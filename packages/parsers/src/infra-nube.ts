import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { parse, parseAllDocuments } from "yaml";
import { cmp, METODOS } from "@flowbrain/core";
import { paqueteDe, type EndpointCrudo, type EventoCrudo, type InfraCruda, type RepoFuente } from "./tipos.js";
import { base, corto, dir, escapar, esMapa, lineaClave, lineaDe, lista, texto, type Mapa } from "./infra-comun.js";
import { rutaCron } from "./entradas.js";

/**
 * Infraestructura de despliegue en la nube, leída sin ejecutar nada: manifiestos de Kubernetes, charts de Helm (sin
 * renderizar), Terraform y funciones serverless (Serverless Framework y AWS SAM). De variables, `ConfigMap` y `Secret`
 * solo salen los nombres, nunca un valor. Un evento http de una función es además un endpoint, atendido por la función
 * del código que nombra su `handler` cuando está en el repo; una cola de la que consume, un evento consumido.
 */

type Item = Omit<InfraCruda, "paquete">;
export interface Nube {
  infra: InfraCruda[];
  endpoints: EndpointCrudo[];
  eventos: EventoCrudo[];
}

const ES_TF = (a: string) => /\.tf$/i.test(a);
const ES_YAML = (a: string) => /\.ya?ml$/i.test(a);
const ES_CHART = (a: string) => base(a) === "Chart.yaml";
const ES_SERVERLESS = (a: string) => /^serverless\.ya?ml$/i.test(base(a));
/** Archivos que pueden traer infraestructura de la nube (los YAML se confirman por su contenido). */
export const ES_NUBE = (a: string) => ES_TF(a) || ES_YAML(a);

const MAX_BYTES = 512 * 1024;
const YAML = { logLevel: "silent", merge: true } as const;
const sinComillas = (s: string) => s.trim().replace(/^"(.*)"$/s, "$1");
const conBarra = (r: string) => "/" + r.trim().replace(/^\/+/, "");
/** `{proxy+}` de API Gateway atrapa todo lo que sigue: es un prefijo, no un endpoint. */
const atrapaTodo = (r: string) => /\{[^}]*\+\}/.test(r) || r === "/*" || r === "*";
const prefijoDe = (r: string) => r.replace(/\/?\{[^}]*\+\}.*$|\/?\*$/, "") || "/";

// ---------- Handler de una función: dónde está en el repo ----------

const EXT = [".ts", ".mts", ".js", ".mjs", ".cjs", ".py"];

function lineaDeFuncion(t: string, archivo: string, fn: string): number | null {
  const f = escapar(fn);
  const patrones = archivo.endsWith(".py")
    ? [new RegExp(`^[ \\t]*(?:async\\s+)?def\\s+${f}\\s*\\(`, "m")]
    : archivo.endsWith(".java")
      ? [new RegExp(`\\b${f}\\s*\\(`)]
      : [
          new RegExp(`^[ \\t]*export\\s+(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${f}\\b`, "m"),
          new RegExp(`^[ \\t]*export\\s+(?:const|let|var)\\s+${f}\\b`, "m"),
          new RegExp(`^[ \\t]*(?:module\\.)?exports\\.${f}\\s*=`, "m"),
          new RegExp(`^[ \\t]*(?:async\\s+)?function\\s*\\*?\\s*${f}\\b|^[ \\t]*(?:const|let|var)\\s+${f}\\s*=`, "m"),
        ];
  for (const p of patrones) {
    const i = t.search(p);
    if (i >= 0) return t.slice(0, i).split("\n").length;
  }
  return null;
}

/** `src/handlers/usuarios.listar` → `src/handlers/usuarios.ts`, función `listar`; `app.lambda_handler` → `app.py`. */
function ubicarHandler(archivos: Set<string>, leer: (a: string) => string | null, raiz: string, handler: string): { archivo: string; linea: number; nombre: string } | null {
  const java = /^([\w.$]+)::(\w+)$/.exec(handler);
  const opciones: Array<{ archivo: string; nombre: string }> = [];
  if (java) {
    const sufijo = java[1]!.replace(/\./g, "/") + ".java";
    for (const a of archivos) if (a === sufijo || a.endsWith("/" + sufijo)) opciones.push({ archivo: a, nombre: java[2]! });
  } else {
    const i = handler.lastIndexOf(".");
    if (i <= 0) return null;
    const modulo = handler.slice(0, i), nombre = handler.slice(i + 1);
    for (const m of new Set([modulo, modulo.replace(/\./g, "/")]))
      for (const e of EXT) opciones.push({ archivo: posix.normalize(posix.join(raiz || ".", m + e)), nombre });
  }
  for (const o of opciones) {
    if (!archivos.has(o.archivo)) continue;
    const t = leer(o.archivo);
    const linea = t === null ? null : lineaDeFuncion(t, o.archivo, o.nombre);
    if (linea !== null) return { archivo: o.archivo, linea, nombre: o.nombre };
  }
  return null;
}

/** Junta lo que sale de una función serverless (Serverless Framework o SAM). */
interface Funcion {
  nombre: string;
  linea: number;
  handler: string | null;
  raiz: string;
  runtime: string | null;
  http: Array<{ metodo: string; ruta: string }>;
  otros: string[];
  colas: Array<{ clase: "cola" | "tema"; nombre: string }>;
  /** Eventos programados (`schedule`, `Schedule`): cada uno es una entrada `CRON` atendida por el handler. */
  horarios: string[];
  variables: string[];
}

function emitirFuncion(f: Funcion, archivo: string, ctx: Ctx) {
  const loc = f.handler ? ubicarHandler(ctx.archivos, ctx.leer, f.raiz, f.handler) : null;
  const detalle: string[] = [];
  if (f.handler) detalle.push(`handler ${f.handler}${loc ? ` → ${loc.archivo}#L${loc.linea}` : " (no se encontró en el repo)"}`);
  if (f.runtime) detalle.push(`runtime ${f.runtime}`);
  const rutas: NonNullable<InfraCruda["rutas"]> = [];
  for (const h of f.http) {
    detalle.push(`http ${h.metodo} ${h.ruta}`);
    const metodo = h.metodo.toUpperCase();
    if (atrapaTodo(h.ruta) || !(METODOS as readonly string[]).includes(metodo)) {
      rutas.push({ ...((METODOS as readonly string[]).includes(metodo) ? { metodo } : {}), ruta: prefijoDe(h.ruta), prefijo: true });
      continue;
    }
    rutas.push({ metodo, ruta: h.ruta, prefijo: false });
    const donde = loc ? { archivo: loc.archivo, linea: loc.linea } : { archivo, linea: f.linea };
    ctx.endpoints.push({ paquete: paqueteDe(ctx.repo, archivo), metodo, ruta: h.ruta, request: null, response: null, ...donde, origen: "infra-parser" });
  }
  for (const c of f.colas) {
    detalle.push(`${c.clase} ${c.nombre}`);
    const donde = loc ? { archivo: loc.archivo, linea: loc.linea } : { archivo, linea: f.linea };
    ctx.eventos.push({ paquete: paqueteDe(ctx.repo, archivo), ...donde, nombre: c.nombre, direccion: "consume" });
  }
  // Un evento programado es una entrada `CRON` atendida por el handler, como un evento http es un endpoint.
  f.horarios.forEach((h, i) => {
    detalle.push(`programada ${h}`);
    const donde = loc ? { archivo: loc.archivo, linea: loc.linea } : { archivo, linea: f.linea };
    ctx.endpoints.push({ paquete: paqueteDe(ctx.repo, archivo), metodo: "CRON", ruta: rutaCron(f.horarios.length > 1 ? `${f.nombre}-${i + 1}` : f.nombre), request: null, response: null, ...donde, origen: "infra-parser", horario: h });
  });
  detalle.push(...f.otros, ...[...new Set(f.variables)].sort(cmp).map((v) => `variable ${v}`));
  ctx.items.push({ archivo, linea: f.linea, clase: "funcion", nombre: f.nombre, detalle, ...(rutas.length ? { rutas } : {}), ...(loc ? { handler: loc } : {}) });
}

interface Ctx {
  repo: RepoFuente;
  archivos: Set<string>;
  leer: (a: string) => string | null;
  items: Item[];
  endpoints: EndpointCrudo[];
  eventos: EventoCrudo[];
}

/** Nombre de una cola o tema: de un ARN, `!GetAtt Cola.Arn`, `{ Ref: Cola }` o un recurso de la misma plantilla. */
function nombreDeRecurso(v: unknown, recursos: Mapa, propiedad: string): string | null {
  if (esMapa(v)) {
    const r = v["Fn::GetAtt"] ?? v["Ref"] ?? v["arn"] ?? v["topicName"] ?? v["queueName"];
    return r === undefined ? null : nombreDeRecurso(r, recursos, propiedad);
  }
  if (Array.isArray(v)) return v.length ? nombreDeRecurso(v[0], recursos, propiedad) : null;
  const s = texto(v);
  if (!s) return null;
  const logico = s.split(".")[0]!;
  const r = recursos[logico];
  if (esMapa(r)) {
    const p = esMapa(r["Properties"]) ? texto(r["Properties"][propiedad]) : null;
    return p && !p.includes("${") ? p : logico;
  }
  if (s.startsWith("arn:")) return s.slice(s.lastIndexOf(":") + 1);
  return s.includes("${") ? null : s;
}

// ---------- Serverless Framework ----------

function serverless(t: string, archivo: string, ctx: Ctx) {
  const doc = parse(t, YAML) as unknown;
  if (!esMapa(doc)) return;
  const prov = esMapa(doc["provider"]) ? doc["provider"] : {};
  const recursos = esMapa(doc["resources"]) && esMapa(doc["resources"]["Resources"]) ? doc["resources"]["Resources"] : {};
  const envProv = esMapa(prov["environment"]) ? Object.keys(prov["environment"]) : [];
  const funciones = esMapa(doc["functions"]) ? doc["functions"] : {};
  const servicio = texto(doc["service"]) ?? (esMapa(doc["service"]) ? texto(doc["service"]["name"]) : null);
  const desde = Math.max(t.search(/^functions\s*:/m), 0);
  ctx.items.push({
    archivo,
    linea: lineaClave(t, "service"),
    clase: "funcion",
    nombre: `serverless ${servicio ?? base(archivo)}`,
    detalle: [
      ...(texto(prov["name"]) ? [`proveedor ${texto(prov["name"])}`] : []),
      ...(texto(prov["runtime"]) ? [`runtime ${texto(prov["runtime"])}`] : []),
      `${Object.keys(funciones).length} funciones`,
      ...envProv.sort(cmp).map((v) => `variable ${v}`),
    ],
  });
  for (const [nombre, f] of Object.entries(funciones)) {
    if (!esMapa(f)) continue;
    const fn: Funcion = { nombre, linea: lineaClave(t, nombre, desde), handler: texto(f["handler"]), raiz: dir(archivo), runtime: texto(f["runtime"]), http: [], otros: [], colas: [], horarios: [], variables: esMapa(f["environment"]) ? Object.keys(f["environment"]) : [] };
    if (texto(f["image"])) fn.otros.push(`imagen ${texto(f["image"])}`);
    for (const e of lista(f["events"])) {
      if (!esMapa(e)) continue;
      const [tipo, v] = Object.entries(e)[0] ?? [];
      if (!tipo) continue;
      if (tipo === "http" || tipo === "httpApi") {
        if (typeof v === "string") {
          const [m, r] = v.trim() === "*" ? ["ANY", "*"] : v.trim().split(/\s+/);
          if (m && r) fn.http.push({ metodo: m.toUpperCase() === "*" ? "ANY" : m.toUpperCase(), ruta: r === "*" ? "*" : conBarra(r) });
        } else if (esMapa(v) && texto(v["path"])) {
          const m = (texto(v["method"]) ?? "ANY").toUpperCase();
          fn.http.push({ metodo: m === "*" ? "ANY" : m, ruta: texto(v["path"]) === "*" ? "*" : conBarra(texto(v["path"])!) });
        }
      } else if (tipo === "schedule") {
        const hs = texto(v) ? [texto(v)!] : esMapa(v) ? lista(v["rate"] ?? v["schedule"]).map(String) : [];
        if (hs.length) fn.horarios.push(...hs);
        else fn.otros.push("programada");
      } else if (tipo === "sqs" || tipo === "sns") {
        const n = nombreDeRecurso(v, recursos, tipo === "sqs" ? "QueueName" : "TopicName");
        if (n) fn.colas.push({ clase: tipo === "sqs" ? "cola" : "tema", nombre: n });
        else fn.otros.push(`evento ${tipo} (nombre armado en tiempo de despliegue)`);
      } else fn.otros.push(`evento ${tipo}`);
    }
    emitirFuncion(fn, archivo, ctx);
  }
}

// ---------- AWS SAM / CloudFormation ----------

function sam(t: string, archivo: string, ctx: Ctx) {
  const doc = parse(t, YAML) as unknown;
  if (!esMapa(doc) || !esMapa(doc["Resources"])) return;
  const recursos = doc["Resources"];
  const glob = esMapa(doc["Globals"]) && esMapa(doc["Globals"]["Function"]) ? doc["Globals"]["Function"] : {};
  const desde = Math.max(t.search(/^Resources\s*:/m), 0);
  const variablesDe = (p: Mapa) => (esMapa(p["Environment"]) && esMapa(p["Environment"]["Variables"]) ? Object.keys(p["Environment"]["Variables"]) : []);
  for (const [id, r] of Object.entries(recursos)) {
    if (!esMapa(r) || !["AWS::Serverless::Function", "AWS::Lambda::Function"].includes(String(r["Type"]))) continue;
    const p = esMapa(r["Properties"]) ? r["Properties"] : {};
    const codeUri = texto(p["CodeUri"]) ?? texto(glob["CodeUri"]) ?? "";
    const fn: Funcion = {
      nombre: id,
      linea: lineaClave(t, id, desde),
      handler: texto(p["Handler"]) ?? texto(glob["Handler"]),
      raiz: posix.normalize(posix.join(dir(archivo) || ".", codeUri)).replace(/^\.\/?$|\/$/g, ""),
      runtime: texto(p["Runtime"]) ?? texto(glob["Runtime"]),
      http: [],
      otros: [],
      colas: [],
      horarios: [],
      variables: [...variablesDe(glob), ...variablesDe(p)],
    };
    if (texto(p["FunctionName"])) fn.otros.push(`nombre ${texto(p["FunctionName"])}`);
    for (const e of Object.values(esMapa(p["Events"]) ? p["Events"] : {})) {
      if (!esMapa(e)) continue;
      const tipo = String(e["Type"] ?? "");
      const ep = esMapa(e["Properties"]) ? e["Properties"] : {};
      if (tipo === "Api" || tipo === "HttpApi") {
        const ruta = texto(ep["Path"]);
        const m = (texto(ep["Method"]) ?? "ANY").toUpperCase();
        if (ruta) fn.http.push({ metodo: m === "*" ? "ANY" : m, ruta: conBarra(ruta) });
        else fn.otros.push(`evento ${tipo} (todas las rutas)`);
      } else if (tipo === "Schedule" || tipo === "ScheduleV2") {
        const h = texto(ep["Schedule"]) ?? texto(ep["ScheduleExpression"]);
        if (h) fn.horarios.push(h);
        else fn.otros.push("programada");
      } else if (tipo === "SQS" || tipo === "SNS") {
        const n = nombreDeRecurso(tipo === "SQS" ? ep["Queue"] : ep["Topic"], recursos, tipo === "SQS" ? "QueueName" : "TopicName");
        if (n) fn.colas.push({ clase: tipo === "SQS" ? "cola" : "tema", nombre: n });
        else fn.otros.push(`evento ${tipo}`);
      } else if (tipo) fn.otros.push(`evento ${tipo}`);
    }
    emitirFuncion(fn, archivo, ctx);
  }
}

// ---------- Kubernetes ----------

const CARGAS = new Set(["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"]);

function contenedores(pod: Mapa): string[] {
  const out: string[] = [];
  for (const c of [...lista(pod["initContainers"]), ...lista(pod["containers"])]) {
    if (!esMapa(c)) continue;
    out.push(`contenedor ${texto(c["name"]) ?? "?"}: imagen ${texto(c["image"]) ?? "?"}`);
    for (const p of lista(c["ports"])) if (esMapa(p) && p["containerPort"] !== undefined) out.push(`puerto ${String(p["containerPort"])}`);
    // Solo el comando: los argumentos pueden llevar una clave.
    if (c["command"]) out.push(`comando ${corto(lista(c["command"]).map(String).join(" "))}`);
    for (const e of lista(c["env"])) {
      if (!esMapa(e) || !texto(e["name"])) continue;
      const vf = esMapa(e["valueFrom"]) ? e["valueFrom"] : null;
      const sk = vf && esMapa(vf["secretKeyRef"]) ? `Secret ${String(vf["secretKeyRef"]["name"])}` : vf && esMapa(vf["configMapKeyRef"]) ? `ConfigMap ${String(vf["configMapKeyRef"]["name"])}` : null;
      out.push(`variable ${texto(e["name"])}${sk ? ` (de ${sk})` : ""}`);
    }
    for (const f of lista(c["envFrom"])) {
      if (!esMapa(f)) continue;
      if (esMapa(f["configMapRef"])) out.push(`variables de ConfigMap ${String(f["configMapRef"]["name"])}`);
      if (esMapa(f["secretRef"])) out.push(`variables de Secret ${String(f["secretRef"]["name"])}`);
    }
  }
  return [...new Set(out)];
}

function kubernetes(t: string, archivo: string, ctx: Ctx) {
  for (const d of parseAllDocuments(t, YAML) as unknown as Array<{ toJS(): unknown; contents?: { range?: number[] } | null }>) {
    const o = d.toJS() as unknown;
    if (!esMapa(o) || typeof o["kind"] !== "string" || typeof o["apiVersion"] !== "string") continue;
    const desde = d.contents?.range?.[0] ?? 0;
    const kind = o["kind"];
    const meta = esMapa(o["metadata"]) ? o["metadata"] : {};
    const nombre = texto(meta["name"]) ?? "?";
    const etiquetas = esMapa(meta["labels"]) ? meta["labels"] : {};
    const spec = esMapa(o["spec"]) ? o["spec"] : {};
    const linea = lineaDe(t, /^kind\s*:/m, desde);
    const ns = texto(meta["namespace"]) ? [`namespace ${texto(meta["namespace"])}`] : [];
    const app = (m: Mapa) => texto(m["app"]) ?? texto(m["app.kubernetes.io/name"]);
    if (CARGAS.has(kind)) {
      const plantilla = kind === "CronJob" ? (spec["jobTemplate"] as Mapa | undefined)?.["spec"] : spec;
      const pod = kind === "Pod" ? spec : esMapa(plantilla) && esMapa(plantilla["template"]) && esMapa(plantilla["template"]["spec"]) ? plantilla["template"]["spec"] : {};
      const detalle = [...ns, ...(spec["replicas"] !== undefined ? [`réplicas ${String(spec["replicas"])}`] : []), ...(texto(spec["schedule"]) ? [`programado ${texto(spec["schedule"])}`] : []), ...contenedores(pod)];
      ctx.items.push({ archivo, linea, clase: "kubernetes", nombre: `${kind} ${nombre}`, detalle, servicio: app(etiquetas) ?? nombre });
    } else if (kind === "Service") {
      const sel = esMapa(spec["selector"]) ? spec["selector"] : {};
      const detalle = [...ns, ...(texto(spec["type"]) ? [`tipo ${texto(spec["type"])}`] : []), ...lista(spec["ports"]).flatMap((p) => (esMapa(p) ? [`puerto ${String(p["port"])}${p["targetPort"] !== undefined ? ` → ${String(p["targetPort"])}` : ""}`] : []))];
      ctx.items.push({ archivo, linea, clase: "kubernetes", nombre: `Service ${nombre}`, detalle, servicio: app(sel) ?? nombre });
    } else if (kind === "Ingress") {
      const anot = esMapa(meta["annotations"]) ? meta["annotations"] : {};
      const reescribe = Object.entries(anot).find(([k]) => /rewrite-target$/.test(k))?.[1];
      const backend = (b: unknown): [string, string] | null => {
        if (!esMapa(b)) return null;
        if (esMapa(b["service"])) {
          const port = esMapa(b["service"]["port"]) ? (b["service"]["port"]["number"] ?? b["service"]["port"]["name"]) : undefined;
          return [String(b["service"]["name"]), port === undefined ? "" : String(port)];
        }
        return b["serviceName"] ? [String(b["serviceName"]), b["servicePort"] === undefined ? "" : String(b["servicePort"])] : null;
      };
      const def = backend(spec["defaultBackend"] ?? spec["backend"]);
      if (def) ctx.items.push({ archivo, linea, clase: "kubernetes", nombre: `Ingress ${nombre} (por defecto)`, detalle: [...ns, `→ ${def[0]}${def[1] ? `:${def[1]}` : ""}`], destino: def[0], rutas: [{ ruta: "/", prefijo: true }] });
      for (const regla of lista(spec["rules"])) {
        if (!esMapa(regla)) continue;
        const host = texto(regla["host"]);
        for (const p of lista(esMapa(regla["http"]) ? regla["http"]["paths"] : [])) {
          if (!esMapa(p)) continue;
          const b = backend(p["backend"]);
          const ruta = texto(p["path"]) ?? "/";
          if (!b) continue;
          // Con rewrite-target el servicio recibe la ruta sin el prefijo: sus endpoints cuelgan de la raíz.
          const rutaEnServicio = reescribe !== undefined ? "/" : ruta.replace(/\(.*$/, "") || "/";
          ctx.items.push({
            archivo,
            linea: lineaDe(t, new RegExp(`path\\s*:\\s*['"]?${escapar(ruta)}['"]?\\s*$`, "m"), desde),
            clase: "kubernetes",
            nombre: `Ingress ${nombre} ${host ?? ""}${ruta}`,
            detalle: [...ns, `→ ${b[0]}${b[1] ? `:${b[1]}` : ""}`, ...(host ? [`host ${host}`] : []), ...(texto(p["pathType"]) ? [`tipo ${texto(p["pathType"])}`] : []), ...(reescribe !== undefined ? [`reescribe a ${String(reescribe)}`] : [])],
            destino: b[0],
            rutas: [{ ruta: rutaEnServicio, prefijo: texto(p["pathType"]) !== "Exact" }],
          });
        }
      }
    } else if (kind === "ConfigMap" || kind === "Secret") {
      // Solo las claves: el valor de un Secret (o de un ConfigMap con algo sensible) nunca llega al brain.
      const claves = [...Object.keys(esMapa(o["data"]) ? o["data"] : {}), ...Object.keys(esMapa(o["stringData"]) ? o["stringData"] : {}), ...Object.keys(esMapa(o["binaryData"]) ? o["binaryData"] : {})];
      ctx.items.push({ archivo, linea, clase: "kubernetes", nombre: `${kind} ${nombre}`, detalle: [...ns, ...[...new Set(claves)].sort(cmp).map((c) => `clave ${c}`)] });
    } else {
      ctx.items.push({ archivo, linea, clase: "kubernetes", nombre: `${kind} ${nombre}`, detalle: ns, ...(app(etiquetas) ? { servicio: app(etiquetas)! } : {}) });
    }
  }
}

// ---------- Helm ----------

function helm(archivo: string, ctx: Ctx) {
  const t = ctx.leer(archivo);
  if (t === null) return;
  const chart = parse(t, YAML) as unknown;
  if (!esMapa(chart)) return;
  const d = dir(archivo);
  const enDir = (r: string) => (d ? `${d}/${r}` : r);
  const nombre = texto(chart["name"]) ?? (base(d) || "chart");
  const detalle: string[] = [];
  if (texto(chart["version"])) detalle.push(`versión ${texto(chart["version"])}`);
  if (texto(chart["appVersion"])) detalle.push(`app ${texto(chart["appVersion"])}`);
  for (const dep of lista(chart["dependencies"])) if (esMapa(dep)) detalle.push(`depende del chart ${String(dep["name"])}${dep["version"] ? ` ${String(dep["version"])}` : ""}${dep["repository"] ? ` (${String(dep["repository"])})` : ""}`);
  const rutas: NonNullable<InfraCruda["rutas"]> = [];
  const vt = ctx.archivos.has(enDir("values.yaml")) ? ctx.leer(enDir("values.yaml")) : null;
  const v = vt ? (parse(vt, YAML) as unknown) : null;
  if (esMapa(v)) {
    const img = esMapa(v["image"]) ? v["image"] : null;
    if (img && texto(img["repository"])) detalle.push(`imagen ${texto(img["repository"])}:${texto(img["tag"]) || `(appVersion${texto(chart["appVersion"]) ? ` ${texto(chart["appVersion"])}` : ""})`}`);
    if (v["replicaCount"] !== undefined) detalle.push(`réplicas ${String(v["replicaCount"])}`);
    const svc = esMapa(v["service"]) ? v["service"] : null;
    if (svc && (svc["port"] !== undefined || svc["type"])) detalle.push(`servicio ${texto(svc["type"]) ?? ""} puerto ${String(svc["port"] ?? "?")}${svc["targetPort"] !== undefined ? ` → ${String(svc["targetPort"])}` : ""}`.replace(/\s+/g, " "));
    const ing = esMapa(v["ingress"]) ? v["ingress"] : null;
    if (ing && ing["enabled"] !== false) {
      for (const h of lista(ing["hosts"])) {
        const host = esMapa(h) ? texto(h["host"]) : texto(h);
        const paths = esMapa(h) ? lista(h["paths"]) : [];
        for (const p of paths.length ? paths : ["/"]) {
          const ruta = esMapa(p) ? texto(p["path"]) ?? "/" : texto(p) ?? "/";
          detalle.push(`ingreso ${host ?? ""}${ruta}`);
          rutas.push({ ruta, prefijo: !(esMapa(p) && p["pathType"] === "Exact") });
        }
      }
    }
    const env = v["env"] ?? v["extraEnv"] ?? v["environment"];
    const vars = esMapa(env) ? Object.keys(env) : lista(env).flatMap((e) => (esMapa(e) && texto(e["name"]) ? [texto(e["name"])!] : []));
    for (const n of [...new Set(vars)].sort(cmp)) detalle.push(`variable ${n}`);
  }
  const otros = [...ctx.archivos].filter((a) => dir(a) === d && /^values.+\.ya?ml$/i.test(base(a))).map(base).sort(cmp);
  if (otros.length) detalle.push(`otros valores: ${otros.join(", ")}`);
  const plantillas = [...ctx.archivos].filter((a) => a.startsWith(enDir("templates/")) && /\.(ya?ml|tpl)$/i.test(a)).sort(cmp);
  for (const p of plantillas) {
    const pt = ctx.leer(p);
    const kinds = pt ? [...new Set([...pt.matchAll(/^kind\s*:\s*([\w-]+)/gm)].map((m) => m[1]!))] : [];
    if (kinds.length) detalle.push(`plantilla ${p.slice(d ? d.length + 1 : 0)}: ${kinds.join(", ")}`);
  }
  // No se renderiza: lo que arman los `{{ }}` (nombres, condiciones, includes) no se conoce sin `helm template`.
  detalle.push("sin renderizar: nombres, condiciones e includes ({{ }}) no se resuelven; los valores salen de values.yaml");
  ctx.items.push({ archivo, linea: lineaClave(t, "name"), clase: "helm", nombre: `chart ${nombre}`, detalle, servicio: nombre, ...(rutas.length ? { rutas } : {}) });
}

// ---------- Terraform ----------

const ATRIBUTOS = new Set(["name", "function_name", "handler", "runtime", "image", "image_uri", "package_type", "port", "container_port", "target_port", "route_key", "target", "desired_count", "memory_size", "timeout", "schedule_expression", "cluster", "family", "engine", "engine_version", "instance_class", "bucket", "location", "region", "source", "version"]);

/** Cuerpo de un bloque desde su `{`, respetando cadenas. */
function cuerpo(t: string, abre: number): string {
  let nivel = 0, enCadena = false;
  for (let i = abre; i < t.length; i++) {
    const c = t[i];
    if (enCadena) {
      if (c === "\\") i++;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') enCadena = true;
    else if (c === "{") nivel++;
    else if (c === "}" && --nivel === 0) return t.slice(abre + 1, i);
  }
  return t.slice(abre + 1);
}

/** Atributos `clave = valor` del primer nivel del bloque. */
function atributos(c: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let nivel = 0;
  for (const l of c.split("\n")) {
    const m = nivel === 0 ? /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(l) : null;
    if (m && !m[2]!.startsWith("<<")) out.push([m[1]!, m[2]!]);
    nivel += (l.match(/[{[(]/g) ?? []).length - (l.match(/[}\])]/g) ?? []).length;
  }
  return out;
}

function terraform(t0: string, archivo: string, ctx: Ctx) {
  // Comentarios fuera (conservando las líneas) para no leer bloques comentados.
  const t = t0.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^[ \t]*(#|\/\/).*$/gm, "");
  const variables: string[] = [], salidas: string[] = [];
  let lineaVar = 0, lineaSal = 0;
  for (const m of t.matchAll(/^[ \t]*(resource|module|variable|output)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/gm)) {
    const [, bloque, a, b] = m;
    const linea = t.slice(0, m.index).split("\n").length;
    const c = cuerpo(t, m.index! + m[0].length - 1);
    const attrs = atributos(c);
    if (bloque === "variable") {
      const tipo = attrs.find(([k]) => k === "type")?.[1];
      variables.push(`variable ${a}${tipo ? `: ${tipo}` : ""}`);
      lineaVar ||= linea;
      continue;
    }
    if (bloque === "output") {
      salidas.push(`salida ${a}`);
      lineaSal ||= linea;
      continue;
    }
    const detalle = attrs.filter(([k]) => ATRIBUTOS.has(k)).map(([k, v]) => `${k} ${corto(sinComillas(v))}`);
    // Imágenes y variables de entorno dentro de bloques anidados (contenedores, `environment { variables = {…} }`).
    for (const im of c.matchAll(/^\s*image\s*=\s*"([^"]+)"/gm)) if (!detalle.includes(`image ${im[1]}`)) detalle.push(`image ${im[1]}`);
    const vars = new Set<string>();
    for (const vb of c.matchAll(/variables\s*=\s*\{([^}]*)\}/g)) for (const k of vb[1]!.matchAll(/^\s*"?([A-Za-z_]\w*)"?\s*=/gm)) vars.add(k[1]!);
    for (const eb of c.matchAll(/\benv\s*\{([^}]*)\}/g)) for (const k of eb[1]!.matchAll(/name\s*=\s*"([^"]+)"/g)) vars.add(k[1]!);
    for (const eb of c.matchAll(/environment\s*=\s*\[([\s\S]*?)\]/g)) for (const k of eb[1]!.matchAll(/name\s*=\s*"([^"]+)"/g)) vars.add(k[1]!);
    detalle.push(...[...vars].sort(cmp).map((v) => `variable ${v}`));
    const literal = (k: string) => {
      const v = attrs.find(([x]) => x === k)?.[1];
      return v && /^"[^"$]*"$/.test(v) ? sinComillas(v) : null;
    };
    const rutas: NonNullable<InfraCruda["rutas"]> = [];
    const rk = literal("route_key");
    const mr = rk ? /^(\w+)\s+(\/\S*)$/.exec(rk) : null;
    if (mr) {
      const metodo = mr[1]!.toUpperCase();
      const ok = (METODOS as readonly string[]).includes(metodo);
      rutas.push(atrapaTodo(mr[2]!) || !ok ? { ...(ok ? { metodo } : {}), ruta: prefijoDe(mr[2]!), prefijo: true } : { metodo, ruta: mr[2]!, prefijo: false });
    }
    // El nombre real del recurso; si no tiene uno literal, su etiqueta, salvo las genéricas (`this`, `main`).
    const etiqueta = bloque === "module" ? a! : b!;
    const servicio = literal("name") ?? literal("function_name") ?? (/^(this|main|default|self|primary|all|principal)$/i.test(etiqueta) ? undefined : etiqueta);
    ctx.items.push({ archivo, linea, clase: "terraform", nombre: bloque === "module" ? `módulo ${a}` : `${a}.${b}`, detalle, ...(servicio ? { servicio } : {}), ...(rutas.length ? { rutas } : {}) });
  }
  if (variables.length) ctx.items.push({ archivo, linea: lineaVar, clase: "terraform", nombre: `variables de ${base(archivo)}`, detalle: variables });
  if (salidas.length) ctx.items.push({ archivo, linea: lineaSal, clase: "terraform", nombre: `salidas de ${base(archivo)}`, detalle: salidas });
}

// ---------- Entrada ----------

export function nube(repo: RepoFuente, yaLeido: (a: string) => boolean): Nube {
  const archivos = new Set(repo.archivos);
  const cache = new Map<string, string | null>();
  const leer = (a: string) => {
    if (!cache.has(a)) {
      try {
        const t = readFileSync(join(repo.raiz, a), "utf8");
        cache.set(a, t.length > MAX_BYTES ? null : t);
      } catch {
        cache.set(a, null);
      }
    }
    return cache.get(a)!;
  };
  const ctx: Ctx = { repo, archivos, leer, items: [], endpoints: [], eventos: [] };
  // Lo de un chart (plantillas y values) lo lee el chart: no son manifiestos sueltos.
  const charts = repo.archivos.filter(ES_CHART).map(dir);
  const delChart = (a: string) => charts.some((d) => { const r = d ? a.slice(d.length + 1) : a; return (d === "" || a.startsWith(d + "/")) && (r.startsWith("templates/") || /^values.*\.ya?ml$/i.test(r) || r === "Chart.lock"); });
  for (const a of repo.archivos) {
    if (yaLeido(a) || !ES_NUBE(a) && !ES_CHART(a)) continue;
    try {
      if (ES_CHART(a)) helm(a, ctx);
      else if (ES_TF(a)) {
        const t = leer(a);
        if (t !== null) terraform(t, a, ctx);
      } else if (ES_YAML(a) && !delChart(a)) {
        const t = leer(a);
        if (t === null) continue;
        if (ES_SERVERLESS(a)) serverless(t, a, ctx);
        else if (/^Resources\s*:/m.test(t) && /AWS::Serverless::Function|AWS::Lambda::Function/.test(t)) sam(t, a, ctx);
        else if (/^apiVersion\s*:/m.test(t) && /^kind\s*:/m.test(t)) kubernetes(t, a, ctx);
      }
    } catch {
      // Un archivo con formato inesperado no aporta; el resto sigue.
    }
  }
  return { infra: ctx.items.map((i) => ({ ...i, paquete: paqueteDe(repo, i.archivo) })), endpoints: ctx.endpoints, eventos: ctx.eventos };
}

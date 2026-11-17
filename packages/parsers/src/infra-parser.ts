import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { cmp } from "@flowbrain/core";
import { extraccionVacia, paqueteDe, type Extraccion, type InfraCruda, type Parser, type RepoFuente } from "./tipos.js";

/**
 * Infraestructura declarada en el repo, sin depender del lenguaje del código: imágenes (Dockerfile), servicios de
 * compose, pipelines de CI (Bitbucket, GitHub Actions, GitLab), variables de entorno de ejemplo y rutas de proxy
 * (nginx). De los archivos de variables solo se leen los de ejemplo y solo los nombres: nunca un `.env` real ni un valor.
 */

const base = (a: string) => a.slice(a.lastIndexOf("/") + 1);
const ES_DOCKERFILE = (a: string) => /^Dockerfile(\..+)?$|\.dockerfile$/i.test(base(a));
const ES_COMPOSE = (a: string) => /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(base(a));
const ES_ENV_EJEMPLO = (a: string) => /^\.?env[.-](example|sample|dist|template|defaults)$|^\.env\.[\w-]+\.(example|sample|dist|template)$|^(example|sample)\.env$/i.test(base(a));
const ES_BITBUCKET = (a: string) => base(a) === "bitbucket-pipelines.yml";
const ES_GITHUB = (a: string) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(a);
const ES_GITLAB = (a: string) => base(a) === ".gitlab-ci.yml";
const ES_PROXY = (a: string) => /\.conf(\.template)?$/i.test(base(a));
const candidato = (a: string) => ES_DOCKERFILE(a) || ES_COMPOSE(a) || ES_ENV_EJEMPLO(a) || ES_BITBUCKET(a) || ES_GITHUB(a) || ES_GITLAB(a) || ES_PROXY(a);

const MAX_DETALLE = 40;
type Mapa = Record<string, unknown>;
const esMapa = (v: unknown): v is Mapa => typeof v === "object" && v !== null && !Array.isArray(v);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const corto = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s).replace(/\s+/g, " ").trim();

/** Línea (desde 1) de la primera aparición de un texto; 1 si no está. */
const lineaDe = (texto: string, aguja: string | RegExp) => {
  const i = typeof aguja === "string" ? texto.indexOf(aguja) : texto.search(aguja);
  return i < 0 ? 1 : texto.slice(0, i).split("\n").length;
};
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lineaClave = (texto: string, clave: string) => lineaDe(texto, new RegExp(`^\\s*['"]?${escapar(clave)}['"]?\\s*:`, "m"));

function dockerfile(texto: string): Array<Omit<InfraCruda, "paquete" | "archivo">> {
  const lineas = texto.replace(/\\\n/g, " ").split("\n");
  const etapas: string[] = [], detalle: string[] = [];
  let final = "", lineaFinal = 1;
  // `ARG IMAGEN=node:22` + `FROM ${IMAGEN}` y `FROM etapa-anterior`: se resuelven a la imagen real.
  const args = new Map<string, string>(), deEtapa = new Map<string, string>();
  texto.split("\n").forEach((l, i) => {
    const a = /^\s*ARG\s+(\w+)=(\S+)/i.exec(l);
    if (a) args.set(a[1]!, a[2]!.replace(/^["']|["']$/g, ""));
    const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(l);
    if (!m) return;
    const conArgs = m[1]!.replace(/\$\{?(\w+)\}?/g, (todo, n: string) => args.get(n) ?? todo);
    const imagen = deEtapa.get(conArgs) ?? conArgs;
    if (m[2]) deEtapa.set(m[2], imagen);
    etapas.push(m[2] ? `etapa ${m[2]}: ${imagen}` : `base ${imagen}`);
    final = imagen;
    lineaFinal = i + 1;
  });
  if (!final) return [];
  for (const l of lineas) {
    const e = /^\s*EXPOSE\s+(.+)$/i.exec(l);
    if (e) for (const p of e[1]!.trim().split(/\s+/)) detalle.push(`puerto ${p}`);
    const c = /^\s*(CMD|ENTRYPOINT)\s+(.+)$/i.exec(l);
    if (c) detalle.push(`${c[1]!.toLowerCase() === "cmd" ? "comando" : "entrada"} ${corto(c[2]!)}`);
    const w = /^\s*WORKDIR\s+(\S+)/i.exec(l);
    if (w) detalle.push(`directorio ${w[1]}`);
  }
  return [{ clase: "imagen", nombre: final, linea: lineaFinal, detalle: [...etapas, ...new Set(detalle)] }];
}

function compose(texto: string): Array<Omit<InfraCruda, "paquete" | "archivo">> {
  const doc = parse(texto, { merge: true }) as unknown;
  const servicios = esMapa(doc) && esMapa(doc["services"]) ? doc["services"] : {};
  return Object.entries(servicios).flatMap(([nombre, s]) => {
    if (!esMapa(s)) return [];
    const detalle: string[] = [];
    if (typeof s["image"] === "string") detalle.push(`imagen ${s["image"]}`);
    const build = s["build"];
    if (typeof build === "string") detalle.push(`construye ${build}`);
    else if (esMapa(build)) detalle.push(`construye ${String(build["context"] ?? ".")}${build["dockerfile"] ? ` (${String(build["dockerfile"])})` : ""}`);
    for (const p of lista(s["ports"])) detalle.push(`puerto ${esMapa(p) ? `${String(p["published"] ?? "")}:${String(p["target"] ?? "")}` : String(p)}`);
    const dep = s["depends_on"];
    const dependeDe = (esMapa(dep) ? Object.keys(dep) : lista(dep).map(String)).sort(cmp);
    for (const d of dependeDe) detalle.push(`depende de ${d}`);
    const env = s["environment"];
    const vars = esMapa(env) ? Object.keys(env) : lista(env).map((v) => String(v).split("=")[0]!);
    for (const v of vars.sort(cmp)) detalle.push(`variable ${v}`);
    for (const f of lista(s["env_file"])) detalle.push(`archivo de variables ${esMapa(f) ? String(f["path"]) : String(f)}`);
    return [{ clase: "servicio", nombre, linea: lineaClave(texto, nombre), detalle, ...(dependeDe.length ? { dependeDe } : {}) }];
  });
}

/** Nombre y comandos de un paso de CI, en cualquiera de los tres formatos. */
function pasos(v: unknown): string[] {
  const out: string[] = [];
  const visitar = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(visitar);
    if (!esMapa(x)) return;
    const paso = esMapa(x["step"]) ? x["step"] : x;
    if (esMapa(x["parallel"]) || Array.isArray(x["parallel"])) visitar(esMapa(x["parallel"]) ? x["parallel"]["steps"] : x["parallel"]);
    if (typeof paso["name"] === "string") out.push(`paso ${paso["name"]}`);
    if (typeof paso["uses"] === "string") out.push(`usa ${paso["uses"]}`);
    if (typeof paso["deployment"] === "string") out.push(`despliega en ${paso["deployment"]}`);
    for (const s of lista(paso["script"] ?? paso["run"])) if (typeof s === "string") for (const l of s.split("\n")) if (l.trim()) out.push(`corre ${corto(l)}`);
  };
  visitar(v);
  return out;
}

function bitbucket(texto: string): Array<Omit<InfraCruda, "paquete" | "archivo">> {
  const doc = parse(texto, { merge: true }) as unknown;
  const p = esMapa(doc) && esMapa(doc["pipelines"]) ? doc["pipelines"] : {};
  const out: Array<Omit<InfraCruda, "paquete" | "archivo">> = [];
  for (const [disparador, v] of Object.entries(p)) {
    if (Array.isArray(v)) out.push({ clase: "pipeline", nombre: disparador, linea: lineaClave(texto, disparador), detalle: pasos(v) });
    else if (esMapa(v)) for (const [patron, w] of Object.entries(v)) out.push({ clase: "pipeline", nombre: `${disparador} ${patron}`, linea: lineaClave(texto, patron), detalle: pasos(w) });
  }
  return out;
}

function github(texto: string): Array<Omit<InfraCruda, "paquete" | "archivo">> {
  const doc = parse(texto, { merge: true }) as unknown;
  if (!esMapa(doc) || !esMapa(doc["jobs"])) return [];
  // YAML 1.1 lee la clave `on` como booleano: se acepta de las dos formas.
  const on = doc["on"] ?? doc["true"];
  const cuando = typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : esMapa(on) ? Object.keys(on) : [];
  const flujo = typeof doc["name"] === "string" ? doc["name"] : "";
  return Object.entries(doc["jobs"]).flatMap(([job, j]) =>
    esMapa(j) ? [{ clase: "pipeline" as const, nombre: flujo ? `${flujo}: ${job}` : job, linea: lineaClave(texto, job), detalle: [...(cuando.length ? [`cuando ${cuando.join(", ")}`] : []), ...(typeof j["environment"] === "string" ? [`despliega en ${j["environment"]}`] : []), ...pasos(j["steps"])] }] : [],
  );
}

function gitlab(texto: string): Array<Omit<InfraCruda, "paquete" | "archivo">> {
  const doc = parse(texto, { merge: true }) as unknown;
  if (!esMapa(doc)) return [];
  return Object.entries(doc).flatMap(([job, j]) =>
    esMapa(j) && j["script"] !== undefined && !job.startsWith(".")
      ? [{ clase: "pipeline" as const, nombre: job, linea: lineaClave(texto, job), detalle: [...(typeof j["stage"] === "string" ? [`etapa ${j["stage"]}`] : []), ...(esMapa(j["environment"]) && j["environment"]["name"] ? [`despliega en ${String(j["environment"]["name"])}`] : typeof j["environment"] === "string" ? [`despliega en ${j["environment"]}`] : []), ...pasos(j)] }]
      : [],
  );
}

function variables(texto: string, archivo: string): Array<Omit<InfraCruda, "paquete" | "archivo">> {
  const nombres = [...new Set([...texto.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]!))].sort(cmp);
  return nombres.length ? [{ clase: "variables", nombre: base(archivo), linea: 1, detalle: nombres }] : [];
}

function proxy(texto: string): Array<Omit<InfraCruda, "paquete" | "archivo">> {
  if (!/\bproxy_pass\b|\bserver\s*\{/.test(texto)) return [];
  const out: Array<Omit<InfraCruda, "paquete" | "archivo">> = [];
  const lineas = texto.split("\n");
  const escucha = [...new Set([...texto.matchAll(/^\s*listen\s+([^;]+);/gm)].map((m) => m[1]!.trim()))];
  const nombres = [...new Set([...texto.matchAll(/^\s*server_name\s+([^;]+);/gm)].flatMap((m) => m[1]!.trim().split(/\s+/)))];
  let actual: { nombre: string; linea: number; nivel: number; detalle: string[] } | null = null;
  let nivel = 0;
  lineas.forEach((l, i) => {
    const loc = /^\s*location\s+(?:[=~^*]+\s+)?(\S+)\s*\{/.exec(l);
    if (loc && !actual) actual = { nombre: loc[1]!, linea: i + 1, nivel, detalle: [] };
    const pp = /^\s*proxy_pass\s+([^;]+);/.exec(l);
    if (pp && actual) actual.detalle.push(`→ ${pp[1]!.trim()}`);
    const raiz = /^\s*(root|alias)\s+([^;]+);/.exec(l);
    if (raiz && actual) actual.detalle.push(`archivos de ${raiz[2]!.trim()}`);
    nivel += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
    if (actual && nivel <= actual.nivel) {
      if (actual.detalle.length) out.push({ clase: "proxy", nombre: actual.nombre, linea: actual.linea, detalle: actual.detalle });
      actual = null;
    }
  });
  if (escucha.length || nombres.length) out.unshift({ clase: "proxy", nombre: "servidor", linea: lineaDe(texto, /\bserver\s*\{/), detalle: [...escucha.map((e) => `escucha ${e}`), ...nombres.map((n) => `nombre ${n}`)] });
  return out;
}

export const infraParser: Parser = {
  nombre: "infra-parser",
  detect: (repo) => repo.archivos.some(candidato),
  extract(repo: RepoFuente): Extraccion {
    const out = extraccionVacia("infra-parser");
    const infra: InfraCruda[] = [];
    for (const archivo of repo.archivos.filter(candidato)) {
      let texto: string;
      try {
        texto = readFileSync(join(repo.raiz, archivo), "utf8");
      } catch {
        continue;
      }
      let items: Array<Omit<InfraCruda, "paquete" | "archivo">> = [];
      try {
        if (ES_DOCKERFILE(archivo)) items = dockerfile(texto);
        else if (ES_COMPOSE(archivo)) items = compose(texto);
        else if (ES_BITBUCKET(archivo)) items = bitbucket(texto);
        else if (ES_GITHUB(archivo)) items = github(texto);
        else if (ES_GITLAB(archivo)) items = gitlab(texto);
        else if (ES_ENV_EJEMPLO(archivo)) items = variables(texto, archivo);
        else if (ES_PROXY(archivo)) items = proxy(texto);
      } catch {
        // YAML inválido o un formato inesperado: ese archivo no aporta, el resto sigue.
        continue;
      }
      // Solo los pipelines se recortan (pueden tener cientos de comandos); las variables van todas, para poder buscarlas.
      for (const it of items) infra.push({ ...it, detalle: it.clase === "pipeline" ? it.detalle.slice(0, MAX_DETALLE) : it.detalle, paquete: paqueteDe(repo, archivo), archivo });
    }
    out.infra = infra.sort((a, b) => cmp(a.archivo, b.archivo) || a.linea - b.linea || cmp(a.nombre, b.nombre));
    return out;
  },
};

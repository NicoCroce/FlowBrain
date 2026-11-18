import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { cmp } from "@flowbrain/core";
import { paqueteDe, type Extraccion, type RepoFuente } from "./tipos.js";

/**
 * Extractores del proyecto: programas chicos, escritos para un repo en particular (por una persona o por un modelo que
 * estudió cómo está hecho), que completan lo que los parsers de FlowBrain no entienden. Viven en
 * `<brain>/extractors/<repo-id>/` y corren en cada indexación, después de los parsers.
 *
 * Contrato: el programa recibe la ruta del repo como primer argumento (y en `FLOWBRAIN_REPO`), corre parado en ella e
 * imprime un JSON por la salida estándar. Cómo lo arma es asunto suyo: el lenguaje del repo no importa. FlowBrain no le
 * cree: cada dato tiene que citar un archivo del repo y una línea que exista; lo que no se comprueba se descarta y queda
 * en el informe.
 *
 * ```json
 * {
 *   "simbolos":     [{ "archivo": "src/Pedidos.go", "nombre": "PedidosHandler.Crear", "tipo": "metodo", "linea": 20, "fin": 41 }],
 *   "invocaciones": [{ "desde": { "archivo": "…", "simbolo": "…" }, "hacia": { "archivo": "…", "simbolo": "…" }, "linea": 27 }],
 *   "endpoints":    [{ "metodo": "POST", "ruta": "/pedidos", "archivo": "src/rutas.go", "linea": 12 }],
 *   "llamadas":     [{ "archivo": "src/api.ts", "linea": 30, "metodo": "GET", "ruta": "/pedidos/{id}", "base": "API_URL" }],
 *   "pantallas":    [{ "ruta": "/pedidos", "archivo": "src/rutas.tsx", "linea": 8, "componente": { "archivo": "…", "simbolo": "Pedidos" } }],
 *   "navegaciones": [{ "archivo": "…", "linea": 14, "desde": "/pedidos", "ruta": "/pedidos/{id}", "tipo": "navega" }],
 *   "accesos":      [{ "archivo": "src/repo.go", "linea": 33, "tabla": "pedidos", "verbo": "escribe", "columnas": ["estado", "total"] }],
 *   "esquema":      [{ "tabla": "pedidos", "archivo": "src/models.go", "linea": 5, "columnas": [{ "nombre": "id", "tipo": "int", "pk": true }, { "nombre": "nota", "tipo": "text", "nulo": true }] }],
 *   "quitar":       [{ "tipo": "llamada", "archivo": "src/api.ts", "linea": 30 }, { "tipo": "pantalla", "ruta": "/{path}/config" }]
 * }
 * ```
 *
 * Un extractor también corrige lo que el parser leyó mal: una llamada en una línea reemplaza a las que el parser dejó en
 * esa misma línea (con o sin ruta), una pantalla con una ruta que ya existe le reemplaza el componente y las envolturas,
 * `esquema` reemplaza las columnas que un parser haya leído para esa tabla (un ORM que FlowBrain no conoce, una convención
 * de nombres propia), y `quitar` borra lo que el parser inventó (una llamada, una pantalla o una navegación). Solo se corrige lo que vino de
 * un parser: lo que sumó otro extractor no se toca.
 */
export const CARPETA_EXTRACTORES = "extractors";
export const RUTA_INFORME_EXTRACTORES = (repo: string) => `_build/extractors/${repo}.json`;

const INTERPRETES: Record<string, string> = { ".mjs": "node", ".js": "node", ".cjs": "node", ".py": "python3", ".sh": "sh", ".rb": "ruby", ".php": "php" };
const TIEMPO_MS = 180_000;
const TIPOS = ["simbolos", "invocaciones", "endpoints", "llamadas", "pantallas", "navegaciones", "accesos", "esquema", "quitar"] as const;
type Tipo = (typeof TIPOS)[number];

export interface InformeExtractor {
  extractor: string;
  ms: number;
  /** No corrió, tardó demasiado o no imprimió un JSON: no aportó nada. */
  error?: string;
  aceptados: Record<Tipo, number>;
  rechazados: number;
  /** Los primeros motivos de rechazo, para corregir el extractor. */
  motivos: string[];
  /** Accesos con `soloColumnas` que no encontraron un acceso del índice al que sumarse. */
  omitidos?: number;
  /** Total aceptado en la corrida anterior, y si esta vez devolvió bastante menos: revisar. */
  antes?: number;
  caida?: true;
}

/**
 * macOS: el extractor corre sin red, sin poder escribir en el disco y sin leer archivos de entorno reales. En otros
 * sistemas corre con el entorno recortado (sin variables del usuario) y el mismo tope de tiempo.
 */
const PERFIL_SANDBOX = [
  "(version 1)",
  "(allow default)",
  "(deny network*)",
  '(deny file-write* (subpath "/"))',
  '(allow file-write* (subpath "/dev"))',
  '(deny file-read* (regex #"/\\.env$") (regex #"/\\.env\\.(local|prod|production|development|dev|staging|test)$") (regex #"/env\\.(prod|production|local)$"))',
].join("");
const ejecutar = promisify(execFile);

async function correr(archivo: string, repo: RepoFuente): Promise<string> {
  const ext = archivo.slice(archivo.lastIndexOf("."));
  const base = [INTERPRETES[ext]!, archivo, repo.raiz];
  const sandbox = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
  const [cmd, ...args] = sandbox ? ["/usr/bin/sandbox-exec", "-p", PERFIL_SANDBOX, ...base] : base;
  const env = { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LANG: "C.UTF-8", FLOWBRAIN_REPO: repo.raiz };
  const { stdout } = await ejecutar(cmd!, args, { cwd: repo.raiz, env, timeout: TIEMPO_MS, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

const esTexto = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const esLinea = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const lista = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const VERBOS: Record<string, "lee_de" | "escribe_en"> = { lee: "lee_de", lee_de: "lee_de", read: "lee_de", escribe: "escribe_en", escribe_en: "escribe_en", write: "escribe_en" };

/** Corre los extractores de `repoId` y suma a `x` lo que se pudo comprobar. Devuelve el informe de cada uno. */
export async function correrExtractores(raizBrain: string, repoId: string, repo: RepoFuente, x: Extraccion): Promise<InformeExtractor[]> {
  const dir = join(raizBrain, CARPETA_EXTRACTORES, repoId);
  const programas = (await readdir(dir).catch(() => [] as string[])).filter((n) => INTERPRETES[n.slice(n.lastIndexOf("."))] && !n.startsWith(".") && !n.startsWith("_")).sort(cmp);
  if (!programas.length) return [];
  const previos = await readFile(join(raizBrain, RUTA_INFORME_EXTRACTORES(repoId)), "utf8").then((t) => (JSON.parse(t) as { extractores?: InformeExtractor[] }).extractores ?? [], () => [] as InformeExtractor[]);
  const enRepo = new Set(repo.archivos);
  const lineas = new Map<string, number>();
  const lineasDe = (a: string) => lineas.get(a) ?? lineas.set(a, readFileSync(join(repo.raiz, a), "utf8").split("\n").length).get(a)!;
  const informes: InformeExtractor[] = [];
  // Lo que vino de los parsers: es lo único que un extractor puede corregir o quitar.
  const delParser = { llamadas: new Set(x.llamadas), pantallas: new Set(x.pantallas), navegaciones: new Set(x.navegaciones) };
  /** Líneas que algún extractor ya corrigió: la segunda llamada en la misma línea se suma a la primera. */
  const corregidas = new Set<string>();

  for (const nombre of programas) {
    const inf: InformeExtractor = { extractor: nombre, ms: 0, aceptados: { simbolos: 0, invocaciones: 0, endpoints: 0, llamadas: 0, pantallas: 0, navegaciones: 0, accesos: 0, esquema: 0, quitar: 0 }, rechazados: 0, motivos: [] };
    informes.push(inf);
    const t0 = Date.now();
    let salida: Record<string, unknown>;
    try {
      salida = JSON.parse(await correr(join(dir, nombre), repo)) as Record<string, unknown>;
    } catch (e) {
      inf.ms = Date.now() - t0;
      inf.error = (e as Error).message.split("\n").slice(0, 3).join(" ").slice(0, 300);
      continue;
    }
    inf.ms = Date.now() - t0;
    const rechazar = (tipo: Tipo, d: unknown, motivo: string) => {
      inf.rechazados++;
      if (inf.motivos.length < 15) inf.motivos.push(`${tipo}: ${motivo} — ${JSON.stringify(d).slice(0, 140)}`);
    };
    /** El dato cita un archivo del repo y una línea que existe. */
    const cita = (archivo: unknown, linea: unknown): string | null =>
      !esTexto(archivo) || !enRepo.has(archivo) ? "el archivo no existe en el repo" : !esLinea(linea) || linea > lineasDe(archivo) ? "la línea no existe en ese archivo" : null;
    const archivoDe = (ruta: string) => {
      let a = x.archivos.find((f) => f.ruta === ruta);
      if (!a) {
        a = { lenguaje: ruta.slice(ruta.lastIndexOf(".") + 1), ruta, simbolos: [] };
        x.archivos.push(a);
      }
      return a;
    };
    const simbolo = (ruta: unknown, nombreS: unknown) => (esTexto(ruta) && esTexto(nombreS) ? x.archivos.find((f) => f.ruta === ruta)?.simbolos.find((s) => s.nombre === nombreS) : undefined);

    for (const d of lista(salida["simbolos"])) {
      const m = cita(d["archivo"], d["linea"]) ?? (!esTexto(d["nombre"]) ? "falta el nombre" : d["fin"] !== undefined && (!esLinea(d["fin"]) || d["fin"] < (d["linea"] as number) || d["fin"] > lineasDe(d["archivo"] as string)) ? "`fin` no es una línea válida" : null);
      if (m) {
        rechazar("simbolos", d, m);
        continue;
      }
      const a = archivoDe(d["archivo"] as string);
      const ya = a.simbolos.find((s) => s.nombre === d["nombre"]);
      // Si el parser ya lo tenía sin rango, el extractor se lo completa.
      if (ya) {
        if (ya.fin === undefined && d["fin"] !== undefined) ya.fin = d["fin"] as number;
      } else a.simbolos.push({ linea: d["linea"] as number, nombre: d["nombre"] as string, tipo: esTexto(d["tipo"]) ? d["tipo"] : "funcion", ...(d["fin"] !== undefined ? { fin: d["fin"] as number } : {}) });
      a.simbolos.sort((p, q) => p.linea - q.linea);
      inf.aceptados.simbolos++;
    }
    for (const d of lista(salida["invocaciones"])) {
      const de = d["desde"] as Record<string, unknown> | undefined, a = d["hacia"] as Record<string, unknown> | undefined;
      const s = simbolo(de?.["archivo"], de?.["simbolo"]);
      const m = !s ? "no existe el símbolo `desde` (declaralo en `simbolos`)" : !simbolo(a?.["archivo"], a?.["simbolo"]) ? "no existe el símbolo `hacia` (declaralo en `simbolos`)" : !esLinea(d["linea"]) || d["linea"] < s.linea || d["linea"] > (s.fin ?? s.linea) ? "la línea no está dentro del símbolo que llama" : null;
      if (m) {
        rechazar("invocaciones", d, m);
        continue;
      }
      const arc = archivoDe(de!["archivo"] as string);
      if (!(arc.invoca ?? []).some((i) => i.desde === de!["simbolo"] && i.archivo === a!["archivo"] && i.simbolo === a!["simbolo"])) {
        (arc.invoca ??= []).push({ desde: de!["simbolo"] as string, archivo: a!["archivo"] as string, simbolo: a!["simbolo"] as string, linea: d["linea"] as number });
      }
      if (arc.sinResolver) arc.sinResolver = arc.sinResolver.filter((r) => !(r.desde === de!["simbolo"] && r.linea === d["linea"]));
      inf.aceptados.invocaciones++;
    }
    for (const d of lista(salida["endpoints"])) {
      const m = cita(d["archivo"], d["linea"]) ?? (!esTexto(d["metodo"]) || !esTexto(d["ruta"]) || !d["ruta"].startsWith("/") ? "faltan `metodo` o `ruta` (que empiece con /)" : null);
      if (m) {
        rechazar("endpoints", d, m);
        continue;
      }
      const e = { paquete: paqueteDe(repo, d["archivo"] as string), metodo: (d["metodo"] as string).toUpperCase(), ruta: d["ruta"] as string, request: esTexto(d["request"]) ? d["request"] : null, response: esTexto(d["response"]) ? d["response"] : null, archivo: d["archivo"] as string, linea: d["linea"] as number };
      if (!x.endpoints.some((y) => y.paquete === e.paquete && y.metodo === e.metodo && y.ruta === e.ruta)) x.endpoints.push(e);
      inf.aceptados.endpoints++;
    }
    for (const d of lista(salida["llamadas"])) {
      const m = cita(d["archivo"], d["linea"]) ?? (!esTexto(d["metodo"]) || !esTexto(d["ruta"]) || !d["ruta"].startsWith("/") ? "faltan `metodo` o `ruta` (que empiece con /)" : null);
      if (m) {
        rechazar("llamadas", d, m);
        continue;
      }
      const l = { archivo: d["archivo"] as string, linea: d["linea"] as number, metodo: (d["metodo"] as string).toUpperCase(), ruta: d["ruta"] as string };
      const base = esTexto(d["base"]) ? d["base"] : null;
      // Reemplaza a las que el parser haya dejado en esa línea, con o sin ruta: el extractor leyó mejor.
      const clave = `${l.archivo}#${l.linea}`;
      if (!corregidas.has(clave)) {
        corregidas.add(clave);
        x.llamadas = x.llamadas.filter((y) => !(delParser.llamadas.has(y) && y.archivo === l.archivo && y.linea === l.linea));
      }
      if (!x.llamadas.some((y) => y.archivo === l.archivo && y.linea === l.linea && y.metodo === l.metodo && y.url.ruta === l.ruta)) {
        x.llamadas.push({ paquete: paqueteDe(repo, l.archivo), ...l, url: { base: base ? "dinamica" : "relativa", host: null, ruta: l.ruta, texto: base ? `\${${base}}${l.ruta}` : l.ruta }, dato: null });
      }
      inf.aceptados.llamadas++;
    }
    for (const d of lista(salida["pantallas"])) {
      const c = d["componente"] as Record<string, unknown> | null | undefined;
      const m = cita(d["archivo"], d["linea"]) ?? (!esTexto(d["ruta"]) || !d["ruta"].startsWith("/") ? "falta `ruta` (que empiece con /)" : c && !simbolo(c["archivo"], c["simbolo"]) ? "no existe el símbolo del `componente` (declaralo en `simbolos`)" : null);
      if (m) {
        rechazar("pantallas", d, m);
        continue;
      }
      const paquete = paqueteDe(repo, d["archivo"] as string);
      const envuelta = lista(d["envuelta"]).filter((e) => simbolo(e["archivo"], e["simbolo"])).map((e) => ({ archivo: e["archivo"] as string, simbolo: e["simbolo"] as string }));
      const nueva = { paquete, ruta: d["ruta"] as string, archivo: d["archivo"] as string, linea: d["linea"] as number, componente: c ? { archivo: c["archivo"] as string, simbolo: c["simbolo"] as string } : null, envuelta };
      const ya = x.pantallas.find((y) => y.paquete === paquete && y.ruta === d["ruta"]);
      // Si el parser ya la tenía, el extractor le corrige el componente y las envolturas (un layout tomado por la página).
      if (ya && delParser.pantallas.has(ya)) x.pantallas[x.pantallas.indexOf(ya)] = nueva;
      else if (!ya) x.pantallas.push(nueva);
      inf.aceptados.pantallas++;
    }
    for (const d of lista(salida["navegaciones"])) {
      const tipo = d["tipo"] === "enlace" || d["tipo"] === "redirige" ? d["tipo"] : "navega";
      const m = cita(d["archivo"], d["linea"]) ?? (!esTexto(d["ruta"]) ? "falta `ruta`" : null);
      if (m) {
        rechazar("navegaciones", d, m);
        continue;
      }
      x.navegaciones.push({ paquete: paqueteDe(repo, d["archivo"] as string), archivo: d["archivo"] as string, linea: d["linea"] as number, desde: esTexto(d["desde"]) ? d["desde"] : null, ruta: d["ruta"] as string, tipo });
      inf.aceptados.navegaciones++;
    }
    for (const d of lista(salida["accesos"])) {
      const verbo = VERBOS[String(d["verbo"] ?? d["op"] ?? "")];
      const m = cita(d["archivo"], d["linea"]) ?? (!esTexto(d["tabla"]) ? "falta `tabla`" : !verbo ? "`verbo` tiene que ser `lee` o `escribe`" : null);
      if (m || !verbo) {
        rechazar("accesos", d, m ?? "verbo inválido");
        continue;
      }
      const paquete = paqueteDe(repo, d["archivo"] as string), tabla = d["tabla"] as string;
      const columnas = Array.isArray(d["columnas"]) ? [...new Set(d["columnas"].filter(esTexto))].sort(cmp) : [];
      const ya = x.tablas.find((y) => y.archivo === d["archivo"] && y.linea === d["linea"] && y.verbo === verbo && (y.modelo === tabla || x.modelos.some((mo) => mo.nombre === y.modelo && mo.tabla === tabla)));
      // Si el parser ya vio ese acceso, el extractor le suma las columnas.
      if (ya) {
        if (columnas.length) ya.columnas = [...new Set([...(ya.columnas ?? []), ...columnas])].sort(cmp);
      } else if (d["soloColumnas"] === true) {
        // El extractor solo quería completar un acceso que ya estuviera en el índice: sin él, no crea nada.
        inf.omitidos = (inf.omitidos ?? 0) + 1;
        continue;
      } else {
        if (!x.modelos.some((mo) => mo.nombre === tabla)) x.modelos.push({ paquete, nombre: tabla, tabla, archivo: d["archivo"] as string, linea: d["linea"] as number });
        x.tablas.push({ paquete, archivo: d["archivo"] as string, linea: d["linea"] as number, modelo: tabla, verbo, ...(columnas.length ? { columnas } : {}) });
      }
      inf.aceptados.accesos++;
    }
    for (const d of lista(salida["quitar"])) {
      const tipo = d["tipo"];
      const coincide = (y: { archivo: string; linea: number; ruta?: string | null }) =>
        (d["archivo"] === undefined || y.archivo === d["archivo"]) && (d["linea"] === undefined || y.linea === d["linea"]) && (d["ruta"] === undefined || y.ruta === d["ruta"]);
      const m =
        tipo !== "llamada" && tipo !== "pantalla" && tipo !== "navegacion"
          ? "`tipo` tiene que ser `llamada`, `pantalla` o `navegacion`"
          : d["archivo"] === undefined && d["ruta"] === undefined
            ? "falta `archivo` (con `linea`) o `ruta`: no se quita nada a ciegas"
            : d["archivo"] !== undefined
              ? cita(d["archivo"], d["linea"] ?? 1)
              : null;
      if (m) {
        rechazar("quitar", d, m);
        continue;
      }
      const antes = x.llamadas.length + x.pantallas.length + x.navegaciones.length;
      if (tipo === "llamada") x.llamadas = x.llamadas.filter((y) => !(delParser.llamadas.has(y) && coincide({ archivo: y.archivo, linea: y.linea, ruta: y.url.ruta }) && (d["metodo"] === undefined || y.metodo === String(d["metodo"]).toUpperCase())));
      if (tipo === "pantalla") x.pantallas = x.pantallas.filter((y) => !(delParser.pantallas.has(y) && coincide(y)));
      if (tipo === "navegacion") x.navegaciones = x.navegaciones.filter((y) => !(delParser.navegaciones.has(y) && coincide(y)));
      if (x.llamadas.length + x.pantallas.length + x.navegaciones.length === antes) rechazar("quitar", d, "no coincide con nada que haya leído un parser");
      else inf.aceptados.quitar++;
    }
    for (const d of lista(salida["esquema"])) {
      const cols = Array.isArray(d["columnas"]) ? (d["columnas"] as unknown[]).filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && esTexto((c as Record<string, unknown>)["nombre"])) : [];
      const m = cita(d["archivo"], d["linea"]) ?? (!esTexto(d["tabla"]) ? "falta `tabla`" : !cols.length ? "faltan `columnas` con `nombre`" : null);
      if (m) {
        rechazar("esquema", d, m);
        continue;
      }
      // La tabla o alguna de sus columnas tiene que aparecer en el archivo citado.
      const texto = readFileSync(join(repo.raiz, d["archivo"] as string), "utf8").toLowerCase();
      if (![d["tabla"] as string, ...cols.map((c) => c["nombre"] as string)].some((n) => texto.includes(n.toLowerCase()))) {
        rechazar("esquema", d, "ni la tabla ni sus columnas aparecen en ese archivo");
        continue;
      }
      const tabla = d["tabla"] as string;
      x.esquema = [
        {
          paquete: paqueteDe(repo, d["archivo"] as string),
          tabla,
          archivo: d["archivo"] as string,
          linea: d["linea"] as number,
          columnas: cols.map((c) => ({ nombre: c["nombre"] as string, tipo: esTexto(c["tipo"]) ? c["tipo"] : "?", nulo: c["nulo"] === true, pk: c["pk"] === true })),
          fks: [],
        },
        ...(x.esquema ?? []).filter((t) => t.tabla !== tabla),
      ];
      inf.aceptados.esquema++;
    }
    for (const k of Object.keys(salida)) if (!(TIPOS as readonly string[]).includes(k)) rechazar("simbolos", k, `sección desconocida: ${k}`);

    const total = TIPOS.reduce((n, t) => n + inf.aceptados[t], 0);
    const previo = previos.find((p) => p.extractor === nombre);
    if (previo && !previo.error) {
      inf.antes = TIPOS.reduce((n, t) => n + (previo.aceptados?.[t] ?? 0), 0);
      // Devolvió bastante menos que la vez anterior: el código cambió y el extractor quedó viejo.
      if (inf.antes >= 10 && total < inf.antes * 0.7) inf.caida = true;
    }
  }
  x.archivos.sort((a, b) => cmp(a.ruta, b.ruta));
  for (const a of x.archivos) if (a.sinResolver && !a.sinResolver.length) delete a.sinResolver;
  return informes;
}

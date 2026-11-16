import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { cmp, cmpTuple, stringifyCanonical } from "./canonical.js";
import { compile, type Fuente } from "./compile.js";
import { compileDir, leerEntradas, escribirSalidas } from "./fs.js";
import { claveDudosa, EVIDENCIA, RUTA_VERIFICACION, VerificacionSchema, type Dudosa, type Graph, type GraphEdge } from "./schema.js";

/**
 * Verificador (`brain verify`). Para cada arista con evidencia comprueba que el archivo exista en el clon local
 * del repo, que la línea exista y, si `_build/archivos/<repo>.json` registra un símbolo en esa línea, que la línea
 * todavía lo nombre. Las que fallan quedan en `_build/verificacion.json` y `compile` las marca `dudoso`.
 */

/**
 * Lector de archivos de repos: devuelve las líneas del archivo, `null` si el archivo no existe y `undefined`
 * si el repo no está disponible localmente (sus aristas no se pueden verificar).
 */
export type LectorRepo = (repo: string, ruta: string) => Promise<string[] | null | undefined>;

export interface ResultadoVerificacion {
  dudosas: Dudosa[];
  /** Dudosas que no estaban en la verificación anterior (hacen fallar a CI). */
  nuevas: Dudosa[];
  /** Estaban dudosas y ahora su evidencia vuelve a existir. */
  recuperadas: Dudosa[];
  verificadas: number;
  noVerificables: Array<{ repo: string; aristas: number }>;
}

/** Símbolos por `repo:ruta` → línea → nombres, desde `_build/archivos/*.json`. */
export function indiceSimbolos(archivos: Fuente[]): Map<string, Map<number, string[]>> {
  const out = new Map<string, Map<number, string[]>>();
  for (const f of archivos) {
    let j: { repo?: string; archivos?: Array<{ ruta: string; simbolos: Array<{ linea: number; nombre: string }> }> };
    try {
      j = JSON.parse(f.contenido) as typeof j;
    } catch {
      continue;
    }
    for (const a of j.archivos ?? []) {
      const m = new Map<number, string[]>();
      for (const s of a.simbolos) m.set(s.linea, [...(m.get(s.linea) ?? []), s.nombre]);
      out.set(`${j.repo}:${a.ruta}`, m);
    }
  }
  return out;
}

export async function verificarAristas(
  graph: Graph,
  leer: LectorRepo,
  simbolos: Map<string, Map<number, string[]>>,
  anterior: Dudosa[] = [],
): Promise<ResultadoVerificacion> {
  const dudosas: Dudosa[] = [];
  const noDisponibles = new Map<string, number>();
  let verificadas = 0;
  const aristas = graph.edges.filter((e): e is GraphEdge & { evidencia: string } => e.evidencia !== null && e.estado !== "deprecado");
  for (const e of aristas) {
    const m = EVIDENCIA.exec(e.evidencia);
    if (!m) continue;
    const [, repo, ruta, lineas] = m as unknown as [string, string, string, string | undefined];
    const contenido = await leer(repo, ruta);
    if (contenido === undefined) {
      noDisponibles.set(repo, (noDisponibles.get(repo) ?? 0) + 1);
      continue;
    }
    verificadas++;
    const dudosa = (motivo: string) => dudosas.push({ desde: e.desde, endpoint: e.endpoint, evidencia: e.evidencia, hasta: e.hasta, motivo, verbo: e.verbo });
    if (contenido === null) {
      dudosa("archivo inexistente");
      continue;
    }
    if (!lineas) continue;
    const [desde, hasta] = lineas.replace(/#L/, "").split("-L").map(Number) as [number, number | undefined];
    const ultima = hasta ?? desde;
    if (ultima > contenido.length) {
      dudosa(`línea ${ultima} fuera del archivo (${contenido.length} líneas)`);
      continue;
    }
    const esperados = simbolos.get(`${repo}:${ruta}`)?.get(desde);
    // Los métodos se guardan como `Clase.metodo`; en la línea aparece solo el nombre del método.
    if (esperados && !esperados.some((s) => (contenido[desde - 1] ?? "").includes(s.slice(s.lastIndexOf(".") + 1)))) {
      dudosa(`la línea ${desde} ya no contiene \`${esperados.join("`, `")}\``);
    }
  }
  // Las dudosas de repos no disponibles se conservan: un clon ausente no es evidencia de nada.
  for (const d of anterior) {
    const repo = EVIDENCIA.exec(d.evidencia)?.[1];
    if (repo && noDisponibles.has(repo) && aristas.some((e) => claveDudosa(e) === claveDudosa(d))) dudosas.push(d);
  }
  const orden = (a: Dudosa, b: Dudosa) => cmpTuple([a.desde, a.verbo, a.hasta, a.endpoint ?? "", a.evidencia], [b.desde, b.verbo, b.hasta, b.endpoint ?? "", b.evidencia]);
  const actuales = [...new Map(dudosas.map((d) => [claveDudosa(d), d])).values()].sort(orden);
  const previas = new Set(anterior.map(claveDudosa));
  const ahora = new Set(actuales.map(claveDudosa));
  return {
    dudosas: actuales,
    nuevas: actuales.filter((d) => !previas.has(claveDudosa(d))),
    recuperadas: anterior.filter((d) => !ahora.has(claveDudosa(d))).sort(orden),
    verificadas,
    noVerificables: [...noDisponibles].map(([repo, n]) => ({ repo, aristas: n })).sort((a, b) => cmp(a.repo, b.repo)),
  };
}

/** Nodos de página sin verificar en `dias` días (o nunca), respecto de `hoy` (YYYY-MM-DD). */
export function nodosSinVerificar(graph: Graph, hoy: string, dias: number): Array<{ id: string; verificado: string | null }> {
  const limite = new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
  return graph.nodes
    .filter((n) => n.pagina !== null && (n.verificado === null || n.verificado < limite))
    .map((n) => ({ id: n.id, verificado: n.verificado }))
    .sort((a, b) => cmp(a.id, b.id));
}

const sinPrefijo = (id: string) => id.slice(id.indexOf("-") + 1);

/** Resuelve el clon local de cada repo: mapa explícito o una carpeta con su id, id sin prefijo o alias. */
export async function ubicarRepos(graph: Graph, mapa: Record<string, string>, carpetas: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>(Object.entries(mapa));
  for (const n of graph.nodes.filter((x) => x.tipo === "repo" && !out.has(x.id))) {
    for (const c of carpetas) {
      for (const nombre of [n.id, sinPrefijo(n.id), ...n.aliases]) {
        const ruta = join(c, nombre);
        if (await stat(ruta).then((s) => s.isDirectory(), () => false)) {
          out.set(n.id, ruta);
          break;
        }
      }
      if (out.has(n.id)) break;
    }
  }
  return out;
}

export async function leerVerificacion(raiz: string): Promise<Dudosa[]> {
  const t = await readFile(join(raiz, RUTA_VERIFICACION), "utf8").catch(() => null);
  if (t === null) return [];
  return VerificacionSchema.parse(JSON.parse(t)).dudosas;
}

/**
 * `brain verify`: compila en memoria, verifica, escribe `_build/verificacion.json` y recompila para que
 * `graph.json` refleje los `dudoso`. Lecturas acotadas a los clones locales.
 */
export async function verifyDir(
  raiz: string,
  opciones: { repos?: Record<string, string>; carpetas?: string[]; hoy: string; dias?: number },
): Promise<ResultadoVerificacion & { sinVerificar: Array<{ id: string; verificado: string | null }>; escritos: string[] }> {
  const entradas = await leerEntradas(raiz);
  const { graph } = compile(entradas);
  const clones = await ubicarRepos(graph, opciones.repos ?? {}, opciones.carpetas ?? []);
  const cache = new Map<string, Promise<string[] | null>>();
  const leer: LectorRepo = (repo, ruta) => {
    const base = clones.get(repo);
    if (base === undefined) return Promise.resolve(undefined);
    const k = `${repo}:${ruta}`;
    if (!cache.has(k)) {
      cache.set(
        k,
        readFile(join(base, ruta), "utf8").then(
          (t) => t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"),
          // Una carpeta existe aunque no se pueda leer como texto (evidencia de `codigo` de una feat).
          (e: NodeJS.ErrnoException) => (e.code === "EISDIR" ? [] : null),
        ),
      );
    }
    return cache.get(k)!;
  };
  const r = await verificarAristas(graph, leer, indiceSimbolos(entradas.archivos), await leerVerificacion(raiz));
  const escritos = await escribirSalidas(raiz, {
    graph,
    generados: { [RUTA_VERIFICACION]: stringifyCanonical({ dudosas: r.dudosas, version: 1 }) },
    paginas: {},
    funcionalidades: [],
  });
  const s = await compileDir(raiz);
  escritos.push(...s.escritos);
  return { ...r, sinVerificar: nodosSinVerificar(s.salidas.graph, opciones.hoy, opciones.dias ?? 90), escritos: [...new Set(escritos)].sort(cmp) };
}

import { cmp, cmpTuple } from "../canonical.js";
import { ENDPOINT_REF, VERBOS, normalizarRuta, type Estado, type GraphEdge, type GraphNode, type Verbo } from "../schema.js";
import type { Contexto } from "./contexto.js";
import { ajustar, confNodo, endpointsDe, PROYECCIONES, proyectar, type ConPresupuesto, type Item, type Proyeccion } from "./proyeccion.js";

export class ConsultaError extends Error {
  constructor(
    public readonly codigo: "nodo_inexistente" | "parametro_invalido",
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ConsultaError";
  }
}

export const BUDGET_POR_DEFECTO = 2000;
export const PROFUNDIDAD_MAX = 5;

interface Comunes {
  proyeccion?: Proyeccion;
  budget_tokens?: number | null;
}

function comunes(c: Comunes, porDefecto: Proyeccion): { proyeccion: Proyeccion; budget: number | null } {
  const proyeccion = c.proyeccion ?? porDefecto;
  if (!PROYECCIONES.includes(proyeccion)) throw new ConsultaError("parametro_invalido", `proyeccion inválida: ${String(proyeccion)}`);
  const budget = c.budget_tokens === undefined ? BUDGET_POR_DEFECTO : c.budget_tokens;
  if (budget !== null && (!Number.isInteger(budget) || budget < 1)) {
    throw new ConsultaError("parametro_invalido", "budget_tokens debe ser un entero positivo o null");
  }
  return { proyeccion, budget };
}

function nodoOError(ctx: Contexto, id: string): GraphNode {
  const n = ctx.nodo.get(id);
  if (!n) throw new ConsultaError("nodo_inexistente", `no existe el nodo: ${id}`);
  return n;
}

/** Arista tal como aparece en `via` y en los saltos. */
export interface AristaRef {
  confianza: number;
  desde: string;
  endpoint: string | null;
  estado: Estado;
  evidencia: string | null;
  hasta: string;
  verbo: Verbo;
}

const ref = (e: GraphEdge): AristaRef => ({
  confianza: e.confianza,
  desde: e.desde,
  endpoint: e.endpoint,
  estado: e.estado,
  evidencia: e.evidencia,
  hasta: e.hasta,
  verbo: e.verbo,
});
const claveE = (e: GraphEdge) => [e.desde, e.verbo, e.hasta, e.endpoint ?? ""];

// ============================== buscar_nodo ==============================

export interface BuscarParams extends Comunes {
  texto: string;
  tipos?: string[];
  limite?: number;
}

export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < minFila) minFila = v;
    }
    if (minFila > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const RANGO = { exacta: 3, prefijo: 2, difusa: 1 } as const;
type Coincidencia = keyof typeof RANGO;

export function buscarNodo(ctx: Contexto, p: BuscarParams) {
  const { proyeccion, budget } = comunes(p, "resumen");
  const q = normalizar(p.texto ?? "");
  if (q === "") throw new ConsultaError("parametro_invalido", "texto vacío");
  const limite = p.limite ?? 10;
  if (!Number.isInteger(limite) || limite < 1) throw new ConsultaError("parametro_invalido", "limite debe ser un entero positivo");

  const hits: Array<{ n: GraphNode; c: Coincidencia }> = [];
  for (const n of ctx.graph.nodes) {
    if (p.tipos && p.tipos.length > 0 && !p.tipos.includes(n.tipo)) continue;
    const claves = [n.id, n.nombre, ...n.aliases].map(normalizar);
    let c: Coincidencia | null = null;
    if (claves.some((k) => k === q)) c = "exacta";
    else if (claves.some((k) => k.startsWith(q))) c = "prefijo";
    else if (claves.some((k) => levenshtein(q, k, 2) <= 2)) c = "difusa";
    if (c) hits.push({ n, c });
  }
  hits.sort((a, b) => RANGO[b.c] - RANGO[a.c] || confNodo(b.n) - confNodo(a.n) || cmp(a.n.id, b.n.id));
  const total = hits.length;
  const nodos = hits.slice(0, limite).map(({ n, c }) => proyectar(ctx, n, proyeccion, { coincidencia: c }));
  return ajustar(
    {
      consulta: { limite, proyeccion, texto: p.texto, tipos: p.tipos ?? [] },
      herramienta: "buscar_nodo" as const,
      nodos,
      total,
    },
    budget,
  );
}

// ============================== recorrer_grafo ==============================

export interface RecorrerParams extends Comunes {
  nodo: string;
  verbos?: string[];
  direccion?: "out" | "in" | "both";
  profundidad?: number;
}

/** `depende_de` en consultas incluye los verbos de datos (SCHEMA §3). */
const SUPERVERBO: Partial<Record<Verbo, Verbo[]>> = {
  depende_de: ["depende_de", "llama_a", "publica_en", "consume_de", "lee_de", "escribe_en"],
};

function expandirVerbos(verbos: string[] | undefined): Set<Verbo> {
  if (!verbos || verbos.length === 0) return new Set(VERBOS.filter((v) => v !== "contiene" && v !== "expone"));
  const out = new Set<Verbo>();
  for (const v of verbos) {
    if (!(VERBOS as readonly string[]).includes(v)) throw new ConsultaError("parametro_invalido", `verbo desconocido: ${v}`);
    for (const x of SUPERVERBO[v as Verbo] ?? [v as Verbo]) out.add(x);
  }
  return out;
}

export function recorrerGrafo(ctx: Contexto, p: RecorrerParams) {
  const { proyeccion, budget } = comunes(p, "resumen");
  const raiz = nodoOError(ctx, p.nodo);
  const direccion = p.direccion ?? "out";
  if (!["out", "in", "both"].includes(direccion)) throw new ConsultaError("parametro_invalido", `direccion inválida: ${direccion}`);
  const profundidad = p.profundidad ?? 1;
  if (!Number.isInteger(profundidad) || profundidad < 1 || profundidad > PROFUNDIDAD_MAX) {
    throw new ConsultaError("parametro_invalido", `profundidad debe estar entre 1 y ${PROFUNDIDAD_MAX}`);
  }
  const verbos = expandirVerbos(p.verbos);

  const visitados = new Set([raiz.id]);
  const nodos: Item[] = [proyectar(ctx, raiz, proyeccion, { nivel: 0, via: null })];
  let frontera = [raiz.id];
  for (let nivel = 1; nivel <= profundidad && frontera.length > 0; nivel++) {
    const mejor = new Map<string, GraphEdge>();
    const considerar = (vecino: string, e: GraphEdge) => {
      if (visitados.has(vecino)) return;
      const prev = mejor.get(vecino);
      if (!prev || e.confianza > prev.confianza || (e.confianza === prev.confianza && cmpTuple(claveE(e), claveE(prev)) < 0)) {
        mejor.set(vecino, e);
      }
    };
    for (const id of frontera) {
      if (direccion !== "in") for (const e of ctx.salientes.get(id) ?? []) if (verbos.has(e.verbo)) considerar(e.hasta, e);
      if (direccion !== "out") for (const e of ctx.entrantes.get(id) ?? []) if (verbos.has(e.verbo)) considerar(e.desde, e);
    }
    const nivelOrdenado = [...mejor.entries()].sort(([a, ea], [b, eb]) => eb.confianza - ea.confianza || cmp(a, b));
    frontera = [];
    for (const [id, e] of nivelOrdenado) {
      visitados.add(id);
      frontera.push(id);
      nodos.push(proyectar(ctx, ctx.nodo.get(id)!, proyeccion, { nivel, via: ref(e) }));
    }
  }
  return ajustar(
    {
      consulta: { direccion, nodo: raiz.id, profundidad, proyeccion, verbos: p.verbos ?? [] },
      herramienta: "recorrer_grafo" as const,
      nodos,
    },
    budget,
  );
}

// ============================== contrato_de ==============================

export interface ContratoParams extends Comunes {
  nodo: string;
  endpoint?: string;
}

export function contratoDe(ctx: Contexto, p: ContratoParams) {
  const { proyeccion, budget } = comunes(p, "resumen");
  let n = nodoOError(ctx, p.nodo);
  let filtro: string | null = null;
  if (n.tipo === "endpoint") {
    filtro = n.id;
    n = nodoOError(ctx, n.id.slice(0, n.id.indexOf(":")));
  }
  if (n.tipo !== "svc") throw new ConsultaError("parametro_invalido", `contrato_de requiere un svc o un endpoint; ${n.id} es ${n.tipo}`);
  const contrato = ctx.contratos.get(n.id);
  if (!contrato) throw new ConsultaError("nodo_inexistente", `${n.id} no tiene contrato`);
  if (p.endpoint !== undefined) {
    const m = ENDPOINT_REF.exec(p.endpoint);
    filtro = m ? `${n.id}:${m[1]}:${normalizarRuta(m[2]!)}` : p.endpoint;
    if (ctx.nodo.get(filtro)?.tipo !== "endpoint") throw new ConsultaError("nodo_inexistente", `endpoint inexistente: ${p.endpoint}`);
  }
  // El svc va con la proyección pedida pero siempre con sus endpoints (es el objeto de la consulta).
  const item = proyectar(ctx, n, proyeccion);
  item.endpoints = endpointsDe(ctx, n.id).filter((e) => filtro === null || e.id === filtro);
  const eventos = filtro === null ? [...contrato.eventos] : [];
  return ajustar(
    {
      consulta: { endpoint: p.endpoint ?? null, nodo: p.nodo, proyeccion },
      eventos,
      fuente: contrato.fuente,
      herramienta: "contrato_de" as const,
      nodos: [item],
    },
    budget,
  );
}

// ============================== trazar ==============================

export interface TrazarParams extends Comunes {
  desde: string;
  hasta?: string;
}

export interface Salto extends AristaRef {
  dato: string | null;
  nivel: number;
}

/** Coincide una ruta concreta contra un patrón con `{param}`. */
export function rutaCoincide(patron: string, ruta: string): boolean {
  const a = patron.split("/");
  const b = ruta.split("/");
  return a.length === b.length && a.every((s, i) => (s.startsWith("{") && s.endsWith("}")) || s === b[i]);
}

interface Inicio {
  /** Aristas de nivel 1 que no salen de un nodo expandido (llamadas entrantes, evidencia de un archivo). */
  semillas: GraphEdge[];
  /** Nodos que se expanden en el primer nivel de BFS. */
  expandir: string[];
  /** Nivel en el que se expanden. */
  nivelExpansion: number;
}

function resolverDesde(ctx: Contexto, desde: string): Inicio {
  const conEndpoints = (eps: string[]): Inicio => {
    const semillas = eps.flatMap((ep) => (ctx.entrantes.get(ep.slice(0, ep.indexOf(":"))) ?? []).filter((e) => e.verbo === "llama_a" && e.endpoint === ep));
    const duenos = [...new Set(eps.map((ep) => ep.slice(0, ep.indexOf(":"))))].sort(cmp);
    return { semillas, expandir: duenos, nivelExpansion: semillas.length > 0 ? 2 : 1 };
  };

  const n = ctx.nodo.get(desde);
  if (n?.tipo === "endpoint") return conEndpoints([n.id]);
  if (n && n.tipo !== "archivo") return { semillas: [], expandir: [n.id], nivelExpansion: 1 };

  // URL o "MÉTODO /ruta"
  let metodo: string | null = null;
  let ruta: string | null = null;
  const m = ENDPOINT_REF.exec(desde);
  if (m) {
    metodo = m[1]!;
    ruta = m[2]!;
  } else if (desde.startsWith("/") || /^https?:\/\//.test(desde)) {
    ruta = desde.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/";
  }
  if (ruta !== null) {
    const r = normalizarRuta(ruta);
    const eps = ctx.graph.nodes
      .filter((x) => x.tipo === "endpoint")
      .filter((x) => {
        const a = x.atributos as { metodo: string; ruta: string };
        return (metodo === null || a.metodo === metodo) && rutaCoincide(a.ruta, r);
      })
      .map((x) => x.id);
    if (eps.length === 0) throw new ConsultaError("nodo_inexistente", `ningún endpoint coincide con: ${desde}`);
    return conEndpoints(eps);
  }

  // Archivo: id `repo:ruta` o ruta relativa; las semillas son las aristas cuya evidencia está en ese archivo.
  const archivo = n?.tipo === "archivo" ? n.id : null;
  const semillas = ctx.graph.edges.filter((e) => {
    if (e.evidencia === null || e.verbo === "contiene" || e.verbo === "expone") return false;
    const sinLinea = e.evidencia.replace(/#.*$/, "");
    return archivo !== null ? sinLinea === archivo : sinLinea.endsWith(`:${desde}`);
  });
  if (semillas.length > 0) return { semillas, expandir: [], nivelExpansion: 2 };

  // Último recurso: alias o nombre exacto.
  const q = normalizar(desde);
  const porNombre = ctx.graph.nodes.filter((x) => [x.nombre, ...x.aliases].some((k) => normalizar(k) === q)).map((x) => x.id);
  if (porNombre.length === 1) return { semillas: [], expandir: porNombre, nivelExpansion: 1 };
  throw new ConsultaError("nodo_inexistente", `no se pudo resolver desde: ${desde}`);
}

/** Dirección del flujo de datos de una arista: [origen, destino]. `consume_de` fluye de la cola al svc. */
const flujo = (e: GraphEdge): [string, string] => (e.verbo === "consume_de" ? [e.hasta, e.desde] : [e.desde, e.hasta]);

function datoDe(ctx: Contexto, e: GraphEdge): string | null {
  if (e.endpoint) {
    const a = ctx.nodo.get(e.endpoint)?.atributos as { request: string | null; response: string | null } | undefined;
    if (a) return `${a.request ?? "null"} → ${a.response ?? "null"}`;
  }
  return e.dato;
}

export function trazar(ctx: Contexto, p: TrazarParams) {
  const { proyeccion, budget } = comunes(p, "resumen");
  if (!p.desde) throw new ConsultaError("parametro_invalido", "desde es obligatorio");
  if (p.hasta !== undefined) nodoOError(ctx, p.hasta);
  const inicio = resolverDesde(ctx, p.desde);

  const ordenNivel = (a: GraphEdge, b: GraphEdge) => b.confianza - a.confianza || cmp(flujo(a)[1], flujo(b)[1]) || cmpTuple(claveE(a), claveE(b));
  const usadas = new Set<string>();
  const expandidos = new Set<string>();
  const saltos: Salto[] = [];
  const agregar = (es: GraphEdge[], nivel: number): string[] => {
    const nuevos: string[] = [];
    for (const e of [...es].sort(ordenNivel)) {
      const k = claveE(e).join("\u0000");
      if (usadas.has(k)) continue;
      usadas.add(k);
      saltos.push({ ...ref(e), dato: datoDe(ctx, e), nivel });
      const destino = flujo(e)[1];
      if (!expandidos.has(destino) && !nuevos.includes(destino)) nuevos.push(destino);
    }
    return nuevos;
  };

  let frontera = [...inicio.expandir];
  if (inicio.semillas.length > 0) {
    const nuevos = agregar(inicio.semillas, 1);
    if (inicio.expandir.length === 0) frontera = nuevos;
  }
  for (let nivel = inicio.nivelExpansion; nivel <= PROFUNDIDAD_MAX && frontera.length > 0; nivel++) {
    for (const id of frontera) expandidos.add(id);
    const candidatas: GraphEdge[] = [];
    for (const id of frontera) {
      for (const e of ctx.salientes.get(id) ?? []) if (e.verbo === "llama_a" || e.verbo === "publica_en" || e.verbo === "lee_de" || e.verbo === "escribe_en") candidatas.push(e);
      if (ctx.nodo.get(id)?.tipo === "queue") for (const e of ctx.entrantes.get(id) ?? []) if (e.verbo === "consume_de") candidatas.push(e);
    }
    frontera = agregar(candidatas, nivel).filter((x) => !expandidos.has(x));
  }

  let resultado = saltos;
  let alcanzado: boolean | null = null;
  if (p.hasta !== undefined) {
    const objetivo = p.hasta;
    const llegan = saltos.filter((s) => flujo(s as unknown as GraphEdge)[1] === objetivo);
    alcanzado = llegan.length > 0;
    if (!alcanzado) resultado = [];
    else {
      const nivelMin = Math.min(...llegan.map((s) => s.nivel));
      const elegidos = new Set<Salto>();
      let buscados = new Set([objetivo]);
      for (let nivel = nivelMin; nivel >= 1 && buscados.size > 0; nivel--) {
        const siguientes = new Set<string>();
        for (const s of saltos) {
          if (s.nivel !== nivel) continue;
          const [de, a] = flujo(s as unknown as GraphEdge);
          if (buscados.has(a)) {
            elegidos.add(s);
            siguientes.add(de);
          }
        }
        buscados = siguientes;
      }
      resultado = saltos.filter((s) => elegidos.has(s));
    }
  }

  const ids = [...new Set(resultado.flatMap((s) => [s.desde, s.hasta]))].sort(cmp);
  const nodos = ids.map((id) => proyectar(ctx, ctx.nodo.get(id)!, proyeccion));
  return ajustar(
    {
      alcanzado,
      consulta: { desde: p.desde, hasta: p.hasta ?? null, proyeccion },
      herramienta: "trazar" as const,
      nodos,
      saltos: resultado,
    },
    budget,
  );
}

export type Resultado =
  | ReturnType<typeof buscarNodo>
  | ReturnType<typeof recorrerGrafo>
  | ReturnType<typeof contratoDe>
  | ReturnType<typeof trazar>;
export type { ConPresupuesto };

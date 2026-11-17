import { cmp } from "../canonical.js";
import type { Conexion } from "../registro.js";
import { crearRecorredor, LIMITES_PANTALLA, type AristaExtraccion, type EstructuraArchivo } from "../funcionalidades.js";
import type { Graph } from "../schema.js";
import { normalizar, rutaCoincide } from "./herramientas.js";

/**
 * Entre cerebros. Cada cerebro es un brain aparte; acá está lo que se calcula al consultar cuando la comunicación
 * entre dos está activa: pistas (algo con el mismo nombre en otro cerebro) y cruces (una llamada HTTP de un cerebro
 * que atiende un endpoint de otro). Nada de esto se guarda en los grafos: apagar la comunicación no requiere reindexar.
 */

/** Lo que hace falta saber de un cerebro para cruzarlo con otro: liviano, sin el índice de código. */
export interface CerebroLiviano {
  nombre: string;
  /** Nodos nombrables (sin archivos), con sus claves ya normalizadas. */
  nombres: Array<{ id: string; tipo: string; claves: string[] }>;
  endpoints: Array<{ id: string; svc: string; metodo: string; ruta: string }>;
  /** Llamadas HTTP que el índice no pudo unir a un endpoint del propio cerebro, con las pantallas que llegan a cada una. */
  pendientes: Array<{ desde: string; evidencia: string; metodo: string; ruta: string; base: string; pantallas: string[] }>;
}

/**
 * Pantallas que llegan a cada llamada pendiente: se recorre el árbol de componentes de cada pantalla (componentes,
 * hooks, clientes de API) y la llamada es de la pantalla si cae dentro de un símbolo del recorrido. Sin `archivos`
 * (la estructura de `_build/files`) no se puede saber, y la llamada queda a nombre del servicio.
 */
function pantallasPorPendiente(graph: Graph, archivos: string[], evidencias: string[]): string[][] {
  const out: string[][] = evidencias.map(() => []);
  const estructura = new Map<string, EstructuraArchivo>();
  for (const c of archivos) {
    try {
      const j = JSON.parse(c) as { repo: string; archivos?: Array<{ ruta: string } & Partial<EstructuraArchivo>> };
      for (const a of j.archivos ?? []) estructura.set(`${j.repo}:${a.ruta}`, { simbolos: a.simbolos ?? [], importa: a.importa ?? [], invoca: a.invoca ?? [] });
    } catch {
      /* ilegible: no aporta */
    }
  }
  if (!estructura.size || !evidencias.length) return out;
  // Cada pendiente entra al recorredor como un toque propio, con su índice como destino.
  const MARCA = "\u0000";
  const aristas: AristaExtraccion[] = evidencias.map((evidencia, i) => ({ desde: "", verbo: "llama_a", hasta: `${MARCA}${i}`, endpoint: null, evidencia }));
  const rec = crearRecorredor(graph, estructura, aristas, [], LIMITES_PANTALLA);
  for (const n of graph.nodes) {
    if (n.tipo !== "pantalla") continue;
    const vistas = new Set<number>();
    for (const c of (n.atributos as { componentes?: string[] }).componentes ?? []) {
      const i = c.lastIndexOf("#");
      if (i < 0) continue;
      for (const p of rec.desdeSimbolo(c.slice(0, i), c.slice(i + 1)).pasos) for (const t of p.toca) if (t.hasta.startsWith(MARCA)) vistas.add(Number(t.hasta.slice(1)));
    }
    for (const i of vistas) out[i]!.push(n.id);
  }
  return out.map((ps) => ps.sort(cmp));
}

export function cerebroLiviano(nombre: string, graph: Graph, extracciones: string[], archivos: string[] = []): CerebroLiviano {
  const nombres = graph.nodes
    .filter((n) => n.tipo !== "archivo" && n.tipo !== "contrato")
    .map((n) => {
      const a = n.atributos as { metodo?: string; ruta?: string };
      const propias = n.tipo === "endpoint" || n.tipo === "pantalla" ? [a.ruta ?? "", a.metodo ? `${a.metodo} ${a.ruta}` : ""] : [n.id.replace(/^[a-z]+-/, ""), n.nombre, ...n.aliases];
      return { id: n.id, tipo: n.tipo, claves: [...new Set([n.id, ...propias].filter(Boolean).map(normalizar))] };
    });
  const endpoints = graph.nodes
    .filter((n) => n.tipo === "endpoint")
    .map((n) => ({ id: n.id, svc: n.id.slice(0, n.id.indexOf(":")), metodo: String(n.atributos["metodo"]), ruta: String(n.atributos["ruta"]) }));
  const pendientes: CerebroLiviano["pendientes"] = [];
  for (const c of extracciones) {
    try {
      const j = JSON.parse(c) as { pendientes?: Array<{ verbo: string; desde: string; evidencia: string; llamada?: { metodo: string; ruta: string | null; base: string } }> };
      for (const p of j.pendientes ?? []) if (p.verbo === "llama_a" && p.llamada?.ruta) pendientes.push({ desde: p.desde, evidencia: p.evidencia, metodo: p.llamada.metodo, ruta: p.llamada.ruta, base: p.llamada.base, pantallas: [] });
    } catch {
      /* extracción ilegible: no aporta */
    }
  }
  pendientes.sort((a, b) => cmp(a.evidencia, b.evidencia));
  pantallasPorPendiente(graph, archivos, pendientes.map((p) => p.evidencia)).forEach((ps, i) => (pendientes[i]!.pantallas = ps));
  return { nombre, nombres, endpoints, pendientes };
}

export interface Pista {
  cerebro: string;
  coincidencias: number;
  /** Hasta tres ids, para consultar ese cerebro. */
  nodos: string[];
}

/** Argumentos de una consulta que nombran algo: de ahí salen los términos a buscar en los otros cerebros. */
const CAMPOS_TERMINO = ["texto", "nodo", "pieza", "desde", "hasta", "id", "ruta", "simbolo", "endpoint"];

/** Pistas: en qué cerebros vecinos hay algo que se llama exactamente igual que lo consultado. Sin coincidencia exacta no hay pista. */
export function pistas(args: Record<string, unknown>, vecinos: CerebroLiviano[]): Pista[] {
  const terminos = new Set<string>();
  for (const k of CAMPOS_TERMINO) {
    const v = args[k];
    if (typeof v !== "string" || v.trim().length < 3) continue;
    const t = normalizar(v);
    terminos.add(t);
    // `tabla-user` en un cerebro puede ser `user` (alias) en otro, y `pantalla /login` es la ruta `/login`.
    terminos.add(t.replace(/^(pantalla|get|post|put|patch|delete)\s+/, ""));
  }
  const out: Pista[] = [];
  for (const v of vecinos) {
    const hits = v.nombres.filter((n) => n.claves.some((k) => terminos.has(k))).map((n) => n.id).sort(cmp);
    if (hits.length) out.push({ cerebro: v.nombre, coincidencias: hits.length, nodos: hits.slice(0, 3) });
  }
  return out;
}

export interface Cruce {
  /** Quién llama: cerebro, servicio, línea de la llamada y las pantallas que llegan a ella (vacío si no es de ninguna). */
  desde: { cerebro: string; svc: string; evidencia: string; pantallas: string[] };
  /** Qué endpoint la atiende, en el otro cerebro. */
  hacia: { cerebro: string; endpoint: string };
  /** La conexión entre esos dos servicios está declarada en el registro. */
  declarada: boolean;
}

export interface Cruces {
  cruces: Cruce[];
  /** Llamadas que coinciden con varios endpoints del otro cerebro: no se unen a ninguno. */
  ambiguas: number;
}

const segmentos = (r: string) => r.split("/").filter(Boolean);

/** Endpoints de `destino` que atienden `metodo ruta`: los de ruta idéntica; si no hay, los que terminan igual (la base de la URL aporta el prefijo). */
function candidatos(destino: CerebroLiviano, metodo: string, ruta: string, svcs: Set<string> | null) {
  const eps = destino.endpoints.filter((e) => e.metodo === metodo && (!svcs || svcs.has(e.svc)));
  const exactos = eps.filter((e) => rutaCoincide(e.ruta, ruta));
  if (exactos.length) return exactos;
  const s = segmentos(ruta);
  return eps.filter((e) => {
    const t = segmentos(e.ruta);
    return t.length > s.length && rutaCoincide(`/${t.slice(t.length - s.length).join("/")}`, ruta);
  });
}

/**
 * Llamadas pendientes de `origen` que atiende algún endpoint de `destino`. Si el registro declara conexiones desde el
 * servicio que llama hacia ese cerebro, solo se intenta contra los servicios declarados, y con `por` solo las llamadas
 * cuya base (variable u host) lo contiene. Sin conexiones declaradas se intenta contra todos, y el cruce queda como no declarado.
 */
export function crucesEntre(origen: CerebroLiviano, destino: CerebroLiviano, conexiones: Conexion[]): Cruces {
  const out: Cruce[] = [];
  let ambiguas = 0;
  const declaradas = conexiones.filter((c) => c.desde.cerebro === origen.nombre && c.hacia.cerebro === destino.nombre);
  for (const p of origen.pendientes) {
    const propias = declaradas.filter((c) => c.desde.svc === p.desde);
    const aplicables = propias.filter((c) => c.por === null || p.base.includes(c.por));
    // El servicio declaró a quién llama en ese cerebro y esta llamada no va por ninguna de esas bases: no es para allá.
    if (propias.length && !aplicables.length) continue;
    const cs = candidatos(destino, p.metodo, p.ruta, aplicables.length ? new Set(aplicables.map((c) => c.hacia.svc)) : null);
    if (cs.length === 1) out.push({ desde: { cerebro: origen.nombre, svc: p.desde, evidencia: p.evidencia, pantallas: p.pantallas }, hacia: { cerebro: destino.nombre, endpoint: cs[0]!.id }, declarada: aplicables.length > 0 });
    else if (cs.length > 1) ambiguas++;
  }
  return { cruces: out, ambiguas };
}

export interface ResumenConexion {
  desde: string;
  hacia: string;
  declarada: boolean;
  por: string | null;
  llamadas: number;
  endpoints: number;
  /** Pantallas distintas del servicio que llama desde las que sale alguna de esas llamadas. */
  pantallas: number;
  /** Algunos ejemplos, con la línea de la llamada. */
  ejemplos: Array<{ evidencia: string; endpoint: string }>;
}

/** Cruces agrupados por par de servicios, más las conexiones declaradas que ninguna llamada respalda. */
export function resumenConexiones(cruces: Cruce[], conexiones: Conexion[]): ResumenConexion[] {
  const grupos = new Map<string, Cruce[]>();
  const clave = (a: string, b: string) => `${a}\u0000${b}`;
  for (const c of cruces) {
    const hacia = `${c.hacia.cerebro}/${c.hacia.endpoint.slice(0, c.hacia.endpoint.indexOf(":"))}`;
    const k = clave(`${c.desde.cerebro}/${c.desde.svc}`, hacia);
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  const out: ResumenConexion[] = [...grupos.entries()].map(([k, cs]) => {
    const [desde, hacia] = k.split("\u0000") as [string, string];
    const decl = conexiones.find((x) => `${x.desde.cerebro}/${x.desde.svc}` === desde && `${x.hacia.cerebro}/${x.hacia.svc}` === hacia);
    return { desde, hacia, declarada: !!decl, por: decl?.por ?? null, llamadas: cs.length, endpoints: new Set(cs.map((c) => c.hacia.endpoint)).size, pantallas: new Set(cs.flatMap((c) => c.desde.pantallas)).size, ejemplos: cs.slice(0, 3).map((c) => ({ evidencia: c.desde.evidencia, endpoint: c.hacia.endpoint })) };
  });
  for (const x of conexiones) {
    const desde = `${x.desde.cerebro}/${x.desde.svc}`, hacia = `${x.hacia.cerebro}/${x.hacia.svc}`;
    if (!out.some((o) => o.desde === desde && o.hacia === hacia)) out.push({ desde, hacia, declarada: true, por: x.por, llamadas: 0, endpoints: 0, pantallas: 0, ejemplos: [] });
  }
  return out.sort((a, b) => cmp(a.desde, b.desde) || cmp(a.hacia, b.hacia));
}

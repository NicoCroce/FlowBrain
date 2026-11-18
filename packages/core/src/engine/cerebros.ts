import { cmp } from "../canonical.js";
import type { Conexion } from "../registro.js";
import { aristasDeExtracciones, crearRecorredor, LIMITES_PANTALLA, tablasSinPagina, type AristaExtraccion, type EstructuraArchivo, type Paso, type Toque } from "../funcionalidades.js";
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
  /** Funcionalidades que implementa cada pantalla (`implementa` pantalla → feat), con su nombre. */
  funcionalidadesDe?: Record<string, Array<{ id: string; nombre: string }>>;
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
  const nodo = new Map(graph.nodes.map((n) => [n.id, n]));
  const funcionalidadesDe: Record<string, Array<{ id: string; nombre: string }>> = {};
  for (const e of graph.edges) {
    if (e.verbo !== "implementa" || nodo.get(e.desde)?.tipo !== "pantalla" || nodo.get(e.hasta)?.tipo !== "feat") continue;
    (funcionalidadesDe[e.desde] ??= []).push({ id: e.hasta, nombre: nodo.get(e.hasta)!.nombre });
  }
  return { nombre, nombres, endpoints, pendientes, funcionalidadesDe };
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

/** Una llamada que podría ser para más de un cerebro: coincide con un endpoint en cada uno y nada dice a cuál va. */
export interface Disputada {
  cerebro: string;
  svc: string;
  evidencia: string;
  metodo: string;
  ruta: string;
  base: string;
  /** `cerebro/endpoint` de cada destino posible. */
  candidatos: string[];
}

export interface Cruces {
  cruces: Cruce[];
  /** Llamadas que coinciden con varios endpoints de un mismo cerebro: no se unen a ninguno. */
  ambiguas: number;
  /** Llamadas que coinciden con un endpoint en más de un cerebro: tampoco se unen, hasta que una conexión diga a cuál van. */
  entreCerebros: Disputada[];
}

const segmentos = (r: string) => r.split("/").filter(Boolean);

/** Endpoints de `destino` que atienden `metodo ruta`: los de ruta idéntica; si no hay, los que terminan igual (la base de la URL aporta el prefijo). */
function candidatos(destino: CerebroLiviano, metodo: string, ruta: string, svcs: Set<string> | null) {
  const eps = destino.endpoints.filter((e) => e.metodo === metodo && (!svcs || svcs.has(e.svc)));
  const s = segmentos(ruta);
  // Como un router: entre varias rutas que coinciden gana la que acierta más segmentos literales. `/login` es
  // `/api/login` y no `/api/image/{userId}`. Si empatan, siguen siendo varias.
  const masLiterales = <T extends { ruta: string }>(cs: T[]): T[] => {
    if (cs.length < 2) return cs;
    const puntos = (e: T) => {
      const t = segmentos(e.ruta).slice(-s.length);
      return t.filter((x, i) => x === s[i]).length;
    };
    const mejor = Math.max(...cs.map(puntos));
    return cs.filter((e) => puntos(e) === mejor);
  };
  const exactos = eps.filter((e) => rutaCoincide(e.ruta, ruta));
  if (exactos.length) return masLiterales(exactos);
  return masLiterales(eps.filter((e) => {
    const t = segmentos(e.ruta);
    return t.length > s.length && rutaCoincide(`/${t.slice(t.length - s.length).join("/")}`, ruta);
  }));
}

/**
 * Llamadas pendientes de `origen` que atiende algún endpoint de sus `destinos` (los cerebros con los que se comunica).
 *
 * - Si el servicio que llama tiene conexiones declaradas que aplican a la llamada (sin `por`, o con un `por` contenido
 *   en la base de la URL), solo se busca en los servicios declarados.
 * - Si tiene conexiones declaradas hacia un cerebro pero ninguna aplica a esta llamada, no es para ese cerebro.
 * - Sin nada declarado se busca en todos. Método y ruta no alcanzan para saber a qué servidor va una llamada: si
 *   coincide con un endpoint en más de un cerebro, no se une a ninguno y queda en `entreCerebros`.
 */
/** Endpoints de un cerebro que atienden `método ruta`, para quien necesita la coincidencia sin las reglas de comunicación. */
export const endpointsQueAtienden = candidatos;

export function crucesDesde(origen: CerebroLiviano, destinos: CerebroLiviano[], conexiones: Conexion[]): Cruces {
  const out: Cruce[] = [];
  const entreCerebros: Disputada[] = [];
  let ambiguas = 0;
  const nombres = new Set(destinos.map((d) => d.nombre));
  const declaradas = conexiones.filter((c) => c.desde.cerebro === origen.nombre && nombres.has(c.hacia.cerebro));
  for (const p of origen.pendientes) {
    const propias = declaradas.filter((c) => c.desde.svc === p.desde);
    const aplicables = propias.filter((c) => c.por === null || p.base.includes(c.por));
    const unicos: Array<{ destino: string; endpoint: string }> = [];
    let varios = false;
    for (const d of destinos) {
      const aca = aplicables.filter((c) => c.hacia.cerebro === d.nombre);
      // Con algo declarado que aplica, solo esos destinos; si este cerebro tiene declaradas y ninguna aplica, no es para acá.
      if (aplicables.length ? !aca.length : propias.some((c) => c.hacia.cerebro === d.nombre)) continue;
      const cs = candidatos(d, p.metodo, p.ruta, aca.length ? new Set(aca.map((c) => c.hacia.svc)) : null);
      if (cs.length === 1) unicos.push({ destino: d.nombre, endpoint: cs[0]!.id });
      else if (cs.length > 1) varios = true;
    }
    if (varios) ambiguas++;
    else if (unicos.length === 1) out.push({ desde: { cerebro: origen.nombre, svc: p.desde, evidencia: p.evidencia, pantallas: p.pantallas }, hacia: { cerebro: unicos[0]!.destino, endpoint: unicos[0]!.endpoint }, declarada: aplicables.length > 0 });
    else if (unicos.length > 1) entreCerebros.push({ cerebro: origen.nombre, svc: p.desde, evidencia: p.evidencia, metodo: p.metodo, ruta: p.ruta, base: p.base, candidatos: unicos.map((u) => `${u.destino}/${u.endpoint}`) });
  }
  return { cruces: out, ambiguas, entreCerebros };
}

/** Lo que alcanza en otro cerebro un cambio que toca estos endpoints: sus pantallas, sus funcionalidades y los servicios que los llaman sin pantalla. */
export interface ImpactoCruzado {
  cerebro: string;
  funcionalidades: Array<{ id: string; nombre: string; pantallas: number }>;
  pantallas: Array<{ id: string; endpoints: string[]; ev: string }>;
  /** Llamadas que no salen de ninguna pantalla (un job, otro back): afectadas, pero su alcance sigue en ese cerebro. */
  servicios: Array<{ svc: string; endpoint: string; ev: string }>;
}

/**
 * El impacto cruza de cerebro: si un cambio alcanza endpoints de `cerebro`, cada llamada real desde otro cerebro a esos
 * endpoints también queda afectada, con las pantallas que llegan a ella y las funcionalidades de esas pantallas. Es la
 * misma regla que usa el visor; un solo salto: lo que siga desde un servicio que llama se consulta en su cerebro.
 */
export function impactoCruzado(cerebro: string, endpoints: Iterable<string>, cruces: Cruce[], cerebros: CerebroLiviano[]): ImpactoCruzado[] {
  const eps = new Set(endpoints);
  const por = new Map<string, { pantallas: Map<string, { endpoints: Set<string>; ev: string }>; servicios: Map<string, { svc: string; endpoint: string; ev: string }> }>();
  for (const x of cruces) {
    if (x.hacia.cerebro !== cerebro || !eps.has(x.hacia.endpoint) || x.desde.cerebro === cerebro) continue;
    const b = por.get(x.desde.cerebro) ?? por.set(x.desde.cerebro, { pantallas: new Map(), servicios: new Map() }).get(x.desde.cerebro)!;
    if (!x.desde.pantallas.length) {
      const k = `${x.desde.svc}\u0000${x.hacia.endpoint}`;
      if (!b.servicios.has(k)) b.servicios.set(k, { svc: x.desde.svc, endpoint: x.hacia.endpoint, ev: x.desde.evidencia });
    }
    for (const p of x.desde.pantallas) {
      const v = b.pantallas.get(p) ?? b.pantallas.set(p, { endpoints: new Set(), ev: x.desde.evidencia }).get(p)!;
      v.endpoints.add(x.hacia.endpoint);
    }
  }
  return [...por.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([nombre, b]) => {
      const de = cerebros.find((c) => c.nombre === nombre)?.funcionalidadesDe ?? {};
      const feats = new Map<string, { id: string; nombre: string; pantallas: number }>();
      for (const p of b.pantallas.keys()) for (const f of de[p] ?? []) (feats.get(f.id) ?? feats.set(f.id, { ...f, pantallas: 0 }).get(f.id)!).pantallas++;
      return {
        cerebro: nombre,
        funcionalidades: [...feats.values()].sort((x, y) => y.pantallas - x.pantallas || cmp(x.id, y.id)),
        pantallas: [...b.pantallas.entries()].map(([id, v]) => ({ id, endpoints: [...v.endpoints].sort(cmp), ev: v.ev })).sort((x, y) => y.endpoints.length - x.endpoints.length || cmp(x.id, y.id)),
        servicios: [...b.servicios.values()].sort((x, y) => cmp(x.svc + x.endpoint, y.svc + y.endpoint)),
      };
    });
}

/** Lo mismo contra un solo cerebro. */
export const crucesEntre = (origen: CerebroLiviano, destino: CerebroLiviano, conexiones: Conexion[]): Cruces => crucesDesde(origen, [destino], conexiones);

/** Todos los cruces de un registro: cada cerebro contra los que tiene comunicados. */
export function crucesDelRegistro(cerebros: CerebroLiviano[], comunicados: (a: string, b: string) => boolean, conexiones: Conexion[]): Cruces {
  const total: Cruces = { cruces: [], ambiguas: 0, entreCerebros: [] };
  for (const o of cerebros) {
    const r = crucesDesde(o, cerebros.filter((d) => comunicados(o.nombre, d.nombre)), conexiones);
    total.cruces.push(...r.cruces);
    total.ambiguas += r.ambiguas;
    total.entreCerebros.push(...r.entreCerebros);
  }
  return total;
}

export interface ResumenConexion {
  desde: string;
  hacia: string;
  declarada: boolean;
  /** Quién declaró la conexión: `persona` o `modelo`; `null` si no está declarada. */
  origen: "persona" | "modelo" | null;
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
    return { desde, hacia, declarada: !!decl, origen: decl?.origen ?? null, por: decl?.por ?? null, llamadas: cs.length, endpoints: new Set(cs.map((c) => c.hacia.endpoint)).size, pantallas: new Set(cs.flatMap((c) => c.desde.pantallas)).size, ejemplos: cs.slice(0, 3).map((c) => ({ evidencia: c.desde.evidencia, endpoint: c.hacia.endpoint })) };
  });
  for (const x of conexiones) {
    const desde = `${x.desde.cerebro}/${x.desde.svc}`, hacia = `${x.hacia.cerebro}/${x.hacia.svc}`;
    if (!out.some((o) => o.desde === desde && o.hacia === hacia)) out.push({ desde, hacia, declarada: true, origen: x.origen, por: x.por, llamadas: 0, endpoints: 0, pantallas: 0, ejemplos: [] });
  }
  return out.sort((a, b) => cmp(a.desde, b.desde) || cmp(a.hacia, b.hacia));
}

/** Lo que hace falta de un cerebro para armar trazas: el grafo y los JSON de `_build` (estructura de archivos y extracción). */
export interface FuenteTraza {
  nombre: string;
  graph: Graph;
  extracciones: string[];
  archivos: string[];
}

export interface TrazasCruzadas {
  /**
   * Por pantalla (`cerebro/id`) con alguna llamada que cruza: su recorrido en el front, donde cada llamada que atiende
   * otro cerebro figura como un toque hacia ese endpoint, y los endpoints que llama, en orden.
   */
  pantallas: Record<string, { pasos: Paso[]; endpoints: string[] }>;
  /** Por endpoint cruzado (`cerebro/endpoint`): lo que ejecuta el back que lo atiende, hasta las tablas. */
  backs: Record<string, { pasos: Paso[]; truncado?: true }>;
}

function estructuraDe(archivos: string[]): Map<string, EstructuraArchivo> {
  const estructura = new Map<string, EstructuraArchivo>();
  for (const c of archivos) {
    try {
      const j = JSON.parse(c) as { repo: string; archivos?: Array<{ ruta: string } & Partial<EstructuraArchivo>> };
      for (const a of j.archivos ?? []) estructura.set(`${j.repo}:${a.ruta}`, { simbolos: a.simbolos ?? [], importa: a.importa ?? [], invoca: a.invoca ?? [] });
    } catch {
      /* ilegible: no aporta */
    }
  }
  return estructura;
}

/** Recorrido de un endpoint del back para una traza: alcanza para llegar a las tablas sin volverse ilegible. */
const LIMITES_BACK = { pasos: 60, nivel: 10 };

/**
 * Trazas de punta a punta entre cerebros: pantalla → componentes y hooks → llamada HTTP → endpoint de otro cerebro →
 * lo que ejecuta ese back → tablas. Cada cerebro por separado solo ve su mitad; acá se unen por los cruces. Todos los
 * ids salen con el prefijo de su cerebro. No se guarda: se calcula con la comunicación y las conexiones vigentes.
 */
export function trazasCruzadas(fuentes: FuenteTraza[], cruces: Cruce[]): TrazasCruzadas {
  const out: TrazasCruzadas = { pantallas: {}, backs: {} };
  const fuente = new Map(fuentes.map((f) => [f.nombre, f]));
  const MARCA = "\u0000";
  for (const f of fuentes) {
    const salen = cruces.filter((c) => c.desde.cerebro === f.nombre && c.desde.pantallas.length && fuente.has(c.hacia.cerebro));
    if (!salen.length) continue;
    const ids = new Set(f.graph.nodes.map((n) => n.id));
    const propio = (id: string) => (ids.has(id) ? `${f.nombre}/${id}` : id);
    // Las llamadas que cruzan entran al recorredor como toques marcados, junto a lo que el cerebro ya resolvió solo.
    const marcas: AristaExtraccion[] = salen.map((c, i) => ({ desde: c.desde.svc, verbo: "llama_a", hasta: `${MARCA}${i}`, endpoint: null, evidencia: c.desde.evidencia }));
    const rec = crearRecorredor(f.graph, estructuraDe(f.archivos), [...aristasDeExtracciones(f.extracciones), ...marcas], [], LIMITES_PANTALLA);
    const conCruce = new Set(salen.flatMap((c) => c.desde.pantallas));
    for (const n of f.graph.nodes) {
      if (n.tipo !== "pantalla" || !conCruce.has(n.id)) continue;
      const pasos: Paso[] = [];
      const endpoints: string[] = [];
      for (const comp of (n.atributos as { componentes?: string[] }).componentes ?? []) {
        const i = comp.lastIndexOf("#");
        if (i < 0) continue;
        for (const p of rec.desdeSimbolo(comp.slice(0, i), comp.slice(i + 1)).pasos) {
          const toca: Toque[] = p.toca.map((t) => {
            if (!t.hasta.startsWith(MARCA)) return { ...t, hasta: t.sinPagina ? t.hasta : propio(t.hasta), endpoint: t.endpoint ? propio(t.endpoint) : null };
            const c = salen[Number(t.hasta.slice(1))]!;
            const ep = `${c.hacia.cerebro}/${c.hacia.endpoint}`;
            return { verbo: "llama_a", hasta: `${c.hacia.cerebro}/${c.hacia.endpoint.slice(0, c.hacia.endpoint.indexOf(":"))}`, endpoint: ep };
          });
          for (const t of toca) if (t.endpoint && !p.repite && !endpoints.includes(t.endpoint)) endpoints.push(t.endpoint);
          pasos.push({ ...p, toca });
        }
      }
      if (endpoints.length) out.pantallas[`${f.nombre}/${n.id}`] = { pasos, endpoints };
    }
  }
  // El otro lado del HTTP: lo que ejecuta cada endpoint cruzado, una vez.
  const porDestino = new Map<string, Set<string>>();
  for (const c of cruces) if (c.desde.pantallas.length && fuente.has(c.hacia.cerebro)) (porDestino.get(c.hacia.cerebro) ?? porDestino.set(c.hacia.cerebro, new Set()).get(c.hacia.cerebro)!).add(c.hacia.endpoint);
  for (const [nombre, eps] of porDestino) {
    const f = fuente.get(nombre)!;
    const ids = new Set(f.graph.nodes.map((n) => n.id));
    const propio = (id: string) => (ids.has(id) ? `${nombre}/${id}` : id);
    const rec = crearRecorredor(f.graph, estructuraDe(f.archivos), aristasDeExtracciones(f.extracciones), tablasSinPagina(f.extracciones), LIMITES_BACK);
    for (const ep of [...eps].sort(cmp)) {
      const r = rec.desdeEndpoint(ep);
      const pasos = r.pasos.map((p) => ({ ...p, toca: p.toca.map((t) => ({ ...t, hasta: t.sinPagina ? t.hasta : propio(t.hasta), endpoint: t.endpoint ? propio(t.endpoint) : null })) }));
      out.backs[`${nombre}/${ep}`] = r.truncado ? { pasos, truncado: true } : { pasos };
    }
  }
  return out;
}

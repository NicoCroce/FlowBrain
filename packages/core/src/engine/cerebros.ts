import { cmp } from "../canonical.js";
import type { Conexion, Interna } from "../registro.js";
import { aristasDeExtracciones, crearRecorredor, LIMITES_PANTALLA, tablasSinPagina, type AristaExtraccion, type EstructuraArchivo, type Paso, type Toque } from "../funcionalidades.js";
import type { Graph } from "../schema.js";
import { alcancePorPantalla, raicesDePantalla } from "../pantallas.js";
import { paqueteDeArchivo, quienesUsan, type PaqueteDelRepo, type RepoLeido } from "../componentes.js";
import { normalizar, rutaCoincide } from "./herramientas.js";
import type { DerivaCruzada } from "./codigo.js";

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
  /** Paquetes que publica el cerebro (por su manifiesto) y la pieza dueña de cada uno. */
  publica?: Array<{ paquete: string; dueño: string }>;
  /** Componentes que exportan esos paquetes. */
  componentes?: Array<{ id: string; paquete: string; nombre: string }>;
  /** Componentes que el cerebro toma de un paquete que no publica él, con quién los usa. */
  usosExternos?: Array<{ desde: string; paquete: string; simbolo: string; evidencia: string; pantallas: string[] }>;
  /** Paquetes de los que declara depender (en un manifiesto) y que no publica él. */
  dependenciasExternas?: Array<{ desde: string; paquete: string; evidencia: string }>;
}

/** Un repo del cerebro tal como queda en `_build/files`, con lo que hace falta para unirlo por paquetes. */
interface ArchivosDeRepo {
  repo: string;
  archivos?: RepoLeido["archivos"];
  paquetes?: PaqueteDelRepo[];
}

/**
 * Lo que el cerebro publica y lo que toma de paquetes ajenos. El dueño de un uso es la pantalla que llega a esa línea;
 * si no es de ninguna, el servicio del repo (si tiene uno solo) o el repo.
 */
function porPaquetes(graph: Graph, archivos: string[]): Pick<CerebroLiviano, "publica" | "componentes" | "usosExternos" | "dependenciasExternas"> {
  const repos: ArchivosDeRepo[] = [];
  for (const c of archivos) {
    try {
      repos.push(JSON.parse(c) as ArchivosDeRepo);
    } catch {
      /* ilegible: no aporta */
    }
  }
  const componentes = graph.nodes.filter((n) => n.tipo === "componente").map((n) => ({ id: n.id, paquete: String(n.atributos["paquete"] ?? ""), nombre: n.nombre }));
  const svcsDe = new Map<string, string[]>();
  const svcs = new Set(graph.nodes.filter((n) => n.tipo === "svc").map((n) => n.id));
  for (const e of graph.edges) if (e.verbo === "vive_en" && svcs.has(e.desde)) svcsDe.set(e.hasta, [...(svcsDe.get(e.hasta) ?? []), e.desde]);
  const dueñoDeRepo = (repo: string) => ((svcsDe.get(repo) ?? []).length === 1 ? svcsDe.get(repo)![0]! : repo);
  const propios = new Set<string>();
  const publica: NonNullable<CerebroLiviano["publica"]> = [];
  for (const r of repos) {
    for (const p of r.paquetes ?? []) {
      if (!p.nombre || propios.has(p.nombre)) continue;
      propios.add(p.nombre);
      const comp = componentes.find((c) => c.paquete === p.nombre);
      publica.push({ paquete: p.nombre, dueño: comp ? comp.id.slice(0, comp.id.indexOf(":componente:")) : dueñoDeRepo(r.repo) });
    }
  }
  const usosExternos: NonNullable<CerebroLiviano["usosExternos"]> = [];
  const dependenciasExternas: NonNullable<CerebroLiviano["dependenciasExternas"]> = [];
  const estructura = new Map<string, EstructuraArchivo>();
  for (const r of repos) for (const a of (r.archivos ?? []) as Array<{ ruta: string } & Partial<EstructuraArchivo>>) estructura.set(`${r.repo}:${a.ruta}`, { simbolos: a.simbolos ?? [], importa: a.importa ?? [], invoca: a.invoca ?? [] });
  const pantallasTodas = graph.nodes.filter((n) => n.tipo === "pantalla");
  for (const r of repos) {
    const pantallas = pantallasTodas.filter((n) => ((n.atributos["componentes"] as string[] | undefined) ?? []).some((c) => c.startsWith(`${r.repo}:`))) as unknown as Array<{ id: string; atributos: { componentes: string[] } }>;
    const leido: RepoLeido = { repo: r.repo, archivos: r.archivos ?? [], paquetes: r.paquetes ?? [], dueñoDe: () => dueñoDeRepo(r.repo), alcance: () => alcancePorPantalla(r.repo, pantallas, estructura) };
    const cache = {};
    for (const a of r.archivos ?? []) {
      for (const u of a.usaPaquetes ?? []) {
        if (propios.has(u.paquete)) continue;
        usosExternos.push({ desde: dueñoDeRepo(r.repo), paquete: u.paquete, simbolo: u.simbolo, evidencia: `${r.repo}:${a.ruta}#L${u.linea}`, pantallas: quienesUsan(leido, a.ruta, u.desde, cache) });
      }
    }
    for (const p of r.paquetes ?? []) for (const d of p.dependeDe ?? []) if (!propios.has(d.nombre) && p.manifiesto) dependenciasExternas.push({ desde: dueñoDeRepo(r.repo), paquete: d.nombre, evidencia: `${r.repo}:${p.manifiesto}#L${d.linea}` });
  }
  return { publica, componentes, usosExternos, dependenciasExternas };
}

/** Un componente de un cerebro que dibuja otro: quién lo usa (pantallas, o el servicio) y cuál es. */
export interface UsoCruzado {
  desde: { cerebro: string; svc: string; evidencia: string; pantallas: string[] };
  hacia: { cerebro: string; componente: string };
}

/** Un repo de un cerebro que declara depender de un paquete que publica otro cerebro. */
export interface DependenciaCruzada {
  desde: { cerebro: string; svc: string; evidencia: string };
  hacia: { cerebro: string; nodo: string; paquete: string };
}

/**
 * Lo que une a los cerebros por paquetes: cada componente importado de un paquete que publica otro cerebro (con las
 * pantallas que lo dibujan) y cada dependencia declarada hacia uno de esos paquetes. Un import nombra el paquete sin
 * ambigüedad, así que no depende de la comunicación entre cerebros, que es para adivinar a quién va una URL.
 */
export function usosEntreCerebros(cerebros: CerebroLiviano[]): { componentes: UsoCruzado[]; dependencias: DependenciaCruzada[] } {
  const componentes: UsoCruzado[] = [];
  const dependencias: DependenciaCruzada[] = [];
  const quienPublica = (paquete: string, salvo: string) => cerebros.filter((c) => c.nombre !== salvo && c.publica?.some((p) => p.paquete === paquete));
  for (const o of cerebros) {
    for (const u of o.usosExternos ?? []) {
      const hits = cerebros.filter((c) => c.nombre !== o.nombre).flatMap((c) => (c.componentes ?? []).filter((x) => x.paquete === u.paquete && x.nombre === u.simbolo).map((x) => ({ cerebro: c.nombre, componente: x.id })));
      if (hits.length === 1) componentes.push({ desde: { cerebro: o.nombre, svc: u.desde, evidencia: u.evidencia, pantallas: u.pantallas }, hacia: hits[0]! });
    }
    const vistas = new Set<string>();
    for (const d of [...(o.dependenciasExternas ?? []), ...(o.usosExternos ?? []).map((u) => ({ desde: u.desde, paquete: u.paquete, evidencia: u.evidencia }))]) {
      const destinos = quienPublica(d.paquete, o.nombre);
      if (destinos.length !== 1) continue;
      const nodo = destinos[0]!.publica!.find((p) => p.paquete === d.paquete)!.dueño;
      const k = `${d.desde}\u0000${destinos[0]!.nombre}\u0000${nodo}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      dependencias.push({ desde: { cerebro: o.nombre, svc: d.desde, evidencia: d.evidencia }, hacia: { cerebro: destinos[0]!.nombre, nodo, paquete: d.paquete } });
    }
  }
  return { componentes, dependencias };
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
    for (const c of raicesDePantalla(n.atributos as { componentes?: string[] })) {
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
  return { nombre, nombres, endpoints, pendientes, funcionalidadesDe, ...porPaquetes(graph, archivos) };
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
  /** Llamadas que el registro declara internas del propio servicio: no se buscan en ningún cerebro. */
  internas: Array<{ cerebro: string; svc: string; evidencia: string }>;
}

/**
 * Un archivo estático de un sitio (`/version.json`, `/logo.svg`). Un parámetro de ruta del back (`/api/{token}`) no lo
 * atiende: lo sirve el propio front. Solo coincide con un endpoint que lo nombre literal.
 */
const ESTATICO = /\.(?:m?js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|json|html?|txt|xml|webmanifest)$/i;
const atrapaEstatico = (rutaEndpoint: string, ruta: string) => {
  const s = segmentos(ruta), ultimo = s[s.length - 1] ?? "", e = segmentos(rutaEndpoint);
  return ESTATICO.test(ultimo) && (e[e.length - 1] ?? "") !== ultimo;
};

const segmentos = (r: string) => r.split("/").filter(Boolean);

/**
 * Endpoints de `destino` que atienden `metodo ruta`: los de ruta idéntica; si no hay, los que terminan igual (la base
 * de la URL aporta el prefijo). Como un router, gana la que acierta más segmentos literales, y tiene que acertar al
 * menos uno: `GET /clubes` no es `GET /v1/pagos/{id}` aunque `{id}` acepte cualquier cosa. `puntaje` sirve para
 * desempatar entre cerebros: una coincidencia exacta vale más que una por sufijo, y más literales, más.
 */
function candidatosConPuntaje(destino: CerebroLiviano, metodo: string, ruta: string, svcs: Set<string> | null) {
  const eps = destino.endpoints.filter((e) => e.metodo === metodo && (!svcs || svcs.has(e.svc)) && !atrapaEstatico(e.ruta, ruta));
  const s = segmentos(ruta);
  const puntos = (e: { ruta: string }) => segmentos(e.ruta).slice(-s.length).filter((x, i) => x === s[i]).length;
  const mejores = <T extends { ruta: string }>(cs: T[]): T[] => {
    const max = Math.max(0, ...cs.map(puntos));
    return max === 0 ? [] : cs.filter((e) => puntos(e) === max);
  };
  const exactos = mejores(eps.filter((e) => rutaCoincide(e.ruta, ruta)));
  if (exactos.length) return { eps: exactos, puntaje: 1000 + puntos(exactos[0]!) };
  const sufijo = mejores(eps.filter((e) => {
    const t = segmentos(e.ruta);
    return t.length > s.length && rutaCoincide(`/${t.slice(t.length - s.length).join("/")}`, ruta);
  }));
  return { eps: sufijo, puntaje: sufijo.length ? puntos(sufijo[0]!) : 0 };
}
const candidatos = (destino: CerebroLiviano, metodo: string, ruta: string, svcs: Set<string> | null) => candidatosConPuntaje(destino, metodo, ruta, svcs).eps;

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

export function crucesDesde(origen: CerebroLiviano, destinos: CerebroLiviano[], conexiones: Conexion[], internas: Interna[] = []): Cruces {
  const out: Cruce[] = [];
  const entreCerebros: Disputada[] = [];
  const deAdentro: Cruces["internas"] = [];
  const propiasInternas = internas.filter((i) => i.de.cerebro === origen.nombre);
  let ambiguas = 0;
  const nombres = new Set(destinos.map((d) => d.nombre));
  const declaradas = conexiones.filter((c) => c.desde.cerebro === origen.nombre && nombres.has(c.hacia.cerebro));
  for (const p of origen.pendientes) {
    // Interna: el registro dice que este servicio se la pide a su propio servidor. No se busca afuera.
    if (propiasInternas.some((i) => i.de.svc === p.desde && (i.por === null ? p.base === "" : p.base.includes(i.por) || p.ruta.startsWith(i.por)))) {
      deAdentro.push({ cerebro: origen.nombre, svc: p.desde, evidencia: p.evidencia });
      continue;
    }
    const propias = declaradas.filter((c) => c.desde.svc === p.desde);
    const aplicables = propias.filter((c) => c.por === null || p.base.includes(c.por));
    let unicos: Array<{ destino: string; endpoint: string; puntaje: number }> = [];
    let varios = false;
    for (const d of destinos) {
      const aca = aplicables.filter((c) => c.hacia.cerebro === d.nombre);
      // Con algo declarado que aplica, solo esos destinos; si este cerebro tiene declaradas y ninguna aplica, no es para acá.
      if (aplicables.length ? !aca.length : propias.some((c) => c.hacia.cerebro === d.nombre)) continue;
      const { eps: cs, puntaje } = candidatosConPuntaje(d, p.metodo, p.ruta, aca.length ? new Set(aca.map((c) => c.hacia.svc)) : null);
      if (cs.length === 1) unicos.push({ destino: d.nombre, endpoint: cs[0]!.id, puntaje });
      else if (cs.length > 1) varios = true;
    }
    // Entre cerebros también gana la coincidencia más específica; si empatan, sigue en disputa.
    const mejor = Math.max(0, ...unicos.map((u) => u.puntaje));
    unicos = unicos.filter((u) => u.puntaje === mejor);
    if (varios) ambiguas++;
    else if (unicos.length === 1) out.push({ desde: { cerebro: origen.nombre, svc: p.desde, evidencia: p.evidencia, pantallas: p.pantallas }, hacia: { cerebro: unicos[0]!.destino, endpoint: unicos[0]!.endpoint }, declarada: aplicables.length > 0 });
    else if (unicos.length > 1) entreCerebros.push({ cerebro: origen.nombre, svc: p.desde, evidencia: p.evidencia, metodo: p.metodo, ruta: p.ruta, base: p.base, candidatos: unicos.map((u) => `${u.destino}/${u.endpoint}`) });
  }
  return { cruces: out, ambiguas, entreCerebros, internas: deAdentro };
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
export const crucesEntre = (origen: CerebroLiviano, destino: CerebroLiviano, conexiones: Conexion[], internas: Interna[] = []): Cruces => crucesDesde(origen, [destino], conexiones, internas);

/** Todos los cruces de un registro: cada cerebro contra los que tiene comunicados. */
export function crucesDelRegistro(cerebros: CerebroLiviano[], comunicados: (a: string, b: string) => boolean, conexiones: Conexion[], internas: Interna[] = []): Cruces {
  const total: Cruces = { cruces: [], ambiguas: 0, entreCerebros: [], internas: [] };
  for (const o of cerebros) {
    const r = crucesDesde(o, cerebros.filter((d) => comunicados(o.nombre, d.nombre)), conexiones, internas);
    total.internas.push(...r.internas);
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
      for (const comp of raicesDePantalla(n.atributos as { componentes?: string[] })) {
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
  // El otro lado del HTTP: lo que ejecuta cada endpoint cruzado, una vez. Si ese back llama a su vez a otro cerebro
  // (una API que cobra en el servicio de pagos), la llamada es un toque hacia ese endpoint, que también se recorre.
  const recorredores = new Map<string, { rec: ReturnType<typeof crearRecorredor>; propio: (id: string) => string; salen: Cruce[] }>();
  const recDe = (nombre: string) => {
    if (recorredores.has(nombre)) return recorredores.get(nombre)!;
    const f = fuente.get(nombre)!;
    const ids = new Set(f.graph.nodes.map((n) => n.id));
    const salen = cruces.filter((c) => c.desde.cerebro === nombre && fuente.has(c.hacia.cerebro));
    const marcas: AristaExtraccion[] = salen.map((c, i) => ({ desde: c.desde.svc, verbo: "llama_a", hasta: `${MARCA}${i}`, endpoint: null, evidencia: c.desde.evidencia }));
    const r = { rec: crearRecorredor(f.graph, estructuraDe(f.archivos), [...aristasDeExtracciones(f.extracciones), ...marcas], tablasSinPagina(f.extracciones), LIMITES_BACK), propio: (id: string) => (ids.has(id) ? `${nombre}/${id}` : id), salen };
    recorredores.set(nombre, r);
    return r;
  };
  const cola: string[] = [];
  for (const c of cruces) if (c.desde.pantallas.length && fuente.has(c.hacia.cerebro)) cola.push(`${c.hacia.cerebro}/${c.hacia.endpoint}`);
  const vistos = new Set<string>();
  const TOPE_BACKS = 3000;
  for (let i = 0; i < cola.length && vistos.size < TOPE_BACKS; i++) {
    const k = cola[i]!;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const nombre = k.slice(0, k.indexOf("/")), ep = k.slice(k.indexOf("/") + 1);
    const { rec, propio, salen } = recDe(nombre);
    const r = rec.desdeEndpoint(ep);
    const pasos = r.pasos.map((p) => ({
      ...p,
      toca: p.toca.map((t) => {
        if (!t.hasta.startsWith(MARCA)) return { ...t, hasta: t.sinPagina ? t.hasta : propio(t.hasta), endpoint: t.endpoint ? propio(t.endpoint) : null };
        const c = salen[Number(t.hasta.slice(1))]!;
        const destino = `${c.hacia.cerebro}/${c.hacia.endpoint}`;
        if (!vistos.has(destino)) cola.push(destino);
        return { verbo: "llama_a", hasta: `${c.hacia.cerebro}/${c.hacia.endpoint.slice(0, c.hacia.endpoint.indexOf(":"))}`, endpoint: destino };
      }),
    }));
    out.backs[k] = r.truncado ? { pasos, truncado: true } : { pasos };
  }
  // Las claves en orden, para que el resultado no dependa del orden en que se descubrieron.
  out.backs = Object.fromEntries(Object.entries(out.backs).sort(([a], [b]) => cmp(a, b)));
  return out;
}

/** Los cruces de un registro vistos desde un cerebro: lo que `deriva` necesita para no confundir "lo atiende otro cerebro" con "no lo atiende nadie". */
export function derivaCruzadaDe(nombre: string, cruces: Cruces, vecinos: string[]): DerivaCruzada {
  const salientes = new Map<string, { cerebro: string; endpoint: string }>();
  const entrantes = new Map<string, Set<string>>();
  const disputadas = new Map<string, string[]>();
  for (const x of cruces.cruces) {
    if (x.desde.cerebro === nombre) salientes.set(x.desde.evidencia, { cerebro: x.hacia.cerebro, endpoint: x.hacia.endpoint });
    if (x.hacia.cerebro === nombre) (entrantes.get(x.hacia.endpoint) ?? entrantes.set(x.hacia.endpoint, new Set()).get(x.hacia.endpoint)!).add(`${x.desde.cerebro}/${x.desde.svc}`);
  }
  for (const d of cruces.entreCerebros) if (d.cerebro === nombre) disputadas.set(d.evidencia, d.candidatos);
  return { vecinos: [...vecinos].sort(cmp), salientes, entrantes, disputadas, internas: new Set(cruces.internas.filter((i) => i.cerebro === nombre).map((i) => i.evidencia)) };
}

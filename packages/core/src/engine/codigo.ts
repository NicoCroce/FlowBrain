import { resolve } from "node:path";
import { cmp } from "../canonical.js";
import { commitDe } from "../git.js";
import {
  aristasDeExtracciones,
  crearRecorredor,
  ES_TEST,
  LIMITES_AGENTE,
  simboloDeLinea,
  tablasSinPagina,
  type EstructuraArchivo,
  type Ficha,
  type Paso,
  type Recorredor,
} from "../funcionalidades.js";
import { dependenciasDelGrafo, impacto as recorrerImpacto, type Dependencia } from "../impacto.js";
import { dentroDe, ENDPOINT_REF, normalizarRuta, type Graph, type GraphNode } from "../schema.js";
import { notasDe, type Contexto } from "./contexto.js";
import { ConsultaError, normalizar, rutaCoincide } from "./herramientas.js";
import { pantallaDeRuta } from "../pantallas.js";
import { tokens } from "./proyeccion.js";

/**
 * Consultas sobre el código y el producto, pensadas para un agente: respuestas cortas, con `repo:ruta#Ln` en cada
 * dato, y explícitas sobre lo que no saben (`avisos`) y sobre de qué versión del código salieron (`indice`).
 * Se apoyan en `_build/funcionalidades.json`, `_build/archivos/*.json` (símbolos, imports, invocaciones) y
 * `_build/extraccion/*.json` (accesos a tablas y llamadas con su línea).
 */

export interface IndiceCodigo {
  fichas: Map<string, Ficha>;
  dependencias: Dependencia[];
  estructura: Map<string, EstructuraArchivo>;
  recorredor: Recorredor;
  /** repo → commit de HEAD al indexar. */
  commits: Record<string, string>;
  /** repo → ruta del clon relativa al brain (de `_build/archivos`). */
  raices: Record<string, string>;
  /** repo → HEAD actual del clon, leído al consultar (`actualizarHeads`); ausente si no se pudo leer. */
  actuales: Record<string, string>;
  /** `repo:ruta#Simbolo` → quién lo llama, con la línea de la llamada. */
  llamadores: Map<string, Array<{ clave: string; linea: number; via?: string | undefined }>>;
  /** Nombre de símbolo → claves `repo:ruta#Simbolo`. */
  porNombre: Map<string, string[]>;
  /** `repo:ruta#Simbolo` → endpoints que atiende. */
  atiende: Map<string, string[]>;
  /** Endpoint → métodos que lo llaman por HTTP (de cualquier repo), con su evidencia. */
  llamanEndpoint: Map<string, Array<{ clave: string; evidencia: string }>>;
  /** Tabla → métodos que la leen o escriben, con su evidencia. */
  tocanTabla: Map<string, Array<{ clave: string; verbo: string; evidencia: string }>>;
  /** Llamadas HTTP que el índice no pudo unir a un endpoint (`pendientes` de la extracción). */
  llamadasPendientes: Array<{ desde: string; referencia: string; motivo: string; evidencia: string; candidatos: number; llamada?: { metodo: string; ruta: string | null; base: string } }>;
}

const clave = (archivo: string, simbolo: string) => `${archivo}#${simbolo}`;
const partes = (k: string) => {
  const i = k.lastIndexOf("#");
  return { archivo: k.slice(0, i), simbolo: k.slice(i + 1) };
};

/** Arma el índice desde los contenidos de los JSON de `_build` (los que no se pueden leer se ignoran). */
export function crearIndiceCodigo(graph: Graph, fichas: Ficha[], archivos: string[], extracciones: string[]): IndiceCodigo {
  const estructura = new Map<string, EstructuraArchivo>();
  const commits: Record<string, string> = {};
  const raices: Record<string, string> = {};
  for (const c of archivos) {
    try {
      const j = JSON.parse(c) as { repo: string; commit?: string; raiz?: string; archivos: Array<{ ruta: string } & Partial<EstructuraArchivo>> };
      if (j.commit) commits[j.repo] = j.commit;
      if (j.raiz) raices[j.repo] = j.raiz;
      for (const a of j.archivos ?? []) estructura.set(`${j.repo}:${a.ruta}`, { simbolos: a.simbolos ?? [], importa: a.importa ?? [], invoca: a.invoca ?? [], sinResolver: a.sinResolver });
    } catch {
      /* ignorado */
    }
  }
  const aristas = aristasDeExtracciones(extracciones);
  const sinPagina = tablasSinPagina(extracciones);
  const recorredor = crearRecorredor(graph, estructura, aristas, sinPagina, LIMITES_AGENTE);
  const llamadores = new Map<string, Array<{ clave: string; linea: number; via?: string | undefined }>>();
  const porNombre = new Map<string, string[]>();
  for (const [archivo, e] of [...estructura.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const repo = archivo.slice(0, archivo.indexOf(":"));
    for (const s of e.simbolos) porNombre.set(s.nombre, [...(porNombre.get(s.nombre) ?? []), clave(archivo, s.nombre)]);
    for (const i of e.invoca) {
      const destino = clave(`${repo}:${i.archivo}`, i.simbolo);
      llamadores.set(destino, [...(llamadores.get(destino) ?? []), { clave: clave(archivo, i.desde), linea: i.linea, ...(i.via ? { via: i.via } : {}) }]);
    }
  }
  const atiende = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (n.tipo !== "endpoint") continue;
    const h = recorredor.atiende(n.id);
    if (h) atiende.set(clave(h.archivo, h.simbolo), [...(atiende.get(clave(h.archivo, h.simbolo)) ?? []), n.id]);
  }
  const llamanEndpoint = new Map<string, Array<{ clave: string; evidencia: string }>>();
  const tocanTabla = new Map<string, Array<{ clave: string; verbo: string; evidencia: string }>>();
  for (const a of aristas) {
    if (a.verbo === "llama_a" && a.endpoint) {
      const m = /^([^#]+)#L(\d+)/.exec(a.evidencia);
      const e = m ? estructura.get(m[1]!) : undefined;
      const s = e ? simboloDeLinea(e, Number(m![2])) : null;
      const k = s ? clave(m![1]!, s.nombre) : a.evidencia;
      const lista = llamanEndpoint.get(a.endpoint) ?? [];
      if (!lista.some((x) => x.clave === k)) lista.push({ clave: k, evidencia: a.evidencia });
      llamanEndpoint.set(a.endpoint, lista);
    }
    if (a.verbo !== "lee_de" && a.verbo !== "escribe_en") continue;
    const m = /^([^#]+)#L(\d+)/.exec(a.evidencia);
    const e = m ? estructura.get(m[1]!) : undefined;
    const s = e ? simboloDeLinea(e, Number(m![2])) : null;
    const k = s ? clave(m![1]!, s.nombre) : a.evidencia;
    const lista = tocanTabla.get(a.hasta) ?? [];
    if (!lista.some((x) => x.clave === k && x.verbo === a.verbo)) lista.push({ clave: k, verbo: a.verbo, evidencia: a.evidencia });
    tocanTabla.set(a.hasta, lista);
  }
  const llamadasPendientes: IndiceCodigo["llamadasPendientes"] = [];
  for (const c of extracciones) {
    try {
      const j = JSON.parse(c) as { pendientes?: Array<{ verbo: string; desde: string; referencia: string; motivo: string; evidencia: string; candidatos?: unknown[]; llamada?: { metodo: string; ruta: string | null; base: string } }> };
      for (const p of j.pendientes ?? []) if (p.verbo === "llama_a") llamadasPendientes.push({ desde: p.desde, referencia: p.referencia, motivo: p.motivo, evidencia: p.evidencia, candidatos: p.candidatos?.length ?? 0, ...(p.llamada ? { llamada: p.llamada } : {}) });
    } catch {
      /* ignorado */
    }
  }
  llamadasPendientes.sort((a, b) => cmp(a.evidencia, b.evidencia) || cmp(a.referencia, b.referencia));
  return { fichas: new Map(fichas.map((f) => [f.id, f])), dependencias: dependenciasDelGrafo(graph, fichas), estructura, recorredor, commits, raices, actuales: {}, llamadores, porNombre, atiende, llamanEndpoint, tocanTabla, llamadasPendientes };
}

/** Lee el HEAD actual de cada clon indexado, para avisar si el índice quedó atrás. Barato: unas lecturas de `.git`. */
export async function actualizarHeads(ix: IndiceCodigo, raizBrain: string): Promise<void> {
  const actuales: Record<string, string> = {};
  for (const [repo, r] of Object.entries(ix.raices)) {
    const c = await commitDe(resolve(raizBrain, r));
    if (c) actuales[repo] = c;
  }
  ix.actuales = actuales;
}

/** Avisos de índice viejo: el clon avanzó (o cambió de rama) desde que se indexó. */
export function avisosIndice(ix: IndiceCodigo): string[] {
  return Object.keys(ix.commits)
    .sort(cmp)
    .filter((r) => ix.actuales[r] && ix.actuales[r] !== ix.commits[r])
    .map((r) => `índice desactualizado: ${r} se indexó en ${corto(ix.commits[r]!)} y el clon está en ${corto(ix.actuales[r]!)}; las líneas pueden no coincidir (corré \`flowbrain index\` y \`flowbrain compile\`)`);
}

// ------------------------------------------------------------------ utilidades

function indice(ctx: Contexto): IndiceCodigo {
  if (!ctx.codigo) throw new ConsultaError("parametro_invalido", "no hay índice de código: corré `flowbrain index <repo>` y `flowbrain compile`");
  return ctx.codigo;
}
const corto = (c: string) => c.slice(0, 12);
const versiones = (ix: IndiceCodigo) => Object.fromEntries(Object.entries(ix.commits).map(([r, c]) => [r, corto(c)]));
const nombre = (ctx: Contexto, id: string) => ctx.nodo.get(id)?.nombre ?? id;
/** `repo:ruta#Clase.metodo` + línea → como lo cita una evidencia: `Clase.metodo @ repo:ruta#Ln`. */
const cita = (ix: IndiceCodigo, k: string, linea?: number) => {
  const { archivo, simbolo } = partes(k);
  const l = linea ?? ix.estructura.get(archivo)?.simbolos.find((s) => s.nombre === simbolo)?.linea;
  return `${simbolo} @ ${archivo}${l ? `#L${l}` : ""}`;
};
const dueñas = (ix: IndiceCodigo, archivo: string) => [...ix.fichas.values()].filter((f) => f.codigo.some((c) => dentroDe(archivo, c))).map((f) => f.id);

/** Recorta listas desde el final, en el orden dado, hasta entrar en el presupuesto. Informa cuántos ítems quitó. */
function ajustarLista<T extends Record<string, unknown>>(r: T, campos: (keyof T & string) | Array<keyof T & string>, budget: number | null | undefined): T & { truncado?: true; omitidos?: number } {
  const b = budget === undefined ? 2000 : budget;
  if (b === null || tokens(r) <= b) return r;
  const copia: Record<string, unknown> = { ...r };
  let omitidos = 0;
  const mide = () => tokens({ ...copia, truncado: true, omitidos });
  for (const c of Array.isArray(campos) ? campos : [campos]) {
    if (!Array.isArray(copia[c])) continue;
    const lista = [...(copia[c] as unknown[])];
    copia[c] = lista;
    while (lista.length > 0 && mide() > b) {
      lista.pop();
      omitidos++;
    }
    if (mide() <= b) break;
  }
  return (omitidos ? { ...copia, truncado: true, omitidos } : copia) as T & { truncado?: true; omitidos?: number };
}

function resolverEndpoints(ctx: Contexto, ref: string): string[] {
  if (ctx.nodo.get(ref)?.tipo === "endpoint") return [ref];
  const m = ENDPOINT_REF.exec(ref);
  const metodo = m ? m[1]! : null;
  const ruta = m ? m[2]! : ref.startsWith("/") ? ref : null;
  if (ruta === null) return [];
  const r = normalizarRuta(ruta);
  return ctx.graph.nodes
    .filter((n) => n.tipo === "endpoint")
    .filter((n) => {
      const a = n.atributos as { metodo: string; ruta: string };
      return (metodo === null || a.metodo === metodo) && rutaCoincide(a.ruta, r);
    })
    .map((n) => n.id)
    .sort(cmp);
}

/** Símbolo por `repo:ruta#Simbolo`, `ruta#Simbolo` o nombre (`Clase.metodo`, `funcion`, `Clase` → todos sus métodos). */
function resolverSimbolo(ix: IndiceCodigo, ref: string): string[] {
  const conArchivo = /^(.+)#([^#]+)$/.exec(ref);
  let claves: string[];
  if (conArchivo) {
    const [, a, s] = conArchivo;
    claves = (ix.porNombre.get(s!) ?? []).filter((k) => {
      const p = partes(k).archivo;
      return p === a || p.endsWith(`:${a}`);
    });
  } else claves = ix.porNombre.get(ref) ?? [];
  // Una clase incluye sus métodos (y la clase misma, por `new Clase()`).
  const out = new Set<string>();
  for (const k of claves) {
    out.add(k);
    const { archivo, simbolo } = partes(k);
    for (const s of ix.estructura.get(archivo)?.simbolos ?? []) if (s.nombre.startsWith(`${simbolo}.`)) out.add(clave(archivo, s.nombre));
  }
  return [...out].sort(cmp);
}

function sugerencias(ix: IndiceCodigo, ref: string): string[] {
  const q = normalizar(ref.replace(/^.*#/, ""));
  return [...ix.porNombre.keys()].filter((n) => normalizar(n).includes(q)).sort(cmp).slice(0, 8);
}

const toque = (t: { verbo: string; hasta: string; endpoint: string | null; sinPagina?: true }) => `${t.verbo} ${t.endpoint ?? t.hasta}${t.sinPagina ? " (tabla sin página en el brain)" : ""}`;
const paso = (ix: IndiceCodigo, p: Paso) => ({
  n: p.nivel,
  simbolo: p.simbolo,
  ev: p.evidencia,
  ...(p.toca.length ? { toca: p.toca.map(toque) } : {}),
  ...(p.aviso ? { aviso: p.aviso } : {}),
  ...(p.via ? { via: p.via.startsWith("HTTP ") ? `por HTTP: ${p.via.slice(5)}` : `en diferido, por evento o cola ${p.via}` } : {}),
  ...(p.repite ? { repite: p.repite === "ciclo" ? "llamada recursiva: no se expande" : "ya recorrido antes: toca resume lo que tocó (él y lo que llama)" } : {}),
});

/** Llamadas sin resolver dentro de los pasos de un recorrido: ahí el recorrido puede seguir y no lo sabemos. */
function sinResolverEnPasos(ix: IndiceCodigo, pasos: Array<{ simbolo: string; ev: string }>): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const p of pasos) {
    const archivo = p.ev.replace(/#L\d+$/, "");
    const k = `${archivo}#${p.simbolo}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    for (const s of ix.estructura.get(archivo)?.sinResolver ?? []) if (s.desde === p.simbolo) out.push(`llamada sin resolver en ${p.simbolo}: ${s.llamada} (${archivo}#L${s.linea}); el recorrido puede seguir por ahí`);
  }
  return out.length > 8 ? [...out.slice(0, 8), `y ${out.length - 8} llamadas sin resolver más`] : out;
}

/** Llamadas sin resolver en todo el código indexado cuyo método se llama igual que el buscado: posibles llamadores que no se ven. */
function sinResolverConNombre(ix: IndiceCodigo, claves: string[]): string[] {
  const nombres = new Set(claves.map((k) => partes(k).simbolo.split(".").pop()!));
  const out: string[] = [];
  for (const [archivo, e] of ix.estructura) {
    if (ES_TEST.test(archivo)) continue;
    for (const s of e.sinResolver ?? []) {
      const m = s.llamada.split(".").pop()!;
      if (nombres.has(m)) out.push(`posible llamador no resuelto: ${s.desde} @ ${archivo}#L${s.linea} llama ${s.llamada} (tipo sin resolver)`);
    }
  }
  out.sort(cmp);
  return out.length > 8 ? [...out.slice(0, 8), `y ${out.length - 8} posibles llamadores no resueltos más`] : out;
}

// ------------------------------------------------------------------ funcionalidad

export interface FuncionalidadParams {
  id: string;
  budget_tokens?: number | null;
}

function resolverFeat(ctx: Contexto, ix: IndiceCodigo, ref: string): Ficha {
  const directa = ix.fichas.get(ref) ?? ix.fichas.get(`feat-${ref}`);
  if (directa) return directa;
  const q = normalizar(ref);
  const feats = [...ix.fichas.keys()].filter((id) => {
    const n = ctx.nodo.get(id);
    return n && [n.nombre, ...n.aliases, id].some((k) => normalizar(k) === q);
  });
  if (feats.length === 1) return ix.fichas.get(feats[0]!)!;
  const parecidas = [...ix.fichas.keys()].filter((id) => normalizar(`${id} ${nombre(ctx, id)}`).includes(q)).sort(cmp);
  throw new ConsultaError("nodo_inexistente", `no existe la funcionalidad: ${ref}${parecidas.length ? ` (¿${parecidas.slice(0, 6).join(", ")}?)` : ""}`);
}

export function funcionalidad(ctx: Contexto, p: FuncionalidadParams) {
  const ix = indice(ctx);
  const f = resolverFeat(ctx, ix, p.id);
  const n = ctx.nodo.get(f.id);
  const datos = f.datos.map((d) => ({ tabla: d.tabla, lee: d.lee, escribe: d.escribe, ev: d.evidencia }));
  const via = f.usaFuncionalidades.flatMap((u) =>
    (ix.fichas.get(u)?.datos ?? []).filter((d) => !f.datos.some((x) => x.tabla === d.tabla)).map((d) => ({ tabla: d.tabla, via: u })),
  );
  const res = {
    id: f.id,
    nombre: n?.nombre ?? f.id,
    resumen: n?.resumen ?? null,
    ...(notasDe(ctx, f.id).length ? { notas: notasDe(ctx, f.id) } : {}),
    codigo: f.codigo,
    implementan: f.implementan,
    usa: f.usaFuncionalidades,
    usadaPor: f.usadaPor,
    expone: f.expone.map((ep) => {
      const h = ix.recorredor.atiende(ep);
      return { endpoint: ep, atiende: h ? cita(ix, clave(h.archivo, h.simbolo)) : null };
    }),
    consume: f.usa.map((u) => ({
      a: u.endpoint ?? u.hasta,
      ...(u.endpoint ? { de: [...ix.fichas.values()].filter((g) => g.id !== f.id && g.expone.includes(u.endpoint!)).map((g) => g.id) } : {}),
      ev: u.evidencia,
      veces: u.veces,
    })),
    // Pantallas del front que dibuja (componente en su codigo) y qué endpoints llaman: `pantalla(ruta)` da el recorrido.
    pantallas: f.pantallas.map((x) => ({ pantalla: x.id, ruta: x.ruta, componente: x.componente, llamaAlBack: x.endpoints })),
    datos,
    datosVia: via,
    dominioCompartido: f.dominio.filter((d) => d.de || d.usadoPor.length).map((d) => ({ archivo: d.archivo, elementos: d.elementos, de: d.de, usadoPor: d.usadoPor })),
    avisos: [
      ...(f.recorridos.some((r) => r.pasos.some((x) => x.aviso)) ? [`hay pasos de repositorio sin tabla detectada: ver recorrido(endpoint)`] : []),
      ...(f.expone.length === 0 && f.usa.length === 0 ? ["sin endpoints expuestos ni consumidos dentro de codigo"] : []),
      ...avisosIndice(ix),
    ],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["dominioCompartido", "datosVia", "consume", "pantallas", "expone", "datos"], p.budget_tokens);
}

// ------------------------------------------------------------------ recorrido

export interface RecorridoParams {
  desde: string;
  budget_tokens?: number | null;
}

export function recorrido(ctx: Contexto, p: RecorridoParams) {
  const ix = indice(ctx);
  const pant = resolverPantalla(ctx, p.desde);
  if (pant) {
    const r = recorridoPantalla(ctx, ix, pant);
    return ajustarLista({ inicio: pant.id, atiende: r.componente, pasos: r.pasos, ...(r.truncado ? { truncado: true as const } : {}), avisos: r.avisos, indice: versiones(ix) }, "pasos", p.budget_tokens);
  }
  const eps = resolverEndpoints(ctx, p.desde);
  let recorridos: Array<{ inicio: string; atiende: string | null; pasos: ReturnType<typeof paso>[]; truncado?: true }>;
  if (eps.length) {
    recorridos = eps.slice(0, 3).map((ep) => {
      const h = ix.recorredor.atiende(ep);
      const r = ix.recorredor.desdeEndpoint(ep);
      return { inicio: ep, atiende: h ? cita(ix, clave(h.archivo, h.simbolo)) : null, pasos: r.pasos.map((x) => paso(ix, x)), ...(r.truncado ? { truncado: true as const } : {}) };
    });
  } else {
    const claves = resolverSimbolo(ix, p.desde).filter((k) => ix.estructura.get(partes(k).archivo)?.simbolos.some((s) => s.nombre === partes(k).simbolo && s.tipo !== "clase"));
    if (!claves.length) {
      const s = sugerencias(ix, p.desde);
      throw new ConsultaError("nodo_inexistente", `ni endpoint ni símbolo: ${p.desde}${s.length ? ` (¿${s.join(", ")}?)` : ""}`);
    }
    recorridos = claves.slice(0, 3).map((k) => {
      const { archivo, simbolo } = partes(k);
      const r = ix.recorredor.desdeSimbolo(archivo, simbolo);
      return { inicio: k, atiende: cita(ix, k), pasos: r.pasos.map((x) => paso(ix, x)), ...(r.truncado ? { truncado: true as const } : {}) };
    });
  }
  const avisos = [
    ...(recorridos.some((r) => !r.atiende) ? ["no se encontró el método que atiende algún endpoint (¿otro lenguaje o framework sin soporte?)"] : []),
    ...(recorridos.some((r) => r.truncado) ? [`recorrido cortado por profundidad (${LIMITES_AGENTE.nivel}) o cantidad de pasos (${LIMITES_AGENTE.pasos})`] : []),
    ...((eps.length || 0) > 3 ? [`${eps.length} endpoints coinciden; se muestran 3`] : []),
    ...sinResolverEnPasos(ix, recorridos.flatMap((r) => r.pasos)),
    ...avisosIndice(ix),
  ];
  const res = { recorridos, avisos, indice: versiones(ix) };
  if (recorridos.length === 1) return ajustarLista({ ...recorridos[0]!, avisos, indice: versiones(ix) }, "pasos", p.budget_tokens);
  return ajustarLista(res, "recorridos", p.budget_tokens);
}

// ------------------------------------------------------------------ pantalla

type AtrPantalla = {
  ruta: string;
  componentes: string[];
  evidencia: string;
  envuelta: Array<{ componente: string; sale: Array<{ a: string | null; ruta: string; tipo: string; evidencia: string }> }>;
  sale: Array<{ a: string | null; ruta: string; tipo: string; evidencia: string }>;
  desdeEnvolturas?: Array<{ componente: string; tipo: string; evidencia: string }>;
};

/**
 * Pantalla por id, por `pantalla /ruta`, por una ruta del front que coincide con una pantalla (y con ningún endpoint),
 * o por el nombre de su componente. `null` si la referencia no parece una pantalla.
 */
function resolverPantalla(ctx: Contexto, ref: string): GraphNode | null {
  const n = ctx.nodo.get(ref);
  if (n) return n.tipo === "pantalla" ? n : null;
  const pantallas = ctx.graph.nodes.filter((x) => x.tipo === "pantalla");
  if (!pantallas.length) return null;
  const explicita = /^pantalla\s+(\S+)$/i.exec(ref.trim());
  const ruta = explicita ? normalizarRuta(explicita[1]!) : ref.startsWith("/") && !ENDPOINT_REF.test(ref) ? normalizarRuta(ref) : null;
  if (ruta) {
    if (!explicita && resolverEndpoints(ctx, ruta).length) return null;
    const conRuta = pantallas.map((x) => ({ ruta: (x.atributos as AtrPantalla).ruta, n: x }));
    const hit = pantallaDeRuta(ruta, conRuta);
    if (hit) return hit.n;
    if (explicita) throw new ConsultaError("nodo_inexistente", `no hay una pantalla con la ruta ${ruta}`);
    return null;
  }
  const porComponente = pantallas.filter((x) => x.aliases.includes(ref));
  return porComponente.length === 1 ? porComponente[0]! : null;
}

/** Recorrido de punta a punta desde el componente de una pantalla: cruza al back por HTTP. */
function recorridoPantalla(ctx: Contexto, ix: IndiceCodigo, n: GraphNode) {
  const a = n.atributos as AtrPantalla;
  const componente = a.componentes[a.componentes.length - 1] ?? null;
  const pasos: ReturnType<typeof paso>[] = [];
  let truncado = false;
  // Con varios componentes (la misma ruta declarada dos veces) se recorren todos.
  for (const c of a.componentes) {
    const { archivo, simbolo } = partes(c);
    const r = ix.recorredor.desdeSimbolo(archivo, simbolo);
    pasos.push(...r.pasos.map((x) => paso(ix, x)));
    truncado ||= r.truncado;
  }
  const avisos = [
    ...(a.componentes.length > 1 ? [`la ruta ${a.ruta} se declara ${a.componentes.length} veces: se recorren todos sus componentes`] : []),
    ...(a.componentes.length === 0 ? ["no se encontró el componente de la pantalla"] : []),
    ...(truncado ? [`recorrido cortado por profundidad (${LIMITES_AGENTE.nivel}) o cantidad de pasos (${LIMITES_AGENTE.pasos})`] : []),
    ...sinResolverEnPasos(ix, pasos),
  ];
  return { componente: componente ? cita(ix, componente) : null, pasos, truncado, avisos };
}

export interface PantallaParams {
  ruta: string;
  budget_tokens?: number | null;
}

/** Una pantalla del front de punta a punta: de dónde se llega, a dónde lleva, qué la envuelve y qué llama del back. */
export function pantalla(ctx: Contexto, p: PantallaParams) {
  const ix = indice(ctx);
  const n = resolverPantalla(ctx, p.ruta.startsWith("/") && !ctx.nodo.has(p.ruta) ? `pantalla ${p.ruta}` : p.ruta);
  if (!n) {
    const q = normalizar(p.ruta);
    const parecidas = ctx.graph.nodes.filter((x) => x.tipo === "pantalla" && normalizar(`${x.nombre} ${x.aliases.join(" ")}`).includes(q)).map((x) => x.nombre);
    throw new ConsultaError("nodo_inexistente", `no existe la pantalla: ${p.ruta}${parecidas.length ? ` (¿${parecidas.slice(0, 6).join(", ")}?)` : ""}`);
  }
  const a = n.atributos as AtrPantalla;
  const r = recorridoPantalla(ctx, ix, n);
  // Solo lo que llama el front mismo: se descarta lo que cuelga de un salto por HTTP (eso ya es el back).
  let back: number | null = null;
  const delFront = r.pasos.filter((x) => {
    if (back !== null && x.n > back) return false;
    back = x.via?.startsWith("por HTTP") ? x.n : null;
    return back === null;
  });
  const llama = [...new Set(delFront.flatMap((x) => (x.toca ?? []).filter((t) => t.startsWith("llama_a ")).map((t) => t.slice(8))))];
  const salida = (s: AtrPantalla["sale"][number]) => ({ a: s.a ? nombre(ctx, s.a) : `${s.ruta} (sin pantalla conocida)`, tipo: s.tipo, ev: s.evidencia });
  const entran = ctx.graph.edges.filter((e) => e.verbo === "navega_a" && e.hasta === n.id);
  const res = {
    id: n.id,
    ruta: a.ruta,
    componente: r.componente,
    funcionalidades: [...new Set(a.componentes.flatMap((c) => dueñas(ix, partes(c).archivo)))].sort(cmp),
    declarada: a.evidencia,
    envuelta: a.envuelta.map((e) => ({ componente: cita(ix, e.componente), lleva: e.sale.map(salida) })),
    llegaDesde: [
      ...entran.map((e) => ({ desde: nombre(ctx, e.desde), ev: e.evidencia })),
      ...(a.desdeEnvolturas ?? []).map((d) => ({ desde: `${partes(d.componente).simbolo} (layout o guarda, ${d.tipo})`, ev: d.evidencia })),
    ],
    vaA: a.sale.map(salida),
    llamaAlBack: llama,
    recorrido: r.pasos,
    avisos: [
      ...(entran.length === 0 && !(a.desdeEnvolturas ?? []).length ? ["ninguna pantalla conocida lleva acá: se entra desde afuera (link, mail, callback) o con una ruta armada en tiempo de ejecución"] : []),
      ...r.avisos,
      ...avisosIndice(ix),
    ],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["recorrido", "llegaDesde", "vaA"], p.budget_tokens);
}

// ------------------------------------------------------------------ quien_llama

export interface QuienLlamaParams {
  simbolo: string;
  profundidad?: number;
  budget_tokens?: number | null;
}

export function quienLlama(ctx: Contexto, p: QuienLlamaParams) {
  const ix = indice(ctx);
  const prof = p.profundidad ?? 3;
  if (!Number.isInteger(prof) || prof < 1 || prof > 6) throw new ConsultaError("parametro_invalido", "profundidad debe estar entre 1 y 6");
  const inicio = resolverSimbolo(ix, p.simbolo);
  if (!inicio.length) {
    const s = sugerencias(ix, p.simbolo);
    throw new ConsultaError("nodo_inexistente", `no existe el símbolo: ${p.simbolo}${s.length ? ` (¿${s.join(", ")}?)` : ""}`);
  }
  const vistos = new Set(inicio);
  const llamadas: Array<{ nivel: number; quien: string; llama_a: string; via?: string }> = [];
  let frente = inicio;
  for (let nivel = 1; nivel <= prof && frente.length; nivel++) {
    const siguiente: string[] = [];
    for (const k of frente) {
      for (const l of [...(ix.llamadores.get(k) ?? [])].sort((a, b) => cmp(a.clave, b.clave))) {
        llamadas.push({ nivel, quien: cita(ix, l.clave, l.linea), llama_a: partes(k).simbolo, ...(l.via ? { via: `evento o cola ${l.via}` } : {}) });
        if (!vistos.has(l.clave)) {
          vistos.add(l.clave);
          siguiente.push(l.clave);
        }
      }
    }
    frente = siguiente;
  }
  const alcanzados = [...vistos];
  const endpoints = [...new Set(alcanzados.flatMap((k) => ix.atiende.get(k) ?? []))].sort(cmp);
  const feats = new Set<string>();
  for (const k of alcanzados) for (const f of dueñas(ix, partes(k).archivo)) feats.add(f);
  const consumidoras = [...ix.fichas.values()].filter((f) => f.usa.some((u) => u.endpoint && endpoints.includes(u.endpoint))).map((f) => f.id);
  const res = {
    simbolo: inicio.map((k) => cita(ix, k)),
    endpoints,
    funcionalidades: [...feats].sort(cmp),
    consumenEsosEndpoints: consumidoras.filter((f) => !feats.has(f)).sort(cmp),
    porHttp: endpoints.flatMap((ep) =>
      (ix.llamanEndpoint.get(ep) ?? []).map((l) => ({ endpoint: ep, quien: l.clave.includes("#L") ? l.clave : cita(ix, l.clave, Number(/#L(\d+)$/.exec(l.evidencia)?.[1])) })),
    ),
    llamadas,
    avisos: [
      ...(frente.length ? [`hay más llamadores por encima de la profundidad ${prof}`] : []),
      ...sinResolverConNombre(ix, inicio),
      ...avisosIndice(ix),
    ],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["llamadas", "porHttp", "consumenEsosEndpoints", "endpoints"], p.budget_tokens);
}

// ------------------------------------------------------------------ impacto

export interface ImpactoParams {
  pieza: string;
  budget_tokens?: number | null;
}

const VERBO: Record<string, string> = { usa: "usa", escribe_en: "escribe en", lee_de: "lee", llama_a: "llama a", implementa: "está implementada por", vive_en: "vive en", publica_en: "publica en", consume_de: "consume de", depende_de: "depende de" };

export interface InfraParams {
  /** Servicio, repo, base, cola o externo. Sin nodo: toda la infraestructura del brain. */
  nodo?: string;
  /** Filtra por texto: una variable de entorno, un puerto, una imagen, un paso de pipeline. */
  texto?: string;
  budget_tokens?: number | null;
}

/**
 * Infraestructura declarada en los repos: imágenes, servicios de compose, pipelines de CI, variables de entorno
 * (solo nombres) y rutas de proxy, cada una con su archivo. Para un servicio suma lo del repo donde vive; para un
 * repo, lo de sus servicios. No necesita índice de código.
 */
export function infra(ctx: Contexto, p: InfraParams) {
  type Item = { clase: string; nombre: string; detalle: string[]; evidencia: string };
  let ids: string[];
  if (p.nodo !== undefined) {
    if (!ctx.nodo.has(p.nodo)) throw new ConsultaError("nodo_inexistente", `no existe el nodo: ${p.nodo}`);
    const vive = (verboDesde: "salientes" | "entrantes") => (ctx[verboDesde].get(p.nodo!) ?? []).filter((e) => e.verbo === "vive_en").map((e) => (verboDesde === "salientes" ? e.hasta : e.desde));
    ids = [p.nodo, ...vive("salientes"), ...vive("entrantes")];
  } else ids = ctx.graph.nodes.map((n) => n.id);
  const q = p.texto ? normalizar(p.texto) : "";
  const items = [...new Set(ids)].sort(cmp).flatMap((id) =>
    ((ctx.nodo.get(id)?.atributos["infra"] as Item[] | undefined) ?? [])
      .filter((it) => !q || [it.clase, it.nombre, ...it.detalle].some((t) => normalizar(t).includes(q)))
      .map((it) => ({ de: id, clase: it.clase, nombre: it.nombre, detalle: q ? it.detalle.filter((t) => normalizar(t).includes(q) || normalizar(it.nombre).includes(q) || it.clase === q) : it.detalle, ev: it.evidencia })),
  );
  const res = {
    ...(p.nodo !== undefined ? { nodo: p.nodo } : {}),
    ...(p.texto ? { texto: p.texto } : {}),
    total: items.length,
    items,
    avisos: items.length ? [] : [ctx.graph.nodes.some((n) => n.atributos["infra"]) ? "nada coincide: no hay infraestructura declarada para eso en los repos indexados" : "el brain no tiene infraestructura indexada (corré flowbrain index y flowbrain compile)"],
  };
  return ajustarLista(res, "items", p.budget_tokens);
}

/** Lo que la gente dejó escrito sobre una pieza: decisiones que la explican y equipos dueños de ella y de lo afectado. */
function contextoHumano(ctx: Contexto, id: string, afectados: string[]) {
  const hacia = (desde: string, verbo: string) => (ctx.salientes.get(desde) ?? []).filter((e) => e.verbo === verbo && e.estado !== "deprecado").map((e) => e.hasta);
  const decisiones = hacia(id, "decidido_por").sort(cmp).map((d) => ({ id: d, nombre: ctx.nodo.get(d)?.nombre ?? d, resumen: ctx.nodo.get(d)?.resumen ?? null }));
  const porEquipo = new Map<string, string[]>();
  for (const x of [...(id ? [id] : []), ...new Set(afectados)]) for (const t of hacia(x, "pertenece_a")) porEquipo.set(t, [...(porEquipo.get(t) ?? []), x]);
  const equipos = [...porEquipo.entries()].sort((a, b) => cmp(a[0], b[0])).map(([equipo, por]) => ({ equipo, nombre: ctx.nodo.get(equipo)?.nombre ?? equipo, por: por.sort(cmp) }));
  // Notas sin revisar sobre la pieza o lo afectado: alguien vio que el código no coincide con el brain.
  const notas = [...(id ? [id] : []), ...new Set(afectados)].flatMap((x) => notasDe(ctx, x).map((nota) => ({ de: x, nota }))).slice(0, 20);
  return { ...(decisiones.length ? { decisiones } : {}), ...(equipos.length ? { equipos } : {}), ...(notas.length ? { notas } : {}) };
}

/** Columnas de una tabla como texto: `nombre tipo`, con `pk` y `null` cuando aplica. */
function columnasDe(ctx: Contexto, id: string): string[] | null {
  const cols = ctx.nodo.get(id)?.atributos["columnas"] as Array<{ nombre: string; tipo: string; nulo: boolean; pk: boolean }> | undefined;
  return cols?.length ? cols.map((c) => `${c.nombre} ${c.tipo}${c.pk ? " pk" : ""}${c.nulo ? " null" : ""}`) : null;
}

export function impactoDe(ctx: Contexto, p: ImpactoParams) {
  const ix = indice(ctx);
  let id = ctx.nodo.has(p.pieza) ? p.pieza : null;
  if (!id) {
    const eps = resolverEndpoints(ctx, p.pieza);
    if (eps.length === 1) id = eps[0]!;
  }
  if (!id) {
    const q = normalizar(p.pieza);
    const nodos = ctx.graph.nodes.filter((n) => n.tipo !== "archivo" && [n.nombre, ...n.aliases].some((k) => normalizar(k) === q));
    if (nodos.length === 1) id = nodos[0]!.id;
  }
  // Un símbolo de código: el impacto es quién lo llama.
  if (!id && resolverSimbolo(ix, p.pieza).length) return { ...quienLlama(ctx, { simbolo: p.pieza, ...(p.budget_tokens !== undefined ? { budget_tokens: p.budget_tokens } : {}) }), nota: "es un símbolo de código: impacto = quién lo llama" };
  if (!id) throw new ConsultaError("nodo_inexistente", `no se pudo resolver la pieza: ${p.pieza}`);

  const niveles = recorrerImpacto(ix.dependencias, id);
  const info = new Map<string, { via: string; verbo: string }>();
  for (const nv of niveles) for (const x of nv) info.set(x.id, x);
  const porque = (x: string) => {
    const out: string[] = [];
    for (let c = info.get(x); c; c = info.get(c.via)) out.push(`${VERBO[c.verbo] ?? c.verbo} ${c.via}`);
    return out.join(", que ");
  };
  const afectados = niveles.flatMap((nv, i) => nv.map((x) => ({ nivel: i + 1, id: x.id, tipo: ctx.nodo.get(x.id)?.tipo ?? "", porque: porque(x.id) })));
  const res = {
    pieza: id,
    tipo: ctx.nodo.get(id)?.tipo ?? "",
    funcionalidades: afectados.filter((a) => a.tipo === "feat"),
    ...(columnasDe(ctx, id) ? { columnas: columnasDe(ctx, id) } : {}),
    ...contextoHumano(ctx, id, afectados.map((a) => a.id)),
    ...(ix.tocanTabla.has(id) ? { tocadaPor: ix.tocanTabla.get(id)!.map((t) => ({ verbo: t.verbo, quien: t.clave.includes("#") && !/#L\d/.test(t.clave) ? cita(ix, t.clave) : t.clave, ev: t.evidencia })) } : {}),
    tecnicas: afectados.filter((a) => a.tipo !== "feat"),
    avisos: [...(afectados.length ? [] : ["nada depende de esta pieza en el grafo"]), ...avisosIndice(ix)],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["tecnicas", "tocadaPor", "columnas", "funcionalidades"], p.budget_tokens);
}

// ------------------------------------------------------------------ riesgo de un cambio

export interface RiesgoParams {
  /** Diff unificado (`git diff`): de ahí salen los archivos y las líneas tocadas. */
  diff?: string;
  /** Archivos tocados, sin diff: `ruta` o `repo:ruta` (cuenta el archivo entero). */
  archivos?: string[];
  /** Repo al que pertenecen las rutas del diff; sin esto se busca la ruta en todos los repos indexados. */
  repo?: string;
  profundidad?: number;
  budget_tokens?: number | null;
}

/** Archivos y rangos de líneas nuevas de un diff unificado. Un archivo borrado cuenta entero (rango vacío = todo). */
export function archivosDeDiff(diff: string): Array<{ ruta: string; rangos: Array<[number, number]> }> {
  const out: Array<{ ruta: string; rangos: Array<[number, number]> }> = [];
  let actual: { ruta: string; rangos: Array<[number, number]> } | null = null;
  let vieja: string | null = null;
  for (const l of diff.split("\n")) {
    const a = /^--- (?:a\/)?(.+?)\s*$/.exec(l);
    if (a) {
      vieja = a[1] === "/dev/null" ? null : a[1]!;
      continue;
    }
    const b = /^\+\+\+ (?:b\/)?(.+?)\s*$/.exec(l);
    if (b) {
      const ruta = b[1] === "/dev/null" ? vieja : b[1]!;
      actual = ruta ? { ruta, rangos: [] } : null;
      if (actual) out.push(actual);
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h && actual) {
      const desde = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2]);
      // Un bloque que solo borra (n = 0) toca el punto donde estaba.
      actual.rangos.push([Math.max(1, desde), Math.max(1, desde + Math.max(n, 1) - 1)]);
    }
  }
  return out;
}

/**
 * Riesgo de un cambio: de las líneas tocadas a los símbolos, de ahí hacia arriba a quién los llama, y de ahí a los
 * endpoints, pantallas, funcionalidades, tablas, otros repos y equipos alcanzados. `nivel` mide alcance (cuánto se
 * ve afectado y cuán lejos), no la probabilidad de que el cambio esté mal; `motivos` dice de dónde sale.
 */
export function riesgo(ctx: Contexto, p: RiesgoParams) {
  const ix = indice(ctx);
  const prof = p.profundidad ?? 4;
  if (!Number.isInteger(prof) || prof < 1 || prof > 6) throw new ConsultaError("parametro_invalido", "profundidad debe estar entre 1 y 6");
  const entradas = [...(p.diff ? archivosDeDiff(p.diff) : []), ...(p.archivos ?? []).map((ruta) => ({ ruta, rangos: [] as Array<[number, number]> }))];
  if (!entradas.length) throw new ConsultaError("parametro_invalido", "riesgo necesita un diff o una lista de archivos");
  if (p.repo !== undefined && ctx.nodo.get(p.repo)?.tipo !== "repo") throw new ConsultaError("nodo_inexistente", `no existe el repo: ${p.repo}`);

  const todos = [...ix.estructura.keys()];
  const fuera: string[] = [], ambiguos: string[] = [];
  const tocados = new Set<string>(), archivos = new Set<string>(), sinSimbolo: string[] = [];
  for (const e of entradas) {
    const exacto = ix.estructura.has(e.ruta) ? [e.ruta] : p.repo ? (ix.estructura.has(`${p.repo}:${e.ruta}`) ? [`${p.repo}:${e.ruta}`] : []) : todos.filter((k) => k.endsWith(`:${e.ruta}`));
    if (!exacto.length) { fuera.push(e.ruta); continue; }
    if (exacto.length > 1) ambiguos.push(e.ruta);
    for (const archivo of exacto) {
      archivos.add(archivo);
      const simbolos = ix.estructura.get(archivo)!.simbolos.filter((s) => s.tipo === "metodo" || s.tipo === "funcion");
      const dentro = e.rangos.length ? simbolos.filter((s) => e.rangos.some(([a, b]) => s.linea <= b && a <= (s.fin ?? s.linea))) : simbolos;
      if (!dentro.length) sinSimbolo.push(archivo);
      for (const s of dentro) tocados.add(clave(archivo, s.nombre));
    }
  }

  // Hacia arriba: quién llama a lo tocado.
  const vistos = new Set(tocados);
  let frente = [...tocados], cortado = false;
  for (let nivel = 1; frente.length; nivel++) {
    if (nivel > prof) { cortado = true; break; }
    const sig: string[] = [];
    for (const k of frente) for (const l of ix.llamadores.get(k) ?? []) if (!vistos.has(l.clave)) { vistos.add(l.clave); sig.push(l.clave); }
    frente = sig;
  }
  const alcanzados = [...vistos].sort(cmp);
  const endpoints = [...new Set(alcanzados.flatMap((k) => ix.atiende.get(k) ?? []))].sort(cmp);
  // Pantallas: las que dibujan un componente alcanzado y las que llaman a un endpoint alcanzado.
  const pantallas = new Set<string>();
  for (const n of ctx.graph.nodes) {
    if (n.tipo !== "pantalla") continue;
    if (((n.atributos as { componentes?: string[] }).componentes ?? []).some((c) => vistos.has(c))) pantallas.add(n.id);
  }
  for (const e of ctx.graph.edges) if (e.verbo === "llama_a" && e.endpoint && endpoints.includes(e.endpoint) && ctx.nodo.get(e.desde)?.tipo === "pantalla") pantallas.add(e.desde);
  const feats = new Set<string>();
  for (const a of archivos) for (const f of dueñas(ix, a)) feats.add(f);
  for (const k of alcanzados) for (const f of dueñas(ix, partes(k).archivo)) feats.add(f);
  for (const e of ctx.graph.edges) if (e.verbo === "implementa" && (endpoints.includes(e.desde) || pantallas.has(e.desde)) && ctx.nodo.get(e.hasta)?.tipo === "feat") feats.add(e.hasta);
  // Tablas: las que tocan directamente los símbolos cambiados.
  const tablas = new Map<string, Set<string>>();
  for (const [tabla, quienes] of ix.tocanTabla) for (const q of quienes) if (tocados.has(q.clave)) tablas.set(tabla, (tablas.get(tabla) ?? new Set()).add(q.verbo));
  const repoDe = (k: string) => k.slice(0, k.indexOf(":"));
  const propios = new Set([...archivos].map(repoDe));
  const otrosRepos = [...new Set(endpoints.flatMap((ep) => (ix.llamanEndpoint.get(ep) ?? []).map((l) => repoDe(l.clave))))].filter((r) => !propios.has(r)).sort(cmp);
  const humano = contextoHumano(ctx, "", [...feats, ...endpoints, ...tablas.keys(), ...[...feats].flatMap((f) => (ctx.entrantes.get(f) ?? []).filter((e) => e.verbo === "implementa" && ctx.nodo.get(e.desde)?.tipo === "svc").map((e) => e.desde))]);

  const escribe = [...tablas.entries()].filter(([, v]) => v.has("escribe_en")).map(([t]) => t).sort(cmp);
  const motivos = [
    ...(otrosRepos.length ? [`lo consumen por HTTP otros repos: ${otrosRepos.join(", ")}`] : []),
    ...(feats.size >= 3 ? [`alcanza ${feats.size} funcionalidades`] : []),
    ...(escribe.length ? [`cambia código que escribe en ${escribe.join(", ")}`] : []),
    ...(endpoints.length ? [`alcanza ${endpoints.length} endpoint${endpoints.length > 1 ? "s" : ""}`] : []),
    ...(pantallas.size ? [`alcanza ${pantallas.size} pantalla${pantallas.size > 1 ? "s" : ""}`] : []),
    ...(feats.size > 0 && feats.size < 3 ? [`alcanza ${feats.size} funcionalidad${feats.size > 1 ? "es" : ""}`] : []),
  ];
  const nivel = otrosRepos.length || feats.size >= 3 || escribe.length ? "alto" : endpoints.length || pantallas.size || feats.size === 2 ? "medio" : "bajo";
  const res = {
    nivel,
    motivos,
    cambia: [...tocados].sort(cmp).map((k) => cita(ix, k)),
    funcionalidades: [...feats].sort(cmp),
    endpoints,
    pantallas: [...pantallas].sort(cmp),
    tablas: [...tablas.entries()].sort((a, b) => cmp(a[0], b[0])).map(([t, v]) => `${[...v].sort(cmp).join(" y ")} ${t}`),
    otrosRepos,
    ...humano,
    llamadores: alcanzados.filter((k) => !tocados.has(k)).map((k) => cita(ix, k)),
    avisos: [
      ...(fuera.length ? [`archivos fuera del índice (no se pudo medir su alcance): ${fuera.join(", ")}`] : []),
      ...(ambiguos.length ? [`ruta en varios repos, se tomaron todos (pasá repo): ${ambiguos.join(", ")}`] : []),
      ...(sinSimbolo.length ? [`cambios fuera de funciones y métodos (tipos, constantes, configuración): ${[...new Set(sinSimbolo)].sort(cmp).join(", ")}`] : []),
      ...(cortado ? [`hay más llamadores por encima de la profundidad ${prof}`] : []),
      ...sinResolverConNombre(ix, [...tocados]),
      ...avisosIndice(ix),
    ],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["llamadores", "cambia", "pantallas", "endpoints"], p.budget_tokens);
}

// ------------------------------------------------------------------ deriva de contratos

export interface DerivaParams {
  /** Servicio a revisar; sin esto, todos. */
  nodo?: string;
  budget_tokens?: number | null;
}

/**
 * Deriva entre lo que se llama y lo que se atiende: llamadas a rutas que ningún endpoint conocido atiende (o que
 * existen con otro método), llamadas que coinciden con varios endpoints, y endpoints que nadie llama. Lo último solo
 * dice algo si los consumidores del servicio están indexados: por eso se informa cuántos tiene cada servicio.
 */
export function deriva(ctx: Contexto, p: DerivaParams) {
  const ix = indice(ctx);
  if (p.nodo !== undefined && ctx.nodo.get(p.nodo)?.tipo !== "svc") throw new ConsultaError("nodo_inexistente", `no existe el servicio: ${p.nodo}`);
  const endpoints = ctx.graph.nodes.filter((n) => n.tipo === "endpoint");
  const svcDe = (ep: string) => ep.slice(0, ep.indexOf(":"));
  const llamados = new Set(ctx.graph.edges.filter((e) => e.verbo === "llama_a" && e.endpoint && e.estado !== "deprecado").map((e) => e.endpoint!));
  // Consumidores de cada servicio: otros servicios o pantallas que le llaman algún endpoint.
  const consumidores = new Map<string, Set<string>>();
  for (const e of ctx.graph.edges) {
    if (e.verbo !== "llama_a" || !e.endpoint || e.desde === e.hasta) continue;
    const quien = ctx.nodo.get(e.desde);
    if (quien?.tipo === "svc") consumidores.set(e.hasta, (consumidores.get(e.hasta) ?? new Set()).add(e.desde));
  }
  const svcs = (p.nodo ? [p.nodo] : [...new Set(endpoints.map((n) => svcDe(n.id)))]).sort(cmp);
  const sinLlamadas = endpoints
    .filter((n) => svcs.includes(svcDe(n.id)) && !llamados.has(n.id) && (consumidores.get(svcDe(n.id))?.size ?? 0) > 0)
    .map((n) => ({ endpoint: n.id, ev: String(n.atributos["evidencia"] ?? "") }));
  const rutaDe = (ref: string) => /^(\w+) (?:\$\{[^}]*\})?(\/\S*)$/.exec(ref);
  const pend = ix.llamadasPendientes.filter((l) => !p.nodo || l.desde === p.nodo || endpoints.some((n) => svcDe(n.id) === p.nodo && l.motivo.includes(String(n.atributos["ruta"]))));
  const sinEndpoint = pend
    .filter((l) => l.motivo.startsWith("base dinámica y ningún endpoint"))
    .map((l) => {
      const m = rutaDe(l.referencia);
      const otros = m ? endpoints.filter((n) => rutaCoincide(String(n.atributos["ruta"]), normalizarRuta(m[2]!)) && n.atributos["metodo"] !== m[1]).map((n) => n.id).sort(cmp) : [];
      return { desde: l.desde, llamada: l.referencia, ev: l.evidencia, ...(otros.length ? { existeConOtroMetodo: otros } : {}) };
    });
  const ambiguas = pend.filter((l) => l.motivo === "varios endpoints coinciden").map((l) => ({ desde: l.desde, llamada: l.referencia, ev: l.evidencia, candidatos: l.candidatos }));
  const sinAnalizar = pend.filter((l) => l.motivo === "URL sin ruta reconocible").length;
  const res = {
    ...(p.nodo ? { nodo: p.nodo } : {}),
    llamadasSinEndpoint: sinEndpoint,
    llamadasAmbiguas: ambiguas,
    endpointsSinLlamadasDetectadas: sinLlamadas,
    consumidoresIndexados: Object.fromEntries(svcs.map((s) => [s, [...(consumidores.get(s) ?? [])].sort(cmp)])),
    avisos: [
      ...svcs.filter((s) => !(consumidores.get(s)?.size ?? 0)).map((s) => `${s} no tiene consumidores indexados: no se puede decir qué endpoints suyos no se usan`),
      ...(sinAnalizar ? [`${sinAnalizar} llamadas con URL armada en tiempo de ejecución no se pudieron analizar: alguna puede ser la que usa un endpoint listado como sin llamadas`] : []),
      ...avisosIndice(ix),
    ],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["endpointsSinLlamadasDetectadas", "llamadasAmbiguas", "llamadasSinEndpoint"], p.budget_tokens);
}

// ------------------------------------------------------------------ paridad entre dos servicios

export interface ParidadParams {
  /** Servicio de origen (el que se reemplaza) y de destino (el que lo reemplaza). */
  viejo: string;
  nuevo: string;
  budget_tokens?: number | null;
}

/**
 * Paridad de una migración: compara dos servicios por lo que exponen (endpoints o pantallas) y por las tablas que
 * toca cada pieza. Empareja por método y ruta sin importar el nombre de los parámetros; si un lado lleva un prefijo
 * fijo que el otro no (`/api`), lo descuenta. No compara comportamiento: dice qué falta y dónde difieren los datos.
 */
export function paridad(ctx: Contexto, p: ParidadParams) {
  for (const id of [p.viejo, p.nuevo]) if (ctx.nodo.get(id)?.tipo !== "svc") throw new ConsultaError("nodo_inexistente", `no existe el servicio: ${id}`);
  const forma = (ruta: string) => ruta.replace(/\{[^}]*\}/g, "{}").toLowerCase();
  const piezas = (svc: string, tipo: "endpoint" | "pantalla") =>
    (ctx.salientes.get(svc) ?? [])
      .filter((e) => e.verbo === "contiene" && ctx.nodo.get(e.hasta)?.tipo === tipo)
      .map((e) => {
        const a = ctx.nodo.get(e.hasta)!.atributos as { metodo?: string; ruta: string };
        return { id: e.hasta, metodo: a.metodo ?? "", ruta: forma(a.ruta) };
      });
  const tablasDe = (id: string) => (ctx.salientes.get(id) ?? []).filter((e) => e.verbo === "lee_de" || e.verbo === "escribe_en").map((e) => `${e.verbo} ${e.hasta}`);
  const comparar = (tipo: "endpoint" | "pantalla") => {
    const v = piezas(p.viejo, tipo), n = piezas(p.nuevo, tipo);
    // Prefijo fijo de un lado (`/api`): el primer segmento que comparten todas sus rutas. Se descuenta solo si así
    // coinciden más piezas que sin descontar nada.
    const comun = (xs: typeof v) => {
      const primero = new Set(xs.map((x) => x.ruta.split("/")[1] ?? ""));
      const unico = primero.size === 1 ? [...primero][0]! : "";
      return unico && !unico.startsWith("{") ? `/${unico}` : "";
    };
    const clave = (x: (typeof v)[number], pre: string) => `${x.metodo} ${pre && (x.ruta === pre || x.ruta.startsWith(`${pre}/`)) ? x.ruta.slice(pre.length) || "/" : x.ruta}`;
    const coinciden = (a: string, b: string) => {
      const claves = new Set(n.map((x) => clave(x, b)));
      return v.filter((x) => claves.has(clave(x, a))).length;
    };
    const [pv, pn] = ([["", ""], ["", comun(n)], [comun(v), ""]] as Array<[string, string]>).reduce((mejor, c) => (coinciden(...c) > coinciden(...mejor) ? c : mejor));
    const enNuevo = new Map(n.map((x) => [clave(x, pn), x.id]));
    const enViejo = new Map(v.map((x) => [clave(x, pv), x.id]));
    const iguales = v.filter((x) => enNuevo.has(clave(x, pv))).map((x) => ({ viejo: x.id, nuevo: enNuevo.get(clave(x, pv))! }));
    const difieren = iguales.flatMap((par) => {
      const a = new Set(tablasDe(par.viejo)), b = new Set(tablasDe(par.nuevo));
      const soloViejo = [...a].filter((t) => !b.has(t)).sort(cmp), soloNuevo = [...b].filter((t) => !a.has(t)).sort(cmp);
      return soloViejo.length || soloNuevo.length ? [{ ...par, soloViejo, soloNuevo }] : [];
    });
    return {
      total: { viejo: v.length, nuevo: n.length, migrados: iguales.length },
      faltan: v.filter((x) => !enNuevo.has(clave(x, pv))).map((x) => x.id).sort(cmp),
      soloEnNuevo: n.filter((x) => !enViejo.has(clave(x, pn))).map((x) => x.id).sort(cmp),
      difierenEnTablas: difieren,
    };
  };
  const tablasSvc = (svc: string) => new Set([svc, ...piezas(svc, "endpoint").map((x) => x.id)].flatMap((id) => (ctx.salientes.get(id) ?? []).filter((e) => e.verbo === "lee_de" || e.verbo === "escribe_en").map((e) => e.hasta)));
  const tv = tablasSvc(p.viejo), tn = tablasSvc(p.nuevo);
  const endpoints = comparar("endpoint"), pantallas = comparar("pantalla");
  const res = {
    viejo: p.viejo,
    nuevo: p.nuevo,
    endpoints,
    pantallas,
    tablasSinMigrar: [...tv].filter((t) => !tn.has(t)).sort(cmp),
    avisos: [
      ...(endpoints.total.viejo + pantallas.total.viejo === 0 ? [`${p.viejo} no tiene endpoints ni pantallas indexados`] : []),
      ...(endpoints.total.nuevo + pantallas.total.nuevo === 0 ? [`${p.nuevo} no tiene endpoints ni pantallas indexados`] : []),
      "se emparejó por método y ruta: una pieza renombrada figura como faltante de un lado y nueva del otro",
    ],
  };
  // Recorte por presupuesto: primero lo nuevo, después las diferencias, al final lo que falta (lo que más importa).
  const b = p.budget_tokens === undefined ? 2000 : p.budget_tokens;
  let omitidos = 0;
  const listas: unknown[][] = [pantallas.soloEnNuevo, endpoints.soloEnNuevo, pantallas.difierenEnTablas, endpoints.difierenEnTablas, res.tablasSinMigrar, pantallas.faltan, endpoints.faltan];
  for (const l of listas) while (b !== null && l.length && tokens({ ...res, truncado: true, omitidos: omitidos + 1 }) > b) { l.pop(); omitidos++; }
  return omitidos ? { ...res, truncado: true as const, omitidos } : res;
}

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
import { dependenciasDelGrafo, dependeDe as recorrerDependencias, impacto as recorrerImpacto, type Dependencia } from "../impacto.js";
import { dentroDe, ENDPOINT_REF, normalizarRuta, SIN_LLAMADOR, type Graph, type GraphNode } from "../schema.js";
import { notasDe, type Contexto } from "./contexto.js";
import { ConsultaError, normalizar, rutaCoincide } from "./herramientas.js";
import { pantallaDeRuta, raicesDePantalla } from "../pantallas.js";
import { tokens } from "./proyeccion.js";

/**
 * Consultas sobre el código y el producto, pensadas para un agente: respuestas cortas, con `repo:ruta#Ln` en cada
 * dato, y explícitas sobre lo que no saben (`avisos`) y sobre de qué versión del código salieron (`indice`).
 * Se apoyan en `_build/features.json`, `_build/files/*.json` (símbolos, imports, invocaciones) y
 * `_build/extraction/*.json` (accesos a tablas y llamadas con su línea).
 */

export interface IndiceCodigo {
  fichas: Map<string, Ficha>;
  dependencias: Dependencia[];
  estructura: Map<string, EstructuraArchivo>;
  recorredor: Recorredor;
  /** repo → commit de HEAD al indexar. */
  commits: Record<string, string>;
  /** repo → ruta del clon relativa al brain (de `_build/files`). */
  raices: Record<string, string>;
  /** repo → HEAD actual del clon, leído al consultar (`actualizarHeads`); ausente si no se pudo leer. */
  actuales: Record<string, string>;
  /** `repo:ruta#Simbolo` → quién lo llama, con la línea de la llamada. */
  llamadores: Map<string, Array<{ clave: string; linea: number; via?: string | undefined }>>;
  /** `repo:ruta#Tipo` (tipo, interfaz, enum, clase o constante) → símbolos que lo nombran, con la línea. */
  usan: Map<string, Array<{ clave: string; linea: number }>>;
  /** Repos cuyo índice no trae `referencias` (indexado antes de registrarlas, o un parser que no las sigue). */
  sinReferencias: Set<string>;
  /** Nombre de símbolo → claves `repo:ruta#Simbolo`. */
  porNombre: Map<string, string[]>;
  /** `repo:ruta#Simbolo` → endpoints que atiende. */
  atiende: Map<string, string[]>;
  /** Endpoint → métodos que lo llaman por HTTP (de cualquier repo), con su evidencia. */
  llamanEndpoint: Map<string, Array<{ clave: string; evidencia: string }>>;
  /** Tabla → métodos que la leen o escriben, con su evidencia. */
  tocanTabla: Map<string, Array<{ clave: string; verbo: string; evidencia: string }>>;
  /** Accesos a tablas del índice, y cuántos dicen qué columnas leen o escriben. */
  accesos: { total: number; conColumnas: number };
  /** Llamadas HTTP que el índice no pudo unir a un endpoint (`pendientes` de la extracción). */
  llamadasPendientes: Array<{ desde: string; referencia: string; motivo: string; evidencia: string; candidatos: number; llamada?: { metodo: string; ruta: string | null; base: string } }>;
  /** Archivo (`repo:ruta`) → cuánto de lo que el índice vio ahí quedó unido: lo usa `fidelidad`. */
  porArchivo: Map<string, DatosArchivo>;
  /** Llamadas HTTP unidas a un endpoint de este brain, una por evidencia. */
  llamadasUnidas: Array<{ desde: string; endpoint: string; evidencia: string }>;
  /** Evidencia de una llamada → lo que manda y espera, campo por campo (`campos` de la extracción). */
  camposDeLlamada: Map<string, CamposDeLlamada>;
  /** Repos cuya extracción no trae `campos` (indexados antes de registrarlos). */
  sinCampos: Set<string>;
}

/** Un lado de una llamada: el tipo con que la nombra el código y sus campos de primer nivel, si es un objeto. */
export interface LadoDeLlamada {
  tipo: string;
  forma?: Record<string, string>;
}

/** Lo que una llamada manda (`envia`), pasa por query (`query`) y espera de la respuesta (`espera`). */
export interface CamposDeLlamada {
  envia?: LadoDeLlamada;
  query?: LadoDeLlamada;
  espera?: LadoDeLlamada;
}

/** Lo que sale de un archivo según la extracción: llamadas a otros servicios y accesos a tablas. */
export interface DatosArchivo {
  /** Llamadas unidas a un servicio, externo o endpoint. */
  llamadas: number;
  /** Accesos a tablas con página, y cuántos dicen qué columnas tocan. */
  accesos: number;
  conColumnas: number;
  /** Accesos a tablas que no tienen página en el brain, con su línea. */
  sinPagina: Array<{ tabla: string; linea: number }>;
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
  const sinReferencias = new Set<string>();
  for (const c of archivos) {
    try {
      const j = JSON.parse(c) as { repo: string; commit?: string; raiz?: string; archivos: Array<{ ruta: string } & Partial<EstructuraArchivo>> };
      if (j.commit) commits[j.repo] = j.commit;
      if (j.raiz) raices[j.repo] = j.raiz;
      for (const a of j.archivos ?? []) estructura.set(`${j.repo}:${a.ruta}`, { simbolos: a.simbolos ?? [], importa: a.importa ?? [], invoca: a.invoca ?? [], sinResolver: a.sinResolver, ...(a.referencias ? { referencias: a.referencias } : {}), ...(a.casos ? { casos: a.casos } : {}) });
      if (!(j.archivos ?? []).some((a) => a.referencias)) sinReferencias.add(j.repo);
    } catch {
      /* ignorado */
    }
  }
  const aristas = aristasDeExtracciones(extracciones);
  const sinPagina = tablasSinPagina(extracciones);
  const recorredor = crearRecorredor(graph, estructura, aristas, sinPagina, LIMITES_AGENTE);
  const llamadores = new Map<string, Array<{ clave: string; linea: number; via?: string | undefined }>>();
  const porNombre = new Map<string, string[]>();
  const usan = new Map<string, Array<{ clave: string; linea: number }>>();
  for (const [archivo, e] of [...estructura.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const repo = archivo.slice(0, archivo.indexOf(":"));
    for (const s of e.simbolos) porNombre.set(s.nombre, [...(porNombre.get(s.nombre) ?? []), clave(archivo, s.nombre)]);
    for (const i of e.invoca) {
      const destino = clave(`${repo}:${i.archivo}`, i.simbolo);
      llamadores.set(destino, [...(llamadores.get(destino) ?? []), { clave: clave(archivo, i.desde), linea: i.linea, ...(i.via ? { via: i.via } : {}) }]);
    }
    for (const r of e.referencias ?? []) {
      const destino = clave(`${repo}:${r.archivo}`, r.simbolo);
      usan.set(destino, [...(usan.get(destino) ?? []), { clave: clave(archivo, r.desde), linea: r.linea }]);
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
  const accesos = { total: 0, conColumnas: 0 };
  const porArchivo = new Map<string, DatosArchivo>();
  const delArchivo = (evidencia: string) => {
    const m = /^([^#]+)#L(\d+)/.exec(evidencia);
    if (!m) return null;
    const d = porArchivo.get(m[1]!) ?? porArchivo.set(m[1]!, { llamadas: 0, accesos: 0, conColumnas: 0, sinPagina: [] }).get(m[1]!)!;
    return { d, linea: Number(m[2]) };
  };
  for (const s of sinPagina) delArchivo(s.evidencia)?.d.sinPagina.push({ tabla: s.tabla, linea: delArchivo(s.evidencia)!.linea });
  for (const a of aristas) {
    const da = delArchivo(a.evidencia)?.d;
    if (a.verbo === "lee_de" || a.verbo === "escribe_en") {
      accesos.total++;
      if (a.columnas?.length) accesos.conColumnas++;
      if (da) {
        da.accesos++;
        if (a.columnas?.length) da.conColumnas++;
      }
    } else if (a.verbo === "llama_a" && da) da.llamadas++;
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
  const camposDeLlamada = new Map<string, CamposDeLlamada>();
  const sinCampos = new Set<string>();
  for (const c of extracciones) {
    try {
      const j = JSON.parse(c) as { repo?: string; campos?: Record<string, CamposDeLlamada>; pendientes?: Array<{ verbo: string; desde: string; referencia: string; motivo: string; evidencia: string; candidatos?: unknown[]; llamada?: { metodo: string; ruta: string | null; base: string } }> };
      for (const p of j.pendientes ?? []) if (p.verbo === "llama_a") llamadasPendientes.push({ desde: p.desde, referencia: p.referencia, motivo: p.motivo, evidencia: p.evidencia, candidatos: p.candidatos?.length ?? 0, ...(p.llamada ? { llamada: p.llamada } : {}) });
      if (j.campos) for (const [ev, k] of Object.entries(j.campos)) camposDeLlamada.set(ev, k);
      else if (j.repo) sinCampos.add(j.repo);
    } catch {
      /* ignorado */
    }
  }
  const unidas = new Map<string, { desde: string; endpoint: string; evidencia: string }>();
  for (const a of aristas) if (a.verbo === "llama_a" && a.endpoint && !unidas.has(a.evidencia)) unidas.set(a.evidencia, { desde: a.desde, endpoint: a.endpoint, evidencia: a.evidencia });
  const llamadasUnidas = [...unidas.values()].sort((a, b) => cmp(a.evidencia, b.evidencia));
  llamadasPendientes.sort((a, b) => cmp(a.evidencia, b.evidencia) || cmp(a.referencia, b.referencia));
  return { fichas: new Map(fichas.map((f) => [f.id, f])), dependencias: dependenciasDelGrafo(graph, fichas), estructura, recorredor, commits, raices, actuales: {}, llamadores, usan, sinReferencias, porNombre, atiende, accesos, llamanEndpoint, tocanTabla, llamadasPendientes, porArchivo, llamadasUnidas, camposDeLlamada, sinCampos };
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
export function ajustarLista<T extends Record<string, unknown>>(r: T, campos: (keyof T & string) | Array<keyof T & string>, budget: number | null | undefined): T & { truncado?: true; omitidos?: number } {
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
    for (const s of ix.estructura.get(archivo)?.sinResolver ?? []) if (s.desde === p.simbolo) out.push(`llamada sin resolver en ${p.simbolo}: ${s.llamada} (${archivo}#L${s.linea})${s.motivo ? `: ${s.motivo}` : "; el recorrido puede seguir por ahí"}`);
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
    // Cuánto está probada: archivos de test y casos, con los primeros nombres de cada uno. Un build viejo no los trae.
    tests: {
      archivos: (f.tests ?? []).length,
      casos: (f.tests ?? []).reduce((n, t) => n + t.casos.length, 0),
      lista: [...(f.tests ?? [])].sort((a, b) => b.casos.length - a.casos.length || cmp(a.archivo, b.archivo)).map((t) => ({ archivo: t.archivo, casos: t.casos.length, por: t.por, ejemplos: t.casos.slice(0, 5).map((c) => `${c.nombre} (L${c.linea})`) })),
    },
    // Requisitos declarados en su página: `especificaciones(funcionalidad)` da el detalle.
    especificaciones: resumenDeEspecificaciones(f),
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

// ------------------------------------------------------------------ especificaciones

export interface EspecificacionesParams {
  /** id, sufijo o nombre de una funcionalidad. Sin ella: el resumen de todas. */
  funcionalidad?: string;
  estado?: string;
  tipo?: string;
  /** Solo las que no tienen ningún caso de test que las verifique. */
  sin_test?: boolean;
  /** Solo los casos de uso que una persona marcó como mal (`problema`). */
  con_problema?: boolean;
  budget_tokens?: number | null;
}

/**
 * Estado de un caso de uso según sus especificaciones: `cumplido` si todas tienen un archivo que las cumple y algún
 * caso de test que las verifica (o una persona decidió probarla a mano: `manual`); `sin_test` si alguna no tiene test; `sin_codigo` si alguna no declara archivo;
 * `sin_reglas` si el caso no tiene ninguna especificación.
 */
export type EstadoDeCaso = "cumplido" | "sin_test" | "sin_codigo" | "sin_reglas";
/** Sin test que la verifique y sin que nadie haya decidido probarla a mano. */
const sinVerificar = (e: { tests: unknown[]; manual?: string }) => !e.tests.length && !e.manual;
export function estadoDeCaso(es: Array<{ archivos: string[]; tests: unknown[]; manual?: string }>): EstadoDeCaso {
  if (!es.length) return "sin_reglas";
  if (es.some((e) => !e.archivos.length)) return "sin_codigo";
  if (es.some(sinVerificar)) return "sin_test";
  return "cumplido";
}

/** Casos de uso de una ficha con su estado, y las especificaciones que no están en ningún caso. */
function casosDeFicha(f: Ficha) {
  const es = f.especificaciones ?? [];
  const porId = new Map(es.map((e) => [e.id, e]));
  const usadas = new Set<string>();
  const casos = (f.casos ?? []).map((c) => {
    const suyas = c.especificaciones.map((id) => porId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
    suyas.forEach((e) => usadas.add(e.id));
    return { ...c, estado: estadoDeCaso(suyas), suyas };
  });
  return { casos, sinCaso: es.filter((e) => !usadas.has(e.id)) };
}

/** Casos de test de la funcionalidad que ninguna especificación nombra (ni por caso ni por archivo entero). */
function casosSinEspecificacion(f: Ficha) {
  const enteros = new Set<string>();
  const nombrados = new Set<string>();
  for (const e of f.especificaciones ?? []) for (const t of e.tests) t.linea === undefined ? enteros.add(t.archivo) : nombrados.add(`${t.archivo}#${t.linea}`);
  return (f.tests ?? []).flatMap((t) => (enteros.has(t.archivo) ? [] : t.casos.filter((c) => !nombrados.has(`${t.archivo}#${c.linea}`)).map((c) => ({ archivo: t.archivo, caso: c.nombre, linea: c.linea }))));
}

function resumenDeEspecificaciones(f: Ficha) {
  const es = f.especificaciones ?? [];
  const { casos, sinCaso } = casosDeFicha(f);
  return {
    casosDeUso: casos.length,
    casosCumplidos: casos.filter((c) => c.estado === "cumplido").length,
    ...(casos.some((c) => c.problema) ? { casosConProblema: casos.filter((c) => c.problema).length } : {}),
    ...(sinCaso.length ? { especificacionesSinCaso: sinCaso.length } : {}),
    total: es.length,
    confirmadas: es.filter((e) => e.estado === "confirmada").length,
    sinTest: es.filter((e) => sinVerificar(e)).length,
    ...(es.some((e) => e.rotos.length) ? { conReferenciasRotas: es.filter((e) => e.rotos.length).length } : {}),
  };
}

const COMO_COMPLETAR = "Las especificaciones se escriben en `especificaciones` de la página de la funcionalidad (product/feat-*.md). La guía para deducirlas del código y de los tests: `flowbrain specs --guide`.";
const COMO_AGRUPAR = "Hay especificaciones que no están en ningún caso de uso: agrupalas en `casos` de la página (nombre de lo que alguien hace, quién, y los ids de sus especificaciones). La guía: `flowbrain specs --guide`.";
const COMO_CORREGIR = "Una persona marcó casos de uso como mal (`problema`): corregí el caso o sus especificaciones según lo que dice y borrá `problema` de la página.";

/**
 * Requisitos de negocio y de producto de cada funcionalidad: qué tiene que cumplirse, qué archivos lo cumplen y qué
 * casos de test lo verifican. Los declara la página de la funcionalidad; acá se cruzan con el índice.
 */
export function especificaciones(ctx: Contexto, p: EspecificacionesParams = {}) {
  const ix = indice(ctx);
  if (p.estado && p.estado !== "propuesta" && p.estado !== "confirmada") throw new ConsultaError("parametro_invalido", `estado desconocido: ${p.estado}. Los que hay: propuesta, confirmada`);
  if (p.tipo && p.tipo !== "negocio" && p.tipo !== "producto") throw new ConsultaError("parametro_invalido", `tipo desconocido: ${p.tipo}. Los que hay: negocio, producto`);
  const pasa = (e: NonNullable<Ficha["especificaciones"]>[number]) => (!p.estado || e.estado === p.estado) && (!p.tipo || e.tipo === p.tipo) && (!p.sin_test || sinVerificar(e));

  if (!p.funcionalidad) {
    const fichas = [...ix.fichas.values()];
    const filas = fichas
      .map((f) => {
        const es = (f.especificaciones ?? []).filter(pasa);
        const casos = (f.tests ?? []).reduce((n, t) => n + t.casos.length, 0);
        const cu = casosDeFicha(f);
        return { id: f.id, nombre: nombre(ctx, f.id), casosDeUso: cu.casos.length, casosCumplidos: cu.casos.filter((c) => c.estado === "cumplido").length, ...(cu.casos.some((c) => c.problema) ? { casosConProblema: cu.casos.filter((c) => c.problema).length } : {}), especificacionesSinCaso: cu.sinCaso.length, especificaciones: es.length, confirmadas: es.filter((e) => e.estado === "confirmada").length, sinTest: es.filter((e) => sinVerificar(e)).length, casosDeTest: casos, casosSinEspecificacion: casosSinEspecificacion(f).length };
      })
      .filter((x) => !p.con_problema || x.casosConProblema)
      .sort((a, b) => b.especificaciones - a.especificaciones || b.casosDeTest - a.casosDeTest || cmp(a.id, b.id));
    const todas = fichas.flatMap((f) => (f.especificaciones ?? []).filter(pasa));
    const todosCasos = fichas.flatMap((f) => casosDeFicha(f).casos);
    const sinCaso = fichas.reduce((n, f) => n + casosDeFicha(f).sinCaso.length, 0);
    const res = {
      herramienta: "especificaciones",
      casosDeUso: todosCasos.length,
      casosCumplidos: todosCasos.filter((c) => c.estado === "cumplido").length,
      casosSinTest: todosCasos.filter((c) => c.estado === "sin_test").length,
      casosConProblema: todosCasos.filter((c) => c.problema).length,
      especificacionesSinCaso: sinCaso,
      total: todas.length,
      confirmadas: todas.filter((e) => e.estado === "confirmada").length,
      propuestas: todas.filter((e) => e.estado === "propuesta").length,
      sinTest: todas.filter((e) => sinVerificar(e)).length,
      conReferenciasRotas: todas.filter((e) => e.rotos.length).length,
      funcionalidadesSinEspecificaciones: fichas.filter((f) => !(f.especificaciones ?? []).length).length,
      funcionalidades: filas,
      avisos: [
        ...(fichas.length === 0 ? ["no hay funcionalidades: primero `flowbrain feature --guide`"] : []),
        ...(todas.length === 0 && fichas.length ? [COMO_COMPLETAR] : []),
        ...(sinCaso ? [COMO_AGRUPAR] : []),
        ...(todosCasos.some((c) => c.problema) ? [COMO_CORREGIR] : []),
        ...avisosIndice(ix),
      ],
    };
    return ajustarLista(res, "funcionalidades", p.budget_tokens);
  }

  const f = resolverFeat(ctx, ix, p.funcionalidad);
  const sueltos = casosSinEspecificacion(f);
  const cu = casosDeFicha(f);
  const casoDe = new Map<string, string>();
  cu.casos.forEach((c) => c.suyas.forEach((e) => casoDe.set(e.id, c.id)));
  const lista = (f.especificaciones ?? []).filter(pasa).map((e) => ({
    id: e.id,
    texto: e.texto,
    tipo: e.tipo,
    estado: e.estado,
    ...(casoDe.has(e.id) ? { caso: casoDe.get(e.id)! } : {}),
    archivos: e.archivos,
    tests: e.tests.map((t) => (t.caso ? `${t.archivo}::${t.caso}${t.linea ? ` (L${t.linea})` : ""}` : `${t.archivo} (${t.casos ?? "?"} casos)`)),
    ...(sinVerificar(e) ? { sinTest: true as const } : {}),
    ...(e.manual ? { manual: e.manual } : {}),
    ...(e.rotos.length ? { rotos: e.rotos } : {}),
  }));
  const res = {
    herramienta: "especificaciones",
    funcionalidad: f.id,
    nombre: nombre(ctx, f.id),
    ...resumenDeEspecificaciones(f),
    // Qué puede hacer alguien con la funcionalidad. El mismo `id` en otro cerebro es el mismo caso, del otro lado.
    casos: cu.casos
      .filter((c) => !p.con_problema || c.problema)
      .map((c) => ({ id: c.id, nombre: c.nombre, ...(c.quien ? { quien: c.quien } : {}), estado: c.estado, especificaciones: c.suyas.map((e) => e.id), ...(c.problema ? { problema: c.problema } : {}) })),
    ...(cu.sinCaso.length ? { especificacionesSinCaso: cu.sinCaso.map((e) => e.id) } : {}),
    especificaciones: lista,
    // Casos de test que no verifican ninguna especificación declarada: o falta escribirla, o falta unirlos.
    casosSinEspecificacion: { total: sueltos.length, lista: sueltos.slice(0, 40).map((c) => `${c.archivo}::${c.caso} (L${c.linea})`) },
    avisos: [
      ...((f.especificaciones ?? []).length === 0 ? [COMO_COMPLETAR] : []),
      ...(cu.sinCaso.length ? [COMO_AGRUPAR] : []),
      ...(cu.casos.some((c) => c.problema) ? [COMO_CORREGIR] : []),
      ...((f.especificaciones ?? []).some((e) => e.rotos.length) ? ["hay referencias que el índice ya no encuentra (`rotos`): un archivo movido o un caso renombrado; corregilas en la página"] : []),
      ...avisosIndice(ix),
    ],
    indice: versiones(ix),
  };
  return ajustarLista(res, "especificaciones", p.budget_tokens);
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
  pendiente?: string;
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
  const explicita = /^pantalla\s+(\/.*)$/i.exec(ref.trim());
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
  // Con varios componentes (la misma ruta declarada dos veces) se recorren todos, y también lo que la envuelve: lo que
  // hace un layout al abrirse lo hace cada pantalla de adentro.
  // Una envoltura que no toca nada (un marco de diseño) no suma pasos.
  const envolturas: string[] = [];
  for (const c of [...raicesDePantalla(a).filter((c) => !a.componentes.includes(c)), ...a.componentes]) {
    const { archivo, simbolo } = partes(c);
    const r = ix.recorredor.desdeSimbolo(archivo, simbolo);
    const propio = a.componentes.includes(c);
    if (!propio && !r.pasos.some((x) => x.toca.length)) continue;
    if (!propio) envolturas.push(c);
    pasos.push(...r.pasos.map((x) => paso(ix, x)));
    truncado ||= r.truncado;
  }
  const avisos = [
    ...(a.componentes.length > 1 ? [`la ruta ${a.ruta} se declara ${a.componentes.length} veces: se recorren todos sus componentes`] : []),
    ...(a.componentes.length === 0 ? ["no se encontró el componente de la pantalla"] : []),
    ...(envolturas.length ? [`el recorrido incluye lo que hacen sus layouts y guardas (${envolturas.map((c) => partes(c).simbolo).join(", ")}): sus llamadas son de la pantalla`] : []),
    ...(a.pendiente ? [`ruta sin resolver: ${a.pendiente}`] : []),
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
    // Componentes de una librería del cerebro (un sistema de diseño) que dibuja.
    ...(() => {
      const usa = ctx.graph.edges.filter((e) => e.verbo === "usa" && e.desde === n.id && ctx.nodo.get(e.hasta)?.tipo === "componente");
      return usa.length ? { usaComponentes: usa.map((e) => ({ componente: e.hasta, paquete: String(ctx.nodo.get(e.hasta)!.atributos["paquete"] ?? ""), ev: e.evidencia })) } : {};
    })(),
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

const VERBO: Record<string, string> = { usa: "usa", escribe_en: "escribe en", lee_de: "lee", llama_a: "llama a", implementa: "está implementada por", vive_en: "vive en", publica_en: "publica en", consume_de: "consume de", depende_de: "depende de", alimenta: "recibe mensajes de" };

export interface InfraParams {
  /** Servicio, repo, base, cola, externo o endpoint. Sin nodo: toda la infraestructura del brain. */
  nodo?: string;
  /** Filtra por texto: una variable de entorno, un puerto, una imagen, un paso de pipeline, una ruta. */
  texto?: string;
  budget_tokens?: number | null;
}

/**
 * Infraestructura declarada en los repos: imágenes, servicios de compose, pipelines de CI, variables de entorno
 * (solo nombres), rutas de proxy, manifiestos de Kubernetes, charts de Helm, Terraform y funciones serverless, cada
 * una con su archivo. Para un servicio suma lo del repo donde vive; para un repo, lo de sus servicios; para un
 * endpoint, lo que llega a él (una ruta de Ingress, un evento http, un `route_key`). No necesita índice de código.
 */
export function infra(ctx: Contexto, p: InfraParams) {
  type Item = { clase: string; nombre: string; detalle: string[]; evidencia: string; endpoints?: string[]; endpointsTotal?: number; atiende?: { simbolo: string; evidencia: string } };
  let ids: string[];
  const esEndpoint = p.nodo !== undefined && ctx.nodo.get(p.nodo)?.tipo === "endpoint";
  if (p.nodo !== undefined) {
    if (!ctx.nodo.has(p.nodo)) throw new ConsultaError("nodo_inexistente", `no existe el nodo: ${p.nodo}`);
    const vive = (verboDesde: "salientes" | "entrantes") => (ctx[verboDesde].get(p.nodo!) ?? []).filter((e) => e.verbo === "vive_en").map((e) => (verboDesde === "salientes" ? e.hasta : e.desde));
    ids = esEndpoint ? ctx.graph.nodes.map((n) => n.id) : [p.nodo, ...vive("salientes"), ...vive("entrantes")];
  } else ids = ctx.graph.nodes.map((n) => n.id);
  const q = p.texto ? normalizar(p.texto) : "";
  const items = [...new Set(ids)].sort(cmp).flatMap((id) =>
    ((ctx.nodo.get(id)?.atributos["infra"] as Item[] | undefined) ?? [])
      .filter((it) => !esEndpoint || (it.endpoints ?? []).includes(p.nodo!))
      .filter((it) => !q || [it.clase, it.nombre, ...it.detalle, ...(it.endpoints ?? []), it.atiende?.simbolo ?? ""].some((t) => normalizar(t).includes(q)))
      .map((it) => ({
        de: id,
        clase: it.clase,
        nombre: it.nombre,
        detalle: q ? it.detalle.filter((t) => normalizar(t).includes(q) || normalizar(it.nombre).includes(q) || it.clase === q) : it.detalle,
        ev: it.evidencia,
        ...(it.endpoints ? { endpoints: it.endpoints } : {}),
        ...(it.endpointsTotal ? { endpointsTotal: it.endpointsTotal } : {}),
        ...(it.atiende ? { atiende: it.atiende } : {}),
      })),
  );
  const res = {
    ...(p.nodo !== undefined ? { nodo: p.nodo } : {}),
    ...(p.texto ? { texto: p.texto } : {}),
    total: items.length,
    items,
    avisos: items.length
      ? []
      : [
          esEndpoint
            ? "ninguna ruta de Ingress, evento http ni route_key declarados en los repos llega a este endpoint"
            : ctx.graph.nodes.some((n) => n.atributos["infra"])
              ? "nada coincide: no hay infraestructura declarada para eso en los repos indexados"
              : "el brain no tiene infraestructura indexada (corré flowbrain index y flowbrain compile)",
        ],
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

const VERBO_IDA: Record<string, string> = { usa: "usa", escribe_en: "escribe en", lee_de: "lee", llama_a: "llama a", implementa: "se apoya en", vive_en: "vive en", publica_en: "publica en", consume_de: "consume de", depende_de: "depende de", alimenta: "recibe mensajes de" };

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
  // La otra dirección: de qué depende la pieza (si cambia algo de esto, la afecta a ella).
  const ida = recorrerDependencias(ix.dependencias, id, (n) => ctx.nodo.get(n)?.tipo);
  const infoIda = new Map<string, { via: string; verbo: string }>();
  for (const nv of ida) for (const x of nv) infoIda.set(x.id, x);
  const porqueIda = (x: string) => {
    const out: string[] = [];
    for (let c = infoIda.get(x); c; c = infoIda.get(c.via)) out.unshift(`${c.via} ${VERBO_IDA[c.verbo] ?? c.verbo}`);
    return out.join(", que ") + ` ${x}`;
  };
  const dependeDe = ida.flatMap((nv, i) => nv.map((x) => ({ nivel: i + 1, id: x.id, tipo: ctx.nodo.get(x.id)?.tipo ?? "", porque: porqueIda(x.id) })));
  const res = {
    pieza: id,
    tipo: ctx.nodo.get(id)?.tipo ?? "",
    funcionalidades: afectados.filter((a) => a.tipo === "feat"),
    ...(columnasDe(ctx, id) ? { columnas: columnasDe(ctx, id) } : {}),
    ...contextoHumano(ctx, id, afectados.map((a) => a.id)),
    ...(ix.tocanTabla.has(id) ? { tocadaPor: ix.tocanTabla.get(id)!.map((t) => ({ verbo: t.verbo, quien: t.clave.includes("#") && !/#L\d/.test(t.clave) ? cita(ix, t.clave) : t.clave, ev: t.evidencia })) } : {}),
    tecnicas: afectados.filter((a) => a.tipo !== "feat"),
    dependeDe,
    avisos: [...(afectados.length ? [] : [`nada depende de esta pieza en el grafo${dependeDe.length ? "; en `dependeDe` está lo que, si cambia, la afecta a ella" : ""}`]), ...avisosIndice(ix)],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["dependeDe", "tecnicas", "tocadaPor", "columnas", "funcionalidades"], p.budget_tokens);
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
  const tocados = new Set<string>(), nombrados = new Set<string>(), archivos = new Set<string>(), sinSimbolo: string[] = [];
  for (const e of entradas) {
    const exacto = ix.estructura.has(e.ruta) ? [e.ruta] : p.repo ? (ix.estructura.has(`${p.repo}:${e.ruta}`) ? [`${p.repo}:${e.ruta}`] : []) : todos.filter((k) => k.endsWith(`:${e.ruta}`));
    if (!exacto.length) { fuera.push(e.ruta); continue; }
    if (exacto.length > 1) ambiguos.push(e.ruta);
    for (const archivo of exacto) {
      archivos.add(archivo);
      const dentro = simbolosTocados(ix.estructura.get(archivo)!.simbolos, e.rangos);
      if (!dentro.length) sinSimbolo.push(archivo);
      for (const s of dentro) {
        tocados.add(clave(archivo, s.nombre));
        if (!INVOCABLES.has(s.tipo)) nombrados.add(clave(archivo, s.nombre));
      }
    }
  }

  // Hacia arriba: quién llama a lo tocado y quién nombra un tipo o una constante tocados.
  const vistos = new Set(tocados);
  let frente = [...tocados], cortado = false;
  for (let nivel = 1; frente.length; nivel++) {
    if (nivel > prof) { cortado = true; break; }
    const sig: string[] = [];
    for (const k of frente) for (const l of [...(ix.llamadores.get(k) ?? []), ...(ix.usan.get(k) ?? [])]) if (!vistos.has(l.clave)) { vistos.add(l.clave); sig.push(l.clave); }
    frente = sig;
  }
  // Usos directos de cada tipo o constante tocados; los que nadie nombra dicen por qué.
  const usos: string[] = [], sinUsos: string[] = [], sinRegistro = new Set<string>();
  for (const k of [...nombrados].sort(cmp)) {
    const us = ix.usan.get(k) ?? [];
    for (const u of [...us].sort((a, b) => cmp(a.clave, b.clave))) usos.push(`${partes(k).simbolo} ← ${cita(ix, u.clave, u.linea)}`);
    if (us.length) continue;
    const repo = k.slice(0, k.indexOf(":"));
    if (ix.sinReferencias.has(repo)) sinRegistro.add(repo);
    else sinUsos.push(partes(k).simbolo);
  }
  const alcanzados = [...vistos].sort(cmp);
  const endpoints = [...new Set(alcanzados.flatMap((k) => ix.atiende.get(k) ?? []))].sort(cmp);
  // Pantallas: las que dibujan un componente alcanzado y las que llaman a un endpoint alcanzado.
  const pantallas = new Set<string>();
  for (const n of ctx.graph.nodes) {
    if (n.tipo !== "pantalla") continue;
    if (raicesDePantalla(n.atributos as { componentes?: string[] }).some((c) => vistos.has(c))) pantallas.add(n.id);
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
    usos,
    llamadores: alcanzados.filter((k) => !tocados.has(k)).map((k) => cita(ix, k)),
    avisos: [
      ...(fuera.length ? [`archivos fuera del índice (no se pudo medir su alcance): ${fuera.join(", ")}`] : []),
      ...(ambiguos.length ? [`ruta en varios repos, se tomaron todos (pasá repo): ${ambiguos.join(", ")}`] : []),
      ...(sinSimbolo.length ? [`cambios fuera de todo símbolo (imports, código suelto de nivel superior, configuración): ${[...new Set(sinSimbolo)].sort(cmp).join(", ")}`] : []),
      ...(sinUsos.length ? [`tipos o constantes que ningún símbolo indexado nombra (si se usan, es fuera del código analizado: otro repo, plantillas, texto o reflexión): ${sinUsos.join(", ")}`] : []),
      ...(sinRegistro.size ? [`el índice de ${[...sinRegistro].sort(cmp).join(", ")} no registra quién usa tipos y constantes (indexado antes de registrarlos, o su parser no los sigue): corré \`flowbrain index\` y \`flowbrain compile\` para seguirlos`] : []),
      ...(cortado ? [`hay más llamadores por encima de la profundidad ${prof}`] : []),
      ...sinResolverConNombre(ix, [...tocados]),
      ...avisosIndice(ix),
    ],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["llamadores", "usos", "cambia", "pantallas", "endpoints"], p.budget_tokens);
}

const INVOCABLES = new Set(["metodo", "funcion"]);
/** Símbolos que se siguen por sus usos (`referencias`), no por sus llamadas. */
const NOMBRABLES = new Set(["tipo", "interfaz", "enum", "constante", "clase", "objeto"]);
/** Clases y objetos contienen métodos: cuentan solo si el cambio cae en una línea suya que no es de un método. */
const CONTENEDORES = new Set(["clase", "objeto"]);

/**
 * Símbolos que tocan los rangos (vacío = el archivo entero): funciones y métodos; tipos, interfaces, enums y
 * constantes; y una clase o un objeto si el cambio cae fuera de sus métodos (una propiedad, un decorador, la firma).
 */
export function simbolosTocados<S extends { nombre: string; tipo: string; linea: number; fin?: number | undefined }>(simbolos: S[], rangos: Array<[number, number]>): S[] {
  const seguidos = simbolos.filter((s) => INVOCABLES.has(s.tipo) || NOMBRABLES.has(s.tipo));
  if (!rangos.length) return seguidos;
  const cruza = (s: S, a: number, b: number) => s.linea <= b && a <= (s.fin ?? s.linea);
  return seguidos.filter((s) =>
    rangos.some(([a, b]) => {
      if (!cruza(s, a, b)) return false;
      if (!CONTENEDORES.has(s.tipo)) return true;
      const metodos = simbolos.filter((m) => INVOCABLES.has(m.tipo) && m.nombre.startsWith(`${s.nombre}.`));
      for (let l = Math.max(a, s.linea); l <= Math.min(b, s.fin ?? s.linea); l++) if (!metodos.some((m) => m.linea <= l && l <= (m.fin ?? m.linea))) return true;
      return false;
    }),
  );
}

// ------------------------------------------------------------------ deriva de contratos

export interface DerivaParams {
  /** Servicio a revisar; sin esto, todos. */
  nodo?: string;
  /** Con varios cerebros: lo que este cerebro llama en otros y lo que otros le llaman. Sin esto, la deriva mira solo este cerebro. */
  cruzadas?: DerivaCruzada;
  budget_tokens?: number | null;
}

/** Lo que cruza de cerebro, visto desde uno: sale de los cruces del registro (la misma regla que `impacto` y `conexiones`). */
export interface DerivaCruzada {
  /** Cerebros con la comunicación activa con este. */
  vecinos: string[];
  /** Llamadas de este cerebro que atiende un endpoint de otro, por su evidencia. */
  salientes: Map<string, { cerebro: string; endpoint: string }>;
  /** Endpoints de este cerebro que llama otro: quiénes (`cerebro/servicio`). */
  entrantes: Map<string, Set<string>>;
  /** Llamadas que coinciden con endpoints de más de un cerebro y no se unieron a ninguno, por su evidencia. */
  disputadas: Map<string, string[]>;
  /** Llamadas que el registro declara internas del propio servicio, por su evidencia: no son deriva. */
  internas?: Set<string>;
  /** Contrato de un endpoint de otro cerebro (el que atiende una llamada saliente): para comparar campos. */
  contratoDe?: (cerebro: string, endpoint: string) => ContratoEndpoint | null;
}

/** Lo que declara un endpoint: los tipos de cuerpo, query y respuesta, y las formas que conoce su contrato. */
export interface ContratoEndpoint {
  ev: string;
  request: string | null;
  response: string | null;
  query: string | null;
  tipos: Record<string, Record<string, string>>;
}

/** El contrato de un endpoint de este brain (`null` si no existe). */
export function contratoDeEndpoint(ctx: Contexto, endpoint: string): ContratoEndpoint | null {
  const n = ctx.nodo.get(endpoint);
  if (n?.tipo !== "endpoint") return null;
  const a = n.atributos as { evidencia?: string; request?: string | null; response?: string | null; query?: string | null };
  return { ev: String(a.evidencia ?? ""), request: a.request ?? null, response: a.response ?? null, query: a.query ?? null, tipos: ctx.contratos.get(endpoint.slice(0, endpoint.indexOf(":")))?.tipos ?? {} };
}

type Campos = Map<string, { opcional: boolean; tipo: string }>;

/** Campos de una forma: la clave con `?` o el tipo con `undefined` marcan un campo opcional. */
function camposDeForma(f: Record<string, string>): Campos {
  const out: Campos = new Map();
  for (const [k, t] of Object.entries(f)) {
    const nombre = k.endsWith("?") ? k.slice(0, -1) : k;
    out.set(nombre, { opcional: k.endsWith("?") || /(^|\|)\s*undefined\s*(\||$)/.test(t), tipo: t });
  }
  return out;
}

/**
 * Los campos de un tipo declarado por el back, con las formas de su contrato. Una unión (`A | B`) junta los campos de
 * todas sus partes (opcional el que falta en alguna). Sin forma para alguna parte, o si es un arreglo, no se compara.
 */
function camposDelBack(nombre: string, tipos: Record<string, Record<string, string>>): Campos | { motivo: string } {
  const partes = nombre.split(" | ").map((x) => x.trim()).filter((x) => x && x !== "null" && x !== "undefined");
  if (!partes.length) return { motivo: `el back declara \`${nombre}\`, sin campos` };
  if (partes.some((x) => x.endsWith("[]"))) return { motivo: `el back declara un arreglo (\`${nombre}\`): se comparan objetos` };
  const sin = partes.filter((x) => !tipos[x]);
  if (sin.length) return { motivo: `el back declara \`${sin.join(" | ")}\` y el contrato no tiene su forma` };
  // Una forma vacía es un tipo de claves libres (`Record<string, …>`, un arreglo asociativo): acepta cualquier campo.
  if (partes.every((x) => !Object.keys(tipos[x]!).length)) return { motivo: `el back declara \`${nombre}\`, sin campos declarados (acepta cualquiera)` };
  const out: Campos = new Map();
  const vistos = new Map<string, number>();
  for (const x of partes)
    for (const [k, v] of camposDeForma(tipos[x]!)) {
      vistos.set(k, (vistos.get(k) ?? 0) + 1);
      const ya = out.get(k);
      out.set(k, { opcional: (ya?.opcional ?? false) || v.opcional, tipo: ya?.tipo ?? v.tipo });
    }
  for (const [k, n] of vistos) if (n < partes.length) out.get(k)!.opcional = true;
  return out;
}

/** Nombre sin separadores ni mayúsculas: `player_id` y `playerId` se parecen. */
const compactar = (k: string) => k.replace(/[_-]/g, "").toLowerCase();

/** Lo que una llamada manda (o pasa por query) contra lo que el back declara recibir. */
function compararEntrada(front: Campos, back: Campos) {
  const sobran = [...front.keys()].filter((k) => !back.has(k));
  const faltan = [...back.entries()].filter(([k, v]) => !v.opcional && !front.has(k)).map(([k]) => k);
  const parecidos: string[] = [];
  for (const k of [...sobran]) {
    const b = [...back.keys()].find((x) => !front.has(x) && compactar(x) === compactar(k));
    if (!b) continue;
    parecidos.push(`${k} ↔ ${b}`);
    sobran.splice(sobran.indexOf(k), 1);
    if (faltan.includes(b)) faltan.splice(faltan.indexOf(b), 1);
  }
  // Mandado como opcional y requerido por el back: puede faltar.
  const puedeFaltar = [...back.entries()].filter(([k, v]) => !v.opcional && front.get(k)?.opcional).map(([k]) => k);
  return { sobran: sobran.sort(cmp), faltan: faltan.sort(cmp), puedeFaltar: puedeFaltar.sort(cmp), parecidos: parecidos.sort(cmp) };
}

/** Lo que una llamada espera de la respuesta contra lo que el back declara devolver. */
function compararRespuesta(front: Campos, back: Campos) {
  const faltantes = [...front.keys()].filter((k) => !back.has(k));
  const parecidos: string[] = [];
  const quedan = faltantes.filter((k) => {
    const b = [...back.keys()].find((x) => !front.has(x) && compactar(x) === compactar(k));
    if (b) parecidos.push(`${k} ↔ ${b}`);
    return !b;
  });
  return {
    noVienen: quedan.filter((k) => !front.get(k)!.opcional).sort(cmp),
    opcionalesQueNoVienen: quedan.filter((k) => front.get(k)!.opcional).sort(cmp),
    parecidos: parecidos.sort(cmp),
  };
}

type LadoComparado = "cuerpo" | "query" | "respuesta";

/**
 * Compara, campo por campo, una llamada unida a un endpoint con lo que el endpoint declara. Cada lado (cuerpo, query,
 * respuesta) es comparable solo si los dos tienen forma: si no, se dice por qué, sin contarlo como coincidencia.
 */
function compararLlamada(k: CamposDeLlamada | undefined, c: ContratoEndpoint, metodo: string) {
  const diferencias: Record<string, unknown> = {};
  const noComparables: Array<{ lado: LadoComparado; motivo: string; tipo?: string }> = [];
  let comparados = 0;
  const conCuerpo = !["GET", "DELETE", "HEAD", "OPTIONS"].includes(metodo);
  const entrada = (lado: "cuerpo" | "query", front: LadoDeLlamada | undefined, back: string | null) => {
    if (!front && !back) return;
    if (lado === "cuerpo" && !front && !conCuerpo) return;
    // No manda nada y el back no declara nada: no hay qué comparar.
    if (!back && front?.forma && !Object.keys(front.forma).length) return;
    if (!front) return void noComparables.push({ lado, motivo: lado === "cuerpo" ? "no se sabe qué cuerpo manda la llamada" : "no se sabe qué query manda la llamada" });
    if (!front.forma) return void noComparables.push({ lado, motivo: "la llamada manda un tipo sin campos que comparar", tipo: front.tipo });
    if (!back) return void noComparables.push({ lado, motivo: lado === "cuerpo" ? "el back no declara el tipo del cuerpo" : "el back no declara el tipo de la query" });
    const b = camposDelBack(back, c.tipos);
    if ("motivo" in b) return void noComparables.push({ lado, motivo: b.motivo.replace(/`[^`]*`/, "un tipo"), tipo: back });
    comparados++;
    const r = compararEntrada(camposDeForma(front.forma), b);
    if (r.sobran.length || r.faltan.length || r.puedeFaltar.length || r.parecidos.length)
      diferencias[lado] = {
        front: front.tipo,
        back,
        ...(r.sobran.length ? { mandaYElBackNoDeclara: r.sobran } : {}),
        ...(r.faltan.length ? { requeridosQueNoManda: r.faltan } : {}),
        ...(r.puedeFaltar.length ? { opcionalesQueElBackRequiere: r.puedeFaltar } : {}),
        ...(r.parecidos.length ? { distintoNombre: r.parecidos } : {}),
      };
  };
  entrada("cuerpo", k?.envia, conCuerpo || k?.envia ? c.request : null);
  entrada("query", k?.query, c.query);
  const f = k?.espera;
  if (!f) noComparables.push({ lado: "respuesta", motivo: "la llamada no tipa la respuesta" });
  else if (!f.forma) noComparables.push({ lado: "respuesta", motivo: "la llamada espera un tipo sin campos que comparar", tipo: f.tipo });
  else if (!c.response) noComparables.push({ lado: "respuesta", motivo: "el back no declara el tipo de respuesta" });
  else {
    const b = camposDelBack(c.response, c.tipos);
    if ("motivo" in b) noComparables.push({ lado: "respuesta", motivo: b.motivo.replace(/`[^`]*`/, "un tipo"), tipo: c.response });
    else {
      comparados++;
      const r = compararRespuesta(camposDeForma(f.forma), b);
      if (r.noVienen.length || r.opcionalesQueNoVienen.length || r.parecidos.length)
        diferencias["respuesta"] = {
          front: f.tipo,
          back: c.response,
          ...(r.noVienen.length ? { esperaYNoViene: r.noVienen } : {}),
          ...(r.opcionalesQueNoVienen.length ? { opcionalesQueNoVienen: r.opcionalesQueNoVienen } : {}),
          ...(r.parecidos.length ? { distintoNombre: r.parecidos } : {}),
        };
    }
  }
  return { diferencias, noComparables, comparados };
}

/**
 * Deriva entre lo que se llama y lo que se atiende: llamadas a rutas que ningún endpoint conocido atiende (o que
 * existen con otro método), llamadas que coinciden con varios endpoints, y endpoints que nadie llama. Lo último solo
 * dice algo si los consumidores del servicio están indexados: por eso se informa cuántos tiene cada servicio.
 *
 * Con un cerebro por repo, casi todo cruza: las llamadas de un front las atiende otro cerebro, y a los endpoints de un
 * back los llama otro. Con `cruzadas`, una llamada atendida en otro cerebro deja de figurar como "sin endpoint" (queda
 * solo la que no atiende nadie), y un endpoint que llama otro cerebro deja de figurar como "sin llamadas".
 */
export function deriva(ctx: Contexto, p: DerivaParams) {
  const ix = indice(ctx);
  if (p.nodo !== undefined && ctx.nodo.get(p.nodo)?.tipo !== "svc") throw new ConsultaError("nodo_inexistente", `no existe el servicio: ${p.nodo}`);
  const endpoints = ctx.graph.nodes.filter((n) => n.tipo === "endpoint");
  const svcDe = (ep: string) => ep.slice(0, ep.indexOf(":"));
  const x = p.cruzadas;
  const llamados = new Set([...ctx.graph.edges.filter((e) => e.verbo === "llama_a" && e.endpoint && e.estado !== "deprecado").map((e) => e.endpoint!), ...(x?.entrantes.keys() ?? [])]);
  // Consumidores de cada servicio: otros servicios o pantallas que le llaman algún endpoint.
  const consumidores = new Map<string, Set<string>>();
  for (const e of ctx.graph.edges) {
    if (e.verbo !== "llama_a" || !e.endpoint || e.desde === e.hasta) continue;
    const quien = ctx.nodo.get(e.desde);
    if (quien?.tipo === "svc") consumidores.set(e.hasta, (consumidores.get(e.hasta) ?? new Set()).add(e.desde));
  }
  for (const [ep, quienes] of x?.entrantes ?? []) for (const q of quienes) consumidores.set(svcDe(ep), (consumidores.get(svcDe(ep)) ?? new Set()).add(q));
  const svcs = (p.nodo ? [p.nodo] : [...new Set(endpoints.map((n) => svcDe(n.id)))]).sort(cmp);
  // Una tarea programada no la llama nadie: la dispara su horario.
  const programadas = endpoints.filter((n) => svcs.includes(svcDe(n.id)) && SIN_LLAMADOR.has(String(n.atributos["metodo"]))).length;
  const sinLlamadas = endpoints
    .filter((n) => svcs.includes(svcDe(n.id)) && !SIN_LLAMADOR.has(String(n.atributos["metodo"])) && !llamados.has(n.id) && (consumidores.get(svcDe(n.id))?.size ?? 0) > 0)
    .map((n) => ({ endpoint: n.id, ev: String(n.atributos["evidencia"] ?? "") }));
  const rutaDe = (ref: string) => /^(\w+) (?:\$\{[^}]*\})?(\/\S*)$/.exec(ref);
  const pend = ix.llamadasPendientes.filter((l) => !p.nodo || l.desde === p.nodo || endpoints.some((n) => svcDe(n.id) === p.nodo && l.motivo.includes(String(n.atributos["ruta"]))));
  // Las que atiende otro cerebro, por cerebro, con un ejemplo de cada una.
  const afuera = new Map<string, { llamadas: number; endpoints: Set<string>; ejemplos: Array<{ llamada: string; endpoint: string; ev: string }> }>();
  for (const l of pend) {
    const d = x?.salientes.get(l.evidencia);
    if (!d) continue;
    const v = afuera.get(d.cerebro) ?? afuera.set(d.cerebro, { llamadas: 0, endpoints: new Set(), ejemplos: [] }).get(d.cerebro)!;
    v.llamadas++;
    if (!v.endpoints.has(d.endpoint) && v.ejemplos.length < 5) v.ejemplos.push({ llamada: l.referencia, endpoint: d.endpoint, ev: l.evidencia });
    v.endpoints.add(d.endpoint);
  }
  const disputadas = pend.filter((l) => x?.disputadas.has(l.evidencia)).map((l) => ({ desde: l.desde, llamada: l.referencia, ev: l.evidencia, candidatos: x!.disputadas.get(l.evidencia)! }));
  const sinEndpoint = pend
    .filter((l) => l.motivo.startsWith("base dinámica y ningún endpoint") && !x?.salientes.has(l.evidencia) && !x?.disputadas.has(l.evidencia) && !x?.internas?.has(l.evidencia))
    .map((l) => {
      const m = rutaDe(l.referencia);
      const otros = m ? endpoints.filter((n) => rutaCoincide(String(n.atributos["ruta"]), normalizarRuta(m[2]!)) && n.atributos["metodo"] !== m[1]).map((n) => n.id).sort(cmp) : [];
      return { desde: l.desde, llamada: l.referencia, ev: l.evidencia, ...(otros.length ? { existeConOtroMetodo: otros } : {}) };
    });
  const ambiguas = pend.filter((l) => l.motivo === "varios endpoints coinciden").map((l) => ({ desde: l.desde, llamada: l.referencia, ev: l.evidencia, candidatos: l.candidatos }));
  const sinAnalizar = pend.filter((l) => l.motivo === "URL sin ruta reconocible").length;
  const campos = compararCampos(ctx, ix, p.nodo, pend, x);
  const res = {
    ...(p.nodo ? { nodo: p.nodo } : {}),
    llamadasSinEndpoint: sinEndpoint,
    ...(x
      ? {
          comunicadoCon: x.vecinos,
          atendidasEnOtrosCerebros: [...afuera.entries()].sort(([a], [b]) => cmp(a, b)).map(([cerebro, v]) => ({ cerebro, llamadas: v.llamadas, endpoints: v.endpoints.size, ejemplos: v.ejemplos })),
          ...(disputadas.length ? { disputadasEntreCerebros: disputadas } : {}),
          ...(x.internas?.size ? { internasDelServicio: pend.filter((l) => x.internas!.has(l.evidencia)).length } : {}),
        }
      : {}),
    llamadasAmbiguas: ambiguas,
    endpointsSinLlamadasDetectadas: sinLlamadas,
    campos: campos.resumen,
    camposQueNoCoinciden: campos.difieren,
    consumidoresIndexados: Object.fromEntries(svcs.map((s) => [s, [...(consumidores.get(s) ?? [])].sort(cmp)])),
    avisos: [
      ...svcs.filter((s) => !(consumidores.get(s)?.size ?? 0)).map((s) => `${s} no tiene consumidores indexados${x?.vecinos.length ? ` (ni acá ni en ${x.vecinos.join(", ")})` : ""}: no se puede decir qué endpoints suyos no se usan`),
      ...(x && !x.vecinos.length ? ["este cerebro no tiene la comunicación activa con ningún otro: lo que llame afuera figura como sin endpoint (flowbrain brains lo muestra)"] : []),
      ...(x && sinEndpoint.length ? [`las llamadas sin endpoint no las atiende ni este cerebro ni ${x.vecinos.join(", ") || "ningún otro"}: o la ruta ya no existe, o el servicio que la atiende no está indexado o no está comunicado`] : []),
      ...(disputadas.length ? [`${disputadas.length} llamadas coinciden con endpoints de más de un cerebro: falta declarar a qué servicio va cada base de URL (flowbrain evidence las lista)`] : []),
      ...(programadas ? [`${programadas} ${programadas === 1 ? "tarea programada (CRON) no se cuenta" : "tareas programadas (CRON) no se cuentan"} entre los endpoints sin llamadas: las dispara un horario, no una llamada`] : []),
      ...(sinAnalizar ? [`${sinAnalizar} llamadas con URL armada en tiempo de ejecución no se pudieron analizar: alguna puede ser la que usa un endpoint listado como sin llamadas`] : []),
      ...campos.avisos,
      ...avisosIndice(ix),
    ],
    indice: versiones(ix),
  };
  return ajustarLista(res, ["camposQueNoCoinciden", "endpointsSinLlamadasDetectadas", "llamadasAmbiguas", ...(disputadas.length ? (["disputadasEntreCerebros"] as never[]) : []), "llamadasSinEndpoint"], p.budget_tokens);
}

/**
 * Campos de cada llamada unida a un endpoint (en este brain, o en otro con `cruzadas.contratoDe`) contra lo que el
 * endpoint declara: lo que se manda de más, lo requerido que no se manda y lo que se espera de la respuesta y no viene.
 * Lo que no se puede comparar (un lado sin tipo o sin forma) se cuenta por motivo, nunca como coincidencia.
 */
function compararCampos(ctx: Contexto, ix: IndiceCodigo, nodo: string | undefined, pend: IndiceCodigo["llamadasPendientes"], x: DerivaCruzada | undefined) {
  const svcDe = (ep: string) => ep.slice(0, ep.indexOf(":"));
  const unidas: Array<{ llamada: string; ev: string; endpoint: string; cerebro?: string; contrato: ContratoEndpoint | null }> = [];
  for (const u of ix.llamadasUnidas) {
    if (nodo && u.desde !== nodo && svcDe(u.endpoint) !== nodo) continue;
    const a = ctx.nodo.get(u.endpoint)?.atributos as { metodo?: string; ruta?: string } | undefined;
    unidas.push({ llamada: `${a?.metodo ?? ""} ${a?.ruta ?? ""}`.trim(), ev: u.evidencia, endpoint: u.endpoint, contrato: contratoDeEndpoint(ctx, u.endpoint) });
  }
  for (const l of pend) {
    const d = x?.salientes.get(l.evidencia);
    if (d) unidas.push({ llamada: l.referencia, ev: l.evidencia, endpoint: d.endpoint, cerebro: d.cerebro, contrato: x?.contratoDe?.(d.cerebro, d.endpoint) ?? null });
  }
  const difieren: Array<Record<string, unknown>> = [];
  const motivos = new Map<string, { lado: LadoComparado; motivo: string; llamadas: number; tipos: Set<string>; ejemplos: Array<{ llamada: string; ev: string }> }>();
  let comparadas = 0;
  let iguales = 0;
  let grpc = 0;
  const anotar = (lado: LadoComparado, motivo: string, tipo: string | undefined, u: (typeof unidas)[number]) => {
    const k = `${lado}\u0000${motivo}`;
    const v = motivos.get(k) ?? motivos.set(k, { lado, motivo, llamadas: 0, tipos: new Set(), ejemplos: [] }).get(k)!;
    v.llamadas++;
    if (tipo) v.tipos.add(tipo);
    if (v.ejemplos.length < 3) v.ejemplos.push({ llamada: u.llamada, ev: u.ev });
  };
  for (const u of unidas) {
    if (!u.contrato) {
      anotar("respuesta", u.cerebro ? `no se cargó el contrato del endpoint en ${u.cerebro}` : "el endpoint no tiene contrato", undefined, u);
      continue;
    }
    const metodo = /^(\w+)/.exec(u.endpoint.slice(u.endpoint.indexOf(":") + 1))?.[1] ?? "";
    // Un rpc manda y recibe mensajes del `.proto`: el índice no lee los campos de la llamada del cliente.
    if (metodo === "GRPC") {
      grpc++;
      continue;
    }
    const r = compararLlamada(ix.camposDeLlamada.get(u.ev), u.contrato, metodo);
    for (const n of r.noComparables) anotar(n.lado, n.motivo, n.tipo, u);
    if (!r.comparados) continue;
    comparadas++;
    if (!Object.keys(r.diferencias).length) iguales++;
    else difieren.push({ llamada: u.llamada, ev: u.ev, endpoint: u.endpoint, ...(u.cerebro ? { cerebro: u.cerebro } : {}), evEndpoint: u.contrato.ev, ...r.diferencias });
  }
  // Primero lo que rompe: requeridos que no se mandan y campos esperados que no vienen.
  const grave = (d: Record<string, unknown>) =>
    (((d["cuerpo"] as { requeridosQueNoManda?: string[] } | undefined)?.requeridosQueNoManda?.length ?? 0) +
      ((d["query"] as { requeridosQueNoManda?: string[] } | undefined)?.requeridosQueNoManda?.length ?? 0) +
      ((d["respuesta"] as { esperaYNoViene?: string[] } | undefined)?.esperaYNoViene?.length ?? 0));
  difieren.sort((a, b) => grave(b) - grave(a) || cmp(String(a["ev"]), String(b["ev"])));
  const resumen = {
    llamadasUnidas: unidas.length,
    comparadas,
    sinDiferencias: iguales,
    conDiferencias: difieren.length,
    noComparables: [...motivos.values()]
      .sort((a, b) => b.llamadas - a.llamadas || cmp(a.lado, b.lado) || cmp(a.motivo, b.motivo))
      .map((v) => ({ lado: v.lado, motivo: v.motivo, llamadas: v.llamadas, ...(v.tipos.size ? { tipos: [...v.tipos].sort(cmp).slice(0, 5) } : {}), ejemplos: v.ejemplos })),
  };
  const sinCampos = [...ix.sinCampos].sort(cmp);
  const entrantes = nodo ? [...(x?.entrantes.keys() ?? [])].some((e) => svcDe(e) === nodo) : (x?.entrantes.size ?? 0) > 0;
  const avisos = [
    ...(sinCampos.length ? [`el índice de ${sinCampos.join(", ")} no trae los campos de las llamadas (se indexó antes de registrarlos): corré \`flowbrain index\` para que \`deriva\` los compare`] : []),
    ...(unidas.length ? ["los campos se comparan en el primer nivel del objeto (no adentro de `data`), por nombre; un lado sin tipo o sin forma figura en `campos.noComparables`, no como coincidencia"] : []),
    ...(grpc ? [`${grpc} ${grpc === 1 ? "llamada gRPC unida no se compara" : "llamadas gRPC unidas no se comparan"} por campos: los mensajes están en el \`.proto\` y el índice no lee lo que arma el cliente`] : []),
    ...(entrantes ? ["los campos de las llamadas que llegan desde otros cerebros se comparan en la deriva del cerebro que llama"] : []),
  ];
  return { resumen, difieren, avisos };
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
  return paridadEntre({ ctx, svc: p.viejo }, { ctx, svc: p.nuevo }, p.budget_tokens);
}

/** Un lado de la comparación: un servicio de un brain. Con `cerebro`, el servicio vive en otro cerebro que el otro lado. */
export interface LadoParidad {
  ctx: Contexto;
  svc: string;
  cerebro?: string;
}

/**
 * La misma paridad, con cada servicio en su propio brain: el caso de una migración con el sistema viejo y el nuevo en
 * cerebros distintos. Las tablas se comparan por nombre sin separadores, porque cada cerebro le puso su id a la página.
 */
export function paridadEntre(viejo: LadoParidad, nuevo: LadoParidad, budget_tokens?: number | null) {
  const p = { viejo: viejo.svc, nuevo: nuevo.svc, budget_tokens };
  for (const l of [viejo, nuevo]) if (l.ctx.nodo.get(l.svc)?.tipo !== "svc") throw new ConsultaError("nodo_inexistente", `no existe el servicio: ${l.svc}${l.cerebro ? ` en el cerebro ${l.cerebro}` : ""}`);
  const entreCerebros = viejo.ctx !== nuevo.ctx;
  // Entre cerebros, la misma tabla puede tener la página con otro id (`tabla-club-has-users` y `tabla-clubhasusers`):
  // se compara el nombre sin separadores ni mayúsculas. En un mismo brain, el id.
  const tabla = (id: string) => (entreCerebros ? id.replace(/^(tabla|db)-/, "").replace(/[^a-z0-9]/gi, "").toLowerCase() : id);
  const sinPar = (xs: string[], otros: string[], clave: (x: string) => string) => {
    const o = new Set(otros.map(clave));
    return xs.filter((x) => !o.has(clave(x))).sort(cmp);
  };
  const claveAcceso = (a: string) => `${a.slice(0, a.indexOf(" "))} ${tabla(a.slice(a.indexOf(" ") + 1))}`;
  const forma = (ruta: string) => ruta.replace(/\{[^}]*\}/g, "{}").toLowerCase();
  const piezas = (l: LadoParidad, tipo: "endpoint" | "pantalla") =>
    (l.ctx.salientes.get(l.svc) ?? [])
      .filter((e) => e.verbo === "contiene" && l.ctx.nodo.get(e.hasta)?.tipo === tipo)
      .map((e) => {
        const a = l.ctx.nodo.get(e.hasta)!.atributos as { metodo?: string; ruta: string };
        return { id: e.hasta, metodo: a.metodo ?? "", ruta: forma(a.ruta) };
      });
  const tablasDe = (l: LadoParidad, id: string) => (l.ctx.salientes.get(id) ?? []).filter((e) => e.verbo === "lee_de" || e.verbo === "escribe_en").map((e) => `${e.verbo} ${e.hasta}`);
  const comparar = (tipo: "endpoint" | "pantalla") => {
    const v = piezas(viejo, tipo), n = piezas(nuevo, tipo);
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
      const a = [...new Set(tablasDe(viejo, par.viejo))], b = [...new Set(tablasDe(nuevo, par.nuevo))];
      const soloViejo = sinPar(a, b, claveAcceso), soloNuevo = sinPar(b, a, claveAcceso);
      return soloViejo.length || soloNuevo.length ? [{ ...par, soloViejo, soloNuevo }] : [];
    });
    return {
      total: { viejo: v.length, nuevo: n.length, migrados: iguales.length },
      faltan: v.filter((x) => !enNuevo.has(clave(x, pv))).map((x) => x.id).sort(cmp),
      soloEnNuevo: n.filter((x) => !enViejo.has(clave(x, pn))).map((x) => x.id).sort(cmp),
      difierenEnTablas: difieren,
    };
  };
  const tablasSvc = (l: LadoParidad) => new Set([l.svc, ...piezas(l, "endpoint").map((x) => x.id)].flatMap((id) => (l.ctx.salientes.get(id) ?? []).filter((e) => e.verbo === "lee_de" || e.verbo === "escribe_en").map((e) => e.hasta)));
  const tv = tablasSvc(viejo), tn = tablasSvc(nuevo);
  const endpoints = comparar("endpoint"), pantallas = comparar("pantalla");
  const res = {
    viejo: p.viejo,
    nuevo: p.nuevo,
    ...(entreCerebros ? { cerebros: { viejo: viejo.cerebro ?? null, nuevo: nuevo.cerebro ?? null } } : {}),
    endpoints,
    pantallas,
    tablasSinMigrar: sinPar([...tv], [...tn], tabla),
    avisos: [
      ...(endpoints.total.viejo + pantallas.total.viejo === 0 ? [`${p.viejo} no tiene endpoints ni pantallas indexados`] : []),
      ...(endpoints.total.nuevo + pantallas.total.nuevo === 0 ? [`${p.nuevo} no tiene endpoints ni pantallas indexados`] : []),
      "se emparejó por método y ruta: una pieza renombrada figura como faltante de un lado y nueva del otro",
      ...(entreCerebros ? ["cada servicio está en su cerebro: las tablas se comparan por nombre, sin guiones ni mayúsculas (`tabla-club-has-users` y `tabla-clubhasusers` son la misma); una tabla renombrada figura como diferencia"] : []),
    ],
  };
  // Recorte por presupuesto: primero lo nuevo, después las diferencias, al final lo que falta (lo que más importa).
  const b = p.budget_tokens === undefined ? 2000 : p.budget_tokens;
  let omitidos = 0;
  const listas: unknown[][] = [pantallas.soloEnNuevo, endpoints.soloEnNuevo, pantallas.difierenEnTablas, endpoints.difierenEnTablas, res.tablasSinMigrar, pantallas.faltan, endpoints.faltan];
  for (const l of listas) while (b !== null && l.length && tokens({ ...res, truncado: true, omitidos: omitidos + 1 }) > b) { l.pop(); omitidos++; }
  return omitidos ? { ...res, truncado: true as const, omitidos } : res;
}

export interface PorResolverParams {
  limite?: number;
  /** Lo que dice `calls.yaml`, para informar cuáles ya entraron al índice. */
  declaradas?: Array<{ desde: string; hacia: string; linea: number }>;
}

/**
 * Dónde se cortan los recorridos: endpoints cuyo recorrido no llega a ninguna tabla y que tienen, en el camino,
 * llamadas que el parser no pudo atribuir (receptor sin tipo declarado). Cada una trae sus candidatos, para que quien
 * lea el código (una persona o un modelo) declare a cuál va en `calls.yaml`.
 */
/**
 * Llamadas HTTP (con ruta) a las que se llega desde el árbol de componentes de una pantalla: las unidas a un endpoint y
 * las pendientes de otro cerebro. Sirve para comprobar que una pantalla sigue llegando a lo que se verificó a mano.
 */
export function llamadasDePantalla(ctx: Contexto, pantalla: string): Array<{ metodo: string; ruta: string }> {
  const ix = ctx.codigo;
  const n = ctx.nodo.get(pantalla);
  if (!ix || !n) return [];
  const vistos = new Set<string>(raicesDePantalla(n.atributos as { componentes?: string[] }));
  const cola = [...vistos];
  while (cola.length && vistos.size < 5000) {
    const k = cola.pop()!;
    const { archivo, simbolo } = partes(k);
    const repo = archivo.slice(0, archivo.indexOf(":"));
    for (const i of ix.estructura.get(archivo)?.invoca ?? []) {
      const sig = `${repo}:${i.archivo}#${i.simbolo}`;
      if (i.desde === simbolo && !vistos.has(sig)) {
        vistos.add(sig);
        cola.push(sig);
      }
    }
  }
  const simboloEn = (archivo: string, linea: number) => {
    const dentro = (ix.estructura.get(archivo)?.simbolos ?? []).filter((s) => s.fin !== undefined && s.linea <= linea && linea <= s.fin);
    return dentro.length ? dentro.reduce((a, b) => (b.linea >= a.linea ? b : a)).nombre : null;
  };
  const out: Array<{ metodo: string; ruta: string }> = [];
  for (const [ep, xs] of ix.llamanEndpoint) {
    const e = ctx.nodo.get(ep);
    if (e && xs.some((x) => vistos.has(x.clave))) out.push({ metodo: String(e.atributos["metodo"]).toUpperCase(), ruta: String(e.atributos["ruta"]) });
  }
  for (const l of ix.llamadasPendientes) {
    const m = l.llamada?.ruta ? /^(.*)#L(\d+)$/.exec(l.evidencia) : null;
    const s = m ? simboloEn(m[1]!, Number(m[2])) : null;
    if (m && s && vistos.has(`${m[1]}#${s}`)) out.push({ metodo: l.llamada!.metodo, ruta: l.llamada!.ruta! });
  }
  return out;
}

/** `repo:ruta#Simbolo` del símbolo que contiene la línea de una evidencia (el más interno con rango). */
function claveDeEvidencia(ix: IndiceCodigo, evidencia: string): string | null {
  const m = /^(.*)#L(\d+)$/.exec(evidencia);
  if (!m) return null;
  const linea = Number(m[2]);
  const dentro = (ix.estructura.get(m[1]!)?.simbolos ?? []).filter((s) => s.fin !== undefined && s.linea <= linea && linea <= s.fin);
  return dentro.length ? `${m[1]}#${dentro.reduce((a, b) => (b.linea >= a.linea ? b : a)).nombre}` : null;
}

/**
 * Pantallas desde cuyo árbol de componentes no se llega a ninguna llamada HTTP con ruta (unida a un endpoint o pendiente
 * de otro cerebro). Una funcionalidad con todas sus pantallas así es sospechosa: o no habla con el back, o lo hace de
 * una forma que el parser no entiende.
 */
export function pantallasSinLlamadas(ctx: Contexto): string[] {
  const ix = indice(ctx);
  const llaman = new Set<string>();
  for (const xs of ix.llamanEndpoint.values()) for (const x of xs) llaman.add(x.clave);
  for (const l of ix.llamadasPendientes) {
    const k = l.llamada?.ruta ? claveDeEvidencia(ix, l.evidencia) : null;
    if (k) llaman.add(k);
  }
  const alcanza = (inicio: string): boolean => {
    const vistos = new Set<string>([inicio]);
    const cola = [inicio];
    while (cola.length && vistos.size < 3000) {
      const k = cola.pop()!;
      if (llaman.has(k)) return true;
      const { archivo, simbolo } = partes(k);
      const repo = archivo.slice(0, archivo.indexOf(":"));
      for (const i of ix.estructura.get(archivo)?.invoca ?? []) {
        const sig = `${repo}:${i.archivo}#${i.simbolo}`;
        if (i.desde === simbolo && !vistos.has(sig)) {
          vistos.add(sig);
          cola.push(sig);
        }
      }
    }
    return false;
  };
  return ctx.graph.nodes.filter((n) => n.tipo === "pantalla" && !raicesDePantalla(n.atributos as { componentes?: string[] }).some(alcanza)).map((n) => n.id);
}

export function llamadasPorResolver(ctx: Contexto, p: PorResolverParams = {}) {
  const ix = indice(ctx);
  let total = 0;
  for (const [archivo, e] of ix.estructura) if (!ES_TEST.test(archivo)) total += e.sinResolver?.length ?? 0;
  const endpoints = ctx.graph.nodes.filter((n) => n.tipo === "endpoint").map((n) => n.id).sort(cmp);
  const sinMetodo: string[] = [];
  const grupos: Array<{ endpoint: string; llamadas: Array<{ desde: string; linea: number; llamada: string; candidatos: string[] }>; mas?: number }> = [];
  let sinTabla = 0;
  for (const ep of endpoints) {
    const r = ix.recorredor.desdeEndpoint(ep);
    if (!r.pasos.length) {
      sinMetodo.push(ep);
      continue;
    }
    if (r.pasos.some((x) => x.toca.some((t) => t.verbo === "lee_de" || t.verbo === "escribe_en"))) continue;
    sinTabla++;
    const llamadas: Array<{ desde: string; linea: number; llamada: string; candidatos: string[] }> = [];
    const vistos = new Set<string>();
    for (const paso of r.pasos) {
      const archivo = paso.evidencia.replace(/#L\d+$/, "");
      const k = `${archivo}#${paso.simbolo}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      for (const s of ix.estructura.get(archivo)?.sinResolver ?? []) {
        if (s.desde !== paso.simbolo) continue;
        llamadas.push({ desde: k, linea: s.linea, llamada: s.llamada, candidatos: (s.candidatos ?? []).flatMap((c) => ix.porNombre.get(c) ?? []).sort(cmp) });
      }
    }
    if (llamadas.length) grupos.push({ endpoint: ep, llamadas: llamadas.slice(0, 8), ...(llamadas.length > 8 ? { mas: llamadas.length - 8 } : {}) });
  }
  // ---------- Del lado del que llama: lo que el parser no vio ----------
  const claveDe = (evidencia: string) => claveDeEvidencia(ix, evidencia);
  // Llamadas HTTP que el parser vio pero sin poder determinar la ruta: no se unen a ningún endpoint.
  const sinRuta = ix.llamadasPendientes.filter((l) => l.llamada && l.llamada.ruta === null && !ES_TEST.test(l.evidencia.replace(/#L.*$/, "")));
  const httpSinRuta = sinRuta.map((l) => ({ evidencia: l.evidencia, desde: claveDe(l.evidencia), metodo: l.llamada!.metodo, base: l.llamada!.base }));
  const pantallas = ctx.graph.nodes.filter((n) => n.tipo === "pantalla");
  const mudas = pantallasSinLlamadas(ctx);
  const mudasSet = new Set(mudas);
  const porFeat = new Map<string, { total: number; mudas: string[] }>();
  for (const e of ctx.graph.edges) {
    if (e.verbo !== "implementa" || ctx.nodo.get(e.desde)?.tipo !== "pantalla" || ctx.nodo.get(e.hasta)?.tipo !== "feat") continue;
    const f = porFeat.get(e.hasta) ?? porFeat.set(e.hasta, { total: 0, mudas: [] }).get(e.hasta)!;
    f.total++;
    if (mudasSet.has(e.desde)) f.mudas.push(e.desde);
  }
  const funcionalidadesSinLlamadas = [...porFeat.entries()]
    .filter(([, v]) => v.total > 0 && v.mudas.length === v.total)
    .map(([id, v]) => ({ funcionalidad: id, codigo: ix.fichas.get(id)?.codigo ?? [], pantallas: v.mudas.sort(cmp).slice(0, 6) }))
    .sort((a, b) => cmp(a.funcionalidad, b.funcionalidad));

  const limite = p.limite ?? 20;
  // Una misma llamada corta muchos recorridos (un helper de autenticación, un serializador): resolver esas primero.
  const repetidas = new Map<string, { desde: string; linea: number; llamada: string; candidatos: string[]; endpoints: number }>();
  for (const g of grupos) {
    for (const l of g.llamadas) {
      const k = `${l.desde}#L${l.linea}`;
      const r = repetidas.get(k);
      if (r) r.endpoints++;
      else repetidas.set(k, { ...l, endpoints: 1 });
    }
  }
  const masRepetidas = [...repetidas.values()].filter((r) => r.endpoints > 1).sort((a, b) => b.endpoints - a.endpoints || cmp(a.desde, b.desde) || a.linea - b.linea).slice(0, 15);
  const declaradas = (p.declaradas ?? []).map((d) => {
    const de = partes(d.desde), a = partes(d.hacia);
    const repo = d.hacia.slice(0, d.hacia.indexOf(":"));
    const ok = (ix.estructura.get(de.archivo)?.invoca ?? []).some((i) => i.desde === de.simbolo && i.simbolo === a.simbolo && `${repo}:${i.archivo}` === a.archivo);
    return { ...d, enElIndice: ok };
  });
  return {
    herramienta: "llamadas_por_resolver",
    endpoints: endpoints.length,
    /** Endpoints sin método que los atienda: ahí el hueco es del parser de rutas, no de una llamada. */
    sinMetodo: { total: sinMetodo.length, ejemplos: sinMetodo.slice(0, 5) },
    sinLlegarATabla: sinTabla,
    conLlamadasPorResolver: grupos.length,
    sinResolverEnTotal: total,
    ...(masRepetidas.length ? { masRepetidas } : {}),
    grupos: grupos.slice(0, limite),
    ...(grupos.length > limite ? { gruposOmitidos: grupos.length - limite } : {}),
    ...(pantallas.length
      ? {
          delLadoQueLlama: {
            pantallas: pantallas.length,
            pantallasSinLlamadas: mudas.length,
            /** Funcionalidades con pantallas y ninguna llamada HTTP en ninguna: revisar su código. */
            funcionalidadesSinLlamadas,
            httpSinRuta: { total: httpSinRuta.length, ejemplos: httpSinRuta.slice(0, limite) },
          },
        }
      : httpSinRuta.length
        ? { delLadoQueLlama: { httpSinRuta: { total: httpSinRuta.length, ejemplos: httpSinRuta.slice(0, limite) } } }
        : {}),
    ...(declaradas.length ? { declaradas: { total: declaradas.length, enElIndice: declaradas.filter((d) => d.enElIndice).length, faltan: declaradas.filter((d) => !d.enElIndice).slice(0, 10).map((d) => `${d.desde} → ${d.hacia}`) } } : {}),
  };
}

// ------------------------------------------------------------------ símbolos para el visor

/** Las funciones y constantes que empiezan con `use` y una mayúscula, en JavaScript o TypeScript: hooks (React, Vue). */
const ES_HOOK = /^use[A-Z0-9]/;
const JS_O_TS = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;

/**
 * Los símbolos del índice de código en el formato corto que embebe el visor, para que Impacto muestre también clases,
 * métodos, funciones, hooks, interfaces, tipos y constantes, con quién los llama y quién los usa: la misma información
 * que `quien_llama`. `archivos`: `[archivo, [[nombre, tipo, línea], …]]`; el índice de un símbolo es su posición
 * contando en ese orden. `llaman` y `usan`: `[destino, desde, línea]` (llamadas y referencias a tipos y constantes).
 * `atiende`: `[símbolo, endpoint]`. Un hook es una función o constante `useX` de JavaScript o TypeScript.
 * `null` sin índice de código.
 */
export function simbolosDelVisor(ctx: Contexto): CodigoVisor | null {
  const ix = ctx.codigo;
  if (!ix) return null;
  const pos = new Map<string, number>();
  const archivos: CodigoVisor["archivos"] = [];
  let k = 0;
  for (const [archivo, e] of [...ix.estructura.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    if (!e.simbolos.length) continue;
    const hook = JS_O_TS.test(archivo);
    archivos.push([archivo, e.simbolos.map((s) => {
      pos.set(clave(archivo, s.nombre), k++);
      return [s.nombre, hook && (s.tipo === "funcion" || s.tipo === "constante") && ES_HOOK.test(s.nombre) ? "hook" : s.tipo, s.linea] as [string, string, number];
    })]);
  }
  const aristas = (m: Map<string, Array<{ clave: string; linea: number }>>) => {
    const out: Array<[number, number, number]> = [];
    for (const [destino, ls] of m) {
      const d = pos.get(destino);
      if (d === undefined) continue;
      for (const l of ls) {
        const o = pos.get(l.clave);
        if (o !== undefined && o !== d) out.push([d, o, l.linea]);
      }
    }
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  };
  const atiende: Array<[number, string]> = [];
  for (const [s, eps] of ix.atiende) {
    const i = pos.get(s);
    if (i !== undefined) for (const ep of eps) atiende.push([i, ep]);
  }
  atiende.sort((a, b) => a[0] - b[0] || cmp(a[1], b[1]));
  return { archivos, llaman: aristas(ix.llamadores), usan: aristas(ix.usan), atiende };
}

export interface CodigoVisor {
  archivos: Array<[string, Array<[string, string, number]>]>;
  llaman: Array<[number, number, number]>;
  usan: Array<[number, number, number]>;
  atiende: Array<[number, string]>;
}

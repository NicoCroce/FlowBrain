import { cmp } from "../canonical.js";
import { capaDe, ES_TEST, type Ficha } from "../funcionalidades.js";
import type { MarcaNoProducto } from "../no-producto.js";
import { dentroDe, type Contrato, type Graph } from "../schema.js";
import { ajustarLista, crearIndiceCodigo, pantallasSinLlamadas } from "./codigo.js";
import { crearContexto, type Contexto } from "./contexto.js";
import { ConsultaError, normalizar } from "./herramientas.js";

/**
 * Fidelidad del índice, archivo por archivo: de lo que el índice vio en un archivo, qué parte quedó entendida. Es un
 * número de 0 a 100 por archivo, y dice por qué no llega a 100 (`faltas`, con su línea): eso es lo que hay que corregir
 * con un extractor, con `calls.yaml` o en la página de la funcionalidad.
 *
 * Cada signal es una proporción (`ok` de `total`) y solo cuenta donde aplica: un archivo sin llamadas HTTP no pierde
 * puntos por HTTP. El puntaje es el promedio de las signals que aplican, con su peso. Un archivo donde el índice no
 * no encontró ninguna relación para medir (ni llamadas, ni HTTP, ni tablas, ni endpoints, ni pantallas) no tiene
 * puntaje: su fidelidad es incierta. No cuenta como 100 ni como 0, no entra al promedio y se informa aparte.
 */

export const SIGNALS = ["llamadas", "http", "datos", "entradas", "contrato", "pantallas"] as const;
export type Signal = (typeof SIGNALS)[number];

/** Peso de cada signal en el puntaje. Las que dicen por dónde pasa el dato pesan el doble. */
export const PESOS: Record<Signal, number> = { llamadas: 2, http: 2, datos: 2, entradas: 2, contrato: 1, pantallas: 1 };

/** Qué mide cada signal, para quien lee el informe. */
export const QUE_MIDE: Record<Signal, string> = {
  llamadas: "calls between methods that the index could attribute to their target",
  http: "HTTP calls linked to an endpoint or an external (with a single brain, having a path is enough)",
  datos: "table accesses whose table has a page and that say which columns they touch",
  entradas: "endpoints served here whose flow reaches a table, a service or a queue",
  contrato: "endpoints served here with a response type",
  pantallas: "screens rendered here from which an HTTP call is reached",
};

export interface FidelidadArchivo {
  archivo: string;
  /** 0 a 100. */
  puntaje: number;
  lenguaje: string;
  capa: string;
  funcionalidades: string[];
  signals: Partial<Record<Signal, { ok: number; total: number }>>;
  /** Por qué no llega a 100, con la línea cuando se conoce. */
  faltas: string[];
  /** Lo mismo, una por cosa a resolver: qué pasa, qué hacer y quién puede hacerlo. */
  tareas: Tarea[];
  /** No es de ninguna funcionalidad ni librería. No resta puntaje: se ve en `sinAsociar`. */
  sinAsociar?: true;
}

/**
 * Un archivo de fidelidad incierta: el índice no encontró en él ninguna relación para medir, así que no se puede decir
 * cuánto lo entendió. `sin_nada`: no vio ni símbolos (configuración, datos, un lenguaje sin parser). `sin_relaciones`:
 * vio código (clases, funciones, tipos) pero ninguna llamada, acceso, endpoint ni pantalla; puede ser un archivo de
 * tipos o constantes, o un hueco del parser.
 */
export interface ArchivoIncierto {
  archivo: string;
  motivo: "sin_nada" | "sin_relaciones";
  lenguaje: string;
  capa: string;
  funcionalidades: string[];
}

export const POR_QUE_INCIERTA: Record<ArchivoIncierto["motivo"], string> = {
  sin_nada: "the index found nothing in the file: no symbols, no calls, no accesses (configuration, data, or a language no parser reads)",
  sin_relaciones: "the index saw code, but no relation to measure: no calls, HTTP, tables, endpoints or screens (types or constants, or something the parser could not read)",
};

/**
 * Un archivo que no es de ninguna funcionalidad ni librería. Que un archivo no tenga funcionalidad no dice nada de
 * cuánto lo entendió el índice, así que no entra en el puntaje: va aparte, con la funcionalidad que se le recomienda.
 */
export interface ArchivoSinAsociar {
  archivo: string;
  lenguaje: string;
  capa: string;
  /** La funcionalidad con más indicios, por qué y con qué confianza. Ausente si no hay indicios o si es código compartido. */
  recomendada?: Recomendacion & { confianza: Confianza };
  /** Otras con indicios parecidos (hasta 2), por si la primera no es. */
  otras: Recomendacion[];
  /** Lo usan archivos de dos o más funcionalidades sin que una domine: no es de una sola. */
  compartido?: { funcionalidades: number };
  /** Ningún archivo de su carpeta (ni de las de adentro) tiene dueño: se puede asociar la carpeta entera. */
  carpetaLibre: boolean;
}

export interface Recomendacion {
  id: string;
  /** El motivo en inglés, armado de `senales`: lo lee el MCP y va en el pedido para el agente. */
  motivo: string;
  /** El mismo motivo, estructurado: el visor lo arma en su idioma. Las dos señales más fuertes, de mayor a menor. */
  senales: SenalDeRecomendacion[];
}

/**
 * Un indicio de que el archivo es de la funcionalidad recomendada (la del `id` de la recomendación). `endpoints`:
 * atiende endpoints que ella llama; `lo_usan`: lo importan archivos suyos; `usa`: importa archivos suyos; `vecinos`:
 * archivos de su misma carpeta son suyos; `arriba`: archivos de la carpeta de arriba (`carpeta`, sin el repo) son suyos.
 */
export interface SenalDeRecomendacion {
  tipo: "endpoints" | "lo_usan" | "usa" | "vecinos" | "arriba";
  cantidad: number;
  carpeta?: string;
}

/** Qué tan segura es una recomendación: ver `confianzaDe`. */
export type Confianza = "alta" | "media" | "baja";

/** Una cosa que le falta a un archivo para llegar a 100. */
export interface Tarea {
  signal: Signal;
  /** Qué pasa, en llano. */
  que: string;
  /** Qué hay que hacer. */
  hacer: string;
  /**
   * `persona`: se resuelve con un dato que alguien conoce (a qué método llama, qué ruta); el
   * visor lo pide ahí mismo. `agente`: hay que leer código y escribir archivos del cerebro; va al plan para el modelo.
   */
  resuelve: "persona" | "agente";
  lineas: number[];
}

export interface FidelidadParams {
  /** Un archivo (`repo:ruta` o `ruta`): devuelve solo ese, con todo su detalle. */
  archivo?: string;
  /** Rango de puntaje, los dos inclusive. */
  min?: number;
  max?: number;
  /** Solo archivos de esta funcionalidad (id, sufijo o nombre); `ninguna` para los que no tienen. */
  funcionalidad?: string;
  /** Solo archivos de este lenguaje o extensión (`php`, `ts`, `vue`). */
  tipo?: string;
  /** Solo archivos a los que les falta esta signal. */
  signal?: string;
  /** Cuántos archivos listar, de menor a mayor puntaje (por defecto 30; en un plan, 40). */
  limite?: number;
  /** En vez del informe, los archivos de fidelidad incierta (sin ninguna relación para medir) y por qué. */
  inciertos?: boolean;
  /** En vez del informe, un plan en texto para que un modelo lleve a 100 los archivos que pasan los filtros. */
  plan?: boolean;
  /**
   * Con varios cerebros: evidencias de las llamadas HTTP de este cerebro que atiende otro cerebro comunicado o que el
   * registro declara internas. Con esto el puntaje es el mismo que muestra el visor: una llamada con ruta que no se
   * unió ni acá ni allá cuenta como falta.
   */
  cruzadas?: ReadonlySet<string>;
  budget_tokens?: number | null;
}

const EXT = /\.([A-Za-z0-9]+)$/;
const lineas = (xs: number[]) => {
  const u = [...new Set(xs)].sort((a, b) => a - b);
  return u.length > 6 ? `L${u.slice(0, 6).join(", L")} and ${u.length - 6} more` : `L${u.join(", L")}`;
};
/** "1 llamada" / "3 llamadas". */
const cuantos = (c: number, uno: string, varios: string) => `${c} ${c === 1 ? uno : varios}`;
const redondo = (n: number) => Math.round(n * 10) / 10;

export interface OpcionesFidelidad {
  /**
   * Con varios cerebros: evidencias (`repo:ruta#Ln`) de las llamadas HTTP de este cerebro que se unieron a un endpoint
   * de otro. Si viene, una llamada con ruta que no se unió ni acá ni allá cuenta como falta; si no viene, se da por
   * entendida (no se sabe si hay otro cerebro que la atienda).
   */
  cruzadas?: ReadonlySet<string>;
  /**
   * Lo que una persona marcó como no de producto (`not-product.yaml`). Sin él, el del contexto (`cargarContexto` lo
   * lee); quien arma el contexto desde `_build` lo pasa acá.
   */
  noProducto?: readonly MarcaNoProducto[];
}

/** Una marca «No es de producto» con cuántos archivos sin dueño cubre hoy (0: ya no tapa nada, se puede sacar). */
export interface IgnoradoSinAsociar extends MarcaNoProducto {
  archivos: number;
}

/** Un contexto con índice de código desde los contenidos de `_build`, para quien no tiene uno armado (el visor). */
export const contextoDeFuentes = (graph: Graph, fichas: Ficha[], archivos: string[], extracciones: string[], contratos: Contrato[] = []): Contexto => crearContexto(graph, contratos, new Map(), crearIndiceCodigo(graph, fichas, archivos, extracciones));

/** Lo mismo que `fidelidadDeArchivos`, desde los contenidos de `_build` (para quien no tiene un contexto armado). */
export function fidelidadDeFuentes(graph: Graph, fichas: Ficha[], archivos: string[], extracciones: string[], opciones: OpcionesFidelidad = {}) {
  return fidelidadDeArchivos(contextoDeFuentes(graph, fichas, archivos, extracciones), opciones);
}

/** Puntaje de cada archivo del índice que se puede medir, y cuáles no se pudieron medir. Sin filtros ni recortes. */
export function fidelidadDeArchivos(ctx: Contexto, opciones: OpcionesFidelidad = {}): { archivos: FidelidadArchivo[]; inciertos: ArchivoIncierto[]; sinAsociar: ArchivoSinAsociar[]; noProducto: IgnoradoSinAsociar[] } {
  const ix = ctx.codigo;
  if (!ix) throw new ConsultaError("parametro_invalido", "there is no code index: run `flowbrain index <repo>` and `flowbrain compile`");
  const archivoDe = (k: string) => k.slice(0, k.lastIndexOf("#"));

  // Lo que cada funcionalidad o librería declara como suyo.
  const dueños = [
    ...[...ix.fichas.values()].flatMap((f) => f.codigo.map((c) => ({ id: f.id, codigo: c, feat: true }))),
    ...ctx.graph.nodes.filter((n) => n.tipo === "lib").flatMap((n) => ((n.atributos["codigo"] as string[] | undefined) ?? []).map((c) => ({ id: n.id, codigo: c, feat: false }))),
  ];
  const hayFuncionalidades = ix.fichas.size > 0;
  // Lo marcado como no de producto no se lista como sin asociar: no tiene por qué ser de una funcionalidad.
  const marcas = opciones.noProducto ?? ctx.noProducto ?? [];
  const tapados = new Map(marcas.map((m) => [m.entrada, 0]));
  const marcaDe = (archivo: string) => marcas.find((m) => dentroDe(archivo, m.entrada));

  // Llamadas HTTP que no se unieron a nada, por archivo.
  const pendientes = new Map<string, { conRuta: number; sinDestino: number[]; sinRuta: number[] }>();
  for (const l of ix.llamadasPendientes) {
    const m = l.llamada ? /^(.*)#L(\d+)$/.exec(l.evidencia) : null;
    if (!m) continue;
    const p = pendientes.get(m[1]!) ?? pendientes.set(m[1]!, { conRuta: 0, sinDestino: [], sinRuta: [] }).get(m[1]!)!;
    if (l.llamada!.ruta === null) p.sinRuta.push(Number(m[2]));
    else if (opciones.cruzadas && !opciones.cruzadas.has(l.evidencia)) p.sinDestino.push(Number(m[2]));
    else p.conRuta++;
  }

  // Endpoints atendidos en cada archivo.
  const entradas = new Map<string, { total: number; sinDestino: string[]; sinRespuesta: string[]; programadas: number }>();
  for (const [k, eps] of ix.atiende) {
    const e = entradas.get(archivoDe(k)) ?? entradas.set(archivoDe(k), { total: 0, sinDestino: [], sinRespuesta: [], programadas: 0 }).get(archivoDe(k))!;
    for (const ep of eps) {
      const n = ctx.nodo.get(ep);
      const ref = n ? `${String(n.atributos["metodo"])} ${String(n.atributos["ruta"])}` : ep;
      e.total++;
      if (!ix.recorredor.desdeEndpoint(ep).pasos.some((x) => x.toca.length)) e.sinDestino.push(ref);
      // Una tarea programada no devuelve nada a nadie: no cuenta para el contrato.
      if (n?.atributos["metodo"] === "CRON") e.programadas++;
      else if (n?.atributos["response"] == null) e.sinRespuesta.push(ref);
    }
  }

  // Pantallas dibujadas por un componente de cada archivo.
  const mudas = new Set(ctx.graph.nodes.some((n) => n.tipo === "pantalla") ? pantallasSinLlamadas(ctx) : []);
  const pantallas = new Map<string, { total: number; mudas: string[] }>();
  for (const n of ctx.graph.nodes) {
    if (n.tipo !== "pantalla") continue;
    const comp = ((n.atributos as { componentes?: string[] }).componentes ?? [])[0];
    if (!comp) continue;
    const p = pantallas.get(archivoDe(comp)) ?? pantallas.set(archivoDe(comp), { total: 0, mudas: [] }).get(archivoDe(comp))!;
    p.total++;
    if (mudas.has(n.id)) p.mudas.push(String(n.atributos["ruta"] ?? n.id));
  }

  const archivos: FidelidadArchivo[] = [], inciertos: ArchivoIncierto[] = [];
  /** Funcionalidades dueñas de cada archivo (los de una librería quedan con lista vacía) y los que no tienen dueño. */
  const featsDe = new Map<string, string[]>();
  const sueltos: Array<{ archivo: string; lenguaje: string; capa: string }> = [];
  for (const [archivo, e] of [...ix.estructura.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const ruta = archivo.slice(archivo.indexOf(":") + 1);
    if (ES_TEST.test(ruta)) continue;
    const suyos = dueños.filter((x) => dentroDe(archivo, x.codigo));
    const lenguaje = (ctx.nodo.get(archivo)?.atributos["lenguaje"] as string | undefined) ?? EXT.exec(ruta)?.[1]?.toLowerCase() ?? "otro";
    const marca = suyos.length || !hayFuncionalidades ? undefined : marcaDe(archivo);
    if (marca) tapados.set(marca.entrada, tapados.get(marca.entrada)! + 1);
    if (suyos.length) featsDe.set(archivo, [...new Set(suyos.filter((x) => x.feat).map((x) => x.id))].sort(cmp));
    else if (hayFuncionalidades && !marca) sueltos.push({ archivo, lenguaje, capa: capaDe(ruta) });
    const signals: FidelidadArchivo["signals"] = {};
    const faltas: string[] = [];
    const tareas: Tarea[] = [];
    const tarea = (signal: Signal, resuelve: Tarea["resuelve"], que: string, hacer: string, ls: number[] = []) => tareas.push({ signal, que, hacer, resuelve, lineas: [...new Set(ls)].sort((a, b) => a - b) });

    const sinResolver = e.sinResolver ?? [];
    if (e.invoca.length + sinResolver.length) {
      signals.llamadas = { ok: e.invoca.length, total: e.invoca.length + sinResolver.length };
      if (sinResolver.length) faltas.push(`${cuantos(sinResolver.length, "unresolved call", "unresolved calls")} (${lineas(sinResolver.map((s) => s.linea))}): declare them in calls.yaml or with an extractor`);
      if (sinResolver.length) tarea("llamadas", "persona", `${cuantos(sinResolver.length, "call", "calls")} whose target method is unknown: the code does not say it with types`, "Say which method each one goes to. It is saved in calls.yaml and enters the index on reindex.", sinResolver.map((s) => s.linea));
    }

    const d = ix.porArchivo.get(archivo), pen = pendientes.get(archivo);
    const http = (d?.llamadas ?? 0) + (pen?.conRuta ?? 0) + (pen?.sinDestino.length ?? 0) + (pen?.sinRuta.length ?? 0);
    if (http) {
      signals.http = { ok: (d?.llamadas ?? 0) + (pen?.conRuta ?? 0), total: http };
      if (pen?.sinDestino.length) faltas.push(`${cuantos(pen.sinDestino.length, "HTTP call not linked", "HTTP calls not linked")} to any endpoint, in this brain or the connected ones (${lineas(pen.sinDestino)}): check the path or declare it in the http section of calls.yaml`);
      if (pen?.sinDestino.length) tarea("http", "agente", `${cuantos(pen.sinDestino.length, "HTTP call with a path no endpoint serves", "HTTP calls with a path no endpoint serves")}, in this brain or the connected ones`, "Check whether the path was read correctly or whether the service that serves it is not indexed.", pen.sinDestino);
      if (pen?.sinRuta.length) faltas.push(`${cuantos(pen.sinRuta.length, "HTTP call", "HTTP calls")} without a path (${lineas(pen.sinRuta)}): the http section of calls.yaml or an extractor`);
      if (pen?.sinRuta.length) tarea("http", "persona", `${cuantos(pen.sinRuta.length, "HTTP call whose path could not be read", "HTTP calls whose path could not be read")}: it is built while the program runs`, "Write the path each one calls, for example /orders/{id}. It is saved in calls.yaml.", pen.sinRuta);
    }

    const accesos = (d?.accesos ?? 0) + (d?.sinPagina.length ?? 0);
    if (accesos) {
      signals.datos = { ok: d!.conColumnas, total: accesos };
      if (d!.sinPagina.length) faltas.push(`${cuantos(d!.sinPagina.length, "access", "accesses")} to tables without a page (${[...new Set(d!.sinPagina.map((s) => s.tabla))].sort(cmp).slice(0, 5).join(", ")}; ${lineas(d!.sinPagina.map((s) => s.linea))})`);
      if (d!.accesos - d!.conColumnas > 0) faltas.push(`${cuantos(d!.accesos - d!.conColumnas, "access", "accesses")} to tables without columns`);
      if (d!.sinPagina.length) tarea("datos", "agente", `Touches ${cuantos(new Set(d!.sinPagina.map((s) => s.tabla)).size, "table the brain does not know", "tables the brain does not know")} (${[...new Set(d!.sinPagina.map((s) => s.tabla))].sort(cmp).slice(0, 5).join(", ")})`, "Create the page of each table in the brain.", d!.sinPagina.map((s) => s.linea));
      if (d!.accesos - d!.conColumnas > 0) tarea("datos", "agente", `${cuantos(d!.accesos - d!.conColumnas, "table access", "table accesses")} without knowing which columns ${d!.accesos - d!.conColumnas === 1 ? "it touches" : "they touch"}`, "Teach the index to read the columns, with an extractor.");
    }

    const en = entradas.get(archivo);
    if (en) {
      signals.entradas = { ok: en.total - en.sinDestino.length, total: en.total };
      if (en.total > en.programadas) signals.contrato = { ok: en.total - en.programadas - en.sinRespuesta.length, total: en.total - en.programadas };
      if (en.sinDestino.length) faltas.push(`${cuantos(en.sinDestino.length, "endpoint", "endpoints")} whose flow reaches nothing (${en.sinDestino.sort(cmp).slice(0, 4).join(", ")}${en.sinDestino.length > 4 ? "…" : ""})`);
      if (en.sinRespuesta.length) faltas.push(`${cuantos(en.sinRespuesta.length, "endpoint", "endpoints")} without a response type`);
      const refs = (xs: string[]) => `${xs.slice(0, 4).join(", ")}${xs.length > 4 ? "…" : ""}`;
      if (en.sinDestino.length) tarea("entradas", "agente", `${cuantos(en.sinDestino.length, "endpoint whose flow stops", "endpoints whose flow stops")} before reaching a table, a service or a queue (${refs(en.sinDestino)})`, "Follow the flow in the code and declare the call where it stops.");
      if (en.sinRespuesta.length) tarea("contrato", "agente", `${cuantos(en.sinRespuesta.length, "endpoint", "endpoints")} with an unknown return type (${refs([...en.sinRespuesta].sort(cmp))})`, "Teach the index to read the response type, with an extractor.");
    }

    const pa = pantallas.get(archivo);
    if (pa) {
      signals.pantallas = { ok: pa.total - pa.mudas.length, total: pa.total };
      if (pa.mudas.length) faltas.push(`${cuantos(pa.mudas.length, "screen", "screens")} without detected HTTP calls (${pa.mudas.sort(cmp).slice(0, 4).join(", ")}${pa.mudas.length > 4 ? "…" : ""})`);
      if (pa.mudas.length) tarea("pantallas", "agente", `${cuantos(pa.mudas.length, "screen", "screens")} with no visible call to the back end (${pa.mudas.slice(0, 4).join(", ")}${pa.mudas.length > 4 ? "…" : ""})`, "Find how it requests its data (a store, a hook, its own client) and teach it to the index.");
    }

    // Sin ninguna relación que medir, la fidelidad es incierta: no hay con qué decir cuánto se entendió.
    if (!Object.keys(signals).length) {
      inciertos.push({ archivo, motivo: e.simbolos.length ? "sin_relaciones" : "sin_nada", lenguaje, capa: capaDe(ruta), funcionalidades: featsDe.get(archivo) ?? [] });
      continue;
    }

    let suma = 0, peso = 0;
    for (const s of SIGNALS) {
      const v = signals[s];
      if (!v) continue;
      suma += PESOS[s] * (v.ok / v.total);
      peso += PESOS[s];
    }
    archivos.push({ archivo, puntaje: Math.round((100 * suma) / peso), lenguaje, capa: capaDe(ruta), funcionalidades: featsDe.get(archivo) ?? [], signals, faltas, tareas, ...(!suyos.length && hayFuncionalidades && !marca ? { sinAsociar: true as const } : {}) });
  }

  const noProducto = marcas.map((m) => ({ ...m, archivos: tapados.get(m.entrada) ?? 0 })).sort((a, b) => cmp(a.entrada, b.entrada));
  return { archivos, inciertos, sinAsociar: recomendar(ctx, sueltos, featsDe), noProducto };
}

const PESO_LO_USAN = 3, PESO_USA = 2, PESO_ENDPOINT = 4, PESO_VECINO = 1, PESO_VECINO_ARRIBA = 0.5, TOPE_VECINOS = 5;
/** La segunda candidata junta como mucho esta parte de los puntos de la primera: la primera gana clara. */
const MARGEN_CLARO = 0.5;
/** La segunda junta esta parte o más: están casi empatadas, el margen es chico. */
const MARGEN_CHICO = 0.8;

/**
 * La confianza de una recomendación, según de dónde salen sus votos y cuánto le saca a la segunda:
 * - `alta`: tiene votos directos (atiende endpoints que la funcionalidad llama, o hay imports en un sentido u otro:
 *   PESO_ENDPOINT, PESO_LO_USAN, PESO_USA), esos votos solos le ganan a todo lo que junta la segunda, y la segunda
 *   no pasa de MARGEN_CLARO de sus puntos (o no hay segunda). Es la que se puede aceptar en lote.
 * - `baja`: solo la votan los vecinos de carpeta (PESO_VECINO o PESO_VECINO_ARRIBA), que dicen dónde está el
 *   archivo y no qué hace; o la segunda junta MARGEN_CHICO de sus puntos o más (casi un empate).
 * - `media`: el resto, como votos directos con una segunda que no queda lejos, o directos que solos no alcanzan.
 */
export function confianzaDe(primera: { directos: number; puntos: number }, segunda: { puntos: number } | undefined): Confianza {
  const otra = segunda?.puntos ?? 0;
  if (!primera.directos || otra >= MARGEN_CHICO * primera.puntos) return "baja";
  if (primera.directos > otra && otra <= MARGEN_CLARO * primera.puntos) return "alta";
  return "media";
}

/** El texto en inglés de una señal, el de siempre para el MCP y el pedido para el agente. */
function motivoEnIngles(s: SenalDeRecomendacion, feat: string): string {
  switch (s.tipo) {
    case "endpoints": return `serves ${cuantos(s.cantidad, "endpoint", "endpoints")} called by ${feat}`;
    case "lo_usan": return `imported by ${cuantos(s.cantidad, "file", "files")} of ${feat}`;
    case "usa": return `imports ${cuantos(s.cantidad, "file", "files")} of ${feat}`;
    case "vecinos": return `${cuantos(s.cantidad, "folder neighbor belongs", "folder neighbors belong")} to ${feat}`;
    case "arriba": return `${cuantos(s.cantidad, "file", "files")} in ${s.carpeta}/ ${s.cantidad === 1 ? "belongs" : "belong"} to ${feat}`;
  }
}

/**
 * A cada archivo sin dueño, la funcionalidad con más indicios. De más fuerte a más débil: atiende un endpoint que una
 * funcionalidad llama; lo importan archivos de una funcionalidad; importa archivos de una funcionalidad; sus vecinos
 * de carpeta (o de la carpeta de arriba) son de una funcionalidad. Si lo usan dos o más funcionalidades y ninguna
 * junta el 60 % de los usos, no se recomienda ninguna: es código compartido. Cada recomendada lleva su confianza
 * (`confianzaDe`) y su motivo en dos formas: el texto en inglés y las señales, para que el visor lo diga en su idioma.
 */
function recomendar(ctx: Contexto, sueltos: Array<{ archivo: string; lenguaje: string; capa: string }>, featsDe: Map<string, string[]>): ArchivoSinAsociar[] {
  const ix = ctx.codigo!;
  const nombre = (id: string) => ctx.nodo.get(id)?.nombre ?? id;
  const carpetasDe = (archivo: string) => {
    const out: string[] = [];
    for (let i = archivo.lastIndexOf("/"); i > archivo.indexOf(":"); i = archivo.lastIndexOf("/", i - 1)) out.push(archivo.slice(0, i));
    return out;
  };
  // Quién importa a quién, y qué carpetas tienen adentro algún archivo con dueño.
  const loImportan = new Map<string, string[]>();
  const porCarpeta = new Map<string, Map<string, number>>();
  const conDueño = new Set<string>();
  for (const [k, feats] of featsDe) {
    const cs = carpetasDe(k);
    for (const c of cs) conDueño.add(c);
    if (cs[0]) {
      const m = porCarpeta.get(cs[0]) ?? porCarpeta.set(cs[0], new Map()).get(cs[0])!;
      for (const f of feats) m.set(f, (m.get(f) ?? 0) + 1);
    }
    const repo = k.slice(0, k.indexOf(":"));
    for (const i of ix.estructura.get(k)?.importa ?? []) (loImportan.get(`${repo}:${i}`) ?? loImportan.set(`${repo}:${i}`, []).get(`${repo}:${i}`)!).push(k);
  }
  // Endpoints atendidos en cada archivo y qué funcionalidades los llaman (desde sus pantallas o su código).
  const endpointsDe = new Map<string, string[]>();
  for (const [k, eps] of ix.atiende) {
    const a = k.slice(0, k.lastIndexOf("#"));
    endpointsDe.set(a, [...(endpointsDe.get(a) ?? []), ...eps]);
  }
  const llaman = new Map<string, Set<string>>();
  for (const f of ix.fichas.values()) {
    for (const ep of [...f.usa.flatMap((u) => (u.endpoint ? [u.endpoint] : [])), ...f.pantallas.flatMap((x) => x.endpoints)]) (llaman.get(ep) ?? llaman.set(ep, new Set()).get(ep)!).add(f.id);
  }

  return sueltos.map(({ archivo, lenguaje, capa }) => {
    const repo = archivo.slice(0, archivo.indexOf(":"));
    const cuenta = new Map<string, { loUsan: number; usa: number; endpoints: number; vecinos: number; arriba: number; carpeta: string }>();
    const de = (id: string) => cuenta.get(id) ?? cuenta.set(id, { loUsan: 0, usa: 0, endpoints: 0, vecinos: 0, arriba: 0, carpeta: "" }).get(id)!;
    for (const k of loImportan.get(archivo) ?? []) for (const f of featsDe.get(k) ?? []) de(f).loUsan++;
    for (const i of ix.estructura.get(archivo)?.importa ?? []) for (const f of featsDe.get(`${repo}:${i}`) ?? []) de(f).usa++;
    for (const ep of new Set(endpointsDe.get(archivo) ?? [])) for (const f of llaman.get(ep) ?? []) de(f).endpoints++;
    const [propia, arriba] = carpetasDe(archivo);
    for (const [f, n] of porCarpeta.get(propia ?? "") ?? []) Object.assign(de(f), { vecinos: n, carpeta: propia });
    for (const [f, n] of porCarpeta.get(arriba ?? "") ?? []) Object.assign(de(f), { arriba: n, carpeta: de(f).carpeta || arriba });
    const corta = (c: string) => c.slice(c.indexOf(":") + 1);
    const candidatas = [...cuenta.entries()]
      .map(([id, c]) => {
        const senales: SenalDeRecomendacion[] = [
          ...(c.endpoints ? [{ tipo: "endpoints" as const, cantidad: c.endpoints }] : []),
          ...(c.loUsan ? [{ tipo: "lo_usan" as const, cantidad: c.loUsan }] : []),
          ...(c.usa ? [{ tipo: "usa" as const, cantidad: c.usa }] : []),
          ...(c.vecinos ? [{ tipo: "vecinos" as const, cantidad: c.vecinos }] : c.arriba ? [{ tipo: "arriba" as const, cantidad: c.arriba, carpeta: corta(arriba!) }] : []),
        ].slice(0, 2);
        return {
          id,
          directos: PESO_ENDPOINT * c.endpoints + PESO_LO_USAN * c.loUsan + PESO_USA * c.usa,
          puntos: PESO_ENDPOINT * c.endpoints + PESO_LO_USAN * c.loUsan + PESO_USA * c.usa + PESO_VECINO * Math.min(c.vecinos, TOPE_VECINOS) + PESO_VECINO_ARRIBA * Math.min(c.arriba, TOPE_VECINOS),
          motivo: senales.map((s) => motivoEnIngles(s, nombre(id))).join("; "),
          senales,
        };
      })
      .sort((a, b) => b.puntos - a.puntos || cmp(a.id, b.id));
    const usos = [...cuenta.values()].reduce((n, c) => n + c.loUsan, 0);
    const queLoUsan = [...cuenta.entries()].filter(([, c]) => c.loUsan);
    const compartido = queLoUsan.length >= 2 && Math.max(...queLoUsan.map(([, c]) => c.loUsan)) < 0.6 * usos;
    const [primera, ...resto] = candidatas;
    return {
      archivo,
      lenguaje,
      capa,
      ...(primera && !compartido ? { recomendada: { id: primera.id, motivo: primera.motivo, senales: primera.senales, confianza: confianzaDe(primera, resto[0]) } } : {}),
      otras: (compartido ? candidatas : resto).filter((c) => !primera || c.puntos >= 0.4 * primera.puntos).slice(0, 2).map((c) => ({ id: c.id, motivo: c.motivo, senales: c.senales })),
      ...(compartido ? { compartido: { funcionalidades: queLoUsan.length } } : {}),
      carpetaLibre: !!propia && !conDueño.has(propia),
    };
  });
}

/** Cómo resuelve el agente cada tipo de falta. Lo usan el plan del CLI y del MCP, y el que arma el visor. */
export const COMO_RESOLVER: Record<Signal, string> = {
  llamadas: "Open the file at the given line, identify which concrete method the call goes to and declare it in the brain's `calls.yaml`, section `llamadas`: `{ desde: \"repo:path#Symbol\", linea: N, hacia: \"repo:path#Class.method\", origen: \"modelo\" }`. `flowbrain calls` lists the calls with their candidates.",
  http: "Open the file at the given line and rebuild the path by reading where the URL comes from. Declare it in `calls.yaml`, section `http`: `{ desde: \"repo:path#Symbol\", linea: N, metodo: \"GET\", ruta: \"/path/{id}\", origen: \"modelo\" }`. If the path was already read and nobody serves it, check with `flowbrain drift` whether the endpoint exists in another form or belongs to an unindexed service.",
  datos: "For a table without a page, create its page in the brain (use an existing table page as a model). For accesses without columns, the index cannot read how this code names the columns: follow `flowbrain coverage --guide` and write or adjust an extractor.",
  entradas: "Run `flowbrain flow \"METHOD /path\"` to see where the flow stops. It is almost always an unresolved call along the way: declare it in `calls.yaml` (section `llamadas`). If the endpoint really touches no data or other services, note it and move on.",
  contrato: "The index could not read what the endpoint returns. Follow `flowbrain coverage --guide` to teach it to read this framework's response type with an extractor.",
  pantallas: "Run `flowbrain screen <path>` and look in the code for how the screen requests its data (a store, a hook, its own client). If it calls through a path the index does not follow, declare it in `calls.yaml` or teach it with an extractor (`flowbrain coverage --guide`). If the screen really does not call the back end, note it.",
};

/** Reglas del plan: valen para cualquier falta. */
export const REGLAS_DEL_PLAN = [
  "Edit only brain files (pages, `calls.yaml`, extractors). Never the project code.",
  "Before declaring anything, open the file at the given line. Do not declare anything you have not seen in the code.",
  "If you cannot determine a fact, don't make it up: note it as pending and move on to the next one.",
  "Check off each task when you finish it.",
];

/** Qué correr al terminar, para que las declaraciones entren al índice y se vea el puntaje nuevo. */
export const CIERRE_DEL_PLAN = [
  "Reindex each brain you touched: `flowbrain brains apply <brain>`.",
  "Check the score: `flowbrain fidelity --max 99` (with `--brain <brain>` if there are several) lists what is still below 100.",
  "Report what reached 100, what didn't and why.",
];

export interface OpcionesPlan {
  /** Solo estos tipos de falta (por defecto, todos). */
  signals?: readonly Signal[];
  /** Cuántos archivos entran al plan, de menor a mayor puntaje (por defecto 40). */
  limite?: number;
  /** Párrafos que van después del objetivo (una tanda de un lote del visor dice de qué cerebro es y cuál es). */
  contexto?: readonly string[];
}

/** Lo que el plan lee de cada archivo: su id, su puntaje y sus faltas (lo que manda el visor alcanza). */
export interface ArchivoDelPlan {
  archivo: string;
  puntaje: number;
  tareas: ReadonlyArray<Pick<Tarea, "signal" | "que" | "lineas">>;
}

/**
 * Plan para pegarle a un modelo: los archivos que no llegan a 100, qué le falta a cada uno con su línea, y cómo se
 * resuelve cada tipo de falta. Es texto: el modelo que lo recibe tiene el código y el MCP para hacer el resto. Lo usan
 * `flowbrain fidelity --plan`, el MCP y cada tanda de un lote «fidelidad» del visor (dec. 231).
 */
export function planDeFidelidad(archivos: readonly ArchivoDelPlan[], opciones: OpcionesPlan = {}): string {
  const quiere = new Set<Signal>(opciones.signals?.length ? opciones.signals : SIGNALS);
  const limite = opciones.limite ?? 40;
  const conTareas = archivos
    .map((a) => ({ a, tareas: a.tareas.filter((t) => quiere.has(t.signal)) }))
    .filter((x) => x.tareas.length)
    .sort((x, y) => x.a.puntaje - y.a.puntaje || cmp(x.a.archivo, y.a.archivo));
  if (!conTareas.length) return "# Fidelity plan\n\nNothing to do: no file in the selection has gaps of that kind.\n";
  const elegidos = conTareas.slice(0, limite);
  const usadas = SIGNALS.filter((s) => elegidos.some((x) => x.tareas.some((t) => t.signal === s)));
  const out = [
    "# Fidelity plan",
    "",
    `Goal: bring the fidelity score of ${cuantos(elegidos.length, "file", "files")} in the FlowBrain index to 100 (today they average ${promedio(elegidos.map((x) => x.a))}). The score measures how much of what is in each file ended up linked in the graph.`,
    ...(conTareas.length > elegidos.length ? ["", `This plan includes the ${elegidos.length} lowest-scoring files; ${conTareas.length - elegidos.length} more are left for another batch.`] : []),
    ...(opciones.contexto ?? []).flatMap((c) => ["", c]),
    "",
    "## Rules",
    "",
    ...REGLAS_DEL_PLAN.map((r) => `- ${r}`),
    "",
    "## How to resolve each thing",
    "",
    ...usadas.map((s) => `- **${s}**: ${COMO_RESOLVER[s]}`),
    "",
    "## Files",
    ...elegidos.flatMap(({ a, tareas }) => [
      "",
      `### ${a.archivo} (${a.puntaje}/100)`,
      ...tareas.map((t) => `- [ ] ${t.signal}: ${t.que}${t.lineas.length ? ` (${lineas(t.lineas)})` : ""}.`),
    ]),
    "",
    "## When done",
    "",
    ...CIERRE_DEL_PLAN.map((c, i) => `${i + 1}. ${c}`),
    "",
  ];
  return out.join("\n");
}

const TRAMOS: Array<[string, number, number]> = [["0-19", 0, 19], ["20-39", 20, 39], ["40-59", 40, 59], ["60-79", 60, 79], ["80-99", 80, 99], ["100", 100, 100]];
const promedio = (xs: ReadonlyArray<{ puntaje: number }>) => (xs.length ? redondo(xs.reduce((a, x) => a + x.puntaje, 0) / xs.length) : null);

function agrupar(xs: FidelidadArchivo[], claves: (x: FidelidadArchivo) => string[]) {
  const m = new Map<string, FidelidadArchivo[]>();
  for (const x of xs) for (const k of claves(x)) (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  return [...m.entries()].map(([id, v]) => ({ id, archivos: v.length, puntaje: promedio(v)! })).sort((a, b) => a.puntaje - b.puntaje || cmp(a.id, b.id));
}

/**
 * Informe de fidelidad de un brain: el puntaje general, cómo se reparten los archivos, qué signal falla más, el puntaje
 * por funcionalidad, capa y lenguaje, y los archivos de menor puntaje con lo que les falta. Los filtros recortan la
 * lista de archivos; el resumen de arriba es siempre el del brain entero.
 */
export function fidelidad(ctx: Contexto, p: FidelidadParams = {}) {
  const { archivos, inciertos, sinAsociar: sueltos } = fidelidadDeArchivos(ctx, p.cruzadas ? { cruzadas: p.cruzadas } : {});

  if (p.archivo) {
    const q = p.archivo.replace(/#.*$/, "");
    const hits = archivos.filter((a) => a.archivo === q || a.archivo.endsWith(`:${q}`) || a.archivo.endsWith(`/${q}`));
    if (hits.length === 1) return { herramienta: "fidelidad", ...hits[0]!, queMide: Object.fromEntries(Object.keys(hits[0]!.signals).map((s) => [s, QUE_MIDE[s as Signal]])) };
    const inc = inciertos.filter((a) => a.archivo === q || a.archivo.endsWith(`:${q}`) || a.archivo.endsWith(`/${q}`));
    if (inc.length === 1) return { herramienta: "fidelidad", archivo: inc[0]!.archivo, puntaje: null, incierta: true, motivo: `uncertain fidelity: ${POR_QUE_INCIERTA[inc[0]!.motivo]}`, ...(inc[0]!.funcionalidades.length ? { funcionalidades: inc[0]!.funcionalidades } : {}) };
    throw new ConsultaError(hits.length ? "parametro_invalido" : "nodo_inexistente", hits.length ? `several files match ${p.archivo}: ${hits.slice(0, 6).map((a) => a.archivo).join(", ")}` : `no indexed file matches ${p.archivo}`);
  }

  if (p.inciertos) {
    const limite = p.limite ?? 30;
    const r = {
      herramienta: "fidelidad",
      inciertos: inciertos.length,
      medidos: archivos.length,
      porMotivo: {
        sin_relaciones: { archivos: inciertos.filter((a) => a.motivo === "sin_relaciones").length, que: POR_QUE_INCIERTA.sin_relaciones },
        sin_nada: { archivos: inciertos.filter((a) => a.motivo === "sin_nada").length, que: POR_QUE_INCIERTA.sin_nada },
      },
      lista: inciertos.slice(0, limite).map((a) => ({ archivo: a.archivo, motivo: a.motivo, ...(a.funcionalidades.length ? { funcionalidades: a.funcionalidades } : {}) })),
      ...(inciertos.length > limite ? { listaOmitidos: inciertos.length - limite } : {}),
      avisos: ["if an uncertain file has code the index should have read, teach it with an extractor: `flowbrain coverage --guide`"],
    };
    return ajustarLista(r, "lista", p.budget_tokens);
  }

  const min = p.min ?? 0, max = p.max ?? 100;
  if (min < 0 || max > 100 || min > max) throw new ConsultaError("parametro_invalido", "the score range goes from 0 to 100, with min ≤ max");
  if (p.signal && !(SIGNALS as readonly string[]).includes(p.signal)) throw new ConsultaError("parametro_invalido", `unknown signal: ${p.signal}. Available: ${SIGNALS.join(", ")}`);
  let feat: string | null = null;
  if (p.funcionalidad && normalizar(p.funcionalidad) !== "ninguna") {
    const q = normalizar(p.funcionalidad);
    const ids = [...ctx.codigo!.fichas.keys()].filter((id) => normalizar(id) === q || normalizar(id) === `feat-${q}` || normalizar(ctx.nodo.get(id)?.nombre ?? "") === q);
    if (ids.length !== 1) throw new ConsultaError("nodo_inexistente", `could not resolve the feature: ${p.funcionalidad}`);
    feat = ids[0]!;
  }
  const tipo = p.tipo ? normalizar(p.tipo.replace(/^\./, "")) : null;
  const filtrados = archivos
    .filter((a) => a.puntaje >= min && a.puntaje <= max)
    .filter((a) => !p.funcionalidad || (feat ? a.funcionalidades.includes(feat) : !!a.sinAsociar))
    .filter((a) => !tipo || normalizar(a.lenguaje) === tipo || EXT.exec(a.archivo)?.[1]?.toLowerCase() === tipo)
    .filter((a) => {
      const v = p.signal ? a.signals[p.signal as Signal] : undefined;
      return !p.signal || (!!v && v.ok < v.total);
    })
    .sort((a, b) => a.puntaje - b.puntaje || b.faltas.length - a.faltas.length || cmp(a.archivo, b.archivo));

  if (p.plan) return { herramienta: "fidelidad", archivos: filtrados.filter((a) => a.tareas.length).length, plan: planDeFidelidad(filtrados, { ...(p.signal ? { signals: [p.signal as Signal] } : {}), ...(p.limite ? { limite: p.limite } : {}) }) };

  const porSignal = Object.fromEntries(
    SIGNALS.flatMap((s) => {
      let ok = 0, total = 0, conFalta = 0;
      for (const a of archivos) {
        const v = a.signals[s];
        if (!v) continue;
        ok += v.ok;
        total += v.total;
        if (v.ok < v.total) conFalta++;
      }
      return total ? [[s, { ok, total, pct: redondo((100 * ok) / total), archivosConFalta: conFalta, mide: QUE_MIDE[s] }]] : [];
    }),
  );
  const limite = p.limite ?? 30;
  const hayFiltro = min > 0 || max < 100 || !!p.funcionalidad || !!tipo || !!p.signal;
  const r = {
    herramienta: "fidelidad",
    puntaje: promedio(archivos),
    archivos: { medidos: archivos.length, inciertos: inciertos.length, completos: archivos.filter((a) => a.puntaje === 100).length, sinAsociar: sueltos.length },
    distribucion: Object.fromEntries(TRAMOS.map(([k, a, b]) => [k, archivos.filter((x) => x.puntaje >= a && x.puntaje <= b).length])),
    porSignal,
    porFuncionalidad: agrupar(archivos, (a) => (a.funcionalidades.length ? a.funcionalidades : ["ninguna"])),
    porCapa: agrupar(archivos, (a) => [a.capa]),
    porLenguaje: agrupar(archivos, (a) => [a.lenguaje]),
    ...(hayFiltro ? { filtro: { coinciden: filtrados.length, puntaje: promedio(filtrados) } } : {}),
    lista: filtrados.slice(0, limite).map((a) => ({ archivo: a.archivo, puntaje: a.puntaje, ...(a.funcionalidades.length ? { funcionalidades: a.funcionalidades } : {}), faltas: a.faltas })),
    ...(filtrados.length > limite ? { listaOmitidos: filtrados.length - limite } : {}),
    avisos: [
      ...(inciertos.length ? [`${inciertos.length} files with uncertain fidelity: the index found no relation to measure in them. They have no score and do not enter the average. \`inciertos: true\` lists them`] : []),
      ...(sueltos.length ? [`${sueltos.length} files belong to no feature or library. They do not lower the score: \`sin_asociar\` lists them by folder with the recommended feature`] : []),
      "an HTTP call with a path not linked to an endpoint of this brain counts as understood: it may go to another brain (see `conexiones`)",
    ],
  };
  return ajustarLista(r, ["lista", "porFuncionalidad", "porLenguaje"], p.budget_tokens);
}

export interface SinAsociarParams {
  /** Solo los archivos de esta carpeta o de las de adentro (`repo:ruta` o `ruta`). */
  carpeta?: string;
  /** Solo los que tienen recomendada esta funcionalidad (id, sufijo o nombre); `ninguna` para los que no tienen pista. */
  funcionalidad?: string;
  /** Cuántas carpetas listar, de la que más archivos tiene a la que menos (por defecto 30). */
  limite?: number;
  budget_tokens?: number | null;
}

/** Dónde viven las marcas «No es de producto» (`ARCHIVO_NO_PRODUCTO`), dicho para el modelo. */
const ARCHIVO_NO_PRODUCTO_TXT = "the brain's not-product.yaml";

export const COMO_ASOCIAR =
  "To assign: add `repo:path` (the file, or the folder if `carpetaLibre`) to the `codigo` list in the frontmatter of the feature page and compile. The recommendation is a hint: open the file before deciding. `compartido` (shared) code does not go to a feature: it goes to the `codigo` of a `lib` page (common code) or stays unassigned. If no feature covers it, propose a new one with `flowbrain feature --guide`. If it is not product code (tests, configuration, scripts, generated), add it to the `no_producto` list of the brain's `not-product.yaml` (`entrada: repo:path`, `motivo: test | config | script | generado | otro`) so it stops being listed.";

/**
 * Archivos que no son de ninguna funcionalidad ni librería, agrupados por carpeta, con la funcionalidad que se le
 * recomienda a cada grupo y por qué. Es la lista de trabajo para completar el catálogo de funcionalidades.
 */
export function sinAsociar(ctx: Contexto, p: SinAsociarParams = {}) {
  const { sinAsociar: todos, noProducto } = fidelidadDeArchivos(ctx);
  const ignorados = noProducto.reduce((n, m) => n + m.archivos, 0);
  if (!ctx.codigo!.fichas.size) return { herramienta: "sin_asociar", total: 0, carpetas: [], avisos: ["the brain has no features: there is nothing to assign to. First run `flowbrain feature --guide`"] };
  const q = p.carpeta?.replace(/\/+$/, "");
  let feat: string | null = null;
  const sinPista = !!p.funcionalidad && normalizar(p.funcionalidad) === "ninguna";
  if (p.funcionalidad && !sinPista) {
    const n = normalizar(p.funcionalidad);
    const ids = [...ctx.codigo!.fichas.keys()].filter((id) => normalizar(id) === n || normalizar(id) === `feat-${n}` || normalizar(ctx.nodo.get(id)?.nombre ?? "") === n);
    if (ids.length !== 1) throw new ConsultaError("nodo_inexistente", `could not resolve the feature: ${p.funcionalidad}`);
    feat = ids[0]!;
  }
  const carpetaDe = (a: string) => (a.lastIndexOf("/") > a.indexOf(":") ? a.slice(0, a.lastIndexOf("/")) : a.slice(0, a.indexOf(":") + 1));
  const filtrados = todos
    .filter((a) => !q || carpetaDe(a.archivo) === q || carpetaDe(a.archivo).startsWith(`${q}/`) || carpetaDe(a.archivo).endsWith(`:${q}`) || a.archivo.includes(`:${q}/`))
    .filter((a) => (sinPista ? !a.recomendada : !feat || a.recomendada?.id === feat));
  const grupos = new Map<string, ArchivoSinAsociar[]>();
  for (const a of filtrados) (grupos.get(carpetaDe(a.archivo)) ?? grupos.set(carpetaDe(a.archivo), []).get(carpetaDe(a.archivo))!).push(a);
  const carpetas = [...grupos.entries()]
    .map(([carpeta, xs]) => {
      // La recomendada de la carpeta: la que más archivos suyos tienen recomendada.
      const votos = new Map<string, number>();
      for (const x of xs) if (x.recomendada) votos.set(x.recomendada.id, (votos.get(x.recomendada.id) ?? 0) + 1);
      const [id, n] = [...votos.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0] ?? [];
      return {
        carpeta,
        archivos: xs.length,
        // Solo si la recomiendan más de la mitad de sus archivos: con menos, la carpeta no es de una sola.
        ...(id && 2 * n! > xs.length ? { recomendada: { id, nombre: ctx.nodo.get(id)?.nombre ?? id, archivos: n! } } : {}),
        carpetaLibre: xs[0]!.carpetaLibre,
        ...(xs.some((x) => x.compartido) ? { compartidos: xs.filter((x) => x.compartido).length } : {}),
        lista: xs.slice(0, 8).map((x) => ({ archivo: x.archivo, ...(x.recomendada ? { recomendada: x.recomendada.id, motivo: x.recomendada.motivo, confianza: x.recomendada.confianza } : {}), ...(x.otras.length ? { otras: x.otras.map((o) => o.id) } : {}), ...(x.compartido ? { compartido: `used by ${x.compartido.funcionalidades} features` } : {}) })),
        ...(xs.length > 8 ? { masArchivos: xs.length - 8 } : {}),
      };
    })
    .sort((a, b) => b.archivos - a.archivos || cmp(a.carpeta, b.carpeta));
  const limite = p.limite ?? 30;
  const r = {
    herramienta: "sin_asociar",
    total: todos.length,
    conRecomendacion: todos.filter((a) => a.recomendada).length,
    compartidos: todos.filter((a) => a.compartido).length,
    sinPista: todos.filter((a) => !a.recomendada && !a.compartido).length,
    ...(q || p.funcionalidad ? { filtro: { coinciden: filtrados.length } } : {}),
    carpetas: carpetas.slice(0, limite),
    ...(carpetas.length > limite ? { carpetasOmitidas: carpetas.length - limite } : {}),
    // Lo marcado como no de producto (`not-product.yaml`): no se lista, pero se dice cuánto es y se puede deshacer.
    ignorados,
    ...(noProducto.length ? { noProducto: noProducto.map((m) => ({ entrada: m.entrada, motivo: m.motivo, archivos: m.archivos })) } : {}),
    avisos: [
      ...(todos.length ? [COMO_ASOCIAR] : [ignorados ? "every other file in the index belongs to some feature or library" : "every file in the index belongs to some feature or library"]),
      ...(noProducto.length ? [`${ignorados} ${ignorados === 1 ? "file is" : "files are"} not listed because ${noProducto.length === 1 ? "an entry" : `${noProducto.length} entries`} of ${ARCHIVO_NO_PRODUCTO_TXT} ${noProducto.length === 1 ? "marks it" : "mark them"} as not product code (tests, configuration, scripts, generated); see \`noProducto\`. To list them again, remove the entry (or use «Undo» in the viewer)`] : []),
    ],
  };
  return ajustarLista(r, "carpetas", p.budget_tokens);
}

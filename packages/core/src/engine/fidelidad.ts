import { cmp } from "../canonical.js";
import { capaDe, ES_TEST, type Ficha } from "../funcionalidades.js";
import { dentroDe, type Graph } from "../schema.js";
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
 * encontró nada (ni símbolos, ni llamadas, ni accesos) no tiene puntaje: no hay con qué medirlo, y se informa aparte.
 */

export const SIGNALS = ["llamadas", "http", "datos", "entradas", "contrato", "pantallas", "funcionalidad"] as const;
export type Signal = (typeof SIGNALS)[number];

/** Peso de cada signal en el puntaje. Las que salen del código pesan el doble que las de clasificación. */
export const PESOS: Record<Signal, number> = { llamadas: 2, http: 2, datos: 2, entradas: 2, contrato: 1, pantallas: 1, funcionalidad: 1 };

/** Qué mide cada signal, para quien lee el informe. */
export const QUE_MIDE: Record<Signal, string> = {
  llamadas: "llamadas entre métodos que el índice pudo atribuir a su destino",
  http: "llamadas HTTP unidas a un endpoint o a un externo (con un solo cerebro, alcanza con que tengan ruta)",
  datos: "accesos a tablas que tienen página y dicen qué columnas tocan",
  entradas: "endpoints atendidos acá cuyo recorrido llega a una tabla, un servicio o una cola",
  contrato: "endpoints atendidos acá con tipo de respuesta",
  pantallas: "pantallas dibujadas acá desde las que se llega a una llamada HTTP",
  funcionalidad: "el archivo pertenece a una funcionalidad o a una librería",
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
  /** Si no es de ninguna funcionalidad: la de sus vecinos de carpeta, como sugerencia. */
  sugerida?: { id: string; motivo: string };
}

/** Una cosa que le falta a un archivo para llegar a 100. */
export interface Tarea {
  signal: Signal;
  /** Qué pasa, en llano. */
  que: string;
  /** Qué hay que hacer. */
  hacer: string;
  /**
   * `persona`: se resuelve con un dato que alguien conoce (a qué funcionalidad va, a qué método llama, qué ruta); el
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
  /** En vez del informe, un plan en texto para que un modelo lleve a 100 los archivos que pasan los filtros. */
  plan?: boolean;
  budget_tokens?: number | null;
}

const EXT = /\.([A-Za-z0-9]+)$/;
const lineas = (xs: number[]) => {
  const u = [...new Set(xs)].sort((a, b) => a - b);
  return u.length > 6 ? `L${u.slice(0, 6).join(", L")} y ${u.length - 6} más` : `L${u.join(", L")}`;
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
}

/** Lo mismo que `fidelidadDeArchivos`, desde los contenidos de `_build` (para quien no tiene un contexto armado). */
export function fidelidadDeFuentes(graph: Graph, fichas: Ficha[], archivos: string[], extracciones: string[], opciones: OpcionesFidelidad = {}) {
  return fidelidadDeArchivos(crearContexto(graph, [], new Map(), crearIndiceCodigo(graph, fichas, archivos, extracciones)), opciones);
}

/** Puntaje de cada archivo del índice que se puede medir, y cuáles no se pudieron medir. Sin filtros ni recortes. */
export function fidelidadDeArchivos(ctx: Contexto, opciones: OpcionesFidelidad = {}): { archivos: FidelidadArchivo[]; sinDatos: string[] } {
  const ix = ctx.codigo;
  if (!ix) throw new ConsultaError("parametro_invalido", "no hay índice de código: corré `flowbrain index <repo>` y `flowbrain compile`");
  const archivoDe = (k: string) => k.slice(0, k.lastIndexOf("#"));

  // Lo que cada funcionalidad o librería declara como suyo.
  const dueños = [
    ...[...ix.fichas.values()].flatMap((f) => f.codigo.map((c) => ({ id: f.id, codigo: c, feat: true }))),
    ...ctx.graph.nodes.filter((n) => n.tipo === "lib").flatMap((n) => ((n.atributos["codigo"] as string[] | undefined) ?? []).map((c) => ({ id: n.id, codigo: c, feat: false }))),
  ];
  const hayFuncionalidades = ix.fichas.size > 0;

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
  const entradas = new Map<string, { total: number; sinDestino: string[]; sinRespuesta: string[] }>();
  for (const [k, eps] of ix.atiende) {
    const e = entradas.get(archivoDe(k)) ?? entradas.set(archivoDe(k), { total: 0, sinDestino: [], sinRespuesta: [] }).get(archivoDe(k))!;
    for (const ep of eps) {
      const n = ctx.nodo.get(ep);
      const ref = n ? `${String(n.atributos["metodo"])} ${String(n.atributos["ruta"])}` : ep;
      e.total++;
      if (!ix.recorredor.desdeEndpoint(ep).pasos.some((x) => x.toca.length)) e.sinDestino.push(ref);
      if (n?.atributos["response"] == null) e.sinRespuesta.push(ref);
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

  const archivos: FidelidadArchivo[] = [], sinDatos: string[] = [];
  for (const [archivo, e] of [...ix.estructura.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const ruta = archivo.slice(archivo.indexOf(":") + 1);
    if (ES_TEST.test(ruta)) continue;
    const signals: FidelidadArchivo["signals"] = {};
    const faltas: string[] = [];
    const tareas: Tarea[] = [];
    const tarea = (signal: Signal, resuelve: Tarea["resuelve"], que: string, hacer: string, ls: number[] = []) => tareas.push({ signal, que, hacer, resuelve, lineas: [...new Set(ls)].sort((a, b) => a - b) });

    const sinResolver = e.sinResolver ?? [];
    if (e.invoca.length + sinResolver.length) {
      signals.llamadas = { ok: e.invoca.length, total: e.invoca.length + sinResolver.length };
      if (sinResolver.length) faltas.push(`${cuantos(sinResolver.length, "llamada", "llamadas")} sin resolver (${lineas(sinResolver.map((s) => s.linea))}): declaralas en calls.yaml o con un extractor`);
      if (sinResolver.length) tarea("llamadas", "persona", `${cuantos(sinResolver.length, "llamada", "llamadas")} que no se sabe a qué método ${sinResolver.length === 1 ? "va" : "van"}: el código no lo dice con tipos`, "Decir a qué método va cada una. Se guarda en calls.yaml y entra al índice al reindexar.", sinResolver.map((s) => s.linea));
    }

    const d = ix.porArchivo.get(archivo), pen = pendientes.get(archivo);
    const http = (d?.llamadas ?? 0) + (pen?.conRuta ?? 0) + (pen?.sinDestino.length ?? 0) + (pen?.sinRuta.length ?? 0);
    if (http) {
      signals.http = { ok: (d?.llamadas ?? 0) + (pen?.conRuta ?? 0), total: http };
      if (pen?.sinDestino.length) faltas.push(`${cuantos(pen.sinDestino.length, "llamada HTTP que no se unió", "llamadas HTTP que no se unieron")} a ningún endpoint, ni de este cerebro ni de los comunicados (${lineas(pen.sinDestino)}): revisá la ruta o declarala en la sección http de calls.yaml`);
      if (pen?.sinDestino.length) tarea("http", "agente", `${cuantos(pen.sinDestino.length, "llamada HTTP con ruta que ningún endpoint atiende", "llamadas HTTP con ruta que ningún endpoint atiende")}, ni en este cerebro ni en los comunicados`, "Revisar si la ruta se leyó bien o si el servicio que la atiende no está indexado.", pen.sinDestino);
      if (pen?.sinRuta.length) faltas.push(`${cuantos(pen.sinRuta.length, "llamada HTTP", "llamadas HTTP")} sin ruta (${lineas(pen.sinRuta)}): la sección http de calls.yaml o un extractor`);
      if (pen?.sinRuta.length) tarea("http", "persona", `${cuantos(pen.sinRuta.length, "llamada HTTP cuya ruta no se pudo leer", "llamadas HTTP cuya ruta no se pudo leer")}: se arma mientras el programa corre`, "Escribir la ruta a la que llama cada una, por ejemplo /pedidos/{id}. Se guarda en calls.yaml.", pen.sinRuta);
    }

    const accesos = (d?.accesos ?? 0) + (d?.sinPagina.length ?? 0);
    if (accesos) {
      signals.datos = { ok: d!.conColumnas, total: accesos };
      if (d!.sinPagina.length) faltas.push(`${cuantos(d!.sinPagina.length, "acceso", "accesos")} a tablas sin página (${[...new Set(d!.sinPagina.map((s) => s.tabla))].sort(cmp).slice(0, 5).join(", ")}; ${lineas(d!.sinPagina.map((s) => s.linea))})`);
      if (d!.accesos - d!.conColumnas > 0) faltas.push(`${cuantos(d!.accesos - d!.conColumnas, "acceso", "accesos")} a tablas sin columnas`);
      if (d!.sinPagina.length) tarea("datos", "agente", `Toca ${cuantos(new Set(d!.sinPagina.map((s) => s.tabla)).size, "tabla que el cerebro no conoce", "tablas que el cerebro no conoce")} (${[...new Set(d!.sinPagina.map((s) => s.tabla))].sort(cmp).slice(0, 5).join(", ")})`, "Crear la página de cada tabla en el cerebro.", d!.sinPagina.map((s) => s.linea));
      if (d!.accesos - d!.conColumnas > 0) tarea("datos", "agente", `${cuantos(d!.accesos - d!.conColumnas, "acceso a una tabla sin saber", "accesos a tablas sin saber")} qué columnas toca`, "Enseñarle al índice a leer las columnas, con un extractor.");
    }

    const en = entradas.get(archivo);
    if (en) {
      signals.entradas = { ok: en.total - en.sinDestino.length, total: en.total };
      signals.contrato = { ok: en.total - en.sinRespuesta.length, total: en.total };
      if (en.sinDestino.length) faltas.push(`${cuantos(en.sinDestino.length, "endpoint", "endpoints")} cuyo recorrido no llega a nada (${en.sinDestino.sort(cmp).slice(0, 4).join(", ")}${en.sinDestino.length > 4 ? "…" : ""})`);
      if (en.sinRespuesta.length) faltas.push(`${cuantos(en.sinRespuesta.length, "endpoint", "endpoints")} sin tipo de respuesta`);
      const refs = (xs: string[]) => `${xs.slice(0, 4).join(", ")}${xs.length > 4 ? "…" : ""}`;
      if (en.sinDestino.length) tarea("entradas", "agente", `${cuantos(en.sinDestino.length, "endpoint cuyo recorrido se corta", "endpoints cuyo recorrido se corta")} antes de llegar a una tabla, un servicio o una cola (${refs(en.sinDestino)})`, "Seguir el recorrido en el código y declarar la llamada donde se corta.");
      if (en.sinRespuesta.length) tarea("contrato", "agente", `${cuantos(en.sinRespuesta.length, "endpoint del que no se sabe", "endpoints de los que no se sabe")} qué devuelve (${refs([...en.sinRespuesta].sort(cmp))})`, "Enseñarle al índice a leer el tipo de respuesta, con un extractor.");
    }

    const pa = pantallas.get(archivo);
    if (pa) {
      signals.pantallas = { ok: pa.total - pa.mudas.length, total: pa.total };
      if (pa.mudas.length) faltas.push(`${cuantos(pa.mudas.length, "pantalla", "pantallas")} sin llamadas HTTP detectadas (${pa.mudas.sort(cmp).slice(0, 4).join(", ")}${pa.mudas.length > 4 ? "…" : ""})`);
      if (pa.mudas.length) tarea("pantallas", "agente", `${cuantos(pa.mudas.length, "pantalla desde la que no se ve", "pantallas desde las que no se ve")} ninguna llamada al back (${pa.mudas.slice(0, 4).join(", ")}${pa.mudas.length > 4 ? "…" : ""})`, "Buscar cómo pide sus datos (un store, un hook, un cliente propio) y enseñárselo al índice.");
    }

    // Sin símbolos ni nada de lo anterior, el índice no vio nada en el archivo: no hay con qué medirlo.
    if (!e.simbolos.length && !Object.keys(signals).length) {
      sinDatos.push(archivo);
      continue;
    }

    const suyos = dueños.filter((x) => dentroDe(archivo, x.codigo));
    if (hayFuncionalidades) {
      signals.funcionalidad = { ok: suyos.length ? 1 : 0, total: 1 };
      if (!suyos.length) faltas.push("no pertenece a ninguna funcionalidad ni librería: sumalo al `codigo` de la que corresponda");
      if (!suyos.length) tarea("funcionalidad", "persona", "No es parte de ninguna funcionalidad ni librería", "Sumarlo a la funcionalidad que corresponda.");
    }

    let suma = 0, peso = 0;
    for (const s of SIGNALS) {
      const v = signals[s];
      if (!v) continue;
      suma += PESOS[s] * (v.ok / v.total);
      peso += PESOS[s];
    }
    const lenguaje = (ctx.nodo.get(archivo)?.atributos["lenguaje"] as string | undefined) ?? EXT.exec(ruta)?.[1]?.toLowerCase() ?? "otro";
    archivos.push({ archivo, puntaje: peso ? Math.round((100 * suma) / peso) : 100, lenguaje, capa: capaDe(ruta), funcionalidades: [...new Set(suyos.filter((x) => x.feat).map((x) => x.id))].sort(cmp), signals, faltas, tareas });
  }

  // A un archivo sin funcionalidad se le sugiere la de sus vecinos: la que más archivos tiene en la carpeta más cercana.
  const porCarpeta = new Map<string, Map<string, number>>();
  const carpetasDe = (archivo: string) => {
    const out: string[] = [];
    for (let i = archivo.lastIndexOf("/"); i > archivo.indexOf(":"); i = archivo.lastIndexOf("/", i - 1)) out.push(archivo.slice(0, i));
    return out;
  };
  for (const a of archivos) {
    const carpeta = carpetasDe(a.archivo)[0];
    if (!carpeta) continue;
    const m = porCarpeta.get(carpeta) ?? porCarpeta.set(carpeta, new Map()).get(carpeta)!;
    for (const f of a.funcionalidades) m.set(f, (m.get(f) ?? 0) + 1);
  }
  for (const a of archivos) {
    if (!a.tareas.some((t) => t.signal === "funcionalidad")) continue;
    // Solo la carpeta propia y la de arriba: más lejos ya no es una pista.
    for (const carpeta of carpetasDe(a.archivo).slice(0, 2)) {
      const m = porCarpeta.get(carpeta);
      if (!m?.size) continue;
      const [id, n] = [...m.entries()].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))[0]!;
      const nombre = ctx.nodo.get(id)?.nombre ?? id;
      a.sugerida = { id, motivo: `${cuantos(n, "archivo", "archivos")} de ${carpeta.slice(carpeta.indexOf(":") + 1)}/ ${n === 1 ? "es" : "son"} de ${nombre}` };
      break;
    }
  }
  return { archivos, sinDatos };
}

/** Cómo resuelve el agente cada tipo de falta. Lo usan el plan del CLI y del MCP, y el que arma el visor. */
export const COMO_RESOLVER: Record<Signal, string> = {
  funcionalidad: "Decidí a qué funcionalidad pertenece el archivo (por lo que hace y por sus vecinos de carpeta) y sumá `repo:ruta` a la lista `codigo` del frontmatter de la página de esa funcionalidad. Si es de una carpeta entera, sumá la carpeta. Si ninguna funcionalidad lo cubre, proponé una nueva siguiendo `flowbrain feature --guide`.",
  llamadas: "Abrí el archivo en la línea indicada, identificá a qué método concreto va la llamada y declarala en `calls.yaml` del cerebro, sección `llamadas`: `{ desde: \"repo:ruta#Simbolo\", linea: N, hacia: \"repo:ruta#Clase.metodo\", origen: \"modelo\" }`. `flowbrain calls` lista las llamadas con sus candidatos.",
  http: "Abrí el archivo en la línea indicada y reconstruí la ruta leyendo de dónde sale la URL. Declarala en `calls.yaml`, sección `http`: `{ desde: \"repo:ruta#Simbolo\", linea: N, metodo: \"GET\", ruta: \"/ruta/{id}\", origen: \"modelo\" }`. Si la ruta ya se leyó y nadie la atiende, verificá con `flowbrain drift` si el endpoint existe con otra forma o si es de un servicio sin indexar.",
  datos: "Para una tabla sin página, creá su página en el cerebro (mirá una página de tabla existente como modelo). Para accesos sin columnas, el índice no sabe leer cómo este código nombra las columnas: seguí `flowbrain coverage --guide` y escribí o ajustá un extractor.",
  entradas: "Corré `flowbrain flow \"MÉTODO /ruta\"` para ver dónde se corta el recorrido. Casi siempre es una llamada sin resolver en el camino: declarala en `calls.yaml` (sección `llamadas`). Si el endpoint de verdad no toca datos ni otros servicios, dejalo anotado y seguí.",
  contrato: "El índice no pudo leer qué devuelve el endpoint. Seguí `flowbrain coverage --guide` para enseñarle a leer el tipo de respuesta de este framework con un extractor.",
  pantallas: "Corré `flowbrain screen <ruta>` y buscá en el código cómo pide sus datos la pantalla (un store, un hook, un cliente propio). Si llama por un camino que el índice no sigue, declaralo en `calls.yaml` o enseñalo con un extractor (`flowbrain coverage --guide`). Si la pantalla de verdad no llama al back, dejalo anotado.",
};

/** Reglas del plan: valen para cualquier falta. */
export const REGLAS_DEL_PLAN = [
  "Editá solo archivos del cerebro (páginas, `calls.yaml`, extractores). Nunca el código del proyecto.",
  "Antes de declarar algo, abrí el archivo en la línea que se indica. No declares nada que no hayas visto en el código.",
  "Si no podés determinar un dato, no lo inventes: anotalo como pendiente y seguí con el próximo.",
  "Marcá cada tarea cuando la termines.",
];

/** Qué correr al terminar, para que las declaraciones entren al índice y se vea el puntaje nuevo. */
export const CIERRE_DEL_PLAN = [
  "Reindexá cada cerebro que tocaste: `flowbrain brains apply <cerebro>`.",
  "Verificá el puntaje: `flowbrain fidelity --max 99` (con `--brain <cerebro>` si hay varios) lista lo que siga sin llegar a 100.",
  "Informá qué quedó en 100, qué no y por qué.",
];

export interface OpcionesPlan {
  /** Solo estos tipos de falta (por defecto, todos). */
  signals?: readonly Signal[];
  /** Cuántos archivos entran al plan, de menor a mayor puntaje (por defecto 40). */
  limite?: number;
}

/**
 * Plan para pegarle a un modelo: los archivos que no llegan a 100, qué le falta a cada uno con su línea, y cómo se
 * resuelve cada tipo de falta. Es texto: el modelo que lo recibe tiene el código y el MCP para hacer el resto.
 */
export function planDeFidelidad(archivos: FidelidadArchivo[], opciones: OpcionesPlan = {}): string {
  const quiere = new Set<Signal>(opciones.signals?.length ? opciones.signals : SIGNALS);
  const limite = opciones.limite ?? 40;
  const conTareas = archivos
    .map((a) => ({ a, tareas: a.tareas.filter((t) => quiere.has(t.signal)) }))
    .filter((x) => x.tareas.length)
    .sort((x, y) => x.a.puntaje - y.a.puntaje || cmp(x.a.archivo, y.a.archivo));
  if (!conTareas.length) return "# Plan de fidelidad\n\nNo hay nada para hacer: ningún archivo de la selección tiene faltas de ese tipo.\n";
  const elegidos = conTareas.slice(0, limite);
  const usadas = SIGNALS.filter((s) => elegidos.some((x) => x.tareas.some((t) => t.signal === s)));
  const out = [
    "# Plan de fidelidad",
    "",
    `Objetivo: llevar a 100 el puntaje de fidelidad de ${cuantos(elegidos.length, "archivo", "archivos")} del índice de FlowBrain (hoy promedian ${promedio(elegidos.map((x) => x.a))}). El puntaje mide cuánto de lo que hay en cada archivo quedó unido en el grafo.`,
    ...(conTareas.length > elegidos.length ? ["", `Este plan trae los ${elegidos.length} de menor puntaje; quedan ${conTareas.length - elegidos.length} más para otra tanda.`] : []),
    "",
    "## Reglas",
    "",
    ...REGLAS_DEL_PLAN.map((r) => `- ${r}`),
    "",
    "## Cómo se resuelve cada cosa",
    "",
    ...usadas.map((s) => `- **${s}**: ${COMO_RESOLVER[s]}`),
    "",
    "## Archivos",
    ...elegidos.flatMap(({ a, tareas }) => [
      "",
      `### ${a.archivo} (${a.puntaje}/100)`,
      ...(a.sugerida && tareas.some((t) => t.signal === "funcionalidad") ? [`Pista: ${a.sugerida.motivo} (\`${a.sugerida.id}\`).`] : []),
      ...tareas.map((t) => `- [ ] ${t.signal}: ${t.que}${t.lineas.length ? ` (${lineas(t.lineas)})` : ""}.`),
    ]),
    "",
    "## Al terminar",
    "",
    ...CIERRE_DEL_PLAN.map((c, i) => `${i + 1}. ${c}`),
    "",
  ];
  return out.join("\n");
}

const TRAMOS: Array<[string, number, number]> = [["0-19", 0, 19], ["20-39", 20, 39], ["40-59", 40, 59], ["60-79", 60, 79], ["80-99", 80, 99], ["100", 100, 100]];
const promedio = (xs: FidelidadArchivo[]) => (xs.length ? redondo(xs.reduce((a, x) => a + x.puntaje, 0) / xs.length) : null);

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
  const { archivos, sinDatos } = fidelidadDeArchivos(ctx);

  if (p.archivo) {
    const q = p.archivo.replace(/#.*$/, "");
    const hits = archivos.filter((a) => a.archivo === q || a.archivo.endsWith(`:${q}`) || a.archivo.endsWith(`/${q}`));
    if (hits.length === 1) return { herramienta: "fidelidad", ...hits[0]!, queMide: Object.fromEntries(Object.keys(hits[0]!.signals).map((s) => [s, QUE_MIDE[s as Signal]])) };
    if (sinDatos.some((a) => a === q || a.endsWith(`:${q}`) || a.endsWith(`/${q}`))) return { herramienta: "fidelidad", archivo: q, puntaje: null, motivo: "el índice no encontró símbolos, llamadas ni accesos en este archivo: no hay con qué medirlo" };
    throw new ConsultaError(hits.length ? "parametro_invalido" : "nodo_inexistente", hits.length ? `varios archivos coinciden con ${p.archivo}: ${hits.slice(0, 6).map((a) => a.archivo).join(", ")}` : `no hay un archivo indexado que coincida con ${p.archivo}`);
  }

  const min = p.min ?? 0, max = p.max ?? 100;
  if (min < 0 || max > 100 || min > max) throw new ConsultaError("parametro_invalido", "el rango de puntaje va de 0 a 100, con min ≤ max");
  if (p.signal && !(SIGNALS as readonly string[]).includes(p.signal)) throw new ConsultaError("parametro_invalido", `signal desconocida: ${p.signal}. Las que hay: ${SIGNALS.join(", ")}`);
  let feat: string | null = null;
  if (p.funcionalidad && normalizar(p.funcionalidad) !== "ninguna") {
    const q = normalizar(p.funcionalidad);
    const ids = [...ctx.codigo!.fichas.keys()].filter((id) => normalizar(id) === q || normalizar(id) === `feat-${q}` || normalizar(ctx.nodo.get(id)?.nombre ?? "") === q);
    if (ids.length !== 1) throw new ConsultaError("nodo_inexistente", `no se pudo resolver la funcionalidad: ${p.funcionalidad}`);
    feat = ids[0]!;
  }
  const tipo = p.tipo ? normalizar(p.tipo.replace(/^\./, "")) : null;
  const filtrados = archivos
    .filter((a) => a.puntaje >= min && a.puntaje <= max)
    .filter((a) => !p.funcionalidad || (feat ? a.funcionalidades.includes(feat) : a.funcionalidades.length === 0))
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
    archivos: { medidos: archivos.length, sinDatos: sinDatos.length, completos: archivos.filter((a) => a.puntaje === 100).length },
    distribucion: Object.fromEntries(TRAMOS.map(([k, a, b]) => [k, archivos.filter((x) => x.puntaje >= a && x.puntaje <= b).length])),
    porSignal,
    porFuncionalidad: agrupar(archivos, (a) => (a.funcionalidades.length ? a.funcionalidades : ["ninguna"])),
    porCapa: agrupar(archivos, (a) => [a.capa]),
    porLenguaje: agrupar(archivos, (a) => [a.lenguaje]),
    ...(hayFiltro ? { filtro: { coinciden: filtrados.length, puntaje: promedio(filtrados) } } : {}),
    lista: filtrados.slice(0, limite).map((a) => ({ archivo: a.archivo, puntaje: a.puntaje, ...(a.funcionalidades.length ? { funcionalidades: a.funcionalidades } : {}), faltas: a.faltas })),
    ...(filtrados.length > limite ? { listaOmitidos: filtrados.length - limite } : {}),
    avisos: [
      ...(sinDatos.length ? [`${sinDatos.length} archivos sin puntaje: el índice no encontró símbolos, llamadas ni accesos en ellos (configuración, datos, o un lenguaje sin parser). Ejemplos: ${sinDatos.slice(0, 3).join(", ")}`] : []),
      ...(ctx.codigo!.fichas.size ? [] : ["el brain no tiene funcionalidades: la signal `funcionalidad` no se mide"]),
      "una llamada HTTP con ruta que no se unió a un endpoint de este cerebro cuenta como entendida: puede ir a otro cerebro (ver `conexiones`)",
    ],
  };
  return ajustarLista(r, ["lista", "porFuncionalidad", "porLenguaje"], p.budget_tokens);
}

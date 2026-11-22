import { cmp } from "../canonical.js";
import { capaDe, ES_TEST, type Ficha } from "../funcionalidades.js";
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
  llamadas: "llamadas entre métodos que el índice pudo atribuir a su destino",
  http: "llamadas HTTP unidas a un endpoint o a un externo (con un solo cerebro, alcanza con que tengan ruta)",
  datos: "accesos a tablas que tienen página y dicen qué columnas tocan",
  entradas: "endpoints atendidos acá cuyo recorrido llega a una tabla, un servicio o una cola",
  contrato: "endpoints atendidos acá con tipo de respuesta",
  pantallas: "pantallas dibujadas acá desde las que se llega a una llamada HTTP",
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
  sin_nada: "el índice no encontró nada en el archivo: ni símbolos, ni llamadas, ni accesos (configuración, datos, o un lenguaje que ningún parser lee)",
  sin_relaciones: "el índice vio código, pero ninguna relación para medir: ni llamadas, ni HTTP, ni tablas, ni endpoints, ni pantallas (tipos o constantes, o algo que el parser no supo leer)",
};

/**
 * Un archivo que no es de ninguna funcionalidad ni librería. Que un archivo no tenga funcionalidad no dice nada de
 * cuánto lo entendió el índice, así que no entra en el puntaje: va aparte, con la funcionalidad que se le recomienda.
 */
export interface ArchivoSinAsociar {
  archivo: string;
  lenguaje: string;
  capa: string;
  /** La funcionalidad con más indicios, y por qué. Ausente si no hay indicios o si es código compartido. */
  recomendada?: Recomendacion;
  /** Otras con indicios parecidos (hasta 2), por si la primera no es. */
  otras: Recomendacion[];
  /** Lo usan archivos de dos o más funcionalidades sin que una domine: no es de una sola. */
  compartido?: { funcionalidades: number };
  /** Ningún archivo de su carpeta (ni de las de adentro) tiene dueño: se puede asociar la carpeta entera. */
  carpetaLibre: boolean;
}

export interface Recomendacion {
  id: string;
  motivo: string;
}

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

/** Un contexto con índice de código desde los contenidos de `_build`, para quien no tiene uno armado (el visor). */
export const contextoDeFuentes = (graph: Graph, fichas: Ficha[], archivos: string[], extracciones: string[], contratos: Contrato[] = []): Contexto => crearContexto(graph, contratos, new Map(), crearIndiceCodigo(graph, fichas, archivos, extracciones));

/** Lo mismo que `fidelidadDeArchivos`, desde los contenidos de `_build` (para quien no tiene un contexto armado). */
export function fidelidadDeFuentes(graph: Graph, fichas: Ficha[], archivos: string[], extracciones: string[], opciones: OpcionesFidelidad = {}) {
  return fidelidadDeArchivos(contextoDeFuentes(graph, fichas, archivos, extracciones), opciones);
}

/** Puntaje de cada archivo del índice que se puede medir, y cuáles no se pudieron medir. Sin filtros ni recortes. */
export function fidelidadDeArchivos(ctx: Contexto, opciones: OpcionesFidelidad = {}): { archivos: FidelidadArchivo[]; inciertos: ArchivoIncierto[]; sinAsociar: ArchivoSinAsociar[] } {
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

  const archivos: FidelidadArchivo[] = [], inciertos: ArchivoIncierto[] = [];
  /** Funcionalidades dueñas de cada archivo (los de una librería quedan con lista vacía) y los que no tienen dueño. */
  const featsDe = new Map<string, string[]>();
  const sueltos: Array<{ archivo: string; lenguaje: string; capa: string }> = [];
  for (const [archivo, e] of [...ix.estructura.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const ruta = archivo.slice(archivo.indexOf(":") + 1);
    if (ES_TEST.test(ruta)) continue;
    const suyos = dueños.filter((x) => dentroDe(archivo, x.codigo));
    const lenguaje = (ctx.nodo.get(archivo)?.atributos["lenguaje"] as string | undefined) ?? EXT.exec(ruta)?.[1]?.toLowerCase() ?? "otro";
    if (suyos.length) featsDe.set(archivo, [...new Set(suyos.filter((x) => x.feat).map((x) => x.id))].sort(cmp));
    else if (hayFuncionalidades) sueltos.push({ archivo, lenguaje, capa: capaDe(ruta) });
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
    archivos.push({ archivo, puntaje: Math.round((100 * suma) / peso), lenguaje, capa: capaDe(ruta), funcionalidades: featsDe.get(archivo) ?? [], signals, faltas, tareas, ...(!suyos.length && hayFuncionalidades ? { sinAsociar: true as const } : {}) });
  }

  return { archivos, inciertos, sinAsociar: recomendar(ctx, sueltos, featsDe) };
}

const PESO_LO_USAN = 3, PESO_USA = 2, PESO_ENDPOINT = 4, PESO_VECINO = 1, PESO_VECINO_ARRIBA = 0.5, TOPE_VECINOS = 5;

/**
 * A cada archivo sin dueño, la funcionalidad con más indicios. De más fuerte a más débil: atiende un endpoint que una
 * funcionalidad llama; lo importan archivos de una funcionalidad; importa archivos de una funcionalidad; sus vecinos
 * de carpeta (o de la carpeta de arriba) son de una funcionalidad. Si lo usan dos o más funcionalidades y ninguna
 * junta el 60 % de los usos, no se recomienda ninguna: es código compartido.
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
      .map(([id, c]) => ({
        id,
        puntos: PESO_ENDPOINT * c.endpoints + PESO_LO_USAN * c.loUsan + PESO_USA * c.usa + PESO_VECINO * Math.min(c.vecinos, TOPE_VECINOS) + PESO_VECINO_ARRIBA * Math.min(c.arriba, TOPE_VECINOS),
        motivo: [
          ...(c.endpoints ? [`atiende ${cuantos(c.endpoints, "endpoint", "endpoints")} que llama ${nombre(id)}`] : []),
          ...(c.loUsan ? [`lo ${c.loUsan === 1 ? "importa" : "importan"} ${cuantos(c.loUsan, "archivo", "archivos")} de ${nombre(id)}`] : []),
          ...(c.usa ? [`importa ${cuantos(c.usa, "archivo", "archivos")} de ${nombre(id)}`] : []),
          ...(c.vecinos ? [`${cuantos(c.vecinos, "vecino", "vecinos")} de carpeta ${c.vecinos === 1 ? "es" : "son"} de ${nombre(id)}`] : c.arriba ? [`${cuantos(c.arriba, "archivo", "archivos")} de ${corta(arriba!)}/ ${c.arriba === 1 ? "es" : "son"} de ${nombre(id)}`] : []),
        ]
          .slice(0, 2)
          .join("; "),
      }))
      .sort((a, b) => b.puntos - a.puntos || cmp(a.id, b.id));
    const usos = [...cuenta.values()].reduce((n, c) => n + c.loUsan, 0);
    const queLoUsan = [...cuenta.entries()].filter(([, c]) => c.loUsan);
    const compartido = queLoUsan.length >= 2 && Math.max(...queLoUsan.map(([, c]) => c.loUsan)) < 0.6 * usos;
    const [primera, ...resto] = candidatas;
    return {
      archivo,
      lenguaje,
      capa,
      ...(primera && !compartido ? { recomendada: { id: primera.id, motivo: primera.motivo } } : {}),
      otras: (compartido ? candidatas : resto).filter((c) => !primera || c.puntos >= 0.4 * primera.puntos).slice(0, 2).map((c) => ({ id: c.id, motivo: c.motivo })),
      ...(compartido ? { compartido: { funcionalidades: queLoUsan.length } } : {}),
      carpetaLibre: !!propia && !conDueño.has(propia),
    };
  });
}

/** Cómo resuelve el agente cada tipo de falta. Lo usan el plan del CLI y del MCP, y el que arma el visor. */
export const COMO_RESOLVER: Record<Signal, string> = {
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
  const { archivos, inciertos, sinAsociar: sueltos } = fidelidadDeArchivos(ctx);

  if (p.archivo) {
    const q = p.archivo.replace(/#.*$/, "");
    const hits = archivos.filter((a) => a.archivo === q || a.archivo.endsWith(`:${q}`) || a.archivo.endsWith(`/${q}`));
    if (hits.length === 1) return { herramienta: "fidelidad", ...hits[0]!, queMide: Object.fromEntries(Object.keys(hits[0]!.signals).map((s) => [s, QUE_MIDE[s as Signal]])) };
    const inc = inciertos.filter((a) => a.archivo === q || a.archivo.endsWith(`:${q}`) || a.archivo.endsWith(`/${q}`));
    if (inc.length === 1) return { herramienta: "fidelidad", archivo: inc[0]!.archivo, puntaje: null, incierta: true, motivo: `fidelidad incierta: ${POR_QUE_INCIERTA[inc[0]!.motivo]}`, ...(inc[0]!.funcionalidades.length ? { funcionalidades: inc[0]!.funcionalidades } : {}) };
    throw new ConsultaError(hits.length ? "parametro_invalido" : "nodo_inexistente", hits.length ? `varios archivos coinciden con ${p.archivo}: ${hits.slice(0, 6).map((a) => a.archivo).join(", ")}` : `no hay un archivo indexado que coincida con ${p.archivo}`);
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
      avisos: ["si en un archivo incierto hay código que el índice debería haber leído, se enseña con un extractor: `flowbrain coverage --guide`"],
    };
    return ajustarLista(r, "lista", p.budget_tokens);
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
      ...(inciertos.length ? [`${inciertos.length} archivos de fidelidad incierta: el índice no encontró en ellos ninguna relación para medir. No tienen puntaje ni entran al promedio. Con \`inciertos: true\` se listan`] : []),
      ...(sueltos.length ? [`${sueltos.length} archivos no son de ninguna funcionalidad ni librería. No restan puntaje: \`sin_asociar\` los lista por carpeta con la funcionalidad recomendada`] : []),
      "una llamada HTTP con ruta que no se unió a un endpoint de este cerebro cuenta como entendida: puede ir a otro cerebro (ver `conexiones`)",
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

export const COMO_ASOCIAR =
  "Para asociar: sumá `repo:ruta` (el archivo, o la carpeta si `carpetaLibre`) a la lista `codigo` del frontmatter de la página de la funcionalidad y compilá. La recomendación es una pista: abrí el archivo antes de decidir. Lo `compartido` no va a una funcionalidad: va al `codigo` de una página `lib` (código común) o queda sin asociar. Si ninguna funcionalidad lo cubre, proponé una nueva con `flowbrain feature --guide`.";

/**
 * Archivos que no son de ninguna funcionalidad ni librería, agrupados por carpeta, con la funcionalidad que se le
 * recomienda a cada grupo y por qué. Es la lista de trabajo para completar el catálogo de funcionalidades.
 */
export function sinAsociar(ctx: Contexto, p: SinAsociarParams = {}) {
  const { sinAsociar: todos } = fidelidadDeArchivos(ctx);
  if (!ctx.codigo!.fichas.size) return { herramienta: "sin_asociar", total: 0, carpetas: [], avisos: ["el brain no tiene funcionalidades: no hay a qué asociar. Primero `flowbrain feature --guide`"] };
  const q = p.carpeta?.replace(/\/+$/, "");
  let feat: string | null = null;
  const sinPista = !!p.funcionalidad && normalizar(p.funcionalidad) === "ninguna";
  if (p.funcionalidad && !sinPista) {
    const n = normalizar(p.funcionalidad);
    const ids = [...ctx.codigo!.fichas.keys()].filter((id) => normalizar(id) === n || normalizar(id) === `feat-${n}` || normalizar(ctx.nodo.get(id)?.nombre ?? "") === n);
    if (ids.length !== 1) throw new ConsultaError("nodo_inexistente", `no se pudo resolver la funcionalidad: ${p.funcionalidad}`);
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
        lista: xs.slice(0, 8).map((x) => ({ archivo: x.archivo, ...(x.recomendada ? { recomendada: x.recomendada.id, motivo: x.recomendada.motivo } : {}), ...(x.otras.length ? { otras: x.otras.map((o) => o.id) } : {}), ...(x.compartido ? { compartido: `lo usan ${x.compartido.funcionalidades} funcionalidades` } : {}) })),
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
    avisos: todos.length ? [COMO_ASOCIAR] : ["todos los archivos del índice son de alguna funcionalidad o librería"],
  };
  return ajustarLista(r, "carpetas", p.budget_tokens);
}

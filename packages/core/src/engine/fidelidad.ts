import { cmp } from "../canonical.js";
import { capaDe, ES_TEST } from "../funcionalidades.js";
import { dentroDe } from "../schema.js";
import { ajustarLista, pantallasSinLlamadas } from "./codigo.js";
import type { Contexto } from "./contexto.js";
import { ConsultaError, normalizar } from "./herramientas.js";

/**
 * Fidelidad del índice, archivo por archivo: de lo que el índice vio en un archivo, qué parte quedó entendida. Es un
 * número de 0 a 100 por archivo, y dice por qué no llega a 100 (`faltas`, con su línea): eso es lo que hay que corregir
 * con un extractor, con `calls.yaml` o en la página de la funcionalidad.
 *
 * Cada señal es una proporción (`ok` de `total`) y solo cuenta donde aplica: un archivo sin llamadas HTTP no pierde
 * puntos por HTTP. El puntaje es el promedio de las señales que aplican, con su peso. Un archivo donde el índice no
 * encontró nada (ni símbolos, ni llamadas, ni accesos) no tiene puntaje: no hay con qué medirlo, y se informa aparte.
 */

export const SEÑALES = ["llamadas", "http", "datos", "entradas", "contrato", "pantallas", "funcionalidad"] as const;
export type Señal = (typeof SEÑALES)[number];

/** Peso de cada señal en el puntaje. Las que salen del código pesan el doble que las de clasificación. */
export const PESOS: Record<Señal, number> = { llamadas: 2, http: 2, datos: 2, entradas: 2, contrato: 1, pantallas: 1, funcionalidad: 1 };

/** Qué mide cada señal, para quien lee el informe. */
export const QUE_MIDE: Record<Señal, string> = {
  llamadas: "llamadas entre métodos que el índice pudo atribuir a su destino",
  http: "llamadas HTTP con ruta conocida (unidas a un endpoint, a un externo, o con ruta para otro cerebro)",
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
  señales: Partial<Record<Señal, { ok: number; total: number }>>;
  /** Por qué no llega a 100, con la línea cuando se conoce. */
  faltas: string[];
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
  /** Solo archivos a los que les falta esta señal. */
  señal?: string;
  /** Cuántos archivos listar, de menor a mayor puntaje (por defecto 30). */
  limite?: number;
  budget_tokens?: number | null;
}

const EXT = /\.([A-Za-z0-9]+)$/;
const lineas = (xs: number[]) => {
  const u = [...new Set(xs)].sort((a, b) => a - b);
  return u.length > 6 ? `L${u.slice(0, 6).join(", L")} y ${u.length - 6} más` : `L${u.join(", L")}`;
};
const redondo = (n: number) => Math.round(n * 10) / 10;

/** Puntaje de cada archivo del índice que se puede medir, y cuáles no se pudieron medir. Sin filtros ni recortes. */
export function fidelidadDeArchivos(ctx: Contexto): { archivos: FidelidadArchivo[]; sinDatos: string[] } {
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
  const pendientes = new Map<string, { conRuta: number; sinRuta: number[] }>();
  for (const l of ix.llamadasPendientes) {
    const m = l.llamada ? /^(.*)#L(\d+)$/.exec(l.evidencia) : null;
    if (!m) continue;
    const p = pendientes.get(m[1]!) ?? pendientes.set(m[1]!, { conRuta: 0, sinRuta: [] }).get(m[1]!)!;
    if (l.llamada!.ruta === null) p.sinRuta.push(Number(m[2]));
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
    const señales: FidelidadArchivo["señales"] = {};
    const faltas: string[] = [];

    const sinResolver = e.sinResolver ?? [];
    if (e.invoca.length + sinResolver.length) {
      señales.llamadas = { ok: e.invoca.length, total: e.invoca.length + sinResolver.length };
      if (sinResolver.length) faltas.push(`${sinResolver.length} llamadas sin resolver (${lineas(sinResolver.map((s) => s.linea))}): declaralas en calls.yaml o con un extractor`);
    }

    const d = ix.porArchivo.get(archivo), pen = pendientes.get(archivo);
    const http = (d?.llamadas ?? 0) + (pen?.conRuta ?? 0) + (pen?.sinRuta.length ?? 0);
    if (http) {
      señales.http = { ok: http - (pen?.sinRuta.length ?? 0), total: http };
      if (pen?.sinRuta.length) faltas.push(`${pen.sinRuta.length} llamadas HTTP sin ruta (${lineas(pen.sinRuta)}): la sección http de calls.yaml o un extractor`);
    }

    const accesos = (d?.accesos ?? 0) + (d?.sinPagina.length ?? 0);
    if (accesos) {
      señales.datos = { ok: d!.conColumnas, total: accesos };
      if (d!.sinPagina.length) faltas.push(`${d!.sinPagina.length} accesos a tablas sin página (${[...new Set(d!.sinPagina.map((s) => s.tabla))].sort(cmp).slice(0, 5).join(", ")}; ${lineas(d!.sinPagina.map((s) => s.linea))})`);
      if (d!.accesos - d!.conColumnas > 0) faltas.push(`${d!.accesos - d!.conColumnas} accesos a tablas sin columnas`);
    }

    const en = entradas.get(archivo);
    if (en) {
      señales.entradas = { ok: en.total - en.sinDestino.length, total: en.total };
      señales.contrato = { ok: en.total - en.sinRespuesta.length, total: en.total };
      if (en.sinDestino.length) faltas.push(`${en.sinDestino.length} endpoints cuyo recorrido no llega a nada (${en.sinDestino.sort(cmp).slice(0, 4).join(", ")}${en.sinDestino.length > 4 ? "…" : ""})`);
      if (en.sinRespuesta.length) faltas.push(`${en.sinRespuesta.length} endpoints sin tipo de respuesta`);
    }

    const pa = pantallas.get(archivo);
    if (pa) {
      señales.pantallas = { ok: pa.total - pa.mudas.length, total: pa.total };
      if (pa.mudas.length) faltas.push(`${pa.mudas.length} pantallas sin llamadas HTTP detectadas (${pa.mudas.sort(cmp).slice(0, 4).join(", ")}${pa.mudas.length > 4 ? "…" : ""})`);
    }

    // Sin símbolos ni nada de lo anterior, el índice no vio nada en el archivo: no hay con qué medirlo.
    if (!e.simbolos.length && !Object.keys(señales).length) {
      sinDatos.push(archivo);
      continue;
    }

    const suyos = dueños.filter((x) => dentroDe(archivo, x.codigo));
    if (hayFuncionalidades) {
      señales.funcionalidad = { ok: suyos.length ? 1 : 0, total: 1 };
      if (!suyos.length) faltas.push("no pertenece a ninguna funcionalidad ni librería: sumalo al `codigo` de la que corresponda");
    }

    let suma = 0, peso = 0;
    for (const s of SEÑALES) {
      const v = señales[s];
      if (!v) continue;
      suma += PESOS[s] * (v.ok / v.total);
      peso += PESOS[s];
    }
    const lenguaje = (ctx.nodo.get(archivo)?.atributos["lenguaje"] as string | undefined) ?? EXT.exec(ruta)?.[1]?.toLowerCase() ?? "otro";
    archivos.push({ archivo, puntaje: peso ? Math.round((100 * suma) / peso) : 100, lenguaje, capa: capaDe(ruta), funcionalidades: [...new Set(suyos.filter((x) => x.feat).map((x) => x.id))].sort(cmp), señales, faltas });
  }
  return { archivos, sinDatos };
}

const TRAMOS: Array<[string, number, number]> = [["0-19", 0, 19], ["20-39", 20, 39], ["40-59", 40, 59], ["60-79", 60, 79], ["80-99", 80, 99], ["100", 100, 100]];
const promedio = (xs: FidelidadArchivo[]) => (xs.length ? redondo(xs.reduce((a, x) => a + x.puntaje, 0) / xs.length) : null);

function agrupar(xs: FidelidadArchivo[], claves: (x: FidelidadArchivo) => string[]) {
  const m = new Map<string, FidelidadArchivo[]>();
  for (const x of xs) for (const k of claves(x)) (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  return [...m.entries()].map(([id, v]) => ({ id, archivos: v.length, puntaje: promedio(v)! })).sort((a, b) => a.puntaje - b.puntaje || cmp(a.id, b.id));
}

/**
 * Informe de fidelidad de un brain: el puntaje general, cómo se reparten los archivos, qué señal falla más, el puntaje
 * por funcionalidad, capa y lenguaje, y los archivos de menor puntaje con lo que les falta. Los filtros recortan la
 * lista de archivos; el resumen de arriba es siempre el del brain entero.
 */
export function fidelidad(ctx: Contexto, p: FidelidadParams = {}) {
  const { archivos, sinDatos } = fidelidadDeArchivos(ctx);

  if (p.archivo) {
    const q = p.archivo.replace(/#.*$/, "");
    const hits = archivos.filter((a) => a.archivo === q || a.archivo.endsWith(`:${q}`) || a.archivo.endsWith(`/${q}`));
    if (hits.length === 1) return { herramienta: "fidelidad", ...hits[0]!, queMide: Object.fromEntries(Object.keys(hits[0]!.señales).map((s) => [s, QUE_MIDE[s as Señal]])) };
    if (sinDatos.some((a) => a === q || a.endsWith(`:${q}`) || a.endsWith(`/${q}`))) return { herramienta: "fidelidad", archivo: q, puntaje: null, motivo: "el índice no encontró símbolos, llamadas ni accesos en este archivo: no hay con qué medirlo" };
    throw new ConsultaError(hits.length ? "parametro_invalido" : "nodo_inexistente", hits.length ? `varios archivos coinciden con ${p.archivo}: ${hits.slice(0, 6).map((a) => a.archivo).join(", ")}` : `no hay un archivo indexado que coincida con ${p.archivo}`);
  }

  const min = p.min ?? 0, max = p.max ?? 100;
  if (min < 0 || max > 100 || min > max) throw new ConsultaError("parametro_invalido", "el rango de puntaje va de 0 a 100, con min ≤ max");
  if (p.señal && !(SEÑALES as readonly string[]).includes(p.señal)) throw new ConsultaError("parametro_invalido", `señal desconocida: ${p.señal}. Las que hay: ${SEÑALES.join(", ")}`);
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
      const v = p.señal ? a.señales[p.señal as Señal] : undefined;
      return !p.señal || (!!v && v.ok < v.total);
    })
    .sort((a, b) => a.puntaje - b.puntaje || b.faltas.length - a.faltas.length || cmp(a.archivo, b.archivo));

  const porSeñal = Object.fromEntries(
    SEÑALES.flatMap((s) => {
      let ok = 0, total = 0, conFalta = 0;
      for (const a of archivos) {
        const v = a.señales[s];
        if (!v) continue;
        ok += v.ok;
        total += v.total;
        if (v.ok < v.total) conFalta++;
      }
      return total ? [[s, { ok, total, pct: redondo((100 * ok) / total), archivosConFalta: conFalta, mide: QUE_MIDE[s] }]] : [];
    }),
  );
  const limite = p.limite ?? 30;
  const hayFiltro = min > 0 || max < 100 || !!p.funcionalidad || !!tipo || !!p.señal;
  const r = {
    herramienta: "fidelidad",
    puntaje: promedio(archivos),
    archivos: { medidos: archivos.length, sinDatos: sinDatos.length, completos: archivos.filter((a) => a.puntaje === 100).length },
    distribucion: Object.fromEntries(TRAMOS.map(([k, a, b]) => [k, archivos.filter((x) => x.puntaje >= a && x.puntaje <= b).length])),
    porSeñal,
    porFuncionalidad: agrupar(archivos, (a) => (a.funcionalidades.length ? a.funcionalidades : ["ninguna"])),
    porCapa: agrupar(archivos, (a) => [a.capa]),
    porLenguaje: agrupar(archivos, (a) => [a.lenguaje]),
    ...(hayFiltro ? { filtro: { coinciden: filtrados.length, puntaje: promedio(filtrados) } } : {}),
    lista: filtrados.slice(0, limite).map((a) => ({ archivo: a.archivo, puntaje: a.puntaje, ...(a.funcionalidades.length ? { funcionalidades: a.funcionalidades } : {}), faltas: a.faltas })),
    ...(filtrados.length > limite ? { listaOmitidos: filtrados.length - limite } : {}),
    avisos: [
      ...(sinDatos.length ? [`${sinDatos.length} archivos sin puntaje: el índice no encontró símbolos, llamadas ni accesos en ellos (configuración, datos, o un lenguaje sin parser). Ejemplos: ${sinDatos.slice(0, 3).join(", ")}`] : []),
      ...(ctx.codigo!.fichas.size ? [] : ["el brain no tiene funcionalidades: la señal `funcionalidad` no se mide"]),
      "una llamada HTTP con ruta que no se unió a un endpoint de este cerebro cuenta como entendida: puede ir a otro cerebro (ver `conexiones`)",
    ],
  };
  return ajustarLista(r, ["lista", "porFuncionalidad", "porLenguaje"], p.budget_tokens);
}

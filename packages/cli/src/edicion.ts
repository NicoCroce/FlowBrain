import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { agregarCodigoAPagina, agregarDeclaracion, anotarResultados, cambiarEstadoDeEspecificacion, decidirHallazgo, type ResultadoDeRegla, marcarProblemaDeCaso, marcarPruebaManual, ARCHIVO_LLAMADAS, cargarContexto, cmp, ConsultaError, dentroDe, type Cerebro, type Contexto, type Registro } from "@flowbrain/core";
import { compileDirConVisor } from "@flowbrain/viewer";

/**
 * Lo que se puede corregir desde la pantalla Fidelidad del visor (`flowbrain viewer --serve`). Cada edición escribe un
 * archivo del cerebro, nunca el código fuente: la página de una funcionalidad o `calls.yaml`. Todo lo que llega se
 * comprueba contra el índice antes de escribir (el archivo existe, la línea es de una llamada sin resolver, el destino
 * es un símbolo del mismo repo), y el destino de la escritura tiene que quedar dentro de la carpeta del cerebro.
 */

export type Edicion =
  /** Sumar el archivo (o una carpeta que lo contiene) al `codigo` de una funcionalidad. */
  | { tipo: "funcionalidad"; cerebro: string; archivo: string; funcionalidad: string; entrada?: string }
  /** Declarar la ruta de una llamada HTTP que el índice vio sin poder rutear. */
  | { tipo: "http"; cerebro: string; archivo: string; linea: number; metodo: string; ruta: string }
  /** Declarar a qué método va una llamada que el índice no pudo atribuir. */
  | { tipo: "llamada"; cerebro: string; archivo: string; linea: number; hacia: string }
  /** Confirmar una especificación de una funcionalidad (o volverla a propuesta). */
  | { tipo: "especificacion"; cerebro: string; funcionalidad: string; id: string; estado: string }
  /** Marcar un caso de uso como mal, con lo que está mal (o sacarle la marca con `problema` vacío). */
  | { tipo: "caso"; cerebro: string; funcionalidad: string; id: string; problema: string | null }
  /** Decidir que una especificación se prueba a mano, con el motivo (o volver a pedirle test con `motivo` vacío). */
  | { tipo: "manual"; cerebro: string; funcionalidad: string; id: string; motivo: string | null }
  /** Anotar lo que un agente resolvió de varias reglas de una funcionalidad: tests que las verifican o hallazgos. */
  | { tipo: "resultados"; cerebro: string; funcionalidad: string; items: ResultadoDeRegla[] }
  /** Decidir qué hacer con el hallazgo de una regla: `regla_mal`, `codigo_mal` o `null` (sacar la decisión). */
  | { tipo: "decision"; cerebro: string; funcionalidad: string; id: string; decision: string | null };

export interface ResultadoEdicion {
  /** Archivo escrito, relativo a la carpeta del registro. */
  escrito: string;
  /** `false` si ya estaba dicho: no se escribió nada. */
  cambio: boolean;
  /** Las declaraciones de `calls.yaml` entran al índice al reindexar el cerebro; sumar código, al recompilar (ya hecho). */
  faltaReindexar: boolean;
  mensaje: string;
}

const METODOS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const invalido = (m: string) => new ConsultaError("parametro_invalido", m);

/** Ruta absoluta de `rel` dentro de `base`, o error si se sale (por `..`, una ruta absoluta o un enlace simbólico). */
export async function rutaDentro(base: string, rel: string): Promise<string> {
  const raiz = await realpath(base);
  const destino = resolve(raiz, rel);
  if (destino !== raiz && !destino.startsWith(raiz + sep)) throw invalido(`the path leaves the brain folder: ${rel}`);
  // La carpeta donde se va a escribir, ya resuelta: un enlace simbólico no puede sacarla del cerebro.
  const carpeta = await realpath(dirname(destino)).catch(() => dirname(destino));
  if (carpeta !== raiz && !carpeta.startsWith(raiz + sep)) throw invalido(`the path leaves the brain folder: ${rel}`);
  return destino;
}

function cerebroDe(registro: Registro, nombre: unknown): Cerebro {
  const c = typeof nombre === "string" ? registro.cerebro(nombre) : null;
  if (!c) throw new ConsultaError("nodo_inexistente", `no such brain: ${String(nombre)}`);
  return c;
}

function estructuraDe(ctx: Contexto, archivo: unknown) {
  const e = typeof archivo === "string" ? ctx.codigo?.estructura.get(archivo) : undefined;
  if (!e || typeof archivo !== "string") throw new ConsultaError("nodo_inexistente", `no indexed file with that id: ${String(archivo)}`);
  return { e, archivo, repo: archivo.slice(0, archivo.indexOf(":")), ruta: archivo.slice(archivo.indexOf(":") + 1) };
}

/** Símbolo que contiene la línea, con rango: el más interno. Una declaración solo vale dentro de uno. */
function simboloEn(e: { simbolos: Array<{ nombre: string; linea: number; fin?: number | undefined }> }, linea: number): string | null {
  const dentro = e.simbolos.filter((s) => s.fin !== undefined && s.linea <= linea && linea <= s.fin);
  return dentro.length ? dentro.reduce((a, b) => (b.linea >= a.linea ? b : a)).nombre : null;
}

/** Lo que la pantalla necesita para ofrecer las ediciones de un archivo. */
export async function detalleDeArchivo(registro: Registro, nombreCerebro: unknown, idArchivo: unknown) {
  const c = cerebroDe(registro, nombreCerebro);
  const ctx = await cargarContexto(c.raiz);
  const { e, archivo, repo, ruta } = estructuraDe(ctx, idArchivo);
  const ix = ctx.codigo!;
  // El archivo y las carpetas que lo contienen, de la más cercana a la más general (sin la raíz del repo).
  const partes = ruta.split("/");
  const entradas = partes.map((_, i) => `${repo}:${partes.slice(0, partes.length - i).join("/")}`).slice(0, 6);
  const http = ix.llamadasPendientes
    .filter((l) => l.llamada && l.llamada.ruta === null && l.evidencia.replace(/#L\d+$/, "") === archivo)
    .map((l) => {
      const linea = Number(/#L(\d+)$/.exec(l.evidencia)?.[1]);
      return { linea, metodo: l.llamada!.metodo, base: l.llamada!.base, desde: simboloEn(e, linea) };
    });
  const llamadas = (e.sinResolver ?? []).map((s) => ({
    linea: s.linea,
    desde: s.desde,
    llamada: s.llamada,
    candidatos: [...new Set((s.candidatos ?? []).flatMap((n) => ix.porNombre.get(n) ?? []).filter((k) => k.startsWith(`${repo}:`)))].sort(cmp).slice(0, 30),
  }));
  const funcionalidades = ctx.graph.nodes.filter((n) => n.tipo === "feat" && n.pagina).map((n) => ({ id: n.id, nombre: n.nombre })).sort((a, b) => cmp(a.nombre, b.nombre));
  const dueñas = [...ix.fichas.values()].filter((f) => f.codigo.some((k) => dentroDe(archivo, k))).map((f) => f.id);
  return { cerebro: c.nombre, archivo, entradas, funcionalidades, dueñas, http, llamadas };
}

/** Hasta cuántas líneas y bytes devuelve «Ver código»: lo que pasa se recorta, y la respuesta dice cuánto quedó afuera. */
export const TOPE_LINEAS_CODIGO = 2000, TOPE_BYTES_CODIGO = 512 * 1024;

/**
 * El código fuente de un archivo indexado, para «Ver código» (`/api/archivo?...&contenido=1`). Solo lee archivos que
 * están en el índice del cerebro, desde el clon que se indexó (`raices` de `_build/files`), y nunca fuera de él: un
 * enlace simbólico no lo saca del repo. Si el clon ya no está o el archivo se borró, lo dice en `error`, no falla.
 */
export async function codigoDeArchivo(registro: Registro, nombreCerebro: unknown, idArchivo: unknown) {
  const c = cerebroDe(registro, nombreCerebro);
  const ctx = await cargarContexto(c.raiz);
  const { archivo, repo, ruta } = estructuraDe(ctx, idArchivo);
  const base = { cerebro: c.nombre, archivo, repo, ruta };
  const raiz = ctx.codigo!.raices[repo];
  if (!raiz) return { ...base, error: `the index does not say where the clone of ${repo} is: run flowbrain brains apply ${c.nombre}` };
  let raizRepo: string, destino: string;
  try {
    raizRepo = await realpath(resolve(c.raiz, raiz));
    destino = await realpath(resolve(raizRepo, ruta));
  } catch {
    return { ...base, error: `the file is not in the clone (${join(raiz, ruta)}): it was moved or deleted since it was indexed` };
  }
  if (!destino.startsWith(raizRepo + sep)) throw invalido(`the path leaves the repo: ${ruta}`);
  const buf = await readFile(destino);
  if (buf.subarray(0, 8000).includes(0)) return { ...base, error: "it is a binary file: there is no text to show" };
  const todas = buf.subarray(0, TOPE_BYTES_CODIGO).toString("utf8").split(/\r?\n/);
  if (todas.length > 1 && todas[todas.length - 1] === "") todas.pop();
  const lineas = todas.slice(0, TOPE_LINEAS_CODIGO);
  const total = buf.length > TOPE_BYTES_CODIGO ? null : todas.length;
  return { ...base, lineas, ...(total === null || total > lineas.length ? { recortado: { mostradas: lineas.length, total, bytes: buf.length } } : {}) };
}

/** Valida una edición contra el índice del cerebro y la escribe. Al sumar código, además recompila. */
export async function editar(registro: Registro, ed: Edicion): Promise<ResultadoEdicion> {
  const c = cerebroDe(registro, ed?.cerebro);
  const ctx = await cargarContexto(c.raiz);
  // `rutaDentro` devuelve rutas ya resueltas; la carpeta del registro se resuelve igual para informar una ruta corta.
  const carpeta = await realpath(registro.carpeta).catch(() => registro.carpeta);
  const rel = (abs: string) => relative(carpeta, abs);

  if (ed.tipo === "especificacion") {
    const n = typeof ed.funcionalidad === "string" ? ctx.nodo.get(ed.funcionalidad) : undefined;
    if (!n || n.tipo !== "feat" || !n.pagina || !/\.md$/.test(n.pagina)) throw new ConsultaError("nodo_inexistente", `no such feature (or it has no page): ${String(ed.funcionalidad)}`);
    if (typeof ed.id !== "string" || (ed.estado !== "confirmada" && ed.estado !== "propuesta")) throw invalido("the specification id is missing, or the state is neither confirmada nor propuesta");
    const destino = await rutaDentro(c.raiz, n.pagina);
    let r: { contenido: string; cambio: boolean };
    try {
      r = cambiarEstadoDeEspecificacion(n.pagina, await readFile(destino, "utf8"), ed.id, ed.estado);
    } catch (err) {
      throw new ConsultaError("nodo_inexistente", (err as Error).message);
    }
    if (r.cambio) {
      await writeFile(destino, r.contenido, "utf8");
      await compileDirConVisor(c.raiz);
    }
    return { escrito: rel(destino), cambio: r.cambio, faltaReindexar: false, mensaje: r.cambio ? `Specification ${ed.id} of ${n.nombre} is now ${ed.estado === "confirmada" ? "confirmed" : "proposed"}.` : `Specification ${ed.id} was already ${ed.estado === "confirmada" ? "confirmed" : "proposed"}: nothing was written.` };
  }

  if (ed.tipo === "caso") {
    const n = typeof ed.funcionalidad === "string" ? ctx.nodo.get(ed.funcionalidad) : undefined;
    if (!n || n.tipo !== "feat" || !n.pagina || !/\.md$/.test(n.pagina)) throw new ConsultaError("nodo_inexistente", `no such feature (or it has no page): ${String(ed.funcionalidad)}`);
    if (typeof ed.id !== "string" || (ed.problema !== null && typeof ed.problema !== "string")) throw invalido("the use case id is missing, or the comment is not text");
    const destino = await rutaDentro(c.raiz, n.pagina);
    let r: { contenido: string; cambio: boolean };
    try {
      r = marcarProblemaDeCaso(n.pagina, await readFile(destino, "utf8"), ed.id, ed.problema);
    } catch (err) {
      throw new ConsultaError("nodo_inexistente", (err as Error).message);
    }
    if (r.cambio) {
      await writeFile(destino, r.contenido, "utf8");
      await compileDirConVisor(c.raiz);
    }
    const marca = !!(ed.problema ?? "").trim();
    return {
      escrito: rel(destino),
      cambio: r.cambio,
      faltaReindexar: false,
      mensaje: !r.cambio ? "Nothing changed: it was already like that." : marca ? `Marked as wrong in ${c.nombre}: the agent sees it with /flowbrain-specs and fixes it.` : `Mark removed in ${c.nombre}.`,
    };
  }

  if (ed.tipo === "resultados" || ed.tipo === "decision") {
    const n = typeof ed.funcionalidad === "string" ? ctx.nodo.get(ed.funcionalidad) : undefined;
    if (!n || n.tipo !== "feat" || !n.pagina || !/\.md$/.test(n.pagina)) throw new ConsultaError("nodo_inexistente", `no such feature (or it has no page): ${String(ed.funcionalidad)}`);
    if (ed.tipo === "resultados" && (!Array.isArray(ed.items) || !ed.items.length || ed.items.some((i) => typeof i?.id !== "string"))) throw invalido("the resolved rules are missing: each one with its id");
    if (ed.tipo === "decision" && (typeof ed.id !== "string" || (ed.decision !== null && typeof ed.decision !== "string"))) throw invalido("the rule id is missing, or the decision is not text");
    const destino = await rutaDentro(c.raiz, n.pagina);
    let r: { contenido: string; cambio: boolean };
    try {
      const previo = await readFile(destino, "utf8");
      r = ed.tipo === "resultados" ? anotarResultados(n.pagina, previo, ed.items) : decidirHallazgo(n.pagina, previo, ed.id, ed.decision);
    } catch (err) {
      throw new ConsultaError("parametro_invalido", (err as Error).message);
    }
    if (r.cambio) {
      await writeFile(destino, r.contenido, "utf8");
      await compileDirConVisor(c.raiz);
    }
    return { escrito: rel(destino), cambio: r.cambio, faltaReindexar: false, mensaje: !r.cambio ? "Nothing changed: it was already like that." : ed.tipo === "resultados" ? `Results recorded in ${c.nombre}.` : `Decision saved in ${c.nombre}.` };
  }

  if (ed.tipo === "manual") {
    const n = typeof ed.funcionalidad === "string" ? ctx.nodo.get(ed.funcionalidad) : undefined;
    if (!n || n.tipo !== "feat" || !n.pagina || !/\.md$/.test(n.pagina)) throw new ConsultaError("nodo_inexistente", `no such feature (or it has no page): ${String(ed.funcionalidad)}`);
    if (typeof ed.id !== "string" || (ed.motivo !== null && typeof ed.motivo !== "string")) throw invalido("the specification id is missing, or the reason is not text");
    const destino = await rutaDentro(c.raiz, n.pagina);
    let r: { contenido: string; cambio: boolean };
    try {
      r = marcarPruebaManual(n.pagina, await readFile(destino, "utf8"), ed.id, ed.motivo);
    } catch (err) {
      throw new ConsultaError("nodo_inexistente", (err as Error).message);
    }
    if (r.cambio) {
      await writeFile(destino, r.contenido, "utf8");
      await compileDirConVisor(c.raiz);
    }
    const manual = !!(ed.motivo ?? "").trim();
    return {
      escrito: rel(destino),
      cambio: r.cambio,
      faltaReindexar: false,
      mensaje: !r.cambio ? "Nothing changed: it was already like that." : manual ? `Marked as tested by hand in ${c.nombre}: it no longer counts as untested.` : `Counts as untested again in ${c.nombre}.`,
    };
  }

  const { e, archivo, repo } = estructuraDe(ctx, ed.archivo);

  if (ed.tipo === "funcionalidad") {
    const n = typeof ed.funcionalidad === "string" ? ctx.nodo.get(ed.funcionalidad) : undefined;
    if (!n || n.tipo !== "feat" || !n.pagina) throw new ConsultaError("nodo_inexistente", `no such feature (or it has no page): ${String(ed.funcionalidad)}`);
    const entrada = ed.entrada ?? archivo;
    // Solo el archivo o una carpeta que lo contiene: nada que no tenga que ver con lo que se está corrigiendo.
    if (typeof entrada !== "string" || !dentroDe(archivo, entrada)) throw invalido(`${String(entrada)} is neither ${archivo} nor a folder that contains it`);
    if (!/\.md$/.test(n.pagina)) throw invalido(`the page of ${n.id} is not Markdown: ${n.pagina}`);
    const destino = await rutaDentro(c.raiz, n.pagina);
    const r = agregarCodigoAPagina(n.pagina, await readFile(destino, "utf8"), entrada);
    if (r.cambio) {
      await writeFile(destino, r.contenido, "utf8");
      await compileDirConVisor(c.raiz);
    }
    return { escrito: rel(destino), cambio: r.cambio, faltaReindexar: false, mensaje: r.cambio ? `${entrada} is now part of ${n.nombre}. Brain ${c.nombre} was recompiled.` : `${n.nombre} already covered ${entrada}: nothing was written.` };
  }

  if (!Number.isInteger(ed.linea) || ed.linea < 1) throw invalido("the line must be an integer greater than zero");
  const destino = await rutaDentro(c.raiz, ARCHIVO_LLAMADAS);
  const previo = await readFile(destino, "utf8").catch(() => null);
  let r: { contenido: string; cambio: boolean };

  if (ed.tipo === "http") {
    const metodo = typeof ed.metodo === "string" ? ed.metodo.toUpperCase() : "";
    if (!METODOS.has(metodo)) throw invalido(`unknown HTTP method: ${String(ed.metodo)}`);
    if (typeof ed.ruta !== "string" || !/^\/[^\s"'`<>\\]{0,300}$/.test(ed.ruta)) throw invalido("the path must start with / and contain no spaces or quotes (parameters go as {id})");
    const pendiente = ctx.codigo!.llamadasPendientes.some((l) => l.llamada?.ruta === null && l.evidencia === `${archivo}#L${ed.linea}`);
    if (!pendiente) throw invalido(`there is no HTTP call without a path at ${archivo}#L${ed.linea}`);
    const simbolo = simboloEn(e, ed.linea);
    if (!simbolo) throw invalido(`line ${ed.linea} is not inside any function or method with a range: teach that call with an extractor (flowbrain coverage --guide)`);
    r = agregarDeclaracion(previo, "http", { desde: `${archivo}#${simbolo}`, linea: ed.linea, metodo, ruta: ed.ruta, origen: "persona" });
  } else if (ed.tipo === "llamada") {
    const s = (e.sinResolver ?? []).find((x) => x.linea === ed.linea);
    if (!s) throw invalido(`there is no unresolved call at ${archivo}#L${ed.linea}`);
    const m = typeof ed.hacia === "string" ? /^([^#]+)#([^#]+)$/.exec(ed.hacia) : null;
    if (!m || !m[1]!.startsWith(`${repo}:`)) throw invalido(`the target goes as ${repo}:path#Symbol, in the same repo as the call`);
    if (!ctx.codigo!.estructura.get(m[1]!)?.simbolos.some((x) => x.nombre === m[2])) throw new ConsultaError("nodo_inexistente", `${ed.hacia} does not exist in the index`);
    r = agregarDeclaracion(previo, "llamadas", { desde: `${archivo}#${s.desde}`, linea: ed.linea, hacia: ed.hacia, origen: "persona" });
  } else {
    throw invalido(`unknown edit type: ${String((ed as { tipo?: unknown }).tipo)}`);
  }

  if (r.cambio) {
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, r.contenido, "utf8");
  }
  return {
    escrito: rel(destino),
    cambio: r.cambio,
    faltaReindexar: r.cambio,
    mensaje: r.cambio ? `Declared in ${join(c.nombre, ARCHIVO_LLAMADAS)}. It enters the index when brain ${c.nombre} is reindexed.` : `That line was already declared in ${ARCHIVO_LLAMADAS}: nothing was written.`,
  };
}

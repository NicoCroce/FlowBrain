import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { agregarCodigoAPagina, agregarDeclaracion, cambiarEstadoDeEspecificacion, ARCHIVO_LLAMADAS, cargarContexto, cmp, ConsultaError, dentroDe, type Cerebro, type Contexto, type Registro } from "@flowbrain/core";
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
  | { tipo: "especificacion"; cerebro: string; funcionalidad: string; id: string; estado: string };

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
  if (destino !== raiz && !destino.startsWith(raiz + sep)) throw invalido(`la ruta se sale de la carpeta del cerebro: ${rel}`);
  // La carpeta donde se va a escribir, ya resuelta: un enlace simbólico no puede sacarla del cerebro.
  const carpeta = await realpath(dirname(destino)).catch(() => dirname(destino));
  if (carpeta !== raiz && !carpeta.startsWith(raiz + sep)) throw invalido(`la ruta se sale de la carpeta del cerebro: ${rel}`);
  return destino;
}

function cerebroDe(registro: Registro, nombre: unknown): Cerebro {
  const c = typeof nombre === "string" ? registro.cerebro(nombre) : null;
  if (!c) throw new ConsultaError("nodo_inexistente", `no existe el cerebro: ${String(nombre)}`);
  return c;
}

function estructuraDe(ctx: Contexto, archivo: unknown) {
  const e = typeof archivo === "string" ? ctx.codigo?.estructura.get(archivo) : undefined;
  if (!e || typeof archivo !== "string") throw new ConsultaError("nodo_inexistente", `no hay un archivo indexado con ese id: ${String(archivo)}`);
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

/** Valida una edición contra el índice del cerebro y la escribe. Al sumar código, además recompila. */
export async function editar(registro: Registro, ed: Edicion): Promise<ResultadoEdicion> {
  const c = cerebroDe(registro, ed?.cerebro);
  const ctx = await cargarContexto(c.raiz);
  // `rutaDentro` devuelve rutas ya resueltas; la carpeta del registro se resuelve igual para informar una ruta corta.
  const carpeta = await realpath(registro.carpeta).catch(() => registro.carpeta);
  const rel = (abs: string) => relative(carpeta, abs);

  if (ed.tipo === "especificacion") {
    const n = typeof ed.funcionalidad === "string" ? ctx.nodo.get(ed.funcionalidad) : undefined;
    if (!n || n.tipo !== "feat" || !n.pagina || !/\.md$/.test(n.pagina)) throw new ConsultaError("nodo_inexistente", `no existe la funcionalidad (o no tiene página): ${String(ed.funcionalidad)}`);
    if (typeof ed.id !== "string" || (ed.estado !== "confirmada" && ed.estado !== "propuesta")) throw invalido("falta el id de la especificación, o el estado no es confirmada ni propuesta");
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
    return { escrito: rel(destino), cambio: r.cambio, faltaReindexar: false, mensaje: r.cambio ? `La especificación ${ed.id} de ${n.nombre} quedó ${ed.estado}.` : `La especificación ${ed.id} ya estaba ${ed.estado}: no se escribió nada.` };
  }

  const { e, archivo, repo } = estructuraDe(ctx, ed.archivo);

  if (ed.tipo === "funcionalidad") {
    const n = typeof ed.funcionalidad === "string" ? ctx.nodo.get(ed.funcionalidad) : undefined;
    if (!n || n.tipo !== "feat" || !n.pagina) throw new ConsultaError("nodo_inexistente", `no existe la funcionalidad (o no tiene página): ${String(ed.funcionalidad)}`);
    const entrada = ed.entrada ?? archivo;
    // Solo el archivo o una carpeta que lo contiene: nada que no tenga que ver con lo que se está corrigiendo.
    if (typeof entrada !== "string" || !dentroDe(archivo, entrada)) throw invalido(`${String(entrada)} no es ${archivo} ni una carpeta que lo contenga`);
    if (!/\.md$/.test(n.pagina)) throw invalido(`la página de ${n.id} no es Markdown: ${n.pagina}`);
    const destino = await rutaDentro(c.raiz, n.pagina);
    const r = agregarCodigoAPagina(n.pagina, await readFile(destino, "utf8"), entrada);
    if (r.cambio) {
      await writeFile(destino, r.contenido, "utf8");
      await compileDirConVisor(c.raiz);
    }
    return { escrito: rel(destino), cambio: r.cambio, faltaReindexar: false, mensaje: r.cambio ? `${entrada} ahora es parte de ${n.nombre}. El cerebro ${c.nombre} se recompiló.` : `${n.nombre} ya cubría ${entrada}: no se escribió nada.` };
  }

  if (!Number.isInteger(ed.linea) || ed.linea < 1) throw invalido("la línea tiene que ser un entero mayor que cero");
  const destino = await rutaDentro(c.raiz, ARCHIVO_LLAMADAS);
  const previo = await readFile(destino, "utf8").catch(() => null);
  let r: { contenido: string; cambio: boolean };

  if (ed.tipo === "http") {
    const metodo = typeof ed.metodo === "string" ? ed.metodo.toUpperCase() : "";
    if (!METODOS.has(metodo)) throw invalido(`método HTTP desconocido: ${String(ed.metodo)}`);
    if (typeof ed.ruta !== "string" || !/^\/[^\s"'`<>\\]{0,300}$/.test(ed.ruta)) throw invalido("la ruta tiene que empezar con / y no llevar espacios ni comillas (los parámetros van como {id})");
    const pendiente = ctx.codigo!.llamadasPendientes.some((l) => l.llamada?.ruta === null && l.evidencia === `${archivo}#L${ed.linea}`);
    if (!pendiente) throw invalido(`en ${archivo}#L${ed.linea} no hay una llamada HTTP sin ruta`);
    const simbolo = simboloEn(e, ed.linea);
    if (!simbolo) throw invalido(`la línea ${ed.linea} no está dentro de ninguna función o método con rango: esa llamada se enseña con un extractor (flowbrain coverage --guide)`);
    r = agregarDeclaracion(previo, "http", { desde: `${archivo}#${simbolo}`, linea: ed.linea, metodo, ruta: ed.ruta, origen: "persona" });
  } else if (ed.tipo === "llamada") {
    const s = (e.sinResolver ?? []).find((x) => x.linea === ed.linea);
    if (!s) throw invalido(`en ${archivo}#L${ed.linea} no hay una llamada sin resolver`);
    const m = typeof ed.hacia === "string" ? /^([^#]+)#([^#]+)$/.exec(ed.hacia) : null;
    if (!m || !m[1]!.startsWith(`${repo}:`)) throw invalido(`el destino va como ${repo}:ruta#Simbolo, del mismo repo que la llamada`);
    if (!ctx.codigo!.estructura.get(m[1]!)?.simbolos.some((x) => x.nombre === m[2])) throw new ConsultaError("nodo_inexistente", `no existe ${ed.hacia} en el índice`);
    r = agregarDeclaracion(previo, "llamadas", { desde: `${archivo}#${s.desde}`, linea: ed.linea, hacia: ed.hacia, origen: "persona" });
  } else {
    throw invalido(`tipo de edición desconocido: ${String((ed as { tipo?: unknown }).tipo)}`);
  }

  if (r.cambio) {
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, r.contenido, "utf8");
  }
  return {
    escrito: rel(destino),
    cambio: r.cambio,
    faltaReindexar: r.cambio,
    mensaje: r.cambio ? `Declarado en ${join(c.nombre, ARCHIVO_LLAMADAS)}. Entra al índice al reindexar el cerebro ${c.nombre}.` : `Esa línea ya estaba declarada en ${ARCHIVO_LLAMADAS}: no se escribió nada.`,
  };
}

import { isMap, isSeq, parseDocument, Scalar, YAMLSeq } from "yaml";
import { parsePagina } from "./frontmatter.js";
import { ARCHIVO_LLAMADAS, type HttpDeclarada, type LlamadaDeclarada } from "./llamadas.js";
import { CODIGO, dentroDe, ESTADOS_ESPECIFICACION } from "./schema.js";

/**
 * Ediciones sobre los archivos de un brain que alguien hace a mano desde el visor: sumar código a una funcionalidad y
 * declarar llamadas en `calls.yaml`. Son funciones de texto a texto: no tocan el disco, conservan los comentarios y el
 * resto del archivo tal como estaba, y no escriben nada que ya esté dicho.
 */

/**
 * Suma `entrada` (`repo:ruta`, un archivo o una carpeta) al `codigo` de una página. Si la página ya la cubre (la misma
 * entrada o una carpeta que la contiene), devuelve el contenido sin cambios.
 */
export function agregarCodigoAPagina(archivo: string, contenido: string, entrada: string): { contenido: string; cambio: boolean } {
  if (!CODIGO.test(entrada)) throw new Error(`entrada de código inválida: ${entrada} (va como repo-x:ruta/dentro/del/repo)`);
  const p = parsePagina(archivo, contenido);
  const doc = parseDocument(p.frontmatter, { version: "1.2", schema: "core" });
  let seq = doc.get("codigo", true);
  if (isSeq(seq) && seq.items.some((x) => dentroDe(entrada, String((x as Scalar).value ?? x)))) return { contenido, cambio: false };
  if (!isSeq(seq)) {
    seq = new YAMLSeq();
    doc.set("codigo", seq);
  }
  (seq as YAMLSeq).items.push(doc.createNode(entrada));
  const frontmatter = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return { contenido: `---\n${frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}\n`}---\n${p.cuerpo}`, cambio: true };
}

/**
 * Cambia el `estado` de una especificación de la página de una funcionalidad: `confirmada` cuando una persona la leyó
 * y la da por buena, `propuesta` para volver atrás. No toca el texto ni el resto de la página.
 */
export function cambiarEstadoDeEspecificacion(archivo: string, contenido: string, id: string, estado: string): { contenido: string; cambio: boolean } {
  if (!(ESTADOS_ESPECIFICACION as readonly string[]).includes(estado)) throw new Error(`estado desconocido: ${estado} (va ${ESTADOS_ESPECIFICACION.join(" o ")})`);
  const p = parsePagina(archivo, contenido);
  const doc = parseDocument(p.frontmatter, { version: "1.2", schema: "core" });
  const seq = doc.get("especificaciones", true);
  const item = isSeq(seq) ? seq.items.find((x) => isMap(x) && x.get("id") === id) : undefined;
  if (!item || !isMap(item)) throw new Error(`la página ${archivo} no tiene una especificación con id ${id}`);
  if ((item.get("estado") ?? "propuesta") === estado) return { contenido, cambio: false };
  item.set("estado", estado);
  const frontmatter = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return { contenido: `---\n${frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}\n`}---\n${p.cuerpo}`, cambio: true };
}

/**
 * Marca un caso de uso de la página de una funcionalidad como mal (`problema` con lo que una persona dice que está mal)
 * o le saca la marca (`problema` nulo o vacío). El agente lee la marca, corrige el caso y la borra.
 */
export function marcarProblemaDeCaso(archivo: string, contenido: string, id: string, problema: string | null): { contenido: string; cambio: boolean } {
  return ponerTexto(archivo, contenido, { lista: "casos", que: "un caso de uso", id, campo: "problema", valor: problema, max: 1000, nombre: "el comentario" });
}

/**
 * Decide que una especificación se prueba a mano (`manual` con el motivo) o lo deshace (`null` o vacío). Una
 * especificación con `manual` cuenta como verificada aunque no tenga test.
 */
export function marcarPruebaManual(archivo: string, contenido: string, id: string, motivo: string | null): { contenido: string; cambio: boolean } {
  return ponerTexto(archivo, contenido, { lista: "especificaciones", que: "una especificación", id, campo: "manual", valor: motivo, max: 300, nombre: "el motivo" });
}

/** Pone (o borra, si viene vacío) un texto entre comillas en el elemento `id` de una lista del frontmatter, texto a texto. */
function ponerTexto(archivo: string, contenido: string, o: { lista: string; que: string; id: string; campo: string; valor: string | null; max: number; nombre: string }): { contenido: string; cambio: boolean } {
  const nota = (o.valor ?? "").replace(/\s+/g, " ").trim();
  if (nota.length > o.max) throw new Error(`${o.nombre} no puede pasar de ${o.max} caracteres`);
  const p = parsePagina(archivo, contenido);
  const doc = parseDocument(p.frontmatter, { version: "1.2", schema: "core" });
  const seq = doc.get(o.lista, true);
  const item = isSeq(seq) ? seq.items.find((x) => isMap(x) && x.get("id") === o.id) : undefined;
  if (!item || !isMap(item)) throw new Error(`la página ${archivo} no tiene ${o.que} con id ${o.id}`);
  if ((item.get(o.campo) ?? "") === nota) return { contenido, cambio: false };
  if (nota) {
    const v = doc.createNode(nota) as Scalar;
    v.type = Scalar.QUOTE_DOUBLE;
    item.set(o.campo, v);
  } else item.delete(o.campo);
  const frontmatter = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return { contenido: `---\n${frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}\n`}---\n${p.cuerpo}`, cambio: true };
}

const CABECERA = "# Llamadas que el código no declara con tipos, resueltas leyendo el código. Se aplican al indexar.\n";

/** Suma una declaración a `calls.yaml` (`texto` es `null` si el archivo todavía no existe). No repite una que ya esté. */
export function agregarDeclaracion(texto: string | null, seccion: "llamadas", item: LlamadaDeclarada): { contenido: string; cambio: boolean };
export function agregarDeclaracion(texto: string | null, seccion: "http", item: HttpDeclarada): { contenido: string; cambio: boolean };
export function agregarDeclaracion(texto: string | null, seccion: "llamadas" | "http", item: LlamadaDeclarada | HttpDeclarada): { contenido: string; cambio: boolean } {
  const previo = texto ?? CABECERA;
  const doc = parseDocument(previo, { version: "1.2", schema: "core" });
  if (doc.errors.length) throw new Error(`${ARCHIVO_LLAMADAS}: YAML inválido (${doc.errors[0]!.message.split("\n")[0]}); corregilo antes de sumar declaraciones`);
  let seq = doc.get(seccion, true);
  const ya = (isSeq(seq) ? (seq.toJSON() as Array<Record<string, unknown>>) : []).some((x) => x?.["desde"] === item.desde && x["linea"] === item.linea);
  if (ya) return { contenido: previo, cambio: false };
  if (!isSeq(seq)) {
    seq = new YAMLSeq();
    doc.set(seccion, seq);
  }
  const nodo = doc.createNode(Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)));
  // Los textos van entre comillas, como en los archivos escritos a mano: un `#` o un `:` no rompen nada.
  for (const it of (nodo as { items: Array<{ value: unknown }> }).items) if (it.value instanceof Scalar && typeof it.value.value === "string") it.value.type = Scalar.QUOTE_DOUBLE;
  (seq as YAMLSeq).items.push(nodo);
  return { contenido: doc.toString({ lineWidth: 0 }), cambio: true };
}

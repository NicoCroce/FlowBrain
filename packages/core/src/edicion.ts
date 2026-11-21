import { isSeq, parseDocument, Scalar, YAMLSeq } from "yaml";
import { parsePagina } from "./frontmatter.js";
import { ARCHIVO_LLAMADAS, type HttpDeclarada, type LlamadaDeclarada } from "./llamadas.js";
import { CODIGO, dentroDe } from "./schema.js";

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

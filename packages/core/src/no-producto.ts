import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMap, isSeq, parse, parseDocument, Scalar, YAMLSeq } from "yaml";
import { CODIGO } from "./schema.js";

/**
 * Lo que no es código de producto: tests, configuración, scripts, generados. Una persona lo marca desde la pantalla
 * «Sin asociar» del visor («No es de producto») para que deje de aparecer ahí y en `sin_asociar`: no es de ninguna
 * funcionalidad y no tiene por qué serlo. Vive en `not-product.yaml`, en la raíz del brain, como `calls.yaml`: es una
 * marca manual del brain (no de una página, porque un archivo sin funcionalidad no tiene página) y sobrevive a
 * reindexar y a recompilar. Se deshace sacando la entrada.
 *
 * ```yaml
 * no_producto:
 *   - entrada: "repo-x:scripts"        # un archivo o una carpeta, como en `codigo`
 *     motivo: script                   # test | config | script | generado | otro
 *     origen: persona
 * ```
 */
export const ARCHIVO_NO_PRODUCTO = "not-product.yaml";

export const MOTIVOS_NO_PRODUCTO = ["test", "config", "script", "generado", "otro"] as const;
export type MotivoNoProducto = (typeof MOTIVOS_NO_PRODUCTO)[number];

export interface MarcaNoProducto {
  /** `repo:ruta` de un archivo o de una carpeta (todo lo de adentro). */
  entrada: string;
  motivo: MotivoNoProducto;
  origen?: string;
}

const CABECERA = `# Files that are not product code (tests, configuration, scripts, generated). FlowBrain's Unassigned screen and the
# sin_asociar tool stop listing them. Remove an entry to list them again. Format: see ARCHIVO_NO_PRODUCTO in FlowBrain.
`;

/** Lee `not-product.yaml`. Las entradas mal formadas se descartan con el motivo. */
export function leerNoProducto(texto: string | null): { marcas: MarcaNoProducto[]; rechazadas: string[] } {
  const marcas: MarcaNoProducto[] = [], rechazadas: string[] = [];
  if (!texto) return { marcas, rechazadas };
  let doc: unknown;
  try {
    doc = parse(texto);
  } catch (e) {
    return { marcas, rechazadas: [`${ARCHIVO_NO_PRODUCTO}: invalid YAML (${(e as Error).message.split("\n")[0]})`] };
  }
  const lista = (doc as { no_producto?: unknown } | null)?.no_producto;
  (Array.isArray(lista) ? lista : []).forEach((x: Record<string, unknown>, i) => {
    const entrada = typeof x?.["entrada"] === "string" ? x["entrada"].trim() : "";
    const motivo = typeof x?.["motivo"] === "string" ? x["motivo"].trim() : "otro";
    if (!CODIGO.test(entrada)) rechazadas.push(`no_producto ${i + 1}: \`entrada\` must be repo-x:path`);
    else if (!(MOTIVOS_NO_PRODUCTO as readonly string[]).includes(motivo)) rechazadas.push(`no_producto ${i + 1}: unknown motivo ${motivo} (${MOTIVOS_NO_PRODUCTO.join(", ")})`);
    else if (!marcas.some((m) => m.entrada === entrada)) marcas.push({ entrada, motivo: motivo as MotivoNoProducto, ...(typeof x["origen"] === "string" ? { origen: x["origen"] } : {}) });
  });
  return { marcas, rechazadas };
}

/** Las marcas de un brain en disco; sin archivo, ninguna. */
export async function cargarNoProducto(raiz: string): Promise<MarcaNoProducto[]> {
  const texto = await readFile(join(raiz, ARCHIVO_NO_PRODUCTO), "utf8").catch(() => null);
  return leerNoProducto(texto).marcas;
}

/**
 * Marca `entrada` como no de producto con su `motivo`, o le saca la marca (`motivo` nulo). Texto a texto: conserva los
 * comentarios y no escribe nada que ya esté dicho. Cambiar el motivo de una entrada ya marcada lo reemplaza.
 */
export function marcarNoProducto(texto: string | null, entrada: string, motivo: string | null): { contenido: string; cambio: boolean } {
  if (!CODIGO.test(entrada)) throw new Error(`invalid entry: ${entrada} (format: repo-x:path/inside/the/repo)`);
  if (motivo !== null && !(MOTIVOS_NO_PRODUCTO as readonly string[]).includes(motivo)) throw new Error(`unknown motivo: ${motivo} (expected ${MOTIVOS_NO_PRODUCTO.join(", ")})`);
  const previo = texto ?? CABECERA;
  const doc = parseDocument(previo, { version: "1.2", schema: "core" });
  if (doc.errors.length) throw new Error(`${ARCHIVO_NO_PRODUCTO}: invalid YAML (${doc.errors[0]!.message.split("\n")[0]}); fix it before marking`);
  let seq = doc.get("no_producto", true);
  const items = isSeq(seq) ? seq.items : [];
  const i = items.findIndex((x) => isMap(x) && x.get("entrada") === entrada);
  if (motivo === null) {
    if (i < 0) return { contenido: previo, cambio: false };
    (seq as YAMLSeq).items.splice(i, 1);
    return { contenido: doc.toString({ lineWidth: 0 }), cambio: true };
  }
  const m = i >= 0 ? items[i] : undefined;
  if (isMap(m)) {
    if (m.get("motivo") === motivo) return { contenido: previo, cambio: false };
    m.set("motivo", motivo);
    return { contenido: doc.toString({ lineWidth: 0 }), cambio: true };
  }
  if (!isSeq(seq)) {
    seq = new YAMLSeq();
    doc.set("no_producto", seq);
  }
  const nodo = doc.createNode({ entrada, motivo, origen: "persona" });
  for (const it of (nodo as { items: Array<{ value: unknown }> }).items) if (it.value instanceof Scalar && typeof it.value.value === "string" && it.value.value === entrada) it.value.type = Scalar.QUOTE_DOUBLE;
  (seq as YAMLSeq).items.push(nodo);
  return { contenido: doc.toString({ lineWidth: 0 }), cambio: true };
}

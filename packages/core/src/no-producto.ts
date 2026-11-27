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
 * La misma marca vale para un endpoint que nadie llama a propósito (dec. 232): un webhook, algo que usa un cliente
 * que no está indexado, algo que se deja vivo adrede. Se marca desde la deriva de Contratos («Sin uso a propósito»),
 * con el id del endpoint como `entrada` y el motivo `sin-uso` (solo un endpoint lleva ese motivo, y un endpoint solo
 * lleva ese), y `deriva` deja de listarlo entre los endpoints sin llamadas.
 *
 * ```yaml
 * no_producto:
 *   - entrada: "repo-x:scripts"        # un archivo o una carpeta, como en `codigo`
 *     motivo: script                   # test | config | script | generado | otro
 *     origen: persona
 *   - entrada: "svc-x:POST:/webhooks/pago"   # un endpoint (su id)
 *     motivo: sin-uso
 *     origen: persona
 * ```
 */
export const ARCHIVO_NO_PRODUCTO = "not-product.yaml";

export const MOTIVOS_NO_PRODUCTO = ["test", "config", "script", "generado", "otro", "sin-uso"] as const;
export type MotivoNoProducto = (typeof MOTIVOS_NO_PRODUCTO)[number];
/** El motivo de un endpoint sin llamadas a propósito: el único que lleva un endpoint. */
export const SIN_USO = "sin-uso" satisfies MotivoNoProducto;
/** El id de un endpoint del grafo: `svc-x:MÉTODO:/ruta`. */
export const ENDPOINT_ID = /^svc-[a-z0-9-]+:[A-Z]+:\/\S*$/;
/** ¿La marca es de un endpoint (y no de un archivo o carpeta)? */
export const esMarcaDeEndpoint = (m: Pick<MarcaNoProducto, "entrada">) => ENDPOINT_ID.test(m.entrada);

/** Por qué no vale una entrada con su motivo (null si vale). */
function invalida(entrada: string, motivo: string): string | null {
  if (ENDPOINT_ID.test(entrada)) return motivo === SIN_USO ? null : `an endpoint only takes motivo ${SIN_USO}`;
  if (!CODIGO.test(entrada)) return `invalid entry: ${entrada} (format: repo-x:path/inside/the/repo, or an endpoint id svc-x:METHOD:/route)`;
  if (motivo === SIN_USO) return `motivo ${SIN_USO} is only for an endpoint`;
  return (MOTIVOS_NO_PRODUCTO as readonly string[]).includes(motivo) ? null : `unknown motivo: ${motivo} (expected ${MOTIVOS_NO_PRODUCTO.join(", ")})`;
}

export interface MarcaNoProducto {
  /** `repo:ruta` de un archivo o de una carpeta (todo lo de adentro), o el id de un endpoint (`svc-x:GET:/ruta`). */
  entrada: string;
  motivo: MotivoNoProducto;
  origen?: string;
}

const CABECERA = `# Files that are not product code (tests, configuration, scripts, generated), and endpoints nobody calls on purpose
# (motivo: sin-uso). FlowBrain's Unassigned screen and the sin_asociar tool stop listing those files; Contracts and the
# deriva tool stop listing those endpoints. Remove an entry to list it again. Format: see ARCHIVO_NO_PRODUCTO in FlowBrain.
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
    const no = invalida(entrada, motivo);
    if (no) rechazadas.push(`no_producto ${i + 1}: ${no}`);
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
 * comentarios y no escribe nada que ya esté dicho. Cambiar el motivo de una entrada ya marcada lo reemplaza. Un
 * endpoint se marca igual, con el motivo `sin-uso`.
 */
export function marcarNoProducto(texto: string | null, entrada: string, motivo: string | null): { contenido: string; cambio: boolean } {
  if (!CODIGO.test(entrada) && !ENDPOINT_ID.test(entrada)) throw new Error(`invalid entry: ${entrada} (format: repo-x:path/inside/the/repo, or an endpoint id svc-x:METHOD:/route)`);
  const no = motivo === null ? null : invalida(entrada, motivo);
  if (no) throw new Error(no);
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

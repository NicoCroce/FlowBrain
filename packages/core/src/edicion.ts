import { isMap, isSeq, parseDocument, Scalar, YAMLSeq } from "yaml";
import { parsePagina } from "./frontmatter.js";
import { ARCHIVO_LLAMADAS, type HttpDeclarada, type LlamadaDeclarada } from "./llamadas.js";
import { CODIGO, dentroDe, DECISIONES_HALLAZGO, ESTADOS_ESPECIFICACION, HallazgoSchema, TEST_REF, type Hallazgo } from "./schema.js";

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

/** Lo que un agente resolvió de una regla: tests nuevos o ya existentes que la verifican, o un hallazgo (o `null`: borrarlo). */
export interface ResultadoDeRegla {
  id: string;
  tests?: string[];
  hallazgo?: Hallazgo | null;
}

const cuerpoNuevo = (p: { cuerpo: string }, doc: ReturnType<typeof parseDocument>) => {
  const frontmatter = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return `---\n${frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}\n`}---\n${p.cuerpo}`;
};

/**
 * Anota en una página, de una vez, lo que un agente resolvió de varias reglas: suma los `tests` que faltan (sin repetir),
 * y pone o saca el `hallazgo`. Un resultado con tests borra un hallazgo viejo: la regla ya está verificada. No toca el
 * texto, el tipo ni `manual`. Falla antes de escribir si una regla no existe o algo no tiene el formato.
 */
export function anotarResultados(archivo: string, contenido: string, resultados: ResultadoDeRegla[]): { contenido: string; cambio: boolean } {
  const p = parsePagina(archivo, contenido);
  const doc = parseDocument(p.frontmatter, { version: "1.2", schema: "core" });
  const seq = doc.get("especificaciones", true);
  let cambio = false;
  for (const r of resultados) {
    const item = isSeq(seq) ? seq.items.find((x) => isMap(x) && x.get("id") === r.id) : undefined;
    if (!item || !isMap(item)) throw new Error(`la página ${archivo} no tiene una especificación con id ${r.id}`);
    for (const t of r.tests ?? []) {
      if (!TEST_REF.test(t)) throw new Error(`test inválido: ${t} (va repo-x:ruta::nombre del caso)`);
    }
    const previos: unknown = item.get("tests", true);
    const nuevos = (r.tests ?? []).filter((t) => !(isSeq(previos) && previos.items.some((x) => String((x as Scalar).value ?? x) === t)));
    if (nuevos.length) {
      let lista: YAMLSeq;
      if (isSeq(previos)) lista = previos;
      else {
        lista = new YAMLSeq();
        item.set("tests", lista);
      }
      for (const t of nuevos) lista.items.push(doc.createNode(t));
      cambio = true;
    }
    let h: Hallazgo | null | undefined = r.hallazgo;
    if ((r.tests ?? []).length && h === undefined) h = null;
    if (h === null && item.has("hallazgo")) {
      item.delete("hallazgo");
      cambio = true;
    } else if (h) {
      const ok = HallazgoSchema.parse({ resultado: h.resultado, ...(h.hoy ? { hoy: h.hoy } : {}), cambio: h.cambio, ...(h.test ? { test: h.test } : {}), ...(h.decision ? { decision: h.decision } : {}) });
      const nodo = doc.createNode(ok) as unknown as { items: Array<{ key: Scalar; value: Scalar }> };
      for (const par of nodo.items) {
        if (typeof par.value.value === "string" && (par.key.value === "test" || par.value.value.includes("\n"))) par.value.type = Scalar.BLOCK_LITERAL;
        else if (typeof par.value.value === "string") par.value.type = Scalar.QUOTE_DOUBLE;
      }
      const actual: unknown = item.get("hallazgo", true);
      if (JSON.stringify(isMap(actual) ? actual.toJSON() : null) !== JSON.stringify(ok)) {
        item.set("hallazgo", nodo);
        cambio = true;
      }
    }
  }
  return cambio ? { contenido: cuerpoNuevo(p, doc), cambio: true } : { contenido, cambio: false };
}

/**
 * Una persona decide qué hacer con un hallazgo: `regla_mal` (la regla se corrige; la corrige el agente) o `codigo_mal`
 * (pasa a desarrollo). `null` borra la decisión. Solo vale sobre una regla que tiene hallazgo.
 */
export function decidirHallazgo(archivo: string, contenido: string, id: string, decision: string | null): { contenido: string; cambio: boolean } {
  if (decision !== null && !(DECISIONES_HALLAZGO as readonly string[]).includes(decision)) throw new Error(`decisión desconocida: ${decision} (va ${DECISIONES_HALLAZGO.join(" o ")})`);
  const p = parsePagina(archivo, contenido);
  const doc = parseDocument(p.frontmatter, { version: "1.2", schema: "core" });
  const seq = doc.get("especificaciones", true);
  const item = isSeq(seq) ? seq.items.find((x) => isMap(x) && x.get("id") === id) : undefined;
  if (!item || !isMap(item)) throw new Error(`la página ${archivo} no tiene una especificación con id ${id}`);
  const h = item.get("hallazgo", true);
  if (!isMap(h)) throw new Error(`la especificación ${id} no tiene hallazgo`);
  if ((h.get("decision") ?? null) === decision) return { contenido, cambio: false };
  if (decision) h.set("decision", decision);
  else h.delete("decision");
  return { contenido: cuerpoNuevo(p, doc), cambio: true };
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

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { cargarContexto, CIERRE_DE_DERIVA, parsePagina, COMO_RESOLVER_DERIVA, ConsultaError, especificaciones, REGLAS_DE_DERIVA, fidelidadDeArchivos, planDeFidelidad, TEST_REF, type Contexto, type FidelidadArchivo, type Registro, type Signal } from "@flowbrain/core";
import type { DerivaVisor } from "@flowbrain/viewer";
import { compileDirConVisor } from "@flowbrain/viewer";
import { borradorRevisado } from "./borradores.js";
import { aplicarCerebro, derivaDelCerebro } from "./cerebros.js";
import type { Edicion } from "./edicion.js";
import { GUIA_ESPECIFICACIONES, GUIA_FUNCIONALIDADES, GUIA_TESTS } from "./guia.js";
import { claudeCode, HERRAMIENTAS_PERMITIDAS, HERRAMIENTAS_PROHIBIDAS, pasosDeEvento, PROVEEDORES, type AdaptadorDeAgente, type ModeloDeAgente } from "./proveedores.js";

export { HERRAMIENTAS_PERMITIDAS, HERRAMIENTAS_PROHIBIDAS, pasosDeEvento };

/**
 * El agente que atiende los pedidos del visor (`flowbrain viewer --serve`): en vez de copiar el pedido y pegarlo en
 * un agente, la página se lo manda al servidor y este corre el agente elegido (hoy Claude Code, sin conversación) en la
 * carpeta del proyecto, con la guía que corresponde y permisos acotados (`proveedores.ts`). La página ve el avance,
 * puede cancelar y, al terminar, qué archivos cambió en cada repo (sin commitear: los revisa una persona).
 *
 * Hay dos formas de pedir:
 * - un pedido suelto (`encolar`): va de a uno, en cola;
 * - un lote (`encolarLote`), de dos clases:
 *   - `test` (pantalla Especificaciones): reglas a testear. Se reparte por repo, los repos corren en paralelo y cada
 *     uno va en tandas de 10 a 15 reglas, una detrás de otra. Cada tanda responde, regla por regla, uno de cuatro
 *     resultados y el servidor lo anota en las páginas (las tandas no editan páginas: dos repos en paralelo no se pisan).
 *   - `asociar` (pantalla Sin asociar): archivos sin funcionalidad. Las tandas (hasta 30 archivos de un mismo repo)
 *     editan las páginas `feat-*`/`lib-*` del cerebro, así que las de un cerebro van una detrás de otra y los cerebros,
 *     en paralelo. Al terminar cada tanda el servidor compila el cerebro y mide cuáles de sus archivos dejaron de
 *     estar sin asociar: eso es lo que cuenta el resumen, no lo que diga el agente.
 *   - `agrupar`, `escribir` y `corregir` (pantalla Especificaciones, dec. 230): funcionalidades a las que agrupar sus
 *     reglas sueltas en casos de uso, a las que escribirles casos y reglas, o casos marcados como mal y reglas a
 *     corregir. Editan las páginas de producto de varios cerebros a la vez (el mismo caso lleva el mismo id en cada
 *     uno), así que las tandas van una detrás de otra, con lo de una misma funcionalidad junto. Al terminar cada tanda
 *     el servidor compila sus cerebros y mira en las páginas qué quedó resuelto (`resueltos`) y qué no (`quedan`).
 *   - `fidelidad` (pantalla Fidelidad, dec. 231): archivos con lo que les falta para llegar a 100. Las tandas (hasta 10
 *     archivos de un mismo repo) declaran en la carpeta del cerebro (`calls.yaml`, extractores, páginas de tablas), así
 *     que las de un cerebro van una detrás de otra y los cerebros, en paralelo. Al terminar cada tanda el servidor
 *     reindexa el cerebro y mide cuáles de las faltas pedidas ya no están (`completados`) y cuáles siguen (`pendientes`).
 *   - `deriva` (pantalla Contratos, dec. 232): problemas de la deriva (llamadas que nadie atiende o con varios
 *     candidatos, endpoints que nadie llama, campos que no coinciden). Las tandas (hasta 10 problemas de un mismo repo)
 *     arreglan la llamada en el código del repo o declaran su destino en `calls.yaml`, y lo que proponen borrar lo
 *     dejan en una nota (nunca borran). Las de un cerebro van una detrás de otra; los cerebros, en paralelo. Al terminar
 *     cada tanda el servidor reindexa el cerebro, rehace su deriva y mide qué problemas ya no están (`corregidos`).
 *   - `funcionalidad` (pantalla Funcionalidades, dec. 233): funcionalidades sin nombre de negocio ni descripción, o
 *     un cerebro sin ninguna al que proponérselas (ítem sin `funcionalidad`). Van como las de Especificaciones (mismo
 *     motor de tandas), pero con la guía de `flowbrain features --guide` y escribiendo SOLO borradores en
 *     `_drafts/product/`: una persona los revisa y los promueve. Al terminar cada tanda el servidor mira los borradores:
 *     resuelto es un borrador de esa funcionalidad (o, en una propuesta, alguno nuevo) con nombre y resumen de verdad.
 *   - `borrador` (pantalla Borradores, dec. 234): borradores de `_drafts/` que una persona devuelve con una nota
 *     («Pedir corrección»), o notas `flowbrain-nota` a resolver. El mismo motor de tandas; escribe SOLO en `_drafts/`
 *     (nunca promueve: lo acepta una persona). Resuelto es el borrador que cambió desde que empezó la tanda (una nota:
 *     también si ya no está).
 *   En todos, una tanda que falla no frena a las demás, y se cancela el lote entero o una tanda. Al terminar, cada
 *   tanda dice cómo terminó cada ítem, igual para todos los tipos (`desenlaces`, dec. 235): resuelto con lo que cambió,
 *   o no, con el motivo (lo que midió el servidor y lo que dijo el agente en su bloque `flowbrain-pending`).
 */

export type TipoDePedido = "test" | "agrupar" | "escribir" | "corregir" | "funcionalidad" | "borrador" | "asociar" | "fidelidad" | "deriva";
export const TIPOS_DE_PEDIDO: readonly TipoDePedido[] = ["test", "agrupar", "escribir", "corregir", "funcionalidad", "borrador", "asociar", "fidelidad", "deriva"];

/**
 * Guía de un pedido «asociar» (pantalla Sin asociar): asociar archivos a su funcionalidad o librería, o proponer un
 * borrador nuevo. Va con permisos acotados (`permisosDelPedido`): solo escribe las páginas `feat-*` y `lib-*` del
 * cerebro (lo mismo que escribe «Asociar») y borradores en `_drafts/`; nunca el código de los repos.
 */
export const GUIA_ASOCIAR = `You are going to complete this project's feature catalog in FlowBrain: assign files that today belong to no
feature or library, or propose the drafts that are missing.

$ARGUMENTS

## Rules

- **Do not modify the project's repositories.** This request can only write, inside each brain folder
  (\`.flowbrain/<brain>/\`): the \`codigo\` list of \`product/feat-*.md\` and \`technology/lib-*.md\` pages that already
  exist, and new drafts in \`_drafts/\`. Any other write will be refused.
- **Do not open real environment files** (\`.env\` and similar). No network.
- **Open each file before deciding.** The recommendation is a hint, not a fact. When you cannot tell, leave it and say
  why in your answer.
- To assign: add \`repo:path\` (the file, or its folder when the whole folder belongs to it) to the \`codigo\` list in
  the frontmatter of the page. Do not touch the rest of the page.
- A new feature goes as a draft: \`.flowbrain/<brain>/_drafts/product/feat-<id>.md\`, with \`tipo: feat\`, a business
  \`nombre\`, a one-line \`resumen\`, its \`codigo\`, its use cases and specifications (\`flowbrain specs --guide\` explains
  them; mark them as proposed). A new library goes as a draft: \`.flowbrain/<brain>/_drafts/<repo-id>/technology/lib-<id>.md\`
  with \`tipo: lib\`, \`nombre\`, \`resumen\` and its \`codigo\`. A person reviews and promotes them
  (\`flowbrain promote <id> --write\`): do not promote them yourself.
- Tests, configuration, scripts and generated files are not product: do not assign them; list them in your answer so
  the person marks them as «Not product» in the viewer.
- Reply in the user's language, briefly.

## Steps

1. For each file, read it and, if needed, \`flowbrain feature <id> --brain <brain>\` for the candidate feature.
2. Edit the pages (or write the drafts). After editing pages of a brain, run \`flowbrain compile --brain <brain>\`;
   if it does not compile, fix your edit.
3. \`flowbrain unassigned --brain <brain>\` shows what is still unassigned.
4. Report: what you assigned and where, the drafts you wrote, and what you left and why.
`;

/**
 * Guía de un pedido «fidelidad» (pantalla Fidelidad): llevar a 100 lo que el índice entendió de unos archivos. El plan
 * de cada tanda (`planDeFidelidad`, el mismo de `flowbrain fidelity --plan`) dice qué falta y cómo se resuelve cada
 * cosa; esta guía pone los límites. Va con permisos acotados (`permisosDelPedido`): solo escribe lo que el plan deja
 * declarar en la carpeta del cerebro (`calls.yaml`, extractores, páginas de tablas); nunca el código de los repos.
 */
export const GUIA_FIDELIDAD = `You are going to improve how well FlowBrain's index understood some files of this project: declare what the
parser could not read, so each file's fidelity score reaches 100.

$ARGUMENTS

## Limits

- **Do not modify the project's repositories.** This request can only write, inside the brain folder
  (\`.flowbrain/<brain>/\`): \`calls.yaml\`, extractors in \`extractors/\` and table pages
  (\`technology/tabla-*.md\`). Any other write will be refused.
- **Do not open real environment files** (\`.env\` and similar). No network.
- Only declare what you read in the code. What you cannot determine stays pending: say so in your answer.
- Reply in the user's language, briefly: what reached 100, what didn't and why.
`;

/**
 * Guía de un pedido «deriva» (pantalla Contratos): arreglar lo que no cierra entre lo que se llama y lo que se atiende.
 * Va con permisos acotados (`permisosDelPedido`): el código del repo de la tanda, y en la carpeta del cerebro su
 * `calls.yaml` y notas en `_drafts/`. Nunca un cambio destructivo: lo que se podría borrar va a la nota.
 */
export const GUIA_DERIVA = `You are going to fix contract drift that FlowBrain found between this project's services: calls nobody serves,
endpoints nobody calls, and calls whose fields do not match the endpoint contract.

$ARGUMENTS

## Limits

- You can only write the code of this batch's repo and, inside the brain folder (\`.flowbrain/<brain>/\`), its
  \`calls.yaml\` and notes in \`_drafts/\`. Any other write will be refused. No network.
${REGLAS_DE_DERIVA.map((r) => `- ${r}`).join("\n")}

## How to resolve each problem

- **A call nobody serves**: ${COMO_RESOLVER_DERIVA.sinEndpoint}
- **A call matching several endpoints**: ${COMO_RESOLVER_DERIVA.disputada}
- **An endpoint nobody calls**: ${COMO_RESOLVER_DERIVA.sinLlamadas}
- **Mismatched fields**: ${COMO_RESOLVER_DERIVA.campos}

## When done

${CIERRE_DE_DERIVA.map((c, i) => `${i + 1}. ${c}`).join("\n")} Reply in the user's language.
`;

/** Comandos que puede correr un pedido «deriva»: leer FlowBrain, compilar y reindexar el cerebro; nada de tests ni de git que cambie algo. */
const COMANDOS_DERIVA = ["flowbrain drift", "flowbrain calls", "flowbrain contract", "flowbrain callers", "flowbrain impact", "flowbrain flow", "flowbrain screen", "flowbrain search", "flowbrain feature", "flowbrain status", "flowbrain compile", "flowbrain brains apply", "cd", "ls", "git status", "git diff", "git log"];

/** Comandos que puede correr un pedido «fidelidad»: leer FlowBrain, compilar y reindexar el cerebro; nada de tests. */
const COMANDOS_FIDELIDAD = ["flowbrain calls", "flowbrain fidelity", "flowbrain flow", "flowbrain screen", "flowbrain drift", "flowbrain coverage", "flowbrain search", "flowbrain feature", "flowbrain status", "flowbrain compile", "flowbrain brains apply", "cd", "ls", "git status", "git diff"];

/** Comandos que puede correr un pedido «asociar»: leer FlowBrain y compilar; nada de tests ni de promover. */
const COMANDOS_ASOCIAR = ["flowbrain compile", "flowbrain unassigned", "flowbrain feature", "flowbrain status", "flowbrain brains", "flowbrain screen", "flowbrain connections", "flowbrain specs --guide", "cd", "ls", "git status", "git diff"];

/**
 * Comandos que puede correr un pedido sobre las especificaciones (agrupar, escribir, corregir): leer FlowBrain (el
 * flujo de un endpoint, una pantalla, los casos de test) y compilar; nada de tests ni de promover.
 */
const COMANDOS_ESPECIFICACIONES = ["flowbrain compile", "flowbrain specs", "flowbrain feature", "flowbrain flow", "flowbrain screen", "flowbrain status", "flowbrain brains", "flowbrain connections", "cd", "ls", "git status", "git diff"];

/**
 * Guía de un pedido «borrador» (pantalla Borradores): revisar borradores que una persona devolvió con una nota, o
 * resolver notas que alguien dejó sobre el cerebro. Solo `_drafts/`: una persona acepta lo que quede.
 */
export const GUIA_BORRADOR = `You are going to revise FlowBrain drafts that a person reviewed in the viewer and sent back with a note, or resolve
notes left about the brain (\`_drafts/notes/\`). A draft is a page waiting for review in \`.flowbrain/<brain>/_drafts/\`.

$ARGUMENTS

## Rules

- **Do not modify the project's repositories**, and do not edit \`product/\` or \`technology/\`: you only write in
  \`.flowbrain/<brain>/_drafts/\`. Never promote anything (\`flowbrain promote\`): the person accepts the drafts.
- **Do not open real environment files** (\`.env\` and similar).
- **Everything comes from the code.** Read the code the page names (\`codigo\`, evidence \`repo:path#Ln\`) and the
  current page (\`product/<id>.md\` or \`technology/<id>.md\`, if there is one) before changing anything. What you
  cannot deduce goes in the page's open questions section.
- Keep the page format (\`flowbrain specs --guide\` explains use cases and specifications): same \`id\`, same \`tipo\`.
- Reply in the user's language. Page text goes in the product's language (the language of the page itself).

## Steps

1. For each draft: read the person's note, the draft and the current page; apply what the note asks, editing the
   draft file in place. If the note asks for something the code contradicts, leave the draft as is and say why.
2. For each note in \`_drafts/notes/\`: check against the code whether it still holds. If it does, write the fix as a
   draft (copy the page to \`_drafts/product/<id>.md\` and fix it there); then delete the note file. If it no longer
   holds, delete the note file and say why.
3. At the end, list what you changed, draft by draft, in one line each.
`;

/** Comandos que puede correr un pedido «borrador»: leer FlowBrain y sus guías; nada de proponer, promover ni tests. */
const COMANDOS_BORRADOR = ["flowbrain status", "flowbrain brains", "flowbrain feature", "flowbrain screen", "flowbrain connections", "flowbrain search", "flowbrain specs", "flowbrain impact", "cd", "ls", "git status", "git diff"];

/**
 * Comandos que puede correr un pedido «funcionalidad»: leer FlowBrain (estado, pantallas, conexiones, lo sin asociar),
 * proponer borradores desde las carpetas (`flowbrain draft`) y compilar; nada de tests ni de promover.
 */
const COMANDOS_FUNCIONALIDADES = ["flowbrain status", "flowbrain brains", "flowbrain draft", "flowbrain feature", "flowbrain screen", "flowbrain connections", "flowbrain unassigned", "flowbrain search", "flowbrain compile", "flowbrain specs --guide", "cd", "ls", "git status", "git diff"];

/**
 * Los permisos de un pedido. Sin `escritura`, los de siempre (`POLITICA`: edita dentro del proyecto y corre tests).
 * Un pedido «asociar» solo puede escribir las páginas `feat-*` y `lib-*` de sus cerebros y borradores en `_drafts/`;
 * uno sobre las especificaciones (agrupar, escribir, corregir), solo las páginas `feat-*` de sus cerebros (y las de
 * borrador); uno de «fidelidad», solo lo que su plan deja declarar: `calls.yaml`, los extractores y las páginas de
 * tablas. Uno de «deriva», el código del repo de su tanda (`repos`) y, en sus cerebros, `calls.yaml` y las notas en
 * `_drafts/`. Uno de «funcionalidad», solo borradores en `_drafts/product/` (una persona los promueve). Lo mismo que dice cada guía, «no modifiques los repositorios del proyecto» (salvo la deriva, en su repo).
 */
export function permisosDelPedido(tipo: TipoDePedido, raices: string[], repos: string[] = []): { escritura?: string[]; comandos?: string[] } {
  if (tipo === "asociar") {
    return {
      escritura: raices.flatMap((r) => [join(r, "_drafts", "**"), join(r, "product", "feat-*.md"), join(r, "technology", "lib-*.md")]),
      comandos: COMANDOS_ASOCIAR,
    };
  }
  if (tipo === "funcionalidad") {
    return { escritura: raices.map((r) => join(r, "_drafts", "product", "**")), comandos: COMANDOS_FUNCIONALIDADES };
  }
  if (tipo === "borrador") {
    return { escritura: raices.map((r) => join(r, "_drafts", "**")), comandos: COMANDOS_BORRADOR };
  }
  if (esTipoDePagina(tipo)) {
    return {
      escritura: raices.flatMap((r) => [join(r, "product", "feat-*.md"), join(r, "_drafts", "product", "feat-*.md")]),
      comandos: COMANDOS_ESPECIFICACIONES,
    };
  }
  if (tipo === "deriva") {
    return {
      escritura: [...repos.map((r) => join(r, "**")), ...raices.flatMap((r) => [join(r, "calls.yaml"), join(r, "_drafts", "**")])],
      comandos: COMANDOS_DERIVA,
    };
  }
  if (tipo === "fidelidad") {
    return {
      escritura: raices.flatMap((r) => [join(r, "calls.yaml"), join(r, "extractors", "**"), join(r, "technology", "tabla-*.md")]),
      comandos: COMANDOS_FIDELIDAD,
    };
  }
  return {};
}

/** Cómo termina cada regla de un pedido de tests: a y b la verifican; c y d son hallazgos que no se resuelven con un test. */
export type ResultadoDeTest = "a" | "b" | "c" | "d";

export interface ResultadoDeRegla {
  cerebro: string;
  /** Id local de la funcionalidad (`feat-mvp`). */
  funcionalidad: string;
  regla: string;
  resultado: ResultadoDeTest;
  /** a y b: los tests que la verifican (`repo-x:ruta::caso`). */
  tests?: string[];
  /** c: qué hace hoy el código (`archivo#Ln`). */
  hoy?: string;
  /** c: qué habría que cambiar, en palabras. d: el ajuste mínimo para poder testearla. */
  cambio?: string;
  /** c: el test que lo demuestra (va solo en el informe; no queda en el repo). */
  test?: string;
}

export interface ReglaDePedido {
  cerebro: string;
  funcionalidad: string;
  regla: string;
  /** Repo que la cumple (`repo-web`); sin él, el primero del cerebro. */
  repo: string | null;
  /** La regla como se la lee el agente: cerebro, funcionalidad, caso, id, tipo, texto y archivo. */
  linea: string;
}

/** Un archivo de un lote «asociar»: el id local (`repo-x:ruta`) y la línea que lee el agente, con su recomendación. */
export interface ArchivoDePedido {
  cerebro: string;
  archivo: string;
  linea: string;
}

/**
 * Un ítem de un lote sobre las especificaciones: una funcionalidad de un cerebro (agrupar, escribir), o un caso
 * marcado como mal o una regla a corregir de ella (corregir). También el de «funcionalidad»: una a la que escribirle
 * nombre y descripción, o (con `funcionalidad` vacía) un cerebro al que proponerle sus funcionalidades. `linea` es
 * como lo lee el agente, en inglés.
 */
export interface ItemDePagina {
  cerebro: string;
  /** Id local de la funcionalidad (`feat-mvp`); vacío en una propuesta de funcionalidades para el cerebro. */
  funcionalidad: string;
  /** corregir: el caso de uso marcado como mal. */
  caso?: string;
  /** corregir: la regla que una persona dijo que está mal (su hallazgo, con decisión `regla_mal`). */
  regla?: string;
  /** borrador: la ruta del borrador o la nota dentro del cerebro (`_drafts/product/feat-x.md`); `funcionalidad` es su id. */
  borrador?: string;
  linea: string;
}
export type TipoDePagina = "agrupar" | "escribir" | "corregir" | "funcionalidad" | "borrador";
export const TIPOS_DE_PAGINA: readonly TipoDePagina[] = ["agrupar", "escribir", "corregir", "funcionalidad", "borrador"];
export const esTipoDePagina = (t: unknown): t is TipoDePagina => TIPOS_DE_PAGINA.includes(t as TipoDePagina);

/**
 * Un archivo de un lote «fidelidad»: el id local (`repo-x:ruta`), su puntaje y las faltas que se piden (las de las
 * relaciones marcadas en el visor), como las mide el visor (que cuenta lo que atiende otro cerebro comunicado).
 */
export interface ArchivoDeFidelidad {
  cerebro: string;
  archivo: string;
  puntaje: number;
  tareas: Array<{ signal: Signal; que: string; lineas: number[] }>;
}

/** Las cuatro clases de problema de la deriva, con la clave que les da el visor. */
export const CLASES_DE_DERIVA = ["sinEndpoint", "disputada", "sinLlamadas", "campos"] as const;
export type ClaseDeDeriva = (typeof CLASES_DE_DERIVA)[number];

/**
 * Un problema de un lote «deriva»: su clase, dónde está (`ev`, `repo:ruta#Ln`: la llamada, o el handler de un
 * endpoint sin llamadas), la llamada (`GET /x`) o el endpoint (su id), y qué está roto en una línea, en inglés.
 */
export interface ProblemaDeDeriva {
  cerebro: string;
  clase: ClaseDeDeriva;
  ev: string;
  llamada?: string;
  endpoint?: string;
  que: string;
}

/**
 * Con qué se reconoce un problema de la deriva antes y después de una tanda: el endpoint, o la llamada por su archivo
 * (sin la línea, que se corre si el agente edita el archivo) y su texto. El visor usa la misma regla.
 */
export function claveDeDeriva(p: Pick<ProblemaDeDeriva, "cerebro" | "clase" | "ev" | "llamada" | "endpoint">): string {
  return `${p.cerebro}|${p.clase}|${p.clase === "sinLlamadas" ? p.endpoint ?? "" : `${p.ev.replace(/#L\d+(-L\d+)?$/, "")} ${p.llamada ?? ""}`}`;
}

/** Los problemas que siguen en una deriva, como claves (`claveDeDeriva`). */
export function clavesDeDeriva(cerebro: string, d: Pick<DerivaVisor, "llamadasSinEndpoint" | "llamadasAmbiguas" | "disputadasEntreCerebros" | "endpointsSinLlamadasDetectadas" | "camposQueNoCoinciden">): Set<string> {
  const k = (clase: ClaseDeDeriva, ev: string, llamada?: string, endpoint?: string) => claveDeDeriva({ cerebro, clase, ev, ...(llamada !== undefined ? { llamada } : {}), ...(endpoint !== undefined ? { endpoint } : {}) });
  return new Set([
    ...d.llamadasSinEndpoint.map((x) => k("sinEndpoint", x.ev, x.llamada)),
    ...[...d.llamadasAmbiguas, ...(d.disputadasEntreCerebros ?? [])].map((x) => k("disputada", x.ev, x.llamada)),
    ...d.endpointsSinLlamadasDetectadas.map((x) => k("sinLlamadas", x.ev, undefined, x.endpoint)),
    ...(d.camposQueNoCoinciden ?? []).map((x) => k("campos", x.ev, x.llamada)),
  ]);
}

export type TipoDeLote = "test" | "asociar" | "fidelidad" | "deriva" | TipoDePagina;

export interface Trabajo {
  id: string;
  tipo: TipoDePedido;
  /** Qué se pidió, corto: "2 tests de Recuperar la contraseña". */
  etiqueta: string;
  pedido: string;
  /** Cerebros que toca: se recompilan al terminar. */
  cerebros: string[];
  estado: "en_cola" | "corriendo" | "terminado" | "fallo" | "cancelado";
  creado: number;
  empezado?: number;
  terminado?: number;
  /** Lo que va haciendo, en llano: "Lee src/x.ts", "Corre: npx vitest …". Los últimos. */
  pasos: string[];
  /** Lo que respondió al final. */
  resultado?: string;
  error?: string;
  costoUsd?: number;
  /** Archivos que cambiaron en cada repo durante el trabajo (según `git status`). */
  cambios: Array<{ repo: string; archivos: string[] }>;
  proveedor?: string;
  modelo?: string;
  /** Si es una tanda de un lote: de cuál, de qué repo, cuál es de cuántas. */
  lote?: string;
  repo?: string;
  tanda?: { n: number; de: number };
  /** Las reglas que se le pidieron (tanda de un lote). */
  reglas?: Array<{ cerebro: string; funcionalidad: string; regla: string }>;
  /** Lo que resolvió de cada regla, ya anotado en las páginas. */
  resultados?: ResultadoDeRegla[];
  /** Reglas pedidas de las que no volvió un resultado válido: quedan en la lista para reintentar. */
  sinResultado?: Array<{ cerebro: string; funcionalidad: string; regla: string; motivo: string }>;
  /** Tanda de un lote «asociar»: los archivos pedidos, y después de compilar, cuáles ya tienen dueño y cuáles siguen sin asociar. */
  archivos?: Array<{ cerebro: string; archivo: string }>;
  asociados?: Array<{ cerebro: string; archivo: string }>;
  siguen?: Array<{ cerebro: string; archivo: string }>;
  /** Tanda de un lote agrupar, escribir o corregir: lo pedido, y después de compilar, qué quedó resuelto en las páginas y qué no. */
  items?: Array<Omit<ItemDePagina, "linea">>;
  resueltos?: Array<Omit<ItemDePagina, "linea">>;
  quedan?: Array<Omit<ItemDePagina, "linea">>;
  /**
   * Tanda de un lote «fidelidad» (los archivos pedidos van en `archivos`): después de reindexar, a cuáles ya no les
   * queda ninguna de las faltas pedidas y a cuáles sí, con el puntaje nuevo (`null` si el archivo ya no se mide).
   */
  completados?: Array<{ cerebro: string; archivo: string; puntaje: number | null }>;
  pendientes?: Array<{ cerebro: string; archivo: string; puntaje: number | null }>;
  /** Tanda de un lote «deriva»: los problemas pedidos, y después de reindexar, cuáles ya no están en la deriva y cuáles siguen. */
  problemas?: ProblemaDeDeriva[];
  corregidos?: ProblemaDeDeriva[];
  persisten?: ProblemaDeDeriva[];
  /**
   * Cómo terminó cada ítem de la tanda, igual para todos los tipos (dec. 235): lo pone el servidor al terminar la tanda
   * (no está en una tanda cancelada antes de empezar). El visor lo muestra ítem por ítem en todas las pantallas.
   */
  desenlaces?: Desenlace[];
}

/**
 * Por qué un ítem quedó sin resolver: `sigue` (el servidor midió después de la tanda y sigue igual), `fallo` (la tanda
 * falló o no se pudo medir: `detalle`), `cancelado`, `sin_respuesta` (tests: el agente no devolvió un resultado válido).
 * `agente`: lo que dijo el agente de ese ítem en su bloque `flowbrain-pending`, si lo dijo.
 */
export type CodigoDeMotivo = "sigue" | "fallo" | "cancelado" | "sin_respuesta";
/** Lo que cambió un ítem resuelto, para que el visor lo diga (sin textos: los pone el visor en su idioma). */
export interface CambioDeDesenlace {
  /** test: el resultado (a, b, c, d) y sus tests. */
  resultado?: ResultadoDeTest;
  tests?: string[];
  /** asociar: el archivo ya tiene dueño. */
  asociado?: true;
  /** fidelidad: el puntaje antes y después (`null` si ya no se mide). */
  puntaje?: { antes: number; despues: number | null };
  /** deriva: el problema ya no está. */
  corregido?: true;
  /** agrupar, escribir, corregir: la funcionalidad cuya página cambió. */
  pagina?: string;
  /** funcionalidad, borrador: el borrador que quedó para revisar (ruta dentro del cerebro). */
  borrador?: string;
}
/** El desenlace de un ítem: `item` es el mismo objeto que lista la tanda (`reglas`, `archivos`, `problemas` o `items`). */
export interface Desenlace {
  item: object;
  resuelto: boolean;
  cambio?: CambioDeDesenlace;
  motivo?: { codigo: CodigoDeMotivo; agente?: string; detalle?: string };
}

/** La lista de ítems de una tanda, según su tipo. */
export function itemsDeTanda(t: Pick<Trabajo, "tipo" | "reglas" | "archivos" | "problemas" | "items">): object[] {
  if (t.tipo === "test") return t.reglas ?? [];
  if (t.tipo === "asociar" || t.tipo === "fidelidad") return t.archivos ?? [];
  if (t.tipo === "deriva") return t.problemas ?? [];
  return t.items ?? [];
}

/** El cierre de cada pedido en lote: cómo decir qué no se pudo resolver y por qué (para el modelo, en inglés). */
export function cierrePendientes(ref: string): string {
  return `If you could not resolve some of them, end your answer with a \`\`\`flowbrain-pending block: a JSON list with one {"ref": "...", "reason": "..."} per item you could not resolve, where ref is ${ref} and reason says in one sentence why (what is missing, or what a person would have to decide).`;
}

/** Lo que el agente dijo que no pudo resolver: el último bloque ```flowbrain-pending (ref → motivo). */
export function pendientesDelAgente(texto: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const bloques = [...(texto ?? "").matchAll(/```flowbrain-pending\s*\n([\s\S]*?)```/g)];
  const ultimo = bloques[bloques.length - 1];
  if (!ultimo) return out;
  let lista: unknown;
  try {
    lista = JSON.parse(ultimo[1]!);
  } catch {
    return out;
  }
  if (!Array.isArray(lista)) return out;
  for (const x of lista as Array<Record<string, unknown>>) {
    const ref = typeof x?.["ref"] === "string" ? normalRef(x["ref"]) : "", reason = typeof x?.["reason"] === "string" ? x["reason"].trim().slice(0, 600) : "";
    if (ref && reason && !out.has(ref)) out.set(ref, reason);
  }
  return out;
}
const normalRef = (s: string) => s.trim().replace(/^`+|`+$/g, "").replace(/#L\d+(-\d+)?$/, "").trim();

/** Con qué se reconoce un ítem en el bloque `flowbrain-pending`: de lo más específico a lo más general. */
function refsDe(x: Record<string, unknown>): string[] {
  const s = (k: string) => (typeof x[k] === "string" && x[k] ? normalRef(x[k] as string) : "");
  const f = s("funcionalidad");
  return [s("borrador"), s("archivo"), s("ev"), s("endpoint"), s("llamada"), f && (s("caso") || s("regla")) ? `${f}/${s("caso") || s("regla")}` : "", f, f ? "" : s("cerebro")].filter(Boolean);
}

/**
 * Los desenlaces de una tanda que terminó, a partir de lo que midió el servidor (`resultados`, `asociados`,
 * `completados`, `corregidos` o `resueltos`), con el motivo de lo que no se resolvió. `puntajes`: fidelidad, el
 * puntaje de cada archivo al pedirlo.
 */
export function desenlacesDeTanda(t: Trabajo, puntajes: Map<string, number> = new Map()): Desenlace[] {
  const dichos = pendientesDelAgente(t.resultado);
  const claveA = (a: { cerebro: string; archivo: string }) => `${a.cerebro}|${a.archivo}`;
  const claveP = (x: { cerebro: string; funcionalidad: string; caso?: string; regla?: string; borrador?: string }) => `${x.cerebro}|${x.funcionalidad}|${x.caso ?? ""}|${x.regla ?? ""}|${x.borrador ?? ""}`;
  const hechos = new Map<string, CambioDeDesenlace>(), medidos = new Set<string>(), sinRespuesta = new Map<string, string>();
  let clave: (x: never) => string;
  if (t.tipo === "test") {
    clave = (r: { cerebro: string; funcionalidad: string; regla: string }) => `${r.cerebro}|${r.funcionalidad}|${r.regla}`;
    for (const r of t.resultados ?? []) hechos.set(clave(r as never), { resultado: r.resultado, ...(r.tests?.length ? { tests: r.tests } : {}) });
    for (const r of t.sinResultado ?? []) sinRespuesta.set(clave(r as never), r.motivo);
  } else if (t.tipo === "asociar") {
    clave = claveA;
    for (const a of t.asociados ?? []) hechos.set(claveA(a), { asociado: true });
    for (const a of t.siguen ?? []) medidos.add(claveA(a));
  } else if (t.tipo === "fidelidad") {
    clave = claveA;
    for (const a of t.completados ?? []) hechos.set(claveA(a), { puntaje: { antes: puntajes.get(claveA(a)) ?? 0, despues: a.puntaje } });
    for (const a of t.pendientes ?? []) if (a.puntaje !== null) medidos.add(claveA(a));
  } else if (t.tipo === "deriva") {
    clave = claveDeDeriva;
    for (const p of t.corregidos ?? []) hechos.set(claveDeDeriva(p), { corregido: true });
    for (const p of t.persisten ?? []) medidos.add(claveDeDeriva(p));
  } else {
    clave = claveP;
    for (const x of t.resueltos ?? []) {
      const c: CambioDeDesenlace = t.tipo === "borrador" ? { borrador: x.borrador ?? "" } : t.tipo === "funcionalidad" ? { borrador: x.funcionalidad ? `_drafts/product/${x.funcionalidad}.md` : "_drafts/product/" } : { pagina: x.funcionalidad };
      hechos.set(claveP(x), c);
    }
    for (const x of t.quedan ?? []) medidos.add(claveP(x));
  }
  return itemsDeTanda(t).map((item) => {
    const k = clave(item as never);
    const cambio = hechos.get(k);
    if (cambio) return { item, resuelto: true, cambio };
    const agente = refsDe(item as Record<string, unknown>).map((r) => dichos.get(r)).find(Boolean);
    const detalle = sinRespuesta.get(k) ?? t.error;
    const codigo: CodigoDeMotivo = sinRespuesta.has(k) ? "sin_respuesta" : t.estado === "cancelado" ? "cancelado" : !t.error && medidos.has(k) ? "sigue" : "fallo";
    return { item, resuelto: false, motivo: { codigo, ...(agente ? { agente } : {}), ...(detalle ? { detalle: detalle.slice(0, 600) } : {}) } };
  });
}

export interface Lote {
  id: string;
  tipo: TipoDeLote;
  creado: number;
  cerebros: string[];
  /** `reindexando`: las tandas terminaron y se actualiza el índice para que los tests nuevos cuenten. */
  estado: "corriendo" | "reindexando" | "terminado";
  error?: string;
}

export interface ProveedorVisible {
  id: string;
  nombre: string;
  version: string;
  modelos: ModeloDeAgente[];
}

const MAX_PASOS = 60;
const MAX_TRABAJOS = 400;
const TANDA_MAX = 15;
/** Archivos por tanda de un lote «asociar»: leer y decidir un archivo cuesta menos que testear una regla. */
export const TANDA_MAX_ASOCIAR = 30;
/** Archivos por tanda de un lote «fidelidad»: cada falta pide abrir el código en su línea y declarar lo que se lee. */
export const TANDA_MAX_FIDELIDAD = 10;
/** Problemas por tanda de un lote «deriva»: cada uno pide abrir la llamada (o buscar quién usa el endpoint) y decidir. */
export const TANDA_MAX_DERIVA = 10;

/**
 * Ítems por tanda de un lote sobre las especificaciones. Escribir lee el código y los tests de cada funcionalidad
 * entera: pocas por tanda. Agrupar solo ordena lo escrito; corregir, un caso o una regla. Describir una funcionalidad
 * lee sus pantallas y endpoints (no sus tests); proponer las de un cerebro entero va sola en su tanda.
 */
export const TANDA_MAX_PAGINAS: Readonly<Record<TipoDePagina, number>> = { agrupar: 8, escribir: 3, corregir: 10, funcionalidad: 5, borrador: 8 };

/** Cuántos lleva cada tanda: lo más parejo posible y nunca más de `max` (15 reglas, o 30 archivos). */
export function tamanioDeTanda(n: number, max = TANDA_MAX): number {
  return Math.ceil(n / Math.max(1, Math.ceil(n / max)));
}

/** El texto que recibe el agente: la guía del tipo de pedido, con el pedido en lugar de `$ARGUMENTS`. */
export function indicacionesDelPedido(tipo: TipoDePedido, pedido: string): string {
  const guia = (tipo === "test" ? GUIA_TESTS : tipo === "funcionalidad" ? GUIA_FUNCIONALIDADES : tipo === "borrador" ? GUIA_BORRADOR : tipo === "asociar" ? GUIA_ASOCIAR : tipo === "fidelidad" ? GUIA_FIDELIDAD : tipo === "deriva" ? GUIA_DERIVA : GUIA_ESPECIFICACIONES).replace(/^---\n[\s\S]*?\n---\n/, "");
  return guia.replace("$ARGUMENTS", `What the person asks for, from the FlowBrain viewer:\n\n${pedido.trim()}\n`);
}

/**
 * Dónde está en disco el repo de una tanda. Las referencias van como `repo-x:ruta` y el id del repo no siempre es el
 * nombre de su carpeta (`repo-tienda` en `repos/tienda`): sin esto, el agente la adivina o la busca por todo el disco.
 */
export function dondeEstaElRepo(repo: string, ruta: string, cwd: string): string {
  const rel = relative(cwd, ruta);
  const carpeta = !rel ? "." : rel.startsWith("..") || isAbsolute(rel) ? resolve(ruta) : rel;
  return `Where the repo is: ${repo} is the folder \`${carpeta}/\`${carpeta === resolve(ruta) ? "" : " (from the working folder)"}, so a reference ${repo}:path is the file \`${carpeta === "." ? "" : `${carpeta}/`}path\`.`;
}

/** El pedido de una tanda: las reglas y cómo tiene que responder (el servidor anota; el agente no toca las páginas). */
export function pedidoDeTanda(reglas: ReglaDePedido[], repo: string, n: number, de: number): string {
  return [
    `Resolve ${reglas.length === 1 ? "this FlowBrain rule" : `these ${reglas.length} FlowBrain rules`} (repo ${repo}${de > 1 ? `, batch ${n} of ${de}` : ""}), following the guide.`,
    "This is a request from the viewer: do NOT edit the feature pages or compile; the server records the tests and findings from your answer. NEVER change the product code, and never leave a failing test in the repo.",
    "Each rule ends in one of the four outcomes (a, b, c, d) from the guide. At the end, answer with the guide's `flowbrain-resultados` block, with one entry per rule (cerebro, funcionalidad and regla exactly as they appear below).",
    "",
    ...reglas.map((r) => r.linea),
  ].join("\n");
}

/** El pedido de una tanda «asociar»: los archivos de un repo, con su recomendación. El agente edita las páginas. */
export function pedidoDeTandaAsociar(archivos: ArchivoDePedido[], repo: string, cerebro: string, n: number, de: number): string {
  return [
    `Assign ${archivos.length === 1 ? "this file" : `these ${archivos.length} files`} of ${repo} (brain ${cerebro}${de > 1 ? `, batch ${n} of ${de}` : ""}) to their feature in FlowBrain. Today they belong to no feature or library.`,
    "To assign one: add repo:path to the codigo list in the frontmatter of the feature's page (the brain's product/feat-*.md) and compile. If a whole folder belongs to the same feature, add the folder.",
    "The recommendation is a hint: open the file before deciding. Shared code does not go to a feature: add it to the codigo of a lib page or leave it unassigned. If no feature covers it, propose a new one as a draft (_drafts/product/feat-<id>.md). Tests, configuration, scripts and generated files are not product: leave them and list them.",
    "Other batches of this request cover the rest of the files: only handle these. The server compiles the brain when you finish and counts what is still unassigned.",
    cierrePendientes("the file as repo-x:path"),
    "",
    ...archivos.map((a) => a.linea),
  ].join("\n");
}

/**
 * El pedido de una tanda «fidelidad»: el plan de `flowbrain fidelity --plan` (reglas, cómo resolver cada cosa, los
 * archivos con sus faltas y el cierre) para los archivos de un repo, con de qué cerebro son y qué tanda es.
 */
export function pedidoDeTandaFidelidad(archivos: ArchivoDeFidelidad[], repo: string, cerebro: string, n: number, de: number): string {
  return planDeFidelidad(archivos.map((a) => ({ archivo: a.archivo, puntaje: a.puntaje, tareas: a.tareas })), {
    limite: archivos.length,
    contexto: [
      `These files are in ${repo}, brain ${cerebro}: what you declare goes in that brain's folder (\`.flowbrain/${cerebro}/\`), and each brain is reindexed with \`flowbrain brains apply ${cerebro}\`.${de > 1 ? ` This is batch ${n} of ${de} of the request: other batches cover the rest, only handle these.` : ""}`,
      "This is a request from the viewer: when you finish, the server reindexes the brain again and measures which of these gaps are gone.",
      cierrePendientes("the file as repo-x:path"),
    ],
  });
}

/** Cómo se nombra cada clase de problema de la deriva, para el modelo. */
const CLASE_EN: Record<ClaseDeDeriva, string> = { sinEndpoint: "call nobody serves", disputada: "call matching several endpoints", sinLlamadas: "endpoint nobody calls", campos: "mismatched fields" };

/** El pedido de una tanda «deriva»: los problemas de un repo, uno por línea, con su evidencia. */
export function pedidoDeTandaDeriva(problemas: ProblemaDeDeriva[], repo: string, cerebro: string, n: number, de: number): string {
  return [
    `Fix ${problemas.length === 1 ? "this contract drift problem" : `these ${problemas.length} contract drift problems`} found in ${repo} (brain ${cerebro}${de > 1 ? `, batch ${n} of ${de}` : ""}), following the guide.`,
    `Code changes go only in ${repo}; declarations go in \`.flowbrain/${cerebro}/calls.yaml\` and proposals in \`.flowbrain/${cerebro}/_drafts/drift-notes.md\`. Never delete anything.`,
    "This is a request from the viewer: when you finish, the server reindexes the brain and checks which of these problems are gone from the drift.",
    cierrePendientes("the location of the problem as repo-x:path#Ln"),
    "",
    ...problemas.map((p) => `- [ ] ${CLASE_EN[p.clase]}: ${p.endpoint ?? p.llamada ?? ""} at ${p.ev}. ${p.que}`),
  ].join("\n");
}

/**
 * Si un archivo ya no tiene ninguna de las faltas pedidas: ninguna de sus faltas de esas relaciones cita una línea
 * pedida (las faltas sin línea se miran por relación). Lo que atiende otro cerebro no se pidió, así que no cuenta.
 * Un archivo que ya no se mide no se puede comprobar: queda.
 */
export function fidelidadResuelta(medido: Pick<FidelidadArchivo, "tareas"> | undefined, pedido: Pick<ArchivoDeFidelidad, "tareas">): boolean {
  if (!medido) return false;
  return pedido.tareas.every((p) => {
    const quedan = medido.tareas.filter((t) => t.signal === p.signal);
    if (!p.lineas.length) return !quedan.length;
    return !quedan.some((t) => t.lineas.some((l) => p.lineas.includes(l)));
  });
}

/**
 * Las tandas de un lote sobre las especificaciones: lo de una misma funcionalidad (en todos sus cerebros) va junto,
 * para que el agente use el mismo id de caso de un lado y del otro; las funcionalidades se suman a una tanda mientras
 * entren en `max` (una que sola lo pasa va en su propia tanda).
 */
export function tandasDePaginas<T extends Pick<ItemDePagina, "funcionalidad"> & { cerebro?: string }>(items: T[], max: number): T[][] {
  const grupos = new Map<string, T[]>();
  // Una propuesta (sin funcionalidad) es de un cerebro entero: su grupo es el cerebro.
  const de = (x: T) => x.funcionalidad || `@${x.cerebro ?? ""}`;
  for (const x of items) grupos.set(de(x), [...(grupos.get(de(x)) ?? []), x]);
  const tandas: T[][] = [];
  let actual: T[] = [];
  for (const g of grupos.values()) {
    if (actual.length && actual.length + g.length > max) {
      tandas.push(actual);
      actual = [];
    }
    actual = actual.concat(g);
  }
  if (actual.length) tandas.push(actual);
  return tandas;
}

/** Lo que encabeza el pedido de una tanda sobre las especificaciones, en inglés: qué hacer con los ítems de abajo. */
const PEDIDO_DE_PAGINA: Record<TipoDePagina | "reglas" | "proponer", (n: number) => string> = {
  agrupar: (n) => `Group into use cases the specifications that are not in any use case yet, in ${n === 1 ? "this FlowBrain feature" : `these ${n} FlowBrain features`}, following the guide. The same use case in another brain keeps the same id. Don't change the text of the specifications.`,
  escribir: (n) => `Write the use cases and specifications of ${n === 1 ? "this FlowBrain feature" : `these ${n} FlowBrain features`}, following the guide.`,
  corregir: (n) => `Fix ${n === 1 ? "this FlowBrain use case" : `these ${n} FlowBrain use cases`} that a person marked as wrong, following the guide. After fixing each one, delete its problema field from the page.`,
  funcionalidad: (n) => `Complete ${n === 1 ? "this FlowBrain feature" : `these ${n} FlowBrain features`} with a business name, a one-line summary and the "what it is" section, following the guide. Write each one as a draft: copy its page to .flowbrain/<brain>/_drafts/product/<id>.md (same id, same codigo) and complete it there. Don't merge, rename or delete features.`,
  proponer: (n) => `${n === 1 ? "This FlowBrain brain has" : `These ${n} FlowBrain brains have`} no features yet. Propose them, following the guide: if there are no drafts, flowbrain draft <repo> proposes them from the folders; then turn them into product features (merge duplicates, group loose screens, leave out what is not product), each one with a business name, a one-line summary, the "what it is" section and all of its code.`,
  borrador: (n) => `Revise ${n === 1 ? "this FlowBrain draft" : `these ${n} FlowBrain drafts`} as the person asked, following the guide. Each line has the brain, the path of the draft (or note) inside the brain folder and the person's note.`,
  reglas: (n) => `Fix the text of ${n === 1 ? "this FlowBrain rule" : `these ${n} FlowBrain rules`}: the agent that tried to test them found that the code does something else, and a person decided the rule is wrong, not the code. Fix the text of each rule (or delete it, if it no longer holds) according to what the code does today, following the guide, and delete its finding (hallazgo). Don't change the product code.`,
};

/** El pedido de una tanda agrupar, escribir o corregir: qué hacer, los ítems y cómo cerrar. El agente edita las páginas. */
export function pedidoDeTandaPaginas(tipo: TipoDePagina, items: ItemDePagina[], n: number, de: number): string {
  const partes: string[] = [];
  const bloque = (cabeza: string, xs: ItemDePagina[]) => { if (xs.length) partes.push(cabeza, "", ...xs.map((x) => x.linea), ""); };
  if (tipo === "corregir") {
    bloque(PEDIDO_DE_PAGINA.corregir(items.filter((x) => !x.regla).length), items.filter((x) => !x.regla));
    bloque(PEDIDO_DE_PAGINA.reglas(items.filter((x) => x.regla).length), items.filter((x) => x.regla));
  } else if (tipo === "funcionalidad") {
    const describir = items.filter((x) => x.funcionalidad), proponer = items.filter((x) => !x.funcionalidad);
    bloque(PEDIDO_DE_PAGINA.funcionalidad(new Set(describir.map((x) => x.funcionalidad)).size), describir);
    bloque(PEDIDO_DE_PAGINA.proponer(proponer.length), proponer);
  } else bloque(PEDIDO_DE_PAGINA[tipo](new Set(items.map((x) => x.funcionalidad)).size), items);
  if (tipo === "borrador") {
    return [
      ...(de > 1 ? [`This is batch ${n} of ${de} of the request: other batches cover the rest, only handle these.`, ""] : []),
      ...partes,
      "Do NOT modify the project's repositories, and do NOT edit product/ or technology/ or promote anything: write ONLY in .flowbrain/<brain>/_drafts/. A person reviews and accepts the drafts. The server then checks which drafts changed.",
      cierrePendientes("the path of the draft or note inside the brain folder"),
    ].join("\n");
  }
  if (tipo === "funcionalidad") {
    return [
      ...(de > 1 ? [`This is batch ${n} of ${de} of the request: other batches cover the rest, only handle these.`, ""] : []),
      ...partes,
      "Do NOT modify the project's repositories, and do NOT edit product/ or promote anything: write ONLY drafts in .flowbrain/<brain>/_drafts/product/ (feat-<id>.md, tipo: feat). A person reviews and promotes them. The server then checks in the drafts what got done.",
      cierrePendientes("the feature id (or, for a proposal, the brain name)"),
    ].join("\n");
  }
  return [
    ...(de > 1 ? [`This is batch ${n} of ${de} of the request: other batches cover the rest, only handle these.`, ""] : []),
    ...partes,
    "Do NOT modify the project's repositories: only the feature pages of FlowBrain. When done, compile each brain (flowbrain compile --brain <brain>) and check with flowbrain specs <feature> --brain <brain> that no broken references remain. The server compiles again and checks in the pages what got resolved.",
    cierrePendientes("the feature id, followed by /<use case or rule id> when the line has one"),
  ].join("\n");
}

/** Si un ítem quedó resuelto en las páginas ya compiladas de su cerebro. Una funcionalidad que ya no está no se puede medir: queda. */
export function resueltoEnPagina(ctx: Contexto, tipo: TipoDePagina, x: Omit<ItemDePagina, "linea">): boolean {
  let r: ReturnType<typeof especificaciones>;
  try {
    r = especificaciones(ctx, { funcionalidad: x.funcionalidad, budget_tokens: null });
  } catch {
    return false;
  }
  const f = r as unknown as { total?: number; especificacionesSinCaso?: string[]; casos?: Array<{ id: string; problema?: string }>; especificaciones?: Array<{ id: string; hallazgo?: unknown }> };
  if (tipo === "agrupar") return !f.especificacionesSinCaso?.length;
  if (tipo === "escribir") return (f.total ?? 0) > 0;
  if (x.caso) return !(f.casos ?? []).some((c) => c.id === x.caso && c.problema);
  // La regla se corrigió (o se borró, si ya no valía) y su hallazgo ya no está.
  return !(f.especificaciones ?? []).some((e) => e.id === x.regla && e.hallazgo);
}

/** Si el resumen de una página es de verdad: no está vacío ni es el de un borrador sin completar («Draft: …»). */
const resumenDeVerdad = (r: unknown) => typeof r === "string" && !!r.trim() && !/^(Borrador|Draft):/.test(r.trim());

/**
 * Si un ítem «funcionalidad» quedó hecho en los borradores de su cerebro (`raiz`): la funcionalidad tiene su borrador
 * `_drafts/product/<id>.md` con nombre y resumen de verdad; una propuesta, algún borrador `feat-*` así escrito desde
 * `desde` (lo de antes, como los que deja `flowbrain draft`, no cuenta).
 */
export async function resueltoEnBorrador(raiz: string, x: Pick<ItemDePagina, "funcionalidad">, desde = 0): Promise<boolean> {
  const carpeta = join(raiz, "_drafts", "product");
  const completo = async (archivo: string, despues: number) => {
    try {
      if (despues && (await stat(join(carpeta, archivo))).mtimeMs < despues) return false;
      const d = parsePagina(archivo, await readFile(join(carpeta, archivo), "utf8")).data as Record<string, unknown> | null;
      return !!d && typeof d["nombre"] === "string" && !!d["nombre"].trim() && resumenDeVerdad(d["resumen"]);
    } catch {
      return false;
    }
  };
  if (x.funcionalidad) return completo(`${x.funcionalidad}.md`, 0);
  let nombres: string[] = [];
  try {
    nombres = (await readdir(carpeta)).filter((n) => /^feat-.+\.md$/.test(n));
  } catch {
    return false;
  }
  for (const n of nombres) if (await completo(n, desde)) return true;
  return false;
}

/** Lo que el agente respondió: la lista del último bloque ```flowbrain-resultados, ya validada. */
export function extraerResultados(texto: string): { resultados: ResultadoDeRegla[]; errores: string[] } {
  const bloques = [...texto.matchAll(/```flowbrain-resultados\s*\n([\s\S]*?)```/g)];
  const ultimo = bloques[bloques.length - 1];
  if (!ultimo) return { resultados: [], errores: ["the answer has no flowbrain-resultados block"] };
  let lista: unknown;
  try {
    lista = JSON.parse(ultimo[1]!);
  } catch (e) {
    return { resultados: [], errores: [`the flowbrain-resultados block is not valid JSON: ${(e as Error).message}`] };
  }
  if (!Array.isArray(lista)) return { resultados: [], errores: ["the flowbrain-resultados block must be a list"] };
  const texto1 = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const resultados: ResultadoDeRegla[] = [];
  const errores: string[] = [];
  for (const x of lista as Array<Record<string, unknown>>) {
    const cerebro = texto1(x?.["cerebro"], 200), funcionalidad = texto1(x?.["funcionalidad"], 200), regla = texto1(x?.["regla"], 200);
    const r = typeof x?.["resultado"] === "string" ? x["resultado"].trim().toLowerCase() : "";
    if (!cerebro || !funcionalidad || !regla || !["a", "b", "c", "d"].includes(r)) {
      errores.push(`invalid entry: ${JSON.stringify(x).slice(0, 120)}`);
      continue;
    }
    const id = `${cerebro}/${funcionalidad}/${regla}`;
    const tests = Array.isArray(x["tests"]) ? (x["tests"] as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.trim()) : [];
    const cambio = texto1(x["cambio"], 1200) ?? texto1(x["ajuste"], 1200);
    if ((r === "a" || r === "b") && (!tests.length || tests.some((t) => !TEST_REF.test(t)))) {
      errores.push(`${id}: outcome ${r} needs the tests as repo-x:path::test case name`);
      continue;
    }
    if ((r === "c" || r === "d") && !cambio) {
      errores.push(`${id}: outcome ${r} needs to say what would have to change`);
      continue;
    }
    resultados.push({ cerebro, funcionalidad, regla, resultado: r as ResultadoDeTest, ...(tests.length ? { tests } : {}), ...(texto1(x["hoy"], 1200) ? { hoy: texto1(x["hoy"], 1200)! } : {}), ...(cambio ? { cambio } : {}), ...(texto1(x["test"], 4000) ? { test: texto1(x["test"], 4000)! } : {}) });
  }
  return { resultados, errores };
}

export interface Agente {
  /** `null` si se puede usar (hay al menos un proveedor instalado); si no, por qué. */
  noDisponible(): string | null;
  /** Los proveedores instalados en la máquina, con sus modelos. */
  proveedores(): ProveedorVisible[];
  encolar(p: { tipo: TipoDePedido; pedido: string; etiqueta: string; cerebros: string[]; proveedor?: string; modelo?: string }): Trabajo;
  /**
   * `test`: reparte las reglas por repo (en paralelo) y cada repo en tandas. `asociar` y `fidelidad`: los archivos por
   * cerebro (en paralelo) y por repo, en tandas. `agrupar`, `escribir` y `corregir`: los ítems en tandas, una detrás de otra.
   */
  encolarLote(p: ({ tipo?: "test"; reglas: ReglaDePedido[] } | { tipo: "asociar"; archivos: ArchivoDePedido[] } | { tipo: "fidelidad"; archivos: ArchivoDeFidelidad[] } | { tipo: "deriva"; problemas: ProblemaDeDeriva[] } | { tipo: TipoDePagina; items: ItemDePagina[] }) & { proveedor?: string; modelo?: string }): { lote: Lote; trabajos: Trabajo[] };
  lista(): Trabajo[];
  lotes(): Lote[];
  cancelar(id: string): Trabajo | null;
  cancelarLote(id: string): Trabajo[] | null;
}

/** Archivos con cambios sin commitear de un repo, o `null` si no es un repo de git. */
function estadoGit(repo: string): Set<string> | null {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf8", timeout: 20_000 });
  if (r.status !== 0) return null;
  return new Set(r.stdout.split("\n").filter(Boolean).map((l) => l.slice(3)));
}

export interface OpcionesDeAgente {
  /** Ejecutable de Claude Code (atajo para probar con otro): arma el único proveedor. */
  comando?: string;
  proveedores?: AdaptadorDeAgente[];
  /** Escribe en las páginas de un cerebro (la misma cola de ediciones del servidor). */
  aplicar?: (ed: Edicion) => Promise<unknown>;
  /** Actualiza el índice de un cerebro: así los tests nuevos entran y cuentan como verificados. */
  reindexar?: (cerebro: string) => Promise<void>;
  /** La deriva de un cerebro, cruzada con los demás (para medir un lote «deriva»); por defecto, la del registro. */
  deriva?: (cerebro: string) => Promise<Parameters<typeof clavesDeDeriva>[1] | null>;
}

/** `registro()` se lee cada vez: si el registro cambia, vale lo que hay en disco. */
export function crearAgente(registro: () => Promise<Registro>, opciones: OpcionesDeAgente = {}): Agente {
  const adaptadores = opciones.proveedores ?? (opciones.comando ? [claudeCode(opciones.comando)] : PROVEEDORES.map((f) => f()));
  const instalados = () => adaptadores.filter((a) => a.detectar().instalado);
  const noDisponible = () => {
    if (instalados().length) return null;
    return adaptadores.map((a) => a.detectar().motivo).filter(Boolean)[0] ?? "no agent is installed on this machine: install Claude Code, or copy the request and paste it into your agent";
  };
  const elegir = (proveedor?: string, modelo?: string) => {
    const a = proveedor ? adaptadores.find((x) => x.id === proveedor) : instalados()[0];
    if (!a) throw new ConsultaError("parametro_invalido", proveedor ? `no such provider: ${proveedor}` : "no agent is installed");
    const det = a.detectar();
    if (!det.instalado) throw new ConsultaError("parametro_invalido", det.motivo ?? `${a.nombre} is not installed`);
    const modelos = a.modelos();
    if (modelo && !modelos.some((m) => m.id === modelo)) throw new ConsultaError("parametro_invalido", `${a.nombre} does not offer the model ${modelo}`);
    return { a, modelo: modelo ?? modelos.find((m) => m.porDefecto)?.id };
  };

  const trabajos: Trabajo[] = [];
  const lotes: Lote[] = [];
  const procesos = new Map<string, ChildProcess>();
  const adaptadorDe = new Map<string, AdaptadorDeAgente>();
  let corriendo = false;

  const vivo = (t: Trabajo) => t.estado === "en_cola" || t.estado === "corriendo";
  function podar() {
    // Los viejos que ya terminaron se olvidan; los que siguen vivos, no.
    while (trabajos.length > MAX_TRABAJOS) {
      const i = trabajos.findIndex((x) => !vivo(x));
      if (i < 0) break;
      trabajos.splice(i, 1);
    }
  }
  const nuevo = (p: Omit<Trabajo, "id" | "estado" | "creado" | "pasos" | "cambios">): Trabajo => ({ id: randomBytes(6).toString("hex"), estado: "en_cola", creado: Date.now(), pasos: [], cambios: [], ...p });

  function siguiente() {
    if (corriendo) return;
    const t = trabajos.find((x) => x.estado === "en_cola" && !x.lote);
    if (!t) return;
    corriendo = true;
    void correr(t, {}).finally(() => {
      corriendo = false;
      siguiente();
    });
  }

  /** Corre el agente de un trabajo. `soloRepo`: la ruta del repo cuyos cambios se cuentan (una tanda de un lote). */
  async function lanzar(t: Trabajo, soloRepo?: string) {
    const a = adaptadorDe.get(t.id)!;
    t.estado = "corriendo";
    t.empezado = Date.now();
    const reg = await registro();
    const cwd = dirname(reg.carpeta);
    const todos = [...new Set(reg.cerebros.flatMap((c) => c.repos.map((r) => r.ruta)))];
    const repos = soloRepo ? [soloRepo] : todos;
    const antes = new Map(repos.map((r) => [r, estadoGit(r)]));
    const afuera = todos.filter((r) => !resolve(r).startsWith(cwd + sep));
    const raices = t.cerebros.map((n) => reg.cerebro(n)?.raiz).filter((r): r is string => !!r).map((r) => resolve(r));
    const pedido = soloRepo && t.repo ? `${t.pedido.trim()}\n\n${dondeEstaElRepo(t.repo, soloRepo, cwd)}` : t.pedido;
    const { comando, args } = a.armar({ prompt: indicacionesDelPedido(t.tipo, pedido), ...(t.modelo ? { modelo: t.modelo } : {}), cwd, carpetasExtra: afuera, ...permisosDelPedido(t.tipo, raices, soloRepo ? [resolve(soloRepo)] : []) });
    await new Promise<void>((listo) => {
      const p = spawn(comando, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FLOWBRAIN_ROOT: reg.carpeta } });
      procesos.set(t.id, p);
      let resto = "", errores = "";
      const paso = (s: string) => {
        t.pasos.push(s);
        if (t.pasos.length > MAX_PASOS) t.pasos.splice(0, t.pasos.length - MAX_PASOS);
      };
      p.stdout!.setEncoding("utf8");
      p.stdout!.on("data", (d: string) => {
        resto += d;
        const lineas = resto.split("\n");
        resto = lineas.pop() ?? "";
        for (const l of lineas) {
          if (!l.trim()) continue;
          const ev = a.leerLinea(l, cwd);
          if (!ev) continue;
          ev.pasos.forEach(paso);
          if (ev.resultado !== undefined) t.resultado = ev.resultado;
          if (ev.costoUsd !== undefined) t.costoUsd = ev.costoUsd;
          if (ev.error !== undefined) t.error = ev.error;
        }
      });
      p.stderr!.setEncoding("utf8");
      p.stderr!.on("data", (d: string) => {
        errores = (errores + d).slice(-2000);
      });
      p.on("error", (e) => {
        t.error = `could not launch ${a.nombre}: ${e.message}`;
        listo();
      });
      p.on("close", (codigo) => {
        procesos.delete(t.id);
        if (t.estado === "cancelado") return listo();
        if (codigo !== 0 && !t.error) t.error = errores.trim().split("\n").slice(-3).join(" ") || `${a.nombre} exited with code ${codigo}`;
        listo();
      });
    });
    for (const r of repos) {
      const antesR = antes.get(r), despues = estadoGit(r);
      if (!antesR || !despues) continue;
      const nuevos = [...despues].filter((x) => !antesR.has(x)).sort();
      if (nuevos.length) t.cambios.push({ repo: relative(cwd, r) || r, archivos: nuevos });
    }
    return reg;
  }

  /** Un pedido suelto: al terminar, recompila los cerebros que toca. */
  async function correr(t: Trabajo, _: object) {
    const reg = await lanzar(t);
    for (const nombre of t.cerebros) {
      const c = reg.cerebro(nombre);
      if (!c) continue;
      try {
        await compileDirConVisor(c.raiz);
      } catch (e) {
        t.error = `${t.error ? `${t.error}. ` : ""}${nombre} does not compile: ${(e as Error).message.split("\n")[0]}`;
      }
    }
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error ? "fallo" : "terminado";
  }

  /** Una tanda: corre el agente y anota lo que respondió regla por regla. */
  async function correrTanda(t: Trabajo, repoRuta: string | undefined) {
    try {
      await lanzar(t, repoRuta);
      if (t.estado !== "cancelado" && !t.error && t.resultado !== undefined) await anotarTanda(t);
      else if (t.estado !== "cancelado" && !t.error) t.error = "the agent finished without answering";
    } catch (e) {
      t.error = `${t.error ? `${t.error}. ` : ""}${(e as Error).message}`;
    }
    t.desenlaces = desenlacesDeTanda(t);
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error && !t.resultados?.length ? "fallo" : "terminado";
  }

  async function anotarTanda(t: Trabajo) {
    const pedidas = new Set((t.reglas ?? []).map((r) => `${r.cerebro}|${r.funcionalidad}|${r.regla}`));
    const { resultados, errores } = extraerResultados(t.resultado ?? "");
    const buenos: ResultadoDeRegla[] = [];
    const vistos = new Set<string>();
    for (const r of resultados) {
      const k = `${r.cerebro}|${r.funcionalidad}|${r.regla}`;
      if (!pedidas.has(k)) errores.push(`${r.cerebro}/${r.funcionalidad}/${r.regla}: it was not among the requested rules`);
      else if (vistos.has(k)) errores.push(`${r.cerebro}/${r.funcionalidad}/${r.regla}: repeated`);
      else {
        vistos.add(k);
        buenos.push(r);
      }
    }
    t.resultados = [];
    t.sinResultado = [];
    // Una edición por funcionalidad: una escritura y una compilación, no una por regla.
    const grupos = new Map<string, ResultadoDeRegla[]>();
    for (const r of buenos) grupos.set(`${r.cerebro}|${r.funcionalidad}`, [...(grupos.get(`${r.cerebro}|${r.funcionalidad}`) ?? []), r]);
    for (const [k, rs] of grupos) {
      const [cerebro, funcionalidad] = k.split("|") as [string, string];
      const items = rs.map((r) => ({
        id: r.regla,
        ...(r.resultado === "a" || r.resultado === "b" ? { tests: r.tests ?? [] } : {}),
        ...(r.resultado === "c" ? { hallazgo: { resultado: "codigo_no_cumple" as const, ...(r.hoy ? { hoy: r.hoy } : {}), cambio: r.cambio!, ...(r.test ? { test: r.test } : {}) } } : {}),
        ...(r.resultado === "d" ? { hallazgo: { resultado: "no_testeable" as const, cambio: r.cambio! } } : {}),
      }));
      try {
        if (!opciones.aplicar) throw new Error("the server cannot write the pages");
        await opciones.aplicar({ tipo: "resultados", cerebro, funcionalidad, items });
        t.resultados.push(...rs);
      } catch (e) {
        for (const r of rs) t.sinResultado.push({ cerebro: r.cerebro, funcionalidad: r.funcionalidad, regla: r.regla, motivo: `could not record it: ${(e as Error).message}` });
      }
    }
    for (const r of t.reglas ?? []) {
      if (!vistos.has(`${r.cerebro}|${r.funcionalidad}|${r.regla}`)) t.sinResultado.push({ ...r, motivo: "the agent did not return a valid outcome for this rule" });
    }
    if (errores.length && !t.resultados.length) t.error = errores[0] ?? "invalid answer";
  }

  /** Una tanda «asociar»: corre el agente, compila el cerebro y mide cuáles de sus archivos ya tienen dueño. */
  async function correrTandaAsociar(t: Trabajo, repoRuta: string | undefined) {
    try {
      const reg = await lanzar(t, repoRuta);
      // Aun cancelada pudo haber escrito algo: se compila y se mide igual.
      for (const nombre of t.cerebros) {
        const c = reg.cerebro(nombre);
        if (!c) continue;
        try {
          await compileDirConVisor(c.raiz);
          const quedan = new Set(fidelidadDeArchivos(await cargarContexto(c.raiz)).sinAsociar.map((a) => a.archivo));
          const suyos = (t.archivos ?? []).filter((a) => a.cerebro === nombre);
          t.asociados = [...(t.asociados ?? []), ...suyos.filter((a) => !quedan.has(a.archivo))];
          t.siguen = [...(t.siguen ?? []), ...suyos.filter((a) => quedan.has(a.archivo))];
        } catch (e) {
          t.error = `${t.error ? `${t.error}. ` : ""}${nombre} does not compile: ${(e as Error).message.split("\n")[0]}`;
        }
      }
    } catch (e) {
      t.error = `${t.error ? `${t.error}. ` : ""}${(e as Error).message}`;
    }
    t.desenlaces = desenlacesDeTanda(t);
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error && !t.asociados?.length ? "fallo" : "terminado";
  }

  /** Lo que pidió cada tanda «fidelidad», con sus faltas: con eso se mide al terminar. */
  const pedidoFidelidad = new Map<string, ArchivoDeFidelidad[]>();

  /** Una tanda «fidelidad»: corre el agente, reindexa el cerebro (así entra `calls.yaml`) y mide qué faltas pedidas ya no están. */
  async function correrTandaFidelidad(t: Trabajo, repoRuta: string | undefined) {
    const pedidos = pedidoFidelidad.get(t.id) ?? [];
    const sinMedir = (xs: ArchivoDeFidelidad[]) => xs.map((a) => ({ cerebro: a.cerebro, archivo: a.archivo, puntaje: null }));
    try {
      const reg = await lanzar(t, repoRuta);
      // Aun cancelada pudo haber declarado algo: se reindexa y se mide igual.
      for (const nombre of t.cerebros) {
        const c = reg.cerebro(nombre);
        const suyos = pedidos.filter((a) => a.cerebro === nombre);
        if (!c) {
          t.pendientes = [...(t.pendientes ?? []), ...sinMedir(suyos)];
          continue;
        }
        try {
          if (opciones.reindexar) await opciones.reindexar(nombre);
          else await aplicarCerebro(c);
          const medidos = new Map(fidelidadDeArchivos(await cargarContexto(c.raiz)).archivos.map((a) => [a.archivo, a]));
          for (const a of suyos) {
            const m = medidos.get(a.archivo);
            (fidelidadResuelta(m, a) ? (t.completados ??= []) : (t.pendientes ??= [])).push({ cerebro: a.cerebro, archivo: a.archivo, puntaje: m ? m.puntaje : null });
          }
        } catch (e) {
          t.pendientes = [...(t.pendientes ?? []), ...sinMedir(suyos)];
          t.error = `${t.error ? `${t.error}. ` : ""}${nombre} could not be reindexed: ${(e as Error).message.split("\n")[0]}`;
        }
      }
    } catch (e) {
      t.error = `${t.error ? `${t.error}. ` : ""}${(e as Error).message}`;
    }
    t.desenlaces = desenlacesDeTanda(t, new Map(pedidos.map((a) => [`${a.cerebro}|${a.archivo}`, a.puntaje])));
    pedidoFidelidad.delete(t.id);
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error && !t.completados?.length ? "fallo" : "terminado";
  }

  /**
   * Una tanda «deriva»: corre el agente, reindexa el cerebro (así entran el código y `calls.yaml` cambiados), rehace su
   * deriva cruzada con los demás cerebros y mide qué problemas pedidos ya no están.
   */
  async function correrTandaDeriva(t: Trabajo, repoRuta: string | undefined) {
    const pedidos = t.problemas ?? [];
    try {
      const reg = await lanzar(t, repoRuta);
      // Aun cancelada pudo haber cambiado algo: se reindexa y se mide igual.
      for (const nombre of t.cerebros) {
        const c = reg.cerebro(nombre);
        const suyos = pedidos.filter((p) => p.cerebro === nombre);
        if (!c) {
          t.persisten = [...(t.persisten ?? []), ...suyos];
          continue;
        }
        try {
          if (opciones.reindexar) await opciones.reindexar(nombre);
          else await aplicarCerebro(c);
          const d = await (opciones.deriva ?? ((n: string) => derivaDelCerebro(reg, n)))(nombre);
          const quedan = d ? clavesDeDeriva(nombre, d) : null;
          for (const p of suyos) (quedan && !quedan.has(claveDeDeriva(p)) ? (t.corregidos ??= []) : (t.persisten ??= [])).push(p);
        } catch (e) {
          t.persisten = [...(t.persisten ?? []), ...suyos];
          t.error = `${t.error ? `${t.error}. ` : ""}${nombre} could not be reindexed: ${(e as Error).message.split("\n")[0]}`;
        }
      }
    } catch (e) {
      t.error = `${t.error ? `${t.error}. ` : ""}${(e as Error).message}`;
    }
    t.desenlaces = desenlacesDeTanda(t);
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error && !t.corregidos?.length ? "fallo" : "terminado";
  }

  /** Una tanda agrupar, escribir o corregir: corre el agente, compila sus cerebros y mira en las páginas qué quedó resuelto. */
  async function correrTandaPaginas(t: Trabajo & { tipo: TipoDePagina }) {
    try {
      const reg = await lanzar(t);
      // Aun cancelada pudo haber escrito algo: se compila y se mide igual.
      for (const nombre of t.cerebros) {
        const c = reg.cerebro(nombre);
        const suyos = (t.items ?? []).filter((x) => x.cerebro === nombre);
        if (!c) {
          t.quedan = [...(t.quedan ?? []), ...suyos];
          continue;
        }
        try {
          if (t.tipo === "borrador") {
            // Solo borradores: resuelto es el que cambió desde que empezó la tanda (una nota, también si ya no está).
            for (const x of suyos) ((await borradorRevisado(c.raiz, x.borrador ?? "", (t.empezado ?? 0) - 1000)) ? (t.resueltos ??= []) : (t.quedan ??= [])).push(x);
            continue;
          }
          if (t.tipo === "funcionalidad") {
            // Escribe solo borradores: no hay páginas nuevas que compilar; se miran los borradores.
            for (const x of suyos) ((await resueltoEnBorrador(c.raiz, x, (t.empezado ?? 0) - 1000)) ? (t.resueltos ??= []) : (t.quedan ??= [])).push(x);
            continue;
          }
          await compileDirConVisor(c.raiz);
          const ctx = await cargarContexto(c.raiz);
          for (const x of suyos) (resueltoEnPagina(ctx, t.tipo, x) ? (t.resueltos ??= []) : (t.quedan ??= [])).push(x);
        } catch (e) {
          t.quedan = [...(t.quedan ?? []), ...suyos];
          t.error = `${t.error ? `${t.error}. ` : ""}${nombre} does not compile: ${(e as Error).message.split("\n")[0]}`;
        }
      }
    } catch (e) {
      t.error = `${t.error ? `${t.error}. ` : ""}${(e as Error).message}`;
    }
    t.desenlaces = desenlacesDeTanda(t);
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error && !t.resueltos?.length ? "fallo" : "terminado";
  }

  /** Un lote agrupar, escribir o corregir: tandas por funcionalidad, una detrás de otra (editan páginas de varios cerebros). */
  function encolarLotePaginas(tipo: TipoDePagina, items: ItemDePagina[], elegido: { a: AdaptadorDeAgente; modelo: string | undefined }): { lote: Lote; trabajos: Trabajo[] } {
    const { a, modelo } = elegido;
    const cerebros = [...new Set(items.map((x) => x.cerebro))];
    const lote: Lote = { id: randomBytes(6).toString("hex"), tipo, creado: Date.now(), cerebros, estado: "corriendo" };
    lotes.push(lote);
    const partes = tandasDePaginas(items, TANDA_MAX_PAGINAS[tipo]);
    const que = (xs: ItemDePagina[]) => {
      if (tipo === "funcionalidad") {
        const n = new Set(xs.filter((x) => x.funcionalidad).map((x) => x.funcionalidad)).size, p = xs.filter((x) => !x.funcionalidad).length;
        return [n ? `${n} ${n === 1 ? "feature" : "features"}` : "", p ? `proposal for ${p} ${p === 1 ? "brain" : "brains"}` : ""].filter(Boolean).join(" · ");
      }
      if (tipo === "borrador") return `${xs.length} ${xs.length === 1 ? "draft" : "drafts"}`;
      if (tipo !== "corregir") { const n = new Set(xs.map((x) => x.funcionalidad)).size; return `${n} ${n === 1 ? "feature" : "features"}`; }
      return `${xs.length} ${xs.length === 1 ? "use case or rule" : "use cases and rules"}`;
    };
    const repo = cerebros.join(", ");
    const hechos = partes.map((parte, i) => {
      const n = i + 1, de = partes.length;
      const t = nuevo({
        tipo, proveedor: a.id, ...(modelo ? { modelo } : {}), lote: lote.id, repo, tanda: { n, de },
        etiqueta: `${de > 1 ? `Batch ${n} of ${de} · ` : ""}${que(parte)}`,
        pedido: pedidoDeTandaPaginas(tipo, parte, n, de), cerebros: [...new Set(parte.map((x) => x.cerebro))],
        items: parte.map(({ linea: _, ...x }) => x),
      });
      adaptadorDe.set(t.id, a);
      trabajos.push(t);
      return t;
    });
    podar();
    void (async () => {
      for (const t of hechos) if (t.estado !== "cancelado") await correrTandaPaginas(t as Trabajo & { tipo: TipoDePagina });
      await terminarLote(lote);
    })();
    return { lote, trabajos: hechos };
  }

  async function terminarLote(l: Lote) {
    // Cada tanda «asociar», «fidelidad», «deriva», agrupar, escribir o corregir ya compiló (o reindexó) sus cerebros: no hay tests nuevos que indexar.
    if (l.tipo !== "test") {
      l.estado = "terminado";
      return;
    }
    l.estado = "reindexando";
    for (const c of l.cerebros) {
      try {
        if (opciones.reindexar) await opciones.reindexar(c);
        else {
          const cer = (await registro()).cerebro(c);
          if (cer) await compileDirConVisor(cer.raiz);
        }
      } catch (e) {
        l.error = `${l.error ? `${l.error}. ` : ""}Could not update ${c}: ${(e as Error).message.split("\n")[0]}`;
      }
    }
    l.estado = "terminado";
  }

  return {
    noDisponible,
    proveedores: () => instalados().map((a) => ({ id: a.id, nombre: a.nombre, version: a.detectar().version ?? "", modelos: a.modelos() })),
    encolar(p) {
      const no = noDisponible();
      if (no) throw new Error(no);
      const { a, modelo } = elegir(p.proveedor, p.modelo);
      const t = nuevo({ tipo: p.tipo, etiqueta: p.etiqueta, pedido: p.pedido, cerebros: p.cerebros, proveedor: a.id, ...(modelo ? { modelo } : {}) });
      adaptadorDe.set(t.id, a);
      trabajos.push(t);
      podar();
      siguiente();
      return t;
    },
    encolarLote(p) {
      const no = noDisponible();
      if (no) throw new Error(no);
      if (esTipoDePagina(p.tipo)) {
        const q = p as { tipo: TipoDePagina; items: ItemDePagina[] };
        if (!q.items.length) throw new ConsultaError("parametro_invalido", "there is nothing to request");
        return encolarLotePaginas(q.tipo, q.items, elegir(p.proveedor, p.modelo));
      }
      const tipo = p.tipo === "asociar" || p.tipo === "fidelidad" || p.tipo === "deriva" ? p.tipo : "test";
      // asociar, fidelidad y deriva: cosas de un cerebro, que escriben en su carpeta.
      const porCerebro = tipo !== "test";
      type Item = ReglaDePedido | (ArchivoDePedido & { repo: string }) | (ArchivoDeFidelidad & { repo: string }) | (ProblemaDeDeriva & { repo: string });
      const items: Item[] = p.tipo === "deriva"
        ? p.problemas.map((x) => ({ ...x, repo: x.ev.split(":")[0]! }))
        : p.tipo === "asociar" || p.tipo === "fidelidad" ? (p.archivos as Array<ArchivoDePedido | ArchivoDeFidelidad>).map((a) => ({ ...a, repo: a.archivo.split(":")[0]! })) : (p as { reglas: ReglaDePedido[] }).reglas;
      if (!items.length) throw new ConsultaError("parametro_invalido", tipo === "deriva" ? "there are no problems to request" : porCerebro ? "there are no files to request" : "there are no rules to request");
      const { a, modelo } = elegir(p.proveedor, p.modelo);
      const cerebros = [...new Set(items.map((r) => r.cerebro))];
      const lote: Lote = { id: randomBytes(6).toString("hex"), tipo, creado: Date.now(), cerebros, estado: "corriendo" };
      lotes.push(lote);
      // Cada cadena corre sus tandas de a una; las cadenas, en paralelo. Tests: una cadena por repo (las tandas no editan
      // páginas). Asociar y fidelidad: una por cerebro (las tandas escriben en su carpeta), con las tandas armadas por repo.
      const repoDe = (r: Item) => r.repo ?? `brain ${r.cerebro}`;
      const cadenaDe = (r: Item) => (porCerebro ? `brain ${r.cerebro}` : repoDe(r));
      const grupos = new Map<string, { cadena: string; repo: string; cerebro: string; xs: typeof items }>();
      for (const r of items) {
        const k = `${cadenaDe(r)}\u0000${repoDe(r)}`;
        if (!grupos.has(k)) grupos.set(k, { cadena: cadenaDe(r), repo: repoDe(r), cerebro: r.cerebro, xs: [] });
        grupos.get(k)!.xs.push(r);
      }
      const hechos: Trabajo[] = [];
      const cadenas = new Map<string, Array<{ t: Trabajo; repo: string }>>();
      for (const g of grupos.values()) {
        const tam = tamanioDeTanda(g.xs.length, tipo === "asociar" ? TANDA_MAX_ASOCIAR : tipo === "fidelidad" ? TANDA_MAX_FIDELIDAD : tipo === "deriva" ? TANDA_MAX_DERIVA : TANDA_MAX);
        const de = Math.ceil(g.xs.length / tam);
        for (let n = 1; n <= de; n++) {
          const parte = g.xs.slice((n - 1) * tam, n * tam);
          const base = { proveedor: a.id, ...(modelo ? { modelo } : {}), lote: lote.id, repo: g.repo, tanda: { n, de } };
          const t = tipo === "deriva"
            ? nuevo({
              ...base, tipo: "deriva", etiqueta: `${g.repo}${de > 1 ? ` · batch ${n} of ${de}` : ""} · ${parte.length} ${parte.length === 1 ? "problem" : "problems"}`,
              pedido: pedidoDeTandaDeriva(parte as ProblemaDeDeriva[], g.repo, g.cerebro, n, de), cerebros: [g.cerebro],
              problemas: (parte as Array<ProblemaDeDeriva & { repo?: string }>).map(({ repo: _, ...x }) => x),
            })
            : tipo === "fidelidad"
            ? nuevo({
              ...base, tipo: "fidelidad", etiqueta: `${g.repo}${de > 1 ? ` · batch ${n} of ${de}` : ""} · ${parte.length} ${parte.length === 1 ? "file" : "files"}`,
              pedido: pedidoDeTandaFidelidad(parte as ArchivoDeFidelidad[], g.repo, g.cerebro, n, de), cerebros: [g.cerebro],
              archivos: (parte as ArchivoDeFidelidad[]).map((x) => ({ cerebro: x.cerebro, archivo: x.archivo })),
            })
            : tipo === "asociar"
            ? nuevo({
              ...base, tipo: "asociar", etiqueta: `${g.repo}${de > 1 ? ` · batch ${n} of ${de}` : ""} · ${parte.length} ${parte.length === 1 ? "file" : "files"}`,
              pedido: pedidoDeTandaAsociar(parte as ArchivoDePedido[], g.repo, g.cerebro, n, de), cerebros: [g.cerebro],
              archivos: (parte as ArchivoDePedido[]).map((x) => ({ cerebro: x.cerebro, archivo: x.archivo })),
            })
            : nuevo({
              ...base, tipo: "test", etiqueta: `${g.repo}${de > 1 ? ` · batch ${n} of ${de}` : ""} · ${parte.length} ${parte.length === 1 ? "rule" : "rules"}`,
              pedido: pedidoDeTanda(parte as ReglaDePedido[], g.repo, n, de), cerebros: [...new Set(parte.map((r) => r.cerebro))],
              reglas: (parte as ReglaDePedido[]).map((r) => ({ cerebro: r.cerebro, funcionalidad: r.funcionalidad, regla: r.regla })),
            });
          adaptadorDe.set(t.id, a);
          if (tipo === "fidelidad") pedidoFidelidad.set(t.id, parte as ArchivoDeFidelidad[]);
          trabajos.push(t);
          hechos.push(t);
          cadenas.set(g.cadena, [...(cadenas.get(g.cadena) ?? []), { t, repo: g.repo }]);
        }
      }
      podar();
      // Dentro de una cadena, una tanda después de otra (dos agentes en el mismo repo, o en las mismas páginas, se pisarían).
      void (async () => {
        const reg = await registro();
        // La carpeta de un repo: la que declara el registro con su id o, si no lo declara, la que anotó el índice del cerebro.
        const indexadas = new Map<string, Promise<Record<string, string>>>();
        const rutaDe = async (repo: string, cerebro: string | undefined) => {
          const declarada = reg.cerebros.flatMap((c) => c.repos).find((r) => r.id === repo)?.ruta;
          const c = cerebro ? reg.cerebro(cerebro) : null;
          if (declarada || !c) return declarada;
          if (!indexadas.has(c.nombre)) indexadas.set(c.nombre, cargarContexto(c.raiz).then((x) => x.codigo?.raices ?? {}, () => ({})));
          const r = (await indexadas.get(c.nombre)!)[repo];
          return r ? resolve(c.raiz, r) : undefined;
        };
        await Promise.all([...cadenas.values()].map(async (ts) => {
          for (const { t, repo } of ts) {
            if (t.estado === "cancelado") {
              pedidoFidelidad.delete(t.id);
              continue;
            }
            const ruta = await rutaDe(repo, t.cerebros[0]);
            await (tipo === "deriva" ? correrTandaDeriva(t, ruta) : tipo === "fidelidad" ? correrTandaFidelidad(t, ruta) : tipo === "asociar" ? correrTandaAsociar(t, ruta) : correrTanda(t, ruta));
          }
        }));
        await terminarLote(lote);
      })();
      return { lote, trabajos: hechos };
    },
    lista: () => trabajos.slice().reverse(),
    lotes: () => lotes.slice().reverse(),
    cancelar(id) {
      const t = trabajos.find((x) => x.id === id);
      if (!t || !vivo(t)) return t ?? null;
      const p = procesos.get(id);
      t.estado = "cancelado";
      t.terminado = Date.now();
      if (p) p.kill("SIGTERM");
      return t;
    },
    cancelarLote(id) {
      if (!lotes.some((l) => l.id === id)) return null;
      const ts = trabajos.filter((t) => t.lote === id);
      for (const t of ts) if (vivo(t)) this.cancelar(t.id);
      return ts;
    },
  };
}

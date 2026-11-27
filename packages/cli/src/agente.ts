import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { cargarContexto, ConsultaError, especificaciones, fidelidadDeArchivos, TEST_REF, type Contexto, type Registro } from "@flowbrain/core";
import { compileDirConVisor } from "@flowbrain/viewer";
import type { Edicion } from "./edicion.js";
import { GUIA_ESPECIFICACIONES, GUIA_TESTS } from "./guia.js";
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
 *   En todos, una tanda que falla no frena a las demás, y se cancela el lote entero o una tanda.
 */

export type TipoDePedido = "test" | "agrupar" | "escribir" | "corregir" | "asociar";
export const TIPOS_DE_PEDIDO: readonly TipoDePedido[] = ["test", "agrupar", "escribir", "corregir", "asociar"];

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
2. Edit the pages (or write the drafts). After editing pages of a brain, run \`flowbrain compile\` inside
   \`.flowbrain/<brain>/\`; if it does not compile, fix your edit.
3. \`flowbrain unassigned --brain <brain>\` shows what is still unassigned.
4. Report: what you assigned and where, the drafts you wrote, and what you left and why.
`;

/** Comandos que puede correr un pedido «asociar»: leer FlowBrain y compilar; nada de tests ni de promover. */
const COMANDOS_ASOCIAR = ["flowbrain compile", "flowbrain unassigned", "flowbrain feature", "flowbrain status", "flowbrain brains", "flowbrain screen", "flowbrain connections", "flowbrain specs --guide", "cd", "ls", "git status", "git diff"];

/**
 * Comandos que puede correr un pedido sobre las especificaciones (agrupar, escribir, corregir): leer FlowBrain (el
 * flujo de un endpoint, una pantalla, los casos de test) y compilar; nada de tests ni de promover.
 */
const COMANDOS_ESPECIFICACIONES = ["flowbrain compile", "flowbrain specs", "flowbrain feature", "flowbrain flow", "flowbrain screen", "flowbrain status", "flowbrain brains", "flowbrain connections", "cd", "ls", "git status", "git diff"];

/**
 * Los permisos de un pedido. Sin `escritura`, los de siempre (`POLITICA`: edita dentro del proyecto y corre tests).
 * Un pedido «asociar» solo puede escribir las páginas `feat-*` y `lib-*` de sus cerebros y borradores en `_drafts/`;
 * uno sobre las especificaciones (agrupar, escribir, corregir), solo las páginas `feat-*` de sus cerebros (y las de
 * borrador): lo mismo que dice su guía, «no modifiques los repositorios del proyecto».
 */
export function permisosDelPedido(tipo: TipoDePedido, raices: string[]): { escritura?: string[]; comandos?: string[] } {
  if (tipo === "asociar") {
    return {
      escritura: raices.flatMap((r) => [join(r, "_drafts", "**"), join(r, "product", "feat-*.md"), join(r, "technology", "lib-*.md")]),
      comandos: COMANDOS_ASOCIAR,
    };
  }
  if (esTipoDePagina(tipo)) {
    return {
      escritura: raices.flatMap((r) => [join(r, "product", "feat-*.md"), join(r, "_drafts", "product", "feat-*.md")]),
      comandos: COMANDOS_ESPECIFICACIONES,
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
 * marcado como mal o una regla a corregir de ella (corregir). `linea` es como lo lee el agente, en inglés.
 */
export interface ItemDePagina {
  cerebro: string;
  /** Id local de la funcionalidad (`feat-mvp`). */
  funcionalidad: string;
  /** corregir: el caso de uso marcado como mal. */
  caso?: string;
  /** corregir: la regla que una persona dijo que está mal (su hallazgo, con decisión `regla_mal`). */
  regla?: string;
  linea: string;
}
export type TipoDePagina = "agrupar" | "escribir" | "corregir";
export const TIPOS_DE_PAGINA: readonly TipoDePagina[] = ["agrupar", "escribir", "corregir"];
export const esTipoDePagina = (t: unknown): t is TipoDePagina => TIPOS_DE_PAGINA.includes(t as TipoDePagina);

export type TipoDeLote = "test" | "asociar" | TipoDePagina;

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

/**
 * Ítems por tanda de un lote sobre las especificaciones. Escribir lee el código y los tests de cada funcionalidad
 * entera: pocas por tanda. Agrupar solo ordena lo escrito; corregir, un caso o una regla.
 */
export const TANDA_MAX_PAGINAS: Readonly<Record<TipoDePagina, number>> = { agrupar: 8, escribir: 3, corregir: 10 };

/** Cuántos lleva cada tanda: lo más parejo posible y nunca más de `max` (15 reglas, o 30 archivos). */
export function tamanioDeTanda(n: number, max = TANDA_MAX): number {
  return Math.ceil(n / Math.max(1, Math.ceil(n / max)));
}

/** El texto que recibe el agente: la guía del tipo de pedido, con el pedido en lugar de `$ARGUMENTS`. */
export function indicacionesDelPedido(tipo: TipoDePedido, pedido: string): string {
  const guia = (tipo === "test" ? GUIA_TESTS : tipo === "asociar" ? GUIA_ASOCIAR : GUIA_ESPECIFICACIONES).replace(/^---\n[\s\S]*?\n---\n/, "");
  return guia.replace("$ARGUMENTS", `What the person asks for, from the FlowBrain viewer:\n\n${pedido.trim()}\n`);
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
    "",
    ...archivos.map((a) => a.linea),
  ].join("\n");
}

/**
 * Las tandas de un lote sobre las especificaciones: lo de una misma funcionalidad (en todos sus cerebros) va junto,
 * para que el agente use el mismo id de caso de un lado y del otro; las funcionalidades se suman a una tanda mientras
 * entren en `max` (una que sola lo pasa va en su propia tanda).
 */
export function tandasDePaginas<T extends Pick<ItemDePagina, "funcionalidad">>(items: T[], max: number): T[][] {
  const grupos = new Map<string, T[]>();
  for (const x of items) grupos.set(x.funcionalidad, [...(grupos.get(x.funcionalidad) ?? []), x]);
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
const PEDIDO_DE_PAGINA: Record<TipoDePagina | "reglas", (n: number) => string> = {
  agrupar: (n) => `Group into use cases the specifications that are not in any use case yet, in ${n === 1 ? "this FlowBrain feature" : `these ${n} FlowBrain features`}, following the guide. The same use case in another brain keeps the same id. Don't change the text of the specifications.`,
  escribir: (n) => `Write the use cases and specifications of ${n === 1 ? "this FlowBrain feature" : `these ${n} FlowBrain features`}, following the guide.`,
  corregir: (n) => `Fix ${n === 1 ? "this FlowBrain use case" : `these ${n} FlowBrain use cases`} that a person marked as wrong, following the guide. After fixing each one, delete its problema field from the page.`,
  reglas: (n) => `Fix the text of ${n === 1 ? "this FlowBrain rule" : `these ${n} FlowBrain rules`}: the agent that tried to test them found that the code does something else, and a person decided the rule is wrong, not the code. Fix the text of each rule (or delete it, if it no longer holds) according to what the code does today, following the guide, and delete its finding (hallazgo). Don't change the product code.`,
};

/** El pedido de una tanda agrupar, escribir o corregir: qué hacer, los ítems y cómo cerrar. El agente edita las páginas. */
export function pedidoDeTandaPaginas(tipo: TipoDePagina, items: ItemDePagina[], n: number, de: number): string {
  const partes: string[] = [];
  const bloque = (cabeza: string, xs: ItemDePagina[]) => { if (xs.length) partes.push(cabeza, "", ...xs.map((x) => x.linea), ""); };
  if (tipo === "corregir") {
    bloque(PEDIDO_DE_PAGINA.corregir(items.filter((x) => !x.regla).length), items.filter((x) => !x.regla));
    bloque(PEDIDO_DE_PAGINA.reglas(items.filter((x) => x.regla).length), items.filter((x) => x.regla));
  } else bloque(PEDIDO_DE_PAGINA[tipo](new Set(items.map((x) => x.funcionalidad)).size), items);
  return [
    ...(de > 1 ? [`This is batch ${n} of ${de} of the request: other batches cover the rest, only handle these.`, ""] : []),
    ...partes,
    "Do NOT modify the project's repositories: only the feature pages of FlowBrain. When done, compile each brain (flowbrain compile inside .flowbrain/<brain>/) and check with flowbrain specs <feature> --brain <brain> that no broken references remain. The server compiles again and checks in the pages what got resolved.",
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
   * `test`: reparte las reglas por repo (en paralelo) y cada repo en tandas. `asociar`: los archivos por cerebro (en
   * paralelo) y por repo, en tandas. `agrupar`, `escribir` y `corregir`: los ítems en tandas, una detrás de otra.
   */
  encolarLote(p: ({ tipo?: "test"; reglas: ReglaDePedido[] } | { tipo: "asociar"; archivos: ArchivoDePedido[] } | { tipo: TipoDePagina; items: ItemDePagina[] }) & { proveedor?: string; modelo?: string }): { lote: Lote; trabajos: Trabajo[] };
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
    const { comando, args } = a.armar({ prompt: indicacionesDelPedido(t.tipo, t.pedido), ...(t.modelo ? { modelo: t.modelo } : {}), cwd, carpetasExtra: afuera, ...permisosDelPedido(t.tipo, raices) });
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
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error && !t.asociados?.length ? "fallo" : "terminado";
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
    // Cada tanda «asociar», agrupar, escribir o corregir ya compiló sus cerebros: no hay tests nuevos que indexar.
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
      const asociar = p.tipo === "asociar";
      const items: Array<ReglaDePedido | (ArchivoDePedido & { repo: string })> = p.tipo === "asociar" ? p.archivos.map((a) => ({ ...a, repo: a.archivo.split(":")[0]! })) : (p as { reglas: ReglaDePedido[] }).reglas;
      if (!items.length) throw new ConsultaError("parametro_invalido", asociar ? "there are no files to request" : "there are no rules to request");
      const { a, modelo } = elegir(p.proveedor, p.modelo);
      const cerebros = [...new Set(items.map((r) => r.cerebro))];
      const lote: Lote = { id: randomBytes(6).toString("hex"), tipo: asociar ? "asociar" : "test", creado: Date.now(), cerebros, estado: "corriendo" };
      lotes.push(lote);
      // Cada cadena corre sus tandas de a una; las cadenas, en paralelo. Tests: una cadena por repo (las tandas no editan
      // páginas). Asociar: una por cerebro (las tandas editan sus páginas), con las tandas armadas por repo.
      const repoDe = (r: (typeof items)[number]) => r.repo ?? `brain ${r.cerebro}`;
      const cadenaDe = (r: (typeof items)[number]) => (asociar ? `brain ${r.cerebro}` : repoDe(r));
      const grupos = new Map<string, { cadena: string; repo: string; cerebro: string; xs: typeof items }>();
      for (const r of items) {
        const k = `${cadenaDe(r)}\u0000${repoDe(r)}`;
        if (!grupos.has(k)) grupos.set(k, { cadena: cadenaDe(r), repo: repoDe(r), cerebro: r.cerebro, xs: [] });
        grupos.get(k)!.xs.push(r);
      }
      const hechos: Trabajo[] = [];
      const cadenas = new Map<string, Array<{ t: Trabajo; repo: string }>>();
      for (const g of grupos.values()) {
        const tam = tamanioDeTanda(g.xs.length, asociar ? TANDA_MAX_ASOCIAR : TANDA_MAX);
        const de = Math.ceil(g.xs.length / tam);
        for (let n = 1; n <= de; n++) {
          const parte = g.xs.slice((n - 1) * tam, n * tam);
          const base = { proveedor: a.id, ...(modelo ? { modelo } : {}), lote: lote.id, repo: g.repo, tanda: { n, de } };
          const t = asociar
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
          trabajos.push(t);
          hechos.push(t);
          cadenas.set(g.cadena, [...(cadenas.get(g.cadena) ?? []), { t, repo: g.repo }]);
        }
      }
      podar();
      // Dentro de una cadena, una tanda después de otra (dos agentes en el mismo repo, o en las mismas páginas, se pisarían).
      void (async () => {
        const reg = await registro();
        const rutaDe = (repo: string) => reg.cerebros.flatMap((c) => c.repos).find((r) => r.id === repo)?.ruta;
        await Promise.all([...cadenas.values()].map(async (ts) => {
          for (const { t, repo } of ts) {
            if (t.estado === "cancelado") continue;
            await (asociar ? correrTandaAsociar(t, rutaDe(repo)) : correrTanda(t, rutaDe(repo)));
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

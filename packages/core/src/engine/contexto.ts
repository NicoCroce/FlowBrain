import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cmp } from "../canonical.js";
import type { Salidas } from "../compile.js";
import { MARCA_FIN, MARCA_INICIO } from "../render.js";
import type { Ficha } from "../funcionalidades.js";
import type { Contrato, Graph, GraphEdge, GraphNode } from "../schema.js";
import { crearIndiceCodigo, type IndiceCodigo } from "./codigo.js";

/** Todo lo que el motor necesita, ya indexado. Inmutable después de construido. */
export interface Contexto {
  graph: Graph;
  nodo: Map<string, GraphNode>;
  salientes: Map<string, GraphEdge[]>;
  entrantes: Map<string, GraphEdge[]>;
  contratos: Map<string, Contrato>;
  /** Prosa de cada página (sin frontmatter ni backlinks), por id de nodo. */
  prosa: Map<string, string>;
  /** Funcionalidades, símbolos, invocaciones y accesos por método. `null` si el brain no tiene índice de código. */
  codigo: IndiceCodigo | null;
}

export function crearContexto(graph: Graph, contratos: Contrato[], prosa: Map<string, string>, codigo: IndiceCodigo | null = null): Contexto {
  const nodo = new Map(graph.nodes.map((n) => [n.id, n]));
  const salientes = new Map<string, GraphEdge[]>();
  const entrantes = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    (salientes.get(e.desde) ?? salientes.set(e.desde, []).get(e.desde)!).push(e);
    (entrantes.get(e.hasta) ?? entrantes.set(e.hasta, []).get(e.hasta)!).push(e);
  }
  return { graph, nodo, salientes, entrantes, contratos: new Map(contratos.map((c) => [c.svc, c])), prosa, codigo };
}

/** Cuerpo de página → prosa: sin la sección de backlinks y sin espacios sobrantes. */
export function extraerProsa(contenidoPagina: string): string {
  const texto = contenidoPagina.replace(/\r\n/g, "\n");
  const cierre = /^---[ \t]*$/m.exec(texto.slice(4));
  let cuerpo = cierre ? texto.slice(4 + cierre.index + cierre[0].length) : texto;
  const i = cuerpo.indexOf(MARCA_INICIO);
  const f = cuerpo.indexOf(MARCA_FIN);
  if (i !== -1 && f > i) cuerpo = cuerpo.slice(0, i) + cuerpo.slice(f + MARCA_FIN.length);
  return cuerpo.trim();
}

/** Contexto a partir de la salida de `compile` (sin tocar disco). */
export function contextoDeSalidas(s: Salidas, contratos: Contrato[], fuentes?: { archivos: string[]; extracciones: string[] }): Contexto {
  const prosa = new Map<string, string>();
  for (const n of s.graph.nodes) {
    if (n.pagina && s.paginas[n.pagina] !== undefined) prosa.set(n.id, extraerProsa(s.paginas[n.pagina]!));
  }
  const codigo = fuentes ? crearIndiceCodigo(s.graph, s.funcionalidades, fuentes.archivos, fuentes.extracciones) : null;
  return crearContexto(s.graph, contratos, prosa, codigo);
}

async function jsonDe(dir: string): Promise<string[]> {
  let nombres: string[] = [];
  try {
    nombres = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort(cmp);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return Promise.all(nombres.map((n) => readFile(join(dir, n), "utf8")));
}

/** Contexto a partir de un brain ya compilado en disco (`_build/graph.json`). */
export async function cargarContexto(raiz: string): Promise<Contexto> {
  const graph = JSON.parse(await readFile(join(raiz, "_build/graph.json"), "utf8")) as Graph;
  const contratos: Contrato[] = [];
  let nombres: string[] = [];
  try {
    nombres = (await readdir(join(raiz, "_build/contratos"))).filter((n) => n.endsWith(".json")).sort(cmp);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  for (const n of nombres) contratos.push(JSON.parse(await readFile(join(raiz, "_build/contratos", n), "utf8")) as Contrato);
  const prosa = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.pagina) prosa.set(n.id, extraerProsa(await readFile(join(raiz, n.pagina), "utf8")));
  }
  let fichas: Ficha[] = [];
  try {
    fichas = (JSON.parse(await readFile(join(raiz, "_build/funcionalidades.json"), "utf8")) as { funcionalidades: Ficha[] }).funcionalidades;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const archivos = await jsonDe(join(raiz, "_build/archivos"));
  const codigo = archivos.length ? crearIndiceCodigo(graph, fichas, archivos, await jsonDe(join(raiz, "_build/extraccion"))) : null;
  return crearContexto(graph, contratos, prosa, codigo);
}

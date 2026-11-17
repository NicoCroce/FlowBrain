import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { compileDir, type Salidas } from "@brain/core";
import { renderViewer } from "./viewer.js";

export * from "./viewer.js";
export * from "./mapa3d.js";

/**
 * El visor es para que una persona controle lo que el brain sabe; el motor y las consultas no dependen de él.
 * Por eso vive fuera de `core`: quien compila para un agente no lo necesita.
 */
export const RUTA_VIEWER = "_build/viewer.html";

let cytoscape: Promise<string> | null = null;
/** Cytoscape minificado, leído una vez desde node_modules (se embebe en el visor). */
const cytoscapeJs = () => (cytoscape ??= readFile(createRequire(import.meta.url).resolve("cytoscape/dist/cytoscape.min.js"), "utf8"));

/** Salida extra de `compile`: el visor autocontenido. */
export async function visor(s: Salidas): Promise<Record<string, string>> {
  return { [RUTA_VIEWER]: renderViewer(s.graph, await cytoscapeJs(), s.funcionalidades) };
}

/** `brain compile` completo: grafo, índices, páginas y el visor. */
export const compileDirConVisor = (raiz: string) => compileDir(raiz, visor);

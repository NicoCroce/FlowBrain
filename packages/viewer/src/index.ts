import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileDir, fidelidadDeFuentes, type Cruce, type ResumenConexion, type TrazasCruzadas, type Salidas } from "@flowbrain/core";
import { renderViewerCerebros, type CerebroVisor, type PorPaquetes } from "./cerebros.js";
import { renderViewer, type FidelidadVisor } from "./viewer.js";

export * from "./viewer.js";
export * from "./mapa3d.js";
export * from "./cerebros.js";

/**
 * El visor es para que una persona controle lo que el brain sabe; el motor y las consultas no dependen de él.
 * Por eso vive fuera de `core`: quien compila para un agente no lo necesita.
 */
export const RUTA_VIEWER = "_build/viewer.html";

/** Salida extra de `compile`: el visor autocontenido. */
export async function visor(s: Salidas, fidelidad?: FidelidadVisor): Promise<Record<string, string>> {
  return { [RUTA_VIEWER]: renderViewer(s.graph, s.funcionalidades, fidelidad) };
}

const jsonDe = async (dir: string) => Promise.all((await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort().map((n) => readFile(join(dir, n), "utf8")));

/** `flowbrain compile` completo: grafo, índices, páginas y el visor, con la fidelidad de cada archivo indexado. */
export const compileDirConVisor = (raiz: string) =>
  compileDir(raiz, async (s) => {
    const [archivos, extracciones] = await Promise.all([jsonDe(join(raiz, "_build/files")), jsonDe(join(raiz, "_build/extraction"))]);
    return visor(s, archivos.length ? fidelidadDeFuentes(s.graph, s.funcionalidades, archivos, extracciones) : undefined);
  });

/** Página del visor para varios cerebros. */
export async function visorDeCerebros(cerebros: CerebroVisor[], cruces: Cruce[], conexiones: ResumenConexion[], trazas?: TrazasCruzadas, paquetes?: PorPaquetes): Promise<string> {
  return renderViewerCerebros(cerebros, cruces, conexiones, trazas, paquetes);
}
export { GRAFO3D_JS } from "./viewer-3d.js";
export { ORDEN_CEREBROS_JS } from "./orden-cerebros.js";

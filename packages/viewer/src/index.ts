import { compileDir, type Cruce, type ResumenConexion, type TrazasCruzadas, type Salidas } from "@flowbrain/core";
import { renderViewerCerebros, type CerebroVisor } from "./cerebros.js";
import { renderViewer } from "./viewer.js";

export * from "./viewer.js";
export * from "./mapa3d.js";
export * from "./cerebros.js";

/**
 * El visor es para que una persona controle lo que el brain sabe; el motor y las consultas no dependen de él.
 * Por eso vive fuera de `core`: quien compila para un agente no lo necesita.
 */
export const RUTA_VIEWER = "_build/viewer.html";

/** Salida extra de `compile`: el visor autocontenido. */
export async function visor(s: Salidas): Promise<Record<string, string>> {
  return { [RUTA_VIEWER]: renderViewer(s.graph, s.funcionalidades) };
}

/** `flowbrain compile` completo: grafo, índices, páginas y el visor. */
export const compileDirConVisor = (raiz: string) => compileDir(raiz, visor);

/** Página del visor para varios cerebros. */
export async function visorDeCerebros(cerebros: CerebroVisor[], cruces: Cruce[], conexiones: ResumenConexion[], trazas?: TrazasCruzadas): Promise<string> {
  return renderViewerCerebros(cerebros, cruces, conexiones, trazas);
}
export { GRAFO3D_JS } from "./viewer-3d.js";
export { ORDEN_CEREBROS_JS } from "./orden-cerebros.js";

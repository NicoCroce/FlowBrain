/**
 * Progreso de un reindexado (decisión 216). El indexador y el compilador reciben `progreso` opcional y avisan en qué
 * etapa están; quién lo muestra (una línea que se reescribe en la terminal, líneas simples en un log, nada) lo decide
 * el que llama. El núcleo no sabe de terminales.
 *
 * Etapas, en orden: `cerebro` (N de M) → por cada repo `repo` (con la pasada) → `parsear` (muchas veces, con la
 * fracción) → `extractores` → `llamadas` → … → `paginas` → `compilar` → `fidelidad` → `visor` → `cerebro_listo`.
 * `visor` sin cerebro es el visor de todo el registro, al final.
 */
export type EventoProgreso =
  | { etapa: "cerebro"; cerebro: string; n: number; de: number }
  /** Un repo del cerebro: `pasada` de `pasadas` (al aplicar un cerebro: borradores y dos pasadas de índice). */
  | { etapa: "repo"; repo: string; n: number; de: number; pasada?: number; pasadas?: number }
  /** Un parser recorriendo los archivos del repo: `fraccion` de 0 a 1, `archivos` los del repo. Llega muy seguido. */
  | { etapa: "parsear"; repo: string; parser: string; archivos: number; fraccion: number }
  | { etapa: "extractores"; repo: string }
  | { etapa: "llamadas"; repo: string }
  /** Promover borradores a páginas (compila el cerebro con cada intento). */
  | { etapa: "paginas" }
  | { etapa: "compilar" }
  | { etapa: "fidelidad" }
  | { etapa: "visor"; todos?: boolean }
  | { etapa: "cerebro_listo"; cerebro: string; n: number; de: number; ms: number; fallidos: number };

export type Progreso = (e: EventoProgreso) => void;

/** Avisa sin romper: un `progreso` que falla no corta el indexado. */
export function avisar(progreso: Progreso | undefined, e: EventoProgreso): void {
  if (!progreso) return;
  try {
    progreso(e);
  } catch {
    /* mostrar el progreso nunca es más importante que indexar */
  }
}

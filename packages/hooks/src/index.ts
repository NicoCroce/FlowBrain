import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { contextoParaPrompt, type Contexto } from "@brain/core";

export const BUDGET_HOOK = 1500;

/** Nombre del directorio raíz del repo git que contiene `dir` (o el propio `dir` si no hay .git). */
export async function nombreRepo(dir: string): Promise<string> {
  let actual = resolve(dir);
  for (;;) {
    try {
      await stat(resolve(actual, ".git"));
      return basename(actual);
    } catch {
      const padre = dirname(actual);
      if (padre === actual) return basename(resolve(dir));
      actual = padre;
    }
  }
}

/** Entrada que Claude Code manda por stdin a un hook UserPromptSubmit (solo los campos que usamos). */
export interface EntradaUserPromptSubmit {
  prompt?: string;
  cwd?: string;
}

/**
 * Hook UserPromptSubmit de Claude Code: devuelve el JSON a imprimir por stdout ("" si no hay nada que
 * inyectar). Nunca debe bloquear el prompt del usuario: ante cualquier error devuelve "".
 */
export async function hookUserPromptSubmit(
  entrada: EntradaUserPromptSubmit,
  obtener: () => Promise<Contexto>,
  budget = BUDGET_HOOK,
): Promise<string> {
  if (!entrada.prompt) return "";
  const ctx = await obtener();
  const repoDir = entrada.cwd ? await nombreRepo(entrada.cwd) : null;
  const r = contextoParaPrompt(ctx, { prompt: entrada.prompt, repoDir, budget_tokens: budget });
  if (r.texto === "") return "";
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: r.texto } }) + "\n";
}

/** Bloque para CLAUDE.md / AGENTS.md (se amplía en el paso 8 con los generadores de reglas). */
export function bloqueReglas(): string {
  return [
    "## Brain",
    "",
    "Antes de explorar el código con grep, consultá el grafo de conocimiento por MCP (servidor `brain`):",
    "- `buscar_nodo` para ubicar servicios, repos, tablas o features por nombre.",
    "- `recorrer_grafo` con `verbos: [\"depende_de\"], direccion: \"in\"` para saber qué se rompe si cambiás algo.",
    "- `contrato_de` para ver qué devuelve un endpoint.",
    "- `trazar` para seguir un flujo desde una ruta HTTP o un archivo.",
    "Cada arista trae evidencia (`repo:ruta#Lnn`); abrí ese archivo antes de afirmar algo.",
    "",
  ].join("\n");
}

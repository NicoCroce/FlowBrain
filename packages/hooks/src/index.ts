import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { contextoParaPrompt, type Contexto } from "@flowbrain/core";

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
  const texto = r.texto.includes("</flowbrain-context>") ? r.texto.replace("</flowbrain-context>", `${INSTRUCCION_NOTA}\n</flowbrain-context>`) : `${r.texto}\n${INSTRUCCION_NOTA}`;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: texto } }) + "\n";
}


// ---------- Notas: contradicciones entre el código y el brain ----------

import { PREFIJO_NOTA } from "./reglas.js";
export * from "./reglas.js";
export const INSTRUCCION_NOTA = `Si algo de esto contradice el código, escribí en tu respuesta una línea \`${PREFIJO_NOTA} <id-del-nodo>: <qué cambió>\`.`;

export interface Nota {
  id: string;
  texto: string;
}

/** Líneas `flowbrain-nota <id>: <texto>` en un texto (tolera viñetas, citas y backticks alrededor). */
export function extraerNotas(texto: string): Nota[] {
  const out: Nota[] = [];
  for (const cruda of texto.split("\n")) {
    let l = cruda.replace(/^[\s>*-]*/, "").trimEnd();
    if (l.startsWith("`") && l.endsWith("`") && l.length > 1) l = l.slice(1, -1);
    const m = new RegExp(`^${PREFIJO_NOTA}\\s+(\\S+?):\\s+(.+)$`).exec(l);
    if (m) out.push({ id: m[1]!, texto: m[2]!.trim() });
  }
  return out;
}

/** Notas escritas por el asistente en un transcript JSONL de Claude Code. Ignora líneas ilegibles. */
export function notasDeTranscript(jsonl: string): Nota[] {
  const out: Nota[] = [];
  for (const linea of jsonl.split("\n")) {
    if (!linea.trim()) continue;
    let ev: { type?: string; message?: { content?: unknown } };
    try {
      ev = JSON.parse(linea) as typeof ev;
    } catch {
      continue;
    }
    if (ev.type !== "assistant") continue;
    const c = ev.message?.content;
    const textos = typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((b): b is { type: "text"; text: string } => (b as { type?: string })?.type === "text").map((b) => b.text) : [];
    for (const t of textos) out.push(...extraerNotas(t));
  }
  return out;
}

const archivoNota = (id: string) => `_drafts/notes/${id.replace(/[^a-z0-9-]+/gi, "_")}.md`;

/**
 * Agrega notas a `_drafts/notes/<id>.md`, una viñeta por nota, sin duplicar. Devuelve las rutas escritas.
 * `fuente` identifica de dónde vino (sesión de Claude Code o `manual`).
 */
export async function anotar(raizBrain: string, notas: Nota[], fuente: string): Promise<string[]> {
  const porId = new Map<string, string[]>();
  for (const n of notas) porId.set(n.id, [...(porId.get(n.id) ?? []), `- ${n.texto} (${fuente})`]);
  const escritos: string[] = [];
  for (const [id, lineas] of [...porId].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const ruta = archivoNota(id);
    const destino = join(raizBrain, ruta);
    const previo = await readFile(destino, "utf8").catch(() => `# Notas sobre \`${id}\`\n\n`);
    const existentes = new Set(previo.split("\n"));
    const nuevas = [...new Set(lineas)].filter((l) => !existentes.has(l));
    if (nuevas.length === 0) continue;
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, (previo.endsWith("\n") ? previo : `${previo}\n`) + nuevas.join("\n") + "\n", "utf8");
    escritos.push(ruta);
  }
  return escritos;
}

export interface EntradaSessionEnd {
  session_id?: string;
  transcript_path?: string;
}

/** Hook SessionEnd: guarda las notas del transcript. Nunca falla hacia Claude Code (el llamador atrapa). */
export async function hookSessionEnd(entrada: EntradaSessionEnd, raizBrain: string): Promise<string[]> {
  if (!entrada.transcript_path) return [];
  const notas = notasDeTranscript(await readFile(entrada.transcript_path, "utf8"));
  return anotar(raizBrain, notas, `sesión ${entrada.session_id ?? basename(entrada.transcript_path, ".jsonl")}`);
}

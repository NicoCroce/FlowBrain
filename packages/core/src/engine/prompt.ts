import { cmp, stringifyCompact } from "../canonical.js";
import type { GraphNode } from "../schema.js";
import type { Contexto } from "./contexto.js";
import { ConsultaError, recorrerGrafo, trazar, BUDGET_POR_DEFECTO } from "./herramientas.js";
import { tokens } from "./proyeccion.js";

/**
 * Contexto para inyectar en un prompt (puerta "hook"). Determinístico: detecta rutas HTTP, archivos y
 * menciones exactas de nodos en el texto, y responde con las mismas herramientas del motor.
 */

export const MAX_TRAZAS = 3;
export const MAX_NODOS = 5;
const MIN_SECCION = 80;
const TIPOS_NOMBRABLES = new Set(["repo", "svc", "lib", "db", "queue", "ext", "tabla", "feat", "team", "decision"]);

export interface ContextoPromptParams {
  prompt: string;
  /** Nombre del directorio del repo actual (basename de la raíz git), o null. */
  repoDir?: string | null;
  budget_tokens?: number;
}

export interface Seccion {
  titulo: string;
  resultado: unknown;
}

export interface ContextoPrompt {
  repo: string | null;
  secciones: Seccion[];
  omitidas: number;
  texto: string;
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Repo cuyo id (sin `repo-`), nombre o alias coincide con el nombre del directorio. */
export function repoPorDirectorio(ctx: Contexto, dir: string): GraphNode | null {
  const q = normalizar(dir.trim());
  const hits = ctx.graph.nodes.filter(
    (n) => n.tipo === "repo" && [n.id, n.id.slice(5), n.nombre, ...n.aliases].some((k) => normalizar(k) === q),
  );
  return hits.length === 1 ? hits[0]! : null;
}

const indices = new WeakMap<Contexto, Map<string, string[]>>();
function indiceNombres(ctx: Contexto): Map<string, string[]> {
  let idx = indices.get(ctx);
  if (idx) return idx;
  idx = new Map();
  for (const n of ctx.graph.nodes) {
    if (!TIPOS_NOMBRABLES.has(n.tipo)) continue;
    for (const k of new Set([n.id, n.nombre, ...n.aliases].map((x) => palabras(x).join(" ")))) {
      if (k.length < 3) continue;
      const l = idx.get(k) ?? [];
      l.push(n.id);
      idx.set(k, l);
    }
  }
  indices.set(ctx, idx);
  return idx;
}

const palabras = (s: string) => normalizar(s).split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);

/** Menciones exactas (n-gramas de hasta 4 palabras), en orden de aparición. */
function nodosMencionados(ctx: Contexto, prompt: string): string[] {
  const idx = indiceNombres(ctx);
  const ws = palabras(prompt);
  const vistos: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    for (let n = 4; n >= 1; n--) {
      if (i + n > ws.length) continue;
      const ids = idx.get(ws.slice(i, i + n).join(" "));
      if (!ids) continue;
      for (const id of [...ids].sort(cmp)) if (!vistos.includes(id)) vistos.push(id);
      break;
    }
  }
  return vistos;
}

/** Rutas HTTP (`/checkout`, `POST /payments`, URLs) y archivos (`a/b/c.ts`), en orden de aparición. */
function candidatosTraza(prompt: string): string[] {
  const out: string[] = [];
  const re =
    /(?:\b(GET|POST|PUT|PATCH|DELETE)\s+)?(https?:\/\/[^\s`'"()<>]+|(?<![\w.\-/])\/[A-Za-z0-9_\-{}:./]+|[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?\/[A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,6})/g;
  for (const m of prompt.matchAll(re)) {
    const valor = m[2]!.replace(/[.,;:)]+$/, "");
    if (valor === "/" || valor.length < 2) continue;
    const c = m[1] ? `${m[1]} ${valor}` : valor;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

export function contextoParaPrompt(ctx: Contexto, p: ContextoPromptParams): ContextoPrompt {
  const budget = p.budget_tokens ?? BUDGET_POR_DEFECTO;
  const repo = p.repoDir ? repoPorDirectorio(ctx, p.repoDir) : null;

  const pendientes: Array<{ titulo: string; correr: (b: number) => unknown }> = [];
  for (const c of candidatosTraza(p.prompt)) {
    if (pendientes.length >= MAX_TRAZAS) break;
    try {
      trazar(ctx, { desde: c, budget_tokens: null });
    } catch (e) {
      if (e instanceof ConsultaError) continue;
      throw e;
    }
    pendientes.push({ titulo: `trazar ${c}`, correr: (b) => trazar(ctx, { desde: c, budget_tokens: b }) });
  }
  for (const id of nodosMencionados(ctx, p.prompt).slice(0, MAX_NODOS)) {
    pendientes.push({
      titulo: `recorrer_grafo ${id}`,
      correr: (b) => recorrerGrafo(ctx, { nodo: id, direccion: "both", budget_tokens: b }),
    });
  }

  if (!repo && pendientes.length === 0) return { repo: null, secciones: [], omitidas: 0, texto: "" };

  const cabecera = [
    "<brain-context>",
    "Grafo de conocimiento del sistema (determinístico, con evidencia). Herramientas MCP: buscar_nodo, recorrer_grafo, contrato_de, trazar, recorrido, pantalla, quien_llama, impacto, funcionalidad.",
  ];
  if (repo) cabecera.push(`Repo actual: ${repo.id} — ${repo.nombre}${repo.resumen ? `: ${repo.resumen}` : ""}`);
  const cierre = "</brain-context>";

  const lineas = [...cabecera];
  const secciones: Seccion[] = [];
  let omitidas = 0;
  for (const s of pendientes) {
    const usado = tokens(lineas.join("\n") + "\n" + cierre) + Math.ceil((`## ${s.titulo}\n`.length + 1) / 4) + 1;
    const disponible = budget - usado;
    if (disponible < MIN_SECCION) {
      omitidas++;
      continue;
    }
    const resultado = s.correr(disponible);
    secciones.push({ titulo: s.titulo, resultado });
    lineas.push(`## ${s.titulo}`, stringifyCompact(resultado));
  }
  if (omitidas > 0) lineas.push(`(${omitidas} secciones omitidas por presupuesto)`);
  lineas.push(cierre);
  return { repo: repo?.id ?? null, secciones, omitidas, texto: lineas.join("\n") + "\n" };
}

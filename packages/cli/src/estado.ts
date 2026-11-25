import { compileDirConVisor } from "@flowbrain/viewer";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { avisar, cargarContexto, cmp, commitDe, dentroDe, ES_TEST, type Contexto, type Progreso } from "@flowbrain/core";
import { escribirIndex, indexar } from "@flowbrain/parsers";
import { L } from "./idioma.js";

/**
 * `sync`, `estado` y `doctor`: mantener el brain al día y saber qué le falta. El manifiesto de repos es lo que ya
 * escribe `flowbrain index` en `_build/files/<repo>.json`: el id, el commit indexado y la ruta del clon relativa al
 * brain. Si el clon no está ahí (otra máquina), se busca por nombre de carpeta en `--repos` / `FLOWBRAIN_REPOS`.
 */

export interface RepoIndexado {
  repo: string;
  /** Commit de HEAD al indexar; `null` si el clon no era un repo git. */
  indexado: string | null;
  /** Ruta absoluta del clon, o `null` si no se encontró. */
  clon: string | null;
  /** HEAD actual del clon. */
  actual: string | null;
  estado: "al día" | "desactualizado" | "sin clon" | "sin commit";
}

const existe = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

export async function reposIndexados(raiz: string, carpetas: string[] = []): Promise<RepoIndexado[]> {
  const dir = join(raiz, "_build/files");
  const nombres = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort(cmp);
  const out: RepoIndexado[] = [];
  for (const n of nombres) {
    let j: { repo?: string; commit?: string; raiz?: string };
    try {
      j = JSON.parse(await readFile(join(dir, n), "utf8")) as typeof j;
    } catch {
      continue;
    }
    if (!j.repo) continue;
    const candidatos = [...(j.raiz ? [resolve(raiz, j.raiz)] : []), ...(j.raiz ? carpetas.map((c) => join(c, basename(resolve(raiz, j.raiz!)))) : [])];
    let clon: string | null = null;
    for (const c of candidatos) if (await existe(c)) { clon = c; break; }
    const actual = clon ? await commitDe(clon) : null;
    const indexado = j.commit ?? null;
    const estado = !clon ? "sin clon" : !indexado || !actual ? "sin commit" : indexado === actual ? "al día" : "desactualizado";
    out.push({ repo: j.repo, indexado, clon, actual, estado });
  }
  return out;
}

export interface ResultadoSync {
  repos: Array<RepoIndexado & { reindexado: boolean }>;
  /** Si se recompiló, los archivos que cambiaron (puede ser ninguno); `null` si no hizo falta compilar. */
  compilados: string[] | null;
}

/** Reindexa los repos cuyo clon avanzó (o todos con `forzar`) y recompila si algo cambió. */
export async function sync(raiz: string, opciones: { carpetas?: string[]; forzar?: boolean; progreso?: Progreso } = {}): Promise<ResultadoSync> {
  const { progreso } = opciones;
  const repos = await reposIndexados(raiz, opciones.carpetas);
  const out: ResultadoSync["repos"] = [];
  let cambios = false;
  const tocan = repos.filter((r) => r.clon !== null && (opciones.forzar === true || r.estado === "desactualizado" || r.estado === "sin commit"));
  for (const r of repos) {
    // Sin commit no se puede saber si cambió: se reindexa siempre que haya clon.
    const toca = tocan.includes(r);
    if (toca) {
      avisar(progreso, { etapa: "repo", repo: r.repo, n: tocan.indexOf(r) + 1, de: tocan.length });
      const escritos = await escribirIndex(raiz, await indexar(r.clon!, raiz, { repo: r.repo, ...(progreso ? { progreso } : {}) }));
      if (escritos.length) cambios = true;
    }
    out.push({ ...r, reindexado: toca });
  }
  const compilados = cambios || opciones.forzar ? (await compileDirConVisor(raiz, progreso)).escritos : null;
  return { repos: out, compilados };
}

export interface Estado {
  repos: RepoIndexado[];
  nodos: Record<string, number>;
  aristas: Record<string, number>;
  /** Huecos conocidos: cada uno con cuántos casos hay y de cuántos. */
  huecos: Array<{ que: string; cuantos: number; de: number; ejemplos: string[] }>;
  desactualizado: boolean;
}

const contar = (xs: string[]) => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => cmp(a[0], b[0])));

async function borradores(raiz: string): Promise<string[]> {
  const out: string[] = [];
  const andar = async (rel: string) => {
    for (const e of await readdir(join(raiz, rel), { withFileTypes: true }).catch(() => [])) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) await andar(r);
      else if (e.name.endsWith(".md") && e.name !== "PROMPT.md" && !r.startsWith("_drafts/notes/")) out.push(r);
    }
  };
  await andar("_drafts");
  return out.sort(cmp);
}

export async function estado(raiz: string, carpetas: string[] = [], ctx?: Contexto): Promise<Estado> {
  const c = ctx ?? (await cargarContexto(raiz));
  const repos = await reposIndexados(raiz, carpetas);
  const g = c.graph;
  const de = (tipo: string) => g.nodes.filter((n) => n.tipo === tipo);
  const hueco = (que: string, casos: string[], total: number) => ({ que, cuantos: casos.length, de: total, ejemplos: casos.slice(0, 5) });
  const conArista = (verbo: string, lado: "desde" | "hasta") => new Set(g.edges.filter((e) => e.verbo === verbo).map((e) => e[lado]));
  const feats = de("feat");
  // Lo que una librería declara como suyo (`codigo`) tampoco está suelto.
  const codigos = [...[...(c.codigo?.fichas.values() ?? [])].flatMap((f) => f.codigo), ...de("lib").flatMap((n) => (n.atributos["codigo"] as string[] | undefined) ?? [])];
  const endpoints = de("endpoint"), tablas = de("tabla"), pantallas = de("pantalla");
  const archivos = de("archivo").filter((n) => !ES_TEST.test(n.id.slice(n.id.indexOf(":") + 1)));
  const viveEn = conArista("vive_en", "desde"), implementa = conArista("implementa", "desde"), implementada = conArista("implementa", "hasta");
  const tocan = new Set(g.edges.filter((e) => e.verbo === "lee_de" || e.verbo === "escribe_en").map((e) => e.hasta));
  const drafts = await borradores(raiz);
  const huecos = [
    hueco(L("endpoints without a response type", "endpoints sin tipo de respuesta"), endpoints.filter((n) => n.atributos["response"] == null).map((n) => n.id), endpoints.length),
    hueco(L("endpoints without a feature", "endpoints sin funcionalidad"), endpoints.filter((n) => !implementa.has(n.id)).map((n) => n.id), endpoints.length),
    hueco(L("screens without a feature", "pantallas sin funcionalidad"), pantallas.filter((n) => !implementa.has(n.id)).map((n) => n.id), pantallas.length),
    hueco(L("tables without a database (vive_en)", "tablas sin base de datos (vive_en)"), tablas.filter((n) => !viveEn.has(n.id)).map((n) => n.id), tablas.length),
    hueco(L("tables nobody reads or writes", "tablas que nadie lee ni escribe"), tablas.filter((n) => !tocan.has(n.id)).map((n) => n.id), tablas.length),
    hueco(L("features without code that implements them", "funcionalidades sin código que las implemente"), feats.filter((n) => !implementada.has(n.id)).map((n) => n.id), feats.length),
    hueco(L("files outside every feature or library", "archivos fuera de toda funcionalidad o librería"), feats.length ? archivos.filter((n) => !codigos.some((k) => dentroDe(n.id, k))).map((n) => n.id) : [], archivos.length),
    hueco(L("doubtful relations", "relaciones dudosas"), g.edges.filter((e) => e.estado === "dudoso").map((e) => `${e.desde} ${e.verbo} ${e.hasta}`), g.edges.length),
    hueco(L("drafts not promoted", "borradores sin promover"), drafts, drafts.length),
    hueco(L("nodes with unreviewed notes", "nodos con notas sin revisar"), [...c.notas.keys()].sort(cmp), c.notas.size),
  ].filter((h) => h.cuantos > 0);
  return { repos, nodos: contar(g.nodes.map((n) => n.tipo)), aristas: contar(g.edges.map((e) => e.verbo)), huecos, desactualizado: repos.some((r) => r.estado === "desactualizado") };
}

const corto = (c: string | null) => (c ? c.slice(0, 12) : "—");

/** El estado de un repo en el idioma de la persona (el valor guardado sigue en castellano). */
export const textoDeEstadoRepo = (e: RepoIndexado["estado"]): string =>
  e === "al día" ? L("up to date", "al día") : e === "desactualizado" ? L("outdated", "desactualizado") : e === "sin clon" ? L("no clone", "sin clon") : L("no commit", "sin commit");

export function textoEstado(e: Estado): string {
  const total = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const lista = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ");
  return [
    L("Indexed repos:", "Repos indexados:"),
    ...(e.repos.length ? e.repos.map((r) => L(`  ${r.repo}: ${textoDeEstadoRepo(r.estado)} (indexed ${corto(r.indexado)}, clone ${corto(r.actual)})`, `  ${r.repo}: ${r.estado} (indexado ${corto(r.indexado)}, clon ${corto(r.actual)})`)) : [L("  none (run flowbrain index <repo-path>)", "  ninguno (corré flowbrain index <ruta-repo>)")]),
    L(`Nodes: ${total(e.nodos)} (${lista(e.nodos)})`, `Nodos: ${total(e.nodos)} (${lista(e.nodos)})`),
    L(`Relations: ${total(e.aristas)} (${lista(e.aristas)})`, `Relaciones: ${total(e.aristas)} (${lista(e.aristas)})`),
    ...(e.huecos.length ? [L("Gaps:", "Huecos:"), ...e.huecos.map((h) => `  ${h.que}: ${h.cuantos}${h.de !== h.cuantos ? L(` of ${h.de}`, ` de ${h.de}`) : ""} — ${h.ejemplos.join(", ")}${h.cuantos > h.ejemplos.length ? ", …" : ""}`)] : [L("Gaps: none", "Huecos: ninguno")]),
  ].join("\n") + "\n";
}

export interface Chequeo {
  que: string;
  ok: boolean;
  detalle: string;
}

/** Diagnóstico de la instalación. Solo lee: no modifica ninguna configuración. */
export async function doctor(raiz: string, opciones: { carpetas?: string[]; settings?: string; mcpConfig?: string[] } = {}): Promise<Chequeo[]> {
  const out: Chequeo[] = [];
  let ctx: Contexto | null = null;
  try {
    ctx = await cargarContexto(raiz);
    out.push({ que: L("the graph loads", "el grafo carga"), ok: true, detalle: L(`${ctx.graph.nodes.length} nodes, ${ctx.graph.edges.length} relations`, `${ctx.graph.nodes.length} nodos, ${ctx.graph.edges.length} relaciones`) });
  } catch (e) {
    out.push({ que: L("the graph loads", "el grafo carga"), ok: false, detalle: L(`${(e as Error).message}; run flowbrain compile`, `${(e as Error).message}; corré flowbrain compile`) });
  }
  out.push({ que: L("there is a code index", "hay índice de código"), ok: !!ctx?.codigo, detalle: ctx?.codigo ? L(`${ctx.codigo.estructura.size} files`, `${ctx.codigo.estructura.size} archivos`) : L("run flowbrain index <repo-path> and flowbrain compile", "corré flowbrain index <ruta-repo> y flowbrain compile") });
  const repos = await reposIndexados(raiz, opciones.carpetas);
  for (const r of repos) out.push({ que: L(`clone of ${r.repo}`, `clon de ${r.repo}`), ok: r.estado === "al día", detalle: r.estado === "sin clon" ? L("not found; pass --repos <clones folder>", "no se encontró; pasá --repos <carpeta de clones>") : r.estado === "desactualizado" ? L("the clone moved ahead; run flowbrain sync", "el clon avanzó; corré flowbrain sync") : textoDeEstadoRepo(r.estado) });

  const leerJson = async (p: string) => {
    try {
      return JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const settings = opciones.settings ?? join(homedir(), ".claude/settings.json");
  const s = await leerJson(settings);
  const comandos = Object.values((s?.["hooks"] ?? {}) as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>).flatMap((es) => es.flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? "")));
  const hook = comandos.find((c) => / hook claude-code( |$)/.test(c));
  out.push({ que: L("Claude Code hooks", "hooks de Claude Code"), ok: !!hook, detalle: hook ? L(`registered in ${settings}`, `registrados en ${settings}`) : L(`not in ${settings}; flowbrain init --claude-code registers them`, `no están en ${settings}; flowbrain init --claude-code los registra`) });
  const mcp = await mcpRegistrado(opciones.mcpConfig);
  out.push({ que: L("MCP server", "servidor MCP"), ok: !!mcp, detalle: mcp ? L(`registered in ${mcp}`, `registrado en ${mcp}`) : L("not registered; flowbrain init prints the claude mcp add line", "no está registrado; flowbrain init imprime la línea de claude mcp add") });
  return out;
}

/** Dónde está registrado el servidor MCP de FlowBrain (`~/.claude.json` o `.mcp.json`), o null si no lo está. */
export async function mcpRegistrado(configs: string[] = [join(homedir(), ".claude.json"), join(process.cwd(), ".mcp.json")]): Promise<string | null> {
  const leerJson = async (p: string): Promise<Record<string, unknown> | null> => {
    try {
      return JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  for (const p of configs) {
    const j = await leerJson(p);
    const propios = (j?.["mcpServers"] ?? {}) as Record<string, { args?: string[]; command?: string }>;
    const deProyectos = Object.values((j?.["projects"] ?? {}) as Record<string, { mcpServers?: typeof propios }>).map((x) => x.mcpServers ?? {});
    // El servidor de FlowBrain: registrado con ese nombre (o `brain`, el anterior), o cualquier entrada cuyo comando sea `flowbrain … serve`.
    const esBrain = ([nombre, v]: [string, { args?: string[]; command?: string }]) => nombre === "flowbrain" || nombre === "brain" || /brain\b.*\bserve\b/.test([v.command ?? "", ...(v.args ?? [])].join(" "));
    if ([propios, ...deProyectos].some((m) => Object.entries(m).some(esBrain))) return p;
  }
  return null;
}

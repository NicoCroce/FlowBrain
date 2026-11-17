import { compileDirConVisor } from "@flowbrain/viewer";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { cargarContexto, cmp, commitDe, dentroDe, ES_TEST, type Contexto } from "@flowbrain/core";
import { escribirIndex, indexar } from "@flowbrain/parsers";

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
export async function sync(raiz: string, opciones: { carpetas?: string[]; forzar?: boolean } = {}): Promise<ResultadoSync> {
  const repos = await reposIndexados(raiz, opciones.carpetas);
  const out: ResultadoSync["repos"] = [];
  let cambios = false;
  for (const r of repos) {
    // Sin commit no se puede saber si cambió: se reindexa siempre que haya clon.
    const toca = r.clon !== null && (opciones.forzar === true || r.estado === "desactualizado" || r.estado === "sin commit");
    if (toca) {
      const escritos = await escribirIndex(raiz, await indexar(r.clon!, raiz, { repo: r.repo }));
      if (escritos.length) cambios = true;
    }
    out.push({ ...r, reindexado: toca });
  }
  const compilados = cambios || opciones.forzar ? (await compileDirConVisor(raiz)).escritos : null;
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
    hueco("endpoints sin tipo de respuesta", endpoints.filter((n) => n.atributos["response"] == null).map((n) => n.id), endpoints.length),
    hueco("endpoints sin funcionalidad", endpoints.filter((n) => !implementa.has(n.id)).map((n) => n.id), endpoints.length),
    hueco("pantallas sin funcionalidad", pantallas.filter((n) => !implementa.has(n.id)).map((n) => n.id), pantallas.length),
    hueco("tablas sin base de datos (vive_en)", tablas.filter((n) => !viveEn.has(n.id)).map((n) => n.id), tablas.length),
    hueco("tablas que nadie lee ni escribe", tablas.filter((n) => !tocan.has(n.id)).map((n) => n.id), tablas.length),
    hueco("funcionalidades sin código que las implemente", feats.filter((n) => !implementada.has(n.id)).map((n) => n.id), feats.length),
    hueco("archivos fuera de toda funcionalidad o librería", feats.length ? archivos.filter((n) => !codigos.some((k) => dentroDe(n.id, k))).map((n) => n.id) : [], archivos.length),
    hueco("relaciones dudosas", g.edges.filter((e) => e.estado === "dudoso").map((e) => `${e.desde} ${e.verbo} ${e.hasta}`), g.edges.length),
    hueco("borradores sin promover", drafts, drafts.length),
    hueco("nodos con notas sin revisar", [...c.notas.keys()].sort(cmp), c.notas.size),
  ].filter((h) => h.cuantos > 0);
  return { repos, nodos: contar(g.nodes.map((n) => n.tipo)), aristas: contar(g.edges.map((e) => e.verbo)), huecos, desactualizado: repos.some((r) => r.estado === "desactualizado") };
}

const corto = (c: string | null) => (c ? c.slice(0, 12) : "—");

export function textoEstado(e: Estado): string {
  const total = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const lista = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ");
  return [
    "Repos indexados:",
    ...(e.repos.length ? e.repos.map((r) => `  ${r.repo}: ${r.estado} (indexado ${corto(r.indexado)}, clon ${corto(r.actual)})`) : ["  ninguno (corré flowbrain index <ruta-repo>)"]),
    `Nodos: ${total(e.nodos)} (${lista(e.nodos)})`,
    `Relaciones: ${total(e.aristas)} (${lista(e.aristas)})`,
    ...(e.huecos.length ? ["Huecos:", ...e.huecos.map((h) => `  ${h.que}: ${h.cuantos}${h.de !== h.cuantos ? ` de ${h.de}` : ""} — ${h.ejemplos.join(", ")}${h.cuantos > h.ejemplos.length ? ", …" : ""}`)] : ["Huecos: ninguno"]),
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
    out.push({ que: "el grafo carga", ok: true, detalle: `${ctx.graph.nodes.length} nodos, ${ctx.graph.edges.length} relaciones` });
  } catch (e) {
    out.push({ que: "el grafo carga", ok: false, detalle: `${(e as Error).message}; corré flowbrain compile` });
  }
  out.push({ que: "hay índice de código", ok: !!ctx?.codigo, detalle: ctx?.codigo ? `${ctx.codigo.estructura.size} archivos` : "corré flowbrain index <ruta-repo> y flowbrain compile" });
  const repos = await reposIndexados(raiz, opciones.carpetas);
  for (const r of repos) out.push({ que: `clon de ${r.repo}`, ok: r.estado === "al día", detalle: r.estado === "sin clon" ? "no se encontró; pasá --repos <carpeta de clones>" : r.estado === "desactualizado" ? "el clon avanzó; corré flowbrain sync" : r.estado });

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
  out.push({ que: "hooks de Claude Code", ok: !!hook, detalle: hook ? `registrados en ${settings}` : `no están en ${settings}; flowbrain init --claude-code los registra` });
  const configs = opciones.mcpConfig ?? [join(homedir(), ".claude.json"), join(process.cwd(), ".mcp.json")];
  let mcp: string | null = null;
  for (const p of configs) {
    const j = await leerJson(p);
    const propios = (j?.["mcpServers"] ?? {}) as Record<string, { args?: string[]; command?: string }>;
    const deProyectos = Object.values((j?.["projects"] ?? {}) as Record<string, { mcpServers?: typeof propios }>).map((x) => x.mcpServers ?? {});
    // El servidor de FlowBrain: registrado con ese nombre (o `brain`, el anterior), o cualquier entrada cuyo comando sea `flowbrain … serve`.
    const esBrain = ([nombre, v]: [string, { args?: string[]; command?: string }]) => nombre === "flowbrain" || nombre === "brain" || /brain\b.*\bserve\b/.test([v.command ?? "", ...(v.args ?? [])].join(" "));
    if ([propios, ...deProyectos].some((m) => Object.entries(m).some(esBrain))) { mcp = p; break; }
  }
  out.push({ que: "servidor MCP", ok: !!mcp, detalle: mcp ? `registrado en ${mcp}` : "no está registrado; flowbrain init imprime la línea de claude mcp add" });
  return out;
}

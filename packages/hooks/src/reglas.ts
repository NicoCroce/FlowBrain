import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cmp, repoPorDirectorio, type Contexto, type GraphNode } from "@flowbrain/core";

/**
 * Generadores de reglas (`flowbrain gen claude|agents|cursor|windsurf`): el bloque que le dice al agente que existe el
 * brain, qué nodo es este repo y cómo consultarlo. Determinísticos: dependen solo del grafo y del repo.
 */

export const PREFIJO_NOTA = "flowbrain-nota";
export const MARCA_REGLAS_INICIO = "<!-- flowbrain:reglas:inicio -->";
export const MARCA_REGLAS_FIN = "<!-- flowbrain:reglas:fin -->";

export const DESTINOS = ["claude", "agents", "cursor", "windsurf"] as const;
export type Destino = (typeof DESTINOS)[number];

/** Verbos que cuentan como dependencia (el superverbo `depende_de` del SCHEMA). */
/** Nodos de las relaciones finas: en el resumen de un servicio solo cuentan piezas técnicas con página. */
const FINOS = new Set(["endpoint", "pantalla", "feat"]);
const DEPENDENCIA = new Set(["depende_de", "llama_a", "publica_en", "consume_de", "lee_de", "escribe_en"]);
const MAX_LISTA = 8;

const lista = (ids: string[]) => {
  const u = [...new Set(ids)].sort(cmp);
  if (u.length === 0) return "—";
  const ver = u.slice(0, MAX_LISTA).map((x) => `\`${x}\``).join(", ");
  return u.length > MAX_LISTA ? `${ver} (+${u.length - MAX_LISTA} more)` : ver;
};

/** Sección "este repo en el brain": servicios que viven acá, de qué dependen y quién los usa. */
function seccionRepo(ctx: Contexto, repo: GraphNode): string[] {
  const svcs = (ctx.entrantes.get(repo.id) ?? []).filter((e) => e.verbo === "vive_en").map((e) => ctx.nodo.get(e.desde)!).filter(Boolean);
  svcs.sort((a, b) => cmp(a.id, b.id));
  const lineas = [`This repo is \`${repo.id}\` (${repo.nombre}) in the brain.${repo.resumen ? ` ${repo.resumen}` : ""}`];
  if (svcs.length > 0) {
    lineas.push("", "What lives here:");
    for (const s of svcs) {
      const usa = (ctx.salientes.get(s.id) ?? []).filter((e) => DEPENDENCIA.has(e.verbo) && e.hasta !== s.id).map((e) => e.hasta);
      const usan = (ctx.entrantes.get(s.id) ?? []).filter((e) => DEPENDENCIA.has(e.verbo) && e.desde !== s.id && !FINOS.has(ctx.nodo.get(e.desde)?.tipo ?? "")).map((e) => e.desde);
      lineas.push(`- \`${s.id}\`${s.resumen ? ` — ${s.resumen}` : ""} Depends on: ${lista(usa)}. Used by: ${lista(usan)}.`);
    }
  }
  return lineas;
}

/** Bloque Markdown de reglas. Con `ctx` y `repo`, incluye el nodo del repo y sus servicios. */
export function bloqueReglas(ctx?: Contexto | null, repo?: GraphNode | null): string {
  return [
    "## FlowBrain",
    "",
    ...(ctx && repo ? [...seccionRepo(ctx, repo), ""] : []),
    "Before exploring the code with grep, query the knowledge graph over MCP (server `brain`):",
    "- `buscar_nodo` to locate services, repos, tables or features by name, and classes or methods in the code (with file and line).",
    "- `recorrer_grafo` with `verbos: [\"depende_de\"], direccion: \"in\"` to know what breaks if you change something.",
    "- `contrato_de` to see what an endpoint returns.",
    "- `trazar` to follow a flow from an HTTP route or a file.",
    "- `recorrido` to see what an endpoint, a method or a front hook runs (front → endpoint → controller → service → repository → table), with file and line; `via` marks hops over HTTP, events or queues.",
    "- `pantalla` for a front screen (`/login`, `LoginScreen`): where you reach it from, where it leads, which guards wrap it and what it calls in the back, end to end.",
    "- `quien_llama` before changing a method: who calls it (also through events, queues and HTTP from other repos) and which endpoints and features it reaches.",
    "- `impacto` to know which features are affected if a table, an endpoint or a service changes.",
    "- `riesgo` with a diff or the files you are going to touch, before a large change: what it reaches and whom to tell.",
    "- `deriva` to see calls no endpoint serves and endpoints nobody calls; `paridad` to know what is left to migrate from one service to another.",
    "- `infra` to know how a service is built, deployed and configured: image, pipelines, environment variables, proxy, Kubernetes, Helm, Terraform and serverless.",
    "- `fidelidad` to know how reliable what the graph says about a file or a feature is (0 to 100) and what it is missing.",
    "- `funcionalidad` for the card of a product feature: endpoints, consumers, data and relations.",
    "The `avisos` in each response are known gaps (missing data, not \"nothing happens\"): unresolved calls or an outdated index; that is where it pays to look at the code. `indice` says which commit it came from.",
    "Without MCP, the same commands through the CLI: `flowbrain search <text>`, `flowbrain traverse <node>`, `flowbrain contract <node>`, `flowbrain trace --from <path>`, `flowbrain flow <endpoint|Class.method>`, `flowbrain screen </route>`, `flowbrain callers <Class.method>`, `flowbrain impact <piece>`, `flowbrain feature <id>`.",
    "Every edge carries evidence (`repo:path#Lnn`); open that file before claiming anything.",
    `If the code contradicts the brain, write a line \`${PREFIJO_NOTA} <node-id>: <what changed>\` in your answer. When the session ends the hook saves it in \`_drafts/notes/\` for review.`,
    "",
    "While you develop:",
    "- The graph only sees committed code: the index follows each clone's commit (`flowbrain serve --sync` reindexes when it moves; otherwise `flowbrain sync`). For files you created or changed and have not committed, read the code, not the graph.",
    "- Before changing a method, an endpoint or a table, ask `quien_llama` or `impacto`; it may be used from another repo over HTTP, events or queues.",
    "- When you add a feature or new files, once they are committed check `sin_asociar` (`flowbrain unassigned`) and say which feature each new file belongs to. For a new feature, propose its page as a draft in `.flowbrain/<brain>/_drafts/product/feat-<id>.md` (or with the `/flowbrain-features` guide), with its use cases and specifications in the same draft (`casos` and `especificaciones`, following `flowbrain specs --guide` or `/flowbrain-specs`). Never edit `product/` or `technology/` directly: the user reviews drafts and moves them with `flowbrain promote`.",
    "- When you change what an existing feature does, update its specifications with `/flowbrain-specs` (`flowbrain specs --guide`) limited to that feature: new rules go in as unconfirmed proposals, and a `confirmada` one that the code now contradicts is reported, not changed.",
    "",
  ].join("\n");
}

export interface Reglas {
  destino: Destino;
  /** Ruta relativa a la raíz del repo. */
  ruta: string;
  /** `bloque`: se inserta entre marcadores en un archivo compartido; `archivo`: el archivo es de brain. */
  modo: "bloque" | "archivo";
  contenido: string;
  repo: string | null;
}

/** Resuelve el nodo del repo por id o por nombre de directorio. */
export function repoDe(ctx: Contexto, idONombre: string | null): GraphNode | null {
  if (!idONombre) return null;
  const n = ctx.nodo.get(idONombre);
  if (n?.tipo === "repo") return n;
  return repoPorDirectorio(ctx, idONombre);
}

export function generarReglas(destino: Destino, ctx: Contexto | null, repo: GraphNode | null): Reglas {
  const bloque = bloqueReglas(ctx, repo);
  const envuelto = `${MARCA_REGLAS_INICIO}\n${bloque}${MARCA_REGLAS_FIN}\n`;
  const r = { destino, repo: repo?.id ?? null };
  switch (destino) {
    case "claude":
      return { ...r, ruta: "CLAUDE.md", modo: "bloque", contenido: envuelto };
    case "agents":
      return { ...r, ruta: "AGENTS.md", modo: "bloque", contenido: envuelto };
    case "cursor":
      return {
        ...r,
        ruta: ".cursor/rules/flowbrain.mdc",
        modo: "archivo",
        contenido: `---\ndescription: FlowBrain knowledge graph: services, contracts and dependencies of this repo\nalwaysApply: true\n---\n\n${bloque}`,
      };
    case "windsurf":
      return { ...r, ruta: ".windsurf/rules/flowbrain.md", modo: "archivo", contenido: `---\ntrigger: always_on\n---\n\n${bloque}` };
  }
}

/** Inserta o reemplaza el bloque entre marcadores; si no hay marcadores, lo agrega al final. */
export function fusionarBloque(previo: string | null, envuelto: string): string {
  if (previo === null || previo.trim() === "") return envuelto;
  // Bloques escritos antes del cambio de nombre (marcadores `brain:reglas`): se reemplazan igual, sin duplicar.
  previo = previo.replace("<!-- brain:reglas:inicio -->", MARCA_REGLAS_INICIO).replace("<!-- brain:reglas:fin -->", MARCA_REGLAS_FIN);
  const i = previo.indexOf(MARCA_REGLAS_INICIO);
  const f = previo.indexOf(MARCA_REGLAS_FIN);
  if (i >= 0 && f > i) {
    const resto = previo.slice(f + MARCA_REGLAS_FIN.length).replace(/^\n/, "");
    return previo.slice(0, i) + envuelto + resto;
  }
  return `${previo.replace(/\n*$/, "\n\n")}${envuelto}`;
}

/** Escribe las reglas en el repo. Devuelve si el archivo cambió. */
export async function escribirReglas(dirRepo: string, r: Reglas): Promise<boolean> {
  const destino = join(dirRepo, r.ruta);
  const previo = await readFile(destino, "utf8").catch(() => null);
  const nuevo = r.modo === "bloque" ? fusionarBloque(previo, r.contenido) : r.contenido;
  if (nuevo === previo) return false;
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, nuevo, "utf8");
  return true;
}

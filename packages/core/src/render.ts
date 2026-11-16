import { cmpTuple, stringifyCanonical } from "./canonical.js";
import { CompileError } from "./frontmatter.js";
import { TIPOS_GENERADOS, TIPOS_PAGINA, type Graph, type GraphEdge, type GraphNode, type Tipo } from "./schema.js";

export const MARCA_INICIO = "<!-- brain:backlinks:inicio -->";
export const MARCA_FIN = "<!-- brain:backlinks:fin -->";

const ORDEN_TIPOS: readonly Tipo[] = [...TIPOS_PAGINA, ...TIPOS_GENERADOS];

function entrantes(graph: Graph): Map<string, GraphEdge[]> {
  const m = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const l = m.get(e.hasta);
    if (l) l.push(e);
    else m.set(e.hasta, [e]);
  }
  for (const l of m.values()) l.sort((a, b) => cmpTuple([a.desde, a.verbo, a.endpoint ?? ""], [b.desde, b.verbo, b.endpoint ?? ""]));
  return m;
}

/** `{ "<id>": [{ desde, endpoint, verbo }] }` para cada nodo con aristas entrantes. */
export function renderBacklinksJson(graph: Graph): string {
  const out: Record<string, Array<{ desde: string; endpoint: string | null; verbo: string }>> = {};
  for (const [hasta, es] of entrantes(graph)) {
    out[hasta] = es.map((e) => ({ desde: e.desde, endpoint: e.endpoint, verbo: e.verbo }));
  }
  return stringifyCanonical(out);
}

function seccionBacklinks(id: string, graph: Graph, porId: Map<string, GraphNode>): string {
  const es = entrantes(graph).get(id) ?? [];
  const lineas = es.map((e) => {
    const ep = e.endpoint ? ` · ${porId.get(e.endpoint)?.nombre ?? e.endpoint}` : "";
    const estado = e.estado !== "vigente" ? ` · ${e.estado}` : "";
    return `- [[${e.desde}]] · ${e.verbo}${ep}${estado}`;
  });
  return [MARCA_INICIO, "## Backlinks", "", ...(lineas.length ? lineas : ["_Sin backlinks._"]), MARCA_FIN].join("\n");
}

/** Inserta o reemplaza la sección de backlinks. Idempotente. */
export function aplicarBacklinks(cuerpo: string, id: string, graph: Graph, archivo: string): string {
  const porId = new Map(graph.nodes.map((n) => [n.id, n]));
  const bloque = seccionBacklinks(id, graph, porId);
  const i = cuerpo.indexOf(MARCA_INICIO);
  const f = cuerpo.indexOf(MARCA_FIN);
  if (i === -1 && f === -1) return `${cuerpo.replace(/\s+$/, "")}\n\n${bloque}\n`;
  if (i === -1 || f === -1 || f < i || cuerpo.indexOf(MARCA_INICIO, i + 1) !== -1) {
    throw new CompileError([{ archivo, linea: null, mensaje: "marcadores de backlinks incompletos o repetidos" }]);
  }
  return cuerpo.slice(0, i) + bloque + cuerpo.slice(f + MARCA_FIN.length);
}

/** Índice para lectura jerárquica: nodos de página y endpoints, agrupados por tipo. */
export function renderIndex(graph: Graph): string {
  const lineas = ["# INDEX", "", "<!-- generado por brain compile; no editar -->"];
  for (const tipo of ORDEN_TIPOS) {
    if (tipo === "archivo" || tipo === "contrato") continue;
    const ns = graph.nodes.filter((n) => n.tipo === tipo);
    if (ns.length === 0) continue;
    lineas.push("", `## ${tipo}`, "");
    for (const n of ns) {
      const resumen = n.resumen ? ` — ${n.resumen}` : "";
      const estado = n.estado !== "vigente" ? ` [${n.estado}]` : "";
      const pagina = n.pagina ? ` → ${n.pagina}` : "";
      lineas.push(`- \`${n.id}\` · ${n.nombre}${estado}${resumen}${pagina}`);
    }
  }
  return lineas.join("\n") + "\n";
}

const mid = (id: string) => id.replace(/[^A-Za-z0-9]/g, "_");
const etiqueta = (s: string) => `"${s.replace(/"/g, "#quot;")}"`;

function forma(n: GraphNode): string {
  const t = etiqueta(n.nombre);
  switch (n.tipo) {
    case "db":
    case "tabla":
      return `[(${t})]`;
    case "queue":
      return `[[${t}]]`;
    case "ext":
      return `{{${t}}}`;
    case "feat":
      return `([${t}])`;
    default:
      return `[${t}]`;
  }
}

/** Mapa Mermaid de los nodos de página y las aristas entre ellos. */
export function renderMermaid(graph: Graph): string {
  const porId = new Map(graph.nodes.map((n) => [n.id, n]));
  const paginas = graph.nodes.filter((n) => n.pagina !== null);
  const ids = new Set(paginas.map((n) => n.id));
  const lineas = ["flowchart LR"];
  for (const n of paginas) lineas.push(`  ${mid(n.id)}${forma(n)}`);
  for (const e of graph.edges) {
    if (!ids.has(e.desde) || !ids.has(e.hasta)) continue;
    const ep = e.endpoint ? ` ${porId.get(e.endpoint)?.nombre ?? e.endpoint}` : "";
    const flecha = e.estado === "vigente" ? "-->" : "-.->";
    lineas.push(`  ${mid(e.desde)} ${flecha}|${etiqueta(e.verbo + ep)}| ${mid(e.hasta)}`);
  }
  return lineas.join("\n") + "\n";
}

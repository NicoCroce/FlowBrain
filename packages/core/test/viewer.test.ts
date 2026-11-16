import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderViewer, reposDelGrafo, type Graph } from "../src/index.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const graph = async () => JSON.parse(await readFile(join(RAIZ, "fixtures/checkout/expected/graph.json"), "utf8")) as Graph;
const cy = () => readFile(createRequire(import.meta.url).resolve("cytoscape/dist/cytoscape.min.js"), "utf8");

const datos = (html: string) => JSON.parse(/<script type="application\/json" id="datos">([\s\S]*?)<\/script>/.exec(html)![1]!.replace(/<\\\//g, "</").replace(/<\\!--/g, "<!--")) as { nodes: Array<{ id: string; n: string }>; edges: unknown[]; tiposIniciales: string[] };

describe("viewer.html", () => {
  it("es determinístico, autocontenido y trae el grafo entero", async () => {
    const [g, lib] = [await graph(), await cy()];
    const a = renderViewer(g, lib);
    expect(renderViewer(g, lib)).toBe(a);
    expect(a).toContain(lib.slice(0, 200));
    // Fuera de la librería embebida, ninguna referencia a la red.
    expect(renderViewer(g, "/* lib */")).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\//);
    const d = datos(a);
    expect(d.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id));
    expect(d.edges).toHaveLength(g.edges.length);
    expect(d.tiposIniciales).not.toContain("archivo");
  });

  it("escapa nombres que podrían cerrar el script", async () => {
    const g = await graph();
    const malo = { ...g, nodes: g.nodes.map((n, i) => (i === 0 ? { ...n, nombre: "</script><script>alert(1)</script><!--" } : n)) };
    const html = renderViewer(malo, "/* lib */");
    expect(html.match(/<\/script>/g)).toHaveLength(5);
    expect(datos(html).nodes[0]!.n).toBe("</script><script>alert(1)</script><!--");
  });

  it("agrupa servicios por repo: caja con varios, plegado con uno", async () => {
    const g = await graph();
    const tienda = reposDelGrafo(g)["repo-tienda"]!;
    expect(tienda.contenedor).toBe(true);
    expect(tienda.svcs.length).toBe(3);
    expect([...tienda.svcs].sort()).toEqual(tienda.svcs);

    const nodo = (id: string, tipo: string) => ({ ...g.nodes[0]!, id, nombre: id, tipo, pagina: null }) as Graph["nodes"][number];
    const arista = (desde: string, verbo: string, hasta: string) => ({ ...g.edges[0]!, desde, verbo, hasta, endpoint: null, evidencia: null }) as Graph["edges"][number];
    const chico: Graph = {
      ...g,
      nodes: [nodo("repo-web", "repo"), nodo("svc-web", "svc"), nodo("archivo-a", "archivo"), nodo("archivo-b", "archivo")],
      edges: [arista("svc-web", "vive_en", "repo-web"), arista("repo-web", "contiene", "archivo-a"), arista("repo-web", "contiene", "archivo-b")],
    };
    expect(reposDelGrafo(chico)).toEqual({ "repo-web": { svcs: ["svc-web"], archivos: 2, contenedor: false } });
    expect(datos(renderViewer(chico, "/* lib */")).tiposIniciales).not.toContain("repo");
  });
});

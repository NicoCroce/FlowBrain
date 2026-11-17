import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderViewer, type Graph } from "../src/index.js";

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
    expect(html.match(/<\/script>/g)).toHaveLength(6);
    expect(datos(html).nodes[0]!.n).toBe("</script><script>alert(1)</script><!--");
  });
});

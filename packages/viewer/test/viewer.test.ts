import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Graph } from "@flowbrain/core";
import { renderViewer } from "../src/index.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const graph = async () => JSON.parse(await readFile(join(RAIZ, "fixtures/checkout/expected/graph.json"), "utf8")) as Graph;

const datos = (html: string) => JSON.parse(/<script type="application\/json" id="datos">([\s\S]*?)<\/script>/.exec(html)![1]!.replace(/<\\\//g, "</").replace(/<\\!--/g, "<!--")) as { nodes: Array<{ id: string; n: string }>; edges: unknown[]; tiposIniciales: string[] };

describe("viewer.html", () => {
  it("es determinístico, autocontenido y trae el grafo entero", async () => {
    const g = await graph();
    const a = renderViewer(g);
    expect(renderViewer(g)).toBe(a);
    // Ninguna referencia a la red: todo va embebido.
    expect(renderViewer(g)).not.toMatch(/<script[^>]+src=|<link[^>]+href="(?!data:)|https?:\/\//);
    const d = datos(a);
    expect(d.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id));
    expect(d.edges).toHaveLength(g.edges.length);
    expect(d.tiposIniciales).not.toContain("archivo");
  });

  it("el pedido al agente es uno solo para todo el visor: bandeja en la barra superior, un panel, y antes que las pantallas", async () => {
    const html = renderViewer(await graph());
    const cabecera = html.slice(html.indexOf('<header id="cabecera">'), html.indexOf("</header>"));
    expect(cabecera).toContain('<span id="pedido-bandeja" class="pedido-bandeja"></span>');
    expect(html.match(/<aside id="pedido-panel"/g)).toHaveLength(1);
    // Un solo botón «Agente» (dec. 236): Borradores no tiene pestaña ni cuenta propia en la navegación (su pantalla sigue).
    expect(cabecera).not.toContain('href="#/borradores"');
    expect(html).not.toContain('id="nav-borradores"');
    expect(html).toContain('<div id="borradores" class="pagina oculto"></div>');
    // Ninguna pantalla trae su propio panel.
    expect(html).not.toMatch(/id="(es|sa)-panel"|id="(es|sa)-bandeja"/);
    const pedido = html.indexOf("window.brainPedido = {");
    expect(pedido).toBeGreaterThan(0);
    for (const p of ["window.brainEspecificaciones = {", "window.brainSinAsociar = {"]) expect(html.indexOf(p)).toBeGreaterThan(pedido);
  });

  it("escapa nombres que podrían cerrar el script", async () => {
    const g = await graph();
    const malo = { ...g, nodes: g.nodes.map((n, i) => (i === 0 ? { ...n, nombre: "</script><script>alert(1)</script><!--" } : n)) };
    const html = renderViewer(malo);
    expect(html.match(/<\/script>/g)).toHaveLength(13);
    expect(datos(html).nodes[0]!.n).toBe("</script><script>alert(1)</script><!--");
  });
});

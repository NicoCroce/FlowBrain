import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Graph } from "@flowbrain/core";
import { redDeFlujo, trazabilidad } from "@flowbrain/core";
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
    // Ninguna pantalla trae su propio panel.
    expect(html).not.toMatch(/id="(es|sa)-panel"|id="(es|sa)-bandeja"/);
    const pedido = html.indexOf("window.brainPedido = {");
    expect(pedido).toBeGreaterThan(0);
    for (const p of ["window.brainEspecificaciones = {", "window.brainSinAsociar = {"]) expect(html.indexOf(p)).toBeGreaterThan(pedido);
  });

  it("el Mapa 3D trae la trazabilidad completa del core, y con los datos de la página arma la cadena de un endpoint", async () => {
    const html = renderViewer(await graph());
    expect(html).toContain("function redDeFlujo(d)");
    expect(html).toContain("function trazabilidad(red, origen, tope)");
    expect(html).toContain("Mostrar trazabilidad completa");
    expect(html).toContain("Salir de la trazabilidad");
    // Lo mismo que hace el visor con sus datos: la red sale de nodes, edges y fichas tal como los embebe la página.
    const d = datos(html) as unknown as { nodes: Array<{ id: string; t: string; n: string }>; edges: Array<{ s: string; h: string; v: string; ev: string; p: string | null }> };
    const red = redDeFlujo({ nodos: d.nodes.map((n) => ({ id: n.id, tipo: n.t, c: 0, nombre: n.n })), aristas: d.edges });
    const ep = d.nodes.find((n) => n.t === "endpoint" && d.edges.some((e) => e.s === n.id && (e.v === "lee_de" || e.v === "escribe_en")))!;
    const t = trazabilidad(red, ep.id)!;
    expect(t.nodos.some((n) => n.tipo === "tabla" && n.lado === "abajo")).toBe(true);
    expect(t.aristas.every((a) => !a.cruza)).toBe(true);
  });

  it("escapa nombres que podrían cerrar el script", async () => {
    const g = await graph();
    const malo = { ...g, nodes: g.nodes.map((n, i) => (i === 0 ? { ...n, nombre: "</script><script>alert(1)</script><!--" } : n)) };
    const html = renderViewer(malo);
    expect(html.match(/<\/script>/g)).toHaveLength(13);
    expect(datos(html).nodes[0]!.n).toBe("</script><script>alert(1)</script><!--");
  });
});

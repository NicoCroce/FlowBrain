import { describe, expect, it } from "vitest";
import type { Cruce, Graph, GraphEdge, GraphNode } from "@flowbrain/core";
import { datosDeCerebros, GRAFO3D_JS, renderViewerCerebros } from "../src/index.js";

const nodo = (id: string, tipo: GraphNode["tipo"], atributos: Record<string, unknown> = {}): GraphNode => ({ actualizado: null, aliases: [], atributos, estado: "vigente", id, nombre: id, origen: "parser", pagina: null, resumen: null, tecnologia: [], tipo, verificado: null });
const arista = (desde: string, verbo: GraphEdge["verbo"], hasta: string): GraphEdge => ({ confianza: 0.9, dato: null, desde, endpoint: null, estado: "vigente", evidencia: null, hasta, origen: "parser", verbo });
const front: Graph = { version: 1, nodes: [nodo("repo-tienda", "repo"), nodo("svc-web", "svc"), nodo("svc-web:/pedidos", "pantalla", { ruta: "/pedidos" })], edges: [arista("svc-web", "vive_en", "repo-tienda")] };
const back: Graph = {
  version: 1,
  // Mismo id de repo que en el otro cerebro, a propósito.
  nodes: [nodo("repo-tienda", "repo"), nodo("svc-api", "svc"), nodo("svc-api:GET:/pedidos", "endpoint", { metodo: "GET", ruta: "/pedidos" })],
  edges: [arista("svc-api", "vive_en", "repo-tienda"), arista("svc-api", "contiene", "svc-api:GET:/pedidos")],
};
const cruces: Cruce[] = [
  { desde: { cerebro: "front", svc: "svc-web", evidencia: "repo-tienda:src/api.ts#L3", pantallas: [] }, hacia: { cerebro: "back", endpoint: "svc-api:GET:/pedidos" }, declarada: false },
  { desde: { cerebro: "front", svc: "svc-web", evidencia: "repo-tienda:src/api.ts#L9", pantallas: [] }, hacia: { cerebro: "back", endpoint: "svc-api:GET:/pedidos" }, declarada: false },
  // Esta sale de un hook que usa una pantalla: la relación es de la pantalla, no del servicio.
  { desde: { cerebro: "front", svc: "svc-web", evidencia: "repo-tienda:src/hooks/usePedidos.ts#L4", pantallas: ["svc-web:/pedidos"] }, hacia: { cerebro: "back", endpoint: "svc-api:GET:/pedidos" }, declarada: false },
];
const cerebros = [
  { nombre: "front", sinRevisar: false, graph: front, funcionalidades: [] },
  { nombre: "back", sinRevisar: true, graph: back, funcionalidades: [] },
];

describe("visor de varios cerebros", () => {
  it("une los cerebros sin mezclar ids repetidos, marca de cuál es cada nodo y agrega lo que cruza", () => {
    const d = datosDeCerebros(cerebros, cruces, []);
    expect(d.cerebros).toEqual([{ nombre: "front", sinRevisar: false, nodos: 3 }, { nombre: "back", sinRevisar: true, nodos: 3 }]);
    expect(d.nodes.map((n) => `${n.c} ${n.id}`)).toEqual(["0 front/repo-tienda", "0 front/svc-web", "0 front/svc-web:/pedidos", "1 back/repo-tienda", "1 back/svc-api", "1 back/svc-api:GET:/pedidos"]);
    // Dos llamadas al mismo endpoint son una relación entre cerebros, con sus veces.
    expect(d.mapa3d.aristas.filter((a) => a[0].startsWith("front/") && a[1].startsWith("back/"))).toEqual([["front/svc-web:/pedidos", "back/svc-api:GET:/pedidos", "llama_a", 1], ["front/svc-web", "back/svc-api:GET:/pedidos", "llama_a", 2]]);
    expect(d.edges.filter((e) => e.s === "front/svc-web" && e.h === "back/svc-api").map((e) => e.p)).toEqual(["back/svc-api:GET:/pedidos"]);
    // Sin cruces (comunicación apagada) no hay relaciones entre cerebros.
    expect(datosDeCerebros(cerebros, [], []).mapa3d.aristas.filter((a) => a[0].startsWith("front/") && a[1].startsWith("back/"))).toEqual([]);
  });

  it("la página embebe los cerebros y los interruptores, y el código del mapa es JavaScript válido", () => {
    const html = renderViewerCerebros(cerebros, cruces, [], "/* lib */");
    expect(html).toContain('"cerebros":[{"nombre":"front"');
    expect(html).toContain('id="m3-cerebros"');
    // El borde del panel de detalle se arrastra para ensancharlo.
    expect(html).toContain('id="m3-asa"');
    expect(html).toContain("var(--der, 300px)");
    for (const pieza of ["data-cerebro=", "data-foco-cerebro=", 'data-tipos="ninguno"', "hiddenBrains", "data-todas=", "data-tab-c=", "moverCerebro", "m3-asa", "COLOR_C"]) expect(GRAFO3D_JS).toContain(pieza);
    expect(() => new Function(GRAFO3D_JS)).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { cerebroLiviano, crucesEntre, resumenConexiones, type Graph, type GraphNode } from "../src/index.js";

const nodo = (id: string, tipo: GraphNode["tipo"], atributos: Record<string, unknown> = {}): GraphNode => ({ actualizado: null, aliases: [], atributos, estado: "vigente", id, nombre: id, origen: "parser", pagina: null, resumen: null, tecnologia: [], tipo, verificado: null });

/**
 * Un front con dos llamadas que su cerebro no pudo unir: una dentro de un hook que usa una pantalla y otra en un
 * script suelto. El back, en otro cerebro, atiende las dos.
 */
const front: Graph = {
  version: 1,
  nodes: [nodo("svc-web", "svc"), nodo("svc-web:/pedidos", "pantalla", { ruta: "/pedidos", componentes: ["repo-web:src/Pedidos.tsx#Pedidos"] })],
  edges: [],
};
const back: Graph = {
  version: 1,
  nodes: [nodo("svc-api", "svc"), nodo("svc-api:GET:/pedidos", "endpoint", { metodo: "GET", ruta: "/pedidos" }), nodo("svc-api:POST:/pedidos", "endpoint", { metodo: "POST", ruta: "/pedidos" })],
  edges: [],
};
const pendiente = (evidencia: string, metodo: string) => ({ verbo: "llama_a", desde: "svc-web", evidencia, llamada: { metodo, ruta: "/pedidos", base: "API_URL" } });
const extraccion = JSON.stringify({ pendientes: [pendiente("repo-web:src/hooks/usePedidos.ts#L3", "GET"), pendiente("repo-web:scripts/carga.ts#L2", "POST")] });
const archivos = JSON.stringify({
  repo: "repo-web",
  archivos: [
    { ruta: "src/Pedidos.tsx", simbolos: [{ nombre: "Pedidos", tipo: "funcion", linea: 2, fin: 6 }], invoca: [{ desde: "Pedidos", archivo: "src/hooks/usePedidos.ts", simbolo: "usePedidos", linea: 3 }] },
    { ruta: "src/hooks/usePedidos.ts", simbolos: [{ nombre: "usePedidos", tipo: "funcion", linea: 1, fin: 5 }] },
    { ruta: "scripts/carga.ts", simbolos: [{ nombre: "cargar", tipo: "funcion", linea: 1, fin: 4 }] },
  ],
});

describe("cruces entre cerebros", () => {
  it("cada llamada dice desde qué pantallas se llega a ella; la que no es de ninguna queda a nombre del servicio", () => {
    const { cruces } = crucesEntre(cerebroLiviano("front", front, [extraccion], [archivos]), cerebroLiviano("back", back, []), []);
    expect(cruces.map((c) => `${c.desde.evidencia} [${c.desde.pantallas.join(",")}] → ${c.hacia.endpoint}`)).toEqual([
      "repo-web:scripts/carga.ts#L2 [] → svc-api:POST:/pedidos",
      "repo-web:src/hooks/usePedidos.ts#L3 [svc-web:/pedidos] → svc-api:GET:/pedidos",
    ]);
    expect(resumenConexiones(cruces, []).map((r) => [r.llamadas, r.endpoints, r.pantallas])).toEqual([[2, 2, 1]]);
  });

  it("sin la estructura de archivos no se inventan pantallas", () => {
    const { cruces } = crucesEntre(cerebroLiviano("front", front, [extraccion]), cerebroLiviano("back", back, []), []);
    expect(cruces.map((c) => c.desde.pantallas)).toEqual([[], []]);
  });
});

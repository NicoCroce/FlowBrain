import { describe, expect, it } from "vitest";
import { ConsultaError, crearContexto, crearIndiceCodigo, fidelidad, fidelidadDeArchivos, type Ficha, type Graph, type GraphEdge, type GraphNode } from "../src/index.js";

/**
 * Un back y un front mínimos, armados a mano para que cada archivo tenga una falta distinta y conocida:
 * - `api/pedidos.ts` atiende dos endpoints: uno llega a una tabla (con columnas) y el otro no llega a nada;
 * - `api/servicio.ts` tiene una llamada resuelta, una sin resolver y un acceso a una tabla sin página;
 * - `web/Pedidos.tsx` dibuja una pantalla que llama al back; `web/Ayuda.tsx`, una que no llama a nadie;
 * - `web/api.ts` tiene una llamada HTTP unida y otra sin ruta;
 * - `web/suelto.ts` tiene símbolos pero no es de ninguna funcionalidad; `web/datos.json` no tiene nada.
 */
const R = "repo-tienda";
const nodo = (id: string, tipo: GraphNode["tipo"], atributos: Record<string, unknown> = {}): GraphNode => ({ actualizado: null, aliases: [], atributos, estado: "vigente", id, nombre: id, origen: "parser", pagina: null, resumen: null, tecnologia: [], tipo, verificado: null });
const arista = (desde: string, verbo: GraphEdge["verbo"], hasta: string): GraphEdge => ({ confianza: 0.9, dato: null, desde, endpoint: null, estado: "vigente", evidencia: null, hasta, origen: "parser", verbo });

const EP_LISTAR = "svc-api:GET:/pedidos", EP_BORRAR = "svc-api:DELETE:/pedidos/{id}";
const graph: Graph = {
  version: 1,
  nodes: [
    nodo("svc-api", "svc"),
    nodo("svc-web", "svc"),
    nodo("tabla-pedido", "tabla"),
    nodo("feat-pedidos", "feat"),
    nodo(EP_LISTAR, "endpoint", { metodo: "GET", ruta: "/pedidos", evidencia: `${R}:api/pedidos.ts#L2`, response: "Pedido[]" }),
    nodo(EP_BORRAR, "endpoint", { metodo: "DELETE", ruta: "/pedidos/{id}", evidencia: `${R}:api/pedidos.ts#L12` }),
    nodo("svc-web:pantalla:/pedidos", "pantalla", { ruta: "/pedidos", componentes: [`${R}:web/Pedidos.tsx#Pedidos`] }),
    nodo("svc-web:pantalla:/ayuda", "pantalla", { ruta: "/ayuda", componentes: [`${R}:web/Ayuda.tsx#Ayuda`] }),
  ],
  edges: [arista("svc-api", "contiene", EP_LISTAR), arista("svc-api", "contiene", EP_BORRAR)],
};
const fn = (nombre: string, linea: number, fin: number) => ({ nombre, tipo: "funcion", linea, fin });
const archivos = JSON.stringify({
  repo: R,
  archivos: [
    { ruta: "api/pedidos.ts", simbolos: [fn("listar", 1, 10), fn("borrar", 11, 20)], importa: [], invoca: [{ desde: "listar", archivo: "api/servicio.ts", simbolo: "buscar", linea: 3 }] },
    { ruta: "api/servicio.ts", simbolos: [fn("buscar", 1, 10)], importa: [], invoca: [{ desde: "buscar", archivo: "api/servicio.ts", simbolo: "buscar", linea: 9 }], sinResolver: [{ desde: "buscar", linea: 6, llamada: "repo.traer" }] },
    { ruta: "web/Pedidos.tsx", simbolos: [fn("Pedidos", 1, 10)], importa: [], invoca: [{ desde: "Pedidos", archivo: "web/api.ts", simbolo: "traerPedidos", linea: 4 }] },
    { ruta: "web/Ayuda.tsx", simbolos: [fn("Ayuda", 1, 10)], importa: [], invoca: [] },
    { ruta: "web/api.ts", simbolos: [fn("traerPedidos", 1, 10), fn("otra", 11, 20)], importa: [], invoca: [] },
    { ruta: "web/suelto.ts", simbolos: [fn("formatear", 1, 5)], importa: [], invoca: [] },
    { ruta: "web/datos.json", simbolos: [], importa: [], invoca: [] },
    { ruta: "web/api.test.ts", simbolos: [fn("prueba", 1, 5)], importa: [], invoca: [] },
  ],
});
const extraccion = JSON.stringify({
  repo: R,
  accesos: [
    { desde: "svc-api", verbo: "lee_de", hasta: "tabla-pedido", endpoint: null, evidencia: `${R}:api/servicio.ts#L4`, columnas: ["id", "total"] },
    { desde: "svc-web", verbo: "llama_a", hasta: "svc-api", endpoint: EP_LISTAR, evidencia: `${R}:web/api.ts#L3` },
  ],
  pendientes: [
    { verbo: "escribe_en", desde: "svc-api", referencia: "auditoria", objetivo: "auditoria", motivo: "tabla sin página", evidencia: `${R}:api/servicio.ts#L8`, candidatos: [] },
    { verbo: "llama_a", desde: "svc-web", referencia: "GET ${url}", motivo: "URL sin ruta reconocible", evidencia: `${R}:web/api.ts#L14`, candidatos: [], llamada: { metodo: "GET", ruta: null, base: "${url}" } },
  ],
});
const ficha = { id: "feat-pedidos", codigo: [`${R}:api`, `${R}:web/Pedidos.tsx`, `${R}:web/Ayuda.tsx`, `${R}:web/api.ts`], cuerpo: "", archivos: 5, implementan: [], expone: [], usa: [], datos: [], usaFuncionalidades: [], usadaPor: [], recorridos: [], dominio: [], pantallas: [] } as Ficha;
const ctx = crearContexto(graph, [], new Map(), crearIndiceCodigo(graph, [ficha], [archivos], [extraccion]));

describe("fidelidad por archivo", () => {
  const { archivos: medidos, sinDatos } = fidelidadDeArchivos(ctx);
  const de = (ruta: string) => medidos.find((a) => a.archivo === `${R}:${ruta}`)!;

  it("mide solo lo que aplica a cada archivo y no puntúa donde no hay nada que medir", () => {
    expect(sinDatos).toEqual([`${R}:web/datos.json`]);
    // Los tests no entran.
    expect(medidos.map((a) => a.archivo)).not.toContain(`${R}:web/api.test.ts`);
    expect(de("web/Ayuda.tsx").señales).toEqual({ pantallas: { ok: 0, total: 1 }, funcionalidad: { ok: 1, total: 1 } });
    expect(de("web/Pedidos.tsx")).toMatchObject({ puntaje: 100, faltas: [], funcionalidades: ["feat-pedidos"] });
  });

  it("endpoints: uno llega a una tabla y tiene respuesta; el otro, ninguna de las dos", () => {
    const a = de("api/pedidos.ts");
    expect(a.señales).toEqual({ llamadas: { ok: 1, total: 1 }, entradas: { ok: 1, total: 2 }, contrato: { ok: 1, total: 2 }, funcionalidad: { ok: 1, total: 1 } });
    // (2·1 + 2·0,5 + 1·0,5 + 1·1) / 6 = 75
    expect(a.puntaje).toBe(75);
    expect(a.faltas).toEqual(["1 endpoints cuyo recorrido no llega a nada (DELETE /pedidos/{id})", "1 endpoints sin tipo de respuesta"]);
  });

  it("llamadas sin resolver y tablas sin página, con su línea", () => {
    const a = de("api/servicio.ts");
    expect(a.señales).toMatchObject({ llamadas: { ok: 1, total: 2 }, datos: { ok: 1, total: 2 } });
    expect(a.puntaje).toBe(60);
    expect(a.faltas[0]).toContain("1 llamadas sin resolver (L6)");
    expect(a.faltas[1]).toContain("1 accesos a tablas sin página (auditoria; L8)");
  });

  it("HTTP sin ruta y archivos sin funcionalidad", () => {
    expect(de("web/api.ts")).toMatchObject({ señales: { http: { ok: 1, total: 2 } }, puntaje: 67 });
    expect(de("web/api.ts").faltas[0]).toContain("1 llamadas HTTP sin ruta (L14)");
    expect(de("web/suelto.ts")).toMatchObject({ puntaje: 0, funcionalidades: [] });
  });
});

describe("informe de fidelidad", () => {
  it("resume el brain y lista de menor a mayor", () => {
    const r = fidelidad(ctx) as ReturnType<typeof fidelidad> & { lista: Array<{ archivo: string; puntaje: number }>; distribucion: Record<string, number>; archivos: unknown; porFuncionalidad: unknown[] };
    expect(r.archivos).toEqual({ medidos: 6, sinDatos: 1, completos: 1 });
    expect(Object.values(r.distribucion).reduce((a, b) => a + b, 0)).toBe(6);
    expect(r.lista.map((a) => a.puntaje)).toEqual([...r.lista.map((a) => a.puntaje)].sort((a, b) => a - b));
    expect(r.lista[0]!.archivo).toBe(`${R}:web/suelto.ts`);
    expect(r.porFuncionalidad).toContainEqual({ id: "ninguna", archivos: 1, puntaje: 0 });
  });

  it("filtra por rango, funcionalidad, tipo y señal", () => {
    const lista = (p: Parameters<typeof fidelidad>[1]) => (fidelidad(ctx, p) as unknown as { lista: Array<{ archivo: string }> }).lista.map((a) => a.archivo.slice(R.length + 1));
    expect(lista({ min: 60, max: 75 })).toEqual(["api/servicio.ts", "web/api.ts", "api/pedidos.ts"]);
    expect(lista({ funcionalidad: "ninguna" })).toEqual(["web/suelto.ts"]);
    expect(lista({ funcionalidad: "pedidos", tipo: "tsx" })).toEqual(["web/Ayuda.tsx", "web/Pedidos.tsx"]);
    expect(lista({ señal: "http" })).toEqual(["web/api.ts"]);
    expect(() => fidelidad(ctx, { min: 80, max: 20 })).toThrow(ConsultaError);
    expect(() => fidelidad(ctx, { señal: "otra" })).toThrow(/señal desconocida/);
  });

  it("un archivo: su detalle, o por qué no tiene puntaje", () => {
    expect(fidelidad(ctx, { archivo: "api/servicio.ts" })).toMatchObject({ archivo: `${R}:api/servicio.ts`, puntaje: 60, capa: expect.any(String) });
    expect(fidelidad(ctx, { archivo: "web/datos.json" })).toMatchObject({ puntaje: null });
    expect(() => fidelidad(ctx, { archivo: "no/existe.ts" })).toThrow(/no hay un archivo indexado/);
  });
});

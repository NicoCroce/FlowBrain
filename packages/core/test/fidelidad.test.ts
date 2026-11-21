import { describe, expect, it } from "vitest";
import { ConsultaError, crearContexto, crearIndiceCodigo, fidelidad, fidelidadDeArchivos, fidelidadDeFuentes, planDeFidelidad, type Ficha, type Graph, type GraphEdge, type GraphNode } from "../src/index.js";

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
    expect(de("web/Ayuda.tsx").signals).toEqual({ pantallas: { ok: 0, total: 1 }, funcionalidad: { ok: 1, total: 1 } });
    expect(de("web/Pedidos.tsx")).toMatchObject({ puntaje: 100, faltas: [], funcionalidades: ["feat-pedidos"] });
  });

  it("endpoints: uno llega a una tabla y tiene respuesta; el otro, ninguna de las dos", () => {
    const a = de("api/pedidos.ts");
    expect(a.signals).toEqual({ llamadas: { ok: 1, total: 1 }, entradas: { ok: 1, total: 2 }, contrato: { ok: 1, total: 2 }, funcionalidad: { ok: 1, total: 1 } });
    // (2·1 + 2·0,5 + 1·0,5 + 1·1) / 6 = 75
    expect(a.puntaje).toBe(75);
    expect(a.faltas).toEqual(["1 endpoint cuyo recorrido no llega a nada (DELETE /pedidos/{id})", "1 endpoint sin tipo de respuesta"]);
  });

  it("llamadas sin resolver y tablas sin página, con su línea", () => {
    const a = de("api/servicio.ts");
    expect(a.signals).toMatchObject({ llamadas: { ok: 1, total: 2 }, datos: { ok: 1, total: 2 } });
    expect(a.puntaje).toBe(60);
    expect(a.faltas[0]).toContain("1 llamada sin resolver (L6)");
    expect(a.faltas[1]).toContain("1 acceso a tablas sin página (auditoria; L8)");
  });

  it("HTTP sin ruta y archivos sin funcionalidad", () => {
    expect(de("web/api.ts")).toMatchObject({ signals: { http: { ok: 1, total: 2 } }, puntaje: 67 });
    expect(de("web/api.ts").faltas[0]).toContain("1 llamada HTTP sin ruta (L14)");
    expect(de("web/suelto.ts")).toMatchObject({ puntaje: 0, funcionalidades: [] });
  });
});

describe("tareas: qué hacer para llegar a 100", () => {
  const { archivos: medidos } = fidelidadDeArchivos(ctx);
  const de = (ruta: string) => medidos.find((a) => a.archivo === `${R}:${ruta}`)!;

  it("cada falta dice qué pasa, qué hacer, quién lo resuelve y en qué líneas", () => {
    expect(de("web/Pedidos.tsx").tareas).toEqual([]);
    expect(de("api/servicio.ts").tareas).toEqual([
      { signal: "llamadas", resuelve: "persona", lineas: [6], que: "1 llamada que no se sabe a qué método va: el código no lo dice con tipos", hacer: expect.stringContaining("calls.yaml") },
      { signal: "datos", resuelve: "agente", lineas: [8], que: "Toca 1 tabla que el cerebro no conoce (auditoria)", hacer: expect.any(String) },
    ]);
    expect(de("web/api.ts").tareas.map((t) => [t.signal, t.resuelve, t.lineas])).toEqual([["http", "persona", [14]]]);
    expect(de("api/pedidos.ts").tareas.map((t) => [t.signal, t.resuelve])).toEqual([["entradas", "agente"], ["contrato", "agente"]]);
    expect(de("web/Ayuda.tsx").tareas.map((t) => t.signal)).toEqual(["pantallas"]);
  });

  it("a un archivo sin funcionalidad le sugiere la de sus vecinos de carpeta", () => {
    const a = de("web/suelto.ts");
    expect(a.tareas).toEqual([expect.objectContaining({ signal: "funcionalidad", resuelve: "persona" })]);
    expect(a.sugerida).toEqual({ id: "feat-pedidos", motivo: "3 archivos de web/ son de feat-pedidos" });
    expect(de("web/api.ts").sugerida).toBeUndefined();
  });

  it("plan para el modelo: tareas por archivo, cómo se resuelve cada tipo y qué correr al terminar", () => {
    const plan = planDeFidelidad(medidos);
    expect(plan).toContain("llevar a 100 el puntaje de fidelidad de 5 archivos");
    expect(plan).toContain(`### ${R}:web/suelto.ts (0/100)\nPista: 3 archivos de web/ son de feat-pedidos (\`feat-pedidos\`).\n- [ ] funcionalidad: No es parte de ninguna funcionalidad ni librería.`);
    expect(plan).toContain("- [ ] llamadas: 1 llamada que no se sabe a qué método va: el código no lo dice con tipos (L6).");
    expect(plan).toContain("- **llamadas**: Abrí el archivo");
    expect(plan).toContain("flowbrain brains apply");
    // El archivo completo no entra; los de menor puntaje van primero.
    expect(plan).not.toContain("web/Pedidos.tsx");
    expect(plan.indexOf("web/suelto.ts")).toBeLessThan(plan.indexOf("api/pedidos.ts"));
    // Solo un tipo de relación, y con tope.
    const soloHttp = planDeFidelidad(medidos, { signals: ["http"] });
    expect(soloHttp).toContain("de 1 archivo");
    expect(soloHttp).not.toContain("**llamadas**");
    expect(planDeFidelidad(medidos, { limite: 2 })).toContain("quedan 3 más para otra tanda");
    expect(planDeFidelidad([])).toContain("No hay nada para hacer");
    // Desde la herramienta, con los mismos filtros que el informe.
    expect(fidelidad(ctx, { plan: true, signal: "http" })).toEqual({ herramienta: "fidelidad", archivos: 1, plan: soloHttp });
  });
});

describe("fidelidad con varios cerebros", () => {
  // Una llamada con ruta que este cerebro no atiende: sola se da por entendida; con otros cerebros, depende de si cruzó.
  const pendiente = { verbo: "llama_a", desde: "svc-web", referencia: "GET /stock", motivo: "ningún endpoint conocido coincide", evidencia: `${R}:web/api.ts#L16`, candidatos: [], llamada: { metodo: "GET", ruta: "/stock", base: "${api}" } };
  const j = JSON.parse(extraccion) as { pendientes: unknown[] };
  const conPendiente = JSON.stringify({ ...j, pendientes: [...j.pendientes, pendiente] });
  const http = (cruzadas?: Set<string>) => fidelidadDeFuentes(graph, [ficha], [archivos], [conPendiente], cruzadas ? { cruzadas } : {}).archivos.find((a) => a.archivo === `${R}:web/api.ts`)!;

  it("la llamada que cruza cuenta como unida; la que no llega a ningún cerebro, como falta", () => {
    expect(http().signals.http).toEqual({ ok: 2, total: 3 });
    expect(http(new Set([`${R}:web/api.ts#L16`])).signals.http).toEqual({ ok: 2, total: 3 });
    const sola = http(new Set());
    expect(sola.signals.http).toEqual({ ok: 1, total: 3 });
    expect(sola.faltas.join(" ")).toContain("1 llamada HTTP que no se unió a ningún endpoint, ni de este cerebro ni de los comunicados (L16)");
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

  it("filtra por rango, funcionalidad, tipo y signal", () => {
    const lista = (p: Parameters<typeof fidelidad>[1]) => (fidelidad(ctx, p) as unknown as { lista: Array<{ archivo: string }> }).lista.map((a) => a.archivo.slice(R.length + 1));
    expect(lista({ min: 60, max: 75 })).toEqual(["api/servicio.ts", "web/api.ts", "api/pedidos.ts"]);
    expect(lista({ funcionalidad: "ninguna" })).toEqual(["web/suelto.ts"]);
    expect(lista({ funcionalidad: "pedidos", tipo: "tsx" })).toEqual(["web/Ayuda.tsx", "web/Pedidos.tsx"]);
    expect(lista({ signal: "http" })).toEqual(["web/api.ts"]);
    expect(() => fidelidad(ctx, { min: 80, max: 20 })).toThrow(ConsultaError);
    expect(() => fidelidad(ctx, { signal: "otra" })).toThrow(/signal desconocida/);
  });

  it("un archivo: su detalle, o por qué no tiene puntaje", () => {
    expect(fidelidad(ctx, { archivo: "api/servicio.ts" })).toMatchObject({ archivo: `${R}:api/servicio.ts`, puntaje: 60, capa: expect.any(String) });
    expect(fidelidad(ctx, { archivo: "web/datos.json" })).toMatchObject({ puntaje: null });
    expect(() => fidelidad(ctx, { archivo: "no/existe.ts" })).toThrow(/no hay un archivo indexado/);
  });
});

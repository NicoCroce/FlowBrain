import { describe, expect, it } from "vitest";
import { ConsultaError, crearContexto, crearIndiceCodigo, fidelidad, fidelidadDeArchivos, fidelidadDeFuentes, planDeFidelidad, sinAsociar, type Ficha, type Graph, type GraphEdge, type GraphNode } from "../src/index.js";

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
const ficha = { id: "feat-pedidos", codigo: [`${R}:api`, `${R}:web/Pedidos.tsx`, `${R}:web/Ayuda.tsx`, `${R}:web/api.ts`], cuerpo: "", archivos: 5, implementan: [], expone: [], usa: [], datos: [], usaFuncionalidades: [], usadaPor: [], recorridos: [], dominio: [], pantallas: [], tests: [], especificaciones: [] } as Ficha;
const ctx = crearContexto(graph, [], new Map(), crearIndiceCodigo(graph, [ficha], [archivos], [extraccion]));

describe("fidelidad por archivo", () => {
  const { archivos: medidos, inciertos } = fidelidadDeArchivos(ctx);
  const de = (ruta: string) => medidos.find((a) => a.archivo === `${R}:${ruta}`)!;

  it("mide solo lo que aplica a cada archivo y no puntúa donde no hay nada que medir", () => {
    // Sin ninguna relación que medir no hay puntaje: la fidelidad es incierta, y se dice por qué.
    expect(inciertos.map((a) => [a.archivo.slice(R.length + 1), a.motivo, a.funcionalidades])).toEqual([["web/datos.json", "sin_nada", []], ["web/suelto.ts", "sin_relaciones", []]]);
    expect(medidos.map((a) => a.archivo)).not.toContain(`${R}:web/suelto.ts`);
    // Los tests no entran.
    expect(medidos.map((a) => a.archivo)).not.toContain(`${R}:web/api.test.ts`);
    expect(de("web/Ayuda.tsx").signals).toEqual({ pantallas: { ok: 0, total: 1 } });
    expect(de("web/Pedidos.tsx")).toMatchObject({ puntaje: 100, faltas: [], funcionalidades: ["feat-pedidos"] });
  });

  it("endpoints: uno llega a una tabla y tiene respuesta; el otro, ninguna de las dos", () => {
    const a = de("api/pedidos.ts");
    expect(a.signals).toEqual({ llamadas: { ok: 1, total: 1 }, entradas: { ok: 1, total: 2 }, contrato: { ok: 1, total: 2 } });
    // (2·1 + 2·0,5 + 1·0,5) / 5 = 70
    expect(a.puntaje).toBe(70);
    expect(a.faltas).toEqual(["1 endpoint cuyo recorrido no llega a nada (DELETE /pedidos/{id})", "1 endpoint sin tipo de respuesta"]);
  });

  it("llamadas sin resolver y tablas sin página, con su línea", () => {
    const a = de("api/servicio.ts");
    expect(a.signals).toMatchObject({ llamadas: { ok: 1, total: 2 }, datos: { ok: 1, total: 2 } });
    expect(a.puntaje).toBe(50);
    expect(a.faltas[0]).toContain("1 llamada sin resolver (L6)");
    expect(a.faltas[1]).toContain("1 acceso a tablas sin página (auditoria; L8)");
  });

  it("HTTP sin ruta; no tener funcionalidad no resta puntaje", () => {
    expect(de("web/api.ts")).toMatchObject({ signals: { http: { ok: 1, total: 2 } }, puntaje: 50 });
    expect(de("web/api.ts").faltas[0]).toContain("1 llamada HTTP sin ruta (L14)");
    expect(de("web/api.ts").sinAsociar).toBeUndefined();
    expect(fidelidadDeArchivos(ctx).sinAsociar.map((a) => a.archivo)).toContain(`${R}:web/suelto.ts`);
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

  it("plan para el modelo: tareas por archivo, cómo se resuelve cada tipo y qué correr al terminar", () => {
    const plan = planDeFidelidad(medidos);
    expect(plan).toContain("llevar a 100 el puntaje de fidelidad de 4 archivos");
    expect(plan).not.toContain("web/suelto.ts");
    expect(plan).toContain("- [ ] llamadas: 1 llamada que no se sabe a qué método va: el código no lo dice con tipos (L6).");
    expect(plan).toContain("- **llamadas**: Abrí el archivo");
    expect(plan).toContain("flowbrain brains apply");
    // El archivo completo no entra; los de menor puntaje van primero.
    expect(plan).not.toContain("web/Pedidos.tsx");
    expect(plan.indexOf("web/Ayuda.tsx")).toBeLessThan(plan.indexOf("api/pedidos.ts"));
    // Solo un tipo de relación, y con tope.
    const soloHttp = planDeFidelidad(medidos, { signals: ["http"] });
    expect(soloHttp).toContain("de 1 archivo");
    expect(soloHttp).not.toContain("**llamadas**");
    expect(planDeFidelidad(medidos, { limite: 2 })).toContain("quedan 2 más para otra tanda");
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
    expect(r.archivos).toEqual({ medidos: 5, inciertos: 2, completos: 1, sinAsociar: 2 });
    expect(Object.values(r.distribucion).reduce((a, b) => a + b, 0)).toBe(5);
    expect(r.lista.map((a) => a.puntaje)).toEqual([...r.lista.map((a) => a.puntaje)].sort((a, b) => a - b));
    expect(r.lista[0]!.archivo).toBe(`${R}:web/Ayuda.tsx`);
    expect((r as unknown as { avisos: string[] }).avisos.join(" ")).toContain("2 archivos de fidelidad incierta");
  });

  it("filtra por rango, funcionalidad, tipo y signal", () => {
    const lista = (p: Parameters<typeof fidelidad>[1]) => (fidelidad(ctx, p) as unknown as { lista: Array<{ archivo: string }> }).lista.map((a) => a.archivo.slice(R.length + 1));
    expect(lista({ min: 50, max: 75 })).toEqual(["api/servicio.ts", "web/api.ts", "api/pedidos.ts"]);
    expect(lista({ funcionalidad: "ninguna" })).toEqual([]);
    expect(lista({ funcionalidad: "pedidos", tipo: "tsx" })).toEqual(["web/Ayuda.tsx", "web/Pedidos.tsx"]);
    expect(lista({ signal: "http" })).toEqual(["web/api.ts"]);
    expect(() => fidelidad(ctx, { min: 80, max: 20 })).toThrow(ConsultaError);
    expect(() => fidelidad(ctx, { signal: "otra" })).toThrow(/signal desconocida/);
  });

  it("un archivo: su detalle, o por qué no tiene puntaje", () => {
    expect(fidelidad(ctx, { archivo: "api/servicio.ts" })).toMatchObject({ archivo: `${R}:api/servicio.ts`, puntaje: 50, capa: expect.any(String) });
    expect(fidelidad(ctx, { archivo: "web/datos.json" })).toMatchObject({ puntaje: null, incierta: true, motivo: expect.stringContaining("no encontró nada") });
    expect(fidelidad(ctx, { archivo: "web/suelto.ts" })).toMatchObject({ puntaje: null, incierta: true, motivo: expect.stringContaining("vio código, pero ninguna relación") });
    // La lista de inciertos, con cuántos hay de cada motivo.
    expect(fidelidad(ctx, { inciertos: true })).toMatchObject({ inciertos: 2, medidos: 5, porMotivo: { sin_relaciones: { archivos: 1 }, sin_nada: { archivos: 1 } }, lista: [{ archivo: `${R}:web/datos.json`, motivo: "sin_nada" }, { archivo: `${R}:web/suelto.ts`, motivo: "sin_relaciones" }] });
    expect(() => fidelidad(ctx, { archivo: "no/existe.ts" })).toThrow(/no hay un archivo indexado/);
  });
});

describe("archivos sin asociar", () => {
  // Un repo con dos funcionalidades y archivos sueltos, cada uno con un indicio distinto.
  const nd = (id: string, tipo: GraphNode["tipo"], nombre = id, atributos: Record<string, unknown> = {}): GraphNode => ({ ...nodo(id, tipo, atributos), nombre });
  const A = "repo-a";
  const arc = (ruta: string, importa: string[] = []) => ({ ruta, lenguaje: "typescript", simbolos: [{ nombre: "f", tipo: "funcion", linea: 1 }], importa, invoca: [] });
  const indice = JSON.stringify({
    repo: A,
    archivos: [
      arc("src/pagos/cobrar.ts", ["src/shared/dinero.ts", "src/shared/fecha.ts", "src/lib/http.ts"]),
      arc("src/pagos/reembolso.ts", ["src/shared/dinero.ts"]),
      arc("src/pagos/extra/nota.ts"),
      arc("src/envios/enviar.ts", ["src/shared/fecha.ts", "src/lib/http.ts"]),
      arc("src/shared/dinero.ts"),
      arc("src/shared/fecha.ts"),
      arc("src/shared/usa-pagos.ts", ["src/pagos/cobrar.ts"]),
      arc("src/sueltos/nada.ts"),
      arc("src/sueltos/nada.test.ts"),
      arc("src/lib/http.ts"),
      arc("src/vecinos/a.ts"),
    ],
  });
  const f = (id: string, codigo: string[]) => ({ ...ficha, id, codigo });
  const g: Graph = { version: 1, nodes: [nd("feat-pagos", "feat", "Pagos"), nd("feat-envios", "feat", "Envíos"), nd("lib-http", "lib", "HTTP", { codigo: [`${A}:src/lib`] })], edges: [] };
  const c = crearContexto(g, [], new Map(), crearIndiceCodigo(g, [f("feat-pagos", [`${A}:src/pagos/cobrar.ts`, `${A}:src/pagos/reembolso.ts`, `${A}:src/vecinos/b.ts`]), f("feat-envios", [`${A}:src/envios`])], [indice], []));
  const { sinAsociar: sueltos, archivos: medidos } = fidelidadDeArchivos(c);
  const de = (ruta: string) => sueltos.find((x) => x.archivo === `${A}:${ruta}`)!;

  it("quedan aparte: ni los de una funcionalidad, ni los de una librería, ni los tests", () => {
    expect(sueltos.map((x) => x.archivo.slice(A.length + 1))).toEqual(["src/pagos/extra/nota.ts", "src/shared/dinero.ts", "src/shared/fecha.ts", "src/shared/usa-pagos.ts", "src/sueltos/nada.ts", "src/vecinos/a.ts"]);
    // Ninguno tiene relaciones que medir: no llevan puntaje, ni 100 ni 0.
    expect(medidos).toEqual([]);
    expect(fidelidadDeArchivos(c).inciertos.every((a) => a.motivo === "sin_relaciones")).toBe(true);
  });

  it("recomienda por quién lo usa, qué usa y, si no hay más, por los vecinos de carpeta", () => {
    expect(de("src/shared/dinero.ts").recomendada).toEqual({ id: "feat-pagos", motivo: "lo importan 2 archivos de Pagos" });
    expect(de("src/shared/usa-pagos.ts").recomendada).toEqual({ id: "feat-pagos", motivo: "importa 1 archivo de Pagos" });
    expect(de("src/pagos/extra/nota.ts").recomendada).toEqual({ id: "feat-pagos", motivo: "2 archivos de src/pagos/ son de Pagos" });
    expect(de("src/sueltos/nada.ts")).toMatchObject({ otras: [], carpetaLibre: true });
    expect(de("src/sueltos/nada.ts").recomendada).toBeUndefined();
  });

  it("lo que usan varias funcionalidades por igual es código compartido: no se recomienda una", () => {
    const fecha = de("src/shared/fecha.ts");
    expect(fecha.recomendada).toBeUndefined();
    expect(fecha.compartido).toEqual({ funcionalidades: 2 });
    expect(fecha.otras.map((o) => o.id)).toEqual(["feat-envios", "feat-pagos"]);
  });

  it("la carpeta se puede asociar entera solo si nada de adentro tiene dueño", () => {
    expect(de("src/shared/dinero.ts").carpetaLibre).toBe(true);
    // En src/pagos hay archivos de Pagos; y src/pagos/extra está libre.
    expect(de("src/pagos/extra/nota.ts").carpetaLibre).toBe(true);
    expect(de("src/vecinos/a.ts").carpetaLibre).toBe(true);
  });

  it("la consulta los agrupa por carpeta, con la recomendada si la mayoría coincide", () => {
    const r = sinAsociar(c, { budget_tokens: null }) as unknown as { total: number; conRecomendacion: number; compartidos: number; sinPista: number; carpetas: Array<{ carpeta: string; archivos: number; recomendada?: { id: string; archivos: number }; carpetaLibre: boolean; compartidos?: number }> };
    expect([r.total, r.conRecomendacion, r.compartidos, r.sinPista]).toEqual([6, 3, 1, 2]);
    expect(r.carpetas[0]).toMatchObject({ carpeta: `${A}:src/shared`, archivos: 3, recomendada: { id: "feat-pagos", archivos: 2 }, carpetaLibre: true, compartidos: 1 });
    const solo = sinAsociar(c, { carpeta: "src/pagos", budget_tokens: null }) as unknown as { filtro: { coinciden: number }; carpetas: Array<{ carpeta: string }> };
    expect(solo.filtro).toEqual({ coinciden: 1 });
    expect((sinAsociar(c, { funcionalidad: "ninguna", budget_tokens: null }) as unknown as { filtro: { coinciden: number } }).filtro).toEqual({ coinciden: 3 });
    expect((sinAsociar(c, { funcionalidad: "pagos", budget_tokens: null }) as unknown as { filtro: { coinciden: number } }).filtro).toEqual({ coinciden: 3 });
    expect(() => sinAsociar(c, { funcionalidad: "no-existe" })).toThrow(ConsultaError);
    expect((fidelidad(c) as unknown as { avisos: string[] }).avisos.join(" ")).toContain("6 archivos no son de ninguna funcionalidad ni librería");
  });
});

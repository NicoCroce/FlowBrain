import { describe, expect, it } from "vitest";
import { cierrePendientes, desenlacesDeTanda, itemsDeTanda, pedidoDeTandaDeriva, pedidoDeTandaFidelidad, pedidoDeTandaPaginas, pendientesDelAgente, type Trabajo } from "../src/agente.js";

/**
 * El desenlace de cada ítem de una tanda (dec. 235): igual para todos los tipos. Lo resuelto dice qué cambió; lo que
 * no, por qué (lo que midió el servidor y, si lo dijo, lo que dijo el agente en su bloque `flowbrain-pending`).
 */
const base = (p: Partial<Trabajo>): Trabajo => ({ id: "t", tipo: "test", etiqueta: "", pedido: "", cerebros: ["c"], estado: "terminado", creado: 0, pasos: [], cambios: [], ...p });
const pendiente = (xs: Array<{ ref: string; reason: string }>) => "Done.\n```flowbrain-pending\n" + JSON.stringify(xs) + "\n```\n";

describe("pendientesDelAgente", () => {
  it("lee el último bloque, sin comillas invertidas ni línea en la ref", () => {
    const m = pendientesDelAgente("```flowbrain-pending\n[{\"ref\":\"viejo\",\"reason\":\"x\"}]\n```\n" + pendiente([{ ref: "`repo-a:src/x.ts#L4`", reason: "No route for it" }, { ref: "", reason: "y" }]));
    expect([...m]).toEqual([["repo-a:src/x.ts", "No route for it"]]);
  });
  it("sin bloque o con un bloque roto, no hay motivos", () => {
    expect(pendientesDelAgente(undefined).size).toBe(0);
    expect(pendientesDelAgente("```flowbrain-pending\nno es json\n```").size).toBe(0);
  });
});

describe("desenlacesDeTanda", () => {
  it("test: el resultado y sus tests, o por qué no volvió", () => {
    const t = base({
      tipo: "test",
      reglas: [{ cerebro: "c", funcionalidad: "feat-a", regla: "r1" }, { cerebro: "c", funcionalidad: "feat-a", regla: "r2" }],
      resultados: [{ cerebro: "c", funcionalidad: "feat-a", regla: "r1", resultado: "a", tests: ["repo-a:t.test.ts::ok"] }],
      sinResultado: [{ cerebro: "c", funcionalidad: "feat-a", regla: "r2", motivo: "the agent did not return a valid outcome for this rule" }],
    });
    expect(desenlacesDeTanda(t)).toEqual([
      { item: t.reglas![0], resuelto: true, cambio: { resultado: "a", tests: ["repo-a:t.test.ts::ok"] } },
      { item: t.reglas![1], resuelto: false, motivo: { codigo: "sin_respuesta", detalle: "the agent did not return a valid outcome for this rule" } },
    ]);
  });
  it("fidelidad: el puntaje de antes y el de ahora; lo que sigue, con el motivo del agente", () => {
    const a = { cerebro: "c", archivo: "repo-a:src/a.ts" }, b = { cerebro: "c", archivo: "repo-a:src/b.ts" };
    const t = base({ tipo: "fidelidad", archivos: [a, b], completados: [{ ...a, puntaje: 100 }], pendientes: [{ ...b, puntaje: 60 }], resultado: pendiente([{ ref: "repo-a:src/b.ts", reason: "The URL is built at runtime" }]) });
    expect(desenlacesDeTanda(t, new Map([["c|repo-a:src/a.ts", 40]]))).toEqual([
      { item: a, resuelto: true, cambio: { puntaje: { antes: 40, despues: 100 } } },
      { item: b, resuelto: false, motivo: { codigo: "sigue", agente: "The URL is built at runtime" } },
    ]);
  });
  it("deriva: corregido o sigue, reconocido por su ubicación", () => {
    const p1 = { cerebro: "c", clase: "sinEndpoint" as const, ev: "repo-a:src/api.ts#L3", llamada: "GET /x", que: "nobody serves it" };
    const p2 = { ...p1, ev: "repo-a:src/api.ts#L9", llamada: "GET /y" };
    const t = base({ tipo: "deriva", problemas: [p1, p2], corregidos: [p1], persisten: [p2], resultado: pendiente([{ ref: "repo-a:src/api.ts#L9", reason: "The backend is not in any brain" }]) });
    const ds = desenlacesDeTanda(t);
    expect(ds.map((d) => [d.resuelto, d.cambio ?? d.motivo])).toEqual([[true, { corregido: true }], [false, { codigo: "sigue", agente: "The backend is not in any brain" }]]);
  });
  it("páginas: la página o el borrador que quedó; una tanda cancelada o caída lo dice", () => {
    const x = { cerebro: "c", funcionalidad: "feat-a" }, y = { cerebro: "c", funcionalidad: "feat-b", caso: "uc-1" };
    expect(desenlacesDeTanda(base({ tipo: "corregir", items: [x, y], resueltos: [x], quedan: [y], resultado: pendiente([{ ref: "feat-b/uc-1", reason: "The use case contradicts the code" }]) })).map((d) => d.cambio ?? d.motivo))
      .toEqual([{ pagina: "feat-a" }, { codigo: "sigue", agente: "The use case contradicts the code" }]);
    expect(desenlacesDeTanda(base({ tipo: "funcionalidad", items: [x, { cerebro: "c", funcionalidad: "" }], resueltos: [x, { cerebro: "c", funcionalidad: "" }] })).map((d) => d.cambio))
      .toEqual([{ borrador: "_drafts/product/feat-a.md" }, { borrador: "_drafts/product/" }]);
    expect(desenlacesDeTanda(base({ tipo: "borrador", items: [{ cerebro: "c", funcionalidad: "feat-a", borrador: "_drafts/product/feat-a.md" }], resueltos: [{ cerebro: "c", funcionalidad: "feat-a", borrador: "_drafts/product/feat-a.md" }] }))[0]!.cambio)
      .toEqual({ borrador: "_drafts/product/feat-a.md" });
    expect(desenlacesDeTanda(base({ tipo: "escribir", estado: "cancelado", items: [x], quedan: [x] }))[0]!.motivo).toEqual({ codigo: "cancelado" });
    expect(desenlacesDeTanda(base({ tipo: "agrupar", error: "c does not compile: bad yaml", items: [x], quedan: [x] }))[0]!.motivo).toEqual({ codigo: "fallo", detalle: "c does not compile: bad yaml" });
  });
  it("cada tipo lista sus ítems en su campo", () => {
    expect(itemsDeTanda(base({ tipo: "asociar", archivos: [{ cerebro: "c", archivo: "a" }] }))).toHaveLength(1);
    expect(itemsDeTanda(base({ tipo: "deriva" }))).toEqual([]);
  });
});

describe("el pedido de cada tanda pide el bloque flowbrain-pending", () => {
  it("en todos los tipos que no son tests, en inglés", () => {
    expect(cierrePendientes("the file")).toMatch(/^If you could not resolve some of them, end your answer with a ```flowbrain-pending block/);
    expect(pedidoDeTandaDeriva([{ cerebro: "c", clase: "sinEndpoint", ev: "repo-a:x.ts#L1", llamada: "GET /x", que: "q" }], "repo-a", "c", 1, 1)).toContain("flowbrain-pending");
    expect(pedidoDeTandaFidelidad([{ cerebro: "c", archivo: "repo-a:x.ts", puntaje: 50, tareas: [{ signal: "llamadas", que: "q", lineas: [1] }] }], "repo-a", "c", 1, 1)).toContain("flowbrain-pending");
    for (const tipo of ["agrupar", "escribir", "corregir", "funcionalidad", "borrador"] as const) expect(pedidoDeTandaPaginas(tipo, [{ cerebro: "c", funcionalidad: "feat-a", linea: "- feat-a" }], 1, 1)).toContain("flowbrain-pending");
  });
});

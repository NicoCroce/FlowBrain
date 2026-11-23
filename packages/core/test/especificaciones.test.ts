import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compile, CompileError, ConsultaError, crearContexto, crearIndiceCodigo, especificaciones, fichasDeFuncionalidades, formatError, funcionalidad, leerEntradas, type Entradas, type Graph, type GraphNode } from "../src/index.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");
let entradas: Entradas;
beforeAll(async () => {
  entradas = await leerEntradas(FIXTURE);
});

const conEspecificaciones = (ruta: string, yaml: string): Entradas => ({
  ...entradas,
  paginas: entradas.paginas.map((p) => (p.ruta === ruta ? { ruta, contenido: p.contenido.replace(/\n---\n/, `\n${yaml}\n---\n`) } : p)),
});
const errores = (e: Entradas): string[] => {
  try {
    compile(e);
  } catch (err) {
    if (err instanceof CompileError) return err.errores.map(formatError);
    throw err;
  }
  return [];
};

describe("especificaciones en la página de una funcionalidad", () => {
  it("compilan y quedan en la ficha, propuestas mientras nadie las confirme", () => {
    const s = compile(
      conEspecificaciones(
        "product/feat-checkout.md",
        [
          "especificaciones:",
          "  - id: paga-con-tarjeta",
          "    texto: El cliente paga el carrito con tarjeta.",
          "    tipo: producto",
          "    archivos: [repo-tienda:apps/bff/src/routes/checkout.ts#L18]",
          "  - id: pago-unico",
          "    texto: Un carrito no se cobra dos veces.",
          "    tipo: negocio",
          "    estado: confirmada",
        ].join("\n"),
      ),
    );
    expect(s.funcionalidades[0]!.especificaciones.map((e) => [e.id, e.tipo, e.estado, e.archivos.length])).toEqual([
      ["paga-con-tarjeta", "producto", "propuesta", 1],
      ["pago-unico", "negocio", "confirmada", 0],
    ]);
  });

  it("un id repetido, una referencia mal escrita o un repo que no existe no compilan, y dicen dónde", () => {
    const e = errores(
      conEspecificaciones(
        "product/feat-checkout.md",
        [
          "especificaciones:",
          "  - { id: a, texto: Uno, tipo: negocio, archivos: [\"src/suelto.ts\"] }",
          "  - { id: a, texto: Dos, tipo: negocio, tests: [\"repo-otro:tests/x.test.ts::caso\"] }",
        ].join("\n"),
      ),
    );
    expect(e.some((x) => x.includes("id repetido: a"))).toBe(true);
    expect(e.some((x) => x.includes('especificaciones.a.archivos con formato inválido: "src/suelto.ts"'))).toBe(true);
    expect(e.some((x) => x.includes("especificaciones.a.tests: repo inexistente: repo-otro"))).toBe(true);
    expect(errores(conEspecificaciones("technology/svc-bff.md", "especificaciones: []")).join("\n")).toContain("especificaciones solo aplica a feat");
    expect(errores(conEspecificaciones("product/feat-checkout.md", "especificaciones:\n  - { id: a, texto: Uno, tipo: tecnica }")).length).toBeGreaterThan(0);
  });
});

describe("especificaciones contra el índice", () => {
  const nodo = (id: string, tipo: GraphNode["tipo"]): GraphNode => ({ actualizado: null, aliases: [], atributos: {}, estado: "vigente", id, nombre: id === "feat-pagos" ? "Pagos" : id, origen: "parser", pagina: null, resumen: null, tecnologia: [], tipo, verificado: null });
  const graph: Graph = { version: 1, nodes: [nodo("feat-pagos", "feat"), nodo("feat-envios", "feat")], edges: [] };
  const arc = (importa: string[] = [], casos?: Array<{ nombre: string; linea: number; grupo?: string }>) => ({ simbolos: [], importa, invoca: [], ...(casos ? { casos } : {}) });
  const estructura = new Map([
    ["repo-a:src/pagos/cobrar.ts", arc()],
    ["repo-a:src/pagos/cobrar.test.ts", arc(["src/pagos/cobrar.ts"], [{ nombre: "Rechaza una tarjeta  vencida", linea: 3 }, { nombre: "cobra", linea: 9, grupo: "con saldo" }, { nombre: "avisa por mail", linea: 15 }])],
    ["repo-a:src/pagos/reembolso.test.ts", arc(["src/pagos/cobrar.ts"], [{ nombre: "devuelve todo", linea: 2 }, { nombre: "devuelve una parte", linea: 8 }])],
    ["repo-a:src/envios/enviar.ts", arc()],
  ]);
  const feats = [
    {
      id: "feat-pagos",
      codigo: ["repo-a:src/pagos"],
      cuerpo: "",
      especificaciones: [
        { id: "tarjeta-vencida", texto: "No se puede pagar con una tarjeta vencida.", tipo: "negocio" as const, archivos: ["repo-a:src/pagos/cobrar.ts#L4"], tests: ["repo-a:src/pagos/cobrar.test.ts::rechaza una tarjeta vencida"], estado: "confirmada" as const },
        { id: "cobra-con-saldo", texto: "Con saldo, el pago se cobra.", tipo: "negocio" as const, tests: ["repo-a:src/pagos/cobrar.test.ts::con saldo › cobra"] },
        { id: "reembolsos", texto: "Se puede devolver un pago entero o una parte.", tipo: "producto" as const, tests: ["repo-a:src/pagos/reembolso.test.ts"] },
        { id: "limite-diario", texto: "No se cobra más de un tope por día.", tipo: "negocio" as const, archivos: ["repo-a:src/pagos/limite.ts", "repo-a:config/limites.yaml#L3"], tests: ["repo-a:src/pagos/cobrar.test.ts::respeta el tope", "repo-sin-indice:tests/tope.test.ts::tope"] },
      ],
    },
    { id: "feat-envios", codigo: ["repo-a:src/envios"], cuerpo: "" },
  ];
  const fichas = fichasDeFuncionalidades(graph, feats, [], estructura);
  const archivos = JSON.stringify({ repo: "repo-a", archivos: [...estructura].map(([k, e]) => ({ ruta: k.slice(7), lenguaje: "typescript", ...e })) });
  const ctx = crearContexto(graph, [], new Map(), crearIndiceCodigo(graph, fichas, [archivos], []));

  it("une cada caso por su nombre, sin importar mayúsculas ni espacios, y también por grupo › nombre", () => {
    const pagos = fichas.find((f) => f.id === "feat-pagos")!;
    expect(pagos.especificaciones.map((e) => [e.id, e.tests, e.rotos])).toEqual([
      ["tarjeta-vencida", [{ archivo: "repo-a:src/pagos/cobrar.test.ts", caso: "Rechaza una tarjeta  vencida", linea: 3 }], []],
      ["cobra-con-saldo", [{ archivo: "repo-a:src/pagos/cobrar.test.ts", caso: "cobra", linea: 9 }], []],
      ["reembolsos", [{ archivo: "repo-a:src/pagos/reembolso.test.ts", casos: 2 }], []],
      // El archivo y el caso que el índice no encuentra quedan rotos; el de un repo sin indexar, o un .yaml que el
      // índice de repo-a no lee, no se puede saber.
      ["limite-diario", [{ archivo: "repo-sin-indice:tests/tope.test.ts", caso: "tope" }], ["repo-a:src/pagos/limite.ts", "repo-a:src/pagos/cobrar.test.ts::respeta el tope"]],
    ]);
    expect(fichas.find((f) => f.id === "feat-envios")!.especificaciones).toEqual([]);
  });

  it("la consulta de una funcionalidad lista cada requisito, lo que no tiene test y los casos sueltos", () => {
    const r = especificaciones(ctx, { funcionalidad: "pagos", budget_tokens: null }) as unknown as { total: number; confirmadas: number; sinTest: number; conReferenciasRotas: number; especificaciones: Array<{ id: string; tests: string[]; sinTest?: true; rotos?: string[] }>; casosSinEspecificacion: { total: number; lista: string[] } };
    expect([r.total, r.confirmadas, r.sinTest, r.conReferenciasRotas]).toEqual([4, 1, 0, 1]);
    expect(r.especificaciones[0]!.tests).toEqual(["repo-a:src/pagos/cobrar.test.ts::Rechaza una tarjeta  vencida (L3)"]);
    expect(r.especificaciones[2]!.tests).toEqual(["repo-a:src/pagos/reembolso.test.ts (2 casos)"]);
    // El archivo nombrado entero cubre sus dos casos; de cobrar.test.ts queda suelto el que nadie nombró.
    expect(r.casosSinEspecificacion).toEqual({ total: 1, lista: ["repo-a:src/pagos/cobrar.test.ts::avisa por mail (L15)"] });
    expect((especificaciones(ctx, { funcionalidad: "pagos", estado: "confirmada", budget_tokens: null }) as unknown as { especificaciones: unknown[] }).especificaciones).toHaveLength(1);
    expect((especificaciones(ctx, { funcionalidad: "pagos", tipo: "producto", budget_tokens: null }) as unknown as { especificaciones: Array<{ id: string }> }).especificaciones.map((e) => e.id)).toEqual(["reembolsos"]);
    expect(() => especificaciones(ctx, { estado: "lista" })).toThrow(ConsultaError);
  });

  it("sin funcionalidad, el resumen: cuántas tiene cada una y cuántos casos de test no verifican ninguna", () => {
    const r = especificaciones(ctx, { budget_tokens: null }) as unknown as { total: number; confirmadas: number; propuestas: number; funcionalidadesSinEspecificaciones: number; funcionalidades: Array<Record<string, unknown>> };
    expect([r.total, r.confirmadas, r.propuestas, r.funcionalidadesSinEspecificaciones]).toEqual([4, 1, 3, 1]);
    expect(r.funcionalidades).toEqual([
      { id: "feat-pagos", nombre: "Pagos", especificaciones: 4, confirmadas: 1, sinTest: 0, casosDeTest: 5, casosSinEspecificacion: 1 },
      { id: "feat-envios", nombre: "feat-envios", especificaciones: 0, confirmadas: 0, sinTest: 0, casosDeTest: 0, casosSinEspecificacion: 0 },
    ]);
    expect((funcionalidad(ctx, { id: "pagos", budget_tokens: null }) as unknown as { especificaciones: unknown }).especificaciones).toEqual({ total: 4, confirmadas: 1, sinTest: 0, conReferenciasRotas: 1 });
  });
});

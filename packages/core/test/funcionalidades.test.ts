import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compile, CompileError, dentroDe, leerEntradas, raizDeServicio, renderViewer, type Entradas } from "../src/index.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");

let base: Entradas;
beforeAll(async () => {
  base = await leerEntradas(FIXTURE);
});

/** feat-checkout con `codigo` en el BFF, una feat-carrito en la web y una extracción que conecta ambas. */
function conFuncionalidades(codigoCheckout = "repo-tienda:apps/bff/src/routes"): Entradas {
  const paginas = base.paginas.map((p) =>
    p.ruta === "producto/feat-checkout.md" ? { ...p, contenido: p.contenido.replace("verificado: 2026-11-15\n", `verificado: 2026-11-15\ncodigo:\n  - ${codigoCheckout}\n`) } : p,
  );
  paginas.push({
    ruta: "producto/feat-carrito.md",
    contenido: "---\nid: feat-carrito\ntipo: feat\nnombre: Carrito\nresumen: El cliente arma el pedido.\ncodigo: [\"repo-tienda:apps/web/src\"]\n---\n# Carrito\n\nArma el pedido.\n",
  });
  const extraccion = {
    aristas: [
      { dato: null, desde: "svc-web", endpoint: "svc-bff:POST:/checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L8", hasta: "svc-bff", origen: "parser", verbo: "llama_a" },
      { dato: null, desde: "svc-web", endpoint: "svc-bff:POST:/checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L20", hasta: "svc-bff", origen: "parser", verbo: "llama_a" },
      { dato: "Pago", desde: "svc-bff", endpoint: null, evidencia: "repo-tienda:apps/bff/src/routes/checkout.ts#L30", hasta: "tabla-pagos", origen: "parser", verbo: "escribe_en" },
      { dato: "Pago", desde: "svc-payments", endpoint: null, evidencia: "repo-tienda:apps/payments/src/x.ts#L3", hasta: "tabla-pagos", origen: "parser", verbo: "lee_de" },
    ],
    pendientes: [],
    repo: "repo-tienda",
    servicios: [],
  };
  return { ...base, paginas, extracciones: [{ ruta: "_build/extraccion/repo-tienda.json", contenido: JSON.stringify(extraccion) }] };
}

describe("funcionalidades", () => {
  it("dentroDe compara por carpeta completa, no por prefijo de texto", () => {
    expect(dentroDe("repo-a:src/features/pay/x.ts#L3", "repo-a:src/features/pay")).toBe(true);
    expect(dentroDe("repo-a:src/features/payments/x.ts", "repo-a:src/features/pay")).toBe(false);
    expect(dentroDe("repo-b:src/features/pay/x.ts", "repo-a:src/features/pay")).toBe(false);
  });

  it("la raíz de un servicio es la carpeta común de sus puntos de entrada", () => {
    expect(raizDeServicio({ a: "apps/bff/src/main.ts", b: "apps/bff/src/routes/" })).toBe("apps/bff/src");
    expect(raizDeServicio({ raiz: "." })).toBe("");
    expect(raizDeServicio(undefined)).toBeNull();
  });

  it("codigo genera implementa solo desde el servicio del monorepo que contiene la ruta", () => {
    const { graph } = compile(conFuncionalidades());
    // Las tres `implementa` hacia checkout están escritas a mano (curado gana); la del BFF toma la evidencia del codigo.
    const impl = graph.edges.filter((e) => e.verbo === "implementa").map((e) => `${e.desde}→${e.hasta} ${e.origen} ${e.evidencia}`);
    expect(impl).toEqual([
      "svc-bff→feat-checkout curado repo-tienda:apps/bff/src/routes",
      "svc-payments→feat-checkout curado null",
      "svc-web→feat-carrito parser repo-tienda:apps/web/src",
      "svc-web→feat-checkout curado null",
    ]);
  });

  it("la ficha deriva qué expone, qué usa, qué datos toca y con qué se relaciona", () => {
    const { funcionalidades, generados } = compile(conFuncionalidades());
    const carrito = funcionalidades.find((f) => f.id === "feat-carrito")!;
    const checkout = funcionalidades.find((f) => f.id === "feat-checkout")!;
    expect(carrito.usa).toEqual([{ endpoint: "svc-bff:POST:/checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L20", hasta: "svc-bff", veces: 2 }]);
    expect(carrito.usaFuncionalidades).toEqual(["feat-checkout"]);
    expect(checkout.usadaPor).toEqual(["feat-carrito"]);
    expect(checkout.expone).toEqual(["svc-bff:POST:/checkout"]);
    expect(checkout.datos).toEqual([{ escribe: 1, evidencia: "repo-tienda:apps/bff/src/routes/checkout.ts#L30", lee: 0, tabla: "tabla-pagos" }]);
    expect(checkout.cuerpo).not.toContain("brain:backlinks");
    expect(generados["_build/funcionalidades.json"]).toContain('"feat-carrito"');
    expect(renderViewer(compile(conFuncionalidades()).graph, "/* lib */", funcionalidades)).toContain('"usaFuncionalidades"');
  });

  it("codigo con formato inválido o en una página que no es feat falla", () => {
    expect(() => compile(conFuncionalidades("repo-tienda:apps/bff#L3"))).toThrow(CompileError);
    expect(() => compile(conFuncionalidades("repo-noexiste:src"))).toThrow(/repo inexistente/);
    const mal = { ...base, paginas: base.paginas.map((p) => (p.ruta === "tecnologia/svc-bff.md" ? { ...p, contenido: p.contenido.replace("vive_en:", "codigo: [\"repo-tienda:apps\"]\nvive_en:") } : p)) };
    expect(() => compile(mal)).toThrow(/codigo solo aplica a feat/);
  });
});

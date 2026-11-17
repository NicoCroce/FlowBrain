import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compile, leerEntradas, type Entradas } from "@flowbrain/core";
import { mapa3dDelGrafo, renderViewer } from "../src/index.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");

let base: Entradas;
beforeAll(async () => {
  base = await leerEntradas(FIXTURE);
});

/** feat-checkout con `codigo` en el BFF, una feat-carrito en la web y una extracción que conecta ambas. */
function conFuncionalidades(codigoCheckout = "repo-tienda:apps/bff/src/routes"): Entradas {
  const paginas = base.paginas.map((p) =>
    p.ruta === "product/feat-checkout.md" ? { ...p, contenido: p.contenido.replace("verificado: 2026-11-15\n", `verificado: 2026-11-15\ncodigo:\n  - ${codigoCheckout}\n`) } : p,
  );
  paginas.push({
    ruta: "product/feat-carrito.md",
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
  return { ...base, paginas, extracciones: [{ ruta: "_build/extraction/repo-tienda.json", contenido: JSON.stringify(extraccion) }] };
}


describe("visor: funcionalidades, dependencias y mapa 3D", () => {
  it("el visor embebe las fichas de las funcionalidades", () => {
    const { graph, funcionalidades } = compile(conFuncionalidades());
    expect(renderViewer(graph, "/* lib */", funcionalidades)).toContain('"usaFuncionalidades"');
  });

  it("el visor embebe las dependencias y las vistas de mapa e impacto", () => {
    const { graph, funcionalidades } = compile(conFuncionalidades());
    const html = renderViewer(graph, "/* lib */", funcionalidades);
    expect(html).toContain('"dependencias":[[');
    expect(html).toContain('href="#/impacto"');
    expect(html).toContain('href="#/grafo"');
    expect(html).toContain("function impacto(deps, origen)");
  });

  it("el mapa 3D cuelga endpoints, tablas y archivos de su funcionalidad o de su servicio", () => {
    const { graph, funcionalidades } = compile(conFuncionalidades());
    const m = mapa3dDelGrafo(graph, funcionalidades);
    const ep = "svc-bff:POST:/checkout", archivo = "repo-tienda:apps/bff/src/routes/checkout.ts";
    expect(m.padres.feat[ep]).toBe("feat-checkout");
    expect(m.padres.svc[ep]).toBe("svc-bff");
    expect(m.padres.feat[archivo]).toBe(ep);
    expect(m.padres.feat["repo-tienda:apps/web/src/main.tsx"]).toBe("feat-carrito");
    expect(m.padres.feat["repo-tienda:apps/payments/src/main.ts"]).toBe("repo-tienda");
    expect(m.padres.feat["tabla-pagos"]).toBe("feat-checkout");
    expect(m.padres.svc["tabla-pagos"]).toBe("db-tienda");
    expect(m.padres.feat["svc-bff"]).toBe("repo-tienda");
    // Las llamadas se cuentan por endpoint y cada relación aparece una vez, con sus veces.
    expect(m.aristas).toContainEqual(["svc-web", ep, "llama_a", 1]);
    expect(m.aristas).toContainEqual(["feat-carrito", ep, "llama_a", 2]);
    expect(m.aristas).toContainEqual([ep, archivo, "recorrido", 1]);
    expect(m.aristas.filter((a) => a[0] === "svc-bff" && a[1] === ep && a[2] === "contiene")).toHaveLength(1);
    const claves = m.aristas.map((a) => a.slice(0, 3).join(" "));
    expect(new Set(claves).size).toBe(claves.length);
    expect([...claves].sort()).toEqual(claves);
    // El uso no cuenta contiene ni vive_en.
    expect(m.uso["repo-tienda"]).toBe(0);
    expect(m.uso[ep]).toBe(m.aristas.filter((a) => (a[0] === ep || a[1] === ep) && a[2] !== "contiene").reduce((s, a) => s + a[3], 0));
    expect(m.uso).not.toHaveProperty("contrato-svc-bff");
  });

});

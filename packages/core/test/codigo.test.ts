import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compile, ConsultaError, contextoDeSalidas, funcionalidad, impactoDe, leerEntradas, quienLlama, recorrido, tokens, type Contexto, type Contrato } from "../src/index.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");

let ctx: Contexto;
let sinIndice: Contexto;
beforeAll(async () => {
  const base = await leerEntradas(FIXTURE);
  const paginas = base.paginas.map((p) =>
    p.ruta === "producto/feat-checkout.md" ? { ...p, contenido: p.contenido.replace("verificado: 2026-11-15\n", "verificado: 2026-11-15\ncodigo:\n  - repo-tienda:apps/bff/src\n") } : p,
  );
  paginas.push({ ruta: "producto/feat-carrito.md", contenido: "---\nid: feat-carrito\ntipo: feat\nnombre: Carrito\nresumen: Arma el pedido.\ncodigo: [\"repo-tienda:apps/web/src\"]\n---\n# Carrito\n" });
  const extraccion = JSON.stringify({
    aristas: [
      { dato: null, desde: "svc-web", endpoint: "svc-bff:POST:/checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L8", hasta: "svc-bff", origen: "parser", verbo: "llama_a" },
      { dato: null, desde: "svc-bff", endpoint: "svc-payments:POST:/payments", evidencia: "repo-tienda:apps/bff/src/clients/payments.ts#L11", hasta: "svc-payments", origen: "parser", verbo: "llama_a" },
      { dato: "Pago", desde: "svc-bff", endpoint: null, evidencia: "repo-tienda:apps/bff/src/routes/checkout.ts#L16", hasta: "tabla-pagos", origen: "parser", verbo: "escribe_en" },
    ],
    pendientes: [],
    repo: "repo-tienda",
    servicios: [],
  });
  const entradas = { ...base, paginas, extracciones: [{ ruta: "_build/extraccion/repo-tienda.json", contenido: extraccion }] };
  const contratos = base.contratos.map((c) => JSON.parse(c.contenido) as Contrato);
  const salidas = compile(entradas);
  ctx = contextoDeSalidas(salidas, contratos, { archivos: base.archivos.map((a) => a.contenido), extracciones: [extraccion] });
  sinIndice = contextoDeSalidas(salidas, contratos);
});

describe("consultas de código", () => {
  it("recorrido desde un endpoint: método que lo atiende y lo que toca cada paso", () => {
    const r = recorrido(ctx, { desde: "POST /checkout" }) as { atiende: string; pasos: Array<{ n: number; simbolo: string; ev: string; toca?: string[] }> };
    expect(r.atiende).toBe("postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L14");
    expect(r.pasos).toEqual([
      { n: 0, simbolo: "postCheckout", ev: "repo-tienda:apps/bff/src/routes/checkout.ts#L14", toca: ["escribe_en tabla-pagos"] },
      { n: 1, simbolo: "crearPago", ev: "repo-tienda:apps/bff/src/clients/payments.ts#L10", toca: ["llama_a svc-payments:POST:/payments"] },
    ]);
  });

  it("quien_llama sube por las invocaciones y dice qué endpoints y funcionalidades alcanza", () => {
    const r = quienLlama(ctx, { simbolo: "crearPago" });
    expect(r.llamadas).toEqual([{ nivel: 1, quien: "postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L15", llama_a: "crearPago" }]);
    expect(r.endpoints).toEqual(["svc-bff:POST:/checkout"]);
    expect(r.funcionalidades).toEqual(["feat-checkout"]);
    expect(r.consumenEsosEndpoints).toEqual(["feat-carrito"]);
  });

  it("impacto de una tabla: funcionalidades por niveles con el porqué y qué métodos la tocan", () => {
    const r = impactoDe(ctx, { pieza: "tabla-pagos" }) as { funcionalidades: Array<{ id: string; nivel: number; porque: string }>; tocadaPor: Array<{ quien: string; verbo: string }> };
    expect(r.funcionalidades.map((f) => `${f.nivel} ${f.id}: ${f.porque}`)).toEqual(["1 feat-checkout: escribe en tabla-pagos", "2 feat-carrito: usa feat-checkout, que escribe en tabla-pagos"]);
    expect(r.tocadaPor).toEqual([{ verbo: "escribe_en", quien: "postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L14", ev: "repo-tienda:apps/bff/src/routes/checkout.ts#L16" }]);
    // Un símbolo de código delega en quien_llama.
    expect(impactoDe(ctx, { pieza: "crearPago" })).toMatchObject({ endpoints: ["svc-bff:POST:/checkout"] });
  });

  it("funcionalidad por sufijo o nombre, con el método que atiende cada endpoint", () => {
    const r = funcionalidad(ctx, { id: "checkout" }) as { id: string; expone: unknown[]; usadaPor: string[] };
    expect(r.id).toBe("feat-checkout");
    expect(r.expone).toEqual([{ endpoint: "svc-bff:POST:/checkout", atiende: "postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L14" }]);
    expect(r.usadaPor).toEqual(["feat-carrito"]);
    expect(() => funcionalidad(ctx, { id: "chekout" })).toThrow(/no existe la funcionalidad/);
  });

  it("respeta el presupuesto y avisa cuando recorta; sin índice de código, error claro", () => {
    for (const r of [funcionalidad(ctx, { id: "checkout", budget_tokens: 120 }), quienLlama(ctx, { simbolo: "crearPago", budget_tokens: 120 })]) {
      expect(tokens(r)).toBeLessThanOrEqual(Math.ceil(120 * 1.05) + 60);
    }
    expect(() => recorrido(sinIndice, { desde: "POST /checkout" })).toThrow(ConsultaError);
    expect(() => quienLlama(ctx, { simbolo: "noExiste" })).toThrow(/no existe el símbolo/);
  });
});

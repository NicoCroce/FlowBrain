import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buscarNodo,
  compile,
  ConsultaError,
  contextoDeSalidas,
  contratoDe,
  leerEntradas,
  recorrerGrafo,
  stringifyCanonical,
  tokens,
  trazar,
  type Contexto,
  type Contrato,
  type Proyeccion,
} from "../src/index.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");
const CONSULTAS = join(FIXTURE, "expected/consultas");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

let ctx: Contexto;
beforeAll(async () => {
  const entradas = await leerEntradas(FIXTURE);
  const contratos = entradas.contratos.map((c) => JSON.parse(c.contenido) as Contrato);
  ctx = contextoDeSalidas(compile(entradas), contratos);
});

async function golden(nombre: string, valor: unknown) {
  const ruta = join(CONSULTAS, `${nombre}.json`);
  const actual = stringifyCanonical(valor);
  if (UPDATE) {
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, actual, "utf8");
  }
  expect(actual).toBe(await readFile(ruta, "utf8"));
}

/** Casos golden: nombre → consulta. El mismo catálogo lo usan los tests de las otras puertas. */
export const CASOS: Record<string, (c: Contexto) => unknown> = {
  "buscar-pagos": (c) => buscarNodo(c, { texto: "pagos" }),
  "buscar-difusa-pasarla": (c) => buscarNodo(c, { texto: "pasarla" }),
  "buscar-tipo-endpoint": (c) => buscarNodo(c, { texto: "POST", tipos: ["endpoint"] }),
  "recorrer-payments-depende-in": (c) => recorrerGrafo(c, { nodo: "svc-payments", verbos: ["depende_de"], direccion: "in" }),
  "recorrer-payments-depende-in-p2": (c) =>
    recorrerGrafo(c, { nodo: "svc-payments", verbos: ["depende_de"], direccion: "in", profundidad: 2 }),
  "recorrer-bff-relaciones": (c) => recorrerGrafo(c, { nodo: "svc-bff", direccion: "both", proyeccion: "relaciones" }),
  "contrato-bff": (c) => contratoDe(c, { nodo: "svc-bff" }),
  "contrato-payments-webhook": (c) => contratoDe(c, { nodo: "svc-payments", endpoint: "POST /webhooks/pasarela" }),
  "trazar-checkout": (c) => trazar(c, { desde: "/checkout" }),
  "trazar-checkout-hasta-tabla": (c) => trazar(c, { desde: "/checkout", hasta: "tabla-pagos" }),
  "trazar-archivo-cliente-payments": (c) => trazar(c, { desde: "apps/bff/src/clients/payments.ts" }),
  "completo-payments-budget-300": (c) => recorrerGrafo(c, { nodo: "svc-payments", proyeccion: "completo", budget_tokens: 300 }),
};

describe("golden de las cuatro herramientas", () => {
  for (const [nombre, consulta] of Object.entries(CASOS)) {
    it(nombre, async () => golden(nombre, consulta(ctx)));
  }
});

describe("criterios de aceptación", () => {
  it("trazar --from /checkout devuelve los 5 saltos esperados, con evidencia y tipos", () => {
    const r = trazar(ctx, { desde: "/checkout" });
    expect(r.saltos.map((s) => [s.nivel, s.desde, s.hasta, s.verbo, s.dato, s.confianza, s.evidencia])).toEqual([
      [1, "svc-web", "svc-bff", "llama_a", "CheckoutRequest → CheckoutResponse", 0.5, "repo-tienda:apps/web/src/api/checkout.ts#L9"],
      [2, "svc-bff", "svc-payments", "llama_a", "CrearPagoRequest → Pago", 0.9, "repo-tienda:apps/bff/src/clients/payments.ts#L11"],
      [3, "svc-payments", "ext-pasarela", "llama_a", "CargoPasarela", 0.9, "repo-tienda:apps/payments/src/clients/pasarela.ts#L8"],
      [3, "svc-payments", "tabla-pagos", "escribe_en", "Pago", 0.9, "repo-tienda:apps/payments/src/routes/payments.ts#L21"],
      [4, "ext-pasarela", "svc-payments", "llama_a", "EventoPasarela → null", 1, "repo-tienda:apps/payments/src/routes/webhooks.ts#L7"],
    ]);
    expect(r.truncado).toBe(false);
  });

  it("recorrer_grafo svc-payments depende_de in: mismo conjunto ordenado en 10 ejecuciones", () => {
    const corrida = () => recorrerGrafo(ctx, { nodo: "svc-payments", verbos: ["depende_de"], direccion: "in" });
    const base = stringifyCanonical(corrida());
    expect(corrida().nodos.map((n) => n.id)).toEqual(["svc-payments", "ext-pasarela", "svc-bff", "svc-bff:POST:/checkout"]);
    for (let i = 0; i < 10; i++) expect(stringifyCanonical(corrida())).toBe(base);
  });

  it("toda herramienta respeta budget_tokens con margen del 5%", () => {
    const proyecciones: Proyeccion[] = ["resumen", "relaciones", "contrato", "completo"];
    const consultas = (p: Proyeccion, b: number) => [
      buscarNodo(ctx, { texto: "s", proyeccion: p, budget_tokens: b }),
      recorrerGrafo(ctx, { nodo: "svc-payments", direccion: "both", profundidad: 3, proyeccion: p, budget_tokens: b }),
      contratoDe(ctx, { nodo: "svc-payments", proyeccion: p, budget_tokens: b }),
      trazar(ctx, { desde: "/checkout", proyeccion: p, budget_tokens: b }),
    ];
    for (const b of [200, 300, 500, 800, 1500, 3000]) {
      for (const p of proyecciones) {
        for (const r of consultas(p, b)) {
          expect(tokens(r), `${r.herramienta} ${p} budget=${b}`).toBeLessThanOrEqual(Math.floor(b * 1.05));
        }
      }
    }
  });

  it("el recorte sigue el orden prosa → endpoints → aristas", () => {
    const completo = recorrerGrafo(ctx, { nodo: "svc-payments", proyeccion: "completo", budget_tokens: null });
    const t = tokens(completo);
    const sinProsa = recorrerGrafo(ctx, { nodo: "svc-payments", proyeccion: "completo", budget_tokens: t - 5 });
    expect(sinProsa.omitidos).toEqual({ aristas: 0, endpoints: 0, nodos: 0, prosa: 1, saltos: 0 });
    expect(sinProsa.nodos[0]!.endpoints).toBeDefined();
  });
});

describe("errores de consulta", () => {
  it("nodo inexistente y parámetros inválidos", () => {
    expect(() => recorrerGrafo(ctx, { nodo: "svc-nada" })).toThrow(ConsultaError);
    expect(() => recorrerGrafo(ctx, { nodo: "svc-bff", profundidad: 6 })).toThrow(/profundidad/);
    expect(() => recorrerGrafo(ctx, { nodo: "svc-bff", verbos: ["invoca_a"] })).toThrow(/unknown verbo/);
    expect(() => contratoDe(ctx, { nodo: "tabla-pagos" })).toThrow(/requires a svc/);
    expect(() => trazar(ctx, { desde: "/no-existe" })).toThrow(/no endpoint matches/);
  });
});

import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ejecutar } from "../src/main.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");
const CONSULTAS = join(FIXTURE, "expected/consultas");

let raiz: string;
beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), "brain-cli-"));
  for (const d of ["producto", "tecnologia", "_build"]) await cp(join(FIXTURE, d), join(raiz, d), { recursive: true });
  const r = await ejecutar(["compile", "--raiz", raiz]);
  expect(r.codigo).toBe(0);
});
afterAll(async () => {
  await rm(raiz, { recursive: true, force: true });
});

const golden = (nombre: string) => readFile(join(CONSULTAS, `${nombre}.json`), "utf8");

describe("brain CLI produce el mismo JSON que el motor", () => {
  const casos: Array<[string, string[]]> = [
    ["trazar-checkout", ["trazar", "--desde", "/checkout"]],
    ["trazar-checkout-hasta-tabla", ["trazar", "--desde", "/checkout", "--hasta", "tabla-pagos"]],
    ["recorrer-payments-depende-in", ["recorrer", "svc-payments", "--verbos", "depende_de", "--direccion", "in"]],
    ["buscar-pagos", ["buscar", "pagos"]],
    ["contrato-bff", ["contrato", "svc-bff"]],
    ["completo-payments-budget-300", ["recorrer", "svc-payments", "--proyeccion", "completo", "--budget", "300"]],
  ];
  for (const [nombre, args] of casos) {
    it(nombre, async () => {
      const r = await ejecutar([...args, "--raiz", raiz]);
      expect(r.codigo).toBe(0);
      expect(r.stdout).toBe(await golden(nombre));
    });
  }

  it("una segunda compilación no escribe nada", async () => {
    const r = await ejecutar(["compile", "--raiz", raiz]);
    expect(r.stdout).toContain("0 archivos escritos");
  });

  it("errores de consulta salen como JSON con código 2", async () => {
    const r = await ejecutar(["recorrer", "svc-nada", "--raiz", raiz]);
    expect(r.codigo).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({ error: { codigo: "nodo_inexistente", mensaje: "no existe el nodo: svc-nada" } });
  });

  it("comando desconocido", async () => {
    const r = await ejecutar(["volar", "--raiz", raiz]);
    expect(r.codigo).toBe(2);
    expect(r.stderr).toContain("comando desconocido");
  });
});

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compile, compileDir, nodosSinVerificar, verificarAristas, verifyDir, type Graph, type GraphEdge } from "../src/index.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const F = (p: string) => join(RAIZ, "fixtures", p);

let dir: string;
let brain: string;
let clon: string;
const HOY = "2026-11-16";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-verify-"));
  brain = join(dir, "brain");
  clon = join(dir, "clones/tienda");
  for (const d of ["producto", "tecnologia", "_build"]) await cp(F(`checkout/${d}`), join(brain, d), { recursive: true });
  await cp(F("repos/tienda"), clon, { recursive: true });
  await compileDir(brain);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const graph = async () => JSON.parse(await readFile(join(brain, "_build/graph.json"), "utf8")) as Graph;
const estado = async (desde: string, hasta: string) => (await graph()).edges.find((e) => e.desde === desde && e.hasta === hasta)?.estado;

describe("brain verify", () => {
  it("sobre el oráculo y su repo: todo vigente y graph.json sin cambios", async () => {
    const antes = await readFile(join(brain, "_build/graph.json"), "utf8");
    const r = await verifyDir(brain, { carpetas: [join(dir, "clones")], hoy: HOY });
    expect(r.verificadas).toBeGreaterThan(0);
    expect(r.dudosas).toEqual([]);
    expect(r.noVerificables).toEqual([]);
    expect(await readFile(join(brain, "_build/graph.json"), "utf8")).toBe(antes);
  });

  it("marca dudoso tras borrar el archivo de evidencia; nuevas solo la primera vez; recupera al volver", async () => {
    const archivo = join(clon, "apps/payments/src/clients/pasarela.ts");
    const original = await readFile(archivo, "utf8");
    await rm(archivo);
    const r1 = await verifyDir(brain, { repos: { "repo-tienda": clon }, hoy: HOY });
    expect(r1.nuevas.map((d) => [d.desde, d.verbo, d.hasta, d.motivo])).toEqual([
      ["svc-payments", "llama_a", "ext-pasarela", "archivo inexistente"],
      // La relación fina del endpoint cita la misma línea: cae con ella.
      ["svc-payments:POST:/payments", "llama_a", "ext-pasarela", "archivo inexistente"],
    ]);
    expect(await estado("svc-payments", "ext-pasarela")).toBe("dudoso");

    const r2 = await verifyDir(brain, { repos: { "repo-tienda": clon }, hoy: HOY });
    expect(r2.nuevas).toEqual([]);
    expect(r2.dudosas).toHaveLength(2);

    await writeFile(archivo, original);
    const r3 = await verifyDir(brain, { repos: { "repo-tienda": clon }, hoy: HOY });
    expect(r3.recuperadas).toHaveLength(2);
    expect(r3.dudosas).toEqual([]);
    expect(await estado("svc-payments", "ext-pasarela")).toBe("vigente");
  });

  it("detecta que la línea citada ya no contiene el símbolo registrado", async () => {
    const e = (evidencia: string): GraphEdge => ({ confianza: 0.9, dato: null, desde: "svc-a", endpoint: null, estado: "vigente", evidencia, hasta: "svc-b", origen: "parser", verbo: "llama_a" });
    const g: Graph = { edges: [e("repo-x:src/a.ts#L2"), e("repo-x:src/a.ts#L3"), e("repo-x:src/a.ts#L9")], nodes: [], version: 1 };
    const simbolos = new Map([["repo-x:src/a.ts", new Map([[2, ["cobrar"]], [3, ["pagar"]]])]]);
    const r = await verificarAristas(g, async () => ["// arriba", "export function cobrar() {}", "// la función se movió"], simbolos);
    expect(r.dudosas.map((d) => [d.evidencia, d.motivo])).toEqual([
      ["repo-x:src/a.ts#L3", "la línea 3 ya no contiene `pagar`"],
      ["repo-x:src/a.ts#L9", "línea 9 fuera del archivo (3 líneas)"],
    ]);
  });

  it("sin clon local no verifica ni pierde dudosas previas", async () => {
    await rm(join(clon, "apps/payments/src/clients/pasarela.ts"));
    await verifyDir(brain, { repos: { "repo-tienda": clon }, hoy: HOY });
    const r = await verifyDir(brain, { hoy: HOY });
    expect(r.verificadas).toBe(0);
    expect(r.noVerificables).toEqual([{ aristas: 11, repo: "repo-tienda" }]);
    expect(r.dudosas).toHaveLength(2);
    expect(r.nuevas).toEqual([]);
  });

  it("deprecado (lo marca un humano) manda sobre dudoso", async () => {
    const pagina = join(brain, "tecnologia/svc-payments.md");
    await writeFile(pagina, (await readFile(pagina, "utf8")).replace("#L8\", origen: parser }", "#L8\", origen: parser, estado: deprecado }"));
    await rm(join(clon, "apps/payments/src/clients/pasarela.ts"));
    const r = await verifyDir(brain, { repos: { "repo-tienda": clon }, hoy: HOY });
    // Solo queda dudosa la relación fina del endpoint, que nadie deprecó.
    expect(r.dudosas.map((d) => d.desde)).toEqual(["svc-payments:POST:/payments"]);
    expect(await estado("svc-payments", "ext-pasarela")).toBe("deprecado");
  });

  it("una verificación con formato inválido hace fallar compile con un mensaje claro", () => {
    expect(() => compile({ paginas: [], contratos: [], archivos: [], verificacion: { ruta: "_build/verificacion.json", contenido: '{"x":1}' } })).toThrow(/verificación con formato inválido/);
  });
});

describe("nodosSinVerificar", () => {
  it("lista páginas con verificado nulo o anterior a N días", async () => {
    const g = await graph();
    expect(nodosSinVerificar(g, "2026-11-16", 90)).toEqual([]);
    expect(nodosSinVerificar(g, "2027-03-01", 90).length).toBe(g.nodes.filter((n) => n.pagina !== null).length);
  });
});

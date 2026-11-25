import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile, compileDir, CompileError, formatError, leerEntradas, type Entradas } from "../src/index.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");
const EXPECTED = join(FIXTURE, "expected");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

let entradas: Entradas;
beforeAll(async () => {
  entradas = await leerEntradas(FIXTURE);
});

/** Compara contra un golden. Con UPDATE_GOLDEN=1 lo reescribe (nunca graph.json: es el oráculo a mano). */
async function golden(rel: string, actual: string) {
  const ruta = join(EXPECTED, rel);
  if (UPDATE && rel !== "graph.json") {
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, actual, "utf8");
  }
  expect(actual).toBe(await readFile(ruta, "utf8"));
}

function conPagina(base: Entradas, ruta: string, cambiar: (s: string) => string): Entradas {
  let tocada = false;
  const paginas = base.paginas.map((p) => {
    if (p.ruta !== ruta) return p;
    tocada = true;
    return { ruta, contenido: cambiar(p.contenido) };
  });
  if (!tocada) paginas.push({ ruta, contenido: cambiar("") });
  return { ...base, paginas };
}

function erroresDe(e: Entradas): string[] {
  try {
    compile(e);
  } catch (err) {
    if (err instanceof CompileError) return err.errores.map(formatError);
    throw err;
  }
  throw new Error("se esperaba CompileError");
}

describe("compile(fixtures/checkout)", () => {
  it("graph.json coincide byte a byte con el oráculo escrito a mano", async () => {
    const s = compile(entradas);
    expect(s.generados["_build/graph.json"]).toBe(await readFile(join(EXPECTED, "graph.json"), "utf8"));
  });

  it("backlinks.json, INDEX.md y map.mmd coinciden con sus golden", async () => {
    const s = compile(entradas);
    await golden("backlinks.json", s.generados["_build/backlinks.json"]!);
    await golden("INDEX.md", s.generados["INDEX.md"]!);
    await golden("map.mmd", s.generados["_build/map.mmd"]!);
  });

  it("las páginas con backlinks inyectados coinciden con sus golden", async () => {
    const s = compile(entradas);
    for (const [ruta, contenido] of Object.entries(s.paginas)) await golden(join("paginas", ruta), contenido);
  });

  it("es idempotente: recompilar las páginas ya inyectadas no cambia nada", () => {
    const a = compile(entradas);
    const segunda: Entradas = { ...entradas, paginas: Object.entries(a.paginas).map(([ruta, contenido]) => ({ ruta, contenido })) };
    const b = compile(segunda);
    expect(b.generados).toEqual(a.generados);
    expect(b.paginas).toEqual(a.paginas);
  });

  it("no depende del orden de las entradas", () => {
    const a = compile(entradas);
    const b = compile({
      paginas: [...entradas.paginas].reverse(),
      contratos: [...entradas.contratos].reverse(),
      archivos: [...entradas.archivos].reverse(),
      extracciones: [...(entradas.extracciones ?? [])].reverse(),
    });
    expect(b.generados).toEqual(a.generados);
  });

  it("10 compilaciones consecutivas dan la misma salida", () => {
    const base = JSON.stringify(compile(entradas).generados);
    for (let i = 0; i < 10; i++) expect(JSON.stringify(compile(entradas).generados)).toBe(base);
  });
});

describe("compileDir", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "brain-compile-"));
    for (const d of ["product", "technology", "_build"]) await cp(join(FIXTURE, d), join(dir, d), { recursive: true });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("la segunda corrida no escribe ningún archivo", async () => {
    const primera = await compileDir(dir);
    expect(primera.escritos).toContain("_build/graph.json");
    expect(primera.escritos).toContain("technology/svc-payments.md");
    const segunda = await compileDir(dir);
    expect(segunda.escritos).toEqual([]);
  });
});

describe("errores ruidosos con archivo y línea", () => {
  const BFF = "technology/svc-bff.md";

  it("verbo desconocido", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace("verbo: llama_a, destino: svc-payments", "verbo: invoca_a, destino: svc-payments"));
    expect(erroresDe(e)).toEqual([`${BFF}:18: unknown verbo: "invoca_a"`]);
  });

  it("destino inexistente", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace("destino: svc-payments", "destino: svc-cobros"));
    expect(erroresDe(e)).toEqual([`${BFF}:18: nonexistent target: svc-cobros`]);
  });

  it("par de tipos no admitido por el verbo", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace("verbo: implementa, destino: feat-checkout", "verbo: implementa, destino: tabla-pagos"));
    expect(erroresDe(e)).toEqual([`${BFF}:19: implementa does not allow svc → tabla`]);
  });

  it("verbo reservado al compilador", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace("verbo: implementa, destino: feat-checkout", "verbo: expone, destino: svc-bff:contrato"));
    expect(erroresDe(e)).toEqual([`${BFF}:19: expone is generated by the compiler; it is not written in pages`]);
  });

  it("endpoint inexistente en el contrato", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace('endpoint: "POST /payments"', 'endpoint: "GET /payments"'));
    expect(erroresDe(e)).toEqual([`${BFF}:18: endpoint not in the contract of svc-payments: GET /payments`]);
  });

  it("evidencia con ruta absoluta o repo inexistente", () => {
    const abs = conPagina(entradas, BFF, (s) => s.replace("repo-tienda:apps/bff/src/clients", "repo-tienda:/apps/bff/src/clients"));
    expect(erroresDe(abs)[0]).toMatch(/svc-bff\.md:18: relaciones\[0\]: evidence with invalid format/);
    const repo = conPagina(entradas, BFF, (s) => s.replace("repo-tienda:apps/bff/src/clients", "repo-otro:apps/bff/src/clients"));
    expect(erroresDe(repo)).toEqual([`${BFF}:18: relaciones[0]: the evidence cites a nonexistent repo: repo-otro`]);
  });

  it("arista de parser sin evidencia", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace(', evidencia: "repo-tienda:apps/bff/src/clients/payments.ts#L11"', ""));
    expect(erroresDe(e)).toEqual([`${BFF}:18: an edge with origen parser requires evidence`]);
  });

  it("campo desconocido y enum inválido", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace("estado: vigente", "estado: activo\ncolor: azul"));
    expect(erroresDe(e)).toEqual([
      `${BFF}:7: estado: invalid value "activo"; expected one of: vigente, dudoso, deprecado`,
      `${BFF}:8: unknown field: color`,
    ]);
  });

  it("id que no coincide con el archivo, y id duplicado", () => {
    const mal = conPagina(entradas, "technology/svc-otro.md", () =>
      "---\nid: svc-bff\ntipo: svc\nnombre: Otro\nresumen: Duplicado.\n---\n",
    );
    expect(erroresDe(mal)).toEqual([
      `technology/svc-otro.md:2: duplicate id: svc-bff`,
      `technology/svc-otro.md:2: id "svc-bff" does not match the file name`,
    ]);
  });

  it("vive_en dentro de relaciones", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace("verbo: implementa, destino: feat-checkout", "verbo: vive_en, destino: repo-tienda"));
    expect(erroresDe(e)).toEqual([`${BFF}:19: vive_en is written as a top-level field, not in relaciones`]);
  });

  it("YAML inválido", () => {
    const e = conPagina(entradas, BFF, (s) => s.replace("nombre: BFF de la tienda", "nombre: [sin cerrar"));
    expect(erroresDe(e).some((m) => /^technology\/svc-bff\.md:\d+: invalid YAML/.test(m))).toBe(true);
  });
});

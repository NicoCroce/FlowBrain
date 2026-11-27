import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarContexto, fidelidadDeArchivos, leerRegistro } from "@flowbrain/core";
import { crearAgente, fidelidadResuelta, indicacionesDelPedido, pedidoDeTandaFidelidad, permisosDelPedido, TANDA_MAX_FIDELIDAD, type ArchivoDeFidelidad } from "../src/agente.js";
import { aplicarCerebro } from "../src/cerebros.js";
import { ejecutar } from "../src/main.js";
import { claudeCode } from "../src/proveedores.js";
import { crearServidorVisor, type ServidorVisor } from "../src/servidor-visor.js";

/**
 * Los pedidos de Fidelidad en lote (dec. 231): archivos con lo que les falta para llegar a 100. Las tandas de un cerebro
 * van una detrás de otra, armadas por repo; al terminar cada una el servidor reindexa el cerebro (así entra
 * `calls.yaml`) y mide qué faltas pedidas ya no están. Dos archivos iguales: `avisos.ts` y `deja.ts`, cada uno con una
 * llamada sin resolver (L4) y una llamada HTTP sin ruta (L5). El agente falso declara las de `avisos.ts` en `calls.yaml`
 * y deja las de `deja.ts`.
 */
let dir: string, reg: string, s: ServidorVisor;
const R = "repo-tienda-api", AVISOS = `${R}:src/avisos.ts`, DEJA = `${R}:src/deja.ts`;
const w = async (ruta: string, lineas: string[]) => {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), lineas.join("\n") + "\n");
};
function pedir(metodo: string, ruta: string, cuerpo?: unknown): Promise<{ estado: number; json: Record<string, unknown> }> {
  const puerto = (s.server.address() as { port: number }).port;
  const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
  return new Promise((ok, mal) => {
    const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { host: `127.0.0.1:${puerto}`, "x-flowbrain-token": s.token, ...(datos ? { "content-type": "application/json" } : {}) } }, (res) => {
      let t = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (t += c));
      res.on("end", () => {
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(t) as Record<string, unknown>; } catch { /* html */ }
        ok({ estado: res.statusCode ?? 0, json });
      });
    });
    req.on("error", mal);
    req.end(datos ?? undefined);
  });
}
type Tr = Record<string, any>;
async function esperarLote(id: string): Promise<{ lote: Tr; trabajos: Tr[] }> {
  for (let i = 0; i < 900; i++) {
    const e = (await pedir("GET", "/api/agente")).json as { trabajos: Tr[]; lotes: Tr[] };
    const lote = e.lotes.find((l) => l["id"] === id);
    if (lote?.["estado"] === "terminado") return { lote, trabajos: e.trabajos.filter((t) => t["lote"] === id) };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("el lote no terminó");
}
// Lo que mide el visor de cada archivo, como lo manda la pantalla.
async function pedidoDe(archivo: string): Promise<ArchivoDeFidelidad> {
  const a = fidelidadDeArchivos(await cargarContexto(join(reg, "tienda"))).archivos.find((x) => x.archivo === archivo)!;
  return { cerebro: "tienda", archivo, puntaje: a.puntaje, tareas: a.tareas.map((t) => ({ signal: t.signal, que: t.que, lineas: t.lineas })) };
}
const archivo = (nombre: string) => [
  "const destinos: Record<string, string> = {};",
  `export async function ${nombre}(pedido: { canal: string }) {`,
  "  const servicio: any = pedido;",
  "  servicio.registrar(pedido);",
  '  await fetch(destinos[pedido.canal]!, { method: "POST" });',
  "}",
  "export function registrar(pedido: unknown) {",
  "  return pedido;",
  "}",
];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-fidelidad-"));
  reg = join(dir, "registro");
  await mkdir(reg, { recursive: true });
  await w("repos/tienda-api/package.json", ['{ "name": "tienda-api", "dependencies": { "express": "4" } }']);
  await w("repos/tienda-api/src/avisos.ts", archivo("avisar"));
  await w("repos/tienda-api/src/deja.ts", archivo("dejar"));
  await writeFile(join(reg, "flowbrain.yaml"), ["version: 1", "cerebros:", "  - nombre: tienda", "    repos: [{ ruta: ../repos/tienda-api }]", ""].join("\n"));
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);

  // El agente falso: anota lo que recibió y, por cada archivo «avisos» del plan, declara sus dos llamadas en calls.yaml.
  const falso = join(dir, "claude-falso.mjs");
  await writeFile(falso, [
    "#!/usr/bin/env node",
    'import { appendFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const a = process.argv.slice(2);",
    'if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }',
    'const prompt = a[a.indexOf("-p") + 1];',
    "const archivos = [...prompt.matchAll(/^### (\\S+) \\(\\d+\\/100\\)/gm)].map((m) => m[1]);",
    "const desde = Date.now();",
    "await new Promise((r) => setTimeout(r, 150));",
    `appendFileSync(${JSON.stringify(join(dir, "tandas.jsonl"))}, JSON.stringify({ archivos, desde, hasta: Date.now(), args: a, prompt }) + "\\n");`,
    `if (archivos.includes(${JSON.stringify(AVISOS)})) writeFileSync(join(process.env.FLOWBRAIN_ROOT, "tienda", "calls.yaml"), ${JSON.stringify([
      "llamadas:",
      `  - { desde: "${AVISOS}#avisar", linea: 4, hacia: "${AVISOS}#registrar", origen: modelo }`,
      "http:",
      `  - { desde: "${AVISOS}#avisar", linea: 5, metodo: POST, ruta: "/avisos", origen: modelo }`,
      "",
    ].join("\n"))});`,
    'console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "avisos.ts reached 100; deja.ts left.", total_cost_usd: 0.04 }));',
  ].join("\n"));
  await chmod(falso, 0o755);
  s = crearServidorVisor(reg, {
    agente: crearAgente(() => leerRegistro(reg), { proveedores: [claudeCode(falso)], reindexar: async (n) => void (await aplicarCerebro((await leerRegistro(reg)).cerebro(n)!)) }),
  });
  await new Promise<void>((ok) => s.server.listen(0, "127.0.0.1", ok));
}, 120_000);
afterAll(async () => {
  await new Promise((ok) => s.server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

const leerLog = async () => (await readFile(join(dir, "tandas.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { archivos: string[]; desde: number; hasta: number; args: string[]; prompt: string });

describe("tandas de fidelidad", () => {
  it("el pedido de una tanda es el plan de flowbrain fidelity --plan, con su cerebro y su tanda, en inglés", async () => {
    const p = pedidoDeTandaFidelidad([await pedidoDe(AVISOS)], R, "tienda", 2, 3);
    expect(p).toContain("# Fidelity plan");
    expect(p).toContain("## Rules");
    expect(p).toContain("Edit only brain files (pages, `calls.yaml`, extractors). Never the project code.");
    expect(p).toContain("- **llamadas**: Open the file at the given line");
    expect(p).toContain(`### ${AVISOS} (0/100)`);
    expect(p).toContain("- [ ] http:");
    expect(p).toContain("(L5)");
    expect(p).toContain("brain tienda");
    expect(p).toContain("`flowbrain brains apply tienda`");
    expect(p).toContain("batch 2 of 3");
    expect(p).toContain("## When done");
    // La guía pone los límites y envuelve el plan.
    const g = indicacionesDelPedido("fidelidad", p);
    expect(g).toContain("Do not modify the project's repositories.");
    expect(g).toContain("# Fidelity plan");
    expect(TANDA_MAX_FIDELIDAD).toBe(10);
  });

  it("con permisos acotados: calls.yaml, extractores y páginas de tablas del cerebro; leer y reindexar FlowBrain", () => {
    const p = permisosDelPedido("fidelidad", ["/x/.flowbrain/tienda"]);
    expect(p.escritura).toEqual([join("/x/.flowbrain/tienda", "calls.yaml"), join("/x/.flowbrain/tienda", "extractors", "**"), join("/x/.flowbrain/tienda", "technology", "tabla-*.md")]);
    expect(p.comandos).toContain("flowbrain calls");
    expect(p.comandos).toContain("flowbrain brains apply");
    expect(p.comandos).not.toContain("npx vitest");
    expect(p.comandos).not.toContain("node");
  });

  it("una falta pedida queda resuelta cuando ninguna falta de esa relación cita sus líneas", () => {
    const pedido = { tareas: [{ signal: "http" as const, que: "x", lineas: [5] }] };
    expect(fidelidadResuelta(undefined, pedido)).toBe(false);
    expect(fidelidadResuelta({ tareas: [] }, pedido)).toBe(true);
    expect(fidelidadResuelta({ tareas: [{ signal: "http", que: "x", hacer: "", resuelve: "persona", lineas: [9] }] }, pedido)).toBe(true);
    expect(fidelidadResuelta({ tareas: [{ signal: "http", que: "x", hacer: "", resuelve: "persona", lineas: [5, 9] }] }, pedido)).toBe(false);
    expect(fidelidadResuelta({ tareas: [{ signal: "datos", que: "x", hacer: "", resuelve: "agente", lineas: [] }] }, { tareas: [{ signal: "datos", que: "x", lineas: [] }] })).toBe(false);
  });
});

describe("lote de fidelidad", () => {
  it("una tanda por repo: reindexa el cerebro y mide qué archivos ya no tienen las faltas pedidas", async () => {
    const archivos = [await pedidoDe(AVISOS), await pedidoDe(DEJA)];
    expect(archivos.map((a) => a.tareas.map((t) => t.signal).sort())).toEqual([["http", "llamadas"], ["http", "llamadas"]]);
    const r = await pedir("POST", "/api/agente/lote", { tipo: "fidelidad", archivos, proveedor: "claude-code", modelo: "claude-sonnet-5-5" });
    expect(r.estado).toBe(200);
    expect((r.json["lote"] as Tr)["tipo"]).toBe("fidelidad");
    const { lote, trabajos } = await esperarLote((r.json["lote"] as Tr)["id"]);
    expect(lote["error"]).toBeUndefined();
    expect(trabajos).toHaveLength(1);
    const t = trabajos[0]!;
    expect(t).toMatchObject({ tipo: "fidelidad", estado: "terminado", modelo: "claude-sonnet-5-5", repo: R, tanda: { n: 1, de: 1 }, etiqueta: `${R} · 2 files` });
    expect(t["archivos"]).toEqual([{ cerebro: "tienda", archivo: AVISOS }, { cerebro: "tienda", archivo: DEJA }]);
    expect(t["completados"]).toEqual([{ cerebro: "tienda", archivo: AVISOS, puntaje: 100 }]);
    expect(t["pendientes"]).toEqual([{ cerebro: "tienda", archivo: DEJA, puntaje: 0 }]);
    // Con la guía de fidelidad y permisos acotados a la carpeta del cerebro.
    const log = await leerLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.archivos).toEqual([AVISOS, DEJA]);
    expect(log[0]!.prompt).toContain("Do not modify the project's repositories.");
    const permisos = log[0]!.args.join(" ");
    expect(permisos).toContain(join(reg, "tienda", "calls.yaml"));
    expect(permisos).toContain(join(reg, "tienda", "extractors", "**"));
    expect(permisos).not.toContain("npx vitest");
  }, 120_000);

  it("solo las relaciones pedidas: si se pidió solo HTTP, alcanza con que esa falta ya no esté", async () => {
    // avisos.ts ya está en 100: se vuelve a medir deja.ts pidiendo solo http; el agente no lo toca, así que queda.
    const deja = await pedidoDe(DEJA);
    const r = await pedir("POST", "/api/agente/lote", { tipo: "fidelidad", archivos: [{ ...deja, tareas: deja.tareas.filter((x) => x.signal === "http") }] });
    expect(r.estado).toBe(200);
    const { trabajos } = await esperarLote((r.json["lote"] as Tr)["id"]);
    expect(trabajos[0]!["pendientes"]).toEqual([{ cerebro: "tienda", archivo: DEJA, puntaje: 0 }]);
    const log = await leerLog();
    expect(log[log.length - 1]!.prompt).toContain("- [ ] http:");
    expect(log[log.length - 1]!.prompt).not.toContain("- [ ] llamadas:");
  }, 120_000);

  it("rechaza lotes inválidos con los mismos límites que los demás", async () => {
    const uno = await pedidoDe(DEJA);
    const mal = async (x: unknown) => (await pedir("POST", "/api/agente/lote", { tipo: "fidelidad", archivos: [x] })).estado;
    expect((await pedir("POST", "/api/agente/lote", { tipo: "fidelidad", archivos: [] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "fidelidad", items: [uno] })).estado).toBe(400);
    expect(await mal({ ...uno, cerebro: "otro" })).toBe(400);
    expect(await mal({ ...uno, archivo: "sin-repo" })).toBe(400);
    expect(await mal({ ...uno, puntaje: 101 })).toBe(400);
    expect(await mal({ ...uno, tareas: [] })).toBe(400);
    expect(await mal({ ...uno, tareas: [{ signal: "otra", que: "x", lineas: [] }] })).toBe(400);
    expect(await mal({ ...uno, tareas: [{ signal: "http", que: "dos\nlíneas", lineas: [] }] })).toBe(400);
    expect(await mal({ ...uno, tareas: [{ signal: "http", que: "x", lineas: [0] }] })).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "fidelidad", archivos: [uno, uno] })).estado).toBe(400);
    const muchos = Array.from({ length: 3001 }, (_, i) => ({ ...uno, archivo: `${R}:src/a${i}.ts` }));
    const r = await pedir("POST", "/api/agente/lote", { tipo: "fidelidad", archivos: muchos });
    expect(r.estado).toBe(400);
    expect(String(r.json["error"])).toContain("1 to 3000 files");
    expect((await pedir("POST", "/api/agente/lote", { tipo: "fidelidad", archivos: [uno], modelo: "gpt-7" })).estado).toBe(400);
  });
});

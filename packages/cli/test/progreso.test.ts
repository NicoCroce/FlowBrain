import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { leerRegistro, type EventoProgreso } from "@flowbrain/core";
import { aplicar, escribirVisor } from "../src/cerebros.js";
import { ejecutar } from "../src/main.js";
import { crearReporte, duracion } from "../src/progreso.js";

/** Dos cerebros (un back y un front que lo llama) y un tercero con un repo que no existe: el progreso de reindexar. */
let dir: string, reg: string;
const w = async (ruta: string, lineas: string[]) => {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), lineas.join("\n") + "\n");
};
const ESC = /\x1b/;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-progreso-"));
  reg = join(dir, "registro");
  await mkdir(reg, { recursive: true });
  await w("repos/api/package.json", ['{ "name": "api", "dependencies": { "express": "4" } }']);
  await w("repos/api/src/main.ts", ['import { Router } from "express";', "export const router = Router();", 'router.get("/pedidos", (_req, res) => res.json([]));']);
  await w("repos/web/package.json", ['{ "name": "web" }']);
  await w("repos/web/src/pedidos.ts", ['export const pedidos = () => fetch("/pedidos");']);
  await writeFile(
    join(reg, "flowbrain.yaml"),
    ["version: 1", "cerebros:", "  - nombre: api", "    repos: [{ ruta: ../repos/api }]", "  - nombre: web", "    repos: [{ ruta: ../repos/web }]", "comunicacion:", "  - { entre: [api, web], activa: true }", ""].join("\n"),
  );
  await mkdir(join(dir, "falla"), { recursive: true });
  await writeFile(
    join(dir, "falla/flowbrain.yaml"),
    ["version: 1", "cerebros:", "  - nombre: roto", "    repos: [{ ruta: ../repos/no-existe }, { ruta: ../repos/api }]", "  - nombre: web", "    repos: [{ ruta: ../repos/web }]", ""].join("\n"),
  );
}, 60_000);

/** Las etapas en orden, sin repetir las seguidas (`parsear` llega muchas veces). */
const etapas = (es: EventoProgreso[]) =>
  es.map((e) => (e.etapa === "cerebro" ? `cerebro ${e.cerebro} ${e.n}/${e.de}` : e.etapa === "repo" ? `repo ${e.repo} ${e.pasada}/${e.pasadas}` : e.etapa === "visor" && e.todos ? "visor todos" : e.etapa === "parsear" ? `parsear ${e.parser}` : e.etapa)).filter((x, i, xs) => x !== xs[i - 1]);

describe("progreso de reindexar", () => {
  it("el callback recibe las etapas en orden, cerebro por cerebro", async () => {
    const eventos: EventoProgreso[] = [];
    const registro = await leerRegistro(reg);
    await aplicar(registro, undefined, { progreso: (e) => eventos.push(e) });
    await escribirVisor(registro, (e) => eventos.push(e));
    const vuelta = (repo: string, pasada: number) => [`repo ${repo} ${pasada}/3`, "parsear ts-parser", "parsear esquema-parser", "extractores", "llamadas", ...(pasada === 1 ? ["paginas"] : [])];
    const cerebro = (nombre: string, n: number, repo: string) => [`cerebro ${nombre} ${n}/2`, ...vuelta(nombre, 1), ...vuelta(repo, 2), ...vuelta(repo, 3), "compilar", "fidelidad", "visor", "cerebro_listo"];
    expect(etapas(eventos)).toEqual([...cerebro("api", 1, "repo-api"), ...cerebro("web", 2, "repo-web"), "visor todos"]);
    // El avance de cada parser va de 0 a 1 sin retroceder.
    const ts = eventos.filter((e): e is Extract<EventoProgreso, { etapa: "parsear" }> => e.etapa === "parsear");
    expect(ts[0]!.fraccion).toBe(0);
    expect(ts.at(-1)!.fraccion).toBe(1);
    for (let i = 1; i < ts.length; i++) if (ts[i]!.fraccion !== 0) expect(ts[i]!.fraccion).toBeGreaterThanOrEqual(ts[i - 1]!.fraccion);
    const listos = eventos.filter((e) => e.etapa === "cerebro_listo");
    expect(listos.map((e) => e.etapa === "cerebro_listo" && e.ms >= 0 && e.fallidos)).toEqual([0, 0]);
  }, 60_000);

  it("fuera de una terminal: líneas simples sin códigos de escape, y el resumen con tiempos por stdout", async () => {
    let err = "";
    const reporte = crearReporte({ write: (t) => (err += t), isTTY: false });
    const r = await ejecutar(["brains", "apply", "--root", reg], {}, dir, async () => "", undefined, reporte);
    expect(r.codigo).toBe(0);
    expect(err).not.toMatch(ESC);
    expect(err.split("\n")).toEqual(expect.arrayContaining(["[1/2] api", "[1/2] api › api (pass 1/3)", "[1/2] api · compiling", "[2/2] web", "viewer for all brains"]));
    expect(err).toMatch(/^\[1\/2\] api · done in \d+\.\ds$/m);
    expect(err).not.toContain("parsing");
    expect(r.stdout).not.toMatch(ESC);
    expect(r.stdout).toMatch(/^api: \d+ nodes, .* \(\d+\.\ds\)$/m);
    expect(r.stdout).toMatch(/^Done in \d+\.\ds\.$/m);
  }, 60_000);

  it("un repo que falla se informa al final y los demás siguen", async () => {
    let err = "";
    const reporte = crearReporte({ write: (t) => (err += t) });
    const carpeta = join(dir, "falla");
    const r = await ejecutar(["brains", "apply", "--root", carpeta], {}, dir, async () => "", undefined, reporte);
    expect(r.codigo).toBe(1);
    expect(r.stdout).toMatch(/no-existe: the folder does not exist/);
    expect(r.stdout).toMatch(/^web: \d+ nodes/m);
    expect(r.stdout).toMatch(/^Done in [\d.]+s\. 1 repo\(s\) failed and the rest went on: roto\/no-existe \(details above\)\.$/m);
    expect(err).toMatch(/\[1\/2\] roto · done in [\d.]+s; 1 repo\(s\) failed/);
  }, 60_000);

  it("en una terminal: una línea que se reescribe, como mucho cada 100 ms, y el resumen en vivo", () => {
    let t = 0;
    let out = "";
    const r = crearReporte({ write: (s) => (out += s), isTTY: true, columns: 200 }, { ahora: () => t, animar: false, resumenEnVivo: true });
    r.progreso({ etapa: "cerebro", cerebro: "api", n: 1, de: 2 });
    r.progreso({ etapa: "repo", repo: "repo-api", n: 1, de: 1, pasada: 2, pasadas: 3 });
    const pintadas = () => out.split("\r\x1b[2K").length - 1;
    const antes = pintadas();
    for (let i = 0; i <= 100; i++) r.progreso({ etapa: "parsear", repo: "repo-api", parser: "ts-parser", archivos: 1350, fraccion: i / 100 });
    // Cambiar de parser pinta enseguida; los 100 avances siguientes, en el mismo instante, no.
    expect(pintadas() - antes).toBe(1);
    expect(out).toMatch(/\r\x1b\[2K[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] \[1\/2\] api › repo-api \(pass 2\/3\) · parsing TypeScript · 0% of 1350 files · 0\.0s$/);
    t = 400;
    r.progreso({ etapa: "parsear", repo: "repo-api", parser: "ts-parser", archivos: 1350, fraccion: 0.52 });
    expect(out.endsWith("parsing TypeScript · 52% of 1350 files · 0.4s")).toBe(true);
    expect(out).not.toContain("\n");
    expect(r.resumenEnVivo).toBe(true);
    r.linea("api: 10 nodes (0.4s)");
    expect(out.endsWith("\r\x1b[2Kapi: 10 nodes (0.4s)\n")).toBe(true);
    r.terminar();
    r.progreso({ etapa: "compilar" });
    expect(out.endsWith("\n")).toBe(true);
  });

  it("duración legible", () => {
    expect(duracion(4_250)).toBe("4.3s");
    expect(duracion(125_000)).toBe("2m 05s");
  });
});

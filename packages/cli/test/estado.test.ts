import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avisosIndice } from "@flowbrain/core";
import { cargadorConCache } from "@flowbrain/mcp";
import { sync, textoEstado } from "../src/estado.js";
import { fijarIdioma } from "../src/idioma.js";
import { ejecutar } from "../src/main.js";

const F = (p: string) => resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures", p);

let dir: string, raiz: string, clon: string;
const head = async (c: string) => writeFile(join(clon, ".git/refs/heads/main"), `${c.repeat(40)}\n`);
const brain = (...args: string[]) => ejecutar([...args, "--root", raiz], {}, dir);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-estado-"));
  raiz = join(dir, "brain");
  clon = join(dir, "tienda");
  for (const d of ["product", "technology"]) await cp(F(`checkout/${d}`), join(raiz, d), { recursive: true });
  await cp(F("repos/tienda"), clon, { recursive: true });
  await mkdir(join(clon, ".git/refs/heads"), { recursive: true });
  await writeFile(join(clon, ".git/HEAD"), "ref: refs/heads/main\n");
  await head("a");
  expect((await brain("index", clon)).codigo).toBe(0);
  expect((await brain("compile")).codigo).toBe(0);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("flowbrain sync, estado y doctor", () => {
  it("estado: repo al día, conteos y huecos; sync no hace nada si el clon no avanzó", async () => {
    const e = await brain("status");
    expect(e.codigo).toBe(0);
    expect(e.stdout).toContain("repo-tienda: up to date (indexed aaaaaaaaaaaa, clone aaaaaaaaaaaa)");
    expect(e.stdout).toContain("Nodes: ");
    expect(e.stdout).toContain("files outside every feature or library");
    const j = JSON.parse((await brain("status", "--json")).stdout) as { nodos: Record<string, number>; desactualizado: boolean };
    expect(j.nodos["svc"]).toBe(3);
    expect(j.desactualizado).toBe(false);
    const s = await brain("sync");
    expect(s.codigo).toBe(0);
    expect(s.stdout).toBe("repo-tienda: up to date\nno changes: no need to compile\n");
  });

  it("el texto del estado sale en inglés o en castellano", () => {
    const e = { repos: [{ repo: "r", indexado: null, clon: null, actual: null, estado: "al día" as const }], nodos: {}, aristas: {}, huecos: [], desactualizado: false };
    expect(textoEstado(e)).toContain("r: up to date");
    fijarIdioma("es");
    try {
      expect(textoEstado(e)).toContain("Repos indexados:\n  r: al día (indexado —, clon —)");
      expect(textoEstado(e)).toContain("Huecos: ninguno");
    } finally {
      fijarIdioma("en");
    }
  });

  it("cuando el clon avanza: estado sale con 1 y sync reindexa y recompila", async () => {
    await head("b");
    const e = await brain("status");
    expect(e.codigo).toBe(1);
    expect(e.stdout).toContain("repo-tienda: outdated (indexed aaaaaaaaaaaa, clone bbbbbbbbbbbb)");
    const s = await brain("sync");
    expect(s.stdout).toContain("repo-tienda: reindexed");
    expect(s.stdout).toContain("compiled: ");
    expect((await brain("status")).codigo).toBe(0);
  });

  it("si el clon se movió, lo encuentra por nombre en --repos; si no está, lo dice", async () => {
    const otro = join(dir, "clones");
    await mkdir(otro);
    await cp(clon, join(otro, "tienda"), { recursive: true });
    await rm(clon, { recursive: true });
    expect((await brain("status")).stdout).toContain("repo-tienda: no clone");
    expect((await brain("sync")).codigo).toBe(1);
    expect((await brain("status", "--repos", otro)).stdout).toContain("repo-tienda: up to date");
  });

  it("el MCP con sincronización reindexa solo cuando el clon avanzó, antes de responder", async () => {
    const clones = join(dir, "clones");
    let corridas = 0;
    const cargar = cargadorConCache(raiz, async () => {
      corridas++;
      await sync(raiz, { carpetas: [clones] });
    });
    // El clon se movió: se reubica una vez para que el índice guarde la ruta nueva.
    await brain("index", join(clones, "tienda"));
    await brain("compile");
    expect(avisosIndice((await cargar()).codigo!)).toEqual([]);
    expect(corridas).toBe(0);
    await writeFile(join(clones, "tienda/.git/refs/heads/main"), `${"c".repeat(40)}\n`);
    const ctx = await cargar();
    expect(corridas).toBe(1);
    expect(avisosIndice(ctx.codigo!)).toEqual([]);
    expect(ctx.codigo!.commits["repo-tienda"]).toBe("c".repeat(40));
    await cargar();
    expect(corridas).toBe(1);
  });

  it("doctor solo lee: dice qué falta registrar y sale con 1", async () => {
    const settings = join(dir, "settings.json");
    await writeFile(settings, "{}\n");
    const d = await brain("doctor", "--settings", settings, "--repos", join(dir, "clones"));
    expect(d.stdout).toMatch(/^ok\s+the graph loads/m);
    expect(d.stdout).toMatch(/^ok\s+clone of repo-tienda/m);
    expect(d.stdout).toContain("Claude Code hooks");
    expect(d.stdout).not.toMatch(/^ok\s+Claude Code hooks/m);
    expect(d.codigo).toBe(1);
    await brain("init", raiz, "--claude-code", "--settings", settings);
    expect((await brain("doctor", "--settings", settings, "--repos", join(dir, "clones"))).stdout).toMatch(/^ok\s+Claude Code hooks/m);
  });
});

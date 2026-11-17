import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ejecutar } from "../src/main.js";

const F = (p: string) => resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures", p);

let dir: string, raiz: string, clon: string;
const head = async (c: string) => writeFile(join(clon, ".git/refs/heads/main"), `${c.repeat(40)}\n`);
const brain = (...args: string[]) => ejecutar([...args, "--raiz", raiz], {}, dir);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-estado-"));
  raiz = join(dir, "brain");
  clon = join(dir, "tienda");
  for (const d of ["producto", "tecnologia"]) await cp(F(`checkout/${d}`), join(raiz, d), { recursive: true });
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

describe("brain sync, estado y doctor", () => {
  it("estado: repo al día, conteos y huecos; sync no hace nada si el clon no avanzó", async () => {
    const e = await brain("estado");
    expect(e.codigo).toBe(0);
    expect(e.stdout).toContain("repo-tienda: al día (indexado aaaaaaaaaaaa, clon aaaaaaaaaaaa)");
    expect(e.stdout).toContain("Nodos: ");
    expect(e.stdout).toContain("archivos fuera de toda funcionalidad");
    const j = JSON.parse((await brain("estado", "--json")).stdout) as { nodos: Record<string, number>; desactualizado: boolean };
    expect(j.nodos["svc"]).toBe(3);
    expect(j.desactualizado).toBe(false);
    const s = await brain("sync");
    expect(s.codigo).toBe(0);
    expect(s.stdout).toBe("repo-tienda: al día\nsin cambios: no hizo falta compilar\n");
  });

  it("cuando el clon avanza: estado sale con 1 y sync reindexa y recompila", async () => {
    await head("b");
    const e = await brain("estado");
    expect(e.codigo).toBe(1);
    expect(e.stdout).toContain("repo-tienda: desactualizado (indexado aaaaaaaaaaaa, clon bbbbbbbbbbbb)");
    const s = await brain("sync");
    expect(s.stdout).toContain("repo-tienda: reindexado");
    expect(s.stdout).toContain("compilado: ");
    expect((await brain("estado")).codigo).toBe(0);
  });

  it("si el clon se movió, lo encuentra por nombre en --repos; si no está, lo dice", async () => {
    const otro = join(dir, "clones");
    await mkdir(otro);
    await cp(clon, join(otro, "tienda"), { recursive: true });
    await rm(clon, { recursive: true });
    expect((await brain("estado")).stdout).toContain("repo-tienda: sin clon");
    expect((await brain("sync")).codigo).toBe(1);
    expect((await brain("estado", "--repos", otro)).stdout).toContain("repo-tienda: al día");
  });

  it("doctor solo lee: dice qué falta registrar y sale con 1", async () => {
    const settings = join(dir, "settings.json");
    await writeFile(settings, "{}\n");
    const d = await brain("doctor", "--settings", settings, "--repos", join(dir, "clones"));
    expect(d.stdout).toContain("ok    el grafo carga");
    expect(d.stdout).toContain("ok    clon de repo-tienda");
    expect(d.stdout).toContain("falta hooks de Claude Code");
    expect(d.codigo).toBe(1);
    await brain("init", raiz, "--claude-code", "--settings", settings);
    expect((await brain("doctor", "--settings", settings, "--repos", join(dir, "clones"))).stdout).toContain("ok    hooks de Claude Code");
  });
});

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarContexto, compileDir, type Contexto } from "@flowbrain/core";
import { escribirReglas, fusionarBloque, generarReglas, MARCA_REGLAS_FIN, MARCA_REGLAS_INICIO, repoDe } from "../src/index.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let dir: string;
let ctx: Contexto;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-reglas-"));
  for (const d of ["producto", "tecnologia", "_build"]) await cp(join(RAIZ, "fixtures/checkout", d), join(dir, "brain", d), { recursive: true });
  await compileDir(join(dir, "brain"));
  ctx = await cargarContexto(join(dir, "brain"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("flowbrain gen", () => {
  it("apunta al nodo del repo, a sus servicios y a sus dependencias", () => {
    const r = generarReglas("claude", ctx, repoDe(ctx, "tienda"));
    expect(r.ruta).toBe("CLAUDE.md");
    expect(r.contenido.startsWith(`${MARCA_REGLAS_INICIO}\n## FlowBrain\n\nEste repo es \`repo-tienda\``)).toBe(true);
    expect(r.contenido).toContain("- `svc-payments` — Cobra pedidos a través de la pasarela y registra cada pago. Depende de: `ext-pasarela`, `tabla-pagos`. Lo usan: `ext-pasarela`, `svc-bff`.");
    expect(r.contenido.endsWith(`${MARCA_REGLAS_FIN}\n`)).toBe(true);
  });

  it("cursor y windsurf llevan su frontmatter y el mismo bloque", () => {
    const repo = repoDe(ctx, "repo-tienda");
    const c = generarReglas("cursor", ctx, repo);
    const w = generarReglas("windsurf", ctx, repo);
    expect(c.ruta).toBe(".cursor/rules/flowbrain.mdc");
    expect(c.contenido).toMatch(/^---\ndescription: .+\nalwaysApply: true\n---\n\n## FlowBrain\n/);
    expect(w.ruta).toBe(".windsurf/rules/flowbrain.md");
    expect(w.contenido).toMatch(/^---\ntrigger: always_on\n---\n\n## FlowBrain\n/);
    expect(c.contenido.split("---\n\n")[1]).toBe(w.contenido.split("---\n\n")[1]);
  });

  it("sin nodo de repo genera el bloque genérico", () => {
    const r = generarReglas("agents", ctx, repoDe(ctx, "otro-repo"));
    expect(r.repo).toBeNull();
    expect(r.contenido).not.toContain("Este repo es");
    expect(r.contenido).toContain("`buscar_nodo`");
  });

  it("fusiona entre marcadores sin tocar el resto, y es idempotente", async () => {
    const r = generarReglas("claude", ctx, repoDe(ctx, "tienda"));
    const repo = join(dir, "repo");
    await cp(join(RAIZ, "fixtures/repos/tienda"), repo, { recursive: true });
    await writeFile(join(repo, "CLAUDE.md"), "# Reglas propias\n\nNo tocar.\n");
    expect(await escribirReglas(repo, r)).toBe(true);
    const una = await readFile(join(repo, "CLAUDE.md"), "utf8");
    expect(una).toBe(`# Reglas propias\n\nNo tocar.\n\n${r.contenido}`);
    expect(await escribirReglas(repo, r)).toBe(false);
    await writeFile(join(repo, "CLAUDE.md"), `${una}\n## Después\n`);
    const otra = generarReglas("claude", ctx, null);
    await escribirReglas(repo, otra);
    expect(await readFile(join(repo, "CLAUDE.md"), "utf8")).toBe(`# Reglas propias\n\nNo tocar.\n\n${otra.contenido}\n## Después\n`);
    expect(fusionarBloque(null, r.contenido)).toBe(r.contenido);
  });

  it("reemplaza un bloque escrito con los marcadores anteriores al cambio de nombre, sin duplicarlo", () => {
    const viejo = "# Proyecto\n\n<!-- brain:reglas:inicio -->\nreglas viejas\n<!-- brain:reglas:fin -->\n\nResto\n";
    const nuevo = fusionarBloque(viejo, `${MARCA_REGLAS_INICIO}\nreglas nuevas\n${MARCA_REGLAS_FIN}\n`);
    expect(nuevo).toBe(`# Proyecto\n\n${MARCA_REGLAS_INICIO}\nreglas nuevas\n${MARCA_REGLAS_FIN}\n\nResto\n`);
  });
});

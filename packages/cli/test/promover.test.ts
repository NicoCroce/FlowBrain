import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ejecutar } from "../src/main.js";

const F = (p: string) => resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures", p);
let raiz: string;
const brain = (...args: string[]) => ejecutar([...args, "--root", raiz]);
const existe = (p: string) => stat(join(raiz, p)).then(() => true, () => false);
const pagina = (id: string, tipo: string, extra: string[] = []) => ["---", `id: ${id}`, `tipo: ${tipo}`, `nombre: ${id}`, `resumen: ${id}.`, ...extra, "---", `# ${id}`, ""].join("\n");
const borrador = async (ruta: string, contenido: string) => {
  await mkdir(dirname(join(raiz, ruta)), { recursive: true });
  await writeFile(join(raiz, ruta), contenido);
};

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), "brain-promover-"));
  for (const d of ["product", "technology", "_build"]) await cp(F(`checkout/${d}`), join(raiz, d), { recursive: true });
  await borrador("_drafts/repo-tienda/technology/ext-correo.md", pagina("ext-correo", "ext"));
  await borrador("_drafts/repo-tienda/technology/svc-roto.md", pagina("svc-roto", "svc", ["vive_en: [repo-que-no-existe]"]));
  await borrador("_drafts/repo-tienda/technology/svc-bff.md", pagina("svc-bff", "svc", ["vive_en: [repo-tienda]"]));
  await borrador("_drafts/product/feat-avisos.md", pagina("feat-avisos", "feat"));
  await borrador("_drafts/repo-tienda/PROMPT.md", "no es una página\n");
  await borrador("_drafts/notes/svc-bff.md", "una nota\n");
});
afterAll(() => rm(raiz, { recursive: true, force: true }));

describe("notas ancladas a un nodo", () => {
  it("una nota sobre una pieza aparece en su impacto y en estado, hasta que alguien la revise", async () => {
    await brain("compile");
    expect((await brain("impact", "tabla-pagos")).stdout).not.toContain('"notas"');
    await brain("note", "tabla-pagos", "la columna estado ahora admite reembolsado");
    const imp = JSON.parse((await brain("impact", "tabla-pagos")).stdout) as { notas: Array<{ de: string; nota: string }> };
    expect(imp.notas).toEqual([{ de: "tabla-pagos", nota: "la columna estado ahora admite reembolsado (manual)" }]);
    expect((await brain("status")).stdout).toContain("nodos con notas sin revisar: 1 — tabla-pagos");
  });
});

describe("flowbrain promote", () => {
  it("sin --write lista los borradores y su estado, sin tocar nada", async () => {
    const r = await brain("promote");
    expect(r.stdout.split("\n").slice(0, 5)).toEqual([
      "borradores (4):",
      "  _drafts/product/feat-avisos.md → product/feat-avisos.md (nuevo)",
      "  _drafts/repo-tienda/technology/ext-correo.md → technology/ext-correo.md (nuevo)",
      "  _drafts/repo-tienda/technology/svc-bff.md → technology/svc-bff.md (distinto)",
      "  _drafts/repo-tienda/technology/svc-roto.md → technology/svc-roto.md (nuevo)",
    ]);
    expect(await existe("technology/ext-correo.md")).toBe(false);
  });

  it("un borrador que rompe la compilación no se promueve y se deshace todo", async () => {
    const r = await brain("promote", "svc-roto", "ext-correo", "--write");
    expect(r.codigo).toBe(1);
    expect(r.stdout).toContain("no se promovió nada; errores:");
    expect(r.stdout).toContain("repo-que-no-existe");
    expect(await existe("technology/ext-correo.md")).toBe(false);
    expect(await existe("_drafts/repo-tienda/technology/ext-correo.md")).toBe(true);
  });

  it("promueve los elegidos, compila, y no pisa una página existente distinta", async () => {
    const antes = await readFile(join(raiz, "technology/svc-bff.md"), "utf8");
    const r = await brain("promote", "ext-correo", "feat-avisos", "svc-bff", "--write");
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain("promovidos 2:");
    expect(r.stdout).toContain("svc-bff.md (distinto): ya existe una página distinta");
    expect(await existe("_drafts/repo-tienda/technology/ext-correo.md")).toBe(false);
    // Ya no es borrador: sin el aviso de `flowbrain draft`.
    expect(await readFile(join(raiz, "technology/ext-correo.md"), "utf8")).not.toContain("Borrador generado");
    // La página curada sigue ahí (compile solo le agrega sus backlinks).
    expect(await readFile(join(raiz, "technology/svc-bff.md"), "utf8")).toContain(antes.slice(0, antes.indexOf("\n---\n", 4)));
    expect((await brain("search", "ext-correo")).stdout).toContain('"id": "ext-correo"');
    expect((await brain("promote", "no-existe", "--write")).stdout).toContain("no hay un borrador con ese id: no-existe");
  });
});

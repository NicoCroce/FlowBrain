import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init, instalarHooksClaudeCode } from "../src/init.js";
import { ejecutar } from "../src/main.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const run = promisify(execFile);
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-init-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("flowbrain init", () => {
  it("crea la estructura, compila y no pisa archivos existentes", async () => {
    await mkdir(join(dir, "b"), { recursive: true });
    await writeFile(join(dir, "b/README.md"), "mío\n");
    const r = await init(join(dir, "b"), { env: { FLOWBRAIN_COMANDO: "flowbrain" } });
    expect(r.creados).toEqual(["INDEX.md", "SCHEMA.md", "_build/backlinks.json", "_build/graph.json", "_build/map.mmd", "_build/viewer.html", "product/.gitkeep", "technology/.gitkeep"]);
    expect(await readFile(join(dir, "b/README.md"), "utf8")).toBe("mío\n");
    expect(await readFile(join(dir, "b/SCHEMA.md"), "utf8")).toBe(await readFile(join(RAIZ, "SCHEMA.md"), "utf8"));
    expect(r.mcp).toBe(`claude mcp add --scope user flowbrain -- flowbrain serve --root ${join(dir, "b")}`);
    expect(r.hooks).toBeNull();
    expect((await init(join(dir, "b"), { env: { FLOWBRAIN_COMANDO: "flowbrain" } })).creados).toEqual([]);
  });

  it("--claude-code registra ambos hooks, conserva los ajenos y reemplaza los propios", async () => {
    const settings = join(dir, "settings.json");
    const ajeno = { matcher: "", hooks: [{ type: "command", command: "otro-hook" }] };
    await writeFile(settings, JSON.stringify({ model: "x", hooks: { UserPromptSubmit: [ajeno, { hooks: [{ type: "command", command: "viejo hook claude-code --root /a" }] }] } }));
    expect(await instalarHooksClaudeCode(settings, "flowbrain hook claude-code --root /b")).toBe(true);
    const s = JSON.parse(await readFile(settings, "utf8")) as { model: string; hooks: Record<string, unknown[]> };
    expect(s.model).toBe("x");
    expect(s.hooks.UserPromptSubmit).toEqual([ajeno, { hooks: [{ type: "command", command: "flowbrain hook claude-code --root /b" }] }]);
    expect(s.hooks.SessionEnd).toEqual([{ hooks: [{ type: "command", command: "flowbrain hook claude-code --root /b" }] }]);
    expect(await instalarHooksClaudeCode(settings, "flowbrain hook claude-code --root /b")).toBe(false);
    expect(await readFile(`${settings}.flowbrain.bak`, "utf8")).toContain("viejo hook claude-code");
  });

  it("no toca un settings.json inválido", async () => {
    const settings = join(dir, "settings.json");
    await writeFile(settings, "{ roto");
    await expect(instalarHooksClaudeCode(settings, "flowbrain hook claude-code")).rejects.toThrow(/no es JSON válido/);
    expect(await readFile(settings, "utf8")).toBe("{ roto");
  });

  it("por CLI imprime la línea de MCP y los pasos siguientes", async () => {
    const r = await ejecutar(["init", "b", "--claude-code", "--settings", "s.json"], { FLOWBRAIN_COMANDO: "flowbrain" }, dir);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain(`claude mcp add --scope user flowbrain -- flowbrain serve --root ${join(dir, "b")}`);
    expect(r.stdout).toContain(`Hooks de Claude Code registrados en ${join(dir, "s.json")}`);
  });
});

describe("paquete flowbrain", () => {
  it("el bundle compila, informa la versión e inicializa un brain", async () => {
    await run("node", [join(RAIZ, "scripts/build.mjs")]);
    const bin = join(RAIZ, "packages/flowbrain/dist/flowbrain.mjs");
    const pkg = JSON.parse(await readFile(join(RAIZ, "packages/flowbrain/package.json"), "utf8")) as { name: string; version: string };
    expect(pkg.name).toBe("@nicocroce/flowbrain");
    expect((await run("node", [bin, "--version"])).stdout).toBe(`${pkg.version}\n`);
    // El bundle trae todas las herramientas del MCP (si no, el paquete quedó viejo respecto del código).
    const bundle = await readFile(bin, "utf8");
    for (const h of ["buscar_nodo", "recorrer_grafo", "contrato_de", "trazar", "funcionalidad", "recorrido", "quien_llama", "impacto"]) expect(bundle).toContain(`"${h}"`);
    const { stdout } = await run("node", [bin, "init", join(dir, "b")], { cwd: dir });
    expect(stdout).toContain(`npx -y @nicocroce/flowbrain@${pkg.version} serve --root ${join(dir, "b")}`);
    expect(await readFile(join(dir, "b/_build/viewer.html"), "utf8")).toContain("<title>FlowBrain · viewer</title>");
  }, 60_000);
});

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
  for (const d of ["product", "technology", "_build"]) await cp(join(FIXTURE, d), join(raiz, d), { recursive: true });
  const r = await ejecutar(["compile", "--root", raiz]);
  expect(r.codigo).toBe(0);
});
afterAll(async () => {
  await rm(raiz, { recursive: true, force: true });
});

const golden = (nombre: string) => readFile(join(CONSULTAS, `${nombre}.json`), "utf8");

describe("brain CLI produce el mismo JSON que el motor", () => {
  const casos: Array<[string, string[]]> = [
    ["trazar-checkout", ["trace", "--from", "/checkout"]],
    ["trazar-checkout-hasta-tabla", ["trace", "--from", "/checkout", "--to", "tabla-pagos"]],
    ["recorrer-payments-depende-in", ["traverse", "svc-payments", "--verbs", "depende_de", "--direction", "in"]],
    ["buscar-pagos", ["search", "pagos"]],
    ["contrato-bff", ["contract", "svc-bff"]],
    ["completo-payments-budget-300", ["traverse", "svc-payments", "--projection", "completo", "--budget", "300"]],
  ];
  for (const [nombre, args] of casos) {
    it(nombre, async () => {
      const r = await ejecutar([...args, "--root", raiz]);
      expect(r.codigo).toBe(0);
      expect(r.stdout).toBe(await golden(nombre));
    });
  }

  it("una segunda compilación no escribe nada", async () => {
    const r = await ejecutar(["compile", "--root", raiz]);
    expect(r.stdout).toContain("0 archivos escritos");
  });

  it("errores de consulta salen como JSON con código 2", async () => {
    const r = await ejecutar(["traverse", "svc-nada", "--root", raiz]);
    expect(r.codigo).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({ error: { codigo: "nodo_inexistente", mensaje: "no existe el nodo: svc-nada" } });
  });

  it("comando desconocido", async () => {
    const r = await ejecutar(["volar", "--root", raiz]);
    expect(r.codigo).toBe(2);
    expect(r.stderr).toContain("comando desconocido");
  });
});

describe("flowbrain verify, draft, nota y hook SessionEnd por CLI", () => {
  const REPOS = resolve(FIXTURE, "../repos");

  it("verify sale con 1 si aparecen dudosas nuevas y con 0 en la siguiente corrida", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brain-cli-verify-"));
    try {
      await cp(join(REPOS, "tienda"), join(dir, "tienda"), { recursive: true });
      const ok = await ejecutar(["verify", "--root", raiz, "--clone", `repo-tienda=${join(dir, "tienda")}`, "--today", "2026-11-16"]);
      expect(ok.codigo).toBe(0);
      expect(ok.stdout).toMatch(/^verificadas \d+ aristas: 0 dudosas/);
      await rm(join(dir, "tienda/apps/payments/src/clients/pasarela.ts"));
      const mal = await ejecutar(["verify", "--root", raiz, "--repos", dir, "--today", "2026-11-16"]);
      expect(mal.codigo).toBe(1);
      expect(mal.stdout).toContain("svc-payments llama_a ext-pasarela — repo-tienda:apps/payments/src/clients/pasarela.ts#L8: archivo inexistente");
      expect((await ejecutar(["verify", "--root", raiz, "--repos", dir, "--today", "2026-11-16"])).codigo).toBe(0);
      await cp(join(REPOS, "tienda"), join(dir, "tienda"), { recursive: true });
      const vuelta = await ejecutar(["verify", "--root", raiz, "--repos", dir, "--today", "2026-11-16"]);
      expect(vuelta.stdout).toContain("2 recuperadas");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("verify rechaza --clone mal formado", async () => {
    const r = await ejecutar(["verify", "--root", raiz, "--clone", "sin-igual"]);
    expect(r.codigo).toBe(2);
  });

  it("draft escribe en _drafts/ y lo informa", async () => {
    const r = await ejecutar(["draft", join(REPOS, "tienda"), "--root", raiz]);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toMatch(/^borradores de repo-tienda: /);
    expect(r.stdout).toContain("_drafts/repo-tienda/PROMPT.md");
  });

  it("nota y hook SessionEnd escriben en _drafts/notes/", async () => {
    const n = await ejecutar(["note", "svc-bff", "el", "handler", "cambió", "--root", raiz]);
    expect(n).toEqual({ codigo: 0, stdout: "nota agregada: _drafts/notes/svc-bff.md\n", stderr: "" });
    const t = join(raiz, "t.jsonl");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(t, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "flowbrain-nota svc-bff: devuelve 202" }] } }) + "\n");
    const h = await ejecutar(["hook", "claude-code", "--root", raiz], {}, raiz, async () => JSON.stringify({ hook_event_name: "SessionEnd", session_id: "s1", transcript_path: t }));
    expect(h.codigo).toBe(0);
    expect(h.stdout).toBe("");
    expect(await readFile(join(raiz, "_drafts/notes/svc-bff.md"), "utf8")).toBe("# Notas sobre `svc-bff`\n\n- el handler cambió (manual)\n- devuelve 202 (sesión s1)\n");
  });

  it("un SessionEnd roto nunca falla hacia Claude Code", async () => {
    const h = await ejecutar(["hook", "claude-code", "--root", raiz], {}, raiz, async () => JSON.stringify({ hook_event_name: "SessionEnd", transcript_path: "/no/existe.jsonl" }));
    expect(h.codigo).toBe(0);
    expect(h.stdout).toBe("");
  });
});

describe("flowbrain gen por CLI", () => {
  it("imprime por stdout y rechaza destinos desconocidos", async () => {
    const r = await ejecutar(["gen", "agents", "--root", raiz, "--repo", "repo-tienda"]);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain("Este repo es `repo-tienda`");
    const mal = await ejecutar(["gen", "vscode", "--root", raiz]);
    expect(mal.codigo).toBe(2);
    expect(mal.stdout).toContain("destino inválido");
  });

  it("compile escribe el visor", async () => {
    const html = await readFile(join(raiz, "_build/viewer.html"), "utf8");
    expect(html).toContain("<title>FlowBrain · visor</title>");
  });
});

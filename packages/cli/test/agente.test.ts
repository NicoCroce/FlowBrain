import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leerRegistro } from "@flowbrain/core";
import { crearAgente, HERRAMIENTAS_PROHIBIDAS, indicacionesDelPedido, pasosDeEvento, permisosDelPedido } from "../src/agente.js";
import { claudeCode } from "../src/proveedores.js";
import { ejecutar } from "../src/main.js";
import { crearServidorVisor, type ServidorVisor } from "../src/servidor-visor.js";

/**
 * Los pedidos que el visor le manda a Claude Code, con un Claude Code falso: un script que anota con qué lo llamaron,
 * escribe un test en el repo y contesta como `claude -p --output-format stream-json`. Si el pedido dice LENTO, espera
 * (para cancelarlo).
 */
let dir: string, reg: string, falso: string, s: ServidorVisor;
const w = async (ruta: string, texto: string) => {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), texto);
};

function pedir(metodo: string, ruta: string, cuerpo?: unknown): Promise<{ estado: number; json: Record<string, unknown>; cuerpo: string }> {
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
        ok({ estado: res.statusCode ?? 0, json, cuerpo: t });
      });
    });
    req.on("error", mal);
    req.end(datos ?? undefined);
  });
}
async function esperar(id: string) {
  for (let i = 0; i < 100; i++) {
    const t = ((await pedir("GET", "/api/agente")).json["trabajos"] as Array<Record<string, unknown>>).find((x) => x["id"] === id)!;
    if (t["estado"] !== "en_cola" && t["estado"] !== "corriendo") return t;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("el pedido no terminó");
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-agente-"));
  reg = join(dir, ".flowbrain");
  await w("repos/tienda/package.json", '{ "name": "tienda", "dependencies": { "express": "4" } }\n');
  await w("repos/tienda/src/main.ts", 'import { Router } from "express";\nexport const router = Router();\nrouter.get("/pedidos", (_q, r) => r.end());\n');
  execFileSync("git", ["init", "-q"], { cwd: join(dir, "repos/tienda") });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: join(dir, "repos/tienda") });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: join(dir, "repos/tienda") });
  await mkdir(reg, { recursive: true });
  await writeFile(join(reg, "flowbrain.yaml"), "version: 1\ncerebros:\n  - nombre: tienda\n    repos: [{ ruta: ../repos/tienda }]\n");
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
  falso = join(dir, "claude-falso.mjs");
  await writeFile(falso, [
    "#!/usr/bin/env node",
    'import { writeFileSync, appendFileSync } from "node:fs";',
    "const a = process.argv.slice(2);",
    'if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }',
    `appendFileSync(${JSON.stringify(join(dir, "llamadas.jsonl"))}, JSON.stringify({ args: a, cwd: process.cwd(), root: process.env.FLOWBRAIN_ROOT }) + "\\n");`,
    'const prompt = a[a.indexOf("-p") + 1];',
    'if (prompt.includes("LENTO")) await new Promise((r) => setTimeout(r, 20000));',
    'writeFileSync("repos/tienda/src/main.test.ts", "test(\'lista\', () => {});\\n");',
    'const ev = (o) => console.log(JSON.stringify(o));',
    'ev({ type: "system", subtype: "init" });',
    `ev({ type: "assistant", message: { content: [{ type: "text", text: "Miro cómo testea el repo." }, { type: "tool_use", name: "Read", input: { file_path: process.cwd() + "/repos/tienda/package.json" } }] } });`,
    `ev({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: process.cwd() + "/repos/tienda/src/main.test.ts" } }, { type: "tool_use", name: "Bash", input: { command: "npx vitest run src/main.test.ts" } }] } });`,
    'ev({ type: "result", subtype: "success", is_error: false, result: "Escribí 1 test en src/main.test.ts.", total_cost_usd: 0.05 });',
  ].join("\n"));
  await chmod(falso, 0o755);
  s = crearServidorVisor(reg, { agente: crearAgente(() => leerRegistro(reg), { comando: falso }) });
  await new Promise<void>((ok) => s.server.listen(0, "127.0.0.1", ok));
}, 60_000);
afterAll(async () => {
  await new Promise((ok) => s.server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

describe("el agente del visor", () => {
  it("la página sabe si hay agente; un pedido corre Claude Code con la guía y permisos acotados, y dice qué cambió", async () => {
    expect((await pedir("GET", "/")).cuerpo).toContain('"agente":{"noDisponible":null,"proveedores":[{"id":"claude-code"');
    const r = await pedir("POST", "/api/agente", { tipo: "test", pedido: "Escribí el test de la regla listar.", etiqueta: "1 test: Listar pedidos", cerebros: ["tienda"] });
    expect(r.estado).toBe(200);
    const t = await esperar(r.json["id"] as string);
    expect(t).toMatchObject({ estado: "terminado", etiqueta: "1 test: Listar pedidos", resultado: "Escribí 1 test en src/main.test.ts.", costoUsd: 0.05 });
    expect(t["pasos"]).toEqual(["Miro cómo testea el repo.", "Reads repos/tienda/package.json", "Writes repos/tienda/src/main.test.ts", "Runs: npx vitest run src/main.test.ts"]);
    expect(t["cambios"]).toEqual([{ repo: "repos/tienda", archivos: ["src/main.test.ts"] }]);
    const llamada = JSON.parse((await readFile(join(dir, "llamadas.jsonl"), "utf8")).trim().split("\n")[0]!) as { args: string[]; cwd: string; root: string };
    // En la carpeta del proyecto, con la guía de tests y el pedido adentro.
    expect(await import("node:fs").then((f) => f.realpathSync(llamada.cwd))).toBe(await import("node:fs").then((f) => f.realpathSync(dir)));
    expect(llamada.root).toBe(reg);
    const prompt = llamada.args[llamada.args.indexOf("-p") + 1]!;
    expect(prompt).toContain("Never modify the product code.");
    expect(prompt).toContain("Escribí el test de la regla listar.");
    expect(prompt).not.toContain("$ARGUMENTS");
    for (const p of HERRAMIENTAS_PROHIBIDAS) expect(llamada.args).toContain(p);
    expect(llamada.args).toContain("Bash(git push:*)");
    expect(llamada.args).not.toContain("--dangerously-skip-permissions");
  }, 30_000);

  it("rechaza lo que no es un pedido válido y cancela uno que está corriendo", async () => {
    expect((await pedir("POST", "/api/agente", { tipo: "borrar", pedido: "x", cerebros: [] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente", { tipo: "test", pedido: "  ", cerebros: [] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente", { tipo: "test", pedido: "x", cerebros: ["otro"] })).estado).toBe(400);
    const r = await pedir("POST", "/api/agente", { tipo: "test", pedido: "LENTO", cerebros: [] });
    await new Promise((x) => setTimeout(x, 300));
    expect((await pedir("POST", "/api/agente/cancelar", { id: r.json["id"] })).json["estado"]).toBe("cancelado");
    expect((await esperar(r.json["id"] as string))["estado"]).toBe("cancelado");
    expect((await pedir("POST", "/api/agente/cancelar", { id: "no-existe" })).estado).toBe(404);
  }, 30_000);

  it("un pedido asociar (Sin asociar) corre con permisos acotados: solo páginas feat y lib y borradores, sin tests", async () => {
    const r = await pedir("POST", "/api/agente", { tipo: "asociar", pedido: "Assign these 2 files to their feature in FlowBrain.", etiqueta: "Asociar 2 archivos", cerebros: ["tienda"] });
    expect(r.estado).toBe(200);
    const t = await esperar(r.json["id"] as string);
    expect(t).toMatchObject({ tipo: "asociar", etiqueta: "Asociar 2 archivos" });
    const lineas = (await readFile(join(dir, "llamadas.jsonl"), "utf8")).trim().split("\n");
    const { args } = JSON.parse(lineas[lineas.length - 1]!) as { args: string[] };
    const prompt = args[args.indexOf("-p") + 1]!;
    expect(prompt).toContain("Assign these 2 files to their feature in FlowBrain.");
    expect(prompt).toContain("This request can only write");
    expect(prompt).not.toContain("$ARGUMENTS");
    // Sin acceptEdits: lo que no está permitido se rechaza solo.
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
    const raiz = (await import("node:path")).resolve(join(reg, "tienda"));
    expect(args).toContain(`Edit(/${join(raiz, "_drafts", "**")})`);
    expect(args).toContain(`Write(/${join(raiz, "product", "feat-*.md")})`);
    expect(args).toContain(`Edit(/${join(raiz, "technology", "lib-*.md")})`);
    expect(args).not.toContain("Edit");
    expect(args).not.toContain("Write");
    expect(args).toContain("Bash(flowbrain compile:*)");
    expect(args).not.toContain("Bash(npx vitest:*)");
    expect(args).not.toContain("Bash(flowbrain:*)");
    for (const p of HERRAMIENTAS_PROHIBIDAS) expect(args).toContain(p);
    // Los otros tipos siguen con los permisos de siempre.
    expect(permisosDelPedido("test", ["/b"])).toEqual({});
    const comun = claudeCode("claude").armar({ prompt: "x", cwd: "/p", carpetasExtra: [] }).args;
    expect(comun[comun.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(comun).toContain("Edit");
  }, 30_000);

  it("sin Claude Code lo dice, y la guía de cada tipo de pedido es la que corresponde", async () => {
    const sin = crearAgente(() => leerRegistro(reg), { comando: join(dir, "no-existe") });
    expect(sin.noDisponible()).toContain("was not found on this machine");
    expect(() => sin.encolar({ tipo: "test", pedido: "x", etiqueta: "x", cerebros: [] })).toThrow("was not found on this machine");
    expect(indicacionesDelPedido("agrupar", "agrupá")).toContain("Every specification goes in a use case");
    expect(indicacionesDelPedido("agrupar", "agrupá")).not.toMatch(/^---/);
    expect(pasosDeEvento({ type: "user" }, "/x")).toEqual([]);
  });
});

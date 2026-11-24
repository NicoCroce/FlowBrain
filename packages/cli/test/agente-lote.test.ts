import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leerRegistro } from "@flowbrain/core";
import { crearAgente, extraerResultados, tamanioDeTanda } from "../src/agente.js";
import { editar } from "../src/edicion.js";
import { ejecutar } from "../src/main.js";
import { claudeCode } from "../src/proveedores.js";
import { crearServidorVisor, type ServidorVisor } from "../src/servidor-visor.js";

/**
 * "Pedir todos": un lote de reglas que se reparte por repo (en paralelo) y por tandas, con un agente falso que contesta
 * los cuatro resultados (a verificada, b ya cubierta, c el código no la cumple, d no se puede testear sin tocar código).
 * Una tanda que falla no frena a las otras.
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
type Tr = Record<string, any>;
async function estado(): Promise<{ trabajos: Tr[]; lotes: Tr[] }> {
  return (await pedir("GET", "/api/agente")).json as unknown as { trabajos: Tr[]; lotes: Tr[] };
}
async function esperarLote(id: string): Promise<Tr[]> {
  for (let i = 0; i < 300; i++) {
    const e = await estado();
    if (e.lotes.find((l) => l["id"] === id)?.["estado"] === "terminado") return e.trabajos.filter((t) => t["lote"] === id);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("el lote no terminó");
}
const regla = (repo: string, id: string, extra = "") => ({ cerebro: "tienda", funcionalidad: "feat-pedidos", regla: id, repo, linea: `- Cerebro tienda, feat-pedidos (Pedidos), regla ${id} [negocio]: texto ${id}${extra}` });
const ids = (repo: string, n: number) => Array.from({ length: n }, (_, i) => `${repo.replace("repo-", "")}-${i + 1}`);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-lote-"));
  reg = join(dir, ".flowbrain");
  for (const [carpeta, id] of [["api", "repo-api"], ["web", "repo-web"]] as const) {
    await w(`repos/${carpeta}/package.json`, `{ "name": "${carpeta}", "dependencies": { "express": "4" } }\n`);
    await w(`repos/${carpeta}/src/main.ts`, 'import { Router } from "express";\nexport const router = Router();\nrouter.get("/pedidos", (_q, r) => r.end());\n');
    execFileSync("git", ["init", "-q"], { cwd: join(dir, "repos", carpeta) });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: join(dir, "repos", carpeta) });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: join(dir, "repos", carpeta) });
    void id;
  }
  await mkdir(reg, { recursive: true });
  await writeFile(join(reg, "flowbrain.yaml"), "version: 1\ncerebros:\n  - nombre: tienda\n    repos: [{ ruta: ../repos/api, id: repo-api }, { ruta: ../repos/web, id: repo-web }]\n");
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
  const reglas = [...ids("repo-api", 18), ...ids("repo-web", 4), "lenta-1"].map((id) => `  - id: ${id}\n    texto: "texto ${id}"\n    tipo: negocio\n    archivos: [${id.startsWith("web") ? "repo-web" : "repo-api"}:src/main.ts]`);
  await writeFile(join(reg, "tienda/product/feat-pedidos.md"), ["---", "id: feat-pedidos", "tipo: feat", 'nombre: "Pedidos"', 'resumen: "Alta de pedidos."', "codigo:", "  - repo-api:src/main.ts", "  - repo-web:src/main.ts", "especificaciones:", ...reglas, "---", "# Pedidos", ""].join("\n"));
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);

  falso = join(dir, "claude-falso.mjs");
  await writeFile(falso, [
    "#!/usr/bin/env node",
    'import { appendFileSync } from "node:fs";',
    "const a = process.argv.slice(2);",
    'if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }',
    'const prompt = a[a.indexOf("-p") + 1];',
    "const desde = Date.now();",
    "const repo = (/repo (repo-[a-z]+)/.exec(prompt) || [])[1];",
    "const reglas = [...prompt.matchAll(/regla ([a-z0-9-]+) \\[/g)].map((m) => m[1]);",
    'if (prompt.includes("lenta-1")) await new Promise((r) => setTimeout(r, 20000));',
    'await new Promise((r) => setTimeout(r, 500));',
    `appendFileSync(${JSON.stringify(join(dir, "tandas.jsonl"))}, JSON.stringify({ repo, reglas, desde, hasta: Date.now(), modelo: a[a.indexOf("--model") + 1], args: a }) + "\\n");`,
    'if (prompt.includes("FALLA")) { console.error("se cayó el agente"); process.exit(1); }',
    "const salida = reglas.map((r, i) => {",
    '  const base = { cerebro: "tienda", funcionalidad: "feat-pedidos", regla: r };',
    '  const k = i % 4;',
    '  if (k === 0) return { ...base, resultado: "a", tests: [`${repo}:src/main.test.ts::${r} funciona`] };',
    '  if (k === 1) return { ...base, resultado: "b", tests: [`${repo}:src/viejo.test.ts::${r} ya estaba`] };',
    '  if (k === 2) return { ...base, resultado: "c", hoy: "src/main.ts#L3: responde sin validar", cambio: "Validar el cuerpo antes de responder.", test: `it("${r}", () => { expect(1).toBe(2) })` };',
    '  return { ...base, resultado: "d", ajuste: "Exportar la función para poder probarla." };',
    "});",
    'const ev = (o) => console.log(JSON.stringify(o));',
    'ev({ type: "assistant", message: { content: [{ type: "text", text: "Miro cómo testea el repo." }] } });',
    'ev({ type: "result", subtype: "success", is_error: false, result: "Listo.\\n```flowbrain-resultados\\n" + JSON.stringify(salida) + "\\n```", total_cost_usd: 0.1 });',
  ].join("\n"));
  await chmod(falso, 0o755);
  const aplicar = async (ed: Parameters<typeof editar>[1]) => editar(await leerRegistro(reg), ed);
  s = crearServidorVisor(reg, { agente: crearAgente(() => leerRegistro(reg), { proveedores: [claudeCode(falso)], aplicar }) });
  await new Promise<void>((ok) => s.server.listen(0, "127.0.0.1", ok));
}, 90_000);
afterAll(async () => {
  await new Promise((ok) => s.server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

describe("tandas", () => {
  it("reparte lo más parejo posible, sin pasar de 15", () => {
    expect([1, 10, 15, 16, 20, 30, 31, 45].map(tamanioDeTanda)).toEqual([1, 10, 15, 8, 10, 15, 11, 15]);
  });
  it("lee el bloque de resultados y descarta lo que no sirve", () => {
    const ok = '```flowbrain-resultados\n[{"cerebro":"c","funcionalidad":"feat-x","regla":"r","resultado":"A","tests":["repo-a:src/x.test.ts::va"]},{"cerebro":"c","funcionalidad":"feat-x","regla":"s","resultado":"c"},{"cerebro":"c","funcionalidad":"feat-x","regla":"t","resultado":"a","tests":["suelto"]}]\n```';
    const r = extraerResultados(ok);
    expect(r.resultados.map((x) => `${x.regla}:${x.resultado}`)).toEqual(["r:a"]);
    expect(r.errores).toHaveLength(2);
    expect(extraerResultados("nada").errores[0]).toContain("flowbrain-resultados");
  });
});

describe("pedir todos", () => {
  it("el visor sabe qué proveedores hay y con qué modelos; el de Claude Code lleva el por defecto marcado", async () => {
    const pagina = (await pedir("GET", "/")).cuerpo;
    expect(pagina).toContain('"proveedores":[{"id":"claude-code"');
    const p = ((await estado()) as unknown as { proveedores: Array<{ modelos: Array<{ id: string; porDefecto?: boolean }> }> }).proveedores[0]!;
    expect(p.modelos.map((m) => m.id)).toEqual(["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(p.modelos.filter((m) => m.porDefecto).map((m) => m.id)).toEqual(["claude-opus-5-5"]);
  });

  it("reparte por repo en paralelo y por tandas, una tanda caída no frena a las otras, y anota los cuatro resultados", async () => {
    const reglas = [...ids("repo-api", 18).map((id, i) => regla("repo-api", id, i === 0 ? " FALLA" : "")), ...ids("repo-web", 4).map((id) => regla("repo-web", id))];
    const r = await pedir("POST", "/api/agente/lote", { reglas, proveedor: "claude-code", modelo: "claude-sonnet-5-5" });
    expect(r.estado).toBe(200);
    const trabajos = await esperarLote((r.json["lote"] as Tr)["id"]);
    expect(trabajos.map((t) => `${t["repo"]} ${t["tanda"].n}/${t["tanda"].de}`).sort()).toEqual(["repo-api 1/2", "repo-api 2/2", "repo-web 1/1"]);
    const api1 = trabajos.find((t) => t["repo"] === "repo-api" && t["tanda"].n === 1)!, api2 = trabajos.find((t) => t["repo"] === "repo-api" && t["tanda"].n === 2)!, web = trabajos.find((t) => t["repo"] === "repo-web")!;
    expect(api1["estado"]).toBe("fallo");
    expect(api1["error"]).toContain("se cayó el agente");
    expect(api2["estado"]).toBe("terminado");
    expect(web["estado"]).toBe("terminado");
    expect(web["costoUsd"]).toBe(0.1);
    expect(web["modelo"]).toBe("claude-sonnet-5-5");

    // Cuatro resultados, anotados en la página.
    expect(web["resultados"].map((x: Tr) => `${x["regla"]}:${x["resultado"]}`)).toEqual(["web-1:a", "web-2:b", "web-3:c", "web-4:d"]);
    const pagina = await readFile(join(reg, "tienda/product/feat-pedidos.md"), "utf8");
    expect(pagina).toContain("tests:\n      - repo-web:src/main.test.ts::web-1 funciona");
    expect(pagina).toContain("repo-web:src/viejo.test.ts::web-2 ya estaba");
    expect(pagina).toMatch(/hallazgo:\n\s+resultado: "?codigo_no_cumple"?/);
    expect(pagina).toContain('hoy: "src/main.ts#L3: responde sin validar"');
    expect(pagina).toMatch(/resultado: "?no_testeable"?/);
    expect(pagina).toContain("Exportar la función");

    // Repos en paralelo; dentro de cada repo, una tanda después de otra.
    const log = (await readFile(join(dir, "tandas.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { repo: string; desde: number; hasta: number; modelo: string; args: string[]; reglas: string[] });
    const [t1, t2] = log.filter((x) => x.repo === "repo-api").sort((a, b) => a.desde - b.desde);
    const tw = log.find((x) => x.repo === "repo-web")!;
    expect(t2!.desde).toBeGreaterThanOrEqual(t1!.hasta - 50);
    expect(tw.desde).toBeLessThan(t1!.hasta);
    expect(tw.modelo).toBe("claude-sonnet-5-5");
    expect(tw.args).toContain("Bash(git push:*)");
    expect(log.map((x) => x.reglas.length).sort()).toEqual([4, 9, 9]);
  }, 60_000);

  it("el MCP y la CLI ven los hallazgos; la decisión de una persona queda en la página", async () => {
    const f = (await ejecutar(["specs", "pedidos", "--findings", "--root", join(reg, "tienda")], {}, dir)).stdout;
    expect(f).toContain('"hallazgo"');
    expect(f).toContain("codigo_no_cumple");
    expect(f).toContain("no_testeable");
    const lista = (JSON.parse(f) as { especificaciones: Array<{ id: string }> }).especificaciones.map((e) => e.id);
    expect(lista).toContain("web-3");
    expect(lista).toContain("web-4");
    expect(lista).not.toContain("web-1");
    const general = JSON.parse((await ejecutar(["specs", "--root", join(reg, "tienda")], {}, dir)).stdout) as Record<string, number>;
    expect(general["reglasConHallazgo"]).toBeGreaterThan(0);
    expect(general["paraDecidir"]).toBeGreaterThan(0);
    const dec = (decision: unknown) => pedir("POST", "/api/editar", { cerebro: "tienda", tipo: "decision", funcionalidad: "feat-pedidos", id: "web-3", decision });
    expect((await dec("codigo_mal")).json).toMatchObject({ cambio: true });
    expect(await readFile(join(reg, "tienda/product/feat-pedidos.md"), "utf8")).toContain("decision: codigo_mal");
    const luego = JSON.parse((await ejecutar(["specs", "--root", join(reg, "tienda")], {}, dir)).stdout) as Record<string, number>;
    expect(luego["paraDesarrollo"]).toBe((general["paraDesarrollo"] ?? 0) + 1);
    expect((await dec("otra")).estado).toBe(400);
    expect((await pedir("POST", "/api/editar", { cerebro: "tienda", tipo: "decision", funcionalidad: "feat-pedidos", id: "web-1", decision: "regla_mal" })).estado).toBe(400);
  }, 60_000);

  it("rechaza lotes inválidos, modelos que el proveedor no ofrece, y cancela un lote que corre", async () => {
    expect((await pedir("POST", "/api/agente/lote", { reglas: [] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { reglas: [{ ...regla("repo-api", "api-1"), cerebro: "otro" }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { reglas: [regla("repo-api", "api-1")], modelo: "gpt-7" })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { reglas: [regla("repo-api", "api-1")], proveedor: "codex" })).estado).toBe(400);
    const r = await pedir("POST", "/api/agente/lote", { reglas: [regla("repo-api", "lenta-1")] });
    expect(r.estado).toBe(200);
    await new Promise((x) => setTimeout(x, 400));
    const c = await pedir("POST", "/api/agente/lote/cancelar", { id: (r.json["lote"] as Tr)["id"] });
    expect((c.json["trabajos"] as Tr[]).map((t) => t["estado"])).toEqual(["cancelado"]);
    expect((await pedir("POST", "/api/agente/lote/cancelar", { id: "no-existe" })).estado).toBe(404);
    await esperarLote((r.json["lote"] as Tr)["id"]);
  }, 60_000);
});

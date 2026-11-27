import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarContexto, deriva, leerRegistro } from "@flowbrain/core";
import { claveDeDeriva, clavesDeDeriva, crearAgente, indicacionesDelPedido, pedidoDeTandaDeriva, permisosDelPedido, TANDA_MAX_DERIVA, type ProblemaDeDeriva } from "../src/agente.js";
import { aplicarCerebro, derivaDelCerebro } from "../src/cerebros.js";
import { ejecutar } from "../src/main.js";
import { claudeCode } from "../src/proveedores.js";
import { crearServidorVisor, type ServidorVisor } from "../src/servidor-visor.js";

/**
 * Los pedidos de la deriva en lote (dec. 232): llamadas que nadie atiende, endpoints que nadie llama y campos que no
 * coinciden. Un cerebro con dos repos: el front (`tienda-web`) llama a `/pedidos`, que existe, y a `/pedido-viejo`,
 * que no; el back (`tienda-api`) tiene `/salud` y `/webhooks/pago`, que nadie llama. El agente falso arregla la
 * llamada rota en el front (pasa a `/pedidos`) y deja una nota por los endpoints, sin borrar nada.
 */
let dir: string, reg: string, s: ServidorVisor;
const WEB = "repo-tienda-web", API = "repo-tienda-api";
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
const derivaHoy = async () => (await derivaDelCerebro(await leerRegistro(reg), "tienda"))!;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-deriva-"));
  reg = join(dir, "registro");
  await mkdir(reg, { recursive: true });
  await w("repos/tienda-api/package.json", ['{ "name": "tienda-api", "dependencies": { "express": "4" } }']);
  await w("repos/tienda-api/src/app.ts", ['import express from "express";', "const app = express();", 'app.get("/pedidos", (req, res) => res.json([]));', 'app.post("/webhooks/pago", (req, res) => res.json({}));', 'app.get("/salud", (req, res) => res.json({}));', "export default app;"]);
  await w("repos/tienda-web/package.json", ['{ "name": "tienda-web" }']);
  await w("repos/tienda-web/src/cliente.ts", ["const API = process.env.API;", "export async function listar() {", "  return fetch(`${API}/pedidos`);", "}", "export async function viejo() {", "  return fetch(`${API}/pedido-viejo`);", "}"]);
  await writeFile(join(reg, "flowbrain.yaml"), ["version: 1", "cerebros:", "  - nombre: tienda", "    repos: [{ ruta: ../repos/tienda-api }, { ruta: ../repos/tienda-web }]", ""].join("\n"));
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
  // El agente falso: anota lo que recibió; arregla la llamada rota del front y deja una nota por cada endpoint.
  const falso = join(dir, "claude-falso.mjs");
  await writeFile(falso, [
    "#!/usr/bin/env node",
    'import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const a = process.argv.slice(2);",
    'if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }',
    'const prompt = a[a.indexOf("-p") + 1];',
    "const items = [...prompt.matchAll(/^- \\[ \\] (.+)$/gm)].map((m) => m[1]);",
    "const desde = Date.now();",
    "await new Promise((r) => setTimeout(r, 150));",
    `appendFileSync(${JSON.stringify(join(dir, "tandas.jsonl"))}, JSON.stringify({ items, desde, hasta: Date.now(), args: a, prompt }) + "\\n");`,
    `const cliente = ${JSON.stringify(join(dir, "repos/tienda-web/src/cliente.ts"))};`,
    'if (prompt.includes("/pedido-viejo")) writeFileSync(cliente, readFileSync(cliente, "utf8").replace("/pedido-viejo", "/pedidos"));',
    'const notas = join(process.env.FLOWBRAIN_ROOT, "tienda", "_drafts");',
    'if (prompt.includes("endpoint nobody calls")) { mkdirSync(notas, { recursive: true }); appendFileSync(join(notas, "drift-notes.md"), "## /salud\\nProposal: delete it (nothing calls it).\\n"); }',
    'console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Fixed the call; left a note for the endpoints.", total_cost_usd: 0.05 }));',
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

const leerLog = async () => (await readFile(join(dir, "tandas.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { items: string[]; desde: number; hasta: number; args: string[]; prompt: string });
const ROTA: ProblemaDeDeriva = { cerebro: "tienda", clase: "sinEndpoint", ev: `${WEB}:src/cliente.ts#L6`, llamada: "GET ${env:API}/pedido-viejo", que: "Nobody serves this call, made from svc-tienda-web." };
const SALUD: ProblemaDeDeriva = { cerebro: "tienda", clase: "sinLlamadas", ev: `${API}:src/app.ts#L5`, endpoint: "svc-tienda-api:GET:/salud", que: "No indexed consumer calls this endpoint." };
const WEBHOOK: ProblemaDeDeriva = { cerebro: "tienda", clase: "sinLlamadas", ev: `${API}:src/app.ts#L4`, endpoint: "svc-tienda-api:POST:/webhooks/pago", que: "No indexed consumer calls this endpoint." };

describe("tandas de la deriva", () => {
  it("la deriva del cerebro tiene la llamada rota y los dos endpoints sin llamadas", async () => {
    const d = await derivaHoy();
    expect(d.llamadasSinEndpoint.map((x) => [x.ev, x.llamada])).toEqual([[ROTA.ev, ROTA.llamada]]);
    expect(d.endpointsSinLlamadasDetectadas.map((x) => [x.endpoint, x.ev])).toEqual([[SALUD.endpoint, SALUD.ev], [WEBHOOK.endpoint, WEBHOOK.ev]]);
    expect(clavesDeDeriva("tienda", d)).toEqual(new Set([ROTA, SALUD, WEBHOOK].map(claveDeDeriva)));
  });

  it("una llamada se reconoce por su archivo y su texto, sin la línea; un endpoint, por su id", () => {
    expect(claveDeDeriva({ ...ROTA, ev: `${WEB}:src/cliente.ts#L9` })).toBe(claveDeDeriva(ROTA));
    expect(claveDeDeriva({ ...ROTA, llamada: "GET /otra" })).not.toBe(claveDeDeriva(ROTA));
    expect(claveDeDeriva(SALUD)).toBe("tienda|sinLlamadas|svc-tienda-api:GET:/salud");
  });

  it("el pedido de una tanda: cada problema con su evidencia, en inglés; la guía dice que nunca se borra nada", () => {
    const p = pedidoDeTandaDeriva([ROTA, SALUD], WEB, "tienda", 2, 3);
    expect(p).toContain(`- [ ] call nobody serves: GET \${env:API}/pedido-viejo at ${ROTA.ev}. Nobody serves this call`);
    expect(p).toContain(`- [ ] endpoint nobody calls: svc-tienda-api:GET:/salud at ${SALUD.ev}.`);
    expect(p).toContain("batch 2 of 3");
    expect(p).toContain(".flowbrain/tienda/_drafts/drift-notes.md");
    const g = indicacionesDelPedido("deriva", p);
    expect(g).toContain("**Never make a destructive change.**");
    expect(g).toContain("Never delete it.");
    expect(g).toContain("«Unused on purpose»");
    expect(g).toContain("## How to resolve each problem");
    expect(g).toContain("- **Mismatched fields**: Align the side that is wrong.");
    expect(g).not.toContain("$ARGUMENTS");
    expect(TANDA_MAX_DERIVA).toBe(10);
  });

  it("con permisos acotados: el código del repo de la tanda, y calls.yaml y notas del cerebro; nada de tests ni git que cambie", () => {
    const p = permisosDelPedido("deriva", ["/x/.flowbrain/tienda"], ["/x/repos/web"]);
    expect(p.escritura).toEqual([join("/x/repos/web", "**"), join("/x/.flowbrain/tienda", "calls.yaml"), join("/x/.flowbrain/tienda", "_drafts", "**")]);
    expect(permisosDelPedido("deriva", ["/x/.flowbrain/tienda"]).escritura).toEqual([join("/x/.flowbrain/tienda", "calls.yaml"), join("/x/.flowbrain/tienda", "_drafts", "**")]);
    expect(p.comandos).toContain("flowbrain drift");
    expect(p.comandos).toContain("flowbrain brains apply");
    for (const no of ["npx vitest", "node", "rm", "git checkout", "git commit"]) expect(p.comandos).not.toContain(no);
  });
});

describe("lote de la deriva", () => {
  it("una tanda por repo, una detrás de otra en el cerebro: reindexa, rehace la deriva y mide qué problemas ya no están", async () => {
    const r = await pedir("POST", "/api/agente/lote", { tipo: "deriva", problemas: [ROTA, SALUD, WEBHOOK], proveedor: "claude-code", modelo: "claude-sonnet-5-5" });
    expect(r.estado).toBe(200);
    expect((r.json["lote"] as Tr)["tipo"]).toBe("deriva");
    const { lote, trabajos } = await esperarLote((r.json["lote"] as Tr)["id"]);
    expect(lote["error"]).toBeUndefined();
    expect(trabajos).toHaveLength(2);
    const web = trabajos.find((t) => t["repo"] === WEB)!, api = trabajos.find((t) => t["repo"] === API)!;
    expect(web).toMatchObject({ tipo: "deriva", estado: "terminado", modelo: "claude-sonnet-5-5", tanda: { n: 1, de: 1 }, etiqueta: `${WEB} · 1 problem` });
    expect(web["problemas"]).toEqual([ROTA]);
    expect(web["corregidos"]).toEqual([ROTA]);
    expect(web["persisten"]).toBeUndefined();
    // Los endpoints siguen: el agente dejó una nota y no borró nada.
    expect(api["etiqueta"]).toBe(`${API} · 2 problems`);
    expect(api["persisten"]).toEqual([SALUD, WEBHOOK]);
    expect(await readFile(join(dir, "repos/tienda-api/src/app.ts"), "utf8")).toContain('"/salud"');
    expect(await readFile(join(reg, "tienda", "_drafts", "drift-notes.md"), "utf8")).toContain("## /salud");
    // Las del mismo cerebro, una detrás de otra; cada una con la guía y sus permisos acotados a su repo.
    const log = await leerLog();
    expect(log).toHaveLength(2);
    const [a, b] = log.sort((x, y) => x.desde - y.desde);
    expect(b!.desde).toBeGreaterThanOrEqual(a!.hasta);
    const deWeb = log.find((l) => l.prompt.includes("/pedido-viejo"))!;
    expect(deWeb.prompt).toContain("Never make a destructive change.");
    const permisos = deWeb.args.join(" ");
    expect(permisos).toContain(join(dir, "repos", "tienda-web", "**"));
    expect(permisos).not.toContain(join(dir, "repos", "tienda-api", "**"));
    expect(permisos).toContain(join(reg, "tienda", "calls.yaml"));
    expect(permisos).toContain(join(reg, "tienda", "_drafts", "**"));
    expect(permisos).not.toContain("npx vitest");
    expect((await derivaHoy()).llamadasSinEndpoint).toEqual([]);
  }, 120_000);

  it("rechaza lotes inválidos con los mismos límites que los demás", async () => {
    const mal = async (x: unknown) => (await pedir("POST", "/api/agente/lote", { tipo: "deriva", problemas: [x] })).estado;
    expect((await pedir("POST", "/api/agente/lote", { tipo: "deriva", problemas: [] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "deriva", archivos: [SALUD] })).estado).toBe(400);
    expect(await mal({ ...SALUD, cerebro: "otro" })).toBe(400);
    expect(await mal({ ...SALUD, clase: "otra" })).toBe(400);
    expect(await mal({ ...SALUD, ev: "sin-linea:src/a.ts" })).toBe(400);
    expect(await mal({ ...SALUD, que: "dos\nlíneas" })).toBe(400);
    expect(await mal({ ...SALUD, endpoint: undefined })).toBe(400);
    expect(await mal({ ...SALUD, llamada: "GET /x" })).toBe(400);
    expect(await mal({ ...ROTA, llamada: undefined })).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "deriva", problemas: [SALUD, SALUD] })).estado).toBe(400);
    const muchos = Array.from({ length: 3001 }, (_, i) => ({ ...SALUD, endpoint: `svc-tienda-api:GET:/e${i}` }));
    const r = await pedir("POST", "/api/agente/lote", { tipo: "deriva", problemas: muchos });
    expect(r.estado).toBe(400);
    expect(String(r.json["error"])).toContain("1 to 3000 problems");
  });
});

describe("«Sin uso a propósito» (not-product.yaml, motivo sin-uso)", () => {
  it("una persona lo marca desde el visor: sale de la deriva (y del MCP), y se deshace", async () => {
    const editar = (motivo: string | null, entrada = WEBHOOK.endpoint!) => pedir("POST", "/api/editar", { tipo: "no_producto", cerebro: "tienda", entrada, motivo });
    const r = await editar("sin-uso");
    expect(r.estado).toBe(200);
    expect(String(r.json["mensaje"])).toContain("unused on purpose");
    expect(await readFile(join(reg, "tienda", "not-product.yaml"), "utf8")).toContain('entrada: "svc-tienda-api:POST:/webhooks/pago"');
    const d = await derivaHoy();
    expect(d.endpointsSinLlamadasDetectadas.map((x) => x.endpoint)).toEqual([SALUD.endpoint]);
    expect(d.sinUsoAProposito).toEqual([{ endpoint: WEBHOOK.endpoint, ev: WEBHOOK.ev, nadieLoLlama: true }]);
    // El MCP y el CLI leen el contexto del cerebro, con sus marcas.
    const ctx = await cargarContexto(join(reg, "tienda"));
    expect((deriva(ctx, { budget_tokens: null }) as { endpointsSinLlamadasDetectadas: Array<{ endpoint: string }> }).endpointsSinLlamadasDetectadas.map((x) => x.endpoint)).toEqual([SALUD.endpoint]);
    // Solo un endpoint del grafo, y solo con ese motivo.
    expect((await editar("sin-uso", "svc-tienda-api:GET:/no-existe")).estado).toBe(400);
    expect((await editar("script")).estado).toBe(400);
    // Deshacer: vuelve a la deriva.
    expect((await editar(null)).estado).toBe(200);
    expect((await derivaHoy()).endpointsSinLlamadasDetectadas.map((x) => x.endpoint)).toEqual([SALUD.endpoint, WEBHOOK.endpoint]);
    await appendFile(join(dir, "fin"), "");
  }, 60_000);
});

import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leerRegistro } from "@flowbrain/core";
import { crearAgente, pedidoDeTandaPaginas, permisosDelPedido, tandasDePaginas, TANDA_MAX_PAGINAS, type ItemDePagina } from "../src/agente.js";
import { ejecutar } from "../src/main.js";
import { claudeCode } from "../src/proveedores.js";
import { crearServidorVisor, type ServidorVisor } from "../src/servidor-visor.js";

/**
 * Los pedidos de Especificaciones en lote (dec. 230): agrupar, escribir y corregir. Las tandas van una detrás de otra,
 * con lo de una misma funcionalidad junto (en todos sus cerebros); al terminar cada una el servidor compila y mira en
 * las páginas qué quedó resuelto. Un agente falso «arregla» cada página que nombra el pedido: descomenta las líneas
 * `# <tipo>: ` y borra las que terminan en ` # <tipo>-borra`, salvo las funcionalidades que se llaman «deja».
 */
let dir: string, reg: string, s: ServidorVisor;
const w = async (ruta: string, texto: string) => {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), texto);
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
  for (let i = 0; i < 600; i++) {
    const e = (await pedir("GET", "/api/agente")).json as { trabajos: Tr[]; lotes: Tr[] };
    const lote = e.lotes.find((l) => l["id"] === id);
    if (lote?.["estado"] === "terminado") return { lote, trabajos: e.trabajos.filter((t) => t["lote"] === id) };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("el lote no terminó");
}
const regla = (id: string, extra: string[] = [], repo = "repo-api") => [`  - id: ${id}`, `    texto: "La regla ${id}."`, "    tipo: negocio", `    archivos: [${repo}:src/main.ts]`, "    tests: []", "    estado: propuesta", ...extra];
const pagina = (id: string, nombre: string, lineas: string[], repo = "repo-api") => ["---", `id: ${id}`, "tipo: feat", `nombre: "${nombre}"`, `resumen: "${nombre}."`, "codigo:", `  - ${repo}:src/main.ts`, ...lineas, "---", `# ${nombre}`, ""].join("\n");
const item = (cerebro: string, funcionalidad: string, extra: Partial<ItemDePagina> = {}): ItemDePagina => ({ cerebro, funcionalidad, ...extra, linea: `- ${funcionalidad}${extra.caso ? ` / ${extra.caso}` : ""}, brain ${cerebro}${extra.regla ? `, rule ${extra.regla}` : ""}: what to do.` });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-paginas-"));
  reg = join(dir, ".flowbrain");
  for (const carpeta of ["api", "admin"]) {
    await w(`repos/${carpeta}/package.json`, `{ "name": "${carpeta}" }\n`);
    await w(`repos/${carpeta}/src/main.ts`, "export const main = 1;\n");
    execFileSync("git", ["init", "-q"], { cwd: join(dir, "repos", carpeta) });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: join(dir, "repos", carpeta) });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: join(dir, "repos", carpeta) });
  }
  await mkdir(reg, { recursive: true });
  await writeFile(join(reg, "flowbrain.yaml"), "version: 1\ncerebros:\n  - nombre: tienda\n    repos: [{ ruta: ../repos/api, id: repo-api }]\n  - nombre: admin\n    repos: [{ ruta: ../repos/admin, id: repo-admin }]\n");
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
  // agrupar: feat-pedidos (en los dos cerebros) y feat-deja tienen reglas sin caso.
  await writeFile(join(reg, "tienda/product/feat-pedidos.md"), pagina("feat-pedidos", "Pedidos", ["especificaciones:", ...regla("alta"), ...regla("baja"), "# agrupar: casos: [{ id: gestionar, nombre: Gestionar pedidos, especificaciones: [alta, baja] }]"]));
  await writeFile(join(reg, "admin/product/feat-pedidos.md"), pagina("feat-pedidos", "Pedidos", ["especificaciones:", ...regla("ver", [], "repo-admin"), "# agrupar: casos: [{ id: gestionar, nombre: Gestionar pedidos, especificaciones: [ver] }]"], "repo-admin"));
  await writeFile(join(reg, "tienda/product/feat-deja.md"), pagina("feat-deja", "Deja", ["especificaciones:", ...regla("suelta"), "# agrupar: casos: [{ id: x, nombre: X, especificaciones: [suelta] }]"]));
  // escribir: feat-envios, feat-stock y feat-dejado, sin nada escrito.
  await writeFile(join(reg, "tienda/product/feat-dejado.md"), pagina("feat-dejado", "Dejado", []));
  await writeFile(join(reg, "tienda/product/feat-envios.md"), pagina("feat-envios", "Envíos", ["# escribir: especificaciones: [{ id: costo, texto: El envío cuesta según la distancia., tipo: negocio, archivos: [repo-api:src/main.ts], tests: [], estado: propuesta }]"]));
  await writeFile(join(reg, "tienda/product/feat-stock.md"), pagina("feat-stock", "Stock", ["# escribir: especificaciones: [{ id: nunca-negativo, texto: El stock nunca es negativo., tipo: negocio, archivos: [repo-api:src/main.ts], tests: [], estado: propuesta }]"]));
  // corregir: un caso marcado como mal y una regla con hallazgo «la regla está mal».
  await writeFile(join(reg, "tienda/product/feat-pagos.md"), pagina("feat-pagos", "Pagos", [
    "especificaciones:", ...regla("cobro", ["    hallazgo: # corregir-borra", "      resultado: codigo_no_cumple # corregir-borra", "      cambio: Cobrar una sola vez. # corregir-borra", "      decision: regla_mal # corregir-borra"]),
    "casos:", "  - id: pagar", "    nombre: Pagar", "    especificaciones: [cobro]", "    problema: falta el reintento # corregir-borra",
  ]));
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);

  const falso = join(dir, "claude-falso.mjs");
  await writeFile(falso, [
    "#!/usr/bin/env node",
    'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const a = process.argv.slice(2);",
    'if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }',
    'const prompt = a[a.indexOf("-p") + 1];',
    'const tipo = prompt.includes("Group into use cases the specifications that are not") ? "agrupar" : prompt.includes("Write the use cases and specifications of") ? "escribir" : "corregir";',
    "const items = [...prompt.matchAll(/^- (feat-[a-z]+)\\b.*?brain ([a-z]+)/gm)].map((m) => ({ feat: m[1], cerebro: m[2] }));",
    "const desde = Date.now();",
    "await new Promise((r) => setTimeout(r, 200));",
    `appendFileSync(${JSON.stringify(join(dir, "tandas.jsonl"))}, JSON.stringify({ tipo, items, desde, hasta: Date.now(), args: a, guia: prompt.includes("Everything comes from the code and the tests") }) + "\\n");`,
    "for (const x of items) {",
    '  if (x.feat.includes("deja")) continue;',
    '  const ruta = join(process.env.FLOWBRAIN_ROOT, x.cerebro, "product", x.feat + ".md");',
    '  const nueva = readFileSync(ruta, "utf8").split("\\n").filter((l) => !l.endsWith(" # " + tipo + "-borra")).map((l) => l.startsWith("# " + tipo + ": ") ? l.slice(tipo.length + 4) : l).join("\\n");',
    "  writeFileSync(ruta, nueva);",
    "}",
    'console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Listo; dejé feat-deja.", total_cost_usd: 0.03 }));',
  ].join("\n"));
  await chmod(falso, 0o755);
  s = crearServidorVisor(reg, { agente: crearAgente(() => leerRegistro(reg), { proveedores: [claudeCode(falso)] }) });
  await new Promise<void>((ok) => s.server.listen(0, "127.0.0.1", ok));
}, 120_000);
afterAll(async () => {
  await new Promise((ok) => s.server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

const leerLog = async () => (await readFile(join(dir, "tandas.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { tipo: string; items: Array<{ feat: string; cerebro: string }>; desde: number; hasta: number; args: string[]; guia: boolean });

describe("tandas de agrupar, escribir y corregir", () => {
  it("juntan lo de una misma funcionalidad y no pasan del máximo (salvo una funcionalidad que sola lo pasa)", () => {
    expect(TANDA_MAX_PAGINAS).toEqual({ agrupar: 8, escribir: 3, corregir: 10, funcionalidad: 5, borrador: 8 });
    const xs = ["a", "b", "b", "c", "d", "d", "d", "d", "e"].map((f, i) => ({ funcionalidad: f, i }));
    expect(tandasDePaginas(xs, 3).map((t) => t.map((x) => x.funcionalidad).join(""))).toEqual(["abb", "c", "dddd", "e"]);
  });
  it("el pedido de una tanda dice qué hacer, trae sus ítems y cómo cerrar, en inglés", () => {
    const p = pedidoDeTandaPaginas("agrupar", [item("tienda", "feat-a"), item("admin", "feat-a")], 2, 3);
    expect(p).toContain("batch 2 of 3");
    expect(p).toContain("Group into use cases the specifications that are not in any use case yet, in this FlowBrain feature");
    expect(p).toContain("- feat-a, brain admin: what to do.");
    expect(p).toContain("Do NOT modify the project's repositories");
    const c = pedidoDeTandaPaginas("corregir", [item("tienda", "feat-a", { caso: "pagar" }), item("tienda", "feat-a", { regla: "cobro" })], 1, 1);
    expect(c).toContain("Fix this FlowBrain use case that a person marked as wrong");
    expect(c).toContain("Fix the text of this FlowBrain rule");
    expect(c.indexOf("/ pagar")).toBeLessThan(c.indexOf("Fix the text"));
    expect(c).not.toContain("batch");
  });
  it("con permisos acotados: solo las páginas de producto de sus cerebros, y leer y compilar FlowBrain", () => {
    for (const t of ["agrupar", "escribir", "corregir"] as const) {
      const p = permisosDelPedido(t, ["/x/.flowbrain/tienda"]);
      expect(p.escritura).toEqual([join("/x/.flowbrain/tienda", "product", "feat-*.md"), join("/x/.flowbrain/tienda", "_drafts", "product", "feat-*.md")]);
      expect(p.comandos).toContain("flowbrain specs");
      expect(p.comandos).not.toContain("npx vitest");
    }
  });
});

describe("lote agrupar, escribir y corregir", () => {
  it("agrupar: una tanda con lo de los dos cerebros, compila y mide qué quedó sin reglas sueltas", async () => {
    const items = [item("tienda", "feat-pedidos"), item("admin", "feat-pedidos"), item("tienda", "feat-deja")];
    const r = await pedir("POST", "/api/agente/lote", { tipo: "agrupar", items, proveedor: "claude-code", modelo: "claude-sonnet-5-5" });
    expect(r.estado).toBe(200);
    expect((r.json["lote"] as Tr)["tipo"]).toBe("agrupar");
    const { lote, trabajos } = await esperarLote((r.json["lote"] as Tr)["id"]);
    expect(lote["error"]).toBeUndefined();
    expect(trabajos).toHaveLength(1);
    const t = trabajos[0]!;
    expect(t).toMatchObject({ tipo: "agrupar", estado: "terminado", modelo: "claude-sonnet-5-5", tanda: { n: 1, de: 1 }, etiqueta: "2 features" });
    expect(t["cerebros"].sort()).toEqual(["admin", "tienda"]);
    expect(t["resueltos"]).toEqual([{ cerebro: "tienda", funcionalidad: "feat-pedidos" }, { cerebro: "admin", funcionalidad: "feat-pedidos" }]);
    expect(t["quedan"]).toEqual([{ cerebro: "tienda", funcionalidad: "feat-deja" }]);
    expect(await readFile(join(reg, "admin/product/feat-pedidos.md"), "utf8")).toContain("casos: [{ id: gestionar");
    // Con la guía de especificaciones y permisos acotados a las páginas de los cerebros de la tanda.
    const log = (await leerLog()).filter((x) => x.tipo === "agrupar");
    expect(log).toHaveLength(1);
    expect(log[0]!.guia).toBe(true);
    const permisos = log[0]!.args.join(" ");
    expect(permisos).toContain(join(reg, "tienda", "product", "feat-*.md"));
    expect(permisos).toContain(join(reg, "admin", "product", "feat-*.md"));
    expect(permisos).not.toContain("npx vitest");
  }, 60_000);

  it("escribir: de a 3 funcionalidades por tanda, una detrás de otra", async () => {
    const items = ["feat-envios", "feat-stock", "feat-dejado", "feat-pedidos"].map((f) => item("tienda", f));
    const r = await pedir("POST", "/api/agente/lote", { tipo: "escribir", items });
    expect(r.estado).toBe(200);
    const { trabajos } = await esperarLote((r.json["lote"] as Tr)["id"]);
    expect(trabajos.map((t) => `${t["tanda"].n}/${t["tanda"].de} ${t["items"].length}`).sort()).toEqual(["1/2 3", "2/2 1"]);
    const res = trabajos.flatMap((t) => t["resueltos"] ?? []).map((x: Tr) => x["funcionalidad"]).sort();
    // feat-pedidos ya tenía reglas: cuenta como resuelta; feat-dejado no se escribió.
    expect(res).toEqual(["feat-envios", "feat-pedidos", "feat-stock"]);
    const log = (await leerLog()).filter((x) => x.tipo === "escribir").sort((a, b) => a.desde - b.desde);
    expect(log).toHaveLength(2);
    expect(log[1]!.desde).toBeGreaterThanOrEqual(log[0]!.hasta - 50);
  }, 60_000);

  it("corregir: el caso marcado y la regla con hallazgo, en la misma tanda; quedan resueltos al sacar la marca", async () => {
    const items = [item("tienda", "feat-pagos", { caso: "pagar" }), item("tienda", "feat-pagos", { regla: "cobro" })];
    const r = await pedir("POST", "/api/agente/lote", { tipo: "corregir", items });
    expect(r.estado).toBe(200);
    const { trabajos } = await esperarLote((r.json["lote"] as Tr)["id"]);
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]!["etiqueta"]).toBe("2 use cases and rules");
    expect(trabajos[0]!["resueltos"]).toEqual([{ cerebro: "tienda", funcionalidad: "feat-pagos", caso: "pagar" }, { cerebro: "tienda", funcionalidad: "feat-pagos", regla: "cobro" }]);
    const p = await readFile(join(reg, "tienda/product/feat-pagos.md"), "utf8");
    expect(p).not.toContain("problema:");
    expect(p).not.toContain("hallazgo:");
  }, 60_000);

  it("rechaza lotes inválidos con los mismos límites que los demás", async () => {
    const uno = item("tienda", "feat-pedidos");
    expect((await pedir("POST", "/api/agente/lote", { tipo: "agrupar", items: [] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "agrupar", reglas: [uno] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "agrupar", items: [{ ...uno, cerebro: "otro" }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "agrupar", items: [{ ...uno, funcionalidad: "con espacio" }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "agrupar", items: [{ ...uno, linea: " " }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "agrupar", items: [uno, uno] })).estado).toBe(400);
    // agrupar y escribir: una funcionalidad sola; corregir: un caso o una regla, uno de los dos.
    expect((await pedir("POST", "/api/agente/lote", { tipo: "escribir", items: [{ ...uno, caso: "x" }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "corregir", items: [uno] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "corregir", items: [{ ...uno, caso: "x", regla: "y" }] })).estado).toBe(400);
    const muchos = Array.from({ length: 3001 }, (_, i) => item("tienda", `feat-${i}`));
    const r = await pedir("POST", "/api/agente/lote", { tipo: "escribir", items: muchos });
    expect(r.estado).toBe(400);
    expect(String(r.json["error"])).toContain("1 to 3000 items");
    expect((await pedir("POST", "/api/agente/lote", { tipo: "agrupar", items: [uno], modelo: "gpt-7" })).estado).toBe(400);
  });
});

import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leerRegistro } from "@flowbrain/core";
import { crearAgente, dondeEstaElRepo, pedidoDeTandaAsociar, tamanioDeTanda, TANDA_MAX_ASOCIAR } from "../src/agente.js";
import { ejecutar } from "../src/main.js";
import { claudeCode } from "../src/proveedores.js";
import { crearServidorVisor, type ServidorVisor } from "../src/servidor-visor.js";

/**
 * «Mandar al agente» de Sin asociar: un lote `asociar` con todos los archivos, que se reparte en tandas por cerebro y
 * repo. Las tandas de un cerebro van una detrás de otra (editan sus páginas); los cerebros, en paralelo. Al terminar
 * cada tanda el servidor compila el cerebro y cuenta qué archivos dejaron de estar sin asociar. Un agente falso asocia
 * cada archivo a la única funcionalidad de su cerebro, salvo los que se llaman «deja».
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
const archivo = (cerebro: string, a: string) => ({ cerebro, archivo: a, linea: `- ${a} (brain ${cerebro}): no hint: nothing links it to a feature` });
const api = Array.from({ length: 35 }, (_, i) => `repo-api:src/extra/a${i + 1}${i === 4 ? "-deja" : ""}.ts`);
const web = ["repo-web:src/web/w1.ts", "repo-web:src/web/w2.ts", "repo-web:src/web/w3.ts"];
const adm = ["repo-admin:src/panel/p1.ts", "repo-admin:src/panel/p2-FALLA.ts"];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-asociar-"));
  reg = join(dir, ".flowbrain");
  const repos: Record<string, string[]> = { api, web, admin: adm };
  for (const [carpeta, archivos] of Object.entries(repos)) {
    await w(`repos/${carpeta}/package.json`, `{ "name": "${carpeta}" }\n`);
    await w(`repos/${carpeta}/src/main.ts`, "export const main = 1;\n");
    for (const a of archivos) await w(`repos/${carpeta}/${a.slice(a.indexOf(":") + 1)}`, `export const x = "${a}";\n`);
    execFileSync("git", ["init", "-q"], { cwd: join(dir, "repos", carpeta) });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: join(dir, "repos", carpeta) });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: join(dir, "repos", carpeta) });
  }
  await mkdir(reg, { recursive: true });
  await writeFile(join(reg, "flowbrain.yaml"), "version: 1\ncerebros:\n  - nombre: tienda\n    repos: [{ ruta: ../repos/api, id: repo-api }, { ruta: ../repos/web, id: repo-web }]\n  - nombre: admin\n    repos: [{ ruta: ../repos/admin, id: repo-admin }]\n");
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
  await writeFile(join(reg, "tienda/product/feat-pedidos.md"), ["---", "id: feat-pedidos", "tipo: feat", 'nombre: "Pedidos"', 'resumen: "Alta de pedidos."', "codigo:", "  - repo-api:src/main.ts", "  - repo-web:src/main.ts", "---", "# Pedidos", ""].join("\n"));
  await writeFile(join(reg, "admin/product/feat-usuarios.md"), ["---", "id: feat-usuarios", "tipo: feat", 'nombre: "Usuarios"', 'resumen: "Alta de usuarios."', "codigo:", "  - repo-admin:src/main.ts", "---", "# Usuarios", ""].join("\n"));
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);

  const falso = join(dir, "claude-falso.mjs");
  await writeFile(falso, [
    "#!/usr/bin/env node",
    'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const a = process.argv.slice(2);",
    'if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }',
    'const prompt = a[a.indexOf("-p") + 1];',
    "const desde = Date.now();",
    "const cerebro = (/\\(brain ([a-z]+)[,)]/.exec(prompt) || [])[1];",
    "const archivos = [...prompt.matchAll(/^- (repo-[a-z]+:\\S+) \\(brain/gm)].map((m) => m[1]);",
    "await new Promise((r) => setTimeout(r, 400));",
    `appendFileSync(${JSON.stringify(join(dir, "tandas.jsonl"))}, JSON.stringify({ cerebro, archivos, desde, hasta: Date.now(), args: a, guia: prompt.includes("Do not modify the project's repositories"), donde: (/^Where the repo is: (.*)$/m.exec(prompt) || [])[1], compila: prompt.includes("flowbrain compile --brain <brain>") }) + "\\n");`,
    'if (archivos.some((x) => x.includes("FALLA"))) { console.error("se cayó el agente"); process.exit(1); }',
    `const pagina = join(process.env.FLOWBRAIN_ROOT, cerebro, "product", cerebro === "admin" ? "feat-usuarios.md" : "feat-pedidos.md");`,
    'const nuevos = archivos.filter((x) => !x.includes("deja")).map((x) => "  - " + x + "\\n").join("");',
    'writeFileSync(pagina, readFileSync(pagina, "utf8").replace("codigo:\\n", "codigo:\\n" + nuevos));',
    'const dejados = archivos.filter((x) => x.includes("deja")).map((x) => ({ ref: x, reason: "It is shared code, not a feature" }));',
    'const fin = dejados.length ? "\\n```flowbrain-pending\\n" + JSON.stringify(dejados) + "\\n```" : "";',
    'console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Asocié " + archivos.length + "; dejé los que dicen deja." + fin, total_cost_usd: 0.05 }));',
  ].join("\n"));
  await chmod(falso, 0o755);
  s = crearServidorVisor(reg, { agente: crearAgente(() => leerRegistro(reg), { proveedores: [claudeCode(falso)] }) });
  await new Promise<void>((ok) => s.server.listen(0, "127.0.0.1", ok));
}, 120_000);
afterAll(async () => {
  await new Promise((ok) => s.server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

describe("tandas de asociar", () => {
  it("van de hasta 30 archivos, lo más parejas posible", () => {
    expect(TANDA_MAX_ASOCIAR).toBe(30);
    expect([1, 30, 31, 35, 60, 61].map((n) => tamanioDeTanda(n, TANDA_MAX_ASOCIAR))).toEqual([1, 30, 16, 18, 30, 21]);
  });
  it("el pedido de una tanda trae sus archivos, su repo, su cerebro y cuál es de cuántas", () => {
    const p = pedidoDeTandaAsociar([archivo("tienda", "repo-api:src/x.ts")], "repo-api", "tienda", 2, 3);
    expect(p).toContain("Assign this file of repo-api (brain tienda, batch 2 of 3)");
    expect(p).toContain("- repo-api:src/x.ts (brain tienda): no hint");
    expect(p).toContain("only handle these");
  });
  it("dice en qué carpeta está el repo: su id no siempre es el nombre de la carpeta", () => {
    expect(dondeEstaElRepo("repo-tienda", "/p/repos/tienda", "/p")).toBe("Where the repo is: repo-tienda is the folder `repos/tienda/` (from the working folder), so a reference repo-tienda:path is the file `repos/tienda/path`.");
    expect(dondeEstaElRepo("repo-x", "/p", "/p")).toBe("Where the repo is: repo-x is the folder `./` (from the working folder), so a reference repo-x:path is the file `path`.");
    // Fuera de la carpeta de trabajo, la ruta absoluta.
    expect(dondeEstaElRepo("repo-y", "/otro/y", "/p")).toBe("Where the repo is: repo-y is the folder `/otro/y/`, so a reference repo-y:path is the file `/otro/y/path`.");
  });
});

describe("lote asociar", () => {
  it("reparte por cerebro y repo, cada cerebro en orden y los cerebros en paralelo, y cuenta lo que quedó asociado", async () => {
    const archivos = [...api.map((a) => archivo("tienda", a)), ...web.map((a) => archivo("tienda", a)), ...adm.map((a) => archivo("admin", a))];
    const r = await pedir("POST", "/api/agente/lote", { tipo: "asociar", archivos, proveedor: "claude-code", modelo: "claude-sonnet-5-5" });
    expect(r.estado).toBe(200);
    expect((r.json["lote"] as Tr)["tipo"]).toBe("asociar");
    const { lote, trabajos } = await esperarLote((r.json["lote"] as Tr)["id"]);
    expect(lote["error"]).toBeUndefined();
    expect(trabajos.map((t) => `${t["repo"]} ${t["tanda"].n}/${t["tanda"].de} ${t["archivos"].length}`).sort()).toEqual(["repo-admin 1/1 2", "repo-api 1/2 18", "repo-api 2/2 17", "repo-web 1/1 3"]);
    for (const t of trabajos) expect(t["tipo"]).toBe("asociar");
    expect(trabajos.find((t) => t["repo"] === "repo-web")!["modelo"]).toBe("claude-sonnet-5-5");

    // Lo cuenta el servidor, compilando: «deja» y la tanda caída siguen sin asociar.
    const api1 = trabajos.find((t) => t["repo"] === "repo-api" && t["tanda"].n === 1)!;
    expect(api1["estado"]).toBe("terminado");
    expect(api1["asociados"]).toHaveLength(17);
    expect(api1["siguen"]).toEqual([{ cerebro: "tienda", archivo: "repo-api:src/extra/a5-deja.ts" }]);
    expect(trabajos.find((t) => t["repo"] === "repo-web")!["asociados"]).toHaveLength(3);
    const admin = trabajos.find((t) => t["repo"] === "repo-admin")!;
    expect(admin["estado"]).toBe("fallo");
    expect(admin["error"]).toContain("se cayó el agente");
    expect(admin["siguen"]).toHaveLength(2);
    // Cada ítem termina con su desenlace (dec. 235): lo resuelto con lo que cambió; lo demás, con el motivo del agente.
    const ds = api1["desenlaces"] as Tr[];
    expect(ds).toHaveLength(18);
    expect(ds.filter((d) => d["resuelto"]).every((d) => d["cambio"].asociado === true)).toBe(true);
    expect(ds.find((d) => !d["resuelto"])).toEqual({ item: { cerebro: "tienda", archivo: "repo-api:src/extra/a5-deja.ts" }, resuelto: false, motivo: { codigo: "sigue", agente: "It is shared code, not a feature" } });
    expect((admin["desenlaces"] as Tr[]).map((d) => [d["resuelto"], d["motivo"].codigo, String(d["motivo"].detalle).includes("se cayó")])).toEqual([[false, "fallo", true], [false, "fallo", true]]);
    expect(pedidoDeTandaAsociar([archivo("tienda", "repo-api:src/x.ts")], "repo-api", "tienda", 1, 1)).toContain("flowbrain-pending");
    expect(await readFile(join(reg, "tienda/product/feat-pedidos.md"), "utf8")).toContain("  - repo-web:src/web/w2.ts");
    const quedan = JSON.parse((await ejecutar(["unassigned", "--root", join(reg, "tienda")], {}, dir)).stdout) as { total: number };
    expect(quedan.total).toBe(1);

    // Un cerebro, una tanda detrás de otra (editan las mismas páginas); otro cerebro, a la vez.
    const log = (await readFile(join(dir, "tandas.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { cerebro: string; archivos: string[]; desde: number; hasta: number; args: string[]; guia: boolean; donde?: string; compila: boolean });
    const tienda = log.filter((x) => x.cerebro === "tienda").sort((a, b) => a.desde - b.desde);
    expect(tienda).toHaveLength(3);
    for (let i = 1; i < tienda.length; i++) expect(tienda[i]!.desde).toBeGreaterThanOrEqual(tienda[i - 1]!.hasta - 50);
    const ad = log.find((x) => x.cerebro === "admin")!;
    expect(ad.desde).toBeLessThan(tienda[0]!.hasta);
    // Con la guía y los permisos acotados del pedido «asociar»: solo las páginas feat-*/lib-* y _drafts/ de su cerebro.
    expect(log.every((x) => x.guia)).toBe(true);
    // Cada tanda dice dónde está su repo en disco y cómo compilar con varios cerebros (prueba real con Claude Code).
    expect(log.find((x) => x.archivos.some((a) => a.startsWith("repo-web:")))!.donde).toContain("repo-web is the folder `repos/web/`");
    expect(ad.donde).toContain("repo-admin is the folder `repos/admin/`");
    expect(log.every((x) => x.compila)).toBe(true);
    const permisos = tienda[0]!.args.join(" ");
    expect(permisos).toContain(join(reg, "tienda", "product", "feat-*.md"));
    expect(permisos).not.toContain(join(reg, "admin"));
  }, 90_000);

  it("rechaza lotes asociar inválidos con los mismos límites que los de tests", async () => {
    const uno = archivo("tienda", "repo-api:src/extra/a1.ts");
    expect((await pedir("POST", "/api/agente/lote", { tipo: "otro", archivos: [uno] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "asociar", archivos: [] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "asociar", reglas: [uno] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "asociar", archivos: [{ ...uno, cerebro: "otro" }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "asociar", archivos: [{ ...uno, archivo: "sin-repo.ts" }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "asociar", archivos: [{ ...uno, linea: " " }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "asociar", archivos: [uno, uno] })).estado).toBe(400);
    const muchos = Array.from({ length: 3001 }, (_, i) => archivo("tienda", `repo-api:src/m${i}.ts`));
    const r = await pedir("POST", "/api/agente/lote", { tipo: "asociar", archivos: muchos });
    expect(r.estado).toBe(400);
    expect(String(r.json["error"])).toContain("1 to 3000 files");
    expect((await pedir("POST", "/api/agente/lote", { tipo: "asociar", archivos: [uno], modelo: "gpt-7" })).estado).toBe(400);
  });
});

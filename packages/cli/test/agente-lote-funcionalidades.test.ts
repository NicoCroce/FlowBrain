import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leerRegistro } from "@flowbrain/core";
import { crearAgente, indicacionesDelPedido, pedidoDeTandaPaginas, permisosDelPedido, resueltoEnBorrador, tandasDePaginas, TANDA_MAX_PAGINAS, type ItemDePagina } from "../src/agente.js";
import { ejecutar } from "../src/main.js";
import { claudeCode, PROVEEDORES } from "../src/proveedores.js";
import { crearServidorVisor, type ServidorVisor } from "../src/servidor-visor.js";

/**
 * Los pedidos de la pantalla Funcionalidades en lote (dec. 233): describir funcionalidades sin nombre de negocio ni
 * descripción, o proponer las de un cerebro que no tiene ninguna. Van con la guía de `flowbrain features --guide` y
 * escriben SOLO borradores en `_drafts/product/`; al terminar cada tanda el servidor mira los borradores. Un agente
 * falso escribe el borrador de cada funcionalidad que nombra el pedido (salvo «feat-deja») y, en una propuesta, una
 * funcionalidad nueva para el cerebro (salvo el cerebro «vacio»).
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
const pagina = (id: string, nombre: string, resumen: string) => ["---", `id: ${id}`, "tipo: feat", `nombre: "${nombre}"`, `resumen: "${resumen}"`, "codigo:", "  - repo-api:src/main.ts", "---", `# ${nombre}`, ""].join("\n");
const describir = (cerebro: string, funcionalidad: string): ItemDePagina => ({ cerebro, funcionalidad, linea: `- ${funcionalidad} (today: x), brain ${cerebro}: 3 files. No business name or description yet.` });
const proponer = (cerebro: string): ItemDePagina => ({ cerebro, funcionalidad: "", linea: `- brain ${cerebro} (repos: repo-x): it has no features yet.` });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-funcionalidades-"));
  reg = join(dir, ".flowbrain");
  for (const carpeta of ["api", "admin", "vacio"]) {
    await w(`repos/${carpeta}/package.json`, `{ "name": "${carpeta}" }\n`);
    await w(`repos/${carpeta}/src/main.ts`, "export const main = 1;\n");
    execFileSync("git", ["init", "-q"], { cwd: join(dir, "repos", carpeta) });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: join(dir, "repos", carpeta) });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: join(dir, "repos", carpeta) });
  }
  await mkdir(reg, { recursive: true });
  await writeFile(join(reg, "flowbrain.yaml"), "version: 1\ncerebros:\n  - nombre: tienda\n    repos: [{ ruta: ../repos/api, id: repo-api }]\n  - nombre: admin\n    repos: [{ ruta: ../repos/admin, id: repo-admin }]\n  - nombre: vacio\n    repos: [{ ruta: ../repos/vacio, id: repo-vacio }]\n");
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
  await writeFile(join(reg, "tienda/product/feat-envios.md"), pagina("feat-envios", "envios", "Draft: generado desde src/envios"));
  await writeFile(join(reg, "tienda/product/feat-deja.md"), pagina("feat-deja", "deja", "Draft: generado"));
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);

  const falso = join(dir, "claude-falso.mjs");
  await writeFile(falso, [
    "#!/usr/bin/env node",
    'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const a = process.argv.slice(2);",
    'if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }',
    'const prompt = a[a.indexOf("-p") + 1];',
    "const describir = [...prompt.matchAll(/^- (feat-[a-z]+) \\(today: [^)]*\\), brain ([a-z]+)/gm)].map((m) => ({ feat: m[1], cerebro: m[2] }));",
    "const proponer = [...prompt.matchAll(/^- brain ([a-z]+)\\b/gm)].map((m) => m[1]);",
    `appendFileSync(${JSON.stringify(join(dir, "tandas.jsonl"))}, JSON.stringify({ describir, proponer, args: a, guia: prompt.includes("complete this project's feature catalog"), soloBorradores: prompt.includes("write ONLY drafts") }) + "\\n");`,
    'const escribir = (cerebro, id, resumen) => { const c = join(process.env.FLOWBRAIN_ROOT, cerebro, "_drafts", "product"); mkdirSync(c, { recursive: true }); writeFileSync(join(c, id + ".md"), ["---", "id: " + id, "tipo: feat", "nombre: Envíos a domicilio", "resumen: " + resumen, "codigo: [repo-api:src/main.ts]", "---", "# Envíos", ""].join("\\n")); };',
    'for (const x of describir) if (x.feat !== "feat-deja") escribir(x.cerebro, x.feat, "Elegir cómo y cuándo llega la compra.");',
    'for (const c of proponer) if (c !== "vacio") escribir(c, "feat-nueva", "Lo que hace la gente en " + c + ".");',
    'console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Listo.", total_cost_usd: 0.05 }));',
  ].join("\n"));
  await chmod(falso, 0o755);
  s = crearServidorVisor(reg, { agente: crearAgente(() => leerRegistro(reg), { proveedores: [claudeCode(falso)] }) });
  await new Promise<void>((ok) => s.server.listen(0, "127.0.0.1", ok));
}, 120_000);
afterAll(async () => {
  await new Promise((ok) => s.server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

const leerLog = async () => (await readFile(join(dir, "tandas.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { describir: Array<{ feat: string; cerebro: string }>; proponer: string[]; args: string[]; guia: boolean; soloBorradores: boolean });

describe("pedidos de Funcionalidades", () => {
  it("una propuesta es de un cerebro entero: va en su grupo, y las funcionalidades de a 5", () => {
    expect(TANDA_MAX_PAGINAS.funcionalidad).toBe(5);
    const xs = [describir("tienda", "feat-a"), proponer("tienda"), proponer("admin"), describir("admin", "feat-a")];
    expect(tandasDePaginas(xs, 2).map((t) => t.map((x) => x.funcionalidad || `@${x.cerebro}`).join(","))).toEqual(["feat-a,feat-a", "@tienda,@admin"]);
  });
  it("el pedido usa la guía de flowbrain features --guide y dice que escriba solo borradores, en inglés", () => {
    const p = pedidoDeTandaPaginas("funcionalidad", [describir("tienda", "feat-a"), proponer("admin")], 1, 2);
    expect(p).toContain("batch 1 of 2");
    expect(p).toContain("Complete this FlowBrain feature with a business name");
    expect(p).toContain("This FlowBrain brain has no features yet. Propose them");
    expect(p).toContain("write ONLY drafts in .flowbrain/<brain>/_drafts/product/");
    expect(p).not.toContain("compile each brain");
    const ind = indicacionesDelPedido("funcionalidad", p);
    expect(ind).toContain("complete this project's feature catalog");
    expect(ind).not.toContain("description: Deduce");
  });
  it("con permisos acotados: solo borradores en _drafts/product, y leer FlowBrain y proponer con flowbrain draft", () => {
    const p = permisosDelPedido("funcionalidad", ["/x/.flowbrain/tienda"]);
    expect(p.escritura).toEqual([join("/x/.flowbrain/tienda", "_drafts", "product", "**")]);
    expect(p.comandos).toContain("flowbrain draft");
    expect(p.comandos).not.toContain("flowbrain promote");
    expect(p.comandos!.some((c) => /vitest|npm|pnpm/.test(c))).toBe(false);
  });
  it("cada modelo estima describir una funcionalidad y proponer las de un cerebro", () => {
    for (const m of PROVEEDORES.flatMap((f) => f().modelos())) {
      expect(m.costoPorPaginaUsd.funcionalidad).toBeGreaterThan(0);
      expect(m.costoPorPaginaUsd.proponer).toBeGreaterThan(m.costoPorPaginaUsd.funcionalidad);
    }
  });
  it("resuelto: el borrador de la funcionalidad con nombre y resumen de verdad; una propuesta, uno nuevo desde que empezó", async () => {
    const raiz = join(dir, "solo-borradores");
    await mkdir(join(raiz, "_drafts", "product"), { recursive: true });
    await writeFile(join(raiz, "_drafts/product/feat-a.md"), pagina("feat-a", "A", "Hace A."));
    await writeFile(join(raiz, "_drafts/product/feat-b.md"), pagina("feat-b", "b", "Draft: generado"));
    expect(await resueltoEnBorrador(raiz, { funcionalidad: "feat-a" })).toBe(true);
    expect(await resueltoEnBorrador(raiz, { funcionalidad: "feat-b" })).toBe(false);
    expect(await resueltoEnBorrador(raiz, { funcionalidad: "feat-c" })).toBe(false);
    expect(await resueltoEnBorrador(raiz, { funcionalidad: "" })).toBe(true);
    const viejo = new Date(Date.now() - 60_000);
    await utimes(join(raiz, "_drafts/product/feat-a.md"), viejo, viejo);
    expect(await resueltoEnBorrador(raiz, { funcionalidad: "" }, Date.now() - 1000)).toBe(false);
  });
});

describe("lote funcionalidad", () => {
  it("rechaza lo que no es una funcionalidad o un cerebro conocido; acepta la propuesta sin funcionalidad", async () => {
    expect((await pedir("POST", "/api/agente/lote", { tipo: "funcionalidad", items: [{ cerebro: "nadie", linea: "x" }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "funcionalidad", items: [{ cerebro: "tienda", funcionalidad: "feat a", linea: "x" }] })).estado).toBe(400);
    expect((await pedir("POST", "/api/agente/lote", { tipo: "funcionalidad", items: [{ cerebro: "tienda", caso: "c", funcionalidad: "feat-a", linea: "x" }] })).estado).toBe(400);
    // Solo «funcionalidad» acepta un ítem sin funcionalidad.
    expect((await pedir("POST", "/api/agente/lote", { tipo: "escribir", items: [{ cerebro: "tienda", linea: "x" }] })).estado).toBe(400);
  });

  it("describe y propone, escribe solo borradores y mide en ellos qué quedó hecho", async () => {
    const items = [describir("tienda", "feat-envios"), describir("tienda", "feat-deja"), proponer("admin"), proponer("vacio")].map(({ funcionalidad, ...x }) => (funcionalidad ? { ...x, funcionalidad } : x));
    const r = await pedir("POST", "/api/agente/lote", { tipo: "funcionalidad", items, proveedor: "claude-code", modelo: "claude-sonnet-5-5" });
    expect(r.estado).toBe(200);
    expect((r.json["lote"] as Tr)["tipo"]).toBe("funcionalidad");
    const { trabajos } = await esperarLote((r.json["lote"] as Tr)["id"]);
    // Caben en una tanda (hasta 5): las dos fichas de tienda y los dos cerebros a proponer.
    expect(trabajos.map((t) => t["etiqueta"])).toEqual(["2 features · proposal for 2 brains"]);
    const resueltos = trabajos.flatMap((t) => t["resueltos"] ?? []).map((x: Tr) => `${x["cerebro"]}|${x["funcionalidad"]}`);
    const quedan = trabajos.flatMap((t) => t["quedan"] ?? []).map((x: Tr) => `${x["cerebro"]}|${x["funcionalidad"]}`);
    expect(resueltos.sort()).toEqual(["admin|", "tienda|feat-envios"]);
    expect(quedan.sort()).toEqual(["tienda|feat-deja", "vacio|"]);
    // La página de producto no se tocó: el borrador espera a que una persona lo promueva.
    expect(await readFile(join(reg, "tienda/product/feat-envios.md"), "utf8")).toContain("Draft: generado");
    expect(await readFile(join(reg, "tienda/_drafts/product/feat-envios.md"), "utf8")).toContain("Envíos a domicilio");
    const log = await leerLog();
    expect(log.every((t) => t.guia && t.soloBorradores)).toBe(true);
    const permisos = log[0]!.args.join(" ");
    expect(permisos).toContain(`Write(/${join(reg, "tienda", "_drafts", "product", "**")})`);
    expect(permisos).not.toContain(join(reg, "tienda", "product", "feat-"));
    expect(permisos).toContain("Bash(flowbrain draft:*)");
  });
});

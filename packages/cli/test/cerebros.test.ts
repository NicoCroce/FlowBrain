import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interpretarRegistro, RegistroError } from "@brain/core";
import { crearMulti, crearServidor } from "@brain/mcp";
import { ejecutar } from "../src/main.js";

/**
 * Tres repos sintéticos: un front que llama a `${API_URL}/pedidos`, y dos back que atienden esa misma ruta (el
 * vigente y uno viejo). Cada uno en su cerebro.
 */
let dir: string, reg: string;
const w = async (ruta: string, lineas: string[]) => {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), lineas.join("\n") + "\n");
};
const brain = (args: string[], cwd = dir) => ejecutar([...args, "--raiz", reg], {}, cwd);
const back = (nombre: string, extra: string[] = []) => [
  w(`repos/${nombre}/package.json`, [`{ "name": "${nombre}", "dependencies": { "express": "4" } }`]),
  w(`repos/${nombre}/src/main.ts`, [
    'import { Router, type Request, type Response } from "express";',
    "export async function listarPedidos(req: Request, res: Response) { res.json([]); }",
    "export async function crearPedido(req: Request, res: Response) { res.status(201).end(); }",
    "export const router = Router();",
    'router.get("/pedidos", listarPedidos);',
    'router.post("/pedidos", crearPedido);',
    ...extra,
  ]),
];
const registro = (extra: string[] = []) =>
  writeFile(
    join(reg, "cerebros.yaml"),
    [
      "version: 1",
      "cerebros:",
      "  - nombre: front",
      "    repos: [{ ruta: ../repos/tienda-web }]",
      "  - nombre: back",
      "    repos: [{ ruta: ../repos/tienda-api }]",
      "  - nombre: legado",
      "    curado: false",
      "    repos: [{ ruta: ../repos/tienda-vieja }]",
      ...extra,
      "",
    ].join("\n"),
  );
const COMUNICADOS = ["comunicacion:", "  - { entre: [front, back], activa: true }"];

async function mcp(cwd: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await crearServidor(() => Promise.reject(new Error("sin cerebro")), crearMulti(reg, { cwd })).connect(a);
  const cliente = new Client({ name: "test", version: "0" });
  await cliente.connect(b);
  const llamar = async (nombre: string, args: Record<string, unknown> = {}) => {
    const r = (await cliente.callTool({ name: nombre, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
  };
  return { cliente, llamar };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-cerebros-"));
  reg = join(dir, "registro");
  await mkdir(reg, { recursive: true });
  await Promise.all([
    ...back("tienda-api"),
    ...back("tienda-vieja"),
    w("repos/tienda-web/package.json", ['{ "name": "tienda-web", "dependencies": { "react": "19" } }']),
    w("repos/tienda-web/src/api.ts", [
      "const API_URL = import.meta.env.VITE_API_URL;",
      "export async function listarPedidos(): Promise<unknown> {",
      "  const res = await fetch(`${API_URL}/pedidos`);",
      "  return res.json();",
      "}",
      "export async function crearPedido(p: unknown): Promise<void> {",
      '  await fetch(`${API_URL}/pedidos`, { method: "POST", body: JSON.stringify(p) });',
      "}",
    ]),
  ]);
}, 60_000);
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("registro de cerebros", () => {
  it("valida el archivo: tope de cerebros, nombres repetidos y referencias a cerebros que no existen", () => {
    const con = (cuerpo: string) => interpretarRegistro(`version: 1\ncerebros:\n${cuerpo}`, "/tmp/x");
    const uno = (n: string) => `  - { nombre: ${n}, repos: [] }\n`;
    expect(con(uno("a") + uno("b")).cerebros.map((c) => `${c.nombre} ${c.raiz} ${c.curado}`)).toEqual(["a /tmp/x/a true", "b /tmp/x/b true"]);
    expect(() => con(["a", "b", "c", "d", "e", "f"].map(uno).join(""))).toThrow(/como máximo 5 cerebros/);
    expect(() => con(uno("a") + uno("a"))).toThrow(/cerebro repetido: a/);
    expect(() => con(uno("a") + "comunicacion:\n  - { entre: [a, z], activa: true }\n")).toThrow(RegistroError);
    expect(() => con(uno("a") + "conexiones:\n  - { desde: a/svc-x, hacia: z/svc-y }\n")).toThrow(/cerebro inexistente: z/);
    const r = con(uno("a") + uno("b") + uno("c") + "comunicacion:\n  - { entre: [b, a], activa: true }\n  - { entre: [a, c], activa: false }\n");
    expect([r.comunicados("a", "b"), r.comunicados("b", "a"), r.comunicados("a", "c"), r.comunicados("b", "c")]).toEqual([true, true, false, false]);
    expect(r.vecinos("a").map((c) => c.nombre)).toEqual(["b"]);
  });

  it("proponer explora la carpeta y deja un borrador con los repos, lo detectado y las preguntas", async () => {
    const r = await brain(["cerebros", "proponer", join(dir, "repos")]);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain("3 repos");
    const texto = await readFile(join(reg, "cerebros.yaml"), "utf8");
    expect(texto).toContain('- ruta: "../repos/tienda-web"');
    expect(texto).toContain("¿Cómo se agrupan estos 3 repos en cerebros (hasta 5)");
    expect(texto).toContain("endpoints: 2");
    // Lo propuesto es un registro válido: un cerebro con todo.
    expect(interpretarRegistro(texto, reg).cerebros.map((c) => `${c.nombre} ${c.repos.length}`)).toEqual(["repos 3"]);
    // Con un registro ya escrito, no lo pisa.
    expect((await brain(["cerebros", "proponer", join(dir, "repos")])).stdout).toContain("cerebros.propuesta.yaml");
  });

  it("aplicar crea e indexa cada cerebro; los comandos eligen el cerebro por nombre o por el repo donde se está", async () => {
    await registro(COMUNICADOS);
    const r = await brain(["cerebros", "aplicar"]);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toMatch(/^front: \d+ nodos/m);
    expect(r.stdout).toMatch(/^legado \(sin curar\): \d+ nodos/m);
    expect((await brain(["cerebros"])).stdout).toContain("  comunicado con: back");
    const enBack = JSON.parse((await brain(["buscar", "/pedidos", "--cerebro", "back"])).stdout) as { nodos: Array<{ id: string }> };
    expect(enBack.nodos.map((n) => n.id)).toEqual(["svc-tienda-api:GET:/pedidos", "svc-tienda-api:POST:/pedidos"]);
    // Parado en el repo del front, sin --cerebro: el suyo, donde esa ruta no es un endpoint.
    const enFront = JSON.parse((await brain(["buscar", "/pedidos"], join(dir, "repos/tienda-web/src"))).stdout) as { nodos: Array<{ tipo: string }> };
    expect(enFront.nodos.filter((n) => n.tipo === "endpoint")).toEqual([]);
    // Fuera de todo repo y con varios cerebros, hay que elegir.
    const sinElegir = await brain(["buscar", "/pedidos"]);
    expect(sinElegir.codigo).not.toBe(0);
    expect(sinElegir.stdout + sinElegir.stderr).toContain("elegí uno con --cerebro");
  }, 60_000);
});

describe("varios cerebros por MCP", () => {
  it("consulta el cerebro del repo actual, rotula la respuesta y avisa lo que hay en los comunicados", async () => {
    const { cliente, llamar } = await mcp(join(dir, "repos/tienda-web"));
    expect(cliente.getInstructions()).toContain("varios cerebros");
    const r = await llamar("buscar_nodo", { texto: "/pedidos" });
    expect(r["cerebro"]).toBe("front");
    expect((r["nodos"] as Array<{ tipo: string }>).filter((n) => n.tipo === "endpoint")).toEqual([]);
    // Pista: el back está comunicado; el legado no, así que no aparece.
    expect(r["otrosCerebros"]).toEqual([{ cerebro: "back", coincidencias: 2, nodos: ["svc-tienda-api:GET:/pedidos", "svc-tienda-api:POST:/pedidos"] }]);
    // Una pista cuesta poco: menos de 40 tokens.
    expect(Math.ceil(JSON.stringify(r["otrosCerebros"]).length / 4)).toBeLessThan(40);
    // Sin coincidencia exacta no hay pista.
    expect(await llamar("buscar_nodo", { texto: "pedid" })).not.toHaveProperty("otrosCerebros");
    const legado = await llamar("buscar_nodo", { texto: "/pedidos", cerebro: "legado" });
    expect([legado["cerebro"], legado["sinRevisar"], legado["otrosCerebros"]]).toEqual(["legado", true, undefined]);
    expect((await llamar("buscar_nodo", { texto: "x", cerebro: "nada" }))["error"]).toMatchObject({ codigo: "nodo_inexistente" });
  });

  it("relaciones entre cerebros: las llamadas del front llegan a los endpoints del back, solo con la comunicación activa", async () => {
    const { llamar } = await mcp(join(dir, "repos/tienda-web"));
    const c = (await llamar("conexiones")) as { comunicadoCon: string[]; conexiones: Array<Record<string, unknown>>; avisos: string[] };
    expect(c.comunicadoCon).toEqual(["back"]);
    expect(c.conexiones.map((x) => `${x["desde"]} → ${x["hacia"]}: ${x["llamadas"]} llamadas, ${x["endpoints"]} endpoints, declarada ${x["declarada"]}`)).toEqual(["front/svc-tienda-web → back/svc-tienda-api: 2 llamadas, 2 endpoints, declarada false"]);
    expect(c.avisos).toEqual(["llamadas detectadas sin conexión declarada: front/svc-tienda-web → back/svc-tienda-api (2)", "comunicación desactivada con: legado"]);
    // Desde el back: el impacto de su endpoint dice quién lo llama desde otro cerebro.
    const imp = (await llamar("impacto", { pieza: "GET /pedidos", cerebro: "back" })) as { llamadoDesdeOtrosCerebros: { total: number; llamadas: unknown[] } };
    expect(imp.llamadoDesdeOtrosCerebros).toEqual({ total: 1, llamadas: [{ endpoint: "svc-tienda-api:GET:/pedidos", cerebro: "front", desde: "svc-tienda-web", ev: "repo-tienda-web:src/api.ts#L3" }] });

    // Se apaga la comunicación en el registro: sin reiniciar ni reindexar, deja de haber pistas y cruces.
    await new Promise((r) => setTimeout(r, 20));
    await registro(["comunicacion:", "  - { entre: [front, back], activa: false }"]);
    expect(await llamar("buscar_nodo", { texto: "/pedidos" })).not.toHaveProperty("otrosCerebros");
    expect(await llamar("impacto", { pieza: "GET /pedidos", cerebro: "back" })).not.toHaveProperty("llamadoDesdeOtrosCerebros");
  });

  it("una conexión declarada con `por` decide a cuál de dos servicios con las mismas rutas va cada llamada", async () => {
    await new Promise((r) => setTimeout(r, 20));
    // Los dos back atienden /pedidos. El front declara que por API_URL va al vigente y por LEGACY_URL al viejo.
    await registro([
      "comunicacion:",
      "  - { entre: [front, back], activa: true }",
      "  - { entre: [front, legado], activa: true }",
      "conexiones:",
      "  - { desde: front/svc-tienda-web, hacia: back/svc-tienda-api, por: API_URL }",
      "  - { desde: front/svc-tienda-web, hacia: legado/svc-tienda-vieja, por: LEGACY_URL }",
    ]);
    const r = JSON.parse((await brain(["conexiones", "--cerebro", "front"])).stdout) as { conexiones: Array<Record<string, unknown>>; avisos: string[] };
    expect(r.conexiones.map((x) => `${x["desde"]} → ${x["hacia"]}: ${x["llamadas"]} (declarada ${x["declarada"]})`)).toEqual([
      "front/svc-tienda-web → back/svc-tienda-api: 2 (declarada true)",
      "front/svc-tienda-web → legado/svc-tienda-vieja: 0 (declarada true)",
    ]);
    expect(r.avisos).toEqual(["conexión declarada sin llamadas que la respalden: front/svc-tienda-web → legado/svc-tienda-vieja"]);
  });
});

describe("hook con varios cerebros", () => {
  const hook = async (cwd: string, prompt: string) => (await ejecutar(["hook", "claude-code", "--raiz", reg], {}, dir, async () => JSON.stringify({ prompt, cwd }))).stdout;
  it("carga solo el cerebro del repo donde se está; fuera de todo repo conocido no inyecta nada", async () => {
    expect(await hook(join(dir, "repos/tienda-api"), "¿qué hace GET /pedidos?")).toContain("Repo actual: repo-tienda-api");
    expect(await hook(join(dir, "repos/tienda-web"), "revisá el repo")).toContain("Repo actual: repo-tienda-web");
    expect(await hook(dir, "¿qué hace GET /pedidos?")).toBe("");
    expect(await hook(tmpdir(), "tienda-api")).toBe("");
  });
});

describe("registrar en Claude Code", () => {
  it("deja los hooks apuntando al registro e imprime la línea del MCP", async () => {
    const settings = join(dir, "settings.json");
    await writeFile(settings, '{ "hooks": { "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "otro-hook" }] }] } }\n');
    const r = await ejecutar(["cerebros", "registrar", "--raiz", reg, "--settings", settings], { BRAIN_COMANDO: "brain" }, dir);
    expect(r.stdout).toContain(`claude mcp add --scope user brain -- brain serve --sync --raiz ${reg}`);
    const s = JSON.parse(await readFile(settings, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(s.hooks["UserPromptSubmit"]!.flatMap((e) => e.hooks.map((h) => h.command))).toEqual(["otro-hook", `brain hook claude-code --raiz ${reg}`]);
    expect(s.hooks["SessionEnd"]!.flatMap((e) => e.hooks.map((h) => h.command))).toEqual([`brain hook claude-code --raiz ${reg}`]);
  });
});

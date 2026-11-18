import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interpretarRegistro, RegistroError } from "@flowbrain/core";
import { crearMulti, crearServidor } from "@flowbrain/mcp";
import { encontrarRepos } from "../src/cerebros.js";
import type { Evidencia } from "../src/evidencia.js";
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
const brain = (args: string[], cwd = dir) => ejecutar([...args, "--root", reg], {}, cwd);
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
    join(reg, "flowbrain.yaml"),
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
    expect(() => con(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(uno).join(""))).toThrow(/como máximo 8 cerebros/);
    expect(() => con(uno("a") + uno("a"))).toThrow(/cerebro repetido: a/);
    expect(() => con(uno("a") + "comunicacion:\n  - { entre: [a, z], activa: true }\n")).toThrow(RegistroError);
    expect(() => con(uno("a") + "conexiones:\n  - { desde: a/svc-x, hacia: z/svc-y }\n")).toThrow(/cerebro inexistente: z/);
    const r = con(uno("a") + uno("b") + uno("c") + "comunicacion:\n  - { entre: [b, a], activa: true }\n  - { entre: [a, c], activa: false }\n");
    expect([r.comunicados("a", "b"), r.comunicados("b", "a"), r.comunicados("a", "c"), r.comunicados("b", "c")]).toEqual([true, true, false, false]);
    expect(r.vecinos("a").map((c) => c.nombre)).toEqual(["b"]);
  });

  it("proponer explora la carpeta y deja un borrador con los repos, lo detectado y las preguntas", async () => {
    const r = await brain(["brains", "propose", join(dir, "repos")]);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain("3 repos");
    const texto = await readFile(join(reg, "flowbrain.yaml"), "utf8");
    expect(texto).toContain('- ruta: "../repos/tienda-web"');
    expect(texto).toContain("¿Cómo se agrupan estos 3 repos en cerebros (hasta 8)");
    expect(texto).toContain("endpoints: 2");
    // Lo propuesto es un registro válido: un cerebro con todo.
    expect(interpretarRegistro(texto, reg).cerebros.map((c) => `${c.nombre} ${c.repos.length}`)).toEqual(["repos 3"]);
    // Con un registro ya escrito, no lo pisa.
    expect((await brain(["brains", "propose", join(dir, "repos")])).stdout).toContain("flowbrain.proposal.yaml");
  });

  it("aplicar crea e indexa cada cerebro; los comandos eligen el cerebro por nombre o por el repo donde se está", async () => {
    await registro(COMUNICADOS);
    const r = await brain(["brains", "apply"]);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toMatch(/^front: \d+ nodos/m);
    expect(r.stdout).toMatch(/^legado \(sin curar\): \d+ nodos/m);
    expect((await brain(["brains"])).stdout).toContain("  comunicado con: back");
    const enBack = JSON.parse((await brain(["search", "/pedidos", "--brain", "back"])).stdout) as { nodos: Array<{ id: string }> };
    expect(enBack.nodos.map((n) => n.id)).toEqual(["svc-tienda-api:GET:/pedidos", "svc-tienda-api:POST:/pedidos"]);
    // Parado en el repo del front, sin --brain: el suyo, donde esa ruta no es un endpoint.
    const enFront = JSON.parse((await brain(["search", "/pedidos"], join(dir, "repos/tienda-web/src"))).stdout) as { nodos: Array<{ tipo: string }> };
    expect(enFront.nodos.filter((n) => n.tipo === "endpoint")).toEqual([]);
    // Fuera de todo repo y con varios cerebros, hay que elegir.
    const sinElegir = await brain(["search", "/pedidos"]);
    expect(sinElegir.codigo).not.toBe(0);
    expect(sinElegir.stdout + sinElegir.stderr).toContain("elegí uno con --brain");
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
    // La llamada del front no sale de ninguna pantalla: queda como servicio afectado, sin funcionalidades.
    const imp = (await llamar("impacto", { pieza: "GET /pedidos", cerebro: "back" })) as Record<string, unknown>;
    expect(imp["enOtrosCerebros"]).toEqual([{ salto: 1, cerebro: "front", funcionalidades: [], pantallas: { total: 0, primeras: [] }, servicios: { total: 1, primeros: [{ svc: "svc-tienda-web", endpoint: "svc-tienda-api:GET:/pedidos", ev: "repo-tienda-web:src/api.ts#L3" }] } }]);
    expect(imp).not.toHaveProperty("llamadoDesdeOtrosCerebros");

    // Se apaga la comunicación en el registro: sin reiniciar ni reindexar, deja de haber pistas y cruces.
    await new Promise((r) => setTimeout(r, 20));
    await registro(["comunicacion:", "  - { entre: [front, back], activa: false }"]);
    expect(await llamar("buscar_nodo", { texto: "/pedidos" })).not.toHaveProperty("otrosCerebros");
    expect(await llamar("impacto", { pieza: "GET /pedidos", cerebro: "back" })).not.toHaveProperty("enOtrosCerebros");
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
    const r = JSON.parse((await brain(["connections", "--brain", "front"])).stdout) as { conexiones: Array<Record<string, unknown>>; avisos: string[] };
    expect(r.conexiones.map((x) => `${x["desde"]} → ${x["hacia"]}: ${x["llamadas"]} (declarada ${x["declarada"]})`)).toEqual([
      "front/svc-tienda-web → back/svc-tienda-api: 2 (declarada true)",
      "front/svc-tienda-web → legado/svc-tienda-vieja: 0 (declarada true)",
    ]);
    expect(r.avisos).toEqual(["conexión declarada sin llamadas que la respalden: front/svc-tienda-web → legado/svc-tienda-vieja"]);
  });
});

describe("hook con varios cerebros", () => {
  const hook = async (cwd: string, prompt: string) => (await ejecutar(["hook", "claude-code", "--root", reg], {}, dir, async () => JSON.stringify({ prompt, cwd }))).stdout;
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
    const r = await ejecutar(["brains", "register", "--root", reg, "--settings", settings], { FLOWBRAIN_COMANDO: "flowbrain" }, dir);
    expect(r.stdout).toContain(`claude mcp add --scope user flowbrain -- flowbrain serve --sync --root ${reg}`);
    const s = JSON.parse(await readFile(settings, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(s.hooks["UserPromptSubmit"]!.flatMap((e) => e.hooks.map((h) => h.command))).toEqual(["otro-hook", `flowbrain hook claude-code --root ${reg}`]);
    expect(s.hooks["SessionEnd"]!.flatMap((e) => e.hooks.map((h) => h.command))).toEqual([`flowbrain hook claude-code --root ${reg}`]);
  });
});

describe("dentro de un proyecto", () => {
  // Siempre con --settings y --bin: sin eso, install tocaría la instalación real de quien corre los tests.
  const global = () => ["--settings", join(dir, "global/settings.json"), "--bin", join(dir, "global/bin")];
  const env = { FLOWBRAIN_COMANDO: "flowbrain" };

  it("install pregunta dónde están los repos y cómo dividirlos, crea .flowbrain e indexa; después todo lo encuentra solo", async () => {
    const proyecto = join(dir, "repos");
    const preguntas: string[] = [];
    const responder = async (q: string) => (preguntas.push(q), preguntas.length === 1 ? "" : "1");
    const r = await ejecutar(["install", ...global()], { ...env, PATH: join(dir, "global/bin") }, proyecto, undefined, responder);
    expect(preguntas[0]).toBe(`¿En qué carpeta están los repositorios? (Enter: ${proyecto}) `);
    expect(preguntas[1]).toContain("Encontré 3: tienda-api, tienda-vieja, tienda-web.");
    expect(r.stdout).toContain(`registro creado en ${join(proyecto, ".flowbrain/flowbrain.yaml")}: 3 repos en 3 cerebros`);
    const yaml = await readFile(join(proyecto, ".flowbrain/flowbrain.yaml"), "utf8");
    expect(yaml).toContain('  - nombre: tienda-web\n    curado: true\n    repos:\n      - ruta: "../tienda-web"');
    expect(yaml).toContain("comunicacion:\n  - { entre: [tienda-api, tienda-vieja], activa: true }\n  - { entre: [tienda-api, tienda-web], activa: true }\n  - { entre: [tienda-vieja, tienda-web], activa: true }");
    expect(await readFile(join(proyecto, ".flowbrain/.gitignore"), "utf8")).toBe("*/_build/\nflowbrain.html\n");
    // La parte de la máquina: comando en el PATH, hooks sin carpeta fija y la línea del MCP.
    expect(await readFile(join(dir, "global/bin/flowbrain"), "utf8")).toContain('exec flowbrain "$@"');
    expect(JSON.parse(await readFile(join(dir, "global/settings.json"), "utf8")).hooks.UserPromptSubmit[0].hooks[0].command).toBe("flowbrain hook claude-code");
    expect(r.stdout).toContain("claude mcp add --scope user flowbrain -- flowbrain serve --sync\n");
    expect(r.stdout).not.toContain("no está en tu PATH");
    // Sin --root, parado adentro de un repo del proyecto.
    const b = JSON.parse((await ejecutar(["search", "/pedidos", "--types", "endpoint"], {}, join(proyecto, "tienda-api/src"))).stdout) as { nodos: Array<{ id: string }> };
    expect(b.nodos.map((n) => n.id)).toContain("svc-tienda-api:GET:/pedidos");
    // El hook no lleva --root: usa la carpeta de la sesión. Fuera de un proyecto no dice nada y no falla.
    const hook = (cwd: string) => ejecutar(["hook", "claude-code"], {}, dir, async () => JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "qué hace GET /pedidos en svc-tienda-api", cwd }));
    expect((await hook(join(proyecto, "tienda-api"))).stdout).toContain("<flowbrain-context>");
    expect(await hook(dir)).toEqual({ codigo: 0, stdout: "", stderr: "" });
    // Volver a correrlo actualiza, sin preguntar ni pisar el registro.
    expect((await ejecutar(["install", ...global()], env, proyecto, undefined, responder)).stdout).toContain("registro existente");
    expect(preguntas.length).toBe(2);
  }, 120_000);

  it("evidence junta por base de URL dónde se define y con qué coincide; una conexión declarada por el modelo resuelve las disputadas", async () => {
    const proyecto = join(dir, "repos");
    await w("repos/tienda-web/.env.example", ["VITE_API_URL=http://localhost:3000"]);
    await w("repos/tienda-web/.env", ["VITE_API_URL=http://solo-en-el-env-real"]);
    const ev = async () => JSON.parse((await ejecutar(["evidence"], {}, proyecto)).stdout) as Evidencia;
    const antes = await ev();
    // Las dos APIs atienden las mismas rutas: método y ruta no dicen a cuál va el front, así que no se une a ninguna.
    expect(antes.disputadas).toEqual([{ base: "${env:VITE_API_URL}", desde: "tienda-web/svc-tienda-web", entre: ["tienda-api", "tienda-vieja"], llamadas: 2 }]);
    const base = antes.bases[0]!;
    expect([base.desde, base.base, base.llamadas, base.sinDestino]).toEqual(["tienda-web/svc-tienda-web", "${env:VITE_API_URL}", 2, 0]);
    expect(base.coincide).toEqual([{ destino: "tienda-api/svc-tienda-api", llamadas: 2, soloAhi: 0 }, { destino: "tienda-vieja/svc-tienda-vieja", llamadas: 2, soloAhi: 0 }]);
    // La definición sale del archivo de ejemplo; el .env real no se abre.
    expect(base.definiciones).toEqual([{ archivo: "tienda-web/.env.example#L1", nombre: "VITE_API_URL", texto: "VITE_API_URL=http://localhost:3000" }]);
    const conn = async () => JSON.parse((await ejecutar(["connections", "--brain", "tienda-web"], {}, proyecto)).stdout) as { conexiones: Array<Record<string, unknown>>; avisos: string[] };
    expect((await conn()).conexiones).toEqual([]);
    expect((await conn()).avisos.join(" ")).toContain("2 llamadas coinciden con endpoints de más de un cerebro");
    // El modelo analiza y deja escrito a dónde va esa base, con su evidencia.
    const archivo = join(proyecto, ".flowbrain/flowbrain.yaml");
    await writeFile(archivo, (await readFile(archivo, "utf8")) + ["", "conexiones:", "  - desde: tienda-web/svc-tienda-web", "    hacia: tienda-api/svc-tienda-api", "    por: VITE_API_URL", "    origen: modelo", '    evidencia: ["tienda-web/.env.example#L1"]', '    nota: "el puerto 3000 es el de tienda-api"', ""].join("\n"));
    const despues = await ev();
    expect(despues.disputadas).toEqual([]);
    expect(despues.bases[0]!.declaradas).toEqual([{ hacia: "tienda-api/svc-tienda-api", origen: "modelo", por: "VITE_API_URL" }]);
    expect((await conn()).conexiones.map((x) => [x["desde"], x["hacia"], x["llamadas"], x["declarada"], x["origen"]])).toEqual([["tienda-web/svc-tienda-web", "tienda-api/svc-tienda-api", 2, true, "modelo"]]);
    // Las instrucciones para el modelo: por consola y como comando de Claude Code, que deja `install`.
    const guia = (await ejecutar(["evidence", "--guide"], {}, dir)).stdout;
    expect(guia).toContain("Nunca abras archivos de entorno reales");
    expect(await readFile(join(dir, "global/commands/flowbrain-index.md"), "utf8")).toBe(guia);
    const feats = (await ejecutar(["feature", "--guide"], {}, dir)).stdout;
    expect(feats).toContain("Agrupar pantallas sueltas");
    expect(await readFile(join(dir, "global/commands/flowbrain-features.md"), "utf8")).toBe(feats);
  }, 120_000);

  it("install sin nadie a quién preguntar: --repos elige la carpeta (un monorepo) y --single junta todo en un cerebro", async () => {
    const mono = join(dir, "mono");
    await mkdir(join(mono, ".git"), { recursive: true });
    for (const p of ["api", "web"]) await w(`mono/packages/${p}/package.json`, [`{ "name": "${p}" }`]);
    const r = await ejecutar(["install", "--repos", "packages", "--single", ...global()], env, mono);
    expect(r.stdout).toContain("2 repos en un cerebro");
    const yaml = await readFile(join(mono, ".flowbrain/flowbrain.yaml"), "utf8");
    expect(yaml).toContain('  - nombre: mono\n    curado: true\n    repos:\n      - ruta: "../packages/api"\n      - ruta: "../packages/web"');
    // Sin --single ni --split y sin terminal: un cerebro por paquete.
    await rm(join(mono, ".flowbrain"), { recursive: true });
    await ejecutar(["install", "--repos", "packages", ...global()], env, mono);
    expect(await readFile(join(mono, ".flowbrain/flowbrain.yaml"), "utf8")).toContain("  - { entre: [api, web], activa: true }");
  }, 120_000);

  it("un repo que guarda otros repos adentro: se indexan los de adentro, no la carpeta entera como un solo repo", async () => {
    const orq = join(dir, "orquestador");
    for (const d of [".git", "clones/uno/.git", "clones/dos/.git", "docs"]) await mkdir(join(orq, d), { recursive: true });
    expect(await encontrarRepos(orq)).toEqual([join(orq, "clones/dos"), join(orq, "clones/uno")]);
    // Sin repos adentro, el repo es la carpeta misma.
    await mkdir(join(dir, "solo/.git"), { recursive: true });
    expect(await encontrarRepos(join(dir, "solo"))).toEqual([join(dir, "solo")]);
  });
});



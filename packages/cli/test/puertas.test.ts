import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargadorConCache, crearServidor } from "@brain/mcp";
import { stringifyCanonical } from "@brain/core";
import { ejecutar } from "../src/main.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");
const CONSULTAS = join(FIXTURE, "expected/consultas");
const golden = (nombre: string) => readFile(join(CONSULTAS, `${nombre}.json`), "utf8");

let raiz: string;
let cliente: Client;

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), "brain-puertas-"));
  for (const d of ["producto", "tecnologia", "_build"]) await cp(join(FIXTURE, d), join(raiz, d), { recursive: true });
  expect((await ejecutar(["compile", "--raiz", raiz])).codigo).toBe(0);
  await mkdir(join(raiz, "ws/tienda/.git"), { recursive: true });

  const [a, b] = InMemoryTransport.createLinkedPair();
  await crearServidor(cargadorConCache(raiz)).connect(a);
  cliente = new Client({ name: "test", version: "0" });
  await cliente.connect(b);
});
afterAll(async () => {
  await cliente?.close();
  await rm(raiz, { recursive: true, force: true });
});

async function mcp(nombre: string, args: Record<string, unknown>): Promise<{ texto: string; error: boolean }> {
  const r = (await cliente.callTool({ name: nombre, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { texto: r.content[0]!.text, error: r.isError === true };
}

async function hook(prompt: string, cwd = join(raiz, "ws/tienda")): Promise<string> {
  const r = await ejecutar(["hook", "claude-code", "--raiz", raiz], {}, raiz, async () => JSON.stringify({ prompt, cwd }));
  expect(r.codigo).toBe(0);
  if (r.stdout === "") return "";
  return (JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
}

/** Extrae el JSON de una sección `## <titulo>` del contexto del hook y lo re-serializa canónico. */
function seccion(texto: string, titulo: string): string {
  const lineas = texto.split("\n");
  const i = lineas.indexOf(`## ${titulo}`);
  expect(i, `falta la sección ${titulo}`).toBeGreaterThan(-1);
  return stringifyCanonical(JSON.parse(lineas[i + 1]!));
}

const CASOS: Array<{ golden: string; cli: string[]; mcp: [string, Record<string, unknown>] }> = [
  { golden: "trazar-checkout", cli: ["trazar", "--desde", "/checkout"], mcp: ["trazar", { desde: "/checkout" }] },
  {
    golden: "recorrer-payments-depende-in",
    cli: ["recorrer", "svc-payments", "--verbos", "depende_de", "--direccion", "in"],
    mcp: ["recorrer_grafo", { nodo: "svc-payments", verbos: ["depende_de"], direccion: "in" }],
  },
  { golden: "buscar-pagos", cli: ["buscar", "pagos"], mcp: ["buscar_nodo", { texto: "pagos" }] },
  { golden: "contrato-bff", cli: ["contrato", "svc-bff"], mcp: ["contrato_de", { nodo: "svc-bff" }] },
  {
    golden: "completo-payments-budget-300",
    cli: ["recorrer", "svc-payments", "--proyeccion", "completo", "--budget", "300"],
    mcp: ["recorrer_grafo", { nodo: "svc-payments", proyeccion: "completo", budget_tokens: 300 }],
  },
];

describe("CLI, MCP y hook devuelven el mismo JSON", () => {
  for (const c of CASOS) {
    it(c.golden, async () => {
      const esperado = await golden(c.golden);
      const cli = await ejecutar([...c.cli, "--raiz", raiz]);
      const m = await mcp(...c.mcp);
      expect(cli.stdout).toBe(esperado);
      expect(m.error).toBe(false);
      expect(m.texto).toBe(esperado);
    });
  }

  it("trazar --desde /checkout: 5 saltos idénticos por CLI, MCP y hook", async () => {
    const esperado = await golden("trazar-checkout");
    const desdeHook = seccion(await hook("¿Qué se rompe si cambio /checkout?"), "trazar /checkout");
    expect(desdeHook).toBe(esperado);
    expect((JSON.parse(desdeHook) as { saltos: unknown[] }).saltos).toHaveLength(5);
    expect((await mcp("trazar", { desde: "/checkout" })).texto).toBe(esperado);
    expect((await ejecutar(["trazar", "--desde", "/checkout", "--raiz", raiz])).stdout).toBe(esperado);
  });

  it("recorrer_grafo por hook coincide con MCP para un nodo mencionado", async () => {
    const texto = await hook("revisá la pasarela");
    const viaMcp = await mcp("recorrer_grafo", { nodo: "ext-pasarela", direccion: "both" });
    expect(seccion(texto, "recorrer_grafo ext-pasarela")).toBe(viaMcp.texto);
  });

  it("los errores de consulta son iguales por CLI y MCP", async () => {
    const cli = await ejecutar(["recorrer", "svc-nada", "--raiz", raiz]);
    const m = await mcp("recorrer_grafo", { nodo: "svc-nada" });
    expect(m.error).toBe(true);
    expect(m.texto).toBe(cli.stdout);
  });
});

describe("hook de Claude Code", () => {
  it("reconoce el repo actual por el directorio git", async () => {
    expect(await hook("hola, revisá la pasarela")).toContain("Repo actual: repo-tienda");
  });

  it("sin menciones ni repo conocido no inyecta nada", async () => {
    expect(await hook("hola", tmpdir())).toBe("");
  });

  it("respeta el presupuesto de 1500 tokens con margen del 5%", async () => {
    const prompts = [
      "trazá /checkout, POST /payments y /webhooks/pasarela; mirá svc-web, bff, payments, pasarela, tabla de pagos y checkout",
      "apps/bff/src/clients/payments.ts y /checkout",
      "pagos",
    ];
    for (const p of prompts) {
      const texto = await hook(p);
      expect(Math.ceil(texto.length / 4), p).toBeLessThanOrEqual(Math.floor(1500 * 1.05));
    }
  });

  it("un brain roto no bloquea el prompt: sale 0 sin salida", async () => {
    const r = await ejecutar(["hook", "claude-code", "--raiz", join(raiz, "no-existe")], {}, raiz, async () =>
      JSON.stringify({ prompt: "/checkout", cwd: raiz }),
    );
    expect(r).toMatchObject({ codigo: 0, stdout: "" });
    expect(r.stderr).toContain("brain hook:");
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cargarContexto, compileDir, deriva } from "@flowbrain/core";
import { escribirIndex, indexar, leerRepo, tsParser, type Extraccion } from "../src/index.js";

/** Un fixture por cliente en `fixtures/clientes-http/<cliente>`: una web que llama y una API Express que atiende. */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FX = (c: string) => join(RAIZ, "fixtures/clientes-http", c);
const pagina = (id: string, tipo: string, extra: string[] = []) => ["---", `id: ${id}`, `tipo: ${tipo}`, `nombre: ${id}`, `resumen: ${id}.`, ...extra, "---", `# ${id}`].join("\n") + "\n";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

const llamadas = (c: string) =>
  (tsParser.extract(leerRepo(FX(c))) as Extraccion).llamadas.map((l) => `${l.linea} ${l.metodo} ${l.url.base}${l.url.host ? `:${l.url.host}` : ""} ${l.url.ruta ?? "(sin ruta)"}`);
const campos = (c: string) => Object.fromEntries((tsParser.extract(leerRepo(FX(c))) as Extraccion).llamadas.map((l) => [l.linea, l.campos ?? null]));

/** Indexa el fixture contra un brain con `svc-api` y `svc-web` y devuelve la deriva. */
async function derivaDe(c: string) {
  const brain = await mkdtemp(join(tmpdir(), `brain-http-${c}-`));
  dirs.push(brain);
  const repo = `repo-${c}`;
  await mkdir(join(brain, "technology"), { recursive: true });
  await writeFile(join(brain, "technology", `${repo}.md`), pagina(repo, "repo"));
  await writeFile(join(brain, "technology", "svc-api.md"), pagina("svc-api", "svc", [`vive_en: [${repo}]`, "puntos_de_entrada:", "  arranque: apps/api/src/rutas.ts"]));
  await writeFile(join(brain, "technology", "svc-web.md"), pagina("svc-web", "svc", [`vive_en: [${repo}]`, "puntos_de_entrada:", "  arranque: apps/web/src/api.ts"]));
  await escribirIndex(brain, await indexar(FX(c), brain));
  await compileDir(brain);
  return deriva(await cargarContexto(brain), { budget_tokens: null }) as unknown as {
    llamadasSinEndpoint: Array<{ llamada?: string; metodo?: string; ruta?: string }>;
    campos: { llamadasUnidas: number; comparadas: number };
    avisos: string[];
  };
}

const pedido = { tipo: "Pedido", forma: { estado: "string", id: "string", total: "number" } };
const nuevo = { tipo: "NuevoPedido", forma: { cantidad: "number", productoId: "string" } };

describe("Angular HttpClient (fixtures/clientes-http/angular)", () => {
  it("inyectado por constructor o con inject(HttpClient): get/post/delete<T>, request(método) y la URL armada en runtime sin ruta", () => {
    expect(llamadas("angular")).toEqual([
      "26 GET dinamica /pedidos",
      "29 GET dinamica /pedidos/{param}",
      "32 POST dinamica /pedidos",
      "35 DELETE dinamica /pedidos/{param}",
      "38 PUT dinamica /pedidos/{param}",
      "48 GET relativa /api/salud",
      "51 GET dinamica (sin ruta)",
    ]);
  });
  it("el <T> es lo que espera, el cuerpo lo que manda y { params } la query", () => {
    const c = campos("angular");
    expect(c[26]).toEqual({ query: { tipo: "Filtro", forma: { pagina: "number" } }, espera: { tipo: "Pedido[]", forma: {} } });
    expect(c[29]!.espera).toEqual(pedido);
    expect(c[32]).toEqual({ envia: nuevo, espera: pedido });
    expect(c[38]).toEqual({ envia: { tipo: "{ estado: string; }", forma: { estado: "string" } } });
  });
});

describe("ky (fixtures/clientes-http/ky)", () => {
  it("ky.create({ prefixUrl }) y .extend heredan la base; ky(url, { method }); URL absoluta; la armada en runtime sin ruta", () => {
    expect(llamadas("ky")).toEqual([
      "17 GET dinamica /pedidos",
      "18 GET dinamica /pedidos/{param}",
      "19 POST dinamica /pedidos",
      "20 PUT dinamica /pedidos/{param}",
      "21 DELETE literal:pedidos.example.com /pedidos/{param}",
      "22 GET dinamica (sin ruta)",
    ]);
  });
  it("json: es el cuerpo, searchParams la query y .json<T>() o get<T> lo que espera", () => {
    const c = campos("ky");
    expect(c[17]).toEqual({ query: { tipo: "{ pagina: number; }", forma: { pagina: "number" } }, espera: { tipo: "Pedido[]", forma: {} } });
    expect(c[18]!.espera).toEqual(pedido);
    expect(c[19]).toEqual({ envia: nuevo, espera: pedido });
    expect(c[20]).toEqual({ envia: { tipo: "{ estado: string; }", forma: { estado: "string" } } });
  });
});

describe("$fetch / ofetch y useFetch de Nuxt (fixtures/clientes-http/ofetch)", () => {
  it("$fetch global, ofetch.create({ baseURL }), useFetch con URL como función, useAsyncData por el $fetch que envuelve, useLazyFetch", () => {
    expect(llamadas("ofetch")).toEqual([
      "16 GET dinamica /pedidos",
      "17 POST dinamica /pedidos",
      "18 DELETE dinamica /pedidos/{param}",
      "19 GET dinamica /pedidos/{param}",
      "20 GET dinamica /pedidos",
      "21 PUT dinamica /pedidos/{param}",
      "22 GET dinamica (sin ruta)",
    ]);
  });
  it("body es el cuerpo, query la query y el <T> lo que espera", () => {
    const c = campos("ofetch");
    expect(c[16]).toEqual({ query: { tipo: "{ pagina: number; }", forma: { pagina: "number" } }, espera: { tipo: "Pedido[]", forma: {} } });
    expect(c[17]).toEqual({ envia: nuevo, espera: pedido });
    expect(c[19]!.espera).toEqual(pedido);
  });
});

describe("las llamadas de los tres clientes se unen a sus endpoints", () => {
  it.each([
    ["angular", 5, ["GET /api/salud"]],
    ["ky", 4, []],
    ["ofetch", 6, []],
  ] as const)("%s: deriva las une y compara con el contrato; la URL armada en runtime queda en avisos", async (c, unidas, sinEndpoint) => {
    const r = await derivaDe(c);
    expect(r.campos).toMatchObject({ llamadasUnidas: unidas, comparadas: 2 });
    expect(r.llamadasSinEndpoint.map((l) => l.llamada)).toEqual(sinEndpoint);
    expect(r.avisos[0]).toMatch(/^1 llamadas con URL armada en tiempo de ejecución/);
  });
});

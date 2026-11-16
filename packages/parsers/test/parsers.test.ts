import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDir, stringifyCanonical } from "@brain/core";
import { escribirIndex, indexar, leerRepo, openapiParser, tsParser, type ResultadoIndex } from "../src/index.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const F = (p: string) => join(RAIZ, "fixtures", p);

interface Etiquetas {
  repo: string;
  aristas: Array<Record<string, unknown>>;
  endpoints: Array<Record<string, unknown> & { svc: string }>;
}

describe("ts-parser sobre fixtures/repos/tienda (Express + Prisma)", () => {
  let r: ResultadoIndex;
  let etiquetas: Etiquetas;
  beforeAll(async () => {
    r = await indexar(F("repos/tienda"), F("checkout"));
    etiquetas = JSON.parse(await readFile(F("repos/tienda.etiquetas.json"), "utf8")) as Etiquetas;
  });

  it("recupera ≥ 90% de las aristas y endpoints etiquetados a mano", () => {
    const claves = (xs: Array<Record<string, unknown>>) => new Set(xs.map((x) => stringifyCanonical(x)));
    const extraidas = claves(r.aristas as unknown as Array<Record<string, unknown>>);
    const endpoints = claves(r.contratos.flatMap((c) => c.endpoints.map((e) => ({ ...e, svc: c.svc }))));
    const aciertos =
      etiquetas.aristas.filter((a) => extraidas.has(stringifyCanonical(a))).length +
      etiquetas.endpoints.filter((e) => endpoints.has(stringifyCanonical(e))).length;
    const total = etiquetas.aristas.length + etiquetas.endpoints.length;
    expect(aciertos / total).toBeGreaterThanOrEqual(0.9);
    // Hoy es 100% y sin falsos positivos: si esto cambia, que sea a propósito.
    expect(aciertos).toBe(total);
    expect(r.aristas).toHaveLength(etiquetas.aristas.length);
    expect(r.pendientes).toEqual([]);
  });

  it("los contratos y el árbol de archivos coinciden byte a byte con los del fixture de checkout", async () => {
    for (const c of r.contratos) {
      expect(stringifyCanonical(c)).toBe(await readFile(F(`checkout/_build/contratos/${c.svc}.json`), "utf8"));
    }
    expect(r.contratos.map((c) => c.svc)).toEqual(["svc-bff", "svc-payments"]);
    expect(stringifyCanonical(r.archivos)).toBe(await readFile(F("checkout/_build/archivos/repo-tienda.json"), "utf8"));
  });

  it("es determinístico", async () => {
    const otra = await indexar(F("repos/tienda"), F("checkout"));
    expect(stringifyCanonical(otra)).toBe(stringifyCanonical(r));
  });
});

describe("index → compile de punta a punta", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "brain-index-"));
    for (const d of ["producto", "tecnologia"]) await cp(F(`checkout/${d}`), join(dir, d), { recursive: true });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("indexar el repo de muestra y compilar reproduce el graph.json escrito a mano", async () => {
    const r = await indexar(F("repos/tienda"), dir);
    const escritos = await escribirIndex(dir, r);
    expect(escritos).toContain("_build/contratos/svc-bff.json");
    await compileDir(dir);
    expect(await readFile(join(dir, "_build/graph.json"), "utf8")).toBe(await readFile(F("checkout/expected/graph.json"), "utf8"));
    expect(await escribirIndex(dir, await indexar(F("repos/tienda"), dir))).toEqual([]);
  });
});

describe("openapi-parser", () => {
  it("la spec prevalece sobre lo inferido del código; los endpoints solo del código se conservan", async () => {
    const r = await indexar(F("repos/catalogo"), F("catalogo-brain"));
    expect(r.contratos).toHaveLength(1);
    const c = r.contratos[0]!;
    expect(c.fuente).toBe("openapi-parser");
    expect(c.endpoints).toEqual([
      { evidencia: "repo-catalogo:openapi.yaml#L15", metodo: "POST", request: "NuevoProducto", response: "Producto", ruta: "/productos" },
      { evidencia: "repo-catalogo:src/server.ts#L13", metodo: "DELETE", request: null, response: null, ruta: "/productos/{id}" },
      { evidencia: "repo-catalogo:openapi.yaml#L7", metodo: "GET", request: null, response: "Producto", ruta: "/productos/{id}" },
    ]);
    expect(c.tipos).toEqual({
      NuevoProducto: { nombre: "string", precio: "number" },
      Producto: { estado: "'activo' | 'pausado' | undefined", id: "string", nombre: "string", precio: "number" },
    });
    expect(c.tipos.ProductoInferido).toBeUndefined();
  });

  it("detect solo con archivos openapi.* / swagger.*", () => {
    expect(openapiParser.detect(leerRepo(F("repos/catalogo")))).toBe(true);
    expect(openapiParser.detect(leerRepo(F("repos/tienda")))).toBe(false);
  });
});

describe("ts-parser: variantes de frameworks y clientes HTTP", () => {
  const x = tsParser.extract(leerRepo(F("repos/variantes")));
  const ep = (archivo: string) => x.endpoints.filter((e) => e.archivo === archivo).map(({ metodo, ruta, request, response, linea }) => ({ metodo, ruta, request, response, linea }));

  it("Fastify con genéricos Body/Reply", () => {
    expect(ep("src/fastify.ts")).toEqual([{ metodo: "POST", ruta: "/login", request: "Login", response: "Sesion", linea: 11 }]);
  });

  it("NestJS: @Controller + @Get/@Post, @Body y Promise<T>", () => {
    expect(ep("src/nest/pedidos.controller.ts")).toEqual([
      { metodo: "GET", ruta: "/pedidos/{id}", request: null, response: "Pedido", linea: 12 },
      { metodo: "POST", ruta: "/pedidos", request: "CrearPedido", response: "Pedido", linea: 17 },
    ]);
  });

  it("Next app router: route.ts, segmentos dinámicos y grupos", () => {
    expect(ep("src/app/api/pedidos/[id]/route.ts").map((e) => `${e.metodo} ${e.ruta}`)).toEqual(["GET /api/pedidos/{id}", "DELETE /api/pedidos/{id}"]);
    expect(ep("src/app/(admin)/api/salud/route.ts").map((e) => `${e.metodo} ${e.ruta}`)).toEqual(["GET /api/salud"]);
  });

  it("axios.create con baseURL de env (otro archivo), axios(config), fetch relativo y host dinámico", () => {
    const ll = x.llamadas.filter((l) => l.archivo === "src/http/usos.ts").map((l) => ({ linea: l.linea, metodo: l.metodo, base: l.url.base, host: l.url.host, ruta: l.url.ruta, dato: l.dato }));
    expect(ll).toEqual([
      { linea: 9, metodo: "GET", base: "dinamica", host: null, ruta: "/usuarios/{param}", dato: null },
      { linea: 10, metodo: "POST", base: "dinamica", host: null, ruta: "/usuarios", dato: "Alta" },
      { linea: 11, metodo: "POST", base: "literal", host: "hooks.slack.example", ruta: "/services/x", dato: "Alta" },
      { linea: 12, metodo: "GET", base: "relativa", host: null, ruta: "/api/salud", dato: null },
      { linea: 13, metodo: "GET", base: "dinamica", host: null, ruta: "/x", dato: null },
    ]);
  });

  it("alias de tsconfig paths, export default de una instancia y URLs en objetos const", () => {
    const l = x.llamadas.filter((y) => y.archivo === "src/usos-alias.ts");
    expect(l.map((y) => ({ linea: y.linea, metodo: y.metodo, base: y.url.base, host: y.url.host, ruta: y.url.ruta }))).toEqual([
      { linea: 8, metodo: "GET", base: "literal", host: "usuarios", ruta: "/perfil" },
    ]);
  });

  it("Prisma con @@map y TypeORM @Entity", () => {
    expect(x.tablas).toEqual([{ paquete: "", archivo: "src/repos.ts", linea: 2, modelo: "Cliente", verbo: "lee_de" }]);
    expect(x.modelos.map((m) => [m.nombre, m.tabla, m.archivo])).toEqual([
      ["Cliente", "clientes", "prisma/schema.prisma"],
      ["Cliente", "clientes", "src/entidades.ts"],
    ]);
  });
});

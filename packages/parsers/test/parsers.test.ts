import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDir, stringifyCanonical } from "@brain/core";
import { endpointsAlcanzables, escribirIndex, indexar, leerRepo, openapiParser, phpParser, tsParser, type Extraccion, type ResultadoIndex } from "../src/index.js";

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
  const x = tsParser.extract(leerRepo(F("repos/variantes"))) as Extraccion;
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

describe("php-parser sobre fixtures/repos/envios (Laravel + Eloquent)", () => {
  let r: ResultadoIndex;
  let etiquetas: Etiquetas;
  beforeAll(async () => {
    r = await indexar(F("repos/envios"), F("envios-brain"));
    etiquetas = JSON.parse(await readFile(F("repos/envios.etiquetas.json"), "utf8")) as Etiquetas;
  });

  it("recupera ≥ 80% de las aristas y endpoints etiquetados a mano", () => {
    const claves = (xs: Array<Record<string, unknown>>) => new Set(xs.map((x) => stringifyCanonical(x)));
    const extraidas = claves(r.aristas as unknown as Array<Record<string, unknown>>);
    const endpoints = claves(r.contratos.flatMap((c) => c.endpoints.map((e) => ({ ...e, svc: c.svc }))));
    const aciertos =
      etiquetas.aristas.filter((a) => extraidas.has(stringifyCanonical(a))).length +
      etiquetas.endpoints.filter((e) => endpoints.has(stringifyCanonical(e))).length;
    const total = etiquetas.aristas.length + etiquetas.endpoints.length;
    expect(aciertos / total).toBeGreaterThanOrEqual(0.8);
    expect(aciertos).toBe(total);
    expect(r.aristas).toHaveLength(etiquetas.aristas.length);
  });

  it("el host dinámico sin endpoint conocido queda pendiente, no se inventa", () => {
    expect(r.pendientes.map((p) => [p.evidencia, p.referencia])).toEqual([["repo-envios:app/Services/Correo.php#L21", "GET ${env:TRACKING_URL}/track"]]);
  });

  it("contrato con formas de FormRequest y JsonResource", () => {
    const c = r.contratos[0]!;
    expect(c.fuente).toBe("php-parser");
    expect(c.tipos).toEqual({
      CrearEnvioRequest: { destino: "string", notas: "string | null | undefined", peso: "number", zona: "string" },
      EnvioResource: { costo: "unknown", estado: "unknown", id: "unknown" },
    });
  });

  it("árbol de archivos con clases PHP", () => {
    const a = r.archivos.archivos.find((x) => x.ruta === "app/Http/Controllers/EnvioController.php");
    expect(a).toMatchObject({ lenguaje: "php", simbolos: [{ nombre: "EnvioController", tipo: "clase" }] });
  });

  it("es determinístico", async () => {
    expect(stringifyCanonical(await indexar(F("repos/envios"), F("envios-brain")))).toBe(stringifyCanonical(r));
  });
});

describe("php-parser: Symfony (atributos, anotaciones, Doctrine)", () => {
  let x: Extraccion;
  beforeAll(async () => {
    x = await phpParser.extract(leerRepo(F("repos/symfony")));
  });

  it("#[Route] y @Route con prefijo de clase; OPTIONS/HEAD se descartan; GET por defecto", () => {
    expect(x.endpoints.map((e) => [e.metodo, e.ruta, e.archivo, e.linea])).toEqual([
      ["GET", "/facturas", "src/Controller/FacturaController.php", 17],
      ["POST", "/facturas/{id}/emitir", "src/Controller/FacturaController.php", 24],
      ["GET", "/legacy/clientes/{id}", "src/Controller/LegacyController.php", 16],
      ["GET", "/legacy/ping", "src/Controller/LegacyController.php", 25],
    ]);
  });

  it("HttpClient->request() con URL literal y curl_init con getenv", () => {
    expect(x.llamadas.map((l) => [l.archivo, l.linea, l.metodo, l.url.base, l.url.host, l.url.ruta])).toEqual([
      ["src/Controller/FacturaController.php", 26, "POST", "literal", "fiscal.example", "/api/comprobantes"],
      ["src/Controller/LegacyController.php", 18, "GET", "dinamica", null, "/clientes/{param}"],
    ]);
  });

  it("entidades Doctrine (atributo y anotación), getRepository y persist", () => {
    expect(x.modelos.map((m) => [m.nombre, m.tabla])).toEqual([
      ["Cliente", "clientes"],
      ["Factura", "facturas_emitidas"],
    ]);
    expect(x.tablas.map((t) => [t.archivo, t.linea, t.modelo, t.verbo])).toEqual([
      ["src/Controller/FacturaController.php", 19, "Factura", "lee_de"],
      ["src/Controller/FacturaController.php", 28, "Factura", "escribe_en"],
      ["src/Controller/LegacyController.php", 19, "Cliente", "lee_de"],
    ]);
  });

  it("detect solo con archivos .php", () => {
    expect(phpParser.detect(leerRepo(F("repos/symfony")))).toBe(true);
    expect(phpParser.detect(leerRepo(F("repos/tienda")))).toBe(false);
  });
});

describe("resolución de llamadas con base dinámica", () => {
  const eps = [
    { metodo: "GET", ruta: "/api/user/get/me" },
    { metodo: "GET", ruta: "/api/user/get/{id}" },
    { metodo: "GET", ruta: "/{token}" },
    { metodo: "PUT", ruta: "/api/user/switcher/club/{clubId}" },
    { metodo: "GET", ruta: "/v1/club/list" },
    { metodo: "GET", ruta: "/v2/club/list" },
  ];
  const r = (m: string, ruta: string) => endpointsAlcanzables(eps, m, ruta).map((e) => e.ruta);

  it("por sufijo cuando la base incluye un prefijo literal (/api)", () => {
    expect(r("PUT", "/user/switcher/club/{param}")).toEqual(["/api/user/switcher/club/{clubId}"]);
  });
  it("prefiere la coincidencia más específica", () => {
    expect(r("GET", "/user/get/me")).toEqual(["/api/user/get/me"]);
  });
  it("una ruta solo de parámetros no se resuelve (evita rutas comodín)", () => {
    expect(r("GET", "/{param}")).toEqual([]);
  });
  it("prefijos distintos que empatan quedan ambiguos", () => {
    expect(r("GET", "/club/list")).toEqual(["/v1/club/list", "/v2/club/list"]);
  });
  it("el prefijo nunca contiene parámetros", () => {
    expect(r("GET", "/get/me")).toEqual(["/api/user/get/me"]);
    expect(endpointsAlcanzables([{ metodo: "GET", ruta: "/{tenant}/club/list" }], "GET", "/club/list")).toEqual([]);
  });
});

describe("desempate por prefijo aprendido de la base dinámica", () => {
  it("si las llamadas sin ambigüedad de una base revelan /api, se usa para elegir entre /api/login y /api/ulite/login", async () => {
    const r = await indexar(F("repos/prefijo"), F("prefijo-brain"));
    expect(r.aristas.map((a) => [a.evidencia, a.endpoint, a.origen])).toEqual([
      ["repo-cliente:src/api.ts#L3", "svc-api:GET:/api/usuarios/{id}", "inferido"],
      ["repo-cliente:src/api.ts#L4", "svc-api:POST:/api/login", "inferido"],
    ]);
    expect(r.pendientes).toEqual([]);
  });
});

describe("fusionar: tests y duplicados", () => {
  const ep = (archivo: string, linea: number) => ({ paquete: ".", metodo: "GET", ruta: "/health/live", archivo, linea, request: null, response: null });
  const base = { parser: "ts", archivos: [], llamadas: [], tablas: [], modelos: [], formas: {}, autoritativo: [] };
  it("descarta endpoints de archivos de test y deja uno por ruta", async () => {
    const { fusionar, esArchivoDeTest } = await import("../src/indexar.js");
    expect(esArchivoDeTest("src/metrics/metrics.test.ts")).toBe(true);
    expect(esArchivoDeTest("tests/Feature/UserTest.php")).toBe(true);
    expect(esArchivoDeTest("src/http/health.controller.ts")).toBe(false);
    const x = fusionar([{ ...base, endpoints: [ep("src/b.ts", 3), ep("src/metrics.test.ts", 1), ep("src/a.ts", 9)] } as never]);
    expect(x.endpoints.map((e) => `${e.archivo}#${e.linea}`)).toEqual(["src/a.ts#9"]);
  });
});

describe("ts-parser: auxiliares de ruta y Kysely", () => {
  let dir: string;
  beforeAll(async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    dir = await mkdtemp(join(tmpdir(), "brain-ts-"));
    const w = async (p: string, t: string) => {
      await mkdir(dirname(join(dir, p)), { recursive: true });
      await writeFile(join(dir, p), t);
    };
    await w("package.json", JSON.stringify({ name: "x", dependencies: { axios: "1", kysely: "0.29.7", "react-router": "7" } }));
    await w(
      "src/api.ts",
      [
        'import axios from "axios";',
        'import { generatePath } from "react-router";',
        "const buildPath = generatePath;",
        'const EP = { doc: "/documentation/generate_download/:fileId", skills: "/skill-group/find" } as const;',
        "const withId = (endpoint: string, id: string) => `${endpoint}/${id}`;",
        "export const a = (fileId: string) => axios.get(`${import.meta.env.VITE_API}${buildPath(EP.doc, { fileId })}`);",
        "export const b = (id: string) => axios.get(`${import.meta.env.VITE_API}${withId(EP.skills, id)}`);",
        "",
      ].join("\n"),
    );
    await w(
      "src/repo.ts",
      [
        'import { sql } from "kysely";',
        "declare const db: any;",
        "const DESDE = sql`FROM wellness_test w JOIN category c ON c.id = w.category_id`;",
        "export const contar = () => sql`SELECT COUNT(*) ${DESDE}`.execute(db);",
        'export const leer = () => db.selectFrom("team_has_players as thp").innerJoin("player as p", "p.id", "thp.player_id").selectAll().execute();',
        'export const escribir = () => db.insertInto("user_token").values({}).execute();',
        'export const borrar = () => db.deleteFrom("payment").execute();',
        "",
      ].join("\n"),
    );
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("resuelve rutas armadas con funciones auxiliares y constructores de librería", async () => {
    const x = await tsParser.extract(leerRepo(dir));
    expect(x.llamadas.map((l) => `${l.metodo} ${l.url.ruta}`).sort()).toEqual(["GET /documentation/generate_download/{fileId}", "GET /skill-group/find/{param}"]);
  });

  it("extrae accesos a tablas de Kysely", async () => {
    const x = await tsParser.extract(leerRepo(dir));
    expect(x.tablas.map((t) => `${t.verbo} ${t.modelo}`).sort()).toEqual([
      "escribe_en payment",
      "escribe_en user_token",
      "lee_de category",
      "lee_de category",
      "lee_de player",
      "lee_de team_has_players",
      "lee_de wellness_test",
      "lee_de wellness_test",
    ]);
    // El fragmento cuenta donde se declara y, además, en la línea donde se interpola.
    expect(x.tablas.filter((t) => t.modelo === "wellness_test").map((t) => t.linea)).toEqual([3, 4]);
  });
});

describe("ts-parser: estructura interna (símbolos, imports e invocaciones)", () => {
  let dir: string;
  beforeAll(async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    dir = await mkdtemp(join(tmpdir(), "brain-capas-"));
    const w = async (p: string, t: string[]) => {
      await mkdir(dirname(join(dir, p)), { recursive: true });
      await writeFile(join(dir, p), t.join("\n") + "\n");
    };
    await w("package.json", [JSON.stringify({ name: "x", dependencies: { "@nestjs/common": "10" } })]);
    await w("src/pagos/domain/pago.ts", ["export interface Pago { id: string }", "export type Estado = 'ok' | 'error';", "export enum Medio { Tarjeta }"]);
    await w("src/pagos/domain/pago.port.ts", ['import type { Pago } from "./pago";', "export abstract class PagoPort {", "  abstract guardar(p: Pago): Promise<void>;", "}"]);
    await w("src/pagos/infrastructure/pago.repository.ts", [
      'import { PagoPort } from "../domain/pago.port";',
      'import type { Pago } from "../domain/pago";',
      "export class PagoRepository extends PagoPort {",
      "  async guardar(p: Pago) {}",
      "}",
    ]);
    await w("src/pagos/application/pago.service.ts", [
      'import { PagoPort } from "../domain/pago.port";',
      "export class PagoService {",
      "  constructor(private readonly repo: PagoPort) {}",
      "  crear() {",
      "    return this.repo.guardar({ id: '1' });",
      "  }",
      "}",
    ]);
    await w("src/pagos/http/pago.controller.ts", [
      'import { Controller, Post } from "@nestjs/common";',
      'import { PagoService } from "../application/pago.service";',
      '@Controller("pagos")',
      "export class PagoController {",
      "  constructor(private readonly svc: PagoService) {}",
      "  @Post()",
      "  crear() {",
      "    return this.svc.crear();",
      "  }",
      "}",
    ]);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("guarda métodos (línea del nombre), interfaces, tipos y enums con su rango", async () => {
    const x = await tsParser.extract(leerRepo(dir));
    const de = (r: string) => x.archivos.find((a) => a.ruta === r)!;
    expect(de("src/pagos/domain/pago.ts").simbolos.map((s) => `${s.tipo} ${s.nombre} ${s.linea}-${s.fin}`)).toEqual(["interfaz Pago 1-1", "tipo Estado 2-2", "enum Medio 3-3"]);
    expect(de("src/pagos/http/pago.controller.ts").simbolos.map((s) => `${s.tipo} ${s.nombre} ${s.linea}`)).toEqual(["clase PagoController 3", "metodo PagoController.crear 7"]);
    expect(x.endpoints[0]).toMatchObject({ archivo: "src/pagos/http/pago.controller.ts", linea: 6 });
  });

  it("registra imports del repo y llamadas entre métodos; un método abstracto va a su implementación", async () => {
    const x = await tsParser.extract(leerRepo(dir));
    const de = (r: string) => x.archivos.find((a) => a.ruta === r)!;
    expect(de("src/pagos/http/pago.controller.ts").importa).toEqual(["src/pagos/application/pago.service.ts"]);
    expect(de("src/pagos/http/pago.controller.ts").invoca).toEqual([{ desde: "PagoController.crear", archivo: "src/pagos/application/pago.service.ts", simbolo: "PagoService.crear", linea: 8 }]);
    expect(de("src/pagos/application/pago.service.ts").invoca).toEqual([
      { desde: "PagoService.crear", archivo: "src/pagos/infrastructure/pago.repository.ts", simbolo: "PagoRepository.guardar", linea: 5 },
    ]);
  });
});

describe("ts-parser: llamadas indirectas (eventos, colas, inyección por token) y sin resolver", () => {
  let dir: string;
  beforeAll(async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    dir = await mkdtemp(join(tmpdir(), "brain-indirectas-"));
    const w = async (p: string, t: string[]) => {
      await mkdir(dirname(join(dir, p)), { recursive: true });
      await writeFile(join(dir, p), t.join("\n") + "\n");
    };
    await w("package.json", [JSON.stringify({ name: "x", dependencies: { "@nestjs/common": "10" } })]);
    await w("src/mail.port.ts", ['export const MAIL = Symbol("MAIL");', "export interface MailPort {", "  enviar(a: string): void;", "}", "export interface Huerfana {", "  nadie(): void;", "}"]);
    await w("src/smtp.mail.ts", ["export class SmtpMail {", "  enviar(a: string) {}", "}"]);
    await w("src/app.module.ts", ['import { MAIL } from "./mail.port";', 'import { SmtpMail } from "./smtp.mail";', "export const providers = [{ provide: MAIL, useExisting: SmtpMail }];"]);
    await w("src/jobs.ts", ['export const AVISO_JOB = { name: "aviso" };', "export const nombres = new Set<string>();"]);
    await w("src/aviso.service.ts", [
      'import { Inject } from "@nestjs/common";',
      'import { MAIL, type MailPort, type Huerfana } from "./mail.port";',
      'import { AVISO_JOB, nombres } from "./jobs";',
      "export class AvisoService {",
      "  constructor(@Inject(MAIL) private readonly mail: MailPort, private readonly cola: any, private readonly bus: any, private readonly h: Huerfana) {}",
      "  onModuleInit(registro: { register(k: unknown, h: unknown): void }) {",
      '    registro.register(AVISO_JOB, { handle: (p: { a: string }) => this.mandar(p.a), failureMessage: () => "x" });',
      "  }",
      "  pedir(a: string) {",
      "    this.cola.enqueue(AVISO_JOB, { a });",
      '    this.bus.emit("usuario.creado", { a });',
      "    nombres.add(a);",
      "  }",
      "  mandar(a: string) {",
      "    this.mail.enviar(a);",
      "    this.h.nadie();",
      "  }",
      "}",
    ]);
    await w("src/rutas.ts", ['import { applyDecorators, HttpCode, Put } from "@nestjs/common";', "export const LegacyPut = (path?: string) => applyDecorators(Put(path), HttpCode(200));", 'export function Fijo() { return Put("fijo"); }']);
    await w("src/sesion.controller.ts", [
      'import { Controller } from "@nestjs/common";',
      'import { LegacyPut, Fijo } from "./rutas";',
      '@Controller("api")',
      "export class SesionController {",
      '  @LegacyPut("login")',
      "  login() {}",
      "  @Fijo()",
      "  otro() {}",
      "}",
    ]);
    await w("src/escucha.ts", ['import { OnEvent } from "@nestjs/event-emitter";', "export class Escucha {", '  @OnEvent("usuario.creado")', "  alCrear() {}", "}"]);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("un decorador propio que envuelve uno de ruta de Nest cuenta como endpoint", async () => {
    const x = await tsParser.extract(leerRepo(dir));
    expect(x.endpoints.map((e) => `${e.metodo} ${e.ruta} L${e.linea}`).sort()).toEqual(["PUT /api/fijo L7", "PUT /api/login L5"]);
  });

  it("publicar con una clave llama en diferido a quien se suscribe con la misma; @Inject(TOKEN) va a la clase ligada", async () => {
    const x = await tsParser.extract(leerRepo(dir));
    const de = (r: string) => x.archivos.find((a) => a.ruta === r)!;
    expect(de("src/aviso.service.ts").invoca).toEqual([
      { desde: "AvisoService.mandar", archivo: "src/mail.port.ts", simbolo: "Huerfana.nadie", linea: 16 },
      { desde: "AvisoService.mandar", archivo: "src/smtp.mail.ts", simbolo: "SmtpMail.enviar", linea: 15 },
      { desde: "AvisoService.onModuleInit", archivo: "src/aviso.service.ts", simbolo: "AvisoService.mandar", linea: 7 },
      { desde: "AvisoService.pedir", archivo: "src/aviso.service.ts", simbolo: "AvisoService.mandar", linea: 10, via: "AVISO_JOB" },
      { desde: "AvisoService.pedir", archivo: "src/escucha.ts", simbolo: "Escucha.alCrear", linea: 11, via: '"usuario.creado"' },
    ]);
    // `any` e interfaz sin implementación: se registran; `Set.add` (de la librería estándar) no.
    expect(de("src/aviso.service.ts").sinResolver).toEqual([
      { desde: "AvisoService.pedir", linea: 10, llamada: "this.cola.enqueue" },
      { desde: "AvisoService.pedir", linea: 11, llamada: "this.bus.emit" },
      { desde: "AvisoService.mandar", linea: 16, llamada: "this.h.nadie" },
    ]);
  });
});

describe("tablasDeSql (Kysely sql`…`)", () => {
  it("escrituras, lecturas, comillas y esquema; ignora CTE y FROM de funciones", async () => {
    const { tablasDeSql } = await import("../src/ts-parser.js");
    const r = (s: string) => tablasDeSql(s).map((x) => `${x.verbo} ${x.tabla} +${x.saltos}`);
    expect(r("\n  UPDATE `user` SET api_token = NULL\n  WHERE id = ?")).toEqual(["escribe_en user +1"]);
    expect(r("SELECT the_value FROM mockup m JOIN app.club c ON c.id = m.club_id")).toEqual(["lee_de mockup +0", "lee_de club +0"]);
    expect(r("DELETE FROM payment WHERE id = ?")).toEqual(["escribe_en payment +0"]);
    expect(r("INSERT INTO invoice (a) SELECT a FROM payment")).toEqual(["escribe_en invoice +0", "lee_de payment +0"]);
    expect(r("WITH ult AS (SELECT * FROM pago) SELECT EXTRACT(YEAR FROM fecha) FROM ult")).toEqual(["lee_de pago +0"]);
  });
});

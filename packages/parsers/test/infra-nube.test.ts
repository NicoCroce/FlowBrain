import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarContexto, compileDir, infra, quienLlama, recorrido, type Contexto } from "@flowbrain/core";
import { escribirIndex, indexar } from "../src/index.js";

/** Un fixture por tecnología en `fixtures/infra/<tecnologia>`; el brain se arma en un directorio temporal. */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE = (t: string) => join(RAIZ, "fixtures/infra", t);

type Item = { de: string; clase: string; nombre: string; detalle: string[]; ev: string; endpoints?: string[]; atiende?: { simbolo: string; evidencia: string } };
const pagina = (id: string, tipo: string, extra: string[] = []) => ["---", `id: ${id}`, `tipo: ${tipo}`, `nombre: ${id}`, `resumen: ${id}.`, ...extra, "---", `# ${id}`].join("\n") + "\n";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

/** Indexa el fixture contra un brain con un repo, un servicio y las páginas extra; devuelve el contexto compilado. */
async function montar(tecnologia: string, svc: string, alias: string, extra: Record<string, string> = {}) {
  const brain = await mkdtemp(join(tmpdir(), `brain-infra-${tecnologia}-`));
  dirs.push(brain);
  const repo = `repo-${tecnologia}`;
  const paginas = { [repo]: pagina(repo, "repo"), [svc]: pagina(svc, "svc", [`aliases: [${alias}]`, `vive_en: [${repo}]`]), ...extra };
  for (const [id, texto] of Object.entries(paginas)) {
    await mkdir(join(brain, "technology"), { recursive: true });
    await writeFile(join(brain, "technology", `${id}.md`), texto);
  }
  const r = await indexar(FIXTURE(tecnologia), brain);
  await escribirIndex(brain, r);
  await compileDir(brain);
  const build = join(brain, "_build");
  const json = (await Promise.all((await readdir(join(build, "files"))).map((f) => readFile(join(build, "files", f), "utf8")))).join("\n");
  return { ctx: await cargarContexto(brain), r, json };
}

const items = (ctx: Contexto, p: Parameters<typeof infra>[1]) => (infra(ctx, p) as { items: Item[] }).items;
const linea = (i: Item) => `${i.de} ${i.clase} ${i.nombre}: ${i.detalle.join(" | ")}`;

describe("infra: Kubernetes", () => {
  let ctx: Contexto, json: string;
  beforeAll(async () => ({ ctx, json } = await montar("kubernetes", "svc-api", "api")));

  it("Deployment y Service van al servicio por su etiqueta app; de ConfigMap y Secret solo las claves", () => {
    expect(items(ctx, { nodo: "svc-api", texto: "Deployment" }).map(linea)).toEqual([
      "svc-api kubernetes Deployment tienda-api: namespace tienda | réplicas 3 | contenedor api: imagen registry.example.com/tienda/api:1.4.0 | puerto 3000 | comando node dist/server.js | variable PUERTO | variable DB_URL (de Secret tienda-secretos) | variables de ConfigMap tienda-config",
    ]);
    expect(items(ctx, { texto: "Secret tienda-secretos" }).map((i) => `${i.nombre} ${i.ev}`)).toContain("Secret tienda-secretos repo-kubernetes:k8s/config.yaml#L10");
    for (const secreto of ["clave-del-secret", "argumento-secreto", "postgres://"]) expect(json).not.toContain(secreto);
  });

  it("una ruta de Ingress llega a los endpoints del servicio que cuelgan de su prefijo; la que va a un servicio sin página no se une", () => {
    const ing = items(ctx, { texto: "Ingress" });
    expect(ing.map((i) => `${i.de} ${i.nombre} ${i.ev} → ${(i.endpoints ?? []).join(", ")}`)).toEqual([
      "svc-api Ingress tienda tienda.example.com/api repo-kubernetes:k8s/ingress.yaml#L11 → svc-api:GET:/api/productos, svc-api:POST:/api/pedidos",
      "svc-api Ingress tienda tienda.example.com/ repo-kubernetes:k8s/ingress.yaml#L18 → ",
    ]);
    // Desde el endpoint: qué infraestructura llega a él.
    expect(items(ctx, { nodo: "svc-api:POST:/api/pedidos" }).map((i) => i.nombre)).toEqual(["Ingress tienda tienda.example.com/api"]);
    // La raíz deriva a `web`, que no tiene página: queda en el repo del manifiesto (su único servicio) y lo dice.
    expect(items(ctx, { texto: "web no tiene" }).map((i) => i.detalle)).toEqual([["web no tiene página en el brain: sus rutas no se unen a endpoints"]]);
    expect((infra(ctx, { nodo: "svc-api:GET:/salud", texto: "/api" }) as { avisos: string[] }).avisos).toEqual(["ninguna ruta de Ingress, evento http ni route_key declarados en los repos llega a este endpoint"]);
  });
});

describe("infra: Helm", () => {
  let ctx: Contexto, json: string;
  beforeAll(async () => ({ ctx, json } = await montar("helm", "svc-catalogo", "catalogo")));

  it("el chart va al servicio por su nombre, con values, plantillas sin renderizar y la ruta de ingreso unida a los endpoints", () => {
    const [chart, ...resto] = items(ctx, { texto: "chart catalogo" });
    expect(resto).toEqual([]);
    expect(chart!.de).toBe("svc-catalogo");
    expect(chart!.ev).toBe("repo-helm:charts/api/Chart.yaml#L2");
    expect(chart!.detalle).toEqual([
      "versión 0.3.1",
      "app 2.0.0",
      "depende del chart redis 18.1.0 (https://charts.bitnami.com/bitnami)",
      "imagen registry.example.com/catalogo:(appVersion 2.0.0)",
      "réplicas 2",
      "servicio ClusterIP puerto 80 → 8080",
      "ingreso catalogo.example.com/catalogo",
      "variable API_KEY",
      "variable REDIS_URL",
      "otros valores: values-prod.yaml",
      "plantilla templates/deployment.yaml: Deployment",
      "plantilla templates/service.yaml: Service, Ingress",
      "sin renderizar: nombres, condiciones e includes ({{ }}) no se resuelven; los valores salen de values.yaml",
    ]);
    expect(chart!.endpoints).toEqual(["svc-catalogo:GET:/catalogo/items", "svc-catalogo:GET:/catalogo/items/{id}"]);
    // Las plantillas no se leen como manifiestos sueltos, y los valores de values.yaml no llegan al brain.
    expect(items(ctx, { texto: "kubernetes" })).toEqual([]);
    expect(json).not.toContain("clave-de-values");
  });
});

describe("infra: Terraform", () => {
  let ctx: Contexto, json: string;
  beforeAll(async () => ({ ctx, json } = await montar("terraform", "svc-productos", "productos")));

  it("recursos, módulos, variables y salidas; el recurso con nombre va a su servicio y un route_key se une al endpoint", () => {
    expect(items(ctx, {}).map((i) => `${i.de} ${i.nombre} ${i.ev}${i.endpoints ? ` → ${i.endpoints.join(", ")}` : ""}`)).toEqual([
      "svc-productos aws_lambda_function.api repo-terraform:main.tf#L7",
      "svc-productos aws_apigatewayv2_route.listar repo-terraform:main.tf#L20 → svc-productos:GET:/productos",
      "svc-productos aws_apigatewayv2_route.resto repo-terraform:main.tf#L26 → svc-productos:DELETE:/productos/{id}, svc-productos:GET:/productos",
      "svc-productos módulo red repo-terraform:main.tf#L31",
      "svc-productos aws_vpc.this repo-terraform:modules/red/main.tf#L1",
      "svc-productos salidas de outputs.tf repo-terraform:outputs.tf#L1",
      "svc-productos variables de variables.tf repo-terraform:variables.tf#L1",
    ]);
    expect(items(ctx, { texto: "aws_lambda_function" })[0]!.detalle).toEqual(["function_name productos", "handler dist/lambda.handler", "runtime nodejs20.x", "memory_size 512", "variable CLAVE", "variable TABLA"]);
    // Lo comentado no cuenta, y de una variable nunca sale el valor por defecto.
    expect(json).not.toContain("comentado");
    expect(json).not.toContain("secreto-de-terraform");
  });
});

describe("infra: Serverless Framework", () => {
  let ctx: Contexto, json: string, r: Awaited<ReturnType<typeof indexar>>;
  beforeAll(async () => ({ ctx, json, r } = await montar("serverless", "svc-usuarios", "usuarios", { "queue-pedidos": pagina("queue-pedidos", "queue", ["aliases: [cola-pedidos]"]) })));

  it("cada evento http es un endpoint atendido por la función del handler; la cola es un evento consumido", () => {
    const c = r.contratos.find((x) => x.svc === "svc-usuarios")!;
    expect(c.fuente).toBe("infra-parser");
    expect(c.endpoints.map((e) => `${e.metodo} ${e.ruta} ${e.evidencia}`)).toEqual([
      "CRON /limpiar repo-serverless:src/tareas.py#L1",
      "GET /usuarios repo-serverless:src/handlers/usuarios.ts#L3",
      "POST /usuarios repo-serverless:src/handlers/usuarios.ts#L9",
      "GET /usuarios/{id} repo-serverless:src/handlers/usuarios.ts#L5",
    ]);
    expect(c.eventos.map((e) => `${e.direccion} ${e.nombre} ${e.cola} ${e.evidencia}`)).toEqual(["consume cola-pedidos queue-pedidos repo-serverless:src/handlers/pedidos.ts#L1"]);
    // El endpoint lo atiende la función del handler, y quien cambie el código que esa función llama alcanza al endpoint.
    expect((recorrido(ctx, { desde: "GET /usuarios" }) as { atiende: string }).atiende).toBe("listar @ repo-serverless:src/handlers/usuarios.ts#L3");
    expect(JSON.stringify(quienLlama(ctx, { simbolo: "buscar" }))).toContain("svc-usuarios:GET:/usuarios");
  });

  it("en infra, cada función con su handler, eventos y variables; un handler sin parser queda con su nombre", () => {
    const fs = items(ctx, { nodo: "svc-usuarios", texto: "handler" });
    expect(fs.map((i) => `${i.nombre} → ${i.atiende?.simbolo} ${i.atiende?.evidencia}${i.endpoints ? ` [${i.endpoints.join(", ")}]` : ""}`)).toEqual([
      "listar → listar repo-serverless:src/handlers/usuarios.ts#L3 [svc-usuarios:GET:/usuarios]",
      "obtener → obtener repo-serverless:src/handlers/usuarios.ts#L5 [svc-usuarios:GET:/usuarios/{id}]",
      "crear → crear repo-serverless:src/handlers/usuarios.ts#L9 [svc-usuarios:POST:/usuarios]",
      "todo → todo repo-serverless:src/handlers/usuarios.ts#L11 [svc-usuarios:GET:/usuarios, svc-usuarios:GET:/usuarios/{id}, svc-usuarios:POST:/usuarios]",
      "limpiar → limpiar repo-serverless:src/tareas.py#L1",
      "procesar → procesar repo-serverless:src/handlers/pedidos.ts#L1",
    ]);
    expect(items(ctx, { texto: "serverless usuarios" }).map(linea)).toEqual(["svc-usuarios funcion serverless usuarios: proveedor aws | runtime nodejs20.x | 6 funciones | variable TABLA_USUARIOS | variable TOKEN_SECRETO"]);
    expect(items(ctx, { texto: "programada" }).map(linea)).toEqual(["svc-usuarios funcion limpiar: programada rate(1 day)"]);
    expect(json).not.toContain("valor-de-serverless");
  });
});

describe("infra: AWS SAM", () => {
  let ctx: Contexto, json: string, r: Awaited<ReturnType<typeof indexar>>;
  beforeAll(async () => ({ ctx, json, r } = await montar("sam", "svc-pedidos", "pedidos", { "queue-sam": pagina("queue-sam", "queue", ["aliases: [cola-sam]"]) })));

  it("funciones con CodeUri de Globals, eventos Api/HttpApi como endpoints y la cola de !GetAtt por su QueueName", () => {
    const c = r.contratos.find((x) => x.svc === "svc-pedidos")!;
    expect(c.endpoints.map((e) => `${e.metodo} ${e.ruta} ${e.evidencia}`)).toEqual(["CRON /ConsumirFn repo-sam:src/app.js#L5", "GET /pedidos repo-sam:src/app.js#L1", "POST /pedidos repo-sam:src/app.js#L3"]);
    // El evento programado es una entrada atendida por el handler, con su horario.
    expect(c.endpoints.find((e) => e.metodo === "CRON")?.horario).toBe("cron(0 3 * * ? *)");
    expect(c.eventos.map((e) => `${e.nombre} ${e.cola}`)).toEqual(["cola-sam queue-sam"]);
    expect(items(ctx, { nodo: "svc-pedidos" }).map(linea)).toEqual([
      "svc-pedidos funcion ListarFn: handler app.listar → src/app.js#L1 | runtime nodejs20.x | http GET /pedidos | variable TABLA",
      "svc-pedidos funcion CrearFn: handler app.crear → src/app.js#L3 | runtime nodejs20.x | http POST /pedidos | variable CLAVE_PAGOS | variable TABLA",
      "svc-pedidos funcion ConsumirFn: handler app.consumir → src/app.js#L5 | runtime nodejs20.x | cola cola-sam | programada cron(0 3 * * ? *) | variable TABLA",
    ]);
    expect(json).not.toContain("clave-de-sam");
  });
});

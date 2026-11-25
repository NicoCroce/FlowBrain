import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarContexto, cerebroLiviano, compileDir, contratoDe, crucesDesde, deriva, recorrido, type Contexto } from "@flowbrain/core";
import { escribirIndex, indexar } from "../src/index.js";

/**
 * Entradas que no son HTTP (decisión 197): tareas programadas (`CRON`) y rpcs de gRPC (`GRPC`), endpoints atendidos
 * por el método que los ejecuta. Un fixture por caso en `fixtures/entradas/<caso>`.
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FX = (c: string) => join(RAIZ, "fixtures/entradas", c);
const pagina = (id: string, tipo: string, extra: string[] = []) => ["---", `id: ${id}`, `tipo: ${tipo}`, `nombre: ${id}`, `resumen: ${id}.`, ...extra, "---", `# ${id}`].join("\n") + "\n";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

/** Indexa el fixture en un brain con esos servicios (id → carpeta) y tablas, y lo compila. */
async function montar(c: string, svcs: Record<string, string>, tablas: string[], externos: string[] = [], repo = `repo-${c}`) {
  const brain = await mkdtemp(join(tmpdir(), `brain-entradas-${c}-`));
  dirs.push(brain);
  await mkdir(join(brain, "technology"), { recursive: true });
  await writeFile(join(brain, "technology", `${repo}.md`), pagina(repo, "repo"));
  for (const [id, carpeta] of Object.entries(svcs)) await writeFile(join(brain, "technology", `${id}.md`), pagina(id, "svc", [`vive_en: [${repo}]`, "puntos_de_entrada:", `  arranque: ${carpeta}`]));
  for (const t of tablas) await writeFile(join(brain, "technology", `tabla-${t}.md`), pagina(`tabla-${t}`, "tabla"));
  for (const e of externos) await writeFile(join(brain, "technology", `ext-${e}.md`), pagina(`ext-${e}`, "ext"));
  const r = await indexar(FX(c), brain);
  await escribirIndex(brain, r);
  await compileDir(brain);
  return { brain, r, ctx: await cargarContexto(brain) };
}
const entradas = (r: Awaited<ReturnType<typeof indexar>>, svc: string) =>
  r.contratos.find((x) => x.svc === svc)!.endpoints.map((e) => `${e.metodo} ${e.ruta} ${e.evidencia.replace(/^[^:]+:/, "")}${e.horario ? ` [${e.horario}]` : ""}`);
type Rec = { atiende: string | null; pasos: Array<{ simbolo: string; toca?: string[]; via?: string }>; avisos: string[] };
const toca = (r: Rec) => [...new Set(r.pasos.flatMap((p) => p.toca ?? []))].sort();

describe("tareas programadas en Node (fixtures/entradas/cron-node)", () => {
  let ctx: Contexto, r: Awaited<ReturnType<typeof indexar>>;
  beforeAll(async () => ({ ctx, r } = await montar("cron-node", { "svc-tareas": "src/tareas.ts" }, ["pedido", "resumen"])));

  it("NestJS @Cron/@Interval/@Timeout, node-cron, node-schedule, cron, agenda, bull repetible y un programador propio por la clave del trabajo", () => {
    expect(entradas(r, "svc-tareas")).toEqual([
      "CRON /CONCILIAR src/trabajos.ts#L43 [cada INTERVALO_CONCILIACION_MS ms (valor en tiempo de ejecución)]",
      "CRON /LimpiezaService.latido src/limpieza.service.ts#L20 [cada 60000 ms]",
      "CRON /LimpiezaService.resumen src/limpieza.service.ts#L15 [CronExpression.EVERY_HOUR]",
      // Una función en línea que llama a un solo método: la entrada es ese método.
      "CRON /PedidosRepo.contar src/pedidos.repo.ts#L10 [*/5 * * * *]",
      // Una que llama a varios queda en la función que la agenda.
      "CRON /arrancar src/tareas.ts#L13 [0 0 1 * *]",
      "CRON /calentar src/limpieza.service.ts#L25 [una vez, a los 5000 ms de arrancar]",
      "CRON /enviar-resumen src/avisos.ts#L5 [cada 5 minutes]",
      "CRON /limpiar-pedidos src/limpieza.service.ts#L10 [0 3 * * *]",
      "CRON /purgar src/pedidos.repo.ts#L6 [0 4 * * *]",
      "CRON /reporte-diario src/avisos.ts#L1 [0 8 * * *]",
    ]);
  });

  it("el recorrido de una tarea llega a sus tablas como el de un endpoint", () => {
    const a = recorrido(ctx, { desde: "CRON /limpiar-pedidos", budget_tokens: null }) as unknown as Rec;
    expect(a.atiende).toBe("LimpiezaService.limpiar @ repo-cron-node:src/limpieza.service.ts#L10");
    expect(toca(a)).toEqual(["escribe_en tabla-pedido"]);
    const b = recorrido(ctx, { desde: "CRON /CONCILIAR", budget_tokens: null }) as unknown as Rec;
    expect(b.atiende).toBe("Conciliacion.conciliar @ repo-cron-node:src/trabajos.ts#L43");
    expect(toca(b)).toEqual(["lee_de tabla-pedido"]);
    // El nodo lleva el horario.
    expect(ctx.nodo.get("svc-tareas:CRON:/limpiar-pedidos")?.atributos["horario"]).toBe("0 3 * * *");
  });

  it("deriva no cuenta una tarea programada como endpoint sin llamadas, y lo dice", () => {
    const d = deriva(ctx, { budget_tokens: null }) as unknown as { endpointsSinLlamadasDetectadas: unknown[]; avisos: string[] };
    expect(d.endpointsSinLlamadasDetectadas).toEqual([]);
    expect(d.avisos).toContain("10 scheduled tasks (CRON) are not counted among the uncalled endpoints: a schedule triggers them, not a call");
  });
});

describe("tareas programadas en PHP (fixtures/entradas/cron-php)", () => {
  let ctx: Contexto, r: Awaited<ReturnType<typeof indexar>>;
  beforeAll(async () => ({ ctx, r } = await montar("cron-php", { "svc-app": "app/Console/Kernel.php" }, ["recordatorios"])));

  it("Laravel ($schedule en Kernel.php y Schedule:: en routes/console.php), Symfony Scheduler y el crontab del Dockerfile, por el comando", () => {
    expect(entradas(r, "svc-app")).toEqual([
      "CRON /EnviarRecordatorios app/Console/Commands/EnviarRecordatorios.php#L12 [0 */6 * * *]",
      "CRON /GenerarReporte src/Scheduler/Tareas.php#L35 [0 7 * * 1]",
      "CRON /Latido app/Jobs/Latido.php#L9 [everyFiveMinutes]",
      "CRON /PurgarSesiones src/Scheduler/Tareas.php#L14 [15 2 * * *]",
      "CRON /RefrescarCache src/Scheduler/Tareas.php#L23 [cada 1 hour]",
      // Comandos de Symfony corridos por el crontab del Dockerfile; el comentado y `cache:clear` (no es del repo) no.
      "CRON /app-sincronizar-categorias src/Command/SincronizarCategorias.php#L12 [5 0 * * *]",
      "CRON /app-vencer-tokens src/Command/VencerTokens.php#L11 [0 2 * * *]",
      // Una función en línea: queda en el método que la agenda.
      "CRON /call app/Console/Kernel.php#L17 [hourly]",
      "CRON /recordatorios-enviar app/Console/Commands/EnviarRecordatorios.php#L12 [dailyAt(09:00)]",
      "CRON /recordatorios-enviar-2 app/Console/Commands/EnviarRecordatorios.php#L12 [weeklyOn(1, 8:00)]",
    ]);
  });

  it("el recorrido de un comando programado llega a su tabla", () => {
    const a = recorrido(ctx, { desde: "CRON /app-sincronizar-categorias", budget_tokens: null }) as unknown as Rec;
    expect(a.atiende).toBe("SincronizarCategorias.execute @ repo-cron-php:src/Command/SincronizarCategorias.php#L12");
    expect(toca(a)).toEqual(["lee_de tabla-recordatorios"]);
  });
});

describe("gRPC (fixtures/entradas/grpc)", () => {
  const svcs = { "svc-api": "apps/api/src/pedidos.controller.ts", "svc-stock": "apps/stock/src/server.ts", "svc-web": "apps/web/src/pedidos.cliente.ts" };
  let ctx: Contexto, r: Awaited<ReturnType<typeof indexar>>;
  beforeAll(async () => ({ ctx, r } = await montar("grpc", svcs, ["pedido"], ["inventario"])));

  it("los rpcs del .proto que implementa NestJS (@GrpcMethod) o grpc-js (addService), en el método, con la línea del .proto y los mensajes", () => {
    expect(entradas(r, "svc-api")).toEqual(["GRPC /pedidos.v1.Pedidos/Crear apps/api/src/pedidos.controller.ts#L10", "GRPC /pedidos.v1.Pedidos/Listar apps/api/src/pedidos.controller.ts#L15"]);
    expect(entradas(r, "svc-stock")).toEqual(["GRPC /pedidos.v1.Stock/Reservar apps/stock/src/server.ts#L8"]);
    const c = contratoDe(ctx, { nodo: "svc-api:GRPC:/pedidos.v1.Pedidos/Crear", proyeccion: "completo", budget_tokens: null } as never) as unknown as { nodos: Array<{ endpoints: Array<Record<string, unknown>> }> };
    expect(c.nodos[0]!.endpoints[0]).toMatchObject({ request: { nombre: "NuevoPedido" }, response: { nombre: "Pedido" }, proto: "repo-grpc:proto/pedidos.proto#L7" });
    expect(r.contratos.find((x) => x.svc === "svc-api")!.tipos).toEqual({
      Filtro: { pagina: "number" },
      NuevoPedido: { cantidad: "number", producto_id: "string" },
      Pedido: { cantidades: "Record<string, number>", id: "string", items: "string[]", nota: "string | undefined" },
    });
  });

  it("los clientes (getService de NestJS, new Servicio(addr) de grpc-js) se unen al rpc; uno que nadie implementa queda sin endpoint", () => {
    const unidas = r.aristas.filter((a) => a.desde === "svc-web").map((a) => `${a.hasta} ${a.endpoint}`);
    expect(unidas).toEqual(["svc-api svc-api:GRPC:/pedidos.v1.Pedidos/Crear", "svc-api svc-api:GRPC:/pedidos.v1.Pedidos/Listar", "svc-stock svc-stock:GRPC:/pedidos.v1.Stock/Reservar"]);
    const d = deriva(ctx, { budget_tokens: null }) as unknown as { llamadasSinEndpoint: Array<{ llamada: string }>; endpointsSinLlamadasDetectadas: unknown[]; avisos: string[] };
    expect(d.llamadasSinEndpoint.map((l) => l.llamada)).toEqual(["GRPC /pedidos.v1.Pedidos/Cancelar"]);
    expect(d.endpointsSinLlamadasDetectadas).toEqual([]);
    expect(d.avisos).toContain("3 linked gRPC calls are not compared by fields: messages live in the `.proto` and the index does not read what the client builds");
  });

  it("el recorrido cruza del cliente al servidor por el rpc, como por HTTP", () => {
    const a = recorrido(ctx, { desde: "PedidosCliente.crear", budget_tokens: null }) as unknown as Rec;
    expect(a.pasos.map((p) => `${p.simbolo}${p.via ? ` (${p.via})` : ""}`)).toEqual([
      "PedidosCliente.crear",
      // La interfaz con que el cliente tipa el servicio.
      "PedidosGrpc.crear",
      "PedidosController.crear (over HTTP: svc-api:GRPC:/pedidos.v1.Pedidos/Crear)",
    ]);
    expect(toca(a)).toContain("escribe_en tabla-pedido");
    const b = recorrido(ctx, { desde: "GRPC /pedidos.v1.Stock/Reservar", budget_tokens: null }) as unknown as Rec;
    expect(b.atiende).toBe("reservar @ repo-grpc:apps/stock/src/server.ts#L8");
    expect(b.pasos.map((p) => p.simbolo)).toEqual(["reservar", "descontar"]);
    expect(toca(b)).toEqual(["llama_a ext-inventario"]);
  });

  it("entre cerebros: la llamada de un cliente indexado aparte se une al rpc del cerebro que lo implementa", async () => {
    const servidor = await montar("grpc", { "svc-api": svcs["svc-api"], "svc-stock": svcs["svc-stock"] }, ["pedido"]);
    const cliente = await montar("grpc", { "svc-web": svcs["svc-web"] }, []);
    const liviano = async (b: { brain: string; ctx: Contexto }, nombre: string) => {
      const dir = join(b.brain, "_build/extraction");
      const ex = await Promise.all((await readdir(dir)).map((n) => readFile(join(dir, n), "utf8")));
      return cerebroLiviano(nombre, b.ctx.graph, ex);
    };
    const x = crucesDesde(await liviano(cliente, "cliente"), [await liviano(servidor, "servidor")], []);
    expect(x.cruces.map((c) => c.hacia.endpoint).sort()).toEqual(["svc-api:GRPC:/pedidos.v1.Pedidos/Crear", "svc-api:GRPC:/pedidos.v1.Pedidos/Listar", "svc-stock:GRPC:/pedidos.v1.Stock/Reservar"]);
  });
});

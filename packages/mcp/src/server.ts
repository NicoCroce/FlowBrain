import { stat } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  actualizarHeads,
  BUDGET_POR_DEFECTO,
  buscarNodo,
  cargarContexto,
  ConsultaError,
  contratoDe,
  funcionalidad,
  impactoDe,
  PROFUNDIDAD_MAX,
  quienLlama,
  recorrido,
  PROYECCIONES,
  recorrerGrafo,
  stringifyCanonical,
  trazar,
  VERBOS,
  type Contexto,
} from "@brain/core";
import { z } from "zod";

/** Versión del paquete, la inyecta el build de brain-graph; "dev" corriendo desde el repo. */
declare const __BRAIN_VERSION__: string | undefined;

/** Carga el contexto y lo recarga si `_build/graph.json` cambió (por mtime). */
export function cargadorConCache(raiz: string): () => Promise<Contexto> {
  let cache: { mtime: number; ctx: Contexto } | null = null;
  return async () => {
    const mtime = (await stat(join(raiz, "_build/graph.json"))).mtimeMs;
    if (!cache || cache.mtime !== mtime) cache = { mtime, ctx: await cargarContexto(raiz) };
    // El clon puede avanzar sin que cambie el brain: el HEAD se relee en cada consulta.
    else if (cache.ctx.codigo) await actualizarHeads(cache.ctx.codigo, raiz);
    return cache.ctx;
  };
}

const comunes = {
  proyeccion: z.enum(PROYECCIONES).optional().describe("resumen | relaciones | contrato | completo"),
  budget_tokens: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(`presupuesto de tokens de la respuesta (por defecto ${BUDGET_POR_DEFECTO}; null = sin límite)`),
};

type Texto = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Ejecuta una herramienta del motor y la serializa igual que la CLI. */
async function responder(fn: () => unknown): Promise<Texto> {
  try {
    return { content: [{ type: "text", text: stringifyCanonical(fn()) }] };
  } catch (e) {
    if (e instanceof ConsultaError) {
      return { content: [{ type: "text", text: stringifyCanonical({ error: { codigo: e.codigo, mensaje: e.message } }) }], isError: true };
    }
    throw e;
  }
}

/** Quita claves con valor undefined (el motor usa exactOptionalPropertyTypes). */
type SinUndefined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};
function limpio<T extends Record<string, unknown>>(o: T): SinUndefined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as SinUndefined<T>;
}

export function crearServidor(obtener: () => Promise<Contexto>): McpServer {
  const server = new McpServer({ name: "brain", version: typeof __BRAIN_VERSION__ === "string" ? __BRAIN_VERSION__ : "dev" });

  server.registerTool(
    "buscar_nodo",
    {
      description:
        "Busca nodos del grafo de conocimiento (servicios, repos, tablas, features, endpoints) por id, nombre o alias. Exacto > prefijo > difuso.",
      inputSchema: {
        texto: z.string().min(1),
        tipos: z.array(z.string()).optional().describe("filtra por tipo de nodo, p. ej. [\"svc\", \"endpoint\"]"),
        limite: z.number().int().positive().optional(),
        ...comunes,
      },
    },
    async (a) => {
      const ctx = await obtener();
      return responder(() => buscarNodo(ctx, limpio(a)));
    },
  );

  server.registerTool(
    "recorrer_grafo",
    {
      description:
        "Recorre el grafo desde un nodo por niveles. Con verbos=[\"depende_de\"] y direccion=\"in\" responde qué se rompe si cambia el nodo. Cada arista trae evidencia.",
      inputSchema: {
        nodo: z.string().min(1),
        verbos: z.array(z.enum(VERBOS)).optional(),
        direccion: z.enum(["out", "in", "both"]).optional(),
        profundidad: z.number().int().min(1).max(PROFUNDIDAD_MAX).optional(),
        ...comunes,
      },
    },
    async (a) => {
      const ctx = await obtener();
      return responder(() => recorrerGrafo(ctx, limpio(a)));
    },
  );

  server.registerTool(
    "contrato_de",
    {
      description: "Endpoints y eventos de un servicio, con los tipos de request/response expandidos y quién llama a cada endpoint.",
      inputSchema: {
        nodo: z.string().min(1).describe("id de un svc o de un endpoint"),
        endpoint: z.string().optional().describe("filtra un endpoint: \"MÉTODO /ruta\""),
        ...comunes,
      },
    },
    async (a) => {
      const ctx = await obtener();
      return responder(() => contratoDe(ctx, limpio(a)));
    },
  );

  server.registerTool(
    "trazar",
    {
      description:
        "Traza el flujo de datos desde un nodo, URL/ruta HTTP o archivo: saltos ordenados con verbo, evidencia, tipo de dato y confianza.",
      inputSchema: {
        desde: z.string().min(1).describe("id de nodo, ruta (/checkout), \"MÉTODO /ruta\", URL o archivo"),
        hasta: z.string().optional().describe("id de nodo destino: devuelve solo los caminos más cortos"),
        ...comunes,
      },
    },
    async (a) => {
      const ctx = await obtener();
      return responder(() => trazar(ctx, limpio(a)));
    },
  );

  const presupuesto = { budget_tokens: comunes.budget_tokens };

  server.registerTool(
    "funcionalidad",
    {
      description:
        "Ficha de una funcionalidad de producto (feat) por id o nombre: qué endpoints expone y qué método atiende cada uno, qué consume y de qué funcionalidad, qué tablas toca, con qué funcionalidades se relaciona y qué dominio comparte. Cada dato con repo:ruta#Ln.",
      inputSchema: { id: z.string().min(1).describe("id (feat-billing), sufijo (billing) o nombre"), ...presupuesto },
    },
    async (a) => {
      const ctx = await obtener();
      return responder(() => funcionalidad(ctx, limpio(a)));
    },
  );

  server.registerTool(
    "recorrido",
    {
      description:
        "Qué ejecuta el código desde un endpoint o un método: pasos en orden de llamada (controller → servicio → repositorio) con repo:ruta#Ln y lo que toca cada paso (lee_de/escribe_en tabla, llama_a servicio). Los pasos con `aviso` son huecos conocidos.",
      inputSchema: { desde: z.string().min(1).describe("endpoint (\"MÉTODO /ruta\", /ruta o id) o símbolo (Clase.metodo, funcion, ruta#Clase.metodo)"), ...presupuesto },
    },
    async (a) => {
      const ctx = await obtener();
      return responder(() => recorrido(ctx, limpio(a)));
    },
  );

  server.registerTool(
    "quien_llama",
    {
      description:
        "Quién llama a un método, función o clase, hacia arriba por niveles, con la línea de cada llamada; y qué endpoints y funcionalidades quedan alcanzados (y cuáles consumen esos endpoints). Usalo antes de cambiar una firma o un comportamiento.",
      inputSchema: {
        simbolo: z.string().min(1).describe("Clase.metodo, funcion, Clase o ruta#Simbolo"),
        profundidad: z.number().int().min(1).max(6).optional().describe("niveles hacia arriba (por defecto 3)"),
        ...presupuesto,
      },
    },
    async (a) => {
      const ctx = await obtener();
      return responder(() => quienLlama(ctx, limpio(a)));
    },
  );

  server.registerTool(
    "impacto",
    {
      description:
        "Si cambia una pieza (tabla, endpoint, servicio, externo, funcionalidad o símbolo de código), qué se ve afectado: funcionalidades y piezas técnicas por niveles con el porqué; para una tabla, además, qué métodos la leen o escriben.",
      inputSchema: { pieza: z.string().min(1).describe("id de nodo, nombre, \"MÉTODO /ruta\" o símbolo"), ...presupuesto },
    },
    async (a) => {
      const ctx = await obtener();
      return responder(() => impactoDe(ctx, limpio(a)));
    },
  );

  return server;
}

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  actualizarHeads,
  avisosIndice,
  BUDGET_POR_DEFECTO,
  buscarNodo,
  cargarContexto,
  ConsultaError,
  contratoDe,
  deriva,
  especificaciones,
  fidelidad,
  sinAsociar,
  funcionalidad,
  impactoDe,
  infra,
  PROFUNDIDAD_MAX,
  quienLlama,
  recorrido,
  pantalla,
  paridad,
  PROYECCIONES,
  recorrerGrafo,
  riesgo,
  SIGNALS,
  stringifyCompact,
  trazar,
  VERBOS,
  type Contexto,
} from "@flowbrain/core";
import { z } from "zod";

/** Versión del paquete, la inyecta el build de flowbrain; "dev" corriendo desde el repo. */
declare const __FLOWBRAIN_VERSION__: string | undefined;

/**
 * Carga el contexto y lo recarga si `_build/graph.json` cambió (por mtime). Con `alDesfase`, si algún clon avanzó
 * desde que se indexó, lo llama (reindexar y recompilar) y recarga antes de responder: el agente consulta siempre
 * sobre el código actual. Se intenta una vez por cada estado de los clones; si falla, se responde con el aviso de siempre.
 */
export function cargadorConCache(raiz: string, alDesfase?: () => Promise<unknown>): () => Promise<Contexto> {
  let cache: { mtime: number; ctx: Contexto } | null = null;
  let intentado = "";
  const cargar = async () => {
    const mtime = (await stat(join(raiz, "_build/graph.json"))).mtimeMs;
    if (!cache || cache.mtime !== mtime) cache = { mtime, ctx: await cargarContexto(raiz) };
    // El clon puede avanzar sin que cambie el brain: el HEAD se relee en cada consulta.
    else if (cache.ctx.codigo) await actualizarHeads(cache.ctx.codigo, raiz);
    return cache.ctx;
  };
  return async () => {
    const ctx = await cargar();
    const heads = ctx.codigo ? JSON.stringify(ctx.codigo.actuales) : "";
    if (!alDesfase || !ctx.codigo || !avisosIndice(ctx.codigo).length || heads === intentado) return ctx;
    intentado = heads;
    try {
      await alDesfase();
    } catch {
      return ctx;
    }
    cache = null;
    return cargar();
  };
}

const comunes = {
  proyeccion: z.enum(PROYECCIONES).optional().describe("summary (resumen) | relations (relaciones) | contract (contrato) | full (completo)"),
  budget_tokens: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(`token budget for the response (default ${BUDGET_POR_DEFECTO}; null = no limit)`),
};

type Texto = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/**
 * Ejecuta una herramienta del motor y la serializa compacta: el presupuesto de tokens se mide sobre ese mismo
 * texto, así que lo que recibe el agente es lo que se presupuestó (la CLI indenta, para leerla una persona).
 */
async function responder(fn: () => unknown): Promise<Texto> {
  try {
    return { content: [{ type: "text", text: stringifyCompact(fn()) }] };
  } catch (e) {
    if (e instanceof ConsultaError) {
      return { content: [{ type: "text", text: stringifyCompact({ error: { codigo: e.codigo, mensaje: e.message } }) }], isError: true };
    }
    throw e;
  }
}

/** Guía de uso que el cliente MCP le pasa al agente al conectarse. */
export const INSTRUCCIONES = [
  "Knowledge graph of the system: product (features, screens), code (endpoints, methods, tables) and how they connect across repos. Query it before exploring the code with grep.",
  "Which tool to use:",
  "- I don't know the id of something, or I'm looking for a class, method or word: buscar_nodo.",
  "- What a product feature does: funcionalidad.",
  "- A front-end screen end to end: pantalla.",
  "- What an endpoint or a method executes, step by step: recorrido.",
  "- What an endpoint receives and returns: contrato_de.",
  "- What breaks if I change a table, endpoint, service or feature: impacto. If it's a method or a class: quien_llama.",
  "- How risky a concrete change is (a diff or some files): riesgo.",
  "- Endpoints nobody calls or calls nobody serves: deriva.",
  "- What is left to migrate from one service to another: paridad.",
  "- Where a piece of data travels between services: trazar.",
  "- How a service is built, deployed and configured (image, pipeline, environment variables, proxy, Kubernetes, Helm, Terraform, serverless): infra.",
  "- Neighbors of a node by relation type: recorrer_grafo.",
  "- What a feature must satisfy (business and product requirements), which file satisfies it and which test verifies it: especificaciones.",
  "- Which files belong to no feature and which one each should be assigned to: sin_asociar.",
  "- How reliable what the graph says about a file or a feature is, and what is missing: fidelidad.",
  "Every fact comes with evidence `repo:path#Ln`: open that file before claiming anything. `avisos` (notices) and `truncado` (truncated) mark known gaps: data is missing there, it does not mean nothing happens.",
  "While developing: the graph only sees committed code, so for uncommitted changes read the code. After adding a feature or files, check sin_asociar and propose a draft page in `_drafts/product/` instead of editing `product/`.",
].join("\n");

/** Quita claves con valor undefined (el motor usa exactOptionalPropertyTypes). */
type SinUndefined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};
function limpio<T extends Record<string, unknown>>(o: T): SinUndefined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as SinUndefined<T>;
}

/** Un cerebro ya resuelto para una consulta: su contexto y lo que hay que agregarle a la respuesta. */
export interface CerebroResuelto {
  ctx: Contexto;
  nombre: string;
  /** El cerebro se indexó sin revisión humana (`curado: false`). */
  sinRevisar: boolean;
  /** Campos extra para la respuesta: pistas de otros cerebros y relaciones que cruzan. */
  anotar(herramienta: string, args: Record<string, unknown>, resultado: unknown): Promise<Record<string, unknown>>;
}

/** Varios cerebros detrás de un solo servidor. */
export interface Multi {
  /** Texto para las instrucciones: qué cerebros hay y cómo elegir. */
  descripcion: string;
  resolver(cerebro?: string): Promise<CerebroResuelto>;
  /** Resumen de las llamadas entre el cerebro y sus vecinos. */
  conexiones(cerebro?: string): Promise<unknown>;
  /** Paridad entre dos servicios que pueden estar en cerebros distintos (`cerebro/svc-x`). */
  paridad(args: { viejo: string; nuevo: string; budget_tokens?: number | null }, cerebro?: string): Promise<unknown>;
}

export function crearServidor(obtener: () => Promise<Contexto>, multi?: Multi): McpServer {
  const server = new McpServer({ name: "flowbrain", version: typeof __FLOWBRAIN_VERSION__ === "string" ? __FLOWBRAIN_VERSION__ : "dev" }, { instructions: multi ? `${INSTRUCCIONES}\n${multi.descripcion}` : INSTRUCCIONES });
  // Siempre declarado; con un solo brain no cambia nada.
  const deCerebro = { cerebro: z.string().min(1).optional().describe("with several brains, which one to query; by default, the one of the current repo") };

  /** Corre una herramienta sobre el cerebro que corresponde y, con varios cerebros, rotula la respuesta. */
  async function correr<A extends Record<string, unknown>>(herramienta: string, a: A, fn: (ctx: Contexto, args: SinUndefined<A>) => unknown): Promise<Texto> {
    const { cerebro, ...resto } = a as A & { cerebro?: string };
    const args = limpio(resto) as unknown as SinUndefined<A>;
    if (!multi) {
      const ctx = await obtener();
      return responder(() => fn(ctx, args));
    }
    try {
      const c = await multi.resolver(cerebro);
      const r = fn(c.ctx, args);
      const extra = await c.anotar(herramienta, args as Record<string, unknown>, r);
      return responder(() => (typeof r === "object" && r !== null && !Array.isArray(r) ? { ...r, cerebro: c.nombre, ...(c.sinRevisar ? { sinRevisar: true } : {}), ...extra } : r));
    } catch (e) {
      return responder(() => {
        throw e;
      });
    }
  }

  server.registerTool(
    "buscar_nodo",
    {
      description:
        "Searches graph nodes (services, repos, tables, features, endpoints, screens) by id, name or alias, and also inside the name and in the text of their page. It also returns `simbolos`: classes, methods and functions in the code with that name, with their `repo:path#Ln`. Exact > prefix > contains > fuzzy > text.",
      inputSchema: {
        texto: z.string().min(1),
        tipos: z.array(z.string()).optional().describe("filter by node type, e.g. [\"svc\", \"endpoint\"]; \"simbolo\" for code symbols only"),
        limite: z.number().int().positive().optional(),
        ...comunes,
        ...deCerebro,
      },
    },
    async (a) => correr("buscar_nodo", a, (ctx, args) => buscarNodo(ctx, args)),
  );

  server.registerTool(
    "recorrer_grafo",
    {
      description:
        "Walks the graph from a node, level by level. With verbos=[\"depende_de\"] and direccion=\"in\" it answers what breaks if the node changes. Every edge comes with evidence.",
      inputSchema: {
        nodo: z.string().min(1),
        verbos: z.array(z.enum(VERBOS)).optional(),
        direccion: z.enum(["out", "in", "both"]).optional(),
        profundidad: z.number().int().min(1).max(PROFUNDIDAD_MAX).optional(),
        ...comunes,
        ...deCerebro,
      },
    },
    async (a) => correr("recorrer_grafo", a, (ctx, args) => recorrerGrafo(ctx, args)),
  );

  server.registerTool(
    "contrato_de",
    {
      description: "Endpoints and events of a service, with request/response types expanded and who calls each endpoint.",
      inputSchema: {
        nodo: z.string().min(1).describe("id of a svc or an endpoint"),
        endpoint: z.string().optional().describe("filter one endpoint: \"METHOD /path\""),
        ...comunes,
        ...deCerebro,
      },
    },
    async (a) => correr("contrato_de", a, (ctx, args) => contratoDe(ctx, args)),
  );

  server.registerTool(
    "trazar",
    {
      description:
        "Traces the data flow from a node, URL/HTTP path or file: ordered hops with verb, evidence, data type and confidence.",
      inputSchema: {
        desde: z.string().min(1).describe("node id, path (/checkout), \"METHOD /path\", URL or file"),
        hasta: z.string().optional().describe("target node id: returns only the shortest paths"),
        ...comunes,
        ...deCerebro,
      },
    },
    async (a) => correr("trazar", a, (ctx, args) => trazar(ctx, args)),
  );

  const presupuesto = { budget_tokens: comunes.budget_tokens };

  server.registerTool(
    "funcionalidad",
    {
      description:
        "Card of a product feature (feat) by id or name: which endpoints it exposes and which method serves each one, what it consumes and from which feature, which tables it touches, which features it relates to and which domain it shares. Every fact with repo:path#Ln.",
      inputSchema: { id: z.string().min(1).describe("id (feat-billing), suffix (billing) or name"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("funcionalidad", a, (ctx, args) => funcionalidad(ctx, args)),
  );

  server.registerTool(
    "recorrido",
    {
      description:
        "What the code executes from an endpoint, a method, a front-end hook/function or a screen (`pantalla /path`): steps in call order (front → endpoint → controller → service → repository) with repo:path#Ln and what each step touches (lee_de/escribe_en table, llama_a endpoint). `via` marks hops over HTTP, events or queues; `repite`, a method already walked; `aviso`, a known gap.",
      inputSchema: { desde: z.string().min(1).describe("endpoint (\"METHOD /path\", /path or id) or symbol (Class.method, function, path#Class.method) or screen (\"pantalla /login\")"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("recorrido", a, (ctx, args) => recorrido(ctx, args)),
  );

  server.registerTool(
    "pantalla",
    {
      description:
        "A front-end screen end to end: its component and feature, what wraps it (layouts, guards and where they redirect), which screens or menus lead to it, which ones it leads to, which back-end endpoints it calls and the full flow (screen → components → hooks → API → endpoint → controller → service → table) with repo:path#Ln.",
      inputSchema: { ruta: z.string().min(1).describe("front-end route (/login, /orders/{id}), screen id or the name of its component (LoginScreen)"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("pantalla", a, (ctx, args) => pantalla(ctx, args)),
  );

  server.registerTool(
    "quien_llama",
    {
      description:
        "Who calls a method, function or class, upwards level by level, with the line of each call (also through events and queues, with `via`); which endpoints and features are reached and who calls those endpoints over HTTP from other repos (`porHttp`). `avisos` lists unresolved calls with the same name. Use it before changing a signature or a behavior.",
      inputSchema: {
        simbolo: z.string().min(1).describe("Class.method, function, Class or path#Symbol"),
        profundidad: z.number().int().min(1).max(6).optional().describe("levels upwards (default 3)"),
        ...presupuesto,
        ...deCerebro,
      },
    },
    async (a) => correr("quien_llama", a, (ctx, args) => quienLlama(ctx, args)),
  );

  server.registerTool(
    "impacto",
    {
      description:
        "If a piece changes (table, endpoint, service, external, feature or code symbol), what is affected: features and technical pieces by level with the reason; for a table, also which methods read or write it.",
      inputSchema: { pieza: z.string().min(1).describe("node id, name, \"METHOD /path\" or symbol"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("impacto", a, (ctx, args) => impactoDe(ctx, args)),
  );

  server.registerTool(
    "infra",
    {
      description:
        "Infrastructure declared in the repos: image of each service (base, ports, command), compose services and what they depend on, CI pipelines with their steps, expected environment variables (names only), proxy routes, Kubernetes manifests (Deployment, Service, Ingress, ConfigMap and Secret with keys only), Helm charts (Chart.yaml, values and templates, not rendered), Terraform (resources, modules, variables and outputs) and serverless functions (serverless.yml, SAM: handler, http, scheduled and queue events). Every fact with repo:path#Ln. An Ingress route, an http event or a route_key comes with `endpoints` (the service endpoints it reaches); a function, with `atiende` (the code function of the handler). With `texto` it answers where a variable, a port or an image is used; with an endpoint as `nodo`, which infrastructure reaches it.",
      inputSchema: {
        nodo: z.string().min(1).optional().describe("id of a service, repo, database, queue, external or endpoint; without nodo, the whole brain"),
        texto: z.string().min(1).optional().describe("filter: variable name, port, image, step (DATABASE_URL, 5432, deploy)"),
        ...presupuesto,
        ...deCerebro,
      },
    },
    async (a) => correr("infra", a, (ctx, args) => infra(ctx, args)),
  );

  server.registerTool(
    "riesgo",
    {
      description:
        "Risk of a change before making or merging it: with a diff (`git diff`) or a list of files, it says which methods, types and constants change, who calls or uses them and what is reached (features, endpoints, screens, tables, other repos that consume it over HTTP, teams and decisions), with a reach `nivel` (bajo, medio, alto = low, medium, high) and its `motivos` (reasons). `avisos` lists what could not be measured.",
      inputSchema: {
        diff: z.string().min(1).optional().describe("unified diff, as git diff prints it"),
        archivos: z.array(z.string().min(1)).optional().describe("touched files (path or repo:path), if there is no diff"),
        repo: z.string().min(1).optional().describe("id of the repo the paths belong to"),
        profundidad: z.number().int().min(1).max(6).optional().describe("levels of callers upwards (default 4)"),
        ...presupuesto,
        ...deCerebro,
      },
    },
    async (a) => correr("riesgo", a, (ctx, args) => riesgo(ctx, args)),
  );

  server.registerTool(
    "deriva",
    {
      description:
        "Contract drift between services: calls to paths no endpoint serves (and whether they exist with another method), calls that match several endpoints, and endpoints no indexed consumer calls. With several brains it cross-references: what another connected brain serves or calls does not count as drift. It compares the fields of each matched call against the endpoint contract (also in another brain): what is sent and the back end does not declare, what is required and not sent, and what is expected from the response and does not come (`camposQueNoCoinciden`, with evidence from both sides); what cannot be compared goes in `campos.noComparables` with its reason. Useful before deleting an endpoint or to find broken integrations.",
      inputSchema: { nodo: z.string().min(1).optional().describe("id of a service; without it, all of them"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("deriva", a, (ctx, args) => deriva(ctx, args)),
  );

  server.registerTool(
    "paridad",
    {
      description:
        "Parity of a migration between two services (the one being replaced and its replacement): which endpoints or screens are already on the other side, which are missing, which are new, in which the touched tables differ, and which tables of the old one the new one does not use yet.",
      inputSchema: { viejo: z.string().min(1).describe("id of the source service; with several brains, `brain/svc-x` or just `brain` if it has a single service"), nuevo: z.string().min(1).describe("id of the replacing service; same format as `viejo`"), ...presupuesto, ...deCerebro },
    },
    async (a) => {
      if (!multi) return correr("paridad", a, (ctx, args) => paridad(ctx, args));
      // Con varios cerebros, cada lado puede estar en el suyo.
      const { cerebro, ...resto } = a;
      try {
        const r = await multi.paridad(limpio(resto), cerebro);
        return responder(() => r);
      } catch (e) {
        return responder(() => {
          throw e;
        });
      }
    },
  );

  server.registerTool(
    "especificaciones",
    {
      description:
        "Use cases and business and product requirements of a feature, in plain language: what someone can do with it (each case with its state: cumplido = satisfied, sin_test = untested, sin_codigo = no code; and `problema` if a person marked it as wrong), what must hold, which files satisfy it and which test cases verify it, with its state (propuesta = proposed by a model, confirmada = confirmed by a person). Without arguments: how many each feature has and how many test cases verify none. With `funcionalidad`: each requirement, the untested ones (`manual`: a person decided to test it by hand, counts as verified) and loose test cases. Every rule that was requested to be tested ends in one of four outcomes: verified with a new test, already covered by an existing test, or with a `hallazgo` (finding: `codigo_no_cumple` = the code does not satisfy it; `no_testeable` = it cannot be tested without touching the code; with the report of what the code does today, what would have to change and the test that proves it, and `decision` if a person settled whether the rule or the code is wrong). The agent that writes tests never modifies the product code. With `con_hallazgo` you see only those rules. To write the missing tests: `flowbrain specs --guide-tests`. Use it before changing a feature, to know what must not break and what is untested.",
      inputSchema: {
        funcionalidad: z.string().min(1).optional().describe("id (feat-billing), suffix (billing) or name"),
        estado: z.enum(["propuesta", "confirmada"]).optional().describe("only those in that state"),
        tipo: z.enum(["negocio", "producto"]).optional().describe("only those of that type (negocio = business, producto = product)"),
        sin_test: z.boolean().optional().describe("only those no test case verifies (and not tested by hand)"),
        con_problema: z.boolean().optional().describe("only the use cases a person marked as wrong"),
        con_hallazgo: z.boolean().optional().describe("only rules with a finding: the code does not satisfy them or they cannot be tested without touching the code"),
        ...presupuesto,
        ...deCerebro,
      },
    },
    async (a) => correr("especificaciones", a, (ctx, args) => especificaciones(ctx, args)),
  );

  server.registerTool(
    "fidelidad",
    {
      description:
        "How well the index understood each file, from 0 to 100, and what is missing with its line (unresolved calls, HTTP without a path, table accesses without columns or without a page, endpoints without a flow or without a response type, screens without calls). Without arguments: overall score, distribution by bands, by signal, by feature, layer and language, and the lowest-scoring files. With `archivo`: its detail. Files with no relation to measure have uncertain fidelity: they get no score and do not enter the average (`inciertos: true` lists them). With `plan: true`: the tasks to bring those files to 100 and how each one is solved. Use it to know where to distrust the graph and what to complete first.",
      inputSchema: {
        archivo: z.string().min(1).optional().describe("repo:path or path of a file: returns only that one"),
        min: z.number().int().min(0).max(100).optional().describe("minimum score (0 to 100)"),
        max: z.number().int().min(0).max(100).optional().describe("maximum score (0 to 100)"),
        funcionalidad: z.string().min(1).optional().describe("id or name of a feature; \"ninguna\" for files without a feature"),
        tipo: z.string().min(1).optional().describe("language or extension: php, ts, vue"),
        signal: z.enum(SIGNALS).optional().describe("only files missing this signal"),
        limite: z.number().int().positive().optional().describe("how many files to list (default 30; in a plan, 40)"),
        inciertos: z.boolean().optional().describe("instead of the report, the files with uncertain fidelity (no relation to measure, no score) and why"),
        plan: z.boolean().optional().describe("instead of the report, a text plan with the tasks of the files that pass the filters and how each one is solved"),
        ...presupuesto,
        ...deCerebro,
      },
    },
    async (a) => correr("fidelidad", a, (ctx, args) => fidelidad(ctx, args)),
  );

  server.registerTool(
    "sin_asociar",
    {
      description:
        "Index files that belong to no feature or library, grouped by folder, with the recommended feature for each one and the reason (it serves an endpoint that feature calls, it is imported by or imports files of it, or its folder neighbors belong to it). It marks shared code (used by several features) and folders that can be assigned as a whole. Use it to complete the feature catalog.",
      inputSchema: {
        carpeta: z.string().min(1).optional().describe("only those in this folder or its subfolders (repo:path or path)"),
        funcionalidad: z.string().min(1).optional().describe("only those with this feature recommended; \"ninguna\" for those without a hint"),
        limite: z.number().int().positive().optional().describe("how many folders to list (default 30)"),
        ...presupuesto,
        ...deCerebro,
      },
    },
    async (a) => correr("sin_asociar", a, (ctx, args) => sinAsociar(ctx, args)),
  );

  if (multi) {
    server.registerTool(
      "conexiones",
      {
        description:
          "What travels between brains: for each pair of services (one in this brain, another in a connected brain), how many HTTP calls there are, to how many endpoints, whether the connection is declared in the registry and examples with their line. `avisos` lists declared connections without backing and undeclared calls.",
        inputSchema: { ...deCerebro },
      },
      async (a) => {
        try {
          const r = await multi.conexiones(a.cerebro);
          return responder(() => r);
        } catch (e) {
          return responder(() => {
            throw e;
          });
        }
      },
    );
  }

  return server;
}

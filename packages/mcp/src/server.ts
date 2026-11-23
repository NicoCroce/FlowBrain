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
  "Grafo de conocimiento del sistema: producto (funcionalidades, pantallas), código (endpoints, métodos, tablas) y cómo se conectan entre repos. Consultalo antes de explorar el código con grep.",
  "Qué herramienta usar:",
  "- No sé el id de algo, o busco una clase, método o palabra: buscar_nodo.",
  "- Qué hace una funcionalidad de producto: funcionalidad.",
  "- Una pantalla del front de punta a punta: pantalla.",
  "- Qué ejecuta un endpoint o un método, paso a paso: recorrido.",
  "- Qué recibe y devuelve un endpoint: contrato_de.",
  "- Qué se rompe si cambio una tabla, endpoint, servicio o funcionalidad: impacto. Si es un método o una clase: quien_llama.",
  "- Qué tan riesgoso es un cambio concreto (un diff o unos archivos): riesgo.",
  "- Endpoints que nadie llama o llamadas que nadie atiende: deriva.",
  "- Qué falta migrar de un servicio a otro: paridad.",
  "- Por dónde viaja un dato entre servicios: trazar.",
  "- Cómo se construye, despliega y configura un servicio (imagen, pipeline, variables de entorno, proxy, Kubernetes, Helm, Terraform, serverless): infra.",
  "- Vecinos de un nodo por tipo de relación: recorrer_grafo.",
  "- Qué tiene que cumplir una funcionalidad (requisitos de negocio y de producto), qué archivo lo cumple y qué test lo verifica: especificaciones.",
  "- Qué archivos no son de ninguna funcionalidad y a cuál conviene asociar cada uno: sin_asociar.",
  "- Qué tan confiable es lo que el grafo dice de un archivo o una funcionalidad, y qué falta completar: fidelidad.",
  "Cada dato trae evidencia `repo:ruta#Ln`: abrí ese archivo antes de afirmar algo. `avisos` y `truncado` marcan huecos conocidos: ahí falta dato, no significa que no pase nada.",
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
  const deCerebro = { cerebro: z.string().min(1).optional().describe("con varios cerebros, cuál consultar; por defecto, el del repo actual") };

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
        "Busca nodos del grafo (servicios, repos, tablas, funcionalidades, endpoints, pantallas) por id, nombre o alias, y también dentro del nombre y en el texto de su página. Además devuelve `simbolos`: clases, métodos y funciones del código con ese nombre, con su `repo:ruta#Ln`. Exacto > prefijo > contiene > difuso > texto.",
      inputSchema: {
        texto: z.string().min(1),
        tipos: z.array(z.string()).optional().describe("filtra por tipo de nodo, p. ej. [\"svc\", \"endpoint\"]; \"simbolo\" para solo símbolos de código"),
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
        "Recorre el grafo desde un nodo por niveles. Con verbos=[\"depende_de\"] y direccion=\"in\" responde qué se rompe si cambia el nodo. Cada arista trae evidencia.",
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
      description: "Endpoints y eventos de un servicio, con los tipos de request/response expandidos y quién llama a cada endpoint.",
      inputSchema: {
        nodo: z.string().min(1).describe("id de un svc o de un endpoint"),
        endpoint: z.string().optional().describe("filtra un endpoint: \"MÉTODO /ruta\""),
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
        "Traza el flujo de datos desde un nodo, URL/ruta HTTP o archivo: saltos ordenados con verbo, evidencia, tipo de dato y confianza.",
      inputSchema: {
        desde: z.string().min(1).describe("id de nodo, ruta (/checkout), \"MÉTODO /ruta\", URL o archivo"),
        hasta: z.string().optional().describe("id de nodo destino: devuelve solo los caminos más cortos"),
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
        "Ficha de una funcionalidad de producto (feat) por id o nombre: qué endpoints expone y qué método atiende cada uno, qué consume y de qué funcionalidad, qué tablas toca, con qué funcionalidades se relaciona y qué dominio comparte. Cada dato con repo:ruta#Ln.",
      inputSchema: { id: z.string().min(1).describe("id (feat-billing), sufijo (billing) o nombre"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("funcionalidad", a, (ctx, args) => funcionalidad(ctx, args)),
  );

  server.registerTool(
    "recorrido",
    {
      description:
        "Qué ejecuta el código desde un endpoint, un método, un hook/función del front o una pantalla (`pantalla /ruta`): pasos en orden de llamada (front → endpoint → controller → servicio → repositorio) con repo:ruta#Ln y lo que toca cada paso (lee_de/escribe_en tabla, llama_a endpoint). `via` marca saltos por HTTP, eventos o colas; `repite`, un método ya recorrido; `aviso`, un hueco conocido.",
      inputSchema: { desde: z.string().min(1).describe("endpoint (\"MÉTODO /ruta\", /ruta o id) o símbolo (Clase.metodo, funcion, ruta#Clase.metodo) o pantalla (\"pantalla /login\")"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("recorrido", a, (ctx, args) => recorrido(ctx, args)),
  );

  server.registerTool(
    "pantalla",
    {
      description:
        "Una pantalla del front de punta a punta: su componente y funcionalidad, qué la envuelve (layouts, guardas y a dónde redirigen), desde qué pantallas o menús se llega, a cuáles lleva, qué endpoints del back llama y el recorrido completo (pantalla → componentes → hooks → API → endpoint → controller → servicio → tabla) con repo:ruta#Ln.",
      inputSchema: { ruta: z.string().min(1).describe("ruta del front (/login, /pedidos/{id}), id de la pantalla o nombre de su componente (LoginScreen)"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("pantalla", a, (ctx, args) => pantalla(ctx, args)),
  );

  server.registerTool(
    "quien_llama",
    {
      description:
        "Quién llama a un método, función o clase, hacia arriba por niveles, con la línea de cada llamada (también por eventos y colas, con `via`); qué endpoints y funcionalidades quedan alcanzados y quién llama a esos endpoints por HTTP desde otros repos (`porHttp`). Los `avisos` listan llamadas sin resolver con el mismo nombre. Usalo antes de cambiar una firma o un comportamiento.",
      inputSchema: {
        simbolo: z.string().min(1).describe("Clase.metodo, funcion, Clase o ruta#Simbolo"),
        profundidad: z.number().int().min(1).max(6).optional().describe("niveles hacia arriba (por defecto 3)"),
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
        "Si cambia una pieza (tabla, endpoint, servicio, externo, funcionalidad o símbolo de código), qué se ve afectado: funcionalidades y piezas técnicas por niveles con el porqué; para una tabla, además, qué métodos la leen o escriben.",
      inputSchema: { pieza: z.string().min(1).describe("id de nodo, nombre, \"MÉTODO /ruta\" o símbolo"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("impacto", a, (ctx, args) => impactoDe(ctx, args)),
  );

  server.registerTool(
    "infra",
    {
      description:
        "Infraestructura declarada en los repos: imagen de cada servicio (base, puertos, comando), servicios de compose y de qué dependen, pipelines de CI con sus pasos, variables de entorno que espera (solo nombres), rutas del proxy, manifiestos de Kubernetes (Deployment, Service, Ingress, ConfigMap y Secret con solo sus claves), charts de Helm (Chart.yaml, values y plantillas, sin renderizar), Terraform (recursos, módulos, variables y salidas) y funciones serverless (serverless.yml, SAM: handler, eventos http, programados y colas). Cada dato con repo:ruta#Ln. Una ruta de Ingress, un evento http o un route_key trae `endpoints` (los del servicio a los que llega); una función, `atiende` (la función del código del handler). Con `texto` responde dónde se usa una variable, un puerto o una imagen; con un endpoint como `nodo`, qué infraestructura llega a él.",
      inputSchema: {
        nodo: z.string().min(1).optional().describe("id de un servicio, repo, base, cola, externo o endpoint; sin nodo, todo el brain"),
        texto: z.string().min(1).optional().describe("filtra: nombre de variable, puerto, imagen, paso (DATABASE_URL, 5432, deploy)"),
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
        "Riesgo de un cambio antes de hacerlo o de mergearlo: con un diff (`git diff`) o una lista de archivos, dice qué métodos, tipos y constantes cambian, quién los llama o los usa y qué queda alcanzado (funcionalidades, endpoints, pantallas, tablas, otros repos que lo consumen por HTTP, equipos y decisiones), con un `nivel` de alcance (bajo, medio, alto) y sus `motivos`. Los `avisos` listan lo que no se pudo medir.",
      inputSchema: {
        diff: z.string().min(1).optional().describe("diff unificado, tal como lo da git diff"),
        archivos: z.array(z.string().min(1)).optional().describe("archivos tocados (ruta o repo:ruta), si no hay diff"),
        repo: z.string().min(1).optional().describe("id del repo al que pertenecen las rutas"),
        profundidad: z.number().int().min(1).max(6).optional().describe("niveles de llamadores hacia arriba (por defecto 4)"),
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
        "Deriva de contratos entre servicios: llamadas a rutas que ningún endpoint atiende (y si existen con otro método), llamadas que coinciden con varios endpoints, y endpoints que ningún consumidor indexado llama. Con varios cerebros cruza: lo que atiende o llama otro cerebro comunicado no cuenta como deriva. Compara campos de cada llamada unida contra el contrato del endpoint (también en otro cerebro): lo que se manda y el back no declara, lo requerido que no se manda y lo que se espera de la respuesta y no viene (`camposQueNoCoinciden`, con evidencia de los dos lados); lo que no se puede comparar va en `campos.noComparables` con su motivo. Sirve antes de borrar un endpoint o para encontrar integraciones rotas.",
      inputSchema: { nodo: z.string().min(1).optional().describe("id de un servicio; sin esto, todos"), ...presupuesto, ...deCerebro },
    },
    async (a) => correr("deriva", a, (ctx, args) => deriva(ctx, args)),
  );

  server.registerTool(
    "paridad",
    {
      description:
        "Paridad de una migración entre dos servicios (el que se reemplaza y el que lo reemplaza): qué endpoints o pantallas ya están del otro lado, cuáles faltan, cuáles son nuevos, en cuáles difieren las tablas que tocan, y qué tablas del viejo todavía no usa el nuevo.",
      inputSchema: { viejo: z.string().min(1).describe("id del servicio de origen; con varios cerebros, `cerebro/svc-x` o solo `cerebro` si tiene un único servicio"), nuevo: z.string().min(1).describe("id del servicio que lo reemplaza; igual que `viejo`"), ...presupuesto, ...deCerebro },
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
        "Requisitos de negocio y de producto de una funcionalidad, en llano: qué tiene que cumplirse, qué archivos lo cumplen y qué casos de test lo verifican, con su estado (propuesta por un modelo o confirmada por una persona). Sin argumentos: cuántas tiene cada funcionalidad y cuántos casos de test no verifican ninguna. Con `funcionalidad`: cada requisito, los que no tienen test y los casos de test sueltos. Usalo antes de cambiar una funcionalidad, para saber qué no puede romperse y qué no está probado.",
      inputSchema: {
        funcionalidad: z.string().min(1).optional().describe("id (feat-billing), sufijo (billing) o nombre"),
        estado: z.enum(["propuesta", "confirmada"]).optional().describe("solo las de ese estado"),
        tipo: z.enum(["negocio", "producto"]).optional().describe("solo las de ese tipo"),
        sin_test: z.boolean().optional().describe("solo las que ningún caso de test verifica"),
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
        "Qué tan entendido quedó cada archivo por el índice, de 0 a 100, y qué le falta con su línea (llamadas sin resolver, HTTP sin ruta, accesos a tablas sin columnas o sin página, endpoints sin recorrido o sin tipo de respuesta, pantallas sin llamadas). Sin argumentos: puntaje general, reparto por tramos, por signal, por funcionalidad, capa y lenguaje, y los archivos de menor puntaje. Con `archivo`: su detalle. Los archivos donde no hay ninguna relación para medir tienen fidelidad incierta: no llevan puntaje ni entran al promedio (`inciertos: true` los lista). Con `plan: true`: las tareas para llevar esos archivos a 100 y cómo se resuelve cada una. Usalo para saber dónde desconfiar del grafo y qué completar primero.",
      inputSchema: {
        archivo: z.string().min(1).optional().describe("repo:ruta o ruta de un archivo: devuelve solo ese"),
        min: z.number().int().min(0).max(100).optional().describe("puntaje mínimo (0 a 100)"),
        max: z.number().int().min(0).max(100).optional().describe("puntaje máximo (0 a 100)"),
        funcionalidad: z.string().min(1).optional().describe("id o nombre de una funcionalidad; \"ninguna\" para los archivos sin funcionalidad"),
        tipo: z.string().min(1).optional().describe("lenguaje o extensión: php, ts, vue"),
        signal: z.enum(SIGNALS).optional().describe("solo archivos a los que les falta esta signal"),
        limite: z.number().int().positive().optional().describe("cuántos archivos listar (por defecto 30; en un plan, 40)"),
        inciertos: z.boolean().optional().describe("en vez del informe, los archivos de fidelidad incierta (sin ninguna relación para medir, sin puntaje) y por qué"),
        plan: z.boolean().optional().describe("en vez del informe, un plan en texto con las tareas de los archivos que pasan los filtros y cómo se resuelve cada una"),
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
        "Archivos del índice que no son de ninguna funcionalidad ni librería, agrupados por carpeta, con la funcionalidad recomendada para cada uno y el motivo (atiende un endpoint que esa funcionalidad llama, lo importan o importa archivos suyos, o sus vecinos de carpeta son de ella). Marca el código compartido (lo usan varias funcionalidades) y las carpetas que se pueden asociar enteras. Usalo para completar el catálogo de funcionalidades.",
      inputSchema: {
        carpeta: z.string().min(1).optional().describe("solo los de esta carpeta o de las de adentro (repo:ruta o ruta)"),
        funcionalidad: z.string().min(1).optional().describe("solo los que tienen recomendada esta funcionalidad; \"ninguna\" para los que no tienen pista"),
        limite: z.number().int().positive().optional().describe("cuántas carpetas listar (por defecto 30)"),
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
          "Qué viaja entre cerebros: por cada par de servicios (uno de este cerebro, otro de un cerebro comunicado), cuántas llamadas HTTP hay, a cuántos endpoints, si la conexión está declarada en el registro y ejemplos con su línea. Los `avisos` listan conexiones declaradas sin respaldo y llamadas sin declarar.",
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

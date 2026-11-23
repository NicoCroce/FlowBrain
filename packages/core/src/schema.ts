import { z } from "zod";

/** Constantes y validaciones de SCHEMA.md. Cualquier cambio acá tiene que reflejarse allá. */

export const TIPOS_PAGINA = ["repo", "svc", "lib", "db", "queue", "ext", "tabla", "feat", "team", "decision"] as const;
export const TIPOS_GENERADOS = ["contrato", "endpoint", "archivo", "pantalla", "componente"] as const;
export type TipoConocido = (typeof TIPOS_PAGINA)[number];
/**
 * Tipo de una página: uno de los conocidos o uno propio del proyecto (`job`, `topic`, `worker`, `webhook`…), en
 * minúsculas. Un tipo propio va en `technology/` o en `product/`, acepta las relaciones de datos y de dependencia con
 * cualquier pieza, y fluye igual al impacto, al visor y a las consultas.
 */
export type TipoPagina = TipoConocido | (string & {});
export type Tipo = TipoPagina | (typeof TIPOS_GENERADOS)[number];
export const TIPO_PROPIO = /^[a-z][a-z0-9_]{1,30}$/;
export const esTipoPropio = (t: string) => !(TIPOS_PAGINA as readonly string[]).includes(t) && !(TIPOS_GENERADOS as readonly string[]).includes(t);
/** Verbos que acepta un tipo propio, de un lado o del otro. */
const VERBOS_TIPO_PROPIO = new Set(["llama_a", "publica_en", "consume_de", "lee_de", "escribe_en", "depende_de", "usa", "implementa", "decidido_por", "pertenece_a"]);
/** Carpeta de una página: la de su tipo; un tipo propio puede ir en cualquiera de las dos. */
export const carpetasDeTipo = (t: string): Array<"product" | "technology"> => (esTipoPropio(t) ? ["technology", "product"] : [CARPETA_POR_TIPO[t as TipoConocido]]);

export const CARPETA_POR_TIPO: Record<TipoConocido, "product" | "technology"> = {
  repo: "technology",
  svc: "technology",
  lib: "technology",
  db: "technology",
  queue: "technology",
  ext: "technology",
  tabla: "technology",
  feat: "product",
  team: "product",
  decision: "product",
};

export const ESTADOS = ["vigente", "dudoso", "deprecado"] as const;
export const ORIGENES = ["curado", "parser", "inferido"] as const;
export type Estado = (typeof ESTADOS)[number];
export type Origen = (typeof ORIGENES)[number];

export const CONFIANZA: Record<Origen, number> = { curado: 1, parser: 0.9, inferido: 0.5 };

export const VERBOS = [
  "llama_a",
  "publica_en",
  "consume_de",
  "lee_de",
  "escribe_en",
  "depende_de",
  "vive_en",
  "implementa",
  "pertenece_a",
  "decidido_por",
  "expone",
  "contiene",
  "navega_a",
  "usa",
] as const;
export type Verbo = (typeof VERBOS)[number];

/** Verbos que se escriben dentro de `relaciones`. */
export const VERBOS_RELACION = [
  "llama_a",
  "publica_en",
  "consume_de",
  "lee_de",
  "escribe_en",
  "depende_de",
  "implementa",
  "decidido_por",
] as const;

/** Verbos que llevan datos (los que recorre `trazar`). */
export const VERBOS_DATOS: readonly Verbo[] = ["llama_a", "publica_en", "consume_de", "lee_de", "escribe_en"];

/** Pares (desde → hasta) permitidos por verbo. */
const TODOS_PAGINA: readonly Tipo[] = TIPOS_PAGINA;
export const DOMINIO: Record<Verbo, ReadonlyArray<readonly [readonly Tipo[], readonly Tipo[]]>> = {
  llama_a: [
    [["svc", "lib", "ext"], ["svc", "ext"]],
    [["pantalla", "endpoint", "feat"], ["svc", "ext"]],
  ],
  publica_en: [[["svc", "endpoint", "feat"], ["queue"]]],
  consume_de: [[["svc", "endpoint", "feat"], ["queue"]]],
  lee_de: [
    [["svc"], ["db", "tabla"]],
    [["endpoint", "feat"], ["db", "tabla"]],
  ],
  escribe_en: [
    [["svc"], ["db", "tabla"]],
    [["endpoint", "feat"], ["db", "tabla"]],
  ],
  depende_de: [
    [["repo", "svc", "lib"], ["repo", "svc", "lib", "db", "queue", "ext"]],
    [["feat"], ["feat", "lib"]],
    [["tabla"], ["tabla"]],
  ],
  implementa: [
    [["svc", "lib", "repo"], ["feat"]],
    [["pantalla", "endpoint"], ["feat"]],
  ],
  decidido_por: [[TODOS_PAGINA, ["decision"]]],
  vive_en: [
    [["svc", "lib"], ["repo"]],
    [["tabla"], ["db"]],
  ],
  pertenece_a: [[["repo", "svc", "lib", "db", "queue", "ext", "feat", "tabla"], ["team"]]],
  expone: [[["svc"], ["contrato"]]],
  contiene: [
    [["repo"], ["archivo"]],
    [["svc"], ["endpoint"]],
    [["svc", "repo"], ["pantalla"]],
    [["svc", "repo"], ["componente"]],
  ],
  navega_a: [[["pantalla"], ["pantalla"]]],
  /** Un componente de una librería (un sistema de diseño) que otra pieza dibuja. */
  usa: [[["pantalla", "svc", "repo", "lib", "componente"], ["componente"]]],
};

export function verboAdmite(verbo: Verbo, desde: Tipo, hasta: Tipo): boolean {
  if ((esTipoPropio(desde) || esTipoPropio(hasta)) && VERBOS_TIPO_PROPIO.has(verbo)) return true;
  return DOMINIO[verbo].some(([ds, hs]) => ds.includes(desde) && hs.includes(hasta));
}

export const ID_PAGINA = /^[a-z]+-[a-z0-9]+(-[a-z0-9]+)*$/;
/** Ruta de código de una funcionalidad: `<repo-id>:<carpeta o archivo>`, sin línea. */
export const CODIGO = /^(repo-[a-z0-9-]+):((?!\/)(?!\.\.?\/)(?!.*\/\.\.?(\/|$))[^\s#:]+?)\/?$/;

/** ¿La evidencia `repo:ruta#L…` cae dentro de la ruta de código `repo:carpeta`? */
export function dentroDe(evidencia: string, codigo: string): boolean {
  const m = CODIGO.exec(codigo);
  const e = EVIDENCIA.exec(evidencia);
  if (!m || !e || m[1] !== e[1]) return false;
  return e[2] === m[2] || e[2]!.startsWith(`${m[2]}/`);
}

export const EVIDENCIA = /^(repo-[a-z0-9-]+):([^\s#:]+)(#L\d+(-L\d+)?)?$/;
export const ENDPOINT_REF = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CRON|GRPC) (\/\S*)$/;
export const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
/**
 * Entradas que no son HTTP, con la forma de un endpoint para que se recorran igual: `CRON /nombre` (una tarea
 * programada; nadie la llama) y `GRPC /paquete.Servicio/Metodo` (un rpc de un `.proto`, con la ruta que usa HTTP/2).
 */
export const METODOS_ENTRADA = [...METODOS, "CRON", "GRPC"] as const;
/** Entradas que nadie llama: las dispara un horario. `deriva` no las cuenta como sin llamadas. */
export const SIN_LLAMADOR = new Set(["CRON"]);

export function evidenciaValida(e: string): boolean {
  const m = EVIDENCIA.exec(e);
  if (!m) return false;
  const ruta = m[2]!;
  return !ruta.startsWith("/") && !ruta.split("/").some((s) => s === ".." || s === "." || s === "");
}

/** Normaliza una ruta HTTP: `:id`, `[id]`, `[...id]` → `{id}`; sin barra final; barras simples. */
export function normalizarRuta(ruta: string): string {
  let r = ruta
    .replace(/\[(?:\.\.\.)?([A-Za-z0-9_]+)\]/g, "{$1}")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/\/{2,}/g, "/");
  if (!r.startsWith("/")) r = "/" + r;
  if (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  return r;
}

export const endpointId = (svc: string, metodo: string, ruta: string) => `${svc}:${metodo}:${normalizarRuta(ruta)}`;

// ---------- Frontmatter ----------

const fecha = z.string().regex(FECHA, "fecha inválida, se espera YYYY-MM-DD");

export const RelacionSchema = z
  .object({
    verbo: z.string(),
    destino: z.string(),
    endpoint: z.string().optional(),
    dato: z.string().min(1).optional(),
    evidencia: z.string().optional(),
    origen: z.enum(ORIGENES).optional(),
    estado: z.enum(ESTADOS).optional(),
  })
  .strict();

export const TIPOS_ESPECIFICACION = ["negocio", "producto"] as const;
export const ESTADOS_ESPECIFICACION = ["propuesta", "confirmada"] as const;
/** Caso de test que verifica una especificación: `repo:ruta` (el archivo entero) o `repo:ruta::nombre del caso`. */
export const TEST_REF = /^(repo-[a-z0-9-]+):([^\s#:]+)(?:::(.+))?$/;

/**
 * Un requisito de una funcionalidad, en llano: qué tiene que cumplirse para que el caso de uso pase. `negocio` es una
 * regla del negocio (vale aunque cambie la pantalla); `producto`, cómo se comporta el producto para quien lo usa.
 */
export const EspecificacionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id de especificación: minúsculas, números y guiones"),
    texto: z.string().min(1).max(400, "texto: máximo 400 caracteres"),
    tipo: z.enum(TIPOS_ESPECIFICACION),
    /** Archivos que la cumplen: `repo:ruta`, con `#Ln` si se sabe la línea. */
    archivos: z.array(z.string()).optional(),
    /** Casos de test que la verifican. */
    tests: z.array(z.string()).optional(),
    /** `propuesta` (la dedujo un modelo, por defecto) o `confirmada` (la revisó una persona). */
    estado: z.enum(ESTADOS_ESPECIFICACION).optional(),
    /**
     * Por qué no necesita un test automático: una persona decidió probarla a mano ("se ve en el celular"). Cuenta como
     * verificada; la escribe la persona desde el visor y el agente no la toca.
     */
    manual: z.string().min(1).max(300, "manual: máximo 300 caracteres").optional(),
  })
  .strict();

/**
 * Un caso de uso de una funcionalidad: algo que alguien puede hacer con el producto ("Votar al mejor jugador del
 * partido"), con las especificaciones que lo componen. El mismo caso en otro cerebro (el front y la API que lo atiende)
 * lleva el mismo `id`: así se ve de punta a punta. `problema` lo escribe una persona cuando lo que dedujo el modelo está
 * mal; el agente lo corrige y lo borra.
 */
export const CasoDeUsoSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id de caso de uso: minúsculas, números y guiones"),
    nombre: z.string().min(1).max(160, "nombre: máximo 160 caracteres"),
    /** Quién lo hace: "Jugador que participó del partido", "Administrador del club". */
    quien: z.string().min(1).max(160).optional(),
    /** ids de las especificaciones de esta página que lo componen. */
    especificaciones: z.array(z.string()).optional(),
    problema: z.string().min(1).max(1000).optional(),
  })
  .strict();

export const FrontmatterSchema = z
  .object({
    id: z.string(),
    tipo: z.union([z.enum(TIPOS_PAGINA), z.string().regex(TIPO_PROPIO, "tipo: uno conocido o uno propio en minúsculas (job, topic, componente…)").refine((t) => !(TIPOS_GENERADOS as readonly string[]).includes(t), "tipo: ese tipo lo genera FlowBrain, no se escribe en una página")]),
    nombre: z.string().min(1),
    resumen: z
      .string()
      .min(1)
      .max(140, "resumen: máximo 140 caracteres")
      .refine((s) => !s.includes("\n"), "resumen: una sola línea"),
    aliases: z.array(z.string().min(1)).optional(),
    estado: z.enum(ESTADOS).optional(),
    origen: z.enum(ORIGENES).optional(),
    actualizado: fecha.optional(),
    verificado: fecha.optional(),
    tecnologia: z.array(z.string().min(1)).optional(),
    vive_en: z.array(z.string()).optional(),
    pertenece_a: z.array(z.string()).optional(),
    puntos_de_entrada: z.record(z.string().regex(/^[a-z0-9_]+$/), z.string().min(1)).optional(),
    codigo: z.array(z.string()).optional(),
    relaciones: z.array(RelacionSchema).optional(),
    especificaciones: z.array(EspecificacionSchema).optional(),
    casos: z.array(CasoDeUsoSchema).optional(),
  })
  .strict();

export type CasoDeUso = z.infer<typeof CasoDeUsoSchema>;
export type Especificacion = z.infer<typeof EspecificacionSchema>;
export type Frontmatter = z.infer<typeof FrontmatterSchema>;
export type Relacion = z.infer<typeof RelacionSchema>;

// ---------- JSON de parsers ----------

export const ContratoSchema = z
  .object({
    svc: z.string(),
    fuente: z.string().min(1),
    endpoints: z.array(
      z
        .object({
          metodo: z.enum(METODOS_ENTRADA),
          ruta: z.string().min(1),
          request: z.string().nullable(),
          response: z.string().nullable(),
          /** Tipo de los parámetros de query; ausente si no se determinó. */
          query: z.string().optional(),
          /** CRON: cuándo corre, como lo dice el código (`0 3 * * *`, `cada 5000 ms`, `daily`). */
          horario: z.string().optional(),
          /** GRPC: dónde se declara el rpc en el `.proto` (`repo:ruta#Ln`). */
          proto: z.string().optional(),
          evidencia: z.string(),
        })
        .strict(),
    ),
    eventos: z.array(
      z
        .object({
          nombre: z.string().min(1),
          direccion: z.enum(["publica", "consume"]),
          cola: z.string().nullable(),
          payload: z.string().nullable(),
          evidencia: z.string(),
        })
        .strict(),
    ),
    tipos: z.record(z.string(), z.record(z.string(), z.string())),
  })
  .strict();

const RefSimboloSchema = z.object({ archivo: z.string().min(1), simbolo: z.string().min(1) }).strict();

export const ArchivosSchema = z
  .object({
    repo: z.string(),
    /** Commit de HEAD del clon indexado, si se pudo leer. */
    commit: z.string().optional(),
    /** Ruta del clon relativa al brain (para avisar si su HEAD avanzó desde que se indexó). */
    raiz: z.string().optional(),
    archivos: z.array(
      z
        .object({
          ruta: z.string().min(1),
          lenguaje: z.string().min(1),
          simbolos: z.array(
            z.object({ nombre: z.string(), tipo: z.string(), linea: z.number().int().positive(), fin: z.number().int().positive().optional() }).strict(),
          ),
          importa: z.array(z.string()).optional(),
          invoca: z
            .array(z.object({ desde: z.string(), archivo: z.string(), simbolo: z.string(), linea: z.number().int().positive(), via: z.string().optional() }).strict())
            .optional(),
          /** Tipos, interfaces, enums, clases y constantes del repo que nombra cada símbolo. */
          referencias: z.array(z.object({ desde: z.string(), archivo: z.string(), simbolo: z.string(), linea: z.number().int().positive() }).strict()).optional(),
          sinResolver: z.array(z.object({ desde: z.string(), linea: z.number().int().positive(), llamada: z.string(), candidatos: z.array(z.string()).optional(), motivo: z.string().optional() }).strict()).optional(),
          /** Casos de prueba, si es un archivo de test. */
          casos: z.array(z.object({ nombre: z.string().min(1), linea: z.number().int().positive(), grupo: z.string().optional() }).strict()).optional(),
          componentes: z.array(z.object({ nombre: z.string().min(1), linea: z.number().int().positive() }).strict()).optional(),
          usaPaquetes: z
            .array(z.object({ desde: z.string().nullable(), paquete: z.string().min(1), simbolo: z.string().min(1), linea: z.number().int().positive() }).strict())
            .optional(),
        })
        .strict(),
    ),
    pantallas: z
      .array(
        z
          .object({
            paquete: z.string(),
            ruta: z.string().startsWith("/"),
            archivo: z.string().min(1),
            linea: z.number().int().positive(),
            componente: RefSimboloSchema.nullable(),
            envuelta: z.array(RefSimboloSchema),
            pendiente: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    navegaciones: z
      .array(
        z
          .object({
            paquete: z.string(),
            archivo: z.string().min(1),
            linea: z.number().int().positive(),
            desde: z.string().nullable(),
            ruta: z.string().startsWith("/"),
            tipo: z.enum(["navega", "enlace", "redirige"]),
          })
          .strict(),
      )
      .optional(),
    /** Nombre con el que se publica cada paquete del repo, según su manifiesto. */
    paquetes: z
      .array(
        z
          .object({
            carpeta: z.string(),
            manifiesto: z.string().optional(),
            nombre: z.string().min(1).optional(),
            dependeDe: z.array(z.object({ nombre: z.string().min(1), linea: z.number().int().positive() }).strict()).optional(),
          })
          .strict(),
      )
      .optional(),
    /** Infraestructura declarada en el repo, por nodo dueño (servicio, base, cola, externo o el repo). */
    infra: z
      .array(
        z
          .object({
            de: z.string().min(1),
            clase: z.enum(["imagen", "servicio", "pipeline", "variables", "proxy", "kubernetes", "helm", "terraform", "funcion"]),
            nombre: z.string().min(1),
            detalle: z.array(z.string()),
            evidencia: z.string(),
            dependeDe: z.array(z.string()).optional(),
            /** Endpoints del dueño a los que llega una ruta de Ingress, un evento http o un `route_key`. */
            endpoints: z.array(z.string()).optional(),
            endpointsTotal: z.number().int().positive().optional(),
            /** Función del código que atiende una función serverless. */
            atiende: z.object({ simbolo: z.string().min(1), evidencia: z.string() }).strict().optional(),
          })
          .strict(),
      )
      .optional(),
    /** Esquema de las tablas con página: columnas y claves foráneas. */
    esquema: z
      .array(
        z
          .object({
            tabla: z.string().min(1),
            evidencia: z.string(),
            columnas: z.array(z.object({ nombre: z.string().min(1), tipo: z.string(), nulo: z.boolean(), pk: z.boolean() }).strict()),
            fks: z.array(z.object({ columnas: z.array(z.string()), hasta: z.string().min(1), columnasRef: z.array(z.string()), evidencia: z.string() }).strict()),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type Contrato = z.infer<typeof ContratoSchema>;
export type Archivos = z.infer<typeof ArchivosSchema>;

// ---------- graph.json ----------

export interface GraphNode {
  actualizado: string | null;
  aliases: string[];
  atributos: Record<string, unknown>;
  estado: Estado;
  id: string;
  nombre: string;
  origen: Origen;
  pagina: string | null;
  resumen: string | null;
  tecnologia: string[];
  tipo: Tipo;
  verificado: string | null;
}

export interface GraphEdge {
  confianza: number;
  dato: string | null;
  desde: string;
  endpoint: string | null;
  estado: Estado;
  evidencia: string | null;
  hasta: string;
  origen: Origen;
  verbo: Verbo;
}

export interface Graph {
  edges: GraphEdge[];
  nodes: GraphNode[];
  version: 1;
}

// ---------- Verificación (`flowbrain verify`) ----------

export const RUTA_VERIFICACION = "_build/verification.json";

export const DudosaSchema = z
  .object({
    desde: z.string(),
    endpoint: z.string().nullable(),
    evidencia: z.string(),
    hasta: z.string(),
    motivo: z.string(),
    verbo: z.string(),
  })
  .strict();
export const VerificacionSchema = z.object({ dudosas: z.array(DudosaSchema), version: z.literal(1) }).strict();
export type Dudosa = z.infer<typeof DudosaSchema>;
export type Verificacion = z.infer<typeof VerificacionSchema>;

/** Clave de una dudosa: la arista y la evidencia que falló (si la evidencia cambia, deja de ser la misma). */
export const claveDudosa = (d: Pick<Dudosa, "desde" | "verbo" | "hasta" | "endpoint" | "evidencia">) =>
  [d.desde, d.verbo, d.hasta, d.endpoint ?? "", d.evidencia].join("\u0000");


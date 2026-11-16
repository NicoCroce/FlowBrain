import { z } from "zod";

/** Constantes y validaciones de SCHEMA.md. Cualquier cambio acá tiene que reflejarse allá. */

export const TIPOS_PAGINA = ["repo", "svc", "lib", "db", "queue", "ext", "tabla", "feat", "team", "decision"] as const;
export const TIPOS_GENERADOS = ["contrato", "endpoint", "archivo"] as const;
export type TipoPagina = (typeof TIPOS_PAGINA)[number];
export type Tipo = TipoPagina | (typeof TIPOS_GENERADOS)[number];

export const CARPETA_POR_TIPO: Record<TipoPagina, "producto" | "tecnologia"> = {
  repo: "tecnologia",
  svc: "tecnologia",
  lib: "tecnologia",
  db: "tecnologia",
  queue: "tecnologia",
  ext: "tecnologia",
  tabla: "tecnologia",
  feat: "producto",
  team: "producto",
  decision: "producto",
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
const TODOS_PAGINA: readonly TipoPagina[] = TIPOS_PAGINA;
export const DOMINIO: Record<Verbo, ReadonlyArray<readonly [readonly Tipo[], readonly Tipo[]]>> = {
  llama_a: [[["svc", "lib", "ext"], ["svc", "ext"]]],
  publica_en: [[["svc"], ["queue"]]],
  consume_de: [[["svc"], ["queue"]]],
  lee_de: [[["svc"], ["db", "tabla"]]],
  escribe_en: [[["svc"], ["db", "tabla"]]],
  depende_de: [[["repo", "svc", "lib"], ["repo", "svc", "lib", "db", "queue", "ext"]]],
  implementa: [[["svc", "lib", "repo"], ["feat"]]],
  decidido_por: [[TODOS_PAGINA, ["decision"]]],
  vive_en: [
    [["svc", "lib"], ["repo"]],
    [["tabla"], ["db"]],
  ],
  pertenece_a: [[["repo", "svc", "lib", "db", "queue", "ext", "feat"], ["team"]]],
  expone: [[["svc"], ["contrato"]]],
  contiene: [
    [["repo"], ["archivo"]],
    [["svc"], ["endpoint"]],
  ],
};

export function verboAdmite(verbo: Verbo, desde: Tipo, hasta: Tipo): boolean {
  return DOMINIO[verbo].some(([ds, hs]) => ds.includes(desde) && hs.includes(hasta));
}

export const ID_PAGINA = /^[a-z]+-[a-z0-9]+(-[a-z0-9]+)*$/;
export const EVIDENCIA = /^(repo-[a-z0-9-]+):([^\s#:]+)(#L\d+(-L\d+)?)?$/;
export const ENDPOINT_REF = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/\S*)$/;
export const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

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

export const FrontmatterSchema = z
  .object({
    id: z.string(),
    tipo: z.enum(TIPOS_PAGINA),
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
    relaciones: z.array(RelacionSchema).optional(),
  })
  .strict();

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
          metodo: z.enum(METODOS),
          ruta: z.string().min(1),
          request: z.string().nullable(),
          response: z.string().nullable(),
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

export const ArchivosSchema = z
  .object({
    repo: z.string(),
    archivos: z.array(
      z
        .object({
          ruta: z.string().min(1),
          lenguaje: z.string().min(1),
          simbolos: z.array(
            z.object({ nombre: z.string(), tipo: z.string(), linea: z.number().int().positive() }).strict(),
          ),
        })
        .strict(),
    ),
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

// ---------- Verificación (`brain verify`) ----------

export const RUTA_VERIFICACION = "_build/verificacion.json";

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


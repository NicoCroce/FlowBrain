import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { cmp } from "./canonical.js";

/**
 * Registro de cerebros: un archivo `flowbrain.yaml` en una carpeta, con hasta `MAX_CEREBROS` cerebros. Cada cerebro
 * es un brain completo en su propia carpeta, con sus repos. Están aislados; `comunicacion` dice entre cuáles se
 * comparten pistas y relaciones, y `conexiones` declara qué servicio de uno llama a qué servicio de otro.
 */

export const ARCHIVO_REGISTRO = "flowbrain.yaml";
export const MAX_CEREBROS = 8;

const NOMBRE = /^[a-z0-9][a-z0-9-]*$/;
/** `cerebro/svc-id`. */
const REF_SERVICIO = /^([a-z0-9][a-z0-9-]*)\/([a-z]+-[a-z0-9-]+)$/;

const CerebroSchema = z
  .object({
    nombre: z.string().regex(NOMBRE, "solo minúsculas, números y guiones"),
    descripcion: z.string().optional(),
    /** Carpeta del brain, relativa al registro; por defecto, el nombre. */
    carpeta: z.string().min(1).optional(),
    /** `false`: las páginas se generan sin revisión humana y cada respuesta lo avisa. */
    curado: z.boolean().optional(),
    repos: z.array(z.object({ ruta: z.string().min(1), id: z.string().regex(/^repo-[a-z0-9-]+$/).optional() }).strict()),
  })
  .strict();

export const RegistroSchema = z
  .object({
    version: z.literal(1),
    cerebros: z.array(CerebroSchema).min(1).max(MAX_CEREBROS, `como máximo ${MAX_CEREBROS} cerebros`),
    comunicacion: z.array(z.object({ entre: z.tuple([z.string(), z.string()]), activa: z.boolean() }).strict()).optional(),
    conexiones: z
      .array(
        z
          .object({
            desde: z.string().regex(REF_SERVICIO, "se espera cerebro/svc-id"),
            hacia: z.string().regex(REF_SERVICIO, "se espera cerebro/svc-id"),
            /** Cómo se distingue este destino en el código que llama: una variable de la URL base o un host. */
            por: z.string().min(1).optional(),
            /** Quién lo decidió: una persona (por defecto) o un modelo que analizó el código. */
            origen: z.enum(["persona", "modelo"]).optional(),
            /** En qué se apoya: archivos con su línea (`repo:ruta#Ln`) o una frase. */
            evidencia: z.array(z.string().min(1)).optional(),
            nota: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
    /**
     * Llamadas que un servicio se hace a sí mismo (una URL relativa a su propio servidor: traducciones, configuración,
     * un archivo estático): no van a ningún otro cerebro. Sin `por`, todas las de URL relativa; con `por`, las que lo
     * llevan en la base de la URL o al principio de la ruta.
     */
    internas: z
      .array(
        z
          .object({
            de: z.string().regex(REF_SERVICIO, "se espera cerebro/svc-id"),
            por: z.string().min(1).optional(),
            origen: z.enum(["persona", "modelo"]).optional(),
            evidencia: z.array(z.string().min(1)).optional(),
            nota: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
    /** Preguntas abiertas que dejó `cerebros proponer`; informativas. */
    preguntas: z.array(z.string()).optional(),
    /** Lo que detectó `cerebros proponer`; informativo. */
    detectado: z.unknown().optional(),
  })
  .strict();

export type RegistroCrudo = z.infer<typeof RegistroSchema>;

export interface Cerebro {
  nombre: string;
  descripcion: string | null;
  /** Carpeta absoluta del brain. */
  raiz: string;
  curado: boolean;
  /** Repos con ruta absoluta. */
  repos: Array<{ ruta: string; id: string | null }>;
}

export interface Conexion {
  desde: { cerebro: string; svc: string };
  hacia: { cerebro: string; svc: string };
  por: string | null;
  origen: "persona" | "modelo";
  evidencia: string[];
  nota: string | null;
}

/** Llamadas de un servicio a su propio servidor: no cruzan a ningún cerebro. */
export interface Interna {
  de: { cerebro: string; svc: string };
  /** Qué las distingue (en la base de la URL o al principio de la ruta); `null`: todas las de URL relativa. */
  por: string | null;
}

export interface Registro {
  /** Carpeta donde está `flowbrain.yaml`. */
  carpeta: string;
  cerebros: Cerebro[];
  conexiones: Conexion[];
  internas: Interna[];
  /** ¿Está activa la comunicación entre estos dos cerebros? */
  comunicados(a: string, b: string): boolean;
  /** Cerebros comunicados con uno dado, en orden. */
  vecinos(nombre: string): Cerebro[];
  cerebro(nombre: string): Cerebro | null;
  /** Cerebro que contiene un directorio: el de algún repo suyo o su propia carpeta. */
  deDirectorio(dir: string): Cerebro | null;
}

export class RegistroError extends Error {}

const dentro = (dir: string, base: string) => dir === base || dir.startsWith(base.endsWith(sep) ? base : base + sep);

export function interpretarRegistro(texto: string, carpeta: string): Registro {
  let crudo: unknown;
  try {
    crudo = parse(texto);
  } catch (e) {
    throw new RegistroError(`${ARCHIVO_REGISTRO}: YAML inválido: ${(e as Error).message}`);
  }
  const r = RegistroSchema.safeParse(crudo);
  if (!r.success) throw new RegistroError(`${ARCHIVO_REGISTRO}: ${r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`);
  const base = resolve(carpeta);
  const abs = (p: string) => (isAbsolute(p) ? resolve(p) : resolve(base, p));
  const cerebros: Cerebro[] = r.data.cerebros.map((c) => ({
    nombre: c.nombre,
    descripcion: c.descripcion ?? null,
    raiz: abs(c.carpeta ?? c.nombre),
    curado: c.curado ?? true,
    repos: c.repos.map((x) => ({ ruta: abs(x.ruta), id: x.id ?? null })),
  }));
  const nombres = new Set<string>();
  for (const c of cerebros) {
    if (nombres.has(c.nombre)) throw new RegistroError(`${ARCHIVO_REGISTRO}: cerebro repetido: ${c.nombre}`);
    nombres.add(c.nombre);
  }
  const pares = new Map<string, boolean>();
  const clave = (a: string, b: string) => [a, b].sort(cmp).join("\u0000");
  for (const c of r.data.comunicacion ?? []) {
    for (const n of c.entre) if (!nombres.has(n)) throw new RegistroError(`${ARCHIVO_REGISTRO}: comunicacion nombra un cerebro inexistente: ${n}`);
    if (c.entre[0] === c.entre[1]) throw new RegistroError(`${ARCHIVO_REGISTRO}: comunicacion de ${c.entre[0]} consigo mismo`);
    pares.set(clave(c.entre[0], c.entre[1]), c.activa);
  }
  const ref = (s: string) => {
    const m = REF_SERVICIO.exec(s)!;
    if (!nombres.has(m[1]!)) throw new RegistroError(`${ARCHIVO_REGISTRO}: conexiones nombra un cerebro inexistente: ${m[1]}`);
    return { cerebro: m[1]!, svc: m[2]! };
  };
  const conexiones = (r.data.conexiones ?? []).map((c) => ({ desde: ref(c.desde), hacia: ref(c.hacia), por: c.por ?? null, origen: c.origen ?? ("persona" as const), evidencia: c.evidencia ?? [], nota: c.nota ?? null }));
  const internas = (r.data.internas ?? []).map((i) => ({ de: ref(i.de), por: i.por ?? null }));
  const comunicados = (a: string, b: string) => a !== b && pares.get(clave(a, b)) === true;
  return {
    carpeta: base,
    cerebros,
    conexiones,
    internas,
    comunicados,
    vecinos: (n) => cerebros.filter((c) => comunicados(n, c.nombre)),
    cerebro: (n) => cerebros.find((c) => c.nombre === n) ?? null,
    deDirectorio: (dir) => {
      const d = resolve(dir);
      // El repo más específico gana (un repo dentro de otro).
      const hits = cerebros.flatMap((c) => [...c.repos.map((x) => x.ruta), c.raiz].filter((p) => dentro(d, p)).map((p) => ({ c, largo: p.length })));
      return hits.sort((x, y) => y.largo - x.largo)[0]?.c ?? null;
    },
  };
}

/** ¿Esta carpeta es un registro de cerebros? */
export const esRegistro = (carpeta: string) => stat(join(carpeta, ARCHIVO_REGISTRO)).then((s) => s.isFile(), () => false);

export async function leerRegistro(carpeta: string): Promise<Registro> {
  return interpretarRegistro(await readFile(join(carpeta, ARCHIVO_REGISTRO), "utf8"), carpeta);
}

/** Carpeta que `flowbrain iniciar` crea dentro de un proyecto: ahí viven el registro y los cerebros. */
export const CARPETA_PROYECTO = ".flowbrain";

/** El registro del proyecto donde se está parado: `<carpeta>/.flowbrain` con su `flowbrain.yaml`, en `desde` o en cualquier carpeta por encima. */
export async function buscarRegistro(desde: string): Promise<string | null> {
  for (let d = resolve(desde); ; d = dirname(d)) {
    const c = join(d, CARPETA_PROYECTO);
    if (await esRegistro(c)) return c;
    if (dirname(d) === d) return null;
  }
}

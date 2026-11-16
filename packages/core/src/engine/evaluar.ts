import { cmp } from "../canonical.js";
import { funcionalidad, impactoDe, pantalla, quienLlama, recorrido } from "./codigo.js";
import type { Contexto } from "./contexto.js";
import { buscarNodo, ConsultaError, contratoDe, recorrerGrafo, trazar } from "./herramientas.js";

/**
 * Evaluación de las consultas contra preguntas con respuesta conocida: mide si el brain responde bien, y si una
 * mejora suma o rompe algo. Las respuestas esperadas se escriben a mano mirando el código, no copiando lo que
 * devuelve la herramienta. Cada pregunta dice qué textos tienen que aparecer en la respuesta (`espera`) y cuáles no
 * (`noEspera`): un nombre de método, una tabla, una línea. Es agnóstico al lenguaje y al repo.
 */

export interface Pregunta {
  id: string;
  /** La pregunta en lenguaje natural, para leer el reporte. */
  pregunta: string;
  herramienta: string;
  args: Record<string, unknown>;
  espera?: string[];
  noEspera?: string[];
  /** La respuesta correcta es un error (p. ej. algo que no existe). */
  error?: boolean;
}

export interface ResultadoPregunta {
  id: string;
  pregunta: string;
  herramienta: string;
  ok: boolean;
  faltan: string[];
  sobran: string[];
  error?: string;
}

export interface Evaluacion {
  total: number;
  aciertos: number;
  porcentaje: number;
  porHerramienta: Record<string, { total: number; aciertos: number }>;
  /** Fracción de los textos esperados que aparecieron (crédito parcial). */
  cobertura: number;
  falladas: ResultadoPregunta[];
}

const HERRAMIENTAS: Record<string, (ctx: Contexto, a: never) => unknown> = {
  buscar_nodo: buscarNodo,
  recorrer_grafo: recorrerGrafo,
  contrato_de: contratoDe,
  trazar,
  funcionalidad,
  recorrido,
  pantalla,
  quien_llama: quienLlama,
  impacto: impactoDe,
};

export function leerPreguntas(texto: string): Pregunta[] {
  const j = JSON.parse(texto) as { preguntas?: unknown } | unknown[];
  const lista = Array.isArray(j) ? j : (j as { preguntas?: unknown }).preguntas;
  if (!Array.isArray(lista)) throw new ConsultaError("parametro_invalido", "el archivo de preguntas debe ser una lista o { preguntas: [...] }");
  const ids = new Set<string>();
  return lista.map((p, i) => {
    const q = p as Partial<Pregunta>;
    if (typeof q.id !== "string" || typeof q.herramienta !== "string" || typeof q.args !== "object" || q.args === null) {
      throw new ConsultaError("parametro_invalido", `pregunta ${i + 1}: requiere id, herramienta y args`);
    }
    if (!(q.herramienta in HERRAMIENTAS)) throw new ConsultaError("parametro_invalido", `pregunta ${q.id}: herramienta desconocida ${q.herramienta}`);
    if (ids.has(q.id)) throw new ConsultaError("parametro_invalido", `pregunta repetida: ${q.id}`);
    ids.add(q.id);
    return { pregunta: q.id, espera: [], noEspera: [], ...q } as Pregunta;
  });
}

export function evaluar(ctx: Contexto, preguntas: Pregunta[]): Evaluacion {
  const resultados: ResultadoPregunta[] = [];
  let esperados = 0, encontrados = 0;
  for (const p of preguntas) {
    const espera = p.espera ?? [], noEspera = p.noEspera ?? [];
    let texto = "", error: string | undefined;
    try {
      // Sin presupuesto: se evalúa lo que la herramienta sabe, no cuánto entra.
      texto = JSON.stringify(HERRAMIENTAS[p.herramienta]!(ctx, { budget_tokens: null, ...p.args } as never));
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      error = e.message;
    }
    const faltan = error ? espera : espera.filter((s) => !texto.includes(JSON.stringify(s).slice(1, -1)));
    const sobran = noEspera.filter((s) => texto.includes(JSON.stringify(s).slice(1, -1)));
    esperados += espera.length;
    encontrados += espera.length - faltan.length;
    const ok = p.error ? error !== undefined : error === undefined && !faltan.length && !sobran.length;
    resultados.push({ id: p.id, pregunta: p.pregunta, herramienta: p.herramienta, ok, faltan, sobran, ...(error && !p.error ? { error } : {}) });
  }
  const porHerramienta: Record<string, { total: number; aciertos: number }> = {};
  for (const r of resultados) {
    const h = (porHerramienta[r.herramienta] ??= { total: 0, aciertos: 0 });
    h.total++;
    if (r.ok) h.aciertos++;
  }
  const aciertos = resultados.filter((r) => r.ok).length;
  return {
    total: resultados.length,
    aciertos,
    porcentaje: resultados.length ? Math.round((aciertos / resultados.length) * 1000) / 10 : 0,
    porHerramienta: Object.fromEntries(Object.entries(porHerramienta).sort((a, b) => cmp(a[0], b[0]))),
    cobertura: esperados ? Math.round((encontrados / esperados) * 1000) / 10 : 100,
    falladas: resultados.filter((r) => !r.ok),
  };
}

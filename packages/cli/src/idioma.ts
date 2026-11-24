import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buscarRegistro, leerRegistro } from "@flowbrain/core";

/**
 * Idioma de la CLI y el menú (dec. 214): inglés por defecto, castellano como segunda opción.
 *
 * Cada texto visible va en par, inglés primero: `L(\`brain ready at ${r}\`, \`brain listo en ${r}\`)`. El idioma se
 * decide una vez por comando (`resolverIdioma`), en este orden:
 *   1. `--lang en|es`
 *   2. `FLOWBRAIN_LANG=en|es`
 *   3. la preferencia de la persona, que guarda el menú (`~/.config/flowbrain/config.json`, `{"lang": "es"}`)
 *   4. `lang: en|es` en el `flowbrain.yaml` del proyecto
 *   5. inglés
 *
 * Los archivos que FlowBrain escribe en disco (README del brain, guías `/flowbrain-*`, reglas para el agente) van
 * siempre en inglés: los lee el modelo y los comparte el equipo.
 */

export type Idioma = "en" | "es";

let actual: Idioma = "en";

export const idioma = (): Idioma => actual;
export const fijarIdioma = (i: Idioma) => {
  actual = i;
};
/** El texto en el idioma actual: inglés primero. */
export const L = (en: string, es: string): string => (actual === "es" ? es : en);
export const esIdioma = (v: unknown): v is Idioma => v === "en" || v === "es";

/** Archivo de preferencias de la persona. Sin `HOME` (los tests que pasan su propio entorno) no hay preferencias. */
export const archivoPreferencias = (env: NodeJS.ProcessEnv): string | null =>
  env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, "flowbrain/config.json") : env.HOME ? join(env.HOME, ".config/flowbrain/config.json") : null;

async function leerPreferencias(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const archivo = archivoPreferencias(env);
  if (!archivo) return {};
  try {
    const x = JSON.parse(await readFile(archivo, "utf8")) as unknown;
    return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Guarda el idioma elegido en el menú. Devuelve el archivo, o `null` si no hay dónde guardarlo. */
export async function guardarIdioma(env: NodeJS.ProcessEnv, i: Idioma): Promise<string | null> {
  const archivo = archivoPreferencias(env);
  if (!archivo) return null;
  const prefs = await leerPreferencias(env);
  await mkdir(dirname(archivo), { recursive: true });
  await writeFile(archivo, JSON.stringify({ ...prefs, lang: i }, null, 2) + "\n", "utf8");
  return archivo;
}

/** Decide el idioma (ver arriba), lo fija y lo devuelve. Un valor inválido en `--lang` o `FLOWBRAIN_LANG` se ignora. */
export async function resolverIdioma(opciones: { flag?: string; env: NodeJS.ProcessEnv; cwd: string }): Promise<Idioma> {
  const { flag, env, cwd } = opciones;
  let i: Idioma | null = esIdioma(flag) ? flag : esIdioma(env.FLOWBRAIN_LANG) ? env.FLOWBRAIN_LANG : null;
  if (!i) {
    const pref = (await leerPreferencias(env)).lang;
    if (esIdioma(pref)) i = pref;
  }
  if (!i) {
    try {
      const reg = env.FLOWBRAIN_ROOT ?? (await buscarRegistro(cwd));
      if (reg) i = (await leerRegistro(reg)).lang;
    } catch {
      /* sin registro legible: inglés */
    }
  }
  fijarIdioma(i ?? "en");
  return actual;
}

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { cmp } from "@flowbrain/core";
import type { RepoFuente } from "./tipos.js";

/** Carpetas que nunca son código del proyecto: dependencias, salidas de build, cachés. La usan el indexador y la detección de repos. */
export const IGNORAR = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit", ".dart_tool", ".gradle", "target", "bin", "obj", "Pods", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", "out", "coverage", "vendor", ".turbo", ".cache", "var", "tmp", ".flowbrain"]);

/** Manifiestos de JavaScript y PHP: marcan una app aunque no tenga código reconocido (lo que siempre se hizo). */
const MANIFIESTO_JS_PHP = /(^|\/)(package|composer)\.json$/;
/**
 * Manifiestos de cualquier otro ecosistema: marcan una app candidata, que queda como servicio solo si el índice le
 * encuentra algo (endpoints, llamadas, pantallas, tablas o eventos). Así un `requirements.txt` de unos scripts no
 * inventa un servicio.
 */
export const MANIFIESTO_OTRO = /(^|\/)(go\.mod|pyproject\.toml|requirements\.txt|setup\.py|Pipfile|pom\.xml|build\.gradle(\.kts)?|Gemfile|[^/]+\.csproj|pubspec\.yaml|Package\.swift|Cargo\.toml|mix\.exs)$/;

/** Lista el repo de forma determinística (orden por code units, sin depender del filesystem). */
export function leerRepo(raiz: string): RepoFuente {
  const abs = resolve(raiz);
  const archivos: string[] = [];
  const recorrer = (rel: string) => {
    const nombres = readdirSync(join(abs, rel)).sort(cmp);
    for (const n of nombres) {
      // Nombres con espacios, `#` o `:` no se pueden citar como evidencia (repo:ruta#Ln): se omiten.
      if (IGNORAR.has(n) || /[\s#:]/.test(n)) continue;
      const r = rel ? `${rel}/${n}` : n;
      const st = statSync(join(abs, r));
      // Un repo dentro del repo (un clon, un submódulo) es otro repo: se indexa aparte, no dos veces.
      if (st.isDirectory() && existsSync(join(abs, r, ".git"))) continue;
      if (st.isDirectory()) recorrer(r);
      else if (st.isFile()) archivos.push(r);
    }
  };
  recorrer("");
  archivos.sort(cmp);

  const carpeta = (a: string) => (a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : "");
  const conManifiesto = archivos.filter((a) => MANIFIESTO_JS_PHP.test(a)).map(carpeta);
  const candidatos = [...new Set(archivos.filter((a) => MANIFIESTO_OTRO.test(a)).map(carpeta))].filter((c) => !conManifiesto.includes(c)).sort(cmp);
  const raizEsWorkspace =
    archivos.includes("pnpm-workspace.yaml") ||
    archivos.includes("lerna.json") ||
    (archivos.includes("package.json") && /"workspaces"\s*:/.test(readFileSync(join(abs, "package.json"), "utf8")));
  let paquetes = [...new Set(conManifiesto)].sort(cmp);
  if (raizEsWorkspace && paquetes.some((p) => p !== "")) paquetes = paquetes.filter((p) => p !== "");
  if (candidatos.length) paquetes = [...new Set([...paquetes, ...candidatos])].sort(cmp);
  if (paquetes.length === 0) paquetes = [""];
  return { raiz: abs, archivos, paquetes, ...(candidatos.length ? { candidatos } : {}) };
}

/**
 * Deja como paquetes los que importan: los de JavaScript y PHP siempre; los candidatos de otros ecosistemas y la raíz
 * del repo, solo si el índice les encontró algo. Así un back en Go en la raíz de un repo que también tiene `web/` con
 * su `package.json` no se pierde, y una carpeta de scripts no se vuelve un servicio.
 */
export function podarPaquetes(repo: RepoFuente, conDatos: Set<string>): RepoFuente {
  const candidatos = new Set(repo.candidatos ?? []);
  let paquetes = repo.paquetes.filter((p) => !candidatos.has(p) || conDatos.has(p));
  if (conDatos.has("") && !paquetes.includes("")) paquetes = ["", ...paquetes];
  if (!paquetes.length) paquetes = [""];
  return { ...repo, paquetes };
}

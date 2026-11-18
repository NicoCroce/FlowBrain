import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { cmp } from "@flowbrain/core";
import type { RepoFuente } from "./tipos.js";

const IGNORAR = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", "vendor", ".turbo", ".cache", "var", "tmp", ".flowbrain"]);

/** Lista el repo de forma determinística (orden por code units, sin depender del filesystem). */
export function leerRepo(raiz: string): RepoFuente {
  const abs = resolve(raiz);
  const archivos: string[] = [];
  const recorrer = (rel: string) => {
    const nombres = readdirSync(join(abs, rel)).sort(cmp);
    for (const n of nombres) {
      // Nombres con `#`, `:` o saltos de línea no se pueden citar como evidencia (repo:ruta#Ln): se omiten. Los espacios
      // sí (`Pantalla copy.jsx`): la evidencia se parte por el primer `:` y el último `#`.
      if (IGNORAR.has(n) || /[#:\n\r\t]/.test(n)) continue;
      const r = rel ? `${rel}/${n}` : n;
      const st = statSync(join(abs, r));
      if (st.isDirectory()) recorrer(r);
      else if (st.isFile()) archivos.push(r);
    }
  };
  recorrer("");
  archivos.sort(cmp);

  const conManifiesto = archivos
    .filter((a) => a === "package.json" || a.endsWith("/package.json") || a === "composer.json" || a.endsWith("/composer.json"))
    .map((a) => (a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : ""));
  const raizEsWorkspace =
    archivos.includes("pnpm-workspace.yaml") ||
    archivos.includes("lerna.json") ||
    (archivos.includes("package.json") && /"workspaces"\s*:/.test(readFileSync(join(abs, "package.json"), "utf8")));
  let paquetes = [...new Set(conManifiesto)].sort(cmp);
  if (raizEsWorkspace && paquetes.some((p) => p !== "")) paquetes = paquetes.filter((p) => p !== "");
  if (paquetes.length === 0) paquetes = [""];
  return { raiz: abs, archivos, paquetes };
}

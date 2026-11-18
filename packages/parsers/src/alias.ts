import { join, posix } from "node:path";
import ts from "typescript";
import { cmp } from "@flowbrain/core";
import type { RepoFuente } from "./tipos.js";

/**
 * Librerías internas por alias: un sistema de diseño que vive en una carpeta del mismo repo y se importa con un alias
 * exacto del tsconfig (`"@ds": ["./design-system/src"]`), sin `package.json` propio. El alias es su nombre: se
 * importa igual que un paquete publicado y cumple el mismo papel. Solo cuenta un alias sin `*` que apunta a una
 * carpeta con `index` (su punto de entrada) o a ese `index`; uno que apunta a la raíz o a `src` del paquete es un
 * atajo a toda la app, no una librería.
 */
export interface LibreriaPorAlias {
  /** Carpeta de la librería en el repo. */
  carpeta: string;
  /** El alias, que es el nombre con el que se importa. */
  nombre: string;
  /** tsconfig que declara el alias. */
  manifiesto: string;
}

const INDEX = /(^|\/)index\.(ts|tsx|js|jsx|mts|mjs)$/;

export function libreriasPorAlias(repo: RepoFuente): LibreriaPorAlias[] {
  const archivos = new Set(repo.archivos);
  const out = new Map<string, LibreriaPorAlias>();
  for (const paquete of [...new Set(["", ...repo.paquetes])].sort(cmp)) {
    const tsconfigs = repo.archivos.filter((a) => (a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : "") === paquete && /(^|\/)[tj]sconfig[^/]*\.json$/.test(a)).sort(cmp);
    for (const t of tsconfigs) {
      const abs = join(repo.raiz, t);
      const leido = ts.readConfigFile(abs, ts.sys.readFile);
      if (leido.error) continue;
      const o = ts.parseJsonConfigFileContent(leido.config, ts.sys, join(abs, ".."), undefined, abs).options;
      if (!o.paths) continue;
      const base = o.baseUrl ?? (o["pathsBasePath"] as string | undefined) ?? join(abs, "..");
      for (const [nombre, destinos] of Object.entries(o.paths)) {
        const destino = destinos[0];
        if (nombre.includes("*") || !destino || destino.includes("*")) continue;
        const absDestino = join(base, destino);
        if (!absDestino.startsWith(repo.raiz + "/")) continue;
        let carpeta = posix.normalize(absDestino.slice(repo.raiz.length + 1)).replace(/\/$/, "");
        if (INDEX.test(carpeta)) carpeta = carpeta.includes("/") ? carpeta.slice(0, carpeta.lastIndexOf("/")) : "";
        else if (![...archivos].some((a) => a.startsWith(`${carpeta}/`) && INDEX.test(a.slice(carpeta.length + 1)) && !a.slice(carpeta.length + 1).includes("/"))) continue;
        if (!carpeta || carpeta === paquete || carpeta === (paquete ? `${paquete}/src` : "src")) continue;
        if (!out.has(carpeta)) out.set(carpeta, { carpeta, nombre, manifiesto: t });
      }
    }
  }
  return [...out.values()].sort((a, b) => cmp(a.carpeta, b.carpeta));
}

/** La librería por alias más específica que contiene un archivo. */
export function libreriaPorAliasDe(libs: LibreriaPorAlias[], archivo: string): LibreriaPorAlias | null {
  let mejor: LibreriaPorAlias | null = null;
  for (const l of libs) if (archivo.startsWith(`${l.carpeta}/`) && (!mejor || l.carpeta.length > mejor.carpeta.length)) mejor = l;
  return mejor;
}

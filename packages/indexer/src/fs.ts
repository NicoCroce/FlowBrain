import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { cmp, leerEntradas } from "@brain/core";
import { indexar } from "@brain/parsers";
import { generarBorradores, type Borradores } from "./borrador.js";

/**
 * `brain draft <repo>`: corre los parsers y escribe borradores en `_drafts/<repo>/`. No toca `_build/`,
 * `tecnologia/` ni `producto/`. Solo escribe archivos cuyo contenido cambió.
 */
export async function draftDir(rutaRepo: string, raizBrain: string, opciones: { repo?: string } = {}): Promise<Borradores & { repo: string; escritos: string[] }> {
  const r = await indexar(rutaRepo, raizBrain, { ...opciones, permitirRepoNuevo: true });
  const { paginas } = await leerEntradas(raizBrain);
  const b = generarBorradores(r, paginas, basename(resolve(rutaRepo)));
  const escritos: string[] = [];
  for (const ruta of Object.keys(b.archivos).sort(cmp)) {
    const destino = join(raizBrain, ruta);
    const previo = await readFile(destino, "utf8").catch(() => null);
    if (previo === b.archivos[ruta]) continue;
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, b.archivos[ruta]!, "utf8");
    escritos.push(ruta);
  }
  return { ...b, repo: r.repo, escritos };
}

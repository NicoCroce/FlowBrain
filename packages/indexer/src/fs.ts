import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { cmp, leerEntradas } from "@flowbrain/core";
import { indexar } from "@flowbrain/parsers";
import { generarBorradores, type Borradores } from "./borrador.js";

/**
 * `flowbrain draft <repo>`: corre los parsers y escribe borradores en `_drafts/<repo>/`. No toca `_build/`,
 * `technology/` ni `product/`. Solo escribe archivos cuyo contenido cambió.
 */
export async function draftDir(rutaRepo: string, raizBrain: string, opciones: { repo?: string } = {}): Promise<Borradores & { repo: string; escritos: string[] }> {
  const r = await indexar(rutaRepo, raizBrain, { ...opciones, permitirRepoNuevo: true });
  const { paginas } = await leerEntradas(raizBrain);
  const dirProducto = join(raizBrain, "_drafts/product");
  const nombres = (await readdir(dirProducto).catch(() => [] as string[])).filter((n) => n.endsWith(".md")).sort(cmp);
  const borradoresProducto = await Promise.all(nombres.map(async (n) => ({ ruta: `_drafts/product/${n}`, contenido: await readFile(join(dirProducto, n), "utf8") })));
  const b = generarBorradores(r, paginas, basename(resolve(rutaRepo)), borradoresProducto);
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

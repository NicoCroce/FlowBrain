import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cmp } from "./canonical.js";
import { compile, type Entradas, type Fuente, type Salidas } from "./compile.js";
import { RUTA_VERIFICACION } from "./schema.js";

async function listar(raiz: string, dir: string, ext: string): Promise<Fuente[]> {
  let nombres: string[];
  try {
    nombres = await readdir(join(raiz, dir));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: Fuente[] = [];
  for (const n of nombres.filter((x) => x.endsWith(ext)).sort(cmp)) {
    const ruta = `${dir}/${n}`;
    out.push({ ruta, contenido: await readFile(join(raiz, ruta), "utf8") });
  }
  return out;
}

export async function leerEntradas(raiz: string): Promise<Entradas> {
  return {
    paginas: [...(await listar(raiz, "product", ".md")), ...(await listar(raiz, "technology", ".md"))],
    contratos: await listar(raiz, "_build/contracts", ".json"),
    archivos: await listar(raiz, "_build/files", ".json"),
    extracciones: await listar(raiz, "_build/extraction", ".json"),
    verificacion: await readFile(join(raiz, RUTA_VERIFICACION), "utf8").then(
      (contenido) => ({ ruta: RUTA_VERIFICACION, contenido }),
      () => null,
    ),
  };
}

/** Escribe salidas y páginas; solo toca archivos cuyo contenido cambió. Devuelve las rutas escritas. */
export async function escribirSalidas(raiz: string, s: Salidas): Promise<string[]> {
  const escritos: string[] = [];
  const todo = { ...s.generados, ...s.paginas };
  for (const ruta of Object.keys(todo).sort(cmp)) {
    const destino = join(raiz, ruta);
    const nuevo = todo[ruta]!;
    let previo: string | null = null;
    try {
      previo = await readFile(destino, "utf8");
    } catch {
      previo = null;
    }
    if (previo === nuevo) continue;
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, nuevo, "utf8");
    escritos.push(ruta);
  }
  return escritos;
}

/**
 * `flowbrain compile`: lee, compila y escribe. `extra` agrega salidas derivadas que no son del núcleo (el visor, que
 * vive en su propio paquete).
 */
export async function compileDir(raiz: string, extra?: (s: Salidas) => Promise<Record<string, string>> | Record<string, string>): Promise<{ salidas: Salidas; escritos: string[] }> {
  const salidas = compile(await leerEntradas(raiz));
  if (extra) Object.assign(salidas.generados, await extra(salidas));
  return { salidas, escritos: await escribirSalidas(raiz, salidas) };
}

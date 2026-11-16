import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cmp } from "./canonical.js";
import { compile, type Entradas, type Fuente, type Salidas } from "./compile.js";

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
    paginas: [...(await listar(raiz, "producto", ".md")), ...(await listar(raiz, "tecnologia", ".md"))],
    contratos: await listar(raiz, "_build/contratos", ".json"),
    archivos: await listar(raiz, "_build/archivos", ".json"),
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

/** `brain compile`: lee, compila y escribe. */
export async function compileDir(raiz: string): Promise<{ salidas: Salidas; escritos: string[] }> {
  const salidas = compile(await leerEntradas(raiz));
  return { salidas, escritos: await escribirSalidas(raiz, salidas) };
}

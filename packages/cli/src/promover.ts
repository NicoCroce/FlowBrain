import { compileDirConVisor } from "@brain/viewer";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cmp, CompileError, formatError } from "@brain/core";

/**
 * `brain promover`: pasa borradores revisados de `_drafts/` a `tecnologia/` y `producto/`. Sin `--escribir` solo
 * lista. Nunca pisa una página existente distinta (salvo `--pisar`), y si el brain deja de compilar con las páginas
 * nuevas, deshace todo y devuelve los errores: un borrador a medio completar no rompe el brain.
 */

export interface Candidato {
  id: string;
  origen: string;
  destino: string;
  /** `nuevo`: no hay página; `igual`: ya está promovido; `distinto`: hay una página con otro contenido. */
  estado: "nuevo" | "igual" | "distinto";
}

export interface ResultadoPromover {
  candidatos: Candidato[];
  movidos: Candidato[];
  /** Con `--escribir`: borradores que quedaron sin mover y por qué. */
  salteados: Array<Candidato & { motivo: string }>;
  errores: string[];
}

const leer = (p: string) => readFile(p, "utf8").catch(() => null);

export async function borradoresPromovibles(raiz: string): Promise<Candidato[]> {
  const out: Candidato[] = [];
  const agregar = async (rel: string, carpeta: "tecnologia" | "producto") => {
    for (const n of (await readdir(join(raiz, rel)).catch(() => [] as string[])).filter((x) => x.endsWith(".md") && x !== "PROMPT.md").sort(cmp)) {
      const origen = `${rel}/${n}`, destino = `${carpeta}/${n}`;
      const [a, b] = [await leer(join(raiz, origen)), await leer(join(raiz, destino))];
      if (a !== null) out.push({ id: n.slice(0, -3), origen, destino, estado: b === null ? "nuevo" : a === b ? "igual" : "distinto" });
    }
  };
  await agregar("_drafts/producto", "producto");
  for (const d of (await readdir(join(raiz, "_drafts"), { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith("_") && e.name !== "producto" && e.name !== "notas").map((e) => e.name).sort(cmp)) {
    await agregar(`_drafts/${d}/tecnologia`, "tecnologia");
    await agregar(`_drafts/${d}/producto`, "producto");
  }
  return out.sort((a, b) => cmp(a.destino, b.destino) || cmp(a.origen, b.origen));
}

export async function promover(raiz: string, opciones: { ids?: string[]; todos?: boolean; escribir?: boolean; pisar?: boolean } = {}): Promise<ResultadoPromover> {
  const candidatos = await borradoresPromovibles(raiz);
  const ids = new Set(opciones.ids ?? []);
  const elegidos = opciones.todos ? candidatos : candidatos.filter((c) => ids.has(c.id) || ids.has(c.origen));
  const faltan = [...ids].filter((i) => !candidatos.some((c) => c.id === i || c.origen === i));
  const res: ResultadoPromover = { candidatos, movidos: [], salteados: [], errores: faltan.map((i) => `no hay un borrador con ese id: ${i}`) };
  if (!opciones.escribir || faltan.length) return res;

  const respaldo = new Map<string, string | null>();
  const destinos = new Set<string>();
  for (const c of elegidos) {
    if (c.estado === "distinto" && !opciones.pisar) { res.salteados.push({ ...c, motivo: "ya existe una página distinta (revisala o usá --pisar)" }); continue; }
    if (destinos.has(c.destino)) { res.salteados.push({ ...c, motivo: "otro borrador va al mismo destino" }); continue; }
    destinos.add(c.destino);
    const contenido = (await leer(join(raiz, c.origen)))!;
    respaldo.set(c.origen, contenido);
    respaldo.set(c.destino, await leer(join(raiz, c.destino)));
    await mkdir(dirname(join(raiz, c.destino)), { recursive: true });
    await writeFile(join(raiz, c.destino), contenido, "utf8");
    await rm(join(raiz, c.origen));
    res.movidos.push(c);
  }
  if (!res.movidos.length) return res;
  try {
    await compileDirConVisor(raiz);
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    for (const [ruta, contenido] of respaldo) {
      if (contenido === null) await rm(join(raiz, ruta), { force: true });
      else await writeFile(join(raiz, ruta), contenido, "utf8");
    }
    res.errores.push(...e.errores.map(formatError));
    res.movidos = [];
  }
  return res;
}

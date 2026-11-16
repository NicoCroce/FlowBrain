import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Commit de HEAD leyendo `.git` (sin ejecutar git): así las consultas pueden decir de qué versión del código salió el
 * índice. `null` si no es un repo git o no se puede resolver.
 */
export async function commitDe(raiz: string): Promise<string | null> {
  const leer = (p: string) => readFile(p, "utf8").then((t) => t.trim(), () => null);
  let git = join(raiz, ".git");
  const archivoGit = await leer(git);
  if (archivoGit?.startsWith("gitdir:")) git = resolve(raiz, archivoGit.slice(7).trim());
  const head = await leer(join(git, "HEAD"));
  if (!head) return null;
  if (/^[0-9a-f]{40}$/.test(head)) return head;
  const ref = /^ref: (.+)$/.exec(head)?.[1];
  if (!ref) return null;
  // En un worktree, las refs viven en el directorio común.
  const comun = await leer(join(git, "commondir"));
  const bases = [git, ...(comun ? [resolve(git, comun)] : [])];
  for (const b of bases) {
    const suelta = await leer(join(b, ref));
    if (suelta && /^[0-9a-f]{40}$/.test(suelta)) return suelta;
    const packed = await leer(join(b, "packed-refs"));
    const m = packed?.split("\n").find((l) => l.endsWith(" " + ref));
    if (m) return m.slice(0, 40);
  }
  return null;
}

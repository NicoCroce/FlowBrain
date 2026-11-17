import { compileDirConVisor } from "@flowbrain/viewer";
import { access, chmod, constants, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cmp } from "@flowbrain/core";

/** Nombre del paquete publicado y versión (la inyecta el build; en desarrollo queda "dev"). */
export const PAQUETE = "flowbrain";
declare const __FLOWBRAIN_VERSION__: string | undefined;
export const VERSION = typeof __FLOWBRAIN_VERSION__ === "string" ? __FLOWBRAIN_VERSION__ : "dev";

/** Comando con el que Claude Code invoca a brain: versión fija vía npx, o el repo en desarrollo. */
export function comandoBrain(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FLOWBRAIN_COMANDO) return env.FLOWBRAIN_COMANDO;
  if (VERSION !== "dev") return `npx -y ${PAQUETE}@${VERSION}`;
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  // Directo, sin pasar por pnpm: así el comando corre en la carpeta desde la que se lo llama.
  return `${comillas(join(repo, "node_modules/.bin/tsx"))} ${comillas(join(repo, "packages/cli/src/main.ts"))}`;
}

export const comillas = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** SCHEMA.md que acompaña al paquete (dist/../SCHEMA.md) o al repo en desarrollo. */
async function leerSchema(): Promise<string> {
  const aqui = dirname(fileURLToPath(import.meta.url));
  for (const c of [join(aqui, "../SCHEMA.md"), join(aqui, "../../../SCHEMA.md")]) {
    const t = await readFile(c, "utf8").catch(() => null);
    if (t !== null) return t;
  }
  throw new Error("no se encontró SCHEMA.md junto al paquete");
}

const README = (cmd: string) => `# FlowBrain

Grafo de conocimiento del sistema: páginas Markdown escritas por humanos (\`producto/\`, \`tecnologia/\`) y JSON
generado por los parsers (\`_build/\`). El contrato está en \`SCHEMA.md\`.

## Flujo

\`\`\`bash
${cmd} draft /ruta/a/un/repo      # borradores en _drafts/<repo>/ y funcionalidades en _drafts/producto/
# revisar, completar y mover _drafts/<repo>/tecnologia/*.md a tecnologia/ y _drafts/producto/*.md a producto/
${cmd} index /ruta/a/un/repo      # contratos y archivos en _build/
${cmd} compile                    # graph.json, INDEX.md, backlinks y _build/viewer.html (funcionalidades y mapa)
${cmd} verify --repos /ruta/a/los/clones   # evidencias rotas → dudoso (para CI)
\`\`\`

Se versiona todo, incluido \`_build/\` y \`_drafts/\` (los borradores se revisan por PR).
`;

export interface ResultadoInit {
  raiz: string;
  creados: string[];
  hooks: { settings: string; cambio: boolean } | null;
  mcp: string;
  comando: string;
}

/**
 * `flowbrain init [dir]`: crea la estructura del brain (sin pisar nada), compila, y opcionalmente registra los hooks
 * de Claude Code en su settings.json. El servidor MCP se registra con una línea de `claude mcp add` que se imprime.
 */
export async function init(
  dir: string,
  opciones: { claudeCode?: boolean; settings?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ResultadoInit> {
  const raiz = resolve(dir);
  const cmd = comandoBrain(opciones.env);
  const archivos: Record<string, string> = {
    "README.md": README(cmd.startsWith("npx") ? "npx flowbrain" : "flowbrain"),
    "SCHEMA.md": await leerSchema(),
    "producto/.gitkeep": "",
    "tecnologia/.gitkeep": "",
  };
  const creados: string[] = [];
  for (const ruta of Object.keys(archivos).sort(cmp)) {
    const destino = join(raiz, ruta);
    if ((await readFile(destino, "utf8").catch(() => null)) !== null) continue;
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, archivos[ruta]!, "utf8");
    creados.push(ruta);
  }
  const { escritos } = await compileDirConVisor(raiz);
  creados.push(...escritos);

  const base = `${cmd} hook claude-code --raiz ${comillas(raiz)}`;
  let hooks: ResultadoInit["hooks"] = null;
  if (opciones.claudeCode) {
    const settings = opciones.settings ?? join(homedir(), ".claude/settings.json");
    hooks = { settings, cambio: await instalarHooksClaudeCode(settings, base) };
  }
  return { raiz, creados: [...new Set(creados)].sort(cmp), hooks, comando: cmd, mcp: `claude mcp add --scope user flowbrain -- ${cmd} serve --raiz ${comillas(raiz)}` };
}

type Settings = { hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string }> }>> } & Record<string, unknown>;

const esDeBrain = (command: string | undefined) => !!command && / hook claude-code( |$)/.test(command);

/**
 * Registra el mismo comando en UserPromptSubmit y SessionEnd. Reemplaza entradas previas de brain y conserva todo
 * lo demás. Si el archivo no es JSON válido, falla sin tocarlo. Deja un respaldo `.flowbrain.bak` antes de escribir.
 */
export async function instalarHooksClaudeCode(settingsPath: string, comando: string): Promise<boolean> {
  const previo = await readFile(settingsPath, "utf8").catch(() => null);
  let s: Settings;
  try {
    s = previo === null || previo.trim() === "" ? {} : (JSON.parse(previo) as Settings);
  } catch {
    throw new Error(`${settingsPath} no es JSON válido; no se modificó`);
  }
  if (typeof s !== "object" || s === null || Array.isArray(s)) throw new Error(`${settingsPath} no es un objeto JSON; no se modificó`);
  s.hooks ??= {};
  for (const evento of ["UserPromptSubmit", "SessionEnd"]) {
    const entradas = (s.hooks[evento] ?? [])
      .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !esDeBrain(h.command)) }))
      .filter((e) => e.hooks.length > 0);
    entradas.push({ hooks: [{ type: "command", command: comando }] });
    s.hooks[evento] = entradas;
  }
  const nuevo = JSON.stringify(s, null, 2) + "\n";
  if (nuevo === previo) return false;
  await mkdir(dirname(settingsPath), { recursive: true });
  if (previo !== null) await writeFile(`${settingsPath}.flowbrain.bak`, previo, "utf8");
  await writeFile(settingsPath, nuevo, "utf8");
  return true;
}

/**
 * Deja el comando `flowbrain` disponible en cualquier carpeta: un script en un directorio del PATH que llama a este
 * mismo código. Con el paquete instalado (`npm i -g flowbrain`) no hace falta. Devuelve dónde quedó y si ese directorio
 * está en el PATH.
 */
export async function instalarComando(env: NodeJS.ProcessEnv = process.env, bin?: string): Promise<{ archivo: string; enPath: boolean }> {
  const enPath = (env.PATH ?? "").split(":").filter(Boolean);
  const escribible = (d: string) => access(d, constants.W_OK).then(() => true, () => false);
  const local = join(homedir(), ".local/bin");
  let dir = bin;
  if (!dir) for (const d of ["/opt/homebrew/bin", "/usr/local/bin", local]) if (enPath.includes(d) && (await escribible(d))) { dir = d; break; }
  dir ??= local;
  await mkdir(dir, { recursive: true });
  const archivo = join(dir, "flowbrain");
  await writeFile(archivo, `#!/bin/sh\n# Lo escribió \`flowbrain instalar\`.\nexec ${comandoBrain(env)} "$@"\n`, "utf8");
  await chmod(archivo, 0o755);
  return { archivo, enPath: enPath.includes(dir) };
}

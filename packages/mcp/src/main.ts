import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cargadorConCache, crearServidor } from "./server.js";

/**
 * `brain serve`: servidor MCP por stdio. Raíz: --raiz <dir>, $BRAIN_ROOT o el directorio actual. Con `--sync` y un
 * `sincronizar` (lo pasa la CLI), reindexa solo cuando un clon avanzó.
 */
export async function servir(argv: string[], env: NodeJS.ProcessEnv = process.env, sincronizar?: (raiz: string) => Promise<unknown>): Promise<void> {
  const i = argv.indexOf("--raiz");
  const raiz = resolve(i !== -1 && argv[i + 1] ? argv[i + 1]! : (env.BRAIN_ROOT ?? "."));
  const server = crearServidor(cargadorConCache(raiz, sincronizar && argv.includes("--sync") ? () => sincronizar(raiz) : undefined));
  await server.connect(new StdioServerTransport());
}

const esMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (esMain) await servir(process.argv.slice(2));

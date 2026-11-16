import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cargadorConCache, crearServidor } from "./server.js";

/** `brain serve`: servidor MCP por stdio. Raíz: --raiz <dir>, $BRAIN_ROOT o el directorio actual. */
export async function servir(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const i = argv.indexOf("--raiz");
  const raiz = resolve(i !== -1 && argv[i + 1] ? argv[i + 1]! : (env.BRAIN_ROOT ?? "."));
  const server = crearServidor(cargadorConCache(raiz));
  await server.connect(new StdioServerTransport());
}

const esMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (esMain) await servir(process.argv.slice(2));

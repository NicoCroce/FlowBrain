import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buscarRegistro, esRegistro } from "@flowbrain/core";
import { crearMulti } from "./multi.js";
import { cargadorConCache, crearServidor } from "./server.js";

/**
 * `flowbrain serve`: servidor MCP por stdio. Raíz: --raiz <dir>, $FLOWBRAIN_ROOT, el `.flowbrain` del proyecto donde se
 * abrió la sesión (en esa carpeta o por encima) o el directorio actual. Con `--sync` y un
 * `sincronizar` (lo pasa la CLI), reindexa solo cuando un clon avanzó.
 */
export async function servir(argv: string[], env: NodeJS.ProcessEnv = process.env, sincronizar?: (raiz: string) => Promise<unknown>): Promise<void> {
  const i = argv.indexOf("--raiz");
  // INIT_CWD: la carpeta desde la que se invocó, cuando el comando pasa por pnpm o npm.
  const raiz = resolve(i !== -1 && argv[i + 1] ? argv[i + 1]! : (env.FLOWBRAIN_ROOT ?? (await buscarRegistro(env.INIT_CWD ?? process.cwd())) ?? "."));
  const sync = sincronizar && argv.includes("--sync") ? sincronizar : undefined;
  // Una carpeta con `cerebros.yaml` sirve todos sus cerebros; si no, es un brain solo.
  const server = (await esRegistro(raiz))
    ? crearServidor(() => Promise.reject(new Error("sin cerebro")), crearMulti(raiz, sync ? { sincronizar: sync } : {}))
    : crearServidor(cargadorConCache(raiz, sync ? () => sync(raiz) : undefined));
  await server.connect(new StdioServerTransport());
}

// Solo cuando se ejecuta este archivo directamente; dentro del paquete empaquetado todo es un mismo archivo y arranca la CLI.
const esMain = process.argv[1] !== undefined && /[\\/]mcp[\\/]src[\\/]main\.[cm]?[jt]s$/.test(process.argv[1]) && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (esMain) await servir(process.argv.slice(2));

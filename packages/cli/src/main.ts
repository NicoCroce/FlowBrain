import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  buscarNodo,
  cargarContexto,
  CompileError,
  compileDir,
  ConsultaError,
  contratoDe,
  formatError,
  recorrerGrafo,
  stringifyCanonical,
  trazar,
  contextoParaPrompt,
  type Contexto,
  type Proyeccion,
} from "@brain/core";
import { BUDGET_HOOK, hookUserPromptSubmit, nombreRepo } from "@brain/hooks";
import { escribirIndex, indexar } from "@brain/parsers";

const AYUDA = `brain <comando> [opciones]

Comandos:
  compile                                   compila páginas y JSON → _build/, INDEX.md, backlinks
  index <ruta-repo> [--repo <repo-id>]      corre los parsers y escribe contratos, archivos y extracción en _build/
  buscar <texto> [--tipos a,b] [--limite n]
  recorrer <nodo> [--verbos a,b] [--direccion out|in|both] [--profundidad n]
  contrato <nodo> [--endpoint "MÉTODO /ruta"]
  trazar --desde <nodo|URL|ruta|archivo> [--hasta <nodo>]
  context --prompt <texto> [--repo <dir>]   contexto para inyectar en un prompt (budget por defecto 1500)
  hook claude-code                          hook UserPromptSubmit: lee el JSON de Claude Code por stdin
  serve                                     servidor MCP por stdio

Opciones comunes:
  --raiz <dir>          raíz del brain (por defecto $BRAIN_ROOT o el directorio actual)
  --proyeccion <p>      resumen | relaciones | contrato | completo
  --budget <n|none>     presupuesto de tokens (por defecto 2000)
`;

type Salida = { codigo: number; stdout: string; stderr: string };

const lista = (v: string | undefined) => (v === undefined ? undefined : v.split(",").map((s) => s.trim()).filter(Boolean));
const entero = (v: string | undefined, nombre: string) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ConsultaError("parametro_invalido", `${nombre} debe ser entero`);
  return n;
};

/** Ejecuta la CLI sin efectos sobre el proceso: devuelve código y salidas. Testeable. */
export async function ejecutar(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  stdin: () => Promise<string> = async () => "",
): Promise<Salida> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        raiz: { type: "string" },
        proyeccion: { type: "string" },
        budget: { type: "string" },
        tipos: { type: "string" },
        limite: { type: "string" },
        verbos: { type: "string" },
        direccion: { type: "string" },
        profundidad: { type: "string" },
        endpoint: { type: "string" },
        desde: { type: "string" },
        hasta: { type: "string" },
        prompt: { type: "string" },
        repo: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    return { codigo: 2, stdout: "", stderr: `${(e as Error).message}\n\n${AYUDA}` };
  }
  const { values: o, positionals } = parsed;
  const [comando, arg] = positionals;
  if (o.help || !comando) return { codigo: comando || o.help ? 0 : 2, stdout: AYUDA, stderr: "" };
  const raiz = resolve(cwd, o.raiz ?? env.BRAIN_ROOT ?? ".");

  try {
    if (comando === "compile") {
      const { salidas, escritos } = await compileDir(raiz);
      const resumen = `compilado: ${salidas.graph.nodes.length} nodos, ${salidas.graph.edges.length} aristas; ${escritos.length} archivos escritos\n`;
      return { codigo: 0, stdout: resumen + escritos.map((e) => `  ${e}\n`).join(""), stderr: "" };
    }

    if (comando === "index") {
      if (!arg) throw new ConsultaError("parametro_invalido", "falta <ruta-repo>");
      const r = await indexar(resolve(cwd, arg), raiz, o.repo !== undefined ? { repo: o.repo } : {});
      const escritos = await escribirIndex(raiz, r);
      const nuevos = r.servicios.filter((s) => s.nuevo).map((s) => `${s.svc} (${s.paquete || "."})`);
      const lineas = [
        `indexado ${r.repo}: ${r.contratos.length} contratos, ${r.aristas.length} aristas, ${r.pendientes.length} pendientes; ${escritos.length} archivos escritos`,
        ...escritos.map((e) => `  ${e}`),
        ...(nuevos.length ? [`servicios sin página (los propone el indexador): ${nuevos.join(", ")}`] : []),
      ];
      return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "hook") {
      if (arg !== "claude-code") return { codigo: 2, stdout: "", stderr: `hook desconocido: ${arg ?? ""}\n` };
      try {
        const entrada = JSON.parse((await stdin()) || "{}") as { prompt?: string; cwd?: string };
        const budget = o.budget === undefined ? BUDGET_HOOK : (entero(o.budget, "--budget") ?? BUDGET_HOOK);
        return { codigo: 0, stdout: await hookUserPromptSubmit(entrada, () => cargarContexto(raiz), budget), stderr: "" };
      } catch (e) {
        // Un hook roto nunca debe bloquear el prompt del usuario.
        return { codigo: 0, stdout: "", stderr: `brain hook: ${(e as Error).message}\n` };
      }
    }

    const budget = o.budget === undefined ? undefined : o.budget === "none" ? null : entero(o.budget, "--budget");
    const comunes = {
      ...(o.proyeccion !== undefined ? { proyeccion: o.proyeccion as Proyeccion } : {}),
      ...(budget !== undefined ? { budget_tokens: budget } : {}),
    };
    const ctx: Contexto = await cargarContexto(raiz);
    let resultado: unknown;
    switch (comando) {
      case "buscar":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <texto>");
        resultado = buscarNodo(ctx, { texto: arg, ...opt("tipos", lista(o.tipos)), ...opt("limite", entero(o.limite, "--limite")), ...comunes });
        break;
      case "recorrer":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <nodo>");
        resultado = recorrerGrafo(ctx, {
          nodo: arg,
          ...opt("verbos", lista(o.verbos)),
          ...opt("direccion", o.direccion as "out" | "in" | "both" | undefined),
          ...opt("profundidad", entero(o.profundidad, "--profundidad")),
          ...comunes,
        });
        break;
      case "contrato":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <nodo>");
        resultado = contratoDe(ctx, { nodo: arg, ...opt("endpoint", o.endpoint), ...comunes });
        break;
      case "trazar": {
        const desde = o.desde ?? arg;
        if (!desde) throw new ConsultaError("parametro_invalido", "falta --desde");
        resultado = trazar(ctx, { desde, ...opt("hasta", o.hasta), ...comunes });
        break;
      }
      case "context": {
        if (!o.prompt) throw new ConsultaError("parametro_invalido", "falta --prompt");
        const repoDir = o.repo !== undefined ? await nombreRepo(resolve(cwd, o.repo)) : null;
        const r = contextoParaPrompt(ctx, {
          prompt: o.prompt,
          repoDir,
          budget_tokens: typeof budget === "number" ? budget : BUDGET_HOOK,
        });
        return { codigo: 0, stdout: r.texto, stderr: "" };
      }
      default:
        return { codigo: 2, stdout: "", stderr: `comando desconocido: ${comando}\n\n${AYUDA}` };
    }
    return { codigo: 0, stdout: stringifyCanonical(resultado), stderr: "" };
  } catch (e) {
    if (e instanceof CompileError) return { codigo: 1, stdout: "", stderr: e.errores.map(formatError).join("\n") + "\n" };
    if (e instanceof ConsultaError) {
      return { codigo: 2, stdout: stringifyCanonical({ error: { codigo: e.codigo, mensaje: e.message } }), stderr: "" };
    }
    throw e;
  }
}

/** Omite la clave si el valor es undefined (exactOptionalPropertyTypes). */
function opt<K extends string, V>(k: K, v: V | undefined): { [P in K]?: V } {
  return (v === undefined ? {} : { [k]: v }) as { [P in K]?: V };
}

async function leerStdin(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const p of process.stdin) partes.push(p as Buffer);
  return Buffer.concat(partes).toString("utf8");
}

const esMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (esMain && process.argv[2] === "serve") {
  const { servir } = await import("@brain/mcp");
  await servir(process.argv.slice(3));
} else if (esMain) {
  const r = await ejecutar(process.argv.slice(2), process.env, process.cwd(), leerStdin);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.codigo;
}

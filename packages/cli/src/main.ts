import { compileDirConVisor } from "@flowbrain/viewer";
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  buscarNodo,
  ARCHIVO_REGISTRO,
  ARCHIVO_CONTROLES,
  cobertura,
  fidelidad,
  leerControles,
  type InformeExtractorBreve,
  ARCHIVO_LLAMADAS,
  leerLlamadasDeclaradas,
  llamadasPorResolver,
  MAX_CEREBROS,
  buscarRegistro,
  CARPETA_PROYECTO,
  cargarContexto,
  esRegistro,
  leerRegistro,
  CompileError,
  ConsultaError,
  contratoDe,
  deriva,
  funcionalidad,
  impactoDe,
  infra,
  riesgo,
  quienLlama,
  recorrido,
  pantalla,
  paridad,
  formatError,
  recorrerGrafo,
  stringifyCanonical,
  trazar,
  contextoParaPrompt,
  evaluar,
  leerPreguntas,
  verifyDir,
  type Contexto,
  type Proyeccion,
} from "@flowbrain/core";
import { crearMulti } from "@flowbrain/mcp";
import { anotar, BUDGET_HOOK, DESTINOS, escribirReglas, generarReglas, hookSessionEnd, hookUserPromptSubmit, nombreRepo, repoDe, type Destino } from "@flowbrain/hooks";
import { draftDir } from "@flowbrain/indexer";
import { aplicar, ARCHIVO_VISOR, asegurarGitignore, crearRegistro, encontrarRepos, escribirVisor, listar, proponer } from "./cerebros.js";
import { doctor, estado, reposIndexados, sync, textoEstado } from "./estado.js";
import { evidencia } from "./evidencia.js";
import { GUIA_ANALISIS, GUIA_ESTUDIO, GUIA_FUNCIONALIDADES, NOMBRE_COMANDO, NOMBRE_ESTUDIO, NOMBRE_FUNCIONALIDADES } from "./guia.js";
import { comandoBrain, comillas, init, instalarComando, instalarHooksClaudeCode, VERSION } from "./init.js";
import { promover } from "./promover.js";
import { escribirIndex, indexar } from "@flowbrain/parsers";

const AYUDA = `flowbrain <comando> [opciones]

Grafo de conocimiento del sistema para agentes de código. Empezá con "flowbrain install" parado en el proyecto.

Comandos:
  (sin comando) | menu                      menú en la terminal: configurar el proyecto, analizarlo completo con Claude
                                            Code, reindexar, abrir el visor, conectar el MCP y actualizar FlowBrain
  setup                                     deja lista la máquina (comando, hooks y comandos de Claude Code) sin
                                            tocar ningún proyecto
  init [dir] [--claude-code]                crea un brain en dir (por defecto el actual) y lo compila;
                                            con --claude-code registra los hooks en ~/.claude/settings.json
  compile                                   compila páginas y JSON → _build/, INDEX.md, backlinks
  index <ruta-repo> [--repo <repo-id>]      corre los parsers y escribe contratos, archivos y extracción en _build/
  draft <ruta-repo> [--repo <repo-id>]      borradores en _drafts/<repo>/ y funcionalidades en _drafts/product/
                                            (no toca technology/, product/ ni _build/)
  install [carpeta] [--repos <dir>]          parado en un proyecto: deja el comando y los hooks de Claude Code, crea
          [--split | --single]              .flowbrain/, pregunta dónde están los repos y si va un cerebro por repo o
                                            todos en uno, e indexa todo; volver a correrlo actualiza
  brains                                  lista los cerebros del registro (flowbrain.yaml en --root) y su estado
  brains propose <carpeta...>             explora carpetas y escribe un borrador de flowbrain.yaml con preguntas abiertas
  brains apply [nombre]                   crea e indexa los cerebros del registro (o uno solo)
  brains viewer                           regenera flowbrain.html (tras cambiar comunicacion o conexiones)
  brains register                         registra en Claude Code los hooks del registro e imprime la línea del MCP
  evidence [--brain <nombre>] [--guide]     para decidir a qué servicio va cada llamada: por base de URL, dónde se
                                            define y con qué coincide; --guide imprime las instrucciones para el modelo
  connections [--brain <nombre>]           qué llamadas viajan entre un cerebro y los que tiene comunicados
  sync [--repos <dir>] [--force]           reindexa los repos cuyo clon avanzó desde el último index y recompila
  status [--repos <dir>] [--json]           repos al día o no, conteos del grafo y huecos conocidos;
                                            sale con 1 si algún repo quedó desactualizado
  doctor [--repos <dir>]                    diagnóstico: grafo, índice, clones, hooks y MCP registrados (solo lee)
  promote [id...] [--all] [--write]   pasa borradores revisados de _drafts/ a technology/ y product/ y compila;
           [--overwrite]                        sin --write solo lista; si el brain deja de compilar, deshace todo
  verify [--repos <dir>] [--clone id=ruta]   verifica evidencias contra los clones locales; marca dudosas
         [--days n] [--today AAAA-MM-DD]      sale con 1 si aparecen dudosas nuevas (apto para CI)
  note <nodo> <texto>                       agrega una nota a _drafts/notes/<nodo>.md
  gen claude|agents|cursor|windsurf         reglas para el agente (CLAUDE.md, AGENTS.md, .cursor/rules, .windsurf/rules)
      [--repo <dir|repo-id>] [--write]   imprime por stdout; con --write las deja en el repo
  search <texto> [--types a,b] [--limit n]
  traverse <nodo> [--verbs a,b] [--direction out|in|both] [--depth n]
  contract <nodo> [--endpoint "MÉTODO /ruta"]
  trace --from <nodo|URL|ruta|archivo> [--to <nodo>]
  feature <id|nombre> [--guide]       ficha compacta: endpoints, consumo, datos, relaciones, dominio compartido;
                                            --guide imprime cómo deducir y completar las funcionalidades (para el modelo)
  flow <"MÉTODO /ruta"|Clase.metodo>   pasos controller → servicio → repositorio, con lo que toca cada uno
  screen </ruta|Componente>               pantalla del front de punta a punta: de dónde se llega, a dónde lleva, qué llama del back
  callers <Clase.metodo|Clase> [--depth n]
  impact <pieza>                           qué se ve afectado si cambia una tabla, endpoint, servicio, feat o símbolo
  risk [archivo...] [--diff <archivo|->]  alcance de un cambio: desde un diff (git diff | flowbrain risk --diff -) o archivos
         [--repo <repo-id>]                 tocados, qué funcionalidades, endpoints, pantallas, tablas y repos alcanza
  parity <svc-viejo> <svc-nuevo>           qué falta migrar de un servicio a otro: endpoints, pantallas y tablas
  coverage                                  cuánto del código quedó conectado: pantallas con llamadas, llamadas con
                                            ruta, endpoints con método y que llegan a una tabla, accesos con columnas;
                                            más el informe de los extractores del proyecto y los controles (checks.yaml)
  fidelity [archivo] [--min n] [--max n]    qué tan entendido quedó cada archivo, de 0 a 100, y qué le falta (con su
           [--feature id|ninguna]           línea): llamadas sin resolver, HTTP sin ruta, accesos sin columnas, endpoints
           [--type ext] [--signal s]        sin recorrido o sin respuesta, pantallas sin llamadas, archivos sin
           [--limit n]                      funcionalidad. Lista de menor a mayor; con un archivo, su detalle
  calls [--limit n]                         dónde se cortan los recorridos: endpoints que no llegan a una tabla y las
                                            llamadas sin tipo que hay en su camino, con candidatos; se resuelven
                                            declarándolas en calls.yaml (raíz del brain) y reindexando
  drift [svc]                              llamadas que ningún endpoint atiende y endpoints que nadie llama
  infra [nodo] [--text <t>]                imágenes, compose, pipelines, variables de entorno y proxy, con su archivo
  eval [archivo] [--min pct]          corre preguntas con respuesta conocida (por defecto evals/questions.json)
                                            y da el porcentaje de aciertos; sale con 1 si queda debajo de --min
  context --prompt <texto> [--repo <dir>]   contexto para inyectar en un prompt (budget por defecto 1500)
  hook claude-code                          hooks UserPromptSubmit y SessionEnd: lee el JSON de Claude Code por stdin
  serve [--sync]                            servidor MCP por stdio; con --sync reindexa solo cuando un clon avanzó

Opciones comunes:
  --root <dir>          raíz del brain, o carpeta con flowbrain.yaml (por defecto $FLOWBRAIN_ROOT, el .flowbrain del
                        proyecto donde estás parado, o el directorio actual)
  --brain <nombre>    con varios cerebros, cuál usar (por defecto, el del repo donde estás parado)
  --projection <p>      resumen | relaciones | contrato | completo
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
/** Deja lista la máquina: el comando `flowbrain` en el PATH, los hooks y los comandos de Claude Code. */
async function prepararMaquina(env: NodeJS.ProcessEnv, cwd: string, settingsOpt?: string, binOpt?: string): Promise<string[]> {
  const cmd = comandoBrain(env);
  const settings = settingsOpt !== undefined ? resolve(cwd, settingsOpt) : join(homedir(), ".claude/settings.json");
  const bin = VERSION === "dev" || binOpt !== undefined ? await instalarComando(env, binOpt !== undefined ? resolve(cwd, binOpt) : undefined) : null;
  const cambio = await instalarHooksClaudeCode(settings, `${cmd} hook claude-code`);
  // Los comandos de Claude Code (las guías para el modelo) van junto a los settings.
  const comandos = join(dirname(settings), "commands");
  await mkdir(comandos, { recursive: true });
  const comandoCC = join(comandos, `${NOMBRE_COMANDO}.md`);
  const comandoFeat = join(comandos, `${NOMBRE_FUNCIONALIDADES}.md`);
  const comandoEstudio = join(comandos, `${NOMBRE_ESTUDIO}.md`);
  await writeFile(comandoCC, GUIA_ANALISIS, "utf8");
  await writeFile(comandoFeat, GUIA_FUNCIONALIDADES, "utf8");
  await writeFile(comandoEstudio, GUIA_ESTUDIO, "utf8");
  return [
    ...(bin ? [`Comando flowbrain en ${bin.archivo}${bin.enPath ? "" : ` (esa carpeta no está en tu PATH: agregá export PATH="${dirname(bin.archivo)}:$PATH" a tu ~/.zshrc)`}.`] : []),
    `Hooks de Claude Code ${cambio ? "registrados" : "ya estaban registrados"} en ${settings} (UserPromptSubmit y SessionEnd).`,
    `Comando /${NOMBRE_COMANDO} para Claude Code en ${comandoCC}: indexa el proyecto y analiza la comunicación real entre servicios.`,
    `Comando /${NOMBRE_FUNCIONALIDADES} en ${comandoFeat}: deduce y completa las funcionalidades de producto de cada cerebro.`,
    `Comando /${NOMBRE_ESTUDIO} en ${comandoEstudio}: estudia cómo está hecho cada repo y escribe los extractores que completan el índice.`,
  ];
}

export async function ejecutar(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  stdin: () => Promise<string> = async () => "",
  /** Para preguntarle al usuario en una terminal; sin esto, los comandos usan sus valores por defecto. */
  preguntar?: (pregunta: string) => Promise<string>,
): Promise<Salida> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        brain: { type: "string" },
        projection: { type: "string" },
        budget: { type: "string" },
        types: { type: "string" },
        limit: { type: "string" },
        verbs: { type: "string" },
        direction: { type: "string" },
        depth: { type: "string" },
        endpoint: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        prompt: { type: "string" },
        repo: { type: "string" },
        repos: { type: "string" },
        clone: { type: "string", multiple: true },
        days: { type: "string" },
        today: { type: "string" },
        min: { type: "string" },
        max: { type: "string" },
        feature: { type: "string" },
        type: { type: "string" },
        signal: { type: "string" },
        text: { type: "string" },
        diff: { type: "string" },
        write: { type: "boolean" },
        guide: { type: "boolean" },
        force: { type: "boolean" },
        all: { type: "boolean" },
        overwrite: { type: "boolean" },
        json: { type: "boolean" },
        "claude-code": { type: "boolean" },
        settings: { type: "string" },
        bin: { type: "string" },
        split: { type: "boolean" },
        single: { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    return { codigo: 2, stdout: "", stderr: `${(e as Error).message}\n\n${AYUDA}` };
  }
  const { values: o, positionals } = parsed;
  const [comando, arg] = positionals;
  if (o.version) return { codigo: 0, stdout: `${VERSION}\n`, stderr: "" };
  if (comando === "help") return { codigo: 0, stdout: AYUDA, stderr: "" };
  if (comando === "menu") return { codigo: 2, stdout: "", stderr: "el menú necesita una terminal interactiva; sin ella, usá los comandos (flowbrain help)\n" };
  if (o.help || !comando) return { codigo: comando || o.help ? 0 : 2, stdout: AYUDA, stderr: "" };
  // Sin --root ni $FLOWBRAIN_ROOT: el `.flowbrain` del proyecto donde se está parado (en esta carpeta o por encima).
  const explicita = o.root ?? env.FLOWBRAIN_ROOT;
  let raiz = resolve(cwd, explicita ?? (await buscarRegistro(cwd)) ?? ".");
  const resumenAplicar = (rs: Awaited<ReturnType<typeof aplicar>>, visor: string | null) => [...rs.flatMap((r) => [
    `${r.nombre}${r.curado ? "" : " (sin curar)"}: ${r.nodos} nodos, ${r.relaciones} relaciones; ${r.promovidas} páginas creadas, ${r.borradores} borradores para revisar`,
    ...r.repos.map((x) => `  ${x.repo ?? "(sin indexar)"} ← ${x.ruta}${x.error ? `: ${x.error}` : ""}`),
    ...r.errores.slice(0, 10).map((e) => `  no compiló y quedó como borrador: ${e}`),
    ...(r.errores.length > 10 ? [`  … y ${r.errores.length - 10} más`] : []),
  ]), ...(visor ? [`visor de todos los cerebros: ${visor}`] : [])];
  const fallo = (rs: Awaited<ReturnType<typeof aplicar>>) => rs.some((r) => r.repos.some((x) => x.error) || r.nodos === 0);

  try {
    if (comando === "init") {
      const r = await init(resolve(cwd, arg ?? "."), { claudeCode: o["claude-code"] === true, ...(o.settings !== undefined ? { settings: resolve(cwd, o.settings) } : {}), env });
      const lineas = [
        `brain listo en ${r.raiz}`,
        ...r.creados.map((c) => `  ${c}`),
        "",
        "Servidor MCP (una línea, una sola vez):",
        `  ${r.mcp}`,
        "",
        r.hooks
          ? `Hooks de Claude Code ${r.hooks.cambio ? "registrados" : "ya estaban registrados"} en ${r.hooks.settings} (UserPromptSubmit y SessionEnd).`
          : "Hooks de Claude Code: repetí con --claude-code para registrarlos en ~/.claude/settings.json.",
        "",
        `Siguiente: ${r.comando} draft /ruta/a/un/repo --root ${r.raiz}`,
      ];
      return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "setup") {
      // Solo la máquina: el comando en el PATH, los hooks y los comandos de Claude Code. No toca ningún proyecto.
      return { codigo: 0, stdout: (await prepararMaquina(env, cwd, o.settings, o.bin)).join("\n") + "\n", stderr: "" };
    }

    if (comando === "install") {
      // Un solo comando, parado en el proyecto. Deja lista la máquina (comando en el PATH y hooks de Claude Code, sin
      // atarlos a una carpeta) y arma `.flowbrain/` en el proyecto: pregunta dónde están los repos y cómo dividirlos.
      const proyecto = resolve(cwd, arg ?? ".");
      const cmd = comandoBrain(env);
      const lineas = [...(await prepararMaquina(env, cwd, o.settings, o.bin)), ""];
      const reg = join(proyecto, CARPETA_PROYECTO);
      await mkdir(reg, { recursive: true });
      if (!(await esRegistro(reg))) {
        const resp = o.repos ?? (preguntar ? (await preguntar(`¿En qué carpeta están los repositorios? (Enter: ${proyecto}) `)).trim() : "");
        const carpeta = resolve(proyecto, resp || ".");
        if (!(await stat(carpeta).then((x) => x.isDirectory(), () => false))) throw new ConsultaError("parametro_invalido", `no existe la carpeta: ${carpeta}`);
        // Una carpeta con código pero sin repos adentro: ella misma es el repo.
        const encontrados = await encontrarRepos(carpeta);
        const rutas = encontrados.length ? encontrados : [carpeta];
        let dividir = false;
        if (rutas.length > 1) {
          if (rutas.length > MAX_CEREBROS) lineas.push(`Hay ${rutas.length} repos y el máximo es ${MAX_CEREBROS} cerebros: quedan todos en uno; agrupalos en ${join(reg, ARCHIVO_REGISTRO)}.`);
          else if (o.split || o.single) dividir = o.split === true;
          else if (preguntar) {
            const r = (await preguntar(`Encontré ${rutas.length}: ${rutas.map((x) => basename(x)).join(", ")}.\n¿Un cerebro por cada uno (1) o todos en un mismo cerebro (2)? (Enter: 1) `)).trim();
            dividir = r !== "2";
          } else dividir = true;
        }
        const c = await crearRegistro(reg, proyecto, rutas, dividir);
        lineas.push(`registro creado en ${c.archivo}: ${c.repos.length} ${c.repos.length === 1 ? "repo" : "repos"} en ${c.cerebros.length === 1 ? "un cerebro" : `${c.cerebros.length} cerebros`}`, ...c.repos.map((x) => `  ${x.nombre}: ${[...x.pila, ...x.lenguajes].join(", ") || "sin código reconocido"}; ${x.endpoints} endpoints, ${x.pantallas} pantallas, ${x.tablas} tablas`));
        await asegurarGitignore(reg);
      } else lineas.push(`registro existente en ${join(reg, ARCHIVO_REGISTRO)}: se actualiza`);
      const registro = await leerRegistro(reg);
      const rs = await aplicar(registro);
      const visor = await escribirVisor(registro);
      lineas.push(
        ...resumenAplicar(rs, visor),
        "",
        `Para reagrupar los repos o apagar la comunicación entre cerebros, editá ${join(reg, ARCHIVO_REGISTRO)} y volvé a correr: flowbrain install`,
        "",
        "Servidor MCP (una sola vez por máquina; si ya lo registraste, no hace falta):",
        "  claude mcp remove --scope user flowbrain",
        `  claude mcp add --scope user flowbrain -- ${cmd} serve --sync`,
      );
      return { codigo: fallo(rs) ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "brains") {
      if (arg === "propose") {
        const carpetas = positionals.slice(2).map((c) => resolve(cwd, c));
        if (!carpetas.length) throw new ConsultaError("parametro_invalido", "uso: flowbrain brains propose <carpeta...> --root <carpeta del registro>");
        const r = await proponer(raiz, carpetas);
        const lineas = [
          `propuesta en ${r.archivo}: ${r.repos.length} repos`,
          ...r.repos.map((x) => `  ${x.nombre}: ${[...x.pila, ...x.lenguajes].join(", ") || "sin código reconocido"}; ${x.endpoints} endpoints, ${x.pantallas} pantallas, ${x.tablas} tablas${x.bases.length ? `; llama por ${x.bases.map((b) => b.base).join(", ")}` : ""}`),
          "revisá el archivo (agrupá los repos en cerebros y respondé las preguntas) y corré: flowbrain brains apply",
        ];
        return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (!(await esRegistro(raiz))) throw new ConsultaError("parametro_invalido", `no hay ${ARCHIVO_REGISTRO} en ${raiz}; creálo con: flowbrain brains propose <carpeta> --root ${raiz}`);
      if (arg === "apply") {
        const registro = await leerRegistro(raiz);
        const solo = positionals[2];
        if (solo && !registro.cerebro(solo)) throw new ConsultaError("nodo_inexistente", `no existe el cerebro: ${solo}`);
        const rs = await aplicar(registro, solo);
        const visor = await escribirVisor(registro);
        return { codigo: fallo(rs) ? 1 : 0, stdout: resumenAplicar(rs, visor).join("\n") + "\n", stderr: "" };
      }
      if (arg === "viewer") {
        const visor = await escribirVisor(await leerRegistro(raiz));
        return { codigo: visor ? 0 : 1, stdout: visor ? `${visor}\n` : "ningún cerebro está compilado: corré flowbrain brains apply\n", stderr: "" };
      }
      if (arg === "register") {
        // Hooks de Claude Code apuntando al registro (cada prompt usa el cerebro del repo actual) y la línea del MCP.
        const cmd = comandoBrain(env);
        const settings = o.settings !== undefined ? resolve(cwd, o.settings) : join(homedir(), ".claude/settings.json");
        const cambio = await instalarHooksClaudeCode(settings, `${cmd} hook claude-code --root ${comillas(raiz)}`);
        const lineas = [
          `Hooks de Claude Code ${cambio ? "registrados" : "ya estaban registrados"} en ${settings} (UserPromptSubmit y SessionEnd).`,
          "",
          "Servidor MCP (una línea, una sola vez; si ya había uno, quitálo antes con: claude mcp remove --scope user flowbrain; el de antes del cambio de nombre se llamaba brain):",
          `  claude mcp add --scope user flowbrain -- ${cmd} serve --sync --root ${comillas(raiz)}`,
        ];
        return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (arg) throw new ConsultaError("parametro_invalido", `subcomando desconocido: cerebros ${arg}`);
      return { codigo: 0, stdout: await listar(raiz), stderr: "" };
    }

    // Con un registro de cerebros, el resto de los comandos trabaja sobre uno: el pedido, o el del repo actual.
    // El hook elige el suyo más abajo, por el directorio que le manda Claude Code, y nunca falla.
    const raizRegistro = (await esRegistro(raiz)) ? raiz : null;
    if (comando === "coverage" && o.guide) return { codigo: 0, stdout: GUIA_ESTUDIO, stderr: "" };
    if (comando === "feature" && o.guide) return { codigo: 0, stdout: GUIA_FUNCIONALIDADES, stderr: "" };
    if (comando === "evidence") {
      // Con --guide, las instrucciones para el modelo que va a analizar; sin él, el informe.
      if (o.guide) return { codigo: 0, stdout: GUIA_ANALISIS, stderr: "" };
      if (!raizRegistro) throw new ConsultaError("parametro_invalido", `evidence necesita un registro: no hay ${ARCHIVO_REGISTRO} en ${raiz}`);
      const registro = await leerRegistro(raizRegistro);
      if (o.brain && !registro.cerebro(o.brain)) throw new ConsultaError("nodo_inexistente", `no existe el cerebro: ${o.brain}`);
      return { codigo: 0, stdout: stringifyCanonical(await evidencia(registro, o.brain)), stderr: "" };
    }
    if (comando === "connections") {
      if (!raizRegistro) throw new ConsultaError("parametro_invalido", `conexiones necesita un registro: no hay ${ARCHIVO_REGISTRO} en ${raiz}`);
      return { codigo: 0, stdout: stringifyCanonical(await crearMulti(raizRegistro, { cwd }).conexiones(o.brain)), stderr: "" };
    }
    if (raizRegistro && comando === "status" && !o.brain) {
      // Con varios cerebros y sin --brain: el estado de cada uno, en vez de pedir que elija.
      const registro = await leerRegistro(raiz);
      const propio = registro.deDirectorio(cwd);
      if (!propio && registro.cerebros.length > 1) {
        const carpetas = (o.repos ?? env.FLOWBRAIN_REPOS ?? "").split(":").filter(Boolean).map((d) => resolve(cwd, d));
        const todos = await Promise.all(registro.cerebros.map(async (c) => ({ nombre: c.nombre, e: await estado(c.raiz, carpetas) })));
        const codigo = todos.some((t) => t.e.desactualizado) ? 1 : 0;
        if (o.json) return { codigo, stdout: stringifyCanonical(Object.fromEntries(todos.map((t) => [t.nombre, t.e]))), stderr: "" };
        return { codigo, stdout: todos.map((t) => `== ${t.nombre} ==\n${textoEstado(t.e)}`).join("\n"), stderr: "" };
      }
    }
    if (raizRegistro && comando !== "hook") {
      const registro = await leerRegistro(raiz);
      const c = o.brain ? registro.cerebro(o.brain) : (registro.deDirectorio(cwd) ?? (registro.cerebros.length === 1 ? registro.cerebros[0]! : null));
      if (!c) throw new ConsultaError("parametro_invalido", o.brain ? `no existe el cerebro: ${o.brain}` : `hay varios cerebros (${registro.cerebros.map((x) => x.nombre).join(", ")}); elegí uno con --brain`);
      raiz = c.raiz;
    } else if (o.brain) throw new ConsultaError("parametro_invalido", `--brain necesita un registro: no hay ${ARCHIVO_REGISTRO} en ${raiz}`);

    if (comando === "compile") {
      const { salidas, escritos } = await compileDirConVisor(raiz);
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

    if (comando === "sync" || comando === "status" || comando === "doctor") {
      const carpetas = (o.repos ?? env.FLOWBRAIN_REPOS ?? "").split(":").filter(Boolean).map((d) => resolve(cwd, d));
      if (comando === "sync") {
        const r = await sync(raiz, { carpetas, forzar: o.force === true });
        const lineas = [
          ...r.repos.map((x) => `${x.repo}: ${x.reindexado ? "reindexado" : x.estado === "sin clon" ? "sin clon (no se reindexó)" : "al día"}`),
          r.repos.length ? (r.compilados ? `compilado: ${r.compilados.length} archivos cambiaron` : "sin cambios: no hizo falta compilar") : "no hay repos indexados (corré flowbrain index <ruta-repo>)",
        ];
        return { codigo: r.repos.some((x) => x.estado === "sin clon") ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (comando === "status") {
        const e = await estado(raiz, carpetas);
        return { codigo: e.desactualizado ? 1 : 0, stdout: o.json ? stringifyCanonical(e) : textoEstado(e), stderr: "" };
      }
      const cs = await doctor(raiz, { carpetas, ...(o.settings !== undefined ? { settings: resolve(cwd, o.settings) } : {}) });
      return { codigo: cs.every((c) => c.ok) ? 0 : 1, stdout: cs.map((c) => `${c.ok ? "ok   " : "falta"} ${c.que}: ${c.detalle}`).join("\n") + "\n", stderr: "" };
    }

    if (comando === "promote") {
      const r = await promover(raiz, { ids: positionals.slice(1), todos: o.all === true, escribir: o.write === true, pisar: o.overwrite === true });
      const fila = (c: { origen: string; destino: string; estado: string }) => `  ${c.origen} → ${c.destino} (${c.estado})`;
      const lineas = o.write
        ? [
            ...(r.movidos.length ? [`promovidos ${r.movidos.length}:`, ...r.movidos.map(fila)] : []),
            ...(r.salteados.length ? ["sin mover:", ...r.salteados.map((c) => `${fila(c)}: ${c.motivo}`)] : []),
            ...(r.errores.length ? ["no se promovió nada; errores:", ...r.errores.map((e) => `  ${e}`)] : []),
            ...(!r.movidos.length && !r.salteados.length && !r.errores.length ? ["nada para promover (pasá ids o --all)"] : []),
          ]
        : [
            ...(r.candidatos.length ? [`borradores (${r.candidatos.length}):`, ...r.candidatos.map(fila), "promové con: flowbrain promote <id...> --write (o --all --write)"] : ["no hay borradores en _drafts/"]),
            ...r.errores,
          ];
      return { codigo: r.errores.length ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "draft") {
      if (!arg) throw new ConsultaError("parametro_invalido", "falta <ruta-repo>");
      const r = await draftDir(resolve(cwd, arg), raiz, o.repo !== undefined ? { repo: o.repo } : {});
      const { paginas, relaciones, preguntas, tablas, externos, funcionalidades } = r.resumen;
      const lineas = [
        `borradores de ${r.repo}: ${paginas} páginas (${funcionalidades} funcionalidades, ${tablas} tablas y ${externos} externos propuestos), ${relaciones} relaciones nuevas, ${preguntas} preguntas abiertas; ${r.escritos.length} archivos escritos`,
        ...r.escritos.map((e) => `  ${e}`),
        `revisá _drafts/${r.repo}/ y _drafts/product/ (o pasale PROMPT.md a un agente), movelos a technology/ y product/ y corré flowbrain index + flowbrain compile`,
      ];
      return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "verify") {
      const clones: Record<string, string> = {};
      for (const c of o.clone ?? []) {
        const i = c.indexOf("=");
        if (i <= 0) throw new ConsultaError("parametro_invalido", `--clone espera <repo-id>=<ruta>, llegó "${c}"`);
        clones[c.slice(0, i)] = resolve(cwd, c.slice(i + 1));
      }
      const carpetas = (o.repos ?? env.FLOWBRAIN_REPOS ?? "").split(":").filter(Boolean).map((d) => resolve(cwd, d));
      // Sin `--clone` para un repo, vale el clon que registró `flowbrain index`.
      for (const r of await reposIndexados(raiz, carpetas)) if (r.clon && !clones[r.repo]) clones[r.repo] = r.clon;
      const hoy = o.today ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) throw new ConsultaError("parametro_invalido", "--today debe ser AAAA-MM-DD");
      const r = await verifyDir(raiz, { repos: clones, carpetas, hoy, dias: entero(o.days, "--days") ?? 90 });
      const ev = (d: { desde: string; verbo: string; hasta: string; evidencia: string; motivo: string }) => `  ${d.desde} ${d.verbo} ${d.hasta} — ${d.evidencia}: ${d.motivo}`;
      const lineas = [
        `verificadas ${r.verificadas} aristas: ${r.dudosas.length} dudosas (${r.nuevas.length} nuevas, ${r.recuperadas.length} recuperadas)`,
        ...(r.nuevas.length ? ["nuevas dudosas:", ...r.nuevas.map(ev)] : []),
        ...(r.recuperadas.length ? ["recuperadas:", ...r.recuperadas.map(ev)] : []),
        ...(r.noVerificables.length ? [`sin clon local (no verificadas): ${r.noVerificables.map((x) => `${x.repo} (${x.aristas})`).join(", ")}`] : []),
        ...(r.sinVerificar.length
          ? [
              `nodos sin verificar en ${entero(o.days, "--days") ?? 90} días (${r.sinVerificar.length}): ${r.sinVerificar
                .slice(0, 20)
                .map((n) => n.id)
                .join(", ")}${r.sinVerificar.length > 20 ? `, … (+${r.sinVerificar.length - 20} más)` : ""}`,
            ]
          : []),
      ];
      return { codigo: r.nuevas.length > 0 ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "gen") {
      if (!arg || !(DESTINOS as readonly string[]).includes(arg)) throw new ConsultaError("parametro_invalido", `destino inválido: ${arg ?? "(falta)"}; usá ${DESTINOS.join(" | ")}`);
      const ctx = await cargarContexto(raiz);
      const dir = resolve(cwd, o.repo !== undefined && !ctx.nodo.has(o.repo) ? o.repo : ".");
      const repo = repoDe(ctx, o.repo !== undefined && ctx.nodo.has(o.repo) ? o.repo : await nombreRepo(dir));
      const r = generarReglas(arg as Destino, ctx, repo);
      if (!o.write) return { codigo: 0, stdout: r.contenido, stderr: repo ? "" : "flowbrain gen: el repo no está en el brain; se genera el bloque genérico\n" };
      const cambio = await escribirReglas(dir, r);
      return { codigo: 0, stdout: `${cambio ? "escrito" : "sin cambios"}: ${r.ruta}${repo ? ` (${repo.id})` : " (sin nodo de repo)"}\n`, stderr: "" };
    }

    if (comando === "note") {
      const texto = positionals.slice(2).join(" ").trim();
      if (!arg || !texto) throw new ConsultaError("parametro_invalido", "uso: flowbrain note <nodo> <texto>");
      const escritos = await anotar(raiz, [{ id: arg, texto }], "manual");
      return { codigo: 0, stdout: escritos.length ? `nota agregada: ${escritos.join(", ")}\n` : "la nota ya existía\n", stderr: "" };
    }

    if (comando === "hook") {
      if (arg !== "claude-code") return { codigo: 2, stdout: "", stderr: `hook desconocido: ${arg ?? ""}\n` };
      try {
        const entrada = JSON.parse((await stdin()) || "{}") as { prompt?: string; cwd?: string; hook_event_name?: string; session_id?: string; transcript_path?: string };
        // Sin raíz explícita manda la carpeta de la sesión: su `.flowbrain`, o nada si no está dentro de un proyecto.
        const regHook = explicita ? raizRegistro : entrada.cwd ? await buscarRegistro(entrada.cwd) : raizRegistro;
        if (!explicita && !regHook && !(await stat(join(raiz, "_build/graph.json")).then(() => true, () => false))) return { codigo: 0, stdout: "", stderr: "" };
        if (regHook) {
          // Solo el cerebro del repo donde se está trabajando; fuera de todo repo conocido, nada.
          const c = entrada.cwd ? (await leerRegistro(regHook)).deDirectorio(entrada.cwd) : null;
          if (!c) return { codigo: 0, stdout: "", stderr: "" };
          raiz = c.raiz;
        }
        if (entrada.hook_event_name === "SessionEnd") {
          const escritos = await hookSessionEnd(entrada, raiz);
          return { codigo: 0, stdout: "", stderr: escritos.length ? `brain: notas guardadas en ${escritos.join(", ")}\n` : "" };
        }
        const budget = o.budget === undefined ? BUDGET_HOOK : (entero(o.budget, "--budget") ?? BUDGET_HOOK);
        return { codigo: 0, stdout: await hookUserPromptSubmit(entrada, () => cargarContexto(raiz), budget), stderr: "" };
      } catch (e) {
        // Un hook roto nunca debe bloquear el prompt del usuario.
        return { codigo: 0, stdout: "", stderr: `flowbrain hook: ${(e as Error).message}\n` };
      }
    }

    const budget = o.budget === undefined ? undefined : o.budget === "none" ? null : entero(o.budget, "--budget");
    const comunes = {
      ...(o.projection !== undefined ? { proyeccion: o.projection as Proyeccion } : {}),
      ...(budget !== undefined ? { budget_tokens: budget } : {}),
    };
    const ctx: Contexto = await cargarContexto(raiz);
    let resultado: unknown;
    switch (comando) {
      case "search":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <texto>");
        resultado = buscarNodo(ctx, { texto: arg, ...opt("tipos", lista(o.types)), ...opt("limite", entero(o.limit, "--limit")), ...comunes });
        break;
      case "traverse":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <nodo>");
        resultado = recorrerGrafo(ctx, {
          nodo: arg,
          ...opt("verbos", lista(o.verbs)),
          ...opt("direccion", o.direction as "out" | "in" | "both" | undefined),
          ...opt("profundidad", entero(o.depth, "--depth")),
          ...comunes,
        });
        break;
      case "contract":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <nodo>");
        resultado = contratoDe(ctx, { nodo: arg, ...opt("endpoint", o.endpoint), ...comunes });
        break;
      case "trace": {
        const desde = o.from ?? arg;
        if (!desde) throw new ConsultaError("parametro_invalido", "falta --from");
        resultado = trazar(ctx, { desde, ...opt("hasta", o.to), ...comunes });
        break;
      }
      case "feature":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <id>");
        resultado = funcionalidad(ctx, { id: arg, ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "flow":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <endpoint o símbolo>");
        resultado = recorrido(ctx, { desde: arg, ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "screen":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta </ruta>");
        resultado = pantalla(ctx, { ruta: arg, ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "callers":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <símbolo>");
        resultado = quienLlama(ctx, { simbolo: arg, ...opt("profundidad", entero(o.depth, "--depth")), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "impact":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <pieza>");
        resultado = impactoDe(ctx, { pieza: arg, ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "risk": {
        const diff = o.diff === undefined ? undefined : o.diff === "-" ? await stdin() : await readFile(resolve(cwd, o.diff), "utf8");
        const archivos = positionals.slice(1);
        resultado = riesgo(ctx, { ...opt("diff", diff), ...(archivos.length ? { archivos } : {}), ...opt("repo", o.repo), ...opt("profundidad", entero(o.depth, "--depth")), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      }
      case "parity":
        if (!arg || !positionals[2]) throw new ConsultaError("parametro_invalido", "uso: flowbrain parity <svc-viejo> <svc-nuevo>");
        resultado = paridad(ctx, { viejo: arg, nuevo: positionals[2], ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "fidelity":
        resultado = fidelidad(ctx, {
          ...opt("archivo", arg),
          ...opt("min", entero(o.min, "--min")),
          ...opt("max", entero(o.max, "--max")),
          ...opt("funcionalidad", o.feature),
          ...opt("tipo", o.type),
          ...opt("señal", o.signal),
          ...opt("limite", entero(o.limit, "--limit")),
          ...opt("budget_tokens", comunes.budget_tokens),
        });
        break;
      case "calls": {
        // Dónde se cortan los recorridos por llamadas sin tipo, y qué hay declarado en calls.yaml.
        const decl = await readFile(join(raiz, ARCHIVO_LLAMADAS), "utf8").then(leerLlamadasDeclaradas, () => null);
        resultado = {
          ...llamadasPorResolver(ctx, { ...opt("limite", entero(o.limit, "--limit")), ...(decl ? { declaradas: decl.llamadas } : {}) }),
          ...(decl?.http.length ? { httpDeclaradas: decl.http.length } : {}),
          ...(decl?.rechazadas.length ? { malFormadas: decl.rechazadas } : {}),
        };
        break;
      }
      case "coverage": {
        // Qué parte del código quedó conectada, cómo anduvo cada extractor del proyecto y si los controles siguen saliendo.
        const controles = await readFile(join(raiz, ARCHIVO_CONTROLES), "utf8").then(leerControles, () => null);
        const dirE = join(raiz, "_build/extractors");
        const extractores = (
          await Promise.all((await readdir(dirE).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort().map((n) => readFile(join(dirE, n), "utf8").then((t) => JSON.parse(t) as { repo: string; extractores: Array<Omit<InformeExtractorBreve, "repo">> })))
        ).flatMap((j) => j.extractores.map((e) => ({ ...e, repo: j.repo })));
        const decl = await readFile(join(raiz, ARCHIVO_LLAMADAS), "utf8").then(leerLlamadasDeclaradas, () => null);
        resultado = {
          ...cobertura(ctx, { ...(controles ? { controles: controles.controles } : {}), extractores, ...(decl ? { declaradas: decl.llamadas } : {}) }),
          ...(decl ? { declaradasEnCalls: { llamadas: decl.llamadas.length, http: decl.http.length } } : {}),
          ...(controles?.malFormados.length ? { controlesMalFormados: controles.malFormados } : {}),
        };
        break;
      }
      case "drift":
        resultado = deriva(ctx, { ...opt("nodo", arg), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "infra":
        resultado = infra(ctx, { ...opt("nodo", arg), ...opt("texto", o.text), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "eval": {
        const archivo = resolve(raiz, arg ?? "evals/questions.json");
        const r = evaluar(ctx, leerPreguntas(await readFile(archivo, "utf8")));
        const minimo = o.min === undefined ? null : Number(o.min);
        if (minimo !== null && Number.isNaN(minimo)) throw new ConsultaError("parametro_invalido", "--min debe ser un número");
        return { codigo: minimo !== null && r.porcentaje < minimo ? 1 : 0, stdout: stringifyCanonical(r), stderr: `${r.aciertos}/${r.total} correctas (${r.porcentaje}%), cobertura de lo esperado ${r.cobertura}%${r.sinPreguntas.length ? `; sin preguntas: ${r.sinPreguntas.join(", ")}` : ""}\n` };
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

// npx y `npm i -g` invocan el bin a través de un symlink: se compara contra la ruta real.
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const esMain = process.argv[1] !== undefined && real(fileURLToPath(import.meta.url)) === real(process.argv[1]);
if (esMain && process.argv[2] === "serve") {
  const { servir } = await import("@flowbrain/mcp");
  await servir(process.argv.slice(3), process.env, (raiz) => sync(raiz, { carpetas: (process.env.FLOWBRAIN_REPOS ?? "").split(":").filter(Boolean) }));
} else if (esMain) {
  // Solo se pregunta cuando hay una persona del otro lado.
  const interactivo = !!(process.stdin.isTTY && process.stdout.isTTY);
  const preguntar = interactivo ? async (q: string) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question(q); } finally { rl.close(); }
  } : undefined;
  const args = process.argv.slice(2);
  if (interactivo && (args.length === 0 || (args.length === 1 && args[0] === "menu"))) {
    // Sin argumentos y con una persona del otro lado: el menú.
    const { menu, terminal } = await import("./menu.js");
    await menu(process.cwd(), terminal((a, cwd) => ejecutar(a, process.env, cwd, leerStdin, preguntar)), { forzarMenu: args[0] === "menu" });
    process.exit(0);
  }
  const r = await ejecutar(args, process.env, process.cwd(), leerStdin, preguntar);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.codigo;
}

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
  especificaciones,
  fidelidad,
  sinAsociar,
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
import { aplicar, type ResultadoCerebro, ARCHIVO_VISOR, asegurarGitignore, crearRegistro, encontrarRepos, escribirVisor, listar, proponer } from "./cerebros.js";
import { doctor, estado, reposIndexados, sync, textoEstado } from "./estado.js";
import { evidencia } from "./evidencia.js";
import { GUIA_ANALISIS, GUIA_ESPECIFICACIONES, GUIA_ESTUDIO, GUIA_FUNCIONALIDADES, GUIA_TESTS, NOMBRE_COMANDO, NOMBRE_ESPECIFICACIONES, NOMBRE_ESTUDIO, NOMBRE_FUNCIONALIDADES, NOMBRE_TESTS } from "./guia.js";
import { crearReporte, duracion, type Reporte } from "./progreso.js";
import { comandoBrain, comillas, init, instalarComando, instalarHooksClaudeCode, VERSION } from "./init.js";
import { promover } from "./promover.js";
import { idioma as idiomaDelMenu, L, resolverIdioma } from "./idioma.js";
import { escribirIndex, indexar } from "@flowbrain/parsers";

const AYUDA_EN = `flowbrain <command> [options]

Knowledge graph of the system for coding agents. Start with "flowbrain install" from the project folder.

Commands:
  (no command) | menu                       terminal menu: set up the project, run the full analysis with Claude
                                            Code, reindex, open the viewer, connect the MCP and update FlowBrain
  setup                                     gets the machine ready (command, hooks and Claude Code commands) without
                                            touching any project
  init [dir] [--claude-code]                creates a brain in dir (the current one by default) and compiles it;
                                            with --claude-code registers the hooks in ~/.claude/settings.json
  compile                                   compiles pages and JSON → _build/, INDEX.md, backlinks
  index <repo-path> [--repo <repo-id>]      runs the parsers and writes contracts, files and extraction to _build/
  draft <repo-path> [--repo <repo-id>]      drafts in _drafts/<repo>/ and features in _drafts/product/
                                            (does not touch technology/, product/ or _build/)
  install [folder] [--repos <dir>]          from a project: sets up the command and the Claude Code hooks, creates
          [--split | --single]              .flowbrain/, asks where the repos are and whether to use one brain per repo
                                            or all in one, and indexes everything; running it again updates it
  brains                                  lists the brains in the registry (flowbrain.yaml in --root) and their state
  brains propose <folder...>              explores folders and writes a draft flowbrain.yaml with open questions
  brains apply [name]                     creates and indexes the brains in the registry (or just one)
  brains viewer                           regenerates flowbrain.html (after changing communication or connections)
  viewer [--serve] [--port n]             regenerates flowbrain.html; with --serve serves it at http://127.0.0.1:4780 and
                                          lets you fix things from the Fidelity screen (add a file to a feature,
                                          declare calls in calls.yaml). It only writes brain files
  brains register                         registers the registry hooks in Claude Code and prints the MCP line
  evidence [--brain <name>] [--guide]       to decide which service each call goes to: by URL base, where it is
                                            defined and what it matches; --guide prints the instructions for the model
  connections [--brain <name>]             which calls travel between a brain and the brains it communicates with
  sync [--repos <dir>] [--force]           reindexes the repos whose clone moved since the last index and recompiles
  status [--repos <dir>] [--json]           repos up to date or not, graph counts and known gaps;
                                            exits with 1 if any repo is out of date
  doctor [--repos <dir>]                    diagnosis: graph, index, clones, registered hooks and MCP (read only)
  promote [id...] [--all] [--write]   moves reviewed drafts from _drafts/ to technology/ and product/ and compiles;
           [--overwrite]                        without --write it only lists; if the brain stops compiling, undoes everything
  verify [--repos <dir>] [--clone id=path]   checks evidence against the local clones; marks doubtful ones
         [--days n] [--today YYYY-MM-DD]      exits with 1 if new doubtful ones appear (CI friendly)
  note <node> <text>                        adds a note to _drafts/notes/<node>.md
  gen claude|agents|cursor|windsurf         rules for the agent (CLAUDE.md, AGENTS.md, .cursor/rules, .windsurf/rules)
      [--repo <dir|repo-id>] [--write]   prints to stdout; with --write leaves them in the repo
  search <text> [--types a,b] [--limit n]
  traverse <node> [--verbs a,b] [--direction out|in|both] [--depth n]
  contract <node> [--endpoint "METHOD /path"]
  trace --from <node|URL|path|file> [--to <node>]
  feature <id|name> [--guide]         compact card: endpoints, consumption, data, relations, shared domain;
                                            --guide prints how to deduce and complete the features (for the model)
  specs [id|name] [--state propuesta|confirmada]     business and product specifications: with no argument, how many
        [--type negocio|producto] [--untested]      each feature has, its use cases (met or not) and how many test
        [--problems] [--findings] [--guide]         cases verify none; with a feature, each use case and each
                                                    requirement with its files and tests; --problems, only the use
                                                    cases a person marked as wrong; --findings, only the rules with a
                                                    finding (the code does not meet them or they cannot be tested);
                                            --guide-tests, how to write the missing tests and record them;
                                            --guide prints how to deduce them from the code and the tests (for the model);
  flow <"METHOD /path"|Class.method>   steps controller → service → repository, with what each one touches
  screen </path|Component>                a front-end screen end to end: how you get there, where it leads, what it calls on the back end
  callers <Class.method|Class> [--depth n]
  impact <piece>                           what is affected if a table, endpoint, service, feature or symbol changes
  risk [file...] [--diff <file|->]        scope of a change: from a diff (git diff | flowbrain risk --diff -) or touched
         [--repo <repo-id>]                 files, which features, endpoints, screens, tables and repos it reaches
  parity <old-svc> <new-svc>               what is left to migrate from one service to another: endpoints, screens and
                                            tables; with several brains each side can be brain/svc-x, or brain if it has one
  coverage                                  how much of the code got connected: screens with calls, calls with a
                                            path, endpoints with a method that reach a table, accesses with columns;
                                            plus the report of the project's extractors and the checks (checks.yaml)
  fidelity [file] [--min n] [--max n]       how well each file was understood, from 0 to 100, and what it is missing
           [--feature id|ninguna]           (with its line): unresolved calls, HTTP without a path, accesses without
           [--type ext] [--signal s]        columns, endpoints without a flow or a response, screens without calls.
           [--limit n] [--plan]             Lists from lowest to highest; with a file, its detail. --uncertain lists
           [--uncertain]                    the ones with uncertain fidelity (nothing to measure: no score and not in
                                            the average). With --plan, a text plan for a model to bring those files to 100
  unassigned [folder] [--feature id|ninguna]  files that belong to no feature or library, by folder, with the
             [--limit n]                    recommended feature and the reason; marks shared code
  calls [--limit n]                         where the flows break: endpoints that do not reach a table and the untyped
                                            calls on their way, with candidates; they are resolved by declaring them
                                            in calls.yaml (brain root) and reindexing
  drift [svc]                              calls no endpoint serves and endpoints nobody calls; with several brains
                                            it cross-references: what another connected brain serves or calls is not drift
  infra [node] [--text <t>]                images, compose, pipelines, variables, proxy, Kubernetes, Helm, Terraform and serverless
  eval [file] [--min pct]             runs questions with a known answer (evals/questions.json by default)
                                            and gives the hit rate; exits with 1 if it falls below --min
  context --prompt <text> [--repo <dir>]    context to inject into a prompt (default budget 1500)
  hook claude-code                          UserPromptSubmit and SessionEnd hooks: reads Claude Code's JSON from stdin
  serve [--sync]                            MCP server over stdio; with --sync reindexes only when a clone moved

Common options:
  --root <dir>          brain root, or folder with flowbrain.yaml (by default $FLOWBRAIN_ROOT, the .flowbrain of the
                        project you are in, or the current directory)
  --brain <name>      with several brains, which one to use (by default, the one of the repo you are in)
  --projection <p>      resumen | relaciones | contrato | completo
  --budget <n|none>     token budget (2000 by default)
  --lang <en|es>        language of the messages (English by default); FLOWBRAIN_LANG=es, the preference saved
                        by the menu, or lang: es in flowbrain.yaml also work
`;

const AYUDA_ES = `flowbrain <comando> [opciones]

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
  viewer [--serve] [--port n]             regenera flowbrain.html; con --serve lo sirve en http://127.0.0.1:4780 y deja
                                          corregir desde la pantalla Fidelidad (sumar un archivo a una funcionalidad,
                                          declarar llamadas en calls.yaml). Solo escribe archivos del cerebro
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
  specs [id|nombre] [--state propuesta|confirmada]   especificaciones de negocio y de producto: sin argumento, cuántas tiene
        [--type negocio|producto] [--untested]      cada funcionalidad, sus casos de uso (cumplidos o no) y cuántos casos de
        [--problems] [--findings] [--guide]         test no verifican ninguna; con una funcionalidad, cada caso de uso y
                                                    cada requisito con sus archivos y sus tests; --problems, solo los
                                                    casos de uso que una persona marcó como mal; --findings, solo las
                                                    reglas con hallazgo (el código no las cumple o no se pueden testear);
                                            --guide-tests, cómo escribir los tests que faltan y anotarlos;
                                            --guide imprime cómo deducirlas del código y de los tests (para el modelo);
  flow <"MÉTODO /ruta"|Clase.metodo>   pasos controller → servicio → repositorio, con lo que toca cada uno
  screen </ruta|Componente>               pantalla del front de punta a punta: de dónde se llega, a dónde lleva, qué llama del back
  callers <Clase.metodo|Clase> [--depth n]
  impact <pieza>                           qué se ve afectado si cambia una tabla, endpoint, servicio, feat o símbolo
  risk [archivo...] [--diff <archivo|->]  alcance de un cambio: desde un diff (git diff | flowbrain risk --diff -) o archivos
         [--repo <repo-id>]                 tocados, qué funcionalidades, endpoints, pantallas, tablas y repos alcanza
  parity <svc-viejo> <svc-nuevo>           qué falta migrar de un servicio a otro: endpoints, pantallas y tablas; con
                                            varios cerebros cada lado puede ser cerebro/svc-x, o cerebro si tiene uno solo
  coverage                                  cuánto del código quedó conectado: pantallas con llamadas, llamadas con
                                            ruta, endpoints con método y que llegan a una tabla, accesos con columnas;
                                            más el informe de los extractores del proyecto y los controles (checks.yaml)
  fidelity [archivo] [--min n] [--max n]    qué tan entendido quedó cada archivo, de 0 a 100, y qué le falta (con su
           [--feature id|ninguna]           línea): llamadas sin resolver, HTTP sin ruta, accesos sin columnas, endpoints
           [--type ext] [--signal s]        sin recorrido o sin respuesta, pantallas sin llamadas. Lista de menor a
           [--limit n] [--plan]             mayor; con un archivo, su detalle. --uncertain lista los de fidelidad
           [--uncertain]                    incierta (sin nada que medir: no tienen puntaje ni entran al promedio). Con
                                            --plan, un plan en texto para que un modelo lleve esos archivos a 100
  unassigned [carpeta] [--feature id|ninguna]  archivos que no son de ninguna funcionalidad ni librería, por carpeta, con
             [--limit n]                    la funcionalidad recomendada y el motivo; marca el código compartido
  calls [--limit n]                         dónde se cortan los recorridos: endpoints que no llegan a una tabla y las
                                            llamadas sin tipo que hay en su camino, con candidatos; se resuelven
                                            declarándolas en calls.yaml (raíz del brain) y reindexando
  drift [svc]                              llamadas que ningún endpoint atiende y endpoints que nadie llama; con varios
                                            cerebros cruza: lo que atiende o llama otro cerebro comunicado no es deriva
  infra [nodo] [--text <t>]                imágenes, compose, pipelines, variables, proxy, Kubernetes, Helm, Terraform y serverless
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
  --lang <en|es>        idioma de los mensajes (por defecto inglés); también FLOWBRAIN_LANG=es, la preferencia que
                        guarda el menú, o lang: es en flowbrain.yaml
`;

const ayuda = () => L(AYUDA_EN, AYUDA_ES);

type Salida = { codigo: number; stdout: string; stderr: string };

const lista = (v: string | undefined) => (v === undefined ? undefined : v.split(",").map((s) => s.trim()).filter(Boolean));
const entero = (v: string | undefined, nombre: string) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ConsultaError("parametro_invalido", L(`${nombre} must be an integer`, `${nombre} debe ser entero`));
  return n;
};

/** La línea que informa los hooks de Claude Code. */
const lineaHooks = (cambio: boolean, settings: string) =>
  L(
    `Claude Code hooks ${cambio ? "registered" : "were already registered"} in ${settings} (UserPromptSubmit and SessionEnd).`,
    `Hooks de Claude Code ${cambio ? "registrados" : "ya estaban registrados"} en ${settings} (UserPromptSubmit y SessionEnd).`,
  );

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
  const comandoSpecs = join(comandos, `${NOMBRE_ESPECIFICACIONES}.md`);
  await writeFile(comandoEstudio, GUIA_ESTUDIO, "utf8");
  await writeFile(comandoSpecs, GUIA_ESPECIFICACIONES, "utf8");
  const comandoTests = join(comandos, `${NOMBRE_TESTS}.md`);
  await writeFile(comandoTests, GUIA_TESTS, "utf8");
  return [
    ...(bin
      ? [
          L(
            `flowbrain command at ${bin.archivo}${bin.enPath ? "" : ` (that folder is not in your PATH: add export PATH="${dirname(bin.archivo)}:$PATH" to your ~/.zshrc)`}.`,
            `Comando flowbrain en ${bin.archivo}${bin.enPath ? "" : ` (esa carpeta no está en tu PATH: agregá export PATH="${dirname(bin.archivo)}:$PATH" a tu ~/.zshrc)`}.`,
          ),
        ]
      : []),
    lineaHooks(cambio, settings),
    L(`/${NOMBRE_COMANDO} command for Claude Code at ${comandoCC}: indexes the project and analyzes the real communication between services.`, `Comando /${NOMBRE_COMANDO} para Claude Code en ${comandoCC}: indexa el proyecto y analiza la comunicación real entre servicios.`),
    L(`/${NOMBRE_FUNCIONALIDADES} command at ${comandoFeat}: deduces and completes the product features of each brain.`, `Comando /${NOMBRE_FUNCIONALIDADES} en ${comandoFeat}: deduce y completa las funcionalidades de producto de cada cerebro.`),
    L(`/${NOMBRE_ESTUDIO} command at ${comandoEstudio}: studies how each repo is built and writes the extractors that complete the index.`, `Comando /${NOMBRE_ESTUDIO} en ${comandoEstudio}: estudia cómo está hecho cada repo y escribe los extractores que completan el índice.`),
    L(`/${NOMBRE_ESPECIFICACIONES} command at ${comandoSpecs}: deduces the business and product specifications of each feature.`, `Comando /${NOMBRE_ESPECIFICACIONES} en ${comandoSpecs}: deduce las especificaciones de negocio y de producto de cada funcionalidad.`),
    L(`/${NOMBRE_TESTS} command at ${comandoTests}: writes the missing tests for the specifications and records them in each rule.`, `Comando /${NOMBRE_TESTS} en ${comandoTests}: escribe los tests que faltan para las especificaciones y los anota en cada regla.`),
  ];
}

export async function ejecutar(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  stdin: () => Promise<string> = async () => "",
  /** Para preguntarle al usuario en una terminal; sin esto, los comandos usan sus valores por defecto. */
  preguntar?: (pregunta: string) => Promise<string>,
  /** Dónde mostrar el progreso de un reindexado (`brains apply`, `install`, `sync`); sin esto, no se muestra. */
  reporte?: Reporte,
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
        serve: { type: "boolean" },
        port: { type: "string" },
        max: { type: "string" },
        feature: { type: "string" },
        type: { type: "string" },
        signal: { type: "string" },
        state: { type: "string" },
        untested: { type: "boolean" },
        problems: { type: "boolean" },
        findings: { type: "boolean" },
        uncertain: { type: "boolean" },
        plan: { type: "boolean" },
        text: { type: "string" },
        diff: { type: "string" },
        write: { type: "boolean" },
        guide: { type: "boolean" },
        "guide-tests": { type: "boolean" },
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
        lang: { type: "string" },
      },
    });
  } catch (e) {
    await resolverIdioma({ env, cwd });
    return { codigo: 2, stdout: "", stderr: `${(e as Error).message}\n\n${ayuda()}` };
  }
  const { values: o, positionals } = parsed;
  await resolverIdioma({ ...opt("flag", o.lang), env, cwd });
  const [comando, arg] = positionals;
  if (o.version) return { codigo: 0, stdout: `${VERSION}\n`, stderr: "" };
  if (comando === "help") return { codigo: 0, stdout: ayuda(), stderr: "" };
  if (comando === "menu") return { codigo: 2, stdout: "", stderr: L("the menu needs an interactive terminal; without one, use the commands (flowbrain help)\n", "el menú necesita una terminal interactiva; sin ella, usá los comandos (flowbrain help)\n") };
  if (o.help || !comando) return { codigo: comando || o.help ? 0 : 2, stdout: ayuda(), stderr: "" };
  // Sin --root ni $FLOWBRAIN_ROOT: el `.flowbrain` del proyecto donde se está parado (en esta carpeta o por encima).
  const explicita = o.root ?? env.FLOWBRAIN_ROOT;
  let raiz = resolve(cwd, explicita ?? (await buscarRegistro(cwd)) ?? ".");
  // Con progreso, cada cerebro dice lo que tardó; sin él (tests, otros programas) la salida no cambia entre corridas.
  const resumenCerebro = (r: ResultadoCerebro) => [
    L(
      `${r.nombre}${r.curado ? "" : " (not curated)"}: ${r.nodos} nodes, ${r.relaciones} relations; ${r.promovidas} pages created, ${r.borradores} drafts to review${reporte ? ` (${duracion(r.ms)})` : ""}`,
      `${r.nombre}${r.curado ? "" : " (sin curar)"}: ${r.nodos} nodos, ${r.relaciones} relaciones; ${r.promovidas} páginas creadas, ${r.borradores} borradores para revisar${reporte ? ` (${duracion(r.ms)})` : ""}`,
    ),
    ...r.repos.map((x) => `  ${x.repo ?? L("(not indexed)", "(sin indexar)")} ← ${x.ruta}${x.error ? `: ${x.error}` : ""}`),
    ...r.errores.slice(0, 10).map((e) => L(`  did not compile and stayed as a draft: ${e}`, `  no compiló y quedó como borrador: ${e}`)),
    ...(r.errores.length > 10 ? [L(`  … and ${r.errores.length - 10} more`, `  … y ${r.errores.length - 10} más`)] : []),
  ];
  // En una terminal, el resumen de cada cerebro aparece apenas termina; si no, va todo junto por stdout al final.
  const enVivo = reporte?.resumenEnVivo === true;
  const aplicarConProgreso = (registro: Awaited<ReturnType<typeof leerRegistro>>, solo?: string) =>
    aplicar(registro, solo, reporte ? { progreso: reporte.progreso, ...(enVivo ? { alTerminar: (r: ResultadoCerebro) => reporte.linea(resumenCerebro(r).join("\n")) } : {}) } : {});
  /** Tiempo total y los repos que fallaron (los demás siguieron). Solo con progreso. */
  const lineaTotal = (inicio: number, fallidos: string[]) =>
    reporte
      ? [
          L(`Done in ${duracion(Date.now() - inicio)}.`, `Listo en ${duracion(Date.now() - inicio)}.`) +
            (fallidos.length ? L(` ${fallidos.length} repo(s) failed and the rest went on: ${fallidos.join(", ")} (details above).`, ` Fallaron ${fallidos.length} repo(s) y los demás siguieron: ${fallidos.join(", ")} (detalle arriba).`) : ""),
        ]
      : [];
  const fallidosDe = (rs: ResultadoCerebro[]) => rs.flatMap((r) => r.repos.filter((x) => x.error).map((x) => `${r.nombre}/${x.repo ?? basename(x.ruta)}`));
  const resumenAplicar = (rs: ResultadoCerebro[], visor: string | null, inicio?: number) => [
    ...(enVivo ? [] : rs.flatMap(resumenCerebro)),
    ...(visor ? [L(`viewer for all brains: ${visor}`, `visor de todos los cerebros: ${visor}`)] : []),
    ...(inicio !== undefined ? lineaTotal(inicio, fallidosDe(rs)) : []),
  ];
  const fallo = (rs: Awaited<ReturnType<typeof aplicar>>) => rs.some((r) => r.repos.some((x) => x.error) || r.nodos === 0);

  try {
    if (comando === "init") {
      const r = await init(resolve(cwd, arg ?? "."), { claudeCode: o["claude-code"] === true, ...(o.settings !== undefined ? { settings: resolve(cwd, o.settings) } : {}), env });
      const lineas = [
        L(`brain ready at ${r.raiz}`, `brain listo en ${r.raiz}`),
        ...r.creados.map((c) => `  ${c}`),
        "",
        L("MCP server (one line, only once):", "Servidor MCP (una línea, una sola vez):"),
        `  ${r.mcp}`,
        "",
        r.hooks
          ? lineaHooks(r.hooks.cambio, r.hooks.settings)
          : L("Claude Code hooks: run it again with --claude-code to register them in ~/.claude/settings.json.", "Hooks de Claude Code: repetí con --claude-code para registrarlos en ~/.claude/settings.json."),
        "",
        L(`Next: ${r.comando} draft /path/to/a/repo --root ${r.raiz}`, `Siguiente: ${r.comando} draft /ruta/a/un/repo --root ${r.raiz}`),
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
        const resp = o.repos ?? (preguntar ? (await preguntar(L(`Which folder are the repositories in? (Enter: ${proyecto}) `, `¿En qué carpeta están los repositorios? (Enter: ${proyecto}) `))).trim() : "");
        const carpeta = resolve(proyecto, resp || ".");
        if (!(await stat(carpeta).then((x) => x.isDirectory(), () => false))) throw new ConsultaError("parametro_invalido", L(`folder does not exist: ${carpeta}`, `no existe la carpeta: ${carpeta}`));
        // Una carpeta con código pero sin repos adentro: ella misma es el repo.
        const encontrados = await encontrarRepos(carpeta);
        const rutas = encontrados.length ? encontrados : [carpeta];
        let dividir = false;
        if (rutas.length > 1) {
          if (rutas.length > MAX_CEREBROS) lineas.push(L(`There are ${rutas.length} repos and the maximum is ${MAX_CEREBROS} brains: they all go in one; group them in ${join(reg, ARCHIVO_REGISTRO)}.`, `Hay ${rutas.length} repos y el máximo es ${MAX_CEREBROS} cerebros: quedan todos en uno; agrupalos en ${join(reg, ARCHIVO_REGISTRO)}.`));
          else if (o.split || o.single) dividir = o.split === true;
          else if (preguntar) {
            const r = (await preguntar(L(`Found ${rutas.length}: ${rutas.map((x) => basename(x)).join(", ")}.\nOne brain for each (1) or all in the same brain (2)? (Enter: 1) `, `Encontré ${rutas.length}: ${rutas.map((x) => basename(x)).join(", ")}.\n¿Un cerebro por cada uno (1) o todos en un mismo cerebro (2)? (Enter: 1) `))).trim();
            dividir = r !== "2";
          } else dividir = true;
        }
        const c = await crearRegistro(reg, proyecto, rutas, dividir);
        lineas.push(
          L(
            `registry created at ${c.archivo}: ${c.repos.length} ${c.repos.length === 1 ? "repo" : "repos"} in ${c.cerebros.length === 1 ? "one brain" : `${c.cerebros.length} brains`}`,
            `registro creado en ${c.archivo}: ${c.repos.length} ${c.repos.length === 1 ? "repo" : "repos"} en ${c.cerebros.length === 1 ? "un cerebro" : `${c.cerebros.length} cerebros`}`,
          ),
          ...c.repos.map((x) => `  ${x.nombre}: ${[...x.pila, ...x.lenguajes].join(", ") || L("no recognized code", "sin código reconocido")}; ${L(`${x.endpoints} endpoints, ${x.pantallas} screens, ${x.tablas} tables`, `${x.endpoints} endpoints, ${x.pantallas} pantallas, ${x.tablas} tablas`)}`),
        );
        await asegurarGitignore(reg);
      } else lineas.push(L(`existing registry at ${join(reg, ARCHIVO_REGISTRO)}: updating it`, `registro existente en ${join(reg, ARCHIVO_REGISTRO)}: se actualiza`));
      const registro = await leerRegistro(reg);
      const inicio = Date.now();
      const rs = await aplicarConProgreso(registro);
      const visor = await escribirVisor(registro, reporte?.progreso);
      reporte?.terminar();
      lineas.push(
        ...resumenAplicar(rs, visor, inicio),
        "",
        L(
          `To regroup the repos or turn off the communication between brains, edit ${join(reg, ARCHIVO_REGISTRO)} and run again: flowbrain install`,
          `Para reagrupar los repos o apagar la comunicación entre cerebros, editá ${join(reg, ARCHIVO_REGISTRO)} y volvé a correr: flowbrain install`,
        ),
        "",
        L("MCP server (once per machine; if you already registered it, no need):", "Servidor MCP (una sola vez por máquina; si ya lo registraste, no hace falta):"),
        "  claude mcp remove --scope user flowbrain",
        `  claude mcp add --scope user flowbrain -- ${cmd} serve --sync`,
      );
      return { codigo: fallo(rs) ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "viewer") {
      if (!(await esRegistro(raiz))) throw new ConsultaError("parametro_invalido", L(`no ${ARCHIVO_REGISTRO} in ${raiz}: the viewer of a standalone brain is _build/viewer.html and flowbrain compile writes it`, `no hay ${ARCHIVO_REGISTRO} en ${raiz}: el visor de un brain suelto es _build/viewer.html y lo deja flowbrain compile`));
      // El servidor queda corriendo: lo arranca el punto de entrada, no este despachador (que devuelve y termina).
      if (o.serve) throw new ConsultaError("parametro_invalido", L("flowbrain viewer --serve runs directly from the terminal", "flowbrain viewer --serve se corre directo desde la terminal"));
      const visor = await escribirVisor(await leerRegistro(raiz));
      return { codigo: visor ? 0 : 1, stdout: visor ? `${visor}\n` : L("no brain is compiled: run flowbrain brains apply\n", "ningún cerebro está compilado: corré flowbrain brains apply\n"), stderr: "" };
    }
    if (comando === "brains") {
      if (arg === "propose") {
        const carpetas = positionals.slice(2).map((c) => resolve(cwd, c));
        if (!carpetas.length) throw new ConsultaError("parametro_invalido", L("usage: flowbrain brains propose <folder...> --root <registry folder>", "uso: flowbrain brains propose <carpeta...> --root <carpeta del registro>"));
        const r = await proponer(raiz, carpetas);
        const lineas = [
          L(`proposal at ${r.archivo}: ${r.repos.length} repos`, `propuesta en ${r.archivo}: ${r.repos.length} repos`),
          ...r.repos.map((x) =>
            L(
              `  ${x.nombre}: ${[...x.pila, ...x.lenguajes].join(", ") || "no recognized code"}; ${x.endpoints} endpoints, ${x.pantallas} screens, ${x.tablas} tables${x.bases.length ? `; calls through ${x.bases.map((b) => b.base).join(", ")}` : ""}`,
              `  ${x.nombre}: ${[...x.pila, ...x.lenguajes].join(", ") || "sin código reconocido"}; ${x.endpoints} endpoints, ${x.pantallas} pantallas, ${x.tablas} tablas${x.bases.length ? `; llama por ${x.bases.map((b) => b.base).join(", ")}` : ""}`,
            ),
          ),
          L("review the file (group the repos into brains and answer the questions) and run: flowbrain brains apply", "revisá el archivo (agrupá los repos en cerebros y respondé las preguntas) y corré: flowbrain brains apply"),
        ];
        return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (!(await esRegistro(raiz))) throw new ConsultaError("parametro_invalido", L(`no ${ARCHIVO_REGISTRO} in ${raiz}; create it with: flowbrain brains propose <folder> --root ${raiz}`, `no hay ${ARCHIVO_REGISTRO} en ${raiz}; creálo con: flowbrain brains propose <carpeta> --root ${raiz}`));
      if (arg === "apply") {
        const registro = await leerRegistro(raiz);
        const solo = positionals[2];
        if (solo && !registro.cerebro(solo)) throw new ConsultaError("nodo_inexistente", L(`brain does not exist: ${solo}`, `no existe el cerebro: ${solo}`));
        const inicio = Date.now();
        const rs = await aplicarConProgreso(registro, solo);
        const visor = await escribirVisor(registro, reporte?.progreso);
        reporte?.terminar();
        return { codigo: fallo(rs) ? 1 : 0, stdout: resumenAplicar(rs, visor, inicio).join("\n") + "\n", stderr: "" };
      }
      if (arg === "viewer") {
        const visor = await escribirVisor(await leerRegistro(raiz));
        return { codigo: visor ? 0 : 1, stdout: visor ? `${visor}\n` : L("no brain is compiled: run flowbrain brains apply\n", "ningún cerebro está compilado: corré flowbrain brains apply\n"), stderr: "" };
      }
      if (arg === "register") {
        // Hooks de Claude Code apuntando al registro (cada prompt usa el cerebro del repo actual) y la línea del MCP.
        const cmd = comandoBrain(env);
        const settings = o.settings !== undefined ? resolve(cwd, o.settings) : join(homedir(), ".claude/settings.json");
        const cambio = await instalarHooksClaudeCode(settings, `${cmd} hook claude-code --root ${comillas(raiz)}`);
        const lineas = [
          lineaHooks(cambio, settings),
          "",
          L(
            "MCP server (one line, only once; if there was one already, remove it first with: claude mcp remove --scope user flowbrain; the one from before the rename was called brain):",
            "Servidor MCP (una línea, una sola vez; si ya había uno, quitálo antes con: claude mcp remove --scope user flowbrain; el de antes del cambio de nombre se llamaba brain):",
          ),
          `  claude mcp add --scope user flowbrain -- ${cmd} serve --sync --root ${comillas(raiz)}`,
        ];
        return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (arg) throw new ConsultaError("parametro_invalido", L(`unknown subcommand: brains ${arg}`, `subcomando desconocido: cerebros ${arg}`));
      return { codigo: 0, stdout: await listar(raiz), stderr: "" };
    }

    // Con un registro de cerebros, el resto de los comandos trabaja sobre uno: el pedido, o el del repo actual.
    // El hook elige el suyo más abajo, por el directorio que le manda Claude Code, y nunca falla.
    const raizRegistro = (await esRegistro(raiz)) ? raiz : null;
    if (comando === "coverage" && o.guide) return { codigo: 0, stdout: GUIA_ESTUDIO, stderr: "" };
    if (comando === "feature" && o.guide) return { codigo: 0, stdout: GUIA_FUNCIONALIDADES, stderr: "" };
    if (comando === "specs" && o.guide) return { codigo: 0, stdout: GUIA_ESPECIFICACIONES, stderr: "" };
    if (comando === "specs" && o["guide-tests"]) return { codigo: 0, stdout: GUIA_TESTS, stderr: "" };
    if (comando === "evidence") {
      // Con --guide, las instrucciones para el modelo que va a analizar; sin él, el informe.
      if (o.guide) return { codigo: 0, stdout: GUIA_ANALISIS, stderr: "" };
      if (!raizRegistro) throw new ConsultaError("parametro_invalido", L(`evidence needs a registry: no ${ARCHIVO_REGISTRO} in ${raiz}`, `evidence necesita un registro: no hay ${ARCHIVO_REGISTRO} en ${raiz}`));
      const registro = await leerRegistro(raizRegistro);
      if (o.brain && !registro.cerebro(o.brain)) throw new ConsultaError("nodo_inexistente", L(`brain does not exist: ${o.brain}`, `no existe el cerebro: ${o.brain}`));
      return { codigo: 0, stdout: stringifyCanonical(await evidencia(registro, o.brain)), stderr: "" };
    }
    if (comando === "connections") {
      if (!raizRegistro) throw new ConsultaError("parametro_invalido", L(`connections needs a registry: no ${ARCHIVO_REGISTRO} in ${raiz}`, `conexiones necesita un registro: no hay ${ARCHIVO_REGISTRO} en ${raiz}`));
      return { codigo: 0, stdout: stringifyCanonical(await crearMulti(raizRegistro, { cwd }).conexiones(o.brain)), stderr: "" };
    }
    if (comando === "parity" && raizRegistro) {
      // Con un registro, cada lado puede estar en su cerebro (`cerebro/svc-x`, o `cerebro` si tiene un solo servicio).
      if (!arg || !positionals[2]) throw new ConsultaError("parametro_invalido", L("usage: flowbrain parity <old> <new>, each as svc-x, brain/svc-x or brain", "uso: flowbrain parity <viejo> <nuevo>, cada uno como svc-x, cerebro/svc-x o cerebro"));
      const b = o.budget === undefined ? undefined : o.budget === "none" ? null : entero(o.budget, "--budget");
      return { codigo: 0, stdout: stringifyCanonical(await crearMulti(raizRegistro, { cwd }).paridad({ viejo: arg, nuevo: positionals[2], ...(b !== undefined ? { budget_tokens: b } : {}) }, o.brain)), stderr: "" };
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
    // Con varios cerebros, las consultas cruzan como en el MCP: se anota lo que atiende, llama o usa otro cerebro.
    let cruzar: { nombre: string } | null = null;
    if (raizRegistro && comando !== "hook") {
      const registro = await leerRegistro(raiz);
      const c = o.brain ? registro.cerebro(o.brain) : (registro.deDirectorio(cwd) ?? (registro.cerebros.length === 1 ? registro.cerebros[0]! : null));
      if (!c)
        throw new ConsultaError(
          "parametro_invalido",
          o.brain
            ? L(`brain does not exist: ${o.brain}`, `no existe el cerebro: ${o.brain}`)
            : L(`there are several brains (${registro.cerebros.map((x) => x.nombre).join(", ")}); pick one with --brain`, `hay varios cerebros (${registro.cerebros.map((x) => x.nombre).join(", ")}); elegí uno con --brain`),
        );
      raiz = c.raiz;
      if (registro.cerebros.length > 1) cruzar = { nombre: c.nombre };
    } else if (o.brain) throw new ConsultaError("parametro_invalido", L(`--brain needs a registry: no ${ARCHIVO_REGISTRO} in ${raiz}`, `--brain necesita un registro: no hay ${ARCHIVO_REGISTRO} en ${raiz}`));

    if (comando === "compile") {
      const { salidas, escritos } = await compileDirConVisor(raiz);
      const resumen = L(
        `compiled: ${salidas.graph.nodes.length} nodes, ${salidas.graph.edges.length} edges; ${escritos.length} files written\n`,
        `compilado: ${salidas.graph.nodes.length} nodos, ${salidas.graph.edges.length} aristas; ${escritos.length} archivos escritos\n`,
      );
      return { codigo: 0, stdout: resumen + escritos.map((e) => `  ${e}\n`).join(""), stderr: "" };
    }

    if (comando === "index") {
      if (!arg) throw new ConsultaError("parametro_invalido", L("missing <repo-path>", "falta <ruta-repo>"));
      const r = await indexar(resolve(cwd, arg), raiz, o.repo !== undefined ? { repo: o.repo } : {});
      const escritos = await escribirIndex(raiz, r);
      const nuevos = r.servicios.filter((s) => s.nuevo).map((s) => `${s.svc} (${s.paquete || "."})`);
      const lineas = [
        L(
          `indexed ${r.repo}: ${r.contratos.length} contracts, ${r.aristas.length} edges, ${r.pendientes.length} pending; ${escritos.length} files written`,
          `indexado ${r.repo}: ${r.contratos.length} contratos, ${r.aristas.length} aristas, ${r.pendientes.length} pendientes; ${escritos.length} archivos escritos`,
        ),
        ...escritos.map((e) => `  ${e}`),
        ...(nuevos.length ? [L(`services without a page (proposed by the indexer): ${nuevos.join(", ")}`, `servicios sin página (los propone el indexador): ${nuevos.join(", ")}`)] : []),
      ];
      return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "sync" || comando === "status" || comando === "doctor") {
      const carpetas = (o.repos ?? env.FLOWBRAIN_REPOS ?? "").split(":").filter(Boolean).map((d) => resolve(cwd, d));
      if (comando === "sync") {
        const inicio = Date.now();
        const r = await sync(raiz, { carpetas, forzar: o.force === true, ...(reporte ? { progreso: reporte.progreso } : {}) });
        reporte?.terminar();
        const lineas = [
          ...r.repos.map((x) => `${x.repo}: ${x.reindexado ? L("reindexed", "reindexado") : x.estado === "sin clon" ? L("no clone (not reindexed)", "sin clon (no se reindexó)") : L("up to date", "al día")}`),
          r.repos.length
            ? r.compilados
              ? L(`compiled: ${r.compilados.length} files changed`, `compilado: ${r.compilados.length} archivos cambiaron`)
              : L("no changes: no need to compile", "sin cambios: no hizo falta compilar")
            : L("no indexed repos (run flowbrain index <repo-path>)", "no hay repos indexados (corré flowbrain index <ruta-repo>)"),
          ...lineaTotal(inicio, []),
        ];
        return { codigo: r.repos.some((x) => x.estado === "sin clon") ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (comando === "status") {
        const e = await estado(raiz, carpetas);
        return { codigo: e.desactualizado ? 1 : 0, stdout: o.json ? stringifyCanonical(e) : textoEstado(e), stderr: "" };
      }
      const cs = await doctor(raiz, { carpetas, ...(o.settings !== undefined ? { settings: resolve(cwd, o.settings) } : {}) });
      return { codigo: cs.every((c) => c.ok) ? 0 : 1, stdout: cs.map((c) => `${c.ok ? "ok   " : L("miss ", "falta")} ${c.que}: ${c.detalle}`).join("\n") + "\n", stderr: "" };
    }

    if (comando === "promote") {
      const r = await promover(raiz, { ids: positionals.slice(1), todos: o.all === true, escribir: o.write === true, pisar: o.overwrite === true });
      const fila = (c: { origen: string; destino: string; estado: string }) => `  ${c.origen} → ${c.destino} (${({ nuevo: L("new", "nuevo"), igual: L("unchanged", "igual"), distinto: L("different", "distinto") } as Record<string, string>)[c.estado] ?? c.estado})`;
      const lineas = o.write
        ? [
            ...(r.movidos.length ? [L(`promoted ${r.movidos.length}:`, `promovidos ${r.movidos.length}:`), ...r.movidos.map(fila)] : []),
            ...(r.salteados.length ? [L("not moved:", "sin mover:"), ...r.salteados.map((c) => `${fila(c)}: ${c.motivo}`)] : []),
            ...(r.errores.length ? [L("nothing was promoted; errors:", "no se promovió nada; errores:"), ...r.errores.map((e) => `  ${e}`)] : []),
            ...(!r.movidos.length && !r.salteados.length && !r.errores.length ? [L("nothing to promote (pass ids or --all)", "nada para promover (pasá ids o --all)")] : []),
          ]
        : [
            ...(r.candidatos.length
              ? [L(`drafts (${r.candidatos.length}):`, `borradores (${r.candidatos.length}):`), ...r.candidatos.map(fila), L("promote with: flowbrain promote <id...> --write (or --all --write)", "promové con: flowbrain promote <id...> --write (o --all --write)")]
              : [L("no drafts in _drafts/", "no hay borradores en _drafts/")]),
            ...r.errores,
          ];
      return { codigo: r.errores.length ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "draft") {
      if (!arg) throw new ConsultaError("parametro_invalido", L("missing <repo-path>", "falta <ruta-repo>"));
      const r = await draftDir(resolve(cwd, arg), raiz, o.repo !== undefined ? { repo: o.repo } : {});
      const { paginas, relaciones, preguntas, tablas, externos, funcionalidades } = r.resumen;
      const lineas = [
        L(
          `drafts of ${r.repo}: ${paginas} pages (${funcionalidades} features, ${tablas} tables and ${externos} external proposed), ${relaciones} new relations, ${preguntas} open questions; ${r.escritos.length} files written`,
          `borradores de ${r.repo}: ${paginas} páginas (${funcionalidades} funcionalidades, ${tablas} tablas y ${externos} externos propuestos), ${relaciones} relaciones nuevas, ${preguntas} preguntas abiertas; ${r.escritos.length} archivos escritos`,
        ),
        ...r.escritos.map((e) => `  ${e}`),
        L(
          `review _drafts/${r.repo}/ and _drafts/product/ (or give PROMPT.md to an agent), move them to technology/ and product/ and run flowbrain index + flowbrain compile`,
          `revisá _drafts/${r.repo}/ y _drafts/product/ (o pasale PROMPT.md a un agente), movelos a technology/ y product/ y corré flowbrain index + flowbrain compile`,
        ),
      ];
      return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "verify") {
      const clones: Record<string, string> = {};
      for (const c of o.clone ?? []) {
        const i = c.indexOf("=");
        if (i <= 0) throw new ConsultaError("parametro_invalido", L(`--clone expects <repo-id>=<path>, got "${c}"`, `--clone espera <repo-id>=<ruta>, llegó "${c}"`));
        clones[c.slice(0, i)] = resolve(cwd, c.slice(i + 1));
      }
      const carpetas = (o.repos ?? env.FLOWBRAIN_REPOS ?? "").split(":").filter(Boolean).map((d) => resolve(cwd, d));
      // Sin `--clone` para un repo, vale el clon que registró `flowbrain index`.
      for (const r of await reposIndexados(raiz, carpetas)) if (r.clon && !clones[r.repo]) clones[r.repo] = r.clon;
      const hoy = o.today ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) throw new ConsultaError("parametro_invalido", L("--today must be YYYY-MM-DD", "--today debe ser AAAA-MM-DD"));
      const r = await verifyDir(raiz, { repos: clones, carpetas, hoy, dias: entero(o.days, "--days") ?? 90 });
      const ev = (d: { desde: string; verbo: string; hasta: string; evidencia: string; motivo: string }) => `  ${d.desde} ${d.verbo} ${d.hasta} — ${d.evidencia}: ${d.motivo}`;
      const lineas = [
        L(
          `verified ${r.verificadas} edges: ${r.dudosas.length} doubtful (${r.nuevas.length} new, ${r.recuperadas.length} recovered)`,
          `verificadas ${r.verificadas} aristas: ${r.dudosas.length} dudosas (${r.nuevas.length} nuevas, ${r.recuperadas.length} recuperadas)`,
        ),
        ...(r.nuevas.length ? [L("new doubtful:", "nuevas dudosas:"), ...r.nuevas.map(ev)] : []),
        ...(r.recuperadas.length ? [L("recovered:", "recuperadas:"), ...r.recuperadas.map(ev)] : []),
        ...(r.noVerificables.length ? [L("no local clone (not verified): ", "sin clon local (no verificadas): ") + r.noVerificables.map((x) => `${x.repo} (${x.aristas})`).join(", ")] : []),
        ...(r.sinVerificar.length
          ? [
              L(`nodes not verified in ${entero(o.days, "--days") ?? 90} days (${r.sinVerificar.length}): `, `nodos sin verificar en ${entero(o.days, "--days") ?? 90} días (${r.sinVerificar.length}): `) +
                r.sinVerificar
                  .slice(0, 20)
                  .map((n) => n.id)
                  .join(", ") +
                (r.sinVerificar.length > 20 ? L(`, … (+${r.sinVerificar.length - 20} more)`, `, … (+${r.sinVerificar.length - 20} más)`) : ""),
            ]
          : []),
      ];
      return { codigo: r.nuevas.length > 0 ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "gen") {
      if (!arg || !(DESTINOS as readonly string[]).includes(arg)) throw new ConsultaError("parametro_invalido", L(`invalid target: ${arg ?? "(missing)"}; use ${DESTINOS.join(" | ")}`, `destino inválido: ${arg ?? "(falta)"}; usá ${DESTINOS.join(" | ")}`));
      const ctx = await cargarContexto(raiz);
      const dir = resolve(cwd, o.repo !== undefined && !ctx.nodo.has(o.repo) ? o.repo : ".");
      const repo = repoDe(ctx, o.repo !== undefined && ctx.nodo.has(o.repo) ? o.repo : await nombreRepo(dir));
      const r = generarReglas(arg as Destino, ctx, repo);
      if (!o.write) return { codigo: 0, stdout: r.contenido, stderr: repo ? "" : L("flowbrain gen: the repo is not in the brain; generating the generic block\n", "flowbrain gen: el repo no está en el brain; se genera el bloque genérico\n") };
      const cambio = await escribirReglas(dir, r);
      return { codigo: 0, stdout: `${cambio ? L("written", "escrito") : L("no changes", "sin cambios")}: ${r.ruta}${repo ? ` (${repo.id})` : L(" (no repo node)", " (sin nodo de repo)")}\n`, stderr: "" };
    }

    if (comando === "note") {
      const texto = positionals.slice(2).join(" ").trim();
      if (!arg || !texto) throw new ConsultaError("parametro_invalido", L("usage: flowbrain note <node> <text>", "uso: flowbrain note <nodo> <texto>"));
      const escritos = await anotar(raiz, [{ id: arg, texto }], "manual");
      return { codigo: 0, stdout: escritos.length ? L(`note added: ${escritos.join(", ")}\n`, `nota agregada: ${escritos.join(", ")}\n`) : L("the note already existed\n", "la nota ya existía\n"), stderr: "" };
    }

    if (comando === "hook") {
      if (arg !== "claude-code") return { codigo: 2, stdout: "", stderr: L(`unknown hook: ${arg ?? ""}\n`, `hook desconocido: ${arg ?? ""}\n`) };
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
          return { codigo: 0, stdout: "", stderr: escritos.length ? L(`brain: notes saved in ${escritos.join(", ")}\n`, `brain: notas guardadas en ${escritos.join(", ")}\n`) : "" };
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
    const resuelto = cruzar && CRUZAN.has(comando) ? await crearMulti(raizRegistro!, { cwd }).resolver(cruzar.nombre) : null;
    const ctx: Contexto = resuelto ? resuelto.ctx : await cargarContexto(raiz);
    // La consulta que se corre, con el nombre y los argumentos que tiene en el MCP: con eso se anotan los cruces.
    let consulta: { herramienta: string; args: Record<string, unknown> } | null = null;
    const q = <A extends object>(herramienta: string, args: A): A => {
      consulta = { herramienta, args: args as Record<string, unknown> };
      return args;
    };
    let resultado: unknown;
    switch (comando) {
      case "search":
        if (!arg) throw new ConsultaError("parametro_invalido", L("missing <text>", "falta <texto>"));
        resultado = buscarNodo(ctx, q("buscar_nodo", { texto: arg, ...opt("tipos", lista(o.types)), ...opt("limite", entero(o.limit, "--limit")), ...comunes }));
        break;
      case "traverse":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <nodo>");
        resultado = recorrerGrafo(ctx, q("recorrer_grafo", {
          nodo: arg,
          ...opt("verbos", lista(o.verbs)),
          ...opt("direccion", o.direction as "out" | "in" | "both" | undefined),
          ...opt("profundidad", entero(o.depth, "--depth")),
          ...comunes,
        }));
        break;
      case "contract":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <nodo>");
        resultado = contratoDe(ctx, q("contrato_de", { nodo: arg, ...opt("endpoint", o.endpoint), ...comunes }));
        break;
      case "trace": {
        const desde = o.from ?? arg;
        if (!desde) throw new ConsultaError("parametro_invalido", L("missing --from", "falta --from"));
        resultado = trazar(ctx, q("trazar", { desde, ...opt("hasta", o.to), ...comunes }));
        break;
      }
      case "feature":
        if (!arg) throw new ConsultaError("parametro_invalido", L("missing <id>", "falta <id>"));
        resultado = funcionalidad(ctx, q("funcionalidad", { id: arg, ...opt("budget_tokens", comunes.budget_tokens) }));
        break;
      case "flow":
        if (!arg) throw new ConsultaError("parametro_invalido", L("missing <endpoint or symbol>", "falta <endpoint o símbolo>"));
        resultado = recorrido(ctx, q("recorrido", { desde: arg, ...opt("budget_tokens", comunes.budget_tokens) }));
        break;
      case "screen":
        if (!arg) throw new ConsultaError("parametro_invalido", L("missing </path>", "falta </ruta>"));
        resultado = pantalla(ctx, q("pantalla", { ruta: arg, ...opt("budget_tokens", comunes.budget_tokens) }));
        break;
      case "callers":
        if (!arg) throw new ConsultaError("parametro_invalido", L("missing <symbol>", "falta <símbolo>"));
        resultado = quienLlama(ctx, q("quien_llama", { simbolo: arg, ...opt("profundidad", entero(o.depth, "--depth")), ...opt("budget_tokens", comunes.budget_tokens) }));
        break;
      case "impact":
        if (!arg) throw new ConsultaError("parametro_invalido", L("missing <piece>", "falta <pieza>"));
        resultado = impactoDe(ctx, q("impacto", { pieza: arg, ...opt("budget_tokens", comunes.budget_tokens) }));
        break;
      case "risk": {
        const diff = o.diff === undefined ? undefined : o.diff === "-" ? await stdin() : await readFile(resolve(cwd, o.diff), "utf8");
        const archivos = positionals.slice(1);
        resultado = riesgo(ctx, q("riesgo", { ...opt("diff", diff), ...(archivos.length ? { archivos } : {}), ...opt("repo", o.repo), ...opt("profundidad", entero(o.depth, "--depth")), ...opt("budget_tokens", comunes.budget_tokens) }));
        break;
      }
      case "parity":
        if (!arg || !positionals[2]) throw new ConsultaError("parametro_invalido", L("usage: flowbrain parity <old-svc> <new-svc>", "uso: flowbrain parity <svc-viejo> <svc-nuevo>"));
        resultado = paridad(ctx, { viejo: arg, nuevo: positionals[2], ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "specs":
        resultado = especificaciones(ctx, { ...opt("funcionalidad", arg), ...opt("estado", o.state), ...opt("tipo", o.type), ...(o.untested ? { sin_test: true } : {}), ...(o.problems ? { con_problema: true } : {}), ...(o.findings ? { con_hallazgo: true } : {}), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "unassigned":
        resultado = sinAsociar(ctx, { ...opt("carpeta", arg), ...opt("funcionalidad", o.feature), ...opt("limite", entero(o.limit, "--limit")), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "fidelity":
        // Con varios cerebros la fidelidad cruza (se rehace al anotar), con la misma regla que el visor.
        resultado = fidelidad(ctx, q("fidelidad", {
          ...opt("archivo", arg),
          ...opt("min", entero(o.min, "--min")),
          ...opt("max", entero(o.max, "--max")),
          ...opt("funcionalidad", o.feature),
          ...opt("tipo", o.type),
          ...opt("signal", o.signal),
          ...opt("limite", entero(o.limit, "--limit")),
          ...opt("budget_tokens", comunes.budget_tokens),
          ...(o.plan ? { plan: true } : {}),
          ...(o.uncertain ? { inciertos: true } : {}),
        }));
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
        // Con varios cerebros la deriva cruza (se rehace al anotar): lo que atiende otro cerebro no es deriva.
        resultado = deriva(ctx, q("deriva", { ...opt("nodo", arg), ...opt("budget_tokens", comunes.budget_tokens) }));
        break;
      case "infra":
        resultado = infra(ctx, q("infra", { ...opt("nodo", arg), ...opt("texto", o.text), ...opt("budget_tokens", comunes.budget_tokens) }));
        break;
      case "eval": {
        const archivo = resolve(raiz, arg ?? "evals/questions.json");
        const r = evaluar(ctx, leerPreguntas(await readFile(archivo, "utf8")));
        const minimo = o.min === undefined ? null : Number(o.min);
        if (minimo !== null && Number.isNaN(minimo)) throw new ConsultaError("parametro_invalido", L("--min must be a number", "--min debe ser un número"));
        return { codigo: minimo !== null && r.porcentaje < minimo ? 1 : 0, stdout: stringifyCanonical(r), stderr: L(
            `${r.aciertos}/${r.total} correct (${r.porcentaje}%), coverage of the expected ${r.cobertura}%${r.sinPreguntas.length ? `; no questions: ${r.sinPreguntas.join(", ")}` : ""}\n`,
            `${r.aciertos}/${r.total} correctas (${r.porcentaje}%), cobertura de lo esperado ${r.cobertura}%${r.sinPreguntas.length ? `; sin preguntas: ${r.sinPreguntas.join(", ")}` : ""}\n`,
          ),
        };
      }
      case "context": {
        if (!o.prompt) throw new ConsultaError("parametro_invalido", L("missing --prompt", "falta --prompt"));
        const repoDir = o.repo !== undefined ? await nombreRepo(resolve(cwd, o.repo)) : null;
        const r = contextoParaPrompt(ctx, {
          prompt: o.prompt,
          repoDir,
          budget_tokens: typeof budget === "number" ? budget : BUDGET_HOOK,
        });
        return { codigo: 0, stdout: r.texto, stderr: "" };
      }
      default:
        return { codigo: 2, stdout: "", stderr: L(`unknown command: ${comando}\n\n${ayuda()}`, `comando desconocido: ${comando}\n\n${ayuda()}`) };
    }
    const pedida = consulta as { herramienta: string; args: Record<string, unknown> } | null;
    if (resuelto && pedida && typeof resultado === "object" && resultado !== null && !Array.isArray(resultado)) {
      resultado = { ...resultado, cerebro: resuelto.nombre, ...(resuelto.sinRevisar ? { sinRevisar: true } : {}), ...(await resuelto.anotar(pedida.herramienta, pedida.args, resultado)) };
    }
    // El plan de fidelidad es texto para pegarle a un modelo: sale tal cual, no como JSON.
    if (comando === "fidelity" && o.plan) return { codigo: 0, stdout: (resultado as { plan: string }).plan, stderr: "" };
    return { codigo: 0, stdout: stringifyCanonical(resultado), stderr: "" };
  } catch (e) {
    if (e instanceof CompileError) return { codigo: 1, stdout: "", stderr: e.errores.map(formatError).join("\n") + "\n" };
    if (e instanceof ConsultaError) {
      return { codigo: 2, stdout: stringifyCanonical({ error: { codigo: e.codigo, mensaje: e.message } }), stderr: "" };
    }
    throw e;
  }
}

/** Comandos de consulta que, con varios cerebros, anotan lo que cruza a otros (los mismos que cruzan en el MCP). */
const CRUZAN = new Set(["search", "traverse", "contract", "trace", "feature", "flow", "screen", "callers", "impact", "risk", "drift", "infra", "fidelity"]);

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
} else if (esMain && process.argv[2] === "viewer" && process.argv.includes("--serve")) {
  // El visor con edición: un servidor en 127.0.0.1 que queda corriendo hasta Ctrl+C.
  const { values } = parseArgs({ args: process.argv.slice(3), options: { serve: { type: "boolean" }, port: { type: "string" }, root: { type: "string" }, lang: { type: "string" } } });
  await resolverIdioma({ ...opt("flag", values.lang), env: process.env, cwd: process.cwd() });
  const carpeta = resolve(process.cwd(), values.root ?? process.env.FLOWBRAIN_ROOT ?? (await buscarRegistro(process.cwd())) ?? ".");
  try {
    if (!(await esRegistro(carpeta))) throw new Error(L(`no ${ARCHIVO_REGISTRO} in ${carpeta}: run flowbrain install in the project`, `no hay ${ARCHIVO_REGISTRO} en ${carpeta}: corré flowbrain install en el proyecto`));
    const puerto = values.port === undefined ? undefined : Number(values.port);
    if (puerto !== undefined && (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535)) throw new Error(L("--port must be a port (0 to 65535)", "--port debe ser un puerto (0 a 65535)"));
    const { servirVisor } = await import("./servidor-visor.js");
    const s = await servirVisor(carpeta, puerto);
    process.stdout.write(
      L(
        `Editable viewer at ${s.url()}\nOnly this machine can open it. What you fix there is written to ${carpeta}.\nCtrl+C to close it.\n`,
        `Visor con edición en ${s.url()}\nSolo esta máquina puede abrirlo. Lo que se corrige ahí se escribe en ${carpeta}.\nCtrl+C para cerrarlo.\n`,
      ),
    );
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
} else if (esMain) {
  // Solo se pregunta cuando hay una persona del otro lado.
  const interactivo = !!(process.stdin.isTTY && process.stdout.isTTY);
  const preguntar = interactivo ? async (q: string) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question(q); } finally { rl.close(); }
  } : undefined;
  const args = process.argv.slice(2);
  // `--lang es` vale también para el menú: se aparta para decidir si se abre.
  const sinLang = args.filter((a, i) => !(a === "--lang" || a.startsWith("--lang=") || (i > 0 && args[i - 1] === "--lang")));
  if (interactivo && (sinLang.length === 0 || (sinLang.length === 1 && sinLang[0] === "menu"))) {
    // Sin argumentos y con una persona del otro lado: el menú.
    const lang = args.find((a) => a.startsWith("--lang="))?.slice(7) ?? (args.includes("--lang") ? args[args.indexOf("--lang") + 1] : undefined);
    await resolverIdioma({ ...opt("flag", lang), env: process.env, cwd: process.cwd() });
    const { menu, terminal } = await import("./menu.js");
    // Cada comando que corre el menú usa el idioma del menú (que se puede cambiar desde ahí).
    // El progreso de reindexar va a stderr, en la misma terminal: una línea viva y el resumen de cada cerebro al terminar.
    const conProgreso = async (a: string[], cwd: string) => {
      const reporte = crearReporte(process.stderr, { resumenEnVivo: true });
      try {
        return await ejecutar([...a, "--lang", idiomaDelMenu()], process.env, cwd, leerStdin, preguntar, reporte);
      } finally {
        reporte.terminar();
      }
    };
    await menu(process.cwd(), terminal(conProgreso), { forzarMenu: sinLang[0] === "menu" });
    process.exit(0);
  }
  // Progreso a stderr: una línea que se reescribe en una terminal, líneas simples en un log. Solo lo usan los comandos
  // que reindexan (`brains apply`, `install`, `sync`); el resumen de cada cerebro sale en vivo si stdout es la terminal.
  const reporte = crearReporte(process.stderr, { resumenEnVivo: !!process.stdout.isTTY });
  const r = await ejecutar(args, process.env, process.cwd(), leerStdin, preguntar, reporte).finally(() => reporte.terminar());
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.codigo;
}

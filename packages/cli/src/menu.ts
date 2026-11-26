import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { buscarRegistro, leerRegistro } from "@flowbrain/core";
import { AGENTES, agentesConMcp, analizarCon, CONFIGS_MCP, conectarMcp, elegirAgente, type Agente } from "./agentes.js";
import { ARCHIVO_VISOR } from "./cerebros.js";
import { comandoBrain, PAQUETE, VERSION } from "./init.js";
import { asistente } from "./asistente.js";
import { fijarIdioma, guardarIdioma, idioma, L, type Idioma } from "./idioma.js";
import { cerrarServidor, depsReales, prepararVisor, type ResultadoVisor } from "./visor-local.js";

/**
 * `flowbrain` sin argumentos (o `flowbrain menu`): un menú en la terminal con lo que se puede hacer en el proyecto
 * donde se está parado. Las opciones dependen del estado: sin `.flowbrain/` lo primero es configurarlo; con él,
 * analizar, reindexar, abrir el visor. Cada opción corre los mismos comandos que se pueden escribir a mano.
 */

export type Clave = "configurar" | "analizar" | "reindexar" | "visor" | "estado" | "mcp" | "actualizar" | "idioma" | "salir";

export interface Opcion {
  clave: Clave;
  titulo: string;
  detalle: string;
}

export interface ContextoMenu {
  /** Carpeta del proyecto: la que tiene `.flowbrain/`, o la actual si todavía no está configurado. */
  proyecto: string;
  /** Carpeta del registro (`.flowbrain/`), si existe. */
  registro: string | null;
  cerebros: string[];
  /** Cerebros sin índice compilado (`_build/graph.json`) y sin análisis del modelo (`profile.md`). */
  faltaIndice: string[];
  faltaAnalisis: string[];
  visor: string | null;
  /** Si algún agente ya tiene el servidor MCP de FlowBrain, y cuáles. */
  mcp: boolean;
  mcpEn: Agente["id"][];
  /** Agentes de código instalados (ver `AGENTES`). */
  agentes: Agente["id"][];
  git: boolean;
  version: string;
  /** Última versión publicada en npm, si es más nueva que la que corre; null si está al día, es "dev" o no se pudo saber. */
  nueva: string | null;
}

/** Lo que el menú necesita del mundo: correr comandos y hablar con la persona. Las pruebas lo reemplazan. */
export interface Entorno {
  /** Corre `flowbrain <args>` en `cwd` y devuelve su salida. */
  flowbrain(args: string[], cwd: string): Promise<{ codigo: number; stdout: string; stderr: string }>;
  /** Corre un programa con la terminal conectada (Claude Code, git, pnpm) y devuelve su código de salida. */
  correr(programa: string, args: string[], cwd: string): Promise<number>;
  escribir(texto: string): void;
  /** Una tecla: `arriba`, `abajo`, `enter`, `salir`, o un dígito. */
  tecla(): Promise<string>;
  preguntar(pregunta: string): Promise<string>;
  limpiar(): void;
  /** Cómo leer el estado del proyecto (las pruebas lo fijan; por defecto, `contextoMenu`). */
  contexto?: (cwd: string) => Promise<ContextoMenu>;
  /** Reusa, levanta o descarta el visor en localhost (por defecto, `prepararVisor` real). */
  visorLocal?: (registro: string) => Promise<ResultadoVisor>;
  /** Espera el Ctrl+C que corta el visor (por defecto, el SIGINT del proceso). */
  esperarCorte?: () => Promise<void>;
  /** Guarda el idioma elegido en el menú y devuelve dónde (por defecto, `guardarIdioma` en las preferencias de la persona). */
  guardarIdioma?: (lang: Idioma) => Promise<string | null>;
}

/** El pedido para el agente que analiza: va al modelo, así que siempre en inglés. */
export const PROMPT_ANALISIS = [
  "Run the full FlowBrain analysis in this project, in order and without skipping steps.",
  "1. Study each repo and write the extractors that complete the index: follow the instructions printed by `flowbrain coverage --guide`.",
  "2. Analyze the real communication between services: follow the ones from `flowbrain evidence --guide`.",
  "3. Deduce and complete the product features: follow the ones from `flowbrain feature --guide`.",
  "Read each guide in full before starting its step. When you finish, run `flowbrain brains viewer` and give me a short report: what changed in each brain and what is still undetermined.",
].join("\n");

/** ¿`a` es una versión posterior a `b`? Compara mayor.menor.parche; una versión con sufijo (`-stage`) nunca gana. */
export function esMasNueva(a: string, b: string): boolean {
  const partes = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
  const x = partes(a), y = partes(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

let ultimaCache: Promise<string | null> | undefined;
/** La última versión publicada en npm, una vez por sesión del menú; sin red o si tarda, null (el menú no espera). */
export function ultimaPublicada(): Promise<string | null> {
  ultimaCache ??= fetch(`https://registry.npmjs.org/${PAQUETE.replace("/", "%2f")}/latest`, { signal: AbortSignal.timeout(2000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ version?: string }>) : null))
    .then((j) => j?.version ?? null)
    .catch(() => null);
  return ultimaCache;
}

export async function contextoMenu(
  cwd: string,
  entorno: { hayComando(nombre: string): boolean; mcpConfig?: string[]; ultima?: () => Promise<string | null> } = { hayComando },
): Promise<ContextoMenu> {
  const registro = await buscarRegistro(cwd);
  let lista: Array<{ nombre: string; raiz: string }> = [];
  if (registro) {
    try {
      lista = (await leerRegistro(registro)).cerebros.map((c) => ({ nombre: c.nombre, raiz: c.raiz }));
    } catch {
      lista = [];
    }
  }
  const cerebros = lista.map((c) => c.nombre);
  const visor = registro && existsSync(join(registro, ARCHIVO_VISOR)) ? join(registro, ARCHIVO_VISOR) : null;
  const mcpEn = await agentesConMcp(entorno.mcpConfig ?? CONFIGS_MCP());
  return {
    proyecto: registro ? dirname(registro) : resolve(cwd),
    registro,
    cerebros,
    faltaIndice: lista.filter((c) => !existsSync(join(c.raiz, "_build/graph.json"))).map((c) => c.nombre),
    faltaAnalisis: lista.filter((c) => !existsSync(join(c.raiz, "profile.md"))).map((c) => c.nombre),
    visor,
    mcp: mcpEn.length > 0,
    mcpEn,
    agentes: AGENTES.filter((a) => entorno.hayComando(a.comando)).map((a) => a.id),
    git: entorno.hayComando("git"),
    version: VERSION,
    nueva: await (async () => {
      if (VERSION === "dev") return null;
      const u = await (entorno.ultima ?? ultimaPublicada)();
      return u && esMasNueva(u, VERSION) ? u : null;
    })(),
  };
}

export function opciones(c: ContextoMenu): Opcion[] {
  const listo = !!c.registro;
  const out: Opcion[] = [
    listo
      ? {
          clave: "configurar",
          titulo: L("Set up / update this project", "Actualizar la configuración"),
          detalle: L("command, hooks and Claude Code commands up to date, and reindexes the brains in flowbrain.yaml", "comando, hooks y comandos de Claude Code al día, y reindexa los cerebros de flowbrain.yaml"),
        }
      : { clave: "configurar", titulo: L("Set up / update this project", "Configurar este proyecto"), detalle: L("detects the subrepositories, builds the brains and indexes everything", "detecta los subrepositorios, arma los cerebros e indexa todo") },
    {
      clave: "analizar",
      titulo: L("Analyze the whole project", "Analizar el proyecto completo"),
      detalle: c.agentes.length
        ? L(
            `the agent you pick studies each repo, joins the services and completes the features${listo ? "" : " (sets it up first)"}`,
            `el agente que elijas estudia cada repo, une los servicios y completa las funcionalidades${listo ? "" : " (antes lo configura)"}`,
          )
        : L("Claude Code, Codex or OpenCode not found: I give you the instructions for the agent you use", "no encontré Claude Code, Codex ni OpenCode: te doy las instrucciones para el agente que uses"),
    },
  ];
  if (listo) out.push({ clave: "reindexar", titulo: L("Re-index", "Reindexar"), detalle: L("runs parsers and extractors again and regenerates the viewer", "vuelve a correr parsers y extractores y regenera el visor") });
  if (c.visor)
    out.push({
      clave: "visor",
      titulo: L("Open the viewer", "Abrir el visor"),
      detalle: L("opens it on localhost to see and fix: features, screens, fidelity, impact and 3D map", "lo abre en localhost para ver y corregir: funcionalidades, pantallas, fidelidad, impacto y mapa 3D"),
    });
  if (listo) out.push({ clave: "estado", titulo: L("See status", "Ver estado"), detalle: L("repos up to date, counts and known gaps of each brain", "repos al día, conteos y huecos conocidos de cada cerebro") });
  const conectados = AGENTES.filter((a) => c.mcpEn.includes(a.id)).map((a) => a.nombre).join(", ");
  out.push(
    {
      clave: "mcp",
      titulo: L("Connect an agent (MCP)", "Conectar un agente (MCP)"),
      detalle: c.mcp
        ? L(`connected in ${conectados}; add another or register it again`, `conectado en ${conectados}; suma otro o lo registra de nuevo`)
        : L("registers the FlowBrain MCP server in Claude Code, Codex or OpenCode, for all your projects", "registra el servidor MCP de FlowBrain en Claude Code, Codex u OpenCode, para todos tus proyectos"),
    },
    {
      clave: "actualizar",
      titulo: L("Update FlowBrain", "Actualizar FlowBrain"),
      detalle:
        c.version === "dev"
          ? L("pulls the latest version from the FlowBrain repo and installs it", "trae la última versión del repo de FlowBrain y la instala")
          : c.nueva
            ? L(`you have ${c.version}: installs ${c.nueva}, the new one, and registers the MCP again`, `tenés la ${c.version}: instala la ${c.nueva}, la nueva, y vuelve a registrar el MCP`)
            : L(`version ${c.version}: installs the latest published one`, `versión ${c.version}: instala la última publicada`),
    },
    { clave: "idioma", titulo: L("Language: English · switch to Español", "Idioma: castellano · cambiar a English"), detalle: L("saved for the next times", "queda guardado para las próximas veces") },
    { clave: "salir", titulo: L("Quit", "Salir"), detalle: "" },
  );
  return out;
}

/**
 * El siguiente paso, en el único orden que funciona: repos → índice → análisis. Cada uno necesita lo que deja el
 * anterior (el análisis mide lo que los parsers ya leyeron). El MCP no bloquea nada, va al final.
 */
export function siguiente(c: ContextoMenu): { clave: Clave; motivo: string } | null {
  const nombres = (xs: string[]) => (xs.length === c.cerebros.length && xs.length > 1 ? L("all the brains", "todos los cerebros") : xs.join(", "));
  if (!c.registro || !c.cerebros.length) return { clave: "configurar", motivo: L("the project is not set up", "el proyecto no está configurado") };
  if (c.faltaIndice.length) return { clave: "reindexar", motivo: L(`${nombres(c.faltaIndice)} not indexed yet`, `falta indexar ${nombres(c.faltaIndice)}`) };
  if (c.faltaAnalisis.length) return { clave: "analizar", motivo: L(`full analysis missing in ${nombres(c.faltaAnalisis)}`, `falta el análisis completo en ${nombres(c.faltaAnalisis)}`) };
  if (!c.mcp) return { clave: "mcp", motivo: L("no agent queries FlowBrain yet", "ningún agente consulta FlowBrain todavía") };
  return null;
}

const NEGRITA = "\x1b[1m", TENUE = "\x1b[2m", INVERSO = "\x1b[7m", FIN = "\x1b[0m";

export function dibujar(c: ContextoMenu, ops: Opcion[], elegida: number): string {
  const estado = c.registro
    ? `${c.cerebros.length} ${c.cerebros.length === 1 ? L("brain", "cerebro") : L("brains", "cerebros")}${c.cerebros.length ? `: ${c.cerebros.join(", ")}` : ""}`
    : L("not set up", "sin configurar");
  const lineas = [
    `${NEGRITA}FlowBrain${FIN} ${TENUE}${c.version}${FIN}`,
    ...(c.nueva
      ? [L(`${NEGRITA}New version ${c.nueva} available${FIN} (you have ${c.version}): I recommend Update FlowBrain`, `${NEGRITA}Hay una versión nueva: ${c.nueva}${FIN} (tenés la ${c.version}): te recomiendo Actualizar FlowBrain`)]
      : []),
    L(`${TENUE}Project:${FIN} ${c.proyecto}`, `${TENUE}Proyecto:${FIN} ${c.proyecto}`),
    L(`${TENUE}Status:${FIN}  ${estado} · MCP ${c.mcp ? "connected" : "not connected"}`, `${TENUE}Estado:${FIN}   ${estado} · MCP ${c.mcp ? "conectado" : "sin conectar"}`),
    ...(() => {
      const s = siguiente(c);
      const o = s && ops.find((x) => x.clave === s.clave);
      return [s && o ? `${NEGRITA}${L("Next step:", "Siguiente paso:")}${FIN} ${o.titulo} (${s.motivo})` : `${TENUE}${L("All up to date.", "Todo al día.")}${FIN}`];
    })(),
    "",
    ...ops.map((o, i) => {
      const n = o.clave === "salir" ? "q" : String(i + 1);
      const fila = `${n}. ${o.titulo}`;
      return i === elegida ? `${INVERSO} ${fila} ${FIN}  ${TENUE}${o.detalle}${FIN}` : `  ${fila}  ${TENUE}${o.detalle}${FIN}`;
    }),
    "",
    `${TENUE}${L("↑/↓ and Enter, or the number. q to quit.", "↑/↓ y Enter, o el número. q para salir.")}${FIN}`,
  ];
  return lineas.join("\n") + "\n";
}

/** Elige una opción con las flechas, Enter o su número. */
export async function elegir(c: ContextoMenu, ops: Opcion[], e: Entorno): Promise<Opcion> {
  // Arranca parado en el siguiente paso recomendado: Enter lo hace.
  const s = siguiente(c);
  let i = Math.max(0, s ? ops.findIndex((o) => o.clave === s.clave) : 0);
  for (;;) {
    e.limpiar();
    e.escribir(dibujar(c, ops, i));
    const t = await e.tecla();
    if (t === "salir") return ops.find((o) => o.clave === "salir")!;
    if (t === "arriba") i = (i - 1 + ops.length) % ops.length;
    else if (t === "abajo") i = (i + 1) % ops.length;
    else if (t === "enter") return ops[i]!;
    else if (/^[1-9]$/.test(t) && Number(t) <= ops.length) return ops[Number(t) - 1]!;
  }
}

export const si = (r: string) => /^(s|si|sí|y|yes)$/i.test(r.trim());
/** Sí por defecto: Enter también vale. */
export const siPorDefecto = (r: string) => !/^(n|no)$/i.test(r.trim());

/** Corre una opción. Devuelve false para salir. */
export async function accion(o: Opcion, c: ContextoMenu, e: Entorno): Promise<boolean> {
  const mostrar = (r: { stdout: string; stderr: string }) => e.escribir(r.stdout + (r.stderr ? r.stderr : ""));
  switch (o.clave) {
    case "salir":
      return false;
    case "configurar":
      if (!c.registro) {
        await asistente(c, e);
        break;
      }
      e.escribir(L("Updating the machine and reindexing…\n", "Actualizando la máquina y reindexando…\n"));
      mostrar(await e.flowbrain(["install"], c.proyecto));
      break;
    case "analizar": {
      if (!c.registro) {
        // El análisis necesita los cerebros y el índice: el asistente los arma y ofrece el análisis al final.
        e.escribir(L("The project has to be set up before analyzing it.\n", "Antes de analizar hay que configurar el proyecto.\n"));
        await asistente(c, e);
        break;
      }
      if (c.faltaIndice.length) {
        e.escribir(L("First indexing what is missing…\n", "Primero indexo lo que falta…\n"));
        mostrar(await e.flowbrain(["brains", "apply"], c.proyecto));
      }
      await analizarCon(await elegirAgente(c, e, "analizar"), PROMPT_ANALISIS, c, e);
      break;
    }
    case "reindexar":
      e.escribir(L("Reindexing…\n", "Reindexando…\n"));
      mostrar(await e.flowbrain(["brains", "apply"], c.proyecto));
      break;
    case "visor":
      await abrirVisor(c, e);
      break;
    case "estado":
      mostrar(await e.flowbrain(["status"], c.proyecto));
      break;
    case "mcp":
      await conectarMcp(c, e);
      break;
    case "actualizar":
      await actualizar(c, e);
      break;
    case "idioma":
      await cambiarIdioma(e);
      break;
  }
  return true;
}

/** Cambia el idioma del menú (inglés ↔ castellano), lo guarda y dice dónde. El menú se redibuja en el nuevo idioma. */
async function cambiarIdioma(e: Entorno): Promise<void> {
  const nuevo: Idioma = idioma() === "es" ? "en" : "es";
  fijarIdioma(nuevo);
  let donde: string | null = null;
  try {
    donde = await (e.guardarIdioma ?? ((i: Idioma) => guardarIdioma(process.env, i)))(nuevo);
  } catch (x) {
    e.escribir(L(`Could not save the preference: ${(x as Error).message}\n`, `No pude guardar la preferencia: ${(x as Error).message}\n`));
  }
  e.escribir(
    donde
      ? L(`Language: English. Saved in ${donde}.\n`, `Idioma: castellano. Quedó guardado en ${donde}.\n`)
      : L("Language: English (only for this session: there is nowhere to save it).\n", "Idioma: castellano (solo por esta vez: no hay dónde guardarlo).\n"),
  );
}

const abridor = () => (process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open");

/** Ctrl+C mientras el visor corre: lo corta y vuelve al menú en vez de cerrar FlowBrain. */
const esperarSigint = () => new Promise<void>((ok) => process.once("SIGINT", () => ok()));

/**
 * El visor servido en localhost (decisión 198): reusa el de este registro si ya corre, si no levanta uno y lo deja
 * andando hasta Ctrl+C. Si no puede, abre el archivo estático y dice por qué.
 */
export async function abrirVisor(c: ContextoMenu, e: Entorno): Promise<void> {
  const r: ResultadoVisor = c.registro
    ? await (e.visorLocal ?? ((reg) => prepararVisor(reg, depsReales(reg))))(c.registro).catch((x: Error) => ({ modo: "estatico" as const, motivo: x.message }))
    : { modo: "estatico", motivo: L("the project has no .flowbrain/", "el proyecto no tiene .flowbrain/") };
  if (r.modo === "reusa") {
    await e.correr(abridor(), [r.url], c.proyecto);
    e.escribir(
      L(
        `A FlowBrain viewer was already running for this project: opened ${r.url}\nI did not start another one. Stop it with Ctrl+C in the terminal where it was opened.\n`,
        `Ya había un visor de FlowBrain corriendo para este proyecto: abrí ${r.url}\nNo levanté otro. Se corta con Ctrl+C en la terminal donde se abrió.\n`,
      ),
    );
    return;
  }
  if (r.modo === "nuevo") {
    await e.correr(abridor(), [r.url], c.proyecto);
    e.escribir(
      [
        L(`Editable viewer at ${r.url}`, `Visor con edición en ${r.url}`),
        L(`Only this machine can open it. What you fix there is written to ${c.registro}.`, `Solo esta máquina puede abrirlo. Lo que se corrige ahí se escribe en ${c.registro}.`),
        L("It keeps running while you use it: Ctrl+C stops it and you go back to the menu.", "Queda corriendo mientras lo uses: Ctrl+C lo corta y volvés al menú."),
        "",
      ].join("\n"),
    );
    await (e.esperarCorte ?? esperarSigint)();
    await cerrarServidor(r.servidor);
    e.escribir(L("\nViewer closed.\n", "\nVisor cerrado.\n"));
    return;
  }
  if (!c.visor) {
    e.escribir(
      L(
        `Could not open the viewer on localhost: ${r.motivo}.\nThere is no static file either (flowbrain.html): pick Re-index to generate it.\n`,
        `No pude abrir el visor en localhost: ${r.motivo}.\nTampoco hay archivo estático (flowbrain.html): elegí Reindexar para generarlo.\n`,
      ),
    );
    return;
  }
  await e.correr(abridor(), [c.visor], c.proyecto);
  e.escribir(
    L(
      `Could not open the viewer on localhost: ${r.motivo}.\nOpened the static file, which shows the same but does not save fixes: ${c.visor}\n` +
        "To fix things from the page: flowbrain viewer --serve --port <another>\n",
      `No pude abrir el visor en localhost: ${r.motivo}.\nAbrí el archivo estático, que muestra lo mismo pero no guarda correcciones: ${c.visor}\n` +
        "Para corregir desde la página: flowbrain viewer --serve --port <otro>\n",
    ),
  );
}

/** Repo de FlowBrain cuando se corre desde el código (versión "dev"). */
const repoFlowbrain = () => resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function actualizar(c: ContextoMenu, e: Entorno): Promise<void> {
  if (c.version !== "dev") {
    const ultima = c.nueva ?? (await ultimaPublicada());
    if (ultima && !esMasNueva(ultima, c.version)) {
      e.escribir(L(`You already have the latest published version (${c.version}).\n`, `Ya tenés la última versión publicada (${c.version}).\n`));
      return;
    }
    if (!si(await e.preguntar(L(`I will install the latest published version (npm install -g ${PAQUETE}@latest). Continue? (y/N) `, `Voy a instalar la última versión publicada (npm install -g ${PAQUETE}@latest). ¿Sigo? (s/N) `)))) return;
    if ((await e.correr("npm", ["install", "-g", `${PAQUETE}@latest`], c.proyecto)) !== 0) {
      e.escribir(L("npm could not install it: check the message above.\n", "npm no pudo instalarla: revisá el mensaje de arriba.\n"));
      return;
    }
    // El binario nuevo deja la máquina al día y vuelve a registrar el MCP con su versión (el viejo quedaría fijado).
    await e.correr("flowbrain", ["setup", "--mcp"], c.proyecto);
    e.escribir(L("FlowBrain updated. If something in the index changed, pick Re-index.\n", "FlowBrain actualizado. Si cambió algo del índice, elegí Reindexar.\n"));
    return;
  }
  const repo = repoFlowbrain();
  if (!si(await e.preguntar(L(`I will pull the latest version of the FlowBrain repo (${repo}: git pull and pnpm install) and bring the machine up to date. Continue? (y/N) `, `Voy a traer la última versión del repo de FlowBrain (${repo}: git pull y pnpm install) y dejar la máquina al día. ¿Sigo? (s/N) `)))) return;
  if ((await e.correr("git", ["-C", repo, "pull", "--ff-only"], repo)) !== 0) {
    e.escribir(L("git pull could not move forward (local changes or diverging branches): fix it in the repo and try again.\n", "git pull no pudo avanzar (cambios locales o ramas que divergen): resolvelo en el repo y volvé a intentar.\n"));
    return;
  }
  if ((await e.correr("pnpm", ["install", "--frozen-lockfile"], repo)) !== 0) {
    e.escribir(L("pnpm install failed: check the message above.\n", "pnpm install falló: revisá el mensaje de arriba.\n"));
    return;
  }
  // El código nuevo deja la máquina al día (comandos de Claude Code y hooks); este proceso todavía tiene el viejo.
  await e.correr("sh", ["-c", `${comandoBrain()} setup --mcp`], c.proyecto);
  e.escribir(L("FlowBrain updated. If something in the index changed, pick Re-index.\n", "FlowBrain actualizado. Si cambió algo del índice, elegí Reindexar.\n"));
}

export async function menu(cwd: string, e: Entorno, opcionesMenu: { forzarMenu?: boolean } = {}): Promise<void> {
  // Un proyecto sin configurar empieza por el asistente; después (o si se lo deja a medias), el menú.
  const leer = e.contexto ?? contextoMenu;
  const inicial = await leer(cwd);
  if (!inicial.registro && !opcionesMenu.forzarMenu) {
    await asistente(inicial, e);
    // Que el resumen del asistente no se borre: el menú aparece recién cuando la persona lo pide.
    await e.preguntar(L("\nEnter to go to the menu ", "\nEnter para ir al menú "));
  }
  for (;;) {
    const c = await leer(cwd);
    const o = await elegir(c, opciones(c), e);
    e.limpiar();
    if (!(await accion(o, c, e))) return;
    await e.preguntar(L("\nEnter to go back to the menu ", "\nEnter para volver al menú "));
  }
}

function hayComando(nombre: string): boolean {
  return (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").some((d) => d && existsSync(join(d, nombre)));
}

/** La terminal real: teclas en modo crudo, preguntas con readline y programas con la terminal conectada. */
export function terminal(flowbrain: Entorno["flowbrain"]): Entorno {
  emitKeypressEvents(process.stdin);
  return {
    flowbrain,
    correr: (programa, args, cwd) =>
      new Promise((res) => {
        const p = spawn(programa, args, { cwd, stdio: "inherit" });
        p.on("error", () => res(127));
        p.on("close", (code) => res(code ?? 1));
      }),
    escribir: (t) => process.stdout.write(t),
    limpiar: () => process.stdout.write("\x1b[2J\x1b[H"),
    tecla: () =>
      new Promise((res) => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once("keypress", (s: string | undefined, k: { name?: string; ctrl?: boolean } | undefined) => {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          const n = k?.name;
          if (k?.ctrl && n === "c") res("salir");
          else if (n === "up" || n === "k") res("arriba");
          else if (n === "down" || n === "j") res("abajo");
          else if (n === "return" || n === "enter") res("enter");
          else if (n === "q" || n === "escape") res("salir");
          else res(s ?? "");
        });
      }),
    preguntar: async (q) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(q);
      } finally {
        rl.close();
      }
    },
  };
}

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
import { cerrarServidor, depsReales, prepararVisor, type ResultadoVisor } from "./visor-local.js";

/**
 * `flowbrain` sin argumentos (o `flowbrain menu`): un menú en la terminal con lo que se puede hacer en el proyecto
 * donde se está parado. Las opciones dependen del estado: sin `.flowbrain/` lo primero es configurarlo; con él,
 * analizar, reindexar, abrir el visor. Cada opción corre los mismos comandos que se pueden escribir a mano.
 */

export type Clave = "configurar" | "analizar" | "reindexar" | "visor" | "estado" | "mcp" | "actualizar" | "salir";

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
}

export const PROMPT_ANALISIS = [
  "Hacé el análisis completo de FlowBrain en este proyecto, en orden y sin saltear pasos.",
  "1. Estudiá cada repo y escribí los extractores que completan el índice: seguí las instrucciones que imprime `flowbrain coverage --guide`.",
  "2. Analizá la comunicación real entre servicios: seguí las de `flowbrain evidence --guide`.",
  "3. Deducí y completá las funcionalidades de producto: seguí las de `flowbrain feature --guide`.",
  "Leé cada guía completa antes de empezar su paso. Al terminar, corré `flowbrain brains viewer` y dame un informe corto: qué cambió en cada cerebro y qué quedó sin determinar.",
].join("\n");

export async function contextoMenu(cwd: string, entorno: { hayComando(nombre: string): boolean; mcpConfig?: string[] } = { hayComando }): Promise<ContextoMenu> {
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
  };
}

export function opciones(c: ContextoMenu): Opcion[] {
  const listo = !!c.registro;
  const out: Opcion[] = [
    listo
      ? { clave: "configurar", titulo: "Actualizar la configuración", detalle: "comando, hooks y comandos de Claude Code al día, y reindexa los cerebros de flowbrain.yaml" }
      : { clave: "configurar", titulo: "Configurar este proyecto", detalle: "detecta los subrepositorios, arma los cerebros e indexa todo" },
    {
      clave: "analizar",
      titulo: "Analizar el proyecto completo",
      detalle: c.agentes.length
        ? `el agente que elijas estudia cada repo, une los servicios y completa las funcionalidades${listo ? "" : " (antes lo configura)"}`
        : "no encontré Claude Code, Codex ni OpenCode: te doy las instrucciones para el agente que uses",
    },
  ];
  if (listo) out.push({ clave: "reindexar", titulo: "Reindexar", detalle: "vuelve a correr parsers y extractores y regenera el visor" });
  if (c.visor) out.push({ clave: "visor", titulo: "Abrir el visor", detalle: "lo abre en localhost para ver y corregir: funcionalidades, pantallas, fidelidad, impacto y mapa 3D" });
  if (listo) out.push({ clave: "estado", titulo: "Ver estado", detalle: "repos al día, conteos y huecos conocidos de cada cerebro" });
  out.push(
    {
      clave: "mcp",
      titulo: "Conectar un agente (MCP)",
      detalle: c.mcp
        ? `conectado en ${AGENTES.filter((a) => c.mcpEn.includes(a.id)).map((a) => a.nombre).join(", ")}; suma otro o lo registra de nuevo`
        : "registra el servidor MCP de FlowBrain en Claude Code, Codex u OpenCode, para todos tus proyectos",
    },
    { clave: "actualizar", titulo: "Actualizar FlowBrain", detalle: c.version === "dev" ? "trae la última versión del repo de FlowBrain y la instala" : `versión ${c.version}: instala la última publicada` },
    { clave: "salir", titulo: "Salir", detalle: "" },
  );
  return out;
}

/**
 * El siguiente paso, en el único orden que funciona: repos → índice → análisis. Cada uno necesita lo que deja el
 * anterior (el análisis mide lo que los parsers ya leyeron). El MCP no bloquea nada, va al final.
 */
export function siguiente(c: ContextoMenu): { clave: Clave; motivo: string } | null {
  const nombres = (xs: string[]) => (xs.length === c.cerebros.length && xs.length > 1 ? "todos los cerebros" : xs.join(", "));
  if (!c.registro || !c.cerebros.length) return { clave: "configurar", motivo: "el proyecto no está configurado" };
  if (c.faltaIndice.length) return { clave: "reindexar", motivo: `falta indexar ${nombres(c.faltaIndice)}` };
  if (c.faltaAnalisis.length) return { clave: "analizar", motivo: `falta el análisis completo en ${nombres(c.faltaAnalisis)}` };
  if (!c.mcp) return { clave: "mcp", motivo: "ningún agente consulta FlowBrain todavía" };
  return null;
}

const NEGRITA = "\x1b[1m", TENUE = "\x1b[2m", INVERSO = "\x1b[7m", FIN = "\x1b[0m";

export function dibujar(c: ContextoMenu, ops: Opcion[], elegida: number): string {
  const estado = c.registro
    ? `${c.cerebros.length} ${c.cerebros.length === 1 ? "cerebro" : "cerebros"}${c.cerebros.length ? `: ${c.cerebros.join(", ")}` : ""}`
    : "sin configurar";
  const lineas = [
    `${NEGRITA}FlowBrain${FIN} ${TENUE}${c.version}${FIN}`,
    `${TENUE}Proyecto:${FIN} ${c.proyecto}`,
    `${TENUE}Estado:${FIN}   ${estado} · MCP ${c.mcp ? "conectado" : "sin conectar"}`,
    ...(() => {
      const s = siguiente(c);
      const o = s && ops.find((x) => x.clave === s.clave);
      return [s && o ? `${NEGRITA}Siguiente paso:${FIN} ${o.titulo} (${s.motivo})` : `${TENUE}Todo al día.${FIN}`];
    })(),
    "",
    ...ops.map((o, i) => {
      const n = o.clave === "salir" ? "q" : String(i + 1);
      const fila = `${n}. ${o.titulo}`;
      return i === elegida ? `${INVERSO} ${fila} ${FIN}  ${TENUE}${o.detalle}${FIN}` : `  ${fila}  ${TENUE}${o.detalle}${FIN}`;
    }),
    "",
    `${TENUE}↑/↓ y Enter, o el número. q para salir.${FIN}`,
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
      e.escribir("Actualizando la máquina y reindexando…\n");
      mostrar(await e.flowbrain(["install"], c.proyecto));
      break;
    case "analizar": {
      if (!c.registro) {
        // El análisis necesita los cerebros y el índice: el asistente los arma y ofrece el análisis al final.
        e.escribir("Antes de analizar hay que configurar el proyecto.\n");
        await asistente(c, e);
        break;
      }
      if (c.faltaIndice.length) {
        e.escribir("Primero indexo lo que falta…\n");
        mostrar(await e.flowbrain(["brains", "apply"], c.proyecto));
      }
      await analizarCon(await elegirAgente(c, e, "analizar"), PROMPT_ANALISIS, c, e);
      break;
    }
    case "reindexar":
      e.escribir("Reindexando…\n");
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
  }
  return true;
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
    : { modo: "estatico", motivo: "el proyecto no tiene .flowbrain/" };
  if (r.modo === "reusa") {
    await e.correr(abridor(), [r.url], c.proyecto);
    e.escribir(`Ya había un visor de FlowBrain corriendo para este proyecto: abrí ${r.url}\nNo levanté otro. Se corta con Ctrl+C en la terminal donde se abrió.\n`);
    return;
  }
  if (r.modo === "nuevo") {
    await e.correr(abridor(), [r.url], c.proyecto);
    e.escribir(
      [
        `Visor con edición en ${r.url}`,
        `Solo esta máquina puede abrirlo. Lo que se corrige ahí se escribe en ${c.registro}.`,
        "Queda corriendo mientras lo uses: Ctrl+C lo corta y volvés al menú.",
        "",
      ].join("\n"),
    );
    await (e.esperarCorte ?? esperarSigint)();
    await cerrarServidor(r.servidor);
    e.escribir("\nVisor cerrado.\n");
    return;
  }
  if (!c.visor) {
    e.escribir(`No pude abrir el visor en localhost: ${r.motivo}.\nTampoco hay archivo estático (flowbrain.html): elegí Reindexar para generarlo.\n`);
    return;
  }
  await e.correr(abridor(), [c.visor], c.proyecto);
  e.escribir(
    `No pude abrir el visor en localhost: ${r.motivo}.\nAbrí el archivo estático, que muestra lo mismo pero no guarda correcciones: ${c.visor}\n` +
      "Para corregir desde la página: flowbrain viewer --serve --port <otro>\n",
  );
}

/** Repo de FlowBrain cuando se corre desde el código (versión "dev"). */
const repoFlowbrain = () => resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function actualizar(c: ContextoMenu, e: Entorno): Promise<void> {
  if (c.version !== "dev") {
    if (!si(await e.preguntar(`Voy a instalar la última versión publicada (npm install -g ${PAQUETE}@latest). ¿Sigo? (s/N) `))) return;
    if ((await e.correr("npm", ["install", "-g", `${PAQUETE}@latest`], c.proyecto)) !== 0) {
      e.escribir("npm no pudo instalarla: revisá el mensaje de arriba.\n");
      return;
    }
    await e.correr("flowbrain", ["setup"], c.proyecto);
    e.escribir("FlowBrain actualizado.\n");
    return;
  }
  const repo = repoFlowbrain();
  if (!si(await e.preguntar(`Voy a traer la última versión del repo de FlowBrain (${repo}: git pull y pnpm install) y dejar la máquina al día. ¿Sigo? (s/N) `))) return;
  if ((await e.correr("git", ["-C", repo, "pull", "--ff-only"], repo)) !== 0) {
    e.escribir("git pull no pudo avanzar (cambios locales o ramas que divergen): resolvelo en el repo y volvé a intentar.\n");
    return;
  }
  if ((await e.correr("pnpm", ["install", "--frozen-lockfile"], repo)) !== 0) {
    e.escribir("pnpm install falló: revisá el mensaje de arriba.\n");
    return;
  }
  // El código nuevo deja la máquina al día (comandos de Claude Code y hooks); este proceso todavía tiene el viejo.
  await e.correr("sh", ["-c", `${comandoBrain()} setup`], c.proyecto);
  e.escribir("FlowBrain actualizado. Si cambió algo del índice, elegí Reindexar.\n");
}

export async function menu(cwd: string, e: Entorno, opcionesMenu: { forzarMenu?: boolean } = {}): Promise<void> {
  // Un proyecto sin configurar empieza por el asistente; después (o si se lo deja a medias), el menú.
  const leer = e.contexto ?? contextoMenu;
  const inicial = await leer(cwd);
  if (!inicial.registro && !opcionesMenu.forzarMenu) {
    await asistente(inicial, e);
    // Que el resumen del asistente no se borre: el menú aparece recién cuando la persona lo pide.
    await e.preguntar("\nEnter para ir al menú ");
  }
  for (;;) {
    const c = await leer(cwd);
    const o = await elegir(c, opciones(c), e);
    e.limpiar();
    if (!(await accion(o, c, e))) return;
    await e.preguntar("\nEnter para volver al menú ");
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

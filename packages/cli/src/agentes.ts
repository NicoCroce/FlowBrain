import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { mcpRegistrado } from "./estado.js";
import { L } from "./idioma.js";
import { comandoBrain } from "./init.js";
import { si, type ContextoMenu, type Entorno } from "./menu.js";

/**
 * El análisis no depende de un modelo: lo hace el agente de código que la persona use. FlowBrain le da las mismas
 * instrucciones a cualquiera (las guías que imprime la CLI) y verifica lo que escribe. Acá está lo único que cambia
 * de un agente a otro: cómo se lo abre con un pedido y cómo se le registra el servidor MCP.
 */

export interface Agente {
  id: "claude" | "codex" | "opencode";
  nombre: string;
  /** El comando que tiene que estar en el PATH. */
  comando: string;
  /** Cómo abrirlo, interactivo, con el pedido ya escrito. */
  analizar(pedido: string): { programa: string; args: string[] };
  /** Cómo registrarle el servidor MCP: una línea que se corre, o un texto para pegar en su configuración. */
  mcp(cmd: string): { correr: string; quitar: { programa: string; args: string[] } } | { pegar: string; archivo: string };
}

export const AGENTES: Agente[] = [
  {
    id: "claude",
    nombre: "Claude Code",
    comando: "claude",
    analizar: (p) => ({ programa: "claude", args: [p] }),
    mcp: (cmd) => ({ correr: `claude mcp add --scope user flowbrain -- ${cmd} serve --sync`, quitar: { programa: "claude", args: ["mcp", "remove", "--scope", "user", "flowbrain"] } }),
  },
  {
    id: "codex",
    nombre: "Codex (OpenAI)",
    comando: "codex",
    analizar: (p) => ({ programa: "codex", args: [p] }),
    mcp: (cmd) => ({ correr: `codex mcp add flowbrain -- ${cmd} serve --sync`, quitar: { programa: "codex", args: ["mcp", "remove", "flowbrain"] } }),
  },
  {
    id: "opencode",
    nombre: "OpenCode",
    comando: "opencode",
    analizar: (p) => ({ programa: "opencode", args: ["--prompt", p] }),
    // OpenCode no tiene un comando para agregarlo sin preguntas: va la entrada para su configuración.
    mcp: (cmd) => ({
      archivo: "~/.config/opencode/opencode.json",
      pegar: JSON.stringify({ mcp: { flowbrain: { type: "local", command: [...partir(cmd), "serve", "--sync"], enabled: true } } }, null, 2),
    }),
  },
];

/** Separa un comando de shell en palabras, respetando las comillas simples que pone `comillas`. */
export function partir(cmd: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^']|'\\'')*)'|(\S+)/g;
  for (const m of cmd.matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]!);
  return out;
}

/** Configuraciones donde cada agente guarda sus servidores MCP. */
export const CONFIGS_MCP = (): string[] => [
  join(homedir(), ".claude.json"),
  join(process.cwd(), ".mcp.json"),
  join(homedir(), ".codex/config.toml"),
  join(homedir(), ".config/opencode/opencode.json"),
  join(homedir(), ".config/opencode/opencode.jsonc"),
];

/** Qué agentes ya tienen registrado el servidor de FlowBrain, según los archivos de configuración dados. */
export async function agentesConMcp(configs: string[]): Promise<Agente["id"][]> {
  const out = new Set<Agente["id"]>();
  for (const p of configs) {
    if (p.endsWith(".toml")) {
      const t = await readFile(p, "utf8").catch(() => "");
      if (/^\s*\[mcp_servers\.(?:"?flowbrain"?)\]/m.test(t)) out.add("codex");
    } else if (/opencode/.test(basename(p))) {
      const t = await readFile(p, "utf8").catch(() => "");
      if (/"mcp"\s*:[\s\S]*"flowbrain"\s*:/.test(t)) out.add("opencode");
    } else if (await mcpRegistrado([p])) out.add("claude");
  }
  return [...out];
}

export const instalados = (c: ContextoMenu) => AGENTES.filter((a) => c.agentes.includes(a.id));

/**
 * Pregunta con qué agente, entre los instalados. Siempre ofrece "otro" (cualquier agente, con las instrucciones a
 * mano), que es lo que devuelve null; sin ninguno instalado, va directo a eso.
 */
export async function elegirAgente(c: ContextoMenu, e: Entorno, para: "analizar" | "mcp"): Promise<Agente | null> {
  const hay = instalados(c);
  if (!hay.length) return null;
  e.escribir(
    para === "mcp"
      ? L("\nWhich agent should I connect it to?\n", "\n¿Con qué agente lo conecto?\n")
      : L("\nWhich agent should run the analysis?\n", "\n¿Con qué agente hago el análisis?\n"),
  );
  hay.forEach((a, i) => e.escribir(`  ${i + 1}. ${a.nombre}${para === "mcp" && c.mcpEn.includes(a.id) ? L(" (already connected)", " (ya conectado)") : ""}\n`));
  e.escribir(
    para === "mcp"
      ? L(`  ${hay.length + 1}. Other: I'll show you how to register it\n`, `  ${hay.length + 1}. Otro: te muestro cómo se registra\n`)
      : L(`  ${hay.length + 1}. Other: I'll show you the instructions to paste into the one you use\n`, `  ${hay.length + 1}. Otro: te muestro las instrucciones para pegarlas en el que uses\n`),
  );
  const n = Number((await e.preguntar(L("Number (Enter: 1) ", "Número (Enter: 1) "))).trim() || "1");
  return Number.isInteger(n) && n >= 1 && n <= hay.length ? hay[n - 1]! : null;
}

/** El análisis completo con el agente elegido; sin agente, las instrucciones para pegar en cualquiera. */
export async function analizarCon(a: Agente | null, pedido: string, c: ContextoMenu, e: Entorno): Promise<void> {
  if (!a) {
    e.escribir(
      [
        "",
        L("Open your coding agent (one that can run commands in the terminal) in this folder:", "Abrí tu agente de código (uno que pueda correr comandos en la terminal) en esta carpeta:"),
        `  ${c.proyecto}`,
        L("and ask it this:", "y pedile esto:"),
        "",
        pedido,
        "",
        L(
          "What the agent writes stays in .flowbrain/ and FlowBrain verifies it when indexing; next time the menu sees the analysis as done.",
          "Lo que el agente escribe queda en .flowbrain/ y FlowBrain lo verifica al indexar; la próxima vez el menú ve el análisis hecho.",
        ),
        "",
      ].join("\n"),
    );
    return;
  }
  e.escribir(
    L(
      `Opening ${a.nombre} with the full analysis. It will take a while: it studies each repo end to end.\n`,
      `Abriendo ${a.nombre} con el análisis completo. Va a tardar: estudia cada repo de punta a punta.\n`,
    ),
  );
  const { programa, args } = a.analizar(pedido);
  await e.correr(programa, args, c.proyecto);
}

/** Registra el servidor MCP de FlowBrain en un agente. `confirmar` en false cuando la persona ya dijo que sí. */
export async function conectarMcp(c: ContextoMenu, e: Entorno, confirmar = true): Promise<void> {
  const cmd = comandoBrain();
  const a = await elegirAgente(c, e, "mcp");
  if (!a) {
    e.escribir(L("\nThis is how FlowBrain's MCP server is registered in each agent (for all your projects):\n", "\nEl servidor MCP de FlowBrain se registra así en cada agente (para todos tus proyectos):\n"));
    for (const x of AGENTES) {
      const m = x.mcp(cmd);
      e.escribir("correr" in m ? `  ${x.nombre}:\n    ${m.correr}\n` : `  ${x.nombre}, ${L("in", "en")} ${m.archivo}:\n${m.pegar.replace(/^/gm, "    ")}\n`);
    }
    e.escribir(L(`  Any other MCP client: the command is  ${cmd} serve --sync  (stdio).\n`, `  Cualquier otro cliente MCP: el comando es  ${cmd} serve --sync  (stdio).\n`));
    return;
  }
  const m = a.mcp(cmd);
  if (!("correr" in m)) {
    e.escribir(
      L(
        `\n${a.nombre} is configured by hand: add this to ${m.archivo} (if it already has "mcp", add only the flowbrain entry):\n\n${m.pegar}\n\nThen open ${a.nombre} again.\n`,
        `\n${a.nombre} se configura a mano: agregá esto en ${m.archivo} (si ya tiene "mcp", sumá solo la entrada flowbrain):\n\n${m.pegar}\n\nDespués abrí ${a.nombre} de nuevo.\n`,
      ),
    );
    return;
  }
  if (
    confirmar &&
    !si(
      await e.preguntar(
        L(
          `I'm going to register FlowBrain's MCP server in ${a.nombre} (for all your projects):\n  ${m.correr}\nContinue? (y/N) `,
          `Voy a registrar el servidor MCP de FlowBrain en ${a.nombre} (para todos tus proyectos):\n  ${m.correr}\n¿Sigo? (s/N) `,
        ),
      ),
    )
  )
    return;
  if (c.mcpEn.includes(a.id)) await e.correr(m.quitar.programa, m.quitar.args, c.proyecto);
  const codigo = await e.correr("sh", ["-c", m.correr], c.proyecto);
  e.escribir(
    codigo === 0
      ? L(`Done: open ${a.nombre} again so it picks it up.\n`, `Listo: abrí ${a.nombre} de nuevo para que lo tome.\n`)
      : L("Could not register it: check the message above.\n", "No se pudo registrar: revisá el mensaje de arriba.\n"),
  );
}

/**
 * Después de actualizar FlowBrain, el servidor MCP sigue registrado con el comando anterior (`npx -y …@<versión vieja>`).
 * Vuelve a registrarlo con `cmd` en cada agente que ya lo tenía a nivel usuario y apunta a otro comando. Los que se
 * configuran a mano (OpenCode) o están registrados solo en un proyecto quedan como aviso, con lo que hay que hacer.
 */
export async function refrescarMcp(
  cmd: string,
  opciones: { configs?: { claude: string; codex: string; opencode: string[] }; correr?: (programa: string, args: string[]) => number } = {},
): Promise<string[]> {
  const configs = opciones.configs ?? {
    claude: join(homedir(), ".claude.json"),
    codex: join(homedir(), ".codex/config.toml"),
    opencode: [join(homedir(), ".config/opencode/opencode.json"), join(homedir(), ".config/opencode/opencode.jsonc")],
  };
  const correr = opciones.correr ?? ((programa: string, args: string[]) => spawnSync(programa, args, { stdio: "inherit" }).status ?? 1);
  const tokens = partir(cmd);
  const out: string[] = [];
  const registrar = (a: Agente) => {
    const m = a.mcp(cmd);
    if (!("correr" in m)) return;
    correr(m.quitar.programa, m.quitar.args);
    const ok = correr("sh", ["-c", m.correr]) === 0;
    out.push(
      ok
        ? L(`MCP server in ${a.nombre} registered again with ${cmd}: open ${a.nombre} again so it picks it up.`, `Servidor MCP en ${a.nombre} registrado de nuevo con ${cmd}: abrí ${a.nombre} de nuevo para que lo tome.`)
        : L(`Could not register the MCP server in ${a.nombre} again: run  ${m.correr}`, `No pude volver a registrar el servidor MCP en ${a.nombre}: corré  ${m.correr}`),
    );
  };

  // Claude Code: la entrada de usuario (`mcpServers` de primer nivel); la de un proyecto no se toca.
  const claude = await readFile(configs.claude, "utf8").then((t) => JSON.parse(t) as Record<string, unknown>, () => null);
  const usuario = (claude?.["mcpServers"] as Record<string, { command?: string; args?: string[] }> | undefined)?.["flowbrain"];
  if (usuario) {
    if (![usuario.command ?? "", ...(usuario.args ?? [])].join(" ").includes(tokens.join(" "))) registrar(AGENTES[0]!);
  } else if (claude && (await mcpRegistrado([configs.claude])))
    out.push(L("Claude Code has FlowBrain's MCP server registered only in a project: register it again from the menu (Connect an agent).", "Claude Code tiene el servidor MCP de FlowBrain registrado solo en un proyecto: registralo de nuevo desde el menú (Conectar un agente)."));

  const codex = await readFile(configs.codex, "utf8").catch(() => "");
  if (/^\s*\[mcp_servers\.(?:"?flowbrain"?)\]/m.test(codex) && !tokens.every((t) => codex.includes(t))) registrar(AGENTES[1]!);

  for (const p of configs.opencode) {
    const t = await readFile(p, "utf8").catch(() => "");
    if (/"mcp"\s*:[\s\S]*"flowbrain"\s*:/.test(t) && !tokens.every((x) => t.includes(x))) {
      const m = AGENTES[2]!.mcp(cmd);
      if ("pegar" in m) out.push(L(`OpenCode is configured by hand: replace the flowbrain entry in ${p} with:\n${m.pegar}`, `OpenCode se configura a mano: reemplazá la entrada flowbrain de ${p} por:\n${m.pegar}`));
    }
  }
  return out;
}

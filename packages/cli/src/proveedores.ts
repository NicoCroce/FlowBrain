import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";

/**
 * Los agentes que pueden atender un pedido del visor, detrás de una misma interfaz: así sumar Codex, Gemini CLI u
 * OpenCode es escribir un adaptador más (ver `AdaptadorDeAgente`), sin tocar la cola, el lote ni la pantalla. Hoy hay
 * uno: Claude Code. La pantalla ofrece solo los que están instalados en la máquina.
 *
 * Los permisos son los mismos para todos y los define FlowBrain (`POLITICA`); cada adaptador los traduce a la forma en
 * que su herramienta los entiende. Ningún agente commitea, pushea, abre `.env` ni sale a la red.
 */

export interface ModeloDeAgente {
  /** Lo que se le pasa a la herramienta (`--model <id>`). */
  id: string;
  nombre: string;
  /** El que se marca al elegir proveedor. A lo sumo uno por proveedor. */
  porDefecto?: boolean;
  /** Dólares por regla, aproximado (tanda de 10 a 15): alcanza para estimar el costo antes de pedir. */
  costoPorReglaUsd: number;
  /**
   * Dólares por archivo a asociar (Sin asociar), aproximado: abrir el archivo y editar el frontmatter de una página,
   * sin escribir ni correr tests. Estimación inicial (dec. 227), a ajustar con el costo real que muestra cada lote.
   */
  costoPorArchivoUsd: number;
  /**
   * Dólares por ítem de un pedido sobre las especificaciones (dec. 230), aproximado: agrupar las reglas sueltas de una
   * funcionalidad (ordenar lo escrito), escribir los casos y reglas de una funcionalidad (leer su código y sus tests) y
   * corregir un caso marcado o una regla. Estimación inicial, a ajustar con el costo real que muestra cada lote.
   */
  costoPorPaginaUsd: { agrupar: number; escribir: number; corregir: number };
}

/** Lo que FlowBrain le permite a cualquier agente. */
export const POLITICA = {
  /** Comandos de terminal que puede correr (prefijos). */
  comandosPermitidos: [
    "flowbrain", "cd", "ls", "git status", "git diff",
    "npx vitest", "npx jest", "npm test", "npm run test", "pnpm test", "pnpm vitest", "pnpm exec vitest", "pnpm exec jest",
    "yarn test", "yarn jest", "yarn vitest",
    "vendor/bin/phpunit", "./vendor/bin/phpunit", "php bin/phpunit", "php vendor/bin/phpunit", "composer test",
    "pytest", "python -m pytest", "python3 -m pytest",
  ],
  /** Comandos que nunca corre. */
  comandosProhibidos: ["git commit", "git push", "git reset", "git checkout"],
  /** Archivos que nunca abre. */
  archivosProhibidos: ["**/.env", "**/.env.*"],
  /** Sin red. */
  sinRed: true,
} as const;

export interface OrdenDeAgente {
  /** Lo que recibe el agente: la guía y el pedido. */
  prompt: string;
  /** Id de uno de `modelos()`; sin él, el de la herramienta. */
  modelo?: string;
  /** Carpeta del proyecto: ahí corre. */
  cwd: string;
  /** Repos que están fuera de `cwd` y tiene que poder leer y escribir. */
  carpetasExtra: string[];
  /**
   * Permisos acotados de un pedido (`permisosDelPedido`): rutas absolutas (globs) donde puede editar y escribir, y los
   * únicos comandos que puede correr. Sin ellos, los de `POLITICA`.
   */
  escritura?: string[];
  comandos?: string[];
}

/** Lo que dice una línea de la salida del agente, ya en llano. */
export interface EventoDeAgente {
  /** Lo que va haciendo: "Lee src/x.ts", "Corre: …". */
  pasos: string[];
  /** La respuesta final. */
  resultado?: string;
  costoUsd?: number;
  /** Si terminó con error, qué dijo. */
  error?: string;
}

/**
 * Cómo se suma un proveedor: un objeto con esta forma, agregado a `PROVEEDORES` (o a `crearAgente({ proveedores })`).
 * - `detectar`: ¿está instalado? Se prueba una vez (`<comando> --version`) y no instalado = no aparece en el selector.
 * - `modelos`: los que ofrece, con el que va por defecto marcado. Para OpenCode, que da muchos proveedores (DeepSeek y
 *   otros), son los de `opencode models` o los que se configuren.
 * - `armar`: el comando y los argumentos para correr sin conversación, con `POLITICA` traducida a sus permisos.
 * - `leerLinea`: una línea de lo que escribe a stdout (idealmente JSON por línea) → pasos, respuesta y costo.
 */
export interface AdaptadorDeAgente {
  id: string;
  nombre: string;
  detectar(): { instalado: boolean; version?: string; motivo?: string };
  modelos(): ModeloDeAgente[];
  armar(orden: OrdenDeAgente): { comando: string; args: string[] };
  leerLinea(linea: string, cwd: string): EventoDeAgente | null;
}

const realReal = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** Un evento de `claude -p --output-format stream-json`, en llano para la pantalla. */
export function pasosDeEvento(ev: unknown, cwd: string): string[] {
  const e = ev as { type?: string; message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }> } };
  if (e?.type !== "assistant" || !Array.isArray(e.message?.content)) return [];
  // La carpeta puede llegar por un enlace (/var y /private/var en macOS): vale cualquiera de las dos.
  const bases = [cwd, realReal(cwd)];
  const rel = (p: unknown) => {
    if (typeof p !== "string") return "";
    const b = bases.find((x) => p.startsWith(x + sep));
    return b ? relative(b, p) : p;
  };
  const corto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const out: string[] = [];
  for (const c of e.message!.content!) {
    if (c.type === "text" && c.text?.trim()) out.push(corto(c.text.trim().replace(/\s+/g, " "), 240));
    if (c.type !== "tool_use") continue;
    const i = c.input ?? {};
    if (c.name === "Read") out.push(`Reads ${rel(i["file_path"])}`);
    else if (c.name === "Edit" || c.name === "MultiEdit") out.push(`Edits ${rel(i["file_path"])}`);
    else if (c.name === "Write") out.push(`Writes ${rel(i["file_path"])}`);
    else if (c.name === "Bash") out.push(`Runs: ${corto(String(i["command"] ?? "").replace(/\s+/g, " "), 160)}`);
    else if (c.name === "Grep" || c.name === "Glob") out.push(`Searches ${corto(String(i["pattern"] ?? ""), 80)}`);
  }
  return out;
}

export const HERRAMIENTAS_PERMITIDAS = [
  "Read", "Glob", "Grep", "Edit", "MultiEdit", "Write", "TodoWrite",
  ...POLITICA.comandosPermitidos.map((c) => `Bash(${c}:*)`),
];
/**
 * Las herramientas de Claude Code para una orden: con `escritura`, editar y escribir solo en esas rutas (`//ruta`
 * absoluta) y correr solo `comandos`; sin, las de siempre. Con permisos acotados no van en modo `acceptEdits`, que
 * aceptaría cualquier edición dentro de la carpeta: lo que no está permitido se rechaza solo (`-p` no pregunta).
 */
export function herramientasDe(o: Pick<OrdenDeAgente, "escritura" | "comandos">): { permitidas: string[]; modo: string } {
  if (!o.escritura) return { permitidas: HERRAMIENTAS_PERMITIDAS, modo: "acceptEdits" };
  const abs = (r: string) => `/${r.startsWith("/") ? r : `/${r}`}`;
  return {
    permitidas: ["Read", "Glob", "Grep", "TodoWrite", ...o.escritura.flatMap((r) => [`Edit(${abs(r)})`, `MultiEdit(${abs(r)})`, `Write(${abs(r)})`]), ...(o.comandos ?? []).map((c) => `Bash(${c}:*)`)],
    modo: "default",
  };
}
export const HERRAMIENTAS_PROHIBIDAS = [...POLITICA.comandosProhibidos.map((c) => `Bash(${c}:*)`), ...POLITICA.archivosProhibidos.map((a) => `Read(${a})`), "WebFetch", "WebSearch"];

/**
 * Claude Code. `comando` es el ejecutable (`claude`, o `FLOWBRAIN_AGENTE` para probar con otro). Los modelos van por
 * su id completo en `--model`.
 */
export function claudeCode(comando = process.env["FLOWBRAIN_AGENTE"] ?? "claude"): AdaptadorDeAgente {
  let visto: ReturnType<AdaptadorDeAgente["detectar"]> | undefined;
  return {
    id: "claude-code",
    nombre: "Claude Code",
    detectar() {
      if (!visto) {
        const prueba = spawnSync(comando, ["--version"], { encoding: "utf8", timeout: 15_000 });
        visto = prueba.error || prueba.status !== 0
          ? { instalado: false, motivo: `Claude Code (${comando}) was not found on this machine: install it, or copy the request and paste it into your agent` }
          : { instalado: true, version: prueba.stdout.trim().split("\n")[0] ?? "" };
      }
      return visto;
    },
    modelos: () => [
      { id: "claude-fable-5-2", nombre: "Fable 5.2", costoPorReglaUsd: 0.9, costoPorArchivoUsd: 0.2, costoPorPaginaUsd: { agrupar: 0.35, escribir: 2.7, corregir: 0.55 } },
      { id: "claude-opus-5-5", nombre: "Opus 5.5", porDefecto: true, costoPorReglaUsd: 0.4, costoPorArchivoUsd: 0.08, costoPorPaginaUsd: { agrupar: 0.15, escribir: 1.2, corregir: 0.25 } },
      { id: "claude-sonnet-5-5", nombre: "Sonnet 5.5", costoPorReglaUsd: 0.15, costoPorArchivoUsd: 0.03, costoPorPaginaUsd: { agrupar: 0.06, escribir: 0.45, corregir: 0.09 } },
      { id: "claude-haiku-5-5", nombre: "Haiku 5.5", costoPorReglaUsd: 0.04, costoPorArchivoUsd: 0.01, costoPorPaginaUsd: { agrupar: 0.015, escribir: 0.12, corregir: 0.025 } },
    ],
    armar: (o) => ({
      comando,
      args: [
        "-p", o.prompt,
        "--output-format", "stream-json", "--verbose",
        ...(o.modelo ? ["--model", o.modelo] : []),
        "--permission-mode", herramientasDe(o).modo,
        "--allowedTools", ...herramientasDe(o).permitidas,
        "--disallowedTools", ...HERRAMIENTAS_PROHIBIDAS,
        ...(o.carpetasExtra.length ? ["--add-dir", ...o.carpetasExtra] : []),
      ],
    }),
    leerLinea(linea, cwd) {
      let ev: { type?: string; result?: string; is_error?: boolean; total_cost_usd?: number };
      try {
        ev = JSON.parse(linea) as typeof ev;
      } catch {
        return null;
      }
      const out: EventoDeAgente = { pasos: pasosDeEvento(ev, cwd) };
      if (ev.type === "result") {
        if (typeof ev.result === "string") out.resultado = ev.result;
        if (typeof ev.total_cost_usd === "number") out.costoUsd = ev.total_cost_usd;
        if (ev.is_error) out.error = ev.result ?? "the agent finished with an error";
      }
      return out;
    },
  };
}

/** Los proveedores que FlowBrain conoce. Codex, Gemini CLI y OpenCode son la etapa 2: un adaptador cada uno. */
export const PROVEEDORES: Array<() => AdaptadorDeAgente> = [() => claudeCode()];

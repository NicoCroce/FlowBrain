import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import type { Registro } from "@flowbrain/core";
import { compileDirConVisor } from "@flowbrain/viewer";
import { GUIA_ESPECIFICACIONES, GUIA_TESTS } from "./guia.js";

/**
 * El agente que atiende los pedidos del visor (`flowbrain viewer --serve`): en vez de copiar el pedido y pegarlo en
 * Claude Code, la página se lo manda al servidor y este corre Claude Code sin conversación (`claude -p`) en la carpeta
 * del proyecto, con la guía que corresponde y permisos acotados. Los pedidos van de a uno, en cola; la página ve el
 * avance, puede cancelar y, al terminar, qué archivos cambió en cada repo (sin commitear: los revisa una persona).
 *
 * Permisos: leer y buscar; editar y escribir archivos; de la terminal, solo `flowbrain`, `git status`/`git diff` y los
 * comandos de test más comunes. Nada de `git commit`/`git push`, red ni archivos `.env`.
 */

export type TipoDePedido = "test" | "agrupar" | "escribir" | "corregir";
export const TIPOS_DE_PEDIDO: readonly TipoDePedido[] = ["test", "agrupar", "escribir", "corregir"];

export interface Trabajo {
  id: string;
  tipo: TipoDePedido;
  /** Qué se pidió, corto: "2 tests de Recuperar la contraseña". */
  etiqueta: string;
  pedido: string;
  /** Cerebros que toca: se recompilan al terminar. */
  cerebros: string[];
  estado: "en_cola" | "corriendo" | "terminado" | "fallo" | "cancelado";
  creado: number;
  empezado?: number;
  terminado?: number;
  /** Lo que va haciendo, en llano: "Lee src/x.ts", "Corre: npx vitest …". Los últimos. */
  pasos: string[];
  /** Lo que respondió al final. */
  resultado?: string;
  error?: string;
  costoUsd?: number;
  /** Archivos que cambiaron en cada repo durante el trabajo (según `git status`). */
  cambios: Array<{ repo: string; archivos: string[] }>;
}

const MAX_PASOS = 60;
const MAX_TRABAJOS = 30;

export const HERRAMIENTAS_PERMITIDAS = [
  "Read", "Glob", "Grep", "Edit", "MultiEdit", "Write", "TodoWrite",
  "Bash(flowbrain:*)", "Bash(cd:*)", "Bash(ls:*)", "Bash(git status:*)", "Bash(git diff:*)",
  "Bash(npx vitest:*)", "Bash(npx jest:*)", "Bash(npm test:*)", "Bash(npm run test:*)", "Bash(pnpm test:*)", "Bash(pnpm vitest:*)",
  "Bash(pnpm exec vitest:*)", "Bash(pnpm exec jest:*)", "Bash(yarn test:*)", "Bash(yarn jest:*)", "Bash(yarn vitest:*)",
  "Bash(vendor/bin/phpunit:*)", "Bash(./vendor/bin/phpunit:*)", "Bash(php bin/phpunit:*)", "Bash(php vendor/bin/phpunit:*)", "Bash(composer test:*)",
  "Bash(pytest:*)", "Bash(python -m pytest:*)", "Bash(python3 -m pytest:*)",
];
export const HERRAMIENTAS_PROHIBIDAS = ["Bash(git commit:*)", "Bash(git push:*)", "Bash(git reset:*)", "Bash(git checkout:*)", "Read(**/.env)", "Read(**/.env.*)", "WebFetch", "WebSearch"];

/** El texto que recibe el agente: la guía del tipo de pedido, con el pedido en lugar de `$ARGUMENTS`. */
export function indicacionesDelPedido(tipo: TipoDePedido, pedido: string): string {
  const guia = (tipo === "test" ? GUIA_TESTS : GUIA_ESPECIFICACIONES).replace(/^---\n[\s\S]*?\n---\n/, "");
  return guia.replace("$ARGUMENTS", `Lo que pide la persona, desde el visor de FlowBrain:\n\n${pedido.trim()}\n`);
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
    if (c.name === "Read") out.push(`Lee ${rel(i["file_path"])}`);
    else if (c.name === "Edit" || c.name === "MultiEdit") out.push(`Edita ${rel(i["file_path"])}`);
    else if (c.name === "Write") out.push(`Escribe ${rel(i["file_path"])}`);
    else if (c.name === "Bash") out.push(`Corre: ${corto(String(i["command"] ?? "").replace(/\s+/g, " "), 160)}`);
    else if (c.name === "Grep" || c.name === "Glob") out.push(`Busca ${corto(String(i["pattern"] ?? ""), 80)}`);
  }
  return out;
}

export interface Agente {
  /** `null` si se puede usar; si no, por qué. Se averigua la primera vez y queda guardado. */
  noDisponible(): string | null;
  encolar(p: { tipo: TipoDePedido; pedido: string; etiqueta: string; cerebros: string[] }): Trabajo;
  lista(): Trabajo[];
  cancelar(id: string): Trabajo | null;
}

/** Archivos con cambios sin commitear de un repo, o `null` si no es un repo de git. */
function estadoGit(repo: string): Set<string> | null {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf8", timeout: 20_000 });
  if (r.status !== 0) return null;
  return new Set(r.stdout.split("\n").filter(Boolean).map((l) => l.slice(3)));
}

/**
 * `comando` es el ejecutable de Claude Code (`claude`, o `FLOWBRAIN_AGENTE` para probar con otro). `registro()` se lee
 * cada vez: si el registro cambia, vale lo que hay en disco.
 */
export function crearAgente(registro: () => Promise<Registro>, opciones: { comando?: string } = {}): Agente {
  const comando = opciones.comando ?? process.env["FLOWBRAIN_AGENTE"] ?? "claude";
  let disponible: string | null | undefined;
  const noDisponible = () => {
    if (disponible === undefined) {
      const prueba = spawnSync(comando, ["--version"], { encoding: "utf8", timeout: 15_000 });
      disponible = prueba.error || prueba.status !== 0 ? `no se encontró Claude Code (${comando}) en esta máquina: instalalo, o copiá el pedido y pegáselo a tu agente` : null;
    }
    return disponible;
  };
  const trabajos: Trabajo[] = [];
  const procesos = new Map<string, ChildProcess>();
  let corriendo = false;

  function siguiente() {
    if (corriendo) return;
    const t = trabajos.find((x) => x.estado === "en_cola");
    if (!t) return;
    corriendo = true;
    void correr(t).finally(() => {
      corriendo = false;
      siguiente();
    });
  }

  async function correr(t: Trabajo) {
    t.estado = "corriendo";
    t.empezado = Date.now();
    const reg = await registro();
    const cwd = dirname(reg.carpeta);
    const repos = [...new Set(reg.cerebros.flatMap((c) => c.repos.map((r) => r.ruta)))];
    const antes = new Map(repos.map((r) => [r, estadoGit(r)]));
    const afuera = repos.filter((r) => !resolve(r).startsWith(cwd + sep));
    const args = [
      "-p", indicacionesDelPedido(t.tipo, t.pedido),
      "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits",
      "--allowedTools", ...HERRAMIENTAS_PERMITIDAS,
      "--disallowedTools", ...HERRAMIENTAS_PROHIBIDAS,
      ...(afuera.length ? ["--add-dir", ...afuera] : []),
    ];
    await new Promise<void>((listo) => {
      const p = spawn(comando, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FLOWBRAIN_ROOT: reg.carpeta } });
      procesos.set(t.id, p);
      let resto = "", errores = "";
      const paso = (s: string) => {
        t.pasos.push(s);
        if (t.pasos.length > MAX_PASOS) t.pasos.splice(0, t.pasos.length - MAX_PASOS);
      };
      p.stdout!.setEncoding("utf8");
      p.stdout!.on("data", (d: string) => {
        resto += d;
        const lineas = resto.split("\n");
        resto = lineas.pop() ?? "";
        for (const l of lineas) {
          if (!l.trim()) continue;
          let ev: { type?: string; result?: string; is_error?: boolean; total_cost_usd?: number };
          try {
            ev = JSON.parse(l) as typeof ev;
          } catch {
            continue;
          }
          pasosDeEvento(ev, cwd).forEach(paso);
          if (ev.type === "result") {
            if (typeof ev.result === "string") t.resultado = ev.result;
            if (typeof ev.total_cost_usd === "number") t.costoUsd = ev.total_cost_usd;
            if (ev.is_error) t.error = t.resultado ?? "el agente terminó con error";
          }
        }
      });
      p.stderr!.setEncoding("utf8");
      p.stderr!.on("data", (d: string) => {
        errores = (errores + d).slice(-2000);
      });
      p.on("error", (e) => {
        t.error = `no se pudo lanzar Claude Code: ${e.message}`;
        listo();
      });
      p.on("close", (codigo) => {
        procesos.delete(t.id);
        if (t.estado === "cancelado") return listo();
        if (codigo !== 0 && !t.error) t.error = errores.trim().split("\n").slice(-3).join(" ") || `Claude Code terminó con código ${codigo}`;
        listo();
      });
    });
    // Los cerebros se recompilan aunque el agente ya lo haya hecho: la página tiene que ver lo que quedó en disco.
    for (const nombre of t.cerebros) {
      const c = reg.cerebro(nombre);
      if (!c) continue;
      try {
        await compileDirConVisor(c.raiz);
      } catch (e) {
        t.error = `${t.error ? `${t.error}. ` : ""}No compila ${nombre}: ${(e as Error).message.split("\n")[0]}`;
      }
    }
    for (const r of repos) {
      const a = antes.get(r), d = estadoGit(r);
      if (!a || !d) continue;
      const nuevos = [...d].filter((x) => !a.has(x)).sort();
      if (nuevos.length) t.cambios.push({ repo: relative(cwd, r) || r, archivos: nuevos });
    }
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error ? "fallo" : "terminado";
  }

  return {
    noDisponible,
    encolar(p) {
      const no = noDisponible();
      if (no) throw new Error(no);
      const t: Trabajo = { id: randomBytes(6).toString("hex"), tipo: p.tipo, etiqueta: p.etiqueta, pedido: p.pedido, cerebros: p.cerebros, estado: "en_cola", creado: Date.now(), pasos: [], cambios: [] };
      trabajos.push(t);
      // Los viejos que ya terminaron se olvidan; los que siguen vivos, no.
      while (trabajos.length > MAX_TRABAJOS) {
        const i = trabajos.findIndex((x) => x.estado !== "en_cola" && x.estado !== "corriendo");
        if (i < 0) break;
        trabajos.splice(i, 1);
      }
      siguiente();
      return t;
    },
    lista: () => trabajos.slice().reverse(),
    cancelar(id) {
      const t = trabajos.find((x) => x.id === id);
      if (!t || (t.estado !== "en_cola" && t.estado !== "corriendo")) return t ?? null;
      const p = procesos.get(id);
      t.estado = "cancelado";
      t.terminado = Date.now();
      if (p) p.kill("SIGTERM");
      return t;
    },
  };
}

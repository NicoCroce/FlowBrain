import type { EventoProgreso, Progreso } from "@flowbrain/core";
import { L } from "./idioma.js";

/**
 * Cómo se ve el progreso de un reindexado (decisión 216). En una terminal: una sola línea que se reescribe, con
 * spinner, la etapa y el tiempo, redibujada como mucho cada `cada` ms. Fuera de una terminal (CI, pipes, `claude -p`):
 * líneas simples sin códigos de escape, solo cuando cambia el cerebro, el repo o la etapa grande. Va a stderr: stdout
 * queda para el resultado del comando.
 */

export interface Salida {
  write(texto: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

export interface Reporte {
  progreso: Progreso;
  /** Una línea que queda (el resumen de un cerebro): borra la línea viva y la escribe. */
  linea(texto: string): void;
  /** Borra la línea viva y deja de animar. Se puede llamar más de una vez. */
  terminar(): void;
  /** Si el resumen de cada cerebro se muestra apenas termina (en vez de todo junto al final, por stdout). */
  resumenEnVivo: boolean;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BORRAR = "\r\x1b[2K";

/** `42.3s`, `2m 05s`. */
export function duracion(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const nombreParser = (p: string): string =>
  ({ "ts-parser": "TypeScript", "php-parser": "PHP", "openapi-parser": "OpenAPI", "esquema-parser": L("schema", "esquema"), "infra-parser": "infra" })[p] ?? p;

function textoEtapa(e: EventoProgreso): string {
  switch (e.etapa) {
    case "parsear": {
      const p = nombreParser(e.parser);
      const pct = Math.min(100, Math.floor(e.fraccion * 100));
      return L(`parsing ${p} · ${pct}% of ${e.archivos} files`, `parseando ${p} · ${pct}% de ${e.archivos} archivos`);
    }
    case "extractores":
      return L("running extractors", "corriendo extractores");
    case "llamadas":
      return L("resolving calls", "resolviendo llamadas");
    case "paginas":
      return L("creating pages from drafts", "creando páginas desde borradores");
    case "compilar":
      return L("compiling", "compilando");
    case "fidelidad":
      return L("fidelity and drift", "fidelidad y deriva");
    case "visor":
      return e.todos ? L("viewer for all brains", "visor de todos los cerebros") : L("viewer", "visor");
    default:
      return "";
  }
}

export function crearReporte(salida: Salida, opciones: { tty?: boolean; resumenEnVivo?: boolean; ahora?: () => number; cada?: number; animar?: boolean } = {}): Reporte {
  const tty = opciones.tty ?? salida.isTTY === true;
  const ahora = opciones.ahora ?? Date.now;
  const cada = opciones.cada ?? 100;
  const inicio = ahora();
  let cerebro: { cerebro: string; n: number; de: number } | null = null;
  let repo: { repo: string; n: number; de: number; pasada?: number; pasadas?: number } | null = null;
  let detalle = "";
  let clave = "";
  let ultimo = -Infinity;
  let cuadro = 0;
  let viva = false;
  let reloj: ReturnType<typeof setInterval> | null = null;
  let cerrado = false;

  const contexto = () => {
    const partes: string[] = [];
    if (cerebro) partes.push(cerebro.de > 1 ? `[${cerebro.n}/${cerebro.de}] ${cerebro.cerebro}` : cerebro.cerebro);
    if (repo) {
      const pasada = repo.pasada && repo.pasadas ? L(` pass ${repo.pasada}/${repo.pasadas}`, ` pasada ${repo.pasada}/${repo.pasadas}`) : "";
      const cuenta = repo.de > 1 ? ` ${repo.n}/${repo.de}` : "";
      partes.push(`${repo.repo}${cuenta || pasada ? ` (${[cuenta.trim(), pasada.trim()].filter(Boolean).join(", ")})` : ""}`);
    }
    return partes.join(" › ");
  };

  const pintar = () => {
    if (cerrado) return;
    ultimo = ahora();
    const texto = `${SPINNER[cuadro++ % SPINNER.length]} ${[contexto(), detalle].filter(Boolean).join(" · ")} · ${duracion(ultimo - inicio)}`;
    const ancho = Math.max(20, (salida.columns || 80) - 1);
    const recortado = [...texto].length > ancho ? [...texto].slice(0, ancho - 1).join("") + "…" : texto;
    salida.write(BORRAR + recortado);
    viva = true;
  };
  const borrar = () => {
    if (viva) salida.write(BORRAR);
    viva = false;
  };
  const llano = (texto: string) => salida.write(`${[contexto(), texto].filter(Boolean).join(" · ")}\n`);

  const progreso: Progreso = (e) => {
    if (cerrado) return;
    switch (e.etapa) {
      case "cerebro":
        cerebro = { cerebro: e.cerebro, n: e.n, de: e.de };
        repo = null;
        detalle = "";
        break;
      case "repo":
        repo = { repo: e.repo, n: e.n, de: e.de, ...(e.pasada !== undefined ? { pasada: e.pasada } : {}), ...(e.pasadas !== undefined ? { pasadas: e.pasadas } : {}) };
        detalle = "";
        break;
      case "compilar":
      case "fidelidad":
      case "visor":
        // Etapas del cerebro entero (o del registro): el repo ya no viene al caso.
        repo = null;
        if (e.etapa === "visor" && e.todos) cerebro = null;
        detalle = textoEtapa(e);
        break;
      case "cerebro_listo":
        if (!tty) llano(L(`done in ${duracion(e.ms)}`, `listo en ${duracion(e.ms)}`) + (e.fallidos ? L(`; ${e.fallidos} repo(s) failed`, `; fallaron ${e.fallidos} repo(s)`) : ""));
        repo = null;
        detalle = "";
        return;
      default:
        detalle = textoEtapa(e);
    }
    if (!tty) {
      // Sin terminal: una línea por cerebro, por repo y por etapa grande; nada por archivo.
      if (e.etapa === "cerebro" || e.etapa === "repo") llano("");
      else if (e.etapa === "compilar" || (e.etapa === "visor" && e.todos)) llano(detalle);
      return;
    }
    const nueva = `${e.etapa}:${e.etapa === "parsear" ? e.parser : ""}`;
    const cambio = nueva !== clave;
    clave = nueva;
    if (cambio || ahora() - ultimo >= cada) pintar();
    if (!reloj && opciones.animar !== false) {
      // Para que el spinner y el tiempo sigan mientras algo largo espera disco; no retiene el proceso.
      reloj = setInterval(() => ahora() - ultimo >= cada && viva && pintar(), cada);
      reloj.unref?.();
    }
  };

  return {
    progreso,
    resumenEnVivo: tty && opciones.resumenEnVivo === true,
    linea(texto) {
      if (tty) borrar();
      salida.write(texto.endsWith("\n") ? texto : texto + "\n");
    },
    terminar() {
      if (reloj) clearInterval(reloj);
      reloj = null;
      if (tty) borrar();
      cerrado = true;
    },
  };
}

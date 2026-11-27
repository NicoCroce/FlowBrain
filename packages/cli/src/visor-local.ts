import { request } from "node:http";
import { L } from "./idioma.js";
import { HUELLA, PUERTO_VISOR, rutaReal, servirVisor, type ServidorVisor } from "./servidor-visor.js";

/**
 * La opción "Abrir el visor" del menú: el visor servido en `127.0.0.1` (con edición), no el archivo estático.
 * Decide en este orden:
 * 1. si en alguno de los puertos del visor ya hay un servidor de FlowBrain para este mismo registro y con el mismo código
 *    (la misma huella), se reusa; uno del mismo registro con código anterior no se reusa y se avisa (`viejos`);
 * 2. si no, se levanta uno en el primer puerto libre desde 4780;
 * 3. si no se puede (todos ocupados, un error al escuchar, o la página no carga), se cae al archivo estático con el motivo.
 */

export const INTENTOS_PUERTO = 10;

export type ResultadoVisor =
  | { modo: "reusa"; url: string }
  | { modo: "nuevo"; url: string; servidor: ServidorVisor; viejos?: string[] }
  | { modo: "estatico"; motivo: string };

/** Lo que la decisión necesita del mundo: las pruebas lo reemplazan. */
export interface DepsVisorLocal {
  /** El registro (y la huella del código) que atiende el visor de FlowBrain en ese puerto, o null si no hay uno. */
  quien(puerto: number): Promise<{ registro: string; huella?: string } | null>;
  /** La huella del código que corre ahora (por defecto, `HUELLA`). */
  huella?: string;
  /** Escucha en ese puerto; rechaza con `code: "EADDRINUSE"` si está ocupado. */
  servir(puerto: number): Promise<ServidorVisor>;
  /** Pide la página: estado HTTP y, si falló, el error que explica el servidor. */
  pagina(url: string): Promise<{ estado: number; error?: string }>;
  /** Cómo comparar rutas (por defecto, sin symlinks). */
  mismaRuta?(a: string, b: string): boolean;
}

export const puertosCandidatos = (base = PUERTO_VISOR, intentos = INTENTOS_PUERTO): number[] =>
  Array.from({ length: intentos }, (_, i) => base + i).filter((p) => p > 0 && p <= 65535);

export async function prepararVisor(registro: string, deps: DepsVisorLocal, opciones: { base?: number; intentos?: number } = {}): Promise<ResultadoVisor> {
  const puertos = puertosCandidatos(opciones.base, opciones.intentos);
  const misma = deps.mismaRuta ?? ((a, b) => rutaReal(a) === rutaReal(b));
  const huella = deps.huella ?? HUELLA;
  const viejos: string[] = [];
  for (const p of puertos) {
    const r = await deps.quien(p).catch(() => null);
    if (r === null || !misma(r.registro, registro)) continue;
    // Levantado antes de actualizar FlowBrain: sirve la pantalla vieja, así que no se reusa.
    if (r.huella !== huella) viejos.push(`http://127.0.0.1:${p}/`);
    else return { modo: "reusa", url: `http://127.0.0.1:${p}/` };
  }
  for (const p of puertos) {
    let s: ServidorVisor;
    try {
      s = await deps.servir(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      return { modo: "estatico", motivo: L(`the server could not listen on port ${p}: ${(e as Error).message}`, `el servidor no pudo escuchar en el puerto ${p}: ${(e as Error).message}`) };
    }
    const url = s.url();
    const pag = await deps.pagina(url).catch((e: Error) => ({ estado: 0, error: e.message }));
    if (pag.estado !== 200) {
      await cerrarServidor(s);
      const detalle = `${pag.estado || L("no response", "sin respuesta")}${pag.error ? `: ${pag.error}` : ""}`;
      return { modo: "estatico", motivo: L(`the server started but the page did not load (${detalle})`, `el servidor arrancó pero la página no cargó (${detalle})`) };
    }
    return { modo: "nuevo", url, servidor: s, ...(viejos.length ? { viejos } : {}) };
  }
  return { modo: "estatico", motivo: L(`ports ${puertos[0]} to ${puertos[puertos.length - 1]} are taken by other programs`, `los puertos ${puertos[0]} a ${puertos[puertos.length - 1]} están ocupados por otros programas`) };
}

export function cerrarServidor(s: ServidorVisor): Promise<void> {
  return new Promise((ok) => {
    s.server.close(() => ok());
    // Las pestañas abiertas mantienen la conexión: sin esto, close espera a que el navegador la suelte.
    s.server.closeAllConnections();
  });
}

function get(url: string, ms = 1500): Promise<{ estado: number; cuerpo: string }> {
  return new Promise((ok, mal) => {
    const req = request(url, { method: "GET", timeout: ms }, (res) => {
      let cuerpo = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (cuerpo += c));
      res.on("end", () => ok({ estado: res.statusCode ?? 0, cuerpo }));
    });
    req.on("timeout", () => req.destroy(new Error(L("did not respond in time", "no respondió a tiempo"))));
    req.on("error", mal);
    req.end();
  });
}

/** Las dependencias reales: HTTP contra `127.0.0.1` y `servirVisor`. */
export function depsReales(registro: string): DepsVisorLocal {
  return {
    quien: async (p) => {
      const r = await get(`http://127.0.0.1:${p}/api/quien`, 400);
      if (r.estado !== 200) return null;
      const j = JSON.parse(r.cuerpo) as { flowbrain?: boolean; registro?: string; huella?: unknown };
      if (j.flowbrain !== true || typeof j.registro !== "string") return null;
      return { registro: j.registro, ...(typeof j.huella === "string" ? { huella: j.huella } : {}) };
    },
    servir: (p) => servirVisor(registro, p),
    pagina: async (url) => {
      const r = await get(url, 60_000);
      if (r.estado === 200) return { estado: 200 };
      try {
        const error = (JSON.parse(r.cuerpo) as { error?: unknown }).error;
        if (typeof error === "string") return { estado: r.estado, error };
      } catch {
        /* no era JSON */
      }
      return { estado: r.estado };
    },
  };
}

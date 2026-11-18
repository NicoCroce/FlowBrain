import { cmp } from "./canonical.js";
import type { Verbo } from "./schema.js";

/**
 * Componentes y dependencias entre paquetes. Un repo publica un paquete con un nombre (su manifiesto: `package.json`,
 * `go.mod`, `pubspec.yaml`…) y otro repo lo declara como dependencia y lo importa. Con eso se unen: un sistema de
 * diseño con las pantallas que dibujan sus componentes, una librería compartida con los servicios que la usan. Es
 * igual para cualquier lenguaje: el parser (o un extractor) dice qué exporta cada archivo y qué toma de qué paquete.
 */

export interface PaqueteDelRepo {
  carpeta: string;
  /** Manifiesto que lo declara (ruta en el repo). */
  manifiesto?: string | undefined;
  /** Nombre con el que se publica; sin nombre no se puede importar desde otro repo. */
  nombre?: string | undefined;
  /** Paquetes de los que declara depender, con la línea del manifiesto. */
  dependeDe?: Array<{ nombre: string; linea: number }> | undefined;
}

export interface RepoLeido {
  repo: string;
  archivos: Array<{
    ruta: string;
    componentes?: Array<{ nombre: string; linea: number }> | undefined;
    usaPaquetes?: Array<{ desde: string | null; paquete: string; simbolo: string; linea: number }> | undefined;
  }>;
  paquetes: PaqueteDelRepo[];
  /** Servicio (o el repo) dueño de un archivo. */
  dueñoDe(archivo: string): string;
  /** Lo que alcanza cada pantalla del repo (se calcula solo si hace falta). */
  alcance(): Map<string, { simbolos: Set<string>; archivos: Set<string> }>;
}

export interface NodoComponente {
  id: string;
  nombre: string;
  aliases: string[];
  atributos: { paquete: string; archivo: string; evidencia: string };
}

export interface AristaComponente {
  desde: string;
  verbo: Verbo;
  hasta: string;
  evidencia: string;
  dato?: string;
}

/** Paquete con nombre más específico que contiene un archivo. */
export function paqueteDeArchivo<P extends { carpeta: string; nombre?: string | undefined }>(paquetes: P[], archivo: string): P | null {
  let mejor: P | null = null;
  for (const p of paquetes) {
    if (!p.nombre || (p.carpeta !== "" && archivo !== p.carpeta && !archivo.startsWith(`${p.carpeta}/`))) continue;
    if (!mejor || p.carpeta.length > mejor.carpeta.length) mejor = p;
  }
  return mejor;
}

/** Quién usa cada uso: las pantallas que llegan a esa línea o, si no es de ninguna, el dueño del archivo. */
export function quienesUsan(r: RepoLeido, ruta: string, desde: string | null, cache: { alcance?: ReturnType<RepoLeido["alcance"]> }): string[] {
  const alcance = (cache.alcance ??= r.alcance());
  const pantallas: string[] = [];
  for (const [id, a] of alcance) if (desde ? a.simbolos.has(`${r.repo}:${ruta}#${desde}`) : a.archivos.has(ruta)) pantallas.push(id);
  return pantallas.sort(cmp);
}

const carpetaComoArchivo = (carpeta: string, manifiesto?: string) => manifiesto ?? (carpeta ? `${carpeta}/` : "");

export function componentesDelCerebro(repos: RepoLeido[]): { nodos: NodoComponente[]; aristas: AristaComponente[] } {
  const nodos = new Map<string, NodoComponente>();
  const porPaquete = new Map<string, string>(); // `paquete\0Nombre` → id
  const dueñoDePaquete = new Map<string, string>(); // nombre del paquete → dueño
  for (const r of repos) {
    for (const p of r.paquetes) if (p.nombre && !dueñoDePaquete.has(p.nombre)) dueñoDePaquete.set(p.nombre, r.dueñoDe(carpetaComoArchivo(p.carpeta, p.manifiesto)));
    for (const a of r.archivos) {
      if (!a.componentes?.length) continue;
      const p = paqueteDeArchivo(r.paquetes, a.ruta);
      if (!p?.nombre) continue;
      for (const c of a.componentes) {
        const k = `${p.nombre}\u0000${c.nombre}`;
        if (porPaquete.has(k)) continue;
        const id = `${r.dueñoDe(a.ruta)}:componente:${c.nombre}`;
        if (nodos.has(id)) continue;
        porPaquete.set(k, id);
        nodos.set(id, { id, nombre: c.nombre, aliases: [`${p.nombre}/${c.nombre}`], atributos: { paquete: p.nombre, archivo: `${r.repo}:${a.ruta}`, evidencia: `${r.repo}:${a.ruta}#L${c.linea}` } });
      }
    }
  }
  const aristas = new Map<string, AristaComponente>();
  const sumar = (x: AristaComponente) => {
    const k = `${x.desde}\u0000${x.verbo}\u0000${x.hasta}`;
    if (x.desde !== x.hasta && !aristas.has(k)) aristas.set(k, x);
  };
  for (const r of repos) {
    const cache: { alcance?: ReturnType<RepoLeido["alcance"]> } = {};
    for (const a of r.archivos) {
      for (const u of a.usaPaquetes ?? []) {
        const id = porPaquete.get(`${u.paquete}\u0000${u.simbolo}`);
        if (!id) continue;
        const ev = `${r.repo}:${a.ruta}#L${u.linea}`;
        const pantallas = quienesUsan(r, a.ruta, u.desde, cache);
        for (const q of pantallas.length ? pantallas : [r.dueñoDe(a.ruta)]) sumar({ desde: q, verbo: "usa", hasta: id, evidencia: ev });
        const dueño = dueñoDePaquete.get(u.paquete);
        if (dueño) sumar({ desde: r.dueñoDe(a.ruta), verbo: "depende_de", hasta: dueño, evidencia: ev, dato: u.paquete });
      }
    }
    // Lo declarado en el manifiesto: depende de un paquete que publica otro repo del cerebro (también en un back).
    for (const p of r.paquetes) {
      for (const d of p.dependeDe ?? []) {
        const dueño = dueñoDePaquete.get(d.nombre);
        if (!dueño || d.nombre === p.nombre || !p.manifiesto) continue;
        sumar({ desde: r.dueñoDe(p.manifiesto), verbo: "depende_de", hasta: dueño, evidencia: `${r.repo}:${p.manifiesto}#L${d.linea}`, dato: d.nombre });
      }
    }
  }
  return {
    nodos: [...nodos.values()].sort((a, b) => cmp(a.id, b.id)),
    aristas: [...aristas.values()].sort((a, b) => cmp(a.desde, b.desde) || cmp(a.verbo, b.verbo) || cmp(a.hasta, b.hasta)),
  };
}

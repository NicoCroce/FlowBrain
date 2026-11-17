import { cmpTuple } from "./canonical.js";
import type { Ficha } from "./funcionalidades.js";
import type { Graph } from "./schema.js";

/**
 * Modelo de dependencias del visor: "A depende de B" (si B cambia, A puede verse afectado). Alimenta dos vistas:
 * el mapa de dependencias entre funcionalidades y el análisis de impacto. Combina el grafo técnico (servicios que
 * llaman, leen o escriben) con lo que derivan las fichas (funcionalidad que usa otra, toca una tabla o llama a un
 * endpoint), así sirve para cualquier pieza: tabla, endpoint, servicio, externo o funcionalidad.
 */

/** [desde, hasta, verbo, veces]: `desde` depende de `hasta`. */
export type Dependencia = [string, string, string, number];

/** Verbos del grafo que expresan dependencia, en el sentido de la arista. */
const VERBOS_DEPENDENCIA = new Set(["llama_a", "publica_en", "consume_de", "lee_de", "escribe_en", "depende_de"]);

export function dependenciasDelGrafo(graph: Graph, fichas: Ficha[]): Dependencia[] {
  const tipo = new Map(graph.nodes.map((n) => [n.id, n.tipo]));
  const m = new Map<string, Dependencia>();
  const sumar = (desde: string, hasta: string, verbo: string, veces = 1) => {
    if (desde === hasta || !tipo.has(desde) || !tipo.has(hasta)) return;
    const k = `${desde}\u0000${hasta}\u0000${verbo}`;
    const d = m.get(k);
    if (d) d[3] += veces;
    else m.set(k, [desde, hasta, verbo, veces]);
  };
  for (const e of graph.edges) {
    if (e.estado === "deprecado") continue;
    // Lo que sale de una funcionalidad lo suman las fichas más abajo, con sus cantidades.
    if (VERBOS_DEPENDENCIA.has(e.verbo) && tipo.get(e.desde) !== "feat") {
      sumar(e.desde, e.hasta, e.verbo);
      if (e.endpoint) sumar(e.desde, e.endpoint, "llama_a");
    }
    // Una funcionalidad depende del servicio que la implementa; una tabla, de la base donde vive.
    if (e.verbo === "implementa") sumar(e.hasta, e.desde, "implementa");
    if (e.verbo === "vive_en" && tipo.get(e.desde) === "tabla") sumar(e.desde, e.hasta, "vive_en");
  }
  for (const f of fichas) {
    for (const u of f.usaFuncionalidades) {
      const dueña = fichas.find((x) => x.id === u);
      const endpoints = dueña ? new Set(f.usa.filter((x) => x.endpoint && dueña.expone.includes(x.endpoint)).map((x) => x.endpoint)).size : 0;
      sumar(f.id, u, "usa", Math.max(1, endpoints));
    }
    for (const d of f.datos) {
      if (d.escribe) sumar(f.id, d.tabla, "escribe_en", d.escribe);
      if (d.lee) sumar(f.id, d.tabla, "lee_de", d.lee);
    }
    for (const u of f.usa) {
      if (u.endpoint) sumar(f.id, u.endpoint, "llama_a", u.veces);
      else sumar(f.id, u.hasta, "llama_a", u.veces);
    }
  }
  return [...m.values()].sort((a, b) => cmpTuple([a[0], a[1], a[2]], [b[0], b[1], b[2]]));
}

/**
 * Recorrido inverso por niveles, en JavaScript plano: lo usan el visor (embebido) y los tests (evaluado), así hay
 * una sola implementación. Nivel 1 son las piezas que dependen directo del origen; nivel 2, las que dependen de esas.
 * `implementa` solo se sigue desde el origen: cambiar un servicio afecta a lo que implementa, pero llegar a un
 * servicio por propagación no arrastra a todas sus funcionalidades.
 */
export const IMPACTO_JS = String.raw`function impacto(deps, origen) {
  var entran = {};
  deps.forEach(function (d) { (entran[d[1]] = entran[d[1]] || []).push(d); });
  var visto = {}, niveles = [], frente = [origen];
  visto[origen] = true;
  while (frente.length) {
    var nivel = [];
    frente.forEach(function (id) {
      (entran[id] || []).forEach(function (d) {
        if (d[2] === "implementa" && id !== origen) return;
        if (visto[d[0]]) return;
        visto[d[0]] = true;
        nivel.push({ id: d[0], via: id, verbo: d[2] });
      });
    });
    if (!nivel.length) break;
    nivel.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    niveles.push(nivel);
    frente = nivel.map(function (x) { return x.id; });
  }
  return niveles;
}`;

export interface Afectado {
  id: string;
  /** Pieza de la que depende (del nivel anterior) y cómo. */
  via: string;
  verbo: string;
}

export const impacto = new Function(`${IMPACTO_JS}; return impacto;`)() as (deps: Dependencia[], origen: string) => Afectado[][];

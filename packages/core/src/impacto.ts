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
const VERBOS_DEPENDENCIA = new Set(["llama_a", "publica_en", "consume_de", "lee_de", "escribe_en", "depende_de", "usa"]);

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
    // (salvo hacia una librería: eso no está en las fichas).
    if (VERBOS_DEPENDENCIA.has(e.verbo) && (tipo.get(e.desde) !== "feat" || tipo.get(e.hasta) === "lib")) {
      sumar(e.desde, e.hasta, e.verbo);
      if (e.endpoint) sumar(e.desde, e.endpoint, "llama_a");
    }
    // Una funcionalidad depende del servicio que la implementa; una tabla, de la base donde vive.
    if (e.verbo === "implementa") sumar(e.hasta, e.desde, "implementa");
    if (e.verbo === "vive_en" && tipo.get(e.desde) === "tabla") sumar(e.desde, e.hasta, "vive_en");
    // Una cola depende de quien publica en ella: si cambia el mensaje, se ven afectados los que consumen.
    if (e.verbo === "publica_en") sumar(e.hasta, e.desde, "alimenta");
  }
  // Una funcionalidad usa los componentes que dibujan sus pantallas: cambiar un componente del sistema de diseño
  // llega a ellas (la pantalla no arrastra a su funcionalidad por propagación, así que se suma directo).
  const funcionalidadesDe = new Map<string, string[]>();
  for (const e of graph.edges) if (e.verbo === "implementa" && tipo.get(e.desde) === "pantalla" && tipo.get(e.hasta) === "feat") funcionalidadesDe.set(e.desde, [...(funcionalidadesDe.get(e.desde) ?? []), e.hasta]);
  for (const e of graph.edges) if (e.verbo === "usa" && e.estado !== "deprecado" && tipo.get(e.hasta) === "componente") for (const f of funcionalidadesDe.get(e.desde) ?? []) sumar(f, e.hasta, "usa");
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
 * servicio por propagación no arrastra a todas sus funcionalidades. Una cola a la que se llegó porque cambió quien
 * publica afecta a los que consumen, no a los demás que publican.
 */
export const IMPACTO_JS = String.raw`function impacto(deps, origen) {
  var entran = {};
  deps.forEach(function (d) { (entran[d[1]] = entran[d[1]] || []).push(d); });
  var visto = {}, por = {}, niveles = [], frente = [origen];
  visto[origen] = true;
  while (frente.length) {
    var nivel = [];
    frente.forEach(function (id) {
      (entran[id] || []).forEach(function (d) {
        if (d[2] === "implementa" && id !== origen) return;
        if (d[2] === "publica_en" && por[id] === "alimenta") return;
        if (visto[d[0]]) return;
        visto[d[0]] = true;
        por[d[0]] = d[2];
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

/**
 * La otra dirección: de qué depende una pieza (lo que, si cambia, la afecta a ella), por niveles. Las mismas reglas:
 * "implementa" solo desde el origen, y un servicio alcanzado no se expande (sería todo lo que ese servicio toca).
 * `tipo(id)` da el tipo de cada pieza. La usan el visor y el MCP.
 */
export const DEPENDE_JS = String.raw`function dependeDe(deps, origen, tipo, tope) {
  var salen = {};
  deps.forEach(function (d) { (salen[d[0]] = salen[d[0]] || []).push(d); });
  var visto = {}, niveles = [], frente = [origen];
  visto[origen] = true;
  while (frente.length && niveles.length < (tope || 8)) {
    var nivel = [];
    frente.forEach(function (id) {
      if (id !== origen && tipo(id) === "svc") return;
      (salen[id] || []).forEach(function (d) {
        if (d[2] === "implementa" && id !== origen) return;
        if (visto[d[1]]) return;
        visto[d[1]] = true;
        nivel.push({ id: d[1], via: id, verbo: d[2] });
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
export const dependeDe = new Function(`${DEPENDE_JS}; return dependeDe;`)() as (deps: Dependencia[], origen: string, tipo: (id: string) => string | undefined, tope?: number) => Afectado[][];

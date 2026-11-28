import type { Contexto } from "./engine/contexto.js";
import { ConsultaError, normalizar } from "./engine/herramientas.js";
import type { Ficha, Paso } from "./funcionalidades.js";
import type { Graph } from "./schema.js";

/**
 * Trazabilidad completa de un nodo: la cadena de punta a punta que pasa por él, en las dos direcciones y solo por
 * relaciones de flujo. Hacia arriba, quién llega a él (funcionalidad → pantalla → hook o componente → método que
 * llama); hacia abajo, a dónde va (endpoint → método que lo atiende → los que llama → tabla, cola o externo),
 * cruzando de cerebro por HTTP, eventos o colas. Las dos direcciones nunca se mezclan: lo que se alcanzó subiendo no
 * se expande bajando (sería la otra pantalla de la misma funcionalidad, un vecino lateral), y un servicio alcanzado
 * no se expande (sería todo lo que el servicio hace).
 *
 * Los pasos de los recorridos (métodos, hooks) entran como nodos propios (`m:<archivo>#<símbolo>`), así la cadena
 * de una tabla sube por los métodos que la tocan de verdad y no por todo el archivo. Cada arista lleva su evidencia
 * `repo:ruta#Ln`.
 *
 * JavaScript plano dentro de `String.raw` (sin backticks ni `${`): lo embebe el visor (Mapa 3D) y lo evalúan el MCP
 * y los tests, así hay una sola implementación.
 */

/** Lo que necesita la red de flujo: el grafo (con los ids como los ve quien la usa), las fichas y las trazas entre cerebros. */
export interface EntradaRed {
  nodos: Array<{ id: string; tipo: string; c?: string | number | null; nombre?: string; archivo?: string | null }>;
  /** s: desde, h: hasta, v: verbo, ev: evidencia, p: endpoint (si la arista va a un servicio por un endpoint). */
  aristas: Array<{ s: string; h: string; v: string; ev?: string | null; p?: string | null }>;
  fichas?: Array<Pick<Ficha, "id" | "recorridos"> & { pantallas?: Array<{ id: string; recorrido: { pasos: Paso[]; truncado?: true } }> }>;
  /** Trazas entre cerebros (`trazasCruzadas`), con los ids ya prefijados. */
  cruzado?: { pantallas: Record<string, { pasos: Paso[] }>; backs: Record<string, { pasos: Paso[]; truncado?: true }> };
  /** Llamadas sin resolver (deriva): `pref` es el prefijo del cerebro (`web/`, o vacío con uno solo). */
  huecos?: Array<{ pref: string; ev: string; texto: string }>;
  /** Varios cerebros: los ids llevan `cerebro/` y la evidencia de un paso se ubica con el prefijo de su dueño. */
  multi?: boolean;
}

export const RED_FLUJO_JS = String.raw`function redDeFlujo(d) {
  var tipo = {}, cer = {}, nombre = {}, archivoDe = {};
  d.nodos.forEach(function (n) { tipo[n.id] = n.tipo; cer[n.id] = n.c === undefined ? null : n.c; nombre[n.id] = n.nombre || n.id; if (n.archivo) archivoDe[n.id] = n.archivo; });
  var sale = {}, entra = {}, metodo = {}, porArchivo = {}, huecos = {}, claves = {};
  function arista(a, b, v, ev, via) {
    if (a === b) return;
    var k = a + "\u0000" + b + "\u0000" + v;
    if (claves[k]) return;
    var x = { a: a, b: b, v: v, ev: ev || null, via: via || null };
    claves[k] = x;
    (sale[a] = sale[a] || []).push(x); (entra[b] = entra[b] || []).push(x);
  }
  function hueco(id, texto, ev) {
    var l = huecos[id] = huecos[id] || [];
    if (!l.some(function (h) { return h.texto === texto && h.ev === ev; })) l.push({ texto: texto, ev: ev || null });
  }
  function pref(id) { if (!d.multi) return ""; var i = id.indexOf("/"); return i > 0 ? id.slice(0, i + 1) : ""; }
  /** Los pasos de un recorrido como nodos: el dueño (endpoint o pantalla) llama al primero y cada uno a los de un nivel más. */
  function recorrer(duenio, pasos, truncado) {
    if (!tipo[duenio]) return {};
    var p0 = pref(duenio), pila = [], alcanza = {}, front = tipo[duenio] === "pantalla";
    (pasos || []).forEach(function (p) {
      var archivo = p.evidencia.split("#")[0], mid = "m:" + p0 + archivo + "#" + p.simbolo;
      if (!metodo[mid]) {
        metodo[mid] = { id: mid, simbolo: p.simbolo, ev: p.evidencia, capa: p.capa, archivo: tipo[p0 + archivo] ? p0 + archivo : null, c: cer[duenio], front: front };
        if (metodo[mid].archivo) (porArchivo[p0 + archivo] = porArchivo[p0 + archivo] || []).push(mid);
        tipo[mid] = "metodo"; cer[mid] = cer[duenio]; nombre[mid] = p.simbolo;
      }
      pila.length = p.nivel;
      var padre = (p.nivel > 0 && pila[p.nivel - 1]) || duenio;
      arista(padre, mid, padre === duenio ? (front ? "dibuja" : "atiende") : "llama_a", p.evidencia, p.via);
      pila[p.nivel] = mid;
      if (p.aviso) hueco(mid, p.aviso, p.evidencia);
      // Un paso repetido resume lo que tocó la primera vez (él y lo que llama): eso ya está en sus aristas.
      if (p.repite) return;
      (p.toca || []).forEach(function (t) {
        var h = t.endpoint && tipo[t.endpoint] ? t.endpoint : t.hasta;
        if (!tipo[h] && t.sinPagina) {
          h = "t:" + p0 + t.hasta;
          tipo[h] = "tabla"; cer[h] = cer[duenio]; nombre[h] = t.hasta;
          hueco(h, "sin_pagina", p.evidencia);
        }
        if (!tipo[h]) { hueco(mid, "fuera_del_grafo:" + (t.endpoint || t.hasta), p.evidencia); return; }
        arista(mid, h, t.verbo, p.evidencia, null);
        alcanza[h] = true;
      });
    });
    if (truncado) hueco(duenio, "truncado", null);
    return alcanza;
  }
  var alcanzan = {}, conPasos = {};
  function sumar(duenio, r) { conPasos[duenio] = true; var a = alcanzan[duenio] = alcanzan[duenio] || {}; Object.keys(r).forEach(function (k) { a[k] = true; }); }
  (d.fichas || []).forEach(function (f) {
    (f.recorridos || []).forEach(function (r) { if (r.pasos.length) sumar(r.endpoint, recorrer(r.endpoint, r.pasos, r.truncado)); else if (tipo[r.endpoint]) hueco(r.endpoint, "sin_metodo", null); });
    (f.pantallas || []).forEach(function (p) { if (p.recorrido && p.recorrido.pasos.length) sumar(p.id, recorrer(p.id, p.recorrido.pasos, p.recorrido.truncado)); });
  });
  var cz = d.cruzado || { pantallas: {}, backs: {} };
  Object.keys(cz.pantallas || {}).forEach(function (id) { sumar(id, recorrer(id, cz.pantallas[id].pasos, false)); });
  Object.keys(cz.backs || {}).forEach(function (id) { if (cz.backs[id].pasos.length) sumar(id, recorrer(id, cz.backs[id].pasos, cz.backs[id].truncado)); });
  // Lo que el grafo sabe a nivel de pieza. Las llamadas y accesos directos solo completan lo que los pasos no alcanzaron.
  var FLUJO = { llama_a: 1, lee_de: 1, escribe_en: 1, publica_en: 1 };
  var DESDE = { pantalla: 1, endpoint: 1, archivo: 1, test: 1, componente: 1 };
  d.aristas.forEach(function (e) {
    var ts = tipo[e.s], th = tipo[e.h];
    if (!ts || !th) return;
    if (e.v === "implementa" && th === "feat" && (ts === "pantalla" || ts === "endpoint")) arista(e.h, e.s, "implementa", e.ev);
    else if (e.v === "usa" && th === "componente" && ts === "pantalla") arista(e.s, e.h, "usa", e.ev);
    else if (e.v === "contiene" && ts === "svc" && (th === "endpoint" || th === "pantalla")) arista(e.s, e.h, "contiene", e.ev);
    else if (e.v === "consume_de" && th === "queue" && (ts === "svc" || ts === "endpoint")) arista(e.h, e.s, "consume_de", e.ev);
    else if (FLUJO[e.v]) {
      var h = e.p && tipo[e.p] ? e.p : e.h;
      if (DESDE[ts] || (ts === "svc" && tipo[h] === "endpoint" && cer[e.s] !== cer[h])) {
        if (conPasos[e.s] && alcanzan[e.s] && alcanzan[e.s][h]) return;
        arista(e.s, h, e.v, e.ev);
      }
    }
  });
  // Un endpoint vive en el servicio de su id: si el grafo no lo dice con "contiene", igual se sabe quién lo atiende.
  d.nodos.forEach(function (n) {
    if (n.tipo !== "endpoint") return;
    var svc = n.id.slice(0, n.id.indexOf(":"));
    if (tipo[svc] === "svc" && !claves[svc + "\u0000" + n.id + "\u0000contiene"]) arista(svc, n.id, "contiene", null);
  });
  // Un componente es el código de su archivo: los pasos que viven ahí son suyos.
  Object.keys(archivoDe).forEach(function (id) { var a = archivoDe[id]; if (porArchivo[a]) porArchivo[id] = (porArchivo[id] || []).concat(porArchivo[a].filter(function (m) { return metodo[m].simbolo === nombre[id] || metodo[m].simbolo.indexOf(nombre[id] + ".") === 0; })); });
  // Una llamada sin resolver va al paso que la contiene: el último del archivo que empieza antes de su línea.
  var linea = function (ev) { var m = /#L(\d+)/.exec(ev || ""); return m ? Number(m[1]) : 0; };
  (d.huecos || []).forEach(function (x) {
    var a = x.pref + x.ev.split("#")[0], l = linea(x.ev), mejor = null;
    (porArchivo[a] || []).forEach(function (m) { var lm = linea(metodo[m].ev); if (lm <= l && (!mejor || lm > linea(metodo[mejor].ev))) mejor = m; });
    if (mejor) hueco(mejor, "sin_resolver:" + x.texto, x.ev);
  });
  return { tipo: tipo, cer: cer, nombre: nombre, sale: sale, entra: entra, metodo: metodo, porArchivo: porArchivo, huecos: huecos };
}`;

export const TRAZABILIDAD_JS = String.raw`function trazabilidad(red, origen, tope) {
  tope = tope || 300;
  if (!red.tipo[origen]) return null;
  var CAPA = { feat: 0, pantalla: 1, componente: 2, archivo: 3, test: 3, endpoint: 4, svc: 5, queue: 6, tabla: 7, db: 7, ext: 8, lib: 8 };
  var capa = function (id) { var t = red.tipo[id]; if (t === "metodo") return red.metodo[id].front ? 2 : 5; return CAPA[t] === undefined ? 9 : CAPA[t]; };
  // El origen y lo que es él mismo: los pasos que viven en su archivo (un archivo, un test, un componente).
  var inicio = [origen].concat(red.porArchivo[origen] || []);
  var esInicio = {}; inicio.forEach(function (x) { esInicio[x] = true; });
  var TOPE_DURO = 20000;
  var lado = {}, dist = {}, orden = [], usadas = [];
  inicio.forEach(function (x) { lado[x] = "origen"; dist[x] = 0; orden.push(x); });
  function correr(haciaAbajo) {
    var cola = inicio.slice(), vistos = {};
    inicio.forEach(function (x) { vistos[x] = true; });
    for (var i = 0; i < cola.length && orden.length < TOPE_DURO; i++) {
      var x = cola[i];
      // Un servicio alcanzado no se expande: sería todo lo que hace. Subiendo, una funcionalidad es el techo.
      if (!esInicio[x] && red.tipo[x] === "svc") continue;
      var as = (haciaAbajo ? red.sale[x] : red.entra[x]) || [];
      for (var j = 0; j < as.length; j++) {
        var e = as[j];
        // "usa" (pantalla → componente) es un vecino de dibujo: solo se sube por él. "contiene" solo desde el origen.
        if (haciaAbajo && e.v === "usa") continue;
        if (e.v === "contiene" && (haciaAbajo ? !esInicio[x] : false)) continue;
        var y = haciaAbajo ? e.b : e.a;
        usadas.push(e);
        if (vistos[y]) continue;
        vistos[y] = true;
        if (lado[y] === undefined) { lado[y] = haciaAbajo ? "abajo" : "arriba"; dist[y] = dist[x] + 1; orden.push(y); }
        cola.push(y);
      }
    }
  }
  correr(true); correr(false);
  // Primero lo más cercano al origen: si hay que cortar, se corta lo más lejano.
  var todos = orden.slice().sort(function (a, b) { return dist[a] - dist[b] || (a < b ? -1 : a > b ? 1 : 0); });
  var quedan = todos.slice(0, tope), dentro = {};
  quedan.forEach(function (x) { dentro[x] = true; });
  var fuera = {}, nFuera = 0;
  todos.slice(tope).forEach(function (x) { var t = red.tipo[x]; fuera[t] = (fuera[t] || 0) + 1; nFuera++; });
  var aristas = [], ya = {};
  usadas.forEach(function (e) {
    var k = e.a + "\u0000" + e.b + "\u0000" + e.v;
    if (ya[k] || !dentro[e.a] || !dentro[e.b]) return;
    ya[k] = true;
    var ca = red.cer[e.a], cb = red.cer[e.b];
    aristas.push({ desde: e.a, hasta: e.b, verbo: e.v, ev: e.ev, via: e.via, cruza: ca !== null && cb !== null && ca !== undefined && cb !== undefined && ca !== cb });
  });
  aristas.sort(function (a, b) { return a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : a.hasta < b.hasta ? -1 : a.hasta > b.hasta ? 1 : 0; });
  var nodos = quedan.map(function (id) {
    var m = red.metodo[id], n = { id: id, tipo: red.tipo[id], nombre: red.nombre[id], c: red.cer[id], capa: capa(id), lado: lado[id], dist: dist[id] };
    if (m) { n.ev = m.ev; n.archivo = m.archivo; n.capaCodigo = m.capa; }
    return n;
  }).sort(function (a, b) { return a.capa - b.capa || a.dist - b.dist || (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0); });
  var huecos = [];
  quedan.forEach(function (id) { (red.huecos[id] || []).forEach(function (h) { huecos.push({ en: id, texto: h.texto, ev: h.ev }); }); });
  return { origen: origen, nodos: nodos, aristas: aristas, huecos: huecos, truncado: nFuera ? { total: todos.length, mostrados: quedan.length, fuera: fuera } : null };
}`;

export interface RedDeFlujo {
  tipo: Record<string, string>;
  cer: Record<string, string | number | null>;
  nombre: Record<string, string>;
  metodo: Record<string, { id: string; simbolo: string; ev: string; capa: string; archivo: string | null; front: boolean }>;
  porArchivo: Record<string, string[]>;
  huecos: Record<string, Array<{ texto: string; ev: string | null }>>;
}

export interface Trazabilidad {
  origen: string;
  /**
   * Ordenados por capa (0 funcionalidad, 1 pantalla, 2 hook o componente, 3 archivo, 4 endpoint, 5 servicio o método,
   * 6 cola, 7 tabla, 8 externo) y distancia al origen. `tipo: "metodo"` es un paso de un recorrido, con su evidencia.
   */
  nodos: Array<{ id: string; tipo: string; nombre: string; c: string | number | null; capa: number; lado: "origen" | "arriba" | "abajo"; dist: number; ev?: string; archivo?: string | null; capaCodigo?: string }>;
  aristas: Array<{ desde: string; hasta: string; verbo: string; ev: string | null; via: string | null; cruza: boolean }>;
  /**
   * Huecos conocidos de la cadena: `sin_metodo` (no se encontró quién atiende el endpoint), `truncado` (el recorrido
   * se cortó), `sin_pagina` (tabla sin página), `fuera_del_grafo:<id>`, `sin_resolver:<llamada>` (deriva) o el aviso
   * del paso tal cual.
   */
  huecos: Array<{ en: string; texto: string; ev: string | null }>;
  /** Presente si la cadena pasaba el tope: cuántos nodos había, cuántos quedaron y, por tipo, los que quedaron afuera. */
  truncado: { total: number; mostrados: number; fuera: Record<string, number> } | null;
}

export const redDeFlujo = new Function(`${RED_FLUJO_JS}; return redDeFlujo;`)() as (d: EntradaRed) => RedDeFlujo;
export const trazabilidad = new Function(`${TRAZABILIDAD_JS}; return trazabilidad;`)() as (red: RedDeFlujo, origen: string, tope?: number) => Trazabilidad | null;

/** La red de un brain solo, a partir de su grafo y sus fichas. */
export function redDelGrafo(graph: Graph, fichas: Ficha[] = []): RedDeFlujo {
  return redDeFlujo({
    nodos: graph.nodes.map((n) => ({ id: n.id, tipo: n.tipo, nombre: n.nombre, archivo: n.tipo === "componente" ? ((n.atributos["archivo"] as string | undefined) ?? null) : null })),
    aristas: graph.edges.filter((e) => e.estado !== "deprecado").map((e) => ({ s: e.desde, h: e.hasta, v: e.verbo, ev: e.evidencia, p: e.endpoint })),
    fichas,
  });
}

const CAPAS_TXT = ["feature", "screen", "hook/component", "file", "endpoint", "service/method", "queue", "table", "external", "other"];
const redes = new WeakMap<Contexto, RedDeFlujo>();

export interface TrazabilidadParams {
  nodo: string;
  /** Cuántos nodos como mucho (por defecto 150): lo más cercano al origen queda, el resto se cuenta en `truncado`. */
  tope?: number;
}

/**
 * La herramienta del MCP: la trazabilidad de un nodo de este brain (por id, nombre o alias), con la capa de cada paso
 * y su evidencia. Con varios cerebros, lo que sale por HTTP hacia otro cerebro aparece como llamada sin resolver: la
 * cadena completa entre cerebros la arma el visor (Mapa 3D), que tiene las trazas cruzadas.
 */
export function trazabilidadDe(ctx: Contexto, p: TrazabilidadParams) {
  const tope = p.tope ?? 150;
  if (!Number.isInteger(tope) || tope < 1 || tope > 2000) throw new ConsultaError("parametro_invalido", "tope must be between 1 and 2000");
  let id = ctx.nodo.has(p.nodo) ? p.nodo : null;
  if (!id) {
    const q = normalizar(p.nodo);
    const iguales = ctx.graph.nodes.filter((n) => [n.nombre, ...n.aliases].some((k) => normalizar(k) === q));
    if (iguales.length === 1) id = iguales[0]!.id;
    else {
      const parecidos = (iguales.length ? iguales : ctx.graph.nodes.filter((n) => normalizar(`${n.id} ${n.nombre}`).includes(q))).slice(0, 6).map((n) => n.id);
      throw new ConsultaError("nodo_inexistente", `could not resolve the node: ${p.nodo}${parecidos.length ? ` (${parecidos.join(", ")}?)` : ""}`);
    }
  }
  let red = redes.get(ctx);
  if (!red) redes.set(ctx, (red = redDelGrafo(ctx.graph, ctx.codigo ? [...ctx.codigo.fichas.values()] : [])));
  const t = trazabilidad(red, id, tope)!;
  return {
    origen: t.origen,
    cadena: t.nodos.map((n) => ({ capa: CAPAS_TXT[n.capa] ?? "other", id: n.id, ...(n.tipo === "metodo" ? { metodo: n.nombre, ev: n.ev } : { tipo: n.tipo }), lado: n.lado })),
    aristas: t.aristas.map((a) => ({ desde: a.desde, verbo: a.verbo, hasta: a.hasta, ev: a.ev, ...(a.via ? { via: a.via } : {}) })),
    huecos: t.huecos,
    ...(t.truncado ? { truncado: t.truncado } : {}),
  };
}

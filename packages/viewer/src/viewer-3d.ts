/**
 * Vista "Mapa 3D" del visor (`#/grafo`): el grafo entero en 3D, dibujado en un `<canvas>` sin librerías.
 * Se dibuja como un cerebro: cada nodo es una neurona (soma, halo y dendritas), cada arista un axón curvo por el que
 * corren impulsos en el sentido de la relación, y una nube de puntos marca la corteza con sus dos hemisferios.
 * Cada neurona crece con su uso en el código; se elige qué tipos y relaciones se ven, cómo se agrupan, y al arrastrar
 * o separar un nodo se lleva a sus hijos. Publica `window.brainVisor` (datos, `enfocar`, `mostrarMapa`) para las
 * demás vistas. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
import { RED_FLUJO_JS, TRAZABILIDAD_JS } from "@flowbrain/core";
import { ORDEN_CEREBROS_JS } from "./orden-cerebros.js";
import { TRAZA_CSS, TRAZA_VISTAS_JS } from "./viewer-traza.js";

export const GRAFO3D_JS = ORDEN_CEREBROS_JS + RED_FLUJO_JS + "\n" + TRAZABILIDAD_JS + String.raw`
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("datos").textContent);
  var M = D.mapa3d;
  var porId = {};
  D.nodes.forEach(function (n) { porId[n.id] = n; });
  var css = getComputedStyle(document.documentElement);
  var color = function (v) { return css.getPropertyValue("--" + v).trim() || "#888888"; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  // Idioma: inglés primero; sin brainI18n (tests) queda en inglés.
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var pl = function (n, uno, varios) { return n === 1 ? uno : varios; };

  // [tipo, plural, singular] en el idioma actual; los textos de cada idioma viven en TIPOS_TXT y rotular() los aplica.
  var TIPOS_TXT = {
    feat: ["Features", "Feature", "Funcionalidades", "Funcionalidad"], pantalla: ["Screens", "Screen", "Pantallas", "Pantalla"],
    componente: ["Components", "Component", "Componentes", "Componente"], endpoint: ["Endpoints", "Endpoint", "Endpoints", "Endpoint"],
    tabla: ["Tables", "Table", "Tablas", "Tabla"], svc: ["Services", "Service", "Servicios", "Servicio"],
    repo: ["Repositories", "Repository", "Repositorios", "Repositorio"], lib: ["Libraries", "Library", "Librerías", "Librería"],
    ext: ["External", "External", "Externos", "Externo"], queue: ["Queues", "Queue", "Colas", "Cola"], db: ["Databases", "Database", "Bases de datos", "Base de datos"],
    team: ["Teams", "Team", "Equipos", "Equipo"], decision: ["Decisions", "Decision", "Decisiones", "Decisión"], test: ["Tests", "Test", "Tests", "Test"],
    archivo: ["Files", "File", "Archivos", "Archivo"],
  };
  var TIPOS = ["feat", "pantalla", "componente", "endpoint", "tabla", "svc", "repo", "lib", "ext", "queue", "db", "team", "decision", "test", "archivo"].map(function (t) { return [t, "", ""]; });
  var TIPO = {};
  TIPOS.forEach(function (t) { TIPO[t[0]] = { label: "", uno: "" }; });
  // Un tipo de nodo que el visor no conoce (lo trajo un extractor o una versión nueva) también se dibuja, con su nombre.
  D.nodes.forEach(function (n) {
    if (TIPO[n.t] || n.t === "contrato") return;
    var nom = n.t.charAt(0).toUpperCase() + n.t.slice(1).replace(/_/g, " ");
    TIPOS_TXT[n.t] = [nom, nom, nom, nom];
    TIPO[n.t] = { label: nom, uno: nom };
    TIPOS.push([n.t, nom, nom]);
  });
  /** Pone los nombres de los tipos en el idioma actual (al cargar y al cambiar de idioma). */
  function rotular() {
    TIPOS.forEach(function (t) {
      var x = TIPOS_TXT[t[0]];
      t[1] = L(x[0], x[2]); t[2] = L(x[1], x[3]);
      TIPO[t[0]].label = t[1]; TIPO[t[0]].uno = t[2];
    });
  }
  rotular();
  // Nombre de una relación en el idioma actual; en castellano, el verbo tal cual (sin el primer guion bajo).
  var VERBO_EN = { implementa: "implements", navega_a: "navigates to", usa: "uses", llama_a: "calls", lee_de: "reads from", escribe_en: "writes to",
    publica_en: "publishes to", consume_de: "consumes from", depende_de: "depends on", contiene: "contains", vive_en: "lives in", recorrido: "flow",
    prueba: "tests", pertenece_a: "belongs to", decidido_por: "decided by" };
  var verboTxt = function (v) { return L(VERBO_EN[v] || v.replace(/_/g, " "), v.replace("_", " ")); };
  var ORDEN_VERBOS =["implementa", "navega_a", "usa", "llama_a", "lee_de", "escribe_en", "publica_en", "consume_de", "depende_de", "contiene", "vive_en", "recorrido", "prueba", "pertenece_a", "decidido_por"];
  var colores = {};
  /** Color de un tipo: la variable del tema; si el tema no la tiene (un tipo nuevo), uno estable sacado de su nombre. */
  var PALETA_EXTRA = ["#E0A458", "#7FB7BE", "#D3826F", "#A3C46C", "#B48EAD", "#88C0D0", "#EBCB8B", "#C97B84"];
  var col = function (t) {
    if (colores[t]) return colores[t];
    var v = css.getPropertyValue("--" + t).trim();
    if (!v) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; v = PALETA_EXTRA[h % PALETA_EXTRA.length]; }
    return (colores[t] = v);
  };

  // ---------- Modelo ----------
  // Varios cerebros: cada uno se dibuja como un cerebro aparte, uno al lado del otro. Con uno solo, todo queda en el origen.
  var CEREBROS = D.cerebros || [], MULTI = CEREBROS.length > 1, SEP = 1500;
  /** Un color por cerebro (hasta 8): el del nombre sobre su corteza y el de la marca en cada conexión que cruza. */
  var COLOR_C = ["#8FA6FF", "#F5B94A", "#5EDBB0", "#F28BB3", "#B79CFF", "#6FD3F7", "#F2906B", "#C8D96B"];
  function colorC(i) { return COLOR_C[i % COLOR_C.length]; }
  function puntoC(i) { return '<span class="pc" style="background:' + colorC(i) + '"></span>'; }
  var NC = MULTI ? CEREBROS.length : 1, RP = NC > 2 ? SEP / (2 * Math.sin(Math.PI / NC)) : 0;
  var OX = [0], OY = [0], OZ = [0], OX0 = [0], OZ0 = [0], cajaNombre = [];
  function moverCerebro(c, dx, dy, dz) {
    OX[c] += dx; OY[c] += dy; OZ[c] += dz;
    N.forEach(function (n) { if (n.c === c) { n.x += dx; n.y += dy; n.z += dz; } });
  }
  function nombreEn(x, y) {
    for (var c = 0; c < cajaNombre.length; c++) { var k = cajaNombre[c]; if (k && x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return c; }
    return -1;
  }
  var N = [], by = {};
  D.nodes.forEach(function (n) {
    if (!TIPO[n.t]) return;
    var x = { id: n.id, tipo: n.t, nombre: n.n, uso: M.uso[n.id] || 0, c: MULTI ? (n.c || 0) : 0, deg: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pin: false, adj: [], kids: [], parent: null, puesto: false, fire: 0, fase: 0 };
    N.push(x); by[n.id] = x;
  });
  var E = [];
  M.aristas.forEach(function (a) {
    var s = by[a[0]], h = by[a[1]];
    if (!s || !h || s === h) return;
    var e = { a: s, b: h, verbo: a[2], ev: a[3], c: ((E.length % 7) - 3) * 0.035 };
    E.push(e); s.adj.push({ n: h, e: e }); h.adj.push({ n: s, e: e });
  });
  N.forEach(function (n) { var vistos = {}; n.adj.forEach(function (x) { vistos[x.n.id] = true; }); n.deg = Object.keys(vistos).length; });

  // Dos cerebros van lado a lado; tres o más, en los vértices de un polígono regular (triángulo, cuadrado, pentágono)
  // con lado SEP, acostado: todos a la misma altura, sobre el plano horizontal, con el primero al fondo.
  // Qué cerebro va en qué vértice se elige para que las líneas entre cerebros no se crucen (ver ordenSinCruces).
  var SLOT = ordenSinCruces(NC, E.filter(function (e) { return e.a.c !== e.b.c; }).map(function (e) { return [e.a.c, e.b.c]; }));
  OX = SLOT.map(function (s) { return NC > 2 ? RP * Math.sin(2 * Math.PI * s / NC) : (s - (NC - 1) / 2) * SEP; });
  // El centro de cada cerebro arranca en su vértice; arrastrando su nombre se lo lleva a cualquier lado.
  OZ0 = SLOT.map(function (s) { return NC > 2 ? RP * Math.cos(2 * Math.PI * s / NC) : 0; });
  OX0 = OX.slice(); OY = OX.map(function () { return 0; }); OZ = OZ0.slice();

  var VERBOS = ORDEN_VERBOS.filter(function (v) { return E.some(function (e) { return e.verbo === v; }); });
  var cuentas = {};
  N.forEach(function (n) { cuentas[n.tipo] = (cuentas[n.tipo] || 0) + 1; });
  var TIPOS_PRESENTES = TIPOS.filter(function (t) { return cuentas[t[0]]; });

  function azar(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var rnd = azar(7);
  N.forEach(function (n) {
    var u = rnd() * Math.PI * 2, v = Math.acos(2 * rnd() - 1), R = 160 + rnd() * 280;
    n.x = OX[n.c] + R * Math.sin(v) * Math.cos(u); n.y = OY[n.c] + R * Math.sin(v) * Math.sin(u) * 0.8; n.z = OZ[n.c] + R * Math.cos(v);
    n.fase = rnd() * Math.PI * 2;
  });
  // Cada línea entre cerebros parpadea a su ritmo: fase, velocidad y brillo máximo propios. El brillo sale sesgado hacia
  // abajo (muchas apenas se ven y pocas se encienden del todo), así cientos de líneas no se suman en una mancha blanca.
  E.forEach(function (e) {
    if (e.a.c === e.b.c) return;
    var b = rnd();
    e.f = rnd() * Math.PI * 2; e.w = 0.008 + rnd() * 0.022; e.v = 0.12 + 0.88 * b * b;
  });
  var QUIETO = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches), nCruceVis = 0;

  var ocultosIniciales = {};
  TIPOS.forEach(function (t) { if (D.tiposIniciales.indexOf(t[0]) < 0) ocultosIniciales[t[0]] = true; });
  var S = { hiddenTypes: ocultosIniciales, hiddenVerbs: {}, sizeMode: "uso", scale: 0.6, group: "feat", labels: "ninguna", selId: null, query: "",
    dragChildren: true, rotating: true, isolate: false, hiddenIds: {}, shownIds: {}, hiddenBrains: {}, todas: {}, tabC: null, intensidad: 0.4, lineas: 0.6,
    pulsos: !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) };

  function setParents(mode) {
    var P = mode === "none" ? {} : M.padres[mode] || {};
    N.forEach(function (n) { n.kids = []; n.parent = null; });
    N.forEach(function (n) {
      var p = by[P[n.id]];
      // Sin ciclos: un padre nunca es descendiente del hijo.
      for (var c = p; c; c = c.parent) if (c === n) { p = null; break; }
      if (p) { n.parent = p; p.kids.push(n); }
    });
  }
  function desc(n) { var out = [], st = n.kids.slice(); while (st.length) { var c = st.pop(); out.push(c); for (var i = 0; i < c.kids.length; i++) st.push(c.kids[i]); } return out; }
  // Un nodo de un tipo apagado igual se ve si se lo prendió a mano desde el pop-up de un nodo relacionado.
  function base(n) { return (TZ && TZ.ns.has(n)) || ((!S.hiddenTypes[n.tipo] || S.shownIds[n.id]) && !S.hiddenIds[n.id] && !S.hiddenBrains[n.c]); }
  /** Relacionados de un nodo que están apagados por su tipo (se pueden prender) y los que se prendieron a mano (se pueden volver a apagar), por tipo. */
  function relacionadosDe(n) {
    var apag = {}, prend = {};
    n.adj.forEach(function (a) {
      var x = a.n;
      if (S.hiddenIds[x.id] || S.hiddenBrains[x.c] || !S.hiddenTypes[x.tipo]) return;
      var d = S.shownIds[x.id] ? prend : apag;
      (d[x.tipo] = d[x.tipo] || []).indexOf(x) < 0 && d[x.tipo].push(x);
    });
    var out = [];
    TIPOS.forEach(function (t) {
      if (apag[t[0]]) out.push({ tipo: t[0], nodos: apag[t[0]], prender: true, texto: L("Show ", "Mostrar ") + apag[t[0]].length + " " + (apag[t[0]].length === 1 ? t[2] : t[1]).toLowerCase() });
      if (prend[t[0]]) out.push({ tipo: t[0], nodos: prend[t[0]], prender: false, texto: L("Hide ", "Ocultar ") + prend[t[0]].length + " " + (prend[t[0]].length === 1 ? t[2] : t[1]).toLowerCase() });
    });
    return out;
  }
  // Trazabilidad completa de un nodo (ver entrarTraza): mientras está puesta, la cadena manda sobre filtros y resaltado.
  var TZ = null;
  // El pop-up del nodo bajo el cursor: su caja y las acciones que se pueden apretar.
  var pop = null;
  function enPop(x, y, margen) { return !!pop && x >= pop.x - margen && x <= pop.x + pop.w + margen && y >= pop.y - margen && y <= pop.y + pop.h + margen; }
  function accionEn(x, y) {
    if (!pop) return null;
    for (var i = 0; i < pop.acciones.length; i++) { var a = pop.acciones[i]; if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a; }
    return null;
  }
  // Una relación entre dos cerebros: lo que viaja de uno a otro.
  function cruza(e) { return e.a.c !== e.b.c; }
  // Brillo de una línea entre cerebros en este cuadro: casi apagada y, de a ratos, se enciende (sin(…)^4 deja el pico
  // corto). Con muchas líneas visibles cada una brilla menos. Con movimiento reducido, quietas y tenues. Lo que se
  // ve viajar son los impulsos; la línea solo insinúa el camino.
  function brilloCruce(e) {
    var dens = Math.min(1, Math.sqrt(40 / Math.max(1, nCruceVis)));
    // Opacidad del panel: 40 % es el brillo de base; 100 %, dos veces y media; 0 %, solo los impulsos.
    var k = S.lineas / 0.4;
    if (QUIETO) return Math.min(0.9, (0.03 + 0.12 * e.v * dens) * k);
    var s = Math.max(0, Math.sin(T * e.w + e.f)), pico = s * s * s * s;
    return Math.min(0.9, (0.02 + 0.5 * e.v * pico * dens) * k);
  }
  var isoSet = null;
  /**
   * Recorrido de punta a punta de lo elegido: desde una funcionalidad, sus pantallas y endpoints; desde una pantalla,
   * los endpoints que llama (aunque estén en otro cerebro); desde un endpoint, lo que llama y las tablas que lee o
   * escribe. Se sigue solo el sentido del flujo y solo a través de pantallas y endpoints: un servicio o una tabla
   * cierran el camino, porque seguir desde ahí alcanzaría a medio sistema.
   */
  var FLUJO = { llama_a: 1, lee_de: 1, escribe_en: 1, publica_en: 1, consume_de: 1 };
  var rutaN = null, rutaE = null, rutaL = [];
  function computeRuta(id) {
    var n = by[id];
    rutaN = rutaE = null; rutaL = [];
    if (!n || (n.tipo !== "feat" && n.tipo !== "pantalla" && n.tipo !== "endpoint")) return;
    var pasa = function (x) { return x.tipo === "pantalla" || x.tipo === "endpoint"; };
    var ns = new Set([n]), es = new Set(), cola = [n];
    if (n.tipo === "feat") n.adj.forEach(function (a) {
      if (a.e.verbo !== "implementa" || a.e.b !== n || !pasa(a.n)) return;
      es.add(a.e);
      if (!ns.has(a.n)) { ns.add(a.n); cola.push(a.n); }
    });
    while (cola.length && ns.size < 800) {
      var x = cola.shift();
      x.adj.forEach(function (a) {
        if (a.e.a !== x || !FLUJO[a.e.verbo]) return;
        es.add(a.e);
        if (!ns.has(a.n)) { ns.add(a.n); if (pasa(a.n)) cola.push(a.n); }
      });
    }
    if (es.size) { rutaN = ns; rutaE = es; rutaL = Array.from(es); }
  }
  function visible(n) { return base(n) && (!S.isolate || !isoSet || isoSet.has(n)); }
  function computeIso(id) {
    var n = by[id || S.selId];
    if (!n) { isoSet = null; return; }
    var s = new Set([n]);
    desc(n).forEach(function (c) { s.add(c); });
    n.adj.forEach(function (a) { s.add(a.n); });
    if (rutaN && by[S.selId] === n) rutaN.forEach(function (x) { s.add(x); });
    isoSet = s;
  }
  // Un nodo que se prende por primera vez aparece junto a su padre, no en un lugar al azar.
  function ubicar(n) {
    if (n.puesto) return;
    n.puesto = true;
    if (n.parent && !n.parent.puesto && base(n.parent)) ubicar(n.parent);
    if (n.parent && n.parent.puesto) { var sp = 70 + 9 * Math.sqrt(n.parent.kids.length); n.x = n.parent.x + (rnd() - 0.5) * sp; n.y = n.parent.y + (rnd() - 0.5) * sp; n.z = n.parent.z + (rnd() - 0.5) * sp; }
  }
  var activos = [];
  function actualizarActivos() {
    activos = N.filter(base);
    activos.forEach(ubicar);
    armarResortes();
  }

  // ---------- Fuerzas ----------
  var alpha = 0;
  // Resortes entre nodos activos: aristas visibles y padre-hijo. La fuerza de cada uno se reparte por la cantidad de
  // resortes de sus extremos (como d3-force): un repo con miles de archivos no recibe miles de tirones sumados, que
  // con muchos nodos hacían diverger la simulación y mandaban todos los puntos fuera de la vista.
  var resortes = [];
  function armarResortes() {
    var cuenta = new Map(), L = [];
    var suma = function (n) { cuenta.set(n, (cuenta.get(n) || 0) + 1); };
    // Una relación entre cerebros no tira: si no, los cerebros se irían uno encima del otro.
    E.forEach(function (e) { if (base(e.a) && base(e.b) && !cruza(e) && !S.hiddenVerbs[e.verbo]) { L.push({ a: e.a, b: e.b, len: 170, k: 0.03 }); suma(e.a); suma(e.b); } });
    activos.forEach(function (n) { if (n.parent && base(n.parent)) { L.push({ a: n, b: n.parent, len: n.tipo === "archivo" ? 45 : 75, k: 0.25 }); suma(n); suma(n.parent); } });
    L.forEach(function (r) { var ca = cuenta.get(r.a), cb = cuenta.get(r.b); r.k = r.k / Math.min(ca, cb); r.bias = ca / (ca + cb); });
    resortes = L;
  }
  var VMAX = 40, FISURA = 26;
  function simStep(a) {
    var A = activos, i, j, n, m, dx, dy, dz, d2, d, f;
    if (A.length <= 900) {
      for (i = 0; i < A.length; i++) {
        n = A[i];
        for (j = i + 1; j < A.length; j++) {
          m = A[j]; dx = n.x - m.x; dy = n.y - m.y; dz = n.z - m.z; d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > 640000) continue;
          if (d2 < 100) d2 = 100;
          f = 5200 / d2; d = Math.sqrt(d2); dx /= d; dy /= d; dz /= d;
          n.vx += dx * f; n.vy += dy * f; n.vz += dz * f; m.vx -= dx * f; m.vy -= dy * f; m.vz -= dz * f;
        }
      }
    } else {
      // Muchos nodos (archivos prendidos): repulsión solo entre vecinos de una grilla.
      var C = 110, g = new Map(), clave = function (x, y, z) { return ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096); };
      for (i = 0; i < A.length; i++) { n = A[i]; n.gx = Math.floor(n.x / C); n.gy = Math.floor(n.y / C); n.gz = Math.floor(n.z / C); var k = clave(n.gx, n.gy, n.gz), l = g.get(k); if (l) l.push(n); else g.set(k, [n]); }
      for (i = 0; i < A.length; i++) {
        n = A[i];
        for (var ax = -1; ax <= 1; ax++) for (var ay = -1; ay <= 1; ay++) for (var az = -1; az <= 1; az++) {
          var L = g.get(clave(n.gx + ax, n.gy + ay, n.gz + az));
          if (!L) continue;
          for (j = 0; j < L.length; j++) {
            m = L[j]; if (m === n) continue;
            dx = n.x - m.x; dy = n.y - m.y; dz = n.z - m.z; d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > C * C) continue;
            if (d2 < 100) d2 = 100;
            f = 2600 / d2; d = Math.sqrt(d2);
            n.vx += dx / d * f; n.vy += dy / d * f; n.vz += dz / d * f;
          }
        }
      }
    }
    // Forma de cerebro: más largo de adelante hacia atrás que alto, y una fisura que separa los dos hemisferios.
    for (i = 0; i < A.length; i++) {
      n = A[i]; var rx = n.x - OX[n.c]; n.vx -= rx * 0.004; n.vy -= (n.y - OY[n.c]) * 0.0056; n.vz -= (n.z - OZ[n.c]) * 0.0031;
      if (rx > -FISURA && rx < FISURA) n.vx += (rx >= 0 ? 1 : -1) * (FISURA - Math.abs(rx)) * 0.03;
    }
    for (i = 0; i < resortes.length; i++) {
      var r = resortes[i], p = r.a, q = r.b, ex = q.x - p.x, ey = q.y - p.y, ez = q.z - p.z, dd = Math.sqrt(ex * ex + ey * ey + ez * ez) + 0.01, ff = (dd - r.len) * r.k / dd;
      var fq = ff * r.bias, fp = ff * (1 - r.bias);
      p.vx += ex * fp; p.vy += ey * fp; p.vz += ez * fp; q.vx -= ex * fq; q.vy -= ey * fq; q.vz -= ez * fq;
    }
    for (i = 0; i < A.length; i++) {
      n = A[i];
      if (n.pin) { n.vx = n.vy = n.vz = 0; continue; }
      var v = Math.sqrt(n.vx * n.vx + n.vy * n.vy + n.vz * n.vz);
      if (v > VMAX) { n.vx *= VMAX / v; n.vy *= VMAX / v; n.vz *= VMAX / v; }
      n.x += n.vx * a; n.y += n.vy * a; n.z += n.vz * a; n.vx *= 0.55; n.vy *= 0.55; n.vz *= 0.55;
    }
  }
  function simulate(iters) { var a = 1; for (var i = 0; i < iters; i++) { simStep(a); a *= 0.988; } }
  function reacomodar(a) { alpha = Math.max(alpha, a); }

  setParents("feat");
  actualizarActivos();
  simulate(activos.length > 900 ? 60 : 300);

  // ---------- Cámara y dibujo ----------
  var cam = { yaw: 0.6, pitch: 0.32, dist: 1050, tx: 0, ty: 0, tz: 0, goal: null };
  var anims = [], proj = [], hover = null, sobreNombre = -1, ptr = null, mouse = null, W = 0, H = 0, F = 1;
  var canvas = document.getElementById("m3-canvas");
  // Cuantos más nodos hay de un tipo, más chicos se dibujan: tres funcionalidades se ven grandes; mil endpoints, finos.
  var FACTOR_TIPO = {};
  (function () {
    var cuenta = {};
    N.forEach(function (n) { cuenta[n.tipo] = (cuenta[n.tipo] || 0) + 1; });
    Object.keys(cuenta).forEach(function (t) { FACTOR_TIPO[t] = Math.max(0.5, Math.min(1.45, 1.45 - 0.3 * Math.log(cuenta[t]) / Math.LN10)); });
    // La jerarquía manda sobre la cantidad: funcionalidad ≥ pantalla ≥ endpoint > tabla > archivo. Una tabla nunca
    // queda más grande que el endpoint que la usa por el solo hecho de haber menos tablas.
    var tope = function (t, de, k) { if (FACTOR_TIPO[t] !== undefined && FACTOR_TIPO[de] !== undefined) FACTOR_TIPO[t] = Math.min(FACTOR_TIPO[t], FACTOR_TIPO[de] * k); };
    tope("pantalla", "feat", 1); tope("endpoint", "pantalla", 1); tope("tabla", "endpoint", 0.8); tope("archivo", "tabla", 0.8);
  })();
  // Cuánto agranda el uso a cada tipo: una tabla la tocan muchos endpoints, y eso no la hace más importante que ellos.
  var PESO_USO = { tabla: 1.2, archivo: 1.2 };
  function radio(n) {
    var k = PESO_USO[n.tipo] || 3.4;
    var b = S.sizeMode === "uso" ? 3 + k * Math.log(1 + n.uso) : S.sizeMode === "deg" ? 3 + k * Math.log(1 + n.deg) : 7;
    return b * S.scale * (FACTOR_TIPO[n.tipo] || 1);
  }
  function base3() { var c = cam, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch); return { right: [cy, 0, -sy], up: [-sy * sp, cp, -cy * sp] }; }
  function project(x, y, z) {
    var c = cam; x -= c.tx; y -= c.ty; z -= c.tz;
    var cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    var x1 = cy * x + sy * z, z1 = -sy * x + cy * z, y2 = cp * y + sp * z1, z2 = -sp * y + cp * z1 + c.dist;
    if (z2 < 30) return null;
    return { sx: W / 2 + F * x1 / z2, sy: H / 2 - F * y2 / z2, s: F / z2, z: z2 };
  }
  function mezcla(a, b, t) {
    var p = function (h, i) { return parseInt(h.slice(i, i + 2), 16); };
    return "rgb(" + Math.round(p(a, 1) + (p(b, 1) - p(a, 1)) * t) + "," + Math.round(p(a, 3) + (p(b, 3) - p(a, 3)) * t) + "," + Math.round(p(a, 5) + (p(b, 5) - p(a, 5)) * t) + ")";
  }
  function rgba(h, a) { return "rgba(" + parseInt(h.slice(1, 3), 16) + "," + parseInt(h.slice(3, 5), 16) + "," + parseInt(h.slice(5, 7), 16) + "," + a + ")"; }
  // Imágenes prerenderizadas por color: dibujar miles de neuronas por cuadro es copiar imágenes escaladas.
  var sprites = {};
  function lienzo(lado) { var cv = document.createElement("canvas"); cv.width = cv.height = lado; return cv; }
  function rama(x, px, py, ang, largo, ancho, c, r, nivel) {
    var pasos = 6, paso = largo / pasos;
    for (var i = 1; i <= pasos; i++) {
      ang += (r() - 0.5) * 0.7;
      var nx = px + Math.cos(ang) * paso, ny = py + Math.sin(ang) * paso, k = i / pasos;
      x.strokeStyle = rgba(c, 0.6 * (1 - k * 0.85)); x.lineWidth = Math.max(0.6, ancho * (1 - k * 0.75));
      x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
      px = nx; py = ny;
      if (nivel < 2 && (i === 2 || i === 4)) rama(x, px, py, ang + (r() < 0.5 ? -0.75 : 0.75), largo * (1 - k) * 0.9, ancho * 0.6, c, r, nivel + 1);
    }
  }
  // Halo y dendritas: el soma ocupa un cuarto del radio de la imagen.
  function neurona(c) {
    var k = "n" + c;
    if (sprites[k]) return sprites[k];
    var R = 96, cv = lienzo(R * 2), x = cv.getContext("2d"), g = x.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, rgba(c, 0.5)); g.addColorStop(0.25, rgba(c, 0.16)); g.addColorStop(0.55, rgba(c, 0.035)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, R * 2, R * 2);
    var r = azar(11); x.lineCap = "round";
    for (var b = 0; b < 7; b++) { var ang = b / 7 * Math.PI * 2 + (r() - 0.5) * 0.5; rama(x, R + Math.cos(ang) * R * 0.2, R + Math.sin(ang) * R * 0.2, ang, R * (0.42 + r() * 0.3), 3.4, c, r, 1); }
    return (sprites[k] = cv);
  }
  function soma(c) {
    var k = "s" + c;
    if (sprites[k]) return sprites[k];
    var R = 32, cv = lienzo(R * 2), x = cv.getContext("2d"), g = x.createRadialGradient(R * 0.8, R * 0.75, R * 0.05, R, R, R);
    g.addColorStop(0, "#FFFFFF"); g.addColorStop(0.3, mezcla(c, "#FFFFFF", 0.5)); g.addColorStop(0.72, c); g.addColorStop(1, mezcla(c, "#05070B", 0.4));
    x.fillStyle = g; x.beginPath(); x.arc(R, R, R, 0, Math.PI * 2); x.fill();
    return (sprites[k] = cv);
  }
  /** Estrella de un impulso: núcleo blanco, halo del color y cuatro puntas finas (dos largas y dos cortas en diagonal). */
  function estrella(c) {
    var k = "e" + c;
    if (sprites[k]) return sprites[k];
    var R = 32, cv = lienzo(R * 2), x = cv.getContext("2d"), g = x.createRadialGradient(R, R, 0, R, R, R * 0.45);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, rgba(c, 0.8)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, R * 2, R * 2);
    x.globalCompositeOperation = "lighter";
    var punta = function (ang, largo, ancho) {
      x.save(); x.translate(R, R); x.rotate(ang);
      var gp = x.createLinearGradient(0, 0, largo, 0);
      gp.addColorStop(0, "rgba(255,255,255,0.95)"); gp.addColorStop(0.4, rgba(c, 0.55)); gp.addColorStop(1, rgba(c, 0));
      x.fillStyle = gp; x.beginPath(); x.moveTo(0, -ancho); x.lineTo(largo, 0); x.lineTo(0, ancho); x.closePath(); x.fill();
      x.restore();
    };
    for (var q = 0; q < 4; q++) { punta(q * Math.PI / 2, R, 2.2); punta(Math.PI / 4 + q * Math.PI / 2, R * 0.5, 1.4); }
    return (sprites[k] = cv);
  }
  // Corteza: puntos sobre una esfera deformada (base chata, fisura entre hemisferios, surcos).
  var CORTEZA = [];
  (function () {
    var K = 1500, oro = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < K; i++) {
      var dy = 1 - 2 * (i + 0.5) / K, rr = Math.sqrt(1 - dy * dy), t = i * oro, dx = Math.cos(t) * rr, dz = Math.sin(t) * rr;
      var w = (1 + 0.05 * Math.sin(dx * 13 + dz * 7) * Math.sin(dy * 11 + dz * 5)) * (1 - 0.2 * Math.exp(-(dx / 0.13) * (dx / 0.13)) * (dy > -0.2 ? 1 : 0.3));
      CORTEZA.push([dx * 0.95 * (1 - 0.1 * dz) * w, dy * (dy < 0 ? 0.6 : 0.82) * w, dz * 1.2 * w]);
    }
  })();
  var BR = 0, BRS = OX.map(function () { return 0; }), T = 0;
  function radioCerebro(c) {
    var r = 0, k = 0;
    for (var i = 0; i < activos.length; i++) { var n = activos[i]; if (n.pin || n.c !== c) continue; var rx = n.x - OX[c], ry = n.y - OY[c], rz = n.z - OZ[c]; r += Math.sqrt(rx * rx + ry * ry + rz * rz); k++; }
    return k ? Math.max(260, 1.5 * r / k) : 260;
  }
  // Radio de cada corteza; BR es el ancho de todo el conjunto, para alejar la cámara lo justo.
  function medirCerebros(suave) {
    for (var c = 0; c < OX.length; c++) { var r = radioCerebro(c); BRS[c] = BRS[c] && suave ? BRS[c] + (r - BRS[c]) * 0.25 : r; }
    var mx = 0, my = 0, mz = 0;
    for (c = 0; c < OX.length; c++) { mx += OX[c] / OX.length; my += OY[c] / OX.length; mz += OZ[c] / OX.length; }
    BR = 0;
    for (c = 0; c < OX.length; c++) BR = Math.max(BR, BRS[c] + Math.sqrt((OX[c] - mx) * (OX[c] - mx) + (OY[c] - my) * (OY[c] - my) + (OZ[c] - mz) * (OZ[c] - mz)));
  }
  // Impulsos: viajan por una arista de origen a destino; al llegar encienden la neurona y pueden seguir por sus salidas.
  var pulsos = [];
  function lanzar(e, gen) { pulsos.push({ e: e, t: 0, v: 0.011 + Math.random() * 0.014, gen: gen, giro: Math.random() * Math.PI, tw: Math.random() * Math.PI * 2 }); }
  function curva(pa, pb, c, t) {
    var cx = (pa.sx + pb.sx) / 2 - (pb.sy - pa.sy) * c, cy = (pa.sy + pb.sy) / 2 + (pb.sx - pa.sx) * c, u = 1 - t;
    return [u * u * pa.sx + 2 * u * t * cx + t * t * pb.sx, u * u * pa.sy + 2 * u * t * cy + t * t * pb.sy];
  }
  function pick(x, y) {
    var best = null, bz = 1e9;
    for (var i = 0; i < proj.length; i++) { var p = proj[i], dx = p.sx - x, dy = p.sy - y, r = Math.max(p.r, 4) + 4; if (dx * dx + dy * dy < r * r && p.z < bz) { bz = p.z; best = p.n; } }
    return best;
  }
  function centro(lista) {
    var cx = 0, cy = 0, cz = 0, k = 0, r = 0;
    lista.forEach(function (n) { cx += n.x; cy += n.y; cz += n.z; k++; });
    k = k || 1; cx /= k; cy /= k; cz /= k;
    // Radio medio: un grupo separado lejos no aleja la cámara de todo lo demás.
    lista.forEach(function (n) { r += Math.sqrt((n.x - cx) * (n.x - cx) + (n.y - cy) * (n.y - cy) + (n.z - cz) * (n.z - cz)); });
    return { x: cx, y: cy, z: cz, r: r / k };
  }
  function focus(n) { cam.goal = { x: n.x, y: n.y, z: n.z, dist: Math.max(360, Math.min(cam.dist, 700)) }; }
  function recentrar() { var c = centro(N.filter(visible)); cam.goal = { x: c.x, y: c.y, z: c.z, dist: Math.max(600, Math.min(4000, Math.max(c.r * 4.2, BR * 2.9))) }; }
  function separar(n) {
    var grp = [n].concat(desc(n)), set = new Set(grp), c = centro(grp), g = centro(activos.filter(function (m) { return !set.has(m); }));
    var dx = c.x - g.x, dy = c.y - g.y, dz = c.z - g.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1) { dx = 1; dy = 0.2; dz = 0; d = Math.sqrt(1.04); }
    var Dd = 200 + Math.sqrt(grp.filter(base).length) * 30;
    anims.push({ grp: grp, dx: dx / d * Dd, dy: dy / d * Dd, dz: dz / d * Dd, t: 0, T: 42 });
    grp.forEach(function (m) { m.pin = true; });
  }
  function separarGrupos() {
    var raices = N.filter(function (n) { return !n.parent && n.kids.length > 0 && visible(n); }), c = centro(raices);
    raices.forEach(function (r) {
      var grp = [r].concat(desc(r)), dx = r.x - c.x, dy = r.y - c.y, dz = r.z - c.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      anims.push({ grp: grp, dx: dx / d * 220, dy: dy / d * 220, dz: dz / d * 220, t: 0, T: 48 });
      grp.forEach(function (m) { m.pin = true; });
    });
  }
  function soltarTodo() { N.forEach(function (n) { n.pin = false; }); reacomodar(1); }

  // ---------- Trazabilidad completa ----------
  // La cadena de punta a punta que pasa por un nodo, calculada por el core (redDeFlujo + trazabilidad) con las fichas,
  // las trazas entre cerebros y la deriva que ya trae la página. Se dibuja sobre el mismo mapa: lo demás se apaga, la
  // cadena se ve con flechas e impulsos en el sentido del flujo y los saltos entre cerebros van en dorado con el nombre
  // del cerebro al que llegan. Los pasos (métodos, hooks) no son nodos del mapa: se ven en su archivo.
  var RED = null, TOPE_TZ = 400, MODO_TZ = "diagrama", TOPE_ETQ = 36;
  var SIN_TZ = { repo: 1, db: 1, team: 1, decision: 1, lib: 1 };
  function redFlujo() {
    if (RED) return RED;
    var hs = [];
    (D.deriva || []).forEach(function (x, i) {
      if (!x) return;
      var p = MULTI ? CEREBROS[x.c === undefined ? i : x.c].nombre + "/" : "";
      (x.sinEndpoint || []).forEach(function (h) { hs.push({ pref: p, ev: h.ev, texto: h.l }); });
      (x.ambiguas || []).concat(x.disputadas || []).forEach(function (h) { hs.push({ pref: p, ev: h.ev, texto: h.l + " (" + L("ambiguous", "ambigua") + ")" }); });
    });
    RED = redDeFlujo({ multi: MULTI, nodos: D.nodes.map(function (n) { return { id: n.id, tipo: n.t, c: MULTI ? (n.c || 0) : 0, nombre: n.n, archivo: n.t === "componente" && n.at ? n.at.archivo : null }; }),
      aristas: D.edges, fichas: D.funcionalidades || [], cruzado: D.cruzado || null, huecos: hs });
    return RED;
  }
  /** El nodo del mapa de un elemento de la cadena: él mismo, o el archivo donde vive un paso. */
  function en3(id) { var m = RED.metodo[id]; return by[m ? m.archivo : id] || null; }
  function entrarTraza(id) {
    var r = trazabilidad(redFlujo(), id, TOPE_TZ);
    if (!r) return;
    var ns = new Set(), es = [], ya = {};
    r.nodos.forEach(function (x) { var n = en3(x.id); if (n) ns.add(n); });
    r.aristas.forEach(function (a) {
      var p = en3(a.desde), q = en3(a.hasta);
      if (!p || !q || p === q) return;
      var k = p.id + "\u0000" + q.id;
      if (ya[k]) return;
      ya[k] = true;
      es.push({ a: p, b: q, verbo: a.verbo, cruza: p.c !== q.c, c: ((es.length % 7) - 3) * 0.035 });
    });
    var giraba = TZ ? TZ.giraba : S.rotating, idx = {};
    r.nodos.forEach(function (x) { idx[x.id] = x; });
    // Nombres en «En los cerebros»: solo la cadena, con tope. Primero el origen y las puntas de los saltos entre
    // cerebros, después lo más cercano al origen (los archivos al final: sus pasos ya se nombran en otro lado).
    var prio = new Map(), cand = [];
    var poner = function (n, p) { if (n && (!prio.has(n) || prio.get(n) > p)) prio.set(n, p); };
    poner(by[id] || en3(id), 0);
    es.forEach(function (e) { if (e.cruza) { poner(e.a, 1); poner(e.b, 1); } });
    r.nodos.forEach(function (x) { var n = en3(x.id); if (n) cand.push({ n: n, p: 2 + x.dist + (n.tipo === "archivo" || n.tipo === "test" ? 50 : 0) }); });
    cand.forEach(function (k) { poner(k.n, k.p); });
    var etq = new Map();
    Array.from(prio.keys()).sort(function (a, b) { return prio.get(a) - prio.get(b); }).slice(0, TOPE_ETQ).forEach(function (n) { etq.set(n, prio.get(n)); });
    TZ = { id: id, r: r, ns: ns, es: es, idx: idx, etq: etq, hov: null, todas: {}, giraba: giraba, re: 0, ficha: id, codigo: null };
    S.rotating = false; S.selId = by[id] ? id : S.selId; S.isolate = false; rutaN = rutaE = null; rutaL = [];
    pulsos.length = 0;
    actualizarActivos(); reacomodar(0.35);
    // Se vuelve a encuadrar en unos cuadros: al abrir el mapa recién se conoce su tamaño, y los puntos se acomodan.
    encuadrar(); TZ.re = T + 70;
    verDiagrama(MODO_TZ === "diagrama");
    ui();
  }
  function salirTraza() {
    if (!TZ) return;
    S.rotating = TZ.giraba; TZ = null; pulsos.length = 0;
    verDiagrama(false);
    actualizarActivos(); computeRuta(S.selId); reacomodar(0.2);
    if (S.selId && by[S.selId]) focus(by[S.selId]);
    ui();
  }
  function encuadrar() {
    if (!TZ || !TZ.ns.size) return;
    if (MODO_TZ === "diagrama") { ajustarDiagrama(); return; }
    // Entran enteros todos los cerebros que la cadena toca, cada punto en su lugar real.
    var l = Array.from(TZ.ns), cs = [], c = centro(l), r = 0;
    l.forEach(function (n) { if (cs.indexOf(n.c) < 0) cs.push(n.c); });
    if (MULTI && cs.length > 1) {
      c = { x: 0, y: 0, z: 0 };
      cs.forEach(function (k) { c.x += OX[k] / cs.length; c.y += OY[k] / cs.length; c.z += OZ[k] / cs.length; });
      cs.forEach(function (k) { r = Math.max(r, Math.sqrt((OX[k] - c.x) * (OX[k] - c.x) + (OY[k] - c.y) * (OY[k] - c.y) + (OZ[k] - c.z) * (OZ[k] - c.z)) + (BRS[k] || 260)); });
    }
    l.forEach(function (n) { r = Math.max(r, Math.sqrt((n.x - c.x) * (n.x - c.x) + (n.y - c.y) * (n.y - c.y) + (n.z - c.z) * (n.z - c.z))); });
    cam.goal = { x: c.x, y: c.y, z: c.z, dist: Math.max(420, Math.min(9000, r * 2.5 + 200)) };
  }

  function step() {
    var c = cam;
    T++;
    if (!BR) { medirCerebros(false); c.dist = Math.max(c.dist, BR * 2.9); } else if (T % 20 === 0) medirCerebros(true);
    if (S.rotating && !ptr) c.yaw += 0.0016;
    if (TZ && TZ.re && T >= TZ.re) { TZ.re = 0; encuadrar(); }
    if (alpha > 0.01) { simStep(alpha); if (activos.length <= 900) simStep(alpha); alpha *= 0.975; }
    for (var i = anims.length - 1; i >= 0; i--) {
      var a = anims[i], e0 = 1 - Math.pow(1 - a.t / a.T, 3); a.t++;
      var k = 1 - Math.pow(1 - a.t / a.T, 3) - e0;
      a.grp.forEach(function (m) { m.x += a.dx * k; m.y += a.dy * k; m.z += a.dz * k; });
      if (a.t >= a.T) anims.splice(i, 1);
    }
    if (c.goal) {
      var g = c.goal; c.tx += (g.x - c.tx) * 0.1; c.ty += (g.y - c.ty) * 0.1; c.tz += (g.z - c.tz) * 0.1; c.dist += (g.dist - c.dist) * 0.1;
      if (Math.abs(g.x - c.tx) + Math.abs(g.y - c.ty) + Math.abs(g.z - c.tz) + Math.abs(g.dist - c.dist) < 1) c.goal = null;
    }
  }
  function draw(ctx) {
    ctx.fillStyle = color("fondo"); ctx.fillRect(0, 0, W, H);
    var luz = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.62);
    luz.addColorStop(0, "rgba(64,88,190,.17)"); luz.addColorStop(0.55, "rgba(40,52,120,.06)"); luz.addColorStop(1, "rgba(10,12,17,0)");
    ctx.fillStyle = luz; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#8FA6FF";
    cajaNombre.length = 0;
    for (var cb = 0; cb < OX.length; cb++) {
      if (S.hiddenBrains[cb]) continue;
      var rb = BRS[cb] || 260;
      for (var ci = 0; ci < CORTEZA.length; ci++) {
        var cp = CORTEZA[ci], cq = project(OX[cb] + cp[0] * rb, OY[cb] + cp[1] * rb, OZ[cb] + cp[2] * rb);
        if (!cq) continue;
        ctx.globalAlpha = Math.max(0.07, Math.min(0.55, 0.95 - (cq.z / cam.dist) * 0.66));
        var cs = Math.max(1.2, 3 * cq.s);
        ctx.fillRect(cq.sx - cs / 2, cq.sy - cs / 2, cs, cs);
      }
      // El nombre de cada cerebro, sobre su corteza.
      if (MULTI) {
        var ct = project(OX[cb], OY[cb] + rb * 0.98, OZ[cb]);
        cajaNombre[cb] = null;
        if (ct) { var agarrado = (ptr && ptr.cerebro === cb) || (!ptr && sobreNombre === cb); ctx.globalAlpha = agarrado ? 0.95 : 0.5; ctx.font = "500 " + Math.max(11, Math.min(15, 18000 * ct.s / 100)) + "px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = colorC(cb); ctx.fillText(CEREBROS[cb].nombre, ct.sx, ct.sy - 10);
          var an = ctx.measureText(CEREBROS[cb].nombre).width + 24; cajaNombre[cb] = { x: ct.sx - an / 2, y: ct.sy - 38, w: an, h: 38 };
          if (agarrado) { ctx.globalAlpha = 0.5; ctx.fillRect(ct.sx - an / 2 + 12, ct.sy - 5, an - 24, 2); }
          ctx.textAlign = "start"; ctx.fillStyle = "#8FA6FF"; }
      }
    }
    ctx.globalAlpha = 1;
    var sel = S.selId ? by[S.selId] : null, hov = hover;
    var selKids = sel ? new Set(desc(sel)) : null;
    var dragGrp = ptr && ptr.group ? new Set(ptr.group) : null;
    var hovKids = hov && !ptr && S.dragChildren ? new Set(desc(hov)) : null;
    var q = S.query.trim().toLowerCase(), match = null;
    if (q) { match = new Set(); N.forEach(function (n) { if (n.nombre.toLowerCase().indexOf(q) >= 0 || n.id.toLowerCase().indexOf(q) >= 0) match.add(n); }); }
    var vecinos = null;
    if (sel) { vecinos = new Set(); sel.adj.forEach(function (a) { vecinos.add(a.n); }); if (rutaN) rutaN.forEach(function (x) { vecinos.add(x); }); }
    var P = [], pm = new Map();
    for (var i = 0; i < N.length; i++) {
      var n = N[i];
      if (!visible(n)) continue;
      var p = project(n.x, n.y, n.z);
      if (!p) continue;
      p.n = n; p.r = Math.max(1.4, radio(n) * p.s);
      var fog = Math.max(0.22, Math.min(1, 1.35 - (p.z / cam.dist) * 0.62)), dim = 1;
      if (match && !match.has(n)) dim = 0.18;
      if (TZ) { if (!TZ.ns.has(n)) dim *= 0.1; }
      else if (sel && !S.isolate && n !== sel && !selKids.has(n) && !vecinos.has(n)) dim *= 0.45;
      p.a = fog * dim; P.push(p); pm.set(n, p);
    }
    proj = P;
    ctx.lineCap = "round"; ctx.globalCompositeOperation = "lighter";
    var vis = [], visCruce = [];
    for (var j = 0; j < E.length; j++) {
      var e = E[j];
      if (S.hiddenVerbs[e.verbo]) continue;
      var pa = pm.get(e.a), pb = pm.get(e.b);
      if (!pa || !pb) continue;
      vis.push(e);
      var xc = cruza(e);
      if (xc) visCruce.push(e);
      if (TZ) {
        // Con una trazabilidad puesta, el resto del mapa queda de fondo: la cadena se dibuja aparte, más abajo.
        ctx.strokeStyle = xc ? "rgba(255,214,140," + Math.min(pa.a, pb.a) * 0.03 + ")" : "rgba(120,146,255," + Math.min(pa.a, pb.a) * 0.035 + ")";
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy);
        ctx.quadraticCurveTo((pa.sx + pb.sx) / 2 - (pb.sy - pa.sy) * e.c, (pa.sy + pb.sy) / 2 + (pb.sx - pa.sx) * e.c, pb.sx, pb.sy); ctx.stroke();
        continue;
      }
      var enRuta = sel && rutaE && rutaE.has(e);
      var hl = enRuta || (sel && (e.a === sel || e.b === sel)) || (hov && (e.a === hov || e.b === hov));
      // Con muchas relaciones resaltadas, cada una se apaga un poco para que no saturen; las que terminan en una
      // tabla, que son las más numerosas, un poco más. La que está bajo el cursor siempre va plena.
      var fuerte = 0.85;
      if (enRuta && !(hov && (e.a === hov || e.b === hov))) fuerte = Math.max(0.2, Math.min(0.85, 0.85 * Math.sqrt(24 / rutaL.length))) * (e.b.tipo === "tabla" ? 0.7 : 1);
      var al = Math.min(pa.a, pb.a) * (hl ? fuerte : xc ? brilloCruce(e) : 0.13);
      ctx.strokeStyle = hl ? rgba(col(enRuta || e.a === sel || e.a === hov ? e.b.tipo : e.a.tipo), al) : xc ? "rgba(255,214,140," + al + ")" : "rgba(120,146,255," + al + ")";
      ctx.lineWidth = hl ? (enRuta && rutaL.length > 60 ? 1.1 : 1.6) : xc ? 1.3 : 1;
      ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy);
      ctx.quadraticCurveTo((pa.sx + pb.sx) / 2 - (pb.sy - pa.sy) * e.c, (pa.sy + pb.sy) / 2 + (pb.sx - pa.sx) * e.c, pb.sx, pb.sy); ctx.stroke();
    }
    nCruceVis = visCruce.length;
    // La cadena: cada arista en el sentido del flujo, con una flecha a dos tercios; los saltos entre cerebros, más
    // gruesos, en dorado y con el nombre del cerebro al que llegan.
    var pastillas = [];
    if (TZ) {
      var muchas = TZ.es.length > 120;
      TZ.es.forEach(function (e) {
        var pa = pm.get(e.a), pb = pm.get(e.b);
        if (!pa || !pb) return;
        var foco = TZ.hov && (e.a === TZ.hov || e.b === TZ.hov);
        var cA = e.cruza ? "#F5B94A" : col(e.b.tipo), al = foco ? 1 : e.cruza ? 0.95 : muchas ? 0.5 : 0.75;
        var cx = (pa.sx + pb.sx) / 2 - (pb.sy - pa.sy) * e.c, cy = (pa.sy + pb.sy) / 2 + (pb.sx - pa.sx) * e.c;
        if (e.cruza) { ctx.strokeStyle = rgba("#F5B94A", 0.22); ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.quadraticCurveTo(cx, cy, pb.sx, pb.sy); ctx.stroke(); }
        ctx.strokeStyle = rgba(cA, al); ctx.lineWidth = e.cruza ? 2.6 : foco ? 2.2 : 1.5;
        ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.quadraticCurveTo(cx, cy, pb.sx, pb.sy); ctx.stroke();
        var t0 = 0.64, p0 = curva(pa, pb, e.c, t0 - 0.03), p1 = curva(pa, pb, e.c, t0 + 0.03), ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), k = e.cruza ? 8 : 6;
        if (Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]) > 0.5) {
          ctx.fillStyle = rgba(cA, Math.min(1, al + 0.1)); ctx.beginPath();
          ctx.moveTo(p1[0] + Math.cos(ang) * k, p1[1] + Math.sin(ang) * k);
          ctx.lineTo(p1[0] + Math.cos(ang + 2.5) * k, p1[1] + Math.sin(ang + 2.5) * k);
          ctx.lineTo(p1[0] + Math.cos(ang - 2.5) * k, p1[1] + Math.sin(ang - 2.5) * k); ctx.closePath(); ctx.fill();
        }
        if (e.cruza && MULTI) { var m = curva(pa, pb, e.c, 0.5); pastillas.push({ x: m[0], y: m[1], de: e.a.c, a: e.b.c }); }
      });
    }
    // Intensidad: con menos, corren menos impulsos y brillan menos; en cero no corre ninguno.
    var I = S.pulsos ? S.intensidad : 0, brillo = 0.3 + 0.7 * I;
    if (I > 0 && vis.length) {
      var tope = (TZ ? Math.min(120, 8 + TZ.es.length * 0.5) : Math.min(150, 14 + vis.length * 0.07)) * I, foco = sel || hov;
      for (var s0 = 0; s0 < 3 && pulsos.length < tope; s0++) {
        if (Math.random() > 0.55 * I) continue;
        var cand = vis[Math.floor(Math.random() * vis.length)];
        // Lo que viaja entre cerebros se ve seguido, aunque sean pocas relaciones entre miles.
        if (visCruce.length && Math.random() < 0.35) cand = visCruce[Math.floor(Math.random() * visCruce.length)];
        // Con una trazabilidad puesta, los impulsos corren solo por la cadena; con un recorrido elegido, lo siguen.
        if (TZ) { if (!TZ.es.length) break; cand = TZ.es[Math.floor(Math.random() * TZ.es.length)]; if (!pm.get(cand.a) || !pm.get(cand.b)) continue; }
        else if (sel && rutaL.length && Math.random() < 0.75) { var re = rutaL[Math.floor(Math.random() * rutaL.length)]; if (pm.get(re.a) && pm.get(re.b) && !S.hiddenVerbs[re.verbo]) cand = re; }
        else if (foco && Math.random() < 0.6) { var fa = foco.adj[Math.floor(Math.random() * foco.adj.length)]; if (fa && pm.get(fa.n) && !S.hiddenVerbs[fa.e.verbo]) cand = fa.e; }
        lanzar(cand, 0);
      }
    } else if (!I) pulsos.length = 0;
    for (var u = pulsos.length - 1; u >= 0; u--) {
      var pu = pulsos[u], pe = pu.e, qa = pm.get(pe.a), qb = pm.get(pe.b);
      if (!qa || !qb || S.hiddenVerbs[pe.verbo]) { pulsos.splice(u, 1); continue; }
      pu.t += pu.v;
      if (pu.t >= 1) {
        pe.b.fire = brillo; pulsos.splice(u, 1);
        if (pu.gen < 3 && Math.random() < 0.6) {
          var sal = TZ ? TZ.es.filter(function (x) { return x.a === pe.b && pm.get(x.b); }) : pe.b.adj.filter(function (x) { return x.e.a === pe.b && !S.hiddenVerbs[x.e.verbo] && pm.get(x.n); }).map(function (x) { return x.e; });
          if (sal.length) { lanzar(sal[Math.floor(Math.random() * sal.length)], pu.gen + 1); if (sal.length > 1 && Math.random() < 0.25) lanzar(sal[Math.floor(Math.random() * sal.length)], pu.gen + 1); }
        }
        continue;
      }
      // Una estrella que titila y gira, con una estela corta y recta (no una cola larga).
      var pc = TZ && pe.cruza ? "#F5B94A" : col(pe.a.tipo), pal = Math.min(1, Math.min(qa.a, qb.a) + 0.25) * brillo;
      var cab = curva(qa, qb, pe.c, pu.t), atras = curva(qa, qb, pe.c, Math.max(0, pu.t - 0.045));
      var est = ctx.createLinearGradient(atras[0], atras[1], cab[0], cab[1]);
      est.addColorStop(0, rgba(pc, 0)); est.addColorStop(1, rgba(pc, 0.6 * pal));
      ctx.strokeStyle = est; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(atras[0], atras[1]); ctx.lineTo(cab[0], cab[1]); ctx.stroke();
      var tw = 0.75 + 0.25 * Math.sin(T * 0.25 + pu.tw), cr = Math.max(5, 15 * Math.min(qa.s, qb.s)) * tw;
      ctx.save(); ctx.translate(cab[0], cab[1]); ctx.rotate(pu.giro + T * 0.04);
      ctx.globalAlpha = pal; ctx.drawImage(estrella(pc), -cr, -cr, cr * 2, cr * 2);
      ctx.restore(); ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";
    P.sort(function (a, b) { return b.z - a.z; });
    var muchos = P.length > 1500;
    for (var k = 0; k < P.length; k++) {
      var p2 = P[k], nn = p2.n;
      var fi = nn.fire; nn.fire = fi > 0.02 ? fi * 0.9 : 0;
      if (p2.r >= (muchos ? 3 : 1.8) || fi) {
        var hr = p2.r * (4 + fi * 2.4);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(1, p2.a * (0.52 + 0.16 * Math.sin(T * 0.035 + nn.fase) + fi * 0.8));
        // Las dendritas se mecen y laten: dos copias de la misma neurona, una espejada, cada una con su vaivén. Con
        // miles de nodos en pantalla va una sola copia, para no perder fluidez.
        var img = neurona(col(nn.tipo)), al0 = ctx.globalAlpha, late = 1 + 0.07 * Math.sin(T * 0.045 + nn.fase * 2);
        ctx.save(); ctx.translate(p2.sx, p2.sy);
        ctx.rotate(nn.fase + 0.3 * Math.sin(T * 0.013 + nn.fase * 3) + T * 0.0012);
        ctx.drawImage(img, -hr * late, -hr * late, hr * 2 * late, hr * 2 * late);
        if (!muchos) {
          ctx.rotate(1.9 + 0.42 * Math.sin(T * 0.009 + nn.fase * 5) - T * 0.0024); ctx.scale(-1, 1);
          ctx.globalAlpha = al0 * 0.5;
          var h2 = hr * (0.82 + 0.1 * Math.sin(T * 0.03 + nn.fase));
          ctx.drawImage(img, -h2, -h2, h2 * 2, h2 * 2);
        }
        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = p2.a;
      ctx.drawImage(soma(col(nn.tipo)), p2.sx - p2.r, p2.sy - p2.r, p2.r * 2, p2.r * 2);
      if (fi > 0.05) { ctx.globalAlpha = Math.min(1, fi * 0.7); ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(p2.sx, p2.sy, p2.r * 0.8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = p2.a; }
      var ring = null;
      if (TZ && nn === TZ.hov) ring = ["#FFE08A", 2.5];
      else if (nn === sel) ring = ["#FFFFFF", 2];
      else if (nn === hov) ring = ["#C7D4FF", 1.5];
      else if ((dragGrp && dragGrp.has(nn)) || (hovKids && hovKids.has(nn)) || (selKids && selKids.has(nn) && S.dragChildren)) ring = ["rgba(199,212,255,.55)", 1];
      if (ring) { ctx.strokeStyle = ring[0]; ctx.lineWidth = ring[1]; ctx.beginPath(); ctx.arc(p2.sx, p2.sy, p2.r + 3, 0, Math.PI * 2); ctx.stroke(); }
      if (nn.pin && p2.r > 3) { ctx.fillStyle = "#C7D4FF"; ctx.beginPath(); ctx.arc(p2.sx + p2.r * 0.75, p2.sy - p2.r * 0.75, 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    ctx.font = "500 11.5px " + color("sans"); ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    // En la trazabilidad se nombra solo la cadena, con tope y por prioridad (origen, saltos, cercanía), sin que un
    // nombre pise a otro: el de menos prioridad se calla.
    var nombres = P;
    if (TZ) nombres = P.filter(function (p3) { return p3.n === hov || p3.n === TZ.hov || TZ.etq.has(p3.n); }).sort(function (a, b) { var pa = a.n === hov || a.n === TZ.hov ? -1 : TZ.etq.get(a.n), pb = b.n === hov || b.n === TZ.hov ? -1 : TZ.etq.get(b.n); return pa - pb; });
    var puestos = [];
    for (var l = 0; l < nombres.length; l++) {
      var p3 = nombres[l], n3 = p3.n;
      var show = n3 === sel || n3 === hov || (sel && rutaN && rutaN.has(n3) && (rutaN.size <= 40 || n3.tipo === "tabla" || n3.c !== sel.c)) || S.labels === "todas" || (S.labels === "grandes" && p3.r > 8.5) || (match && match.has(n3));
      if (S.labels === "ninguna" && n3 !== sel && n3 !== hov) show = false;
      // Con un recorrido aislado queda poco en pantalla: ahí los nombres se prenden solos.
      if (S.isolate && isoSet) show = true;
      if (TZ) show = true;
      if (!show || p3.a < 0.3) continue;
      var lx = p3.sx + p3.r + 6;
      var txt = TZ && (n3.tipo === "archivo" || n3.tipo === "test") ? n3.nombre.slice(n3.nombre.lastIndexOf("/") + 1) : n3.nombre;
      if (TZ && txt.length > 34 && n3 !== hov && n3 !== TZ.hov) txt = txt.slice(0, 33) + "…";
      if (TZ) {
        var caja = { x: lx - 2, y: p3.sy - 8, w: ctx.measureText(txt).width + 4, h: 16 };
        if (n3 !== hov && n3 !== TZ.hov && puestos.some(function (q) { return caja.x < q.x + q.w && q.x < caja.x + caja.w && caja.y < q.y + q.h && q.y < caja.y + caja.h; })) continue;
        puestos.push(caja);
      }
      ctx.globalAlpha = Math.min(1, p3.a + 0.15); ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(10,12,17,.9)";
      ctx.strokeText(txt, lx, p3.sy); ctx.fillStyle = n3 === sel ? "#FFFFFF" : "#D5DAE4"; ctx.fillText(txt, lx, p3.sy); ctx.globalAlpha = 1;
    }
    pastillas.forEach(function (q) {
      var txt = "→ " + CEREBROS[q.a].nombre;
      ctx.font = "600 11px " + color("sans"); var w = ctx.measureText(txt).width + 16;
      ctx.globalAlpha = 0.95; ctx.fillStyle = "rgba(18,22,32,.92)"; ctx.strokeStyle = colorC(q.a); ctx.lineWidth = 1.2;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(q.x - w / 2, q.y - 10, w, 20, 10); else ctx.rect(q.x - w / 2, q.y - 10, w, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colorC(q.a); ctx.textAlign = "center"; ctx.fillText(txt, q.x, q.y); ctx.textAlign = "start"; ctx.globalAlpha = 1;
    });
    pop = null;
    var ph = hov && !ptr && mouse ? pm.get(hov) : null;
    if (ph) {
      var hijos = desc(hov).length, lineas = [hov.nombre, TIPO[hov.tipo].uno + " · " + L(num(hov.uso) + pl(hov.uso, " use · ", " uses · ") + num(hov.deg) + pl(hov.deg, " connection", " connections"), hov.uso + " usos · " + hov.deg + " conexiones")];
      if (hijos) lineas.push(L(num(hijos) + pl(hijos, " child moves", " children move") + " with this node", hijos + " hijos se mueven con este nodo"));
      var accs = relacionadosDe(hov);
      if (!SIN_TZ[hov.tipo]) accs.unshift({ traza: true, tipo: hov.tipo, texto: TZ && TZ.id === hov.id ? L("Exit traceability", "Salir de la trazabilidad") : L("Show full traceability", "Mostrar trazabilidad completa") });
      ctx.font = "500 12px " + color("sans");
      var w = 0; lineas.concat(accs.map(function (a) { return a.texto + "     "; })).forEach(function (t) { w = Math.max(w, ctx.measureText(t).width); });
      var alto = lineas.length * 18 + 14 + (accs.length ? accs.length * 28 + 8 : 0);
      // Con acciones, el cartel se ancla al nodo (no al cursor) para poder llevar el cursor hasta el botón.
      var ax = accs.length ? ph.sx + ph.r * 0.5 : mouse.x + 16, ay = accs.length ? ph.sy + ph.r * 0.5 : mouse.y + 16;
      var bx = Math.max(8, Math.min(W - w - 30, ax)), byy = Math.max(8, Math.min(H - alto - 10, ay));
      ctx.fillStyle = "rgba(18,22,32,.96)"; ctx.strokeStyle = "#2A3142"; ctx.lineWidth = 1;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, byy, w + 24, alto, 8); else ctx.rect(bx, byy, w + 24, alto); ctx.fill(); ctx.stroke();
      lineas.forEach(function (t, ix) { ctx.fillStyle = ix === 0 ? "#FFFFFF" : "#A3ABBD"; ctx.font = (ix === 0 ? "600 " : "400 ") + "12px " + color("sans"); ctx.fillText(t, bx + 12, byy + 16 + ix * 18); });
      if (accs.length) {
        pop = { n: hov, x: bx, y: byy, w: w + 24, h: alto, acciones: [] };
        accs.forEach(function (a, ix) {
          var yy = byy + lineas.length * 18 + 14 + ix * 28, caja = { x: bx + 8, y: yy, w: w + 8, h: 24, acc: a };
          var encima = mouse.x >= caja.x && mouse.x <= caja.x + caja.w && mouse.y >= caja.y && mouse.y <= caja.y + caja.h;
          ctx.fillStyle = encima ? "rgba(91,124,250,.32)" : "rgba(91,124,250,.14)"; ctx.strokeStyle = encima ? "#8FA6FF" : "#36457A";
          ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(caja.x, caja.y, caja.w, caja.h, 6); else ctx.rect(caja.x, caja.y, caja.w, caja.h); ctx.fill(); ctx.stroke();
          ctx.fillStyle = a.traza ? "#F5B94A" : col(a.tipo); ctx.beginPath(); ctx.arc(caja.x + 12, caja.y + 12, 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#E6EAF2"; ctx.font = "500 12px " + color("sans"); ctx.fillText(a.texto, caja.x + 24, caja.y + 12);
          pop.acciones.push(caja);
        });
      }
    }
  }
  var corriendo = false;
  function loop() {
    requestAnimationFrame(loop);
    if (!canvas.offsetParent) return;
    if (TZ && MODO_TZ === "diagrama") return;
    var padre = canvas.parentElement, dpr = window.devicePixelRatio || 1;
    W = padre.clientWidth; H = padre.clientHeight; F = Math.min(W, H) * 1.15;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    var ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    step(); draw(ctx);
  }

  // ---------- Interacción con el lienzo ----------
  function pos(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  canvas.addEventListener("pointerdown", function (ev) {
    var p = pos(ev);
    // Un botón del pop-up: prende (o vuelve a apagar) los relacionados de ese tipo, sin mover ni elegir nada.
    var boton = accionEn(p.x, p.y);
    if (boton && boton.acc.traza) { if (TZ && TZ.id === pop.n.id) salirTraza(); else entrarTraza(pop.n.id); return; }
    if (boton) {
      boton.acc.nodos.forEach(function (x) { if (boton.acc.prender) S.shownIds[x.id] = true; else delete S.shownIds[x.id]; });
      actualizarActivos(); reacomodar(0.3); ui();
      return;
    }
    var cn = MULTI ? nombreEn(p.x, p.y) : -1, hit = cn >= 0 ? null : pick(p.x, p.y);
    canvas.setPointerCapture(ev.pointerId);
    ptr = { x: p.x, y: p.y, moved: 0, hit: hit, group: null, cerebro: cn };
    if (hit) ptr.group = S.dragChildren && !ev.shiftKey ? [hit].concat(desc(hit)) : [hit];
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", function (ev) {
    var p = pos(ev); mouse = p;
    // Mientras el cursor está sobre el pop-up (o yendo hacia él), el nodo sigue siendo el mismo.
    if (!ptr && pop && enPop(p.x, p.y, 10)) { hover = pop.n; canvas.style.cursor = accionEn(p.x, p.y) ? "pointer" : "default"; return; }
    if (!ptr) { sobreNombre = MULTI ? nombreEn(p.x, p.y) : -1; hover = sobreNombre >= 0 ? null : pick(p.x, p.y); canvas.style.cursor = sobreNombre >= 0 ? "move" : hover ? "pointer" : "grab"; return; }
    var dx = p.x - ptr.x, dy = p.y - ptr.y; ptr.x = p.x; ptr.y = p.y; ptr.moved += Math.abs(dx) + Math.abs(dy);
    if (ptr.cerebro >= 0) {
      // Agarrado del nombre: el cerebro entero (centro, corteza y nodos) sigue al cursor, en el plano de la pantalla.
      var pc = project(OX[ptr.cerebro], OY[ptr.cerebro], OZ[ptr.cerebro]);
      if (!pc) return;
      var kc = 1 / pc.s, bc = base3();
      moverCerebro(ptr.cerebro, (dx * bc.right[0] - dy * bc.up[0]) * kc, (dx * bc.right[1] - dy * bc.up[1]) * kc, (dx * bc.right[2] - dy * bc.up[2]) * kc);
    } else if (ptr.hit) {
      var pr = project(ptr.hit.x, ptr.hit.y, ptr.hit.z);
      if (!pr) return;
      var k = 1 / pr.s, b = base3();
      var wx = (dx * b.right[0] - dy * b.up[0]) * k, wy = (dx * b.right[1] - dy * b.up[1]) * k, wz = (dx * b.right[2] - dy * b.up[2]) * k;
      ptr.group.forEach(function (n) { n.x += wx; n.y += wy; n.z += wz; n.pin = true; n.vx = n.vy = n.vz = 0; });
    } else {
      cam.yaw += dx * 0.006; cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + dy * 0.006));
    }
  });
  function soltar() {
    var P = ptr; ptr = null; canvas.style.cursor = "grab";
    if (!P) return;
    if (P.cerebro >= 0) { medirCerebros(false); return; }
    if (P.hit && TZ && P.moved < 5 && (TZ.idx[P.hit.id] || TZ.ns.has(P.hit))) elegirEnTraza(P.hit.id);
    else if (P.hit) seleccionar(P.hit.id);
    else if (TZ) return;
    else if (P.moved < 5) { S.selId = null; S.isolate = false; computeRuta(null); ui(); }
    else if (P.hit) ui();
  }
  canvas.addEventListener("pointerup", soltar);
  canvas.addEventListener("pointercancel", soltar);
  canvas.addEventListener("pointerleave", function () { if (!ptr) { hover = null; sobreNombre = -1; } });
  if (!MULTI) { var soloMulti = document.querySelector(".solo-multi"); if (soloMulti) soloMulti.remove(); }
  canvas.addEventListener("dblclick", function (ev) { var p = pos(ev), h = pick(p.x, p.y); if (h) focus(h); });
  canvas.addEventListener("wheel", function (ev) { ev.preventDefault(); cam.dist = Math.max(220, Math.min(6000, cam.dist * Math.exp(ev.deltaY * 0.0012))); }, { passive: false });

  // ---------- Paneles ----------
  var $ = function (id) { return document.getElementById(id); };
  var sw = function (t) { return '<span class="sw" style="background:' + col(t) + '"></span>'; };
  var on = function (b) { return b ? " on" : ""; };
  function seleccionar(id) { if (S.selId !== id) { S.todas = {}; S.tabC = null; } S.selId = id; computeRuta(id); computeIso(id); ui(); }
  function irA(id) {
    var n = by[id];
    if (!n) return;
    if (S.hiddenTypes[n.tipo] || S.hiddenIds[n.id]) { S.hiddenTypes[n.tipo] = false; delete S.hiddenIds[n.id]; actualizarActivos(); reacomodar(0.4); }
    seleccionar(id); focus(n);
  }
  var PRESETS = [["producto", ["Product", "Producto"], ["feat", "endpoint", "tabla"]], ["arquitectura", ["Architecture", "Arquitectura"], ["svc", "repo", "lib", "ext", "queue", "db"]],
    ["codigo", ["Code", "Código"], ["endpoint", "svc", "repo", "archivo"]], ["todo", ["All", "Todo"], null]];
  function presetActual() {
    var r = null;
    PRESETS.forEach(function (p) { if (TIPOS_PRESENTES.every(function (t) { return !S.hiddenTypes[t[0]] === (!p[2] || p[2].indexOf(t[0]) >= 0); })) r = p[0]; });
    return r;
  }
  function seg(nombre, opciones, actual) {
    return opciones.map(function (o) { return '<button type="button" class="sb' + on(actual === o[0]) + '" aria-pressed="' + (actual === o[0]) + '" data-' + nombre + '="' + o[0] + '">' + o[1] + "</button>"; }).join("");
  }
  function fila(n, extra, marca) { return '<button type="button" class="nb" data-pick="' + esc(n.id) + '" title="' + esc(n.nombre) + '">' + sw(n.tipo) + '<span class="corta">' + esc(n.nombre) + '</span><span class="vb">' + esc(extra) + "</span>" + (marca || "") + "</button>"; }
  /** Resumen del recorrido de punta a punta: qué alcanza lo elegido en cada cerebro, y las tablas a las que llega. */
  function recorridoDe(sel) {
    if (!rutaN) return "";
    var porC = {}, tablas = [];
    rutaN.forEach(function (n) {
      if (n === sel) return;
      (porC[n.c] = porC[n.c] || {})[n.tipo] = ((porC[n.c] || {})[n.tipo] || 0) + 1;
      if (n.tipo === "tabla") tablas.push(n);
    });
    var cs = Object.keys(porC).map(Number).sort(function (a, b) { return (a === sel.c ? -1 : 0) - (b === sel.c ? -1 : 0) || a - b; });
    if (!cs.length) return "";
    tablas.sort(function (a, b) { return a.c - b.c || (a.nombre < b.nombre ? -1 : 1); });
    var ocultos = TIPOS.filter(function (t) { return S.hiddenTypes[t[0]] && cs.some(function (c) { return porC[c][t[0]]; }); }).map(function (t) { return t[1].toLowerCase(); });
    return '<div class="m3-caja"><span class="lbl">' + L("End-to-end flow", "Recorrido de punta a punta") + '</span>' +
      cs.map(function (c) {
        var partes = TIPOS.filter(function (t) { return porC[c][t[0]]; }).map(function (t) { return porC[c][t[0]] + " " + (porC[c][t[0]] === 1 ? t[2] : t[1]).toLowerCase(); });
        return '<div class="nb m3-rc">' + (MULTI ? puntoC(c) + '<span class="corta">' + esc(CEREBROS[c].nombre) + "</span>" : "") + '<span class="vb">' + esc(partes.join(" · ")) + "</span></div>";
      }).join("") +
      (tablas.length ? '<span class="lbl m3-sub">' + L("Tables it reaches", "Tablas a las que llega") + '</span>' + tablas.slice(0, 12).map(function (n) { return fila(n, "", MULTI && n.c !== sel.c ? '<span class="mc" style="color:' + colorC(n.c) + ";border-color:" + colorC(n.c) + '">' + esc(CEREBROS[n.c].nombre) + "</span>" : ""); }).join("") + (tablas.length > 12 ? '<p class="vacio">' + L("and " + num(tablas.length - 12) + " more: click an endpoint to see its own.", "y " + (tablas.length - 12) + " más: hacé clic en un endpoint para ver las suyas.") + "</p>" : "") : '<p class="vacio">' + L("It doesn't reach any indexed table.", "No llega a ninguna tabla indexada.") + "</p>") +
      (ocultos.length ? '<p class="vacio">' + L(ocultos.join(" and ") + " are turned off in the left panel: that part of the flow isn't drawn.", "Hay " + ocultos.join(" y ") + " apagados en el panel izquierdo: esa parte del recorrido no se dibuja.") + "</p>" : "") + "</div>";
  }
  /** Conexiones del nodo elegido, todas: primero las de su cerebro y después un grupo por cada otro cerebro, con su color. */
  var TOPE_GRUPO = 30;
  function conexionesDe(sel) {
    var orden = function (a, b) { return b.e.ev - a.e.ev || b.n.uso - a.n.uso || (a.n.id < b.n.id ? -1 : 1); };
    var grupos = CEREBROS.length ? CEREBROS.map(function () { return []; }) : [[]];
    sel.adj.forEach(function (a) { grupos[a.n.c || 0].push(a); });
    var ids = grupos.map(function (_, i) { return i; }).filter(function (i) { return grupos[i].length; }).sort(function (a, b) { return (a === sel.c ? -1 : 0) - (b === sel.c ? -1 : 0) || a - b; });
    if (!ids.length) return '<div><h3 class="lbl">' + L("Connections", "Conexiones") + '</h3><p class="vacio">' + L("None.", "Ninguna.") + "</p></div>";
    // Con varios cerebros, una pestaña por cerebro con conexiones: se ve de a uno.
    var tab = ids.indexOf(Number(S.tabC)) >= 0 && S.tabC !== null ? Number(S.tabC) : ids[0];
    var tabs = MULTI && ids.length > 1 ? '<div class="m3-tabs" role="tablist">' + ids.map(function (i) {
      return '<button type="button" role="tab" class="m3-tab' + on(i === tab) + '" aria-selected="' + (i === tab) + '" data-tab-c="' + i + '"' + (i === tab ? ' style="border-color:' + colorC(i) + '"' : "") + ">" + puntoC(i) + esc(CEREBROS[i].nombre) + '<span class="ct">' + grupos[i].length + "</span></button>";
    }).join("") + "</div>" : "";
    return (tabs ? '<h3 class="lbl">' + L("Connections", "Conexiones") + '<span class="ct">' + sel.adj.length + "</span></h3>" + tabs : "") + (tabs ? [tab] : ids).map(function (i) {
      var xs = grupos[i].slice().sort(orden), fuera = MULTI && i !== sel.c;
      var sale = xs.filter(function (a) { return a.e.a === sel; }).length, entra = xs.length - sale;
      var titulo = !MULTI ? L("Connections", "Conexiones") : fuera ? L("With ", "Con ") + CEREBROS[i].nombre : L("In ", "En ") + CEREBROS[i].nombre;
      var cuenta = (tabs ? "" : xs.length + " · ") + [sale ? sale + (fuera ? L(" to there", " hacia allá") : L(" outgoing", " salen")) : "", entra ? entra + (fuera ? L(" from there", " desde allá") : L(" incoming", " llegan")) : ""].filter(Boolean).join(", ");
      var ver = S.todas[i] ? xs : xs.slice(0, TOPE_GRUPO);
      return '<div class="m3-grupo"' + (fuera ? ' style="border-left-color:' + colorC(i) + '"' : "") + '><h3 class="lbl">' + (MULTI ? puntoC(i) : "") + esc(titulo) + '<span class="ct">' + cuenta + "</span></h3>" +
        ver.map(function (a) {
          var va = a.e.a === sel, verbo = verboTxt(a.e.verbo);
          return fila(a.n, (va ? verbo + " →" : "← " + verbo) + (fuera && a.e.ev > 1 ? " ×" + a.e.ev : ""), fuera && !tabs ? '<span class="mc" style="color:' + colorC(i) + ";border-color:" + colorC(i) + '">' + esc(CEREBROS[i].nombre) + "</span>" : "");
        }).join("") +
        (xs.length > TOPE_GRUPO ? '<button type="button" class="btn" data-todas="' + i + '">' + (S.todas[i] ? L("Show less", "Ver menos") : L("Show all " + num(xs.length), "Ver las " + xs.length)) + "</button>" : "") + "</div>";
    }).join("");
  }
  function ui() {
    var actual = presetActual();
    $("presets").innerHTML = '<span class="lbl">' + L("View", "Vista") + '</span>' + PRESETS.map(function (p) { return '<button type="button" class="chip' + on(actual === p[0]) + '" aria-pressed="' + (actual === p[0]) + '" data-preset="' + p[0] + '">' + L(p[1][0], p[1][1]) + "</button>"; }).join("");
    var nVis = N.filter(visible).length;
    $("m3-vis").textContent = L(num(nVis) + pl(nVis, " node", " nodes"), nVis + " nodos");
    $("m3-cerebros").innerHTML = MULTI ? CEREBROS.map(function (c, i) {
      var v = !S.hiddenBrains[i];
      return '<button type="button" class="tg' + (v ? "" : " off") + '" aria-pressed="' + v + '" data-cerebro="' + i + '">' + puntoC(i) + esc(c.nombre) + '<span class="ct">' + c.nodos + "</span></button>";
    }).join("") : "";
    var hayTipos = TIPOS_PRESENTES.some(function (t) { return !S.hiddenTypes[t[0]]; });
    $("m3-todo").innerHTML = '<button type="button" class="chip" data-tipos="todos">' + L("Turn all on", "Prender todo") + '</button><button type="button" class="chip' + on(!hayTipos) + '" data-tipos="ninguno">' + L("Turn all off", "Apagar todo") + "</button>";
    $("m3-tipos").innerHTML = TIPOS_PRESENTES.map(function (t) {
      var v = !S.hiddenTypes[t[0]];
      return '<button type="button" class="tg' + (v ? "" : " off") + '" aria-pressed="' + v + '" data-tipo="' + t[0] + '">' + sw(t[0]) + esc(t[1]) + '<span class="ct">' + cuentas[t[0]] + "</span></button>";
    }).join("");
    var nOcultos = Object.keys(S.hiddenIds).length;
    $("m3-ocultos").innerHTML = nOcultos ? '<button type="button" class="chip" data-mostrar-ocultos="1">' + L("Show " + num(nOcultos) + pl(nOcultos, " node", " nodes") + " hidden by hand", "Mostrar " + nOcultos + " nodos ocultos a mano") + "</button>" : "";
    $("m3-verbos").innerHTML = VERBOS.map(function (v) { var x = !S.hiddenVerbs[v]; return '<button type="button" class="chip' + on(x) + '" aria-pressed="' + x + '" data-verbo="' + v + '">' + esc(verboTxt(v)) + "</button>"; }).join("");
    $("m3-tam").innerHTML = seg("tam", [["uso", L("Code usage", "Uso en código")], ["deg", L("Connections", "Conexiones")], ["uni", L("Equal", "Igual")]], S.sizeMode);
    $("m3-grupo").innerHTML = seg("grupo", [["feat", L("Feature", "Funcionalidad")], ["svc", L("Service", "Servicio")], ["none", L("No groups", "Sin grupos")]], S.group);
    $("m3-etq").innerHTML = seg("etq", [["grandes", L("Large", "Grandes")], ["todas", L("All", "Todas")], ["ninguna", L("None", "Ninguna")]], S.labels);
    $("m3-escala-txt").textContent = S.scale.toFixed(1) + "×";
    var drag = $("m3-drag"), rot = $("m3-rot");
    drag.classList.toggle("on", S.dragChildren); drag.setAttribute("aria-pressed", S.dragChildren);
    rot.classList.toggle("on", S.rotating); rot.setAttribute("aria-pressed", S.rotating);
    var imp = $("m3-imp"); imp.classList.toggle("on", S.pulsos); imp.setAttribute("aria-pressed", S.pulsos);
    $("m3-int").disabled = !S.pulsos;
    detalle();
  }
  // Capas de la cadena, de arriba hacia abajo (las numera el core).
  var CAPAS_TZ = [["Features", "Funcionalidad"], ["Screens", "Pantalla"], ["Hooks and components", "Hook / Componente"], ["Files", "Archivo"], ["Endpoints", "Endpoint"],
    ["Services and methods", "Servicio / Método"], ["Queues and events", "Cola / Evento"], ["Tables", "Tabla"], ["External", "Externo"], ["Other", "Otro"]];
  var TOPE_CAPA = 40;
  function huecoTxt(t) {
    if (t === "sin_metodo") return L("No method found that serves this endpoint.", "No se encontró el método que atiende este endpoint.");
    if (t === "truncado") return L("Its walk was cut by depth or number of steps: there may be more below.", "Su recorrido se cortó por profundidad o cantidad de pasos: abajo puede haber más.");
    if (t === "sin_pagina") return L("Table found in the code without a page in the brain.", "Tabla que está en el código y no tiene página en el brain.");
    if (t.indexOf("fuera_del_grafo:") === 0) return L("Touches ", "Toca ") + t.slice(16) + L(", which isn't in the graph.", ", que no está en el grafo.");
    if (t.indexOf("sin_resolver:") === 0) return L("Unresolved call in this file: ", "Llamada sin resolver en este archivo: ") + t.slice(13);
    return t;
  }
`
  + TRAZA_VISTAS_JS +
  String.raw`
  /** La trazabilidad puesta: la cadena por capa, con el cerebro y la evidencia de cada paso, los huecos y lo que quedó afuera. */
  function panelTraza() {
    var r = TZ.r, o = TZ.idx[TZ.id], ev = {};
    // Evidencia de cada elemento: la suya (un paso) o la de la arista que lo une a la cadena, del lado del origen.
    r.aristas.forEach(function (a) { if (a.ev && !ev[a.hasta]) ev[a.hasta] = a.ev; });
    r.aristas.forEach(function (a) { if (a.ev && !ev[a.desde]) ev[a.desde] = a.ev; });
    var filas = {}, cerebrosEn = [], saltos = r.aristas.filter(function (a) { return a.cruza; }).length;
    r.nodos.forEach(function (x) {
      if (MULTI && cerebrosEn.indexOf(x.c) < 0) cerebrosEn.push(x.c);
      (filas[x.capa] = filas[x.capa] || []).push(x);
    });
    // Los archivos que la cadena atraviesa: así se ven los pasos en el mapa.
    var archivos = {}, nArch = 0;
    r.nodos.forEach(function (x) { if (x.tipo === "metodo" && x.archivo && by[x.archivo]) { if (!archivos[x.archivo]) { archivos[x.archivo] = { id: x.archivo, pasos: 0, dist: x.dist, lado: x.lado }; nArch++; } archivos[x.archivo].pasos++; } });
    var sinMapa = r.nodos.filter(function (x) { return !en3(x.id); }).length;
    var chip = function (c) { return MULTI ? '<span class="mc" style="color:' + colorC(c) + ";border-color:" + colorC(c) + '">' + esc(CEREBROS[c].nombre) + "</span>" : ""; };
    var flecha = function (x) { return x.lado === "arriba" ? "↑" : x.lado === "abajo" ? "↓" : "●"; };
    var fila = function (x) {
      var n3 = en3(x.id), e = x.ev || ev[x.id] || (porId[x.id] && porId[x.id].at && porId[x.id].at.evidencia) || "";
      var sw0 = x.tipo === "metodo" ? sw(x.capa === 2 ? "componente" : "svc") : sw(x.tipo);
      return '<button type="button" class="nb tz-fila' + (x.id === TZ.ficha ? " on" : "") + '"' + (n3 || TZ.idx[x.id] ? ' data-tz="' + esc(x.id) + '"' : " disabled") + ' title="' + esc(x.id) + '">' + sw0 +
        '<span class="tz-txt"><span class="corta">' + esc(x.nombre) + "</span>" + (e ? '<code class="tz-ev">' + esc(e) + "</code>" : '<span class="tz-ev">' + L("no evidence", "sin evidencia") + "</span>") + "</span>" +
        '<span class="vb" title="' + (x.lado === "arriba" ? L("reaches it", "llega a él") : x.lado === "abajo" ? L("it reaches", "llega desde él") : L("origin", "origen")) + '">' + flecha(x) + "</span>" + chip(x.c) + "</button>";
    };
    var capas = CAPAS_TZ.map(function (cp, i) {
      var xs = i === 3 ? (filas[3] || []).concat(Object.keys(archivos).map(function (k) { var a = archivos[k], n = by[k]; return { id: k, tipo: n.tipo, nombre: n.nombre, c: n.c, capa: 3, lado: a.lado, dist: a.dist, ev: L(a.pasos + (a.pasos === 1 ? " step" : " steps") + " of the chain", a.pasos + (a.pasos === 1 ? " paso" : " pasos") + " de la cadena") }; }).sort(function (a, b) { return a.dist - b.dist || (a.nombre < b.nombre ? -1 : 1); })) : filas[i] || [];
      if (!xs.length) return "";
      var ver = TZ.todas[i] ? xs : xs.slice(0, TOPE_CAPA);
      return '<div class="m3-grupo tz-capa"><h3 class="lbl">' + esc(L(cp[0], cp[1])) + '<span class="ct">' + xs.length + "</span></h3>" + ver.map(fila).join("") +
        (xs.length > TOPE_CAPA ? '<button type="button" class="btn" data-tz-todas="' + i + '">' + (TZ.todas[i] ? L("Show less", "Ver menos") : L("Show all " + num(xs.length), "Ver los " + xs.length)) + "</button>" : "") + "</div>";
    }).join("");
    var nombreDe = function (id) { var x = r.nodos.filter(function (y) { return y.id === id; })[0]; return x ? x.nombre : id; };
    var huecos = r.huecos.length ? '<div class="m3-caja tz-huecos"><span class="lbl">' + L("Gaps in the chain", "Huecos en la cadena") + '<span class="ct">' + r.huecos.length + "</span></span>" +
      r.huecos.slice(0, 30).map(function (h) { var n3 = en3(h.en); return '<button type="button" class="nb tz-fila"' + (n3 || TZ.idx[h.en] ? ' data-tz="' + esc(h.en) + '"' : " disabled") + '><span class="tz-txt"><span class="corta">' + esc(nombreDe(h.en)) + '</span><span class="tz-hueco">' + esc(huecoTxt(h.texto)) + "</span>" + (h.ev ? '<code class="tz-ev">' + esc(h.ev) + "</code>" : "") + "</span></button>"; }).join("") +
      (r.huecos.length > 30 ? '<p class="vacio">' + L("and " + num(r.huecos.length - 30) + " more.", "y " + (r.huecos.length - 30) + " más.") + "</p>" : "") + "</div>" : "";
    var corte = "";
    if (r.truncado) {
      var fuera = Object.keys(r.truncado.fuera).sort(function (a, b) { return r.truncado.fuera[b] - r.truncado.fuera[a]; }).map(function (t) { var k = r.truncado.fuera[t], nm = t === "metodo" ? L(pl(k, "step", "steps"), pl(k, "paso", "pasos")) : TIPO[t] ? (k === 1 ? TIPO[t].uno : TIPO[t].label).toLowerCase() : t; return k + " " + nm; }).join(", ");
      corte = '<p class="vacio tz-corte">' + L("The chain is cut at the " + num(r.truncado.mostrados) + " pieces closest to the origin, out of " + num(r.truncado.total) + ". Left out: " + fuera + ". Start from a piece further along to see that part.",
        "La cadena se corta en las " + r.truncado.mostrados + " piezas más cercanas al origen, de " + r.truncado.total + ". Quedaron afuera: " + fuera + ". Arrancá desde una pieza más adelante para ver esa parte.") + "</p>";
    }
    var vacia = r.nodos.length <= 1 ? '<p class="vacio">' + L("No flow relation reaches this piece or leaves it: nothing in the graph calls it, draws it or reads it, and it doesn't call anything. If it should, check Fidelity for this file or feature.",
      "Ninguna relación de flujo llega a esta pieza ni sale de ella: nada del grafo la llama, la dibuja ni la lee, y ella no llama a nada. Si debería, revisá Fidelidad de su archivo o funcionalidad.") + "</p>" : "";
    // Los cerebros en el sentido de los saltos: primero el que más llama a otros y menos recibe.
    cerebrosEn = cerebrosEnOrden(r);
    var ruta = MULTI && cerebrosEn.length ? '<div class="tz-ruta">' + cerebrosEn.map(function (c) { return '<span class="tz-cer" style="color:' + colorC(c) + ";border-color:" + colorC(c) + '">' + puntoC(c) + esc(CEREBROS[c].nombre) + "</span>"; }).join('<span class="tz-sig">→</span>') + "</div>" : "";
    return '<div class="m3-cab"><div class="m3-tipo"><span class="sw" style="background:#F5B94A"></span><span class="lbl">' + L("Full traceability", "Trazabilidad completa") + "</span></div>" +
      '<h2 class="m3-nombre">' + (o && by[o.id] ? sw(o.tipo) + " " : "") + esc(o ? o.nombre : TZ.id) + "</h2><code>" + esc(TZ.id) + "</code>" +
      '<p class="m3-resumen">' + L(num(r.nodos.length) + pl(r.nodos.length, " piece", " pieces") + (MULTI ? " in " + cerebrosEn.length + pl(cerebrosEn.length, " brain", " brains") + " · " + saltos + pl(saltos, " jump", " jumps") + " between brains" : "") + ". ↑ reaches it · ↓ it reaches.",
        r.nodos.length + " piezas" + (MULTI ? " en " + cerebrosEn.length + (cerebrosEn.length === 1 ? " cerebro" : " cerebros") + " · " + saltos + (saltos === 1 ? " salto" : " saltos") + " entre cerebros" : "") + ". ↑ llega a ella · ↓ llega desde ella.") + "</p>" + ruta + "</div>" +
      '<div class="tz-modo"><span class="lbl">' + L("Show", "Ver") + '</span><div class="seg">' + seg("tzmodo", [["diagrama", L("Diagram (2D)", "Diagrama (2D)")], ["cerebros", L("In the brains (3D)", "En los cerebros (3D)")]], MODO_TZ) + "</div></div>" +
      '<div class="m3-acciones"><button type="button" class="btn pri" data-acc="tz-salir">' + L("Exit traceability", "Salir de la trazabilidad") + '</button><button type="button" class="btn" data-acc="tz-encuadrar">' + L("Frame the chain", "Encuadrar la cadena") + "</button></div>" +
      (TZ.ficha ? fichaDe(TZ.ficha) : '<p class="vacio">' + L("Click a piece of the chain (in the diagram, the map or the list) to see its card.", "Hacé clic en una pieza de la cadena (en el diagrama, el mapa o la lista) para ver su ficha.") + "</p>") +
      corte + vacia + huecos + '<h3 class="lbl tz-cadena">' + L("The chain, by layer", "La cadena, por capa") + "</h3>" + capas +
      (sinMapa ? '<p class="vacio">' + L(num(sinMapa) + pl(sinMapa, " piece of the chain has", " pieces of the chain have") + " no point on the map (their file isn't indexed as a node, or it's a table without a page): they're only listed here.",
        sinMapa + " piezas de la cadena no tienen punto en el mapa (su archivo no está indexado como nodo, o es una tabla sin página): solo se listan acá.") + "</p>" : "");
  }
  function detalle() {
    var sel = S.selId ? by[S.selId] : null, raiz = $("m3-detalle");
    if (TZ) { raiz.innerHTML = panelTraza(); return; }
    if (!sel && MULTI) {
      // Un bloque por cerebro: qué tiene, con su interruptor, y lo que viaja entre ellos.
      var bloques = CEREBROS.map(function (c, i) {
        var porTipo = {};
        N.forEach(function (n) { if (n.c === i) porTipo[n.tipo] = (porTipo[n.tipo] || 0) + 1; });
        var v = !S.hiddenBrains[i];
        return '<div class="m3-cer"><h3>' + puntoC(i) + esc(c.nombre) + "</h3><p>" + L(num(c.nodos) + pl(c.nodos, " node", " nodes") + (c.sinRevisar ? " · indexed without review" : ""), c.nodos + " nodos" + (c.sinRevisar ? " · indexado sin revisión" : "")) + "</p>" +
          TIPOS.filter(function (t) { return porTipo[t[0]]; }).map(function (t) { return '<div class="nb">' + sw(t[0]) + '<span class="corta">' + esc(t[1]) + '</span><span class="vb">' + porTipo[t[0]] + "</span></div>"; }).join("") +
          '<div class="m3-acciones"><button type="button" class="btn' + on(v) + '" aria-pressed="' + v + '" data-cerebro="' + i + '">' + (v ? L("Turn off", "Apagar") : L("Turn on", "Prender")) + '</button><button type="button" class="btn" data-foco-cerebro="' + i + '">' + L("Focus", "Enfocar") + "</button></div></div>";
      }).join("");
      var viaja = (D.conexiones || []).map(function (x) {
        return '<div class="nb"><span class="corta">' + esc(x.desde) + " → " + esc(x.hacia) + '</span><span class="vb">' + L((x.llamadas ? num(x.llamadas) + pl(x.llamadas, " call", " calls") : "no calls") + (x.declarada ? (x.origen === "modelo" ? " · declared by a model" : "") : " · not declared"), (x.llamadas ? x.llamadas + " llamadas" : "sin llamadas") + (x.declarada ? (x.origen === "modelo" ? " · lo declaró un modelo" : "") : " · sin declarar")) + "</span></div>";
      }).join("");
      raiz.innerHTML = '<div class="m3-vacio"><h2 class="lbl">' + L("Brains", "Cerebros") + "</h2><p>" + L("Each brain is a group of repos. The golden lines are calls from one brain to another.", "Cada cerebro es un grupo de repos. Las líneas doradas son llamadas de un cerebro a otro.") + "</p>" + bloques +
        '<div class="m3-caja"><span class="lbl">' + L("What travels between brains", "Qué viaja entre cerebros") + "</span>" + (viaja || '<p class="vacio">' + L("Nothing: communication isn't active or no calls were detected.", "Nada: no hay comunicación activa o no se detectaron llamadas.") + "</p>") + "</div></div>";
      return;
    }
    if (!sel) {
      var top = N.filter(function (n) { return n.tipo === "tabla" || n.tipo === "endpoint" || n.tipo === "feat"; }).sort(function (a, b) { return b.uso - a.uso || (a.id < b.id ? -1 : 1); }).slice(0, 6);
      raiz.innerHTML = '<div class="m3-vacio"><h2 class="lbl">' + L("Detail", "Detalle") + "</h2><p>" + L("Click a point to see what it is, how much the code uses it and what it connects to.", "Hacé clic en un punto para ver qué es, cuánto se usa en el código y con qué se conecta.") + "</p>" +
        '<div class="m3-caja"><span class="lbl">' + L("Most used", "Más usados") + "</span>" + top.map(function (n) { return fila(n, L(num(n.uso) + pl(n.uso, " use", " uses"), n.uso + " usos")); }).join("") + "</div></div>";
      return;
    }
    var n = porId[sel.id];
    var enlaces = [];
    if (sel.tipo === "feat") enlaces.push('<a href="#/f/' + encodeURIComponent(sel.id) + '">' + L("Open the card", "Abrir la ficha") + "</a>");
    enlaces.push('<a href="#/n/' + encodeURIComponent(sel.id) + '">' + L("Technical sheet", "Ficha técnica") + "</a>");
    enlaces.push('<a href="#/impacto/' + encodeURIComponent(sel.id) + '">' + L("What's affected if it changes?", "¿Qué se ve afectado si cambia?") + "</a>");
    if (n.p) enlaces.push('<a href="../' + esc(n.p) + '">' + L("Page", "Página") + "</a>");
    raiz.innerHTML =
      '<div class="m3-cab"><div class="m3-tipo">' + sw(sel.tipo) + '<span class="lbl">' + esc(TIPO[sel.tipo].uno) + "</span>" + (sel.pin ? '<span class="m3-fijado">' + L("Pinned", "Fijado") + "</span>" : "") + "</div>" +
      '<h2 class="m3-nombre">' + esc(sel.nombre) + "</h2><code>" + esc(sel.id) + "</code>" + (MULTI ? '<p class="m3-resumen">' + L("Brain: ", "Cerebro: ") + esc(CEREBROS[sel.c].nombre) + "</p>" : "") + (n.r && !/^Borrador:/.test(n.r) ? '<p class="m3-resumen">' + esc(n.r) + "</p>" : "") + "</div>" +
      '<div class="m3-stats"><div><b>' + sel.uso + "</b><span>" + L("uses in code", "usos en código") + "</span></div><div><b>" + sel.deg + "</b><span>" + L("connections", "conexiones") + "</span></div><div><b>" + desc(sel).length + "</b><span>" + L("children", "hijos") + "</span></div></div>" +
      '<div class="m3-acciones"><button type="button" class="btn pri" data-acc="sep">' + L("Separate from the rest", "Separar del resto") + '</button><button type="button" class="btn" data-acc="focus">' + L("Focus", "Enfocar") + "</button>" +
      '<button type="button" class="btn' + on(S.isolate) + '" aria-pressed="' + S.isolate + '" data-acc="iso">' + L("Isolate", "Aislar") + '</button><button type="button" class="btn" data-acc="hide">' + L("Hide", "Ocultar") + "</button>" +
      (SIN_TZ[sel.tipo] ? "" : '<button type="button" class="btn ancho" data-acc="tz">' + L("Show full traceability", "Mostrar trazabilidad completa") + "</button>") +
      (sel.pin ? '<button type="button" class="btn ancho" data-acc="unpin">' + L("Back to its place", "Volver a su lugar") + "</button>" : "") + "</div>" +
      '<div class="m3-enlaces">' + enlaces.join("") + "</div>" +
      recorridoDe(sel) + conexionesDe(sel) +
      '<button type="button" class="btn" data-acc="close">' + L("Close detail", "Cerrar detalle") + "</button>";
  }
  function resultados() {
    var q = S.query.trim().toLowerCase(), r = $("m3-res");
    if (!q) { r.innerHTML = ""; r.classList.add("oculto"); return; }
    var xs = N.filter(function (n) { return n.nombre.toLowerCase().indexOf(q) >= 0 || n.id.toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return b.uso - a.uso || (a.id < b.id ? -1 : 1); }).slice(0, 6);
    r.innerHTML = xs.map(function (n) { return fila(n, TIPO[n.tipo].uno); }).join("");
    r.classList.toggle("oculto", !xs.length);
  }

  // El panel de detalle se ensancha arrastrando su borde; el ancho se recuerda en este navegador.
  (function () {
    var asa = $("m3-asa"), app = document.getElementById("app");
    if (!asa) return;
    var poner = function (w) { app.style.setProperty("--der", Math.round(Math.max(260, Math.min(window.innerWidth * 0.6, w))) + "px"); };
    try { var previo = Number(localStorage.getItem("flowbrain-m3-der")); if (previo) poner(previo); } catch (e) { /* sin almacenamiento */ }
    var mover = function (ev) { poner(window.innerWidth - ev.clientX); ev.preventDefault(); };
    var soltar = function () {
      window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); asa.classList.remove("on");
      try { localStorage.setItem("flowbrain-m3-der", String(parseInt(app.style.getPropertyValue("--der"), 10) || 300)); } catch (e) { /* sin almacenamiento */ }
    };
    asa.addEventListener("pointerdown", function (ev) { asa.classList.add("on"); window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar); ev.preventDefault(); });
    asa.addEventListener("dblclick", function () { poner(300); soltar(); });
  })();

  document.getElementById("app").addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button, a") : null;
    if (!b || b.tagName === "A") return;
    var d = b.dataset, sel = S.selId ? by[S.selId] : null;
    if (d.acc === "pedir" && b.closest("#m3-detalle")) { if (window.brainPedido) window.brainPedido.sumar(d.tipo, d.k); ui(); return; }
    if ((d.tz || d.tzIr) && TZ) {
      var iz = d.tz || d.tzIr, nz = en3(iz);
      if (TZ.idx[iz] || by[iz]) elegirEnTraza(iz);
      if (MODO_TZ === "diagrama") centrarEn(iz, false); else if (nz) { TZ.hov = nz; focus(nz); }
      return;
    }
    if (d.tzTodas) { TZ.todas[d.tzTodas] = !TZ.todas[d.tzTodas]; ui(); return; }
    if (d.tzmodo && TZ) {
      if (d.tzmodo !== MODO_TZ) { MODO_TZ = d.tzmodo; verDiagrama(MODO_TZ === "diagrama"); if (MODO_TZ === "cerebros") { encuadrar(); TZ.re = T + 45; } }
      ui(); return;
    }
    if (d.pick) { irA(d.pick); if (b.closest("#m3-res")) { S.query = ""; $("m3-buscar").value = ""; resultados(); } return; }
    if (d.cerebro) { S.hiddenBrains[d.cerebro] = !S.hiddenBrains[d.cerebro]; actualizarActivos(); reacomodar(0.3); }
    else if (d.tabC) S.tabC = d.tabC;
    else if (d.todas) S.todas[d.todas] = !S.todas[d.todas];
    else if (d.focoCerebro) { var fc = Number(d.focoCerebro); cam.goal = { x: OX[fc], y: OY[fc], z: OZ[fc], dist: Math.max(600, (BRS[fc] || 260) * 3.1) }; }
    else if (d.tipos) { S.shownIds = {}; TIPOS.forEach(function (t) { S.hiddenTypes[t[0]] = d.tipos === "ninguno"; }); actualizarActivos(); reacomodar(0.3); }
    else if (d.tipo) { N.forEach(function (x) { if (x.tipo === d.tipo) delete S.shownIds[x.id]; }); S.hiddenTypes[d.tipo] = !S.hiddenTypes[d.tipo]; actualizarActivos(); reacomodar(0.3); }
    else if (d.verbo) { S.hiddenVerbs[d.verbo] = !S.hiddenVerbs[d.verbo]; armarResortes(); }
    else if (d.mostrarOcultos) { S.hiddenIds = {}; actualizarActivos(); }
    else if (d.tam) S.sizeMode = d.tam;
    else if (d.etq) S.labels = d.etq;
    else if (d.grupo) { S.group = d.grupo; setParents(d.grupo); actualizarActivos(); soltarTodo(); }
    else if (d.acc === "explode") separarGrupos();
    else if (d.acc === "relayout") { OX.forEach(function (_, c) { moverCerebro(c, OX0[c] - OX[c], -OY[c], OZ0[c] - OZ[c]); }); soltarTodo(); }
    else if (d.acc === "recenter") recentrar();
    else if (d.acc === "drag") S.dragChildren = !S.dragChildren;
    else if (d.acc === "rot") S.rotating = !S.rotating;
    else if (d.acc === "imp") S.pulsos = !S.pulsos;
    else if (d.acc === "sep" && sel) separar(sel);
    else if (d.acc === "focus" && sel) focus(sel);
    else if (d.acc === "iso") { computeIso(); S.isolate = !S.isolate; }
    else if (d.acc === "hide" && sel) { S.hiddenIds[sel.id] = true; S.selId = null; S.isolate = false; computeRuta(null); actualizarActivos(); }
    else if (d.acc === "unpin" && sel) { [sel].concat(desc(sel)).forEach(function (n) { n.pin = false; }); reacomodar(0.6); }
    else if (d.acc === "close") { S.selId = null; S.isolate = false; computeRuta(null); }
    else if (d.acc === "tz" && sel) { entrarTraza(sel.id); return; }
    else if (d.acc === "tz-salir") { salirTraza(); return; }
    else if (d.acc === "tz-encuadrar") encuadrar();
    else if (d.acc === "tz-ficha-cerrar" && TZ) { TZ.ficha = null; TZ.codigo = null; marcarDiagrama(); }
    else if (d.acc === "tz-codigo" && TZ && TZ.ficha) { verCodigo(TZ.idx[TZ.ficha] || fichaPieza(TZ.ficha)); return; }
    else if (d.acc === "tz-desde" && TZ && TZ.ficha) { entrarTraza(TZ.ficha); return; }
    else return;
    ui();
  });
  // Pasar el mouse por un paso de la lista lo marca en el mapa (anillo y nombre); hacer clic, además, lo enfoca.
  $("m3-detalle").addEventListener("mouseover", function (ev) { if (!TZ) return; var b = ev.target.closest ? ev.target.closest("[data-tz]") : null; TZ.hov = b ? en3(b.dataset.tz) : null; });
  $("m3-detalle").addEventListener("mouseleave", function () { if (TZ) TZ.hov = null; });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && TZ && canvas.offsetParent) salirTraza(); });
  (function () {
    var st = document.createElement("style");
    st.textContent = ".tz-fila{align-items:flex-start;min-height:40px}.tz-fila.on{background:var(--sel-fondo)}.tz-fila[disabled]{cursor:default;opacity:.75}.tz-fila .sw{margin-top:5px}" +
      ".tz-txt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.tz-ev{font:400 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--suave);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".tz-hueco{font:400 12px var(--sans);color:var(--atencion);white-space:normal}.tz-fila .vb{margin-top:3px}.tz-fila .mc{margin-top:2px}" +
      ".tz-ruta{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.tz-cer{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border:1px solid;border-radius:999px;font:600 11px var(--sans)}" +
      ".tz-modo{display:flex;align-items:center;gap:10px}.tz-modo .seg{flex:1}" +
      ".tz-sig{color:var(--suave)}.tz-corte{border-left:2px solid var(--atencion);padding-left:8px}.tz-huecos{border-color:var(--atencion-borde)}" + ` + JSON.stringify(TRAZA_CSS) + String.raw`;
    document.head.appendChild(st);
  })();
  $("presets").addEventListener("click", function (ev) {
    var b = ev.target.closest("button");
    if (!b) return;
    var p = PRESETS.filter(function (x) { return x[0] === b.dataset.preset; })[0];
    TIPOS.forEach(function (t) { S.hiddenTypes[t[0]] = !!p[2] && p[2].indexOf(t[0]) < 0; });
    actualizarActivos(); reacomodar(0.3); ui();
  });
  $("m3-buscar").addEventListener("input", function (ev) { S.query = ev.target.value; resultados(); });
  $("m3-buscar").addEventListener("keydown", function (ev) { var b = $("m3-res").querySelector("button"); if (ev.key === "Enter" && b) b.click(); });
  $("m3-escala").addEventListener("input", function (ev) { S.scale = parseFloat(ev.target.value); $("m3-escala-txt").textContent = S.scale.toFixed(1) + "×"; });
  $("m3-lin").addEventListener("input", function (ev) { S.lineas = parseFloat(ev.target.value) / 100; $("m3-lin-txt").textContent = ev.target.value + "%"; });
  if (!MULTI) $("m3-lin-sec").hidden = true;
  $("m3-int").addEventListener("input", function (ev) { S.intensidad = parseFloat(ev.target.value) / 100; $("m3-int-txt").textContent = ev.target.value + "%"; });
  ui();
  // Al cambiar de idioma: los nombres de los tipos y todos los paneles (el lienzo se repinta solo en cada cuadro).
  if (window.brainI18n) window.brainI18n.alCambiar(function () { rotular(); ui(); resultados(); });

  function mostrarMapa() { if (!corriendo) { corriendo = true; loop(); } }
  // El color de un cerebro, por su número o su nombre: el mismo del mapa 3D en todas las pantallas.
  var colorCerebro = function (v) { var i = typeof v === "number" || /^\d+$/.test(String(v)) ? Number(v) : CEREBROS.map(function (c) { return c.nombre; }).indexOf(String(v)); return i >= 0 && MULTI ? colorC(i) : ""; };
  window.brainVisor = { D: D, porId: porId, esc: esc, color: color, colorCerebro: colorCerebro, enfocar: function (id) { mostrarMapa(); irA(id); }, mostrarMapa: mostrarMapa,
    trazabilidad: function (id) { mostrarMapa(); entrarTraza(id); }, salirTrazabilidad: salirTraza };
})();
`;

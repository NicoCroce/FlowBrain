/**
 * Vista "Mapa 3D" del visor (`#/grafo`): el grafo entero en 3D, dibujado en un `<canvas>` sin librerías.
 * Se dibuja como un cerebro: cada nodo es una neurona (soma, halo y dendritas), cada arista un axón curvo por el que
 * corren impulsos en el sentido de la relación, y una nube de puntos marca la corteza con sus dos hemisferios.
 * Cada neurona crece con su uso en el código; se elige qué tipos y relaciones se ven, cómo se agrupan, y al arrastrar
 * o separar un nodo se lleva a sus hijos. Publica `window.brainVisor` (datos, `enfocar`, `mostrarMapa`) para las
 * demás vistas. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const GRAFO3D_JS = String.raw`
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("datos").textContent);
  var M = D.mapa3d;
  var porId = {};
  D.nodes.forEach(function (n) { porId[n.id] = n; });
  var css = getComputedStyle(document.documentElement);
  var color = function (v) { return css.getPropertyValue("--" + v).trim() || "#888888"; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  var TIPOS = [["feat", "Funcionalidades", "Funcionalidad"], ["pantalla", "Pantallas", "Pantalla"], ["endpoint", "Endpoints", "Endpoint"], ["tabla", "Tablas", "Tabla"], ["svc", "Servicios", "Servicio"],
    ["repo", "Repositorios", "Repositorio"], ["lib", "Librerías", "Librería"], ["ext", "Externos", "Externo"], ["queue", "Colas", "Cola"], ["db", "Bases de datos", "Base de datos"],
    ["team", "Equipos", "Equipo"], ["decision", "Decisiones", "Decisión"], ["archivo", "Archivos", "Archivo"]];
  var TIPO = {};
  TIPOS.forEach(function (t) { TIPO[t[0]] = { label: t[1], uno: t[2] }; });
  var ORDEN_VERBOS = ["implementa", "navega_a", "llama_a", "lee_de", "escribe_en", "publica_en", "consume_de", "depende_de", "contiene", "vive_en", "recorrido", "pertenece_a", "decidido_por"];
  var colores = {};
  var col = function (t) { return colores[t] || (colores[t] = color(t)); };

  // ---------- Modelo ----------
  // Varios cerebros: cada uno se dibuja como un cerebro aparte, uno al lado del otro. Con uno solo, todo queda en el origen.
  var CEREBROS = D.cerebros || [], MULTI = CEREBROS.length > 1, SEP = 1500;
  /** Un color por cerebro (hasta 5): el del nombre sobre su corteza y el de la marca en cada conexión que cruza. */
  var COLOR_C = ["#8FA6FF", "#F5B94A", "#5EDBB0", "#F28BB3", "#B79CFF"];
  function colorC(i) { return COLOR_C[i % COLOR_C.length]; }
  function puntoC(i) { return '<span class="pc" style="background:' + colorC(i) + '"></span>'; }
  var OX = MULTI ? CEREBROS.map(function (_, i) { return (i - (CEREBROS.length - 1) / 2) * SEP; }) : [0];
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
  var VERBOS = ORDEN_VERBOS.filter(function (v) { return E.some(function (e) { return e.verbo === v; }); });
  var cuentas = {};
  N.forEach(function (n) { cuentas[n.tipo] = (cuentas[n.tipo] || 0) + 1; });
  var TIPOS_PRESENTES = TIPOS.filter(function (t) { return cuentas[t[0]]; });

  function azar(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var rnd = azar(7);
  N.forEach(function (n) {
    var u = rnd() * Math.PI * 2, v = Math.acos(2 * rnd() - 1), R = 160 + rnd() * 280;
    n.x = OX[n.c] + R * Math.sin(v) * Math.cos(u); n.y = R * Math.sin(v) * Math.sin(u) * 0.8; n.z = R * Math.cos(v);
    n.fase = rnd() * Math.PI * 2;
  });

  var ocultosIniciales = {};
  TIPOS.forEach(function (t) { if (D.tiposIniciales.indexOf(t[0]) < 0) ocultosIniciales[t[0]] = true; });
  var S = { hiddenTypes: ocultosIniciales, hiddenVerbs: {}, sizeMode: "uso", scale: 1, group: "feat", labels: "grandes", selId: null, query: "",
    dragChildren: true, rotating: true, isolate: false, hiddenIds: {}, hiddenBrains: {}, todas: {}, tabC: null, intensidad: 1,
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
  function base(n) { return !S.hiddenTypes[n.tipo] && !S.hiddenIds[n.id] && !S.hiddenBrains[n.c]; }
  // Una relación entre dos cerebros: lo que viaja de uno a otro.
  function cruza(e) { return e.a.c !== e.b.c; }
  var isoSet = null;
  function visible(n) { return base(n) && (!S.isolate || !isoSet || isoSet.has(n)); }
  function computeIso(id) {
    var n = by[id || S.selId];
    if (!n) { isoSet = null; return; }
    var s = new Set([n]);
    desc(n).forEach(function (c) { s.add(c); });
    n.adj.forEach(function (a) { s.add(a.n); });
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
      n = A[i]; var rx = n.x - OX[n.c]; n.vx -= rx * 0.004; n.vy -= n.y * 0.0056; n.vz -= n.z * 0.0031;
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
  var anims = [], proj = [], hover = null, ptr = null, mouse = null, W = 0, H = 0, F = 1;
  var canvas = document.getElementById("m3-canvas");
  function radio(n) {
    var b = S.sizeMode === "uso" ? 3 + 3.4 * Math.log(1 + n.uso) : S.sizeMode === "deg" ? 3 + 3.4 * Math.log(1 + n.deg) : 7;
    return b * S.scale;
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
  function chispa(c) {
    var k = "c" + c;
    if (sprites[k]) return sprites[k];
    var R = 32, cv = lienzo(R * 2), x = cv.getContext("2d"), g = x.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.22, rgba(c, 0.85)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, R * 2, R * 2);
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
    for (var i = 0; i < activos.length; i++) { var n = activos[i]; if (n.pin || n.c !== c) continue; var rx = n.x - OX[c]; r += Math.sqrt(rx * rx + n.y * n.y + n.z * n.z); k++; }
    return k ? Math.max(260, 1.5 * r / k) : 260;
  }
  // Radio de cada corteza; BR es el ancho de todo el conjunto, para alejar la cámara lo justo.
  function medirCerebros(suave) {
    for (var c = 0; c < OX.length; c++) { var r = radioCerebro(c); BRS[c] = BRS[c] && suave ? BRS[c] + (r - BRS[c]) * 0.25 : r; }
    BR = Math.max.apply(null, BRS) + (OX[OX.length - 1] - OX[0]) / 2;
  }
  // Impulsos: viajan por una arista de origen a destino; al llegar encienden la neurona y pueden seguir por sus salidas.
  var pulsos = [];
  function lanzar(e, gen) { pulsos.push({ e: e, t: 0, v: 0.011 + Math.random() * 0.014, gen: gen }); }
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

  function step() {
    var c = cam;
    T++;
    if (!BR) { medirCerebros(false); c.dist = Math.max(c.dist, BR * 2.9); } else if (T % 20 === 0) medirCerebros(true);
    if (S.rotating && !ptr) c.yaw += 0.0016;
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
    for (var cb = 0; cb < OX.length; cb++) {
      if (S.hiddenBrains[cb]) continue;
      var rb = BRS[cb] || 260;
      for (var ci = 0; ci < CORTEZA.length; ci++) {
        var cp = CORTEZA[ci], cq = project(OX[cb] + cp[0] * rb, cp[1] * rb, cp[2] * rb);
        if (!cq) continue;
        ctx.globalAlpha = Math.max(0.07, Math.min(0.55, 0.95 - (cq.z / cam.dist) * 0.66));
        var cs = Math.max(1.2, 3 * cq.s);
        ctx.fillRect(cq.sx - cs / 2, cq.sy - cs / 2, cs, cs);
      }
      // El nombre de cada cerebro, sobre su corteza.
      if (MULTI) {
        var ct = project(OX[cb], rb * 0.98, 0);
        if (ct) { ctx.globalAlpha = 0.85; ctx.font = "600 " + Math.max(12, Math.min(22, 26000 * ct.s / 100)) + "px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = colorC(cb); ctx.fillText(CEREBROS[cb].nombre, ct.sx, ct.sy - 10); ctx.textAlign = "start"; ctx.fillStyle = "#8FA6FF"; }
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
    if (sel) { vecinos = new Set(); sel.adj.forEach(function (a) { vecinos.add(a.n); }); }
    var P = [], pm = new Map();
    for (var i = 0; i < N.length; i++) {
      var n = N[i];
      if (!visible(n)) continue;
      var p = project(n.x, n.y, n.z);
      if (!p) continue;
      p.n = n; p.r = Math.max(1.4, radio(n) * p.s);
      var fog = Math.max(0.22, Math.min(1, 1.35 - (p.z / cam.dist) * 0.62)), dim = 1;
      if (match && !match.has(n)) dim = 0.18;
      if (sel && !S.isolate && n !== sel && !selKids.has(n) && !vecinos.has(n)) dim *= 0.45;
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
      var hl = (sel && (e.a === sel || e.b === sel)) || (hov && (e.a === hov || e.b === hov));
      var al = Math.min(pa.a, pb.a) * (hl ? 0.85 : xc ? 0.42 : 0.13);
      ctx.strokeStyle = hl ? rgba(col((e.a === sel || e.a === hov) ? e.b.tipo : e.a.tipo), al) : xc ? "rgba(255,214,140," + al + ")" : "rgba(120,146,255," + al + ")";
      ctx.lineWidth = hl ? 1.6 : xc ? 1.3 : 1;
      ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy);
      ctx.quadraticCurveTo((pa.sx + pb.sx) / 2 - (pb.sy - pa.sy) * e.c, (pa.sy + pb.sy) / 2 + (pb.sx - pa.sx) * e.c, pb.sx, pb.sy); ctx.stroke();
    }
    // Intensidad: con menos, corren menos impulsos y brillan menos; en cero no corre ninguno.
    var I = S.pulsos ? S.intensidad : 0, brillo = 0.3 + 0.7 * I;
    if (I > 0 && vis.length) {
      var tope = Math.min(150, 14 + vis.length * 0.07) * I, foco = sel || hov;
      for (var s0 = 0; s0 < 3 && pulsos.length < tope; s0++) {
        if (Math.random() > 0.55 * I) continue;
        var cand = vis[Math.floor(Math.random() * vis.length)];
        // Lo que viaja entre cerebros se ve seguido, aunque sean pocas relaciones entre miles.
        if (visCruce.length && Math.random() < 0.35) cand = visCruce[Math.floor(Math.random() * visCruce.length)];
        if (foco && Math.random() < 0.6) { var fa = foco.adj[Math.floor(Math.random() * foco.adj.length)]; if (fa && pm.get(fa.n) && !S.hiddenVerbs[fa.e.verbo]) cand = fa.e; }
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
          var sal = pe.b.adj.filter(function (x) { return x.e.a === pe.b && !S.hiddenVerbs[x.e.verbo] && pm.get(x.n); });
          if (sal.length) { lanzar(sal[Math.floor(Math.random() * sal.length)].e, pu.gen + 1); if (sal.length > 1 && Math.random() < 0.25) lanzar(sal[Math.floor(Math.random() * sal.length)].e, pu.gen + 1); }
        }
        continue;
      }
      // Rastro quebrado, como una descarga, y una chispa en la punta.
      var pc = col(pe.a.tipo), pal = Math.min(1, Math.min(qa.a, qb.a) + 0.25) * brillo, nx = qb.sy - qa.sy, ny = qa.sx - qb.sx, nl = Math.sqrt(nx * nx + ny * ny) || 1;
      ctx.beginPath();
      for (var tr = 0; tr <= 6; tr++) {
        var tt = Math.max(0, pu.t - 0.16 * (1 - tr / 6)), pt = curva(qa, qb, pe.c, tt), jit = tr > 0 && tr < 6 ? (Math.random() - 0.5) * 5 : 0;
        if (tr === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0] + nx / nl * jit, pt[1] + ny / nl * jit);
      }
      ctx.strokeStyle = rgba(pc, 0.85 * pal); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255," + 0.55 * pal + ")"; ctx.lineWidth = 0.7; ctx.stroke();
      var cab = curva(qa, qb, pe.c, pu.t), cr = Math.max(6, 20 * Math.min(qa.s, qb.s));
      ctx.globalAlpha = pal; ctx.drawImage(chispa(pc), cab[0] - cr, cab[1] - cr, cr * 2, cr * 2); ctx.globalAlpha = 1;
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
        ctx.drawImage(neurona(col(nn.tipo)), p2.sx - hr, p2.sy - hr, hr * 2, hr * 2);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = p2.a;
      ctx.drawImage(soma(col(nn.tipo)), p2.sx - p2.r, p2.sy - p2.r, p2.r * 2, p2.r * 2);
      if (fi > 0.05) { ctx.globalAlpha = Math.min(1, fi * 0.7); ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(p2.sx, p2.sy, p2.r * 0.8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = p2.a; }
      var ring = null;
      if (nn === sel) ring = ["#FFFFFF", 2];
      else if (nn === hov) ring = ["#C7D4FF", 1.5];
      else if ((dragGrp && dragGrp.has(nn)) || (hovKids && hovKids.has(nn)) || (selKids && selKids.has(nn) && S.dragChildren)) ring = ["rgba(199,212,255,.55)", 1];
      if (ring) { ctx.strokeStyle = ring[0]; ctx.lineWidth = ring[1]; ctx.beginPath(); ctx.arc(p2.sx, p2.sy, p2.r + 3, 0, Math.PI * 2); ctx.stroke(); }
      if (nn.pin && p2.r > 3) { ctx.fillStyle = "#C7D4FF"; ctx.beginPath(); ctx.arc(p2.sx + p2.r * 0.75, p2.sy - p2.r * 0.75, 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    ctx.font = "500 11.5px " + color("sans"); ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    for (var l = 0; l < P.length; l++) {
      var p3 = P[l], n3 = p3.n;
      var show = n3 === sel || n3 === hov || S.labels === "todas" || (S.labels === "grandes" && p3.r > 8.5) || (match && match.has(n3));
      if (S.labels === "ninguna" && n3 !== sel && n3 !== hov) show = false;
      if (!show || p3.a < 0.3) continue;
      ctx.globalAlpha = Math.min(1, p3.a + 0.15); ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(10,12,17,.9)";
      var lx = p3.sx + p3.r + 6;
      ctx.strokeText(n3.nombre, lx, p3.sy); ctx.fillStyle = n3 === sel ? "#FFFFFF" : "#D5DAE4"; ctx.fillText(n3.nombre, lx, p3.sy); ctx.globalAlpha = 1;
    }
    if (hov && !ptr && mouse) {
      var hijos = desc(hov).length, lineas = [hov.nombre, TIPO[hov.tipo].uno + " · " + hov.uso + " usos · " + hov.deg + " conexiones"];
      if (hijos) lineas.push(hijos + " hijos se mueven con este nodo");
      ctx.font = "500 12px " + color("sans");
      var w = 0; lineas.forEach(function (t) { w = Math.max(w, ctx.measureText(t).width); });
      var bx = Math.max(8, Math.min(W - w - 30, mouse.x + 16)), byy = Math.max(8, Math.min(H - lineas.length * 18 - 24, mouse.y + 16));
      ctx.fillStyle = "rgba(18,22,32,.96)"; ctx.strokeStyle = "#2A3142"; ctx.lineWidth = 1;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, byy, w + 24, lineas.length * 18 + 14, 8); else ctx.rect(bx, byy, w + 24, lineas.length * 18 + 14); ctx.fill(); ctx.stroke();
      lineas.forEach(function (t, ix) { ctx.fillStyle = ix === 0 ? "#FFFFFF" : "#A3ABBD"; ctx.font = (ix === 0 ? "600 " : "400 ") + "12px " + color("sans"); ctx.fillText(t, bx + 12, byy + 16 + ix * 18); });
    }
  }
  var corriendo = false;
  function loop() {
    requestAnimationFrame(loop);
    if (!canvas.offsetParent) return;
    var padre = canvas.parentElement, dpr = window.devicePixelRatio || 1;
    W = padre.clientWidth; H = padre.clientHeight; F = Math.min(W, H) * 1.15;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    var ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    step(); draw(ctx);
  }

  // ---------- Interacción con el lienzo ----------
  function pos(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  canvas.addEventListener("pointerdown", function (ev) {
    var p = pos(ev), hit = pick(p.x, p.y);
    canvas.setPointerCapture(ev.pointerId);
    ptr = { x: p.x, y: p.y, moved: 0, hit: hit, group: null };
    if (hit) ptr.group = S.dragChildren && !ev.shiftKey ? [hit].concat(desc(hit)) : [hit];
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", function (ev) {
    var p = pos(ev); mouse = p;
    if (!ptr) { hover = pick(p.x, p.y); canvas.style.cursor = hover ? "pointer" : "grab"; return; }
    var dx = p.x - ptr.x, dy = p.y - ptr.y; ptr.x = p.x; ptr.y = p.y; ptr.moved += Math.abs(dx) + Math.abs(dy);
    if (ptr.hit) {
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
    if (P.hit) seleccionar(P.hit.id);
    else if (P.moved < 5) { S.selId = null; S.isolate = false; ui(); }
    else if (P.hit) ui();
  }
  canvas.addEventListener("pointerup", soltar);
  canvas.addEventListener("pointercancel", soltar);
  canvas.addEventListener("pointerleave", function () { if (!ptr) hover = null; });
  canvas.addEventListener("dblclick", function (ev) { var p = pos(ev), h = pick(p.x, p.y); if (h) focus(h); });
  canvas.addEventListener("wheel", function (ev) { ev.preventDefault(); cam.dist = Math.max(220, Math.min(6000, cam.dist * Math.exp(ev.deltaY * 0.0012))); }, { passive: false });

  // ---------- Paneles ----------
  var $ = function (id) { return document.getElementById(id); };
  var sw = function (t) { return '<span class="sw" style="background:' + col(t) + '"></span>'; };
  var on = function (b) { return b ? " on" : ""; };
  function seleccionar(id) { if (S.selId !== id) { S.todas = {}; S.tabC = null; } S.selId = id; computeIso(id); ui(); }
  function irA(id) {
    var n = by[id];
    if (!n) return;
    if (S.hiddenTypes[n.tipo] || S.hiddenIds[n.id]) { S.hiddenTypes[n.tipo] = false; delete S.hiddenIds[n.id]; actualizarActivos(); reacomodar(0.4); }
    seleccionar(id); focus(n);
  }
  var PRESETS = [["producto", "Producto", ["feat", "endpoint", "tabla"]], ["arquitectura", "Arquitectura", ["svc", "repo", "lib", "ext", "queue", "db"]],
    ["codigo", "Código", ["endpoint", "svc", "repo", "archivo"]], ["todo", "Todo", null]];
  function presetActual() {
    var r = null;
    PRESETS.forEach(function (p) { if (TIPOS_PRESENTES.every(function (t) { return !S.hiddenTypes[t[0]] === (!p[2] || p[2].indexOf(t[0]) >= 0); })) r = p[0]; });
    return r;
  }
  function seg(nombre, opciones, actual) {
    return opciones.map(function (o) { return '<button type="button" class="sb' + on(actual === o[0]) + '" aria-pressed="' + (actual === o[0]) + '" data-' + nombre + '="' + o[0] + '">' + o[1] + "</button>"; }).join("");
  }
  function fila(n, extra, marca) { return '<button type="button" class="nb" data-pick="' + esc(n.id) + '" title="' + esc(n.nombre) + '">' + sw(n.tipo) + '<span class="corta">' + esc(n.nombre) + '</span><span class="vb">' + esc(extra) + "</span>" + (marca || "") + "</button>"; }
  /** Conexiones del nodo elegido, todas: primero las de su cerebro y después un grupo por cada otro cerebro, con su color. */
  var TOPE_GRUPO = 30;
  function conexionesDe(sel) {
    var orden = function (a, b) { return b.e.ev - a.e.ev || b.n.uso - a.n.uso || (a.n.id < b.n.id ? -1 : 1); };
    var grupos = CEREBROS.length ? CEREBROS.map(function () { return []; }) : [[]];
    sel.adj.forEach(function (a) { grupos[a.n.c || 0].push(a); });
    var ids = grupos.map(function (_, i) { return i; }).filter(function (i) { return grupos[i].length; }).sort(function (a, b) { return (a === sel.c ? -1 : 0) - (b === sel.c ? -1 : 0) || a - b; });
    if (!ids.length) return '<div><h3 class="lbl">Conexiones</h3><p class="vacio">Ninguna.</p></div>';
    // Con varios cerebros, una pestaña por cerebro con conexiones: se ve de a uno.
    var tab = ids.indexOf(Number(S.tabC)) >= 0 && S.tabC !== null ? Number(S.tabC) : ids[0];
    var tabs = MULTI && ids.length > 1 ? '<div class="m3-tabs" role="tablist">' + ids.map(function (i) {
      return '<button type="button" role="tab" class="m3-tab' + on(i === tab) + '" aria-selected="' + (i === tab) + '" data-tab-c="' + i + '"' + (i === tab ? ' style="border-color:' + colorC(i) + '"' : "") + ">" + puntoC(i) + esc(CEREBROS[i].nombre) + '<span class="ct">' + grupos[i].length + "</span></button>";
    }).join("") + "</div>" : "";
    return (tabs ? '<h3 class="lbl">Conexiones<span class="ct">' + sel.adj.length + "</span></h3>" + tabs : "") + (tabs ? [tab] : ids).map(function (i) {
      var xs = grupos[i].slice().sort(orden), fuera = MULTI && i !== sel.c;
      var sale = xs.filter(function (a) { return a.e.a === sel; }).length, entra = xs.length - sale;
      var titulo = !MULTI ? "Conexiones" : fuera ? "Con " + CEREBROS[i].nombre : "En " + CEREBROS[i].nombre;
      var cuenta = (tabs ? "" : xs.length + " · ") + [sale ? sale + (fuera ? " hacia allá" : " salen") : "", entra ? entra + (fuera ? " desde allá" : " llegan") : ""].filter(Boolean).join(", ");
      var ver = S.todas[i] ? xs : xs.slice(0, TOPE_GRUPO);
      return '<div class="m3-grupo"' + (fuera ? ' style="border-left-color:' + colorC(i) + '"' : "") + '><h3 class="lbl">' + (MULTI ? puntoC(i) : "") + esc(titulo) + '<span class="ct">' + cuenta + "</span></h3>" +
        ver.map(function (a) {
          var va = a.e.a === sel, verbo = a.e.verbo.replace("_", " ");
          return fila(a.n, (va ? verbo + " →" : "← " + verbo) + (fuera && a.e.ev > 1 ? " ×" + a.e.ev : ""), fuera && !tabs ? '<span class="mc" style="color:' + colorC(i) + ";border-color:" + colorC(i) + '">' + esc(CEREBROS[i].nombre) + "</span>" : "");
        }).join("") +
        (xs.length > TOPE_GRUPO ? '<button type="button" class="btn" data-todas="' + i + '">' + (S.todas[i] ? "Ver menos" : "Ver las " + xs.length) + "</button>" : "") + "</div>";
    }).join("");
  }
  function ui() {
    var actual = presetActual();
    $("presets").innerHTML = '<span class="lbl">Vista</span>' + PRESETS.map(function (p) { return '<button type="button" class="chip' + on(actual === p[0]) + '" aria-pressed="' + (actual === p[0]) + '" data-preset="' + p[0] + '">' + p[1] + "</button>"; }).join("");
    $("m3-vis").textContent = N.filter(visible).length + " nodos";
    $("m3-cerebros").innerHTML = MULTI ? CEREBROS.map(function (c, i) {
      var v = !S.hiddenBrains[i];
      return '<button type="button" class="tg' + (v ? "" : " off") + '" aria-pressed="' + v + '" data-cerebro="' + i + '">' + puntoC(i) + esc(c.nombre) + '<span class="ct">' + c.nodos + "</span></button>";
    }).join("") : "";
    var hayTipos = TIPOS_PRESENTES.some(function (t) { return !S.hiddenTypes[t[0]]; });
    $("m3-todo").innerHTML = '<button type="button" class="chip" data-tipos="todos">Prender todo</button><button type="button" class="chip' + on(!hayTipos) + '" data-tipos="ninguno">Apagar todo</button>';
    $("m3-tipos").innerHTML = TIPOS_PRESENTES.map(function (t) {
      var v = !S.hiddenTypes[t[0]];
      return '<button type="button" class="tg' + (v ? "" : " off") + '" aria-pressed="' + v + '" data-tipo="' + t[0] + '">' + sw(t[0]) + esc(t[1]) + '<span class="ct">' + cuentas[t[0]] + "</span></button>";
    }).join("");
    var nOcultos = Object.keys(S.hiddenIds).length;
    $("m3-ocultos").innerHTML = nOcultos ? '<button type="button" class="chip" data-mostrar-ocultos="1">Mostrar ' + nOcultos + " nodos ocultos a mano</button>" : "";
    $("m3-verbos").innerHTML = VERBOS.map(function (v) { var x = !S.hiddenVerbs[v]; return '<button type="button" class="chip' + on(x) + '" aria-pressed="' + x + '" data-verbo="' + v + '">' + v.replace("_", " ") + "</button>"; }).join("");
    $("m3-tam").innerHTML = seg("tam", [["uso", "Uso en código"], ["deg", "Conexiones"], ["uni", "Igual"]], S.sizeMode);
    $("m3-grupo").innerHTML = seg("grupo", [["feat", "Funcionalidad"], ["svc", "Servicio"], ["none", "Sin grupos"]], S.group);
    $("m3-etq").innerHTML = seg("etq", [["grandes", "Grandes"], ["todas", "Todas"], ["ninguna", "Ninguna"]], S.labels);
    $("m3-escala-txt").textContent = S.scale.toFixed(1) + "×";
    var drag = $("m3-drag"), rot = $("m3-rot");
    drag.classList.toggle("on", S.dragChildren); drag.setAttribute("aria-pressed", S.dragChildren);
    rot.classList.toggle("on", S.rotating); rot.setAttribute("aria-pressed", S.rotating);
    var imp = $("m3-imp"); imp.classList.toggle("on", S.pulsos); imp.setAttribute("aria-pressed", S.pulsos);
    $("m3-int").disabled = !S.pulsos;
    detalle();
  }
  function detalle() {
    var sel = S.selId ? by[S.selId] : null, raiz = $("m3-detalle");
    if (!sel && MULTI) {
      // Un bloque por cerebro: qué tiene, con su interruptor, y lo que viaja entre ellos.
      var bloques = CEREBROS.map(function (c, i) {
        var porTipo = {};
        N.forEach(function (n) { if (n.c === i) porTipo[n.tipo] = (porTipo[n.tipo] || 0) + 1; });
        var v = !S.hiddenBrains[i];
        return '<div class="m3-cer"><h3>' + puntoC(i) + esc(c.nombre) + "</h3><p>" + c.nodos + " nodos" + (c.sinRevisar ? " · indexado sin revisión" : "") + "</p>" +
          TIPOS.filter(function (t) { return porTipo[t[0]]; }).map(function (t) { return '<div class="nb">' + sw(t[0]) + '<span class="corta">' + esc(t[1]) + '</span><span class="vb">' + porTipo[t[0]] + "</span></div>"; }).join("") +
          '<div class="m3-acciones"><button type="button" class="btn' + on(v) + '" aria-pressed="' + v + '" data-cerebro="' + i + '">' + (v ? "Apagar" : "Prender") + '</button><button type="button" class="btn" data-foco-cerebro="' + i + '">Enfocar</button></div></div>';
      }).join("");
      var viaja = (D.conexiones || []).map(function (x) {
        return '<div class="nb"><span class="corta">' + esc(x.desde) + " → " + esc(x.hacia) + '</span><span class="vb">' + (x.llamadas ? x.llamadas + " llamadas" : "sin llamadas") + (x.declarada ? "" : " · sin declarar") + "</span></div>";
      }).join("");
      raiz.innerHTML = '<div class="m3-vacio"><h2 class="lbl">Cerebros</h2><p>Cada cerebro es un grupo de repos. Las líneas doradas son llamadas de un cerebro a otro.</p>' + bloques +
        '<div class="m3-caja"><span class="lbl">Qué viaja entre cerebros</span>' + (viaja || '<p class="vacio">Nada: no hay comunicación activa o no se detectaron llamadas.</p>') + "</div></div>";
      return;
    }
    if (!sel) {
      var top = N.filter(function (n) { return n.tipo === "tabla" || n.tipo === "endpoint" || n.tipo === "feat"; }).sort(function (a, b) { return b.uso - a.uso || (a.id < b.id ? -1 : 1); }).slice(0, 6);
      raiz.innerHTML = '<div class="m3-vacio"><h2 class="lbl">Detalle</h2><p>Hacé clic en un punto para ver qué es, cuánto se usa en el código y con qué se conecta.</p>' +
        '<div class="m3-caja"><span class="lbl">Más usados</span>' + top.map(function (n) { return fila(n, n.uso + " usos"); }).join("") + "</div></div>";
      return;
    }
    var n = porId[sel.id];
    var enlaces = [];
    if (sel.tipo === "feat") enlaces.push('<a href="#/f/' + encodeURIComponent(sel.id) + '">Abrir la ficha</a>');
    enlaces.push('<a href="#/impacto/' + encodeURIComponent(sel.id) + '">¿Qué se ve afectado si cambia?</a>');
    if (n.p) enlaces.push('<a href="../' + esc(n.p) + '">Página</a>');
    raiz.innerHTML =
      '<div class="m3-cab"><div class="m3-tipo">' + sw(sel.tipo) + '<span class="lbl">' + esc(TIPO[sel.tipo].uno) + "</span>" + (sel.pin ? '<span class="m3-fijado">Fijado</span>' : "") + "</div>" +
      '<h2 class="m3-nombre">' + esc(sel.nombre) + "</h2><code>" + esc(sel.id) + "</code>" + (MULTI ? '<p class="m3-resumen">Cerebro: ' + esc(CEREBROS[sel.c].nombre) + "</p>" : "") + (n.r && !/^Borrador:/.test(n.r) ? '<p class="m3-resumen">' + esc(n.r) + "</p>" : "") + "</div>" +
      '<div class="m3-stats"><div><b>' + sel.uso + "</b><span>usos en código</span></div><div><b>" + sel.deg + "</b><span>conexiones</span></div><div><b>" + desc(sel).length + "</b><span>hijos</span></div></div>" +
      '<div class="m3-acciones"><button type="button" class="btn pri" data-acc="sep">Separar del resto</button><button type="button" class="btn" data-acc="focus">Enfocar</button>' +
      '<button type="button" class="btn' + on(S.isolate) + '" aria-pressed="' + S.isolate + '" data-acc="iso">Aislar</button><button type="button" class="btn" data-acc="hide">Ocultar</button>' +
      (sel.pin ? '<button type="button" class="btn ancho" data-acc="unpin">Volver a su lugar</button>' : "") + "</div>" +
      '<div class="m3-enlaces">' + enlaces.join("") + "</div>" +
      conexionesDe(sel) +
      '<button type="button" class="btn" data-acc="close">Cerrar detalle</button>';
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
    try { var previo = Number(localStorage.getItem("brain-m3-der")); if (previo) poner(previo); } catch (e) { /* sin almacenamiento */ }
    var mover = function (ev) { poner(window.innerWidth - ev.clientX); ev.preventDefault(); };
    var soltar = function () {
      window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); asa.classList.remove("on");
      try { localStorage.setItem("brain-m3-der", String(parseInt(app.style.getPropertyValue("--der"), 10) || 300)); } catch (e) { /* sin almacenamiento */ }
    };
    asa.addEventListener("pointerdown", function (ev) { asa.classList.add("on"); window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar); ev.preventDefault(); });
    asa.addEventListener("dblclick", function () { poner(300); soltar(); });
  })();

  document.getElementById("app").addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button, a") : null;
    if (!b || b.tagName === "A") return;
    var d = b.dataset, sel = S.selId ? by[S.selId] : null;
    if (d.pick) { irA(d.pick); if (b.closest("#m3-res")) { S.query = ""; $("m3-buscar").value = ""; resultados(); } return; }
    if (d.cerebro) { S.hiddenBrains[d.cerebro] = !S.hiddenBrains[d.cerebro]; actualizarActivos(); reacomodar(0.3); }
    else if (d.tabC) S.tabC = d.tabC;
    else if (d.todas) S.todas[d.todas] = !S.todas[d.todas];
    else if (d.focoCerebro) { var fc = Number(d.focoCerebro); cam.goal = { x: OX[fc], y: 0, z: 0, dist: Math.max(600, (BRS[fc] || 260) * 3.1) }; }
    else if (d.tipos) { TIPOS.forEach(function (t) { S.hiddenTypes[t[0]] = d.tipos === "ninguno"; }); actualizarActivos(); reacomodar(0.3); }
    else if (d.tipo) { S.hiddenTypes[d.tipo] = !S.hiddenTypes[d.tipo]; actualizarActivos(); reacomodar(0.3); }
    else if (d.verbo) { S.hiddenVerbs[d.verbo] = !S.hiddenVerbs[d.verbo]; armarResortes(); }
    else if (d.mostrarOcultos) { S.hiddenIds = {}; actualizarActivos(); }
    else if (d.tam) S.sizeMode = d.tam;
    else if (d.etq) S.labels = d.etq;
    else if (d.grupo) { S.group = d.grupo; setParents(d.grupo); actualizarActivos(); soltarTodo(); }
    else if (d.acc === "explode") separarGrupos();
    else if (d.acc === "relayout") soltarTodo();
    else if (d.acc === "recenter") recentrar();
    else if (d.acc === "drag") S.dragChildren = !S.dragChildren;
    else if (d.acc === "rot") S.rotating = !S.rotating;
    else if (d.acc === "imp") S.pulsos = !S.pulsos;
    else if (d.acc === "sep" && sel) separar(sel);
    else if (d.acc === "focus" && sel) focus(sel);
    else if (d.acc === "iso") { computeIso(); S.isolate = !S.isolate; }
    else if (d.acc === "hide" && sel) { S.hiddenIds[sel.id] = true; S.selId = null; S.isolate = false; actualizarActivos(); }
    else if (d.acc === "unpin" && sel) { [sel].concat(desc(sel)).forEach(function (n) { n.pin = false; }); reacomodar(0.6); }
    else if (d.acc === "close") { S.selId = null; S.isolate = false; }
    else return;
    ui();
  });
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
  $("m3-int").addEventListener("input", function (ev) { S.intensidad = parseFloat(ev.target.value) / 100; $("m3-int-txt").textContent = ev.target.value + "%"; });
  ui();

  function mostrarMapa() { if (!corriendo) { corriendo = true; loop(); } }
  window.brainVisor = { D: D, porId: porId, esc: esc, color: color, enfocar: function (id) { mostrarMapa(); irA(id); }, mostrarMapa: mostrarMapa };
})();
`;

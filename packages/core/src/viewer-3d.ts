/**
 * Vista "Mapa 3D" del visor (`#/grafo`): el grafo entero en 3D, dibujado en un `<canvas>` sin librerías.
 * Cada punto crece con su uso en el código; se elige qué tipos y relaciones se ven, cómo se agrupan, y al arrastrar
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

  var TIPOS = [["feat", "Funcionalidades", "Funcionalidad"], ["endpoint", "Endpoints", "Endpoint"], ["tabla", "Tablas", "Tabla"], ["svc", "Servicios", "Servicio"],
    ["repo", "Repositorios", "Repositorio"], ["lib", "Librerías", "Librería"], ["ext", "Externos", "Externo"], ["queue", "Colas", "Cola"], ["db", "Bases de datos", "Base de datos"],
    ["team", "Equipos", "Equipo"], ["decision", "Decisiones", "Decisión"], ["archivo", "Archivos", "Archivo"]];
  var TIPO = {};
  TIPOS.forEach(function (t) { TIPO[t[0]] = { label: t[1], uno: t[2] }; });
  var ORDEN_VERBOS = ["implementa", "llama_a", "lee_de", "escribe_en", "publica_en", "consume_de", "depende_de", "contiene", "vive_en", "recorrido", "pertenece_a", "decidido_por"];
  var colores = {};
  var col = function (t) { return colores[t] || (colores[t] = color(t)); };

  // ---------- Modelo ----------
  var N = [], by = {};
  D.nodes.forEach(function (n) {
    if (!TIPO[n.t]) return;
    var x = { id: n.id, tipo: n.t, nombre: n.n, uso: M.uso[n.id] || 0, deg: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pin: false, adj: [], kids: [], parent: null, puesto: false };
    N.push(x); by[n.id] = x;
  });
  var E = [];
  M.aristas.forEach(function (a) {
    var s = by[a[0]], h = by[a[1]];
    if (!s || !h || s === h) return;
    var e = { a: s, b: h, verbo: a[2], ev: a[3] };
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
    n.x = R * Math.sin(v) * Math.cos(u); n.y = R * Math.sin(v) * Math.sin(u) * 0.8; n.z = R * Math.cos(v);
  });

  var ocultosIniciales = {};
  TIPOS.forEach(function (t) { if (D.tiposIniciales.indexOf(t[0]) < 0) ocultosIniciales[t[0]] = true; });
  var S = { hiddenTypes: ocultosIniciales, hiddenVerbs: {}, sizeMode: "uso", scale: 1, group: "feat", labels: "grandes", selId: null, query: "",
    dragChildren: true, rotating: true, isolate: false, hiddenIds: {} };

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
  function base(n) { return !S.hiddenTypes[n.tipo] && !S.hiddenIds[n.id]; }
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
  }

  // ---------- Fuerzas ----------
  var alpha = 0;
  function simStep(a) {
    var A = activos, i, j, n, m, dx, dy, dz, d2, d, f;
    if (A.length <= 900) {
      for (i = 0; i < A.length; i++) {
        n = A[i];
        for (j = i + 1; j < A.length; j++) {
          m = A[j]; dx = n.x - m.x; dy = n.y - m.y; dz = n.z - m.z; d2 = dx * dx + dy * dy + dz * dz + 0.01;
          if (d2 > 640000) continue;
          f = 5200 / d2; d = Math.sqrt(d2); dx /= d; dy /= d; dz /= d;
          n.vx += dx * f; n.vy += dy * f; n.vz += dz * f; m.vx -= dx * f; m.vy -= dy * f; m.vz -= dz * f;
        }
      }
    } else {
      // Muchos nodos (archivos prendidos): repulsión solo entre vecinos de una grilla.
      var C = 150, g = new Map();
      for (i = 0; i < A.length; i++) { n = A[i]; var k = Math.floor(n.x / C) + "," + Math.floor(n.y / C) + "," + Math.floor(n.z / C); var l = g.get(k); if (l) l.push(n); else g.set(k, [n]); }
      for (i = 0; i < A.length; i++) {
        n = A[i]; var cx = Math.floor(n.x / C), cy = Math.floor(n.y / C), cz = Math.floor(n.z / C);
        for (var ax = -1; ax <= 1; ax++) for (var ay = -1; ay <= 1; ay++) for (var az = -1; az <= 1; az++) {
          var L = g.get((cx + ax) + "," + (cy + ay) + "," + (cz + az));
          if (!L) continue;
          for (j = 0; j < L.length; j++) {
            m = L[j]; if (m === n) continue;
            dx = n.x - m.x; dy = n.y - m.y; dz = n.z - m.z; d2 = dx * dx + dy * dy + dz * dz + 0.01;
            if (d2 > C * C) continue;
            f = 2600 / d2; d = Math.sqrt(d2);
            n.vx += dx / d * f; n.vy += dy / d * f; n.vz += dz / d * f;
          }
        }
      }
    }
    for (i = 0; i < A.length; i++) { n = A[i]; n.vx -= n.x * 0.004; n.vy -= n.y * 0.004; n.vz -= n.z * 0.004; }
    function resorte(p, q, Lr, k) {
      var ex = q.x - p.x, ey = q.y - p.y, ez = q.z - p.z, dd = Math.sqrt(ex * ex + ey * ey + ez * ez) + 0.01, ff = (dd - Lr) * k / dd;
      p.vx += ex * ff; p.vy += ey * ff; p.vz += ez * ff; q.vx -= ex * ff; q.vy -= ey * ff; q.vz -= ez * ff;
    }
    for (i = 0; i < E.length; i++) { var e = E[i]; if (base(e.a) && base(e.b) && !S.hiddenVerbs[e.verbo]) resorte(e.a, e.b, 170, 0.004); }
    for (i = 0; i < A.length; i++) { n = A[i]; if (n.parent && base(n.parent)) resorte(n, n.parent, n.tipo === "archivo" ? 45 : 75, 0.06); }
    for (i = 0; i < A.length; i++) {
      n = A[i];
      if (n.pin) { n.vx = n.vy = n.vz = 0; continue; }
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
  // Una esfera prerenderizada por color: dibujar miles de nodos por cuadro es copiar una imagen escalada.
  var esferas = {};
  function esfera(c) {
    if (esferas[c]) return esferas[c];
    var R = 48, cv = document.createElement("canvas"); cv.width = cv.height = R * 2;
    var x = cv.getContext("2d"), g = x.createRadialGradient(R * 0.65, R * 0.6, R * 0.1, R, R, R);
    g.addColorStop(0, mezcla(c, "#FFFFFF", 0.55)); g.addColorStop(0.45, c); g.addColorStop(1, mezcla(c, "#05070B", 0.55));
    x.fillStyle = g; x.beginPath(); x.arc(R, R, R, 0, Math.PI * 2); x.fill();
    return (esferas[c] = cv);
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
  function recentrar() { var c = centro(N.filter(visible)); cam.goal = { x: c.x, y: c.y, z: c.z, dist: Math.max(600, Math.min(4000, c.r * 4.2)) }; }
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
    ctx.lineCap = "round";
    for (var j = 0; j < E.length; j++) {
      var e = E[j];
      if (S.hiddenVerbs[e.verbo]) continue;
      var pa = pm.get(e.a), pb = pm.get(e.b);
      if (!pa || !pb) continue;
      var hl = (sel && (e.a === sel || e.b === sel)) || (hov && (e.a === hov || e.b === hov));
      var al = Math.min(pa.a, pb.a) * (hl ? 0.85 : 0.16);
      ctx.strokeStyle = hl ? rgba(col((e.a === sel || e.a === hov) ? e.b.tipo : e.a.tipo), al) : "rgba(150,162,190," + al + ")";
      ctx.lineWidth = hl ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
    }
    P.sort(function (a, b) { return b.z - a.z; });
    for (var k = 0; k < P.length; k++) {
      var p2 = P[k], nn = p2.n;
      ctx.globalAlpha = p2.a;
      ctx.drawImage(esfera(col(nn.tipo)), p2.sx - p2.r, p2.sy - p2.r, p2.r * 2, p2.r * 2);
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
  function seleccionar(id) { S.selId = id; computeIso(id); ui(); }
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
  function fila(n, extra) { return '<button type="button" class="nb" data-pick="' + esc(n.id) + '">' + sw(n.tipo) + '<span class="corta">' + esc(n.nombre) + '</span><span class="vb">' + esc(extra) + "</span></button>"; }
  function ui() {
    var actual = presetActual();
    $("presets").innerHTML = '<span class="lbl">Vista</span>' + PRESETS.map(function (p) { return '<button type="button" class="chip' + on(actual === p[0]) + '" aria-pressed="' + (actual === p[0]) + '" data-preset="' + p[0] + '">' + p[1] + "</button>"; }).join("");
    $("m3-vis").textContent = N.filter(visible).length + " nodos";
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
    detalle();
  }
  function detalle() {
    var sel = S.selId ? by[S.selId] : null, raiz = $("m3-detalle");
    if (!sel) {
      var top = N.filter(function (n) { return n.tipo === "tabla" || n.tipo === "endpoint" || n.tipo === "feat"; }).sort(function (a, b) { return b.uso - a.uso || (a.id < b.id ? -1 : 1); }).slice(0, 6);
      raiz.innerHTML = '<div class="m3-vacio"><h2 class="lbl">Detalle</h2><p>Hacé clic en un punto para ver qué es, cuánto se usa en el código y con qué se conecta.</p>' +
        '<div class="m3-caja"><span class="lbl">Más usados</span>' + top.map(function (n) { return fila(n, n.uso + " usos"); }).join("") + "</div></div>";
      return;
    }
    var n = porId[sel.id];
    var vec = sel.adj.slice().sort(function (a, b) { return b.e.ev - a.e.ev || b.n.uso - a.n.uso || (a.n.id < b.n.id ? -1 : 1); }).slice(0, 10);
    var enlaces = [];
    if (sel.tipo === "feat") enlaces.push('<a href="#/f/' + encodeURIComponent(sel.id) + '">Abrir la ficha</a>');
    enlaces.push('<a href="#/impacto/' + encodeURIComponent(sel.id) + '">¿Qué se ve afectado si cambia?</a>');
    if (n.p) enlaces.push('<a href="../' + esc(n.p) + '">Página</a>');
    raiz.innerHTML =
      '<div class="m3-cab"><div class="m3-tipo">' + sw(sel.tipo) + '<span class="lbl">' + esc(TIPO[sel.tipo].uno) + "</span>" + (sel.pin ? '<span class="m3-fijado">Fijado</span>' : "") + "</div>" +
      '<h2 class="m3-nombre">' + esc(sel.nombre) + "</h2><code>" + esc(sel.id) + "</code>" + (n.r && !/^Borrador:/.test(n.r) ? '<p class="m3-resumen">' + esc(n.r) + "</p>" : "") + "</div>" +
      '<div class="m3-stats"><div><b>' + sel.uso + "</b><span>usos en código</span></div><div><b>" + sel.deg + "</b><span>conexiones</span></div><div><b>" + desc(sel).length + "</b><span>hijos</span></div></div>" +
      '<div class="m3-acciones"><button type="button" class="btn pri" data-acc="sep">Separar del resto</button><button type="button" class="btn" data-acc="focus">Enfocar</button>' +
      '<button type="button" class="btn' + on(S.isolate) + '" aria-pressed="' + S.isolate + '" data-acc="iso">Aislar</button><button type="button" class="btn" data-acc="hide">Ocultar</button>' +
      (sel.pin ? '<button type="button" class="btn ancho" data-acc="unpin">Volver a su lugar</button>' : "") + "</div>" +
      '<div class="m3-enlaces">' + enlaces.join("") + "</div>" +
      '<div><h3 class="lbl">Conexiones</h3>' + (vec.map(function (a) { return fila(a.n, (a.e.a === sel ? "" : "← ") + a.e.verbo.replace("_", " ")); }).join("") || '<p class="vacio">Ninguna.</p>') + "</div>" +
      '<button type="button" class="btn" data-acc="close">Cerrar detalle</button>';
  }
  function resultados() {
    var q = S.query.trim().toLowerCase(), r = $("m3-res");
    if (!q) { r.innerHTML = ""; r.classList.add("oculto"); return; }
    var xs = N.filter(function (n) { return n.nombre.toLowerCase().indexOf(q) >= 0 || n.id.toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return b.uso - a.uso || (a.id < b.id ? -1 : 1); }).slice(0, 6);
    r.innerHTML = xs.map(function (n) { return fila(n, TIPO[n.tipo].uno); }).join("");
    r.classList.toggle("oculto", !xs.length);
  }

  document.getElementById("app").addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button, a") : null;
    if (!b || b.tagName === "A") return;
    var d = b.dataset, sel = S.selId ? by[S.selId] : null;
    if (d.pick) { irA(d.pick); if (b.closest("#m3-res")) { S.query = ""; $("m3-buscar").value = ""; resultados(); } return; }
    if (d.tipo) { S.hiddenTypes[d.tipo] = !S.hiddenTypes[d.tipo]; actualizarActivos(); reacomodar(0.3); }
    else if (d.verbo) S.hiddenVerbs[d.verbo] = !S.hiddenVerbs[d.verbo];
    else if (d.mostrarOcultos) { S.hiddenIds = {}; actualizarActivos(); }
    else if (d.tam) S.sizeMode = d.tam;
    else if (d.etq) S.labels = d.etq;
    else if (d.grupo) { S.group = d.grupo; setParents(d.grupo); actualizarActivos(); soltarTodo(); }
    else if (d.acc === "explode") separarGrupos();
    else if (d.acc === "relayout") soltarTodo();
    else if (d.acc === "recenter") recentrar();
    else if (d.acc === "drag") S.dragChildren = !S.dragChildren;
    else if (d.acc === "rot") S.rotating = !S.rotating;
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
  ui();

  function mostrarMapa() { if (!corriendo) { corriendo = true; loop(); } }
  window.brainVisor = { D: D, porId: porId, esc: esc, color: color, enfocar: function (id) { mostrarMapa(); irA(id); }, mostrarMapa: mostrarMapa };
})();
`;

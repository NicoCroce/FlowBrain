/**
 * Las vistas de la trazabilidad completa del Mapa 3D (dec. 238), que van DENTRO de la función del mapa
 * (`GRAFO3D_JS`): comparten su alcance (D, porId, by, TZ, RED, CEREBROS, colorC, L, esc…).
 *
 * - «Diagrama (2D)»: la cadena como diagrama de flujo de izquierda a derecha, en SVG y sin librerías. Cada cerebro es
 *   una caja con borde neón de su color (el mismo del mapa 3D); adentro, una columna por capa (Funcionalidad →
 *   Pantalla → Hook / Componente → Archivo | Endpoint → Método → Tabla | Cola). Las cajas siguen el sentido de los
 *   saltos; dentro de cada columna, el orden baja los cruces (baricentro). Los saltos entre cerebros van en dorado con
 *   su rótulo («→ nestjs-api · HTTP»); las aristas internas, grises con trazos que corren. Arrastrar desplaza, la rueda
 *   acerca, y −, + y «Ajustar» hacen lo mismo con botones.
 * - La ficha del nodo: lo que el grafo sabe de una pieza de la cadena, por tipo, con «Ver código», «Trazar desde acá»
 *   y «Pedir al agente». Muestra SOLO lo que el grafo tiene; lo que falta se dice que falta.
 *
 * JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const TRAZA_VISTAS_JS = String.raw`
  // ---------- Diagrama (2D) ----------
  var DG = null;
  var DG_NW = 206, DG_NH = 46, DG_GY = 12, DG_GX = 58, DG_PAD = 26, DG_TIT = 46, DG_GB = 150, DG_FILAS = 14;
  /** Los cerebros de la cadena en el sentido de los saltos: primero el que más llama a otros y menos recibe. */
  function cerebrosEnOrden(r) {
    var cs = [], balance = {}, idx = {};
    r.nodos.forEach(function (x) { idx[x.id] = x; if (cs.indexOf(x.c) < 0) cs.push(x.c); });
    r.aristas.forEach(function (a) { if (!a.cruza) return; var ca = idx[a.desde], cb = idx[a.hasta]; if (!ca || !cb) return; balance[ca.c] = (balance[ca.c] || 0) - 1; balance[cb.c] = (balance[cb.c] || 0) + 1; });
    return cs.sort(function (a, b) { return (balance[a] || 0) - (balance[b] || 0) || a - b; });
  }
  var nombreCerebro = function (c) { return CEREBROS[c] ? CEREBROS[c].nombre : ""; };
  /** Qué es cada pieza, para el rótulo de su caja: un paso del front es un hook o función; uno del back, un método. */
  function tipoTxt(x) {
    if (x.tipo === "metodo") return x.capa === 2 ? L("Hook / function", "Hook / función") : L("Method", "Método");
    return TIPO[x.tipo] ? TIPO[x.tipo].uno : x.tipo;
  }
  var nombreCorto = function (x) { return x.tipo === "archivo" || x.tipo === "test" ? x.nombre.slice(x.nombre.lastIndexOf("/") + 1) : x.nombre; };
  /** Qué viaja en un salto entre cerebros: por una cola, un evento o HTTP. */
  function clasePorSalto(a, idx) {
    var p = idx[a.desde], q = idx[a.hasta];
    if ((p && p.tipo === "queue") || (q && q.tipo === "queue") || a.verbo === "publica_en" || a.verbo === "consume_de") return L("queue", "cola");
    if (/evento|emite|event/.test(a.verbo || "")) return L("event", "evento");
    return "HTTP";
  }
  function el(tag, at, padre) {
    // El espacio de nombres de SVG sale del <svg> que el HTML ya armó (así la página no nombra ninguna URL).
    var e = document.createElementNS(DG.svg.namespaceURI, tag);
    Object.keys(at || {}).forEach(function (k) { e.setAttribute(k, at[k]); });
    if (padre) padre.appendChild(e);
    return e;
  }
  /** Ubica cada pieza: una caja por cerebro, una columna por capa, el orden de cada columna por baricentro. */
  function acomodarDiagrama(r) {
    var idx = {}, vec = {};
    r.nodos.forEach(function (x, i) { idx[x.id] = x; x._i = i; vec[x.id] = []; });
    r.aristas.forEach(function (a) { if (vec[a.desde] && vec[a.hasta]) { vec[a.desde].push(a.hasta); vec[a.hasta].push(a.desde); } });
    var orden = cerebrosEnOrden(r), cols = [], cajas = [];
    orden.forEach(function (c) {
      var porCapa = {};
      r.nodos.forEach(function (x) { if (x.c === c) (porCapa[x.capa] = porCapa[x.capa] || []).push(x); });
      var ks = Object.keys(porCapa).map(Number).sort(function (a, b) { return a - b; });
      var caja = { c: c, cols: [] };
      ks.forEach(function (k) {
        var l = porCapa[k].sort(function (p, q) { var lp = p.lado === "arriba" ? 0 : p.lado === "origen" ? 1 : 2, lq = q.lado === "arriba" ? 0 : q.lado === "origen" ? 1 : 2; return lp - lq || p.dist - q.dist || p._i - q._i; });
        var col = { capa: k, nodos: l, caja: caja };
        caja.cols.push(col); cols.push(col);
      });
      cajas.push(caja);
    });
    // Baricentro: cada columna se ordena por la fila media de sus vecinos ya ubicados (ida, vuelta e ida).
    var fila = {};
    var numerar = function () { cols.forEach(function (col) { col.nodos.forEach(function (x, i) { fila[x.id] = i - (col.nodos.length - 1) / 2; }); }); };
    numerar();
    var barrer = function (lista) {
      lista.forEach(function (col) {
        var peso = {};
        col.nodos.forEach(function (x) {
          var vs = vec[x.id].filter(function (v) { return fila[v] !== undefined && idx[v].capa !== x.capa; });
          peso[x.id] = vs.length ? vs.reduce(function (s, v) { return s + fila[v]; }, 0) / vs.length : fila[x.id];
        });
        col.nodos.sort(function (p, q) { return peso[p.id] - peso[q.id] || p._i - q._i; });
        col.nodos.forEach(function (x, i) { fila[x.id] = i - (col.nodos.length - 1) / 2; });
      });
    };
    barrer(cols); barrer(cols.slice().reverse()); barrer(cols);
    // Medidas: una columna larga se parte en sub-columnas de DG_FILAS.
    var pos = {}, x0 = 0, altoMax = 0;
    cajas.forEach(function (caja) {
      var x = x0 + DG_PAD, alto = 0;
      caja.cols.forEach(function (col) {
        col.sub = Math.ceil(col.nodos.length / DG_FILAS);
        col.filas = Math.min(DG_FILAS, col.nodos.length);
        col.x = x; col.ancho = col.sub * DG_NW + (col.sub - 1) * 16;
        x += col.ancho + DG_GX;
        alto = Math.max(alto, col.filas * (DG_NH + DG_GY) - DG_GY);
      });
      caja.x = x0; caja.ancho = x - DG_GX + DG_PAD - x0; caja.altoCuerpo = alto;
      caja.alto = alto + DG_TIT + DG_PAD + 22;
      altoMax = Math.max(altoMax, caja.alto);
      x0 += caja.ancho + DG_GB;
    });
    cajas.forEach(function (caja) {
      caja.y = (altoMax - caja.alto) / 2;
      caja.cols.forEach(function (col) {
        var h = col.filas * (DG_NH + DG_GY) - DG_GY, y0 = caja.y + DG_TIT + 22 + (caja.altoCuerpo - h) / 2;
        col.y = caja.y + DG_TIT + 6;
        col.nodos.forEach(function (x, i) { pos[x.id] = { x: col.x + Math.floor(i / DG_FILAS) * (DG_NW + 16), y: y0 + (i % DG_FILAS) * (DG_NH + DG_GY), w: DG_NW, h: DG_NH, n: x }; });
      });
    });
    return { idx: idx, pos: pos, cajas: cajas, ancho: Math.max(1, x0 - DG_GB), alto: altoMax };
  }
  function hostDiagrama() {
    if (DG && DG.host) return DG.host;
    var padre = canvas.parentElement, host = document.createElement("div");
    host.id = "tz-dg"; host.hidden = true;
    host.innerHTML = '<svg class="tz-svg" role="img"></svg><div class="tz-dg-barra"><button type="button" class="ov" data-dg="menos" aria-label="−">−</button><button type="button" class="ov" data-dg="mas" aria-label="+">+</button><button type="button" class="ov" data-dg="ajustar"></button></div><div class="tz-dg-guia"></div>';
    padre.appendChild(host);
    DG = { host: host, svg: host.querySelector("svg"), k: 1, x: 0, y: 0, mapa: null };
    var svg = DG.svg, arr = null;
    // La pieza se toma al apretar: con el puntero capturado, al soltar el destino es el <svg>.
    svg.addEventListener("pointerdown", function (ev) { var g = ev.target.closest ? ev.target.closest("[data-id]") : null; arr = { x: ev.clientX, y: ev.clientY, ox: DG.x, oy: DG.y, movio: false, id: g ? g.getAttribute("data-id") : null }; svg.setPointerCapture(ev.pointerId); });
    svg.addEventListener("pointermove", function (ev) {
      if (!arr) return;
      var dx = ev.clientX - arr.x, dy = ev.clientY - arr.y;
      if (!arr.movio && Math.abs(dx) + Math.abs(dy) < 4) return;
      arr.movio = true; host.classList.add("arrastra");
      DG.x = arr.ox + dx; DG.y = arr.oy + dy; transformar();
    });
    svg.addEventListener("pointerup", function (ev) {
      var a = arr; arr = null; host.classList.remove("arrastra");
      if (!a || a.movio || !a.id) return;
      elegirEnTraza(a.id);
    });
    svg.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var r = svg.getBoundingClientRect();
      zoomEn(DG.k * Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });
    host.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-dg]") : null;
      if (!b) return;
      var r = svg.getBoundingClientRect();
      if (b.dataset.dg === "mas") zoomEn(DG.k * 1.25, r.width / 2, r.height / 2);
      else if (b.dataset.dg === "menos") zoomEn(DG.k / 1.25, r.width / 2, r.height / 2);
      else ajustarDiagrama();
    });
    return host;
  }
  function transformar() { if (DG && DG.raiz) DG.raiz.setAttribute("transform", "translate(" + DG.x.toFixed(1) + "," + DG.y.toFixed(1) + ") scale(" + DG.k.toFixed(4) + ")"); }
  function zoomEn(k, px, py) {
    k = Math.max(0.12, Math.min(2.6, k));
    DG.x = px - (px - DG.x) * k / DG.k; DG.y = py - (py - DG.y) * k / DG.k; DG.k = k;
    transformar();
  }
  function medidaSvg() { var r = DG.svg.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 600 }; }
  function ajustarDiagrama() {
    if (!DG || !DG.mapa) return;
    var m = medidaSvg(), M = DG.mapa, k = Math.min(1.2, Math.min((m.w - 80) / M.ancho, (m.h - 120) / M.alto));
    DG.k = Math.max(0.12, k); DG.x = (m.w - M.ancho * DG.k) / 2; DG.y = (m.h - M.alto * DG.k) / 2 + 18;
    transformar();
  }
  /** Centra una pieza; si todo el diagrama entra a un tamaño legible, lo muestra entero. */
  function centrarEn(id, siEntraTodo) {
    if (!DG || !DG.mapa) return;
    var m = medidaSvg(), M = DG.mapa, p = M.pos[id], kTodo = Math.min((m.w - 80) / M.ancho, (m.h - 120) / M.alto);
    if (siEntraTodo && kTodo >= 0.62) { ajustarDiagrama(); return; }
    if (!p) { ajustarDiagrama(); return; }
    if (siEntraTodo) DG.k = Math.max(0.5, Math.min(1, kTodo));
    DG.x = m.w / 2 - (p.x + p.w / 2) * DG.k; DG.y = m.h / 2 - (p.y + p.h / 2) * DG.k;
    transformar();
  }
  function curvaDg(a, b) {
    var sx = a.x + a.w, sy = a.y + a.h / 2, tx = b.x, ty = b.y + b.h / 2;
    if (Math.abs(a.x - b.x) < 4) { sx = a.x + a.w; tx = b.x + b.w; var o = 46 + Math.min(80, Math.abs(ty - sy) * 0.2); return { d: "M" + sx + "," + sy + " C" + (sx + o) + "," + sy + " " + (tx + o) + "," + ty + " " + tx + "," + ty, mx: sx + o * 0.75, my: (sy + ty) / 2 }; }
    if (tx < sx) { sx = a.x; tx = b.x + b.w; }
    var dx = Math.max(50, Math.abs(tx - sx) / 2), s = tx >= sx ? 1 : -1;
    return { d: "M" + sx + "," + sy + " C" + (sx + s * dx) + "," + sy + " " + (tx - s * dx) + "," + ty + " " + tx + "," + ty, mx: (sx + tx) / 2, my: (sy + ty) / 2 };
  }
  function cortar(t, n) { return t.length > n ? t.slice(0, n - 1) + "…" : t; }
  /** Dibuja el diagrama de la trazabilidad puesta (de cero: se llama al entrar y al cambiar de origen). */
  function armarDiagrama() {
    hostDiagrama();
    var svg = DG.svg, r = TZ.r, M = acomodarDiagrama(r);
    DG.mapa = M;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var defs = el("defs", {}, svg);
    var f = el("filter", { id: "tz-neon", x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs); el("feGaussianBlur", { stdDeviation: "6" }, f);
    var f2 = el("filter", { id: "tz-brillo", x: "-30%", y: "-60%", width: "160%", height: "220%" }, defs); el("feGaussianBlur", { stdDeviation: "3" }, f2);
    [["tz-fl", "#7D8699"], ["tz-fl-oro", "#F5B94A"], ["tz-fl-luz", "#C7D4FF"]].forEach(function (m) {
      var mk = el("marker", { id: m[0], viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, defs);
      el("path", { d: "M0,0 L10,5 L0,10 z", fill: m[1] }, mk);
    });
    var raiz = el("g", {}, svg); DG.raiz = raiz;
    // Cajas de los cerebros: borde y título neón del color del cerebro.
    M.cajas.forEach(function (caja) {
      var cc = MULTI ? colorC(caja.c) : colorC(0);
      el("rect", { x: caja.x, y: caja.y, width: caja.ancho, height: caja.alto, rx: 18, fill: "none", stroke: cc, "stroke-width": 4, opacity: 0.85, filter: "url(#tz-neon)" }, raiz);
      el("rect", { x: caja.x, y: caja.y, width: caja.ancho, height: caja.alto, rx: 18, fill: cc, "fill-opacity": 0.04, stroke: cc, "stroke-width": 1.6 }, raiz);
      var tt = nombreCerebro(caja.c) || L("This brain", "Este cerebro");
      var t1 = el("text", { x: caja.x + DG_PAD, y: caja.y + 30, fill: cc, "class": "tz-dg-cer", filter: "url(#tz-brillo)" }, raiz); t1.textContent = tt;
      var t2 = el("text", { x: caja.x + DG_PAD, y: caja.y + 30, fill: cc, "class": "tz-dg-cer" }, raiz); t2.textContent = tt;
      caja.cols.forEach(function (col) {
        var h = el("text", { x: col.x, y: col.y + 12, "class": "tz-dg-capa" }, raiz);
        h.textContent = L(CAPAS_TZ[col.capa][0], CAPAS_TZ[col.capa][1]).toUpperCase() + "  " + col.nodos.length;
      });
    });
    // Aristas: las internas grises con trazos que corren; los saltos entre cerebros, dorados con brillo y rótulo.
    var capaA = el("g", {}, raiz), capaS = el("g", {}, raiz), rotulos = el("g", {}, raiz), ya = {}, puestos = [];
    DG.aristas = [];
    r.aristas.forEach(function (a) {
      var p = M.pos[a.desde], q = M.pos[a.hasta];
      if (!p || !q) return;
      var cv = curvaDg(p, q), k = a.desde + "\u0000" + a.hasta;
      if (ya[k]) return; ya[k] = true;
      if (a.cruza) {
        el("path", { d: cv.d, fill: "none", stroke: "#F5B94A", "stroke-width": 5, opacity: 0.45, filter: "url(#tz-brillo)" }, capaS);
        var pa = el("path", { d: cv.d, fill: "none", stroke: "#F5B94A", "stroke-width": 2, "marker-end": "url(#tz-fl-oro)", "class": "tz-dg-salto" }, capaS);
        var txt = "→ " + nombreCerebro(q.n.c) + " · " + clasePorSalto(a, M.idx), w = txt.length * 6.3 + 18;
        // Rótulos que se pisarían bajan hasta tener lugar.
        var choca = function () { return puestos.some(function (q) { return Math.abs(q.x - cv.mx) < (q.w + w) / 2 + 4 && Math.abs(q.y - cv.my) < 24; }); };
        for (var vueltas = 0; vueltas < 12 && choca(); vueltas++) cv.my += 26;
        puestos.push({ x: cv.mx, y: cv.my, w: w });
        var gr = el("g", { "class": "tz-dg-rot" }, rotulos);
        el("rect", { x: cv.mx - w / 2, y: cv.my - 11, width: w, height: 22, rx: 11, fill: "rgba(18,22,32,.95)", stroke: "#F5B94A", "stroke-width": 1.2 }, gr);
        var tr = el("text", { x: cv.mx, y: cv.my + 4, "text-anchor": "middle" }, gr); tr.textContent = txt;
        DG.aristas.push({ a: a, el: pa });
      } else {
        var pi = el("path", { d: cv.d, fill: "none", stroke: "#7D8699", "stroke-width": 1.2, opacity: 0.75, "marker-end": "url(#tz-fl)", "class": "tz-dg-flujo" }, capaA);
        var ti = el("title", {}, pi); ti.textContent = a.verbo + (a.ev ? " · " + a.ev : "");
        DG.aristas.push({ a: a, el: pi });
      }
    });
    // Piezas: fondo oscuro, borde y tipo del color del cerebro, nombre claro; el origen con borde grueso y brillo.
    var capaN = el("g", {}, raiz);
    DG.cajasN = {};
    Object.keys(M.pos).forEach(function (id) {
      var p = M.pos[id], x = p.n, cc = MULTI ? colorC(x.c) : colorC(0), origen = x.lado === "origen";
      var g = el("g", { "class": "tz-dg-n" + (origen ? " origen" : ""), "data-id": id, transform: "translate(" + p.x + "," + p.y + ")" }, capaN);
      var tt = el("title", {}, g); tt.textContent = x.nombre + (x.ev ? "\n" + x.ev : "");
      if (origen) el("rect", { x: -2, y: -2, width: p.w + 4, height: p.h + 4, rx: 11, fill: "none", stroke: cc, "stroke-width": 4, opacity: 0.8, filter: "url(#tz-neon)" }, g);
      el("rect", { width: p.w, height: p.h, rx: 9, fill: "#121621", stroke: cc, "stroke-width": origen ? 2.6 : 1.1, "class": "tz-dg-caja" }, g);
      var t1 = el("text", { x: 11, y: 17, fill: cc, "class": "tz-dg-tipo" }, g); t1.textContent = cortar(tipoTxt(x).toUpperCase(), 30);
      var t2 = el("text", { x: 11, y: 35, "class": "tz-dg-nom" }, g); t2.textContent = cortar(nombreCorto(x), 29);
      DG.cajasN[id] = g;
    });
    var guia = DG.host.querySelector(".tz-dg-guia");
    guia.innerHTML = '<span><i class="tz-l-int"></i>' + L("call inside a brain", "llamada dentro de un cerebro") + '</span><span><i class="tz-l-oro"></i>' + L("jump between brains", "salto entre cerebros") + "</span><span>" + L("Drag to move · scroll to zoom · click a piece for its card", "Arrastrá para mover · rueda para acercar · clic en una pieza para su ficha") + "</span>";
    DG.host.querySelector('[data-dg="ajustar"]').textContent = L("Fit", "Ajustar");
    marcarDiagrama();
  }
  /** Marca en el diagrama la pieza de la ficha y sus aristas. */
  function marcarDiagrama() {
    if (!DG || !DG.cajasN || !TZ) return;
    Object.keys(DG.cajasN).forEach(function (id) { DG.cajasN[id].classList.toggle("elegida", id === TZ.ficha); });
    (DG.aristas || []).forEach(function (x) { x.el.classList.toggle("foco", !!TZ.ficha && (x.a.desde === TZ.ficha || x.a.hasta === TZ.ficha)); });
  }
  function verDiagrama(on) {
    var host = hostDiagrama();
    host.hidden = !on;
    if (on) { armarDiagrama(); requestAnimationFrame(function () { centrarEn(TZ.id, true); }); }
  }
  /** Una pieza elegida (en el diagrama, el mapa o la lista): su ficha en el panel. */
  function elegirEnTraza(id) {
    if (!TZ) return;
    TZ.ficha = id; TZ.codigo = null;
    var n3 = en3(id);
    if (n3) TZ.hov = n3;
    marcarDiagrama();
    ui();
    var d = $("m3-detalle");
    if (d && d.scrollTo) d.scrollTo(0, 0);
  }

  // ---------- Ficha del nodo ----------
  var IX = null;
  /** Índices de la página para la ficha, armados una vez. */
  function indices() {
    if (IX) return IX;
    IX = { fid: {}, sinAs: {}, pant: {}, llegan: {}, feat: {}, paso: {}, sims: {}, llamanA: {}, llamaDe: {}, simsArch: {}, svcInfra: {} };
    ((D.fidelidad && D.fidelidad.archivos) || []).forEach(function (x) { IX.fid[x.a] = x; });
    (D.sinAsociar || []).forEach(function (x) { IX.sinAs[x.a] = x; });
    (D.pantallas || []).forEach(function (p) {
      IX.pant[p.id] = p;
      (p.sale || []).forEach(function (s) { (IX.llegan[s.a] = IX.llegan[s.a] || []).push({ desde: p.id, ruta: p.ruta, tipo: s.tipo, ev: s.evidencia }); });
    });
    (D.funcionalidades || []).forEach(function (f) { IX.feat[f.id] = f; });
    // Cada paso de un recorrido, con lo que toca y lo que llama debajo: la misma regla de ids que redDeFlujo.
    var pref = function (id) { if (!MULTI) return ""; var i = id.indexOf("/"); return i > 0 ? id.slice(0, i + 1) : ""; };
    var recorrer = function (duenio, pasos) {
      (pasos || []).forEach(function (p, i) {
        var mid = "m:" + pref(duenio) + p.evidencia.split("#")[0] + "#" + p.simbolo;
        if (IX.paso[mid]) return;
        var debajo = [];
        for (var j = i + 1; j < pasos.length && pasos[j].nivel > p.nivel; j++) debajo.push(pasos[j]);
        IX.paso[mid] = { p: p, duenio: duenio, debajo: debajo };
      });
    };
    (D.funcionalidades || []).forEach(function (f) {
      (f.recorridos || []).forEach(function (r) { recorrer(r.endpoint, r.pasos); });
      (f.pantallas || []).forEach(function (p) { if (p.recorrido) recorrer(p.id, p.recorrido.pasos); });
    });
    var cz = D.cruzado || {};
    Object.keys(cz.pantallas || {}).forEach(function (id) { recorrer(id, cz.pantallas[id].pasos); });
    Object.keys(cz.backs || {}).forEach(function (id) { recorrer(id, cz.backs[id].pasos); });
    // Índice de código: símbolos de cada archivo y quién llama a quién.
    if (D.codigo) {
      var S0 = [];
      D.codigo.archivos.forEach(function (a) { IX.simsArch[a[0]] = []; a[1].forEach(function (s) { var y = { n: s[0], t: s[1], l: s[2], a: a[0], i: S0.length }; S0.push(y); IX.simsArch[a[0]].push(y); }); });
      IX.sims = S0;
      D.codigo.llaman.concat(D.codigo.usan).forEach(function (r) { (IX.llamanA[r[0]] = IX.llamanA[r[0]] || []).push({ o: r[1], l: r[2] }); (IX.llamaDe[r[1]] = IX.llamaDe[r[1]] || []).push({ o: r[0], l: r[2] }); });
    }
    return IX;
  }
  var prefC = function (c) { return MULTI && CEREBROS[c] ? CEREBROS[c].nombre + "/" : ""; };
  // Piezas que no viven en un archivo propio: su fidelidad no se mide por archivo.
  var SIN_ARCHIVO = { tabla: 1, queue: 1, feat: 1, svc: 1, ext: 1, db: 1 };
  /** El archivo (id del grafo) donde vive una pieza, si se sabe. */
  function archivoDePieza(x) {
    if (x.tipo === "archivo" || x.tipo === "test") return x.id;
    if (SIN_ARCHIVO[x.tipo]) return null;
    if (x.tipo === "metodo") { var m = RED.metodo[x.id]; if (m && m.archivo) return m.archivo; }
    var n = porId[x.id], ev = x.ev || (n && n.at && (n.at.evidencia || n.at.archivo)) || "";
    if (n && n.t === "componente" && n.at && n.at.archivo) ev = n.at.archivo;
    if (x.tipo === "pantalla" && IX.pant[x.id] && IX.pant[x.id].componentes && IX.pant[x.id].componentes[0]) ev = IX.pant[x.id].componentes[0];
    if (!ev) return null;
    var a = String(ev).split("#")[0];
    if (a.indexOf(prefC(x.c)) !== 0 || !prefC(x.c)) a = prefC(x.c) + a;
    return porId[a] || IX.fid[a] || IX.simsArch[a] ? a : null;
  }
  function evDePieza(x) {
    var n = porId[x.id];
    if (x.tipo === "pantalla" && IX.pant[x.id] && IX.pant[x.id].evidencia) return IX.pant[x.id].evidencia;
    if (x.tipo === "archivo" || x.tipo === "test") return x.id.slice(prefC(x.c).length);
    if (x.tipo === "feat") return n && n.p ? n.p : null;
    if (x.ev) return x.ev;
    if (n && n.at && n.at.evidencia) return n.at.evidencia;
    var e = null;
    TZ.r.aristas.forEach(function (a) { if (!e && a.ev && (a.hasta === x.id || a.desde === x.id)) e = a.ev; });
    return e;
  }
  var fx = function (et, html) { return '<div class="tz-fx"><span class="tz-fx-et">' + esc(et) + '</span><div class="tz-fx-v">' + html + "</div></div>"; };
  var falta = function (txt) { return '<span class="tz-falta">' + esc(txt) + "</span>"; };
  var codigo = function (t) { return "<code>" + esc(t) + "</code>"; };
  var chipN = function (id, txt) { return '<button type="button" class="chip tz-ir" data-tz-ir="' + esc(id) + '">' + esc(txt) + "</button>"; };
  var nombreDeId = function (id) { var x = TZ.idx[id]; if (x) return nombreCorto(x); var n = porId[id]; return n ? n.n : RED.nombre[id] || id; };
  /** Lista corta de ids como chips (los que están en la cadena se pueden elegir). */
  function listaIds(ids, tope) {
    tope = tope || 12;
    // Dos piezas con el mismo nombre (una funcionalidad en dos cerebros) llevan el cerebro al lado.
    var nombres = ids.slice(0, tope).map(nombreDeId);
    var xs = ids.slice(0, tope).map(function (id, i) {
      var c = TZ.idx[id] ? TZ.idx[id].c : porId[id] ? porId[id].c : null, t = nombres[i] + (MULTI && c !== null && c !== undefined && nombres.indexOf(nombres[i]) !== nombres.lastIndexOf(nombres[i]) ? " · " + nombreCerebro(c) : "");
      return TZ.idx[id] ? chipN(id, t) : '<span class="chip">' + esc(t) + "</span>";
    }).join("");
    return xs + (ids.length > tope ? ' <span class="tz-mas">' + L("and " + num(ids.length - tope) + " more", "y " + (ids.length - tope) + " más") + "</span>" : "");
  }
  /** Funcionalidades a las que pertenece: las del archivo (Fidelidad) o las que la implementan o usan (dependencias). */
  function featsDe(x, arch) {
    var fs = [];
    if (x.tipo === "feat") return [x.id];
    if (arch && IX.fid[arch]) fs = IX.fid[arch].f.slice();
    (D.dependencias || []).forEach(function (d) { if (d[1] === x.id && porId[d[0]] && porId[d[0]].t === "feat" && fs.indexOf(d[0]) < 0) fs.push(d[0]); });
    return fs;
  }
  function verificadoTxt(x) {
    var n = porId[x.id];
    if (x.tipo === "metodo") return L("Verified: read from the code by the parser (walk of its endpoint or screen).", "Verificado: lo leyó el parser del código (recorrido de su endpoint o pantalla).");
    if (!n) return L("Verified: found by the parser in a walk (the table has no page in the brain).", "Verificado: lo encontró el parser en un recorrido (la tabla no tiene página en el brain).");
    var inf = TZ.r.aristas.filter(function (a) { return a.hasta === x.id || a.desde === x.id; }).length;
    var base = n.o === "curado" ? L("Verified: curated page in the brain", "Verificado: página curada en el brain") : n.o === "parser" ? L("Verified: read from the code by the parser", "Verificado: lo leyó el parser del código") : L("Inferred (", "Inferido (") + esc(n.o || "?") + ")";
    var infer = (D.edges || []).filter(function (e) { return (e.s === x.id || e.h === x.id) && e.o === "inferido"; }).length;
    return base + (infer ? L(" · " + infer + " of its relations are inferred", " · " + infer + " de sus relaciones son inferidas") : "") + (inf ? "" : "") + ".";
  }
  function fidelidadHtml(arch, x) {
    if (x.tipo === "feat") {
      var fs = ((D.fidelidad && D.fidelidad.archivos) || []).filter(function (y) { return y.f.indexOf(x.id) >= 0; });
      if (!fs.length) return falta(L("None of its files has a fidelity measurement.", "Ninguno de sus archivos tiene medición de fidelidad."));
      var prom = Math.floor(fs.reduce(function (s0, y) { return s0 + y.p; }, 0) / fs.length), con = fs.filter(function (y) { return y.t.length; }).length;
      return L("average ", "promedio ") + "<b>" + prom + "/100</b> " + L("in " + fs.length + pl(fs.length, " file", " files") + " · " + con + " with gaps", "en " + fs.length + (fs.length === 1 ? " archivo" : " archivos") + " · " + con + " con faltas");
    }
    if (SIN_ARCHIVO[x.tipo]) return falta(L("Fidelity is measured per file, and this piece has no file of its own.", "La fidelidad se mide por archivo, y esta pieza no tiene uno propio."));
    var f = arch && IX.fid[arch];
    if (!f) return falta(arch ? L("This file has no fidelity measurement.", "Este archivo no tiene medición de fidelidad.") : L("Its file isn't known, so there is no fidelity measurement.", "No se sabe su archivo: no hay medición de fidelidad."));
    var tono = f.p >= 90 ? "var(--ok, #5EDBB0)" : f.p >= 60 ? "var(--atencion, #F5B94A)" : "#F2906B";
    return '<span class="chip" style="color:' + tono + ";border-color:" + tono + '">' + f.p + "/100</span>" +
      (f.t.length ? '<ul class="tz-ul">' + f.t.map(function (t) { return "<li>" + esc(t[2]) + (t[4] && t[4].length ? " <small>L" + t[4].slice(0, 6).join(", L") + "</small>" : "") + "</li>"; }).join("") + "</ul>" : ' <span class="tz-ok">' + L("nothing missing", "no le falta nada") + "</span>");
  }
  /** Lo que cambiaría: funcionalidades alcanzadas por impacto() sobre las dependencias del grafo. */
  function afectadasHtml(x) {
    var deps = D.dependencias || [], tiene = function (id) { return deps.some(function (d) { return d[0] === id || d[1] === id; }); };
    if (typeof impacto !== "function") return falta(L("Impact isn't available on this page.", "El impacto no está disponible en esta página."));
    // Un paso o un archivo no están en las dependencias: cuenta lo que alcanza su endpoint o pantalla dueños.
    var ids = [x.id], por = [];
    if (!tiene(x.id)) {
      var ms = x.tipo === "metodo" ? [x.id] : RED.porArchivo[x.id] || [];
      ids = [];
      ms.forEach(function (m) { var ps = IX.paso[m]; if (ps && tiene(ps.duenio) && ids.indexOf(ps.duenio) < 0) ids.push(ps.duenio); });
      por = ids;
    }
    if (!ids.length) return falta(L("The graph has no dependencies recorded for this piece.", "El grafo no registra dependencias de esta pieza."));
    var fs = [];
    ids.forEach(function (id) { if (porId[id] && porId[id].t === "feat" && id !== x.id) fs.push(id); impacto(deps, id).forEach(function (nv) { nv.forEach(function (y) { if (porId[y.id] && porId[y.id].t === "feat" && fs.indexOf(y.id) < 0) fs.push(y.id); }); }); });
    var via = por.length ? "<br><small>" + L("through ", "por ") + por.slice(0, 3).map(function (id) { return esc(nombreDeId(id)); }).join(", ") + (por.length > 3 ? "…" : "") + "</small>" : "";
    return (fs.length ? "<b>" + fs.length + "</b> " + L(pl(fs.length, "feature", "features"), fs.length === 1 ? "funcionalidad" : "funcionalidades") + " · " + listaIds(fs, 6) + ' <a href="#/impacto/' + encodeURIComponent(ids[0]) + '">' + L("See impact", "Ver impacto") + "</a>"
      : L("No feature depends on it.", "Ninguna funcionalidad depende de ella.")) + via;
  }
  function entraSale(id, verbos, lado) {
    var l = (lado === "entra" ? RED.entra[id] : RED.sale[id]) || [];
    return l.filter(function (a) { return !verbos || verbos[a.v]; }).map(function (a) { return lado === "entra" ? a.a : a.b; }).filter(function (v, i, xs) { return xs.indexOf(v) === i; });
  }
  function seccionPantalla(x) {
    var p = IX.pant[x.id], out = "";
    if (!p) return fx(L("Screen", "Pantalla"), falta(L("The graph has no screen attributes for it.", "El grafo no tiene atributos de pantalla para ella.")));
    out += fx(L("Route", "Ruta"), codigo(p.ruta || "?"));
    out += fx(L("Component", "Componente"), (p.componentes || []).length ? p.componentes.map(function (c) { return codigo(c.slice(c.lastIndexOf("#") + 1)); }).join(" ") : falta(L("not detected", "no se detectó")));
    out += fx(L("Wrapped by", "Envolturas"), (p.envuelta || []).length ? p.envuelta.map(function (e) { var nm = e.componente.slice(e.componente.lastIndexOf("#") + 1); return codigo(nm) + (e.sale && e.sale.length ? " <small>" + e.sale.map(function (s) { return (s.tipo === "redirige" ? L("redirects to ", "redirige a ") : "→ ") + esc(s.ruta); }).join(", ") + "</small>" : ""); }).join("<br>") : L("none (layouts or guards)", "ninguna (layouts ni guardas)"));
    out += fx(L("Navigates to", "Navega a"), (p.sale || []).length ? p.sale.map(function (s) { return '<span class="chip">' + esc(s.ruta) + "</span>"; }).slice(0, 14).join("") : L("nothing detected", "nada detectado"));
    var lleg = IX.llegan[x.id] || [];
    out += fx(L("Reached from", "Llega desde"), lleg.length ? lleg.slice(0, 14).map(function (s) { return '<span class="chip">' + esc(s.ruta || s.desde) + "</span>"; }).join("") : L("no other screen links to it", "ninguna otra pantalla enlaza a ella"));
    var cz = D.cruzado && D.cruzado.pantallas && D.cruzado.pantallas[x.id], eps = cz && cz.endpoints ? cz.endpoints.slice() : [];
    entraSale(x.id, null, "sale").forEach(function (id) { if (RED.tipo[id] === "endpoint" && eps.indexOf(id) < 0) eps.push(id); });
    TZ.r.nodos.forEach(function (y) { if (y.tipo === "endpoint" && y.lado === "abajo" && eps.indexOf(y.id) < 0 && y.dist <= 4) eps.push(y.id); });
    out += fx(L("Endpoints it calls", "Endpoints que llama"), eps.length ? listaIds(eps, 10) : L("none detected", "ninguno detectado"));
    return out;
  }
  function simbolosDe(arch) { return (arch && IX.simsArch[arch]) || null; }
  function simboloDeMetodo(m, arch) {
    var ss = simbolosDe(arch);
    if (!ss) return null;
    var nm = m.simbolo, corto = nm.slice(nm.lastIndexOf(".") + 1), cl = nm.indexOf(".") > 0 ? nm.slice(0, nm.indexOf(".")) : nm;
    return ss.filter(function (s) { return s.n === nm; })[0] || ss.filter(function (s) { return s.n === corto; })[0] || ss.filter(function (s) { return s.n === cl; })[0] || null;
  }
  function quienUsa(sims) {
    var otros = {};
    sims.forEach(function (s) { (IX.llamanA[s.i] || []).forEach(function (q) { var o = IX.sims[q.o]; if (o && o.a !== s.a) otros[o.a] = (otros[o.a] || 0) + 1; }); });
    return Object.keys(otros).sort(function (a, b) { return otros[b] - otros[a]; });
  }
  function aQuienLlama(sims) {
    var otros = {};
    sims.forEach(function (s) { (IX.llamaDe[s.i] || []).forEach(function (q) { var o = IX.sims[q.o]; if (o && o.a !== s.a) otros[o.a] = (otros[o.a] || 0) + 1; }); });
    return Object.keys(otros).sort(function (a, b) { return otros[b] - otros[a]; });
  }
  var archCorto = function (a) { var s = a.slice(a.indexOf(":") + 1); return s.slice(s.lastIndexOf("/") + 1); };
  var listaArchivos = function (as, tope) { tope = tope || 10; return as.slice(0, tope).map(function (a) { return TZ.idx[a] ? chipN(a, archCorto(a)) : '<span class="chip" title="' + esc(a) + '">' + esc(archCorto(a)) + "</span>"; }).join("") + (as.length > tope ? ' <span class="tz-mas">' + L("and " + (as.length - tope) + " more", "y " + (as.length - tope) + " más") + "</span>" : ""); };
  function tocaHtml(pasos) {
    var t = {};
    pasos.forEach(function (p) { (p.toca || []).forEach(function (k) { if (k.verbo !== "lee_de" && k.verbo !== "escribe_en") return; var kk = k.verbo + "|" + k.hasta; t[kk] = t[kk] || { verbo: k.verbo, hasta: k.hasta, cols: [] }; (k.columnas || []).forEach(function (c) { if (t[kk].cols.indexOf(c) < 0) t[kk].cols.push(c); }); }); });
    var ks = Object.keys(t);
    if (!ks.length) return "";
    return '<ul class="tz-ul">' + ks.map(function (k) { var x = t[k]; return "<li>" + (x.verbo === "lee_de" ? L("reads ", "lee ") : L("writes ", "escribe ")) + codigo(nombreDeId(x.hasta)) + (x.cols.length ? " <small>" + esc(x.cols.slice(0, 12).join(", ")) + (x.cols.length > 12 ? "…" : "") + "</small>" : " <small>" + L("columns not detected", "columnas no detectadas") + "</small>") + "</li>"; }).join("") + "</ul>";
  }
  function seccionMetodo(x, arch) {
    var m = RED.metodo[x.id] || {}, out = "", ps = IX.paso[x.id], s = simboloDeMetodo(m, arch);
    if (x.capa === 2) {
      var ss = simbolosDe(arch);
      out += fx(L("Exposes", "Expone"), ss ? ss.filter(function (y) { return y.t !== "constante" && y.t !== "tipo" && y.t !== "interfaz"; }).slice(0, 14).map(function (y) { return codigo(y.n) + " <small>" + esc(y.t) + "</small>"; }).join(" · ") || L("nothing besides types and constants", "nada aparte de tipos y constantes") : falta(L("Its file isn't in the code index.", "Su archivo no está en el índice de código.")));
      var usan = s ? quienUsa([s]) : [];
      out += fx(L("Who uses it", "Quién lo usa"), s ? (usan.length ? listaArchivos(usan) : L("no other file calls it", "ningún otro archivo lo llama")) : falta(L("The symbol isn't in the code index.", "El símbolo no está en el índice de código.")));
    } else {
      out += fx(L("Walk", "Recorrido"), ps ? '<ol class="tz-ol">' + [ps.p].concat(ps.debajo).slice(0, 18).map(function (p) { return '<li style="margin-left:' + Math.min(5, p.nivel - ps.p.nivel) * 12 + 'px">' + codigo(p.simbolo) + (p.capa ? " <small>" + esc(p.capa) + "</small>" : "") + "</li>"; }).join("") + "</ol>" + (ps.debajo.length > 17 ? '<span class="tz-mas">' + L("and " + (ps.debajo.length - 17) + " more steps", "y " + (ps.debajo.length - 17) + " pasos más") + "</span>" : "") : falta(L("Its walk isn't in the page.", "Su recorrido no está en la página.")));
      var th = ps ? tocaHtml([ps.p].concat(ps.debajo)) : "";
      out += fx(L("Tables read and written", "Tablas que lee y escribe"), th || L("touches no table (in its walk)", "no toca tablas (en su recorrido)"));
    }
    var hs = TZ.r.huecos.filter(function (h) { return h.en === x.id && h.texto.indexOf("sin_resolver:") === 0; });
    out += fx(L("Unresolved calls", "Llamadas sin resolver"), hs.length ? '<ul class="tz-ul">' + hs.map(function (h) { return "<li>" + codigo(h.texto.slice(13)) + " <small>" + L("no endpoint serves that path, in this brain or the connected ones", "ningún endpoint atiende esa ruta, en este cerebro ni en los conectados") + (h.ev ? " · " + esc(h.ev) : "") + "</small></li>"; }).join("") + "</ul>" : L("none", "ninguna"));
    return out;
  }
  function seccionArchivo(x, arch) {
    var ss = simbolosDe(arch), out = "";
    out += fx(L("Calls", "Llama a"), ss ? (aQuienLlama(ss).length ? listaArchivos(aQuienLlama(ss)) : L("no other file", "ningún otro archivo")) : falta(L("The file isn't in the code index.", "El archivo no está en el índice de código.")));
    out += fx(L("Used by", "Lo usan"), ss ? (quienUsa(ss).length ? listaArchivos(quienUsa(ss)) : L("no other file", "ningún otro archivo")) : falta(L("The file isn't in the code index.", "El archivo no está en el índice de código.")));
    var pasos = (RED.porArchivo[x.id] || []).filter(function (m) { return TZ.idx[m]; });
    if (pasos.length) out += fx(L("Steps of the chain here", "Pasos de la cadena acá"), listaIds(pasos, 10));
    // Lo que manda y espera: las llamadas de este archivo que la deriva comparó con el back.
    var loc = arch ? arch.slice(prefC(x.c).length) : "", difs = [];
    (D.deriva || []).forEach(function (d) { if (d) (d.difieren || []).forEach(function (f) { if (String(f.ev).split("#")[0] === loc) difs.push(f); }); });
    out += fx(L("What it sends and expects", "Lo que manda y espera"), difs.length ? difsHtml(difs) : falta(L("The graph has no compared fields for its calls (only calls whose fields differ are recorded).", "El grafo no tiene campos comparados de sus llamadas (solo se guardan las llamadas cuyos campos difieren).")));
    return out;
  }
  function difsHtml(difs) {
    return '<ul class="tz-ul">' + difs.slice(0, 8).map(function (f) {
      var lados = ["cuerpo", "query", "respuesta"].filter(function (k) { return f[k]; }).map(function (k) {
        var v = f[k], txt = (k === "cuerpo" ? L("body", "cuerpo") : k === "query" ? "query" : L("response", "respuesta")) + ": " + esc(v.front || "?") + " ↔ " + esc(v.back || "?");
        var probs = [];
        Object.keys(v).forEach(function (kk) { if (Array.isArray(v[kk]) && v[kk].length) probs.push(esc(kk) + " " + v[kk].map(function (c) { return codigo(String(c)); }).join(" ")); });
        return "<div><small>" + txt + "</small>" + (probs.length ? "<br><small>" + probs.join(" · ") + "</small>" : "") + "</div>";
      }).join("");
      return "<li>" + codigo(f.l) + lados + "</li>";
    }).join("") + "</ul>" + (difs.length > 8 ? '<span class="tz-mas">' + L("and " + (difs.length - 8) + " more", "y " + (difs.length - 8) + " más") + "</span>" : "");
  }
  function seccionEndpoint(x) {
    var n = porId[x.id], a = (n && n.at) || {}, out = "";
    out += fx(L("Method and route", "Método y ruta"), a.metodo || a.ruta ? codigo((a.metodo || "") + " " + (a.ruta || "")) : falta(L("not recorded", "no registrado")));
    out += fx(L("Receives", "Recibe"), a.request ? codigo(a.request) + (a.query ? " · query " + codigo(a.query) : "") + ' <small class="tz-falta">' + L("its fields aren't in the graph", "sus campos no están en el grafo") + "</small>" : falta(L("no declared request type", "sin tipo de request declarado")));
    out += fx(L("Returns", "Devuelve"), a.response ? codigo(a.response) + ' <small class="tz-falta">' + L("its fields aren't in the graph", "sus campos no están en el grafo") + "</small>" : falta(L("no declared response type", "sin tipo de respuesta declarado")));
    var llaman = entraSale(x.id, { llama_a: 1 }, "entra"), otros = llaman.filter(function (id) { return RED.cer[id] !== x.c; });
    out += fx(L("Who calls it", "Quién lo llama"), llaman.length ? listaIds(llaman, 10) + (otros.length && MULTI ? "<br><small>" + L(otros.length + " from other brains", otros.length + " desde otros cerebros") + "</small>" : "") : L("nobody in the graph", "nadie en el grafo"));
    var loc = x.id.slice(prefC(x.c).length), difs = [];
    (D.deriva || []).forEach(function (d) { if (d) (d.difieren || []).forEach(function (f) { if (f.e === loc) difs.push(f); }); });
    out += fx(L("Fields that don't match", "Campos que no coinciden"), difs.length ? difsHtml(difs) : L("none recorded", "ninguno registrado"));
    var svc = porId[x.id.slice(0, x.id.indexOf(":"))], inf = svc && svc.at && svc.at.infra;
    out += fx(L("Infrastructure", "Infraestructura"), inf && inf.length ? '<ul class="tz-ul">' + inf.filter(function (i) { return i.clase !== "variables"; }).slice(0, 6).map(function (i) { return "<li><b>" + esc(i.clase) + "</b> " + esc(i.nombre) + (i.detalle && i.detalle.length ? " <small>" + esc(i.detalle.slice(0, 4).join(" · ")) + "</small>" : "") + "</li>"; }).join("") + "</ul>" : falta(L("The graph has no infrastructure for its service.", "El grafo no tiene infraestructura de su servicio.")));
    var hs = TZ.r.huecos.filter(function (h) { return h.en === x.id; });
    if (hs.length) out += fx(L("Gaps", "Huecos"), hs.map(function (h) { return '<span class="tz-hueco">' + esc(huecoTxt(h.texto)) + "</span>"; }).join("<br>"));
    return out;
  }
  function seccionTabla(x) {
    var n = porId[x.id], a = (n && n.at) || {}, out = "";
    var cols = a.columnas || [];
    out += fx(L("Columns", "Columnas"), cols.length ? '<table class="tz-tabla"><tr><th>' + L("name", "nombre") + "</th><th>" + L("type", "tipo") + "</th><th>" + L("null", "nulo") + "</th><th>pk</th></tr>" + cols.slice(0, 40).map(function (c) { return "<tr><td>" + esc(c.nombre) + "</td><td>" + esc(c.tipo || "?") + "</td><td>" + (c.nulo ? "✓" : "") + "</td><td>" + (c.pk ? "✓" : "") + "</td></tr>"; }).join("") + "</table>" + (cols.length > 40 ? '<span class="tz-mas">' + L("and " + (cols.length - 40) + " more", "y " + (cols.length - 40) + " más") + "</span>" : "") : falta(n ? L("The graph has no columns for it.", "El grafo no tiene sus columnas.") : L("It has no page in the brain: only its name is known.", "No tiene página en el brain: solo se sabe su nombre.")));
    out += fx(L("Foreign keys", "Claves foráneas"), falta(L("The graph doesn't record foreign keys.", "El grafo no registra claves foráneas.")));
    var lee = entraSale(x.id, { lee_de: 1 }, "entra"), esc2 = entraSale(x.id, { escribe_en: 1 }, "entra");
    out += fx(L("Who reads it", "Quién la lee"), lee.length ? listaIds(lee, 10) : L("nobody in the graph", "nadie en el grafo"));
    out += fx(L("Who writes it", "Quién la escribe"), esc2.length ? listaIds(esc2, 10) : L("nobody in the graph", "nadie en el grafo"));
    return out;
  }
  function seccionCola(x) {
    var pub = [], con = [];
    (D.edges || []).forEach(function (e) { if (e.h !== x.id) return; if (e.v === "publica_en") pub.push(e.s); else if (e.v === "consume_de") con.push(e.s); });
    return fx(L("Publishers", "Publican"), pub.length ? listaIds(pub, 10) : L("nobody in the graph", "nadie en el grafo")) + fx(L("Consumers", "Consumen"), con.length ? listaIds(con, 10) : L("nobody in the graph", "nadie en el grafo"));
  }
  function seccionFeat(x) {
    var f = IX.feat[x.id], out = "";
    if (!f) return fx(L("Card", "Ficha"), falta(L("The feature has no card in the page.", "La funcionalidad no tiene ficha en la página.")));
    var es = f.especificaciones || [], prob = es.filter(function (e) { return e.tests && e.tests.length; }).length;
    out += fx(L("Specifications", "Especificaciones"), es.length ? "<b>" + es.length + "</b> · " + L(prob + " tested", prob + " con test") + '<ul class="tz-ul">' + es.slice(0, 6).map(function (e) { return "<li>" + esc(e.texto) + (e.tests && e.tests.length ? ' <small class="tz-ok">✓ ' + e.tests.length + "</small>" : ' <small class="tz-falta">' + L("no test", "sin test") + "</small>") + "</li>"; }).join("") + "</ul>" : falta(L("It has no specifications yet.", "Todavía no tiene especificaciones.")));
    out += fx(L("Use cases", "Casos de uso"), (f.casos || []).length ? '<ul class="tz-ul">' + f.casos.slice(0, 8).map(function (c) { return "<li>" + esc(c.nombre) + (c.quien ? " <small>" + esc(c.quien) + "</small>" : "") + "</li>"; }).join("") + "</ul>" : falta(L("It has no use cases yet.", "Todavía no tiene casos de uso.")));
    out += fx(L("Screens", "Pantallas"), (f.pantallas || []).length ? f.pantallas.slice(0, 12).map(function (p) { return TZ.idx[p.id] ? chipN(p.id, p.ruta || p.id) : '<span class="chip">' + esc(p.ruta || p.id) + "</span>"; }).join("") : L("none", "ninguna"));
    out += ' <a href="#/f/' + encodeURIComponent(x.id) + '">' + L("Open the feature card", "Abrir la ficha de la funcionalidad") + "</a>";
    return out;
  }
  /** «Pedir al agente»: lo que el panel único del agente ya sabe pedir para esta pieza (su archivo). */
  function pedirHtml(arch) {
    var PD = window.brainPedido, b = [];
    if (!PD || !arch) return "";
    var f = IX.fid[arch];
    if (f && f.t.length) b.push(PD.boton({ tipo: "fidelidad", k: "a|" + arch, et: L("Request: bring its file to 100", "Pedir: llevar su archivo a 100") }));
    if (IX.sinAs[arch]) b.push(PD.boton({ tipo: "asociar", k: "a|" + arch, et: L("Request: assign its file to a feature", "Pedir: asociar su archivo a una funcionalidad") }));
    return b.join("");
  }
  function codigoHtml() {
    var c = TZ.codigo;
    if (!c) return "";
    if (c.error) return '<p class="tz-falta">' + L("Could not read the file: ", "No se pudo leer el archivo: ") + esc(c.error) + "</p>";
    if (!c.d) return '<p class="vacio">' + L("Reading the file…", "Leyendo el archivo…") + "</p>";
    if (c.d.error) return '<p class="tz-falta">' + esc(c.d.error) + "</p>";
    var ls = c.d.lineas || [], l0 = Math.max(0, c.linea - 8), l1 = Math.min(ls.length, c.linea + 22);
    if (!c.linea) { l0 = 0; l1 = Math.min(ls.length, 40); }
    return '<pre class="tz-pre">' + ls.slice(l0, l1).map(function (t, i) { var n = l0 + i + 1; return '<span class="tz-ln' + (n === c.linea ? " on" : "") + '">' + n + "</span>" + esc(t); }).join("\n") + "</pre>";
  }
  function verCodigo(x) {
    var ED = window.FLOWBRAIN_EDICION || null, ev = evDePieza(x);
    if (!ev) return;
    var arch = String(ev).split("#")[0], m = /#L(\d+)/.exec(ev), cer = nombreCerebro(x.c);
    if (TZ.codigo && TZ.codigo.ev === ev) { TZ.codigo = null; ui(); return; }
    TZ.codigo = { ev: ev, linea: m ? Number(m[1]) : 0, d: null };
    if (!ED) { TZ.codigo.error = L("open this page with flowbrain viewer --serve to read the code", "abrí esta página con flowbrain viewer --serve para leer el código"); ui(); return; }
    ui();
    var pedido = TZ.codigo;
    fetch("/api/archivo?cerebro=" + encodeURIComponent(cer) + "&archivo=" + encodeURIComponent(arch) + "&contenido=1", { method: "GET", headers: { "x-flowbrain-token": ED.token } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); })
      .then(function (d) { if (TZ && TZ.codigo === pedido) { pedido.d = d; ui(); } })
      .catch(function (e) { if (TZ && TZ.codigo === pedido) { pedido.error = e.message; ui(); } });
  }
  /** Una pieza que no está en la cadena pero sí en el mapa (un archivo donde viven pasos): su ficha igual se arma. */
  function fichaPieza(id) { var n = by[id]; return n ? { id: id, tipo: n.tipo, nombre: n.nombre, c: n.c, capa: 3, lado: "fuera", dist: 99 } : null; }
  /** La ficha de una pieza de la cadena. */
  function fichaDe(id) {
    indices();
    var x = TZ.idx[id] || fichaPieza(id);
    if (!x) return "";
    var arch = archivoDePieza(x), ev = evDePieza(x), cc = MULTI ? colorC(x.c) : colorC(0), fs = featsDe(x, arch), cuerpo = "";
    if (x.tipo === "pantalla") cuerpo = seccionPantalla(x);
    else if (x.tipo === "metodo") cuerpo = seccionMetodo(x, arch);
    else if (x.tipo === "archivo" || x.tipo === "test" || x.tipo === "componente") cuerpo = (x.tipo === "componente" ? fx(L("File", "Archivo"), arch ? codigo(arch.slice(prefC(x.c).length)) : falta(L("not known", "no se sabe"))) : "") + seccionArchivo(x, arch);
    else if (x.tipo === "endpoint") cuerpo = seccionEndpoint(x);
    else if (x.tipo === "tabla") cuerpo = seccionTabla(x);
    else if (x.tipo === "queue") cuerpo = seccionCola(x);
    else if (x.tipo === "feat") cuerpo = seccionFeat(x);
    var pedir = pedirHtml(arch);
    return '<div class="m3-caja tz-ficha" style="border-color:' + cc + '">' +
      '<div class="tz-ficha-cab"><span class="tz-fi-tipo" style="color:' + cc + '">' + esc(tipoTxt(x)) + "</span>" + (MULTI ? '<span class="mc" style="color:' + cc + ";border-color:" + cc + '">' + esc(nombreCerebro(x.c)) + "</span>" : "") + '<button type="button" class="tz-cerrar" data-acc="tz-ficha-cerrar" aria-label="' + L("Close card", "Cerrar ficha") + '">×</button></div>' +
      '<h3 class="tz-fi-nom">' + esc(x.nombre) + "</h3>" +
      fx(L("Evidence", "Evidencia"), ev ? codigo(ev) : falta(L("no evidence in the graph", "sin evidencia en el grafo"))) +
      (x.tipo === "feat" ? "" : fx(SIN_ARCHIVO[x.tipo] ? L("Used by features", "La usan") : L("Feature", "Funcionalidad"), fs.length ? listaIds(fs, 6) : falta(SIN_ARCHIVO[x.tipo] ? L("no feature", "ninguna funcionalidad") : L("belongs to no feature", "no pertenece a ninguna funcionalidad")))) +
      fx(L("Fidelity", "Fidelidad"), fidelidadHtml(arch, x)) +
      fx(L("If it changes", "Si cambia"), afectadasHtml(x)) +
      fx(L("Source", "Origen"), verificadoTxt(x)) +
      cuerpo +
      '<div class="m3-acciones tz-fi-acc">' + (ev ? '<button type="button" class="btn' + (TZ.codigo ? " on" : "") + '" data-acc="tz-codigo">' + L("See code", "Ver código") + "</button>" : "") +
      (id !== TZ.id ? '<button type="button" class="btn" data-acc="tz-desde">' + L("Trace from here", "Trazar desde acá") + "</button>" : "") + "</div>" +
      (pedir ? '<div class="tz-pedir"><span class="lbl">' + L("Ask the agent", "Pedir al agente") + "</span>" + pedir + "</div>"
        : '<p class="tz-falta">' + L("Nothing to ask the agent: the graph shows no gap in its file (fidelity at 100 and assigned to a feature), or its file isn't known.", "Nada para pedir al agente: el grafo no muestra faltas en su archivo (fidelidad en 100 y asociado a una funcionalidad), o no se sabe su archivo.") + "</p>") +
      codigoHtml() + "</div>";
  }
`;

/** Estilos de las vistas de la trazabilidad (se inyectan con el resto de los del mapa). */
export const TRAZA_CSS =
  "#tz-dg{position:absolute;inset:0;background:var(--fondo);z-index:3;overflow:hidden}#tz-dg[hidden]{display:none}" +
  ".tz-svg{width:100%;height:100%;display:block;cursor:grab;touch-action:none;user-select:none}#tz-dg.arrastra .tz-svg{cursor:grabbing}" +
  ".tz-dg-barra{position:absolute;top:14px;right:14px;display:flex;gap:8px}.tz-dg-barra .ov{min-width:36px;justify-content:center}" +
  ".tz-dg-guia{position:absolute;left:14px;bottom:14px;display:flex;gap:14px;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--borde);border-radius:10px;background:rgba(14,17,24,.82);font-size:12px;color:var(--medio);pointer-events:none}" +
  ".tz-dg-guia span{display:inline-flex;align-items:center;gap:7px}.tz-dg-guia i{display:inline-block;width:22px;height:0;border-top:2px dashed #7D8699}.tz-dg-guia i.tz-l-oro{border-top:2px solid #F5B94A;box-shadow:0 0 6px #F5B94A}" +
  ".tz-dg-cer{font:700 15px var(--sans);letter-spacing:.02em}.tz-dg-capa{font:600 10px var(--sans);letter-spacing:.08em;fill:#6E788C}" +
  ".tz-dg-tipo{font:700 9.5px var(--sans);letter-spacing:.07em}.tz-dg-nom{font:500 12.5px var(--sans);fill:#E6EAF2}" +
  ".tz-dg-n{cursor:pointer}.tz-dg-n:hover .tz-dg-caja{fill:#1A2030}.tz-dg-n.elegida .tz-dg-caja{stroke:#FFE08A;stroke-width:2.4}" +
  ".tz-dg-flujo{stroke-dasharray:6 6;animation:tz-corre 1.1s linear infinite}.tz-dg-flujo.foco{stroke:#C7D4FF;opacity:1;stroke-width:1.8;marker-end:url(#tz-fl-luz)}" +
  ".tz-dg-salto{stroke-dasharray:10 6;animation:tz-corre .9s linear infinite}.tz-dg-salto.foco{stroke-width:3}" +
  "@keyframes tz-corre{to{stroke-dashoffset:-24}}@media (prefers-reduced-motion:reduce){.tz-dg-flujo,.tz-dg-salto{animation:none}}" +
  ".tz-dg-rot text{font:600 11px var(--sans);fill:#F5D08A}" +
  ".tz-ficha{display:flex;flex-direction:column;gap:8px;border-width:1px;border-style:solid}.tz-ficha-cab{display:flex;align-items:center;gap:8px}" +
  ".tz-fi-tipo{font:700 10.5px var(--sans);letter-spacing:.08em;text-transform:uppercase}.tz-cerrar{margin-left:auto;border:0;background:transparent;color:var(--suave);font-size:18px;cursor:pointer;line-height:1}" +
  ".tz-fi-nom{margin:0;font:600 15px var(--sans);color:#FFFFFF;word-break:break-word}" +
  ".tz-fx{display:grid;grid-template-columns:96px 1fr;gap:8px;font-size:12.5px;align-items:baseline}.tz-fx-et{color:var(--suave);font-size:11.5px}.tz-fx-v{min-width:0;color:var(--claro);word-break:break-word}" +
  ".tz-fx-v code{font:400 11.5px ui-monospace,SFMono-Regular,Menlo,monospace}.tz-fx-v .chip{margin:0 4px 4px 0}.tz-ir{cursor:pointer;background:transparent;font:inherit}" +
  ".tz-falta{color:var(--suave);font-style:italic}.tz-ok{color:#5EDBB0}.tz-mas{color:var(--suave);font-size:11.5px}" +
  ".tz-ul,.tz-ol{margin:4px 0 0;padding-left:16px}.tz-ul li,.tz-ol li{margin:2px 0}" +
  ".tz-tabla{border-collapse:collapse;font-size:11.5px;width:100%}.tz-tabla th{color:var(--suave);font-weight:500;text-align:left}.tz-tabla td,.tz-tabla th{padding:2px 6px 2px 0;border-bottom:1px solid var(--borde)}" +
  ".tz-pedir{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.tz-pedir .lbl{width:100%}" +
  ".tz-pre{max-height:340px;overflow:auto;margin:0;padding:8px;border:1px solid var(--borde);border-radius:8px;background:#0B0E14;font:400 11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}" +
  ".tz-ln{display:inline-block;width:38px;color:#566074;user-select:none}.tz-ln.on{color:#FFE08A}";

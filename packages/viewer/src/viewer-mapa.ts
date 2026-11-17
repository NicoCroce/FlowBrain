import { IMPACTO_JS } from "@brain/core";

/**
 * Vistas del visor que responden preguntas: "Dependencias" (qué funcionalidades usan a cuáles y qué datos y
 * externos tocan) e "Impacto" (si cambia esta pieza, qué se ve afectado, por niveles y con el porqué). También es
 * el enrutador de todo el visor: `#/funcionalidades`, `#/f/<id>`, `#/mapa[/<id>]`, `#/impacto[/<id>]`,
 * `#/grafo[/<id>]`. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const MAPA_JS =
  IMPACTO_JS +
  String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, P = window.brainProducto, D = V.D, porId = V.porId, esc = V.esc, color = V.color;
  var fichas = D.funcionalidades || [], deps = D.dependencias || [];
  var porFicha = {};
  fichas.forEach(function (f) { porFicha[f.id] = f; });
  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var tipo = function (id) { return porId[id] ? porId[id].t : ""; };
  var plural = function (n, uno, varios) { return n + " " + (n === 1 ? uno : varios); };
  var TIPO = { feat: "funcionalidad", tabla: "tabla", endpoint: "endpoint", svc: "servicio", ext: "servicio externo", db: "base de datos", queue: "cola", lib: "librería", repo: "repo" };
  var TIPOS = { feat: "funcionalidades", tabla: "tablas", endpoint: "endpoints", svc: "servicios", ext: "servicios externos", db: "bases de datos", queue: "colas", lib: "librerías", repo: "repos" };
  var VERBO = { usa: "usa", escribe_en: "escribe en", lee_de: "lee", llama_a: "llama a", implementa: "está implementada por", vive_en: "vive en", publica_en: "publica en", consume_de: "consume de", depende_de: "depende de" };
  var puntoT = function (t) { return '<span class="punto" style="background:' + color(t) + '"></span>'; };
  var punto = function (id) { return puntoT(tipo(id)); };
  var entran = {}, salen = {};
  deps.forEach(function (d) { (entran[d[1]] = entran[d[1]] || []).push(d); (salen[d[0]] = salen[d[0]] || []).push(d); });
  var vistas = { producto: document.getElementById("producto"), deps: document.getElementById("deps"), impacto: document.getElementById("impacto"), grafo: document.getElementById("app") };

  // ---------- Dependencias entre funcionalidades ----------
  var cyd = null, panel = document.getElementById("detalle-deps");
  var ver = { tablas: false, ext: false, sueltas: false };
  var botonVer = { tablas: document.getElementById("ver-tablas"), ext: document.getElementById("ver-ext"), sueltas: document.getElementById("ver-sueltas") };
  function pintarBotones() { Object.keys(ver).forEach(function (k) { botonVer[k].classList.toggle("on", ver[k]); botonVer[k].setAttribute("aria-pressed", ver[k]); }); }
  // Esfera: el mismo degradé que los puntos del mapa 3D.
  function mezcla(a, b, t) {
    var p = function (h, i) { return parseInt(h.slice(i, i + 2), 16); };
    return "rgb(" + Math.round(p(a, 1) + (p(b, 1) - p(a, 1)) * t) + "," + Math.round(p(a, 3) + (p(b, 3) - p(a, 3)) * t) + "," + Math.round(p(a, 5) + (p(b, 5) - p(a, 5)) * t) + ")";
  }
  var esfera = function (n) { var c = color(n.data("tipo")); return [mezcla(c, "#FFFFFF", 0.45), c, mezcla(c, "#05070B", 0.5)].join(" "); };
  function armarDeps() {
    var nodos = {}, aristas = [], datos = {};
    fichas.forEach(function (f) { nodos[f.id] = { id: f.id, label: nombre(f.id), tipo: "feat", peso: f.usadaPor.length }; });
    deps.forEach(function (d) {
      if (!porFicha[d[0]]) return;
      var t = tipo(d[1]);
      if (d[2] === "usa" && porFicha[d[1]]) aristas.push({ id: "u:" + d[0] + ":" + d[1], source: d[0], target: d[1], clase: "usa", veces: d[3], label: plural(d[3], "endpoint", "endpoints") });
      else if (t === "tabla" && (d[2] === "lee_de" || d[2] === "escribe_en")) {
        var k = d[0] + ":" + d[1];
        datos[k] = datos[k] || { id: "t:" + k, source: d[0], target: d[1], clase: "dato", lee: false, escribe: false };
        datos[k][d[2] === "lee_de" ? "lee" : "escribe"] = true;
        nodos[d[1]] = { id: d[1], label: nombre(d[1]), tipo: "tabla", peso: 0 };
      } else if (t === "ext" && d[2] === "llama_a") {
        aristas.push({ id: "x:" + d[0] + ":" + d[1], source: d[0], target: d[1], clase: "ext", label: "llama a" });
        nodos[d[1]] = { id: d[1], label: nombre(d[1]), tipo: "ext", peso: 0 };
      }
    });
    Object.keys(datos).sort().forEach(function (k) { var x = datos[k]; x.label = x.lee && x.escribe ? "lee y escribe" : x.escribe ? "escribe" : "lee"; aristas.push(x); });
    var etiqueta = { label: "data(label)", "font-size": 10, color: "#D5DAE4", "text-rotation": "autorotate", "text-background-color": color("fondo"), "text-background-opacity": 0.85, "text-background-padding": 2, "text-background-shape": "roundrectangle", opacity: 1 };
    cyd = cytoscape({
      container: document.getElementById("cy-deps"),
      elements: Object.keys(nodos).sort().map(function (id) { return { group: "nodes", data: nodos[id] }; }).concat(aristas.map(function (a) { return { group: "edges", data: a }; })),
      wheelSensitivity: 0.3,
      style: [
        { selector: "node", style: { shape: "ellipse", "background-fill": "radial-gradient", "background-gradient-stop-colors": esfera, "background-gradient-stop-positions": "0 45 100",
          label: "data(label)", color: "#D5DAE4", "font-family": color("sans"), "font-size": 11, "font-weight": 500, "text-valign": "bottom", "text-margin-y": 5,
          "text-outline-color": color("fondo"), "text-outline-width": 2, "min-zoomed-font-size": 6, width: 12, height: 12, "border-width": 0 } },
        { selector: "node[tipo = 'feat']", style: { width: function (n) { return 14 + Math.min(n.data("peso"), 10) * 3.4; }, height: function (n) { return 14 + Math.min(n.data("peso"), 10) * 3.4; }, "font-size": 12, "font-weight": 600, color: "#E6E8EE" } },
        { selector: "edge", style: { width: 1, "line-color": "rgba(150,162,190,0.28)", "target-arrow-color": "rgba(150,162,190,0.45)", "target-arrow-shape": "triangle", "curve-style": "bezier", "arrow-scale": 0.7 } },
        { selector: "edge[clase = 'usa']", style: { width: function (e) { return 1.2 + Math.min(e.data("veces"), 6) * 0.45; }, "line-color": "rgba(150,162,190,0.45)", "target-arrow-color": "rgba(150,162,190,0.6)" } },
        { selector: "edge[clase = 'dato'], edge[clase = 'ext']", style: { "line-style": "dashed", "line-dash-pattern": [4, 4] } },
        { selector: ".atenuado", style: { opacity: 0.12 } },
        { selector: "node.foco", style: { "border-width": 2, "border-color": "#FFFFFF", "border-opacity": 0.9 } },
        { selector: "edge.sale", style: Object.assign({ "line-color": color("acento"), "target-arrow-color": color("acento") }, etiqueta) },
        { selector: "edge.entra", style: Object.assign({ "line-color": color("feat"), "target-arrow-color": color("feat") }, etiqueta) }
      ]
    });
    cyd.on("tap", "node", function (ev) { location.hash = "#/mapa/" + encodeURIComponent(ev.target.id()); });
    cyd.on("tap", function (ev) { if (ev.target === cyd) location.hash = "#/mapa"; });
    cyd.on("mouseover", "node", function () { document.getElementById("cy-deps").style.cursor = "pointer"; });
    cyd.on("mouseout", "node", function () { document.getElementById("cy-deps").style.cursor = ""; });
    Object.keys(botonVer).forEach(function (k) { botonVer[k].addEventListener("click", function () { ver[k] = !ver[k]; pintarBotones(); visibilidad(); disponer(); }); });
    document.getElementById("ajustar-deps").addEventListener("click", function () { cyd.fit(cyd.elements(":visible"), 40); });
    pintarBotones();
    visibilidad();
    disponer();
  }
  function visibilidad() {
    cyd.batch(function () {
      cyd.nodes("[tipo = 'tabla']").style("display", ver.tablas ? "element" : "none");
      cyd.nodes("[tipo = 'ext']").style("display", ver.ext ? "element" : "none");
      cyd.nodes("[tipo = 'feat']").forEach(function (n) {
        var conVisibles = n.connectedEdges().some(function (e) { var o = e.source().id() === n.id() ? e.target() : e.source(); return o.data("tipo") === "feat" || o.style("display") !== "none"; });
        n.style("display", ver.sueltas || conVisibles ? "element" : "none");
      });
    });
    var sueltas = cyd.nodes("[tipo = 'feat']").filter(function (n) { return n.style("display") === "none"; }).length;
    document.getElementById("cuenta-sueltas").textContent = sueltas ? sueltas + " ocultas" : "";
  }
  function disponer() {
    cyd.elements(":visible").layout({ name: "cose", animate: false, randomize: false, nodeDimensionsIncludeLabels: true, idealEdgeLength: function () { return 120; }, nodeRepulsion: function () { return 14000; }, padding: 40, stop: function () { cyd.fit(cyd.elements(":visible"), 40); } }).run();
  }
  var sw = function (id) { return '<span class="sw" style="background:' + color(tipo(id)) + '"></span>'; };
  var fila = function (id, extra) { return '<a class="nb" href="#/mapa/' + encodeURIComponent(id) + '">' + sw(id) + '<span class="corta">' + esc(nombre(id)) + "</span>" + (extra ? '<span class="vb">' + extra + "</span>" : "") + "</a>"; };
  var seccion = function (titulo, items) { return items.length ? '<div class="deps-seccion"><h3 class="lbl">' + titulo + " (" + items.length + ")</h3>" + items.join("") + "</div>" : ""; };
  var stats = function (xs) { return '<div class="m3-stats">' + xs.map(function (x) { return "<div><b>" + x[0] + "</b><span>" + x[1] + "</span></div>"; }).join("") + "</div>"; };
  function resumenImpacto(id) {
    var niveles = impacto(deps, id), feats = [], directas = 0;
    niveles.forEach(function (nv, i) { nv.forEach(function (x) { if (porFicha[x.id]) { feats.push(x.id); if (i === 0) directas++; } }); });
    var texto = feats.length
      ? "Si cambia, puede afectar a <strong>" + plural(feats.length, "funcionalidad", "funcionalidades") + "</strong>" + (directas < feats.length ? " (" + directas + " en forma directa)" : "") + "."
      : "Ninguna funcionalidad depende de esto.";
    return '<div class="deps-seccion"><h3 class="lbl">Impacto</h3><p class="deps-impacto">' + texto + ' <a href="#/impacto/' + encodeURIComponent(id) + '">Ver detalle →</a></p></div>';
  }
  function panelGeneral() {
    var usa = deps.filter(function (d) { return d[2] === "usa"; }).length;
    var sueltas = fichas.filter(function (f) { return !f.usadaPor.length && !f.usaFuncionalidades.length; }).length;
    var top = fichas.filter(function (f) { return f.usadaPor.length; }).sort(function (a, b) { return b.usadaPor.length - a.usadaPor.length || (a.id < b.id ? -1 : 1); }).slice(0, 8);
    panel.innerHTML = '<div class="m3-cab"><span class="lbl">Dependencias</span><h2 class="m3-nombre">Entre funcionalidades</h2>' +
      '<p class="m3-resumen">Cada flecha va de la funcionalidad que usa a la usada. El grosor es la cantidad de endpoints y el tamaño, cuántas la usan.</p></div>' +
      stats([[fichas.length, "funcionalidades"], [usa, "relaciones de uso"], [sueltas, "sin relaciones"]]) +
      (top.length ? '<div class="m3-caja"><span class="lbl">Las más usadas</span>' + top.map(function (f) { return fila(f.id, "la usan " + f.usadaPor.length); }).join("") + "</div>" : "");
  }
  function construccion(f) {
    var eps = f.recorridos.filter(function (r) { return r.pasos.length; }).slice(0, 6).map(function (r) {
      var cadena = r.pasos.filter(function (p) { return p.nivel <= 2; }).map(function (p) { return p.simbolo; });
      return '<div class="deps-pasos"><code>' + esc(nombre(r.endpoint)) + "</code>" + esc(cadena.slice(0, 4).join(" → ")) + (cadena.length > 4 ? " → …" : "") + "</div>";
    });
    if (!eps.length) return "";
    return '<div class="deps-seccion"><h3 class="lbl">Qué ejecuta cada endpoint</h3>' + eps.join("") +
      '<a href="#/f/' + encodeURIComponent(f.id) + '" style="font-size: 13px; padding: 2px 4px">Ver los recorridos completos en la ficha →</a></div>';
  }
  function panelNodo(id) {
    var t = tipo(id), f = porFicha[id], n = porId[id] || {};
    var cab = '<div class="m3-cab"><div class="m3-tipo">' + sw(id) + '<span class="lbl">' + esc(TIPO[t] || t) + "</span></div>" +
      '<h2 class="m3-nombre">' + esc(nombre(id)) + "</h2><code>" + esc(id) + "</code>" +
      (P.pendiente(n.r) ? (f ? '<p class="m3-resumen pendiente">Sin descripción todavía</p>' : "") : '<p class="m3-resumen">' + esc(n.r) + "</p>") + "</div>";
    var enlaces = '<div class="m3-enlaces">' + (f ? '<a href="#/f/' + encodeURIComponent(id) + '">Abrir la ficha</a>' : "") + '<a href="#/grafo/' + encodeURIComponent(id) + '">Ver en el mapa 3D</a></div>';
    var html;
    if (f) {
      var datos = P.datosDe(f), externos = f.usa.filter(function (u) { return tipo(u.hasta) === "ext"; });
      html = cab + stats([[f.usadaPor.length, "la usan"], [f.usaFuncionalidades.length, "usa"], [datos.length, "tablas"]]) + enlaces +
        seccion("Usa", f.usaFuncionalidades.map(function (u) { var d = (salen[id] || []).filter(function (x) { return x[1] === u && x[2] === "usa"; })[0]; return fila(u, d ? plural(d[3], "endpoint", "endpoints") : ""); })) +
        seccion("La usan", f.usadaPor.map(function (u) { return fila(u); })) +
        seccion("Datos", datos.map(function (d) { return fila(d.tabla, [d.lee ? "lee" : "", d.escribe ? "escribe" : ""].filter(Boolean).join(" y ") + (d.via ? " · vía " + esc(nombre(d.via)) : "")); })) +
        seccion("Servicios externos", externos.map(function (u) { return fila(u.hasta); })) +
        construccion(f);
    } else {
      var de = function (v) { return (entran[id] || []).filter(function (d) { return d[2] === v && porFicha[d[0]]; }).map(function (d) { return fila(d[0]); }); };
      html = cab + enlaces + (t === "tabla" ? seccion("La escriben", de("escribe_en")) + seccion("La leen", de("lee_de")) : seccion("La usan", de("llama_a")));
    }
    panel.innerHTML = html + resumenImpacto(id);
  }
  function mostrarDeps(id) {
    if (!fichas.length) {
      panel.innerHTML = '<p class="aviso">Todavía no hay funcionalidades: el mapa de dependencias se arma con ellas. Mientras tanto, el mapa 3D y el impacto funcionan sobre servicios, tablas y endpoints.</p>';
      return;
    }
    if (!cyd) armarDeps();
    else cyd.resize();
    cyd.elements().removeClass("atenuado foco sale entra");
    var n = id ? cyd.getElementById(id) : cyd.collection();
    if (n.empty()) return panelGeneral();
    if (n.style("display") === "none") { if (tipo(id) === "tabla") ver.tablas = true; else if (tipo(id) === "ext") ver.ext = true; else ver.sueltas = true; pintarBotones(); visibilidad(); disponer(); }
    var vec = n.closedNeighborhood();
    cyd.elements().not(vec).addClass("atenuado");
    n.addClass("foco");
    n.outgoers("edge").addClass("sale");
    n.incomers("edge").addClass("entra");
    // Con pocos vecinos, encuadrar solo el vecindario acerca demasiado: se limita el zoom.
    cyd.fit(vec, 80);
    if (cyd.zoom() > 1.2) cyd.zoom({ level: 1.2, position: n.position() });
    panelNodo(id);
    panel.scrollTop = 0;
  }
  var buscarDeps = document.getElementById("buscar-deps");
  buscarDeps.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || !cyd) return;
    var q = buscarDeps.value.trim().toLowerCase();
    var c = cyd.nodes().filter(function (n) { return (n.id() + " " + n.data("label")).toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return a.id() < b.id() ? -1 : 1; })[0];
    if (c) location.hash = "#/mapa/" + encodeURIComponent(c.id());
  });

  // ---------- Impacto ----------
  var raizImpacto = vistas.impacto, copia = "";
  var candidatos = D.nodes.filter(function (n) { return entran[n.id] || salen[n.id] || porFicha[n.id]; });
  function buscarPiezas(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return candidatos.map(function (n) {
      var claves = [n.id, n.n].concat(n.a).map(function (k) { return k.toLowerCase(); });
      var p = claves.some(function (k) { return k === q; }) ? 0 : claves.some(function (k) { return k.indexOf(q) === 0; }) ? 1 : claves.some(function (k) { return k.indexOf(q) >= 0; }) ? 2 : 9;
      return [p + (n.t === "feat" ? 0 : 0.5), n];
    }).filter(function (x) { return x[0] < 9; }).sort(function (a, b) { return a[0] - b[0] || (a[1].id < b[1].id ? -1 : 1); }).slice(0, 10).map(function (x) { return x[1]; });
  }
  var enlaceImpacto = function (id) { return '<a href="#/impacto/' + encodeURIComponent(id) + '">' + punto(id) + " " + esc(nombre(id)) + "</a>"; };
  function buscador() {
    return '<input id="buscar-impacto" type="search" placeholder="Buscar una funcionalidad, tabla, endpoint, servicio o externo" autocomplete="off"><ul id="resultados-impacto" class="lista"></ul>';
  }
  function conectarBuscador() {
    var input = document.getElementById("buscar-impacto"), res = document.getElementById("resultados-impacto");
    input.addEventListener("input", function () {
      res.innerHTML = buscarPiezas(input.value).map(function (n) { return "<li>" + enlaceImpacto(n.id) + " <small>· " + esc(TIPO[n.t] || n.t) + "</small></li>"; }).join("");
    });
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { var c = buscarPiezas(input.value)[0]; if (c) location.hash = "#/impacto/" + encodeURIComponent(c.id); } });
  }
  function masDependidas(t, n) {
    return candidatos.filter(function (x) { return x.t === t && entran[x.id]; }).map(function (x) {
      var quien = {};
      entran[x.id].forEach(function (d) { quien[d[0]] = true; });
      return [Object.keys(quien).length, x.id];
    }).sort(function (a, b) { return b[0] - a[0] || (a[1] < b[1] ? -1 : 1); }).slice(0, n);
  }
  function inicioImpacto() {
    var bloque = function (titulo, xs) { return xs.length ? "<section><h2>" + titulo + "</h2><ul class=\"lista\">" + xs.map(function (x) { return "<li>" + enlaceImpacto(x[1]) + " <small>· " + plural(x[0], "pieza depende", "piezas dependen") + " directo</small></li>"; }).join("") + "</ul></section>" : ""; };
    raizImpacto.innerHTML = "<h1>Impacto de un cambio</h1>" +
      '<p class="subtitulo">Elegí una pieza y mirá todo lo que depende de ella, directa o indirectamente: para planificar un cambio, revisar un PR o estimar el riesgo.</p>' +
      buscador() + '<div class="columnas">' + bloque("Funcionalidades más usadas", masDependidas("feat", 8)) + bloque("Tablas más compartidas", masDependidas("tabla", 8)) + bloque("Endpoints más llamados", masDependidas("endpoint", 8)) + "</div>";
    conectarBuscador();
  }
  function mostrarImpacto(id) {
    if (!id || !porId[id]) return inicioImpacto();
    var niveles = impacto(deps, id), info = {};
    niveles.forEach(function (nv, i) { nv.forEach(function (x) { x.nivel = i + 1; info[x.id] = x; }); });
    var porque = function (x) {
      var partes = [];
      for (var c = x; c; c = info[c.via]) partes.push((VERBO[c.verbo] || c.verbo) + " " + nombre(c.via));
      return partes.join(", que ");
    };
    var todos = [].concat.apply([], niveles);
    var feats = todos.filter(function (x) { return porFicha[x.id]; });
    var tecnicas = todos.filter(function (x) { return !porFicha[x.id]; });
    var cuenta = {};
    todos.forEach(function (x) { var t = tipo(x.id); cuenta[t] = (cuenta[t] || 0) + 1; });
    var orden = ["feat", "svc", "endpoint", "tabla", "ext", "queue", "db", "lib", "repo"];
    var chips = Object.keys(cuenta).sort(function (a, b) { return (orden.indexOf(a) + 1 || 99) - (orden.indexOf(b) + 1 || 99); }).map(function (t) { return '<span class="chip">' + puntoT(t) + " " + cuenta[t] + " " + esc((cuenta[t] === 1 ? TIPO[t] : TIPOS[t]) || t) + "</span>"; }).join("");
    var item = function (x) {
      var destino = porFicha[x.id] ? "#/f/" + encodeURIComponent(x.id) : "#/impacto/" + encodeURIComponent(x.id);
      return '<li><a href="' + destino + '">' + punto(x.id) + " " + esc(nombre(x.id)) + "</a> <small>· " + esc(TIPO[tipo(x.id)] || tipo(x.id)) + (x.nivel > 1 ? " · nivel " + x.nivel : " · directo") + "</small><br><small>" + esc(porque(x)) + "</small></li>";
    };
    var porNivel = function (xs) { return xs.slice().sort(function (a, b) { return a.nivel - b.nivel || (nombre(a.id) < nombre(b.id) ? -1 : 1); }); };
    var plano = function (x) { return "- " + nombre(x.id) + " (" + (TIPO[tipo(x.id)] || tipo(x.id)) + ", " + (x.nivel > 1 ? "nivel " + x.nivel : "directo") + "): " + porque(x); };
    copia = "Impacto de cambiar " + nombre(id) + " (" + id + ")\n\n" +
      (feats.length ? "Funcionalidades:\n" + porNivel(feats).map(plano).join("\n") + "\n\n" : "") +
      (tecnicas.length ? "Piezas técnicas:\n" + porNivel(tecnicas).map(plano).join("\n") + "\n" : "");
    var n = porId[id];
    raizImpacto.innerHTML = '<a class="volver" href="#/impacto">← Otra pieza</a>' +
      "<h1>Si cambia " + esc(n.n) + "</h1>" +
      '<p class="subtitulo">' + esc(TIPO[n.t] || n.t) + " · <code>" + esc(id) + "</code>" + (porFicha[id] ? ' · <a href="#/f/' + encodeURIComponent(id) + '">ficha</a>' : "") + ' · <a href="#/mapa/' + encodeURIComponent(id) + '">mapa</a></p>' +
      (todos.length
        ? '<div class="chips resumen-impacto">' + chips + '</div><p><button class="boton" id="copiar-impacto">Copiar como lista</button></p>' +
          '<div class="columnas"><section><h2>Funcionalidades afectadas (' + feats.length + ")</h2>" + (feats.length ? '<ul class="lista">' + porNivel(feats).map(item).join("") + "</ul>" : '<p class="vacio">Ninguna.</p>') + "</section>" +
          "<section><h2>Piezas técnicas afectadas (" + tecnicas.length + ")</h2>" + (tecnicas.length ? '<ul class="lista">' + porNivel(tecnicas).map(item).join("") + "</ul>" : '<p class="vacio">Ninguna.</p>') + "</section></div>"
        : '<p class="aviso">Nada depende de esta pieza en el grafo: cambiarla no afecta a otras funcionalidades ni servicios conocidos.</p>');
    var b = document.getElementById("copiar-impacto");
    if (b) b.addEventListener("click", function () {
      var listo = function () { b.textContent = "Copiado"; setTimeout(function () { b.textContent = "Copiar como lista"; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(copia).then(listo, function () { b.textContent = "No se pudo copiar"; });
    });
  }

  // ---------- Navegación ----------
  function ir() {
    var h = decodeURIComponent(location.hash.replace(/^#/, "")), m, vista;
    if (/^\/grafo/.test(h)) vista = "grafo";
    else if (/^\/impacto/.test(h)) vista = "impacto";
    else if (/^\/mapa/.test(h)) vista = "deps";
    else if (h === "" && !fichas.length) vista = "grafo";
    else vista = "producto";
    // La navegación entre pantallas se dibuja en el mismo contenedor que las funcionalidades.
    var pestana = vista === "producto" && /^\/(pantallas|p\/)/.test(h) ? "pantallas" : vista;
    // Un enlace viejo al mapa con una pieza que no está en el de dependencias va al grafo completo.
    if (vista === "deps" && (m = /^\/mapa\/(.+)$/.exec(h)) && fichas.length && !porFicha[m[1]] && !(entran[m[1]] || []).some(function (d) { return porFicha[d[0]]; })) {
      location.replace("#/grafo/" + encodeURIComponent(m[1]));
      return;
    }
    document.querySelectorAll("#cabecera nav a").forEach(function (a) { a.classList.toggle("activa", a.getAttribute("data-vista") === pestana); });
    Object.keys(vistas).forEach(function (k) { vistas[k].classList.toggle("oculto", k !== vista); });
    document.getElementById("presets").classList.toggle("oculto", vista !== "grafo");
    if (vista === "grafo") { V.mostrarMapa(); if ((m = /^\/grafo\/(.+)$/.exec(h))) V.enfocar(m[1]); return; }
    if (vista === "deps") { m = /^\/mapa\/(.+)$/.exec(h); mostrarDeps(m ? m[1] : null); return; }
    if (vista === "impacto") { m = /^\/impacto\/(.+)$/.exec(h); mostrarImpacto(m ? m[1] : null); window.scrollTo(0, 0); return; }
    if (pestana === "pantallas") window.brainPantallas.mostrar(h); else P.mostrar(h);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", ir);
  ir();
})();
`;

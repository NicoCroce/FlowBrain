import { IMPACTO_JS } from "@flowbrain/core";

/**
 * "Impacto" (si cambia esta pieza, qué se ve afectado, por niveles y con el porqué) y el enrutador de todo el visor:
 * `#/funcionalidades`, `#/f/<id>`, `#/impacto[/<id>]`, `#/grafo[/<id>]`. Los enlaces viejos `#/mapa[/<id>]` (la vista
 * de dependencias, que se quitó) abren el mapa 3D. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
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
  var vistas = { producto: document.getElementById("producto"), impacto: document.getElementById("impacto"), grafo: document.getElementById("app") };

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
      '<p class="subtitulo">' + esc(TIPO[n.t] || n.t) + " · <code>" + esc(id) + "</code>" + (porFicha[id] ? ' · <a href="#/f/' + encodeURIComponent(id) + '">ficha</a>' : "") + ' · <a href="#/grafo/' + encodeURIComponent(id) + '">mapa 3D</a></p>' +
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
    // Enlaces viejos a la vista de dependencias: el mapa 3D, con la misma pieza.
    if ((m = /^\/mapa(?:\/(.+))?$/.exec(h))) {
      location.replace(m[1] ? "#/grafo/" + encodeURIComponent(m[1]) : "#/grafo");
      return;
    }
    if (/^\/grafo/.test(h)) vista = "grafo";
    else if (/^\/impacto/.test(h)) vista = "impacto";
    else if (h === "" && !fichas.length) vista = "grafo";
    else vista = "producto";
    // La navegación entre pantallas se dibuja en el mismo contenedor que las funcionalidades.
    var pestana = vista === "producto" && /^\/(pantallas|p\/)/.test(h) ? "pantallas" : vista;
    document.querySelectorAll("#cabecera nav a").forEach(function (a) { a.classList.toggle("activa", a.getAttribute("data-vista") === pestana); });
    Object.keys(vistas).forEach(function (k) { vistas[k].classList.toggle("oculto", k !== vista); });
    document.getElementById("presets").classList.toggle("oculto", vista !== "grafo");
    if (vista === "grafo") { V.mostrarMapa(); if ((m = /^\/grafo\/(.+)$/.exec(h))) V.enfocar(m[1]); return; }
    if (vista === "impacto") { m = /^\/impacto\/(.+)$/.exec(h); mostrarImpacto(m ? m[1] : null); window.scrollTo(0, 0); return; }
    if (pestana === "pantallas") window.brainPantallas.mostrar(h); else P.mostrar(h);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", ir);
  ir();
})();
`;

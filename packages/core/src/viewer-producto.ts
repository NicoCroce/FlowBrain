/**
 * Vista de producto del visor: catálogo de funcionalidades y ficha de cada una. Corre en el navegador sobre los
 * datos embebidos (`window.brainVisor.D`); navega por `location.hash` (`#/funcionalidades`, `#/f/<id>`, `#/mapa`,
 * `#/mapa/<id>`), así funcionan Atrás y los enlaces compartidos. Sin dependencias ni red.
 *
 * Es JavaScript plano dentro de `String.raw`: sin backticks ni `${` (los backticks de Markdown van como \x60).
 */
export const PRODUCTO_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var fichas = D.funcionalidades || [];
  var porFicha = {};
  fichas.forEach(function (f) { porFicha[f.id] = f; });
  var duenas = {};
  fichas.forEach(function (f) { f.expone.forEach(function (e) { (duenas[e] = duenas[e] || []).push(f.id); }); });
  var consumidoras = {};
  fichas.forEach(function (f) { f.usa.forEach(function (u) { if (u.endpoint) (consumidoras[u.endpoint] = consumidoras[u.endpoint] || []).push(f.id); }); });
  var raiz = document.getElementById("producto"), app = document.getElementById("app");
  var filtro = "";

  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var pendiente = function (r) { return !r || /^Borrador:/.test(r); };
  var plural = function (n, uno, varios) { return n + " " + (n === 1 ? uno : varios); };
  var hrefFicha = function (id) { return "#/f/" + encodeURIComponent(id); };
  var chipFeat = function (id) { return '<a class="chip" href="' + hrefFicha(id) + '">' + esc(nombre(id)) + "</a>"; };

  // ---------- Markdown mínimo: títulos, párrafos, listas, citas, código, negrita, cursiva y enlaces ----------
  function inline(t) {
    return t
      .replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|#)[^)\s]+)\)/g, '<a href="$2">$1</a>');
  }
  function markdown(md) {
    var out = [], parrafo = [], lista = "";
    function cerrarParrafo() { if (parrafo.length) { out.push("<p>" + inline(esc(parrafo.join(" "))) + "</p>"); parrafo = []; } }
    function cerrar() { cerrarParrafo(); if (lista) { out.push("</" + lista + ">"); lista = ""; } }
    function item(tipo, texto) {
      cerrarParrafo();
      if (lista !== tipo) { if (lista) out.push("</" + lista + ">"); out.push("<" + tipo + ">"); lista = tipo; }
      out.push("<li>" + inline(esc(texto)) + "</li>");
    }
    md.split("\n").forEach(function (l) {
      var m;
      if (/^#\s/.test(l) || /^>\s*Borrador generado/.test(l)) return cerrar();
      if ((m = /^(#{2,4})\s+(.*)$/.exec(l))) { cerrar(); var h = "h" + (m[1].length + 1); out.push("<" + h + ">" + inline(esc(m[2])) + "</" + h + ">"); return; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) return item("ul", m[1]);
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) return item("ol", m[1]);
      if ((m = /^>\s?(.*)$/.exec(l))) { cerrar(); out.push("<blockquote>" + inline(esc(m[1])) + "</blockquote>"); return; }
      if (l.trim() === "") return cerrar();
      if (lista) { out.push("</" + lista + ">"); lista = ""; }
      parrafo.push(l.trim());
    });
    cerrar();
    return out.join("");
  }

  // ---------- Datos que toca: los propios y los de las funcionalidades que usa ----------
  function datosDe(f) {
    var vistos = {}, out = [];
    f.datos.forEach(function (d) { vistos[d.tabla] = true; out.push({ tabla: d.tabla, lee: d.lee, escribe: d.escribe, via: null }); });
    f.usaFuncionalidades.forEach(function (u) {
      (porFicha[u] ? porFicha[u].datos : []).forEach(function (d) {
        if (vistos[d.tabla]) return;
        vistos[d.tabla] = true;
        out.push({ tabla: d.tabla, lee: d.lee, escribe: d.escribe, via: u });
      });
    });
    return out;
  }

  // ---------- Catálogo ----------
  function tarjeta(f) {
    var n = porId[f.id] || {};
    var chips = [plural(f.archivos, "archivo", "archivos")];
    var rel = f.usaFuncionalidades.length + f.usadaPor.length;
    if (rel) chips.push(plural(rel, "relacionada", "relacionadas"));
    var t = datosDe(f).length;
    if (t) chips.push(plural(t, "tabla", "tablas"));
    if (f.expone.length) chips.push("API: " + f.expone.length);
    return '<a class="tarjeta" href="' + hrefFicha(f.id) + '"><h3>' + esc(nombre(f.id)) + "</h3>" +
      (pendiente(n.r) ? '<p class="pendiente">Sin descripción todavía</p>' : "<p>" + esc(n.r) + "</p>") +
      '<div class="chips">' + chips.map(function (c) { return '<span class="chip">' + esc(c) + "</span>"; }).join("") + "</div></a>";
  }
  function tarjetas() {
    var q = filtro.trim().toLowerCase();
    var lista = fichas.filter(function (f) {
      var n = porId[f.id] || {};
      return !q || [f.id, n.n || "", n.r || ""].concat(n.a || []).join(" ").toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return nombre(a.id).localeCompare(nombre(b.id), "es"); });
    return lista.map(tarjeta).join("") || '<p class="vacio">Ninguna funcionalidad coincide.</p>';
  }
  function pintarCatalogo() {
    if (!fichas.length) {
      raiz.innerHTML = "<h1>Funcionalidades</h1>" +
        '<p class="aviso">Todavía no hay funcionalidades. <code>brain draft &lt;repo&gt;</code> las propone a partir de las carpetas <code>features/</code>, <code>modules/</code> o <code>domains/</code> en <code>_drafts/producto/</code>: revisalas, movelas a <code>producto/</code> y corré <code>brain compile</code>.</p>';
      return;
    }
    var sin = fichas.filter(function (f) { return pendiente((porId[f.id] || {}).r); }).length;
    raiz.innerHTML = "<h1>Funcionalidades</h1>" +
      '<p class="subtitulo">' + plural(fichas.length, "funcionalidad", "funcionalidades") + (sin ? " · " + sin + " sin descripción" : "") + "</p>" +
      '<input id="filtro-feat" type="search" placeholder="Filtrar por nombre o descripción" autocomplete="off">' +
      '<div class="tarjetas" id="tarjetas">' + tarjetas() + "</div>";
    var input = document.getElementById("filtro-feat");
    input.value = filtro;
    input.addEventListener("input", function () { filtro = input.value; document.getElementById("tarjetas").innerHTML = tarjetas(); });
  }

  // ---------- Ficha ----------
  function seccion(titulo, cuerpo) { return cuerpo ? "<section><h2>" + titulo + "</h2>" + cuerpo + "</section>" : ""; }
  function lista(items) { return items.length ? '<ul class="lista">' + items.join("") + "</ul>" : ""; }
  function ficha(id) {
    var f = porFicha[id], n = porId[id];
    if (!f || !n) return '<p>No existe la funcionalidad <code>' + esc(id) + '</code>. <a href="#/funcionalidades">Volver al catálogo</a></p>';
    var desde = function (v) { return D.edges.filter(function (e) { return e.s === id && e.v === v; }).map(function (e) { return e.h; }); };

    var consume = f.usa.filter(function (u) { return u.endpoint; }).map(function (u) {
      var de = (duenas[u.endpoint] || []).filter(function (x) { return x !== id; });
      return "<li><code>" + esc(nombre(u.endpoint)) + "</code><br><small>" + esc(nombre(u.hasta)) +
        (de.length ? " · " + de.map(function (x) { return esc(nombre(x)); }).join(", ") : "") +
        (u.veces > 1 ? " · " + u.veces + " llamadas" : "") + " · <code>" + esc(u.evidencia) + "</code></small></li>";
    });
    var expone = f.expone.map(function (e) {
      var la = (consumidoras[e] || []).filter(function (x) { return x !== id; });
      return "<li><code>" + esc(nombre(e)) + "</code>" + (la.length ? "<br><small>La usan: " + la.map(function (x) { return esc(nombre(x)); }).join(", ") + "</small>" : "") + "</li>";
    });
    var datos = datosDe(f).map(function (d) {
      var que = [d.lee ? "lee" : "", d.escribe ? "escribe" : ""].filter(Boolean).join(" y ");
      return "<li>" + esc(nombre(d.tabla)) + " <small>· " + que + (d.via ? " · a través de " + esc(nombre(d.via)) : "") + "</small></li>";
    });
    var externos = f.usa.filter(function (u) { return porId[u.hasta] && porId[u.hasta].t === "ext"; }).map(function (u) {
      return "<li>" + esc(nombre(u.hasta)) + " <small>· <code>" + esc(u.evidencia) + "</code></small></li>";
    });
    var relacion = (f.usaFuncionalidades.length ? "<p><small>Usa</small><br>" + '<span class="chips">' + f.usaFuncionalidades.map(chipFeat).join("") + "</span></p>" : "") +
      (f.usadaPor.length ? "<p><small>La usan</small><br>" + '<span class="chips">' + f.usadaPor.map(chipFeat).join("") + "</span></p>" : "");
    var equipo = desde("pertenece_a").map(function (t) { return "<li>" + esc(nombre(t)) + "</li>"; });
    var decisiones = desde("decidido_por").map(function (d) { return "<li>" + esc(nombre(d)) + (porId[d] && porId[d].r ? "<br><small>" + esc(porId[d].r) + "</small>" : "") + "</li>"; });
    var codigo = f.codigo.map(function (c) { return "<li><code>" + esc(c) + "</code></li>"; });
    var cuerpo = markdown(f.cuerpo);

    return '<div class="ficha"><div class="texto">' +
      '<a class="volver" href="#/funcionalidades">← Funcionalidades</a>' +
      "<h1>" + esc(n.n) + "</h1>" +
      (pendiente(n.r) ? '<p class="subtitulo pendiente">Sin descripción todavía</p>' : '<p class="subtitulo">' + esc(n.r) + "</p>") +
      (cuerpo || '<p class="aviso">La página no tiene texto. Escribí qué es y cómo se usa en <code>' + esc(n.p || "") + "</code>.</p>") +
      seccion("Qué consume (" + consume.length + ")", lista(consume)) +
      seccion("Qué expone (" + expone.length + ")", lista(expone)) +
      "</div><div>" +
      seccion("Se relaciona con", relacion) +
      seccion("Datos (" + datos.length + ")", lista(datos)) +
      seccion("Servicios externos", lista(externos)) +
      seccion("Equipo", lista(equipo)) +
      seccion("Decisiones", lista(decisiones)) +
      seccion("Código", lista(codigo) + "<p><small>" + plural(f.archivos, "archivo", "archivos") +
        (f.implementan.length ? " · " + f.implementan.map(function (s) { return esc(nombre(s)); }).join(", ") : "") + "</small></p>" +
        (n.p ? '<p><small>Página: <code>' + esc(n.p) + "</code></small></p>" : "")) +
      '<p><a href="#/mapa/' + encodeURIComponent(id) + '">Ver en el mapa técnico →</a></p>' +
      "</div></div>";
  }

  // ---------- Navegación ----------
  function ir() {
    var h = decodeURIComponent(location.hash.replace(/^#/, "")), m;
    var vista = /^\/mapa/.test(h) || (h === "" && !fichas.length) ? "mapa" : "producto";
    document.querySelectorAll("#cabecera nav a").forEach(function (a) { a.classList.toggle("activa", a.getAttribute("data-vista") === vista); });
    raiz.classList.toggle("oculto", vista !== "producto");
    app.classList.toggle("oculto", vista !== "mapa");
    if (vista === "mapa") {
      V.mostrarMapa();
      if ((m = /^\/mapa\/(.+)$/.exec(h))) V.enfocar(m[1]);
      return;
    }
    if ((m = /^\/f\/(.+)$/.exec(h))) raiz.innerHTML = ficha(m[1]);
    else pintarCatalogo();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", ir);
  ir();
})();
`;

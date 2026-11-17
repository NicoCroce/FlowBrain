/**
 * Pantallas del front en el visor: la sección "Pantallas" de cada funcionalidad y la vista "Navegación"
 * (`#/pantallas`, `#/p/<id>`). Muestra qué envuelve a cada pantalla (layouts, guardas y a dónde redirigen), desde dónde
 * se llega, a dónde lleva y el recorrido de punta a punta: lo que ejecuta el front hasta la API y, del otro lado del
 * HTTP, lo que hace el back con ese pedido. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const PANTALLAS_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var P = function () { return window.brainProducto; };
  var raiz = document.getElementById("producto");
  var pantallas = D.pantallas || [], fichas = D.funcionalidades || [];
  var porPant = {}, fichaDe = {}, featsDe = {}, backDe = {}, entran = {};
  pantallas.forEach(function (p) { porPant[p.id] = p; });
  fichas.forEach(function (f) {
    (f.pantallas || []).forEach(function (p) {
      if (!fichaDe[p.id]) fichaDe[p.id] = { f: f, p: p };
      (featsDe[p.id] = featsDe[p.id] || []).push(f.id);
    });
    f.recorridos.forEach(function (r) { if (!backDe[r.endpoint] && r.pasos.length) backDe[r.endpoint] = { f: f, r: r }; });
  });
  D.edges.forEach(function (e) { if (e.v === "navega_a") (entran[e.h] = entran[e.h] || []).push({ desde: e.s, evidencia: e.ev }); });
  var filtro = "";

  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var plural = function (n, uno, varios) { return n + " " + (n === 1 ? uno : varios); };
  var simbolo = function (k) { return k.slice(k.lastIndexOf("#") + 1); };
  var archivo = function (k) { var i = k.indexOf(":"), j = k.lastIndexOf("#"); return k.slice(i + 1, j > i ? j : k.length); };
  var sinRepo = function (ev) { return ev.slice(ev.indexOf(":") + 1); };
  var href = function (id) { return "#/p/" + encodeURIComponent(id); };
  var TIPO = { navega: "navega", enlace: "enlace", redirige: "redirige" };
  function chipPant(id, ruta, tipo) {
    var t = tipo && tipo !== "navega" ? ' <small>' + esc(TIPO[tipo] || tipo) + "</small>" : "";
    if (id && porPant[id]) return '<a class="chip" href="' + href(id) + '">' + esc(porPant[id].ruta) + t + "</a>";
    return '<span class="chip" title="Ruta sin pantalla conocida">' + esc(ruta || id) + t + "</span>";
  }
  var chipFeat = function (id) { return '<a class="chip" href="#/f/' + encodeURIComponent(id) + '">' + esc(nombre(id)) + "</a>"; };
  var chips = function (xs) { return '<div class="chips">' + xs.join("") + "</div>"; };

  // ---------- Lo que se sabe de una pantalla ----------
  function datos(id) {
    var p = porPant[id];
    if (!p) return null;
    var fp = fichaDe[id];
    var llega = (entran[id] || []).map(function (e) { return chipPant(e.desde); });
    var envolturas = (p.desdeEnvolturas || []).map(function (d) {
      return '<span class="chip" title="' + esc(sinRepo(d.evidencia)) + '">' + esc(simbolo(d.componente)) + (d.tipo === "redirige" ? " <small>redirige</small>" : " <small>menú</small>") + "</span>";
    });
    return {
      p: p,
      componente: fp ? fp.p.componente : p.componentes[0] || null,
      feats: featsDe[id] || [],
      envuelta: p.envuelta.map(function (e) {
        var sale = e.sale.map(function (s) { return chipPant(s.a, s.ruta, s.tipo); });
        return "<li><strong>" + esc(simbolo(e.componente)) + "</strong> <small><code>" + esc(archivo(e.componente)) + "</code></small>" +
          (sale.length ? '<div class="chips toca">' + sale.join("") + "</div>" : "") + "</li>";
      }),
      llega: llega.concat(envolturas),
      va: p.sale.map(function (s) { return chipPant(s.a, s.ruta, s.tipo); }),
      recorrido: fp ? fp.p.recorrido : null,
      endpoints: fp ? fp.p.endpoints : []
    };
  }

  // ---------- De punta a punta: front hasta la API, y el back del otro lado ----------
  function backDeEndpoint(ep) {
    var b = backDe[ep];
    var titulo = "<code>" + esc(nombre(ep)) + "</code>";
    if (!b) return '<details class="recorrido"><summary>' + titulo + '<br><small>No se encontró el método que lo atiende en el back.</small></summary></details>';
    return '<details class="recorrido"><summary>' + titulo + "<br><small>" + P().resumenRecorrido(b.r) + " · " + esc(nombre(b.f.id)) + "</small></summary>" +
      P().pasosHtml(b.r.pasos, sinRepo) +
      (b.r.truncado ? '<p class="vacio">Recortado. Completo: <code>brain recorrido "' + esc(nombre(ep)) + '"</code>.</p>' : "") + "</details>";
  }
  function puntaAPunta(x) {
    if (!x.recorrido) return '<p class="vacio">Esta pantalla no está en ninguna funcionalidad: su recorrido no se calculó.</p>';
    var r = x.recorrido;
    var front = r.pasos.length > 1 || x.endpoints.length
      ? P().pasosHtml(r.pasos, sinRepo) + (r.truncado ? '<p class="vacio">El árbol de componentes es grande y se recorrió hasta cierto punto. Completo: <code>brain pantalla ' + esc(x.p.ruta) + "</code>.</p>" : "")
      : '<p class="vacio">No se encontró ninguna llamada al back desde esta pantalla.</p>';
    return "<h4>En el front</h4><p><small>Desde el componente de la pantalla hasta la llamada a la API: los componentes, hooks y funciones del camino.</small></p>" + front +
      (x.endpoints.length ? "<h4>En el back (" + x.endpoints.length + ")</h4><p><small>Qué hace el back con cada pedido: el método que lo atiende y lo que toca.</small></p>" + x.endpoints.map(backDeEndpoint).join("") : "");
  }
  function navegacion(x) {
    return (x.envuelta.length ? "<h4>Envuelta por</h4><p><small>Layouts y guardas, de afuera hacia adentro, con a dónde llevan o redirigen.</small></p>" + '<ul class="lista">' + x.envuelta.join("") + "</ul>" : "") +
      (x.llega.length ? "<h4>Se llega desde (" + x.llega.length + ")</h4>" + chips(x.llega) : '<h4>Se llega desde</h4><p class="vacio">Ninguna pantalla lleva acá: se entra desde afuera (un mail, un callback, la URL).</p>') +
      (x.va.length ? "<h4>Lleva a (" + x.va.length + ")</h4>" + chips(x.va) : "");
  }

  // ---------- Sección en la ficha de una funcionalidad ----------
  function seccionFicha(f) {
    var ps = f.pantallas || [];
    if (!ps.length) return "";
    var abiertas = ps.length === 1;
    return "<section><h2>Pantallas (" + ps.length + ")</h2><p><small>Rutas del front que dibuja esta funcionalidad, cómo se llega a ellas y qué llaman en el back.</small></p>" +
      ps.map(function (pf) {
        var x = datos(pf.id);
        if (!x) return "";
        var resumen = [esc(simbolo(pf.componente || ""))];
        if (pf.endpoints.length) resumen.push("llama a " + pf.endpoints.map(function (e) { return esc(nombre(e)); }).join(", "));
        else resumen.push("no llama al back");
        return "<details" + (abiertas ? " open" : "") + ' class="recorrido"><summary><code>' + esc(pf.ruta) + "</code> · " + resumen.join(" · ") + "</summary>" +
          navegacion(x) + puntaAPunta(x) +
          '<p><small><a href="' + href(pf.id) + '">Ver la pantalla →</a></small></p></details>';
      }).join("") + "</section>";
  }

  // ---------- Vista Navegación ----------
  function fila(p) {
    var x = datos(p.id);
    var meta = [esc(x.componente ? simbolo(x.componente) : "sin componente")];
    if (x.endpoints.length) meta.push(plural(x.endpoints.length, "endpoint", "endpoints"));
    meta.push("llega desde " + x.llega.length + " · lleva a " + x.va.length);
    var guardas = p.envuelta.filter(function (e) { return e.sale.some(function (s) { return s.tipo === "redirige"; }); }).map(function (e) { return simbolo(e.componente); });
    if (guardas.length) meta.push("guarda: " + esc(guardas.join(", ")));
    return '<li><a href="' + href(p.id) + '"><code>' + esc(p.ruta) + "</code></a><br><small>" + meta.join(" · ") + "</small></li>";
  }
  function listado() {
    var q = filtro.trim().toLowerCase();
    var visibles = pantallas.filter(function (p) {
      return !q || [p.ruta].concat(p.componentes.map(simbolo), (featsDe[p.id] || []).map(nombre)).join(" ").toLowerCase().indexOf(q) >= 0;
    });
    var grupos = {}, sin = [];
    visibles.forEach(function (p) { var fs = featsDe[p.id] || []; if (!fs.length) sin.push(p); fs.forEach(function (f) { (grupos[f] = grupos[f] || []).push(p); }); });
    var orden = Object.keys(grupos).sort(function (a, b) { return nombre(a).localeCompare(nombre(b), "es"); });
    var html = orden.map(function (f) {
      return '<section class="grupo-pant"><h3><a href="#/f/' + encodeURIComponent(f) + '">' + esc(nombre(f)) + "</a> <small>" + grupos[f].length + "</small></h3>" +
        '<ul class="lista">' + grupos[f].map(fila).join("") + "</ul></section>";
    }).join("");
    if (sin.length) html += '<section class="grupo-pant"><h3>Sin funcionalidad <small>' + sin.length + '</small></h3><ul class="lista">' + sin.map(fila).join("") + "</ul></section>";
    return html || '<p class="vacio">Ninguna pantalla coincide.</p>';
  }
  function pintarListado() {
    if (!pantallas.length) {
      raiz.innerHTML = "<h1>Navegación</h1>" + '<p class="aviso">No se detectaron pantallas. Se leen de los routers del front (react-router, vue-router, Angular): <code>brain index</code> y <code>brain compile</code>.</p>';
      return;
    }
    var aristas = D.edges.filter(function (e) { return e.v === "navega_a"; }).length;
    raiz.innerHTML = "<h1>Navegación</h1>" +
      '<p class="subtitulo">' + plural(pantallas.length, "pantalla", "pantallas") + " · " + plural(aristas, "enlace", "enlaces") + " entre ellas · agrupadas por funcionalidad</p>" +
      '<input id="filtro-pant" type="search" placeholder="Filtrar por ruta, componente o funcionalidad" autocomplete="off">' +
      '<div id="lista-pant">' + listado() + "</div>";
    var input = document.getElementById("filtro-pant");
    input.value = filtro;
    input.addEventListener("input", function () { filtro = input.value; document.getElementById("lista-pant").innerHTML = listado(); });
  }
  function detalle(id) {
    var x = datos(id);
    if (!x) return '<p>No existe la pantalla <code>' + esc(id) + '</code>. <a href="#/pantallas">Volver a Navegación</a></p>';
    var otros = x.p.componentes.filter(function (c) { return c !== x.componente; });
    return '<div class="ficha"><div class="texto">' +
      '<a class="volver" href="#/pantallas">← Navegación</a>' +
      '<h1 class="ruta">' + esc(x.p.ruta) + "</h1>" +
      '<p class="subtitulo">' + (x.componente ? "Dibuja <strong>" + esc(simbolo(x.componente)) + "</strong> · <code>" + esc(archivo(x.componente)) + "</code>" : "Sin componente detectado") + "</p>" +
      "<section><h2>De punta a punta</h2>" + puntaAPunta(x) + "</section>" +
      "</div><div>" +
      P().seccion("Navegación", navegacion(x)) +
      P().seccion("Funcionalidades", x.feats.length ? chips(x.feats.map(chipFeat)) : '<p class="vacio">Ninguna.</p>') +
      P().seccion("Código", "<p><small>Se declara en <code>" + esc(sinRepo(x.p.evidencia)) + "</code></small></p>" +
        (otros.length ? "<p><small>También la dibujan: " + otros.map(function (c) { return "<code>" + esc(simbolo(c)) + "</code>"; }).join(", ") + "</small></p>" : "")) +
      '<p><a href="#/grafo/' + encodeURIComponent(id) + '">Ver en el mapa 3D →</a></p>' +
      "</div></div>";
  }

  window.brainPantallas = {
    seccionFicha: seccionFicha,
    mostrar: function (h) { var m = /^\/p\/(.+)$/.exec(h); if (m) raiz.innerHTML = detalle(m[1]); else pintarListado(); }
  };
})();
`;

/**
 * Vista de producto del visor: catálogo de funcionalidades y ficha de cada una. Corre en el navegador sobre los
 * datos embebidos (`window.brainVisor.D`); la navegación por `location.hash` está en `viewer-mapa.ts`. Sin dependencias ni red.
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
  var raiz = document.getElementById("producto");
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
  // Con varios cerebros los ids son "cerebro/feat-x". La misma funcionalidad en varios cerebros (mismo id) es una sola
  // tarjeta, con un enlace a la ficha de cada cerebro: el front que la muestra y el back que la atiende.
  var cerebroDe = function (id) { var i = id.indexOf("/"); return i < 0 ? "" : id.slice(0, i); };
  var idBase = function (id) { return id.slice(id.indexOf("/") + 1); };
  function grupos() {
    var g = {}, orden = [];
    fichas.forEach(function (f) {
      var k = idBase(f.id);
      if (!g[k]) { g[k] = []; orden.push(k); }
      g[k].push(f);
    });
    return orden.map(function (k) { return g[k]; });
  }
  function tarjeta(grupo) {
    var f = grupo[0];
    var desc = grupo.map(function (x) { return (porId[x.id] || {}).r; }).filter(function (r) { return !pendiente(r); })[0];
    var archivos = 0, api = 0, tablas = {}, rel = {};
    grupo.forEach(function (x) {
      archivos += x.archivos;
      api += x.expone.length;
      datosDe(x).forEach(function (d) { tablas[d.tabla] = true; });
      x.usaFuncionalidades.concat(x.usadaPor).forEach(function (u) { rel[idBase(u)] = true; });
    });
    var chips = [plural(archivos, "archivo", "archivos")];
    var nr = Object.keys(rel).length, nt = Object.keys(tablas).length;
    if (nr) chips.push(plural(nr, "relacionada", "relacionadas"));
    if (nt) chips.push(plural(nt, "tabla", "tablas"));
    if (api) chips.push("API: " + api);
    var casos = 0;
    grupo.forEach(function (x) { (x.tests || []).forEach(function (t) { casos += t.casos.length; }); });
    chips.push(casos ? plural(casos, "test", "tests") : "sin tests");
    var cuerpo = "<h3>" + esc(nombre(f.id)) + "</h3>" +
      (desc ? "<p>" + esc(desc) + "</p>" : '<p class="pendiente">Sin descripción todavía</p>') +
      '<div class="chips">' + chips.map(function (c) { return '<span class="chip">' + esc(c) + "</span>"; }).join("") + "</div>";
    if (!cerebroDe(f.id)) return '<a class="tarjeta" href="' + hrefFicha(f.id) + '">' + cuerpo + "</a>";
    // Varios enlaces: la tarjeta no puede ser un <a> (no se anidan); el título lleva a la primera ficha.
    return '<div class="tarjeta">' + cuerpo.replace("<h3>" + esc(nombre(f.id)) + "</h3>", '<h3><a href="' + hrefFicha(f.id) + '">' + esc(nombre(f.id)) + "</a></h3>") +
      '<div class="chips cerebros">' + grupo.map(function (x) {
        return '<a class="chip" href="' + hrefFicha(x.id) + '" title="' + esc(nombre(x.id)) + '">' + esc(cerebroDe(x.id)) + "</a>";
      }).join("") + "</div></div>";
  }
  function tarjetas() {
    var q = filtro.trim().toLowerCase();
    var lista = grupos().filter(function (g) {
      return !q || g.some(function (f) {
        var n = porId[f.id] || {};
        return [f.id, n.n || "", n.r || ""].concat(n.a || []).join(" ").toLowerCase().indexOf(q) >= 0;
      });
    }).sort(function (a, b) { return nombre(a[0].id).localeCompare(nombre(b[0].id), "es"); });
    return lista.map(tarjeta).join("") || '<p class="vacio">Ninguna funcionalidad coincide.</p>';
  }
  function pintarCatalogo() {
    if (!fichas.length) {
      raiz.innerHTML = "<h1>Funcionalidades</h1>" +
        '<p class="aviso">Todavía no hay funcionalidades. <code>flowbrain draft &lt;repo&gt;</code> las propone a partir de las carpetas <code>features/</code>, <code>modules/</code> o <code>domains/</code> (o, sin ellas, <code>pages/</code>, <code>screens/</code> o <code>views/</code>) en <code>_drafts/product/</code>. Para completarlas con nombre de negocio y descripción, corré <code>/flowbrain-features</code> en Claude Code, o revisalas a mano y pasalas a <code>product/</code> con <code>flowbrain promote</code>.</p>';
      return;
    }
    var sin = fichas.filter(function (f) { return pendiente((porId[f.id] || {}).r); }).length;
    raiz.innerHTML = "<h1>Funcionalidades</h1>" +
      '<p class="subtitulo">' + plural(grupos().length, "funcionalidad", "funcionalidades") +
      (grupos().length !== fichas.length ? " en " + plural(fichas.length, "ficha", "fichas") + " de sus cerebros" : "") +
      (sin ? " · " + sin + " sin descripción" : "") + "</p>" +
      '<input id="filtro-feat" type="search" placeholder="Filtrar por nombre o descripción" autocomplete="off">' +
      '<div class="tarjetas" id="tarjetas">' + tarjetas() + "</div>";
    var input = document.getElementById("filtro-feat");
    input.value = filtro;
    input.addEventListener("input", function () { filtro = input.value; document.getElementById("tarjetas").innerHTML = tarjetas(); });
  }

  // ---------- Cómo está construida ----------
  var CAPA = { entrada: "Entrada", logica: "Lógica", dominio: "Dominio", datos: "Datos e integraciones", interfaz: "Interfaz", otros: "Otros" };
  var VERBO_TOQUE = { lee_de: "lee", escribe_en: "escribe en", llama_a: "llama a" };
  var capa = function (c) { return '<span class="capa capa-' + esc(c) + '">' + esc(CAPA[c] || c) + "</span>"; };
  function corta(f, archivo) {
    for (var i = 0; i < f.codigo.length; i++) if (archivo.indexOf(f.codigo[i] + "/") === 0) return archivo.slice(f.codigo[i].length + 1);
    return archivo.slice(archivo.indexOf(":") + 1);
  }
  function toque(t) {
    var destino = t.endpoint ? nombre(t.endpoint) + " (" + nombre(t.hasta) + ")" : nombre(t.hasta) + (t.sinPagina ? " · sin página" : "");
    return '<span class="chip">' + esc(VERBO_TOQUE[t.verbo] || t.verbo) + " " + esc(destino) + "</span>";
  }
  // Pasos de un recorrido, indentados por nivel, con lo que toca cada uno. cortar acorta la evidencia.
  function pasosHtml(pasos, cortar) {
    return '<ol class="pasos">' + pasos.map(function (p) {
      return '<li style="margin-left:' + p.nivel * 18 + 'px">' + (p.nivel ? '<span class="flecha">↳</span> ' : "") + capa(p.capa) + " <strong>" + esc(p.simbolo) + "</strong>" +
        ' <small><code>' + esc(cortar(p.evidencia)) + "</code></small>" +
        (p.repite ? ' <small class="vacio">' + (p.repite === "ciclo" ? "(recursivo)" : "(ya recorrido arriba)") + "</small>" : "") +
        (p.aviso ? ' <small class="vacio">⚠ ' + esc(p.aviso) + "</small>" : "") +
        (p.toca.length ? '<div class="chips toca">' + p.toca.map(toque).join("") + "</div>" : "") + "</li>";
    }).join("") + "</ol>";
  }
  function resumenRecorrido(r) {
    var tablas = {}, otros = {};
    r.pasos.forEach(function (p) { p.toca.forEach(function (t) { if (t.verbo === "llama_a") otros[nombre(t.hasta)] = true; else tablas[nombre(t.hasta)] = true; }); });
    var partes = [];
    if (r.pasos.length) partes.push(esc(r.pasos[0].simbolo) + " · " + plural(r.pasos.length, "paso", "pasos") + (r.truncado ? " (recortado)" : ""));
    if (Object.keys(tablas).length) partes.push("tablas: " + esc(Object.keys(tablas).sort().join(", ")));
    if (Object.keys(otros).length) partes.push("llama a: " + esc(Object.keys(otros).sort().join(", ")));
    return partes.join(" · ");
  }
  function recorridos(f) {
    if (!f.recorridos.length) return "";
    var abiertos = f.recorridos.length <= 2;
    return f.recorridos.map(function (r) {
      var cuerpo = r.pasos.length
        ? pasosHtml(r.pasos, function (ev) { return corta(f, ev); })
        : '<p class="vacio">No se encontró el método que atiende este endpoint.</p>';
      if (r.truncado) cuerpo += '<p class="vacio">Recorrido recortado para que se pueda leer. Completo: <code>flowbrain flow "' + esc(nombre(r.endpoint)) + '"</code>.</p>';
      return "<details" + (abiertos ? " open" : "") + ' class="recorrido"><summary><code>' + esc(nombre(r.endpoint)) + "</code><br><small>" + resumenRecorrido(r) + "</small></summary>" + cuerpo + "</details>";
    }).join("");
  }
  function dominio(f) {
    // Primero lo compartido con otras funcionalidades, después lo que define tipos, al final los archivos solo de funciones.
    var peso = function (d) { return d.de || d.usadoPor.length ? 0 : d.elementos.length ? 1 : 2; };
    var orden = f.dominio.slice().sort(function (a, b) { return peso(a) - peso(b) || (a.archivo < b.archivo ? -1 : 1); });
    return orden.map(function (d) {
      var otras = d.usadoPor.length ? "<br><small>También la usan: " + d.usadoPor.map(chipFeat).join(" ") + "</small>" : "";
      var titulo = d.elementos.length ? esc(d.elementos.join(", ")) : '<span class="vacio">' + esc(plural(d.funciones, "función", "funciones")) + "</span>";
      return "<li><strong>" + titulo + "</strong>" +
        "<br><small><code>" + esc(d.archivo.slice(d.archivo.indexOf(":") + 1)) + "</code>" + (d.de ? " · de " + chipFeat(d.de) : "") + "</small>" + otras + "</li>";
    });
  }
  function construida(f) {
    // Para personas: los recorridos y el dominio compartido. Las capas y el detalle de archivos van por la CLI y el MCP.
    var compartido = dominio({ dominio: f.dominio.filter(function (d) { return d.de || d.usadoPor.length; }), codigo: f.codigo });
    if (!f.recorridos.length && !compartido.length) return "";
    return "<section><h2>Cómo está construida</h2>" +
      (f.recorridos.length ? "<h3>Qué ejecuta cada endpoint (" + f.recorridos.length + ")</h3><p><small>Desde el método que atiende el pedido: qué llama y qué datos toca en cada paso.</small></p>" + recorridos(f) : "") +
      (compartido.length ? "<h3>Dominio compartido con otras funcionalidades (" + compartido.length + ")</h3><p><small>Tipos que esta funcionalidad usa y que también usan otras: un cambio acá las afecta.</small></p>" + lista(compartido) : "") +
      "</section>";
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
    // Tests: cada archivo con sus casos (los primeros a la vista, el resto plegado). Sin tests, se dice.
    var tests = f.tests || [], totalCasos = 0;
    tests.forEach(function (t) { totalCasos += t.casos.length; });
    var caso = function (c) { return "<li>" + (c.grupo ? "<small>" + esc(c.grupo) + " ›</small> " : "") + esc(c.nombre) + " <small>L" + c.linea + "</small></li>"; };
    var pruebas = tests.length
      ? "<p><small>Lo que hoy se prueba de esta funcionalidad, tal como lo nombran sus tests. Tocá un archivo para ver sus casos.</small></p>" +
        tests.slice().sort(function (a, b) { return b.casos.length - a.casos.length || (a.archivo < b.archivo ? -1 : 1); }).map(function (t, i) {
          var ruta = t.archivo.slice(t.archivo.indexOf(":") + 1);
          return '<details class="tf"' + (i === 0 ? " open" : "") + "><summary><code>" + esc(ruta) + "</code> <small>· " + plural(t.casos.length, "caso", "casos") + (t.por === "importa" ? " · fuera de su código: es de esta porque es de la que más importa" : "") + "</small></summary>" +
            (t.casos.length ? '<ul class="lista">' + t.casos.map(caso).join("") + "</ul>" : "<p><small>Es un test, pero no se le pudieron leer los casos: los arma al correr o no usa un framework conocido.</small></p>") + "</details>";
        }).join("")
      : '<p class="aviso">No se encontraron tests de esta funcionalidad: ningún archivo de test vive en su código ni importa un archivo suyo. Si los hay y el índice es anterior a esta versión, se ven al reindexar.</p>';

    return '<div class="ficha"><div class="texto">' +
      '<a class="volver" href="#/funcionalidades">← Funcionalidades</a>' +
      "<h1>" + esc(n.n) + "</h1>" +
      (pendiente(n.r) ? '<p class="subtitulo pendiente">Sin descripción todavía</p>' : '<p class="subtitulo">' + esc(n.r) + "</p>") +
      (cuerpo || '<p class="aviso">La página no tiene texto. Escribí qué es y cómo se usa en <code>' + esc(n.p || "") + "</code>.</p>") +
      (window.brainPantallas ? window.brainPantallas.seccionFicha(f) : "") +
      seccion("Qué consume (" + consume.length + ")", lista(consume)) +
      seccion("Qué expone (" + expone.length + ")", lista(expone)) +
      construida(f) +
      "<section><h2>Tests (" + (tests.length ? plural(totalCasos, "caso", "casos") + " en " + plural(tests.length, "archivo", "archivos") : "ninguno") + ")</h2>" + pruebas + "</section>" +
      "</div><div>" +
      seccion("Se relaciona con", relacion) +
      seccion("Datos (" + datos.length + ")", lista(datos)) +
      seccion("Servicios externos", lista(externos)) +
      seccion("Equipo", lista(equipo)) +
      seccion("Decisiones", lista(decisiones)) +
      seccion("Código", lista(codigo) + "<p><small>" + plural(f.archivos, "archivo", "archivos") +
        (f.implementan.length ? " · " + f.implementan.map(function (s) { return esc(nombre(s)); }).join(", ") : "") + "</small></p>" +
        (n.p ? '<p><small>Página: <code>' + esc(n.p) + "</code></small></p>" : "")) +
      '<p><a href="#/grafo/' + encodeURIComponent(id) + '">Verla en el mapa 3D →</a><br><a href="#/impacto/' + encodeURIComponent(id) + '">¿Qué se ve afectado si cambia? →</a></p>' +
      "</div></div>";
  }

  // La navegación entre vistas la hace el enrutador de viewer-mapa.
  window.brainProducto = {
    mostrar: function (h) { var m = /^\/f\/(.+)$/.exec(h); if (m) raiz.innerHTML = ficha(m[1]); else pintarCatalogo(); },
    datosDe: datosDe,
    pasosHtml: pasosHtml,
    resumenRecorrido: resumenRecorrido,
    seccion: seccion,
    pendiente: pendiente
  };
})();
`;

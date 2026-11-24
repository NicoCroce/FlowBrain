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
        var cc = V.colorCerebro ? V.colorCerebro(cerebroDe(x.id)) : "";
        return '<a class="chip" href="' + hrefFicha(x.id) + '" title="' + esc(nombre(x.id)) + '">' + (cc ? '<span class="pc" style="background:' + cc + '"></span>' : "") + esc(cerebroDe(x.id)) + "</a>";
      }).join("") + "</div></div>";
  }
  // El catálogo usa el mismo filtro y estadística que las demás pantallas de lista (viewer-filtros.ts): cifras,
  // grupos, buscador, cerebro y paneles. Un ítem es una tarjeta: la misma funcionalidad en todos sus cerebros.
  var SIN_CEREBRO = "\u0000";
  function info(g) {
    var desc = g.some(function (x) { return !pendiente((porId[x.id] || {}).r); }), tests = 0;
    g.forEach(function (x) { (x.tests || []).forEach(function (t) { tests += t.casos.length; }); });
    var cs = g.map(function (x) { return cerebroDe(x.id); }).filter(Boolean);
    return { g: g, desc: desc, tests: tests, c: cs.length ? cs : [SIN_CEREBRO],
      texto: g.map(function (f) { var n = porId[f.id] || {}; return [f.id, n.n || "", n.r || ""].concat(n.a || []).join(" "); }).join(" ") };
  }
  var ITEMS_FU = null;
  var itemsFu = function () { return ITEMS_FU || (ITEMS_FU = grupos().map(info)); };
  var nCerebros = function () { var v = {}; fichas.forEach(function (f) { var c = cerebroDe(f.id); if (c) v[c] = true; }); return Object.keys(v).length; };
  var fl = window.brainFiltros.crear({
    pre: "fu", clave: "flowbrain.funcionalidades", unidad: ["funcionalidad", "funcionalidades"], todos: "todas las funcionalidades",
    items: itemsFu,
    grupos: [
      { id: "", etiqueta: "Todas" },
      { id: "sindesc", etiqueta: "Sin descripción", palabra: "sin descripción", es: function (x) { return !x.desc; }, ocultarVacio: true },
      { id: "sintests", etiqueta: "Sin tests", palabra: "sin tests", es: function (x) { return !x.tests; }, ocultarVacio: true }
    ],
    buscar: { ph: "Buscar por nombre o descripción…", texto: function (x) { return x.texto; } },
    campos: [
      { id: "cerebro", etiqueta: "Cerebro", propio: "el cerebro elegido", solo: function () { return nCerebros() > 1; }, de: function (x) { return x.c; },
        etiquetaDe: function (v) { return v === SIN_CEREBRO ? "Sin cerebro" : v; }, palabra: function (v) { return "cerebro " + v; } },
      { id: "tests", etiqueta: "Tests", todos: "Con o sin tests", propio: "los tests", de: function (x) { return x.tests ? "si" : "no"; },
        etiquetaDe: function (v) { return v === "si" ? "Con tests" : "Sin tests"; }, palabra: function (v) { return v === "si" ? "con tests" : "sin tests"; } }
    ],
    paneles: [
      { titulo: "Por cerebro", campo: "cerebro" },
      { titulo: "Tests", campo: "tests", orden: "fijo" }
    ],
    cifras: function () {
      var xs = itemsFu(), sinDesc = xs.filter(function (x) { return !x.desc; }).length, sinTests = xs.filter(function (x) { return !x.tests; }).length;
      var out = [[xs.length, "funcionalidades"]];
      if (xs.length !== fichas.length) out.push([fichas.length, "fichas, una por cerebro que la tiene"]);
      out.push([sinDesc, "sin descripción", sinDesc ? "var(--atencion)" : "", "sindesc"]);
      out.push([sinTests, "sin tests", sinTests ? "var(--atencion)" : "", "sintests"]);
      return out;
    },
    alCambiar: function (todo) { if (todo) pintarCatalogo(); else { var l = document.getElementById("tarjetas"); if (l) l.innerHTML = tarjetas(); } }
  });
  function tarjetas() {
    var lista = fl.filtrar().map(function (x) { return x.g; }).sort(function (a, b) { return nombre(a[0].id).localeCompare(nombre(b[0].id), "es"); });
    if (!lista.length) return fl.vacio(itemsFu().length);
    return fl.resultado(lista.length) + '<div class="tarjetas">' + lista.map(tarjeta).join("") + "</div>";
  }
  function pintarCatalogo() {
    if (!fichas.length) {
      raiz.innerHTML = "<h1>Funcionalidades</h1>" +
        '<p class="aviso">Todavía no hay funcionalidades. <code>flowbrain draft &lt;repo&gt;</code> las propone a partir de las carpetas <code>features/</code>, <code>modules/</code> o <code>domains/</code> (o, sin ellas, <code>pages/</code>, <code>screens/</code> o <code>views/</code>) en <code>_drafts/product/</code>. Para completarlas con nombre de negocio y descripción, corré <code>/flowbrain-features</code> en Claude Code, o revisalas a mano y pasalas a <code>product/</code> con <code>flowbrain promote</code>.</p>';
      return;
    }
    raiz.innerHTML = "<h1>Funcionalidades</h1>" +
      '<p class="subtitulo">Lo que el producto le permite hacer a quien lo usa, una tarjeta por funcionalidad: de qué cerebros es, cuánto código tiene, qué tablas y endpoints toca y si tiene tests. Tocá una para ver su ficha.</p>' +
      fl.html() + '<div id="tarjetas">' + tarjetas() + "</div>";
  }
  if (raiz) raiz.addEventListener("click", function (ev) { fl.manejar(ev, "click"); });
  if (raiz) raiz.addEventListener("change", function (ev) { fl.manejar(ev, "change"); });
  if (raiz) raiz.addEventListener("input", function (ev) { fl.manejar(ev, "input"); });

  // De qué cerebro es esta ficha y en cuáles más está la misma funcionalidad (el front que la muestra, el back que la atiende).
  function chipCerebro(id, actual) {
    var c = cerebroDe(id), cc = V.colorCerebro ? V.colorCerebro(c) : "";
    var punto = cc ? '<span class="pc" style="background:' + cc + '"></span>' : "";
    return actual ? '<span class="chip on">' + punto + esc(c) + "</span>" : '<a class="chip" href="' + hrefFicha(id) + '">' + punto + esc(c) + "</a>";
  }
  function enCerebros(f) {
    if (!cerebroDe(f.id)) return "";
    var otras = fichas.filter(function (x) { return x.id !== f.id && idBase(x.id) === idBase(f.id); });
    return '<div class="chips ficha-cerebros">' + chipCerebro(f.id, true) + (otras.length ? '<small class="vacio">También en</small>' + otras.map(function (x) { return chipCerebro(x.id, false); }).join("") : "") + "</div>";
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
      enCerebros(f) +
      (pendiente(n.r) ? '<p class="subtitulo pendiente">Sin descripción todavía</p>' : '<p class="subtitulo">' + esc(n.r) + "</p>") +
      (cuerpo || '<p class="aviso">La página no tiene texto. Escribí qué es y cómo se usa en <code>' + esc(n.p || "") + "</code>.</p>") +
      (window.brainPantallas ? window.brainPantallas.seccionFicha(f) : "") +
      seccion("Qué consume (" + consume.length + ")", lista(consume)) +
      seccion("Qué expone (" + expone.length + ")", lista(expone)) +
      construida(f) +
      "<section><h2>Casos de uso (" + (f.casos || []).length + ")</h2>" + ((f.especificaciones || []).length
        ? "<p>" + ((f.casos || []).length ? (f.casos || []).map(function (c) { return esc(c.nombre); }).join(" · ") + ". " : "Todavía no están agrupadas en casos de uso: hay " + (f.especificaciones || []).length + " reglas escritas, " + (f.especificaciones || []).filter(function (e) { return !e.tests.length; }).length + " sin test. ") + '<a href="#/especificaciones/' + esc(f.id) + '">Ver si están cumplidos</a></p>'
        : '<p class="aviso">Nadie escribió todavía qué se puede hacer con esta funcionalidad. <a href="#/especificaciones">En Especificaciones</a> está el pedido para que el agente lo deduzca del código y de los tests.</p>') + "</section>" +
      "<section><h2>Tests (" + (tests.length ? plural(totalCasos, "caso", "casos") + " en " + plural(tests.length, "archivo", "archivos") : "ninguno") + ")</h2>" + pruebas + "</section>" +
      "</div><div>" +
      seccion("Se relaciona con", relacion) +
      seccion("Datos (" + datos.length + ")", lista(datos)) +
      seccion("Servicios externos", lista(externos)) +
      seccion("Equipo", lista(equipo)) +
      seccion("Decisiones", lista(decisiones)) +
      seccion("Código", lista(codigo) + "<p><small>" + plural(f.archivos, "archivo", "archivos") +
        (f.implementan.length ? " · " + f.implementan.map(function (s) { return esc(nombre(s)); }).join(", ") : "") + "</small></p>" +
        (n.p ? '<p><small>El texto de esta ficha se edita en <code>' + esc(n.p) + "</code></small></p>" : "")) +
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

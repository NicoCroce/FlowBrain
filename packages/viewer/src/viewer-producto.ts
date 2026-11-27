/**
 * Vista de producto del visor: catálogo de funcionalidades y ficha de cada una. Corre en el navegador sobre los
 * datos embebidos (`window.brainVisor.D`); la navegación por `location.hash` está en `viewer-mapa.ts`. Sin dependencias ni red.
 *
 * Pide al agente con el pedido único (`window.brainPedido`, dec. 229 y 233): registra el tipo `funcionalidad`
 * (describir las que no tienen nombre de negocio ni descripción, o proponer las de un cerebro que no tiene ninguna,
 * siempre como borradores en `_drafts/product/`) y, en la ficha, pone el botón del tipo `escribir` de Especificaciones
 * con su misma clave (`escribir|<id>`), así está «✔ En el pedido» en las dos pantallas.
 *
 * Es JavaScript plano dentro de `String.raw`: sin backticks ni `${` (los backticks de Markdown van como \x60).
 */
export const PRODUCTO_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  // Idioma (dec. 214): todo texto visible se arma al pintar con L(inglés, castellano).
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var fichas = D.funcionalidades || [];
  var porFicha = {};
  fichas.forEach(function (f) { porFicha[f.id] = f; });
  var duenas = {};
  fichas.forEach(function (f) { f.expone.forEach(function (e) { (duenas[e] = duenas[e] || []).push(f.id); }); });
  var consumidoras = {};
  fichas.forEach(function (f) { f.usa.forEach(function (u) { if (u.endpoint) (consumidoras[u.endpoint] = consumidoras[u.endpoint] || []).push(f.id); }); });
  var raiz = document.getElementById("producto");
  var PD = window.brainPedido || null, CEREBROS = D.cerebros || [];

  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var pendiente = function (r) { return !r || /^(Borrador|Draft):/.test(r); };
  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
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
      if (/^#\s/.test(l) || /^>\s*(Borrador generado|Draft generated)/.test(l)) return cerrar();
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
    var chips = [plural(archivos, L("file", "archivo"), L("files", "archivos"))];
    var nr = Object.keys(rel).length, nt = Object.keys(tablas).length;
    if (nr) chips.push(plural(nr, L("related", "relacionada"), L("related", "relacionadas")));
    if (nt) chips.push(plural(nt, L("table", "tabla"), L("tables", "tablas")));
    if (api) chips.push("API: " + api);
    var casos = 0;
    grupo.forEach(function (x) { (x.tests || []).forEach(function (t) { casos += t.casos.length; }); });
    chips.push(casos ? plural(casos, "test", "tests") : L("untested", "sin tests"));
    var cuerpo = "<h3>" + esc(nombre(f.id)) + "</h3>" +
      (desc ? "<p>" + esc(desc) + "</p>" : '<p class="pendiente">' + L("No description yet", "Sin descripción todavía") + "</p>") +
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
    // Las etiquetas son funciones: brainFiltros las evalúa al pintar, así siguen el cambio de idioma.
    pre: "fu", clave: "flowbrain.funcionalidades", unidad: function () { return L(["feature", "features"], ["funcionalidad", "funcionalidades"]); }, todos: function () { return L("all features", "todas las funcionalidades"); },
    items: itemsFu,
    grupos: [
      { id: "", etiqueta: function () { return L("All", "Todas"); } },
      { id: "sindesc", etiqueta: function () { return L("No description", "Sin descripción"); }, palabra: function () { return L("no description", "sin descripción"); }, es: function (x) { return !x.desc; }, ocultarVacio: true },
      { id: "sintests", etiqueta: function () { return L("Untested", "Sin tests"); }, palabra: function () { return L("untested", "sin tests"); }, es: function (x) { return !x.tests; }, ocultarVacio: true }
    ],
    buscar: { ph: function () { return L("Search by name or description…", "Buscar por nombre o descripción…"); }, texto: function (x) { return x.texto; } },
    campos: [
      { id: "cerebro", etiqueta: function () { return L("Brain", "Cerebro"); }, propio: function () { return L("the chosen brain", "el cerebro elegido"); }, solo: function () { return nCerebros() > 1; }, de: function (x) { return x.c; },
        etiquetaDe: function (v) { return v === SIN_CEREBRO ? L("No brain", "Sin cerebro") : v; }, palabra: function (v) { return L("brain ", "cerebro ") + v; } },
      { id: "tests", etiqueta: "Tests", todos: function () { return L("With or without tests", "Con o sin tests"); }, propio: function () { return L("the tests", "los tests"); }, de: function (x) { return x.tests ? "si" : "no"; },
        etiquetaDe: function (v) { return v === "si" ? L("With tests", "Con tests") : L("Untested", "Sin tests"); }, palabra: function (v) { return v === "si" ? L("with tests", "con tests") : L("untested", "sin tests"); } }
    ],
    paneles: [
      { titulo: function () { return L("By brain", "Por cerebro"); }, campo: "cerebro" },
      { titulo: "Tests", campo: "tests", orden: "fijo" }
    ],
    cifras: function () {
      var xs = itemsFu(), sinDesc = xs.filter(function (x) { return !x.desc; }).length, sinTests = xs.filter(function (x) { return !x.tests; }).length;
      var out = [[xs.length, L("features", "funcionalidades")]];
      if (xs.length !== fichas.length) out.push([fichas.length, L("cards, one per brain that has it", "fichas, una por cerebro que la tiene")]);
      out.push([sinDesc, L("no description", "sin descripción"), sinDesc ? "var(--atencion)" : "", "sindesc"]);
      out.push([sinTests, L("untested", "sin tests"), sinTests ? "var(--atencion)" : "", "sintests"]);
      return out;
    },
    alCambiar: function (todo) { if (todo) pintarCatalogo(); else { var l = document.getElementById("tarjetas"); if (l) l.innerHTML = tarjetas(); } }
  });
  function tarjetas() {
    var lista = fl.filtrar().map(function (x) { return x.g; }).sort(function (a, b) { return nombre(a[0].id).localeCompare(nombre(b[0].id), L("en", "es")); });
    if (!lista.length) return fl.vacio(itemsFu().length);
    return fl.resultado(lista.length) + barraSinDescripcion() + '<div class="tarjetas">' + lista.map(tarjeta).join("") + "</div>";
  }
  function pintarCatalogo() {
    if (!fichas.length) {
      raiz.innerHTML = "<h1>" + L("Features", "Funcionalidades") + "</h1>" + vacioConAgente();
      return;
    }
    raiz.innerHTML = "<h1>" + L("Features", "Funcionalidades") + "</h1>" +
      '<p class="subtitulo">' + L("What the product lets its users do, one card per feature: which brains it belongs to, how much code it has, which tables and endpoints it touches and whether it has tests. Click one to see its card.",
        "Lo que el producto le permite hacer a quien lo usa, una tarjeta por funcionalidad: de qué cerebros es, cuánto código tiene, qué tablas y endpoints toca y si tiene tests. Tocá una para ver su ficha.") + "</p>" +
      cerebrosSinFuncionalidades() + fl.html() + '<div id="tarjetas">' + tarjetas() + "</div>";
  }
  // Cómo se hace sin el agente: desde la terminal (o a mano). Es la explicación de siempre.
  function porTerminal() {
    return L("<code>flowbrain draft &lt;repo&gt;</code> proposes them from the <code>features/</code>, <code>modules/</code> or <code>domains/</code> folders (or, without them, <code>pages/</code>, <code>screens/</code> or <code>views/</code>) in <code>_drafts/product/</code>. To complete them with a business name and description, run <code>/flowbrain-features</code> in Claude Code, or review them by hand and move them to <code>product/</code> with <code>flowbrain promote</code>.",
          "<code>flowbrain draft &lt;repo&gt;</code> las propone a partir de las carpetas <code>features/</code>, <code>modules/</code> o <code>domains/</code> (o, sin ellas, <code>pages/</code>, <code>screens/</code> o <code>views/</code>) en <code>_drafts/product/</code>. Para completarlas con nombre de negocio y descripción, corré <code>/flowbrain-features</code> en Claude Code, o revisalas a mano y pasalas a <code>product/</code> con <code>flowbrain promote</code>.");
  }
  if (raiz) raiz.addEventListener("click", function (ev) {
    if (fl.manejar(ev, "click")) return;
    // «Pedir»: suma al pedido único o saca lo que ya estaba; el componente cambia los botones sin repintar.
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-acc="pedir"]') : null;
    if (b && !b.disabled && PD) PD.sumar(b.getAttribute("data-tipo"), b.getAttribute("data-k"));
  });
  if (raiz) raiz.addEventListener("change", function (ev) { fl.manejar(ev, "change"); });
  if (raiz) raiz.addEventListener("input", function (ev) { fl.manejar(ev, "input"); });

  // ---------- El pedido al agente: tipo «funcionalidad» (dec. 233) ----------
  // Dos clases de ítem, en un solo tipo y una sola guía (flowbrain features --guide): describir una funcionalidad sin
  // nombre de negocio ni descripción (k = id de la ficha) o proponer las de un cerebro que no tiene ninguna
  // (k = "proponer|<cerebro>", sin funcionalidad). El agente escribe solo borradores en _drafts/product/.
  // Lo que va al modelo, solo en inglés (dec. 214).
  var GUIA_F = "following the flowbrain features --guide guide (in Claude Code: /flowbrain-features)";
  var reposDe = function (c) {
    var i = -1; CEREBROS.forEach(function (x, j) { if (x.nombre === c) i = j; });
    return D.nodes.filter(function (n) { return n.t === "repo" && (i < 0 || n.c === i); }).map(function (n) { return n.n; });
  };
  var conFichas = function (c) { return fichas.some(function (f) { return cerebroDe(f.id) === c; }); };
  // Los cerebros sin ninguna funcionalidad, a los que se les puede pedir que las propongan.
  var sinFuncionalidades = function () { return CEREBROS.map(function (c) { return c.nombre; }).filter(function (c) { return c && !conFichas(c); }); };
  function itemDescribir(f) {
    var c = cerebroDe(f.id), fid = idBase(f.id), n = nombre(f.id);
    var que = [f.expone.length ? f.expone.length + (f.expone.length === 1 ? " endpoint" : " endpoints") : "", f.archivos + (f.archivos === 1 ? " file" : " files")].filter(Boolean).join(", ");
    return { tipo: "funcionalidad", k: f.id, cerebro: c, repo: null, datos: { cerebro: c, funcionalidad: fid, nombre: n, archivos: f.archivos,
      linea: "- " + fid + " (today: " + n + "), brain " + c + ": " + que + ". No business name or description yet." } };
  }
  function itemProponer(c) {
    var rs = reposDe(c);
    return { tipo: "funcionalidad", k: "proponer|" + c, cerebro: c, repo: null, datos: { cerebro: c, funcionalidad: "", repos: rs,
      linea: "- brain " + c + (rs.length ? " (repos: " + rs.join(", ") + ")" : "") + ": it has no features yet." } };
  }
  // Las fichas sin descripción del catálogo, con los filtros de ahora.
  var fichasSinDescripcion = function () {
    var out = [];
    fl.filtrar().forEach(function (x) { x.g.forEach(function (f) { if (pendiente((porId[f.id] || {}).r)) out.push(f); }); });
    return out;
  };
  // Lo que suma cada botón: "f|<id>" (una ficha), "sindesc" (las del catálogo filtrado), "proponer|<cerebro>" o "proponer|" (todos).
  function itemsDelBoton(k) {
    if (k === "sindesc") return fichasSinDescripcion().map(itemDescribir);
    if (k.indexOf("f|") === 0) { var f = porFicha[k.slice(2)]; return f && pendiente((porId[f.id] || {}).r) ? [itemDescribir(f)] : []; }
    if (k.indexOf("proponer|") === 0) { var c = k.slice(9); return (c ? [c] : sinFuncionalidades()).filter(function (x) { return !conFichas(x); }).map(itemProponer); }
    return [];
  }
  var boton = function (k, et) { return PD ? PD.boton({ tipo: "funcionalidad", k: k, et: et }) : ""; };
  function barraSinDescripcion() {
    var n = PD ? fichasSinDescripcion().length : 0;
    if (!n) return "";
    return '<div class="es-cab fu-pedir"><p><small>' + L(plural(n, "card", "cards") + " without a business name or description in this list: the agent writes " + (n === 1 ? "it" : "them") + " from the code, as " + (n === 1 ? "a draft." : "drafts."),
      (n === 1 ? "Una ficha" : num(n) + " fichas") + " sin nombre de negocio ni descripción en esta lista: el agente " + (n === 1 ? "la escribe" : "las escribe") + " a partir del código, como " + (n === 1 ? "borrador." : "borradores.")) + "</small></p>" +
      boton("sindesc", L(n === 1 ? "Request it" : "Request the " + num(n), n === 1 ? "Pedirla" : "Pedir las " + num(n))) + "</div>";
  }
  // Con funcionalidades en unos cerebros y en otros no: el pedido para los que no tienen.
  function cerebrosSinFuncionalidades() {
    var cs = PD ? sinFuncionalidades() : [];
    if (!cs.length) return "";
    return '<section class="fu-proponer"><p class="aviso">' + L(cs.length === 1 ? "The brain " + esc(cs[0]) + " has no features yet." : "These brains have no features yet: " + esc(cs.join(", ")) + ".", cs.length === 1 ? "El cerebro " + esc(cs[0]) + " todavía no tiene funcionalidades." : "Estos cerebros todavía no tienen funcionalidades: " + esc(cs.join(", ")) + ".") + "</p>" +
      '<ul class="lista">' + cs.map(filaProponer).join("") + "</ul></section>";
  }
  function filaProponer(c) {
    var rs = reposDe(c);
    return '<li class="es-fila"><span><strong>' + esc(c) + "</strong>" + (rs.length ? " <small>" + esc(rs.join(", ")) + "</small>" : "") + "</span>" +
      boton("proponer|" + c, L("Request the features", "Pedir que proponga las funcionalidades")) + "</li>";
  }
  // No hay ninguna funcionalidad: el pedido por cerebro, y la terminal como alternativa (o la única, sin cerebros).
  function vacioConAgente() {
    var cs = PD ? sinFuncionalidades() : [];
    if (!cs.length) return '<p class="aviso">' + L("No features yet. ", "Todavía no hay funcionalidades. ") + porTerminal() + "</p>";
    return '<p class="aviso">' + L("No features yet. The agent can propose them from the code of each brain: what the people who use the product can do, with a business name and a description. It writes them as drafts in <code>_drafts/product/</code>, never the repos' code; a person reviews and promotes them.",
        "Todavía no hay funcionalidades. El agente puede proponerlas a partir del código de cada cerebro: lo que puede hacer quien usa el producto, con nombre de negocio y descripción. Las escribe como borradores en <code>_drafts/product/</code>, nunca en el código de los repos; una persona las revisa y las promueve.") + "</p>" +
      '<section class="fu-proponer">' + (cs.length > 1 ? '<div class="es-cab"><h3>' + L("Brains (", "Cerebros (") + num(cs.length) + ")</h3>" + boton("proponer|", L("Request them all", "Pedir todos")) + "</div>" : "") +
      '<ul class="lista">' + cs.map(filaProponer).join("") + "</ul></section>" +
      (PD && PD.agente ? '<details class="tf"><summary>' + L("Or from the terminal", "O desde la terminal") + "</summary><p><small>" + porTerminal() + "</small></p></details>"
        : '<p><small>' + L("Without an agent on this machine, the panel downloads the request as .md for your agent. Or from the terminal: ", "Sin un agente en esta máquina, el panel baja el pedido como .md para tu agente. O desde la terminal: ") + porTerminal() + "</small></p>");
  }
  var clave = function (x) { return x.cerebro + "|" + (x.funcionalidad || ""); };
  function mdFuncionalidades(its) {
    var desc = its.filter(function (it) { return it.datos.funcionalidad; }), prop = its.filter(function (it) { return !it.datos.funcionalidad; }), out = [];
    if (desc.length) out.push("Complete " + (desc.length === 1 ? "this FlowBrain feature" : "these " + desc.length + " FlowBrain features") + " with a business name, a one-line summary and the \"what it is\" section, " + GUIA_F + ". Write each one as a draft: copy its page to .flowbrain/<brain>/_drafts/product/<id>.md (same id, same codigo) and complete it there.", "", desc.map(function (it) { return it.datos.linea; }).join("\n"), "");
    if (prop.length) out.push((prop.length === 1 ? "This FlowBrain brain has" : "These " + prop.length + " FlowBrain brains have") + " no features yet. Propose them " + GUIA_F + ": each one with a business name, a one-line summary, the \"what it is\" section and all of its code.", "", prop.map(function (it) { return it.datos.linea; }).join("\n"), "");
    out.push("Do NOT modify the project's repositories, and do NOT edit product/ or promote anything: write ONLY drafts in .flowbrain/<brain>/_drafts/product/. A person reviews and promotes them.", "");
    return out.join("\n");
  }
  if (PD && raiz) {
    PD.raiz(raiz);
    PD.registrar("funcionalidad", {
      get nombre() { return L("Features", "Funcionalidades"); },
      unidad: ["task", "tasks", "tarea", "tareas"],
      raiz: raiz,
      claves: function (k) { return itemsDelBoton(k).map(function (it) { return it.k; }); },
      items: itemsDelBoton,
      // Primero las propuestas (un cerebro entero), después las fichas por nombre.
      orden: function (a, b) { return (a.datos.funcionalidad ? 1 : 0) - (b.datos.funcionalidad ? 1 : 0) || String(a.datos.nombre || a.datos.cerebro).localeCompare(String(b.datos.nombre || b.datos.cerebro)); },
      resumen: function (its) {
        var p = its.filter(function (it) { return !it.datos.funcionalidad; }).length, d = its.length - p;
        return [[d ? L(plural(d, "card to describe", "cards to describe"), plural(d, "ficha a describir", "fichas a describir")) : "", p ? L(plural(p, "brain to propose features for", "brains to propose features for"), plural(p, "cerebro al que proponerle funcionalidades", "cerebros a los que proponerles funcionalidades")) : ""].filter(Boolean).join(" · "),
          L("Only drafts in _drafts/product/: a person promotes them", "Solo borradores en _drafts/product/: una persona los promueve")];
      },
      costo: function (mo, it) { var c = mo.costoPorPaginaUsd, v = c ? c[it && !it.datos.funcionalidad ? "proponer" : "funcionalidad"] : null; return typeof v === "number" ? v : null; },
      lote: function (its) {
        return { tipo: "funcionalidad", items: its.map(function (it) { var x = it.datos, o = { cerebro: x.cerebro, linea: x.linea }; if (x.funcionalidad) o.funcionalidad = x.funcionalidad; return o; }) };
      },
      md: { archivo: "funcionalidades.md", texto: mdFuncionalidades },
      clave: function (it) { return clave(it.datos); },
      tanda: { lista: "items", clave: clave },
      seguimiento: {
        pidiendo: function (n) { return L("Writing " + plural(n, "draft task", "draft tasks"), "Escribiendo " + plural(n, "tarea de borrador", "tareas de borrador")); }
      },
      tarjeta: function (it) {
        var x = it.datos;
        return '<p class="es-texto">' + esc(x.funcionalidad ? x.nombre : L("Propose the features of " + x.cerebro, "Proponer las funcionalidades de " + x.cerebro)) + '</p><div class="chips">' +
          '<span class="chip">' + (x.funcionalidad ? L("No description", "Sin descripción") : L("No features", "Sin funcionalidades")) + "</span>" +
          (x.funcionalidad ? "" : (x.repos || []).map(function (r) { return '<span class="chip">' + esc(r) + "</span>"; }).join("")) +
          '<span class="chip es-cerebro" title="' + L("Brain", "Cerebro") + '">' + esc(x.cerebro) + "</span></div>";
      }
    });
    // Lo que ya no está pendiente sale de la lista: la ficha ya tiene descripción o el cerebro ya tiene funcionalidades.
    PD.podar("funcionalidad", function (it) {
      var x = it.datos;
      if (!x.funcionalidad) return conFichas(x.cerebro) ? null : it;
      return porFicha[it.k] && !pendiente((porId[it.k] || {}).r) ? null : it;
    });
  }

  // De qué cerebro es esta ficha y en cuáles más está la misma funcionalidad (el front que la muestra, el back que la atiende).
  function chipCerebro(id, actual) {
    var c = cerebroDe(id), cc = V.colorCerebro ? V.colorCerebro(c) : "";
    var punto = cc ? '<span class="pc" style="background:' + cc + '"></span>' : "";
    return actual ? '<span class="chip on">' + punto + esc(c) + "</span>" : '<a class="chip" href="' + hrefFicha(id) + '">' + punto + esc(c) + "</a>";
  }
  function enCerebros(f) {
    if (!cerebroDe(f.id)) return "";
    var otras = fichas.filter(function (x) { return x.id !== f.id && idBase(x.id) === idBase(f.id); });
    return '<div class="chips ficha-cerebros">' + chipCerebro(f.id, true) + (otras.length ? '<small class="vacio">' + L("Also in", "También en") + "</small>" + otras.map(function (x) { return chipCerebro(x.id, false); }).join("") : "") + "</div>";
  }

  // ---------- Cómo está construida ----------
  // Tablas de etiquetas como funciones: se leen al pintar, en el idioma del momento.
  var CAPA = function () { return { entrada: L("Entry", "Entrada"), logica: L("Logic", "Lógica"), dominio: L("Domain", "Dominio"), datos: L("Data and integrations", "Datos e integraciones"), interfaz: L("Interface", "Interfaz"), otros: L("Other", "Otros") }; };
  var VERBO_TOQUE = function () { return { lee_de: L("reads", "lee"), escribe_en: L("writes to", "escribe en"), llama_a: L("calls", "llama a") }; };
  var capa = function (c) { return '<span class="capa capa-' + esc(c) + '">' + esc(CAPA()[c] || c) + "</span>"; };
  function corta(f, archivo) {
    for (var i = 0; i < f.codigo.length; i++) if (archivo.indexOf(f.codigo[i] + "/") === 0) return archivo.slice(f.codigo[i].length + 1);
    return archivo.slice(archivo.indexOf(":") + 1);
  }
  function toque(t) {
    var destino = t.endpoint ? nombre(t.endpoint) + " (" + nombre(t.hasta) + ")" : nombre(t.hasta) + (t.sinPagina ? L(" · no page", " · sin página") : "");
    return '<span class="chip">' + esc(VERBO_TOQUE()[t.verbo] || t.verbo) + " " + esc(destino) + "</span>";
  }
  // Pasos de un recorrido, indentados por nivel, con lo que toca cada uno. cortar acorta la evidencia.
  function pasosHtml(pasos, cortar) {
    return '<ol class="pasos">' + pasos.map(function (p) {
      return '<li style="margin-left:' + p.nivel * 18 + 'px">' + (p.nivel ? '<span class="flecha">↳</span> ' : "") + capa(p.capa) + " <strong>" + esc(p.simbolo) + "</strong>" +
        ' <small><code>' + esc(cortar(p.evidencia)) + "</code></small>" +
        (p.repite ? ' <small class="vacio">' + (p.repite === "ciclo" ? L("(recursive)", "(recursivo)") : L("(already traversed above)", "(ya recorrido arriba)")) + "</small>" : "") +
        (p.aviso ? ' <small class="vacio">⚠ ' + esc(p.aviso) + "</small>" : "") +
        (p.toca.length ? '<div class="chips toca">' + p.toca.map(toque).join("") + "</div>" : "") + "</li>";
    }).join("") + "</ol>";
  }
  function resumenRecorrido(r) {
    var tablas = {}, otros = {};
    r.pasos.forEach(function (p) { p.toca.forEach(function (t) { if (t.verbo === "llama_a") otros[nombre(t.hasta)] = true; else tablas[nombre(t.hasta)] = true; }); });
    var partes = [];
    if (r.pasos.length) partes.push(esc(r.pasos[0].simbolo) + " · " + plural(r.pasos.length, L("step", "paso"), L("steps", "pasos")) + (r.truncado ? L(" (trimmed)", " (recortado)") : ""));
    if (Object.keys(tablas).length) partes.push(L("tables: ", "tablas: ") + esc(Object.keys(tablas).sort().join(", ")));
    if (Object.keys(otros).length) partes.push(L("calls: ", "llama a: ") + esc(Object.keys(otros).sort().join(", ")));
    return partes.join(" · ");
  }
  function recorridos(f) {
    if (!f.recorridos.length) return "";
    var abiertos = f.recorridos.length <= 2;
    return f.recorridos.map(function (r) {
      var cuerpo = r.pasos.length
        ? pasosHtml(r.pasos, function (ev) { return corta(f, ev); })
        : ('<p class="vacio">' + L("The method that handles this endpoint wasn't found.", "No se encontró el método que atiende este endpoint.") + "</p>");
      if (r.truncado) cuerpo += '<p class="vacio">' + L("Flow trimmed to keep it readable. Full flow: ", "Recorrido recortado para que se pueda leer. Completo: ") + '<code>flowbrain flow "' + esc(nombre(r.endpoint)) + '"</code>.</p>';
      return "<details" + (abiertos ? " open" : "") + ' class="recorrido"><summary><code>' + esc(nombre(r.endpoint)) + "</code><br><small>" + resumenRecorrido(r) + "</small></summary>" + cuerpo + "</details>";
    }).join("");
  }
  function dominio(f) {
    // Primero lo compartido con otras funcionalidades, después lo que define tipos, al final los archivos solo de funciones.
    var peso = function (d) { return d.de || d.usadoPor.length ? 0 : d.elementos.length ? 1 : 2; };
    var orden = f.dominio.slice().sort(function (a, b) { return peso(a) - peso(b) || (a.archivo < b.archivo ? -1 : 1); });
    return orden.map(function (d) {
      var otras = d.usadoPor.length ? "<br><small>" + L("Also used by: ", "También la usan: ") + d.usadoPor.map(chipFeat).join(" ") + "</small>" : "";
      var titulo = d.elementos.length ? esc(d.elementos.join(", ")) : '<span class="vacio">' + esc(plural(d.funciones, L("function", "función"), L("functions", "funciones"))) + "</span>";
      return "<li><strong>" + titulo + "</strong>" +
        "<br><small><code>" + esc(d.archivo.slice(d.archivo.indexOf(":") + 1)) + "</code>" + (d.de ? L(" · from ", " · de ") + chipFeat(d.de) : "") + "</small>" + otras + "</li>";
    });
  }
  function construida(f) {
    // Para personas: los recorridos y el dominio compartido. Las capas y el detalle de archivos van por la CLI y el MCP.
    var compartido = dominio({ dominio: f.dominio.filter(function (d) { return d.de || d.usadoPor.length; }), codigo: f.codigo });
    if (!f.recorridos.length && !compartido.length) return "";
    return "<section><h2>" + L("How it's built", "Cómo está construida") + "</h2>" +
      (f.recorridos.length ? "<h3>" + L("What each endpoint runs (", "Qué ejecuta cada endpoint (") + num(f.recorridos.length) + ")</h3><p><small>" + L("From the method that handles the request: what it calls and what data it touches at each step.", "Desde el método que atiende el pedido: qué llama y qué datos toca en cada paso.") + "</small></p>" + recorridos(f) : "") +
      (compartido.length ? "<h3>" + L("Domain shared with other features (", "Dominio compartido con otras funcionalidades (") + num(compartido.length) + ")</h3><p><small>" + L("Types this feature uses that others use too: a change here affects them.", "Tipos que esta funcionalidad usa y que también usan otras: un cambio acá las afecta.") + "</small></p>" + lista(compartido) : "") +
      "</section>";
  }

  // ---------- Ficha ----------
  // Sin casos de uso ni reglas (en ningún cerebro): el mismo pedido «escribir» que Especificaciones, con su clave.
  function sinCasos(f) {
    var nadie = fichas.filter(function (x) { return idBase(x.id) === idBase(f.id); }).every(function (x) { return !(x.especificaciones || []).length; });
    var pedir = nadie && PD ? PD.boton({ tipo: "escribir", k: "escribir|" + idBase(f.id), et: L("Request use cases and specifications", "Pedir casos de uso y especificaciones") }) : "";
    return '<div class="es-cab fu-pedir"><p class="aviso">' + L("Nobody has written yet what can be done with this feature. The agent deduces it from the code and the tests; ", "Nadie escribió todavía qué se puede hacer con esta funcionalidad. Lo deduce el agente a partir del código y de los tests; ") +
      '<a href="#/especificaciones">' + L("Specifications", "Especificaciones") + "</a>" + L(" has the same request for every feature.", " tiene el mismo pedido para todas.") + "</p>" + pedir + "</div>";
  }
  function seccion(titulo, cuerpo) { return cuerpo ? "<section><h2>" + titulo + "</h2>" + cuerpo + "</section>" : ""; }
  function lista(items) { return items.length ? '<ul class="lista">' + items.join("") + "</ul>" : ""; }
  function ficha(id) {
    var f = porFicha[id], n = porId[id];
    if (!f || !n) return "<p>" + L("There's no feature ", "No existe la funcionalidad ") + "<code>" + esc(id) + '</code>. <a href="#/funcionalidades">' + L("Back to the catalog", "Volver al catálogo") + "</a></p>";
    var desde = function (v) { return D.edges.filter(function (e) { return e.s === id && e.v === v; }).map(function (e) { return e.h; }); };

    var consume = f.usa.filter(function (u) { return u.endpoint; }).map(function (u) {
      var de = (duenas[u.endpoint] || []).filter(function (x) { return x !== id; });
      return "<li><code>" + esc(nombre(u.endpoint)) + "</code><br><small>" + esc(nombre(u.hasta)) +
        (de.length ? " · " + de.map(function (x) { return esc(nombre(x)); }).join(", ") : "") +
        (u.veces > 1 ? " · " + num(u.veces) + L(" calls", " llamadas") : "") + " · <code>" + esc(u.evidencia) + "</code></small></li>";
    });
    var expone = f.expone.map(function (e) {
      var la = (consumidoras[e] || []).filter(function (x) { return x !== id; });
      return "<li><code>" + esc(nombre(e)) + "</code>" + (la.length ? "<br><small>" + L("Used by: ", "La usan: ") + la.map(function (x) { return esc(nombre(x)); }).join(", ") + "</small>" : "") + "</li>";
    });
    var datos = datosDe(f).map(function (d) {
      var que = [d.lee ? L("reads", "lee") : "", d.escribe ? L("writes", "escribe") : ""].filter(Boolean).join(L(" and ", " y "));
      return "<li>" + esc(nombre(d.tabla)) + " <small>· " + que + (d.via ? L(" · through ", " · a través de ") + esc(nombre(d.via)) : "") + "</small></li>";
    });
    var externos = f.usa.filter(function (u) { return porId[u.hasta] && porId[u.hasta].t === "ext"; }).map(function (u) {
      return "<li>" + esc(nombre(u.hasta)) + " <small>· <code>" + esc(u.evidencia) + "</code></small></li>";
    });
    var relacion = (f.usaFuncionalidades.length ? "<p><small>" + L("Uses", "Usa") + "</small><br>" + '<span class="chips">' + f.usaFuncionalidades.map(chipFeat).join("") + "</span></p>" : "") +
      (f.usadaPor.length ? "<p><small>" + L("Used by", "La usan") + "</small><br>" + '<span class="chips">' + f.usadaPor.map(chipFeat).join("") + "</span></p>" : "");
    var equipo = desde("pertenece_a").map(function (t) { return "<li>" + esc(nombre(t)) + "</li>"; });
    var decisiones = desde("decidido_por").map(function (d) { return "<li>" + esc(nombre(d)) + (porId[d] && porId[d].r ? "<br><small>" + esc(porId[d].r) + "</small>" : "") + "</li>"; });
    var codigo = f.codigo.map(function (c) { return "<li><code>" + esc(c) + "</code></li>"; });
    var cuerpo = markdown(f.cuerpo);
    // Tests: cada archivo con sus casos (los primeros a la vista, el resto plegado). Sin tests, se dice.
    var tests = f.tests || [], totalCasos = 0;
    tests.forEach(function (t) { totalCasos += t.casos.length; });
    var caso = function (c) { return "<li>" + (c.grupo ? "<small>" + esc(c.grupo) + " ›</small> " : "") + esc(c.nombre) + " <small>L" + c.linea + "</small></li>"; };
    var pruebas = tests.length
      ? "<p><small>" + L("What is tested of this feature today, as its tests name it. Click a file to see its cases.", "Lo que hoy se prueba de esta funcionalidad, tal como lo nombran sus tests. Tocá un archivo para ver sus casos.") + "</small></p>" +
        tests.slice().sort(function (a, b) { return b.casos.length - a.casos.length || (a.archivo < b.archivo ? -1 : 1); }).map(function (t, i) {
          var ruta = t.archivo.slice(t.archivo.indexOf(":") + 1);
          return '<details class="tf"' + (i === 0 ? " open" : "") + "><summary><code>" + esc(ruta) + "</code> <small>· " + plural(t.casos.length, L("case", "caso"), L("cases", "casos")) + (t.por === "importa" ? L(" · outside its code: it belongs here because this is the feature it imports the most", " · fuera de su código: es de esta porque es de la que más importa") : "") + "</small></summary>" +
            (t.casos.length ? '<ul class="lista">' + t.casos.map(caso).join("") + "</ul>" : "<p><small>" + L("It's a test, but its cases couldn't be read: it builds them at runtime or doesn't use a known framework.", "Es un test, pero no se le pudieron leer los casos: los arma al correr o no usa un framework conocido.") + "</small></p>") + "</details>";
        }).join("")
      : '<p class="aviso">' + L("No tests found for this feature: no test file lives in its code or imports one of its files. If there are some and the index predates this version, they show up after you reindex.", "No se encontraron tests de esta funcionalidad: ningún archivo de test vive en su código ni importa un archivo suyo. Si los hay y el índice es anterior a esta versión, se ven al reindexar.") + "</p>";

    return '<div class="ficha"><div class="texto">' +
      '<a class="volver" href="#/funcionalidades">← ' + L("Features", "Funcionalidades") + "</a>" +
      "<h1>" + esc(n.n) + "</h1>" +
      enCerebros(f) +
      (pendiente(n.r) ? '<div class="es-cab fu-pedir"><p class="subtitulo pendiente">' + L("No description yet", "Sin descripción todavía") + "</p>" + boton("f|" + id, L("Request description", "Pedir descripción")) + "</div>" : '<p class="subtitulo">' + esc(n.r) + "</p>") +
      (cuerpo || '<p class="aviso">' + L("The page has no text. Write what it is and how it's used in ", "La página no tiene texto. Escribí qué es y cómo se usa en ") + "<code>" + esc(n.p || "") + "</code>.</p>") +
      (window.brainPantallas ? window.brainPantallas.seccionFicha(f) : "") +
      seccion(L("What it consumes (", "Qué consume (") + num(consume.length) + ")", lista(consume)) +
      seccion(L("What it exposes (", "Qué expone (") + num(expone.length) + ")", lista(expone)) +
      construida(f) +
      "<section><h2>" + L("Use cases (", "Casos de uso (") + num((f.casos || []).length) + ")</h2>" + ((f.especificaciones || []).length
        ? "<p>" + ((f.casos || []).length ? (f.casos || []).map(function (c) { return esc(c.nombre); }).join(" · ") + ". " : (function (nr, ns) { return L("Not grouped into use cases yet: there are " + num(nr) + " written rules, " + num(ns) + " untested. ", "Todavía no están agrupadas en casos de uso: hay " + nr + " reglas escritas, " + ns + " sin test. "); })((f.especificaciones || []).length, (f.especificaciones || []).filter(function (e) { return !e.tests.length; }).length)) + '<a href="#/especificaciones/' + esc(f.id) + '">' + L("See whether they're met", "Ver si están cumplidos") + "</a></p>"
        : sinCasos(f)) + "</section>" +
      "<section><h2>Tests (" + (tests.length ? plural(totalCasos, L("case", "caso"), L("cases", "casos")) + L(" in ", " en ") + plural(tests.length, L("file", "archivo"), L("files", "archivos")) : L("none", "ninguno")) + ")</h2>" + pruebas + "</section>" +
      "</div><div>" +
      seccion(L("Related to", "Se relaciona con"), relacion) +
      seccion(L("Data (", "Datos (") + num(datos.length) + ")", lista(datos)) +
      seccion(L("External services", "Servicios externos"), lista(externos)) +
      seccion(L("Team", "Equipo"), lista(equipo)) +
      seccion(L("Decisions", "Decisiones"), lista(decisiones)) +
      seccion(L("Code", "Código"), lista(codigo) + "<p><small>" + plural(f.archivos, L("file", "archivo"), L("files", "archivos")) +
        (f.implementan.length ? " · " + f.implementan.map(function (s) { return esc(nombre(s)); }).join(", ") : "") + "</small></p>" +
        (n.p ? "<p><small>" + L("This card's text is edited in ", "El texto de esta ficha se edita en ") + "<code>" + esc(n.p) + "</code></small></p>" : "")) +
      '<p><a href="#/grafo/' + encodeURIComponent(id) + '">' + L("See it on the 3D map →", "Verla en el mapa 3D →") + '</a><br><a href="#/impacto/' + encodeURIComponent(id) + '">' + L("What is affected if it changes? →", "¿Qué se ve afectado si cambia? →") + "</a></p>" +
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

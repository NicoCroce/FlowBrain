/**
 * "Sin asociar" (`#/sin-asociar`): los archivos que no son de ninguna funcionalidad ni librería, aislados y agrupados
 * por carpeta, cada uno con la funcionalidad que se le recomienda y por qué. No es un puntaje: es una lista de trabajo.
 * Si la página la sirve `flowbrain viewer --serve`, se asocia ahí mismo (el archivo, o la carpeta entera cuando nada
 * de ella tiene dueño); si no, arma el pedido para el agente. El código compartido se marca aparte: no es de una
 * funcionalidad. Un vacío siempre dice por qué. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const SIN_ASOCIAR_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("sinasociar");
  var CEREBROS = D.cerebros || [];
  var U = D.sinAsociar ? D.sinAsociar.slice() : null;
  var ED = window.FLOWBRAIN_EDICION || null;
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var CAPA_EN = { entrada: "Entry", logica: "Logic", dominio: "Domain", datos: "Data", interfaz: "Interface", otros: "Other" };
  var CAPA_ES = { entrada: "Entrada", logica: "Lógica", dominio: "Dominio", datos: "Datos", interfaz: "Interfaz", otros: "Otros" };
  var capa = function (k) { return L(CAPA_EN[k], CAPA_ES[k]) || k; };
  var PASO = 30, VISIBLES = 8, TOPE_PEDIDO = 80;
  var S = null, fl = null;
  var OTRA = null, MSG = null, PEDIDO = null, ocupado = false, hechos = 0;

  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
  var elem = function (id) { return document.getElementById(id); };
  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var cerebroDe = function (x) { return x.c !== undefined && CEREBROS[x.c] ? CEREBROS[x.c].nombre : ""; };
  // "cerebro/repo-x:ruta" → "repo-x:ruta": el servidor conoce los ids del cerebro, sin el prefijo del visor.
  var local = function (id, x) { var c = cerebroDe(x); return c && id.indexOf(c + "/") === 0 ? id.slice(c.length + 1) : id; };
  var carpetaDe = function (a) { var i = a.lastIndexOf("/"), j = a.indexOf(":"); return i > j ? a.slice(0, i) : a.slice(0, j + 1); };
  var rutaDe = function (a, x) { var l = local(a, x), i = l.indexOf(":"); return i < 0 ? l : l.slice(i + 1); };
  var repoDe = function (a, x) { var l = local(a, x), i = l.indexOf(":"); return i < 0 ? "" : l.slice(0, i); };
  var archivoDe = function (a) { return a.slice(a.lastIndexOf("/") + 1).replace(/^[^:]*:/, ""); };
  var clase = function (x) { return x.g ? "recomendada" : x.m ? "compartido" : "sinpista"; };
  // Funcionalidades con página, del mismo cerebro: a esas se puede asociar.
  var featsDe = function (x) {
    return D.nodes.filter(function (n) { return n.t === "feat" && n.p && (x.c === undefined || n.c === x.c); }).sort(function (a, b) { return a.n.toLowerCase() < b.n.toLowerCase() ? -1 : 1; });
  };

  var filtrados = function () { return fl.filtrar(); };
  function carpetas(xs) {
    var m = {}, orden = [];
    xs.forEach(function (x) { var k = (x.c === undefined ? "" : x.c) + "|" + carpetaDe(x.a); if (!m[k]) { m[k] = { k: k, carpeta: carpetaDe(x.a), xs: [] }; orden.push(m[k]); } m[k].xs.push(x); });
    orden.forEach(function (g) {
      var votos = {}, mejor = null;
      g.xs.forEach(function (x) { if (x.g) votos[x.g[0]] = (votos[x.g[0]] || 0) + 1; });
      Object.keys(votos).sort().forEach(function (id) { if (!mejor || votos[id] > votos[mejor]) mejor = id; });
      // La carpeta tiene recomendada solo si la votan más de la mitad de sus archivos.
      if (mejor && 2 * votos[mejor] <= g.xs.length) mejor = null;
      g.feat = mejor; g.votos = mejor ? votos[mejor] : 0; g.libre = g.xs.every(function (x) { return x.cl; });
    });
    return orden.sort(function (a, b) { return b.xs.length - a.xs.length || (a.carpeta < b.carpeta ? -1 : 1); });
  }

  // ---------- Pedido para el agente ----------
  // Es una instrucción para el modelo: va siempre en inglés, sin importar el idioma del visor.
  function textoDelPedido(xs) {
    var elegidos = xs.slice(0, TOPE_PEDIDO);
    var out = [
      "Assign these " + elegidos.length + " files to their feature in FlowBrain. Today they belong to no feature or library.",
      "To assign one: add " + "repo:path" + " to the codigo list in the frontmatter of the feature's page (the brain's product/feat-*.md) and compile. If a whole folder belongs to the same feature, add the folder.",
      "The recommendation is a hint: open the file before deciding. Shared code does not go to a feature: add it to the codigo of a lib page or leave it unassigned, and tell me. If no feature covers it, propose a new one (flowbrain feature --guide).",
      ""
    ];
    elegidos.forEach(function (x) {
      var c = cerebroDe(x);
      out.push("- " + local(x.a, x) + (c ? " (brain " + c + ")" : "") + ": " +
        (x.g ? "recommended " + local(x.g[0], x) + " (" + x.g[1] + ")" + (x.o ? "; others: " + x.o.map(function (o) { return local(o[0], x); }).join(", ") : "")
          : x.m ? "shared code, used by " + x.m + " features"
          : "no hint: nothing links it to a feature"));
    });
    if (xs.length > elegidos.length) out.push("", (xs.length - elegidos.length) + " more remain for another batch.");
    out.push("", "When done, run " + "flowbrain unassigned" + " to see what is still unassigned and why.");
    return out.join("\n");
  }
  function copiar(texto, listo) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(function () { listo(true); }, function () { listo(false); }); return; }
    } catch (e) { /* sin portapapeles */ }
    listo(false);
  }
  function pedido(xs) {
    if (!PEDIDO) return "";
    return '<div class="fd-plan"><h2>' + L("Request for the agent", "Pedido para el agente") + "</h2>" +
      '<p class="fd-nota">' + L("Brings the files in the list below (up to " + TOPE_PEDIDO + "), each with its recommendation. Paste it into your agent: it opens each file, decides and assigns them.", "Trae los archivos de la lista de abajo (hasta " + TOPE_PEDIDO + "), cada uno con su recomendación. Pegalo en tu agente: abre cada archivo, decide y los asocia.") + "</p>" +
      '<textarea class="fd-texto" readonly rows="10" aria-label="' + L("Request for the agent", "Pedido para el agente") + '">' + esc(textoDelPedido(xs)) + "</textarea>" +
      (PEDIDO.copiado === true ? '<span class="fd-ok">' + L("Copied. Paste it into your agent.", "Copiado. Pegalo en tu agente.") + "</span>" : PEDIDO.copiado === "no" ? '<span class="fd-nota">' + L("Could not copy automatically: select the text and copy it.", "No se pudo copiar solo: seleccioná el texto y copialo.") + "</span>" : "") + "</div>";
  }

  // ---------- Filas ----------
  function selector(clave, x) {
    var fs = featsDe(x);
    if (!fs.length) return '<p class="fd-nota">' + L("This brain has no features with a page yet: create them with <code>/flowbrain-features</code>.", "Este cerebro no tiene funcionalidades con página todavía: se crean con <code>/flowbrain-features</code>.") + "</p>";
    return '<div class="fd-linea sa-otra"><select id="sa-feat" aria-label="' + L("Feature", "Funcionalidad") + '">' + fs.map(function (n) { return '<option value="' + esc(n.id) + '">' + esc(n.n) + "</option>"; }).join("") + "</select>" +
      '<button type="button" class="boton pri" data-acc="asociar-elegida" data-k="' + esc(clave) + '"' + (ocupado ? " disabled" : "") + ">" + L("Assign", "Asociar") + "</button></div>";
  }
  function fila(x) {
    var que = x.g
      ? '<span class="sa-rec">→ <a href="#/f/' + encodeURIComponent(x.g[0]) + '">' + esc(nombre(x.g[0])) + "</a></span> <small>" + esc(x.g[1]) + "</small>"
      : x.m ? '<span class="fd-es na">' + L("Shared code", "Código compartido") + "</span> <small>" + L("Used by " + x.m + " features and none dominates: it fits a library, not a feature.", "Lo usan " + x.m + " funcionalidades y ninguna domina: conviene una librería, no una funcionalidad.") + "</small>"
      : '<span class="fd-es na">' + L("No hint", "Sin pista") + "</span> <small>" + L("Nothing links it to a feature: no imports, no endpoints, no folder neighbors.", "Nada lo une a una funcionalidad: ni imports, ni endpoints, ni vecinos de carpeta.") + "</small>";
    var botones = "";
    if (ED) {
      var a = ' data-a="' + esc(x.a) + '"' + (ocupado ? " disabled" : "");
      botones = (x.g ? '<button type="button" class="boton pri" data-acc="asociar" data-f="' + esc(x.g[0]) + '"' + a + ">" + L("Assign to ", "Asociar a ") + esc(nombre(x.g[0])) + "</button>" : "") +
        (x.o || []).map(function (o) { return '<button type="button" class="boton" data-acc="asociar" data-f="' + esc(o[0]) + '" title="' + esc(o[1]) + '"' + a + ">" + esc(nombre(o[0])) + "</button>"; }).join("") +
        '<button type="button" class="boton' + (OTRA === x.a ? " on" : "") + '" data-acc="otra" data-k="' + esc(x.a) + '">' + (x.g ? L("Another…", "Otra…") : L("Choose feature", "Elegir funcionalidad")) + "</button>";
    }
    return '<li class="sa-fila"><div class="sa-que"><code title="' + esc(local(x.a, x)) + '">' + esc(archivoDe(x.a)) + '</code> <span class="capa capa-' + esc(x.k) + '">' + esc(capa(x.k)) + "</span><div>" + que + "</div></div>" +
      (botones ? '<div class="fd-hacer">' + botones + "</div>" : "") + (OTRA === x.a ? selector(x.a, x) : "") + "</li>";
  }
  function grupo(g) {
    var x0 = g.xs[0], c = CEREBROS.length > 1 ? cerebroDe(x0) : "", ruta = rutaDe(g.carpeta, x0), repo = repoDe(g.carpeta + (ruta ? "" : "x"), x0);
    var rec = g.feat
      ? '<span class="chip">' + L("Recommended: ", "Recomendada: ") + esc(nombre(g.feat)) + (g.votos < g.xs.length ? " (" + g.votos + L(" of ", " de ") + g.xs.length + ")" : "") + "</span>"
      : "";
    var acciones = "";
    if (ED && ruta) {
      var dis = ocupado ? " disabled" : "";
      acciones = g.libre
        ? (g.feat ? '<button type="button" class="boton pri" data-acc="asociar-carpeta" data-k="' + esc(g.k) + '" data-f="' + esc(g.feat) + '"' + dis + ">" + L("Assign the folder to ", "Asociar la carpeta a ") + esc(nombre(g.feat)) + "</button>" : "") +
          '<button type="button" class="boton' + (OTRA === g.k ? " on" : "") + '" data-acc="otra" data-k="' + esc(g.k) + '">' + (g.feat ? L("To another…", "A otra…") : L("Assign the folder…", "Asociar la carpeta…")) + "</button>"
        : "";
    }
    var nota = ED && ruta && !g.libre ? '<p class="fd-nota">' + L("Other files in this folder already belong to a feature: here you assign them one by one.", "Otros archivos de esta carpeta ya son de alguna funcionalidad: acá se asocia de a uno.") + "</p>" : "";
    var visibles = g.xs.slice(0, VISIBLES), resto = g.xs.slice(VISIBLES);
    return '<section class="es-feat"><div class="es-cab"><h3><code>' + esc(ruta ? ruta + "/" : L("(repo root)", "(raíz del repo)")) + "</code>" + (repo ? " <small>" + esc(repo) + "</small>" : "") + "</h3>" +
      '<div class="chips"><span class="chip">' + plural(g.xs.length, L("file", "archivo"), L("files", "archivos")) + "</span>" + rec + (c ? '<span class="chip">' + esc(c) + "</span>" : "") + "</div></div>" +
      (acciones ? '<div class="fd-hacer sa-acc">' + acciones + "</div>" : "") + (OTRA === g.k ? selector(g.k, x0) : "") + nota +
      '<ul class="lista">' + visibles.map(fila).join("") + "</ul>" +
      (resto.length ? '<details class="tf"' + (resto.some(function (x) { return OTRA === x.a; }) ? " open" : "") + "><summary>" + plural(resto.length, L("more file", "archivo más"), L("more files", "archivos más")) + '</summary><ul class="lista">' + resto.map(fila).join("") + "</ul></details>" : "") + "</section>";
  }

  // ---------- Filtro y estadística: el componente compartido (viewer-filtros) ----------
  // La configuración del filtro se arma una vez; sus textos fijos se ponen en textosFiltro() y se rehacen al cambiar de idioma.
  var GRUPOS = ["", "recomendada", "compartido", "sinpista"];
  var CFG = {
    pre: "sa", clave: "flowbrain.sinasociar", unidad: ["file", "files"], todos: "",
    items: function () { return U; },
    estado: { cuantas: PASO },
    grupos: GRUPOS.map(function (g) { return { id: g, es: g ? function (x) { return clase(x) === g; } : null }; }),
    buscar: { ph: "", texto: function (x) { return x.a + " " + (x.g ? nombre(x.g[0]) : ""); } },
    campos: [
      { id: "cerebro", solo: function () { return CEREBROS.length > 1; }, de: function (x) { return x.c; },
        valores: function () { return CEREBROS.map(function (c, i) { return [i, c.nombre, U.filter(function (x) { return x.c === i; }).length]; }); },
        etiquetaDe: function (v) { return CEREBROS[Number(v)] ? CEREBROS[Number(v)].nombre : v; }, palabra: function (v) { return L("brain ", "cerebro ") + (CEREBROS[Number(v)] ? CEREBROS[Number(v)].nombre : v); } },
      { id: "recomendada", ordenPorCantidad: true, de: function (x) { return x.g ? x.g[0] : ""; },
        etiquetaDe: nombre, palabra: function (v) { return L("recommended ", "recomendada ") + nombre(v); } },
      { id: "capa", ordenPorCantidad: true, de: function (x) { return x.k; },
        etiquetaDe: capa, palabra: function (v) { return L("layer ", "capa ") + capa(v); } },
      { id: "repo", ordenPorCantidad: true, de: function (x) { return repoDe(x.a, x); }, palabra: function (v) { return "repo " + v; } }
    ],
    paneles: [
      { campo: "cerebro" },
      { campo: "capa" },
      { campo: "recomendada", max: 8 }
    ],
    cifras: function () {
      var n = function (k) { return U.filter(function (x) { return clase(x) === k; }).length; };
      return [[U.length, L("unassigned files", "archivos sin asociar"), U.length ? "var(--atencion)" : ""], [n("recomendada"), L("with a recommended feature", "con una funcionalidad recomendada"), n("recomendada") ? "var(--bien)" : "", "recomendada"],
        [n("compartido"), L("of shared code", "de código compartido"), "", "compartido"], [n("sinpista"), L("with no hint at all", "sin ninguna pista"), "", "sinpista"], [carpetas(U).length, L("folders", "carpetas")]];
    },
    acciones: function () { return '<button type="button" class="boton' + (PEDIDO ? " on" : "") + '" data-acc="pedido">' + (PEDIDO ? L("Hide request", "Ocultar pedido") : L("Request for the agent", "Pedido para el agente")) + "</button>"; },
    alCambiar: function (todo) { refrescar(todo); }
  };
  // Los textos fijos del filtro, en el idioma actual. Se cambian en el mismo objeto (y la misma lista de unidad), que el
  // componente compartido guardó al crearse.
  function textosFiltro() {
    var g = CFG.grupos, c = CFG.campos, p = CFG.paneles;
    CFG.unidad[0] = L("file", "archivo"); CFG.unidad[1] = L("files", "archivos");
    CFG.todos = L("all unassigned files", "todos los archivos sin asociar");
    CFG.buscar.ph = L("Search by path or by recommended feature…", "Buscar por ruta o por funcionalidad recomendada…");
    g[0].etiqueta = L("All", "Todos"); g[1].etiqueta = L("With a recommendation", "Con recomendación");
    g[2].etiqueta = L("Shared code", "Código compartido"); g[3].etiqueta = L("No hint", "Sin pista");
    c[0].etiqueta = L("Brain", "Cerebro"); c[0].propio = L("the chosen brain", "el cerebro elegido");
    c[1].etiqueta = L("Recommended", "Recomendada"); c[1].todos = L("Any", "Cualquiera"); c[1].propio = L("the chosen recommendation", "la recomendada elegida");
    c[2].etiqueta = L("Layer", "Capa"); c[2].todos = L("All", "Todas"); c[2].propio = L("the chosen layer", "la capa elegida");
    c[3].etiqueta = "Repo"; c[3].propio = L("the chosen repo", "el repo elegido");
    p[0].titulo = L("By brain", "Por cerebro");
    p[1].titulo = L("By layer", "Por capa");
    p[2].titulo = L("Recommended feature", "Funcionalidad recomendada");
    p[2].sinValor = L("no recommendation (shared code or no hint)", "sin recomendación (código compartido o sin pista)");
    p[2].ninguno = L("None has a recommended feature: they are shared code or have no hint.", "Ninguno tiene una funcionalidad recomendada: son código compartido o no tienen pista.");
  }
  if (U) {
    textosFiltro();
    if (window.brainI18n && window.brainI18n.alCambiar) window.brainI18n.alCambiar(textosFiltro);
    fl = window.brainFiltros.crear(CFG);
  }
  if (fl) { S = fl.S(); S.cuantas = PASO; if (S.cerebro !== "" && !CEREBROS[Number(S.cerebro)]) S.cerebro = ""; }
  var guardar = function () { if (fl) fl.guardar(); };
  function lista() {
    var xs = filtrados();
    var msg = MSG ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    if (!xs.length) return msg + fl.vacio(U.length, [L("unassigned file", "archivo sin asociar"), L("unassigned files", "archivos sin asociar")]);
    var cs = carpetas(xs), visibles = cs.slice(0, S.cuantas);
    return msg + pedido(xs) + fl.resultado(xs, L(" in ", " en ") + plural(cs.length, L("folder", "carpeta"), L("folders", "carpetas"))) +
      visibles.map(grupo).join("") +
      (cs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="boton" data-acc="mas">' + L("Show " + Math.min(PASO, cs.length - visibles.length) + " more folders", "Mostrar " + Math.min(PASO, cs.length - visibles.length) + " carpetas más") + "</button> <small>" + num(visibles.length) + L(" of ", " de ") + num(cs.length) + "</small></p>" : "");
  }
  var COMO = function () { return '<p class="subtitulo">' + L("Files that belong to no feature or library, by folder. Each one gets a recommended feature based on who uses it, what it uses, which endpoints it serves and who owns its neighbors. They do not lower the fidelity score: it is a list to complete the catalog.", "Archivos que no son de ninguna funcionalidad ni librería, por carpeta. A cada uno se le recomienda una funcionalidad según quién lo usa, qué usa, qué endpoints atiende y de quién son sus vecinos. No restan puntaje de fidelidad: es una lista para completar el catálogo.") + "</p>"; };
  function aviso() {
    if (!ED) return '<p class="aviso">' + L("This page is read-only: you can see each file's recommendation and build the request for the agent. To assign from here, open it with <code>flowbrain viewer --serve</code>.", "Esta página es de solo lectura: podés ver la recomendación de cada archivo y armar el pedido para el agente. Para asociar desde acá, abrila con <code>flowbrain viewer --serve</code>.") + "</p>";
    return "";
  }
  function pintarLista() { var e = elem("sa-lista"); if (e) e.innerHTML = lista(); }
  var titulo = function () { return "<h1>" + L("Unassigned", "Sin asociar") + "</h1>"; };
  function pintarTodo() {
    if (!U) {
      raiz.innerHTML = titulo() + '<p class="aviso">' + L("There is no code index, so there is no telling which files exist. Run <code>flowbrain index</code> on each repo and then <code>flowbrain compile</code> (or <code>flowbrain brains apply</code>).", "No hay índice de código, así que no se sabe qué archivos hay. Corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code> (o <code>flowbrain brains apply</code>).") + "</p>";
      return;
    }
    if (!(D.funcionalidades || []).length) {
      raiz.innerHTML = titulo() + '<p class="aviso">' + L("There are no features yet, so there is nothing to assign the files to. First deduce the product's features: <code>/flowbrain-features</code> in the agent (or <code>flowbrain feature --guide</code>).", "Todavía no hay funcionalidades, así que no hay a qué asociar los archivos. Primero se deducen las funcionalidades del producto: <code>/flowbrain-features</code> en el agente (o <code>flowbrain feature --guide</code>).") + "</p>";
      return;
    }
    if (!U.length) {
      raiz.innerHTML = titulo() + COMO() + '<p class="aviso">' + (hechos ? L("Done: no unassigned files left.", "Listo: ya no queda ningún archivo sin asociar.") : L("Every file in the index belongs to a feature or library. There is nothing to assign.", "Todos los archivos del índice son de alguna funcionalidad o librería. No hay nada para asociar.")) + "</p>";
      return;
    }
    raiz.innerHTML = titulo() + COMO() + aviso() + fl.html() + '<div id="sa-lista">' + lista() + "</div>";
  }
  function refrescar(todo) { S.cuantas = PASO; if (PEDIDO) PEDIDO.copiado = false; guardar(); if (todo) pintarTodo(); else pintarLista(); }
  var porArchivo = function (a) { for (var i = 0; i < U.length; i++) if (U[i].a === a) return U[i]; return null; };
  var porClave = function (k) { var cs = carpetas(U); for (var i = 0; i < cs.length; i++) if (cs[i].k === k) return cs[i]; return null; };
  // Asocia el archivo x (o su carpeta, si entrada viene) a la funcionalidad. Lo asociado sale de la lista sin recargar.
  function asociar(x, feat, entrada) {
    if (ocupado || !ED || !x || !feat) return;
    ocupado = true; MSG = { texto: L("Saving…", "Guardando…") }; pintarLista();
    var cuerpo = { tipo: "funcionalidad", cerebro: cerebroDe(x), archivo: local(x.a, x), funcionalidad: local(feat, x) };
    if (entrada) cuerpo.entrada = local(entrada, x);
    fetch("/api/editar", { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); })
      .then(function (r) {
        ocupado = false; OTRA = null;
        var antes = U.length;
        U = U.filter(function (y) { return y.c !== x.c || (entrada ? y.a.indexOf(entrada + "/") !== 0 : y.a !== x.a); });
        hechos += antes - U.length;
        // Asociado un archivo suelto, su carpeta y las de arriba ya tienen algo con dueño: dejan de poder asociarse enteras.
        if (!entrada) U.forEach(function (y) { if (y.c === x.c && x.a.indexOf(carpetaDe(y.a) + "/") === 0) delete y.cl; });
        MSG = { texto: r.mensaje + " (" + r.escrito + ")" + (antes - U.length > 1 ? " " + L((antes - U.length) + " files left the list.", (antes - U.length) + " archivos salieron de la lista.") : "") };
        pintarTodo();
      }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; pintarLista(); });
  }

  raiz.addEventListener("click", function (ev) {
    if (fl && fl.manejar(ev, "click")) return;
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k"), g;
    if (acc === "mas") { S.cuantas += PASO; pintarLista(); return; }
    if (acc === "pedido") {
      if (PEDIDO) { PEDIDO = null; pintarTodo(); return; }
      PEDIDO = { copiado: false }; pintarTodo();
      copiar(textoDelPedido(filtrados()), function (ok) { if (PEDIDO) { PEDIDO.copiado = ok ? true : "no"; pintarLista(); } });
      return;
    }
    if (acc === "otra") { OTRA = OTRA === k ? null : k; pintarLista(); return; }
    if (acc === "asociar") { asociar(porArchivo(b.getAttribute("data-a")), b.getAttribute("data-f")); return; }
    if (acc === "asociar-carpeta") { g = porClave(k); if (g) asociar(g.xs[0], b.getAttribute("data-f"), g.carpeta); return; }
    if (acc === "asociar-elegida") {
      var sel = elem("sa-feat"), feat = sel ? String(sel.value || "") : "";
      g = porClave(k);
      if (g) asociar(g.xs[0], feat, g.carpeta); else asociar(porArchivo(k), feat);
      return;
    }
  });
  raiz.addEventListener("change", function (ev) { if (fl) fl.manejar(ev, "change"); });
  raiz.addEventListener("input", function (ev) { if (fl) fl.manejar(ev, "input"); });

  window.brainSinAsociar = { mostrar: pintarTodo };
})();
`;

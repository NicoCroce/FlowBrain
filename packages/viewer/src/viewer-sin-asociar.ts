/**
 * "Sin asociar" (`#/sin-asociar`): los archivos que no son de ninguna funcionalidad ni librería, aislados y agrupados
 * por carpeta, cada uno con la funcionalidad que se le recomienda y por qué. No es un puntaje: es una lista de trabajo.
 * Si la página la sirve `flowbrain viewer --serve`, se asocia ahí mismo (el archivo, o la carpeta entera cuando nada
 * de ella tiene dueño); si no, arma el pedido para el agente. El código compartido se marca aparte: no es de una
 * funcionalidad. Un vacío siempre dice por qué. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 *
 * Cada recomendada lleva su confianza (alta, media o baja: el criterio está en `confianzaDe` del motor), con su
 * etiqueta, su filtro y, con el servidor, «Aceptar las de confianza alta» para asociarlas en lote. El motivo llega
 * estructurado (señal, cantidad, funcionalidad) y se dice en el idioma del visor; el texto en inglés queda para el
 * pedido al agente. «Ver código» muestra el archivo con `/api/archivo?…&contenido=1`: sin servidor no aparece y el
 * aviso de solo lectura dice por qué.
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
  // CODIGO: el archivo abierto con «Ver código» ({ a, d: respuesta del servidor o null mientras lee, error }).
  var CODIGO = null;

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

  // ---------- Confianza y motivo ----------
  // La confianza viene del motor (g[2]); el criterio está documentado en confianzaDe (core/engine/fidelidad.ts).
  var CONF = ["alta", "media", "baja"];
  var CONF_CLASE = { alta: "ok", media: "falta", baja: "na" };
  var CONF_COLOR = { alta: "var(--bien)", media: "var(--atencion)", baja: "var(--suave)" };
  var confDe = function (x) { return x.g && x.g[2] ? x.g[2] : ""; };
  var confEt = function (v) { return v === "alta" ? L("High", "Alta") : v === "media" ? L("Medium", "Media") : v === "baja" ? L("Low", "Baja") : v; };
  var confPorQue = function (v) {
    return v === "alta" ? L("Endpoints or direct imports point to this feature, and it clearly beats the next one.", "Endpoints o imports directos señalan a esta funcionalidad, y le gana clara a la siguiente.")
      : v === "media" ? L("It has direct signals, but another feature is not far behind.", "Tiene señales directas, pero otra funcionalidad no queda lejos.")
      : L("Only folder neighbors point to it, or another feature is almost tied: open the file before deciding.", "Solo la señalan los vecinos de carpeta, o otra funcionalidad está casi empatada: abrí el archivo antes de decidir.");
  };
  var etiquetaConf = function (x) {
    var v = confDe(x);
    return v ? ' <span class="fd-es ' + CONF_CLASE[v] + ' sa-conf" title="' + esc(confPorQue(v)) + '">' + L(confEt(v) + " confidence", "Confianza " + confEt(v).toLowerCase()) + "</span>" : "";
  };
  // El motivo en el idioma del visor, armado de las señales [tipo, cantidad, carpeta?]. Sin señales (datos de antes), el texto del motor.
  function motivoDe(id, texto, senales) {
    if (!senales || !senales.length) return texto || "";
    var f = nombre(id);
    return senales.map(function (s) {
      var n = s[1];
      if (s[0] === "endpoints") return L("serves " + plural(n, "endpoint", "endpoints") + " called by " + f, "atiende " + plural(n, "endpoint", "endpoints") + " que llama " + f);
      if (s[0] === "lo_usan") return L("imported by " + plural(n, "file", "files") + " of " + f, "lo importan " + plural(n, "archivo", "archivos") + " de " + f);
      if (s[0] === "usa") return L("imports " + plural(n, "file", "files") + " of " + f, "importa " + plural(n, "archivo", "archivos") + " de " + f);
      if (s[0] === "vecinos") return L(plural(n, "folder neighbor belongs", "folder neighbors belong") + " to " + f, plural(n, "vecino de carpeta es", "vecinos de carpeta son") + " de " + f);
      if (s[0] === "arriba") return L(plural(n, "file", "files") + " in " + s[2] + "/ " + (n === 1 ? "belongs" : "belong") + " to " + f, plural(n, "archivo", "archivos") + " de " + s[2] + "/ " + (n === 1 ? "es" : "son") + " de " + f);
      return texto || "";
    }).join("; ");
  }
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
      ? '<span class="sa-rec">→ <a href="#/f/' + encodeURIComponent(x.g[0]) + '">' + esc(nombre(x.g[0])) + "</a></span>" + etiquetaConf(x) + " <small>" + esc(motivoDe(x.g[0], x.g[1], x.g[3])) + "</small>"
      : x.m ? '<span class="fd-es na">' + L("Shared code", "Código compartido") + "</span> <small>" + L("Used by " + x.m + " features and none dominates: it fits a library, not a feature.", "Lo usan " + x.m + " funcionalidades y ninguna domina: conviene una librería, no una funcionalidad.") + "</small>"
      : '<span class="fd-es na">' + L("No hint", "Sin pista") + "</span> <small>" + L("Nothing links it to a feature: no imports, no endpoints, no folder neighbors.", "Nada lo une a una funcionalidad: ni imports, ni endpoints, ni vecinos de carpeta.") + "</small>";
    var botones = "";
    if (ED) {
      var a = ' data-a="' + esc(x.a) + '"' + (ocupado ? " disabled" : "");
      botones = (x.g ? '<button type="button" class="boton pri" data-acc="asociar" data-f="' + esc(x.g[0]) + '"' + a + ">" + L("Assign to ", "Asociar a ") + esc(nombre(x.g[0])) + "</button>" : "") +
        (x.o || []).map(function (o) { return '<button type="button" class="boton" data-acc="asociar" data-f="' + esc(o[0]) + '" title="' + esc(motivoDe(o[0], o[1], o[2])) + '"' + a + ">" + esc(nombre(o[0])) + "</button>"; }).join("") +
        '<button type="button" class="boton' + (OTRA === x.a ? " on" : "") + '" data-acc="otra" data-k="' + esc(x.a) + '">' + (x.g ? L("Another…", "Otra…") : L("Choose feature", "Elegir funcionalidad")) + "</button>" +
        '<button type="button" class="boton' + (CODIGO && CODIGO.a === x.a ? " on" : "") + '" data-acc="codigo" data-a="' + esc(x.a) + '">' + (CODIGO && CODIGO.a === x.a ? L("Hide code", "Ocultar código") : L("View code", "Ver código")) + "</button>";
    }
    return '<li class="sa-fila"><div class="sa-que"><code title="' + esc(local(x.a, x)) + '">' + esc(archivoDe(x.a)) + '</code> <span class="capa capa-' + esc(x.k) + '">' + esc(capa(x.k)) + "</span><div>" + que + "</div></div>" +
      (botones ? '<div class="fd-hacer">' + botones + "</div>" : "") + (OTRA === x.a ? selector(x.a, x) : "") + (CODIGO && CODIGO.a === x.a ? panelCodigo(x) : "") + "</li>";
  }
  // ---------- Ver código ----------
  function panelCodigo(x) {
    var d = CODIGO.d, ruta = local(x.a, x);
    if (CODIGO.error) return '<div class="fd-ed sa-codigo"><p class="fd-msg error">' + L("Could not read the file: ", "No se pudo leer el archivo: ") + esc(CODIGO.error) + "</p></div>";
    if (!d) return '<div class="fd-ed sa-codigo"><p class="vacio">' + L("Reading the file…", "Leyendo el archivo…") + "</p></div>";
    if (d.error) return '<div class="fd-ed sa-codigo"><p class="fd-nota">' + L("There is no code to show for <code>" + esc(ruta) + "</code>: ", "No hay código para mostrar de <code>" + esc(ruta) + "</code>: ") + esc(d.error) + "</p></div>";
    var ls = d.lineas || [];
    if (!ls.length || (ls.length === 1 && ls[0] === "")) return '<div class="fd-ed sa-codigo"><p class="fd-nota">' + L("The file <code>" + esc(ruta) + "</code> is empty.", "El archivo <code>" + esc(ruta) + "</code> está vacío.") + "</p></div>";
    var r = d.recortado;
    var nota = !r ? "" : '<p class="fd-nota">' + (r.total === null
      ? L("Showing the first " + num(r.mostradas) + " lines: the file weighs " + num(Math.round(r.bytes / 1024)) + " KB, more than this view shows. Open it in your editor to see the rest.", "Se muestran las primeras " + num(r.mostradas) + " líneas: el archivo pesa " + num(Math.round(r.bytes / 1024)) + " KB, más de lo que muestra esta vista. Abrilo en tu editor para ver el resto.")
      : L("Showing " + num(r.mostradas) + " of " + num(r.total) + " lines. Open it in your editor to see the rest.", "Se muestran " + num(r.mostradas) + " de " + num(r.total) + " líneas. Abrilo en tu editor para ver el resto.")) + "</p>";
    return '<div class="fd-ed sa-codigo"><div class="sa-codigo-cab"><code>' + esc(ruta) + "</code> <small>" + plural(ls.length, L("line", "línea"), L("lines", "líneas")) + "</small></div>" + nota +
      '<pre class="sa-pre">' + ls.map(function (l, i) { return '<span class="sa-ln">' + (i + 1) + "</span>" + esc(l); }).join("\n") + "</pre></div>";
  }
  function verCodigo(a) {
    if (CODIGO && CODIGO.a === a) { CODIGO = null; pintarLista(); return; }
    var x = porArchivo(a);
    if (!x || !ED) return;
    CODIGO = { a: a, d: null }; pintarLista();
    fetch("/api/archivo?cerebro=" + encodeURIComponent(cerebroDe(x)) + "&archivo=" + encodeURIComponent(local(x.a, x)) + "&contenido=1", { method: "GET", headers: { "x-flowbrain-token": ED.token } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); })
      .then(function (d) { if (CODIGO && CODIGO.a === a) { CODIGO.d = d; pintarLista(); } })
      .catch(function (e) { if (CODIGO && CODIGO.a === a) { CODIGO.error = e.message; pintarLista(); } });
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
      (resto.length ? '<details class="tf"' + (resto.some(function (x) { return OTRA === x.a || (CODIGO && CODIGO.a === x.a); }) ? " open" : "") + "><summary>" + plural(resto.length, L("more file", "archivo más"), L("more files", "archivos más")) + '</summary><ul class="lista">' + resto.map(fila).join("") + "</ul></details>" : "") + "</section>";
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
      { id: "repo", ordenPorCantidad: true, de: function (x) { return repoDe(x.a, x); }, palabra: function (v) { return "repo " + v; } },
      { id: "confianza", de: confDe, etiquetaDe: confEt, color: function (v) { return CONF_COLOR[v]; },
        valores: function () { return CONF.map(function (v) { return [v, confEt(v), U.filter(function (x) { return confDe(x) === v; }).length]; }); },
        palabra: function (v) { return L("confidence ", "confianza ") + confEt(v).toLowerCase(); } }
    ],
    paneles: [
      { campo: "cerebro" },
      { campo: "capa" },
      { campo: "recomendada", max: 8 },
      { campo: "confianza", orden: "fijo" }
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
    c[4].etiqueta = L("Confidence", "Confianza"); c[4].todos = L("Any", "Cualquiera"); c[4].propio = L("the chosen confidence", "la confianza elegida");
    p[0].titulo = L("By brain", "Por cerebro");
    p[1].titulo = L("By layer", "Por capa");
    p[2].titulo = L("Recommended feature", "Funcionalidad recomendada");
    p[2].sinValor = L("no recommendation (shared code or no hint)", "sin recomendación (código compartido o sin pista)");
    p[2].ninguno = L("None has a recommended feature: they are shared code or have no hint.", "Ninguno tiene una funcionalidad recomendada: son código compartido o no tienen pista.");
    p[3].titulo = L("Confidence of the recommendation", "Confianza de la recomendación");
    p[3].sinValor = L("no recommendation, so no confidence (shared code or no hint)", "sin recomendación, así que sin confianza (código compartido o sin pista)");
    p[3].ninguno = L("None has a recommended feature, so there is no confidence to show.", "Ninguno tiene una funcionalidad recomendada, así que no hay confianza para mostrar.");
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
    return msg + lote(xs) + pedido(xs) + fl.resultado(xs, L(" in ", " en ") + plural(cs.length, L("folder", "carpeta"), L("folders", "carpetas"))) +
      visibles.map(grupo).join("") +
      (cs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="boton" data-acc="mas">' + L("Show " + Math.min(PASO, cs.length - visibles.length) + " more folders", "Mostrar " + Math.min(PASO, cs.length - visibles.length) + " carpetas más") + "</button> <small>" + num(visibles.length) + L(" of ", " de ") + num(cs.length) + "</small></p>" : "");
  }
  var COMO = function () { return '<p class="subtitulo">' + L("Files that belong to no feature or library, by folder. Each one gets a recommended feature based on who uses it, what it uses, which endpoints it serves and who owns its neighbors. They do not lower the fidelity score: it is a list to complete the catalog.", "Archivos que no son de ninguna funcionalidad ni librería, por carpeta. A cada uno se le recomienda una funcionalidad según quién lo usa, qué usa, qué endpoints atiende y de quién son sus vecinos. No restan puntaje de fidelidad: es una lista para completar el catálogo.") + "</p>"; };
  function aviso() {
    if (!ED) return '<p class="aviso">' + L("This page is read-only: you can see each file's recommendation and build the request for the agent. To assign from here, accept the high-confidence ones in bulk or view each file's code, open it with <code>flowbrain viewer --serve</code>: a static page cannot read the repos.", "Esta página es de solo lectura: podés ver la recomendación de cada archivo y armar el pedido para el agente. Para asociar desde acá, aceptar en lote las de confianza alta o ver el código de cada archivo, abrila con <code>flowbrain viewer --serve</code>: una página estática no puede leer los repos.") + "</p>";
    return "";
  }
  // «Aceptar las de confianza alta»: solo con el servidor; cuenta las de la lista filtrada.
  function lote(xs) {
    if (!ED) return "";
    var n = xs.filter(function (x) { return confDe(x) === "alta"; }).length;
    if (!n) return '<p class="fd-nota sa-lote">' + L("No file in this list has a high-confidence recommendation to accept in bulk: review them one by one, or open the code first.", "Ningún archivo de esta lista tiene una recomendación de confianza alta para aceptar en lote: revisalos de a uno, o abrí el código antes.") + "</p>";
    return '<div class="fd-hacer sa-lote"><button type="button" class="boton pri" data-acc="aceptar-altas"' + (ocupado ? " disabled" : "") + ">" + L("Accept the high-confidence ones", "Aceptar las de confianza alta") + " (" + num(n) + ')</button> <small title="' + esc(confPorQue("alta")) + '">' +
      L("Assigns each one to its recommended feature. Only the files in the list below, with the filters applied.", "Asocia cada uno a su funcionalidad recomendada. Solo los archivos de la lista de abajo, con los filtros aplicados.") + "</small></div>";
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
  // Manda al servidor la asociación del archivo x (o de su carpeta, si entrada viene) a la funcionalidad.
  function pedirAsociar(x, feat, entrada) {
    var cuerpo = { tipo: "funcionalidad", cerebro: cerebroDe(x), archivo: local(x.a, x), funcionalidad: local(feat, x) };
    if (entrada) cuerpo.entrada = local(entrada, x);
    return fetch("/api/editar", { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); });
  }
  // Saca de la lista lo asociado; devuelve cuántos archivos salieron.
  function sacar(x, entrada) {
    var antes = U.length;
    U = U.filter(function (y) { return y.c !== x.c || (entrada ? y.a.indexOf(entrada + "/") !== 0 : y.a !== x.a); });
    // Asociado un archivo suelto, su carpeta y las de arriba ya tienen algo con dueño: dejan de poder asociarse enteras.
    if (!entrada) U.forEach(function (y) { if (y.c === x.c && x.a.indexOf(carpetaDe(y.a) + "/") === 0) delete y.cl; });
    if (CODIGO && !porArchivo(CODIGO.a)) CODIGO = null;
    hechos += antes - U.length;
    return antes - U.length;
  }
  // Asocia el archivo x (o su carpeta, si entrada viene) a la funcionalidad. Lo asociado sale de la lista sin recargar.
  function asociar(x, feat, entrada) {
    if (ocupado || !ED || !x || !feat) return;
    ocupado = true; MSG = { texto: L("Saving…", "Guardando…") }; pintarLista();
    pedirAsociar(x, feat, entrada)
      .then(function (r) {
        ocupado = false; OTRA = null;
        var salieron = sacar(x, entrada);
        MSG = { texto: r.mensaje + " (" + r.escrito + ")" + (salieron > 1 ? " " + L(salieron + " files left the list.", salieron + " archivos salieron de la lista.") : "") };
        pintarTodo();
      }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; pintarLista(); });
  }
  // Asocia en lote, de a uno (cada asociación escribe la página y recompila), las de confianza alta de la lista filtrada.
  function aceptarAltas() {
    if (ocupado || !ED) return;
    var xs = filtrados().filter(function (x) { return confDe(x) === "alta"; });
    if (!xs.length) return;
    var pregunta = L("Assign " + plural(xs.length, "file", "files") + " to their high-confidence recommended feature? Each one is written to its feature's page.", "¿Asociar " + plural(xs.length, "archivo", "archivos") + " a su funcionalidad recomendada de confianza alta? Cada uno se escribe en la página de su funcionalidad.");
    if (!window.confirm || !window.confirm(pregunta)) return;
    ocupado = true; OTRA = null;
    var bien = 0, errores = [];
    var paso = function (i) {
      if (i >= xs.length) {
        ocupado = false;
        MSG = errores.length
          ? { texto: L(plural(bien, "file was", "files were") + " assigned; " + plural(errores.length, "failed", "failed") + ": ", plural(bien, "archivo se asoció", "archivos se asociaron") + "; " + plural(errores.length, "falló", "fallaron") + ": ") + errores.join("; "), error: true }
          : { texto: L(plural(bien, "file was", "files were") + " assigned to " + (bien === 1 ? "its" : "their") + " recommended feature.", plural(bien, "archivo se asoció", "archivos se asociaron") + " a su funcionalidad recomendada.") };
        pintarTodo();
        return;
      }
      var x = xs[i];
      MSG = { texto: L("Assigning " + num(i + 1) + " of " + num(xs.length) + "…", "Asociando " + num(i + 1) + " de " + num(xs.length) + "…") }; pintarLista();
      pedirAsociar(x, x.g[0])
        .then(function () { bien++; sacar(x); }, function (e) { errores.push(local(x.a, x) + ": " + e.message); })
        .then(function () { paso(i + 1); });
    };
    paso(0);
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
    if (acc === "codigo") { verCodigo(b.getAttribute("data-a")); return; }
    if (acc === "aceptar-altas") { aceptarAltas(); return; }
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

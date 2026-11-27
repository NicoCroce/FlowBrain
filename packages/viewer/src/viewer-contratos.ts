/**
 * "Contratos" (`#/contratos`): dos controles sobre lo que los servicios se prometen entre sí.
 * - Deriva: llamadas que nadie atiende y endpoints que nadie llama, por cerebro. Viene calculada por el motor (con los
 *   cruces entre cerebros): lo que atiende o llama otro cerebro comunicado no es deriva, y se muestra aparte. También
 *   los campos de cada llamada unida que no coinciden con lo que declara el endpoint, y lo que no se pudo comparar.
 * - Paridad: se eligen dos servicios (el que se reemplaza y el que lo reemplaza, del mismo cerebro o de dos) y se ve qué
 *   ya está del otro lado, qué falta y dónde difieren las tablas. Se calcula acá, con la misma regla que `paridad` del
 *   motor: método y ruta sin el nombre de los parámetros, prefijo fijo descontado, y entre cerebros las tablas por
 *   nombre sin separadores.
 * Cada problema de la deriva se suma al pedido al agente, el componente único del visor (`window.brainPedido`, dec.
 * 232): «Pedir» en cada problema y «Pedir los N» por sección o servicio; de ahí sale en lote (tandas por repo) o como
 * .md. Un endpoint que nadie llama a propósito (un webhook, un cliente afuera) se marca «Sin uso a propósito»: se
 * guarda en el cerebro como «No es de producto» (`not-product.yaml`, motivo `sin-uso`), sale de la deriva y se
 * deshace desde la misma pantalla.
 * Un vacío siempre dice por qué. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const CONTRATOS_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("contratos");
  var CEREBROS = D.cerebros || [];
  var DERIVA = D.deriva || null;
  var PASO = 100;
  // tab, los dos servicios de la paridad y cuánto se ve de cada lista. El filtro de cada pestaña lo guarda su componente.
  var inicial = function () { return { tab: "deriva", viejo: "", nuevo: "", ver: {} }; };
  var S = inicial();
  var CLAVE = "flowbrain.contratos";
  var guardar = function () { try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLAVE, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ } };
  try {
    var previo = typeof sessionStorage !== "undefined" ? JSON.parse(sessionStorage.getItem(CLAVE) || "null") : null;
    if (previo) Object.keys(S).forEach(function (k) { if (typeof previo[k] === typeof S[k]) S[k] = previo[k]; });
    S.ver = {};
  } catch (e) { /* sin almacenamiento */ }

  // Idioma (dec. 214): todo texto visible se arma al pintar con L(inglés, castellano).
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
  var elem = function (id) { return document.getElementById(id); };
  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var cerebroDe = function (id) { var n = porId[id]; return n && n.c !== undefined && CEREBROS[n.c] ? CEREBROS[n.c].nombre : ""; };
  // "cerebro/svc-x:GET:/ruta" → "svc-x:GET:/ruta"
  var local = function (id) { var c = cerebroDe(id); return c && id.indexOf(c + "/") === 0 ? id.slice(c.length + 1) : id; };
  // Un endpoint se lee como "GET /ruta"; lo que no es un endpoint conocido, como viene.
  var pieza = function (id) {
    var n = porId[id], a = n && n.at;
    if (a && a.ruta !== undefined) return (a.metodo ? a.metodo + " " : "") + a.ruta;
    var m = /:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CRON|GRPC):(\/.*)$/.exec(id);
    if (m) return m[1] + " " + m[2];
    m = /:pantalla:(.*)$/.exec(id);
    return m ? m[1] : local(id);
  };
  var cifra = function (valor, texto, color) { return '<div class="fd-cifra"><b' + (color ? ' style="color:' + color + '"' : "") + ">" + (typeof valor === "number" ? num(valor) : valor) + "</b><span>" + texto + "</span></div>"; };
  // Una lista larga se corta y ofrece seguir: clave identifica la lista.
  function listaCortada(clave, items, fila) {
    if (!items.length) return "";
    var n = S.ver[clave] || PASO, visibles = items.slice(0, n);
    return '<ul class="lista">' + visibles.map(fila).join("") + "</ul>" +
      (items.length > visibles.length ? '<p class="fd-mas"><button type="button" class="boton" data-acc="mas" data-k="' + esc(clave) + '">' + L("Show " + num(Math.min(PASO, items.length - visibles.length)) + " more", "Mostrar " + Math.min(PASO, items.length - visibles.length) + " más") + "</button> <small>" + num(visibles.length) + L(" of ", " de ") + num(items.length) + "</small></p>" : "");
  }
  function seccion(titulo, n, cuerpo, abierta) {
    return '<details class="es-feat ct-sec"' + (abierta ? " open" : "") + "><summary><h3>" + titulo + ' <small>' + num(n) + "</small></h3></summary>" + cuerpo + "</details>";
  }

  // ---------- Deriva ----------
  // Una sola lista con los problemas de todos los cerebros: llamadas que nadie atiende, endpoints que nadie llama,
  // llamadas con varios candidatos y campos que no coinciden. El filtro y la estadística son el componente compartido.
  // Se lee al pintar: las etiquetas siguen el idioma.
  var TIPOS_D = function () { return [["sinEndpoint", L("Nobody handles them", "Nadie las atiende")], ["sinLlamadas", L("Nobody calls them", "Nadie los llama")], ["disputada", L("Several candidates", "Varios candidatos")], ["campos", L("Mismatched fields", "Campos distintos")]]; };
  var tipoD = function (id) { var t = TIPOS_D().filter(function (x) { return x[0] === id; })[0]; return t ? t[1] : id; };
  var svcDeId = function (id) { var s = String(id || ""), i = s.indexOf(":"); return i < 0 ? s : s.slice(0, i); };
  var metodoDe = function (texto) { var m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CRON|GRPC)\b/.exec(String(texto || "")); return m ? m[1] : ""; };
  var cerebroD = function (d, i) { return d.c !== undefined ? d.c : i; };
  // Los problemas, uno por fila; k: su clave en la lista y en el pedido al agente. Se rearman al marcar un endpoint
  // «Sin uso a propósito» (sale de la deriva) o al deshacerlo (vuelve).
  var ITEMS_D = [], ITEM_POR_K = {};
  function armarItems() {
    ITEMS_D = []; ITEM_POR_K = {};
    var sumar = function (it) { it.k = it.t + "|" + it.c + "|" + (it.t === "sinLlamadas" ? it.x.e : it.x.ev + "|" + it.x.l); ITEMS_D.push(it); ITEM_POR_K[it.k] = it; };
    (DERIVA || []).forEach(function (d, i) {
      var c = cerebroD(d, i);
      d.sinEndpoint.forEach(function (x) { sumar({ t: "sinEndpoint", c: c, svc: svcDeId(x.d), m: metodoDe(x.l), x: x, texto: x.l + " " + x.ev + " " + nombre(x.d) }); });
      d.disputadas.concat(d.ambiguas).forEach(function (x) { sumar({ t: "disputada", c: c, svc: svcDeId(x.d), m: metodoDe(x.l), x: x, texto: x.l + " " + x.ev }); });
      var svcs = Object.keys(d.consumidores);
      d.sinLlamadas.forEach(function (x) {
        var s = svcDeId(x.e);
        svcs.forEach(function (k) { if (x.e.indexOf(k + ":") === 0) s = k; });
        sumar({ t: "sinLlamadas", c: c, svc: s, m: metodoDe(pieza(x.e)), x: x, texto: pieza(x.e) + " " + x.ev });
      });
      (d.difieren || []).forEach(function (x) { sumar({ t: "campos", c: c, svc: svcDeId(x.e), m: metodoDe(x.l), x: x, texto: x.l + " " + x.ev + " " + x.e + " " + JSON.stringify([x.cuerpo, x.query, x.respuesta]) }); });
    });
  }
  armarItems();
  var nombreCerebro = function (v) { return CEREBROS[Number(v)] ? CEREBROS[Number(v)].nombre : String(v); };
  var nombreSvc = function (s) { return porId[s] ? nombre(s) : local(s); };
  var flD = DERIVA ? window.brainFiltros.crear({
    // Las etiquetas son funciones: brainFiltros las evalúa al pintar, así siguen el cambio de idioma.
    pre: "ct", clave: "flowbrain.contratos.deriva", unidad: function () { return L(["problem", "problems"], ["problema", "problemas"]); }, todos: function () { return L("everything that doesn't add up", "todo lo que no cierra"); },
    items: function () { return ITEMS_D; },
    grupos: [{ id: "", etiqueta: function () { return L("All", "Todo"); } }].concat(TIPOS_D().map(function (t) { return { id: t[0], etiqueta: function () { return tipoD(t[0]); }, palabra: function () { return tipoD(t[0]).toLowerCase(); }, es: function (x) { return x.t === t[0]; }, ocultarVacio: t[0] === "disputada" }; })),
    buscar: { ph: function () { return L("Search a route, a service or a file…", "Buscar una ruta, un servicio o un archivo…"); }, texto: function (x) { return x.texto; } },
    campos: [
      { id: "cerebro", etiqueta: function () { return L("Brain", "Cerebro"); }, propio: function () { return L("the chosen brain", "el cerebro elegido"); }, solo: function () { return DERIVA.length > 1; }, de: function (x) { return x.c; },
        valores: function () { return DERIVA.map(function (d, i) { var c = cerebroD(d, i); return [c, nombreCerebro(c), ITEMS_D.filter(function (x) { return x.c === c; }).length]; }); },
        etiquetaDe: nombreCerebro, palabra: function (v) { return L("brain ", "cerebro ") + nombreCerebro(v); } },
      { id: "servicio", etiqueta: function () { return L("Service", "Servicio"); }, propio: function () { return L("the chosen service", "el servicio elegido"); }, ordenPorCantidad: true, de: function (x) { return x.svc; }, etiquetaDe: nombreSvc, palabra: function (v) { return L("service ", "servicio ") + nombreSvc(v); } },
      { id: "metodo", etiqueta: function () { return L("Method", "Método"); }, propio: function () { return L("the chosen method", "el método elegido"); }, ordenPorCantidad: true, de: function (x) { return x.m; }, palabra: function (v) { return L("method ", "método ") + v; } }
    ],
    paneles: [
      { titulo: function () { return L("By brain", "Por cerebro"); }, campo: "cerebro" },
      { titulo: function () { return L("By service", "Por servicio"); }, campo: "servicio", max: 8 },
      { titulo: function () { return L("By method", "Por método"); }, campo: "metodo", sinValor: function () { return L("no HTTP method (routes that couldn't be read, or queues)", "sin método HTTP (rutas que no se pudieron leer o colas)"); } }
    ],
    cifras: function () {
      var ds = alcance(), n = function (f) { var s = 0; ds.forEach(function (d) { s += f(d); }); return s; };
      var sinEp = n(function (d) { return d.sinEndpoint.length; }), atendidas = n(function (d) { var s = 0; d.atendidas.forEach(function (a) { s += a.llamadas; }); return s; });
      var disp = n(function (d) { return d.disputadas.length; }), sinLl = n(function (d) { return d.sinLlamadas.length; }), conDif = n(function (d) { return d.campos ? d.campos.conDiferencias : 0; });
      var out = [[sinEp, L("calls nobody handles", "llamadas que nadie atiende"), sinEp ? "var(--mal)" : "var(--bien)", "sinEndpoint"]];
      if (ds.some(function (d) { return d.comunicadoCon; })) out.push([atendidas, L("calls handled by another brain", "llamadas que atiende otro cerebro")]);
      if (disp) out.push([disp, L("disputed between brains", "en disputa entre cerebros"), "var(--atencion)", "disputada"]);
      out.push([sinLl, L("endpoints nobody calls", "endpoints que nadie llama"), sinLl ? "var(--atencion)" : "", "sinLlamadas"]);
      if (ds.some(function (d) { return d.campos && d.campos.llamadasUnidas; })) out.push([conDif, L("with mismatched fields", "con campos que no coinciden"), conDif ? "var(--mal)" : "var(--bien)", "campos"]);
      return out;
    },
    alCambiar: function (todo) { refrescar(todo); }
  }) : null;
  // Los cerebros que entran: el elegido en el filtro, o todos.
  function alcance() {
    var s = flD.S().cerebro;
    return DERIVA.filter(function (d, i) { return s === "" || String(cerebroD(d, i)) === s; });
  }
  var conCerebro = function (x) { return DERIVA.length > 1 ? ' <span class="chip">' + esc(nombreCerebro(x.c)) + "</span>" : ""; };
  function llamada(x, extra, it) {
    return "<li><code>" + esc(x.l) + "</code> <small>" + L("from ", "desde ") + esc(nombre(x.d)) + " · <code>" + esc(x.ev) + "</code></small>" + (it ? conCerebro(it) : "") + (extra || "") + (it ? hacer(it) : "") + "</li>";
  }
  var ninguno = function () { return '<p class="aviso">' + L("Nothing matches ", "Ninguno coincide con ") + esc(flD.activos().join(", ")) + ".</p>"; };
  // Lo de cada cerebro que no es una lista: con quién se cruza, lo que atiende otro, lo que no se pudo medir.
  function contexto(ds) {
    var varios = ds.length > 1, quien = function (d, i) { return varios ? "<strong>" + esc(nombreCerebro(cerebroD(d, i))) + "</strong>: " : ""; };
    var cruces = ds.map(function (d, i) {
      if (d.comunicadoCon === null || d.comunicadoCon === undefined) return "";
      return d.comunicadoCon.length
        ? '<p class="explica">' + quien(d, i) + L("Cross-referenced with ", "Cruzado con ") + d.comunicadoCon.map(esc).join(", ") + L(": whatever one of those brains handles or calls doesn't count as drift.", ": lo que atiende o llama uno de esos cerebros no cuenta como deriva.") +
          (d.internas ? L(" Neither " + (d.internas === 1 ? "does the call" : "do the " + num(d.internas) + " calls") + " to the service's own server that <code>flowbrain.yaml</code> declares internal (<code>internas</code>).",
            " Tampoco " + (d.internas === 1 ? "la llamada" : "las " + num(d.internas) + " llamadas") + " al propio servidor que <code>flowbrain.yaml</code> declara " + (d.internas === 1 ? "interna" : "internas") + " (<code>internas</code>).") : "") + "</p>"
        : '<p class="aviso">' + quien(d, i) + (varios ? L("has", "no tiene") : L("This brain has", "Este cerebro no tiene")) + L(" no active communication with any other: every outside call shows up as having no endpoint. Turn it on in <code>flowbrain.yaml</code> (<code>comunicacion</code>).", " la comunicación activa con ningún otro: todo lo que llame afuera figura como sin endpoint. Se activa en <code>flowbrain.yaml</code> (<code>comunicacion</code>).") + "</p>";
    }).join("");
    // Con varios cerebros, una línea por cerebro repetía la misma explicación: va una sola vez, con quién se cruza cada uno.
    if (varios) {
      var con = [], sin = [], internas = 0;
      ds.forEach(function (d, i) {
        if (d.comunicadoCon === null || d.comunicadoCon === undefined) return;
        var n = esc(nombreCerebro(cerebroD(d, i)));
        if (d.comunicadoCon.length) con.push("<strong>" + n + "</strong>" + L(" with ", " con ") + d.comunicadoCon.map(esc).join(", ")); else sin.push("<strong>" + n + "</strong>");
        internas += d.internas || 0;
      });
      cruces = (con.length ? '<p class="aviso">' + L("Each brain is cross-referenced with the ones it communicates with: ", "Cada cerebro se cruza con los que se comunica: ") + con.join(" · ") + L(". Whatever one of those brains handles or calls doesn't count as drift.", ". Lo que atiende o llama uno de esos cerebros no cuenta como deriva.") +
          (internas ? L(" Neither do " + plural(internas, "call", "calls") + " to the service's own server that <code>flowbrain.yaml</code> declares internal (<code>internas</code>).", " Tampoco " + plural(internas, "llamada", "llamadas") + " al propio servidor que <code>flowbrain.yaml</code> declara internas (<code>internas</code>).") : "") + "</p>" : "") +
        (sin.length ? '<p class="aviso">' + sin.join(", ") + L((sin.length === 1 ? " has" : " have") + " no active communication with any other: every outside call shows up as having no endpoint. Turn it on in <code>flowbrain.yaml</code> (<code>comunicacion</code>).",
          (sin.length === 1 ? " no tiene" : " no tienen") + " la comunicación activa con ningún otro: todo lo que " + (sin.length === 1 ? "llame" : "llamen") + " afuera figura como sin endpoint. Se activa en <code>flowbrain.yaml</code> (<code>comunicacion</code>).") + "</p>" : "");
    }
    var at = [], total = 0;
    ds.forEach(function (d) { d.atendidas.forEach(function (a) { at.push(a); total += a.llamadas; }); });
    var atHtml = at.length ? seccion(L("Handled by another brain", "Las atiende otro cerebro"), total, "<p><small>" + L("Not drift: they're linked to an endpoint of a connected brain.", "No son deriva: están unidas a un endpoint de un cerebro comunicado.") + "</small></p>" +
      '<ul class="lista">' + at.map(function (a) { return "<li>" + esc(a.cerebro) + " <small>" + plural(a.llamadas, L("call", "llamada"), L("calls", "llamadas")) + L(" to ", " a ") + plural(a.endpoints, "endpoint", "endpoints") + "</small></li>"; }).join("") + "</ul>", false) : "";
    var avisos = [];
    ds.forEach(function (d, i) { d.avisos.forEach(function (a) { avisos.push((varios ? nombreCerebro(cerebroD(d, i)) + ": " : "") + a); }); });
    var avHtml = avisos.length ? seccion(L("What couldn't be measured", "Lo que no se pudo medir"), avisos.length, '<ul class="lista">' + avisos.map(function (a) { return "<li><small>" + esc(a) + "</small></li>"; }).join("") + "</ul>", false) : "";
    return { cruces: cruces, atendidas: atHtml, avisos: avHtml };
  }
  function vistaDeriva() {
    if (!DERIVA) return '<p class="aviso">' + L("There's no code index, so it's unknown what each service calls or whom. Run <code>flowbrain index</code> on each repo and then <code>flowbrain compile</code> (or <code>flowbrain brains apply</code>).",
      "No hay índice de código, así que no se sabe qué llama cada servicio ni a quién. Corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code> (o <code>flowbrain brains apply</code>).") + "</p>";
    var ds = alcance(), ctx = contexto(ds);
    var msg = MSG ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '" role="status">' + esc(MSG.texto) + "</p>" : "";
    return ctx.cruces + flD.html() + msg + '<div id="ct-lista">' + listaDeriva() + "</div>" + ctx.atendidas + ctx.avisos;
  }
  function listaDeriva() {
    var ds = alcance(), S2 = flD.S(), xs = flD.filtrar(), ve = function (t) { return !S2.grupo || S2.grupo === t; };
    var de = function (t) { return xs.filter(function (x) { return x.t === t; }); };
    var total = function (f) { var s = 0; ds.forEach(function (d) { s += f(d); }); return s; };
    var out = flD.resultado(xs);
    if (ve("sinEndpoint")) {
      var sinEp = de("sinEndpoint"), n = total(function (d) { return d.sinEndpoint.length; });
      out += seccion(L("Calls nobody handles", "Llamadas que nadie atiende"), sinEp.length, n
        ? "<p><small>" + L("The route no longer exists, changed method, or the service that handles it isn't indexed", "La ruta ya no existe, cambió de método, o el servicio que la atiende no está indexado") + (ds.some(function (d) { return d.comunicadoCon; }) ? L(" or connected", " ni comunicado") : "") + ".</small></p>" + barra("s|sinEndpoint", L("The agent fixes each call or declares its real destination.", "El agente arregla cada llamada o declara su destino real.")) +
          (sinEp.length ? listaCortada("sinEndpoint", sinEp, function (it) {
            var x = it.x;
            return llamada(x, x.o ? '<div class="fd-nota">' + L("Exists with another method: ", "Existe con otro método: ") + x.o.map(function (id) { return "<code>" + esc(pieza(id)) + "</code>"; }).join(", ") + "</div>" : "", it);
          }) : ninguno())
        : '<p class="fd-ok">' + L("Every call with a route has something that handles it.", "Todas las llamadas con ruta tienen quién las atienda.") + "</p>", true);
    }
    if (ve("disputada")) {
      var disp = de("disputada");
      if (disp.length) out += seccion(L("Match several endpoints", "Coinciden con varios endpoints"), disp.length, "<p><small>" + L("They match more than one endpoint and weren't linked to any. Between brains, fix it by declaring which service each base URL goes to (<code>flowbrain evidence</code>).", "Coinciden con más de un endpoint y no se unieron a ninguno. Entre cerebros se resuelve declarando a qué servicio va cada base de URL (<code>flowbrain evidence</code>).") + "</small></p>" + barra("s|disputada", L("The agent declares which service each one goes to, or fixes the call.", "El agente declara a qué servicio va cada una, o arregla la llamada.")) +
        listaCortada("disputadas", disp, function (it) { return llamada(it.x, '<div class="fd-nota">' + L("Candidates: ", "Candidatos: ") + it.x.k.map(function (k) { return "<code>" + esc(k) + "</code>"; }).join(", ") + "</div>", it); }), true);
    }
    if (ve("sinLlamadas")) {
      // Endpoints sin llamadas, por servicio, con quién lo llama.
      var sinLl = de("sinLlamadas"), filtrado = flD.activos().length > 0;
      var porSvc = ds.map(function (d, i) {
        var c = cerebroD(d, i);
        return Object.keys(d.consumidores).sort().map(function (s) {
          if (S2.servicio && S2.servicio !== s) return "";
          var todos = d.sinLlamadas.filter(function (x) { return x.e.indexOf(s + ":") === 0; }), suyos = sinLl.filter(function (x) { return x.c === c && x.svc === s; }), cons = d.consumidores[s];
          if (filtrado && !suyos.length && cons.length) return "";
          var cab = "<h4>" + esc(nombre(s)) + " <small>" + (cons.length ? L("called by ", "lo llaman ") + cons.map(function (k) { return esc(porId[k] ? nombre(k) : k); }).join(", ") : L("no indexed consumers", "sin consumidores indexados")) + "</small>" + (ds.length > 1 ? ' <span class="chip">' + esc(nombreCerebro(c)) + "</span>" : "") + (suyos.length > 1 ? " " + botonPedir("g|" + c + "|" + s, L("Request the " + num(suyos.length), "Pedir los " + num(suyos.length))) : "") + "</h4>";
          if (!cons.length) return cab + '<p class="aviso">' + L("Nothing indexed calls this service, so it's impossible to tell which of its endpoints are unused. Index whoever consumes it, or turn on communication with its brain.", "Nadie indexado llama a este servicio, así que no se puede decir qué endpoints suyos no se usan. Falta indexar a quien lo consume, o activar la comunicación con su cerebro.") + "</p>";
          if (!todos.length) return cab + '<p class="fd-ok">' + L("All its endpoints have at least one call.", "Todos sus endpoints tienen al menos una llamada.") + "</p>";
          return cab + (suyos.length ? listaCortada("sinLlamadas:" + c + ":" + s, suyos, function (it) {
            return "<li><code>" + esc(pieza(it.x.e)) + "</code>" + (it.x.ev ? " <small><code>" + esc(it.x.ev) + "</code></small>" : "") + hacer(it,
              ED ? '<button type="button" class="boton chico" data-acc="sin-uso" data-k="' + esc(it.k) + '" title="' + L("Someone uses it on purpose (a webhook, a client that isn't indexed): it leaves the drift and is saved in the brain. It can be undone.", "Alguien lo usa a propósito (un webhook, un cliente que no está indexado): sale de la deriva y se guarda en el cerebro. Se puede deshacer.") + '"' + (ocupado ? " disabled" : "") + ">" + L("Unused on purpose", "Sin uso a propósito") + "</button>" : "") + "</li>";
          }) : ninguno());
        }).join("");
      }).join("");
      var hay = ds.some(function (d) { return Object.keys(d.consumidores).length; });
      out += seccion(L("Endpoints nobody calls", "Endpoints que nadie llama"), sinLl.length, hay ? "<p><small>" + L("Candidates for deletion, or called by something that isn't indexed. Before deleting one, check its impact.", "Candidatos a borrar, o llamados por algo que no está indexado. Antes de borrar uno, revisá su impacto.") + "</small></p>" +
          barra("s|sinLlamadas", L("The agent looks for who uses each one and declares it, or proposes deleting it in a note: it never deletes anything.", "El agente busca quién usa cada uno y lo declara, o propone borrarlo en una nota: nunca borra nada.")) + (porSvc || ninguno())
        : '<p class="aviso">' + L((ds.length > 1 ? "These brains have" : "This brain has") + " no services with endpoints: there's nothing anyone could stop calling.", (ds.length > 1 ? "Estos cerebros no tienen" : "Este cerebro no tiene") + " servicios con endpoints: no hay nada que alguien pueda dejar de llamar.") + "</p>", true);
      out += sinUsoHtml(ds);
    }
    if (ve("campos")) out += seccion(L("Mismatched fields", "Campos que no coinciden"), de("campos").length, camposHtml(ds, de("campos")), true);
    return out;
  }
  // Campos: lo que cada llamada unida manda y espera contra lo que declara el endpoint.
  // Tablas de etiquetas como funciones: se leen al pintar, en el idioma del momento.
  var ETIQUETAS = function () { return { mandaYElBackNoDeclara: L("sent but not declared by the back end", "manda y el back no declara"), requeridosQueNoManda: L("required but not sent", "requeridos que no manda"), opcionalesQueElBackRequiere: L("sent as optional but required by the back end", "manda como opcionales y el back los requiere"), esperaYNoViene: L("expected but missing", "espera y no vienen"), opcionalesQueNoVienen: L("optional and missing", "opcionales que no vienen"), distintoNombre: L("different name", "distinto nombre") }; };
  var LADOS = function () { return { cuerpo: L("Body", "Cuerpo"), query: "Query", respuesta: L("Response", "Respuesta") }; };
  function camposHtml(ds, dif) {
    if (ds.every(function (d) { return !d.campos; })) return '<p class="aviso">' + L("This drift doesn't include the field comparison: recompile with a newer version of FlowBrain.", "Esta deriva no trae la comparación de campos: recompilá con una versión nueva de FlowBrain.") + "</p>";
    var unidas = 0, comparadas = 0, sinDif = 0, total = 0, noComp = [], viejo = [];
    ds.forEach(function (d) {
      if (!d.campos) return;
      unidas += d.campos.llamadasUnidas; comparadas += d.campos.comparadas; sinDif += d.campos.sinDiferencias; total += d.difieren.length;
      noComp = noComp.concat(d.campos.noComparables);
      // El aviso viene del motor: se reconoce en los dos idiomas.
      viejo = viejo.concat(d.avisos.filter(function (a) { return a.indexOf("no trae los campos") >= 0 || /\bfields of (the |its )?calls\b|\bcall fields\b/i.test(a); }));
    });
    if (!unidas) return '<p class="aviso">' + L("No call " + (ds.length > 1 ? "from these brains" : "from this brain") + " is linked to an endpoint, so there are no fields to compare.", "Ninguna llamada " + (ds.length > 1 ? "de estos cerebros" : "de este cerebro") + " está unida a un endpoint, así que no hay campos que comparar.") + "</p>";
    var resumen = "<p><small>" + L(plural(unidas, "call", "calls") + " linked to an endpoint; " + num(comparadas) + " compared (" + num(sinDif) + " with no differences). The object's first level is compared, by name.",
      plural(unidas, "llamada unida", "llamadas unidas") + " a un endpoint; " + plural(comparadas, "se comparó", "se compararon") + " (" + num(sinDif) + " sin diferencias). Se compara el primer nivel del objeto, por nombre.") + "</small></p>" +
      barra("s|campos", L("The agent aligns the side that is wrong: usually the client; the contract only by adding, never removing.", "El agente alinea el lado que está mal: casi siempre el cliente; el contrato solo sumando, nunca sacando."));
    var filas = dif.length ? listaCortada("campos", dif, function (it) {
      var x = it.x;
      var notas = ["cuerpo", "query", "respuesta"].filter(function (k) { return x[k]; }).map(function (k) {
        var o = x[k];
        var et = ETIQUETAS(), partes = Object.keys(et).filter(function (e) { return o[e]; }).map(function (e) { return et[e] + ": " + o[e].map(function (c) { return "<code>" + esc(c) + "</code>"; }).join(", "); });
        return '<div class="fd-nota">' + LADOS()[k] + " (<code>" + esc(o.front) + "</code> → <code>" + esc(o.back) + "</code>): " + partes.join(" · ") + "</div>";
      }).join("");
      return "<li><code>" + esc(x.l) + "</code> <small>→ <code>" + esc(x.c ? x.c + "/" + pieza(x.e) : pieza(x.e)) + "</code> · " + L("call", "llama") + " <code>" + esc(x.ev) + "</code> · " + L("handler", "atiende") + " <code>" + esc(x.eb) + "</code></small>" + conCerebro(it) + notas + hacer(it) + "</li>";
    }) : total ? ninguno() : comparadas ? '<p class="fd-ok">' + L("In what could be compared, what's sent and expected matches what the back end declares.", "En lo que se pudo comparar, lo que se manda y se espera coincide con lo que declara el back.") + "</p>" : "";
    var nc = noComp.length
      ? "<h4>" + L("Couldn't be compared <small>they don't count as a match</small>", "No se pudieron comparar <small>no cuentan como coincidencia</small>") + '</h4><ul class="lista">' + noComp.map(function (n) { return "<li>" + LADOS()[n.lado] + ": " + esc(n.motivo) + " <small>" + plural(n.llamadas, L("call", "llamada"), L("calls", "llamadas")) + (n.tipos ? " · " + n.tipos.map(function (t) { return "<code>" + esc(t) + "</code>"; }).join(", ") : "") + "</small></li>"; }).join("") + "</ul>"
      : "";
    // Un índice anterior no trae lo que manda cada llamada: que se lea acá, no solo en los avisos.
    return (viejo.length ? '<p class="aviso">' + esc(viejo[0]) + "</p>" : "") + resumen + filas + nc;
  }

  // ---------- El tipo «deriva» del pedido al agente (viewer-pedido, dec. 232) ----------
  // Un ítem por problema: { tipo: "deriva", k: la clave de la fila, cerebro, repo, datos: { c, cerebro, clase, ev,
  // llamada | endpoint (id del cerebro, sin prefijo), que: qué está roto, en inglés } }.
  var PD = window.brainPedido || null, ED = window.FLOWBRAIN_EDICION || null, PLAN = D.derivaPlan || null, TANDA = 10;
  var MSG = null, ocupado = false, BT = String.fromCharCode(96);
  var derivaDe = function (c) { for (var i = 0; i < (DERIVA || []).length; i++) if (cerebroD(DERIVA[i], i) === c) return DERIVA[i]; return null; };
  var cerebroNombre = function (c) { return CEREBROS[Number(c)] ? CEREBROS[Number(c)].nombre : ""; };
  // Lo que va al modelo, solo en inglés (dec. 214).
  var CLASE_EN = { sinEndpoint: "call nobody serves", disputada: "call matching several endpoints", sinLlamadas: "endpoint nobody calls", campos: "mismatched fields" };
  var ET_EN = { mandaYElBackNoDeclara: "sent but not declared by the back end", requeridosQueNoManda: "required but not sent", opcionalesQueElBackRequiere: "sent as optional but required by the back end", esperaYNoViene: "expected but missing", opcionalesQueNoVienen: "optional and missing", distintoNombre: "different name" };
  var LADO_EN = { cuerpo: "Body", query: "Query", respuesta: "Response" };
  function queEn(it) {
    var x = it.x, t;
    if (it.t === "sinEndpoint") t = "Nobody serves this call, made from " + local(x.d) + "." + (x.o ? " It exists with another method: " + x.o.map(pieza).join(", ") + "." : "");
    else if (it.t === "disputada") t = "It matches several endpoints and was linked to none: " + x.k.map(local).join(", ") + ".";
    else if (it.t === "sinLlamadas") {
      var d = derivaDe(it.c), cons = d && d.consumidores[it.svc] ? d.consumidores[it.svc].map(local) : [];
      t = "No indexed consumer calls this endpoint" + (cons.length ? " (its service is called by " + cons.join(", ") + ")" : "") + ".";
    } else {
      t = ["cuerpo", "query", "respuesta"].filter(function (k) { return x[k]; }).map(function (k) {
        var o = x[k];
        return LADO_EN[k] + " (" + o.front + " -> " + o.back + "): " + Object.keys(ET_EN).filter(function (e) { return o[e]; }).map(function (e) { return ET_EN[e] + ": " + o[e].join(", "); }).join("; ");
      }).join(". ") + ". Endpoint " + local(x.e) + (x.c ? " in brain " + x.c : "") + ", handled at " + x.eb + ".";
    }
    return t.length > 590 ? t.slice(0, 589) + "…" : t;
  }
  // Se puede pedir lo que tiene dónde mirar: repo:ruta#Ln.
  var pedible = function (it) { return /^[^:\s]+:[^\s#]+#L\d+/.test(String(it.x.ev || "")); };
  function entradaDe(it) {
    var x = it.x, cer = cerebroNombre(it.c), d = { c: it.c, cerebro: cer, clase: it.t, ev: x.ev, que: queEn(it) };
    if (it.t === "sinLlamadas") d.endpoint = local(x.e); else d.llamada = x.l;
    return { tipo: "deriva", k: it.k, cerebro: cer, repo: String(x.ev).split(":")[0], datos: d };
  }
  // Con qué se reconoce un problema antes y después de una tanda (la misma regla que claveDeDeriva del servidor): el
  // endpoint, o la llamada por su archivo sin la línea (que se corre si el agente edita el archivo) y su texto.
  var claveSrv = function (d) { return d.cerebro + "|" + d.clase + "|" + (d.clase === "sinLlamadas" ? d.endpoint : String(d.ev).replace(/#L\d+(-L\d+)?$/, "") + " " + d.llamada); };
  // Lo que suma cada botón, según su data-k: «p|<fila>», «s|<clase>» (la sección, con los filtros) o «g|<cerebro>|<servicio>».
  function xsDeBoton(k, memo) {
    k = String(k || "");
    var xs = [], filtrados = function () { return memo ? memo.f || (memo.f = flD.filtrar()) : flD.filtrar(); };
    if (k.indexOf("p|") === 0) xs = ITEM_POR_K[k.slice(2)] ? [ITEM_POR_K[k.slice(2)]] : [];
    else if (k.indexOf("s|") === 0) xs = filtrados().filter(function (it) { return it.t === k.slice(2); });
    else if (k.indexOf("g|") === 0) { var p = k.slice(2).split("|"); xs = filtrados().filter(function (it) { return it.t === "sinLlamadas" && String(it.c) === p[0] && it.svc === p.slice(1).join("|"); }); }
    return xs.filter(pedible);
  }
  var botonPedir = function (k, et) { var xs = PD ? xsDeBoton(k) : []; return xs.length ? PD.boton({ tipo: "deriva", k: k, et: et, claves: xs.map(function (it) { return it.k; }) }) : ""; };
  // El botón de una fila (y lo que la fila sume al lado, como «Sin uso a propósito»).
  var hacer = function (it, extra) { var b = PD && pedible(it) ? PD.boton({ tipo: "deriva", k: "p|" + it.k, et: L("Request", "Pedir"), claves: [it.k] }) : ""; return b || extra ? '<div class="fd-hacer">' + b + (extra || "") + "</div>" : ""; };
  // Arriba de una sección: «Pedir los N» con lo que se ve (los filtros aplicados).
  function barra(k, que) {
    var xs = PD ? xsDeBoton(k) : [];
    if (!xs.length) return "";
    return '<div class="fd-hacer">' + botonPedir(k, xs.length === 1 ? L("Request it", "Pedirlo") : L("Request the " + num(xs.length), "Pedir los " + num(xs.length))) + "<small>" + que + "</small></div>";
  }
  var CLASES = ["sinEndpoint", "disputada", "sinLlamadas", "campos"];
  var cuantasTandas = function (ds) { var g = {}, n = 0; ds.forEach(function (d) { var k = d.cerebro + "|" + d.ev.split(":")[0]; g[k] = (g[k] || 0) + 1; }); Object.keys(g).forEach(function (k) { n += Math.ceil(g[k] / TANDA); }); return n; };
  // El .md para cualquier agente: las mismas reglas que usa el servidor (D.derivaPlan) y los problemas por cerebro y repo.
  function textoMd(es) {
    var ds = es.map(function (e) { return e.datos; });
    if (!ds.length) return "";
    var out = ["# Contract drift to fix", "", "Fix these " + ds.length + " " + (ds.length === 1 ? "problem" : "problems") + " that FlowBrain's drift found between this project's services." + (CEREBROS.length > 1 ? " Each group says its brain: declarations and notes go in that brain's folder (" + BT + ".flowbrain/<brain>/" + BT + ")." : "")];
    if (PLAN) {
      out.push("", "## Rules", "");
      PLAN.reglas.forEach(function (r) { out.push("- " + r); });
      out.push("", "## How to resolve each problem", "");
      CLASES.filter(function (c) { return ds.some(function (d) { return d.clase === c; }); }).forEach(function (c) { out.push("- **" + CLASE_EN[c] + "**: " + PLAN.como[c]); });
    }
    out.push("", "## Problems");
    var grupos = {}, orden = [];
    ds.forEach(function (d) { var g = (d.cerebro ? d.cerebro + " / " : "") + d.ev.split(":")[0]; if (!grupos[g]) { grupos[g] = []; orden.push(g); } grupos[g].push(d); });
    orden.forEach(function (g) {
      out.push("", "### " + g);
      grupos[g].forEach(function (d) { out.push("- [ ] " + CLASE_EN[d.clase] + ": " + (d.endpoint || d.llamada) + " at " + d.ev + ". " + d.que); });
    });
    if (PLAN) { out.push("", "## When done", ""); PLAN.cierre.forEach(function (c, i) { out.push((i + 1) + ". " + c); }); }
    return out.join("\n") + "\n";
  }
  if (DERIVA && PD) PD.registrar("deriva", {
    get nombre() { return L("Drift to fix", "Deriva a arreglar"); },
    unidad: ["problem", "problems", "problema", "problemas"],
    raiz: raiz,
    claves: function (k, memo) { return xsDeBoton(k, memo).map(function (it) { return it.k; }); },
    items: function (k) { return xsDeBoton(k).map(entradaDe); },
    repintar: function () { var l = elem("ct-lista"); if (l && S.tab === "deriva") l.innerHTML = listaDeriva(); },
    orden: function (a, b) { return CLASES.indexOf(a.datos.clase) - CLASES.indexOf(b.datos.clase) || (a.k < b.k ? -1 : 1); },
    resumen: function (es) {
      var ds = es.map(function (e) { return e.datos; });
      var partes = CLASES.map(function (c) { var n = ds.filter(function (d) { return d.clase === c; }).length; return n ? num(n) + " " + tipoD(c).toLowerCase() : ""; }).filter(Boolean);
      return [partes.join(" · "),
        PD.agente && ds.length ? L("In " + plural(cuantasTandas(ds), "batch", "batches") + " of up to " + TANDA + " problems of the same repo; after each one, the brain is reindexed and the drift measured again. Nothing is deleted: proposals go to a note", "En " + plural(cuantasTandas(ds), "tanda", "tandas") + " de hasta " + TANDA + " problemas de un mismo repo; después de cada una se reindexa el cerebro y se vuelve a medir la deriva. No se borra nada: las propuestas van a una nota") : ""];
    },
    costo: function (mo) { return typeof mo.costoPorDerivaUsd === "number" ? mo.costoPorDerivaUsd : null; },
    lote: function (es) {
      return { tipo: "deriva", problemas: es.map(function (e) { var d = e.datos, p = { cerebro: d.cerebro, clase: d.clase, ev: d.ev, que: d.que }; if (d.clase === "sinLlamadas") p.endpoint = d.endpoint; else p.llamada = d.llamada; return p; }) };
    },
    md: { archivo: "drift-fixes.md", texto: textoMd },
    clave: function (it) { return claveSrv(it.datos); },
    tanda: { lista: "problemas", clave: claveSrv },
    seguimiento: {
      pidiendo: function (n, repos) { return L("Fixing " + plural(n, "drift problem", "drift problems") + " in " + plural(repos, "repo", "repos"), "Arreglando " + plural(n, "problema", "problemas") + " de la deriva en " + plural(repos, "repo", "repos")); },
    },
    // La tarjeta: qué está roto, la llamada o el endpoint, dónde (repo:ruta#Ln) y el cerebro.
    tarjeta: function (it) {
      var d = it.datos;
      return '<p class="es-texto"><code>' + esc(d.clase === "sinLlamadas" ? pieza(d.endpoint) : d.llamada) + "</code></p>" +
        "<p><small><code>" + esc(d.ev) + "</code></small></p>" +
        '<div class="chips"><span class="chip">' + esc(tipoD(d.clase)) + "</span>" +
        (CEREBROS.length > 1 && d.cerebro ? '<span class="chip es-cerebro" title="' + L("Brain", "Cerebro") + '">' + esc(d.cerebro) + "</span>" : "") + "</div>";
    }
  });
  // Lo que ya no está en la deriva (se arregló, o se marcó sin uso) sale del pedido; lo que sigue, se pone al día.
  function podarPedido() { if (DERIVA && PD) PD.podar("deriva", function (x) { var it = ITEM_POR_K[x.k]; return it && pedible(it) ? entradaDe(it) : null; }); }

  // ---------- «Sin uso a propósito»: una marca de la persona, no del agente ----------
  // Se guarda en el cerebro como «No es de producto» (not-product.yaml, motivo sin-uso): el endpoint sale de la deriva.
  function sinUsoHtml(ds) {
    var xs = [];
    ds.forEach(function (d, i) { (d.sinUso || []).forEach(function (m) { xs.push({ c: cerebroD(d, i), m: m }); }); });
    if (!xs.length) return "";
    return seccion(L("Unused on purpose", "Sin uso a propósito"), xs.length, "<p><small>" + L("Endpoints nobody calls on purpose (a webhook, a client that isn't indexed): they don't count as drift. They're saved in the brain's <code>not-product.yaml</code>.", "Endpoints que nadie llama a propósito (un webhook, un cliente que no está indexado): no cuentan como deriva. Se guardan en el <code>not-product.yaml</code> del cerebro.") + (ED ? "" : L(" To undo one from here, open it with <code>flowbrain viewer --serve</code>.", " Para deshacer uno desde acá, abrilo con <code>flowbrain viewer --serve</code>.")) + "</small></p>" +
      '<ul class="lista">' + xs.map(function (y) {
        return "<li><code>" + esc(pieza(y.m.e)) + "</code>" + (y.m.ev ? " <small><code>" + esc(y.m.ev) + "</code></small>" : "") + (ds.length > 1 ? ' <span class="chip">' + esc(nombreCerebro(y.c)) + "</span>" : "") +
          (ED ? ' <button type="button" class="boton chico" data-acc="deshacer-sin-uso" data-c="' + esc(String(y.c)) + '" data-e="' + esc(y.m.e) + '"' + (ocupado ? " disabled" : "") + ">" + L("Undo", "Deshacer") + "</button>" : "") + "</li>";
      }).join("") + "</ul>", false);
  }
  function marcarSinUso(k) {
    var it = ITEM_POR_K[k], d = it ? derivaDe(it.c) : null;
    if (!it || !d || ocupado || !ED || !PD) return;
    ocupado = true; MSG = { texto: L("Saving…", "Guardando…") }; pintar();
    PD.llamar("/api/editar", { tipo: "no_producto", cerebro: cerebroNombre(it.c), entrada: local(it.x.e), motivo: "sin-uso" }).then(function (r) {
      ocupado = false;
      d.sinLlamadas = d.sinLlamadas.filter(function (x) { return x.e !== it.x.e; });
      (d.sinUso = d.sinUso || []).push({ e: it.x.e, ev: it.x.ev, n: true });
      armarItems(); podarPedido();
      MSG = { texto: L(pieza(it.x.e) + " is marked as unused on purpose and left the drift. You can undo it in «Unused on purpose».", pieza(it.x.e) + " quedó marcado sin uso a propósito y salió de la deriva. Se deshace en «Sin uso a propósito».") + " (" + r.escrito + ")" };
      pintar();
    }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; pintar(); });
  }
  function deshacerSinUso(c, e) {
    var d = derivaDe(Number(c)), m = null;
    (d && d.sinUso || []).forEach(function (x) { if (x.e === e) m = x; });
    if (!m || ocupado || !ED || !PD) return;
    ocupado = true; MSG = { texto: L("Saving…", "Guardando…") }; pintar();
    PD.llamar("/api/editar", { tipo: "no_producto", cerebro: cerebroNombre(Number(c)), entrada: local(e), motivo: null }).then(function () {
      ocupado = false;
      d.sinUso = d.sinUso.filter(function (x) { return x.e !== e; });
      // Vuelve a la deriva si nadie lo llama (si lo llaman, ya no es deriva).
      if (m.n) d.sinLlamadas.push({ e: m.e, ev: m.ev });
      armarItems();
      MSG = { texto: m.n ? L(pieza(e) + " is no longer marked: it's back in «Endpoints nobody calls».", pieza(e) + " ya no está marcado: volvió a «Endpoints que nadie llama».") : L(pieza(e) + " is no longer marked.", pieza(e) + " ya no está marcado.") };
      pintar();
    }).catch(function (er) { ocupado = false; MSG = { texto: er.message, error: true }; pintar(); });
  }

  // ---------- Paridad ----------
  // Qué contiene cada servicio y qué tablas toca cada pieza, del grafo embebido.
  var contenido = {}, tablas = {};
  D.edges.forEach(function (e) {
    if (e.v === "contiene") (contenido[e.s] = contenido[e.s] || []).push(e.h);
    else if (e.v === "lee_de" || e.v === "escribe_en") (tablas[e.s] = tablas[e.s] || []).push(e.v + " " + e.h);
  });
  var rutaPantalla = {};
  (D.pantallas || []).forEach(function (p) { rutaPantalla[p.id] = p.ruta; });
  var forma = function (r) { return String(r).replace(/\{[^}]*\}/g, "{}").toLowerCase(); };
  function piezas(svc, tipo) {
    return (contenido[svc] || []).filter(function (id) { return porId[id] && porId[id].t === tipo; }).map(function (id) {
      var a = porId[id].at || {};
      return { id: id, metodo: tipo === "endpoint" ? a.metodo || "" : "", ruta: forma(tipo === "endpoint" ? a.ruta : rutaPantalla[id] || "") };
    });
  }
  var SERVICIOS = D.nodes.filter(function (n) { return n.t === "svc" && (piezas(n.id, "endpoint").length || piezas(n.id, "pantalla").length); })
    .sort(function (a, b) { return (cerebroDe(a.id) + a.n).toLowerCase() < (cerebroDe(b.id) + b.n).toLowerCase() ? -1 : 1; });
  function paridad(viejo, nuevo) {
    var entre = (porId[viejo] || {}).c !== (porId[nuevo] || {}).c;
    // Entre cerebros, la misma tabla puede tener la página con otro id: se compara el nombre sin separadores.
    var tabla = function (id) { return entre ? local(id).replace(/^(tabla|db)-/, "").replace(/[^a-z0-9]/gi, "").toLowerCase() : id; };
    var acceso = function (a) { var i = a.indexOf(" "); return a.slice(0, i) + " " + tabla(a.slice(i + 1)); };
    var sinPar = function (xs, otros, clave) { var o = {}; otros.forEach(function (x) { o[clave(x)] = true; }); return xs.filter(function (x) { return !o[clave(x)]; }).sort(); };
    var unicos = function (xs) { var v = {}; return xs.filter(function (x) { if (v[x]) return false; v[x] = true; return true; }); };
    function comparar(tipo) {
      var v = piezas(viejo, tipo), n = piezas(nuevo, tipo);
      var comun = function (xs) { var p = {}, k; xs.forEach(function (x) { p[x.ruta.split("/")[1] || ""] = true; }); k = Object.keys(p); return k.length === 1 && k[0] && k[0].charAt(0) !== "{" ? "/" + k[0] : ""; };
      var clave = function (x, pre) { return x.metodo + " " + (pre && (x.ruta === pre || x.ruta.indexOf(pre + "/") === 0) ? x.ruta.slice(pre.length) || "/" : x.ruta); };
      var coinciden = function (a, b) { var cs = {}; n.forEach(function (x) { cs[clave(x, b)] = true; }); return v.filter(function (x) { return cs[clave(x, a)]; }).length; };
      // Prefijo fijo de un lado (/api): se descuenta solo si así coinciden más piezas.
      var mejor = ["", ""];
      [["", comun(n)], [comun(v), ""]].forEach(function (c) { if (coinciden(c[0], c[1]) > coinciden(mejor[0], mejor[1])) mejor = c; });
      var enNuevo = {}, enViejo = {};
      n.forEach(function (x) { enNuevo[clave(x, mejor[1])] = x.id; });
      v.forEach(function (x) { enViejo[clave(x, mejor[0])] = x.id; });
      var iguales = v.filter(function (x) { return enNuevo[clave(x, mejor[0])]; }).map(function (x) { return { viejo: x.id, nuevo: enNuevo[clave(x, mejor[0])] }; });
      var difieren = [];
      iguales.forEach(function (par) {
        var a = unicos(tablas[par.viejo] || []), b = unicos(tablas[par.nuevo] || []);
        var sv = sinPar(a, b, acceso), sn = sinPar(b, a, acceso);
        if (sv.length || sn.length) difieren.push({ viejo: par.viejo, nuevo: par.nuevo, soloViejo: sv, soloNuevo: sn });
      });
      return {
        viejo: v.length, nuevo: n.length, migrados: iguales.length,
        faltan: v.filter(function (x) { return !enNuevo[clave(x, mejor[0])]; }).map(function (x) { return x.id; }).sort(),
        soloEnNuevo: n.filter(function (x) { return !enViejo[clave(x, mejor[1])]; }).map(function (x) { return x.id; }).sort(),
        difieren: difieren
      };
    }
    var tablasSvc = function (svc) {
      var out = [];
      [svc].concat(piezas(svc, "endpoint").map(function (x) { return x.id; })).forEach(function (id) { (tablas[id] || []).forEach(function (a) { out.push(a.slice(a.indexOf(" ") + 1)); }); });
      return unicos(out);
    };
    return { entre: entre, endpoints: comparar("endpoint"), pantallas: comparar("pantalla"), tablasSinMigrar: sinPar(tablasSvc(viejo), tablasSvc(nuevo), tabla) };
  }
  // Para los tests: la misma cuenta que hace la pantalla.
  var rotulo = function (n) { var c = cerebroDe(n.id); return (c && CEREBROS.length > 1 ? c + " · " : "") + n.n + " (" + plural(piezas(n.id, "endpoint").length, "endpoint", "endpoints") + (piezas(n.id, "pantalla").length ? ", " + plural(piezas(n.id, "pantalla").length, L("screen", "pantalla"), L("screens", "pantallas")) : "") + ")"; };
  // ---------- Paridad con filtro y estadística ----------
  // Cada pieza de la comparación es un ítem: lo que falta migrar, lo migrado que toca otras tablas, lo que solo está en el
  // nuevo y las tablas que el nuevo todavía no toca.
  var TIPOS_P = function () { return [["falta", L("Not migrated yet", "Faltan migrar")], ["difiere", L("Touch different tables", "Tocan tablas distintas")], ["solo", L("Only in the new one", "Solo en el nuevo")], ["tabla", L("Tables not migrated", "Tablas sin migrar")]]; };
  var tipoP = function (id) { var t = TIPOS_P().filter(function (x) { return x[0] === id; })[0]; return t ? t[1] : id; };
  var CLASE = function () { return { endpoint: "Endpoint", pantalla: L("Screen", "Pantalla"), tabla: L("Table", "Tabla") }; };
  var prefijoDe = function (texto) { var r = String(texto).replace(/^[A-Z]+ /, ""), m = /^\/([^/]*)/.exec(r); return m ? "/" + m[1] : ""; };
  var PAR = { k: "", r: null, items: [] };
  function comparacion() {
    var k = S.viejo + "|" + S.nuevo;
    if (PAR.k === k) return PAR;
    PAR = { k: k, r: null, items: [] };
    if (!porId[S.viejo] || !porId[S.nuevo] || S.viejo === S.nuevo) return PAR;
    var r = PAR.r = paridad(S.viejo, S.nuevo), out = PAR.items;
    var pon = function (t, clase, id, x) { var p = clase === "tabla" ? nombre(id) : pieza(id); out.push({ t: t, clase: clase, id: id, x: x, m: clase === "endpoint" ? metodoDe(p) : "", pre: clase === "tabla" ? "" : prefijoDe(p), texto: p + (x ? " " + x.soloViejo.join(" ") + " " + x.soloNuevo.join(" ") : "") }); };
    [["endpoint", r.endpoints], ["pantalla", r.pantallas]].forEach(function (b) {
      b[1].faltan.forEach(function (id) { pon("falta", b[0], id); });
      b[1].difieren.forEach(function (x) { pon("difiere", b[0], x.viejo, x); });
      b[1].soloEnNuevo.forEach(function (id) { pon("solo", b[0], id); });
    });
    r.tablasSinMigrar.forEach(function (id) { pon("tabla", "tabla", id); });
    return PAR;
  }
  var flP = window.brainFiltros.crear({
    pre: "ct", clave: "flowbrain.contratos.paridad", unidad: function () { return L(["piece", "pieces"], ["pieza", "piezas", "f"]); }, todos: function () { return L("everything that differs between the two", "todo lo que difiere entre los dos"); },
    items: function () { return comparacion().items; },
    grupos: [{ id: "", etiqueta: function () { return L("All", "Todo"); } }].concat(TIPOS_P().map(function (t) { return { id: t[0], etiqueta: function () { return tipoP(t[0]); }, palabra: function () { return tipoP(t[0]).toLowerCase(); }, es: function (x) { return x.t === t[0]; } }; })),
    buscar: { ph: function () { return L("Search a route or a table…", "Buscar una ruta o una tabla…"); }, texto: function (x) { return x.texto; } },
    campos: [
      { id: "clase", etiqueta: function () { return L("Type", "Tipo"); }, propio: function () { return L("the chosen type", "el tipo elegido"); }, de: function (x) { return x.clase; }, etiquetaDe: function (v) { return CLASE()[v] || v; }, palabra: function (v) { return L("only ", "solo ") + (CLASE()[v] || v).toLowerCase() + "s"; } },
      { id: "metodo", etiqueta: function () { return L("Method", "Método"); }, propio: function () { return L("the chosen method", "el método elegido"); }, ordenPorCantidad: true, de: function (x) { return x.m; }, palabra: function (v) { return L("method ", "método ") + v; } },
      { id: "prefijo", etiqueta: function () { return L("Route starting with", "Ruta que empieza con"); }, todos: function () { return L("Any", "Cualquiera"); }, propio: function () { return L("the chosen prefix", "el prefijo elegido"); }, ordenPorCantidad: true, de: function (x) { return x.pre; }, palabra: function (v) { return L("route ", "ruta ") + v; } }
    ],
    paneles: [
      { titulo: function () { return L("By type", "Por tipo"); }, campo: "clase" },
      { titulo: function () { return L("By method", "Por método"); }, campo: "metodo", sinValor: function () { return L("screens and tables have no method", "pantallas y tablas no tienen método"); } },
      { titulo: function () { return L("By route prefix", "Por comienzo de la ruta"); }, campo: "prefijo", max: 8 }
    ],
    alCambiar: function (todo) { refrescar(todo); }
  });
  var accesos = function (xs) { return xs.map(function (a) { var i = a.indexOf(" "); return (a.slice(0, i) === "lee_de" ? L("reads ", "lee ") : L("writes to ", "escribe en ")) + "<code>" + esc(nombre(a.slice(i + 1))) + "</code>"; }).join(", "); };
  // que, uno y varios llegan ya en el idioma del momento (se arman al pintar).
  function bloque(que, clase, uno, varios, r, xs) {
    var k = clase === "endpoint" ? "Endpoints" : "Pantallas"; // clave fija de las listas, en cualquier idioma
    if (!r.viejo && !r.nuevo) return "";
    var pct = r.viejo ? Math.round((100 * r.migrados) / r.viejo) : 0, S2 = flP.S(), ve = function (t) { return !S2.grupo || S2.grupo === t; };
    var de = function (t) { return xs.filter(function (x) { return x.clase === clase && x.t === t; }); };
    var faltan = de("falta"), solo = de("solo"), dif = de("difiere");
    var item = function (x) { return "<li><code>" + esc(pieza(x.id)) + "</code></li>"; };
    var vacio = function (n, texto) { return n ? '<p class="aviso">' + L("Nothing matches ", "Ninguno coincide con ") + esc(flP.activos().join(", ")) + ".</p>" : '<p class="fd-ok">' + texto + "</p>"; };
    return "<h2>" + que + "</h2>" +
      '<div class="fd-cifras">' + cifra(num(r.migrados) + L(" of ", " de ") + num(r.viejo), L(varios + " already on the other side (" + pct + " %)", varios + " ya están del otro lado (" + pct + " %)"), pct === 100 ? "var(--bien)" : "") +
      cifra(r.faltan.length, L("not migrated yet", "faltan migrar"), r.faltan.length ? "var(--atencion)" : "var(--bien)") + cifra(r.soloEnNuevo.length, L("only in the new one", "solo en el nuevo")) +
      (clase === "endpoint" ? cifra(r.difieren.length, L("migrated but touching different tables", "migrados que tocan tablas distintas"), r.difieren.length ? "var(--atencion)" : "") : "") + "</div>" +
      '<div class="fd-pista ct-barra" role="img" aria-label="' + pct + L(' % migrated', ' % migrado') + '"><span class="fd-relleno" style="width:' + pct + '%;background:var(--bien)"></span></div>' +
      (ve("falta") ? seccion(L("Not migrated yet", "Faltan migrar"), faltan.length, faltan.length ? listaCortada(k + ":faltan", faltan, item) : vacio(r.faltan.length, L("Nothing missing: all the old one's " + varios + " are in the new one.", "No falta ninguno: todos los " + varios + " del viejo están en el nuevo.")), faltan.length > 0 && faltan.length <= 40) : "") +
      (ve("difiere") && r.difieren.length ? seccion(L("Migrated but touching different tables", "Migrados que tocan tablas distintas"), dif.length,
        "<p><small>" + L("The same " + uno + " on each side doesn't read or write the same tables: it may be an intended change or something left unmigrated.", "El mismo " + uno + " de cada lado no lee o escribe las mismas tablas: puede ser un cambio buscado o algo que quedó sin migrar.") + "</small></p>" +
        (dif.length ? listaCortada(k + ":difieren", dif, function (it) {
          var x = it.x;
          return "<li><code>" + esc(pieza(x.viejo)) + "</code>" +
            (x.soloViejo.length ? '<div class="fd-nota">' + L("Only the old one ", "Solo el viejo ") + accesos(x.soloViejo) + "</div>" : "") +
            (x.soloNuevo.length ? '<div class="fd-nota">' + L("Only the new one ", "Solo el nuevo ") + accesos(x.soloNuevo) + "</div>" : "") + "</li>";
        }) : vacio(1, "")), false) : "") +
      (ve("solo") ? seccion(L("Only in the new one", "Solo en el nuevo"), solo.length, solo.length ? listaCortada(k + ":solo", solo, item) : vacio(r.soloEnNuevo.length, L("The new one has no " + varios + " the old one lacks.", "El nuevo no tiene " + varios + " que el viejo no tenga.")), false) : "");
  }
  function listaParidad() {
    var P2 = comparacion(), r = P2.r, xs = flP.filtrar(), S2 = flP.S();
    var tsm = xs.filter(function (x) { return x.t === "tabla"; });
    return flP.resultado(xs) + bloque("Endpoints", "endpoint", "endpoint", "endpoints", r.endpoints, xs) + bloque(L("Screens", "Pantallas"), "pantalla", L("screen", "pantalla"), L("screens", "pantallas"), r.pantallas, xs) +
      (!S2.grupo || S2.grupo === "tabla" ? "<h2>" + L("Tables", "Tablas") + "</h2>" + seccion(L("Tables the new one doesn't touch yet", "Tablas que el nuevo todavía no toca"), tsm.length,
        tsm.length ? listaCortada("tablas", tsm, function (x) { return "<li><code>" + esc(nombre(x.id)) + "</code></li>"; })
          : r.tablasSinMigrar.length ? '<p class="aviso">' + L("Nothing matches ", "Ninguna coincide con ") + esc(flP.activos().join(", ")) + ".</p>" : '<p class="fd-ok">' + L("The new one already touches every table the old one touches.", "El nuevo ya toca todas las tablas que toca el viejo.") + "</p>", tsm.length > 0 && tsm.length <= 40) : "") +
      '<p class="aviso">' + L("Matched by method and route, regardless of parameter names: something renamed shows up as missing on one side and new on the other. Behavior isn't compared.", "Se empareja por método y ruta, sin importar el nombre de los parámetros: algo renombrado figura como faltante de un lado y nuevo del otro. No compara comportamiento.") +
      (r.entre ? L(" The two services are in different brains: tables are compared by name, ignoring dashes and case.", " Los dos servicios están en cerebros distintos: las tablas se comparan por nombre, sin guiones ni mayúsculas.") : "") + "</p>";
  }
  function vistaParidad() {
    if (SERVICIOS.length < 2) {
      return '<p class="aviso">' + L("Comparing needs two services with endpoints or screens, and " + (SERVICIOS.length ? "there's only one (" + esc(SERVICIOS[0].n) + ")" : "there are none") + ". Parity compares the service being replaced with the one replacing it.",
        "Para comparar hacen falta dos servicios con endpoints o pantallas, y " + (SERVICIOS.length ? "solo hay uno (" + esc(SERVICIOS[0].n) + ")" : "no hay ninguno") + ". La paridad compara el servicio que se reemplaza con el que lo reemplaza.") + "</p>";
    }
    var ops = function (actual) { return '<option value="">' + L("Choose a service…", "Elegí un servicio…") + "</option>" + SERVICIOS.map(function (n) { return '<option value="' + esc(n.id) + '"' + (n.id === actual ? " selected" : "") + ">" + esc(rotulo(n)) + "</option>"; }).join(""); };
    var elegir = '<div class="ct-par"><label class="fd-campo" for="ct-viejo"><span class="lbl">' + L("The one being replaced", "El que se reemplaza") + '</span><select id="ct-viejo">' + ops(S.viejo) + "</select></label>" +
      '<button type="button" class="boton" data-acc="invertir" title="' + L("Swap the comparison", "Dar vuelta la comparación") + '"' + (S.viejo && S.nuevo ? "" : " disabled") + ">⇄ " + L("Swap", "Invertir") + "</button>" +
      '<label class="fd-campo" for="ct-nuevo"><span class="lbl">' + L("The one replacing it", "El que lo reemplaza") + '</span><select id="ct-nuevo">' + ops(S.nuevo) + "</select></label></div>";
    if (!porId[S.viejo] || !porId[S.nuevo]) return elegir + '<p class="aviso">' + L("Choose both services: the one being replaced and the one replacing it. They're compared by method and route, and by the tables each endpoint touches.", "Elegí los dos servicios: el que se está reemplazando y el que lo reemplaza. Se comparan por método y ruta, y por las tablas que toca cada endpoint.") + "</p>";
    if (S.viejo === S.nuevo) return elegir + '<p class="aviso">' + L("You chose the same service on both sides: there's nothing to compare.", "Elegiste el mismo servicio de los dos lados: no hay nada que comparar.") + "</p>";
    return elegir + flP.html() + '<div id="ct-lista">' + listaParidad() + "</div>";
  }

  // ---------- Página ----------
  var actual = function () { return S.tab === "deriva" ? flD : flP; };
  function pintar() {
    // Igual que en Impacto: título, para qué sirve la pantalla, y las sub-vistas como pestañas subrayadas (los chips filtran).
    var tabs = '<nav class="pestanas" role="tablist" aria-label="' + L("What to show", "Qué ver") + '">' +
      [["deriva", L("Drift: broken calls and unused endpoints", "Deriva: llamadas rotas y endpoints sin uso")], ["paridad", L("Migration parity", "Paridad de una migración")]].map(function (t) { return '<button type="button" role="tab" class="pestana' + (S.tab === t[0] ? " on" : "") + '" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</nav>";
    var que = S.tab === "deriva"
      ? '<p class="explica">' + L("What gets called and nobody handles, and what gets handled and nobody calls. Use it to find broken integrations and endpoints you can delete.", "Lo que se llama y nadie atiende, y lo que se atiende y nadie llama. Sirve para encontrar integraciones rotas y endpoints que se pueden borrar.") + "</p>"
      : '<p class="explica">' + L("What's missing for one service to replace another: which endpoints and screens are already on the other side, which aren't, and which change tables.", "Qué falta para que un servicio reemplace a otro: qué endpoints y pantallas ya están del otro lado, cuáles no, y en cuáles cambian las tablas.") + "</p>";
    raiz.innerHTML = "<h1>" + L("Contracts", "Contratos") + "</h1>" + '<p class="subtitulo">' + L("How services talk to each other: what each front end or back end calls and who handles it, comparing method, route and fields.", "Cómo se hablan los servicios: qué llama cada front o back y quién lo atiende, comparando método, ruta y campos.") + "</p>" + tabs + que + (S.tab === "deriva" ? vistaDeriva() : vistaParidad());
  }
  // Al buscar se repinta solo la lista (el buscador no pierde el foco); si no está, la vista entera.
  function refrescar(todo) {
    S.ver = {}; guardar();
    var l = elem("ct-lista");
    if (todo || !l) pintar(); else l.innerHTML = S.tab === "deriva" ? listaDeriva() : listaParidad();
  }

  raiz.addEventListener("click", function (ev) {
    var f = actual();
    if (f && f.manejar(ev, "click")) return;
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc");
    if (acc === "mas") { var k = b.getAttribute("data-k"); S.ver[k] = (S.ver[k] || PASO) + PASO; pintar(); return; }
    // Sumar o sacar del pedido al agente (el componente cambia los botones y el panel, sin repintar la lista).
    if (acc === "pedir") { if (PD) PD.sumar("deriva", b.getAttribute("data-k")); return; }
    if (acc === "sin-uso") { marcarSinUso(b.getAttribute("data-k")); return; }
    if (acc === "deshacer-sin-uso") { deshacerSinUso(b.getAttribute("data-c"), b.getAttribute("data-e")); return; }
    if (acc === "invertir") { var t = S.viejo; S.viejo = S.nuevo; S.nuevo = t; refrescar(true); return; }
    if (b.hasAttribute("data-tab")) { S.tab = b.getAttribute("data-tab"); refrescar(true); }
  });
  raiz.addEventListener("change", function (ev) {
    var id = ev.target.id || "";
    if (id === "ct-viejo") { S.viejo = ev.target.value; refrescar(true); }
    else if (id === "ct-nuevo") { S.nuevo = ev.target.value; refrescar(true); }
    else { var f = actual(); if (f) f.manejar(ev, "change"); }
  });
  raiz.addEventListener("input", function (ev) { var f = actual(); if (f) f.manejar(ev, "input"); });

  // Al cargar, con todo ya definido: el pedido guardado se pone al día con la deriva de esta página.
  podarPedido();
  window.brainContratos = { mostrar: pintar, paridad: paridad };
})();
`;

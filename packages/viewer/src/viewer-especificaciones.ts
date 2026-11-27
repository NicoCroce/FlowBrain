/**
 * "Especificaciones" (`#/especificaciones[/<feat>]`): los casos de uso de cada funcionalidad del producto, y si están
 * cumplidos (código y test) en cada cerebro. La misma funcionalidad en varios cerebros (`web/feat-mvp`,
 * `newapi/feat-mvp`) es una sola, y el mismo caso (por su `id`) también: se ve de punta a punta, con una fila por
 * cerebro. Sale de `casos`, `especificaciones` y `tests` de cada ficha, sin datos propios. Los deduce el agente (guía
 * `/flowbrain-specs`); una persona marca lo que está mal ("Esto está mal") y el agente lo corrige: el botón aparece si
 * la página la sirve `flowbrain viewer --serve`. Lo que falta siempre se dice: la regla que no está en ningún caso, la
 * funcionalidad sin ninguna, el caso sin test. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const ESPECIFICACIONES_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("especificaciones");
  var CEREBROS = D.cerebros || [];
  var FICHAS = D.funcionalidades || [];
  var ED = window.FLOWBRAIN_EDICION || null;
  // El pedido al agente es el componente único del visor (viewer-pedido): la lista, el panel, el lote y el estado del
  // agente. Con el visor servido y un agente instalado, los pedidos se mandan directo; si no, se copian.
  var PD = window.brainPedido;
  var AG = PD.agente;
  // TRABAJOS: lo que corre el agente (lo trae el componente para todo el visor).
  var TRABAJOS = [];
  // Idioma (dec. 214): L(inglés, castellano) al pintar; sin window.brainI18n (los tests), inglés.
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  // Las tablas de textos son getters: se leen al pintar, en el idioma de ese momento.
  var TIPO = { get negocio() { return L("Business", "Negocio"); }, get producto() { return L("Product", "Producto"); } };
  var QUE_ES = { get negocio() { return L("Business rule: holds even if the screen changes", "Regla del negocio: vale aunque cambie la pantalla"); }, get producto() { return L("How the product behaves for whoever uses it", "Cómo se comporta el producto para quien lo usa"); } };
  // Estado de un caso: el peor de sus cerebros. Orden: lo que más falta, primero.
  var ESTADO = {
    sin_codigo: { get txt() { return L("No code", "Sin código"); }, cls: "no", get que() { return L("Some rule doesn't say which file fulfills it.", "Alguna regla no dice qué archivo la cumple."); } },
    sin_test: { get txt() { return L("Untested", "Sin test"); }, cls: "falta", get que() { return L("Some rule has no test that verifies it: if it breaks, nothing warns you.", "Alguna regla no tiene un test que la verifique: si se rompe, nada avisa."); } },
    sin_reglas: { get txt() { return L("No rules", "Sin reglas"); }, cls: "na", get que() { return L("The use case has no written rule.", "El caso no tiene ninguna regla escrita."); } },
    cumplido: { get txt() { return L("Fulfilled", "Cumplido"); }, cls: "ok", get que() { return L("Every rule has the code that fulfills it and a test that verifies it.", "Cada regla tiene el código que la cumple y un test que la verifica."); } }
  };
  var PESO = { sin_codigo: 0, sin_test: 1, sin_reglas: 2, cumplido: 3 };
  // El filtro y la estadística son el componente compartido (viewer-filtros); se arma más abajo, con los casos.
  var S = null, fl = null;
  // Los cerebros elegidos son una preferencia que dura (localStorage); el resto de la vista, solo la pestaña.
  var CLAVE_CEREBROS = "flowbrain.especificaciones.cerebros";
  var SEL = [];
  var guardar = function () {
    if (fl) fl.guardar();
    try { if (typeof localStorage !== "undefined") localStorage.setItem(CLAVE_CEREBROS, JSON.stringify(SEL)); } catch (e) { /* sin almacenamiento */ }
  };
  // MSG: { k: clave del caso, texto, error }. EDITA: clave del caso que se está marcando. PEDIDO: { k, copiado }.
  var MSG = null, EDITA = null, BORRADOR = "", PEDIDO = null, ocupado = false, FOCO = null;
  // MANUAL: clave de la regla ("<ficha>|<regla>") con el formulario "No necesita test" abierto; su motivo, en MOTIVO.
  var MANUAL = null, MOTIVO = "";

  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
  // El plural en los dos idiomas: pl(n, "rule", "rules", "regla", "reglas").
  var pl = function (n, enUno, enVarios, esUno, esVarios) { return L(plural(n, enUno, enVarios), plural(n, esUno, esVarios)); };
  var elem = function (id) { return document.getElementById(id); };
  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var indiceCerebro = function (id) { return porId[id] && porId[id].c !== undefined ? porId[id].c : -1; };
  var cerebroDe = function (id) { var i = indiceCerebro(id); return i >= 0 && CEREBROS[i] ? CEREBROS[i].nombre : ""; };
  // "cerebro/feat-x" o "cerebro/repo-x:ruta" → sin el prefijo del visor.
  var local = function (id, f) { var c = cerebroDe(f); return c && id.indexOf(c + "/") === 0 ? id.slice(c.length + 1) : id; };
  var ruta = function (ref, f) { var a = local(ref, f), i = a.indexOf(":"); return i < 0 ? a : a.slice(i + 1); };
  var corto = function (ref, f) { var r = ruta(ref, f).replace(/#L\d+$/, ""); return r.slice(r.lastIndexOf("/") + 1); };
  var specs = function (f) { return f.especificaciones || []; };
  var totalCasos = function (f) { var n = 0; (f.tests || []).forEach(function (t) { n += t.casos.length; }); return n; };
  // Sin test y sin que una persona haya decidido probarla a mano.
  var sinVerificar = function (e) { return !e.tests.length && !e.manual; };
  var clave = function (f, e) { return f.id + "|" + e.id; };
  var estadoDeReglas = function (es) {
    if (!es.length) return "sin_reglas";
    if (es.some(function (e) { return !e.archivos.length; })) return "sin_codigo";
    if (es.some(sinVerificar)) return "sin_test";
    return "cumplido";
  };

  // ---------- Cerebros elegidos ----------
  // Solo los que tienen funcionalidades; SEL vacío = todos. Se guardan por nombre: el orden del registro puede cambiar.
  var CON_FICHAS = [];
  FICHAS.forEach(function (f) { var c = cerebroDe(f.id); if (c && CON_FICHAS.indexOf(c) < 0) CON_FICHAS.push(c); });
  try {
    var guardados = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(CLAVE_CEREBROS) || "[]") : [];
    if (Array.isArray(guardados)) SEL = guardados.filter(function (c) { return CON_FICHAS.indexOf(c) >= 0; });
  } catch (e) { /* sin almacenamiento */ }
  if (SEL.length >= CON_FICHAS.length) SEL = [];
  var elegido = function (c) { return !SEL.length || SEL.indexOf(c) >= 0; };

  // ---------- Modelo: funcionalidades del producto (unidas entre cerebros) y sus casos de uso ----------
  // P = { id, nombre, resumen, fichas, cerebros, casos: [C], sueltas: [{ f, e }] }
  // C = { k, id, nombre, quien, todas: [pata], patas: [pata de los cerebros elegidos], ocultas, problemas: [{ cerebro, texto }], estado }
  // pata = { f, cerebro, reglas, estado }. El estado del caso sale solo de los cerebros elegidos.
  function armar() {
    var porLocal = {}, orden = [];
    FICHAS.forEach(function (f) {
      var k = local(f.id, f.id);
      if (!porLocal[k]) { porLocal[k] = { id: k, nombre: nombre(f.id), resumen: porId[f.id] && porId[f.id].r || "", fichas: [], cerebros: [], casos: [], sueltas: [] }; orden.push(k); }
      porLocal[k].fichas.push(f);
      var c = cerebroDe(f.id); if (c && porLocal[k].cerebros.indexOf(c) < 0) porLocal[k].cerebros.push(c);
    });
    return orden.map(function (k) {
      var P = porLocal[k], casos = {}, ordenCasos = [];
      P.fichas.forEach(function (f) {
        var porIdSpec = {}, usadas = {};
        specs(f).forEach(function (e) { porIdSpec[e.id] = e; });
        (f.casos || []).forEach(function (c) {
          if (!casos[c.id]) { casos[c.id] = { k: P.id + "|" + c.id, id: c.id, nombre: c.nombre, quien: c.quien || "", todas: [], patas: [], ocultas: 0, problemas: [] }; ordenCasos.push(c.id); }
          var C = casos[c.id], reglas = c.especificaciones.map(function (id) { return porIdSpec[id]; }).filter(Boolean);
          reglas.forEach(function (e) { usadas[e.id] = true; });
          if (!C.quien && c.quien) C.quien = c.quien;
          C.todas.push({ f: f, cerebro: cerebroDe(f.id), reglas: reglas, estado: estadoDeReglas(reglas) });
          if (c.problema) C.problemas.push({ cerebro: cerebroDe(f.id), texto: c.problema });
        });
        specs(f).forEach(function (e) { if (!usadas[e.id]) P.sueltas.push({ f: f, e: e }); });
      });
      P.casos = ordenCasos.map(function (id) { return casos[id]; });
      return P;
    });
  }
  function elegir(producto) {
    producto.forEach(function (P) {
      P.casos.forEach(function (C) {
        C.patas = C.todas.filter(function (p) { return elegido(p.cerebro); });
        C.ocultas = C.todas.length - C.patas.length;
        C.estado = C.patas.reduce(function (a, p) { return PESO[p.estado] < PESO[a] ? p.estado : a; }, "cumplido");
        if (C.patas.every(function (p) { return !p.reglas.length; })) C.estado = "sin_reglas";
      });
    });
    return producto;
  }
  var PRODUCTO = elegir(armar());

  var enCerebro = function (cerebros) { return cerebros.some(elegido); };
  var cerebrosDelCaso = function (C) { return C.patas.map(function (p) { return p.cerebro; }); };
  var enGrupo = function (C, g) { return g === "sintest" ? C.estado === "sin_test" || C.estado === "sin_codigo" : g === "problema" ? C.problemas.length > 0 : g === "cumplido" ? C.estado === "cumplido" : true; };
  var sueltaEnGrupo = function (x, g) { return g === "sintest" ? sinVerificar(x.e) || !x.e.archivos.length : g === "cumplido" ? !sinVerificar(x.e) && x.e.archivos.length > 0 : g === "problema" ? false : true; };
  var textoDeRegla = function (x) { return x.e.texto + " " + x.e.archivos.join(" ") + " " + x.e.tests.map(function (t) { return t.archivo + " " + (t.caso || ""); }).join(" "); };
  var conSpecs = function (P) { return P.fichas.some(function (f) { return specs(f).length; }); };
  var visibles = function () { return PRODUCTO.filter(function (P) { return enCerebro(P.cerebros); }); };
  var todosLosCasos = function () { var out = []; visibles().forEach(function (P) { P.casos.forEach(function (C) { if (C.patas.length) out.push([P, C]); }); }); return out; };
  var todasSueltas = function () { var out = []; visibles().forEach(function (P) { P.sueltas.forEach(function (x) { if (enCerebro([cerebroDe(x.f.id)])) out.push([P, x]); }); }); return out; };

  // ---------- Filtro y estadística ----------
  // Cada ítem es un caso de uso ({ P, C }) o una regla que todavía no está en ninguno ({ P, x }), de los cerebros elegidos.
  var ITEMS = null;
  function items() {
    if (ITEMS) return ITEMS;
    ITEMS = [];
    visibles().forEach(function (P) {
      P.casos.forEach(function (C) { if (C.patas.length) ITEMS.push({ P: P, C: C }); });
      P.sueltas.forEach(function (x) { if (elegido(cerebroDe(x.f.id))) ITEMS.push({ P: P, x: x }); });
    });
    return ITEMS;
  }
  var ESTADOS = function () { return [["cumplido", L("Fulfilled: code and test", "Cumplido: código y test"), "var(--bien)"], ["sin_test", L("Untested", "Sin test"), "var(--atencion)"], ["sin_codigo", L("No code", "Sin código"), "var(--mal)"], ["sin_reglas", L("No rules", "Sin reglas"), "var(--atencion)"]]; };
  var deEstado = function (v, i) { var es = ESTADOS(); for (var j = 0; j < es.length; j++) if (es[j][0] === v) return es[j][i]; return i === 1 ? v : ""; };
  var estadoDe = function (it) { return it.C ? it.C.estado : !it.x.e.archivos.length ? "sin_codigo" : sinVerificar(it.x.e) ? "sin_test" : "cumplido"; };
  var reglasDe = function (it) { var out = []; if (it.C) it.C.patas.forEach(function (p) { out = out.concat(p.reglas); }); else out.push(it.x.e); return out; };
  var nombreP = function (id) { for (var i = 0; i < PRODUCTO.length; i++) if (PRODUCTO[i].id === id) return PRODUCTO[i].nombre; return id; };
  var textoDe = function (it) {
    return it.P.nombre + " " + it.P.id + " " + (it.C ? it.C.nombre + " " + it.C.quien + " " + it.C.patas.map(function (p) { return p.cerebro + " " + p.reglas.map(function (e) { return textoDeRegla({ e: e }); }).join(" "); }).join(" ") : textoDeRegla(it.x));
  };
  // Los textos del filtro son getters (y la unidad, un arreglo con getters): el filtro los lee al pintar, en el idioma de ese momento.
  var UNIDAD = [];
  Object.defineProperty(UNIDAD, 0, { get: function () { return L("use case", "caso de uso"); } });
  Object.defineProperty(UNIDAD, 1, { get: function () { return L("use cases", "casos de uso"); } });
  fl = window.brainFiltros.crear({
    pre: "es", clave: "flowbrain.especificaciones.v2", unidad: UNIDAD, get todos() { return L("all use cases", "todos los casos de uso"); },
    items: items,
    estado: { abiertas: {} },
    contar: function (xs) {
      var nc = 0; xs.forEach(function (it) { if (it.C) nc++; });
      var ns = xs.length - nc;
      return [nc || !ns ? pl(nc, "use case", "use cases", "caso de uso", "casos de uso") : "", ns ? pl(ns, "rule without a use case", "rules without a use case", "regla sin caso", "reglas sin caso") : ""].filter(Boolean).join(L(" and ", " y "));
    },
    grupos: [
      { id: "", get etiqueta() { return L("All", "Todos"); } },
      { id: "sintest", get etiqueta() { return L("Untested", "Sin test"); }, get palabra() { return L("untested", "sin test"); }, es: function (it) { return it.C ? enGrupo(it.C, "sintest") : sueltaEnGrupo(it.x, "sintest"); } },
      { id: "problema", get etiqueta() { return L("Marked as wrong", "Marcados como mal"); }, get palabra() { return L("marked as wrong", "marcados como mal"); }, es: function (it) { return !!it.C && it.C.problemas.length > 0; } },
      { id: "cumplido", get etiqueta() { return L("Fulfilled", "Cumplidos"); }, get palabra() { return L("fulfilled", "cumplidos"); }, es: function (it) { return estadoDe(it) === "cumplido"; } }
    ],
    buscar: { get ph() { return L("Search a use case, a rule, a feature, a file or a test…", "Buscar un caso de uso, una regla, una funcionalidad, un archivo o un test…"); }, texto: textoDe },
    campos: [
      { id: "estado", get etiqueta() { return L("Status", "Estado"); }, get propio() { return L("the chosen status", "el estado elegido"); }, de: estadoDe,
        etiquetaDe: function (v) { return deEstado(v, 1); }, color: function (v) { return deEstado(v, 2); },
        palabra: function (v) { return L("status ", "estado ") + deEstado(v, 1).toLowerCase(); },
        valores: function () { var xs = items(); return ESTADOS().map(function (e) { return [e[0], e[1], xs.filter(function (it) { return estadoDe(it) === e[0]; }).length]; }); } },
      { id: "cerebro", get etiqueta() { return L("Brain", "Cerebro"); }, get propio() { return L("the chosen brain", "el cerebro elegido"); }, solo: function () { return CON_FICHAS.filter(elegido).length > 1; },
        de: function (it) { return it.C ? cerebrosDelCaso(it.C) : cerebroDe(it.x.f.id); }, palabra: function (v) { return L("brain ", "cerebro ") + v; } },
      { id: "feat", get etiqueta() { return L("Feature", "Funcionalidad"); }, get todos() { return L("All", "Todas"); }, get propio() { return L("the chosen feature", "la funcionalidad elegida"); }, de: function (it) { return it.P.id; }, etiquetaDe: nombreP,
        palabra: function (v) { return L("feature ", "funcionalidad ") + nombreP(v); } },
      { id: "tipo", get etiqueta() { return L("Rule type", "Tipo de regla"); }, de: function (it) { var t = {}; reglasDe(it).forEach(function (e) { t[e.tipo] = true; }); return Object.keys(t); },
        etiquetaDe: function (v) { return v === "negocio" ? L("Business", "De negocio") : v === "producto" ? L("Product", "De producto") : v; },
        palabra: function (v) { return v === "negocio" ? L("with business rules", "con reglas de negocio") : L("with product rules", "con reglas de producto"); } },
      { id: "quien", get etiqueta() { return L("Who does it", "Quién lo hace"); }, de: function (it) { return it.C ? it.C.quien : ""; }, palabra: function (v) { return L("done by ", "lo hace ") + v; } },
      { id: "que", get etiqueta() { return L("What", "Qué"); }, solo: function () { return items().some(function (it) { return !it.C; }); }, de: function (it) { return it.C ? "caso" : "suelta"; },
        etiquetaDe: function (v) { return v === "caso" ? L("Use cases", "Casos de uso") : L("Rules without a use case", "Reglas sin caso de uso"); }, palabra: function (v) { return v === "caso" ? L("only use cases", "solo casos de uso") : L("only rules without a use case", "solo reglas sin caso"); } }
    ],
    paneles: [
      { get titulo() { return L("By status", "Por estado"); }, campo: "estado", orden: "fijo" },
      { get titulo() { return L("By brain", "Por cerebro"); }, campo: "cerebro" },
      { get titulo() { return L("By feature", "Por funcionalidad"); }, campo: "feat", max: 8 }
    ],
    cifras: function () {
      var cs = todosLosCasos().map(function (x) { return x[1]; }), sueltas = todasSueltas().length;
      var cumplidos = cs.filter(function (C) { return C.estado === "cumplido"; }).length, sinTest = cs.filter(function (C) { return enGrupo(C, "sintest"); }).length, mal = cs.filter(function (C) { return C.problemas.length; }).length;
      var vacias = visibles().filter(function (P) { return !conSpecs(P); }).length;
      var out = [[cs.length, L("use cases", "casos de uso")], [cumplidos, L("fulfilled: code and test", "cumplidos: código y test"), cumplidos ? "var(--bien)" : "", "cumplido"], [sinTest, L("without a test that verifies them", "sin test que los verifique"), sinTest ? "var(--atencion)" : "", "sintest"], [mal, L("marked as wrong", "marcados como mal"), mal ? "var(--mal)" : "", "problema"]];
      if (sueltas) out.push([sueltas, L("rules without a use case", "reglas sin caso de uso"), "var(--atencion)"]);
      if (vacias) out.push([vacias, L("features with nothing written", "funcionalidades sin nada escrito"), "var(--atencion)"]);
      return out;
    },
    alCambiar: function (todo) { refrescar(todo); }
  });
  S = fl.S();
  var filtrosActivos = fl.activos;

  // ---------- Pedidos para el agente ----------
  // Los pedidos son instrucciones para el modelo: solo en inglés (dec. 214).
  var GUIA = "following the flowbrain specs --guide guide (in Claude Code: /flowbrain-specs)";
  // Plural en inglés con el número sin formato de idioma: el texto para el modelo no cambia con el switch.
  var plEn = function (n, uno, varios) { return n + " " + (n === 1 ? uno : varios); };
  function casoDeRegla(f, e) { var out = null; (f.casos || []).forEach(function (c) { if (c.especificaciones.indexOf(e.id) >= 0) out = c; }); return out; }
  function textoDelPedido(tipo, items) {
    var out;
    if (tipo === "corregir") {
      out = ["Fix these FlowBrain use cases that I marked as wrong, " + GUIA + ". After fixing each one, delete its problem field from the page.", ""];
      items.forEach(function (it) { porTexto(it[1].problemas).forEach(function (pr) { out.push("- " + it[0].id + " / " + it[1].id + " (" + it[1].nombre + "), " + (pr[1].length > 1 ? "brains " : "brain ") + pr[1].join(", ") + ": " + pr[0]); }); });
    } else if (tipo === "agrupar") {
      out = ["Group into use cases the specifications that are not in any use case yet, " + GUIA + ". The same use case in another brain keeps the same id. Don't change the text of the specifications.", ""];
      items.forEach(function (P) {
        var porCerebro = {};
        P.sueltas.forEach(function (x) { var c = cerebroDe(x.f.id); if (elegido(c)) porCerebro[c] = (porCerebro[c] || 0) + 1; });
        out.push("- " + P.id + " (" + P.nombre + "): " + Object.keys(porCerebro).map(function (c) { return plEn(porCerebro[c], "specification", "specifications") + " in " + c; }).join(", ") + ".");
      });
    } else {
      out = ["Write the use cases and specifications of " + (items.length === 1 ? "this FlowBrain feature" : "these " + items.length + " FlowBrain features") + " " + GUIA + ".", ""];
      items.forEach(function (P) {
        P.fichas.filter(function (f) { return elegido(cerebroDe(f.id)); }).forEach(function (f) { var n = totalCasos(f); out.push("- " + P.id + " (" + P.nombre + "), brain " + cerebroDe(f.id) + ": " + (n ? plEn(n, "test case", "test cases") : "no tests: derive them from the code") + "."); });
      });
    }
    out.push("", "When done, compile each brain and check with flowbrain specs <feature> --brain <brain> that no broken references remain.");
    return out.join("\n");
  }
  function copiar(texto, listo) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(function () { listo(true); }, function () { listo(false); }); return; }
    } catch (e) { /* sin portapapeles */ }
    listo(false);
  }
  var PEDIDOS = {};
  function botonPedido(k, tipo, items, etiqueta) {
    PEDIDOS[k] = [tipo, items];
    // Pedir un test no manda nada: suma la regla a la lista de «Tests pedidos» (celeste, la acción de la pantalla).
    if (tipo === "test") {
      return PD.boton({ tipo: "test", k: k, et: etiqueta });
    }
    if (AG) etiqueta = etiqueta.replace(/^Copiar pedido/, "Pedírselo al agente").replace(/^Copy request/, "Send request");
    // Pedir un test es la acción de la pantalla: va en celeste, para encontrarla de un vistazo.
    return '<button type="button" class="boton' + (tipo === "test" ? " es-pedir" : "") + '" data-acc="pedido" data-k="' + esc(k) + '">' + (PEDIDO && PEDIDO.k === k ? L("Hide request", "Ocultar pedido") : etiqueta) + "</button>";
  }
  function cajaDelPedido(k) {
    if (!PEDIDO || PEDIDO.k !== k || !PEDIDOS[k] || PEDIDOS[k][0] === "test") return "";
    var por = !ED ? L("To send it straight to the agent, open the viewer from the menu («Open the viewer») or with <code>flowbrain viewer --serve</code>.", "Para mandarlo directo al agente, abrí el visor desde el menú («Abrir el visor») o con <code>flowbrain viewer --serve</code>.")
      : ED.agente && ED.agente.noDisponible ? L("It can't be sent directly: ", "No se puede mandar directo: ") + esc(ED.agente.noDisponible) + "." : "";
    var botones = AG
      ? '<div class="fd-acc"><button type="button" class="boton pri" data-acc="mandar" data-k="' + esc(k) + '"' + (PEDIDO.mandado ? " disabled" : "") + ">" + (PEDIDO.mandado ? L("Sent", "Mandado") : L("Send to the agent", "Mandar al agente")) + '</button><button type="button" class="boton" data-acc="copiar" data-k="' + esc(k) + '">' + L("Copy", "Copiar") + "</button></div>" +
        "<small>" + L("Claude Code does it on this machine, in the project folder: it writes and runs the tests, but doesn't commit. It uses your Claude plan. You see the progress above, in «The agent».", "Lo hace Claude Code en esta máquina, en la carpeta del proyecto: escribe y corre los tests, pero no commitea. Usa tu plan de Claude. Ves el avance arriba, en «El agente».") + "</small>"
      : "";
    return '<div class="fd-plan"><h2>' + L("Request for the agent", "Pedido para el agente") + "</h2>" +
      '<textarea class="fd-texto" readonly rows="8" aria-label="' + L("Request for the agent", "Pedido para el agente") + '">' + esc(textoDelPedido(PEDIDOS[k][0], PEDIDOS[k][1])) + "</textarea>" + botones +
      (PEDIDO.copiado === true ? '<span class="fd-ok">' + L("Copied. Paste it into your agent.", "Copiado. Pegalo en tu agente.") + "</span>" : PEDIDO.copiado === "no" ? '<span class="fd-nota">' + L("It couldn't be copied automatically: select the text and copy it.", "No se pudo copiar solo: seleccioná el texto y copialo.") + "</span>" : "") +
      (PEDIDO.error ? '<p class="fd-msg error">' + esc(PEDIDO.error) + "</p>" : "") + (por ? '<p class="fd-nota">' + por + "</p>" : "") + "</div>";
  }
  // Qué cerebros toca un pedido y cómo se llama en la lista del agente.
  function cerebrosDelPedido(tipo, items) {
    var out = [], suma = function (c) { if (c && out.indexOf(c) < 0) out.push(c); };
    items.forEach(function (it) {
      if (tipo === "corregir") it[1].todas.forEach(function (p) { suma(p.cerebro); });
      else it.fichas.forEach(function (f) { if (elegido(cerebroDe(f.id))) suma(cerebroDe(f.id)); });
    });
    return out;
  }
  function etiquetaDelPedido(tipo, items) {
    if (tipo === "corregir") return L("Fix ", "Corregir ") + pl(items.length, "marked use case", "marked use cases", "caso marcado", "casos marcados");
    var que = items.length === 1 ? items[0].nombre : pl(items.length, "feature", "features", "funcionalidad", "funcionalidades");
    return (tipo === "agrupar" ? L("Group into use cases: ", "Agrupar en casos de uso: ") : L("Write use cases: ", "Escribir casos de uso: ")) + que;
  }

  // ---------- Una regla (dentro de un caso o suelta) ----------
  function unaRegla(e, f, conCerebro) {
    var k = clave(f, e);
    var cumple = e.archivos.length
      ? e.archivos.map(function (a) { return '<code title="' + esc(local(a, f.id)) + '">' + esc(corto(a, f.id)) + "</code>"; }).join(" ")
      : '<span class="es-mal">' + L("doesn't say which file fulfills it", "no dice qué archivo la cumple") + "</span>";
    var verifica = e.tests.length
      ? e.tests.map(function (t) { return '<span title="' + esc(ruta(t.archivo, f.id) + (t.linea ? " L" + t.linea : "")) + '">' + esc(t.caso || L("all of ", "todo ") + corto(t.archivo, f.id) + (t.casos !== undefined ? " (" + pl(t.casos, "case", "cases", "caso", "casos") + ")" : "")) + "</span>"; }).join('<span class="es-sep"> · </span>')
      : e.manual ? '<span class="es-manual">' + L("Tested by hand: ", "Se prueba a mano: ") + esc(e.manual) + "</span>" + (ED ? ' <button type="button" class="boton chico" data-acc="automatico" data-k="' + esc(k) + '"' + (ocupado ? " disabled" : "") + ">" + L("Ask for a test", "Pedirle un test") + "</button>" : "")
      : '<span class="es-mal">' + L("No test verifies it: if someone breaks it, nothing warns you.", "Ningún test la verifica: si alguien la rompe, nada avisa.") + "</span>";
    var acciones = !e.tests.length && !e.manual && MANUAL !== k
      ? '<div class="fd-acc">' + botonPedido("test|" + k, "test", [[e, f]], L("Request the test", "Pedir el test")) + (ED ? '<button type="button" class="boton" data-acc="manual" data-k="' + esc(k) + '"' + (ocupado ? " disabled" : "") + ">" + L("Doesn't need a test", "No necesita test") + "</button>" : "") + "</div>" + cajaDelPedido("test|" + k)
      : "";
    var form = MANUAL === k
      ? '<div class="es-form"><label for="es-motivo">' + L("Why it doesn't need an automated test", "Por qué no necesita un test automático") + '</label><input id="es-motivo" type="text" maxlength="300" placeholder="' + L("Tested by hand on the phone before each release", "Se prueba a mano en el celular antes de cada versión") + '" value="' + esc(MOTIVO) + '">' +
        '<div class="fd-acc"><button type="button" class="boton pri" data-acc="guardar-manual" data-k="' + esc(k) + '"' + (ocupado ? " disabled" : "") + ">" + L("Save", "Guardar") + '</button><button type="button" class="boton" data-acc="cancelar-manual">' + L("Cancel", "Cancelar") + "</button></div>" +
        "<small>" + L("It stops counting as untested. It's saved in the feature page of ", "Deja de contar como sin test. Se guarda en la página de la funcionalidad de ") + esc(cerebroDe(f.id)) + ".</small></div>"
      : "";
    var msg = MSG && MSG.k === k ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    var rotos = e.rotos.length ? '<p class="fd-msg error es-roto">' + L("The index no longer finds ", "El índice ya no encuentra ") + e.rotos.map(function (r) { return "<code>" + esc(local(r, f.id)) + "</code>"; }).join(", ") + L(": a file moved or a test was renamed. Ask the agent to fix it.", ": se movió un archivo o cambió el nombre de un test. Pedile al agente que lo corrija.") + "</p>" : "";
    return '<li class="es-regla"><p class="es-texto">' + esc(e.texto) + ' <span class="chip" title="' + esc(QUE_ES[e.tipo] || "") + '">' + esc(TIPO[e.tipo] || e.tipo) + "</span>" + (conCerebro ? ' <span class="chip">' + esc(cerebroDe(f.id)) + "</span>" : "") + "</p>" +
      '<div class="es-ref"><span class="lbl">' + L("Fulfilled by", "Lo cumple") + "</span><div>" + cumple + "</div></div>" +
      '<div class="es-ref"><span class="lbl">' + L("Verified by", "Lo verifica") + "</span><div>" + verifica + "</div></div>" + rotos + acciones + form + msg + "</li>";
  }

  // ---------- Un caso de uso ----------
  // El mismo comentario guardado en varios cerebros se dice una vez, con los cerebros donde está.
  function porTexto(problemas) {
    var out = [], idx = {};
    problemas.forEach(function (pr) { if (idx[pr.texto] === undefined) { idx[pr.texto] = out.length; out.push([pr.texto, []]); } out[idx[pr.texto]][1].push(pr.cerebro); });
    return out;
  }
  function filaDeCerebro(p, C, faltanDelCaso) {
    var pataK = "test|" + C.k + "|" + p.cerebro;
    var archivos = {}, tests = {}, sinTest = 0, sinCodigo = 0;
    p.reglas.forEach(function (e) {
      e.archivos.forEach(function (a) { archivos[a.replace(/#L\d+$/, "")] = true; });
      e.tests.forEach(function (t) { tests[t.archivo + "::" + (t.caso || "")] = true; });
      if (sinVerificar(e)) sinTest++;
      if (!e.archivos.length) sinCodigo++;
    });
    var a = Object.keys(archivos), nt = Object.keys(tests).length;
    var codigo = a.length ? a.slice(0, 4).map(function (x) { return '<code title="' + esc(local(x, p.f.id)) + '">' + esc(corto(x, p.f.id)) + "</code>"; }).join(" ") + (a.length > 4 ? " <small>" + L("and " + (a.length - 4) + " more", "y " + (a.length - 4) + " más") + "</small>" : "") : '<span class="es-mal">' + L("no code", "sin código") + "</span>";
    var test = !p.reglas.length ? '<span class="es-mal">' + L("no rules in this brain", "sin reglas en este cerebro") + "</span>"
      : sinTest ? '<span class="es-mal">✘ ' + (sinTest === p.reglas.length ? L("untested", "sin test") : L(sinTest + " of " + p.reglas.length + " rules untested", sinTest + " de " + p.reglas.length + " reglas sin test")) + "</span>" + (nt ? " <small>(" + pl(nt, "test", "tests", "test", "tests") + L(" in the others", " en las otras") + ")</small>" : "")
      : '<span class="es-bien">✔ ' + (nt ? pl(nt, "test", "tests", "test", "tests") : L("tested by hand", "se prueba a mano")) + "</span>" + (nt && p.reglas.some(function (e) { return e.manual; }) ? " <small>" + L("(and by hand)", "(y a mano)") + "</small>" : "");
    var pedir = sinTest && sinTest < faltanDelCaso ? " " + botonPedido(pataK, "test", p.reglas.filter(sinVerificar).map(function (e) { return [e, p.f]; }), sinTest === 1 ? L("Request the test", "Pedir el test") : L("Request the " + sinTest, "Pedir los " + sinTest)) : "";
    return '<tr><th scope="row">' + esc(p.cerebro) + "</th><td>" + codigo + (sinCodigo && a.length ? ' <span class="es-mal">(' + L(sinCodigo + " without a file", sinCodigo + " sin archivo") + ")</span>" : "") + '</td><td><div class="es-verifica"><span>' + test + "</span>" + pedir + "</div></td></tr>";
  }
  function unCaso(P, C) {
    var est = ESTADO[C.estado], reglas = [];
    C.patas.forEach(function (p) { p.reglas.forEach(function (e) { reglas.push([e, p.f]); }); });
    var peso = function (e) { return (sinVerificar(e) ? 0 : 2) + (e.tipo === "negocio" ? 0 : 1); };
    reglas.sort(function (a, b) { return peso(a[0]) - peso(b[0]); });
    var varios = C.patas.length > 1;
    var marca = C.problemas.length
      ? '<div class="es-problema"><b>' + L("Marked as wrong", "Marcado como mal") + "</b>" + porTexto(C.problemas).map(function (pr) { return "<p>«" + esc(pr[0]) + "»" + (C.todas.length > 1 && pr[1].length < C.todas.length ? " <small>(" + esc(pr[1].join(", ")) + ")</small>" : "") + "</p>"; }).join("") +
        "<small>" + L("The agent sees it with <code>/flowbrain-specs</code> (or <code>flowbrain specs --problems</code>), fixes it and removes the mark.", "El agente lo ve con <code>/flowbrain-specs</code> (o <code>flowbrain specs --problems</code>), lo corrige y saca la marca.") + "</small>" +
        (ED ? ' <button type="button" class="boton" data-acc="desmarcar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + ">" + L("Remove the mark", "Quitar la marca") + "</button>" : "") + "</div>"
      : "";
    var form = EDITA === C.k
      ? '<div class="es-form"><label for="es-nota">' + L("What's wrong", "Qué está mal") + '</label><textarea id="es-nota" rows="3" maxlength="1000" placeholder="' + L("The name isn't what the screen does, a rule is missing, the file or the test isn't that one…", "El nombre no es lo que hace la pantalla, falta una regla, el archivo o el test no es ese…") + '">' + esc(BORRADOR) + "</textarea>" +
        '<div class="fd-acc"><button type="button" class="boton pri" data-acc="guardar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + ">" + L("Save", "Guardar") + '</button><button type="button" class="boton" data-acc="cancelar">' + L("Cancel", "Cancelar") + "</button></div>" +
        "<small>" + (C.todas.length > 1
          ? L("It's saved in the feature page of each brain (", "Se guarda en la página de la funcionalidad de cada cerebro (") + esc(C.todas.map(function (p) { return p.cerebro; }).join(", ")) + ")."
          : L("It's saved in the feature page of its brain.", "Se guarda en la página de la funcionalidad de su cerebro.")) + "</small></div>"
      : "";
    var msg = MSG && MSG.k === C.k ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    var accion = ED && EDITA !== C.k ? '<button type="button" class="boton" data-acc="marcar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + ">" + L("This is wrong", "Esto está mal") + "</button>" : "";
    var faltan = [];
    C.patas.forEach(function (p) { p.reglas.forEach(function (e) { if (sinVerificar(e)) faltan.push([e, p.f]); }); });
    var pedirTodos = faltan.length ? botonPedido("test|" + C.k, "test", faltan, faltan.length === 1 ? L("Request the missing test", "Pedir el test que falta") : L("Request the " + faltan.length + " missing tests", "Pedir los " + faltan.length + " tests que faltan")) : "";
    var cajas = cajaDelPedido("test|" + C.k) + C.patas.map(function (p) { return cajaDelPedido("test|" + C.k + "|" + p.cerebro); }).join("");
    return '<li class="es-caso" id="es-caso-' + esc(C.k) + '"><div class="es-cabeza"><div><p class="es-nombre">' + esc(C.nombre) + "</p>" + (C.quien ? "<small>" + L("Who: ", "Quién: ") + esc(C.quien) + "</small>" : "") + "</div>" +
      '<div class="es-acciones"><span class="fd-es ' + est.cls + '" title="' + esc(est.que) + '">' + (C.estado === "cumplido" ? "✔ " : "✘ ") + est.txt + "</span>" + pedirTodos + accion + "</div></div>" +
      marca + form + msg + cajas +
      (C.ocultas ? '<p class="es-ocultas"><small>' + pl(C.ocultas, "more brain", "more brains", "cerebro más", "cerebros más") + L(" outside the chosen ones: ", " fuera de los elegidos: ") + esc(C.todas.filter(function (p) { return !elegido(p.cerebro); }).map(function (p) { return p.cerebro; }).join(", ")) + ".</small></p>" : "") +
      '<table class="es-patas"><thead><tr><th scope="col">' + L("Brain", "Cerebro") + '</th><th scope="col">' + L("Fulfilled by", "Lo cumple") + '</th><th scope="col">' + L("Verified by", "Lo verifica") + "</th></tr></thead><tbody>" + C.patas.map(function (p) { return filaDeCerebro(p, C, faltan.length); }).join("") + "</tbody></table>" +
      (reglas.length ? '<details class="tf es-reglas"><summary>' + pl(reglas.length, "rule", "rules", "regla", "reglas") + ": " + esc(reglas.slice(0, 3).map(function (r) { return r[0].texto.replace(/\.$/, ""); }).join(" · ")) + (reglas.length > 3 ? " …" : "") + "</summary>" +
        '<ul class="lista">' + reglas.map(function (r) { return unaRegla(r[0], r[1], varios); }).join("") + "</ul></details>" : "") + "</li>";
  }

  // ---------- Una funcionalidad del producto ----------
  // Lo de los cerebros elegidos: un caso que solo está en cerebros fuera de la elección no cuenta.
  var faltanDeNegocio = function (C) { var n = 0; C.patas.forEach(function (p) { p.reglas.forEach(function (e) { if (sinVerificar(e) && e.tipo === "negocio") n++; }); }); return n; };
  var vivos = function (P) { return P.casos.filter(function (C) { return C.patas.length; }); };
  var sueltasVivas = function (P) { return P.sueltas.filter(function (x) { return elegido(cerebroDe(x.f.id)); }); };
  function pendientes(P) {
    var mal = 0, falta = 0, sueltasSinTest = 0;
    vivos(P).forEach(function (C) { if (C.problemas.length) mal++; if (C.estado !== "cumplido") falta++; });
    sueltasVivas(P).forEach(function (x) { if (sinVerificar(x.e)) sueltasSinTest++; });
    return [mal, falta, sueltasSinTest];
  }
  function unaFuncionalidad(P, casos, sueltas) {
    var abierta = !!S.abiertas[P.id] || !!S.q.trim();
    var vs = vivos(P), ns = sueltasVivas(P).length;
    var cumplidos = vs.filter(function (C) { return C.estado === "cumplido"; }).length;
    var sinTest = vs.filter(function (C) { return C.estado === "sin_test" || C.estado === "sin_codigo"; }).length;
    var mal = vs.filter(function (C) { return C.problemas.length; }).length;
    var chips = (vs.length ? '<span class="chip">' + pl(vs.length, "use case", "use cases", "caso de uso", "casos de uso") + "</span>" +
        '<span class="chip es-ok">' + L(cumplidos + " fulfilled", cumplidos + " cumplido" + (cumplidos === 1 ? "" : "s")) + "</span>" +
        (sinTest ? '<span class="chip es-aviso">' + L(sinTest + " untested", sinTest + " sin test") + "</span>" : "") +
        (mal ? '<span class="chip es-falta">' + L(mal + " marked as wrong", mal + " marcado" + (mal === 1 ? "" : "s") + " como mal") + "</span>" : "") : "") +
      (ns ? '<span class="chip es-aviso">' + pl(ns, "rule without a use case", "rules without a use case", "regla sin caso de uso", "reglas sin caso de uso") + "</span>" : "") +
      P.cerebros.map(function (c) { return '<span class="chip es-cerebro' + (elegido(c) ? "" : " fuera") + '"' + (elegido(c) ? "" : ' title="' + L("Outside the chosen brains", "Fuera de los cerebros elegidos") + '"') + ">" + esc(c) + "</span>"; }).join("");
    var cuerpo = "";
    if (abierta) {
      var bloqueSueltas = sueltas.length
        ? '<div class="es-sueltas"><div class="es-cab"><h4>' + pl(sueltas.length, "rule without a use case", "rules without a use case", "regla sin caso de uso", "reglas sin caso de uso") + "</h4>" + botonPedido("agrupar|" + P.id, "agrupar", [P], L("Copy request for the agent", "Copiar pedido para el agente")) + "</div>" +
          "<p><small>" + L("The agent hasn't grouped them yet into what someone does with the product. Ask it and they show up above as use cases.", "El agente todavía no las agrupó en lo que alguien hace con el producto. Pedíselo y aparecen arriba como casos de uso.") + "</small></p>" + cajaDelPedido("agrupar|" + P.id) +
          '<ul class="lista">' + sueltas.map(function (x) { return unaRegla(x.e, x.f, P.cerebros.length > 1); }).join("") + "</ul></div>"
        : "";
      cuerpo = '<div class="es-cuerpo">' + (P.resumen ? '<p class="es-resumen">' + esc(P.resumen) + ' <a href="#/f/' + esc(P.fichas[0].id) + '">' + L("See the feature", "Ver la funcionalidad") + "</a></p>" : "") +
        (casos.length ? '<ul class="lista es-casos">' + casos.map(function (C) { return unCaso(P, C); }).join("") + "</ul>" : "") + bloqueSueltas + "</div>";
    }
    return '<section class="es-feat' + (abierta ? " abierta" : "") + '" id="es-' + esc(P.id) + '">' +
      '<button type="button" class="es-toggle" data-acc="abrir" data-k="' + esc(P.id) + '" aria-expanded="' + abierta + '"><span class="es-flecha">' + (abierta ? "▾" : "▸") + "</span><h3>" + esc(P.nombre) + "</h3></button>" +
      '<div class="chips">' + chips + "</div>" + cuerpo + "</section>";
  }

  // ---------- Las que no tienen ninguna especificación ----------
  function sinNinguna(lista) {
    if (!lista.length) return "";
    var tc = function (P) { return P.fichas.reduce(function (n, f) { return n + totalCasos(f); }, 0); };
    var orden = lista.slice().sort(function (a, b) { return tc(b) - tc(a) || (a.nombre.toLowerCase() < b.nombre.toLowerCase() ? -1 : 1); });
    return '<section class="es-feat"><div class="es-cab"><h3>' + L("No use cases or rules (", "Sin casos de uso ni reglas (") + lista.length + ")</h3>" + botonPedido("escribir|", "escribir", orden, L("Copy request for all", "Copiar pedido para todas")) + "</div>" +
      "<p><small>" + L("Nobody has written yet what can be done with these features. The agent deduces it from the code and the tests; the ones with more tests go first.", "Nadie escribió todavía qué se puede hacer con estas funcionalidades. Las deduce el agente del código y de los tests; las que más tests tienen van primero.") + "</small></p>" + cajaDelPedido("escribir|") +
      '<ul class="lista">' + orden.map(function (P) {
        var n = tc(P);
        return '<li class="es-fila"><span><a href="#/f/' + esc(P.fichas[0].id) + '">' + esc(P.nombre) + "</a> <small>" + (n ? pl(n, "test case", "test cases", "caso de test", "casos de test") : L("no tests", "sin tests")) + " · " + esc(P.cerebros.join(", ")) + "</small></span>" +
          botonPedido("escribir|" + P.id, "escribir", [P], L("Copy request", "Copiar pedido")) + cajaDelPedido("escribir|" + P.id) + "</li>";
      }).join("") + "</ul></section>";
  }

  // ---------- Página ----------
  // Varios a la vez; lo elegido queda guardado en este navegador para la próxima vez.
  function selectorDeCerebros() {
    if (CON_FICHAS.length < 2) return "";
    var boton = function (c) {
      var on = SEL.indexOf(c) >= 0;
      return '<button type="button" class="es-cer' + (on ? " on" : "") + '" data-acc="cerebro" data-k="' + esc(c) + '" aria-pressed="' + on + '">' + (on ? "✔ " : "") + esc(c) + "</button>";
    };
    return '<div class="es-cerebros" role="group" aria-label="' + L("Brains you follow", "Cerebros que seguís") + '"><span class="lbl">' + L("Brains you follow", "Cerebros que seguís") + "</span>" +
      '<button type="button" class="es-cer' + (SEL.length ? "" : " on") + '" data-acc="cerebro" data-k="" aria-pressed="' + !SEL.length + '">' + L("All", "Todos") + "</button>" + CON_FICHAS.map(boton).join("") +
      "<small>" + (SEL.length
        ? L("You see " + esc(SEL.join(", ")) + ": use cases only count what's in " + (SEL.length === 1 ? "that brain" : "those brains") + ". It's saved for next time.", "Ves " + esc(SEL.join(", ")) + ": los casos cuentan solo lo de " + (SEL.length === 1 ? "ese cerebro" : "esos cerebros") + ". Queda guardado para la próxima vez.")
        : L("Choose the brains you care about: it's saved for next time.", "Elegí los cerebros que te importan: queda guardado para la próxima vez.")) + "</small></div>";
  }
  function lista() {
    var xs = fl.filtrar(), sinFiltro = !fl.activos().length, porP = {}, filas = [];
    xs.forEach(function (it) {
      var k = it.P.id;
      if (!porP[k]) { porP[k] = [it.P, [], []]; filas.push(porP[k]); }
      if (it.C) porP[k][1].push(it.C); else porP[k][2].push(it.x);
    });
    filas.forEach(function (x) {
      x[1].sort(function (a, b) { return (b.problemas.length ? 1 : 0) - (a.problemas.length ? 1 : 0) || PESO[a.estado] - PESO[b.estado] || faltanDeNegocio(b) - faltanDeNegocio(a); });
      x[2].sort(function (a, b) { return (a.e.tests.length ? 1 : 0) - (b.e.tests.length ? 1 : 0); });
    });
    filas.sort(function (a, b) {
      var pa = pendientes(a[0]), pb = pendientes(b[0]);
      return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2] || (a[0].nombre.toLowerCase() < b[0].nombre.toLowerCase() ? -1 : 1);
    });
    var vacias = sinFiltro ? visibles().filter(function (P) { return !conSpecs(P); }) : [];
    if (!filas.length && !vacias.length) return fl.vacio(items());
    var corregir = S.grupo === "problema" && xs.some(function (it) { return it.C; })
      ? '<div class="es-sueltas"><div class="es-cab"><p>' + L("Pass what you marked to the agent so it fixes it.", "Pasale al agente lo que marcaste para que lo corrija.") + "</p>" + botonPedido("corregir|", "corregir", todosLosCasos().filter(function (x) { return x[1].problemas.length; }), L("Copy request for the agent", "Copiar pedido para el agente")) + "</div>" + cajaDelPedido("corregir|") + "</div>"
      : "";
    var todasAbiertas = filas.length && filas.every(function (x) { return S.abiertas[x[0].id]; });
    return (filas.length ? fl.resultado(xs, L(" in ", " en ") + pl(filas.length, "feature", "features", "funcionalidad", "funcionalidades") + L(". What's missing most, first.", ". Lo que más falta, primero."), '<button type="button" class="boton" data-acc="todas">' + (todasAbiertas ? L("Collapse all", "Plegar todas") : L("Expand all", "Desplegar todas")) + "</button>") : "") +
      corregir + filas.map(function (x) { return unaFuncionalidad(x[0], x[1], x[2]); }).join("") + sinNinguna(vacias);
  }
  var COMO = function () { return '<p class="subtitulo">' + L("What someone can do with each product feature, and whether it's fulfilled: the code that does it and the test that verifies it, in each brain. Each use case is made of plain-language rules. The agent deduces them by reading the code and the tests; you mark what's wrong and the agent fixes it.", "Qué puede hacer alguien con cada funcionalidad del producto, y si está cumplido: el código que lo hace y el test que lo verifica, en cada cerebro. Cada caso de uso se arma con reglas en llano. Los deduce el agente leyendo el código y los tests; vos marcás lo que está mal y el agente lo corrige.") + "</p>"; };
  function aviso() {
    var out = "";
    if (!ED) out += '<p class="aviso">' + L("This page is read-only. To mark a use case as wrong, open it with <code>flowbrain viewer --serve</code> (or from the menu, «Open the viewer»).", "Esta página es de solo lectura. Para marcar un caso de uso como mal, abrila con <code>flowbrain viewer --serve</code> (o desde el menú, «Abrir el visor»).") + "</p>";
    var n = todasSueltas().length, cs = todosLosCasos().length;
    if (n) {
      var conSueltas = visibles().filter(function (P) { return P.sueltas.length; });
      out += '<div class="aviso es-agrupar" id="es-agrupar"><p>' + L(
        (cs ? "There " + (n === 1 ? "is " : "are ") : "There are no use cases yet: there " + (n === 1 ? "is " : "are ")) + plural(n, "written rule", "written rules") + " the agent didn't group into use cases" + (cs ? "" : " (what someone does: «Vote for the best player of the match»)") + ". Ask it to group them; it doesn't change what's written, it only organizes it.",
        (cs ? "Hay " : "Todavía no hay casos de uso: hay ") + plural(n, "regla escrita", "reglas escritas") + " que el agente no agrupó en casos de uso" + (cs ? "" : " (lo que alguien hace: «Votar al mejor jugador del partido»)") + ". Pedile que las agrupe; no cambia lo escrito, solo lo ordena.") + "</p>" +
        botonPedido("agrupar|", "agrupar", conSueltas, L("Copy request to group them all", "Copiar pedido para agrupar todas")) + cajaDelPedido("agrupar|") + "</div>";
    }
    return out;
  }
  // ---------- Qué te toca hacer: cada pendiente con su cantidad y el botón que lo muestra ----------
  function queHacer() {
    var cs = todosLosCasos(), sueltas = todasSueltas().length, mal = 0, negocio = 0, producto = 0;
    cs.forEach(function (x) {
      if (x[1].problemas.length) mal++;
      x[1].patas.forEach(function (p) { p.reglas.forEach(function (e) { if (sinVerificar(e)) { if (e.tipo === "negocio") negocio++; else producto++; } }); });
    });
    if (!cs.length && !sueltas) return "";
    var paso = function (hecho, titulo, detalle, acc, k) {
      return '<li class="' + (hecho ? "hecho" : "") + '"><div><b>' + (pasos.length + 1) + ". " + (hecho ? "✔ " : "") + titulo + "</b>" + (detalle ? "<small>" + detalle + "</small>" : "") + "</div>" +
        (!hecho && acc ? '<button type="button" class="boton" data-acc="' + acc + '" data-k="' + esc(k || "") + '">' + L("View", "Ver") + "</button>" : "") + "</li>";
    };
    var pasos = [];
    if (sueltas) pasos.push(paso(false, L("Ask it to group " + plural(sueltas, "loose rule", "loose rules") + " into use cases", "Pedir que agrupe " + plural(sueltas, "regla suelta", "reglas sueltas") + " en casos de uso"), L("They're written but it's not known which action they belong to.", "Están escritas pero no se sabe a qué acción pertenecen."), "ir-agrupar"));
    pasos.push(paso(!mal, mal ? L("Pass " + plural(mal, "use case", "use cases") + " marked as wrong to the agent", "Pasarle al agente " + plural(mal, "caso marcado", "casos marcados") + " como mal") : L("Nothing marked as wrong", "Nada marcado como mal"), mal ? L("It fixes it and removes the mark.", "Lo corrige y saca la marca.") : "", "grupo", "problema"));
    pasos.push(paso(!negocio && !producto, negocio || producto ? L("Request the missing tests", "Pedir los tests que faltan") : L("Every rule has its test or is tested by hand", "Cada regla tiene su test o se prueba a mano"),
      negocio || producto
        ? L([negocio ? plural(negocio, "business rule", "business rules") : "", producto ? plural(producto, "screen rule", "screen rules") : ""].filter(Boolean).join(" and ") + " untested." + (negocio && producto ? " Start with the business ones: if they break, nobody finds out." : "") + " The ones tested by hand, mark them with «Doesn't need a test».",
          [negocio ? plural(negocio, "regla de negocio", "reglas de negocio") : "", producto ? plural(producto, "regla de pantalla", "reglas de pantalla") : ""].filter(Boolean).join(" y ") + " sin test." + (negocio && producto ? " Empezá por las de negocio: si se rompen, nadie se entera." : "") + " Las que se prueban a mano, marcalas con «No necesita test».")
        : "", "grupo", "sintest"));
    pasos.push(paso(false, L("Read the use cases and mark what's wrong", "Leer los casos de uso y marcar lo que está mal"), L("If a name, a rule, a file or a test isn't what the product does: «This is wrong».", "Si un nombre, una regla, un archivo o un test no es lo que hace el producto: «Esto está mal»."), "grupo", ""));
    return '<section class="es-hacer" aria-label="' + L("What you need to do", "Qué te toca hacer") + '"><h2>' + L("What you need to do", "Qué te toca hacer") + "</h2><ol>" + pasos.join("") + "</ol></section>";
  }
  function pintarLista() { var e = elem("es-lista"); if (e) e.innerHTML = lista(); }
  function pintarTodo() {
    if (!FICHAS.length) {
      raiz.innerHTML = "<h1>" + L("Specifications", "Especificaciones") + "</h1>" + '<p class="aviso">' + L("There are no features, so there are no use cases. First the product features are deduced: <code>/flowbrain-features</code> in the agent (or <code>flowbrain feature --guide</code>).", "No hay funcionalidades, así que no hay casos de uso. Primero se deducen las funcionalidades del producto: <code>/flowbrain-features</code> en el agente (o <code>flowbrain feature --guide</code>).") + "</p>";
      return;
    }
    var hay = todosLosCasos().length || todasSueltas().length;
    var nada = !hay
      ? '<p class="aviso">' + L("There are no use cases or written rules yet", "Todavía no hay casos de uso ni reglas escritas") + (SEL.length ? L(" in ", " en ") + esc(SEL.join(", ")) : "") + L(". They're saved in each feature's page and the agent deduces them: copy the request below and paste it, or run <code>/flowbrain-specs</code>.", ". Se guardan en la página de cada funcionalidad y las deduce el agente: copiá el pedido de abajo y pegáselo, o corré <code>/flowbrain-specs</code>.") + "</p>"
      : "";
    PEDIDOS = {};
    var cabeza = '<div class="es-titulo"><h1>' + L("Specifications", "Especificaciones") + "</h1></div>" + COMO() + aviso() + (CON_FICHAS.length > 1 ? selectorDeCerebros() : "") + queHacer() +
      '<section id="es-agente" class="' + (AG && sueltos().length ? "es-agente" : "") + '" aria-live="polite">' + htmlAgente() + "</section>" + (hay ? fl.html() + (todosLosCasos().length ? "" : '<p class="fd-nota">' + L("There are no use cases yet: the numbers count rules.", "Todavía no hay casos de uso: los números cuentan reglas.") + "</p>") : "") + nada;
    raiz.innerHTML = cabeza + '<div id="es-lista">' + lista() + "</div>";
    if (FOCO) { var s = elem("es-" + FOCO); FOCO = null; if (s && s.scrollIntoView) s.scrollIntoView(); }
  }
  function refrescar(todo) { guardar(); if (todo) pintarTodo(); else pintarLista(); }
  function pedir(cuerpo) {
    return fetch("/api/editar", { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); });
  }
  function buscarCaso(k) { var out = null; PRODUCTO.forEach(function (P) { P.casos.forEach(function (C) { if (C.k === k) out = [P, C]; }); }); return out; }
  // Marca (o desmarca, con texto vacío) el caso en la página de cada cerebro donde está, uno detrás del otro.
  function marcar(k, texto) {
    var pc = buscarCaso(k);
    if (!pc || ocupado || !ED) return;
    var C = pc[1], hechos = [];
    ocupado = true; MSG = { k: k, texto: L("Saving…", "Guardando…") }; pintarLista();
    var cadena = Promise.resolve();
    C.todas.forEach(function (p) {
      cadena = cadena.then(function () {
        return pedir({ tipo: "caso", cerebro: p.cerebro, funcionalidad: local(p.f.id, p.f.id), id: C.id, problema: texto || null }).then(function () {
          hechos.push(p.cerebro);
          (p.f.casos || []).forEach(function (c) { if (c.id === C.id) { if (texto) c.problema = texto; else delete c.problema; } });
        });
      });
    });
    cadena.then(function () {
      ocupado = false; EDITA = null; BORRADOR = "";
      ITEMS = null; PRODUCTO = elegir(armar());
      MSG = { k: k, texto: texto
        ? L("Marked as wrong in " + hechos.join(", ") + ". The agent fixes it with /flowbrain-specs; copy the request from «Marked as wrong».", "Quedó marcado como mal en " + hechos.join(", ") + ". El agente lo corrige con /flowbrain-specs; copiá el pedido desde «Marcados como mal».")
        : L("The mark was removed in " + hechos.join(", ") + ".", "Se le sacó la marca en " + hechos.join(", ") + ".") };
      pintarTodo();
    }).catch(function (e) {
      ocupado = false; ITEMS = null; PRODUCTO = elegir(armar());
      MSG = { k: k, texto: (hechos.length ? L("Saved in " + hechos.join(", ") + " but failed in the rest: ", "Se guardó en " + hechos.join(", ") + " pero falló en el resto: ") : "") + e.message, error: true };
      pintarTodo();
    });
  }

  // ---------- Tests pedidos: el tipo «test» del pedido al agente (viewer-pedido, dec. 229) ----------
  // «Pedir el test» (de una regla, de la fila de un cerebro o de un caso) suma reglas al pedido; nada se manda hasta
  // «Pedir todos». La lista, el panel, el lote y su avance son del componente; acá, qué es una regla y qué volvió.
  // DECIDIDAS: lo que se decidió de cada hallazgo sin recargar. CORRIGIENDO: mandando «Pedir la corrección».
  var DECIDIDAS = {}, CORRIGIENDO = false;
  var claveDeEntrada = function (x) { return x.cerebro + "|" + x.funcionalidad + "|" + x.regla; };

  // La regla como se la lee el agente (cerebro, funcionalidad, caso, id, tipo, texto y el archivo que la cumple): solo en inglés.
  function lineaDeRegla(x) {
    return "- Brain " + x.cerebro + ", " + x.funcionalidad + " (" + x.funcNombre + ")" + (x.caso ? ", use case " + x.caso + " (" + x.casoNombre + ")" : "") + ", rule " + x.regla + " [" + x.tipo + "]: " + x.texto +
      (x.archivos.length ? " Fulfilled by: " + x.archivos.join(", ") + "." : " It doesn't say which file fulfills it: find it first.");
  }
  // El ítem del pedido: { tipo: "test", k: "<ficha>|<regla>", cerebro, repo, datos: la regla como la muestra la tarjeta }.
  function entradaDe(e, f) {
    var C = casoDeRegla(f, e), archivos = e.archivos.map(function (a) { return local(a, f.id); }), repo = archivos.length ? archivos[0].split(":")[0] : "";
    var x = { k: f.id + "|" + e.id, cerebro: cerebroDe(f.id), funcionalidad: local(f.id, f.id), funcNombre: nombre(f.id), regla: e.id, tipo: e.tipo, texto: e.texto, caso: C ? C.id : "", casoNombre: C ? C.nombre : "", archivos: archivos, repo: /^repo-/.test(repo) ? repo : null };
    x.linea = lineaDeRegla(x);
    return { tipo: "test", k: x.k, cerebro: x.cerebro, repo: x.repo, datos: x };
  }
  // Las de negocio primero: son las que más cuesta que se rompan sin aviso.
  var negocioPrimero = function (a, b) { return (a.tipo === "negocio" ? 0 : 1) - (b.tipo === "negocio" ? 0 : 1); };
  // Las reglas de un botón «Pedir el test»: las de su regla, la fila de un cerebro o el caso entero.
  var reglasDelBoton = function (k) { var p = PEDIDOS[k]; return p && p[0] === "test" ? p[1] : []; };

  // ---- el .md: lo que se le pasa a cualquier agente con acceso al repo ----
  // Son instrucciones para el modelo, como la guía que trae (FLOWBRAIN_GUIA_TESTS): solo en inglés.
  function mdDeLista(xs) {
    var porRepo = {}, orden = [], guia = String(window.FLOWBRAIN_GUIA_TESTS || "").replace(/^---\n[\s\S]*?\n---\n/, "");
    xs.forEach(function (x) { var r = x.repo || "brain " + x.cerebro; if (!porRepo[r]) { porRepo[r] = []; orden.push(r); } porRepo[r].push(x); });
    var cerebros = []; xs.forEach(function (x) { if (cerebros.indexOf(x.cerebro) < 0) cerebros.push(x.cerebro); });
    var neg = xs.filter(function (x) { return x.tipo === "negocio"; }).length;
    var out = ["# Tests requested from FlowBrain", "",
      plEn(xs.length, "rule", "rules") + " (" + neg + " business, " + (xs.length - neg) + " screen) in " + plEn(orden.length, "repo", "repos") + ". The business ones go first.", "",
      "> **You need an agent with access to the repo** (Claude Code, Codex, Gemini CLI, OpenCode…): it has to read the code and run the tests. A web chat won't do: it can't do either.", "",
      "Open your agent in the project folder and pass it this whole file.", "",
      "## The guide", "", guia.replace("$ARGUMENTS", "The rules to resolve are further below, in «The rules»; the wrap-up, in «When done».").trim(), "", "## The rules", ""];
    orden.forEach(function (r) {
      out.push("### " + r + " (" + porRepo[r].length + ")", "");
      porRepo[r].forEach(function (x) { out.push(lineaDeRegla(x)); });
      out.push("");
    });
    out.push("## When done", "",
      "1. Record each result in its feature page, \u0060.flowbrain/<brain>/product/<feature>.md\u0060: the tests of a and b in the rule's \u0060tests:\u0060 (\u0060repo:path::test case name\u0060); those of c and d in \u0060hallazgo:\u0060 (\u0060resultado\u0060, \u0060hoy\u0060, \u0060cambio\u0060, \u0060test\u0060).",
      "2. Compile each brain: \u0060flowbrain compile\u0060 inside \u0060.flowbrain/<brain>/\u0060 (" + cerebros.map(function (c) { return "\u0060" + c + "\u0060"; }).join(", ") + ").",
      "3. Verify with \u0060flowbrain specs <feature> --brain <brain>\u0060: the rules with a test are no longer untested nor in \u0060rotos\u0060; the findings show with \u0060flowbrain specs --findings\u0060.",
      "4. Don't modify the product code or leave a failing test in the repo. Don't commit: the changes stay for review.", "");
    return out.join("\n");
  }
  var descargar = function (archivo, texto) { return PD.descargar(archivo, texto); };


  // ---- lo que quedó sin resolver con un test: hallazgos (c y d) ----
  // De las páginas (los que ya estaban al abrir) y, mientras la página no se recarga, de lo que acaba de volver del lote.
  function claveDeFicha(cerebro, funcionalidad, regla) { return cerebro + "/" + funcionalidad + "|" + regla; }
  function hallazgos() {
    var por = {}, orden = [];
    FICHAS.forEach(function (f) { specs(f).forEach(function (e) { if (e.hallazgo) { var k = f.id + "|" + e.id; por[k] = { k: k, f: f, e: e, h: e.hallazgo }; orden.push(k); } }); });
    var LT = PD.lote("test");
    if (LT) TRABAJOS.forEach(function (t) {
      if (t.lote !== LT.id) return;
      (t.resultados || []).forEach(function (r) {
        if (r.resultado !== "c" && r.resultado !== "d") return;
        var k = claveDeFicha(r.cerebro, r.funcionalidad, r.regla);
        if (por[k]) return;
        var par = buscarRegla(k);
        if (!par) return;
        por[k] = { k: k, f: par[1], e: par[0], h: { resultado: r.resultado === "c" ? "codigo_no_cumple" : "no_testeable", hoy: r.hoy, cambio: r.cambio, test: r.test } };
        orden.push(k);
      });
    });
    return orden.map(function (k) {
      var x = por[k], d = DECIDIDAS[k] !== undefined ? DECIDIDAS[k] : x.h.decision;
      return { k: k, f: x.f, e: x.e, h: x.h, decision: d || "" };
    });
  }
  var paraDecidir = function (hs) { return hs.filter(function (x) { return x.h.resultado === "codigo_no_cumple" && !x.decision; }); };
  var reglaMal = function (hs) { return hs.filter(function (x) { return x.decision === "regla_mal"; }); };
  var paraDesarrollo = function (hs) { return hs.filter(function (x) { return x.decision === "codigo_mal" || (x.h.resultado === "no_testeable" && x.decision !== "regla_mal"); }); };
  // Para desarrollo: lo lee una persona (tickets), en su idioma.
  function mdDesarrollo() {
    var hs = paraDesarrollo(hallazgos());
    var out = [L("# For development", "# Para desarrollo"), "", L(plural(hs.length, "rule", "rules") + " that couldn't be closed with a test and need work in the code. They come from FlowBrain: each one says what the code does today, what should change and, if there is one, the test that proves it.", plural(hs.length, "regla", "reglas") + " que no se pudieron cerrar con un test y necesitan trabajo en el código. Salen de FlowBrain: cada una dice qué hace hoy el código, qué habría que cambiar y, si hay, el test que lo demuestra."), ""];
    hs.forEach(function (x, i) {
      var h = x.h, ca = casoDeRegla(x.f, x.e);
      out.push("## " + (i + 1) + ". " + x.e.texto, "",
        L("- **Brain:** ", "- **Cerebro:** ") + cerebroDe(x.f.id), L("- **Feature:** ", "- **Funcionalidad:** ") + nombre(x.f.id) + " (\u0060" + local(x.f.id, x.f.id) + "\u0060)" + (ca ? L("\n- **Use case:** ", "\n- **Caso de uso:** ") + ca.nombre : ""), L("- **Rule:** ", "- **Regla:** ") + "\u0060" + x.e.id + "\u0060 [" + x.e.tipo + "]",
        L("- **Result:** ", "- **Resultado:** ") + (h.resultado === "codigo_no_cumple" ? L("the code doesn't fulfill the rule (a person confirmed it)", "el código no cumple la regla (una persona lo confirmó)") : L("it can't be tested without touching the code", "no se puede testear sin tocar el código")));
      if (x.e.archivos.length) out.push(L("- **File:** ", "- **Archivo:** ") + x.e.archivos.map(function (a) { return "\u0060" + local(a, x.f.id) + "\u0060"; }).join(", "));
      out.push("");
      if (h.hoy) out.push(L("**What the code does today:** ", "**Qué hace hoy el código:** ") + h.hoy, "");
      out.push("**" + (h.resultado === "codigo_no_cumple" ? L("What should change", "Qué habría que cambiar") : L("Minimal change to be able to test it", "Ajuste mínimo para poder testearla")) + ":** " + h.cambio, "");
      if (h.test) out.push(L("**Test that proves it** (it's not in the repo: it fails until the code is fixed):", "**Test que lo demuestra** (no está en el repo: falla hasta que se corrija el código):"), "", "\u0060\u0060\u0060", h.test, "\u0060\u0060\u0060", "");
    });
    return out.join("\n");
  }
  function decidir(k, decision) {
    var hs = hallazgos(), x = null; hs.forEach(function (y) { if (y.k === k) x = y; });
    if (!x || ocupado || !ED) return;
    ocupado = true; PD.aviso({ nota: L("Saving the decision in the page of " + cerebroDe(x.f.id) + "…", "Guardando la decisión en la página de " + cerebroDe(x.f.id) + "…") });
    pedir({ tipo: "decision", cerebro: cerebroDe(x.f.id), funcionalidad: local(x.f.id, x.f.id), id: x.e.id, decision: decision || null }).then(function () {
      ocupado = false; DECIDIDAS[k] = decision || "";
      if (x.e.hallazgo) { if (decision) x.e.hallazgo.decision = decision; else delete x.e.hallazgo.decision; }
      PD.aviso(null);
    }).catch(function (err) { ocupado = false; PD.aviso({ error: err.message }); });
  }
  function corregirReglas() {
    var hs = reglaMal(hallazgos());
    if (!hs.length || !AG || CORRIGIENDO) return;
    var cerebros = []; hs.forEach(function (x) { var c = cerebroDe(x.f.id); if (cerebros.indexOf(c) < 0) cerebros.push(c); });
    var texto = ["Fix the text of these FlowBrain rules: the agent that tried to test them found that the code does something else, and a person decided the rule is wrong, not the code. Do it " + GUIA + ". Fix the text of each rule (or delete it, if it no longer holds) according to what the code does today and delete its finding (hallazgo). Don't change the product code.", ""];
    hs.forEach(function (x) { texto.push("- Brain " + cerebroDe(x.f.id) + ", " + local(x.f.id, x.f.id) + ", rule " + x.e.id + ": «" + x.e.texto + "». The code today: " + (x.h.hoy || x.h.cambio)); });
    CORRIGIENDO = true; PD.aviso(null);
    PD.llamar("/api/agente", { tipo: "corregir", pedido: texto.join("\n"), etiqueta: L("Fix " + plural(hs.length, "rule", "rules") + " (the rule is wrong)", "Corregir " + plural(hs.length, "regla", "reglas") + " (la regla está mal)"), cerebros: cerebros, proveedor: PD.proveedor().id, modelo: PD.modelo().id }).then(function () {
      CORRIGIENDO = false; PD.actualizar();
    }).catch(function (err) { CORRIGIENDO = false; PD.aviso({ error: err.message }); });
  }

  // ---- lo que volvió del lote ----
  function resumenDeLote(ts) {
    var rs = []; ts.forEach(function (t) { rs = rs.concat(t.resultados || []); });
    var n = function (r) { return rs.filter(function (x) { return x.resultado === r; }).length; };
    var sin = 0; ts.forEach(function (t) { sin += (t.sinResultado || []).length; });
    var costo = 0; ts.forEach(function (t) { costo += t.costoUsd || 0; });
    return { rs: rs, a: n("a"), b: n("b"), c: n("c"), d: n("d"), sin: sin, costo: costo, fallaron: ts.filter(function (t) { return t.estado === "fallo"; }).length, cancelaron: ts.filter(function (t) { return t.estado === "cancelado"; }).length };
  }
  function htmlHallazgo(x, conBotones) {
    var h = x.h, ca = casoDeRegla(x.f, x.e), d = x.decision;
    var botones = conBotones && ED
      ? '<div class="fd-acc"><button type="button" class="boton" data-acc="regla-mal" data-k="' + esc(x.k) + '"' + (ocupado ? " disabled" : "") + ">" + L("The rule is wrong", "La regla está mal") + '</button><button type="button" class="boton" data-acc="codigo-mal" data-k="' + esc(x.k) + '"' + (ocupado ? " disabled" : "") + ">" + L("The code is wrong", "El código está mal") + "</button></div>"
      : conBotones ? '<p class="fd-nota">' + L("To decide, open the viewer with <code>flowbrain viewer --serve</code>.", "Para decidir, abrí el visor con <code>flowbrain viewer --serve</code>.") + "</p>"
      : ED && d ? '<div class="fd-acc"><button type="button" class="boton chico" data-acc="deshacer" data-k="' + esc(x.k) + '"' + (ocupado ? " disabled" : "") + ">" + L("Decide again", "Volver a decidir") + "</button></div>" : "";
    return '<li class="es-hallazgo"><p class="es-texto">' + esc(x.e.texto) + '</p><div class="chips"><span class="chip">' + esc(TIPO[x.e.tipo] || x.e.tipo) + '</span><span class="chip">' + esc(cerebroDe(x.f.id)) + '</span><span class="chip">' + esc(nombre(x.f.id)) + "</span>" + (ca ? '<span class="chip">' + esc(ca.nombre) + "</span>" : "") + "</div>" +
      (h.hoy ? '<div class="es-ref"><span class="lbl">' + L("The code today", "Hoy el código") + "</span><div>" + esc(h.hoy) + "</div></div>" : "") +
      '<div class="es-ref"><span class="lbl">' + (h.resultado === "codigo_no_cumple" ? L("What should change", "Habría que cambiar") : L("Minimal change", "Ajuste mínimo")) + "</span><div>" + esc(h.cambio) + "</div></div>" +
      (h.test ? '<details class="tf"><summary>' + L("The test that proves it", "El test que lo demuestra") + '</summary><pre class="es-test">' + esc(h.test) + "</pre></details>" : "") + botones + "</li>";
  }
  function htmlResultados() {
    var hs = hallazgos(), LT = PD.lote("test"), ts = LT ? PD.tandas(LT) : [], R = LT ? resumenDeLote(ts) : null;
    var verif = R ? R.rs.filter(function (r) { return r.resultado === "a" || r.resultado === "b"; }) : [];
    var dec = paraDecidir(hs), mal = reglaMal(hs), des = paraDesarrollo(hs), out = "";
    var seccion = function (titulo, n, ayuda, cuerpo, acc) { return '<section class="es-res"><div class="es-cab"><h3>' + titulo + ' <span class="chip">' + n + "</span></h3>" + (acc || "") + "</div>" + (ayuda ? "<small>" + ayuda + "</small>" : "") + cuerpo + "</section>"; };
    if (R) out += seccion(L("Verified", "Verificadas"), verif.length, L("They have a passing test: a new one (a) or one that already existed (b).", "Tienen un test que pasa: uno nuevo (a) o uno que ya existía (b)."),
      verif.length ? '<ul class="lista">' + verif.map(function (r) { var par = buscarRegla(claveDeFicha(r.cerebro, r.funcionalidad, r.regla)); return '<li class="es-verif"><p class="es-texto">' + esc(par ? par[0].texto : r.regla) + ' <span class="chip">' + (r.resultado === "a" ? L("New test", "Test nuevo") : L("Already had a test", "Ya tenía test")) + "</span></p><small>" + (r.tests || []).map(function (t) { return "<code>" + esc(t) + "</code>"; }).join(" ") + "</small></li>"; }).join("") + "</ul>" : "<p><small>" + L("None in this request.", "Ninguna en este pedido.") + "</small></p>");
    if (dec.length || R) out += seccion(L("To decide", "Para decidir"), dec.length, L("The code doesn't fulfill the rule. Is the rule wrong or is the code wrong?", "El código no cumple la regla. ¿Está mal la regla o está mal el código?"), dec.length ? '<ul class="lista">' + dec.map(function (x) { return htmlHallazgo(x, true); }).join("") + "</ul>" : "<p><small>" + L("Nothing to decide.", "Nada por decidir.") + "</small></p>");
    if (mal.length) out += seccion(L("The rule gets fixed", "La regla se corrige"), mal.length, L("You said the rule is wrong: the agent fixes it with <code>/flowbrain-specs</code>.", "Dijiste que la regla está mal: la corrige el agente con <code>/flowbrain-specs</code>."), '<ul class="lista">' + mal.map(function (x) { return htmlHallazgo(x, false); }).join("") + "</ul>",
      AG ? '<button type="button" class="boton" data-acc="corregir-reglas"' + (CORRIGIENDO ? " disabled" : "") + ">" + L("Request the fix", "Pedir la corrección") + "</button>" : "");
    if (des.length || R) out += seccion(L("For development", "Para desarrollo"), des.length, L("The code is wrong, or it can't be tested without touching it. The agent never changes the product code.", "El código está mal, o no se puede testear sin tocarlo. El agente nunca cambia el código del producto."), des.length ? '<ul class="lista">' + des.map(function (x) { return htmlHallazgo(x, false); }).join("") + "</ul>" : "<p><small>" + L("Nothing for development.", "Nada para desarrollo.") + "</small></p>",
      des.length ? '<button type="button" class="boton" data-acc="descargar-desarrollo">' + L("Download .md for tickets", "Descargar .md para tickets") + "</button>" : "");
    return out;
  }
  // El tipo «test» en el pedido al agente: cómo se ve cada regla, cómo se la manda y lo que vuelve.
  PD.registrar("test", {
    get nombre() { return L("Tests", "Tests"); },
    unidad: ["rule", "rules", "regla", "reglas"],
    raiz: raiz,
    claves: function (k) { return reglasDelBoton(k).map(function (it) { return it[1].id + "|" + it[0].id; }); },
    items: function (k) { return reglasDelBoton(k).map(function (it) { return entradaDe(it[0], it[1]); }); },
    repintar: function () { pintarLista(); },
    orden: function (a, b) { return negocioPrimero(a.datos, b.datos); },
    resumen: function (its) { var neg = its.filter(function (it) { return it.datos.tipo === "negocio"; }).length; return [L(neg + " business (they go first) · " + (its.length - neg) + " screen", neg + " de negocio (van primero) · " + (its.length - neg) + " de pantalla")]; },
    costo: function (mo) { return typeof mo.costoPorReglaUsd === "number" ? mo.costoPorReglaUsd : null; },
    lote: function (its) { return { tipo: "test", reglas: its.map(function (it) { var x = it.datos; return { cerebro: x.cerebro, funcionalidad: x.funcionalidad, regla: x.regla, repo: x.repo, linea: lineaDeRegla(x) }; }) }; },
    md: { archivo: "tests-pedidos.md", texto: function (its) { return mdDeLista(its.map(function (it) { return it.datos; })); } },
    // En una tanda, la regla se reconoce por cerebro, funcionalidad y regla: lo que tiene resultado sale de la lista.
    clave: function (it) { return claveDeEntrada(it.datos); },
    enTanda: function (t) { return (t.reglas || []).map(claveDeEntrada); },
    hechos: function (t) { return (t.resultados || []).map(claveDeEntrada); },
    seguimiento: {
      cuantos: function (t) { return (t.reglas || []).length; },
      get reindexando() { return L("Updating the index so the new tests count…", "Actualizando el índice para que los tests nuevos cuenten…"); },
      pidiendo: function (n, repos) { return L("Requesting " + plural(n, "rule", "rules") + " in " + plural(repos, "repo", "repos") + " at once", "Pidiendo " + plural(n, "regla", "reglas") + " en " + plural(repos, "repo", "repos") + " a la vez"); },
      extraTanda: function (t) { return (t.sinResultado || []).length ? '<p class="fd-nota">' + L("No result: ", "Sin resultado: ") + pl(t.sinResultado.length, "rule", "rules", "regla", "reglas") + L(". They stay in the list to request them again. ", ". Siguen en la lista para pedirlas de nuevo. ") + esc(t.sinResultado[0].motivo) + "</p>" : ""; },
      resumen: function (ts) {
        var R = resumenDeLote(ts);
        return L(R.a + " verified with a new test · " + R.b + " already covered · " + R.c + " with code that doesn't fulfill it · " + R.d + " that can't be tested without touching code",
          R.a + " verificadas con un test nuevo · " + R.b + " ya cubiertas · " + R.c + " con el código que no la cumple · " + R.d + " que no se pueden testear sin tocar código") +
          (R.sin ? " · " + L(R.sin + " without a result", R.sin + " sin resultado") : "");
      }
    },
    tarjeta: function (it, enTanda) {
      var x = it.datos;
      return '<p class="es-texto">' + esc(x.texto) + '</p><div class="chips"><span class="chip ' + (x.tipo === "negocio" ? "es-neg" : "") + '" title="' + esc(QUE_ES[x.tipo] || "") + '">' + (x.tipo === "negocio" ? L("Business", "De negocio") : L("Screen", "De pantalla")) + "</span>" +
          (x.caso ? '<span class="chip" title="' + L("Use case", "Caso de uso") + '">' + esc(x.casoNombre) + "</span>" : '<span class="chip">' + L("No use case", "Sin caso de uso") + "</span>") + '<span class="chip" title="' + L("Feature", "Funcionalidad") + '">' + esc(x.funcNombre) + '</span><span class="chip es-cerebro" title="' + L("Brain", "Cerebro") + '">' + esc(x.cerebro) + "</span>" +
          (enTanda ? '<span class="chip es-ok">' + L("Requesting…", "Pidiéndose…") + "</span>" : "") + "</div>" +
          '<small class="es-archivo">' + (x.archivos.length ? L("Fulfilled by: ", "La cumple: ") + x.archivos.map(function (a) { return "<code>" + esc(a.replace(/#L\d+$/, "")) + "</code>"; }).join(" ") : L("Doesn't say which file fulfills it", "No dice qué archivo la cumple")) + "</small>";
    },
    // Los resultados del último lote: verificadas, para decidir, la regla se corrige y para desarrollo.
    despues: function () { return htmlResultados(); },
    bandeja: function () { var pend = paraDecidir(hallazgos()).length; return pend ? L(pend + " to decide", pend + " para decidir") : ""; },
    accion: function (acc, k) {
      if (acc === "regla-mal") decidir(k, "regla_mal");
      else if (acc === "codigo-mal") decidir(k, "codigo_mal");
      else if (acc === "deshacer") decidir(k, null);
      else if (acc === "corregir-reglas") corregirReglas();
      else if (acc === "descargar-desarrollo") { if (!descargar(L("for-development.md", "para-desarrollo.md"), mdDesarrollo())) PD.aviso({ error: L("It couldn't be downloaded.", "No se pudo descargar.") }); }
      else return false;
      return true;
    }
  });
  // Lo que corre el agente lo trae el componente: acá, los pedidos sueltos («El agente») y lo que volvió del lote.
  PD.escuchar(function (ev) { if (ev === "trabajos") { TRABAJOS = PD.trabajos(); pintarAgente(); } });

  // ---------- El agente: mandar pedidos y ver cómo van ----------
  var pedirAgente = function (ruta, cuerpo) { return PD.llamar(ruta, cuerpo); };
  function mandar(k) {
    var p = PEDIDOS[k];
    if (!p || !AG || !PEDIDO || PEDIDO.k !== k || PEDIDO.mandado) return;
    PEDIDO.mandado = true; PEDIDO.error = null; pintarTodo();
    pedirAgente("/api/agente", { tipo: p[0], pedido: textoDelPedido(p[0], p[1]), etiqueta: etiquetaDelPedido(p[0], p[1]), cerebros: cerebrosDelPedido(p[0], p[1]), proveedor: PD.proveedor() ? PD.proveedor().id : undefined, modelo: PD.modelo() ? PD.modelo().id : undefined }).then(function () {
      PEDIDO = null; PD.actualizar(); pintarTodo();
      var a = elem("es-agente"); if (a && a.scrollIntoView) a.scrollIntoView();
    }).catch(function (e) { if (PEDIDO && PEDIDO.k === k) { PEDIDO.mandado = false; PEDIDO.error = e.message; pintarTodo(); } });
  }
  var vivo = function (t) { return t.estado === "en_cola" || t.estado === "corriendo"; };
  var estadoTrabajo = function (e) { return PD.estado(e); };
  function unTrabajo(t) {
    var e = estadoTrabajo(t.estado);
    var pasos = t.pasos || [], ultimos = pasos.slice(-4);
    var cambios = (t.cambios || []).map(function (c) { return "<li><b>" + esc(c.repo) + "</b>: " + c.archivos.map(function (a) { return "<code>" + esc(a) + "</code>"; }).join(" ") + "</li>"; }).join("");
    return '<li class="es-trabajo"><div class="es-cab"><b>' + esc(t.etiqueta) + '</b><span class="fd-es ' + e[1] + '">' + e[0] + "</span></div>" +
      (vivo(t) && ultimos.length ? '<ul class="es-pasos">' + ultimos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (t.estado === "en_cola" ? "<small>" + L("Waits for the previous one to finish.", "Espera a que termine el anterior.") + "</small>" : "") +
      (t.error ? '<p class="fd-msg error">' + esc(t.error) + "</p>" : "") +
      (!vivo(t) && t.resultado ? '<details class="tf"><summary>' + L("What the agent said", "Lo que dijo el agente") + '</summary><p class="es-resultado">' + esc(t.resultado) + "</p></details>" : "") +
      (!vivo(t) && pasos.length ? '<details class="tf"><summary>' + L("What it did (" + plural(pasos.length, "step", "steps") + ")", "Lo que hizo (" + plural(pasos.length, "paso", "pasos") + ")") + "</summary><ul class=\"es-pasos\">" + pasos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></details>" : "") +
      (cambios ? '<div class="es-cambios"><small>' + L("Changed, uncommitted (review it before committing):", "Cambió, sin commitear (revisalo antes de commitear):") + "</small><ul>" + cambios + "</ul></div>" : !vivo(t) && t.estado === "terminado" ? "<small>" + L("It didn't change files in the repos.", "No cambió archivos en los repos.") + "</small>" : "") +
      '<div class="fd-acc">' + (vivo(t) ? '<button type="button" class="boton" data-acc="cancelar-agente" data-k="' + esc(t.id) + '">' + L("Cancel", "Cancelar") + "</button>" : "") +
      (t.estado === "terminado" || t.estado === "fallo" ? '<button type="button" class="boton" data-acc="recargar">' + L("Reload to see the changes", "Recargar para ver los cambios") + "</button>" : "") + "</div></li>";
  }
  // Las tandas de «Pedir todos» se ven en el panel «Tests pedidos»; acá, los pedidos sueltos.
  var sueltos = function () { return TRABAJOS.filter(function (t) { return !t.lote && t.tipo !== "asociar"; }); };
  function htmlAgente() {
    if (!AG || !sueltos().length) return "";
    return "<h2>" + L("The agent", "El agente") + '</h2><ul class="lista">' + sueltos().map(unTrabajo).join("") + "</ul>";
  }
  function pintarAgente() { var a = elem("es-agente"); if (a) { a.innerHTML = htmlAgente(); a.className = sueltos().length && AG ? "es-agente" : ""; } }
  function buscarRegla(k) { var out = null; FICHAS.forEach(function (f) { specs(f).forEach(function (e) { if (clave(f, e) === k) out = [e, f]; }); }); return out; }
  function ponerManual(k, motivo) {
    var ef = buscarRegla(k);
    if (!ef || ocupado || !ED) return;
    var e = ef[0], f = ef[1];
    ocupado = true; MSG = { k: k, texto: L("Saving…", "Guardando…") }; pintarLista();
    pedir({ tipo: "manual", cerebro: cerebroDe(f.id), funcionalidad: local(f.id, f.id), id: e.id, motivo: motivo || null }).then(function () {
      if (motivo) e.manual = motivo; else delete e.manual;
      ocupado = false; MANUAL = null; MOTIVO = "";
      ITEMS = null; PRODUCTO = elegir(armar());
      MSG = { k: k, texto: motivo ? L("Marked as tested by hand: it no longer counts as untested.", "Queda como probada a mano: ya no cuenta como sin test.") : L("It counts as untested again: request the test whenever you want.", "Vuelve a contar como sin test: pedí el test cuando quieras.") };
      pintarTodo();
    }).catch(function (err) { ocupado = false; MSG = { k: k, texto: err.message, error: true }; pintarLista(); });
  }
  function accion(b) {
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k");
    if (acc === "cerebro") {
      if (!k) SEL = [];
      else if (SEL.indexOf(k) >= 0) SEL = SEL.filter(function (c) { return c !== k; });
      else SEL = SEL.concat([k]);
      if (SEL.length >= CON_FICHAS.length) SEL = [];
      SEL.sort(function (a, b) { return CON_FICHAS.indexOf(a) - CON_FICHAS.indexOf(b); });
      ITEMS = null; PRODUCTO = elegir(PRODUCTO); refrescar(true); return;
    }
    if (acc === "grupo") { fl.poner({ grupo: S.grupo === k && k ? "" : k || "" }); return; }
    if (acc === "abrir") { if (S.abiertas[k]) delete S.abiertas[k]; else S.abiertas[k] = true; refrescar(false); return; }
    if (acc === "todas") {
      var ids = [];
      fl.filtrar().forEach(function (it) { if (ids.indexOf(it.P.id) < 0) ids.push(it.P.id); });
      var todasAbiertas = ids.every(function (id) { return S.abiertas[id]; });
      ids.forEach(function (id) { if (todasAbiertas) delete S.abiertas[id]; else S.abiertas[id] = true; });
      refrescar(false); return;
    }
    if (acc === "marcar") { EDITA = k; BORRADOR = ""; MSG = null; pintarLista(); var t = elem("es-nota"); if (t && t.focus) t.focus(); return; }
    if (acc === "cancelar") { EDITA = null; BORRADOR = ""; pintarLista(); return; }
    if (acc === "guardar") {
      var nota = (BORRADOR || "").trim();
      if (!nota) { MSG = { k: k, texto: L("Write what's wrong: it's what the agent will read to fix it.", "Escribí qué está mal: es lo que va a leer el agente para corregirlo."), error: true }; pintarLista(); return; }
      marcar(k, nota); return;
    }
    if (acc === "desmarcar") { marcar(k, ""); return; }
    if (acc === "ir-agrupar") { var a = elem("es-agrupar"); if (a && a.scrollIntoView) a.scrollIntoView(); return; }
    if (acc === "manual") { MANUAL = k; MOTIVO = ""; MSG = null; pintarLista(); var m = elem("es-motivo"); if (m && m.focus) m.focus(); return; }
    if (acc === "cancelar-manual") { MANUAL = null; MOTIVO = ""; pintarLista(); return; }
    if (acc === "guardar-manual") {
      var motivo = (MOTIVO || "").trim();
      if (!motivo) { MSG = { k: k, texto: L("Write why it's tested by hand: it's what whoever comes next will read.", "Escribí por qué se prueba a mano: es lo que va a leer quien venga después."), error: true }; pintarLista(); return; }
      ponerManual(k, motivo); return;
    }
    if (acc === "automatico") { ponerManual(k, ""); return; }
    if (acc === "pedido") {
      if (PEDIDO && PEDIDO.k === k) { PEDIDO = null; pintarTodo(); return; }
      var p = PEDIDOS[k];
      if (!p || p[0] === "test") return;
      PEDIDO = { k: k, copiado: false }; pintarTodo();
      // Con el agente a mano, se muestra el pedido y se elige; sin él, se copia directo.
      if (!AG) copiar(textoDelPedido(p[0], p[1]), function (ok) { if (PEDIDO && PEDIDO.k === k) { PEDIDO.copiado = ok ? true : "no"; pintarTodo(); } });
      return;
    }
    if (acc === "copiar") {
      var pc = PEDIDOS[k];
      if (pc) copiar(textoDelPedido(pc[0], pc[1]), function (ok) { if (PEDIDO && PEDIDO.k === k) { PEDIDO.copiado = ok ? true : "no"; pintarTodo(); } });
      return;
    }
    if (acc === "mandar") { mandar(k); return; }
    // Sumar o sacar del pedido: el componente cambia los botones sin repintar (no se cierra lo que se estaba mirando).
    if (acc === "pedir") { PD.sumar("test", k); return; }
    if (acc === "cancelar-agente") { pedirAgente("/api/agente/cancelar", { id: k }).then(PD.actualizar, PD.actualizar); return; }
    if (acc === "recargar") { if (typeof location !== "undefined") location.reload(); return; }
  }
  raiz.addEventListener("click", function (ev) {
    if (fl.manejar(ev, "click")) return;
    var b = ev.target.closest ? ev.target.closest("[data-acc]") : null;
    if (b && !b.disabled) accion(b);
  });
  raiz.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var b = ev.target.closest ? ev.target.closest(".es-ir[data-fl]") : null;
    if (b) { if (ev.preventDefault) ev.preventDefault(); fl.manejar(ev, "click"); }
  });
  raiz.addEventListener("input", function (ev) {
    if (fl.manejar(ev, "input")) return;
    if (ev.target.id === "es-nota") BORRADOR = ev.target.value;
    else if (ev.target.id === "es-motivo") MOTIVO = ev.target.value;
  });
  raiz.addEventListener("change", function (ev) {
    if (fl.manejar(ev, "change")) return;
  });

  window.brainEspecificaciones = {
    mostrar: function (feat) {
      if (feat) { var k = local(feat, feat); fl.limpiar(true); S.abiertas[k] = true; FOCO = k; guardar(); }
      pintarTodo();
    }
  };
})();
`;

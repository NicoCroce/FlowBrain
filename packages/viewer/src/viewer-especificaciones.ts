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
  // Con el visor servido y Claude Code instalado, los pedidos se mandan directo al agente; si no, se copian.
  var AG = !!(ED && ED.agente && !ED.agente.noDisponible);
  // Los proveedores de agente instalados en la máquina, cada uno con sus modelos (el marcado por defecto, porDefecto).
  var PROVS = AG && ED.agente.proveedores ? ED.agente.proveedores : [];
  var TRABAJOS = [], LOTES = [], ESPERA = null;
  var TIPO = { negocio: "Negocio", producto: "Producto" };
  var QUE_ES = { negocio: "Regla del negocio: vale aunque cambie la pantalla", producto: "Cómo se comporta el producto para quien lo usa" };
  // Estado de un caso: el peor de sus cerebros. Orden: lo que más falta, primero.
  var ESTADO = {
    sin_codigo: { txt: "Sin código", cls: "no", que: "Alguna regla no dice qué archivo la cumple." },
    sin_test: { txt: "Sin test", cls: "falta", que: "Alguna regla no tiene un test que la verifique: si se rompe, nada avisa." },
    sin_reglas: { txt: "Sin reglas", cls: "na", que: "El caso no tiene ninguna regla escrita." },
    cumplido: { txt: "Cumplido", cls: "ok", que: "Cada regla tiene el código que la cumple y un test que la verifica." }
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

  var plural = function (n, uno, varios) { return n.toLocaleString("es") + " " + (n === 1 ? uno : varios); };
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
  var ESTADOS = [["cumplido", "Cumplido: código y test", "var(--bien)"], ["sin_test", "Sin test", "var(--atencion)"], ["sin_codigo", "Sin código", "var(--mal)"], ["sin_reglas", "Sin reglas", "var(--atencion)"]];
  var deEstado = function (v, i) { for (var j = 0; j < ESTADOS.length; j++) if (ESTADOS[j][0] === v) return ESTADOS[j][i]; return i === 1 ? v : ""; };
  var estadoDe = function (it) { return it.C ? it.C.estado : !it.x.e.archivos.length ? "sin_codigo" : sinVerificar(it.x.e) ? "sin_test" : "cumplido"; };
  var reglasDe = function (it) { var out = []; if (it.C) it.C.patas.forEach(function (p) { out = out.concat(p.reglas); }); else out.push(it.x.e); return out; };
  var nombreP = function (id) { for (var i = 0; i < PRODUCTO.length; i++) if (PRODUCTO[i].id === id) return PRODUCTO[i].nombre; return id; };
  var textoDe = function (it) {
    return it.P.nombre + " " + it.P.id + " " + (it.C ? it.C.nombre + " " + it.C.quien + " " + it.C.patas.map(function (p) { return p.cerebro + " " + p.reglas.map(function (e) { return textoDeRegla({ e: e }); }).join(" "); }).join(" ") : textoDeRegla(it.x));
  };
  fl = window.brainFiltros.crear({
    pre: "es", clave: "flowbrain.especificaciones.v2", unidad: ["caso de uso", "casos de uso"], todos: "todos los casos de uso",
    items: items,
    estado: { abiertas: {} },
    contar: function (xs) {
      var nc = 0; xs.forEach(function (it) { if (it.C) nc++; });
      var ns = xs.length - nc;
      return [nc || !ns ? plural(nc, "caso de uso", "casos de uso") : "", ns ? plural(ns, "regla sin caso", "reglas sin caso") : ""].filter(Boolean).join(" y ");
    },
    grupos: [
      { id: "", etiqueta: "Todos" },
      { id: "sintest", etiqueta: "Sin test", palabra: "sin test", es: function (it) { return it.C ? enGrupo(it.C, "sintest") : sueltaEnGrupo(it.x, "sintest"); } },
      { id: "problema", etiqueta: "Marcados como mal", palabra: "marcados como mal", es: function (it) { return !!it.C && it.C.problemas.length > 0; } },
      { id: "cumplido", etiqueta: "Cumplidos", palabra: "cumplidos", es: function (it) { return estadoDe(it) === "cumplido"; } }
    ],
    buscar: { ph: "Buscar un caso de uso, una regla, una funcionalidad, un archivo o un test…", texto: textoDe },
    campos: [
      { id: "estado", etiqueta: "Estado", propio: "el estado elegido", de: estadoDe,
        etiquetaDe: function (v) { return deEstado(v, 1); }, color: function (v) { return deEstado(v, 2); },
        palabra: function (v) { return "estado " + deEstado(v, 1).toLowerCase(); },
        valores: function () { var xs = items(); return ESTADOS.map(function (e) { return [e[0], e[1], xs.filter(function (it) { return estadoDe(it) === e[0]; }).length]; }); } },
      { id: "cerebro", etiqueta: "Cerebro", propio: "el cerebro elegido", solo: function () { return CON_FICHAS.filter(elegido).length > 1; },
        de: function (it) { return it.C ? cerebrosDelCaso(it.C) : cerebroDe(it.x.f.id); }, palabra: function (v) { return "cerebro " + v; } },
      { id: "feat", etiqueta: "Funcionalidad", todos: "Todas", propio: "la funcionalidad elegida", de: function (it) { return it.P.id; }, etiquetaDe: nombreP,
        palabra: function (v) { return "funcionalidad " + nombreP(v); } },
      { id: "tipo", etiqueta: "Tipo de regla", de: function (it) { var t = {}; reglasDe(it).forEach(function (e) { t[e.tipo] = true; }); return Object.keys(t); },
        etiquetaDe: function (v) { return v === "negocio" ? "De negocio" : v === "producto" ? "De producto" : v; },
        palabra: function (v) { return v === "negocio" ? "con reglas de negocio" : "con reglas de producto"; } },
      { id: "quien", etiqueta: "Quién lo hace", de: function (it) { return it.C ? it.C.quien : ""; }, palabra: function (v) { return "lo hace " + v; } },
      { id: "que", etiqueta: "Qué", solo: function () { return items().some(function (it) { return !it.C; }); }, de: function (it) { return it.C ? "caso" : "suelta"; },
        etiquetaDe: function (v) { return v === "caso" ? "Casos de uso" : "Reglas sin caso de uso"; }, palabra: function (v) { return v === "caso" ? "solo casos de uso" : "solo reglas sin caso"; } }
    ],
    paneles: [
      { titulo: "Por estado", campo: "estado", orden: "fijo" },
      { titulo: "Por cerebro", campo: "cerebro" },
      { titulo: "Por funcionalidad", campo: "feat", max: 8 }
    ],
    cifras: function () {
      var cs = todosLosCasos().map(function (x) { return x[1]; }), sueltas = todasSueltas().length;
      var cumplidos = cs.filter(function (C) { return C.estado === "cumplido"; }).length, sinTest = cs.filter(function (C) { return enGrupo(C, "sintest"); }).length, mal = cs.filter(function (C) { return C.problemas.length; }).length;
      var vacias = visibles().filter(function (P) { return !conSpecs(P); }).length;
      var out = [[cs.length, "casos de uso"], [cumplidos, "cumplidos: código y test", cumplidos ? "var(--bien)" : "", "cumplido"], [sinTest, "sin test que los verifique", sinTest ? "var(--atencion)" : "", "sintest"], [mal, "marcados como mal", mal ? "var(--mal)" : "", "problema"]];
      if (sueltas) out.push([sueltas, "reglas sin caso de uso", "var(--atencion)"]);
      if (vacias) out.push([vacias, "funcionalidades sin nada escrito", "var(--atencion)"]);
      return out;
    },
    alCambiar: function (todo) { refrescar(todo); }
  });
  S = fl.S();
  var filtrosActivos = fl.activos;

  // ---------- Pedidos para el agente ----------
  var GUIA = "siguiendo la guía de flowbrain specs --guide (en Claude Code: /flowbrain-specs)";
  function casoDeRegla(f, e) { var out = null; (f.casos || []).forEach(function (c) { if (c.especificaciones.indexOf(e.id) >= 0) out = c; }); return out; }
  function textoDelPedido(tipo, items) {
    var out;
    if (tipo === "corregir") {
      out = ["Corregí estos casos de uso de FlowBrain que marqué como mal, " + GUIA + ". Después de corregir cada uno, borrá su campo problema de la página.", ""];
      items.forEach(function (it) { porTexto(it[1].problemas).forEach(function (pr) { out.push("- " + it[0].id + " / " + it[1].id + " (" + it[1].nombre + "), " + (pr[1].length > 1 ? "cerebros " : "cerebro ") + pr[1].join(", ") + ": " + pr[0]); }); });
    } else if (tipo === "agrupar") {
      out = ["Agrupá en casos de uso las especificaciones que todavía no están en ninguno, " + GUIA + ". El mismo caso en otro cerebro lleva el mismo id. No cambies el texto de las especificaciones.", ""];
      items.forEach(function (P) {
        var porCerebro = {};
        P.sueltas.forEach(function (x) { var c = cerebroDe(x.f.id); if (elegido(c)) porCerebro[c] = (porCerebro[c] || 0) + 1; });
        out.push("- " + P.id + " (" + P.nombre + "): " + Object.keys(porCerebro).map(function (c) { return plural(porCerebro[c], "especificación", "especificaciones") + " en " + c; }).join(", ") + ".");
      });
    } else {
      out = ["Escribí los casos de uso y las especificaciones de " + (items.length === 1 ? "esta funcionalidad" : "estas " + items.length + " funcionalidades") + " de FlowBrain " + GUIA + ".", ""];
      items.forEach(function (P) {
        P.fichas.filter(function (f) { return elegido(cerebroDe(f.id)); }).forEach(function (f) { var n = totalCasos(f); out.push("- " + P.id + " (" + P.nombre + "), cerebro " + cerebroDe(f.id) + ": " + (n ? plural(n, "caso de test", "casos de test") : "sin tests: salen del código") + "."); });
      });
    }
    out.push("", "Al terminar, compilá cada cerebro y revisá con flowbrain specs <funcionalidad> --brain <cerebro> que no queden referencias rotas.");
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
      var yaEsta = items.length > 0 && items.every(function (it) { return enLista(it[1].id + "|" + it[0].id); });
      return '<button type="button" class="boton es-pedir' + (yaEsta ? " en-lista" : "") + '" data-acc="sumar" data-k="' + esc(k) + '" data-et="' + esc(etiqueta) + '" aria-pressed="' + yaEsta + '" title="' + (yaEsta ? "Tocalo para sacarla de la lista" : "Suma la regla a la lista de tests pedidos: no se manda nada hasta «Pedir todos»") + '">' + (yaEsta ? "✔ En tests pedidos" : etiqueta) + "</button>";
    }
    if (AG) etiqueta = etiqueta.replace(/^Copiar pedido/, "Pedírselo al agente");
    // Pedir un test es la acción de la pantalla: va en celeste, para encontrarla de un vistazo.
    return '<button type="button" class="boton' + (tipo === "test" ? " es-pedir" : "") + '" data-acc="pedido" data-k="' + esc(k) + '">' + (PEDIDO && PEDIDO.k === k ? "Ocultar pedido" : etiqueta) + "</button>";
  }
  function cajaDelPedido(k) {
    if (!PEDIDO || PEDIDO.k !== k || !PEDIDOS[k] || PEDIDOS[k][0] === "test") return "";
    var por = !ED ? "Para mandarlo directo al agente, abrí el visor desde el menú («Abrir el visor») o con <code>flowbrain viewer --serve</code>."
      : ED.agente && ED.agente.noDisponible ? "No se puede mandar directo: " + esc(ED.agente.noDisponible) + "." : "";
    var botones = AG
      ? '<div class="fd-acc"><button type="button" class="boton pri" data-acc="mandar" data-k="' + esc(k) + '"' + (PEDIDO.mandado ? " disabled" : "") + ">" + (PEDIDO.mandado ? "Mandado" : "Mandar al agente") + '</button><button type="button" class="boton" data-acc="copiar" data-k="' + esc(k) + '">Copiar</button></div>' +
        "<small>Lo hace Claude Code en esta máquina, en la carpeta del proyecto: escribe y corre los tests, pero no commitea. Usa tu plan de Claude. Ves el avance arriba, en «El agente».</small>"
      : "";
    return '<div class="fd-plan"><h2>Pedido para el agente</h2>' +
      '<textarea class="fd-texto" readonly rows="8" aria-label="Pedido para el agente">' + esc(textoDelPedido(PEDIDOS[k][0], PEDIDOS[k][1])) + "</textarea>" + botones +
      (PEDIDO.copiado === true ? '<span class="fd-ok">Copiado. Pegalo en tu agente.</span>' : PEDIDO.copiado === "no" ? '<span class="fd-nota">No se pudo copiar solo: seleccioná el texto y copialo.</span>' : "") +
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
    if (tipo === "corregir") return "Corregir " + plural(items.length, "caso marcado", "casos marcados");
    var que = items.length === 1 ? items[0].nombre : plural(items.length, "funcionalidad", "funcionalidades");
    return (tipo === "agrupar" ? "Agrupar en casos de uso: " : "Escribir casos de uso: ") + que;
  }

  // ---------- Una regla (dentro de un caso o suelta) ----------
  function unaRegla(e, f, conCerebro) {
    var k = clave(f, e);
    var cumple = e.archivos.length
      ? e.archivos.map(function (a) { return '<code title="' + esc(local(a, f.id)) + '">' + esc(corto(a, f.id)) + "</code>"; }).join(" ")
      : '<span class="es-mal">no dice qué archivo la cumple</span>';
    var verifica = e.tests.length
      ? e.tests.map(function (t) { return '<span title="' + esc(ruta(t.archivo, f.id) + (t.linea ? " L" + t.linea : "")) + '">' + esc(t.caso || "todo " + corto(t.archivo, f.id) + (t.casos !== undefined ? " (" + plural(t.casos, "caso", "casos") + ")" : "")) + "</span>"; }).join('<span class="es-sep"> · </span>')
      : e.manual ? '<span class="es-manual">Se prueba a mano: ' + esc(e.manual) + "</span>" + (ED ? ' <button type="button" class="boton chico" data-acc="automatico" data-k="' + esc(k) + '"' + (ocupado ? " disabled" : "") + ">Pedirle un test</button>" : "")
      : '<span class="es-mal">Ningún test la verifica: si alguien la rompe, nada avisa.</span>';
    var acciones = !e.tests.length && !e.manual && MANUAL !== k
      ? '<div class="fd-acc">' + botonPedido("test|" + k, "test", [[e, f]], "Pedir el test") + (ED ? '<button type="button" class="boton" data-acc="manual" data-k="' + esc(k) + '"' + (ocupado ? " disabled" : "") + ">No necesita test</button>" : "") + "</div>" + cajaDelPedido("test|" + k)
      : "";
    var form = MANUAL === k
      ? '<div class="es-form"><label for="es-motivo">Por qué no necesita un test automático</label><input id="es-motivo" type="text" maxlength="300" placeholder="Se prueba a mano en el celular antes de cada versión" value="' + esc(MOTIVO) + '">' +
        '<div class="fd-acc"><button type="button" class="boton pri" data-acc="guardar-manual" data-k="' + esc(k) + '"' + (ocupado ? " disabled" : "") + '>Guardar</button><button type="button" class="boton" data-acc="cancelar-manual">Cancelar</button></div>' +
        "<small>Deja de contar como sin test. Se guarda en la página de la funcionalidad de " + esc(cerebroDe(f.id)) + ".</small></div>"
      : "";
    var msg = MSG && MSG.k === k ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    var rotos = e.rotos.length ? '<p class="fd-msg error es-roto">El índice ya no encuentra ' + e.rotos.map(function (r) { return "<code>" + esc(local(r, f.id)) + "</code>"; }).join(", ") + ": se movió un archivo o cambió el nombre de un test. Pedile al agente que lo corrija.</p>" : "";
    return '<li class="es-regla"><p class="es-texto">' + esc(e.texto) + ' <span class="chip" title="' + esc(QUE_ES[e.tipo] || "") + '">' + esc(TIPO[e.tipo] || e.tipo) + "</span>" + (conCerebro ? ' <span class="chip">' + esc(cerebroDe(f.id)) + "</span>" : "") + "</p>" +
      '<div class="es-ref"><span class="lbl">Lo cumple</span><div>' + cumple + "</div></div>" +
      '<div class="es-ref"><span class="lbl">Lo verifica</span><div>' + verifica + "</div></div>" + rotos + acciones + form + msg + "</li>";
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
    var codigo = a.length ? a.slice(0, 4).map(function (x) { return '<code title="' + esc(local(x, p.f.id)) + '">' + esc(corto(x, p.f.id)) + "</code>"; }).join(" ") + (a.length > 4 ? " <small>y " + (a.length - 4) + " más</small>" : "") : '<span class="es-mal">sin código</span>';
    var test = !p.reglas.length ? '<span class="es-mal">sin reglas en este cerebro</span>'
      : sinTest ? '<span class="es-mal">✘ ' + (sinTest === p.reglas.length ? "sin test" : sinTest + " de " + p.reglas.length + " reglas sin test") + "</span>" + (nt ? " <small>(" + plural(nt, "test", "tests") + " en las otras)</small>" : "")
      : '<span class="es-bien">✔ ' + (nt ? plural(nt, "test", "tests") : "se prueba a mano") + "</span>" + (nt && p.reglas.some(function (e) { return e.manual; }) ? " <small>(y a mano)</small>" : "");
    var pedir = sinTest && sinTest < faltanDelCaso ? " " + botonPedido(pataK, "test", p.reglas.filter(sinVerificar).map(function (e) { return [e, p.f]; }), "Pedir " + (sinTest === 1 ? "el test" : "los " + sinTest)) : "";
    return '<tr><th scope="row">' + esc(p.cerebro) + "</th><td>" + codigo + (sinCodigo && a.length ? ' <span class="es-mal">(' + sinCodigo + " sin archivo)</span>" : "") + '</td><td><div class="es-verifica"><span>' + test + "</span>" + pedir + "</div></td></tr>";
  }
  function unCaso(P, C) {
    var est = ESTADO[C.estado], reglas = [];
    C.patas.forEach(function (p) { p.reglas.forEach(function (e) { reglas.push([e, p.f]); }); });
    var peso = function (e) { return (sinVerificar(e) ? 0 : 2) + (e.tipo === "negocio" ? 0 : 1); };
    reglas.sort(function (a, b) { return peso(a[0]) - peso(b[0]); });
    var varios = C.patas.length > 1;
    var marca = C.problemas.length
      ? '<div class="es-problema"><b>Marcado como mal</b>' + porTexto(C.problemas).map(function (pr) { return "<p>«" + esc(pr[0]) + "»" + (C.todas.length > 1 && pr[1].length < C.todas.length ? " <small>(" + esc(pr[1].join(", ")) + ")</small>" : "") + "</p>"; }).join("") +
        "<small>El agente lo ve con <code>/flowbrain-specs</code> (o <code>flowbrain specs --problems</code>), lo corrige y saca la marca.</small>" +
        (ED ? ' <button type="button" class="boton" data-acc="desmarcar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + ">Quitar la marca</button>" : "") + "</div>"
      : "";
    var form = EDITA === C.k
      ? '<div class="es-form"><label for="es-nota">Qué está mal</label><textarea id="es-nota" rows="3" maxlength="1000" placeholder="El nombre no es lo que hace la pantalla, falta una regla, el archivo o el test no es ese…">' + esc(BORRADOR) + "</textarea>" +
        '<div class="fd-acc"><button type="button" class="boton pri" data-acc="guardar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + '>Guardar</button><button type="button" class="boton" data-acc="cancelar">Cancelar</button></div>' +
        "<small>Se guarda en la página de la funcionalidad de " + (C.todas.length > 1 ? "cada cerebro (" + esc(C.todas.map(function (p) { return p.cerebro; }).join(", ")) + ")" : "su cerebro") + ".</small></div>"
      : "";
    var msg = MSG && MSG.k === C.k ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    var accion = ED && EDITA !== C.k ? '<button type="button" class="boton" data-acc="marcar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + ">Esto está mal</button>" : "";
    var faltan = [];
    C.patas.forEach(function (p) { p.reglas.forEach(function (e) { if (sinVerificar(e)) faltan.push([e, p.f]); }); });
    var pedirTodos = faltan.length ? botonPedido("test|" + C.k, "test", faltan, faltan.length === 1 ? "Pedir el test que falta" : "Pedir los " + faltan.length + " tests que faltan") : "";
    var cajas = cajaDelPedido("test|" + C.k) + C.patas.map(function (p) { return cajaDelPedido("test|" + C.k + "|" + p.cerebro); }).join("");
    return '<li class="es-caso" id="es-caso-' + esc(C.k) + '"><div class="es-cabeza"><div><p class="es-nombre">' + esc(C.nombre) + "</p>" + (C.quien ? "<small>Quién: " + esc(C.quien) + "</small>" : "") + "</div>" +
      '<div class="es-acciones"><span class="fd-es ' + est.cls + '" title="' + esc(est.que) + '">' + (C.estado === "cumplido" ? "✔ " : "✘ ") + est.txt + "</span>" + pedirTodos + accion + "</div></div>" +
      marca + form + msg + cajas +
      (C.ocultas ? '<p class="es-ocultas"><small>' + plural(C.ocultas, "cerebro más", "cerebros más") + " fuera de los elegidos: " + esc(C.todas.filter(function (p) { return !elegido(p.cerebro); }).map(function (p) { return p.cerebro; }).join(", ")) + ".</small></p>" : "") +
      '<table class="es-patas"><thead><tr><th scope="col">Cerebro</th><th scope="col">Lo cumple</th><th scope="col">Lo verifica</th></tr></thead><tbody>' + C.patas.map(function (p) { return filaDeCerebro(p, C, faltan.length); }).join("") + "</tbody></table>" +
      (reglas.length ? '<details class="tf es-reglas"><summary>' + plural(reglas.length, "regla", "reglas") + ": " + esc(reglas.slice(0, 3).map(function (r) { return r[0].texto.replace(/\.$/, ""); }).join(" · ")) + (reglas.length > 3 ? " …" : "") + "</summary>" +
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
    var chips = (vs.length ? '<span class="chip">' + plural(vs.length, "caso de uso", "casos de uso") + "</span>" +
        '<span class="chip es-ok">' + cumplidos + " cumplido" + (cumplidos === 1 ? "" : "s") + "</span>" +
        (sinTest ? '<span class="chip es-aviso">' + sinTest + " sin test</span>" : "") +
        (mal ? '<span class="chip es-falta">' + mal + " marcado" + (mal === 1 ? "" : "s") + " como mal</span>" : "") : "") +
      (ns ? '<span class="chip es-aviso">' + plural(ns, "regla sin caso de uso", "reglas sin caso de uso") + "</span>" : "") +
      P.cerebros.map(function (c) { return '<span class="chip es-cerebro' + (elegido(c) ? "" : " fuera") + '"' + (elegido(c) ? "" : ' title="Fuera de los cerebros elegidos"') + ">" + esc(c) + "</span>"; }).join("");
    var cuerpo = "";
    if (abierta) {
      var bloqueSueltas = sueltas.length
        ? '<div class="es-sueltas"><div class="es-cab"><h4>' + plural(sueltas.length, "regla", "reglas") + " sin caso de uso</h4>" + botonPedido("agrupar|" + P.id, "agrupar", [P], "Copiar pedido para el agente") + "</div>" +
          "<p><small>El agente todavía no las agrupó en lo que alguien hace con el producto. Pedíselo y aparecen arriba como casos de uso.</small></p>" + cajaDelPedido("agrupar|" + P.id) +
          '<ul class="lista">' + sueltas.map(function (x) { return unaRegla(x.e, x.f, P.cerebros.length > 1); }).join("") + "</ul></div>"
        : "";
      cuerpo = '<div class="es-cuerpo">' + (P.resumen ? '<p class="es-resumen">' + esc(P.resumen) + ' <a href="#/f/' + esc(P.fichas[0].id) + '">Ver la funcionalidad</a></p>' : "") +
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
    return '<section class="es-feat"><div class="es-cab"><h3>Sin casos de uso ni reglas (' + lista.length + ")</h3>" + botonPedido("escribir|", "escribir", orden, "Copiar pedido para todas") + "</div>" +
      "<p><small>Nadie escribió todavía qué se puede hacer con estas funcionalidades. Las deduce el agente del código y de los tests; las que más tests tienen van primero.</small></p>" + cajaDelPedido("escribir|") +
      '<ul class="lista">' + orden.map(function (P) {
        var n = tc(P);
        return '<li class="es-fila"><span><a href="#/f/' + esc(P.fichas[0].id) + '">' + esc(P.nombre) + "</a> <small>" + (n ? plural(n, "caso de test", "casos de test") : "sin tests") + " · " + esc(P.cerebros.join(", ")) + "</small></span>" +
          botonPedido("escribir|" + P.id, "escribir", [P], "Copiar pedido") + cajaDelPedido("escribir|" + P.id) + "</li>";
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
    return '<div class="es-cerebros" role="group" aria-label="Cerebros que seguís"><span class="lbl">Cerebros que seguís</span>' +
      '<button type="button" class="es-cer' + (SEL.length ? "" : " on") + '" data-acc="cerebro" data-k="" aria-pressed="' + !SEL.length + '">Todos</button>' + CON_FICHAS.map(boton).join("") +
      "<small>" + (SEL.length ? "Ves " + esc(SEL.join(", ")) + ": los casos cuentan solo lo de " + (SEL.length === 1 ? "ese cerebro" : "esos cerebros") + ". Queda guardado para la próxima vez." : "Elegí los cerebros que te importan: queda guardado para la próxima vez.") + "</small></div>";
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
      ? '<div class="es-sueltas"><div class="es-cab"><p>Pasale al agente lo que marcaste para que lo corrija.</p>' + botonPedido("corregir|", "corregir", todosLosCasos().filter(function (x) { return x[1].problemas.length; }), "Copiar pedido para el agente") + "</div>" + cajaDelPedido("corregir|") + "</div>"
      : "";
    var todasAbiertas = filas.length && filas.every(function (x) { return S.abiertas[x[0].id]; });
    return (filas.length ? fl.resultado(xs, " en " + plural(filas.length, "funcionalidad", "funcionalidades") + ". Lo que más falta, primero.", '<button type="button" class="boton" data-acc="todas">' + (todasAbiertas ? "Plegar todas" : "Desplegar todas") + "</button>") : "") +
      corregir + filas.map(function (x) { return unaFuncionalidad(x[0], x[1], x[2]); }).join("") + sinNinguna(vacias);
  }
  var COMO = '<p class="subtitulo">Qué puede hacer alguien con cada funcionalidad del producto, y si está cumplido: el código que lo hace y el test que lo verifica, en cada cerebro. Cada caso de uso se arma con reglas en llano. Los deduce el agente leyendo el código y los tests; vos marcás lo que está mal y el agente lo corrige.</p>';
  function aviso() {
    var out = "";
    if (!ED) out += '<p class="aviso">Esta página es de solo lectura. Para marcar un caso de uso como mal, abrila con <code>flowbrain viewer --serve</code> (o desde el menú, «Abrir el visor»).</p>';
    var n = todasSueltas().length, cs = todosLosCasos().length;
    if (n) {
      var conSueltas = visibles().filter(function (P) { return P.sueltas.length; });
      out += '<div class="aviso es-agrupar" id="es-agrupar"><p>' + (cs ? "Hay " : "Todavía no hay casos de uso: hay ") + plural(n, "regla escrita", "reglas escritas") + " que el agente no agrupó en casos de uso" + (cs ? "" : " (lo que alguien hace: «Votar al mejor jugador del partido»)") + ". Pedile que las agrupe; no cambia lo escrito, solo lo ordena.</p>" +
        botonPedido("agrupar|", "agrupar", conSueltas, "Copiar pedido para agrupar todas") + cajaDelPedido("agrupar|") + "</div>";
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
        (!hecho && acc ? '<button type="button" class="boton" data-acc="' + acc + '" data-k="' + esc(k || "") + '">Ver</button>' : "") + "</li>";
    };
    var pasos = [];
    if (sueltas) pasos.push(paso(false, "Pedir que agrupe " + plural(sueltas, "regla suelta", "reglas sueltas") + " en casos de uso", "Están escritas pero no se sabe a qué acción pertenecen.", "ir-agrupar"));
    pasos.push(paso(!mal, mal ? "Pasarle al agente " + plural(mal, "caso marcado", "casos marcados") + " como mal" : "Nada marcado como mal", mal ? "Lo corrige y saca la marca." : "", "grupo", "problema"));
    pasos.push(paso(!negocio && !producto, negocio || producto ? "Pedir los tests que faltan" : "Cada regla tiene su test o se prueba a mano",
      negocio || producto ? [negocio ? plural(negocio, "regla de negocio", "reglas de negocio") : "", producto ? plural(producto, "regla de pantalla", "reglas de pantalla") : ""].filter(Boolean).join(" y ") + " sin test." + (negocio && producto ? " Empezá por las de negocio: si se rompen, nadie se entera." : "") + " Las que se prueban a mano, marcalas con «No necesita test»." : "", "grupo", "sintest"));
    pasos.push(paso(false, "Leer los casos de uso y marcar lo que está mal", "Si un nombre, una regla, un archivo o un test no es lo que hace el producto: «Esto está mal».", "grupo", ""));
    return '<section class="es-hacer" aria-label="Qué te toca hacer"><h2>Qué te toca hacer</h2><ol>' + pasos.join("") + "</ol></section>";
  }
  function pintarLista() { var e = elem("es-lista"); if (e) e.innerHTML = lista(); }
  function pintarTodo() {
    if (!FICHAS.length) {
      raiz.innerHTML = "<h1>Especificaciones</h1>" + '<p class="aviso">No hay funcionalidades, así que no hay casos de uso. Primero se deducen las funcionalidades del producto: <code>/flowbrain-features</code> en el agente (o <code>flowbrain feature --guide</code>).</p>';
      return;
    }
    var hay = todosLosCasos().length || todasSueltas().length;
    var nada = !hay
      ? '<p class="aviso">Todavía no hay casos de uso ni reglas escritas' + (SEL.length ? " en " + esc(SEL.join(", ")) : "") + ". Se guardan en la página de cada funcionalidad y las deduce el agente: copiá el pedido de abajo y pegáselo, o corré <code>/flowbrain-specs</code>.</p>"
      : "";
    PEDIDOS = {};
    var cabeza = '<div class="es-titulo"><h1>Especificaciones</h1><span id="es-bandeja">' + htmlBandeja() + "</span></div>" + COMO + aviso() + (CON_FICHAS.length > 1 ? selectorDeCerebros() : "") + queHacer() +
      '<section id="es-agente" class="' + (AG && sueltos().length ? "es-agente" : "") + '" aria-live="polite">' + htmlAgente() + "</section>" + (hay ? fl.html() + (todosLosCasos().length ? "" : '<p class="fd-nota">Todavía no hay casos de uso: los números cuentan reglas.</p>') : "") + nada;
    raiz.innerHTML = cabeza + '<div id="es-lista">' + lista() + '</div><aside id="es-panel" class="es-panel' + (PANEL ? " abierto" : "") + '" aria-label="Tests pedidos">' + htmlPanel() + "</aside>";
    if (raiz.classList) { if (PANEL) raiz.classList.add("es-con-panel"); else raiz.classList.remove("es-con-panel"); }
    if (FOCO) { var s = elem("es-" + FOCO); FOCO = null; if (s && s.scrollIntoView) s.scrollIntoView(); }
  }
  function refrescar(todo) { guardar(); if (todo) pintarTodo(); else pintarLista(); }
  function pedir(cuerpo) {
    return fetch("/api/editar", { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "el servidor respondió " + r.status); return j; }); });
  }
  function buscarCaso(k) { var out = null; PRODUCTO.forEach(function (P) { P.casos.forEach(function (C) { if (C.k === k) out = [P, C]; }); }); return out; }
  // Marca (o desmarca, con texto vacío) el caso en la página de cada cerebro donde está, uno detrás del otro.
  function marcar(k, texto) {
    var pc = buscarCaso(k);
    if (!pc || ocupado || !ED) return;
    var C = pc[1], hechos = [];
    ocupado = true; MSG = { k: k, texto: "Guardando…" }; pintarLista();
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
      MSG = { k: k, texto: texto ? "Quedó marcado como mal en " + hechos.join(", ") + ". El agente lo corrige con /flowbrain-specs; copiá el pedido desde «Marcados como mal»." : "Se le sacó la marca en " + hechos.join(", ") + "." };
      pintarTodo();
    }).catch(function (e) {
      ocupado = false; ITEMS = null; PRODUCTO = elegir(armar());
      MSG = { k: k, texto: (hechos.length ? "Se guardó en " + hechos.join(", ") + " pero falló en el resto: " : "") + e.message, error: true };
      pintarTodo();
    });
  }

  // ---------- Tests pedidos: la lista, el panel lateral y el lote ----------
  // «Pedir el test» (de una regla, de la fila de un cerebro o de un caso) suma reglas a la lista; nada se manda hasta
  // «Pedir todos». La lista se guarda en este navegador (localStorage) y sobrevive a recargar la página.
  var CLAVE_LISTA = "flowbrain.especificaciones.pedidos", CLAVE_AGENTE = "flowbrain.especificaciones.agente", CLAVE_PANEL = "flowbrain.especificaciones.panel", CLAVE_VISTOS = "flowbrain.especificaciones.lotes";
  var LISTA = [], PANEL = false, ELEGIDO = { proveedor: "", modelo: "" }, VISTOS = [], DECIDIDAS = {}, PANEL_ERROR = "", PANEL_NOTA = "", PIDIENDO = false, OCULTA_ESTA_VEZ = {};
  var leerLocal = function (k, por) { try { if (typeof localStorage !== "undefined") { var v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } } catch (e) { /* sin almacenamiento */ } return por; };
  var guardarLocal = function (k, v) { try { if (typeof localStorage !== "undefined") localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
  LISTA = leerLocal(CLAVE_LISTA, []); if (!Array.isArray(LISTA)) LISTA = [];
  LISTA = LISTA.filter(function (x) { return x && typeof x.k === "string" && typeof x.linea === "string"; });
  PANEL = leerLocal(CLAVE_PANEL, false) === true && LISTA.length > 0;
  VISTOS = leerLocal(CLAVE_VISTOS, []); if (!Array.isArray(VISTOS)) VISTOS = [];
  var sel0 = leerLocal(CLAVE_AGENTE, {}); if (sel0 && typeof sel0 === "object") ELEGIDO = { proveedor: sel0.proveedor || "", modelo: sel0.modelo || "" };
  var guardarLista = function () { guardarLocal(CLAVE_LISTA, LISTA); guardarLocal(CLAVE_PANEL, PANEL); };
  var enLista = function (k) { return LISTA.some(function (x) { return x.k === k; }); };
  var claveDeEntrada = function (x) { return x.cerebro + "|" + x.funcionalidad + "|" + x.regla; };
  var dolares = function (n) { return "US$ " + (n < 0.1 ? n.toFixed(3) : n.toFixed(2)); };

  // La regla como se la lee el agente: cerebro, funcionalidad, caso, id, tipo, texto y el archivo que la cumple.
  function lineaDeRegla(x) {
    return "- Cerebro " + x.cerebro + ", " + x.funcionalidad + " (" + x.funcNombre + ")" + (x.caso ? ", caso " + x.caso + " (" + x.casoNombre + ")" : "") + ", regla " + x.regla + " [" + x.tipo + "]: " + x.texto +
      (x.archivos.length ? " La cumple: " + x.archivos.join(", ") + "." : " No dice qué archivo la cumple: buscalo primero.");
  }
  function entradaDe(e, f) {
    var C = casoDeRegla(f, e), archivos = e.archivos.map(function (a) { return local(a, f.id); }), repo = archivos.length ? archivos[0].split(":")[0] : "";
    var x = { k: f.id + "|" + e.id, cerebro: cerebroDe(f.id), funcionalidad: local(f.id, f.id), funcNombre: nombre(f.id), regla: e.id, tipo: e.tipo, texto: e.texto, caso: C ? C.id : "", casoNombre: C ? C.nombre : "", archivos: archivos, repo: /^repo-/.test(repo) ? repo : null };
    x.linea = lineaDeRegla(x);
    return x;
  }
  // Las de negocio primero: son las que más cuesta que se rompan sin aviso.
  var ordenadas = function () { return LISTA.slice().sort(function (a, b) { return (a.tipo === "negocio" ? 0 : 1) - (b.tipo === "negocio" ? 0 : 1); }); };
  function botonesDePedido() {
    var bs = raiz.querySelectorAll('[data-acc="sumar"]');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], p = PEDIDOS[b.getAttribute("data-k")];
      if (!p) continue;
      var ya = p[1].length > 0 && p[1].every(function (it) { return enLista(it[1].id + "|" + it[0].id); });
      b.setAttribute("aria-pressed", String(ya));
      if (b.classList) { if (ya) b.classList.add("en-lista"); else b.classList.remove("en-lista"); }
      b.textContent = ya ? "✔ En tests pedidos" : (b.getAttribute("data-et") || "Pedir el test");
    }
  }
  function sumarOQuitar(items) {
    var todas = items.length > 0 && items.every(function (it) { return enLista(it[1].id + "|" + it[0].id); });
    if (todas) {
      var ks = items.map(function (it) { return it[1].id + "|" + it[0].id; });
      LISTA = LISTA.filter(function (x) { return ks.indexOf(x.k) < 0; });
    } else {
      items.forEach(function (it) { if (!enLista(it[1].id + "|" + it[0].id)) LISTA.push(entradaDe(it[0], it[1])); });
      PANEL = true;
    }
    guardarLista();
  }
  function proveedorElegido() {
    for (var i = 0; i < PROVS.length; i++) if (PROVS[i].id === ELEGIDO.proveedor) return PROVS[i];
    return PROVS[0] || null;
  }
  function modeloElegido() {
    var p = proveedorElegido(); if (!p) return null;
    for (var i = 0; i < p.modelos.length; i++) if (p.modelos[i].id === ELEGIDO.modelo) return p.modelos[i];
    for (var j = 0; j < p.modelos.length; j++) if (p.modelos[j].porDefecto) return p.modelos[j];
    return p.modelos[0] || null;
  }

  // ---- el .md: lo que se le pasa a cualquier agente con acceso al repo ----
  function mdDeLista() {
    var xs = ordenadas(), porRepo = {}, orden = [], guia = String(window.FLOWBRAIN_GUIA_TESTS || "").replace(/^---\n[\s\S]*?\n---\n/, "");
    xs.forEach(function (x) { var r = x.repo || "cerebro " + x.cerebro; if (!porRepo[r]) { porRepo[r] = []; orden.push(r); } porRepo[r].push(x); });
    var cerebros = []; xs.forEach(function (x) { if (cerebros.indexOf(x.cerebro) < 0) cerebros.push(x.cerebro); });
    var neg = xs.filter(function (x) { return x.tipo === "negocio"; }).length;
    var out = ["# Tests pedidos desde FlowBrain", "",
      plural(xs.length, "regla", "reglas") + " (" + neg + " de negocio, " + (xs.length - neg) + " de pantalla) en " + plural(orden.length, "repo", "repos") + ". Las de negocio van primero.", "",
      "> **Hace falta un agente con acceso al repo** (Claude Code, Codex, Gemini CLI, OpenCode…): tiene que leer el código y correr los tests. Un chat web no sirve: no puede hacer ninguna de las dos cosas.", "",
      "Abrí tu agente en la carpeta del proyecto y pasale este archivo entero.", "",
      "## La guía", "", guia.replace("$ARGUMENTS", "Las reglas a resolver están más abajo, en «Las reglas»; el cierre, en «Al terminar».").trim(), "", "## Las reglas", ""];
    orden.forEach(function (r) {
      out.push("### " + r + " (" + porRepo[r].length + ")", "");
      porRepo[r].forEach(function (x) { out.push(x.linea); });
      out.push("");
    });
    out.push("## Al terminar", "",
      "1. Anotá cada resultado en la página de su funcionalidad, \u0060.flowbrain/<cerebro>/product/<funcionalidad>.md\u0060: los tests de a y b en \u0060tests:\u0060 de la regla (\u0060repo:ruta::nombre del caso\u0060); los de c y d en \u0060hallazgo:\u0060 (\u0060resultado\u0060, \u0060hoy\u0060, \u0060cambio\u0060, \u0060test\u0060).",
      "2. Compilá cada cerebro: \u0060flowbrain compile\u0060 dentro de \u0060.flowbrain/<cerebro>/\u0060 (" + cerebros.map(function (c) { return "\u0060" + c + "\u0060"; }).join(", ") + ").",
      "3. Verificá con \u0060flowbrain specs <funcionalidad> --brain <cerebro>\u0060: las reglas con test ya no están sin test ni en \u0060rotos\u0060; los hallazgos se ven con \u0060flowbrain specs --findings\u0060.",
      "4. No modifiques el código del producto ni dejes un test fallando en el repo. No commitees: los cambios quedan para revisar.", "");
    return out.join("\n");
  }
  function descargar(archivo, texto) {
    try {
      var blob = new Blob([texto], { type: "text/markdown;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = archivo; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return true;
    } catch (e) { return false; }
  }

  // ---- lo que quedó sin resolver con un test: hallazgos (c y d) ----
  // De las páginas (los que ya estaban al abrir) y, mientras la página no se recarga, de lo que acaba de volver del lote.
  function claveDeFicha(cerebro, funcionalidad, regla) { return cerebro + "/" + funcionalidad + "|" + regla; }
  function hallazgos() {
    var por = {}, orden = [];
    FICHAS.forEach(function (f) { specs(f).forEach(function (e) { if (e.hallazgo) { var k = f.id + "|" + e.id; por[k] = { k: k, f: f, e: e, h: e.hallazgo }; orden.push(k); } }); });
    var L = loteActual();
    if (L) TRABAJOS.forEach(function (t) {
      if (t.lote !== L.id) return;
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
  function mdDesarrollo() {
    var hs = paraDesarrollo(hallazgos());
    var out = ["# Para desarrollo", "", plural(hs.length, "regla", "reglas") + " que no se pudieron cerrar con un test y necesitan trabajo en el código. Salen de FlowBrain: cada una dice qué hace hoy el código, qué habría que cambiar y, si hay, el test que lo demuestra.", ""];
    hs.forEach(function (x, i) {
      var h = x.h, ca = casoDeRegla(x.f, x.e);
      out.push("## " + (i + 1) + ". " + x.e.texto, "",
        "- **Cerebro:** " + cerebroDe(x.f.id), "- **Funcionalidad:** " + nombre(x.f.id) + " (\u0060" + local(x.f.id, x.f.id) + "\u0060)" + (ca ? "\n- **Caso de uso:** " + ca.nombre : ""), "- **Regla:** \u0060" + x.e.id + "\u0060 [" + x.e.tipo + "]",
        "- **Resultado:** " + (h.resultado === "codigo_no_cumple" ? "el código no cumple la regla (una persona lo confirmó)" : "no se puede testear sin tocar el código"));
      if (x.e.archivos.length) out.push("- **Archivo:** " + x.e.archivos.map(function (a) { return "\u0060" + local(a, x.f.id) + "\u0060"; }).join(", "));
      out.push("");
      if (h.hoy) out.push("**Qué hace hoy el código:** " + h.hoy, "");
      out.push("**" + (h.resultado === "codigo_no_cumple" ? "Qué habría que cambiar" : "Ajuste mínimo para poder testearla") + ":** " + h.cambio, "");
      if (h.test) out.push("**Test que lo demuestra** (no está en el repo: falla hasta que se corrija el código):", "", "\u0060\u0060\u0060", h.test, "\u0060\u0060\u0060", "");
    });
    return out.join("\n");
  }
  function decidir(k, decision) {
    var hs = hallazgos(), x = null; hs.forEach(function (y) { if (y.k === k) x = y; });
    if (!x || ocupado || !ED) return;
    ocupado = true; PANEL_ERROR = ""; PANEL_NOTA = "Guardando la decisión en la página de " + cerebroDe(x.f.id) + "…"; pintarPanel();
    pedir({ tipo: "decision", cerebro: cerebroDe(x.f.id), funcionalidad: local(x.f.id, x.f.id), id: x.e.id, decision: decision || null }).then(function () {
      ocupado = false; PANEL_NOTA = ""; DECIDIDAS[k] = decision || "";
      if (x.e.hallazgo) { if (decision) x.e.hallazgo.decision = decision; else delete x.e.hallazgo.decision; }
      pintarPanel();
    }).catch(function (err) { ocupado = false; PANEL_NOTA = ""; PANEL_ERROR = err.message; pintarPanel(); });
  }
  function corregirReglas() {
    var hs = reglaMal(hallazgos());
    if (!hs.length || !AG || PIDIENDO) return;
    var cerebros = []; hs.forEach(function (x) { var c = cerebroDe(x.f.id); if (cerebros.indexOf(c) < 0) cerebros.push(c); });
    var texto = ["Corregí el texto de estas reglas de FlowBrain: el agente que intentó testearlas encontró que el código hace otra cosa, y una persona decidió que está mal la regla, no el código. " + GUIA + ". Corregí el texto de cada regla (o borrala, si ya no vale) según lo que hace el código hoy y borrá su hallazgo. No cambies el código del producto.", ""];
    hs.forEach(function (x) { texto.push("- Cerebro " + cerebroDe(x.f.id) + ", " + local(x.f.id, x.f.id) + ", regla " + x.e.id + ": «" + x.e.texto + "». Hoy el código: " + (x.h.hoy || x.h.cambio)); });
    PIDIENDO = true; PANEL_ERROR = ""; pintarPanel();
    pedirAgente("/api/agente", { tipo: "corregir", pedido: texto.join("\n"), etiqueta: "Corregir " + plural(hs.length, "regla", "reglas") + " (la regla está mal)", cerebros: cerebros, proveedor: proveedorElegido().id, modelo: modeloElegido().id }).then(function () {
      PIDIENDO = false; traerTrabajos();
    }).catch(function (err) { PIDIENDO = false; PANEL_ERROR = err.message; pintarPanel(); });
  }

  // ---- el lote ----
  var vivoT = function (t) { return t.estado === "en_cola" || t.estado === "corriendo"; };
  function loteActual() {
    for (var i = 0; i < LOTES.length; i++) if (!OCULTA_ESTA_VEZ[LOTES[i].id] && VISTOS.indexOf("oculto:" + LOTES[i].id) < 0) return LOTES[i];
    return null;
  }
  var tandasDe = function (L) { return TRABAJOS.filter(function (t) { return t.lote === L.id; }).sort(function (a, b) { return a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.tanda.n - b.tanda.n; }); };
  var loteVivo = function (L) { return !!L && (L.estado !== "terminado" || tandasDe(L).some(vivoT)); };
  function pedirTodos() {
    var xs = ordenadas(), pr = proveedorElegido(), mo = modeloElegido();
    if (!xs.length || !AG || !pr || !mo || PIDIENDO || loteVivo(loteActual())) return;
    PIDIENDO = true; PANEL_ERROR = ""; pintarPanel();
    pedirAgente("/api/agente/lote", { proveedor: pr.id, modelo: mo.id, reglas: xs.map(function (x) { return { cerebro: x.cerebro, funcionalidad: x.funcionalidad, regla: x.regla, repo: x.repo, linea: x.linea }; }) }).then(function (j) {
      PIDIENDO = false; if (j && j.lote) OCULTA_ESTA_VEZ = {}; traerTrabajos();
    }).catch(function (err) { PIDIENDO = false; PANEL_ERROR = err.message; pintarPanel(); });
  }
  // Lo que ya tiene resultado sale de la lista: pasó a Verificadas, Para decidir o Para desarrollo. Lo que no volvió, queda para reintentar.
  function limpiarListaDelLote(L) {
    if (VISTOS.indexOf(L.id) >= 0) return;
    var hechas = {};
    tandasDe(L).forEach(function (t) { (t.resultados || []).forEach(function (r) { hechas[claveDeEntrada(r)] = true; }); });
    VISTOS.push(L.id); guardarLocal(CLAVE_VISTOS, VISTOS.slice(-30));
    var antes = LISTA.length;
    LISTA = LISTA.filter(function (x) { return !hechas[claveDeEntrada(x)]; });
    if (LISTA.length !== antes) guardarLista();
  }
  function resumenDeLote(L, ts) {
    var rs = []; ts.forEach(function (t) { rs = rs.concat(t.resultados || []); });
    var n = function (r) { return rs.filter(function (x) { return x.resultado === r; }).length; };
    var sin = 0; ts.forEach(function (t) { sin += (t.sinResultado || []).length; });
    var costo = 0; ts.forEach(function (t) { costo += t.costoUsd || 0; });
    return { rs: rs, a: n("a"), b: n("b"), c: n("c"), d: n("d"), sin: sin, costo: costo, fallaron: ts.filter(function (t) { return t.estado === "fallo"; }).length, cancelaron: ts.filter(function (t) { return t.estado === "cancelado"; }).length };
  }
  function htmlTanda(t) {
    var e = ESTADO_TRABAJO[t.estado] || [t.estado, "na"], pasos = (t.pasos || []).slice(-2);
    var cuantas = (t.reglas || []).length;
    return '<li class="es-tanda"><div class="es-cab"><span>' + (t.tanda.de > 1 ? "Tanda " + t.tanda.n + " de " + t.tanda.de : "Una tanda") + " · " + plural(cuantas, "regla", "reglas") + '</span><span class="fd-es ' + e[1] + '">' + e[0] + "</span></div>" +
      (vivoT(t) && pasos.length ? '<ul class="es-pasos">' + pasos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (t.estado === "en_cola" ? "<small>Espera a que termine la tanda anterior de este repo.</small>" : "") +
      (t.error ? '<p class="fd-msg error">' + esc(t.error) + "</p>" : "") +
      ((t.sinResultado || []).length ? '<p class="fd-nota">Sin resultado: ' + plural(t.sinResultado.length, "regla", "reglas") + ". Siguen en la lista para pedirlas de nuevo. " + esc(t.sinResultado[0].motivo) + "</p>" : "") + "</li>";
  }
  function htmlLote() {
    var L = loteActual(); if (!L) return "";
    var ts = tandasDe(L), vivo = loteVivo(L), R = resumenDeLote(L, ts), hechas = ts.filter(function (t) { return !vivoT(t); }).length;
    var porRepo = {}, repos = []; ts.forEach(function (t) { if (!porRepo[t.repo]) { porRepo[t.repo] = []; repos.push(t.repo); } porRepo[t.repo].push(t); });
    var cuerpo = repos.map(function (r) { return '<div class="es-repo"><h4>' + esc(r) + "</h4><ul>" + porRepo[r].map(htmlTanda).join("") + "</ul></div>"; }).join("");
    var cab = vivo
      ? (L.estado === "reindexando" ? "Actualizando el índice para que los tests nuevos cuenten…" : "Pidiendo " + plural(ts.reduce(function (n, t) { return n + (t.reglas || []).length; }, 0), "regla", "reglas") + " en " + plural(repos.length, "repo", "repos") + " a la vez")
      : "Terminó";
    var fin = !vivo
      ? '<div class="es-fin"><b>Costo real: ' + dolares(R.costo) + "</b><span>" + R.a + " verificadas con un test nuevo · " + R.b + " ya cubiertas · " + R.c + " con el código que no la cumple · " + R.d + " que no se pueden testear sin tocar código" +
        (R.sin ? " · " + R.sin + " sin resultado" : "") + (R.fallaron ? " · " + plural(R.fallaron, "tanda falló", "tandas fallaron") : "") + (R.cancelaron ? " · " + plural(R.cancelaron, "tanda cancelada", "tandas canceladas") : "") + ".</span>" +
        (L.error ? '<p class="fd-msg error">' + esc(L.error) + "</p>" : "") + "</div>"
      : '<div class="es-fin"><span>Costo hasta ahora: ' + dolares(R.costo) + "</span></div>";
    return '<section class="es-lote"><div class="es-cab"><h3>' + cab + '</h3><span class="fd-es ' + (vivo ? "na" : R.fallaron ? "no" : "ok") + '">' + hechas + " de " + ts.length + " tandas</span></div>" +
      '<progress max="' + Math.max(1, ts.length) + '" value="' + hechas + '"></progress>' + cuerpo + fin +
      '<div class="fd-acc">' + (vivo ? '<button type="button" class="boton" data-acc="cancelar-lote" data-k="' + esc(L.id) + '">Cancelar todo</button>' : '<button type="button" class="boton" data-acc="recargar">Recargar para ver los cambios</button><button type="button" class="boton" data-acc="cerrar-lote" data-k="' + esc(L.id) + '">Cerrar el resumen</button>') + "</div></section>";
  }
  function htmlHallazgo(x, conBotones) {
    var h = x.h, ca = casoDeRegla(x.f, x.e), d = x.decision;
    var botones = conBotones && ED
      ? '<div class="fd-acc"><button type="button" class="boton" data-acc="regla-mal" data-k="' + esc(x.k) + '"' + (ocupado ? " disabled" : "") + '>La regla está mal</button><button type="button" class="boton" data-acc="codigo-mal" data-k="' + esc(x.k) + '"' + (ocupado ? " disabled" : "") + ">El código está mal</button></div>"
      : conBotones ? '<p class="fd-nota">Para decidir, abrí el visor con <code>flowbrain viewer --serve</code>.</p>'
      : ED && d ? '<div class="fd-acc"><button type="button" class="boton chico" data-acc="deshacer" data-k="' + esc(x.k) + '"' + (ocupado ? " disabled" : "") + ">Volver a decidir</button></div>" : "";
    return '<li class="es-hallazgo"><p class="es-texto">' + esc(x.e.texto) + '</p><div class="chips"><span class="chip">' + esc(TIPO[x.e.tipo] || x.e.tipo) + '</span><span class="chip">' + esc(cerebroDe(x.f.id)) + '</span><span class="chip">' + esc(nombre(x.f.id)) + "</span>" + (ca ? '<span class="chip">' + esc(ca.nombre) + "</span>" : "") + "</div>" +
      (h.hoy ? '<div class="es-ref"><span class="lbl">Hoy el código</span><div>' + esc(h.hoy) + "</div></div>" : "") +
      '<div class="es-ref"><span class="lbl">' + (h.resultado === "codigo_no_cumple" ? "Habría que cambiar" : "Ajuste mínimo") + "</span><div>" + esc(h.cambio) + "</div></div>" +
      (h.test ? '<details class="tf"><summary>El test que lo demuestra</summary><pre class="es-test">' + esc(h.test) + "</pre></details>" : "") + botones + "</li>";
  }
  function htmlResultados() {
    var hs = hallazgos(), L = loteActual(), ts = L ? tandasDe(L) : [], R = L ? resumenDeLote(L, ts) : null;
    var verif = R ? R.rs.filter(function (r) { return r.resultado === "a" || r.resultado === "b"; }) : [];
    var dec = paraDecidir(hs), mal = reglaMal(hs), des = paraDesarrollo(hs), out = "";
    var seccion = function (titulo, n, ayuda, cuerpo, acc) { return '<section class="es-res"><div class="es-cab"><h3>' + titulo + ' <span class="chip">' + n + "</span></h3>" + (acc || "") + "</div>" + (ayuda ? "<small>" + ayuda + "</small>" : "") + cuerpo + "</section>"; };
    if (R) out += seccion("Verificadas", verif.length, "Tienen un test que pasa: uno nuevo (a) o uno que ya existía (b).",
      verif.length ? '<ul class="lista">' + verif.map(function (r) { var par = buscarRegla(claveDeFicha(r.cerebro, r.funcionalidad, r.regla)); return '<li class="es-verif"><p class="es-texto">' + esc(par ? par[0].texto : r.regla) + ' <span class="chip">' + (r.resultado === "a" ? "Test nuevo" : "Ya tenía test") + "</span></p><small>" + (r.tests || []).map(function (t) { return "<code>" + esc(t) + "</code>"; }).join(" ") + "</small></li>"; }).join("") + "</ul>" : "<p><small>Ninguna en este pedido.</small></p>");
    if (dec.length || R) out += seccion("Para decidir", dec.length, "El código no cumple la regla. ¿Está mal la regla o está mal el código?", dec.length ? '<ul class="lista">' + dec.map(function (x) { return htmlHallazgo(x, true); }).join("") + "</ul>" : "<p><small>Nada por decidir.</small></p>");
    if (mal.length) out += seccion("La regla se corrige", mal.length, "Dijiste que la regla está mal: la corrige el agente con <code>/flowbrain-specs</code>.", '<ul class="lista">' + mal.map(function (x) { return htmlHallazgo(x, false); }).join("") + "</ul>",
      AG ? '<button type="button" class="boton" data-acc="corregir-reglas"' + (PIDIENDO ? " disabled" : "") + ">Pedir la corrección</button>" : "");
    if (des.length || R) out += seccion("Para desarrollo", des.length, "El código está mal, o no se puede testear sin tocarlo. El agente nunca cambia el código del producto.", des.length ? '<ul class="lista">' + des.map(function (x) { return htmlHallazgo(x, false); }).join("") + "</ul>" : "<p><small>Nada para desarrollo.</small></p>",
      des.length ? '<button type="button" class="boton" data-acc="descargar-desarrollo">Descargar .md para tickets</button>' : "");
    return out;
  }
  function htmlPanel() {
    var xs = ordenadas(), neg = xs.filter(function (x) { return x.tipo === "negocio"; }).length, pr = proveedorElegido(), mo = modeloElegido(), L = loteActual(), vivo = loteVivo(L);
    var enTanda = {}; if (vivo) tandasDe(L).forEach(function (t) { if (vivoT(t)) (t.reglas || []).forEach(function (r) { enTanda[claveDeEntrada(r)] = true; }); });
    var estimado = mo ? xs.length * mo.costoPorReglaUsd : 0;
    var selector = AG && pr
      ? '<div class="es-agsel"><label>Proveedor<select id="es-prov"' + (vivo ? " disabled" : "") + ">" + PROVS.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pr.id ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select></label>" +
        '<label>Modelo<select id="es-modelo"' + (vivo ? " disabled" : "") + ">" + pr.modelos.map(function (m) { return '<option value="' + esc(m.id) + '"' + (mo && m.id === mo.id ? " selected" : "") + ">" + esc(m.nombre) + (m.porDefecto ? " (por defecto)" : "") + "</option>"; }).join("") + "</select></label></div>"
      : '<p class="fd-nota">' + (ED ? "No hay ningún agente instalado en esta máquina" + (ED.agente && ED.agente.noDisponible ? ": " + esc(ED.agente.noDisponible) : "") + "." : "Esta página es de solo lectura: no puede mandar los pedidos.") + " Descargá el .md y dáselo a tu agente (con acceso al repo, no un chat web).</p>";
    var totales = '<div class="es-totales"><b>' + plural(xs.length, "regla", "reglas") + "</b><span>" + neg + " de negocio (van primero) · " + (xs.length - neg) + " de pantalla</span>" +
      (AG && mo ? "<span>Costo estimado: " + (xs.length ? "≈ " + dolares(estimado) : dolares(0)) + ' <small>(aprox., con ' + esc(mo.nombre) + ")</small></span>" : "") + "</div>";
    var botones = '<div class="fd-acc"><button type="button" class="boton pri" data-acc="pedir-todos"' + (!AG || !xs.length || vivo || PIDIENDO ? " disabled" : "") + ">" + (PIDIENDO ? "Mandando…" : "Pedir todos" + (xs.length ? " (" + xs.length + ")" : "")) + '</button>' +
      '<button type="button" class="boton" data-acc="descargar-lista"' + (!xs.length ? " disabled" : "") + '>Descargar .md</button><button type="button" class="boton" data-acc="vaciar"' + (!xs.length || vivo ? " disabled" : "") + ">Vaciar la lista</button></div>";
    var filas = xs.length
      ? '<ul class="es-pedidos">' + xs.map(function (x) {
        return '<li class="es-pedido"><div><p class="es-texto">' + esc(x.texto) + '</p><div class="chips"><span class="chip ' + (x.tipo === "negocio" ? "es-neg" : "") + '" title="' + esc(QUE_ES[x.tipo] || "") + '">' + (x.tipo === "negocio" ? "De negocio" : "De pantalla") + "</span>" +
          (x.caso ? '<span class="chip" title="Caso de uso">' + esc(x.casoNombre) + "</span>" : '<span class="chip">Sin caso de uso</span>') + '<span class="chip" title="Funcionalidad">' + esc(x.funcNombre) + '</span><span class="chip es-cerebro" title="Cerebro">' + esc(x.cerebro) + "</span>" +
          (enTanda[claveDeEntrada(x)] ? '<span class="chip es-ok">Pidiéndose…</span>' : "") + "</div>" +
          '<small class="es-archivo">' + (x.archivos.length ? "La cumple: " + x.archivos.map(function (a) { return "<code>" + esc(a.replace(/#L\d+$/, "")) + "</code>"; }).join(" ") : "No dice qué archivo la cumple") + "</small></div>" +
          '<button type="button" class="boton chico" data-acc="quitar" data-k="' + esc(x.k) + '" aria-label="Quitar de la lista"' + (enTanda[claveDeEntrada(x)] ? " disabled" : "") + ">Quitar</button></li>";
      }).join("") + "</ul>"
      : '<p class="fd-nota">La lista está vacía. Tocá «Pedir el test» en una regla, en la fila de un cerebro o en un caso entero: se suma acá, y recién «Pedir todos» lo manda.</p>';
    return '<div class="es-panel-cab"><h2>Tests pedidos</h2><button type="button" class="boton chico" data-acc="cerrar-panel" aria-label="Cerrar el panel">✕</button></div>' + selector + totales + botones +
      (PANEL_ERROR ? '<p class="fd-msg error">' + esc(PANEL_ERROR) + "</p>" : PANEL_NOTA ? '<p class="fd-nota">' + esc(PANEL_NOTA) + "</p>" : "") + htmlLote() + filas + htmlResultados();
  }
  function pintarPanel() {
    var e = elem("es-panel"); if (!e) return;
    var antes = typeof e.scrollTop === "number" ? e.scrollTop : 0;
    e.innerHTML = htmlPanel();
    e.className = "es-panel" + (PANEL ? " abierto" : "");
    if (typeof e.scrollTop === "number") e.scrollTop = antes;
    if (raiz.classList) { if (PANEL) raiz.classList.add("es-con-panel"); else raiz.classList.remove("es-con-panel"); }
    var b = elem("es-bandeja"); if (b) b.innerHTML = htmlBandeja();
  }
  function htmlBandeja() {
    var hs = hallazgos(), n = LISTA.length, pend = paraDecidir(hs).length;
    if (!n && !hs.length && !loteActual()) return "";
    return '<button type="button" class="boton es-pedir" data-acc="panel" aria-expanded="' + PANEL + '">Tests pedidos' + (n ? " (" + n + ")" : "") + (pend ? " · " + pend + " para decidir" : "") + "</button>";
  }

  // ---------- El agente: mandar pedidos y ver cómo van ----------
  function pedirAgente(ruta, cuerpo) {
    return fetch(ruta, cuerpo ? { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) } : { headers: { "x-flowbrain-token": ED.token } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "el servidor respondió " + r.status); return j; }); });
  }
  function mandar(k) {
    var p = PEDIDOS[k];
    if (!p || !AG || !PEDIDO || PEDIDO.k !== k || PEDIDO.mandado) return;
    PEDIDO.mandado = true; PEDIDO.error = null; pintarTodo();
    pedirAgente("/api/agente", { tipo: p[0], pedido: textoDelPedido(p[0], p[1]), etiqueta: etiquetaDelPedido(p[0], p[1]), cerebros: cerebrosDelPedido(p[0], p[1]), proveedor: proveedorElegido() ? proveedorElegido().id : undefined, modelo: modeloElegido() ? modeloElegido().id : undefined }).then(function () {
      PEDIDO = null; traerTrabajos(); pintarTodo();
      var a = elem("es-agente"); if (a && a.scrollIntoView) a.scrollIntoView();
    }).catch(function (e) { if (PEDIDO && PEDIDO.k === k) { PEDIDO.mandado = false; PEDIDO.error = e.message; pintarTodo(); } });
  }
  var vivo = function (t) { return t.estado === "en_cola" || t.estado === "corriendo"; };
  function traerTrabajos() {
    if (!AG) return;
    pedirAgente("/api/agente").then(function (j) {
      TRABAJOS = j.trabajos || []; LOTES = j.lotes || [];
      LOTES.forEach(function (L) { if (!loteVivo(L)) limpiarListaDelLote(L); });
      pintarAgente();
      if (ESPERA) { clearTimeout(ESPERA); ESPERA = null; }
      if (TRABAJOS.some(vivo) || LOTES.some(loteVivo)) ESPERA = setTimeout(traerTrabajos, 2000);
    }).catch(function () { ESPERA = setTimeout(traerTrabajos, 5000); });
  }
  var ESTADO_TRABAJO = { en_cola: ["En cola", "na"], corriendo: ["Trabajando…", "na"], terminado: ["Terminó", "ok"], fallo: ["Falló", "no"], cancelado: ["Cancelado", "na"] };
  function unTrabajo(t) {
    var e = ESTADO_TRABAJO[t.estado] || [t.estado, "na"];
    var pasos = t.pasos || [], ultimos = pasos.slice(-4);
    var cambios = (t.cambios || []).map(function (c) { return "<li><b>" + esc(c.repo) + "</b>: " + c.archivos.map(function (a) { return "<code>" + esc(a) + "</code>"; }).join(" ") + "</li>"; }).join("");
    return '<li class="es-trabajo"><div class="es-cab"><b>' + esc(t.etiqueta) + '</b><span class="fd-es ' + e[1] + '">' + e[0] + "</span></div>" +
      (vivo(t) && ultimos.length ? '<ul class="es-pasos">' + ultimos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (t.estado === "en_cola" ? "<small>Espera a que termine el anterior.</small>" : "") +
      (t.error ? '<p class="fd-msg error">' + esc(t.error) + "</p>" : "") +
      (!vivo(t) && t.resultado ? '<details class="tf"><summary>Lo que dijo el agente</summary><p class="es-resultado">' + esc(t.resultado) + "</p></details>" : "") +
      (!vivo(t) && pasos.length ? '<details class="tf"><summary>Lo que hizo (' + pasos.length + " pasos)</summary><ul class=\"es-pasos\">" + pasos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></details>" : "") +
      (cambios ? '<div class="es-cambios"><small>Cambió, sin commitear (revisalo antes de commitear):</small><ul>' + cambios + "</ul></div>" : !vivo(t) && t.estado === "terminado" ? "<small>No cambió archivos en los repos.</small>" : "") +
      '<div class="fd-acc">' + (vivo(t) ? '<button type="button" class="boton" data-acc="cancelar-agente" data-k="' + esc(t.id) + '">Cancelar</button>' : "") +
      (t.estado === "terminado" || t.estado === "fallo" ? '<button type="button" class="boton" data-acc="recargar">Recargar para ver los cambios</button>' : "") + "</div></li>";
  }
  // Las tandas de «Pedir todos» se ven en el panel «Tests pedidos»; acá, los pedidos sueltos.
  var sueltos = function () { return TRABAJOS.filter(function (t) { return !t.lote; }); };
  function htmlAgente() {
    if (!AG || !sueltos().length) return "";
    return '<h2>El agente</h2><ul class="lista">' + sueltos().map(unTrabajo).join("") + "</ul>";
  }
  function pintarAgente() { var a = elem("es-agente"); if (a) { a.innerHTML = htmlAgente(); a.className = sueltos().length && AG ? "es-agente" : ""; } pintarPanel(); }
  function buscarRegla(k) { var out = null; FICHAS.forEach(function (f) { specs(f).forEach(function (e) { if (clave(f, e) === k) out = [e, f]; }); }); return out; }
  function ponerManual(k, motivo) {
    var ef = buscarRegla(k);
    if (!ef || ocupado || !ED) return;
    var e = ef[0], f = ef[1];
    ocupado = true; MSG = { k: k, texto: "Guardando…" }; pintarLista();
    pedir({ tipo: "manual", cerebro: cerebroDe(f.id), funcionalidad: local(f.id, f.id), id: e.id, motivo: motivo || null }).then(function () {
      if (motivo) e.manual = motivo; else delete e.manual;
      ocupado = false; MANUAL = null; MOTIVO = "";
      ITEMS = null; PRODUCTO = elegir(armar());
      MSG = { k: k, texto: motivo ? "Queda como probada a mano: ya no cuenta como sin test." : "Vuelve a contar como sin test: pedí el test cuando quieras." };
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
      if (!nota) { MSG = { k: k, texto: "Escribí qué está mal: es lo que va a leer el agente para corregirlo.", error: true }; pintarLista(); return; }
      marcar(k, nota); return;
    }
    if (acc === "desmarcar") { marcar(k, ""); return; }
    if (acc === "ir-agrupar") { var a = elem("es-agrupar"); if (a && a.scrollIntoView) a.scrollIntoView(); return; }
    if (acc === "manual") { MANUAL = k; MOTIVO = ""; MSG = null; pintarLista(); var m = elem("es-motivo"); if (m && m.focus) m.focus(); return; }
    if (acc === "cancelar-manual") { MANUAL = null; MOTIVO = ""; pintarLista(); return; }
    if (acc === "guardar-manual") {
      var motivo = (MOTIVO || "").trim();
      if (!motivo) { MSG = { k: k, texto: "Escribí por qué se prueba a mano: es lo que va a leer quien venga después.", error: true }; pintarLista(); return; }
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
    if (acc === "sumar") {
      var ps = PEDIDOS[k];
      if (!ps) return;
      sumarOQuitar(ps[1]);
      // Sin repintar la lista: así no se cierran las reglas que se estaban mirando. Solo cambian los botones y el panel.
      if (raiz.querySelectorAll) { botonesDePedido(); pintarPanel(); } else pintarTodo();
      return;
    }
    if (acc === "panel") { PANEL = !PANEL; guardarLista(); pintarPanel(); return; }
    if (acc === "cerrar-panel") { PANEL = false; guardarLista(); pintarPanel(); return; }
    if (acc === "quitar") { LISTA = LISTA.filter(function (x) { return x.k !== k; }); guardarLista(); if (raiz.querySelectorAll) { botonesDePedido(); pintarPanel(); } else pintarTodo(); return; }
    if (acc === "vaciar") { LISTA = []; guardarLista(); if (raiz.querySelectorAll) { botonesDePedido(); pintarPanel(); } else pintarTodo(); return; }
    if (acc === "pedir-todos") { pedirTodos(); return; }
    if (acc === "descargar-lista") { if (!descargar("tests-pedidos.md", mdDeLista())) { PANEL_ERROR = "No se pudo descargar: copiá la lista desde el visor servido."; pintarPanel(); } return; }
    if (acc === "descargar-desarrollo") { if (!descargar("para-desarrollo.md", mdDesarrollo())) { PANEL_ERROR = "No se pudo descargar."; pintarPanel(); } return; }
    if (acc === "cancelar-lote") { pedirAgente("/api/agente/lote/cancelar", { id: k }).then(traerTrabajos, function () { traerTrabajos(); }); return; }
    if (acc === "cerrar-lote") { OCULTA_ESTA_VEZ[k] = true; VISTOS.push("oculto:" + k); guardarLocal(CLAVE_VISTOS, VISTOS.slice(-60)); pintarPanel(); return; }
    if (acc === "regla-mal") { decidir(k, "regla_mal"); return; }
    if (acc === "codigo-mal") { decidir(k, "codigo_mal"); return; }
    if (acc === "deshacer") { decidir(k, null); return; }
    if (acc === "corregir-reglas") { corregirReglas(); return; }
    if (acc === "cancelar-agente") { pedirAgente("/api/agente/cancelar", { id: k }).then(traerTrabajos, function () { traerTrabajos(); }); return; }
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
    if (ev.target.id === "es-prov") { ELEGIDO = { proveedor: ev.target.value, modelo: "" }; guardarLocal(CLAVE_AGENTE, ELEGIDO); pintarPanel(); }
    else if (ev.target.id === "es-modelo") { ELEGIDO.proveedor = proveedorElegido() ? proveedorElegido().id : ""; ELEGIDO.modelo = ev.target.value; guardarLocal(CLAVE_AGENTE, ELEGIDO); pintarPanel(); }
  });

  var primeraVez = true;
  window.brainEspecificaciones = {
    mostrar: function (feat) {
      if (primeraVez) { primeraVez = false; traerTrabajos(); }
      if (feat) { var k = local(feat, feat); fl.limpiar(true); S.abiertas[k] = true; FOCO = k; guardar(); }
      pintarTodo();
    }
  };
})();
`;

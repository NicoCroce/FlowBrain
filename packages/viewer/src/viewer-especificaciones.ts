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
  var TRABAJOS = [], ESPERA = null;
  var TIPO = { negocio: "Negocio", producto: "Producto" };
  var QUE_ES = { negocio: "Regla del negocio: vale aunque cambie la pantalla", producto: "Cómo se comporta el producto para quien lo usa" };
  // Estado de un caso: el peor de sus cerebros. Orden: lo que más falta, primero.
  var ESTADO = {
    sin_codigo: { txt: "Sin código", cls: "no", que: "Alguna regla no dice qué archivo la cumple." },
    sin_test: { txt: "Sin test", cls: "no", que: "Alguna regla no tiene un test que la verifique: si se rompe, nada avisa." },
    sin_reglas: { txt: "Sin reglas", cls: "na", que: "El caso no tiene ninguna regla escrita." },
    cumplido: { txt: "Cumplido", cls: "ok", que: "Cada regla tiene el código que la cumple y un test que la verifica." }
  };
  var PESO = { sin_codigo: 0, sin_test: 1, sin_reglas: 2, cumplido: 3 };
  var GRUPOS = [["", "Todos"], ["sintest", "Sin test"], ["problema", "Marcados como mal"], ["cumplido", "Cumplidos"]];
  var inicial = function () { return { grupo: "", q: "", abiertas: {} }; };
  var S = inicial();
  var CLAVE = "flowbrain.especificaciones.v2";
  // Los cerebros elegidos son una preferencia que dura (localStorage); el resto de la vista, solo la pestaña.
  var CLAVE_CEREBROS = "flowbrain.especificaciones.cerebros";
  var SEL = [];
  var guardar = function () {
    try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLAVE, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ }
    try { if (typeof localStorage !== "undefined") localStorage.setItem(CLAVE_CEREBROS, JSON.stringify(SEL)); } catch (e) { /* sin almacenamiento */ }
  };
  try {
    var previo = typeof sessionStorage !== "undefined" ? JSON.parse(sessionStorage.getItem(CLAVE) || "null") : null;
    if (previo) Object.keys(S).forEach(function (k) { if (previo[k] !== undefined && typeof previo[k] === typeof S[k]) S[k] = previo[k]; });
  } catch (e) { /* sin almacenamiento */ }
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
  function busca(P, extra) {
    var q = S.q.trim().toLowerCase();
    return !q || (P.nombre + " " + P.id + " " + extra).toLowerCase().indexOf(q) >= 0;
  }
  var casoCoincide = function (P, C) {
    return enGrupo(C, S.grupo) && C.patas.length > 0 &&
      busca(P, C.nombre + " " + C.quien + " " + C.patas.map(function (p) { return p.cerebro + " " + p.reglas.map(function (e) { return textoDeRegla({ e: e }); }).join(" "); }).join(" "));
  };
  var sueltaCoincide = function (P, x) { return sueltaEnGrupo(x, S.grupo) && enCerebro([cerebroDe(x.f.id)]) && busca(P, textoDeRegla(x)); };
  var conSpecs = function (P) { return P.fichas.some(function (f) { return specs(f).length; }); };
  var visibles = function () { return PRODUCTO.filter(function (P) { return enCerebro(P.cerebros); }); };
  var todosLosCasos = function () { var out = []; visibles().forEach(function (P) { P.casos.forEach(function (C) { if (C.patas.length) out.push([P, C]); }); }); return out; };
  var todasSueltas = function () { var out = []; visibles().forEach(function (P) { P.sueltas.forEach(function (x) { if (enCerebro([cerebroDe(x.f.id)])) out.push([P, x]); }); }); return out; };
  function filtrosActivos() {
    var out = [];
    GRUPOS.forEach(function (g) { if (g[0] && S.grupo === g[0]) out.push(g[1].toLowerCase()); });
    if (S.q.trim()) out.push("«" + S.q.trim() + "»");
    return out;
  }

  // ---------- Pedidos para el agente ----------
  var GUIA = "siguiendo la guía de flowbrain specs --guide (en Claude Code: /flowbrain-specs)";
  var GUIA_TESTS = "siguiendo la guía de flowbrain specs --guide-tests (en Claude Code: /flowbrain-tests)";
  // items: [[regla, ficha], …]. Las de negocio primero: son las que más cuesta que se rompan sin aviso.
  function pedidoDeTests(items) {
    var orden = items.slice().sort(function (a, b) { return (a[0].tipo === "negocio" ? 0 : 1) - (b[0].tipo === "negocio" ? 0 : 1); });
    var out = ["Escribí " + (orden.length === 1 ? "el test que verifica esta regla" : "los tests que verifican estas " + orden.length + " reglas") + " de FlowBrain, " + GUIA_TESTS + ".",
      "Usá la herramienta de tests que ya tiene cada repo. No cambies el código del producto: si un test muestra que el código no cumple la regla, no lo arregles; marcá el caso de uso como mal (problema) diciendo qué encontraste.", ""];
    orden.forEach(function (it) {
      var e = it[0], f = it[1], C = casoDeRegla(f, e);
      out.push("- Cerebro " + cerebroDe(f.id) + ", " + local(f.id, f.id) + " (" + nombre(f.id) + ")" + (C ? ", caso " + C.id + " (" + C.nombre + ")" : "") + ", regla " + e.id + " [" + e.tipo + "]: " + e.texto +
        (e.archivos.length ? " La cumple: " + e.archivos.map(function (a) { return local(a, f.id); }).join(", ") + "." : " No dice qué archivo la cumple: buscalo primero."));
    });
    out.push("", "Por cada test que pase, agregalo en tests: de su regla, en .flowbrain/<cerebro>/product/<funcionalidad>.md, y compilá ese cerebro. Al final decime qué tests escribiste, en qué archivos, y qué reglas no se cumplen.");
    return out.join("\n");
  }
  function casoDeRegla(f, e) { var out = null; (f.casos || []).forEach(function (c) { if (c.especificaciones.indexOf(e.id) >= 0) out = c; }); return out; }
  function textoDelPedido(tipo, items) {
    var out;
    if (tipo === "test") return pedidoDeTests(items);
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
    if (AG) etiqueta = etiqueta.replace(/^Copiar pedido/, "Pedírselo al agente");
    return '<button type="button" class="boton" data-acc="pedido" data-k="' + esc(k) + '">' + (PEDIDO && PEDIDO.k === k ? "Ocultar pedido" : etiqueta) + "</button>";
  }
  function cajaDelPedido(k) {
    if (!PEDIDO || PEDIDO.k !== k || !PEDIDOS[k]) return "";
    var por = !ED ? "Para mandarlo directo al agente, abrí el visor desde el menú («Abrir el visor») o con <code>flowbrain viewer --serve</code>."
      : ED.agente && ED.agente.noDisponible ? "No se puede mandar directo: " + esc(ED.agente.noDisponible) + "." : "";
    var botones = AG
      ? '<div class="fd-acc"><button type="button" class="boton fd-pri" data-acc="mandar" data-k="' + esc(k) + '"' + (PEDIDO.mandado ? " disabled" : "") + ">" + (PEDIDO.mandado ? "Mandado" : "Mandar al agente") + '</button><button type="button" class="boton" data-acc="copiar" data-k="' + esc(k) + '">Copiar</button></div>' +
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
      if (tipo === "test") suma(cerebroDe(it[1].id));
      else if (tipo === "corregir") it[1].todas.forEach(function (p) { suma(p.cerebro); });
      else it.fichas.forEach(function (f) { if (elegido(cerebroDe(f.id))) suma(cerebroDe(f.id)); });
    });
    return out;
  }
  function etiquetaDelPedido(tipo, items) {
    if (tipo === "test") {
      var casos = [];
      items.forEach(function (it) { var c = casoDeRegla(it[1], it[0]), n = c ? c.nombre : nombre(it[1].id); if (casos.indexOf(n) < 0) casos.push(n); });
      return plural(items.length, "test", "tests") + (casos.length === 1 ? ": " + casos[0] : " de " + plural(casos.length, "caso", "casos"));
    }
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
        '<div class="fd-acc"><button type="button" class="boton fd-pri" data-acc="guardar-manual" data-k="' + esc(k) + '"' + (ocupado ? " disabled" : "") + '>Guardar</button><button type="button" class="boton" data-acc="cancelar-manual">Cancelar</button></div>' +
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
    return '<tr><th scope="row">' + esc(p.cerebro) + "</th><td>" + codigo + (sinCodigo && a.length ? ' <span class="es-mal">(' + sinCodigo + " sin archivo)</span>" : "") + "</td><td>" + test + pedir + "</td></tr>";
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
        '<div class="fd-acc"><button type="button" class="boton fd-pri" data-acc="guardar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + '>Guardar</button><button type="button" class="boton" data-acc="cancelar">Cancelar</button></div>' +
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
        (sinTest ? '<span class="chip es-falta">' + sinTest + " sin test</span>" : "") +
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
  function cifras() {
    var cifra = function (valor, texto, color, grupo) {
      return '<div class="fd-cifra' + (grupo !== undefined ? " es-ir" : "") + '"' + (grupo !== undefined ? ' role="button" tabindex="0" data-acc="grupo" data-k="' + grupo + '"' : "") + "><b" + (color ? ' style="color:' + color + '"' : "") + ">" + valor.toLocaleString("es") + "</b><span>" + texto + "</span></div>";
    };
    var cs = todosLosCasos().map(function (x) { return x[1]; }), sueltas = todasSueltas().length;
    var cumplidos = cs.filter(function (C) { return C.estado === "cumplido"; }).length, sinTest = cs.filter(function (C) { return enGrupo(C, "sintest"); }).length, mal = cs.filter(function (C) { return C.problemas.length; }).length;
    var vacias = visibles().filter(function (P) { return !conSpecs(P); }).length;
    return '<div class="fd-cifras">' + cifra(cs.length, "casos de uso") + cifra(cumplidos, "cumplidos: código y test", cumplidos ? "var(--tabla)" : "", "cumplido") +
      cifra(sinTest, "sin test que los verifique", sinTest ? "var(--dudoso)" : "", "sintest") + cifra(mal, "marcados como mal", mal ? "var(--dudoso)" : "", "problema") +
      (sueltas ? cifra(sueltas, "reglas sin caso de uso", "var(--feat)") : "") + (vacias ? cifra(vacias, "funcionalidades sin nada escrito", "var(--feat)") : "") + "</div>";
  }
  function grupos() {
    var cs = todosLosCasos();
    var porReglas = !cs.length;
    return '<div class="fd-grupos" role="group" aria-label="Qué ver">' + GRUPOS.map(function (g) {
      var n = porReglas ? todasSueltas().filter(function (x) { return sueltaEnGrupo(x[1], g[0]); }).length : cs.filter(function (x) { return enGrupo(x[1], g[0]); }).length;
      return '<button type="button" class="fd-grupo' + (S.grupo === g[0] ? " on" : "") + '" data-acc="grupo" data-k="' + g[0] + '" aria-pressed="' + (S.grupo === g[0]) + '">' + g[1] + "<small>" + n.toLocaleString("es") + "</small></button>";
    }).join("") + "</div>" + (porReglas ? '<p class="fd-nota">Todavía no hay casos de uso: los números cuentan reglas.</p>' : "");
  }
  function herramientas() {
    return '<div class="fd-herr"><input id="es-q" type="search" placeholder="Buscar un caso de uso, una regla, una funcionalidad, un archivo o un test…" aria-label="Buscar" autocomplete="off" value="' + esc(S.q) + '"></div>';
  }
  // Varios a la vez; lo elegido queda guardado en este navegador para la próxima vez.
  function selectorDeCerebros() {
    if (CON_FICHAS.length < 2) return "";
    var boton = function (c) {
      var on = SEL.indexOf(c) >= 0;
      return '<button type="button" class="es-cer' + (on ? " on" : "") + '" data-acc="cerebro" data-k="' + esc(c) + '" aria-pressed="' + on + '">' + (on ? "✔ " : "") + esc(c) + "</button>";
    };
    return '<div class="es-cerebros" role="group" aria-label="Cerebros"><span class="lbl">Cerebros</span>' +
      '<button type="button" class="es-cer' + (SEL.length ? "" : " on") + '" data-acc="cerebro" data-k="" aria-pressed="' + !SEL.length + '">Todos</button>' + CON_FICHAS.map(boton).join("") +
      "<small>" + (SEL.length ? "Ves " + esc(SEL.join(", ")) + ": los casos cuentan solo lo de " + (SEL.length === 1 ? "ese cerebro" : "esos cerebros") + ". Queda guardado para la próxima vez." : "Elegí los cerebros que te importan: queda guardado para la próxima vez.") + "</small></div>";
  }
  function lista() {
    var activos = filtrosActivos(), sinFiltro = !S.grupo && !S.q.trim();
    var filas = visibles().map(function (P) {
      return [P, P.casos.filter(function (C) { return casoCoincide(P, C); }).sort(function (a, b) { return (b.problemas.length ? 1 : 0) - (a.problemas.length ? 1 : 0) || PESO[a.estado] - PESO[b.estado] || faltanDeNegocio(b) - faltanDeNegocio(a); }),
        P.sueltas.filter(function (x) { return sueltaCoincide(P, x); }).sort(function (a, b) { return (a.e.tests.length ? 1 : 0) - (b.e.tests.length ? 1 : 0); })];
    }).filter(function (x) { return x[1].length || x[2].length; });
    filas.sort(function (a, b) {
      var pa = pendientes(a[0]), pb = pendientes(b[0]);
      return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2] || (a[0].nombre.toLowerCase() < b[0].nombre.toLowerCase() ? -1 : 1);
    });
    var vacias = sinFiltro ? visibles().filter(function (P) { return !conSpecs(P); }) : [];
    if (!filas.length && !vacias.length) {
      var cuantos = todosLosCasos().length;
      return '<p class="aviso">Nada coincide con los filtros: ' + activos.map(esc).join(", ") + ". Hay " + (cuantos ? plural(cuantos, "caso de uso", "casos de uso") : plural(todasSueltas().length, "regla", "reglas")) + ' en total. <button type="button" class="boton" data-acc="limpiar">Quitar filtros</button></p>';
    }
    var nc = 0, ns = 0; filas.forEach(function (x) { nc += x[1].length; ns += x[2].length; });
    var corregir = S.grupo === "problema" && nc
      ? '<div class="es-sueltas"><div class="es-cab"><p>Pasale al agente lo que marcaste para que lo corrija.</p>' + botonPedido("corregir|", "corregir", todosLosCasos().filter(function (x) { return x[1].problemas.length; }), "Copiar pedido para el agente") + "</div>" + cajaDelPedido("corregir|") + "</div>"
      : "";
    return '<div class="fd-cab"><p class="subtitulo">' + (nc ? plural(nc, "caso de uso", "casos de uso") : "") + (nc && ns ? " y " : "") + (ns ? plural(ns, "regla sin caso", "reglas sin caso") : "") + (nc || ns ? " en " + plural(filas.length, "funcionalidad", "funcionalidades") : "") + (activos.length ? " (" + activos.map(esc).join(", ") + ")" : "") + ". Lo que más falta, primero.</p>" +
      '<div class="fd-acc"><button type="button" class="boton" data-acc="todas">' + (filas.every(function (x) { return S.abiertas[x[0].id]; }) ? "Plegar todas" : "Desplegar todas") + "</button>" + (activos.length ? '<button type="button" class="boton" data-acc="limpiar">Quitar filtros</button>' : "") + "</div></div>" +
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
      return '<li class="' + (hecho ? "hecho" : "") + '"><div><b>' + (hecho ? "✔ " : (pasos.length + 1) + ". ") + titulo + "</b>" + (detalle ? "<small>" + detalle + "</small>" : "") + "</div>" +
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
    var cabeza = "<h1>Especificaciones</h1>" + COMO + aviso() + (CON_FICHAS.length > 1 ? selectorDeCerebros() : "") + queHacer() +
      '<section id="es-agente" class="' + (AG && TRABAJOS.length ? "es-agente" : "") + '" aria-live="polite">' + htmlAgente() + "</section>" + cifras() + (hay ? grupos() : "") + (hay ? herramientas() : "") + nada;
    raiz.innerHTML = cabeza + '<div id="es-lista">' + lista() + "</div>";
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
      PRODUCTO = elegir(armar());
      MSG = { k: k, texto: texto ? "Quedó marcado como mal en " + hechos.join(", ") + ". El agente lo corrige con /flowbrain-specs; copiá el pedido desde «Marcados como mal»." : "Se le sacó la marca en " + hechos.join(", ") + "." };
      pintarTodo();
    }).catch(function (e) {
      ocupado = false; PRODUCTO = elegir(armar());
      MSG = { k: k, texto: (hechos.length ? "Se guardó en " + hechos.join(", ") + " pero falló en el resto: " : "") + e.message, error: true };
      pintarTodo();
    });
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
    pedirAgente("/api/agente", { tipo: p[0], pedido: textoDelPedido(p[0], p[1]), etiqueta: etiquetaDelPedido(p[0], p[1]), cerebros: cerebrosDelPedido(p[0], p[1]) }).then(function () {
      PEDIDO = null; traerTrabajos(); pintarTodo();
      var a = elem("es-agente"); if (a && a.scrollIntoView) a.scrollIntoView();
    }).catch(function (e) { if (PEDIDO && PEDIDO.k === k) { PEDIDO.mandado = false; PEDIDO.error = e.message; pintarTodo(); } });
  }
  var vivo = function (t) { return t.estado === "en_cola" || t.estado === "corriendo"; };
  function traerTrabajos() {
    if (!AG) return;
    pedirAgente("/api/agente").then(function (j) {
      TRABAJOS = j.trabajos || []; pintarAgente();
      if (ESPERA) { clearTimeout(ESPERA); ESPERA = null; }
      if (TRABAJOS.some(vivo)) ESPERA = setTimeout(traerTrabajos, 2000);
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
  function htmlAgente() {
    if (!AG || !TRABAJOS.length) return "";
    return '<h2>El agente</h2><ul class="lista">' + TRABAJOS.map(unTrabajo).join("") + "</ul>";
  }
  function pintarAgente() { var a = elem("es-agente"); if (a) { a.innerHTML = htmlAgente(); a.className = TRABAJOS.length && AG ? "es-agente" : ""; } }
  function buscarRegla(k) { var out = null; FICHAS.forEach(function (f) { specs(f).forEach(function (e) { if (clave(f, e) === k) out = [e, f]; }); }); return out; }
  function ponerManual(k, motivo) {
    var ef = buscarRegla(k);
    if (!ef || ocupado || !ED) return;
    var e = ef[0], f = ef[1];
    ocupado = true; MSG = { k: k, texto: "Guardando…" }; pintarLista();
    pedir({ tipo: "manual", cerebro: cerebroDe(f.id), funcionalidad: local(f.id, f.id), id: e.id, motivo: motivo || null }).then(function () {
      if (motivo) e.manual = motivo; else delete e.manual;
      ocupado = false; MANUAL = null; MOTIVO = "";
      PRODUCTO = elegir(armar());
      MSG = { k: k, texto: motivo ? "Queda como probada a mano: ya no cuenta como sin test." : "Vuelve a contar como sin test: pedí el test cuando quieras." };
      pintarTodo();
    }).catch(function (err) { ocupado = false; MSG = { k: k, texto: err.message, error: true }; pintarLista(); });
  }
  function accion(b) {
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k");
    if (acc === "limpiar") { S = inicial(); refrescar(true); return; }
    if (acc === "cerebro") {
      if (!k) SEL = [];
      else if (SEL.indexOf(k) >= 0) SEL = SEL.filter(function (c) { return c !== k; });
      else SEL = SEL.concat([k]);
      if (SEL.length >= CON_FICHAS.length) SEL = [];
      SEL.sort(function (a, b) { return CON_FICHAS.indexOf(a) - CON_FICHAS.indexOf(b); });
      PRODUCTO = elegir(PRODUCTO); refrescar(true); return;
    }
    if (acc === "grupo") { S.grupo = S.grupo === k && k !== "" ? "" : k || ""; refrescar(true); return; }
    if (acc === "abrir") { if (S.abiertas[k]) delete S.abiertas[k]; else S.abiertas[k] = true; refrescar(false); return; }
    if (acc === "todas") {
      var ids = [];
      visibles().forEach(function (P) { if (P.casos.some(function (C) { return casoCoincide(P, C); }) || P.sueltas.some(function (x) { return sueltaCoincide(P, x); })) ids.push(P.id); });
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
      if (!p) return;
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
    if (acc === "cancelar-agente") { pedirAgente("/api/agente/cancelar", { id: k }).then(traerTrabajos, function () { traerTrabajos(); }); return; }
    if (acc === "recargar") { if (typeof location !== "undefined") location.reload(); return; }
  }
  raiz.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-acc]") : null;
    if (b && !b.disabled) accion(b);
  });
  raiz.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var b = ev.target.closest ? ev.target.closest(".es-ir[data-acc]") : null;
    if (b) { if (ev.preventDefault) ev.preventDefault(); accion(b); }
  });
  raiz.addEventListener("input", function (ev) {
    if (ev.target.id === "es-q") { S.q = ev.target.value; refrescar(false); }
    else if (ev.target.id === "es-nota") BORRADOR = ev.target.value;
    else if (ev.target.id === "es-motivo") MOTIVO = ev.target.value;
  });

  var primeraVez = true;
  window.brainEspecificaciones = {
    mostrar: function (feat) {
      if (primeraVez) { primeraVez = false; traerTrabajos(); }
      if (feat) { var k = local(feat, feat); S = inicial(); S.abiertas[k] = true; FOCO = k; guardar(); }
      pintarTodo();
    }
  };
})();
`;

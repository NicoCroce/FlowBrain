/**
 * "Especificaciones" (`#/especificaciones[/<feat>]`): por funcionalidad, cada requisito de negocio o de producto dicho
 * en llano, con el archivo que lo cumple y el caso de test que lo verifica. Sale de `especificaciones` y `tests` de
 * cada ficha, sin datos propios. Las propone el agente (guía `/flowbrain-specs`) y las confirma una persona: el botón
 * aparece si la página la sirve `flowbrain viewer --serve`. Lo que falta siempre se dice: la funcionalidad que no
 * tiene ninguna, la que no tiene test, la referencia que el índice ya no encuentra, y los casos de test que no
 * verifican nada declarado. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const ESPECIFICACIONES_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("especificaciones");
  var CEREBROS = D.cerebros || [];
  var FICHAS = D.funcionalidades || [];
  var ED = window.FLOWBRAIN_EDICION || null;
  var TIPO = { negocio: "Negocio", producto: "Producto" };
  var QUE_ES = { negocio: "Regla del negocio: vale aunque cambie la pantalla", producto: "Cómo se comporta el producto para quien lo usa" };
  var GRUPOS = [["", "Todas"], ["propuesta", "Por confirmar"], ["confirmada", "Confirmadas"], ["sintest", "Sin test"], ["rotas", "Con referencias rotas"]];
  var TOPE_SUELTOS = 60;
  var inicial = function () { return { grupo: "", tipo: "", cerebro: "", q: "" }; };
  var S = inicial();
  var CLAVE = "flowbrain.especificaciones";
  var guardar = function () { try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLAVE, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ } };
  try {
    var previo = typeof sessionStorage !== "undefined" ? JSON.parse(sessionStorage.getItem(CLAVE) || "null") : null;
    if (previo) Object.keys(S).forEach(function (k) { if (typeof previo[k] === typeof S[k]) S[k] = previo[k]; });
    if (S.cerebro !== "" && !CEREBROS[Number(S.cerebro)]) S.cerebro = "";
  } catch (e) { /* sin almacenamiento */ }
  // MSG: { f: feat, id: especificación, texto, error }. PEDIDO: { f: feat o "" para todas, copiado }.
  var MSG = null, PEDIDO = null, ocupado = false, FOCO = null;

  var plural = function (n, uno, varios) { return n.toLocaleString("es") + " " + (n === 1 ? uno : varios); };
  var elem = function (id) { return document.getElementById(id); };
  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var indiceCerebro = function (id) { return porId[id] && porId[id].c !== undefined ? porId[id].c : -1; };
  var cerebroDe = function (id) { var i = indiceCerebro(id); return i >= 0 && CEREBROS[i] ? CEREBROS[i].nombre : ""; };
  // "cerebro/feat-x" o "cerebro/repo-x:ruta" → sin el prefijo del visor.
  var local = function (id, f) { var c = cerebroDe(f); return c && id.indexOf(c + "/") === 0 ? id.slice(c.length + 1) : id; };
  var ruta = function (ref, f) { var a = local(ref, f), i = a.indexOf(":"); return i < 0 ? a : a.slice(i + 1); };
  var specs = function (f) { return f.especificaciones || []; };
  var totalCasos = function (f) { var n = 0; (f.tests || []).forEach(function (t) { n += t.casos.length; }); return n; };
  // Casos de test de la funcionalidad que ninguna especificación nombra (ni por caso ni por archivo entero).
  function sueltos(f) {
    var enteros = {}, nombrados = {}, out = [];
    specs(f).forEach(function (e) { e.tests.forEach(function (t) { if (t.linea === undefined) enteros[t.archivo] = true; else nombrados[t.archivo + "#" + t.linea] = true; }); });
    (f.tests || []).forEach(function (t) {
      if (enteros[t.archivo]) return;
      t.casos.forEach(function (c) { if (!nombrados[t.archivo + "#" + c.linea]) out.push({ archivo: t.archivo, caso: c.nombre, linea: c.linea }); });
    });
    return out;
  }
  var enGrupo = function (e, g) { return g === "propuesta" ? e.estado !== "confirmada" : g === "confirmada" ? e.estado === "confirmada" : g === "sintest" ? !e.tests.length : g === "rotas" ? e.rotos.length > 0 : true; };
  var delCerebro = function (f) { return S.cerebro === "" || String(indiceCerebro(f.id)) === S.cerebro; };
  function coincide(f, e) {
    if (!enGrupo(e, S.grupo)) return false;
    if (S.tipo && e.tipo !== S.tipo) return false;
    var q = S.q.trim().toLowerCase();
    if (!q) return true;
    return (e.texto + " " + e.id + " " + nombre(f.id) + " " + e.archivos.join(" ") + " " + e.tests.map(function (t) { return t.archivo + " " + (t.caso || ""); }).join(" ")).toLowerCase().indexOf(q) >= 0;
  }
  var todas = function () { var out = []; FICHAS.filter(delCerebro).forEach(function (f) { specs(f).forEach(function (e) { out.push([f, e]); }); }); return out; };
  function filtrosActivos() {
    var out = [];
    GRUPOS.forEach(function (g) { if (g[0] && S.grupo === g[0]) out.push(g[1].toLowerCase()); });
    if (S.tipo) out.push("tipo " + TIPO[S.tipo].toLowerCase());
    if (S.cerebro !== "") out.push("cerebro " + CEREBROS[Number(S.cerebro)].nombre);
    if (S.q.trim()) out.push("«" + S.q.trim() + "»");
    return out;
  }

  // ---------- Pedido para el agente ----------
  function textoDelPedido(fichas) {
    var out = [
      "Escribí las especificaciones de " + (fichas.length === 1 ? "esta funcionalidad" : "estas " + fichas.length + " funcionalidades") + " de FlowBrain siguiendo la guía de " + "flowbrain specs --guide" + " (en Claude Code: /flowbrain-specs).",
      "Cada especificación es un requisito de negocio o de producto en llano, con el archivo que lo cumple y el caso de test que lo verifica. Dejalas con estado propuesta: las confirmo yo.",
      ""
    ];
    fichas.forEach(function (f) {
      var c = cerebroDe(f.id), n = totalCasos(f), s = sueltos(f).length;
      out.push("- " + local(f.id, f.id) + " (" + nombre(f.id) + ")" + (c ? ", cerebro " + c : "") + ": " + (specs(f).length ? plural(specs(f).length, "especificación ya escrita", "especificaciones ya escritas") + ", " : "") +
        (n ? plural(n, "caso de test", "casos de test") + (specs(f).length ? ", " + s + " sin especificación" : "") : "sin tests: salen del código") + ".");
    });
    out.push("", "Al terminar, compilá cada cerebro y revisá con " + "flowbrain specs <funcionalidad>" + " que no queden referencias rotas.");
    return out.join("\n");
  }
  function copiar(texto, listo) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(function () { listo(true); }, function () { listo(false); }); return; }
    } catch (e) { /* sin portapapeles */ }
    listo(false);
  }
  function cajaDelPedido(fichas) {
    return '<div class="fd-plan"><h2>Pedido para el agente</h2>' +
      '<textarea class="fd-texto" readonly rows="8" aria-label="Pedido para el agente">' + esc(textoDelPedido(fichas)) + "</textarea>" +
      (PEDIDO.copiado === true ? '<span class="fd-ok">Copiado. Pegalo en tu agente.</span>' : PEDIDO.copiado === "no" ? '<span class="fd-nota">No se pudo copiar solo: seleccioná el texto y copialo.</span>' : "") + "</div>";
  }

  // ---------- Una especificación ----------
  function unaEspecificacion(f, e) {
    var confirmada = e.estado === "confirmada";
    var chips = '<span class="chip" title="' + esc(QUE_ES[e.tipo] || "") + '">' + esc(TIPO[e.tipo] || e.tipo) + "</span>" +
      '<span class="fd-es ' + (confirmada ? "ok" : "na") + '">' + (confirmada ? "Confirmada" : "Por confirmar") + "</span>" +
      (e.tests.length ? "" : '<span class="fd-es no">Sin test</span>');
    var cumple = e.archivos.length
      ? e.archivos.map(function (a) { return "<code title=\"" + esc(local(a, f.id)) + "\">" + esc(ruta(a, f.id)) + "</code>"; }).join(" ")
      : '<small>No se declaró ningún archivo.</small>';
    var verifica = e.tests.length
      ? '<ul class="lista es-tests">' + e.tests.map(function (t) {
          return "<li>" + (t.caso ? esc(t.caso) : "Todo el archivo" + (t.casos !== undefined ? " (" + plural(t.casos, "caso", "casos") + ")" : "")) +
            " <small><code>" + esc(ruta(t.archivo, f.id)) + "</code>" + (t.linea ? " L" + t.linea : "") + "</small></li>";
        }).join("") + "</ul>"
      : "<small>Ningún caso de test la verifica: si se rompe, nada avisa.</small>";
    var rotos = e.rotos.length
      ? '<p class="fd-msg error es-roto">El índice ya no encuentra ' + e.rotos.map(function (r) { return "<code>" + esc(local(r, f.id)) + "</code>"; }).join(", ") +
        ". Se movió un archivo o cambió el nombre de un caso: corregilo en la página de la funcionalidad o pedíselo al agente.</p>"
      : "";
    var msg = MSG && MSG.f === f.id && MSG.id === e.id ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    var accion = ED
      ? '<button type="button" class="boton' + (confirmada ? "" : " fd-pri") + '" data-acc="estado" data-f="' + esc(f.id) + '" data-id="' + esc(e.id) + '" data-estado="' + (confirmada ? "propuesta" : "confirmada") + '"' + (ocupado ? " disabled" : "") + ">" +
        (confirmada ? "Volver a por confirmar" : "Confirmar") + "</button>"
      : "";
    return '<li class="es-item"><div class="es-cabeza"><p class="es-texto">' + esc(e.texto) + "</p>" + accion + "</div>" +
      '<div class="chips">' + chips + "</div>" +
      '<div class="es-ref"><span class="lbl">Lo cumple</span><div>' + cumple + "</div></div>" +
      '<div class="es-ref"><span class="lbl">Lo verifica</span><div>' + verifica + "</div></div>" + rotos + msg + "</li>";
  }

  // ---------- Una funcionalidad ----------
  function unaFuncionalidad(f, es) {
    var todasSuyas = specs(f), conf = todasSuyas.filter(function (e) { return e.estado === "confirmada"; }).length;
    var sinTest = todasSuyas.filter(function (e) { return !e.tests.length; }).length, casos = totalCasos(f), ss = sueltos(f);
    var c = CEREBROS.length > 1 ? cerebroDe(f.id) : "";
    var chips = '<span class="chip">' + (es.length === todasSuyas.length ? plural(todasSuyas.length, "especificación", "especificaciones") : es.length + " de " + plural(todasSuyas.length, "especificación", "especificaciones")) + "</span>" +
      '<span class="chip">' + conf + " de " + todasSuyas.length + " confirmadas</span>" +
      (sinTest ? '<span class="chip es-falta">' + sinTest + " sin test</span>" : "") +
      '<span class="chip">' + (casos ? plural(casos, "caso de test", "casos de test") : "sin tests") + "</span>" +
      (c ? '<span class="chip">' + esc(c) + "</span>" : "");
    var lista = ss.length
      ? '<details class="tf"><summary>' + plural(ss.length, "caso de test no verifica", "casos de test no verifican") + " ninguna especificación</summary>" +
        "<p><small>O falta escribir la especificación, o el caso prueba un detalle técnico que no es un requisito. El agente los revisa con <code>/flowbrain-specs</code>.</small></p>" +
        '<ul class="lista">' + ss.slice(0, TOPE_SUELTOS).map(function (x) { return "<li>" + esc(x.caso) + " <small><code>" + esc(ruta(x.archivo, f.id)) + "</code> L" + x.linea + "</small></li>"; }).join("") + "</ul>" +
        (ss.length > TOPE_SUELTOS ? "<p><small>Y " + (ss.length - TOPE_SUELTOS) + " más: están todos en la ficha de la funcionalidad, en Tests.</small></p>" : "") + "</details>"
      : casos ? '<p class="fd-ok">Todos sus casos de test verifican alguna especificación.</p>' : "";
    return '<section class="es-feat" id="es-' + esc(f.id) + '"><div class="es-cab"><h3><a href="#/f/' + esc(f.id) + '">' + esc(nombre(f.id)) + "</a></h3>" +
      '<div class="chips">' + chips + "</div></div>" +
      '<ul class="lista">' + es.map(function (e) { return unaEspecificacion(f, e); }).join("") + "</ul>" + lista + "</section>";
  }

  // ---------- Las que no tienen ninguna ----------
  function sinNinguna(fichas) {
    if (!fichas.length) return "";
    var orden = fichas.slice().sort(function (a, b) { return totalCasos(b) - totalCasos(a) || (nombre(a.id).toLowerCase() < nombre(b.id).toLowerCase() ? -1 : 1); });
    return '<section class="es-feat"><div class="es-cab"><h3>Sin especificaciones (' + fichas.length + ")</h3>" +
      '<button type="button" class="boton" data-acc="pedido" data-f="">' + (PEDIDO && PEDIDO.f === "" ? "Ocultar pedido" : "Copiar pedido para todas") + "</button></div>" +
      '<p><small>Nadie escribió todavía qué tienen que cumplir. Las deduce el agente del código y de los tests; las que más casos de test tienen van primero, porque son las más fáciles de deducir.</small></p>' +
      (PEDIDO && PEDIDO.f === "" ? cajaDelPedido(orden) : "") +
      '<ul class="lista">' + orden.map(function (f) {
        var n = totalCasos(f), c = CEREBROS.length > 1 ? cerebroDe(f.id) : "";
        return '<li class="es-fila"><span><a href="#/f/' + esc(f.id) + '">' + esc(nombre(f.id)) + "</a> <small>" + (n ? plural(n, "caso de test", "casos de test") : "sin tests") + (c ? " · " + esc(c) : "") + "</small></span>" +
          '<button type="button" class="boton" data-acc="pedido" data-f="' + esc(f.id) + '">' + (PEDIDO && PEDIDO.f === f.id ? "Ocultar pedido" : "Copiar pedido") + "</button>" +
          (PEDIDO && PEDIDO.f === f.id ? cajaDelPedido([f]) : "") + "</li>";
      }).join("") + "</ul></section>";
  }

  // ---------- Página ----------
  function cifras(pares, vacias) {
    var cifra = function (valor, texto, color) { return '<div class="fd-cifra"><b' + (color ? ' style="color:' + color + '"' : "") + ">" + valor.toLocaleString("es") + "</b><span>" + texto + "</span></div>"; };
    var conf = pares.filter(function (p) { return p[1].estado === "confirmada"; }).length, sinTest = pares.filter(function (p) { return !p[1].tests.length; }).length, ss = 0;
    FICHAS.filter(delCerebro).forEach(function (f) { if (specs(f).length) ss += sueltos(f).length; });
    return '<div class="fd-cifras">' + cifra(pares.length, "especificaciones") + cifra(conf, "confirmadas por una persona", conf ? "var(--tabla)" : "") +
      cifra(sinTest, "sin ningún test que las verifique", sinTest ? "var(--dudoso)" : "") + cifra(ss, "casos de test sin especificación") + cifra(vacias, "funcionalidades sin especificaciones", vacias ? "var(--feat)" : "") + "</div>";
  }
  function grupos(pares) {
    return '<div class="fd-grupos" role="group" aria-label="Qué ver">' + GRUPOS.map(function (g) {
      var n = pares.filter(function (p) { return enGrupo(p[1], g[0]); }).length;
      if (g[0] === "rotas" && !n && S.grupo !== "rotas") return "";
      return '<button type="button" class="fd-grupo' + (S.grupo === g[0] ? " on" : "") + '" data-grupo="' + g[0] + '" aria-pressed="' + (S.grupo === g[0]) + '">' + g[1] + "<small>" + n.toLocaleString("es") + "</small></button>";
    }).join("") + "</div>";
  }
  function herramientas() {
    var sel = function (id, etiqueta, todos, ops, actual) {
      return '<select id="' + id + '" aria-label="' + etiqueta + '"><option value="">' + todos + "</option>" + ops.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === actual ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
    };
    return '<div class="fd-herr"><input id="es-q" type="search" placeholder="Buscar en el texto, la funcionalidad, un archivo o un test…" aria-label="Buscar" autocomplete="off" value="' + esc(S.q) + '">' +
      sel("es-tipo", "Tipo", "Negocio y producto", [["negocio", "Solo negocio"], ["producto", "Solo producto"]], S.tipo) +
      (CEREBROS.length > 1 ? sel("es-cerebro", "Cerebro", "Todos los cerebros", CEREBROS.map(function (c, i) { return [i, c.nombre]; }), S.cerebro) : "") + "</div>";
  }
  function lista() {
    var fichas = FICHAS.filter(delCerebro), activos = filtrosActivos(), soloCerebro = !S.grupo && !S.tipo && !S.q.trim();
    var con = fichas.map(function (f) { return [f, specs(f).filter(function (e) { return coincide(f, e); })]; }).filter(function (x) { return x[1].length; });
    con.sort(function (a, b) { return nombre(a[0].id).toLowerCase() < nombre(b[0].id).toLowerCase() ? -1 : 1; });
    var vacias = soloCerebro ? fichas.filter(function (f) { return !specs(f).length; }) : [];
    if (!con.length && !vacias.length) {
      return '<p class="aviso">Ninguna especificación coincide con ' + activos.map(esc).join(", ") + ". Hay " + plural(todas().length, "especificación", "especificaciones") + ' en total. <button type="button" class="boton" data-acc="limpiar">Quitar filtros</button></p>';
    }
    var n = 0; con.forEach(function (x) { n += x[1].length; });
    return (con.length ? '<div class="fd-cab"><p class="subtitulo">' + plural(n, "especificación", "especificaciones") + " en " + plural(con.length, "funcionalidad", "funcionalidades") + (activos.length ? " (" + activos.map(esc).join(", ") + ")" : "") + "</p>" +
        (activos.length ? '<div class="fd-acc"><button type="button" class="boton" data-acc="limpiar">Quitar filtros</button></div>' : "") + "</div>" : "") +
      con.map(function (x) { return unaFuncionalidad(x[0], x[1]); }).join("") + sinNinguna(vacias);
  }
  var COMO = '<p class="subtitulo">Qué tiene que cumplirse en cada funcionalidad, dicho en llano: el archivo que lo cumple y el caso de test que lo verifica. Las propone el agente leyendo el código y los tests; una persona las confirma.</p>';
  function aviso() {
    if (!ED) return '<p class="aviso">Esta página es de solo lectura. Para confirmar especificaciones desde acá, abrila con <code>flowbrain viewer --serve</code>; si no, se confirman cambiando <code>estado: propuesta</code> por <code>estado: confirmada</code> en la página de la funcionalidad.</p>';
    return "";
  }
  function pintarLista() { var e = elem("es-lista"); if (e) e.innerHTML = lista(); }
  function pintarTodo() {
    if (!FICHAS.length) {
      raiz.innerHTML = "<h1>Especificaciones</h1>" + '<p class="aviso">No hay funcionalidades, así que no hay de qué escribir especificaciones. Primero se deducen las funcionalidades del producto: <code>/flowbrain-features</code> en el agente (o <code>flowbrain feature --guide</code>).</p>';
      return;
    }
    var pares = todas(), vacias = FICHAS.filter(delCerebro).filter(function (f) { return !specs(f).length; }).length;
    var nada = !pares.length
      ? '<p class="aviso">Todavía no hay ninguna especificación escrita' + (S.cerebro !== "" ? " en este cerebro" : "") + ". Se guardan en la página de cada funcionalidad y las deduce el agente: copiá el pedido de abajo y pegáselo, o corré <code>/flowbrain-specs</code>.</p>"
      : "";
    raiz.innerHTML = "<h1>Especificaciones</h1>" + COMO + aviso() + cifras(pares, vacias) + (pares.length ? grupos(pares) : "") + (pares.length || CEREBROS.length > 1 ? herramientas() : "") + nada + '<div id="es-lista">' + lista() + "</div>";
    if (FOCO) { var s = elem("es-" + FOCO); FOCO = null; if (s && s.scrollIntoView) s.scrollIntoView(); }
  }
  function refrescar(todo) { guardar(); if (todo) pintarTodo(); else pintarLista(); }
  function pedir(cuerpo) {
    return fetch("/api/editar", { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "el servidor respondió " + r.status); return j; }); });
  }
  function cambiarEstado(f, id, estado) {
    if (ocupado || !ED) return;
    ocupado = true; MSG = { f: f, id: id, texto: "Guardando…" }; pintarLista();
    pedir({ tipo: "especificacion", cerebro: cerebroDe(f), funcionalidad: local(f, f), id: id, estado: estado }).then(function (r) {
      ocupado = false;
      // El cambio ya está en la página y el cerebro recompilado: se refleja acá sin recargar.
      FICHAS.forEach(function (x) { if (x.id === f) specs(x).forEach(function (e) { if (e.id === id) e.estado = estado; }); });
      MSG = { f: f, id: id, texto: r.mensaje + " (" + r.escrito + ")" };
      pintarTodo();
    }).catch(function (e) { ocupado = false; MSG = { f: f, id: id, texto: e.message, error: true }; pintarLista(); });
  }

  raiz.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc");
    if (acc === "limpiar") { S = inicial(); refrescar(true); return; }
    if (acc === "estado") { cambiarEstado(b.getAttribute("data-f"), b.getAttribute("data-id"), b.getAttribute("data-estado")); return; }
    if (acc === "pedido") {
      var f = b.getAttribute("data-f");
      if (PEDIDO && PEDIDO.f === f) { PEDIDO = null; pintarLista(); return; }
      PEDIDO = { f: f, copiado: false }; pintarLista();
      var fichas = f === "" ? FICHAS.filter(delCerebro).filter(function (x) { return !specs(x).length; }) : FICHAS.filter(function (x) { return x.id === f; });
      copiar(textoDelPedido(fichas), function (ok) { if (PEDIDO && PEDIDO.f === f) { PEDIDO.copiado = ok ? true : "no"; pintarLista(); } });
      return;
    }
    if (b.hasAttribute("data-grupo")) { S.grupo = b.getAttribute("data-grupo"); refrescar(true); }
  });
  raiz.addEventListener("change", function (ev) {
    var id = ev.target.id || "";
    if (id === "es-tipo") { S.tipo = ev.target.value; refrescar(false); }
    else if (id === "es-cerebro") { S.cerebro = ev.target.value; refrescar(true); }
  });
  raiz.addEventListener("input", function (ev) { if (ev.target.id === "es-q") { S.q = ev.target.value; refrescar(false); } });

  window.brainEspecificaciones = { mostrar: function (feat) { FOCO = feat || null; if (feat) { S = inicial(); } pintarTodo(); } };
})();
`;

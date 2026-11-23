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
  var inicial = function () { return { grupo: "", cerebro: "", q: "", abiertas: {} }; };
  var S = inicial();
  var CLAVE = "flowbrain.especificaciones.v2";
  var guardar = function () { try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLAVE, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ } };
  try {
    var previo = typeof sessionStorage !== "undefined" ? JSON.parse(sessionStorage.getItem(CLAVE) || "null") : null;
    if (previo) Object.keys(S).forEach(function (k) { if (previo[k] !== undefined && typeof previo[k] === typeof S[k]) S[k] = previo[k]; });
    if (S.cerebro !== "" && !CEREBROS[Number(S.cerebro)]) S.cerebro = "";
  } catch (e) { /* sin almacenamiento */ }
  // MSG: { k: clave del caso, texto, error }. EDITA: clave del caso que se está marcando. PEDIDO: { k, copiado }.
  var MSG = null, EDITA = null, BORRADOR = "", PEDIDO = null, ocupado = false, FOCO = null;

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
  var estadoDeReglas = function (es) {
    if (!es.length) return "sin_reglas";
    if (es.some(function (e) { return !e.archivos.length; })) return "sin_codigo";
    if (es.some(function (e) { return !e.tests.length; })) return "sin_test";
    return "cumplido";
  };

  // ---------- Modelo: funcionalidades del producto (unidas entre cerebros) y sus casos de uso ----------
  // P = { id, nombre, resumen, fichas, cerebros, casos: [C], sueltas: [{ f, e }] }
  // C = { k, id, nombre, quien, patas: [{ f, cerebro, reglas, estado }], problemas: [{ cerebro, texto }], estado }
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
          if (!casos[c.id]) { casos[c.id] = { k: P.id + "|" + c.id, id: c.id, nombre: c.nombre, quien: c.quien || "", patas: [], problemas: [] }; ordenCasos.push(c.id); }
          var C = casos[c.id], reglas = c.especificaciones.map(function (id) { return porIdSpec[id]; }).filter(Boolean);
          reglas.forEach(function (e) { usadas[e.id] = true; });
          if (!C.quien && c.quien) C.quien = c.quien;
          C.patas.push({ f: f, cerebro: cerebroDe(f.id), reglas: reglas, estado: estadoDeReglas(reglas) });
          if (c.problema) C.problemas.push({ cerebro: cerebroDe(f.id), texto: c.problema });
        });
        specs(f).forEach(function (e) { if (!usadas[e.id]) P.sueltas.push({ f: f, e: e }); });
      });
      P.casos = ordenCasos.map(function (id) {
        var C = casos[id];
        C.estado = C.patas.reduce(function (a, p) { return PESO[p.estado] < PESO[a] ? p.estado : a; }, "cumplido");
        if (C.patas.every(function (p) { return !p.reglas.length; })) C.estado = "sin_reglas";
        return C;
      });
      return P;
    });
  }
  var PRODUCTO = armar();

  var enCerebro = function (cerebros) { return S.cerebro === "" || cerebros.indexOf(CEREBROS[Number(S.cerebro)].nombre) >= 0; };
  var cerebrosDelCaso = function (C) { return C.patas.map(function (p) { return p.cerebro; }); };
  var enGrupo = function (C, g) { return g === "sintest" ? C.estado === "sin_test" || C.estado === "sin_codigo" : g === "problema" ? C.problemas.length > 0 : g === "cumplido" ? C.estado === "cumplido" : true; };
  var sueltaEnGrupo = function (x, g) { return g === "sintest" ? !x.e.tests.length || !x.e.archivos.length : g === "cumplido" ? x.e.tests.length > 0 && x.e.archivos.length > 0 : g === "problema" ? false : true; };
  var textoDeRegla = function (x) { return x.e.texto + " " + x.e.archivos.join(" ") + " " + x.e.tests.map(function (t) { return t.archivo + " " + (t.caso || ""); }).join(" "); };
  function busca(P, extra) {
    var q = S.q.trim().toLowerCase();
    return !q || (P.nombre + " " + P.id + " " + extra).toLowerCase().indexOf(q) >= 0;
  }
  var casoCoincide = function (P, C) {
    return enGrupo(C, S.grupo) && enCerebro(cerebrosDelCaso(C)) &&
      busca(P, C.nombre + " " + C.quien + " " + C.patas.map(function (p) { return p.cerebro + " " + p.reglas.map(function (e) { return textoDeRegla({ e: e }); }).join(" "); }).join(" "));
  };
  var sueltaCoincide = function (P, x) { return sueltaEnGrupo(x, S.grupo) && enCerebro([cerebroDe(x.f.id)]) && busca(P, textoDeRegla(x)); };
  var conSpecs = function (P) { return P.fichas.some(function (f) { return specs(f).length; }); };
  var visibles = function () { return PRODUCTO.filter(function (P) { return enCerebro(P.cerebros); }); };
  var todosLosCasos = function () { var out = []; visibles().forEach(function (P) { P.casos.forEach(function (C) { if (enCerebro(cerebrosDelCaso(C))) out.push([P, C]); }); }); return out; };
  var todasSueltas = function () { var out = []; visibles().forEach(function (P) { P.sueltas.forEach(function (x) { if (enCerebro([cerebroDe(x.f.id)])) out.push([P, x]); }); }); return out; };
  function filtrosActivos() {
    var out = [];
    GRUPOS.forEach(function (g) { if (g[0] && S.grupo === g[0]) out.push(g[1].toLowerCase()); });
    if (S.cerebro !== "") out.push("cerebro " + CEREBROS[Number(S.cerebro)].nombre);
    if (S.q.trim()) out.push("«" + S.q.trim() + "»");
    return out;
  }

  // ---------- Pedidos para el agente ----------
  var GUIA = "siguiendo la guía de flowbrain specs --guide (en Claude Code: /flowbrain-specs)";
  function textoDelPedido(tipo, items) {
    var out;
    if (tipo === "corregir") {
      out = ["Corregí estos casos de uso de FlowBrain que marqué como mal, " + GUIA + ". Después de corregir cada uno, borrá su campo problema de la página.", ""];
      items.forEach(function (it) { porTexto(it[1].problemas).forEach(function (pr) { out.push("- " + it[0].id + " / " + it[1].id + " (" + it[1].nombre + "), " + (pr[1].length > 1 ? "cerebros " : "cerebro ") + pr[1].join(", ") + ": " + pr[0]); }); });
    } else if (tipo === "agrupar") {
      out = ["Agrupá en casos de uso las especificaciones que todavía no están en ninguno, " + GUIA + ". El mismo caso en otro cerebro lleva el mismo id. No cambies el texto de las especificaciones.", ""];
      items.forEach(function (P) {
        var porCerebro = {};
        P.sueltas.forEach(function (x) { var c = cerebroDe(x.f.id); porCerebro[c] = (porCerebro[c] || 0) + 1; });
        out.push("- " + P.id + " (" + P.nombre + "): " + Object.keys(porCerebro).map(function (c) { return plural(porCerebro[c], "especificación", "especificaciones") + " en " + c; }).join(", ") + ".");
      });
    } else {
      out = ["Escribí los casos de uso y las especificaciones de " + (items.length === 1 ? "esta funcionalidad" : "estas " + items.length + " funcionalidades") + " de FlowBrain " + GUIA + ".", ""];
      items.forEach(function (P) {
        P.fichas.forEach(function (f) { var n = totalCasos(f); out.push("- " + P.id + " (" + P.nombre + "), cerebro " + cerebroDe(f.id) + ": " + (n ? plural(n, "caso de test", "casos de test") : "sin tests: salen del código") + "."); });
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
    return '<button type="button" class="boton" data-acc="pedido" data-k="' + esc(k) + '">' + (PEDIDO && PEDIDO.k === k ? "Ocultar pedido" : etiqueta) + "</button>";
  }
  function cajaDelPedido(k) {
    if (!PEDIDO || PEDIDO.k !== k || !PEDIDOS[k]) return "";
    return '<div class="fd-plan"><h2>Pedido para el agente</h2>' +
      '<textarea class="fd-texto" readonly rows="8" aria-label="Pedido para el agente">' + esc(textoDelPedido(PEDIDOS[k][0], PEDIDOS[k][1])) + "</textarea>" +
      (PEDIDO.copiado === true ? '<span class="fd-ok">Copiado. Pegalo en tu agente.</span>' : PEDIDO.copiado === "no" ? '<span class="fd-nota">No se pudo copiar solo: seleccioná el texto y copialo.</span>' : "") + "</div>";
  }

  // ---------- Una regla (dentro de un caso o suelta) ----------
  function unaRegla(e, f, conCerebro) {
    var cumple = e.archivos.length
      ? e.archivos.map(function (a) { return '<code title="' + esc(local(a, f.id)) + '">' + esc(corto(a, f.id)) + "</code>"; }).join(" ")
      : '<span class="es-mal">no dice qué archivo la cumple</span>';
    var verifica = e.tests.length
      ? e.tests.map(function (t) { return '<span title="' + esc(ruta(t.archivo, f.id) + (t.linea ? " L" + t.linea : "")) + '">' + esc(t.caso || "todo " + corto(t.archivo, f.id) + (t.casos !== undefined ? " (" + plural(t.casos, "caso", "casos") + ")" : "")) + "</span>"; }).join('<span class="es-sep"> · </span>')
      : '<span class="es-mal">ningún test la verifica</span>';
    var rotos = e.rotos.length ? '<p class="fd-msg error es-roto">El índice ya no encuentra ' + e.rotos.map(function (r) { return "<code>" + esc(local(r, f.id)) + "</code>"; }).join(", ") + ": se movió un archivo o cambió el nombre de un test. Pedile al agente que lo corrija.</p>" : "";
    return '<li class="es-regla"><p class="es-texto">' + esc(e.texto) + ' <span class="chip" title="' + esc(QUE_ES[e.tipo] || "") + '">' + esc(TIPO[e.tipo] || e.tipo) + "</span>" + (conCerebro ? ' <span class="chip">' + esc(cerebroDe(f.id)) + "</span>" : "") + "</p>" +
      '<div class="es-ref"><span class="lbl">Lo cumple</span><div>' + cumple + "</div></div>" +
      '<div class="es-ref"><span class="lbl">Lo verifica</span><div>' + verifica + "</div></div>" + rotos + "</li>";
  }

  // ---------- Un caso de uso ----------
  // El mismo comentario guardado en varios cerebros se dice una vez, con los cerebros donde está.
  function porTexto(problemas) {
    var out = [], idx = {};
    problemas.forEach(function (pr) { if (idx[pr.texto] === undefined) { idx[pr.texto] = out.length; out.push([pr.texto, []]); } out[idx[pr.texto]][1].push(pr.cerebro); });
    return out;
  }
  function filaDeCerebro(p) {
    var archivos = {}, tests = {}, sinTest = 0, sinCodigo = 0;
    p.reglas.forEach(function (e) {
      e.archivos.forEach(function (a) { archivos[a.replace(/#L\d+$/, "")] = true; });
      e.tests.forEach(function (t) { tests[t.archivo + "::" + (t.caso || "")] = true; });
      if (!e.tests.length) sinTest++;
      if (!e.archivos.length) sinCodigo++;
    });
    var a = Object.keys(archivos), nt = Object.keys(tests).length;
    var codigo = a.length ? a.slice(0, 4).map(function (x) { return '<code title="' + esc(local(x, p.f.id)) + '">' + esc(corto(x, p.f.id)) + "</code>"; }).join(" ") + (a.length > 4 ? " <small>y " + (a.length - 4) + " más</small>" : "") : '<span class="es-mal">sin código</span>';
    var test = !p.reglas.length ? '<span class="es-mal">sin reglas en este cerebro</span>'
      : sinTest ? '<span class="es-mal">✘ ' + (sinTest === p.reglas.length ? "sin test" : sinTest + " de " + p.reglas.length + " reglas sin test") + "</span>" + (nt ? " <small>(" + plural(nt, "test", "tests") + " en las otras)</small>" : "")
      : '<span class="es-bien">✔ ' + plural(nt, "test", "tests") + "</span>";
    return '<tr><th scope="row">' + esc(p.cerebro) + "</th><td>" + codigo + (sinCodigo && a.length ? ' <span class="es-mal">(' + sinCodigo + " sin archivo)</span>" : "") + "</td><td>" + test + "</td></tr>";
  }
  function unCaso(P, C) {
    var est = ESTADO[C.estado], reglas = [];
    C.patas.forEach(function (p) { p.reglas.forEach(function (e) { reglas.push([e, p.f]); }); });
    var varios = C.patas.length > 1;
    var marca = C.problemas.length
      ? '<div class="es-problema"><b>Marcado como mal</b>' + porTexto(C.problemas).map(function (pr) { return "<p>«" + esc(pr[0]) + "»" + (varios && pr[1].length < C.patas.length ? " <small>(" + esc(pr[1].join(", ")) + ")</small>" : "") + "</p>"; }).join("") +
        "<small>El agente lo ve con <code>/flowbrain-specs</code> (o <code>flowbrain specs --problems</code>), lo corrige y saca la marca.</small>" +
        (ED ? ' <button type="button" class="boton" data-acc="desmarcar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + ">Quitar la marca</button>" : "") + "</div>"
      : "";
    var form = EDITA === C.k
      ? '<div class="es-form"><label for="es-nota">Qué está mal</label><textarea id="es-nota" rows="3" maxlength="1000" placeholder="El nombre no es lo que hace la pantalla, falta una regla, el archivo o el test no es ese…">' + esc(BORRADOR) + "</textarea>" +
        '<div class="fd-acc"><button type="button" class="boton fd-pri" data-acc="guardar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + '>Guardar</button><button type="button" class="boton" data-acc="cancelar">Cancelar</button></div>' +
        "<small>Se guarda en la página de la funcionalidad de " + (varios ? "cada cerebro (" + esc(cerebrosDelCaso(C).join(", ")) + ")" : "su cerebro") + ".</small></div>"
      : "";
    var msg = MSG && MSG.k === C.k ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    var accion = ED && EDITA !== C.k ? '<button type="button" class="boton" data-acc="marcar" data-k="' + esc(C.k) + '"' + (ocupado ? " disabled" : "") + ">Esto está mal</button>" : "";
    return '<li class="es-caso" id="es-caso-' + esc(C.k) + '"><div class="es-cabeza"><div><p class="es-nombre">' + esc(C.nombre) + "</p>" + (C.quien ? "<small>Quién: " + esc(C.quien) + "</small>" : "") + "</div>" +
      '<div class="es-acciones"><span class="fd-es ' + est.cls + '" title="' + esc(est.que) + '">' + (C.estado === "cumplido" ? "✔ " : "✘ ") + est.txt + "</span>" + accion + "</div></div>" +
      marca + form + msg +
      '<table class="es-patas"><thead><tr><th scope="col">Cerebro</th><th scope="col">Lo cumple</th><th scope="col">Lo verifica</th></tr></thead><tbody>' + C.patas.map(filaDeCerebro).join("") + "</tbody></table>" +
      (reglas.length ? '<details class="tf es-reglas"><summary>' + plural(reglas.length, "regla", "reglas") + ": " + esc(reglas.slice(0, 3).map(function (r) { return r[0].texto.replace(/\.$/, ""); }).join(" · ")) + (reglas.length > 3 ? " …" : "") + "</summary>" +
        '<ul class="lista">' + reglas.map(function (r) { return unaRegla(r[0], r[1], varios); }).join("") + "</ul></details>" : "") + "</li>";
  }

  // ---------- Una funcionalidad del producto ----------
  function pendientes(P) {
    var mal = 0, falta = 0, sueltasSinTest = 0;
    P.casos.forEach(function (C) { if (C.problemas.length) mal++; if (C.estado !== "cumplido") falta++; });
    P.sueltas.forEach(function (x) { if (!x.e.tests.length) sueltasSinTest++; });
    return [mal, falta, sueltasSinTest];
  }
  function unaFuncionalidad(P, casos, sueltas) {
    var abierta = !!S.abiertas[P.id] || !!S.q.trim();
    var cumplidos = P.casos.filter(function (C) { return C.estado === "cumplido"; }).length;
    var sinTest = P.casos.filter(function (C) { return C.estado === "sin_test" || C.estado === "sin_codigo"; }).length;
    var mal = P.casos.filter(function (C) { return C.problemas.length; }).length;
    var chips = (P.casos.length ? '<span class="chip">' + plural(P.casos.length, "caso de uso", "casos de uso") + "</span>" +
        '<span class="chip es-ok">' + cumplidos + " cumplido" + (cumplidos === 1 ? "" : "s") + "</span>" +
        (sinTest ? '<span class="chip es-falta">' + sinTest + " sin test</span>" : "") +
        (mal ? '<span class="chip es-falta">' + mal + " marcado" + (mal === 1 ? "" : "s") + " como mal</span>" : "") : "") +
      (P.sueltas.length ? '<span class="chip es-aviso">' + plural(P.sueltas.length, "regla sin caso de uso", "reglas sin caso de uso") + "</span>" : "") +
      P.cerebros.map(function (c) { return '<span class="chip es-cerebro">' + esc(c) + "</span>"; }).join("");
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
    return '<div class="fd-herr"><input id="es-q" type="search" placeholder="Buscar un caso de uso, una regla, una funcionalidad, un archivo o un test…" aria-label="Buscar" autocomplete="off" value="' + esc(S.q) + '">' +
      (CEREBROS.length > 1 ? '<select id="es-cerebro" aria-label="Cerebro"><option value="">Todos los cerebros</option>' + CEREBROS.map(function (c, i) { return '<option value="' + i + '"' + (String(i) === S.cerebro ? " selected" : "") + ">" + esc(c.nombre) + "</option>"; }).join("") + "</select>" : "") + "</div>";
  }
  function lista() {
    var activos = filtrosActivos(), sinFiltro = !S.grupo && !S.q.trim();
    var filas = visibles().map(function (P) {
      return [P, P.casos.filter(function (C) { return casoCoincide(P, C); }).sort(function (a, b) { return (b.problemas.length ? 1 : 0) - (a.problemas.length ? 1 : 0) || PESO[a.estado] - PESO[b.estado]; }),
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
      out += '<div class="aviso es-agrupar"><p>' + (cs ? "Hay " : "Todavía no hay casos de uso: hay ") + plural(n, "regla escrita", "reglas escritas") + " que el agente no agrupó en casos de uso" + (cs ? "" : " (lo que alguien hace: «Votar al mejor jugador del partido»)") + ". Pedile que las agrupe; no cambia lo escrito, solo lo ordena.</p>" +
        botonPedido("agrupar|", "agrupar", conSueltas, "Copiar pedido para agrupar todas") + cajaDelPedido("agrupar|") + "</div>";
    }
    return out;
  }
  function pintarLista() { var e = elem("es-lista"); if (e) e.innerHTML = lista(); }
  function pintarTodo() {
    if (!FICHAS.length) {
      raiz.innerHTML = "<h1>Especificaciones</h1>" + '<p class="aviso">No hay funcionalidades, así que no hay casos de uso. Primero se deducen las funcionalidades del producto: <code>/flowbrain-features</code> en el agente (o <code>flowbrain feature --guide</code>).</p>';
      return;
    }
    var hay = todosLosCasos().length || todasSueltas().length;
    var nada = !hay
      ? '<p class="aviso">Todavía no hay casos de uso ni reglas escritas' + (S.cerebro !== "" ? " en este cerebro" : "") + ". Se guardan en la página de cada funcionalidad y las deduce el agente: copiá el pedido de abajo y pegáselo, o corré <code>/flowbrain-specs</code>.</p>"
      : "";
    PEDIDOS = {};
    var cabeza = "<h1>Especificaciones</h1>" + COMO + aviso() + cifras() + (hay ? grupos() : "") + (hay || CEREBROS.length > 1 ? herramientas() : "") + nada;
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
    C.patas.forEach(function (p) {
      cadena = cadena.then(function () {
        return pedir({ tipo: "caso", cerebro: p.cerebro, funcionalidad: local(p.f.id, p.f.id), id: C.id, problema: texto || null }).then(function () {
          hechos.push(p.cerebro);
          (p.f.casos || []).forEach(function (c) { if (c.id === C.id) { if (texto) c.problema = texto; else delete c.problema; } });
        });
      });
    });
    cadena.then(function () {
      ocupado = false; EDITA = null; BORRADOR = "";
      PRODUCTO = armar();
      MSG = { k: k, texto: texto ? "Quedó marcado como mal en " + hechos.join(", ") + ". El agente lo corrige con /flowbrain-specs; copiá el pedido desde «Marcados como mal»." : "Se le sacó la marca en " + hechos.join(", ") + "." };
      pintarTodo();
    }).catch(function (e) {
      ocupado = false; PRODUCTO = armar();
      MSG = { k: k, texto: (hechos.length ? "Se guardó en " + hechos.join(", ") + " pero falló en el resto: " : "") + e.message, error: true };
      pintarTodo();
    });
  }

  function accion(b) {
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k");
    if (acc === "limpiar") { S = inicial(); refrescar(true); return; }
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
    if (acc === "pedido") {
      if (PEDIDO && PEDIDO.k === k) { PEDIDO = null; pintarTodo(); return; }
      var p = PEDIDOS[k];
      if (!p) return;
      PEDIDO = { k: k, copiado: false }; pintarTodo();
      copiar(textoDelPedido(p[0], p[1]), function (ok) { if (PEDIDO && PEDIDO.k === k) { PEDIDO.copiado = ok ? true : "no"; pintarTodo(); } });
    }
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
  raiz.addEventListener("change", function (ev) { if ((ev.target.id || "") === "es-cerebro") { S.cerebro = ev.target.value; refrescar(true); } });
  raiz.addEventListener("input", function (ev) {
    if (ev.target.id === "es-q") { S.q = ev.target.value; refrescar(false); }
    else if (ev.target.id === "es-nota") BORRADOR = ev.target.value;
  });

  window.brainEspecificaciones = {
    mostrar: function (feat) {
      if (feat) { var k = local(feat, feat); S = inicial(); S.abiertas[k] = true; FOCO = k; guardar(); }
      pintarTodo();
    }
  };
})();
`;

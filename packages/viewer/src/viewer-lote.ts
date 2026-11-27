/**
 * El panel de un lote al agente, compartido por las pantallas que mandan lotes (`/api/agente/lote`): Especificaciones
 * (reglas a testear) y Sin asociar (archivos a asociar). Pone `window.brainLote` con:
 * - la elección de Proveedor y Modelo (`selector`, `proveedor`, `modelo`): la pantalla guarda lo elegido;
 * - el seguimiento (`tandas`, `vivo`, `loteVivo`, `estado`);
 * - el panel del lote (`html`): «X de N tandas», el avance por repo y tanda, el costo, el resumen al terminar y los
 *   botones «Cancelar todo» (`cancelar-lote`), «Recargar para ver los cambios» (`recargar`) y «Cerrar el resumen»
 *   (`cerrar-lote`). Cada pantalla atiende esos `data-acc` y pone lo propio (qué cuenta, qué dice cada tanda, el
 *   resumen) con las opciones de `html`;
 * - la lista que se va armando y su panel lateral (dec. 227): el botón celeste que suma o saca de la lista
 *   (`botonSumar`, `data-acc="sumar"`, y `marcarBotones` para cambiarlos sin repintar), el botón que abre el panel
 *   (`bandeja`, `data-acc="panel"`), el panel (`aside`, `panel`: título y ✕ `cerrar-panel`, proveedor y modelo, los
 *   totales, los botones, el lote, cada ítem con «Quitar» `quitar` y lo que la pantalla agregue) y `pintarPanel`.
 *   La lista y si el panel está abierto los guarda cada pantalla en este navegador (localStorage). Lo usan
 *   Especificaciones («Tests pedidos») y Sin asociar («Pedido al agente»): cada una pone sus textos y sus ítems.
 * JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const LOTE_JS = String.raw`
(function () {
  "use strict";
  var esc = function (s) { return window.brainVisor.esc(s); };
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
  var pl = function (n, u) { return L(plural(n, u[0], u[1]), plural(n, u[2], u[3])); };
  var vivo = function (t) { return t.estado === "en_cola" || t.estado === "corriendo"; };
  var estado = function (e) {
    var T = { en_cola: [L("Queued", "En cola"), "na"], corriendo: [L("Working…", "Trabajando…"), "na"], terminado: [L("Finished", "Terminó"), "ok"], fallo: [L("Failed", "Falló"), "no"], cancelado: [L("Canceled", "Cancelado"), "na"] };
    return T[e] || [e, "na"];
  };
  var dolares = function (n) { return "US$ " + (n < 0.1 ? n.toFixed(3) : n.toFixed(2)); };
  var tandas = function (LT, trabajos) { return trabajos.filter(function (t) { return t.lote === LT.id; }).sort(function (a, b) { return a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.tanda.n - b.tanda.n; }); };
  var loteVivo = function (LT, trabajos) { return !!LT && (LT.estado !== "terminado" || tandas(LT, trabajos).some(vivo)); };
  function proveedor(provs, elegido) {
    for (var i = 0; i < provs.length; i++) if (provs[i].id === elegido.proveedor) return provs[i];
    return provs[0] || null;
  }
  function modelo(provs, elegido) {
    var p = proveedor(provs, elegido); if (!p) return null;
    for (var i = 0; i < p.modelos.length; i++) if (p.modelos[i].id === elegido.modelo) return p.modelos[i];
    for (var j = 0; j < p.modelos.length; j++) if (p.modelos[j].porDefecto) return p.modelos[j];
    return p.modelos[0] || null;
  }
  // Los selects llevan id pre + "-prov" y pre + "-modelo": la pantalla escucha su change y guarda lo elegido.
  function selector(provs, elegido, pre, deshabilitado) {
    var pr = proveedor(provs, elegido), mo = modelo(provs, elegido), dis = deshabilitado ? " disabled" : "";
    if (!pr) return "";
    return '<div class="es-agsel"><label>' + L("Provider", "Proveedor") + '<select id="' + pre + '-prov"' + dis + ">" + provs.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pr.id ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Model", "Modelo") + '<select id="' + pre + '-modelo"' + dis + ">" + pr.modelos.map(function (m) { return '<option value="' + esc(m.id) + '"' + (mo && m.id === mo.id ? " selected" : "") + ">" + esc(m.nombre) + (m.porDefecto ? L(" (default)", " (por defecto)") : "") + "</option>"; }).join("") + "</select></label></div>";
  }
  // o: { unidad: [en uno, en varios, es uno, es varios], cuantos(t): cuántos lleva la tanda, pidiendo(n, repos): el título
  // mientras corre, reindexando: el título mientras actualiza el índice, extraTanda(t): lo propio de cada tanda,
  // resumen(ts): lo que volvió (sin el punto final) }.
  function htmlTanda(t, o) {
    var e = estado(t.estado), pasos = (t.pasos || []).slice(-2);
    return '<li class="es-tanda"><div class="es-cab"><span>' + (t.tanda.de > 1 ? L("Batch " + t.tanda.n + " of " + t.tanda.de, "Tanda " + t.tanda.n + " de " + t.tanda.de) : L("One batch", "Una tanda")) + " · " + pl(o.cuantos(t), o.unidad) + '</span><span class="fd-es ' + e[1] + '">' + e[0] + "</span></div>" +
      (vivo(t) && pasos.length ? '<ul class="es-pasos">' + pasos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (t.estado === "en_cola" ? "<small>" + (o.espera || L("Waits for the previous batch of this repo to finish.", "Espera a que termine la tanda anterior de este repo.")) + "</small>" : "") +
      (t.error ? '<p class="fd-msg error">' + esc(t.error) + "</p>" : "") + (o.extraTanda ? o.extraTanda(t) : "") + "</li>";
  }
  function html(LT, ts, o) {
    var v = LT.estado !== "terminado" || ts.some(vivo), hechas = ts.filter(function (t) { return !vivo(t); }).length;
    var porRepo = {}, repos = []; ts.forEach(function (t) { if (!porRepo[t.repo]) { porRepo[t.repo] = []; repos.push(t.repo); } porRepo[t.repo].push(t); });
    var cuerpo = repos.map(function (r) { return '<div class="es-repo"><h4>' + esc(r) + "</h4><ul>" + porRepo[r].map(function (t) { return htmlTanda(t, o); }).join("") + "</ul></div>"; }).join("");
    var n = ts.reduce(function (s, t) { return s + o.cuantos(t); }, 0);
    var costo = ts.reduce(function (s, t) { return s + (t.costoUsd || 0); }, 0);
    var fallaron = ts.filter(function (t) { return t.estado === "fallo"; }).length, cancelaron = ts.filter(function (t) { return t.estado === "cancelado"; }).length;
    var cab = v ? (LT.estado === "reindexando" ? o.reindexando : o.pidiendo(n, repos.length)) : L("Finished", "Terminó");
    var fin = !v
      ? '<div class="es-fin"><b>' + L("Actual cost: ", "Costo real: ") + dolares(costo) + "</b><span>" + o.resumen(ts) +
        (fallaron ? " · " + pl(fallaron, ["batch failed", "batches failed", "tanda falló", "tandas fallaron"]) : "") + (cancelaron ? " · " + pl(cancelaron, ["batch canceled", "batches canceled", "tanda cancelada", "tandas canceladas"]) : "") + ".</span>" +
        (LT.error ? '<p class="fd-msg error">' + esc(LT.error) + "</p>" : "") + "</div>"
      : '<div class="es-fin"><span>' + L("Cost so far: ", "Costo hasta ahora: ") + dolares(costo) + "</span></div>";
    return '<section class="es-lote"><div class="es-cab"><h3>' + cab + '</h3><span class="fd-es ' + (v ? "na" : fallaron ? "no" : "ok") + '">' + L(hechas + " of " + ts.length + " batches", hechas + " de " + ts.length + " tandas") + "</span></div>" +
      '<progress max="' + Math.max(1, ts.length) + '" value="' + hechas + '"></progress>' + cuerpo + fin +
      '<div class="fd-acc">' + (v ? '<button type="button" class="boton" data-acc="cancelar-lote" data-k="' + esc(LT.id) + '">' + L("Cancel all", "Cancelar todo") + "</button>" : '<button type="button" class="boton" data-acc="recargar">' + L("Reload to see the changes", "Recargar para ver los cambios") + '</button><button type="button" class="boton" data-acc="cerrar-lote" data-k="' + esc(LT.id) + '">' + L("Close the summary", "Cerrar el resumen") + "</button>") + "</div></section>";
  }
  // ---------- La lista y el panel lateral ----------
  // o: { k, et: lo que dice sin sumar, ya: si ya está todo en la lista, textoYa, titulo, tituloYa }. Tocarlo suma lo que
  // falta o, si ya estaba todo, lo saca: la pantalla decide qué entra con su data-k.
  function botonSumar(o) {
    return '<button type="button" class="boton es-pedir' + (o.ya ? " en-lista" : "") + '" data-acc="sumar" data-k="' + esc(o.k) + '" data-et="' + esc(o.et) + '" aria-pressed="' + !!o.ya + '" title="' + esc(o.ya ? o.tituloYa : o.titulo) + '">' + esc(o.ya ? o.textoYa : o.et) + "</button>";
  }
  // Cambia los botones «sumar» ya pintados (sin repintar la lista, así no se cierra lo que se estaba mirando).
  // ya(k): si lo de ese botón ya está todo en la lista (null: no se toca).
  function marcarBotones(raiz, ya, o) {
    if (!raiz || !raiz.querySelectorAll) return false;
    var bs = raiz.querySelectorAll('[data-acc="sumar"]');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], y = ya(b.getAttribute("data-k"));
      if (y === null) continue;
      b.setAttribute("aria-pressed", String(y));
      b.setAttribute("title", y ? o.tituloYa : o.titulo);
      if (b.classList) { if (y) b.classList.add("en-lista"); else b.classList.remove("en-lista"); }
      b.textContent = y ? o.textoYa : (b.getAttribute("data-et") || "");
    }
    return true;
  }
  function bandeja(titulo, n, extra, abierto) {
    return '<button type="button" class="boton es-pedir" data-acc="panel" aria-expanded="' + !!abierto + '">' + titulo + (n ? " (" + num(n) + ")" : "") + (extra ? " · " + extra : "") + "</button>";
  }
  function aside(id, abierto, etiqueta, contenido) {
    return '<aside id="' + id + '" class="es-panel' + (abierto ? " abierto" : "") + '" aria-label="' + etiqueta + '">' + contenido + "</aside>";
  }
  var boton = function (b, pri) { return '<button type="button" class="boton' + (pri ? " pri" : "") + '" data-acc="' + b[0] + '"' + (b[2] ? " disabled" : "") + ">" + b[1] + "</button>"; };
  // o: { titulo, selector (proveedor y modelo, o la nota de por qué no se manda), totales (html), principal: [acc, texto,
  // deshabilitado], botones: [[acc, texto, deshabilitado]], vaciar: deshabilitado, error, nota, antes (html bajo los
  // botones), lote (html), filas: [{ html, k, bloqueado }], vacio (por qué no hay nada y cómo se suma), despues (html) }.
  function panel(o) {
    var filas = o.filas.length
      ? '<ul class="es-pedidos">' + o.filas.map(function (f) {
        return '<li class="es-pedido"><div>' + f.html + '</div><button type="button" class="boton chico" data-acc="quitar" data-k="' + esc(f.k) + '" aria-label="' + L("Remove from the list", "Quitar de la lista") + '"' + (f.bloqueado ? " disabled" : "") + ">" + L("Remove", "Quitar") + "</button></li>";
      }).join("") + "</ul>"
      : '<p class="fd-nota">' + o.vacio + "</p>";
    var botones = '<div class="fd-acc">' + (o.principal ? boton(o.principal, true) : "") + (o.botones || []).map(function (b) { return boton(b, false); }).join("") +
      boton(["vaciar", L("Empty the list", "Vaciar la lista"), o.vaciar], false) + "</div>";
    return '<div class="es-panel-cab"><h2>' + o.titulo + '</h2><button type="button" class="boton chico" data-acc="cerrar-panel" aria-label="' + L("Close the panel", "Cerrar el panel") + '">✕</button></div>' +
      (o.selector || "") + (o.totales || "") + botones +
      (o.error ? '<p class="fd-msg error">' + esc(o.error) + "</p>" : o.nota ? '<p class="fd-nota">' + esc(o.nota) + "</p>" : "") + (o.antes || "") + (o.lote || "") + filas + (o.despues || "");
  }
  // Repinta el panel guardando dónde estaba el scroll, y deja lugar a la derecha de la página mientras está abierto.
  function pintarPanel(el, raiz, abierto, contenido) {
    if (!el) return;
    var antes = typeof el.scrollTop === "number" ? el.scrollTop : 0;
    el.innerHTML = contenido;
    el.className = "es-panel" + (abierto ? " abierto" : "");
    if (typeof el.scrollTop === "number") el.scrollTop = antes;
    if (raiz && raiz.classList) { if (abierto) raiz.classList.add("es-con-panel"); else raiz.classList.remove("es-con-panel"); }
  }
  window.brainLote = { vivo: vivo, estado: estado, dolares: dolares, tandas: tandas, loteVivo: loteVivo, proveedor: proveedor, modelo: modelo, selector: selector, html: html,
    botonSumar: botonSumar, marcarBotones: marcarBotones, bandeja: bandeja, aside: aside, panel: panel, pintarPanel: pintarPanel };
})();
`;

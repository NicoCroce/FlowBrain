/**
 * El pedido al agente: UN componente para todo el visor (dec. 229). Pone `window.brainPedido`.
 *
 * Hay una sola lista de pedidos, guardada en una sola clave de este navegador (`flowbrain.pedido`, localStorage), que
 * sigue viva al cambiar de pantalla. Cada ítem es `{ tipo, k, cerebro, repo, datos }`: el tipo (`test`, `asociar` y
 * los que vengan), su clave dentro del tipo, el cerebro y repo, y lo que su tarjeta muestra (`datos`, lo arma la
 * pantalla). Lo de antes (`flowbrain.especificaciones.pedidos`, `flowbrain.sinasociar.pedidos` y sus claves de panel,
 * modelo y lotes) se pasa a la clave nueva la primera vez, para no perder nada.
 *
 * Cada pantalla REGISTRA su tipo con `registrar(tipo, def)` y pone su botón con `boton(...)`; el componente hace todo lo
 * demás: el botón celeste «Pedir» / «✔ En el pedido», la bandeja con el contador en la barra superior (`#pedido-bandeja`,
 * visible desde cualquier pantalla), el panel lateral (`#pedido-panel`) con Proveedor y Modelo, el resumen agrupado
 * por tipo con el costo total estimado, «Pedir todos» (un lote por tipo, `/api/agente/lote`), «Descargar .md»,
 * «Vaciar la lista», «Quitar» por tarjeta y el seguimiento de las tandas (avance, «Cancelar todo», resumen). También
 * consulta el estado del agente (`/api/agente`) para todo el visor: las pantallas escuchan con `escuchar`.
 *
 * `def` (lo que cada tipo pone; lo marcado con ? es opcional):
 * - `nombre`: título del grupo en el panel (getter, en el idioma de ese momento); `unidad`: [en uno, en varios, es uno,
 *   es varios] («rule», «rules», «regla», «reglas»);
 * - `raiz`: el elemento de la pantalla con sus botones `pedir`; `claves(k)`: las claves de ítem que suma el botón `k`;
 *   `items(k)`: esos ítems armados (`claves(k, memo)`: memo dura una pasada sobre los botones); `repintar?()`: si los botones no se pueden marcar sin repintar;
 * - `tarjeta(item, enTanda)`: el HTML de la tarjeta; `orden?(a, b)`; `resumen?(items)`: textos bajo el total del tipo;
 *   `notas?(items)`: avisos del tipo; `costo(modelo)`: US$ por ítem estimado, o null si ese modelo no tiene estimación;
 * - `lote(items)`: el cuerpo de `/api/agente/lote` sin proveedor ni modelo (`{ tipo, reglas }` o `{ tipo, archivos }`);
 *   `md`: `{ archivo, texto(items) }`, el .md para cualquier agente (en inglés);
 * - el seguimiento: `clave?(item)` (con qué se reconoce el ítem en una tanda; por defecto `k`), `enTanda(t)` y
 *   `hechos(t)` (las claves que la tanda lleva y las que resolvió: salen de la lista), y `seguimiento` (lo que dice el
 *   lote: `cuantos(t)`, `pidiendo(n, repos)`, `reindexando`, `espera?`, `extraTanda?(t)`, `resumen(ts)`);
 * - `despues?()`: lo que va al final del panel (los resultados de los tests); `bandeja?()`: lo que suma la bandeja
 *   («2 para decidir»); `accion?(acc, k, boton)`: los botones propios dentro del panel (true si lo atendió).
 *
 * Lo que va al modelo, solo en inglés (dec. 214). JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const PEDIDO_JS = String.raw`
(function () {
  "use strict";
  var esc = function (s) { return window.brainVisor.esc(s); };
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
  var pl = function (n, u) { return L(plural(n, u[0], u[1]), plural(n, u[2], u[3])); };
  var elem = function (id) { return typeof document !== "undefined" && document.getElementById ? document.getElementById(id) : null; };
  var ED = window.FLOWBRAIN_EDICION || null;
  // Con el visor servido y un agente instalado, el lote se manda directo; si no, el .md es el camino.
  var AG = !!(ED && ED.agente && !ED.agente.noDisponible);
  var PROVS = AG && ED.agente.proveedores ? ED.agente.proveedores : [];
  // El servidor acepta hasta 3000 ítems por lote.
  var TOPE = 3000;

  // ---------- Lo que se guarda: una sola clave ----------
  var CLAVE = "flowbrain.pedido";
  var leer = function (k) { try { if (typeof localStorage !== "undefined") { var v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } } catch (e) { /* sin almacenamiento */ } return null; };
  var borrar = function (k) { try { if (typeof localStorage !== "undefined" && localStorage.removeItem) localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } };
  var valido = function (x) { return x && typeof x.tipo === "string" && typeof x.k === "string" && x.datos && typeof x.datos === "object"; };
  // E: { items, panel (abierto), elegido: { proveedor, modelo }, limpios: tandas cuyo resultado ya limpió la lista, ocultos: lotes con el resumen cerrado }.
  var E = leer(CLAVE);
  if (!E || typeof E !== "object") E = migrar();
  E = {
    items: Array.isArray(E.items) ? E.items.filter(valido) : [],
    panel: E.panel === true,
    elegido: E.elegido && typeof E.elegido === "object" ? { proveedor: String(E.elegido.proveedor || ""), modelo: String(E.elegido.modelo || "") } : { proveedor: "", modelo: "" },
    limpios: Array.isArray(E.limpios) ? E.limpios : [],
    ocultos: Array.isArray(E.ocultos) ? E.ocultos : []
  };
  if (!E.items.length) E.panel = false;
  // Las listas de antes (una por pantalla) pasan a la clave nueva, con su tipo; las claves viejas se borran.
  function migrar() {
    var out = { items: [], panel: false, elegido: null, limpios: [], ocultos: [] };
    var viejas = [["flowbrain.especificaciones.pedidos", "test"], ["flowbrain.sinasociar.pedidos", "asociar"]];
    viejas.forEach(function (v) {
      var xs = leer(v[0]);
      if (Array.isArray(xs)) xs.forEach(function (x) {
        if (!x || typeof x.k !== "string" || typeof x.linea !== "string") return;
        var repo = v[1] === "asociar" ? String(x.archivo || "").split(":")[0] : x.repo || null;
        out.items.push({ tipo: v[1], k: x.k, cerebro: x.cerebro || "", repo: repo, datos: x });
      });
    });
    out.panel = out.items.length > 0 && (leer("flowbrain.especificaciones.panel") === true || leer("flowbrain.sinasociar.panel") === true);
    var el = leer("flowbrain.especificaciones.agente") || leer("flowbrain.sinasociar.modelo");
    if (el && typeof el === "object") out.elegido = el;
    var ve = leer("flowbrain.especificaciones.lotes");
    if (Array.isArray(ve)) ve.forEach(function (x) { if (typeof x === "string" && x.indexOf("oculto:") === 0) out.ocultos.push(x.slice(7)); });
    var vs = leer("flowbrain.sinasociar.lotes");
    if (Array.isArray(vs)) vs.forEach(function (x) { if (typeof x === "string") out.ocultos.push(x); });
    ["flowbrain.especificaciones.pedidos", "flowbrain.especificaciones.panel", "flowbrain.especificaciones.agente", "flowbrain.especificaciones.lotes",
      "flowbrain.sinasociar.pedidos", "flowbrain.sinasociar.panel", "flowbrain.sinasociar.modelo", "flowbrain.sinasociar.lotes"].forEach(borrar);
    E = out; guardar();
    return out;
  }
  function guardar() {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(CLAVE, JSON.stringify({ v: 1, items: E.items, panel: E.panel, elegido: E.elegido, limpios: E.limpios.slice(-400), ocultos: E.ocultos.slice(-60) })); } catch (e) { /* sin almacenamiento */ }
  }
  // Índice tipo|k → ítem, para saber de un vistazo si algo ya está en la lista.
  var INDICE = {};
  var indexar = function () { INDICE = {}; E.items.forEach(function (x) { INDICE[x.tipo + "|" + x.k] = x; }); };
  indexar();

  // ---------- Los tipos ----------
  var TIPOS = {}, ORDEN = [];
  var def = function (tipo) { return TIPOS[tipo] || null; };
  var itemsDe = function (tipo) {
    var xs = E.items.filter(function (x) { return x.tipo === tipo; }), d = def(tipo);
    return d && d.orden ? xs.slice().sort(d.orden) : xs;
  };
  // Los tipos con algo en la lista: los registrados en su orden y, al final, los de una pantalla que este visor no tiene.
  function tiposEnLista() {
    var out = ORDEN.filter(function (t) { return INDICE_TIPO()[t]; });
    Object.keys(INDICE_TIPO()).forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });
    return out;
  }
  function INDICE_TIPO() { var m = {}; E.items.forEach(function (x) { m[x.tipo] = true; }); return m; }
  var unidadDe = function (tipo) { var d = def(tipo); return d && d.unidad ? d.unidad : ["item", "items", "ítem", "ítems"]; };
  var nombreDe = function (tipo) { var d = def(tipo); return d && d.nombre ? d.nombre : tipo; };

  // ---------- El agente: proveedor, modelo y lo que está corriendo ----------
  var TRABAJOS = [], LOTES = [], ESPERA = null, OYENTES = [], PIDIENDO = false, ERROR = "", NOTA = "";
  var vivo = function (t) { return t.estado === "en_cola" || t.estado === "corriendo"; };
  var estado = function (e) {
    var T = { en_cola: [L("Queued", "En cola"), "na"], corriendo: [L("Working…", "Trabajando…"), "na"], terminado: [L("Finished", "Terminó"), "ok"], fallo: [L("Failed", "Falló"), "no"], cancelado: [L("Canceled", "Cancelado"), "na"] };
    return T[e] || [e, "na"];
  };
  var dolares = function (n) { return "US$ " + (n < 0.1 ? n.toFixed(3) : n.toFixed(2)); };
  var tandas = function (LT) { return TRABAJOS.filter(function (t) { return t.lote === LT.id; }).sort(function (a, b) { return a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.tanda.n - b.tanda.n; }); };
  var loteVivo = function (LT) { return !!LT && (LT.estado !== "terminado" || tandas(LT).some(vivo)); };
  var tipoDeLote = function (LT) { return LT.tipo || "test"; };
  // El lote que se ve de cada tipo: el más nuevo, hasta que se cierra su resumen.
  function loteDe(tipo) {
    for (var i = 0; i < LOTES.length; i++) if (tipoDeLote(LOTES[i]) === tipo && E.ocultos.indexOf(LOTES[i].id) < 0) return LOTES[i];
    return null;
  }
  var lotesVisibles = function () { var out = []; ORDEN.concat(Object.keys(TIPOS_DE_LOTES())).forEach(function (t) { var LT = loteDe(t); if (LT && out.indexOf(LT) < 0) out.push(LT); }); return out; };
  function TIPOS_DE_LOTES() { var m = {}; LOTES.forEach(function (LT) { m[tipoDeLote(LT)] = true; }); return m; }
  function proveedor() {
    for (var i = 0; i < PROVS.length; i++) if (PROVS[i].id === E.elegido.proveedor) return PROVS[i];
    return PROVS[0] || null;
  }
  function modelo() {
    var p = proveedor(); if (!p) return null;
    for (var i = 0; i < p.modelos.length; i++) if (p.modelos[i].id === E.elegido.modelo) return p.modelos[i];
    for (var j = 0; j < p.modelos.length; j++) if (p.modelos[j].porDefecto) return p.modelos[j];
    return p.modelos[0] || null;
  }
  function elegir(prov, mod) {
    if (prov !== undefined && prov !== null && prov !== (proveedor() ? proveedor().id : "")) E.elegido = { proveedor: String(prov), modelo: "" };
    else E.elegido.proveedor = proveedor() ? proveedor().id : "";
    if (mod !== undefined && mod !== null) E.elegido.modelo = String(mod);
    guardar(); avisar("elegido"); pintar();
  }
  // Los selects llevan id pre + "-prov" y pre + "-modelo": el del panel lo atiende el componente; los de las pantallas
  // (pedidos sueltos) llaman a elegir.
  function selector(pre, deshabilitado) {
    var pr = proveedor(), mo = modelo(), dis = deshabilitado ? " disabled" : "";
    if (!pr) return "";
    return '<div class="es-agsel"><label>' + L("Provider", "Proveedor") + '<select id="' + pre + '-prov"' + dis + ">" + PROVS.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pr.id ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Model", "Modelo") + '<select id="' + pre + '-modelo"' + dis + ">" + pr.modelos.map(function (m) { return '<option value="' + esc(m.id) + '"' + (mo && m.id === mo.id ? " selected" : "") + ">" + esc(m.nombre) + (m.porDefecto ? L(" (default)", " (por defecto)") : "") + "</option>"; }).join("") + "</select></label></div>";
  }
  function llamar(ruta, cuerpo) {
    return fetch(ruta, cuerpo ? { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) } : { method: "GET", headers: { "x-flowbrain-token": ED.token } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); });
  }
  var avisar = function (ev) { OYENTES.forEach(function (f) { try { f(ev); } catch (e) { /* una pantalla no frena a las otras */ } }); };
  // El estado del agente, para todo el visor: cada 2 s mientras algo corre.
  function actualizar() {
    if (!AG) return;
    if (ESPERA) { clearTimeout(ESPERA); ESPERA = null; }
    var p;
    try { p = llamar("/api/agente"); } catch (e) { return; }
    p.then(function (j) {
      TRABAJOS = j.trabajos || []; LOTES = j.lotes || [];
      limpiar();
      avisar("trabajos"); pintar();
      if (TRABAJOS.some(vivo) || LOTES.some(loteVivo)) ESPERA = setTimeout(actualizar, 2000);
    }).catch(function () { ESPERA = setTimeout(actualizar, 5000); });
  }
  // Lo que una tanda ya resolvió sale de la lista, una sola vez por tanda: lo que no volvió queda para reintentar.
  function limpiar() {
    var antes = E.items.length, cambio = false;
    TRABAJOS.forEach(function (t) {
      if (!t.lote || vivo(t) || E.limpios.indexOf(t.id) >= 0) return;
      var LT = null; LOTES.forEach(function (l) { if (l.id === t.lote) LT = l; });
      var d = LT ? def(tipoDeLote(LT)) : null;
      if (!d) return;
      E.limpios.push(t.id); cambio = true;
      var hechos = {}; (d.hechos ? d.hechos(t) : []).forEach(function (c) { hechos[c] = true; });
      E.items = E.items.filter(function (x) { return x.tipo !== tipoDeLote(LT) || !hechos[claveDe(x)]; });
    });
    if (E.items.length !== antes) { indexar(); avisar("lista"); marcar(); }
    if (cambio) guardar();
  }
  var claveDe = function (x) { var d = def(x.tipo); return d && d.clave ? d.clave(x) : x.k; };
  function enTandas() {
    var m = {};
    lotesVisibles().forEach(function (LT) {
      if (!loteVivo(LT)) return;
      var d = def(tipoDeLote(LT));
      if (d && d.enTanda) tandas(LT).forEach(function (t) { if (vivo(t)) d.enTanda(t).forEach(function (c) { m[tipoDeLote(LT) + "|" + c] = true; }); });
    });
    return m;
  }

  // ---------- La lista ----------
  var esta = function (tipo, k) { return !!INDICE[tipo + "|" + k]; };
  // Si el botón k ya está todo en la lista (null: el botón no suma nada). ks: sus claves, si la pantalla ya las tiene;
  // memo: un objeto que dura una pasada de marcar, para que la pantalla no recalcule lo mismo en cada botón.
  function ya(tipo, k, ks, memo) {
    var d = def(tipo);
    if (!ks) { if (!d || !d.claves) return null; ks = d.claves(k, memo || {}); }
    return ks.length ? ks.every(function (c) { return esta(tipo, c); }) : null;
  }
  // Tocar un botón: si ya estaba todo, lo saca; si no, suma lo que falta y abre el panel.
  function sumar(tipo, k) {
    var d = def(tipo); if (!d) return;
    var xs = d.items(k).filter(valido);
    if (!xs.length) return;
    if (xs.every(function (x) { return esta(tipo, x.k); })) {
      var fuera = {}; xs.forEach(function (x) { fuera[x.k] = true; });
      E.items = E.items.filter(function (x) { return x.tipo !== tipo || !fuera[x.k]; });
    } else {
      xs.forEach(function (x) { if (!esta(tipo, x.k)) { E.items.push(x); INDICE[tipo + "|" + x.k] = x; } });
      E.panel = true;
    }
    ERROR = "";
    cambio();
  }
  function quitar(tipo, k) { E.items = E.items.filter(function (x) { return x.tipo !== tipo || x.k !== k; }); cambio(); }
  function vaciar() { var vivos = enTandas(); E.items = E.items.filter(function (x) { return vivos[x.tipo + "|" + claveDe(x)]; }); cambio(); }
  // Pone al día (o saca, si fn devuelve null) los ítems de un tipo: lo que ya no está pendiente en la pantalla.
  function podar(tipo, fn) {
    var antes = E.items.length, out = [];
    E.items.forEach(function (x) { if (x.tipo !== tipo) { out.push(x); return; } var y = fn(x); if (valido(y)) out.push(y); });
    E.items = out;
    if (out.length !== antes) { if (!out.length) E.panel = false; cambio(); } else { indexar(); guardar(); }
  }
  function cambio() { indexar(); guardar(); avisar("lista"); marcar(); pintar(); }

  // ---------- El botón celeste ----------
  var TEXTOS = {
    get ya() { return L("✔ In the request", "✔ En el pedido"); },
    get titulo() { return L("Adds it to the request to the agent: nothing is sent until «Request all», in the panel", "Lo suma al pedido al agente: no se manda nada hasta «Pedir todos», en el panel"); },
    get tituloYa() { return L("Click to remove it from the request", "Tocalo para sacarlo del pedido"); }
  };
  // o: { tipo, k, et: lo que dice sin sumar, claves?: las claves de ítem que suma (si no, def.claves(k)) }. La
  // pantalla atiende data-acc="pedir" con sumar(tipo, k).
  function boton(o) {
    var y = ya(o.tipo, o.k, o.claves) === true;
    return '<button type="button" class="boton es-pedir' + (y ? " en-lista" : "") + '" data-acc="pedir" data-tipo="' + esc(o.tipo) + '" data-k="' + esc(o.k) + '" data-et="' + esc(o.et) + '" aria-pressed="' + y + '" title="' + esc(y ? TEXTOS.tituloYa : TEXTOS.titulo) + '">' + esc(y ? TEXTOS.ya : o.et) + "</button>";
  }
  // Cambia los botones ya pintados sin repintar la pantalla (así no se cierra lo que se estaba mirando).
  function marcar() {
    ORDEN.forEach(function (tipo) {
      var d = def(tipo), raiz = d.raiz;
      if (!raiz || !raiz.querySelectorAll) { if (d.repintar) d.repintar(); return; }
      var bs = raiz.querySelectorAll('[data-acc="pedir"]'), memo = {};
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i];
        if (b.getAttribute("data-tipo") !== tipo) continue;
        var y = ya(tipo, b.getAttribute("data-k"), null, memo);
        if (y === null) continue;
        b.setAttribute("aria-pressed", String(y));
        b.setAttribute("title", y ? TEXTOS.tituloYa : TEXTOS.titulo);
        if (b.classList) { if (y) b.classList.add("en-lista"); else b.classList.remove("en-lista"); }
        b.textContent = y ? TEXTOS.ya : (b.getAttribute("data-et") || "");
      }
    });
  }

  // ---------- El seguimiento de un lote ----------
  function htmlTanda(t, o, u) {
    var e = estado(t.estado), pasos = (t.pasos || []).slice(-2);
    return '<li class="es-tanda"><div class="es-cab"><span>' + (t.tanda.de > 1 ? L("Batch " + t.tanda.n + " of " + t.tanda.de, "Tanda " + t.tanda.n + " de " + t.tanda.de) : L("One batch", "Una tanda")) + " · " + pl(o.cuantos(t), u) + '</span><span class="fd-es ' + e[1] + '">' + e[0] + "</span></div>" +
      (vivo(t) && pasos.length ? '<ul class="es-pasos">' + pasos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (t.estado === "en_cola" ? "<small>" + (o.espera || L("Waits for the previous batch of this repo to finish.", "Espera a que termine la tanda anterior de este repo.")) + "</small>" : "") +
      (t.error ? '<p class="fd-msg error">' + esc(t.error) + "</p>" : "") + (o.extraTanda ? o.extraTanda(t) : "") + "</li>";
  }
  function htmlLote(LT) {
    var d = def(tipoDeLote(LT)); if (!d || !d.seguimiento) return "";
    var o = d.seguimiento, u = unidadDe(tipoDeLote(LT)), ts = tandas(LT);
    var v = LT.estado !== "terminado" || ts.some(vivo), hechas = ts.filter(function (t) { return !vivo(t); }).length;
    var porRepo = {}, repos = []; ts.forEach(function (t) { if (!porRepo[t.repo]) { porRepo[t.repo] = []; repos.push(t.repo); } porRepo[t.repo].push(t); });
    var cuerpo = repos.map(function (r) { return '<div class="es-repo"><h4>' + esc(r) + "</h4><ul>" + porRepo[r].map(function (t) { return htmlTanda(t, o, u); }).join("") + "</ul></div>"; }).join("");
    var n = ts.reduce(function (s, t) { return s + o.cuantos(t); }, 0);
    var costo = ts.reduce(function (s, t) { return s + (t.costoUsd || 0); }, 0);
    var fallaron = ts.filter(function (t) { return t.estado === "fallo"; }).length, cancelaron = ts.filter(function (t) { return t.estado === "cancelado"; }).length;
    var cab = v ? (LT.estado === "reindexando" ? o.reindexando : o.pidiendo(n, repos.length)) : L("Finished", "Terminó") + " · " + esc(nombreDe(tipoDeLote(LT)));
    var fin = !v
      ? '<div class="es-fin"><b>' + L("Actual cost: ", "Costo real: ") + dolares(costo) + "</b><span>" + o.resumen(ts) +
        (fallaron ? " · " + pl(fallaron, ["batch failed", "batches failed", "tanda falló", "tandas fallaron"]) : "") + (cancelaron ? " · " + pl(cancelaron, ["batch canceled", "batches canceled", "tanda cancelada", "tandas canceladas"]) : "") + ".</span>" +
        (LT.error ? '<p class="fd-msg error">' + esc(LT.error) + "</p>" : "") + "</div>"
      : '<div class="es-fin"><span>' + L("Cost so far: ", "Costo hasta ahora: ") + dolares(costo) + "</span></div>";
    return '<section class="es-lote" data-tipo="' + esc(tipoDeLote(LT)) + '"><div class="es-cab"><h3>' + cab + '</h3><span class="fd-es ' + (v ? "na" : fallaron ? "no" : "ok") + '">' + L(hechas + " of " + ts.length + " batches", hechas + " de " + ts.length + " tandas") + "</span></div>" +
      '<progress max="' + Math.max(1, ts.length) + '" value="' + hechas + '"></progress>' + cuerpo + fin +
      '<div class="fd-acc">' + (v ? '<button type="button" class="boton" data-acc="cancelar-lote" data-k="' + esc(LT.id) + '">' + L("Cancel all", "Cancelar todo") + "</button>" : '<button type="button" class="boton" data-acc="recargar">' + L("Reload to see the changes", "Recargar para ver los cambios") + '</button><button type="button" class="boton" data-acc="cerrar-lote" data-k="' + esc(LT.id) + '">' + L("Close the summary", "Cerrar el resumen") + "</button>") + "</div></section>";
  }

  // ---------- Pedir todos: un lote por tipo ----------
  // Lo que se puede mandar ahora: los tipos sin un lote en curso, hasta TOPE cada uno.
  function mandables() {
    return tiposEnLista().filter(function (t) { var d = def(t); return d && d.lote && !loteVivo(loteDe(t)); })
      .map(function (t) { return { tipo: t, items: itemsDe(t).slice(0, TOPE) }; });
  }
  function pedirTodos() {
    var ms = mandables(), pr = proveedor(), mo = modelo();
    if (!ms.length || !AG || !pr || PIDIENDO) return;
    PIDIENDO = true; ERROR = ""; pintar();
    var errores = [], cadena = Promise.resolve();
    // De a uno: si el servidor rechaza un tipo, los otros igual salen.
    ms.forEach(function (m) {
      cadena = cadena.then(function () {
        var cuerpo = def(m.tipo).lote(m.items);
        cuerpo.proveedor = pr.id; if (mo) cuerpo.modelo = mo.id;
        return llamar("/api/agente/lote", cuerpo).then(function (j) {
          if (j && j.lote) {
            E.ocultos = E.ocultos.filter(function (id) { return id !== j.lote.id; });
            LOTES = [j.lote].concat(LOTES.filter(function (l) { return l.id !== j.lote.id; }));
            TRABAJOS = (j.trabajos || []).concat(TRABAJOS);
          }
        }, function (e) { errores.push(nombreDe(m.tipo) + ": " + e.message); });
      });
    });
    cadena.then(function () {
      PIDIENDO = false;
      if (errores.length) ERROR = L("It could not be sent: ", "No se pudo mandar: ") + errores.join(" · ");
      pintar(); actualizar();
    });
  }
  // El .md: lo de cada tipo, uno detrás del otro, para cualquier agente con acceso a los repos.
  function md() {
    var ts = tiposEnLista().filter(function (t) { var d = def(t); return d && d.md; });
    if (!ts.length) return null;
    if (ts.length === 1) return { archivo: def(ts[0]).md.archivo, texto: def(ts[0]).md.texto(itemsDe(ts[0])) };
    return { archivo: "flowbrain-request.md", texto: ts.map(function (t) { return def(t).md.texto(itemsDe(t)); }).join("\n---\n\n") };
  }
  // Baja un archivo de texto con el documento de la página: true si el navegador lo dejó.
  function descargar(archivo, texto) {
    try {
      var blob = new Blob([texto], { type: "text/markdown;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = archivo; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return true;
    } catch (e) { return false; }
  }

  // ---------- El panel y la bandeja ----------
  var botonP = function (b, pri) { return '<button type="button" class="boton' + (pri ? " pri" : "") + '" data-acc="' + b[0] + '"' + (b[2] ? " disabled" : "") + ">" + b[1] + "</button>"; };
  function htmlPanel() {
    var ts = tiposEnLista(), pr = proveedor(), mo = modelo(), lotes = lotesVisibles(), corriendo = lotes.some(loteVivo), vivos = enTandas();
    var total = E.items.length, ms = mandables(), aMandar = ms.reduce(function (s, m) { return s + m.items.length; }, 0);
    var sel = AG && pr
      ? selector("pedido", corriendo)
      : '<p class="fd-nota">' + (ED ? L("There's no agent installed on this machine", "No hay ningún agente instalado en esta máquina") + (ED.agente && ED.agente.noDisponible ? ": " + esc(ED.agente.noDisponible) : "") + "." : L("This page is read-only: it can't send the requests.", "Esta página es de solo lectura: no puede mandar los pedidos.")) +
        L(" Download the .md and give it to your agent (with access to the repos, not a web chat).", " Descargá el .md y dáselo a tu agente (con acceso a los repos, no un chat web).") + "</p>";
    // El resumen, agrupado por tipo, con su costo; abajo, el total si hay más de uno.
    var costoTotal = 0, sinEstimar = false;
    var totales = ts.map(function (t) {
      var d = def(t), xs = itemsDe(t), lleva = Math.min(xs.length, TOPE), c = d && d.costo && mo ? d.costo(mo) : null;
      if (typeof c === "number") costoTotal += lleva * c; else sinEstimar = true;
      var costo = AG && mo ? "<span>" + L("Estimated cost: ", "Costo estimado: ") + (typeof c !== "number" ? L("no estimate for this model: the actual cost shows while it runs", "sin estimación para este modelo: el costo real se ve mientras corre") : (lleva ? "≈ " + dolares(lleva * c) : dolares(0)) + " <small>(" + L("approx., with ", "aprox., con ") + esc(mo.nombre) + ")</small>") + "</span>" : "";
      return '<div class="es-totales" data-tipo="' + esc(t) + '"><b>' + pl(xs.length, unidadDe(t)) + "</b>" + (ts.length > 1 ? "<small>" + esc(nombreDe(t)) + "</small>" : "") +
        (d && d.resumen ? d.resumen(xs).filter(Boolean).map(function (s) { return "<span>" + s + "</span>"; }).join("") : "") + costo + "</div>";
    }).join("");
    if (ts.length > 1 && AG && mo) totales += '<div class="es-totales pd-total"><b>' + L("Total: ", "Total: ") + plural(total, L("item", "ítem"), L("items", "ítems")) + "</b><span>" + L("Estimated cost: ", "Costo estimado: ") + "≈ " + dolares(costoTotal) + (sinEstimar ? L(" (plus what has no estimate)", " (más lo que no tiene estimación)") : "") + "</span></div>";
    var notas = [];
    ts.forEach(function (t) { var d = def(t); if (d && d.notas) notas = notas.concat(d.notas(itemsDe(t))); });
    ts.forEach(function (t) { if (AG && itemsDe(t).length > TOPE) notas.push(L("A request carries up to " + num(TOPE) + " per type: it takes the first " + num(TOPE) + " of " + num(itemsDe(t).length) + " " + esc(nombreDe(t)) + "; request the rest when it finishes. The .md carries them all.", "Un pedido lleva hasta " + num(TOPE) + " por tipo: lleva los primeros " + num(TOPE) + " de " + num(itemsDe(t).length) + " (" + esc(nombreDe(t)) + "); el resto se pide cuando termine. El .md los lleva todos.")); });
    if (corriendo) notas.push(L("A batch is running: what it carries stays locked until it finishes; you can cancel it below.", "Hay un lote en curso: lo que lleva queda bloqueado hasta que termine; podés cancelarlo abajo."));
    var botones = '<div class="fd-acc">' + botonP(["pedir-todos", PIDIENDO ? L("Sending…", "Mandando…") : L("Request all", "Pedir todos") + (aMandar ? " (" + num(aMandar) + ")" : ""), !AG || !aMandar || PIDIENDO], true) +
      botonP(["descargar-lista", L("Download .md", "Descargar .md"), !total], false) + botonP(["vaciar", L("Empty the list", "Vaciar la lista"), !E.items.some(function (x) { return !vivos[x.tipo + "|" + claveDe(x)]; })], false) + "</div>";
    var grupos = ts.length
      ? ts.map(function (t) {
        var d = def(t), xs = itemsDe(t);
        return '<section class="pd-grupo" data-tipo="' + esc(t) + '">' + (ts.length > 1 ? '<h3>' + esc(nombreDe(t)) + ' <span class="chip">' + num(xs.length) + "</span></h3>" : "") + '<ul class="es-pedidos">' + xs.map(function (x) {
          var bloq = !!vivos[t + "|" + claveDe(x)];
          return '<li class="es-pedido"><div>' + (d && d.tarjeta ? d.tarjeta(x, bloq) : "<code>" + esc(x.k) + "</code>") + '</div><button type="button" class="boton chico" data-acc="quitar" data-tipo="' + esc(t) + '" data-k="' + esc(x.k) + '" aria-label="' + L("Remove from the list", "Quitar de la lista") + '"' + (bloq ? " disabled" : "") + ">" + L("Remove", "Quitar") + "</button></li>";
        }).join("") + "</ul></section>";
      }).join("")
      : '<p class="fd-nota">' + L("The list is empty. Click «Request» on a rule, a file or a folder, on any screen: it's added here, and only «Request all» sends it.", "La lista está vacía. Tocá «Pedir» en una regla, un archivo o una carpeta, en cualquier pantalla: se suma acá, y recién «Pedir todos» lo manda.") + "</p>";
    var despues = ORDEN.map(function (t) { var d = def(t), h = d.despues ? d.despues() : ""; return h ? '<div class="pd-despues" data-tipo="' + esc(t) + '">' + h + "</div>" : ""; }).join("");
    return '<div class="es-panel-cab"><h2>' + L("Request to the agent", "Pedido al agente") + '</h2><button type="button" class="boton chico" data-acc="cerrar-panel" aria-label="' + L("Close the panel", "Cerrar el panel") + '">✕</button></div>' +
      sel + totales + botones +
      (ERROR ? '<p class="fd-msg error">' + esc(ERROR) + "</p>" : NOTA ? '<p class="fd-nota">' + esc(NOTA) + "</p>" : "") +
      notas.map(function (t) { return '<p class="fd-nota">' + t + "</p>"; }).join("") +
      lotes.map(htmlLote).join("") + grupos + despues;
  }
  function htmlBandeja() {
    var n = E.items.length, extras = [];
    ORDEN.forEach(function (t) { var d = def(t), x = d.bandeja ? d.bandeja() : ""; if (x) extras.push(x); });
    var corriendo = lotesVisibles().some(loteVivo);
    if (!n && !extras.length && !lotesVisibles().length) return "";
    return '<button type="button" class="boton es-pedir' + (corriendo ? " pd-corriendo" : "") + '" data-acc="panel" aria-expanded="' + E.panel + '" aria-controls="pedido-panel">' + L("Request", "Pedido") + (n ? " (" + num(n) + ")" : "") + (corriendo ? " · " + L("running", "corriendo") : "") + (extras.length ? " · " + extras.join(" · ") : "") + "</button>";
  }
  // Repinta el panel (guardando el scroll) y la bandeja, y deja lugar a la derecha de la página mientras está abierto.
  function pintar() {
    var el = elem("pedido-panel");
    if (el) {
      var antes = typeof el.scrollTop === "number" ? el.scrollTop : 0;
      el.innerHTML = htmlPanel();
      el.className = "es-panel" + (E.panel ? " abierto" : "");
      if (typeof el.scrollTop === "number") el.scrollTop = antes;
    }
    var b = elem("pedido-bandeja"); if (b) b.innerHTML = htmlBandeja();
    var body = typeof document !== "undefined" ? document.body : null;
    if (body && body.classList) { if (E.panel) body.classList.add("con-pedido"); else body.classList.remove("con-pedido"); }
    ajustarAlto();
  }
  // El panel arranca debajo de la barra superior, que en pantallas angostas ocupa más de una línea: así no tapa la bandeja.
  function ajustarAlto() {
    var c = elem("cabecera"), raiz = typeof document !== "undefined" ? document.documentElement : null;
    if (c && c.offsetHeight && raiz && raiz.style && raiz.style.setProperty) raiz.style.setProperty("--alto-cabecera", c.offsetHeight + "px");
  }
  function abrir(abierto) { E.panel = abierto; guardar(); pintar(); }

  // ---------- Los botones del panel y de la bandeja ----------
  function accion(b) {
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k");
    if (acc === "panel") { abrir(!E.panel); return; }
    if (acc === "cerrar-panel") { abrir(false); return; }
    if (acc === "quitar") { quitar(b.getAttribute("data-tipo"), k); return; }
    if (acc === "vaciar") { vaciar(); return; }
    if (acc === "pedir-todos") { pedirTodos(); return; }
    if (acc === "descargar-lista") { var m = md(); if (m && !descargar(m.archivo, m.texto)) { ERROR = L("It couldn't be downloaded.", "No se pudo descargar."); pintar(); } return; }
    if (acc === "cancelar-lote") { llamar("/api/agente/lote/cancelar", { id: k }).then(actualizar, actualizar); return; }
    if (acc === "cerrar-lote") { E.ocultos.push(k); guardar(); pintar(); return; }
    if (acc === "recargar") { if (window.location && window.location.reload) window.location.reload(); return; }
    // Lo demás es de un tipo (los resultados de los tests): lo atiende quien lo pintó.
    for (var i = 0; i < ORDEN.length; i++) { var d = def(ORDEN[i]); if (d.accion && d.accion(acc, k, b) === true) return; }
  }
  var alClic = function (ev) { var b = ev.target && ev.target.closest ? ev.target.closest("[data-acc]") : null; if (b && !b.disabled) accion(b); };
  var panelEl = elem("pedido-panel"), bandejaEl = elem("pedido-bandeja");
  if (panelEl && panelEl.addEventListener) {
    panelEl.addEventListener("click", alClic);
    panelEl.addEventListener("change", function (ev) {
      var id = ev.target ? ev.target.id : "";
      if (id === "pedido-prov") elegir(String(ev.target.value || ""), null);
      else if (id === "pedido-modelo") elegir(null, String(ev.target.value || ""));
    });
  }
  if (bandejaEl && bandejaEl.addEventListener) bandejaEl.addEventListener("click", alClic);
  if (window.addEventListener) window.addEventListener("resize", ajustarAlto);
  if (window.brainI18n && window.brainI18n.alCambiar) window.brainI18n.alCambiar(function () { pintar(); });
  // Otra pestaña cambió el pedido: esta lo toma, así las dos muestran la misma lista.
  if (window.addEventListener) window.addEventListener("storage", function (ev) {
    if (ev.key !== CLAVE || !ev.newValue) return;
    try {
      var n = JSON.parse(ev.newValue);
      if (!n || !Array.isArray(n.items)) return;
      E.items = n.items.filter(valido); E.panel = n.panel === true;
      if (n.elegido) E.elegido = n.elegido;
      if (Array.isArray(n.limpios)) E.limpios = n.limpios;
      if (Array.isArray(n.ocultos)) E.ocultos = n.ocultos;
      indexar(); avisar("lista"); marcar(); pintar();
    } catch (e) { /* no era JSON */ }
  });

  window.brainPedido = {
    // Registrar un tipo (ver def arriba). Se puede llamar una vez por tipo; vuelve a pintar.
    registrar: function (tipo, d) { if (!TIPOS[tipo]) ORDEN.push(tipo); TIPOS[tipo] = d; pintar(); },
    boton: boton, sumar: sumar, quitar: quitar, esta: esta, podar: podar, items: itemsDe, pintar: pintar, abrir: abrir,
    escuchar: function (f) { OYENTES.push(f); },
    // El agente, para todo el visor.
    agente: AG, proveedores: PROVS, proveedor: proveedor, modelo: modelo, elegir: elegir, selector: selector, llamar: llamar, actualizar: actualizar,
    trabajos: function () { return TRABAJOS; }, lote: loteDe, tandas: tandas, loteVivo: loteVivo,
    // Avisos en el panel (los resultados de un tipo los usan al guardar algo).
    aviso: function (o) { ERROR = o && o.error ? o.error : ""; NOTA = o && o.nota ? o.nota : ""; pintar(); },
    vivo: vivo, estado: estado, dolares: dolares, descargar: descargar
  };
  pintar();
  actualizar();
})();
`;

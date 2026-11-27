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
 * - `tarjeta(item)`: el HTML de la tarjeta (el estado, «El agente lo está resolviendo…» o cómo terminó, lo pone el componente); `orden?(a, b)`; `resumen?(items)`: textos bajo el total del tipo;
 *   `notas?(items)`: avisos del tipo; `costo(modelo, item)`: US$ estimado de ese ítem (el mismo para todos, si el tipo
 *   no distingue), o null si ese modelo no tiene estimación;
 * - `lote(items)`: el cuerpo de `/api/agente/lote` sin proveedor ni modelo (`{ tipo, reglas }` o `{ tipo, archivos }`);
 *   `md`: `{ archivo, texto(items) }`, el .md para cualquier agente (en inglés);
 * - el seguimiento: `clave?(item)` (con qué se reconoce el ítem de la lista en una tanda; por defecto `k`), `tanda`
 *   (`{ lista, clave }`: en qué campo de la tanda vienen sus ítems y la clave de cada uno, la misma que `clave(item)`),
 *   y `seguimiento` (lo que dice el lote: `pidiendo(n, repos)`, `reindexando?`, `resumen?(ts)`: lo que el tipo suma
 *   al resumen común);
 * - `despues?()`: lo que va al final del panel (los resultados de los tests; puede llevar botones `boton(...)`, que el
 *   panel atiende igual que en la pantalla); `bandeja?()`: lo que suma la bandeja («2 para decidir»); `enlace?()`: un
 *   enlace que va al lado de la bandeja, fuera del botón («3 borradores para revisar», cuando un lote dejó borradores);
 *   `accion?(acc, k, boton)`: los botones propios dentro del panel (true si lo atendió).
 *
 * Un botón de un tipo puede estar en otra pantalla que la que lo registró (la ficha de una funcionalidad pide
 * «escribir», que es de Especificaciones: mismo tipo y clave, así el botón dice «✔ En el pedido» en las dos). Esa
 * pantalla avisa dónde pinta con `raiz(el)`, y el componente marca ahí también los botones de cualquier tipo.
 *
 * Cómo termina cada ítem (dec. 235): el servidor devuelve en cada tanda sus `desenlaces` (`{ item, resuelto, cambio,
 * motivo }`, igual para todos los tipos). Al terminar la tanda, sus ítems salen de la lista y quedan en `res` con su
 * estado: «✔ Resuelto por el agente» (con lo que cambió) o «No lo pudo resolver» (con el motivo y «Pedir de nuevo»,
 * que lo vuelve a sumar). El estado se ve en el panel y junto a cada botón «Pedir» de las pantallas (`marca`, pintada
 * por `boton` y puesta al día por `marcar`, sin repintar). Al terminar un lote que cambió algo, la página se recarga
 * sola (cuando nadie está escribiendo) y vuelve a la misma pantalla y scroll: los filtros y la lista ya viven en este
 * navegador. Si terminó mientras se miraba otra pantalla (o con el panel cerrado), la bandeja lo avisa.
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
  // E: { items, panel (abierto), elegido: { proveedor, modelo }, limpios: tandas cuyo resultado ya limpió la lista, ocultos: lotes con el resumen cerrado,
  // res: "tipo|k" → cómo terminó ese ítem { l: lote, ok, c: cambio, m: motivo, it: el ítem, para pedirlo de nuevo }, seguidos: lotes vistos
  // corriendo (al terminar se avisa y se recarga), avisos: lotes que terminaron sin que se los mirara { l, ok, no } }.
  var E = leer(CLAVE);
  if (!E || typeof E !== "object") E = migrar();
  E = {
    items: Array.isArray(E.items) ? E.items.filter(valido) : [],
    panel: E.panel === true,
    elegido: E.elegido && typeof E.elegido === "object" ? { proveedor: String(E.elegido.proveedor || ""), modelo: String(E.elegido.modelo || "") } : { proveedor: "", modelo: "" },
    limpios: Array.isArray(E.limpios) ? E.limpios : [],
    ocultos: Array.isArray(E.ocultos) ? E.ocultos : [],
    res: E.res && typeof E.res === "object" && !Array.isArray(E.res) ? E.res : {},
    seguidos: Array.isArray(E.seguidos) ? E.seguidos : [],
    avisos: Array.isArray(E.avisos) ? E.avisos : []
  };
  if (!E.items.length) E.panel = false;
  // Las listas de antes (una por pantalla) pasan a la clave nueva, con su tipo; las claves viejas se borran.
  function migrar() {
    var out = { items: [], panel: false, elegido: null, limpios: [], ocultos: [], res: {}, seguidos: [], avisos: [] };
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
    try { if (typeof localStorage !== "undefined") localStorage.setItem(CLAVE, JSON.stringify({ v: 1, items: E.items, panel: E.panel, elegido: E.elegido, limpios: E.limpios.slice(-400), ocultos: E.ocultos.slice(-60), res: E.res, seguidos: E.seguidos.slice(-20), avisos: E.avisos.slice(-10) })); } catch (e) { /* sin almacenamiento */ }
  }
  // Índice tipo|k → ítem, para saber de un vistazo si algo ya está en la lista.
  var INDICE = {};
  var indexar = function () { INDICE = {}; E.items.forEach(function (x) { INDICE[x.tipo + "|" + x.k] = x; }); };
  indexar();

  // ---------- Los tipos ----------
  var TIPOS = {}, ORDEN = [], RAICES = [];
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
      var recargar = terminar();
      avisar("trabajos"); pintar();
      if (recargar) { recargarSola(); return; }
      if (TRABAJOS.some(vivo) || LOTES.some(loteVivo)) ESPERA = setTimeout(actualizar, 2000);
    }).catch(function () { ESPERA = setTimeout(actualizar, 5000); });
  }
  var loteConId = function (id) { for (var i = 0; i < LOTES.length; i++) if (LOTES[i].id === id) return LOTES[i]; return null; };
  // Cada tanda que terminó, una sola vez: sus ítems salen de la lista y quedan con su desenlace (resuelto o no, y por
  // qué). Una tanda sin desenlaces (cancelada antes de empezar) deja lo suyo en la lista.
  function limpiar() {
    var antes = E.items.length, cambio = false;
    TRABAJOS.forEach(function (t) {
      if (!t.lote || vivo(t) || E.limpios.indexOf(t.id) >= 0) return;
      var LT = loteConId(t.lote), tipo = LT ? tipoDeLote(LT) : "", d = def(tipo);
      if (!d) return;
      E.limpios.push(t.id); cambio = true;
      if (!Array.isArray(t.desenlaces)) return;
      var porClave = {}, fuera = {}, cl = tandaDe(d).clave;
      E.items.forEach(function (x) { if (x.tipo === tipo) porClave[claveDe(x)] = x; });
      t.desenlaces.forEach(function (ds) {
        var c = cl(ds.item), x = porClave[c];
        E.res[tipo + "|" + (x ? x.k : c)] = { l: LT.id, ok: !!ds.resuelto, c: ds.cambio || null, m: ds.motivo || null, it: x || null };
        if (x) fuera[x.k] = true;
      });
      E.items = E.items.filter(function (x) { return x.tipo !== tipo || !fuera[x.k]; });
    });
    if (E.items.length !== antes) { indexar(); avisar("lista"); }
    if (cambio) { guardar(); marcar(); }
  }
  // Los lotes que se vieron corriendo y ya terminaron: la bandeja avisa si no se los estaba mirando, y si cambiaron
  // algo después de que se cargó esta página, hay que traer los datos nuevos (devuelve true).
  var CARGADA = Date.now();
  function terminar() {
    var recargar = false, cambio = false;
    LOTES.forEach(function (LT) {
      var i = E.seguidos.indexOf(LT.id);
      if (loteVivo(LT)) { if (i < 0) { E.seguidos.push(LT.id); cambio = true; } return; }
      if (i < 0) return;
      E.seguidos.splice(i, 1); cambio = true;
      var ts = tandas(LT), c = cuentaRes(LT.id), d = def(tipoDeLote(LT));
      if (!E.panel || !d || !enPantalla(d.raiz)) E.avisos = E.avisos.filter(function (a) { return a.l !== LT.id; }).concat([{ l: LT.id, ok: c.ok, no: c.no }]);
      var fin = ts.reduce(function (m, t) { return Math.max(m, t.terminado || 0); }, 0);
      if (fin >= CARGADA && (c.ok || ts.some(function (t) { return t.cambios && t.cambios.length; }))) recargar = true;
    });
    if (cambio) guardar();
    return recargar;
  }
  // Si un elemento se ve: ni él ni lo que lo contiene está oculto (las pantallas que no se miran llevan «oculto»).
  function enPantalla(el) {
    for (var n = el; n && n.classList; n = n.parentNode) if (n.classList.contains("oculto")) return false;
    return !!el;
  }
  var cuentaRes = function (l) { var c = { ok: 0, no: 0 }; Object.keys(E.res).forEach(function (k) { var r = E.res[k]; if (r.l === l) c[r.ok ? "ok" : "no"]++; }); return c; };
  var claveDe = function (x) { var d = def(x.tipo); return d && d.clave ? d.clave(x) : x.k; };
  // Dónde vienen los ítems de un tipo en una tanda, y con qué clave.
  var tandaDe = function (d) { return d && d.tanda ? d.tanda : { lista: "items", clave: function (x) { return x.k; } }; };
  var deLaTanda = function (d, t) { var o = tandaDe(d); return t[o.lista] || []; };
  function enTandas() {
    var m = {};
    lotesVisibles().forEach(function (LT) {
      if (!loteVivo(LT)) return;
      var d = def(tipoDeLote(LT));
      if (d) tandas(LT).forEach(function (t) { if (vivo(t)) deLaTanda(d, t).forEach(function (x) { m[tipoDeLote(LT) + "|" + tandaDe(d).clave(x)] = true; }); });
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
      xs.forEach(function (x) { if (!esta(tipo, x.k)) { E.items.push(x); INDICE[tipo + "|" + x.k] = x; delete E.res[tipo + "|" + x.k]; } });
      E.panel = true;
    }
    ERROR = "";
    cambio();
  }
  // «Pedir de nuevo» desde el panel: vuelve a la lista el mismo ítem que se había pedido.
  function otraVez(tipo, k) {
    var r = E.res[tipo + "|" + k];
    if (!r || !valido(r.it)) return;
    delete E.res[tipo + "|" + k];
    if (!esta(tipo, r.it.k)) E.items.push(r.it);
    E.panel = true; ERROR = "";
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
    get tituloYa() { return L("Click to remove it from the request", "Tocalo para sacarlo del pedido"); },
    get otraVez() { return L("Request again", "Pedir de nuevo"); },
    get resuelto() { return L("Resolved by the agent", "Resuelto por el agente"); },
    get noPudo() { return L("It could not resolve it", "No lo pudo resolver"); },
    get trabajando() { return L("The agent is working on it…", "El agente lo está resolviendo…"); }
  };
  // Lo que cambió un ítem resuelto y por qué no se resolvió otro, en el idioma de la página (HTML).
  function textoCambio(c) {
    if (!c) return "";
    var codigo = function (x) { return "<code>" + esc(x) + "</code>"; };
    if (c.resultado) return ({ a: L("new test", "test nuevo"), b: L("it already had a test", "ya tenía test"), c: L("the code doesn't fulfill it: to decide", "el código no la cumple: para decidir"), d: L("it can't be tested without touching the code", "no se puede testear sin tocar el código") })[c.resultado] + (c.tests && c.tests.length ? " " + c.tests.map(codigo).join(" ") : "");
    if (c.asociado) return L("file assigned", "archivo asociado");
    if (c.puntaje) return L("score ", "puntaje ") + num(c.puntaje.antes) + " → " + (c.puntaje.despues === null || c.puntaje.despues === undefined ? "—" : num(c.puntaje.despues));
    if (c.corregido) return L("no longer in the drift", "ya no está en la deriva");
    if (c.borrador) return '<a href="#/borradores">' + L("new draft to review", "borrador nuevo para revisar") + "</a>";
    if (c.pagina) return L("page updated: ", "página actualizada: ") + codigo(c.pagina);
    return "";
  }
  function textoMotivo(m) {
    if (!m) return "";
    var T = { sigue: L("after the batch it is still pending", "después de la tanda sigue pendiente"), fallo: L("the batch failed", "la tanda falló"), cancelado: L("the batch was canceled", "la tanda se canceló"), sin_respuesta: L("the agent didn't return a valid result", "el agente no devolvió un resultado válido") };
    return (T[m.codigo] || esc(m.codigo)) + (m.agente ? ". " + L("The agent says: ", "El agente dice: ") + "«" + esc(m.agente) + "»" : "") + (m.detalle ? ' <small>(' + esc(m.detalle) + ")</small>" : "");
  }
  var plano = function (h) { return String(h).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); };
  // El estado de un botón: null (no hay desenlace de todo lo que suma, o algo está en la lista), resuelto o no.
  function estadoDe(tipo, ks) {
    if (!ks || !ks.length || ks.some(function (c) { return esta(tipo, c); })) return null;
    var rs = ks.map(function (c) { return E.res[tipo + "|" + c]; });
    if (rs.some(function (r) { return !r; })) return null;
    var no = rs.filter(function (r) { return !r.ok; });
    return { ok: !no.length, r: no.length ? no[0] : rs[0], uno: rs.length === 1 };
  }
  // La marca junto al botón: la misma en todas las pantallas.
  function htmlMarca(e) {
    if (!e) return "";
    if (e.ok) { var c = e.uno ? textoCambio(e.r.c) : ""; return '<span class="pd-marca ok" title="' + esc(TEXTOS.resuelto + (c ? ": " + plano(c) : "")) + '">✔ ' + TEXTOS.resuelto + (c ? " · " + c : "") + "</span>"; }
    return '<span class="pd-marca no" title="' + esc(plano(textoMotivo(e.r.m))) + '">✕ ' + TEXTOS.noPudo + "</span>";
  }
  // o: { tipo, k, et: lo que dice sin sumar, claves?: las claves de ítem que suma (si no, def.claves(k)) }. La
  // pantalla atiende data-acc="pedir" con sumar(tipo, k).
  function boton(o) {
    var d = def(o.tipo), ks = o.claves || (d && d.claves ? d.claves(o.k, {}) : []), y = ya(o.tipo, o.k, ks) === true, e = y ? null : estadoDe(o.tipo, ks);
    return '<button type="button" class="boton es-pedir' + (y ? " en-lista" : "") + '" data-acc="pedir" data-tipo="' + esc(o.tipo) + '" data-k="' + esc(o.k) + '" data-et="' + esc(o.et) + '" aria-pressed="' + y + '" title="' + esc(y ? TEXTOS.tituloYa : TEXTOS.titulo) + '">' + esc(y ? TEXTOS.ya : e && !e.ok ? TEXTOS.otraVez : o.et) + "</button>" + htmlMarca(e);
  }
  // Cambia los botones ya pintados sin repintar la pantalla (así no se cierra lo que se estaba mirando).
  function marcar() {
    ORDEN.forEach(function (tipo) {
      var d = def(tipo), raices = [d.raiz].concat(RAICES).filter(function (r, i, xs) { return r && r.querySelectorAll && xs.indexOf(r) === i; });
      if (!d.raiz || !d.raiz.querySelectorAll) { if (d.repintar) d.repintar(); }
      var bs = [], memo = {};
      raices.forEach(function (r) { var xs = r.querySelectorAll('[data-acc="pedir"]'); for (var j = 0; j < xs.length; j++) bs.push(xs[j]); });
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i];
        if (b.getAttribute("data-tipo") !== tipo) continue;
        var ks = d.claves ? d.claves(b.getAttribute("data-k"), memo) : null, y = ya(tipo, b.getAttribute("data-k"), ks, memo);
        if (y === null) continue;
        var e = y ? null : estadoDe(tipo, ks);
        b.setAttribute("aria-pressed", String(y));
        b.setAttribute("title", y ? TEXTOS.tituloYa : TEXTOS.titulo);
        if (b.classList) { if (y) b.classList.add("en-lista"); else b.classList.remove("en-lista"); }
        b.textContent = y ? TEXTOS.ya : e && !e.ok ? TEXTOS.otraVez : (b.getAttribute("data-et") || "");
        ponerMarca(b, htmlMarca(e));
      }
    });
  }

  // La marca va justo después del botón: se cambia, se pone o se saca sin tocar lo demás.
  function ponerMarca(b, h) {
    var sig = b.nextElementSibling, tiene = !!(sig && sig.classList && sig.classList.contains("pd-marca"));
    if (tiene && !h) { sig.parentNode.removeChild(sig); return; }
    if (!h) return;
    if (tiene) { if (sig.outerHTML !== h) sig.outerHTML = h; }
    else if (b.insertAdjacentHTML) b.insertAdjacentHTML("afterend", h);
  }

  // ---------- El seguimiento de un lote ----------
  function htmlTanda(t, o, u, d) {
    var e = estado(t.estado), pasos = (t.pasos || []).slice(-2);
    return '<li class="es-tanda"><div class="es-cab"><span>' + (t.tanda.de > 1 ? L("Batch " + t.tanda.n + " of " + t.tanda.de, "Tanda " + t.tanda.n + " de " + t.tanda.de) : L("One batch", "Una tanda")) + " · " + pl(deLaTanda(d, t).length, u) + '</span><span class="fd-es ' + e[1] + '">' + e[0] + "</span></div>" +
      (vivo(t) && pasos.length ? '<ul class="es-pasos">' + pasos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (t.estado === "en_cola" ? "<small>" + L("Waits for the previous batch to finish.", "Espera a que termine la tanda anterior.") + "</small>" : "") +
      (t.error ? '<p class="fd-msg error">' + esc(t.error) + "</p>" : "") + (vivo(t) ? "" : cifrasTanda(t)) + "</li>";
  }
  // Cómo terminó una tanda: cuántos resolvió y cuántos no, y lo que dijo el agente.
  function cifrasTanda(t) {
    var ds = Array.isArray(t.desenlaces) ? t.desenlaces : null, ok = ds ? ds.filter(function (x) { return x.resuelto; }).length : 0;
    return (ds ? "<small>" + cifras(ok, ds.length - ok) + "</small>" : "") +
      (t.resultado ? '<details class="tf"><summary>' + L("What the agent said", "Lo que dijo el agente") + '</summary><p class="es-resultado">' + esc(t.resultado) + "</p></details>" : "");
  }
  var cifrasLote = function (ts) { var ok = 0, todos = 0; ts.forEach(function (t) { (t.desenlaces || []).forEach(function (x) { todos++; if (x.resuelto) ok++; }); }); return cifras(ok, todos - ok); };
  var cifras = function (ok, no) { return L(num(ok) + " resolved · " + num(no) + " could not be resolved", plural(ok, "resuelto", "resueltos") + " · " + num(no) + " sin resolver"); };
  // Lo que dejó un lote, ítem por ítem: primero lo que no se resolvió (con «Pedir de nuevo»), después lo resuelto.
  function htmlResultados(LT) {
    var tipo = tipoDeLote(LT), d = def(tipo), rs = [];
    Object.keys(E.res).forEach(function (k) { var r = E.res[k]; if (r.l === LT.id) rs.push({ k: k.slice(tipo.length + 1), r: r }); });
    if (!rs.length) return "";
    var MAX = 200;
    var li = function (x) {
      var r = x.r, cuerpo = r.it && d && d.tarjeta ? d.tarjeta(r.it, false) : "<code>" + esc(x.k) + "</code>";
      var estado = r.ok ? '<p class="pd-estado ok">✔ ' + TEXTOS.resuelto + (r.c ? " · " + textoCambio(r.c) : "") + "</p>" : '<p class="pd-estado no">✕ ' + TEXTOS.noPudo + ": " + textoMotivo(r.m) + "</p>";
      return '<li class="es-pedido pd-res' + (r.ok ? " ok" : " no") + '"><div>' + cuerpo + estado + "</div>" + (!r.ok && r.it ? '<button type="button" class="boton chico" data-acc="otra-vez" data-tipo="' + esc(tipo) + '" data-k="' + esc(x.k) + '">' + TEXTOS.otraVez + "</button>" : "") + "</li>";
    };
    var no = rs.filter(function (x) { return !x.r.ok; }), ok = rs.filter(function (x) { return x.r.ok; });
    var mas = function (n) { return n > MAX ? '<p class="fd-nota">' + L("And " + num(n - MAX) + " more.", "Y " + num(n - MAX) + " más.") + "</p>" : ""; };
    return '<div class="pd-resultados">' +
      (no.length ? "<h4>" + TEXTOS.noPudo + ' <span class="chip">' + num(no.length) + '</span></h4><ul class="es-pedidos">' + no.slice(0, MAX).map(li).join("") + "</ul>" + mas(no.length) : "") +
      (ok.length ? '<details class="tf"' + (no.length ? "" : " open") + "><summary>" + TEXTOS.resuelto + ' <span class="chip">' + num(ok.length) + '</span></summary><ul class="es-pedidos">' + ok.slice(0, MAX).map(li).join("") + "</ul>" + mas(ok.length) + "</details>" : "") + "</div>";
  }
  function htmlLote(LT) {
    var d = def(tipoDeLote(LT)); if (!d || !d.seguimiento) return "";
    var o = d.seguimiento, u = unidadDe(tipoDeLote(LT)), ts = tandas(LT);
    var v = LT.estado !== "terminado" || ts.some(vivo), hechas = ts.filter(function (t) { return !vivo(t); }).length;
    var porRepo = {}, repos = []; ts.forEach(function (t) { if (!porRepo[t.repo]) { porRepo[t.repo] = []; repos.push(t.repo); } porRepo[t.repo].push(t); });
    var cuerpo = repos.map(function (r) { return '<div class="es-repo"><h4>' + esc(r) + "</h4><ul>" + porRepo[r].map(function (t) { return htmlTanda(t, o, u, d); }).join("") + "</ul></div>"; }).join("");
    var n = ts.reduce(function (s, t) { return s + deLaTanda(d, t).length; }, 0);
    var costo = ts.reduce(function (s, t) { return s + (t.costoUsd || 0); }, 0);
    var fallaron = ts.filter(function (t) { return t.estado === "fallo"; }).length, cancelaron = ts.filter(function (t) { return t.estado === "cancelado"; }).length;
    var cab = v ? (LT.estado === "reindexando" ? o.reindexando || L("Finishing…", "Terminando…") : o.pidiendo(n, repos.length)) : L("Finished", "Terminó") + " · " + esc(nombreDe(tipoDeLote(LT)));
    var fin = !v
      ? '<div class="es-fin"><b>' + L("Actual cost: ", "Costo real: ") + dolares(costo) + "</b><span>" + cifrasLote(ts) + (o.resumen ? " · " + o.resumen(ts) : "") +
        (fallaron ? " · " + pl(fallaron, ["batch failed", "batches failed", "tanda falló", "tandas fallaron"]) : "") + (cancelaron ? " · " + pl(cancelaron, ["batch canceled", "batches canceled", "tanda cancelada", "tandas canceladas"]) : "") + ".</span>" +
        (LT.error ? '<p class="fd-msg error">' + esc(LT.error) + "</p>" : "") + "</div>" + htmlResultados(LT)
      : '<div class="es-fin"><span>' + L("Cost so far: ", "Costo hasta ahora: ") + dolares(costo) + "</span></div>";
    return '<section class="es-lote" data-tipo="' + esc(tipoDeLote(LT)) + '"><div class="es-cab"><h3>' + cab + '</h3><span class="fd-es ' + (v ? "na" : fallaron ? "no" : "ok") + '">' + L(hechas + " of " + ts.length + " batches", hechas + " de " + ts.length + " tandas") + "</span></div>" +
      '<progress max="' + Math.max(1, ts.length) + '" value="' + hechas + '"></progress>' + cuerpo + fin +
      '<div class="fd-acc">' + (v ? '<button type="button" class="boton" data-acc="cancelar-lote" data-k="' + esc(LT.id) + '">' + L("Cancel all", "Cancelar todo") + "</button>" : '<button type="button" class="boton" data-acc="cerrar-lote" data-k="' + esc(LT.id) + '">' + L("Close the summary", "Cerrar el resumen") + "</button>") + "</div></section>";
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
      // El costo del tipo: la suma de lo que estima cada ítem que lleva el pedido (null si alguno no tiene estimación).
      var d = def(t), xs = itemsDe(t), c = d && d.costo && mo ? xs.slice(0, TOPE).reduce(function (s, x) { var u = s === null ? null : d.costo(mo, x); return typeof u === "number" ? s + u : null; }, 0) : null;
      if (typeof c === "number") costoTotal += c; else sinEstimar = true;
      var costo = AG && mo ? "<span>" + L("Estimated cost: ", "Costo estimado: ") + (typeof c !== "number" ? L("no estimate for this model: the actual cost shows while it runs", "sin estimación para este modelo: el costo real se ve mientras corre") : (c ? "≈ " + dolares(c) : dolares(0)) + " <small>(" + L("approx., with ", "aprox., con ") + esc(mo.nombre) + ")</small>") + "</span>" : "";
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
          return '<li class="es-pedido"><div>' + (d && d.tarjeta ? d.tarjeta(x, bloq) : "<code>" + esc(x.k) + "</code>") + (bloq ? '<p class="pd-estado na">' + TEXTOS.trabajando + "</p>" : "") + '</div><button type="button" class="boton chico" data-acc="quitar" data-tipo="' + esc(t) + '" data-k="' + esc(x.k) + '" aria-label="' + L("Remove from the list", "Quitar de la lista") + '"' + (bloq ? " disabled" : "") + ">" + L("Remove", "Quitar") + "</button></li>";
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
    var corriendo = lotesVisibles().some(loteVivo), enlaces = "";
    ORDEN.forEach(function (t) { var d = def(t), x = d.enlace ? d.enlace() : ""; if (x) enlaces += x; });
    if (!n && !extras.length && !lotesVisibles().length && !E.avisos.length) return enlaces;
    // Un lote que terminó mientras se miraba otra cosa: cuánto se resolvió, hasta abrir el panel.
    var av = E.avisos.reduce(function (s, a) { return { ok: s.ok + a.ok, no: s.no + a.no }; }, { ok: 0, no: 0 });
    var aviso = E.avisos.length ? ' <span class="pd-aviso" title="' + esc(L("A batch finished: open the panel to see what was resolved", "Terminó un lote: abrí el panel para ver qué se resolvió")) + '">' + L("finished", "terminó") + ": ✔ " + num(av.ok) + (av.no ? " · ✕ " + num(av.no) : "") + "</span>" : "";
    return enlaces + '<button type="button" class="boton es-pedir' + (corriendo ? " pd-corriendo" : "") + '" data-acc="panel" aria-expanded="' + E.panel + '" aria-controls="pedido-panel">' + L("Request", "Pedido") + (n ? " (" + num(n) + ")" : "") + (corriendo ? " · " + L("running", "corriendo") : "") + (extras.length ? " · " + extras.join(" · ") : "") + aviso + "</button>";
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
  function abrir(abierto) { E.panel = abierto; if (abierto) E.avisos = []; guardar(); pintar(); }

  // ---------- Los datos nuevos, solos ----------
  // Cada pantalla arma sus índices una vez, con los datos de la página: traer los nuevos es volver a cargarla. Se
  // hace sola, cuando nadie está escribiendo, y vuelve a la misma pantalla y al mismo scroll (los filtros y la lista ya
  // viven en este navegador).
  var VISTA = "flowbrain.pedido.vista";
  function editando() {
    var a = typeof document !== "undefined" ? document.activeElement : null;
    if (!a) return false;
    if (a.isContentEditable) return true;
    var tag = String(a.tagName || "").toLowerCase();
    return tag === "textarea" ? !!a.value : tag === "input" && /^(text|number|email|url)$/.test(a.type || "text") && !!a.value;
  }
  function recargarSola() {
    if (!(window.location && window.location.reload)) return;
    if (editando()) { setTimeout(recargarSola, 1500); return; }
    try {
      var p = elem("pedido-panel");
      sessionStorage.setItem(VISTA, JSON.stringify({ h: window.location.hash || "", x: window.scrollX || 0, y: window.scrollY || 0, p: p ? p.scrollTop : 0, n: Date.now() }));
    } catch (e) { /* sin almacenamiento: se recarga igual */ }
    window.location.reload();
  }
  function restaurarVista() {
    var v = null;
    try { if (typeof sessionStorage !== "undefined") { v = JSON.parse(sessionStorage.getItem(VISTA) || "null"); sessionStorage.removeItem(VISTA); } } catch (e) { v = null; }
    if (!v || Date.now() - v.n > 60000 || !window.location || (window.location.hash || "") !== v.h) return;
    // Las pantallas pintan al cargar (Borradores, después de pedir su lista): se vuelve al scroll un par de veces.
    var ir = function () { if (window.scrollTo) window.scrollTo(v.x, v.y); var p = elem("pedido-panel"); if (p) p.scrollTop = v.p; };
    if (window.addEventListener) window.addEventListener("load", function () { ir(); setTimeout(ir, 300); setTimeout(ir, 900); });
  }

  // ---------- Los botones del panel y de la bandeja ----------
  function accion(b) {
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k");
    if (acc === "panel") { abrir(!E.panel); return; }
    if (acc === "cerrar-panel") { abrir(false); return; }
    if (acc === "quitar") { quitar(b.getAttribute("data-tipo"), k); return; }
    // Un botón «Pedir» pintado dentro del panel (en lo que un tipo pone al final, como «Pedir la corrección»).
    if (acc === "pedir") { sumar(b.getAttribute("data-tipo"), k); return; }
    if (acc === "vaciar") { vaciar(); return; }
    if (acc === "pedir-todos") { pedirTodos(); return; }
    if (acc === "descargar-lista") { var m = md(); if (m && !descargar(m.archivo, m.texto)) { ERROR = L("It couldn't be downloaded.", "No se pudo descargar."); pintar(); } return; }
    if (acc === "cancelar-lote") { llamar("/api/agente/lote/cancelar", { id: k }).then(actualizar, actualizar); return; }
    if (acc === "otra-vez") { otraVez(b.getAttribute("data-tipo"), k); return; }
    // Cerrar el resumen olvida también cómo terminó cada ítem de ese lote (las marcas de las pantallas se van).
    if (acc === "cerrar-lote") {
      E.ocultos.push(k);
      Object.keys(E.res).forEach(function (c) { if (E.res[c].l === k) delete E.res[c]; });
      E.avisos = E.avisos.filter(function (a) { return a.l !== k; });
      guardar(); marcar(); pintar(); return;
    }
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
      if (n.res && typeof n.res === "object") E.res = n.res;
      if (Array.isArray(n.seguidos)) E.seguidos = n.seguidos;
      if (Array.isArray(n.avisos)) E.avisos = n.avisos;
      indexar(); avisar("lista"); marcar(); pintar();
    } catch (e) { /* no era JSON */ }
  });

  window.brainPedido = {
    // Registrar un tipo (ver def arriba). Se puede llamar una vez por tipo; vuelve a pintar.
    registrar: function (tipo, d) { if (!TIPOS[tipo]) ORDEN.push(tipo); TIPOS[tipo] = d; pintar(); },
    // Otra pantalla con botones «Pedir» (de cualquier tipo): el componente los marca ahí también.
    raiz: function (el) { if (el && RAICES.indexOf(el) < 0) RAICES.push(el); },
    boton: boton, sumar: sumar, quitar: quitar, esta: esta, podar: podar, items: itemsDe, pintar: pintar, abrir: abrir,
    escuchar: function (f) { OYENTES.push(f); },
    // El agente, para todo el visor.
    agente: AG, proveedores: PROVS, proveedor: proveedor, modelo: modelo, elegir: elegir, selector: selector, llamar: llamar, actualizar: actualizar,
    trabajos: function () { return TRABAJOS; }, lotes: lotesVisibles, lote: loteDe, tandas: tandas, loteVivo: loteVivo,
    // Avisos en el panel (los resultados de un tipo los usan al guardar algo).
    aviso: function (o) { ERROR = o && o.error ? o.error : ""; NOTA = o && o.nota ? o.nota : ""; pintar(); },
    vivo: vivo, estado: estado, dolares: dolares, descargar: descargar,
    // Cómo terminó un ítem de la lista en su último lote (null si no hay desenlace).
    resultado: function (tipo, k) { return E.res[tipo + "|" + k] || null; }
  };
  restaurarVista();
  pintar();
  actualizar();
})();
`;

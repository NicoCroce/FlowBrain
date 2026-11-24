/**
 * "Contratos" (`#/contratos`): dos controles sobre lo que los servicios se prometen entre sí.
 * - Deriva: llamadas que nadie atiende y endpoints que nadie llama, por cerebro. Viene calculada por el motor (con los
 *   cruces entre cerebros): lo que atiende o llama otro cerebro comunicado no es deriva, y se muestra aparte. También
 *   los campos de cada llamada unida que no coinciden con lo que declara el endpoint, y lo que no se pudo comparar.
 * - Paridad: se eligen dos servicios (el que se reemplaza y el que lo reemplaza, del mismo cerebro o de dos) y se ve qué
 *   ya está del otro lado, qué falta y dónde difieren las tablas. Se calcula acá, con la misma regla que `paridad` del
 *   motor: método y ruta sin el nombre de los parámetros, prefijo fijo descontado, y entre cerebros las tablas por
 *   nombre sin separadores.
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

  var plural = function (n, uno, varios) { return n.toLocaleString("es") + " " + (n === 1 ? uno : varios); };
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
  var cifra = function (valor, texto, color) { return '<div class="fd-cifra"><b' + (color ? ' style="color:' + color + '"' : "") + ">" + (typeof valor === "number" ? valor.toLocaleString("es") : valor) + "</b><span>" + texto + "</span></div>"; };
  // Una lista larga se corta y ofrece seguir: clave identifica la lista.
  function listaCortada(clave, items, fila) {
    if (!items.length) return "";
    var n = S.ver[clave] || PASO, visibles = items.slice(0, n);
    return '<ul class="lista">' + visibles.map(fila).join("") + "</ul>" +
      (items.length > visibles.length ? '<p class="fd-mas"><button type="button" class="boton" data-acc="mas" data-k="' + esc(clave) + '">Mostrar ' + Math.min(PASO, items.length - visibles.length) + " más</button> <small>" + visibles.length + " de " + items.length.toLocaleString("es") + "</small></p>" : "");
  }
  function seccion(titulo, n, cuerpo, abierta) {
    return '<details class="es-feat ct-sec"' + (abierta ? " open" : "") + "><summary><h3>" + titulo + ' <small>' + n.toLocaleString("es") + "</small></h3></summary>" + cuerpo + "</details>";
  }

  // ---------- Deriva ----------
  // Una sola lista con los problemas de todos los cerebros: llamadas que nadie atiende, endpoints que nadie llama,
  // llamadas con varios candidatos y campos que no coinciden. El filtro y la estadística son el componente compartido.
  var TIPOS_D = [["sinEndpoint", "Nadie las atiende"], ["sinLlamadas", "Nadie los llama"], ["disputada", "Varios candidatos"], ["campos", "Campos distintos"]];
  var svcDeId = function (id) { var s = String(id || ""), i = s.indexOf(":"); return i < 0 ? s : s.slice(0, i); };
  var metodoDe = function (texto) { var m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CRON|GRPC)\b/.exec(String(texto || "")); return m ? m[1] : ""; };
  var cerebroD = function (d, i) { return d.c !== undefined ? d.c : i; };
  var ITEMS_D = [];
  (DERIVA || []).forEach(function (d, i) {
    var c = cerebroD(d, i);
    d.sinEndpoint.forEach(function (x) { ITEMS_D.push({ t: "sinEndpoint", c: c, svc: svcDeId(x.d), m: metodoDe(x.l), x: x, texto: x.l + " " + x.ev + " " + nombre(x.d) }); });
    d.disputadas.concat(d.ambiguas).forEach(function (x) { ITEMS_D.push({ t: "disputada", c: c, svc: svcDeId(x.d), m: metodoDe(x.l), x: x, texto: x.l + " " + x.ev }); });
    var svcs = Object.keys(d.consumidores);
    d.sinLlamadas.forEach(function (x) {
      var s = svcDeId(x.e);
      svcs.forEach(function (k) { if (x.e.indexOf(k + ":") === 0) s = k; });
      ITEMS_D.push({ t: "sinLlamadas", c: c, svc: s, m: metodoDe(pieza(x.e)), x: x, texto: pieza(x.e) + " " + x.ev });
    });
    (d.difieren || []).forEach(function (x) { ITEMS_D.push({ t: "campos", c: c, svc: svcDeId(x.e), m: metodoDe(x.l), x: x, texto: x.l + " " + x.ev + " " + x.e + " " + JSON.stringify([x.cuerpo, x.query, x.respuesta]) }); });
  });
  var nombreCerebro = function (v) { return CEREBROS[Number(v)] ? CEREBROS[Number(v)].nombre : String(v); };
  var nombreSvc = function (s) { return porId[s] ? nombre(s) : local(s); };
  var flD = DERIVA ? window.brainFiltros.crear({
    pre: "ct", clave: "flowbrain.contratos.deriva", unidad: ["problema", "problemas"], todos: "todo lo que no cierra",
    items: function () { return ITEMS_D; },
    grupos: [{ id: "", etiqueta: "Todo" }].concat(TIPOS_D.map(function (t) { return { id: t[0], etiqueta: t[1], palabra: t[1].toLowerCase(), es: function (x) { return x.t === t[0]; }, ocultarVacio: t[0] === "disputada" }; })),
    buscar: { ph: "Buscar una ruta, un servicio o un archivo…", texto: function (x) { return x.texto; } },
    campos: [
      { id: "cerebro", etiqueta: "Cerebro", propio: "el cerebro elegido", solo: function () { return DERIVA.length > 1; }, de: function (x) { return x.c; },
        valores: function () { return DERIVA.map(function (d, i) { var c = cerebroD(d, i); return [c, nombreCerebro(c), ITEMS_D.filter(function (x) { return x.c === c; }).length]; }); },
        etiquetaDe: nombreCerebro, palabra: function (v) { return "cerebro " + nombreCerebro(v); } },
      { id: "servicio", etiqueta: "Servicio", propio: "el servicio elegido", ordenPorCantidad: true, de: function (x) { return x.svc; }, etiquetaDe: nombreSvc, palabra: function (v) { return "servicio " + nombreSvc(v); } },
      { id: "metodo", etiqueta: "Método", propio: "el método elegido", ordenPorCantidad: true, de: function (x) { return x.m; }, palabra: function (v) { return "método " + v; } }
    ],
    paneles: [
      { titulo: "Por cerebro", campo: "cerebro" },
      { titulo: "Por servicio", campo: "servicio", max: 8 },
      { titulo: "Por método", campo: "metodo", sinValor: "sin método HTTP (rutas que no se pudieron leer o colas)" }
    ],
    cifras: function () {
      var ds = alcance(), n = function (f) { var s = 0; ds.forEach(function (d) { s += f(d); }); return s; };
      var sinEp = n(function (d) { return d.sinEndpoint.length; }), atendidas = n(function (d) { var s = 0; d.atendidas.forEach(function (a) { s += a.llamadas; }); return s; });
      var disp = n(function (d) { return d.disputadas.length; }), sinLl = n(function (d) { return d.sinLlamadas.length; }), conDif = n(function (d) { return d.campos ? d.campos.conDiferencias : 0; });
      var out = [[sinEp, "llamadas que nadie atiende", sinEp ? "var(--mal)" : "var(--bien)", "sinEndpoint"]];
      if (ds.some(function (d) { return d.comunicadoCon; })) out.push([atendidas, "llamadas que atiende otro cerebro"]);
      if (disp) out.push([disp, "en disputa entre cerebros", "var(--atencion)", "disputada"]);
      out.push([sinLl, "endpoints que nadie llama", sinLl ? "var(--atencion)" : "", "sinLlamadas"]);
      if (ds.some(function (d) { return d.campos && d.campos.llamadasUnidas; })) out.push([conDif, "con campos que no coinciden", conDif ? "var(--mal)" : "var(--bien)", "campos"]);
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
    return "<li><code>" + esc(x.l) + "</code> <small>desde " + esc(nombre(x.d)) + " · <code>" + esc(x.ev) + "</code></small>" + (it ? conCerebro(it) : "") + (extra || "") + "</li>";
  }
  var ninguno = function () { return '<p class="aviso">Ninguno coincide con ' + esc(flD.activos().join(", ")) + ".</p>"; };
  // Lo de cada cerebro que no es una lista: con quién se cruza, lo que atiende otro, lo que no se pudo medir.
  function contexto(ds) {
    var varios = ds.length > 1, quien = function (d, i) { return varios ? "<strong>" + esc(nombreCerebro(cerebroD(d, i))) + "</strong>: " : ""; };
    var cruces = ds.map(function (d, i) {
      if (d.comunicadoCon === null || d.comunicadoCon === undefined) return "";
      return d.comunicadoCon.length
        ? '<p class="explica">' + quien(d, i) + "Cruzado con " + d.comunicadoCon.map(esc).join(", ") + ": lo que atiende o llama uno de esos cerebros no cuenta como deriva." +
          (d.internas ? " Tampoco " + (d.internas === 1 ? "la llamada" : "las " + d.internas.toLocaleString("es") + " llamadas") + " al propio servidor que <code>flowbrain.yaml</code> declara " + (d.internas === 1 ? "interna" : "internas") + " (<code>internas</code>)." : "") + "</p>"
        : '<p class="aviso">' + quien(d, i) + (varios ? "no tiene" : "Este cerebro no tiene") + " la comunicación activa con ningún otro: todo lo que llame afuera figura como sin endpoint. Se activa en <code>flowbrain.yaml</code> (<code>comunicacion</code>).</p>";
    }).join("");
    // Con varios cerebros, una línea por cerebro repetía la misma explicación: va una sola vez, con quién se cruza cada uno.
    if (varios) {
      var con = [], sin = [], internas = 0;
      ds.forEach(function (d, i) {
        if (d.comunicadoCon === null || d.comunicadoCon === undefined) return;
        var n = esc(nombreCerebro(cerebroD(d, i)));
        if (d.comunicadoCon.length) con.push("<strong>" + n + "</strong> con " + d.comunicadoCon.map(esc).join(", ")); else sin.push("<strong>" + n + "</strong>");
        internas += d.internas || 0;
      });
      cruces = (con.length ? '<p class="aviso">Cada cerebro se cruza con los que se comunica: ' + con.join(" · ") + ". Lo que atiende o llama uno de esos cerebros no cuenta como deriva." +
          (internas ? " Tampoco " + plural(internas, "llamada", "llamadas") + " al propio servidor que <code>flowbrain.yaml</code> declara internas (<code>internas</code>)." : "") + "</p>" : "") +
        (sin.length ? '<p class="aviso">' + sin.join(", ") + (sin.length === 1 ? " no tiene" : " no tienen") + " la comunicación activa con ningún otro: todo lo que " + (sin.length === 1 ? "llame" : "llamen") + " afuera figura como sin endpoint. Se activa en <code>flowbrain.yaml</code> (<code>comunicacion</code>).</p>" : "");
    }
    var at = [], total = 0;
    ds.forEach(function (d) { d.atendidas.forEach(function (a) { at.push(a); total += a.llamadas; }); });
    var atHtml = at.length ? seccion("Las atiende otro cerebro", total, "<p><small>No son deriva: están unidas a un endpoint de un cerebro comunicado.</small></p>" +
      '<ul class="lista">' + at.map(function (a) { return "<li>" + esc(a.cerebro) + " <small>" + plural(a.llamadas, "llamada", "llamadas") + " a " + plural(a.endpoints, "endpoint", "endpoints") + "</small></li>"; }).join("") + "</ul>", false) : "";
    var avisos = [];
    ds.forEach(function (d, i) { d.avisos.forEach(function (a) { avisos.push((varios ? nombreCerebro(cerebroD(d, i)) + ": " : "") + a); }); });
    var avHtml = avisos.length ? seccion("Lo que no se pudo medir", avisos.length, '<ul class="lista">' + avisos.map(function (a) { return "<li><small>" + esc(a) + "</small></li>"; }).join("") + "</ul>", false) : "";
    return { cruces: cruces, atendidas: atHtml, avisos: avHtml };
  }
  function vistaDeriva() {
    if (!DERIVA) return '<p class="aviso">No hay índice de código, así que no se sabe qué llama cada servicio ni a quién. Corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code> (o <code>flowbrain brains apply</code>).</p>';
    var ds = alcance(), ctx = contexto(ds);
    return ctx.cruces + flD.html() + '<div id="ct-lista">' + listaDeriva() + "</div>" + ctx.atendidas + ctx.avisos;
  }
  function listaDeriva() {
    var ds = alcance(), S2 = flD.S(), xs = flD.filtrar(), ve = function (t) { return !S2.grupo || S2.grupo === t; };
    var de = function (t) { return xs.filter(function (x) { return x.t === t; }); };
    var total = function (f) { var s = 0; ds.forEach(function (d) { s += f(d); }); return s; };
    var out = flD.resultado(xs);
    if (ve("sinEndpoint")) {
      var sinEp = de("sinEndpoint"), n = total(function (d) { return d.sinEndpoint.length; });
      out += seccion("Llamadas que nadie atiende", sinEp.length, n
        ? "<p><small>La ruta ya no existe, cambió de método, o el servicio que la atiende no está indexado" + (ds.some(function (d) { return d.comunicadoCon; }) ? " ni comunicado" : "") + ".</small></p>" +
          (sinEp.length ? listaCortada("sinEndpoint", sinEp, function (it) {
            var x = it.x;
            return llamada(x, x.o ? '<div class="fd-nota">Existe con otro método: ' + x.o.map(function (id) { return "<code>" + esc(pieza(id)) + "</code>"; }).join(", ") + "</div>" : "", it);
          }) : ninguno())
        : '<p class="fd-ok">Todas las llamadas con ruta tienen quién las atienda.</p>', true);
    }
    if (ve("disputada")) {
      var disp = de("disputada");
      if (disp.length) out += seccion("Coinciden con varios endpoints", disp.length, "<p><small>Coinciden con más de un endpoint y no se unieron a ninguno. Entre cerebros se resuelve declarando a qué servicio va cada base de URL (<code>flowbrain evidence</code>).</small></p>" +
        listaCortada("disputadas", disp, function (it) { return llamada(it.x, '<div class="fd-nota">Candidatos: ' + it.x.k.map(function (k) { return "<code>" + esc(k) + "</code>"; }).join(", ") + "</div>", it); }), true);
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
          var cab = "<h4>" + esc(nombre(s)) + " <small>" + (cons.length ? "lo llaman " + cons.map(function (k) { return esc(porId[k] ? nombre(k) : k); }).join(", ") : "sin consumidores indexados") + "</small>" + (ds.length > 1 ? ' <span class="chip">' + esc(nombreCerebro(c)) + "</span>" : "") + "</h4>";
          if (!cons.length) return cab + '<p class="aviso">Nadie indexado llama a este servicio, así que no se puede decir qué endpoints suyos no se usan. Falta indexar a quien lo consume, o activar la comunicación con su cerebro.</p>';
          if (!todos.length) return cab + '<p class="fd-ok">Todos sus endpoints tienen al menos una llamada.</p>';
          return cab + (suyos.length ? listaCortada("sinLlamadas:" + c + ":" + s, suyos, function (it) { return "<li><code>" + esc(pieza(it.x.e)) + "</code>" + (it.x.ev ? " <small><code>" + esc(it.x.ev) + "</code></small>" : "") + "</li>"; }) : ninguno());
        }).join("");
      }).join("");
      var hay = ds.some(function (d) { return Object.keys(d.consumidores).length; });
      out += seccion("Endpoints que nadie llama", sinLl.length, hay ? "<p><small>Candidatos a borrar, o llamados por algo que no está indexado. Antes de borrar uno, revisá su impacto.</small></p>" + (porSvc || ninguno())
        : '<p class="aviso">' + (ds.length > 1 ? "Estos cerebros no tienen" : "Este cerebro no tiene") + " servicios con endpoints: no hay nada que alguien pueda dejar de llamar.</p>", true);
    }
    if (ve("campos")) out += seccion("Campos que no coinciden", de("campos").length, camposHtml(ds, de("campos")), true);
    return out;
  }
  // Campos: lo que cada llamada unida manda y espera contra lo que declara el endpoint.
  var ETIQUETAS = { mandaYElBackNoDeclara: "manda y el back no declara", requeridosQueNoManda: "requeridos que no manda", opcionalesQueElBackRequiere: "manda como opcionales y el back los requiere", esperaYNoViene: "espera y no vienen", opcionalesQueNoVienen: "opcionales que no vienen", distintoNombre: "distinto nombre" };
  var LADOS = { cuerpo: "Cuerpo", query: "Query", respuesta: "Respuesta" };
  function camposHtml(ds, dif) {
    if (ds.every(function (d) { return !d.campos; })) return '<p class="aviso">Esta deriva no trae la comparación de campos: recompilá con una versión nueva de FlowBrain.</p>';
    var unidas = 0, comparadas = 0, sinDif = 0, total = 0, noComp = [], viejo = [];
    ds.forEach(function (d) {
      if (!d.campos) return;
      unidas += d.campos.llamadasUnidas; comparadas += d.campos.comparadas; sinDif += d.campos.sinDiferencias; total += d.difieren.length;
      noComp = noComp.concat(d.campos.noComparables);
      viejo = viejo.concat(d.avisos.filter(function (a) { return a.indexOf("no trae los campos") >= 0; }));
    });
    if (!unidas) return '<p class="aviso">Ninguna llamada ' + (ds.length > 1 ? "de estos cerebros" : "de este cerebro") + " está unida a un endpoint, así que no hay campos que comparar.</p>";
    var resumen = "<p><small>" + plural(unidas, "llamada unida", "llamadas unidas") + " a un endpoint; " + plural(comparadas, "se comparó", "se compararon") + " (" + sinDif.toLocaleString("es") + " sin diferencias). Se compara el primer nivel del objeto, por nombre.</small></p>";
    var filas = dif.length ? listaCortada("campos", dif, function (it) {
      var x = it.x;
      var notas = ["cuerpo", "query", "respuesta"].filter(function (k) { return x[k]; }).map(function (k) {
        var o = x[k];
        var partes = Object.keys(ETIQUETAS).filter(function (e) { return o[e]; }).map(function (e) { return ETIQUETAS[e] + ": " + o[e].map(function (c) { return "<code>" + esc(c) + "</code>"; }).join(", "); });
        return '<div class="fd-nota">' + LADOS[k] + " (<code>" + esc(o.front) + "</code> → <code>" + esc(o.back) + "</code>): " + partes.join(" · ") + "</div>";
      }).join("");
      return "<li><code>" + esc(x.l) + "</code> <small>→ <code>" + esc(x.c ? x.c + "/" + pieza(x.e) : pieza(x.e)) + "</code> · llama <code>" + esc(x.ev) + "</code> · atiende <code>" + esc(x.eb) + "</code></small>" + conCerebro(it) + notas + "</li>";
    }) : total ? ninguno() : comparadas ? '<p class="fd-ok">En lo que se pudo comparar, lo que se manda y se espera coincide con lo que declara el back.</p>' : "";
    var nc = noComp.length
      ? '<h4>No se pudieron comparar <small>no cuentan como coincidencia</small></h4><ul class="lista">' + noComp.map(function (n) { return "<li>" + LADOS[n.lado] + ": " + esc(n.motivo) + " <small>" + plural(n.llamadas, "llamada", "llamadas") + (n.tipos ? " · " + n.tipos.map(function (t) { return "<code>" + esc(t) + "</code>"; }).join(", ") : "") + "</small></li>"; }).join("") + "</ul>"
      : "";
    // Un índice anterior no trae lo que manda cada llamada: que se lea acá, no solo en los avisos.
    return (viejo.length ? '<p class="aviso">' + esc(viejo[0]) + "</p>" : "") + resumen + filas + nc;
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
  var rotulo = function (n) { var c = cerebroDe(n.id); return (c && CEREBROS.length > 1 ? c + " · " : "") + n.n + " (" + plural(piezas(n.id, "endpoint").length, "endpoint", "endpoints") + (piezas(n.id, "pantalla").length ? ", " + plural(piezas(n.id, "pantalla").length, "pantalla", "pantallas") : "") + ")"; };
  // ---------- Paridad con filtro y estadística ----------
  // Cada pieza de la comparación es un ítem: lo que falta migrar, lo migrado que toca otras tablas, lo que solo está en el
  // nuevo y las tablas que el nuevo todavía no toca.
  var TIPOS_P = [["falta", "Faltan migrar"], ["difiere", "Tocan tablas distintas"], ["solo", "Solo en el nuevo"], ["tabla", "Tablas sin migrar"]];
  var CLASE = { endpoint: "Endpoint", pantalla: "Pantalla", tabla: "Tabla" };
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
    pre: "ct", clave: "flowbrain.contratos.paridad", unidad: ["pieza", "piezas", "f"], todos: "todo lo que difiere entre los dos",
    items: function () { return comparacion().items; },
    grupos: [{ id: "", etiqueta: "Todo" }].concat(TIPOS_P.map(function (t) { return { id: t[0], etiqueta: t[1], palabra: t[1].toLowerCase(), es: function (x) { return x.t === t[0]; } }; })),
    buscar: { ph: "Buscar una ruta o una tabla…", texto: function (x) { return x.texto; } },
    campos: [
      { id: "clase", etiqueta: "Tipo", propio: "el tipo elegido", de: function (x) { return x.clase; }, etiquetaDe: function (v) { return CLASE[v] || v; }, palabra: function (v) { return "solo " + (CLASE[v] || v).toLowerCase() + "s"; } },
      { id: "metodo", etiqueta: "Método", propio: "el método elegido", ordenPorCantidad: true, de: function (x) { return x.m; }, palabra: function (v) { return "método " + v; } },
      { id: "prefijo", etiqueta: "Ruta que empieza con", todos: "Cualquiera", propio: "el prefijo elegido", ordenPorCantidad: true, de: function (x) { return x.pre; }, palabra: function (v) { return "ruta " + v; } }
    ],
    paneles: [
      { titulo: "Por tipo", campo: "clase" },
      { titulo: "Por método", campo: "metodo", sinValor: "pantallas y tablas no tienen método" },
      { titulo: "Por comienzo de la ruta", campo: "prefijo", max: 8 }
    ],
    alCambiar: function (todo) { refrescar(todo); }
  });
  var accesos = function (xs) { return xs.map(function (a) { var i = a.indexOf(" "); return (a.slice(0, i) === "lee_de" ? "lee " : "escribe en ") + "<code>" + esc(nombre(a.slice(i + 1))) + "</code>"; }).join(", "); };
  function bloque(que, clase, uno, varios, r, xs) {
    if (!r.viejo && !r.nuevo) return "";
    var pct = r.viejo ? Math.round((100 * r.migrados) / r.viejo) : 0, S2 = flP.S(), ve = function (t) { return !S2.grupo || S2.grupo === t; };
    var de = function (t) { return xs.filter(function (x) { return x.clase === clase && x.t === t; }); };
    var faltan = de("falta"), solo = de("solo"), dif = de("difiere");
    var item = function (x) { return "<li><code>" + esc(pieza(x.id)) + "</code></li>"; };
    var vacio = function (n, texto) { return n ? '<p class="aviso">Ninguno coincide con ' + esc(flP.activos().join(", ")) + ".</p>" : '<p class="fd-ok">' + texto + "</p>"; };
    return "<h2>" + que + "</h2>" +
      '<div class="fd-cifras">' + cifra(r.migrados + " de " + r.viejo.toLocaleString("es"), varios + " ya están del otro lado (" + pct + " %)", pct === 100 ? "var(--bien)" : "") +
      cifra(r.faltan.length, "faltan migrar", r.faltan.length ? "var(--atencion)" : "var(--bien)") + cifra(r.soloEnNuevo.length, "solo en el nuevo") +
      (clase === "endpoint" ? cifra(r.difieren.length, "migrados que tocan tablas distintas", r.difieren.length ? "var(--atencion)" : "") : "") + "</div>" +
      '<div class="fd-pista ct-barra" role="img" aria-label="' + pct + ' % migrado"><span class="fd-relleno" style="width:' + pct + '%;background:var(--bien)"></span></div>' +
      (ve("falta") ? seccion("Faltan migrar", faltan.length, faltan.length ? listaCortada(que + ":faltan", faltan, item) : vacio(r.faltan.length, "No falta ninguno: todos los " + varios + " del viejo están en el nuevo."), faltan.length > 0 && faltan.length <= 40) : "") +
      (ve("difiere") && r.difieren.length ? seccion("Migrados que tocan tablas distintas", dif.length,
        "<p><small>El mismo " + uno + " de cada lado no lee o escribe las mismas tablas: puede ser un cambio buscado o algo que quedó sin migrar.</small></p>" +
        (dif.length ? listaCortada(que + ":difieren", dif, function (it) {
          var x = it.x;
          return "<li><code>" + esc(pieza(x.viejo)) + "</code>" +
            (x.soloViejo.length ? '<div class="fd-nota">Solo el viejo ' + accesos(x.soloViejo) + "</div>" : "") +
            (x.soloNuevo.length ? '<div class="fd-nota">Solo el nuevo ' + accesos(x.soloNuevo) + "</div>" : "") + "</li>";
        }) : vacio(1, "")), false) : "") +
      (ve("solo") ? seccion("Solo en el nuevo", solo.length, solo.length ? listaCortada(que + ":solo", solo, item) : vacio(r.soloEnNuevo.length, "El nuevo no tiene " + varios + " que el viejo no tenga."), false) : "");
  }
  function listaParidad() {
    var P2 = comparacion(), r = P2.r, xs = flP.filtrar(), S2 = flP.S();
    var tsm = xs.filter(function (x) { return x.t === "tabla"; });
    return flP.resultado(xs) + bloque("Endpoints", "endpoint", "endpoint", "endpoints", r.endpoints, xs) + bloque("Pantallas", "pantalla", "pantalla", "pantallas", r.pantallas, xs) +
      (!S2.grupo || S2.grupo === "tabla" ? "<h2>Tablas</h2>" + seccion("Tablas que el nuevo todavía no toca", tsm.length,
        tsm.length ? listaCortada("tablas", tsm, function (x) { return "<li><code>" + esc(nombre(x.id)) + "</code></li>"; })
          : r.tablasSinMigrar.length ? '<p class="aviso">Ninguna coincide con ' + esc(flP.activos().join(", ")) + ".</p>" : '<p class="fd-ok">El nuevo ya toca todas las tablas que toca el viejo.</p>', tsm.length > 0 && tsm.length <= 40) : "") +
      '<p class="aviso">Se empareja por método y ruta, sin importar el nombre de los parámetros: algo renombrado figura como faltante de un lado y nuevo del otro. No compara comportamiento.' +
      (r.entre ? " Los dos servicios están en cerebros distintos: las tablas se comparan por nombre, sin guiones ni mayúsculas." : "") + "</p>";
  }
  function vistaParidad() {
    if (SERVICIOS.length < 2) {
      return '<p class="aviso">Para comparar hacen falta dos servicios con endpoints o pantallas, y ' + (SERVICIOS.length ? "solo hay uno (" + esc(SERVICIOS[0].n) + ")" : "no hay ninguno") + ". La paridad compara el servicio que se reemplaza con el que lo reemplaza.</p>";
    }
    var ops = function (actual) { return '<option value="">Elegí un servicio…</option>' + SERVICIOS.map(function (n) { return '<option value="' + esc(n.id) + '"' + (n.id === actual ? " selected" : "") + ">" + esc(rotulo(n)) + "</option>"; }).join(""); };
    var elegir = '<div class="ct-par"><label class="fd-campo" for="ct-viejo"><span class="lbl">El que se reemplaza</span><select id="ct-viejo">' + ops(S.viejo) + "</select></label>" +
      '<button type="button" class="boton" data-acc="invertir" title="Dar vuelta la comparación"' + (S.viejo && S.nuevo ? "" : " disabled") + ">⇄ Invertir</button>" +
      '<label class="fd-campo" for="ct-nuevo"><span class="lbl">El que lo reemplaza</span><select id="ct-nuevo">' + ops(S.nuevo) + "</select></label></div>";
    if (!porId[S.viejo] || !porId[S.nuevo]) return elegir + '<p class="aviso">Elegí los dos servicios: el que se está reemplazando y el que lo reemplaza. Se comparan por método y ruta, y por las tablas que toca cada endpoint.</p>';
    if (S.viejo === S.nuevo) return elegir + '<p class="aviso">Elegiste el mismo servicio de los dos lados: no hay nada que comparar.</p>';
    return elegir + flP.html() + '<div id="ct-lista">' + listaParidad() + "</div>";
  }

  // ---------- Página ----------
  var actual = function () { return S.tab === "deriva" ? flD : flP; };
  function pintar() {
    // Igual que en Impacto: título, para qué sirve la pantalla, y las sub-vistas como pestañas subrayadas (los chips filtran).
    var tabs = '<nav class="pestanas" role="tablist" aria-label="Qué ver">' +
      [["deriva", "Deriva: llamadas rotas y endpoints sin uso"], ["paridad", "Paridad de una migración"]].map(function (t) { return '<button type="button" role="tab" class="pestana' + (S.tab === t[0] ? " on" : "") + '" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</nav>";
    var que = S.tab === "deriva"
      ? '<p class="explica">Lo que se llama y nadie atiende, y lo que se atiende y nadie llama. Sirve para encontrar integraciones rotas y endpoints que se pueden borrar.</p>'
      : '<p class="explica">Qué falta para que un servicio reemplace a otro: qué endpoints y pantallas ya están del otro lado, cuáles no, y en cuáles cambian las tablas.</p>';
    raiz.innerHTML = "<h1>Contratos</h1>" + '<p class="subtitulo">Cómo se hablan los servicios: qué llama cada front o back y quién lo atiende, comparando método, ruta y campos.</p>' + tabs + que + (S.tab === "deriva" ? vistaDeriva() : vistaParidad());
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

  window.brainContratos = { mostrar: pintar, paridad: paridad };
})();
`;

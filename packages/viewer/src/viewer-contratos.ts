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
  var inicial = function () { return { tab: "deriva", cerebro: "", q: "", viejo: "", nuevo: "", ver: {} }; };
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
  var contiene = function (texto, q) { return !q || texto.toLowerCase().indexOf(q) >= 0; };
  // Una lista larga se corta y ofrece seguir: clave identifica la lista.
  function listaCortada(clave, items, fila) {
    if (!items.length) return "";
    var n = S.ver[clave] || PASO, visibles = items.slice(0, n);
    return '<ul class="lista">' + visibles.map(fila).join("") + "</ul>" +
      (items.length > visibles.length ? '<p class="fd-mas"><button type="button" class="btn" data-acc="mas" data-k="' + esc(clave) + '">Mostrar ' + Math.min(PASO, items.length - visibles.length) + " más</button> <small>" + visibles.length + " de " + items.length.toLocaleString("es") + "</small></p>" : "");
  }
  function seccion(titulo, n, cuerpo, abierta) {
    return '<details class="es-feat ct-sec"' + (abierta ? " open" : "") + "><summary><h3>" + titulo + ' <small>' + n.toLocaleString("es") + "</small></h3></summary>" + cuerpo + "</details>";
  }
  var buscador = function (texto) { return '<div class="fd-herr"><input id="ct-q" type="search" placeholder="' + texto + '" aria-label="Buscar" autocomplete="off" value="' + esc(S.q) + '"></div>'; };

  // ---------- Deriva ----------
  function derivaDe() {
    if (!DERIVA || !DERIVA.length) return null;
    if (S.cerebro !== "") for (var i = 0; i < DERIVA.length; i++) if (String(DERIVA[i].c) === S.cerebro) return DERIVA[i];
    return DERIVA[0];
  }
  function llamada(x, extra) {
    return "<li><code>" + esc(x.l) + "</code> <small>desde " + esc(nombre(x.d)) + " · <code>" + esc(x.ev) + "</code></small>" + (extra || "") + "</li>";
  }
  function vistaDeriva() {
    if (!DERIVA) return '<p class="aviso">No hay índice de código, así que no se sabe qué llama cada servicio ni a quién. Corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code> (o <code>flowbrain brains apply</code>).</p>';
    var d = derivaDe(), q = S.q.trim().toLowerCase();
    var selector = DERIVA.length > 1
      ? '<div class="fd-grupos" role="group" aria-label="Cerebro">' + DERIVA.map(function (x) {
          var n = x.sinEndpoint.length + x.sinLlamadas.length, on = x === d;
          return '<button type="button" class="fd-grupo' + (on ? " on" : "") + '" data-cerebro="' + x.c + '" aria-pressed="' + on + '">' + esc(CEREBROS[x.c] ? CEREBROS[x.c].nombre : String(x.c)) + "<small>" + n.toLocaleString("es") + "</small></button>";
        }).join("") + "</div>"
      : "";
    var atendidas = 0;
    d.atendidas.forEach(function (a) { atendidas += a.llamadas; });
    var cifras = '<div class="fd-cifras">' + cifra(d.sinEndpoint.length, "llamadas que nadie atiende", d.sinEndpoint.length ? "var(--dudoso)" : "var(--tabla)") +
      (d.comunicadoCon ? cifra(atendidas, "llamadas que atiende otro cerebro") : "") +
      (d.disputadas.length ? cifra(d.disputadas.length, "en disputa entre cerebros", "var(--feat)") : "") +
      cifra(d.sinLlamadas.length, "endpoints que nadie llama", d.sinLlamadas.length ? "var(--feat)" : "") +
      (d.campos && d.campos.llamadasUnidas ? cifra(d.campos.conDiferencias, "con campos que no coinciden", d.campos.conDiferencias ? "var(--dudoso)" : "var(--tabla)") : "") + "</div>";
    var cruce = d.comunicadoCon === null ? ""
      : d.comunicadoCon.length ? '<p class="subtitulo">Cruzado con ' + d.comunicadoCon.map(esc).join(", ") + ": lo que atiende o llama uno de esos cerebros no cuenta como deriva." +
        (d.internas ? " Tampoco " + (d.internas === 1 ? "la llamada" : "las " + d.internas.toLocaleString("es") + " llamadas") + " al propio servidor que <code>flowbrain.yaml</code> declara " + (d.internas === 1 ? "interna" : "internas") + " (<code>internas</code>)." : "") + "</p>"
      : '<p class="aviso">Este cerebro no tiene la comunicación activa con ningún otro: todo lo que llame afuera figura como sin endpoint. Se activa en <code>flowbrain.yaml</code> (<code>comunicacion</code>).</p>';

    var sinEp = d.sinEndpoint.filter(function (x) { return contiene(x.l + " " + x.ev + " " + nombre(x.d), q); });
    var sinEpHtml = d.sinEndpoint.length
      ? "<p><small>La ruta ya no existe, cambió de método, o el servicio que la atiende no está indexado" + (d.comunicadoCon ? " ni comunicado" : "") + ".</small></p>" +
        (sinEp.length ? listaCortada("sinEndpoint", sinEp, function (x) {
          return llamada(x, x.o ? '<div class="fd-nota">Existe con otro método: ' + x.o.map(function (id) { return "<code>" + esc(pieza(id)) + "</code>"; }).join(", ") + "</div>" : "");
        }) : '<p class="aviso">Ninguna coincide con «' + esc(S.q.trim()) + "».</p>")
      : '<p class="fd-ok">Todas las llamadas con ruta tienen quién las atienda.</p>';

    var atHtml = d.atendidas.length
      ? '<ul class="lista">' + d.atendidas.map(function (a) { return "<li>" + esc(a.cerebro) + " <small>" + plural(a.llamadas, "llamada", "llamadas") + " a " + plural(a.endpoints, "endpoint", "endpoints") + "</small></li>"; }).join("") + "</ul>"
      : "";

    var disp = d.disputadas.concat(d.ambiguas).filter(function (x) { return contiene(x.l + " " + x.ev, q); });
    var dispHtml = disp.length
      ? "<p><small>Coinciden con más de un endpoint y no se unieron a ninguno. Entre cerebros se resuelve declarando a qué servicio va cada base de URL (<code>flowbrain evidence</code>).</small></p>" +
        listaCortada("disputadas", disp, function (x) { return llamada(x, '<div class="fd-nota">Candidatos: ' + x.k.map(function (k) { return "<code>" + esc(k) + "</code>"; }).join(", ") + "</div>"); })
      : "";

    // Endpoints sin llamadas, por servicio, con quién lo llama.
    var svcs = Object.keys(d.consumidores).sort();
    var porSvc = svcs.map(function (s) {
      var suyos = d.sinLlamadas.filter(function (x) { return x.e.indexOf(s + ":") === 0; }), cons = d.consumidores[s];
      var filtrados = suyos.filter(function (x) { return contiene(pieza(x.e) + " " + x.ev, q); });
      var cab = "<h4>" + esc(nombre(s)) + " <small>" + (cons.length ? "lo llaman " + cons.map(function (c) { return esc(porId[c] ? nombre(c) : c); }).join(", ") : "sin consumidores indexados") + "</small></h4>";
      if (!cons.length) return cab + '<p class="aviso">Nadie indexado llama a este servicio, así que no se puede decir qué endpoints suyos no se usan. Falta indexar a quien lo consume, o activar la comunicación con su cerebro.</p>';
      if (!suyos.length) return cab + '<p class="fd-ok">Todos sus endpoints tienen al menos una llamada.</p>';
      return cab + (filtrados.length ? listaCortada("sinLlamadas:" + s, filtrados, function (x) { return "<li><code>" + esc(pieza(x.e)) + "</code>" + (x.ev ? " <small><code>" + esc(x.ev) + "</code></small>" : "") + "</li>"; }) : '<p class="aviso">Ninguno coincide con «' + esc(S.q.trim()) + "».</p>");
    }).join("");
    var sinLlHtml = svcs.length ? "<p><small>Candidatos a borrar, o llamados por algo que no está indexado. Antes de borrar uno, revisá su impacto.</small></p>" + porSvc
      : '<p class="aviso">Este cerebro no tiene servicios con endpoints: no hay nada que alguien pueda dejar de llamar.</p>';

    // Campos: lo que cada llamada unida manda y espera contra lo que declara el endpoint.
    var ETIQUETAS = { mandaYElBackNoDeclara: "manda y el back no declara", requeridosQueNoManda: "requeridos que no manda", opcionalesQueElBackRequiere: "manda como opcionales y el back los requiere", esperaYNoViene: "espera y no vienen", opcionalesQueNoVienen: "opcionales que no vienen", distintoNombre: "distinto nombre" };
    var LADOS = { cuerpo: "Cuerpo", query: "Query", respuesta: "Respuesta" };
    var camposHtml;
    if (!d.campos) camposHtml = '<p class="aviso">Esta deriva no trae la comparación de campos: recompilá con una versión nueva de FlowBrain.</p>';
    else if (!d.campos.llamadasUnidas) camposHtml = '<p class="aviso">Ninguna llamada de este cerebro está unida a un endpoint, así que no hay campos que comparar.</p>';
    else {
      var dif = d.difieren.filter(function (x) { return contiene(x.l + " " + x.ev + " " + x.e + " " + JSON.stringify([x.cuerpo, x.query, x.respuesta]), q); });
      var resumen = "<p><small>" + plural(d.campos.llamadasUnidas, "llamada unida", "llamadas unidas") + " a un endpoint; " + plural(d.campos.comparadas, "se comparó", "se compararon") + " (" + d.campos.sinDiferencias.toLocaleString("es") + " sin diferencias). Se compara el primer nivel del objeto, por nombre.</small></p>";
      var filas = dif.length ? listaCortada("campos", dif, function (x) {
        var notas = ["cuerpo", "query", "respuesta"].filter(function (k) { return x[k]; }).map(function (k) {
          var o = x[k];
          var partes = Object.keys(ETIQUETAS).filter(function (e) { return o[e]; }).map(function (e) { return ETIQUETAS[e] + ": " + o[e].map(function (c) { return "<code>" + esc(c) + "</code>"; }).join(", "); });
          return '<div class="fd-nota">' + LADOS[k] + " (<code>" + esc(o.front) + "</code> → <code>" + esc(o.back) + "</code>): " + partes.join(" · ") + "</div>";
        }).join("");
        return "<li><code>" + esc(x.l) + "</code> <small>→ <code>" + esc(x.c ? x.c + "/" + pieza(x.e) : pieza(x.e)) + "</code> · llama <code>" + esc(x.ev) + "</code> · atiende <code>" + esc(x.eb) + "</code></small>" + notas + "</li>";
      }) : d.difieren.length ? '<p class="aviso">Ninguna coincide con «' + esc(S.q.trim()) + "».</p>" : d.campos.comparadas ? '<p class="fd-ok">En lo que se pudo comparar, lo que se manda y se espera coincide con lo que declara el back.</p>' : "";
      var noComp = d.campos.noComparables.length
        ? '<h4>No se pudieron comparar <small>no cuentan como coincidencia</small></h4><ul class="lista">' + d.campos.noComparables.map(function (n) { return "<li>" + LADOS[n.lado] + ": " + esc(n.motivo) + " <small>" + plural(n.llamadas, "llamada", "llamadas") + (n.tipos ? " · " + n.tipos.map(function (t) { return "<code>" + esc(t) + "</code>"; }).join(", ") : "") + "</small></li>"; }).join("") + "</ul>"
        : "";
      // Un índice anterior no trae lo que manda cada llamada: que se lea acá, no solo en los avisos.
      var viejo = d.avisos.filter(function (a) { return a.indexOf("no trae los campos") >= 0; });
      camposHtml = (viejo.length ? '<p class="aviso">' + esc(viejo[0]) + "</p>" : "") + resumen + filas + noComp;
    }

    var avisos = d.avisos.length ? seccion("Lo que no se pudo medir", d.avisos.length, '<ul class="lista">' + d.avisos.map(function (a) { return "<li><small>" + esc(a) + "</small></li>"; }).join("") + "</ul>", false) : "";
    return selector + cruce + cifras + buscador("Buscar una ruta, un servicio o un archivo…") +
      seccion("Llamadas que nadie atiende", d.sinEndpoint.length, sinEpHtml, true) +
      (atHtml ? seccion("Las atiende otro cerebro", atendidas, "<p><small>No son deriva: están unidas a un endpoint de un cerebro comunicado.</small></p>" + atHtml, false) : "") +
      (dispHtml ? seccion("Coinciden con varios endpoints", d.disputadas.length + d.ambiguas.length, dispHtml, true) : "") +
      seccion("Endpoints que nadie llama", d.sinLlamadas.length, sinLlHtml, true) +
      seccion("Campos que no coinciden", d.campos ? d.campos.conDiferencias : 0, camposHtml, true) + avisos;
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
  function bloque(que, uno, varios, r, q) {
    if (!r.viejo && !r.nuevo) return "";
    var pct = r.viejo ? Math.round((100 * r.migrados) / r.viejo) : 0;
    var filtra = function (ids) { return ids.filter(function (id) { return contiene(pieza(id), q); }); };
    var faltan = filtra(r.faltan), solo = filtra(r.soloEnNuevo), dif = r.difieren.filter(function (x) { return contiene(pieza(x.viejo) + " " + x.soloViejo.join(" ") + " " + x.soloNuevo.join(" "), q); });
    var item = function (id) { return "<li><code>" + esc(pieza(id)) + "</code></li>"; };
    var vacio = function (n, texto) { return n ? '<p class="aviso">Ninguno coincide con «' + esc(S.q.trim()) + "».</p>" : '<p class="fd-ok">' + texto + "</p>"; };
    var accesos = function (xs) { return xs.map(function (a) { var i = a.indexOf(" "); return (a.slice(0, i) === "lee_de" ? "lee " : "escribe en ") + "<code>" + esc(nombre(a.slice(i + 1))) + "</code>"; }).join(", "); };
    return "<h2>" + que + "</h2>" +
      '<div class="fd-cifras">' + cifra(r.migrados + " de " + r.viejo.toLocaleString("es"), varios + " ya están del otro lado (" + pct + " %)", pct === 100 ? "var(--tabla)" : "") +
      cifra(r.faltan.length, "faltan migrar", r.faltan.length ? "var(--dudoso)" : "var(--tabla)") + cifra(r.soloEnNuevo.length, "solo en el nuevo") +
      (que === "Endpoints" ? cifra(r.difieren.length, "migrados que tocan tablas distintas", r.difieren.length ? "var(--feat)" : "") : "") + "</div>" +
      '<div class="fd-pista ct-barra" role="img" aria-label="' + pct + ' % migrado"><span class="fd-relleno" style="width:' + pct + '%;background:var(--tabla)"></span></div>' +
      seccion("Faltan migrar", r.faltan.length, faltan.length ? listaCortada(que + ":faltan", faltan, item) : vacio(r.faltan.length, "No falta ninguno: todos los " + varios + " del viejo están en el nuevo."), r.faltan.length > 0 && r.faltan.length <= 40) +
      (r.difieren.length ? seccion("Migrados que tocan tablas distintas", r.difieren.length,
        "<p><small>El mismo " + uno + " de cada lado no lee o escribe las mismas tablas: puede ser un cambio buscado o algo que quedó sin migrar.</small></p>" +
        (dif.length ? listaCortada(que + ":difieren", dif, function (x) {
          return "<li><code>" + esc(pieza(x.viejo)) + "</code>" +
            (x.soloViejo.length ? '<div class="fd-nota">Solo el viejo ' + accesos(x.soloViejo) + "</div>" : "") +
            (x.soloNuevo.length ? '<div class="fd-nota">Solo el nuevo ' + accesos(x.soloNuevo) + "</div>" : "") + "</li>";
        }) : vacio(1, "")), false) : "") +
      seccion("Solo en el nuevo", r.soloEnNuevo.length, solo.length ? listaCortada(que + ":solo", solo, item) : vacio(r.soloEnNuevo.length, "El nuevo no tiene " + varios + " que el viejo no tenga."), false);
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
    var r = paridad(S.viejo, S.nuevo), q = S.q.trim().toLowerCase();
    var tsm = r.tablasSinMigrar.filter(function (t) { return contiene(nombre(t), q); });
    return elegir + buscador("Buscar una ruta o una tabla…") +
      bloque("Endpoints", "endpoint", "endpoints", r.endpoints, q) + bloque("Pantallas", "pantalla", "pantallas", r.pantallas, q) +
      "<h2>Tablas</h2>" + seccion("Tablas que el nuevo todavía no toca", r.tablasSinMigrar.length,
        tsm.length ? listaCortada("tablas", tsm, function (t) { return "<li><code>" + esc(nombre(t)) + "</code></li>"; })
          : r.tablasSinMigrar.length ? '<p class="aviso">Ninguna coincide con «' + esc(S.q.trim()) + "».</p>" : '<p class="fd-ok">El nuevo ya toca todas las tablas que toca el viejo.</p>', r.tablasSinMigrar.length > 0 && r.tablasSinMigrar.length <= 40) +
      '<p class="aviso">Se empareja por método y ruta, sin importar el nombre de los parámetros: algo renombrado figura como faltante de un lado y nuevo del otro. No compara comportamiento.' +
      (r.entre ? " Los dos servicios están en cerebros distintos: las tablas se comparan por nombre, sin guiones ni mayúsculas." : "") + "</p>";
  }

  // ---------- Página ----------
  function pintar() {
    var tabs = '<div class="fd-grupos" role="tablist" aria-label="Qué ver">' +
      [["deriva", "Deriva"], ["paridad", "Paridad de una migración"]].map(function (t) { return '<button type="button" role="tab" class="fd-grupo' + (S.tab === t[0] ? " on" : "") + '" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div>";
    var que = S.tab === "deriva"
      ? '<p class="subtitulo">Lo que se llama y nadie atiende, y lo que se atiende y nadie llama. Sirve para encontrar integraciones rotas y endpoints que se pueden borrar.</p>'
      : '<p class="subtitulo">Qué falta para que un servicio reemplace a otro: qué endpoints y pantallas ya están del otro lado, cuáles no, y en cuáles cambian las tablas.</p>';
    raiz.innerHTML = "<h1>Contratos</h1>" + tabs + que + (S.tab === "deriva" ? vistaDeriva() : vistaParidad());
  }
  function refrescar() { S.ver = {}; guardar(); pintar(); }

  raiz.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc");
    if (acc === "mas") { var k = b.getAttribute("data-k"); S.ver[k] = (S.ver[k] || PASO) + PASO; pintar(); return; }
    if (acc === "invertir") { var t = S.viejo; S.viejo = S.nuevo; S.nuevo = t; refrescar(); return; }
    if (b.hasAttribute("data-tab")) { S.tab = b.getAttribute("data-tab"); S.q = ""; refrescar(); return; }
    if (b.hasAttribute("data-cerebro")) { S.cerebro = b.getAttribute("data-cerebro"); refrescar(); }
  });
  raiz.addEventListener("change", function (ev) {
    var id = ev.target.id || "";
    if (id === "ct-viejo") { S.viejo = ev.target.value; refrescar(); }
    else if (id === "ct-nuevo") { S.nuevo = ev.target.value; refrescar(); }
  });
  // La búsqueda repinta la vista entera: después se devuelve el foco al campo, con el cursor al final.
  raiz.addEventListener("input", function (ev) {
    if (ev.target.id !== "ct-q") return;
    S.q = ev.target.value; refrescar();
    var e = elem("ct-q");
    if (e && e.focus) { e.focus(); if (e.setSelectionRange) e.setSelectionRange(S.q.length, S.q.length); }
  });

  window.brainContratos = { mostrar: pintar, paridad: paridad };
})();
`;

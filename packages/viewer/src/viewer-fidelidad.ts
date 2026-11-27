/**
 * "Fidelidad" (`#/fidelidad`): qué tan entendido quedó cada archivo por el índice, de 0 a 100, y qué hacer para
 * llevarlo a 100. Cada fila se explica sola: la cadena de trazabilidad (qué eslabón quedó unido, cuál se corta y cuál
 * no aplica), y por cada cosa que falta, qué pasa, qué hacer y quién lo resuelve. Lo que se resuelve con un dato que
 * una persona conoce se hace ahí mismo (si la página la sirve `flowbrain viewer --serve`); lo demás se suma al pedido
 * al agente, el componente único del visor (`window.brainPedido`, dec. 231): «Pedir» en cada archivo o «Pedir los N de
 * la lista», con las relaciones marcadas, y de ahí sale en lote (o como .md). La estadística y los filtros están
 * siempre a la vista. Un vacío siempre dice por qué.
 * JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const FIDELIDAD_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("fidelidad");
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var F = D.fidelidad, CEREBROS = D.cerebros || [];
  var filas = F ? F.archivos : [];
  // Fidelidad incierta: archivos sin ninguna relación para medir. No tienen puntaje ni entran al promedio.
  var INC = F ? F.inciertos || [] : [];
  // Los textos se eligen al pintar (L): por eso son funciones y no tablas armadas al cargar.
  var POR_QUE = function (m) {
    return m === 0
      ? L("The index found nothing here: no symbols, no calls, no accesses. It is usually configuration, data or a language no parser reads.", "El índice no encontró nada acá: ni símbolos, ni llamadas, ni accesos. Suele ser configuración, datos o un lenguaje que ningún parser lee.")
      : L("The index saw code, but no relationship to measure: no calls, HTTP, tables, endpoints or screens. It is usually a types or constants file; if not, there is something the parser could not read.", "El índice vio código, pero ninguna relación para medir: ni llamadas, ni HTTP, ni tablas, ni endpoints, ni pantallas. Suele ser un archivo de tipos o constantes; si no lo es, hay algo que el parser no supo leer.");
  };
  var SIGNAL_EN = { llamadas: "Calls between methods", http: "HTTP calls", datos: "Table accesses", entradas: "Endpoint flow", contrato: "Response type", pantallas: "Screens with calls" };
  var SIGNAL_ES = { llamadas: "Llamadas entre métodos", http: "Llamadas HTTP", datos: "Accesos a tablas", entradas: "Recorrido de endpoints", contrato: "Tipo de respuesta", pantallas: "Pantallas con llamadas" };
  var SIGNAL = function (s) { return L(SIGNAL_EN[s], SIGNAL_ES[s]); };
  var MIDE_EN = {
    llamadas: "calls the index could attribute to their target",
    http: "HTTP calls linked to an endpoint or an external",
    datos: "table accesses with page and columns",
    entradas: "endpoints whose flow reaches a table, a service or a queue",
    contrato: "endpoints with a response type",
    pantallas: "screens that lead to an HTTP call"
  };
  var MIDE_ES = {
    llamadas: "llamadas que el índice pudo atribuir a su destino",
    http: "llamadas HTTP unidas a un endpoint o a un externo",
    datos: "accesos a tablas con página y columnas",
    entradas: "endpoints cuyo recorrido llega a una tabla, un servicio o una cola",
    contrato: "endpoints con tipo de respuesta",
    pantallas: "pantallas desde las que se llega a una llamada HTTP"
  };
  var MIDE = function (s) { return L(MIDE_EN[s], MIDE_ES[s]); };
  var ORDEN_SIGNAL = ["llamadas", "http", "datos", "entradas", "contrato", "pantallas"];
  // La cadena de trazabilidad: del producto a los datos. Cada eslabón junta una o dos signals.
  var CADENA = [[["Screen", "Pantalla"], ["pantallas"]], [["HTTP", "HTTP"], ["http"]], [["Endpoint", "Endpoint"], ["entradas", "contrato"]], [["Calls", "Llamadas"], ["llamadas"]], [["Data", "Datos"], ["datos"]]];
  var CAPA_EN = { entrada: "Entry", logica: "Logic", dominio: "Domain", datos: "Data", interfaz: "Interface", otros: "Other" };
  var CAPA_ES = { entrada: "Entrada", logica: "Lógica", dominio: "Dominio", datos: "Datos", interfaz: "Interfaz", otros: "Otros" };
  var capa = function (k) { return L(CAPA_EN[k], CAPA_ES[k]) || k; };
  var TRAMOS = [[0, 19], [20, 39], [40, 59], [60, 79], [80, 99], [100, 100]];
  var NINGUNA = "__ninguna";
  var PASO = 100;
  var S = null, fl = null;
  // Edición: solo cuando la página la sirve flowbrain viewer --serve.
  var ED = window.FLOWBRAIN_EDICION || null;
  // abierto: { a: archivo, que: "llamadas" | "http" }. MSG: { a, texto, ... }.
  var abierto = null, DET = null, MSG = null, ocupado = false;
  // El pedido al agente: el componente único del visor (viewer-pedido). TANDA: los archivos de una tanda del lote en el servidor.
  var PD = window.brainPedido, TANDA = 10;

  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
  var archivos = function (n) { return plural(n, L("file", "archivo"), L("files", "archivos")); };
  var tono = function (p) { return p < 40 ? "var(--mal)" : p < 80 ? "var(--atencion)" : "var(--bien)"; };
  var promedio = function (xs) { if (!xs.length) return null; var s = 0; xs.forEach(function (x) { s += x.p; }); return Math.round((10 * s) / xs.length) / 10; };
  var cerebroDe = function (x) { return x.c !== undefined && CEREBROS[x.c] ? CEREBROS[x.c].nombre : ""; };
  // "cerebro/repo-x:src/a.ts" → { repo: "repo-x", ruta: "src/a.ts" }
  var partes = function (x) {
    var c = cerebroDe(x), a = c && x.a.indexOf(c + "/") === 0 ? x.a.slice(c.length + 1) : x.a, i = a.indexOf(":");
    return { repo: i < 0 ? "" : a.slice(0, i), ruta: i < 0 ? a : a.slice(i + 1) };
  };
  // El id que conoce el servidor: "repo-x:src/a.ts", sin el cerebro.
  var idServidor = function (x) { var p = partes(x); return p.repo + ":" + p.ruta; };
  var porArchivo = function (a) { for (var i = 0; i < filas.length; i++) if (filas[i].a === a) return filas[i]; return null; };
  var nombreFeat = function (id) { return porId[id] ? porId[id].n : id; };
  // en: el plan para el modelo va siempre en inglés; lo visible sigue al idioma.
  var lineas = function (ls, en) { return ls.length > 6 ? "L" + ls.slice(0, 6).join(", L") + (en ? " and " + (ls.length - 6) + " more" : L(" and " + (ls.length - 6) + " more", " y " + (ls.length - 6) + " más")) : "L" + ls.join(", L"); };
  var paraVos = function (x) { return x.t.some(function (t) { return t[1] === 1; }); };
  var paraAgente = function (x) { return x.t.some(function (t) { return t[1] === 0; }); };
  var enGrupo = function (x, g) { return g === "vos" ? paraVos(x) : g === "agente" ? paraAgente(x) : g === "completos" ? !x.t.length : g === "incierta" ? false : true; };

  // ---------- Filtro y estadística: el componente compartido (viewer-filtros) ----------
  // El grupo de fidelidad incierta no tiene puntaje: los paneles lo ignoran y miden los archivos con los demás filtros.
  // Cada panel cuenta los archivos que pasan todos los filtros menos el suyo (el rango en el reparto, el cerebro en
  // "Por cerebro", la signal en "por signal"): así refleja la lista y sigue sirviendo para elegir otra barra.
  var porCantidad = function (m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }); };
  function contar(clave) {
    var m = {};
    filas.forEach(function (x) { clave(x).forEach(function (k) { m[k] = (m[k] || 0) + 1; }); });
    return m;
  }
  function panelReparto(xs, api) {
    if (!xs.length) return api.vacio();
    var max = 1, cuentas = TRAMOS.map(function (t) { var n = xs.filter(function (x) { return x.p >= t[0] && x.p <= t[1]; }).length; if (n > max) max = n; return n; });
    return TRAMOS.map(function (t, i) {
      return api.barra(t[0] === t[1] ? "100" : t[0] + "–" + t[1], (100 * cuentas[i]) / max, archivos(cuentas[i]), { min: t[0], max: t[1] }, S.min === t[0] && S.max === t[1], tono(t[0]));
    }).join("");
  }
  // Por cerebro es también el selector: siempre están todos, con el elegido marcado y su puntaje promedio.
  function panelCerebros(xs, api) {
    return CEREBROS.map(function (c, i) {
      var suyos = xs.filter(function (x) { return x.c === i; }), p = promedio(suyos);
      if (p === null) {
        var sinIndice = !filas.some(function (x) { return x.c === i; });
        return '<p class="fd-sin"><strong>' + esc(c.nombre) + "</strong> · " + (sinIndice ? L("no code index: no files to measure", "sin índice de código: no hay archivos para medir") : L("no file matches the other filters", "ningún archivo coincide con los demás filtros")) + "</p>";
      }
      return api.barra(esc(c.nombre), p, p + " · " + archivos(suyos.length), { cerebro: String(i) }, S.cerebro === String(i), tono(p));
    }).join("");
  }
  function panelSignals(xs, api) {
    if (!xs.length) return api.vacio();
    var out = ORDEN_SIGNAL.map(function (s) {
      var ok = 0, total = 0, conFalta = 0;
      xs.forEach(function (x) { var v = x.s[s]; if (!v) return; ok += v[0]; total += v[1]; if (v[0] < v[1]) conFalta++; });
      if (!total) return "";
      var pct = Math.round((1000 * ok) / total) / 10;
      return api.barra(SIGNAL(s), pct, pct + "% · " + (conFalta ? plural(conFalta, L("file with gaps", "archivo con falta"), L("files with gaps", "archivos con falta")) : L("no gaps", "sin faltas")), { signal: s }, S.signal === s, tono(pct), SIGNAL(s) + ": " + MIDE(s));
    }).join("");
    if (!out) return '<p class="fd-sin">' + L("These files have no relationships to measure by link.", "Estos archivos no tienen relaciones que medir por eslabón.") + "</p>";
    var noAplican = ORDEN_SIGNAL.filter(function (s) { return !xs.some(function (x) { return x.s[s] && x.s[s][1]; }); });
    return out + (noAplican.length ? '<p class="fd-sin">' + L("Not applicable to these files: ", "No aplican a estos archivos: ") + noAplican.map(SIGNAL).join(", ") + ".</p>" : "");
  }
  // La configuración del filtro se arma una vez; sus textos fijos se ponen en textosFiltro() y se rehacen al cambiar de idioma.
  var CFG = {
    pre: "fd", clave: "flowbrain.fidelidad", unidad: ["file", "files"], todos: "",
    items: function () { return filas; },
    estado: { orden: "asc", ver: PASO },
    grupos: [
      { id: "" },
      { id: "vos", es: paraVos },
      { id: "agente", es: paraAgente },
      { id: "completos", es: function (x) { return !x.t.length; } },
      { id: "incierta", es: function () { return false; }, n: function () { return INC.length; }, ocultarVacio: true, sinPaneles: true }
    ],
    buscar: { ph: "", texto: function (x) { return x.a + " " + x.t.map(function (t) { return t[2]; }).join(" "); } },
    campos: [
      { id: "min", tipo: "numero", min: 0, max: 100, inicial: 0, dim: "puntaje", prueba: function (x, v) { return x.p >= v; }, palabra: function () { return L("score " + S.min + " to " + S.max, "puntaje de " + S.min + " a " + S.max); } },
      { id: "max", tipo: "numero", min: 0, max: 100, inicial: 100, dim: "puntaje", prueba: function (x, v) { return x.p <= v; }, palabra: function () { return L("score " + S.min + " to " + S.max, "puntaje de " + S.min + " a " + S.max); } },
      { id: "cerebro", solo: function () { return CEREBROS.length > 1; }, de: function (x) { return x.c; },
        valores: function () { return CEREBROS.map(function (c, i) { return [i, c.nombre, filas.filter(function (x) { return x.c === i; }).length]; }); },
        palabra: function (v) { return L("brain ", "cerebro ") + (CEREBROS[Number(v)] ? CEREBROS[Number(v)].nombre : v); } },
      { id: "lenguaje", de: function (x) { return x.l; }, palabra: function (v) { return L("type ", "tipo ") + v; },
        valores: function () { var m = contar(function (x) { return [x.l]; }); return porCantidad(m).map(function (k) { return [k, k, m[k]]; }); } },
      { id: "capa", de: function (x) { return x.k; }, palabra: function (v) { return L("layer ", "capa ") + capa(v); },
        valores: function () { var m = contar(function (x) { return [x.k]; }); return porCantidad(m).map(function (k) { return [k, capa(k), m[k]]; }); } },
      { id: "feat", de: function (x) { return x.f; },
        prueba: function (x, v) { return v === NINGUNA ? (x.p === undefined ? !x.f.length : !!x.u) : x.f.indexOf(v) >= 0; },
        palabra: function (v) { return v === NINGUNA ? L("no feature", "sin funcionalidad") : L("feature ", "funcionalidad ") + nombreFeat(v); },
        valores: function () {
          var feats = contar(function (x) { return x.f; }), sinFeat = filas.filter(function (x) { return x.u; }).length;
          var ops = Object.keys(feats).sort(function (a, b) { return nombreFeat(a).toLowerCase() < nombreFeat(b).toLowerCase() ? -1 : 1; }).map(function (id) {
            var c = CEREBROS.length > 1 && id.indexOf("/") > 0 ? " · " + id.slice(0, id.indexOf("/")) : "";
            return [id, nombreFeat(id) + c, feats[id]];
          });
          if (sinFeat) ops.unshift([NINGUNA, L("No feature", "Sin funcionalidad"), sinFeat]);
          return ops;
        } },
      { id: "signal", de: function () { return ""; },
        prueba: function (x, v) { var s = x.s[v]; return !!s && s[0] < s[1]; }, palabra: function (v) { return L("missing: ", "le falta: ") + SIGNAL(v); },
        valores: function () { return ORDEN_SIGNAL.map(function (s) { return [s, SIGNAL(s)]; }); } }
    ],
    paneles: [
      { salvo: "puntaje", html: panelReparto },
      { salvo: "cerebro", html: panelCerebros, solo: function () { return CEREBROS.length > 1; } },
      { salvo: "signal", html: panelSignals }
    ],
    cifras: function () {
      var p = promedio(filas), completos = filas.filter(function (x) { return x.p === 100; }).length;
      return [[p === null ? "—" : String(p), L("average score of what was measured", "puntaje promedio de lo medido"), p === null ? "" : tono(p)], [filas.length, L("files measured", "archivos medidos")], [completos, L("at 100", "en 100")], [filas.length - completos, L("with something to complete", "con algo por completar")], [INC.length, L("of uncertain fidelity", "de fidelidad incierta")]];
    },
    alCambiar: function (todo) { refrescar(todo); }
  };
  // Los textos fijos del filtro, en el idioma actual. Se cambian en el mismo objeto (y la misma lista de unidad), que el
  // componente compartido guardó al crearse.
  function textosFiltro() {
    var g = CFG.grupos, c = CFG.campos, p = CFG.paneles;
    CFG.unidad[0] = L("file", "archivo"); CFG.unidad[1] = L("files", "archivos");
    CFG.todos = L("all measured files", "todos los archivos medidos");
    CFG.buscar.ph = L("Search by path or by what is missing…", "Buscar por ruta o por lo que falta…");
    g[0].etiqueta = L("All", "Todos");
    g[1].etiqueta = L("You resolve it", "Lo resolvés vos"); g[1].palabra = L("what you resolve", "lo que resolvés vos");
    g[2].etiqueta = L("The agent resolves it", "Lo resuelve el agente"); g[2].palabra = L("what the agent resolves", "lo que resuelve el agente");
    g[3].etiqueta = L("Complete", "Completos");
    g[4].etiqueta = L("Uncertain fidelity", "Fidelidad incierta"); g[4].notaPaneles = L("uncertain-fidelity files have no score", "los de fidelidad incierta no tienen puntaje");
    c[0].etiqueta = L("Score from", "Puntaje desde"); c[0].propio = L("the score range", "el rango de puntaje");
    c[1].etiqueta = L("to", "hasta"); c[1].propio = c[0].propio;
    c[2].etiqueta = L("Brain", "Cerebro"); c[2].propio = L("the chosen brain", "el cerebro elegido");
    c[3].etiqueta = L("File type", "Tipo de archivo");
    c[4].etiqueta = L("Layer", "Capa"); c[4].todos = L("All", "Todas");
    c[5].etiqueta = L("Feature", "Funcionalidad"); c[5].todos = L("All", "Todas");
    c[6].etiqueta = L("Missing link", "Eslabón que falta"); c[6].todos = L("Any", "Cualquiera"); c[6].propio = L("the chosen link", "el eslabón elegido");
    p[0].titulo = L("Score distribution", "Reparto por puntaje");
    p[1].titulo = L("By brain", "Por cerebro");
    p[2].titulo = L("What was understood, by link", "Qué se entendió, por eslabón");
  }
  textosFiltro();
  if (window.brainI18n && window.brainI18n.alCambiar) window.brainI18n.alCambiar(textosFiltro);
  fl = window.brainFiltros.crear(CFG);
  S = fl.S();
  if (S.cerebro !== "" && !CEREBROS[Number(S.cerebro)]) S.cerebro = "";
  var coincide = fl.coincide, filtrosActivos = fl.activos, guardar = fl.guardar;
  function filtradas() {
    var out = fl.filtrar();
    out.sort(function (a, b) { return (S.orden === "asc" ? a.p - b.p : b.p - a.p) || b.t.length - a.t.length || (a.a < b.a ? -1 : 1); });
    return out;
  }

  function herramientas() { return fl.html(); }

  // ---------- El tipo «fidelidad» del pedido al agente (viewer-pedido, dec. 231) ----------
  // Un ítem por archivo, con las faltas de las relaciones marcadas en las casillas:
  // { tipo: "fidelidad", k: el archivo como lo ve el visor, cerebro, repo, datos: { a, cerebro, archivo, p, t: [[relación, qué pasa, líneas]] } }.
  // Las casillas: qué relaciones se piden (todas, salvo las que se desmarquen).
  var PL = { signals: {} };
  var pide = function (s) { return PL.signals[s] !== false; };
  // Las faltas de un archivo que se piden: las de las relaciones marcadas (sigs: las de un ítem ya pedido, al ponerlo al día).
  var faltasPedidas = function (x, sigs) { return x.t.filter(function (t) { return sigs ? sigs.indexOf(t[0]) >= 0 : pide(t[0]); }).map(function (t) { return [t[0], t[2], t[4]]; }); };
  function entradaDe(x, sigs) {
    var p = partes(x);
    return { tipo: "fidelidad", k: x.a, cerebro: cerebroDe(x), repo: p.repo, datos: { a: x.a, cerebro: cerebroDe(x), archivo: idServidor(x), p: x.p, t: faltasPedidas(x, sigs) } };
  }
  var claveServidor = function (d) { return d.cerebro + "|" + d.archivo; };
  // El texto para cualquier agente: el mismo plan que arma flowbrain fidelity --plan (reglas, cómo se resuelve cada cosa,
  // archivos con sus faltas y cierre; cada tanda del lote lo arma el servidor con planDeFidelidad). Es una instrucción
  // para el modelo: va siempre en inglés, sin importar el idioma del visor. ds: los datos de los ítems.
  function textoDelPlan(ds) {
    var con = ds.filter(function (d) { return d.t.length; }).sort(function (a, b) { return a.p - b.p || (a.a < b.a ? -1 : 1); });
    if (!con.length) return "";
    var usadas = ORDEN_SIGNAL.filter(function (s) { return con.some(function (d) { return d.t.some(function (t) { return t[0] === s; }); }); });
    var out = ["# Fidelity plan", "",
      "Goal: bring the fidelity score of " + con.length + " " + (con.length === 1 ? "file" : "files") + " in the FlowBrain index to 100 (today they average " + promedio(con) + "). The score measures how much of what is in each file ended up linked in the graph."];
    if (CEREBROS.length > 1) out.push("", "Each file is given as brain/repo:path. What you declare goes in that brain's folder.");
    out.push("", "## Rules", "");
    F.plan.reglas.forEach(function (r) { out.push("- " + r); });
    out.push("", "## How to resolve each thing", "");
    usadas.forEach(function (s) { out.push("- **" + s + "**: " + F.plan.como[s]); });
    out.push("", "## Files");
    con.forEach(function (d) {
      out.push("", "### " + d.a + " (" + d.p + "/100)");
      d.t.forEach(function (t) { out.push("- [ ] " + t[0] + ": " + t[1] + (t[2].length ? " (" + lineas(t[2], true) + ")" : "") + "."); });
    });
    out.push("", "## When done", "");
    F.plan.cierre.forEach(function (c, i) { out.push((i + 1) + ". " + c); });
    return out.join("\n") + "\n";
  }
  // Lo que suma cada botón celeste, según su data-k: «a|<archivo>» o «l|» (la lista filtrada). Solo los que tienen
  // alguna falta de las relaciones marcadas.
  function xsDeBoton(k, memo) {
    if (!k) return [];
    var xs = k.indexOf("a|") === 0 ? [porArchivo(k.slice(2))].filter(Boolean) : k === "l|" ? (memo ? memo.l || (memo.l = filtradas()) : filtradas()) : [];
    return xs.filter(function (x) { return faltasPedidas(x).length; });
  }
  var botonSumar = function (k, xs, et) { return PD.boton({ tipo: "fidelidad", k: k, et: et, claves: xs.map(function (x) { return x.a; }) }); };
  // Cuántas tandas arma el servidor: por cerebro y repo, de hasta TANDA archivos.
  function tandasDeLista(ds) {
    var g = {}, n = 0;
    ds.forEach(function (d) { var k = d.cerebro + "|" + d.archivo.split(":")[0]; g[k] = (g[k] || 0) + 1; });
    Object.keys(g).forEach(function (k) { n += Math.ceil(g[k] / TANDA); });
    return n;
  }
  if (F) PD.registrar("fidelidad", {
    get nombre() { return L("Files to bring to 100", "Archivos a llevar a 100"); },
    unidad: ["file", "files", "archivo", "archivos"],
    raiz: raiz,
    claves: function (k, memo) { return xsDeBoton(k, memo).map(function (x) { return x.a; }); },
    items: function (k) { return xsDeBoton(k).map(function (x) { return entradaDe(x); }); },
    repintar: function () { if (document.getElementById("fd-lista")) pintarLista(); },
    orden: function (a, b) { return a.datos.p - b.datos.p || (a.k < b.k ? -1 : 1); },
    resumen: function (es) {
      var n = es.reduce(function (s, e) { return s + e.datos.t.length; }, 0), ds = es.map(function (e) { return e.datos; });
      return [L(plural(n, "gap", "gaps") + " to resolve · average score " + promedio(ds), plural(n, "falta", "faltas") + " por resolver · puntaje promedio " + promedio(ds)),
        PD.agente && es.length ? L("In " + plural(tandasDeLista(ds), "batch", "batches") + " of up to " + TANDA + " files of the same repo; after each one, the brain is reindexed and the score measured", "En " + plural(tandasDeLista(ds), "tanda", "tandas") + " de hasta " + TANDA + " archivos de un mismo repo; después de cada una se reindexa el cerebro y se mide el puntaje") : ""];
    },
    costo: function (mo) { return typeof mo.costoPorFidelidadUsd === "number" ? mo.costoPorFidelidadUsd : null; },
    lote: function (es) {
      return { tipo: "fidelidad", archivos: es.map(function (e) { var d = e.datos; return { cerebro: d.cerebro, archivo: d.archivo, puntaje: d.p, tareas: d.t.map(function (t) { return { signal: t[0], que: t[1], lineas: t[2] }; }) }; }) };
    },
    md: { archivo: "fidelity-plan.md", texto: function (es) { return textoDelPlan(es.map(function (e) { return e.datos; })); } },
    clave: function (it) { return claveServidor(it.datos); },
    tanda: { lista: "archivos", clave: claveServidor },
    seguimiento: {
      pidiendo: function (n, repos) { return L("Bringing " + plural(n, "file", "files") + " to 100 in " + plural(repos, "repo", "repos"), "Llevando " + plural(n, "archivo", "archivos") + " a 100 en " + plural(repos, "repo", "repos")); },
    },
    // La tarjeta: el archivo, su puntaje, qué le falta (por relación, con sus líneas) y el cerebro.
    tarjeta: function (it) {
      var d = it.datos, x = porArchivo(d.a), ps = x ? partes(x) : { ruta: d.archivo, repo: "" };
      var faltas = d.t.map(function (t) { return '<span class="chip" title="' + esc(t[1]) + '">' + esc(SIGNAL(t[0])) + (t[2].length ? " · " + lineas(t[2]) : "") + "</span>"; }).join("");
      return '<p class="es-texto"><code>' + esc(ps.ruta) + "</code>" + (ps.repo ? " <small>" + esc(ps.repo) + "</small>" : "") + "</p>" +
        '<div class="chips"><span class="chip" style="color:' + tono(d.p) + ";border-color:" + tono(d.p) + '" title="' + L("Fidelity score", "Puntaje de fidelidad") + '">' + d.p + "/100</span>" + faltas +
        (CEREBROS.length > 1 ? '<span class="chip es-cerebro" title="' + L("Brain", "Cerebro") + '">' + esc(d.cerebro) + "</span>" : "") + "</div>";
    }
  });
  // Arriba de la lista: qué relaciones pedir y «Pedir los N de la lista».
  function barraDePedido(xs) {
    var presentes = ORDEN_SIGNAL.filter(function (s) { return xs.some(function (x) { return x.t.some(function (t) { return t[0] === s; }); }); });
    if (!presentes.length) return "";
    var casillas = presentes.map(function (s) {
      var n = xs.filter(function (x) { return x.t.some(function (t) { return t[0] === s; }); }).length;
      return '<label class="fd-casilla" title="' + esc(MIDE(s)) + '"><input type="checkbox" id="fd-pl-s-' + s + '"' + (pide(s) ? " checked" : "") + "> " + SIGNAL(s) + " <small>" + num(n) + "</small></label>";
    }).join("");
    var con = xs.filter(function (x) { return faltasPedidas(x).length; });
    return '<div class="fd-plan"><div class="fd-casillas"><span class="lbl">' + L("Which relationships to request", "Qué relaciones pedir") + "</span>" + casillas + "</div>" +
      '<div class="fd-hacer">' + (con.length ? botonSumar("l|", con, con.length === 1 ? L("Request it", "Pedirlo") : L("Request the " + num(con.length) + " in the list", "Pedir los " + num(con.length) + " de la lista")) : "") +
      "<small>" + (con.length ? L("With the files in the list below, filters applied: the agent declares what is missing in the brain's folder, and the score is measured again.", "Con los archivos de la lista de abajo, con los filtros aplicados: el agente declara lo que falta en la carpeta del cerebro y se vuelve a medir el puntaje.") : L("Check at least one relationship to request the files.", "Marcá al menos una relación para pedir los archivos.")) + "</small></div></div>";
  }

  // ---------- Lista ----------
  function cadena(x) {
    return '<div class="fd-cadena" aria-label="' + L("Traceability", "Trazabilidad") + '">' + CADENA.map(function (e, i) {
      var ok = 0, total = 0;
      e[1].forEach(function (s) { var v = x.s[s]; if (v) { ok += v[0]; total += v[1]; } });
      var cls = !total ? "na" : ok >= total ? "ok" : "no";
      var titulo = !total ? L("Does not apply to this file", "No aplica a este archivo") : e[1].filter(function (s) { return x.s[s]; }).map(function (s) { return SIGNAL(s) + ": " + x.s[s][0] + L(" of ", " de ") + x.s[s][1] + " (" + MIDE(s) + ")"; }).join(" · ");
      return (i ? '<span class="fd-sep" aria-hidden="true">›</span>' : "") + '<span class="fd-es ' + cls + '" title="' + esc(titulo) + '">' + L(e[0][0], e[0][1]) + (cls === "no" && total > 1 ? " " + ok + "/" + total : "") + "</span>";
    }).join("") + "</div>";
  }
  function accion(x, t) {
    if (t[1] !== 1) return '<span class="fd-quien">' + L("The agent resolves it", "Lo resuelve el agente") + "</span>";
    if (!ED) return '<span class="fd-quien vos">' + L("You resolve it", "Lo resolvés vos") + "</span>";
    var a = ' data-a="' + esc(x.a) + '"', on = function (que) { return abierto && abierto.a === x.a && abierto.que === que ? " on" : ""; };
    if (t[0] === "llamadas") return '<button type="button" class="boton' + on("llamadas") + '" data-acc="resolver" data-que="llamadas"' + a + ">" + L("Choose target", "Elegir destino") + "</button>";
    return '<button type="button" class="boton' + on("http") + '" data-acc="resolver" data-que="http"' + a + ">" + L("Write the route", "Escribir la ruta") + "</button>";
  }
  function tarea(x, t) {
    return '<div class="fd-tarea"><div class="fd-que"><p>' + esc(t[2]) + (t[4].length ? ' <span class="fd-ln">' + lineas(t[4]) + "</span>" : "") + ".</p>" +
      '<p class="fd-nota">' + esc(t[3]) + '</p></div><div class="fd-hacer">' + accion(x, t) + "</div></div>" +
      (abierto && abierto.a === x.a && abierto.que === (t[0] === "llamadas" ? t[0] : t[1] === 1 ? "http" : "") ? panel(x) : "");
  }
  function fila(x) {
    var p = partes(x), c = cerebroDe(x);
    var msg = MSG && MSG.a === x.a ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + (MSG.aplicar ? ' <button type="button" class="boton" data-acc="aplicar" data-cerebro="' + esc(MSG.aplicar) + '">' + L("Reindex " + esc(MSG.aplicar) + " now", "Reindexar " + esc(MSG.aplicar) + " ahora") + "</button>" : "") + (MSG.recargar ? ' <button type="button" class="boton" data-acc="recargar">' + L("See the new score", "Ver el puntaje nuevo") + "</button>" : "") + "</p>" : "";
    return '<li class="fd-fila">' +
      '<span class="fd-p" style="color:' + tono(x.p) + ";border-color:" + tono(x.p) + '">' + x.p + "</span>" +
      '<div class="fd-cuerpo"><div class="fd-ruta"><code>' + esc(p.ruta) + "</code>" + (p.repo ? " <small>" + esc(p.repo) + "</small>" : "") + "</div>" +
      '<div class="chips">' + (c && CEREBROS.length > 1 ? '<span class="chip">' + esc(c) + "</span>" : "") + '<span class="chip">' + esc(x.l) + '</span><span class="capa capa-' + esc(x.k) + '">' + esc(capa(x.k)) + "</span>" +
      (x.f.length ? x.f.map(function (id) { return '<a class="chip" href="#/f/' + encodeURIComponent(id) + '">' + esc(nombreFeat(id)) + "</a>"; }).join("") : x.u ? '<a class="chip fd-sinfeat" href="#/sin-asociar" title="' + L("It does not lower the score. Assign it in Unassigned", "No resta puntaje. Se asocia en Sin asociar") + '">' + L("no feature", "sin funcionalidad") + "</a>" : "") + "</div>" +
      cadena(x) +
      (x.t.length ? x.t.map(function (t) { return tarea(x, t); }).join("") : '<p class="fd-ok">' + L("Complete: everything the index saw here is linked.", "Completo: todo lo que el índice vio acá quedó unido.") + "</p>") +
      msg +
      (faltasPedidas(x).length ? '<div class="fd-hacer">' + botonSumar("a|" + x.a, [x], L("Request", "Pedir")) + "<small>" + L("Adds what it is missing to the request to the agent", "Suma lo que le falta al pedido al agente") + "</small></div>" : "") +
      "</div></li>";
  }

  // ---------- Edición ----------
  // "cerebro/feat-x" → "feat-x": el servidor conoce los ids del cerebro, sin el prefijo del visor.
  var idLocal = function (x, id) { var c = cerebroDe(x); return c && id.indexOf(c + "/") === 0 ? id.slice(c.length + 1) : id; };
  function pedir(metodo, ruta, cuerpo) {
    return fetch(ruta, { method: metodo, headers: cuerpo ? { "content-type": "application/json", "x-flowbrain-token": ED.token } : { "x-flowbrain-token": ED.token }, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); });
  }
  function panel(x) {
    if (!DET) return '<div class="fd-ed"><p class="vacio">' + L("Reading the file…", "Leyendo el archivo…") + "</p></div>";
    var html = "";
    if (abierto.que === "llamadas") {
      html = DET.llamadas.length ? DET.llamadas.map(function (l) {
        var donde = '<p class="fd-donde">L' + l.linea + " · " + L("in <code>" + esc(l.desde) + "</code> there is a call to <code>" + esc(l.llamada) + "</code>. Where does it go?", "en <code>" + esc(l.desde) + "</code> se llama a <code>" + esc(l.llamada) + "</code>. ¿A cuál va?") + "</p>";
        var corto = function (k) { var i = k.lastIndexOf("#"); return esc(k.slice(i + 1)) + " <small>" + esc(k.slice(k.indexOf(":") + 1, i)) + "</small>"; };
        if (l.candidatos.length && l.candidatos.length <= 6) {
          return '<div class="fd-pregunta">' + donde + '<div class="fd-opciones">' + l.candidatos.map(function (k) { return '<button type="button" class="boton" data-acc="declarar-llamada" data-linea="' + l.linea + '" data-hacia="' + esc(k) + '">' + corto(k) + "</button>"; }).join("") + "</div></div>";
        }
        var destino = l.candidatos.length
          ? '<select id="fd-l-' + l.linea + '" aria-label="' + L("Which method it goes to", "A qué método va") + '">' + l.candidatos.map(function (k) { var i = k.lastIndexOf("#"); return '<option value="' + esc(k) + '">' + esc(k.slice(i + 1)) + " · " + esc(k.slice(k.indexOf(":") + 1, i)) + "</option>"; }).join("") + "</select>"
          : '<input id="fd-l-' + l.linea + '" type="search" placeholder="' + L("repo:path/File.ext#Class.method", "repo:ruta/Archivo.ext#Clase.metodo") + '" aria-label="' + L("Which method it goes to", "A qué método va") + '" autocomplete="off">';
        return '<div class="fd-pregunta">' + donde + (l.candidatos.length ? "" : '<p class="fd-nota">' + L("The index found no candidates with that name: write it, or leave it to the agent with «Request».", "El índice no encontró candidatos con ese nombre: escribilo, o dejáselo al agente con «Pedir».") + "</p>") + '<div class="fd-linea">' + destino + '<button type="button" class="boton" data-acc="declarar-llamada" data-linea="' + l.linea + '">' + L("Declare", "Declarar") + "</button></div></div>";
      }).join("") : '<p class="fd-nota">' + L("No unresolved calls left in this file.", "Ya no quedan llamadas sin resolver en este archivo.") + "</p>";
    } else {
      html = DET.http.length ? DET.http.map(function (h) {
        if (!h.desde) return '<p class="fd-nota">L' + h.linea + ": " + L("it is not inside a function, so it cannot be declared here. Leave it to the agent with «Request».", "no está dentro de una función, así que no se puede declarar acá. Dejáselo al agente con «Pedir».") + "</p>";
        return '<div class="fd-pregunta"><p class="fd-donde">L' + h.linea + " · " +
          L("in <code>" + esc(h.desde) + "</code> there is a <code>" + esc(h.metodo) + "</code>" + (h.base ? " to <code>" + esc(h.base) + "</code>" : "") + ". Which route does it call?", "en <code>" + esc(h.desde) + "</code> hay un <code>" + esc(h.metodo) + "</code>" + (h.base ? " a <code>" + esc(h.base) + "</code>" : "") + ". ¿A qué ruta llama?") + '</p><div class="fd-linea">' +
          '<input id="fd-h-r-' + h.linea + '" type="search" placeholder="' + L("/orders/{id}", "/pedidos/{id}") + '" aria-label="' + L("Route", "Ruta") + '" autocomplete="off">' +
          '<button type="button" class="boton" data-acc="declarar-http" data-linea="' + h.linea + '" data-metodo="' + esc(h.metodo) + '">' + L("Declare", "Declarar") + "</button></div></div>";
      }).join("") : '<p class="fd-nota">' + L("No HTTP calls without a route left in this file.", "Ya no quedan llamadas HTTP sin ruta en este archivo.") + "</p>";
    }
    return '<div class="fd-ed">' + html + "</div>";
  }
  function resolver(a, que) {
    if (abierto && abierto.a === a && abierto.que === que) { abierto = null; DET = null; pintarLista(); return; }
    abierto = { a: a, que: que }; DET = null; if (MSG && MSG.a !== a) MSG = null; pintarLista();
    var x = porArchivo(a);
    pedir("GET", "/api/archivo?cerebro=" + encodeURIComponent(cerebroDe(x)) + "&archivo=" + encodeURIComponent(idServidor(x)))
      .then(function (d) { if (abierto && abierto.a === a) { DET = d; pintarLista(); } })
      .catch(function (e) { if (abierto && abierto.a === a) { abierto = null; MSG = { a: a, texto: L("Could not read the file: ", "No se pudo leer el archivo: ") + e.message, error: true }; pintarLista(); } });
  }
  function enviar(x, cuerpo) {
    if (ocupado || !x) return;
    cuerpo.cerebro = cerebroDe(x); cuerpo.archivo = idServidor(x);
    ocupado = true; MSG = { a: x.a, texto: L("Saving…", "Guardando…") }; pintarLista();
    pedir("POST", "/api/editar", cuerpo).then(function (r) {
      ocupado = false;
      ED.sinAplicar = r.sinAplicar || [];
      MSG = { a: x.a, texto: r.mensaje + " (" + r.escrito + ")", aplicar: r.faltaReindexar ? cuerpo.cerebro : null, recargar: r.cambio && !r.faltaReindexar };
      pintarLista();
    }).catch(function (e) { ocupado = false; MSG = { a: x.a, texto: e.message, error: true }; pintarLista(); });
  }
  function aplicar(cerebro) {
    if (ocupado) return;
    var a = MSG ? MSG.a : null;
    ocupado = true; MSG = { a: a, texto: L("Reindexing " + cerebro + "… it may take a few seconds.", "Reindexando " + cerebro + "… puede tardar unos segundos.") }; pintarLista(); pintarAviso(L("Reindexing " + cerebro + "…", "Reindexando " + cerebro + "…"));
    pedir("POST", "/api/aplicar", { cerebro: cerebro }).then(function (r) {
      ocupado = false;
      if (r.errores.length) { MSG = { a: a, texto: L("The brain was reindexed with errors: ", "El cerebro se reindexó con errores: ") + r.errores.join("; "), error: true }; pintarLista(); pintarAviso(L("The brain " + cerebro + " was reindexed with errors: ", "El cerebro " + cerebro + " se reindexó con errores: ") + r.errores.join("; ")); return; }
      guardar(); location.reload();
    }).catch(function (e) { ocupado = false; MSG = { a: a, texto: e.message, error: true }; pintarLista(); pintarAviso(null); });
  }
  var elem = function (id) { return document.getElementById(id); };
  var valor = function (id) { var e = elem(id); return e ? String(e.value || "").trim() : ""; };
  // Lo que se declaró y todavía no entró al índice: se dice arriba, con el botón para aplicarlo.
  function aviso(texto) {
    if (!ED) return '<p class="aviso" id="fd-aviso">' + L("This page is read-only: you can see what is missing and add it to the request to the agent (it goes out as a .md). To resolve from here what depends on you, or to send the request to the agent, open it with <code>flowbrain viewer --serve</code>.", "Esta página es de solo lectura: podés ver qué falta y sumarlo al pedido al agente (sale como .md). Para resolver desde acá lo que depende de vos, o para mandarle el pedido al agente, abrila con <code>flowbrain viewer --serve</code>.") + "</p>";
    if (texto) return '<p class="aviso" id="fd-aviso">' + esc(texto) + "</p>";
    if (!ED.sinAplicar || !ED.sinAplicar.length) return '<p class="aviso oculto" id="fd-aviso"></p>';
    return '<p class="aviso" id="fd-aviso">' + L("There are declarations saved in <code>calls.yaml</code> that are not in the index yet: ", "Hay declaraciones guardadas en <code>calls.yaml</code> que todavía no entraron al índice: ") +
      ED.sinAplicar.map(function (c) { return '<button type="button" class="boton" data-acc="aplicar" data-cerebro="' + esc(c) + '">' + L("Reindex ", "Reindexar ") + esc(c) + "</button>"; }).join(" ") + "</p>";
  }
  function pintarAviso(texto) { var e = elem("fd-aviso"); if (e && e.outerHTML !== undefined) e.outerHTML = aviso(texto); }
  // El apartado de fidelidad incierta: sin puntaje, con el porqué de cada archivo. Respeta cerebro, tipo, capa, funcionalidad y texto.
  function inciertas() {
    var q = S.q.trim().toLowerCase();
    return INC.filter(function (x) {
      if (S.cerebro !== "" && String(x.c) !== S.cerebro) return false;
      if (S.lenguaje && x.l !== S.lenguaje) return false;
      if (S.capa && x.k !== S.capa) return false;
      if (S.feat === NINGUNA ? x.f.length : S.feat && x.f.indexOf(S.feat) < 0) return false;
      return !q || x.a.toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return b.m - a.m || (a.a < b.a ? -1 : 1); });
  }
  function listaIncierta() {
    var xs = inciertas(), conCodigo = xs.filter(function (x) { return x.m === 1; }).length;
    var que = '<p class="aviso">' + L("These files have no score: the index found no relationship to measure in them, so there is no telling how well it understood them. They count neither as 100 nor as 0 and are left out of the average. If one of them has code that should have been read, teach it with an extractor (<code>flowbrain coverage --guide</code>).",
      "Estos archivos no tienen puntaje: el índice no encontró en ellos ninguna relación para medir, así que no se puede decir cuánto los entendió. No cuentan como 100 ni como 0 y no entran al promedio. Si en alguno hay código que debería haberse leído, se enseña con un extractor (<code>flowbrain coverage --guide</code>).") + "</p>";
    if (!xs.length) {
      return que + '<p class="aviso">' + L("No uncertain-fidelity file matches the filters. There are " + archivos(INC.length) + " in total.", "Ningún archivo de fidelidad incierta coincide con los filtros. Hay " + archivos(INC.length) + " en total.") + ' <button type="button" class="boton" data-fl="fd" data-fl-limpiar="1">' + L("Clear filters", "Quitar filtros") + "</button></p>";
    }
    var visibles = xs.slice(0, S.ver);
    return que + '<div class="fd-cab"><p class="subtitulo">' + L(archivos(xs.length) + " of uncertain fidelity: " + num(conCodigo) + " with code but no relationships, " + num(xs.length - conCodigo) + " where the index saw nothing", archivos(xs.length) + " de fidelidad incierta: " + num(conCodigo) + " con código pero sin relaciones, " + num(xs.length - conCodigo) + " donde el índice no vio nada") + "</p></div>" +
      '<ul class="lista fd-lista">' + visibles.map(function (x) {
        var p = partes(x), c = cerebroDe(x);
        return '<li class="fd-fila"><span class="fd-p fd-inc" title="' + L("Uncertain fidelity", "Fidelidad incierta") + '">?</span>' +
          '<div class="fd-cuerpo"><div class="fd-ruta"><code>' + esc(p.ruta) + "</code>" + (p.repo ? " <small>" + esc(p.repo) + "</small>" : "") + "</div>" +
          '<div class="chips">' + (c && CEREBROS.length > 1 ? '<span class="chip">' + esc(c) + "</span>" : "") + '<span class="chip">' + esc(x.l) + '</span><span class="capa capa-' + esc(x.k) + '">' + esc(capa(x.k)) + "</span>" +
          x.f.map(function (id) { return '<a class="chip" href="#/f/' + encodeURIComponent(id) + '">' + esc(nombreFeat(id)) + "</a>"; }).join("") + "</div>" +
          '<p class="fd-nota">' + POR_QUE(x.m) + "</p></div></li>";
      }).join("") + "</ul>" +
      (xs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="boton" data-acc="mas">' + L("Show " + Math.min(PASO, xs.length - visibles.length) + " more", "Mostrar " + Math.min(PASO, xs.length - visibles.length) + " más") + "</button> <small>" + L(num(visibles.length) + " visible of " + num(xs.length), plural(visibles.length, "visible", "visibles") + " de " + num(xs.length)) + "</small></p>" : "");
  }
  function lista() {
    if (S.grupo === "incierta") return listaIncierta();
    var xs = filtradas();
    if (!xs.length) return fl.vacio(filas.length, [L("measured file", "archivo medido"), L("measured files", "archivos medidos")]);
    var visibles = xs.slice(0, S.ver);
    return barraDePedido(xs) + fl.resultado(xs.length, L(" · average ", " · promedio ") + promedio(xs), '<button type="button" class="boton" data-acc="orden">' + (S.orden === "asc" ? L("Lowest first", "De menor a mayor") : L("Highest first", "De mayor a menor")) + "</button>") +
      '<ul class="lista fd-lista">' + visibles.map(fila).join("") + "</ul>" +
      (xs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="boton" data-acc="mas">' + L("Show " + Math.min(PASO, xs.length - visibles.length) + " more", "Mostrar " + Math.min(PASO, xs.length - visibles.length) + " más") + "</button> <small>" + L(num(visibles.length) + " visible of " + num(xs.length), plural(visibles.length, "visible", "visibles") + " de " + num(xs.length)) + "</small></p>" : "");
  }

  // ---------- Página ----------
  var COMO = function () {
    return '<p class="subtitulo">' + L("How much of each file ended up linked in the graph, from 0 to 100. Only files with something to measure are measured: the rest go to Uncertain fidelity. In each row, the chain shows which link was understood, where it breaks and what does not apply; below it, what is missing and what to do.", "Cuánto de cada archivo quedó unido en el grafo, de 0 a 100. Solo se mide donde hay algo que medir: el resto queda en Fidelidad incierta. En cada fila, la cadena muestra qué eslabón se entendió, dónde se corta y qué no aplica; debajo, qué falta y qué hacer.") + "</p>" +
      '<p class="fd-leyenda"><span class="fd-es ok">' + L("Understood", "Entendido") + '</span><span class="fd-es no">' + L("Breaks here", "Ahí se corta") + '</span><span class="fd-es na">' + L("Does not apply", "No aplica") + "</span></p>";
  };
  function pintarLista() { elem("fd-lista").innerHTML = lista(); }
  var pintarGraficos = function () { fl.pintarGraficos(); };
  function pintarTodo() {
    if (!F) {
      raiz.innerHTML = "<h1>" + L("Fidelity", "Fidelidad") + '</h1><p class="aviso">' + L("There is no code index, so there are no files to measure. Fidelity comes from what <code>flowbrain index</code> leaves in <code>_build/files</code> and <code>_build/extraction</code>: run <code>flowbrain index</code> on each repo and then <code>flowbrain compile</code>.", "No hay índice de código, así que no hay archivos para medir. La fidelidad sale de lo que deja <code>flowbrain index</code> en <code>_build/files</code> y <code>_build/extraction</code>: corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code>.") + "</p>";
      return;
    }
    if (!filas.length && !INC.length) {
      raiz.innerHTML = "<h1>" + L("Fidelity", "Fidelidad") + '</h1><p class="aviso">' + L("The index found no files to measure. Run <code>flowbrain index</code> on each repo and then <code>flowbrain compile</code>.", "El índice no encontró ningún archivo para medir. Corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code>.") + "</p>";
      return;
    }
    if (S.grupo === "incierta" && !INC.length) S.grupo = "";
    var sin = INC.length && S.grupo !== "incierta" ? '<p class="aviso">' + L(plural(INC.length, "file has uncertain fidelity", "files have uncertain fidelity") + ": there is no relationship to measure in them, so they have no score and are left out of the average.", plural(INC.length, "archivo tiene fidelidad incierta", "archivos tienen fidelidad incierta") + ": no hay en ellos ninguna relación para medir, así que no llevan puntaje ni entran al promedio.") + ' <button type="button" class="boton" data-fl="fd" data-grupo="incierta">' + L("See them", "Verlos") + "</button></p>" : "";
    raiz.innerHTML = "<h1>" + L("Fidelity", "Fidelidad") + "</h1>" + COMO() + aviso(null) + herramientas() + '<div id="fd-lista">' + lista() + "</div>" + sin;
  }
  function refrescar(todo) { S.ver = PASO; guardar(); if (todo) pintarTodo(); else { pintarGraficos(); pintarLista(); } }

  raiz.addEventListener("click", function (ev) {
    if (fl.manejar(ev, "click")) return;
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc"), x = b.getAttribute("data-a") ? porArchivo(b.getAttribute("data-a")) : abierto ? porArchivo(abierto.a) : null;
    if (acc === "limpiar") { fl.limpiar(); return; }
    if (acc === "pedir") { PD.sumar("fidelidad", b.getAttribute("data-k")); return; }
    if (acc === "resolver") { resolver(x.a, b.getAttribute("data-que")); return; }
    if (acc === "recargar") { guardar(); location.reload(); return; }
    if (acc === "aplicar") { aplicar(b.getAttribute("data-cerebro")); return; }
    if (acc === "declarar-http") { var lh = Number(b.getAttribute("data-linea")); enviar(x, { tipo: "http", linea: lh, metodo: b.getAttribute("data-metodo"), ruta: valor("fd-h-r-" + lh) }); return; }
    if (acc === "declarar-llamada") { var ll = Number(b.getAttribute("data-linea")); enviar(x, { tipo: "llamada", linea: ll, hacia: b.getAttribute("data-hacia") || valor("fd-l-" + ll) }); return; }
    if (acc === "orden") { S.orden = S.orden === "asc" ? "desc" : "asc"; refrescar(false); return; }
    if (acc === "mas") { S.ver += PASO; pintarLista(); return; }
  });
  raiz.addEventListener("change", function (ev) {
    var id = ev.target.id || "";
    if (fl.manejar(ev, "change")) return;
    if (id.indexOf("fd-pl-s-") === 0) { PL.signals[id.slice(8)] = !!ev.target.checked; pintarLista(); }
  });
  raiz.addEventListener("input", function (ev) { fl.manejar(ev, "input"); });

  // Al cargar, con todo ya definido: lo que ya llegó a 100 (o ya no tiene las faltas pedidas) sale del pedido; lo que sigue, se pone al día.
  if (F) PD.podar("fidelidad", function (it) {
    var x = porArchivo(it.k);
    if (!x || !it.datos || !Array.isArray(it.datos.t)) return null;
    var sigs = it.datos.t.map(function (t) { return t[0]; }), y = entradaDe(x, sigs);
    return y.datos.t.length ? y : null;
  });
  window.brainFidelidad = { mostrar: pintarTodo };
})();
`;

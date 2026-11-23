/**
 * El filtro y la estadística de las pantallas de lista (`window.brainFiltros`): un solo componente para Fidelidad,
 * Especificaciones, Sin asociar, Contratos, Impacto y Navegación, que se edita en un solo lugar.
 *
 * Cada pantalla lo arma con sus datos: los ítems, los grupos (botones con su cantidad), el buscador, los campos del
 * filtro (selects o números) y los paneles de estadística. Un panel cuenta los ítems que pasan todos los filtros menos
 * el suyo, y lo dice («Sobre … · sin aplicar el cerebro elegido, que se marca en su barra»): así refleja la lista y
 * sigue sirviendo para elegir otra barra. Tocar una barra prende su filtro; tocarla otra vez lo apaga.
 *
 * El componente no escucha eventos: la pantalla le pasa los suyos con `manejar(ev, tipo)`, que dice si eran del filtro.
 * Ids: `<pre>-q` el buscador, `<pre>-<campo>` cada campo, `<pre>-graficos` la estadística (al buscar se repinta sola,
 * sin rehacer el buscador, así no se pierde el foco). JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const FILTROS_JS = String.raw`
(function () {
  "use strict";
  var esc = function (s) { return window.brainVisor.esc(s); };
  var plural = function (n, uno, varios) { return n.toLocaleString("es") + " " + (n === 1 ? uno : varios); };
  var elem = function (id) { return document.getElementById(id); };
  var pct1 = function (n, total) { return total ? Math.round((1000 * n) / total) / 10 : 0; };

  // Una barra de estadística. pct: el largo (0 a 100). set: los filtros que prende, como objeto.
  function barra(pre, etiqueta, pct, detalle, set, activa, color, titulo) {
    return '<button type="button" class="fd-barra' + (activa ? " on" : "") + '" data-fl="' + pre + '" data-fl-set="' + esc(JSON.stringify(set)) + '" aria-pressed="' + !!activa + '" title="' + esc(titulo || detalle) + '">' +
      '<span class="fd-et">' + etiqueta + '</span><span class="fd-pista"><span class="fd-relleno" style="width:' + Math.max(pct, pct > 0 ? 1.5 : 0) + "%;background:" + (color || "var(--primario)") + '"></span></span>' +
      '<span class="fd-val">' + esc(detalle) + "</span></button>";
  }
  var cifra = function (valor, texto, color, grupo, pre) {
    var ir = grupo !== undefined && grupo !== null;
    return '<div class="fd-cifra' + (ir ? " es-ir" : "") + '"' + (ir ? ' role="button" tabindex="0" data-fl="' + pre + '" data-grupo="' + esc(grupo) + '"' : "") + "><b" + (color ? ' style="color:' + color + '"' : "") + ">" + (typeof valor === "number" ? valor.toLocaleString("es") : valor) + "</b><span>" + texto + "</span></div>";
  };

  /**
   * cfg = {
   *   pre, clave (sessionStorage; sin clave no se guarda), items: () => [...], unidad: ["caso", "casos"], todos: "todos los casos",
   *   grupos: [{ id, etiqueta, es(x), n?() , palabra?, sinPaneles?, ocultarVacio? }]  (el primero, id "", es "Todos"),
   *   buscar: { ph, texto(x) },
   *   campos: [{ id, etiqueta, de(x) → valor o lista, valores?() → [[v, etiqueta, n]], etiquetaDe?(v), todos?, palabra?(v),
   *              tipo?: "numero", inicial?, min?, max?, dim?, prueba?(x, v), color?(v), solo?: () => bool }],
   *   paneles: [{ titulo, campo, max?, orden?: "cantidad" | "fijo", sinValor?: "sin recomendación", ninguno?, nota?(xs) }  o  { titulo, salvo, html(xs, api) }],
   *   contar?: (xs) → texto ("12 casos de uso y 2 reglas sueltas"), cifras?: () → [[valor, texto, color, grupo]], acciones?: () → html, alCambiar(todo),
 *   estado?: { lo propio de la pantalla que se guarda y se vacía con el filtro, como el orden }
   * }
   */
  function crear(cfg) {
    var pre = cfg.pre, campos = cfg.campos || [], grupos = cfg.grupos || [], paneles = cfg.paneles || [];
    var u = cfg.unidad || ["elemento", "elementos"];
    // Cuántos, en palabras: con contar, la pantalla lo dice a su modo («12 casos de uso y 2 reglas sueltas»).
    var cuenta = function (xs) { return cfg.contar ? cfg.contar(xs) : plural(xs.length, u[0], u[1]); };
    var inicial = function () { var s = { grupo: "", q: "" }, e = JSON.parse(JSON.stringify(cfg.estado || {})); Object.keys(e).forEach(function (k) { s[k] = e[k]; }); campos.forEach(function (c) { s[c.id] = c.inicial !== undefined ? c.inicial : ""; }); return s; };
    var S = inicial();
    var guardar = function () { if (!cfg.clave) return; try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(cfg.clave, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ } };
    if (cfg.clave) {
      try {
        var previo = typeof sessionStorage !== "undefined" ? JSON.parse(sessionStorage.getItem(cfg.clave) || "null") : null;
        if (previo) Object.keys(S).forEach(function (k) { if (previo[k] !== undefined && typeof previo[k] === typeof S[k]) S[k] = previo[k]; });
      } catch (e) { /* sin almacenamiento */ }
    }
    var grupoDe = function (id) { for (var i = 0; i < grupos.length; i++) if (grupos[i].id === id) return grupos[i]; return null; };
    var campoDe = function (id) { for (var i = 0; i < campos.length; i++) if (campos[i].id === id) return campos[i]; return null; };
    if (!grupoDe(S.grupo)) S.grupo = "";
    var dimDe = function (c) { return c.dim || c.id; };
    var visible = function (c) { return !c.solo || c.solo(); };
    var puesto = function (c) { var i = c.inicial !== undefined ? c.inicial : ""; return visible(c) && S[c.id] !== i; };
    var valoresDe = function (c, x) { var v = c.de(x); return Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === "" ? [] : [String(v)]; };
    var etiquetaDe = function (c, v) { return c.etiquetaDe ? c.etiquetaDe(v) : String(v); };
    var palabra = function (c) { return c.palabra ? c.palabra(S[c.id]) : c.etiqueta.toLowerCase() + " " + etiquetaDe(c, S[c.id]); };

    // salvo: la dimensión que un panel no aplica sobre sí mismo.
    function coincide(x, salvo) {
      var g = grupoDe(S.grupo);
      if (g && g.es && !(salvo && g.sinPaneles) && !g.es(x)) return false;
      for (var i = 0; i < campos.length; i++) {
        var c = campos[i];
        if (dimDe(c) === salvo || !puesto(c)) continue;
        if (c.prueba ? !c.prueba(x, S[c.id]) : valoresDe(c, x).indexOf(String(S[c.id])) < 0) return false;
      }
      var q = S.q.trim().toLowerCase();
      if (q && cfg.buscar && cfg.buscar.texto(x).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }
    var filtrar = function (salvo) { return cfg.items().filter(function (x) { return coincide(x, salvo); }); };
    // Lo que hay puesto, en palabras: para la línea del resultado y para decir por qué algo quedó vacío.
    function activos(salvo) {
      var out = [], g = grupoDe(S.grupo);
      if (g && g.id && !(salvo && g.sinPaneles)) out.push(g.palabra || g.etiqueta.toLowerCase());
      campos.forEach(function (c) { if (dimDe(c) !== salvo && puesto(c)) { var w = palabra(c); if (w && out.indexOf(w) < 0) out.push(w); } });
      if (S.q.trim()) out.push("texto «" + S.q.trim() + "»");
      return out;
    }
    function opcionesDe(c) {
      if (c.valores) return c.valores();
      var n = {};
      cfg.items().forEach(function (x) { valoresDe(c, x).forEach(function (v) { n[v] = (n[v] || 0) + 1; }); });
      return Object.keys(n).sort(function (a, b) { return c.ordenPorCantidad ? n[b] - n[a] || (a < b ? -1 : 1) : etiquetaDe(c, a).localeCompare(etiquetaDe(c, b), "es"); }).map(function (v) { return [v, etiquetaDe(c, v), n[v]]; });
    }

    // ---------- Partes de la pantalla ----------
    function cifras() {
      var cs = cfg.cifras ? cfg.cifras() : [];
      return cs.length ? '<div class="fd-cifras">' + cs.map(function (x) { return cifra(x[0], x[1], x[2], x[3], pre); }).join("") + "</div>" : "";
    }
    function htmlGrupos() {
      if (grupos.length < 2) return "";
      var xs = cfg.items();
      return '<div class="fd-grupos" role="group" aria-label="Qué ver">' + grupos.map(function (g) {
        var n = g.n ? g.n() : g.es ? xs.filter(g.es).length : xs.length;
        if (g.ocultarVacio && !n && S.grupo !== g.id) return "";
        return '<button type="button" class="fd-grupo' + (S.grupo === g.id ? " on" : "") + '" data-fl="' + pre + '" data-grupo="' + esc(g.id) + '" aria-pressed="' + (S.grupo === g.id) + '">' + esc(g.etiqueta) + " <small>" + n.toLocaleString("es") + "</small></button>";
      }).join("") + "</div>";
    }
    function herramientas() {
      var acc = cfg.acciones ? cfg.acciones() : "";
      if (!cfg.buscar && !acc) return "";
      return '<div class="fd-herr">' + (cfg.buscar ? '<input id="' + pre + '-q" type="search" placeholder="' + esc(cfg.buscar.ph) + '" aria-label="Buscar" autocomplete="off" value="' + esc(S.q) + '">' : "") + acc + "</div>";
    }
    function control(c) {
      var id = pre + "-" + c.id;
      if (c.tipo === "numero") return '<input id="' + id + '" type="number" min="' + c.min + '" max="' + c.max + '" step="1" value="' + esc(S[c.id]) + '">';
      return '<select id="' + id + '"><option value="">' + esc(c.todos || "Todos") + "</option>" + opcionesDe(c).map(function (v) {
        return '<option value="' + esc(v[0]) + '"' + (String(v[0]) === String(S[c.id]) ? " selected" : "") + ">" + esc(v[1]) + (v[2] !== undefined ? " (" + v[2].toLocaleString("es") + ")" : "") + "</option>";
      }).join("") + "</select>";
    }
    function filtros() {
      var hay = campos.filter(function (c) { return visible(c) && (c.tipo === "numero" || puesto(c) || opcionesDe(c).length > 1); });
      if (!hay.length) return "";
      return '<div class="fd-filtros">' + hay.map(function (c) { return '<label class="fd-campo" for="' + pre + "-" + c.id + '"><span class="lbl">' + esc(c.etiqueta) + "</span>" + control(c) + "</label>"; }).join("") + "</div>";
    }
    // Sobre qué conjunto se calcula un panel, en palabras, y qué filtro propio no aplica.
    function sobre(salvo, xs) {
      var fs = activos(salvo), propios = campos.filter(function (c) { return dimDe(c) === salvo && puesto(c); });
      var g = grupoDe(S.grupo);
      return '<p class="fd-sobre">Sobre ' + (fs.length ? esc(fs.join(", ")) : esc(cfg.todos || "todos")) + " · " + cuenta(xs) +
        (propios.length ? " · sin aplicar " + esc(propios[0].propio || "el filtro de " + propios[0].etiqueta.toLowerCase()) + ", que se marca en su barra" : "") +
        (salvo && g && g.sinPaneles && g.notaPaneles ? " · " + esc(g.notaPaneles) : "") + "</p>";
    }
    var vacioPanel = function () { return '<p class="fd-sin">Ningún ' + esc(u[0]) + ' coincide con los demás filtros. <button type="button" class="boton" data-fl="' + pre + '" data-fl-limpiar="1">Quitar filtros</button></p>'; };
    var api = {
      barra: function (etiqueta, pct, detalle, set, activa, color, titulo) { return barra(pre, etiqueta, pct, detalle, set, activa, color, titulo); },
      vacio: vacioPanel, S: function () { return S; }, plural: plural
    };
    // El panel de un campo: una barra por valor con su cantidad. Con muchos valores, los que más tienen y el elegido.
    function panelDeCampo(p, xs) {
      var c = campoDe(p.campo), n = {}, de = {}, orden = [];
      if (!xs.length) return vacioPanel();
      xs.forEach(function (x) { valoresDe(c, x).forEach(function (v) { if (n[v] === undefined) { n[v] = 0; de[v] = []; orden.push(v); } n[v]++; de[v].push(x); }); });
      if (p.orden === "fijo") { var fijo = opcionesDe(c).map(function (v) { return String(v[0]); }); orden = fijo.filter(function (v) { return n[v]; }); }
      else orden.sort(function (a, b) { return n[b] - n[a] || etiquetaDe(c, a).localeCompare(etiquetaDe(c, b), "es"); });
      if (!orden.length) return '<p class="fd-sin">' + esc(p.ninguno || "Ninguno de estos " + u[1] + " tiene " + c.etiqueta.toLowerCase() + ".") + "</p>";
      var max = p.max || 8, sel = String(S[c.id]), vis = orden.slice(0, max);
      if (sel && orden.indexOf(sel) >= max) vis.push(sel);
      var tope = 0; vis.forEach(function (v) { if (n[v] > tope) tope = n[v]; });
      var sinValor = xs.filter(function (x) { return !valoresDe(c, x).length; }).length;
      return vis.map(function (v) {
        var set = {}; set[c.id] = v;
        return barra(pre, esc(etiquetaDe(c, v)), (100 * n[v]) / tope, cuenta(de[v]) + " · " + pct1(n[v], xs.length) + " %", set, sel === v, c.color ? c.color(v) : "");
      }).join("") +
        (orden.length > vis.length ? '<p class="fd-sin">Y ' + plural(orden.length - vis.length, "valor más", "valores más") + ": elegilos en el filtro «" + esc(c.etiqueta) + "».</p>" : "") +
        (sinValor && p.sinValor ? '<p class="fd-sin">' + plural(sinValor, u[0], u[1]) + ": " + esc(p.sinValor) + "</p>" : "");
    }
    function graficos() {
      var hechos = paneles.map(function (p) {
        if (p.solo && !p.solo()) return "";
        var salvo = p.salvo || (p.campo ? dimDe(campoDe(p.campo)) : ""), xs = filtrar(salvo);
        if (p.campo && !visible(campoDe(p.campo))) return "";
        var cuerpo = p.html ? p.html(xs, api) : panelDeCampo(p, xs);
        if (!cuerpo) return "";
        return "<section><h2>" + esc(p.titulo) + "</h2>" + sobre(salvo, xs) + '<div class="fd-barras">' + cuerpo + "</div>" + (p.nota ? p.nota(xs) : "") + "</section>";
      }).join("");
      return hechos ? '<div class="fd-graficos">' + hechos + "</div>" : "";
    }
    // Todo lo de arriba de la lista: cifras, grupos, buscador, filtros y estadística.
    function html() { return cifras() + htmlGrupos() + herramientas() + filtros() + '<div id="' + pre + '-graficos">' + graficos() + "</div>"; }
    function pintarGraficos() { var g = elem(pre + "-graficos"); if (g) g.innerHTML = graficos(); }

    // La línea del resultado: cuántos coinciden y con qué, lo que agrega la pantalla y «Quitar filtros».
    // xs: la lista que quedó (o cuántos son).
    function resultado(xs, extra, botones) {
      var a = activos(), n = typeof xs === "number" ? xs : xs.length;
      var dice = typeof xs === "number" ? plural(n, u[0], u[1]) : cuenta(xs);
      return '<div class="fd-cab"><p class="subtitulo">' + dice + (a.length ? " " + (n === 1 ? "coincide" : "coinciden") + " (" + esc(a.join(", ")) + ")" : "") + (extra || "") + "</p>" +
        ((botones || a.length) ? '<div class="fd-acc">' + (botones || "") + (a.length ? '<button type="button" class="boton" data-fl="' + pre + '" data-fl-limpiar="1">Quitar filtros</button>' : "") + "</div>" : "") + "</div>";
    }
    // Lista vacía: por qué (qué filtros) y cuántos hay en total, con el camino para salir. total: los ítems o cuántos son.
    function vacio(total, unidadTotal) {
      var a = activos(), ut = unidadTotal || u;
      return '<p class="aviso">Ningún ' + esc(u[0]) + " coincide" + (a.length ? " con " + esc(a.join(", ")) : "") + ". Hay " + (typeof total === "number" ? plural(total, ut[0], ut[1]) : cuenta(total)) + " en total." +
        (a.length ? ' <button type="button" class="boton" data-fl="' + pre + '" data-fl-limpiar="1">Quitar filtros</button>' : "") + "</p>";
    }

    var cambio = function (todo) { guardar(); if (cfg.alCambiar) cfg.alCambiar(todo); };
    function poner(cambios, todo) { Object.keys(cambios).forEach(function (k) { if (k in S) S[k] = cambios[k]; }); cambio(todo !== false); }
    // Se vacía en el mismo objeto: la pantalla puede tener S = fl.S() a mano. callado: sin avisar a la pantalla.
    function limpiar(callado) { var ini = inicial(); Object.keys(ini).forEach(function (k) { S[k] = ini[k]; }); if (callado) guardar(); else cambio(true); }
    var numero = function (c, v) { var n = parseInt(v, 10); return isNaN(n) ? c.inicial : Math.min(c.max, Math.max(c.min, n)); };
    // Los eventos de la pantalla: true si eran del filtro (y ya se atendieron).
    // tipo: "click", "change" o "input" (si no viene, el del evento).
    function manejar(ev, tipo) {
      var t = ev.target || {};
      tipo = tipo || ev.type;
      if (tipo === "input") {
        if (t.id !== pre + "-q") return false;
        S.q = String(t.value || ""); guardar(); pintarGraficos(); if (cfg.alCambiar) cfg.alCambiar(false);
        return true;
      }
      if (tipo === "change") {
        var id = t.id || "";
        if (id.indexOf(pre + "-") !== 0) return false;
        var c = campoDe(id.slice(pre.length + 1));
        if (!c) return false;
        if (c.tipo === "numero") {
          S[c.id] = numero(c, t.value);
          // Un rango (desde/hasta de la misma dimensión) no se cruza.
          campos.forEach(function (o) { if (o !== c && o.tipo === "numero" && dimDe(o) === dimDe(c)) { if (o.inicial > c.inicial && S[o.id] < S[c.id]) S[o.id] = S[c.id]; if (o.inicial < c.inicial && S[o.id] > S[c.id]) S[o.id] = S[c.id]; } });
        } else S[c.id] = String(t.value || "");
        cambio(true);
        return true;
      }
      var b = t.closest ? t.closest("[data-fl]") : null;
      if (!b || b.getAttribute("data-fl") !== pre) return false;
      if (b.getAttribute("data-fl-limpiar")) { limpiar(false); return true; }
      var g = b.getAttribute("data-grupo");
      if (g !== null && g !== undefined) { S.grupo = S.grupo === g && g ? "" : g; cambio(true); return true; }
      var set = b.getAttribute("data-fl-set");
      if (set) {
        var o = JSON.parse(set), ya = Object.keys(o).every(function (k) { return String(S[k]) === String(o[k]); });
        Object.keys(o).forEach(function (k) { var cc = campoDe(k); S[k] = ya ? (cc && cc.inicial !== undefined ? cc.inicial : "") : o[k]; });
        cambio(true);
        return true;
      }
      return false;
    }

    return {
      S: function () { return S; }, coincide: coincide, filtrar: filtrar, activos: activos, html: html, graficos: graficos, pintarGraficos: pintarGraficos,
      resultado: resultado, vacio: vacio, manejar: manejar, poner: poner, limpiar: limpiar, guardar: guardar, barra: api.barra
    };
  }

  window.brainFiltros = { crear: crear, plural: plural };
})();
`;

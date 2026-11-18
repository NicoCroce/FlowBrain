import { IMPACTO_JS } from "@flowbrain/core";

/**
 * "Impacto" (si cambia esta pieza, qué se ve afectado, por niveles y con el porqué) y el enrutador de todo el visor:
 * `#/funcionalidades`, `#/f/<id>`, `#/impacto[/<id>]`, `#/n/<id>` (ficha técnica de cualquier pieza), `#/grafo[/<id>]`. Los enlaces viejos `#/mapa[/<id>]` (la vista
 * de dependencias, que se quitó) abren el mapa 3D. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const MAPA_JS =
  IMPACTO_JS +
  String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, P = window.brainProducto, D = V.D, porId = V.porId, esc = V.esc, color = V.color;
  var fichas = D.funcionalidades || [], deps = D.dependencias || [];
  var porFicha = {};
  fichas.forEach(function (f) { porFicha[f.id] = f; });
  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var tipo = function (id) { return porId[id] ? porId[id].t : ""; };
  var plural = function (n, uno, varios) { return n + " " + (n === 1 ? uno : varios); };
  var TIPO = { feat: "funcionalidad", pantalla: "pantalla", tabla: "tabla", endpoint: "endpoint", svc: "servicio", ext: "servicio externo", db: "base de datos", queue: "cola", lib: "librería", repo: "repo" };
  var TIPOS = { feat: "funcionalidades", pantalla: "pantallas", tabla: "tablas", endpoint: "endpoints", svc: "servicios", ext: "servicios externos", db: "bases de datos", queue: "colas", lib: "librerías", repo: "repos" };
  var VERBO = { usa: "usa", escribe_en: "escribe en", lee_de: "lee", llama_a: "llama a", implementa: "está implementada por", vive_en: "vive en", publica_en: "publica en", consume_de: "consume de", depende_de: "depende de" };
  var puntoT = function (t) { return '<span class="punto" style="background:' + color(t) + '"></span>'; };
  var punto = function (id) { return puntoT(tipo(id)); };
  var entran = {}, salen = {};
  deps.forEach(function (d) { (entran[d[1]] = entran[d[1]] || []).push(d); (salen[d[0]] = salen[d[0]] || []).push(d); });
  var vistas = { producto: document.getElementById("producto"), impacto: document.getElementById("impacto"), grafo: document.getElementById("app") };

  // ---------- Impacto ----------
  var raizImpacto = vistas.impacto, copia = "", filtroImpacto = "todos";
  var candidatos = D.nodes.filter(function (n) { return entran[n.id] || salen[n.id] || porFicha[n.id]; });
  function buscarPiezas(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return candidatos.map(function (n) {
      var claves = [n.id, n.n].concat(n.a).map(function (k) { return k.toLowerCase(); });
      var p = claves.some(function (k) { return k === q; }) ? 0 : claves.some(function (k) { return k.indexOf(q) === 0; }) ? 1 : claves.some(function (k) { return k.indexOf(q) >= 0; }) ? 2 : 9;
      return [p + (n.t === "feat" ? 0 : 0.5), n];
    }).filter(function (x) { return x[0] < 9; }).sort(function (a, b) { return a[0] - b[0] || (a[1].id < b[1].id ? -1 : 1); }).slice(0, 10).map(function (x) { return x[1]; });
  }
  var enlaceImpacto = function (id) { return '<a href="#/impacto/' + encodeURIComponent(id) + '">' + punto(id) + " " + esc(nombre(id)) + "</a>"; };
  function buscador() {
    return '<input id="buscar-impacto" type="search" placeholder="Buscar una funcionalidad, tabla, endpoint, servicio o externo" autocomplete="off"><ul id="resultados-impacto" class="lista"></ul>';
  }
  function conectarBuscador() {
    var input = document.getElementById("buscar-impacto"), res = document.getElementById("resultados-impacto");
    input.addEventListener("input", function () {
      res.innerHTML = buscarPiezas(input.value).map(function (n) { return "<li>" + enlaceImpacto(n.id) + " <small>· " + esc(TIPO[n.t] || n.t) + "</small></li>"; }).join("");
    });
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { var c = buscarPiezas(input.value)[0]; if (c) location.hash = "#/impacto/" + encodeURIComponent(c.id); } });
  }
  function masDependidas(t, n) {
    return candidatos.filter(function (x) { return x.t === t && entran[x.id]; }).map(function (x) {
      var quien = {};
      entran[x.id].forEach(function (d) { quien[d[0]] = true; });
      return [Object.keys(quien).length, x.id];
    }).sort(function (a, b) { return b[0] - a[0] || (a[1] < b[1] ? -1 : 1); }).slice(0, n);
  }
  function inicioImpacto() {
    var bloque = function (titulo, xs) { return xs.length ? "<section><h2>" + titulo + "</h2><ul class=\"lista\">" + xs.map(function (x) { return "<li>" + enlaceImpacto(x[1]) + " <small>· " + plural(x[0], "pieza depende", "piezas dependen") + " directo</small></li>"; }).join("") + "</ul></section>" : ""; };
    raizImpacto.innerHTML = "<h1>Impacto de un cambio</h1>" +
      '<p class="subtitulo">Elegí una pieza y mirá todo lo que depende de ella, directa o indirectamente: para planificar un cambio, revisar un PR o estimar el riesgo.</p>' +
      buscador() + '<div class="columnas">' + bloque("Funcionalidades más usadas", masDependidas("feat", 8)) + bloque("Tablas más compartidas", masDependidas("tabla", 8)) + bloque("Endpoints más llamados", masDependidas("endpoint", 8)) + "</div>";
    conectarBuscador();
  }
  function mostrarImpacto(id) {
    if (!id || !porId[id]) return inicioImpacto();
    var niveles = impacto(deps, id), info = {};
    niveles.forEach(function (nv, i) { nv.forEach(function (x) { x.nivel = i + 1; info[x.id] = x; }); });
    var porque = function (x) {
      var partes = [];
      for (var c = x; c; c = info[c.via]) partes.push((VERBO[c.verbo] || c.verbo) + " " + nombre(c.via));
      return partes.join(", que ");
    };
    var todos = [].concat.apply([], niveles);
    var feats = todos.filter(function (x) { return porFicha[x.id]; });
    var tecnicas = todos.filter(function (x) { return !porFicha[x.id]; });
    // Un grupo por tipo de pieza, cada uno con su buscador; los chips de arriba filtran qué grupo se ve.
    var porTipo = {};
    todos.forEach(function (x) { var t = tipo(x.id); (porTipo[t] = porTipo[t] || []).push(x); });
    var orden = ["feat", "pantalla", "svc", "endpoint", "tabla", "ext", "queue", "db", "lib", "repo"];
    var tipos = Object.keys(porTipo).sort(function (a, b) { return (orden.indexOf(a) + 1 || 99) - (orden.indexOf(b) + 1 || 99); });
    var titulo = function (t, k) { return esc((k === 1 ? TIPO[t] : TIPOS[t]) || t); };
    if (filtroImpacto !== "todos" && !porTipo[filtroImpacto]) filtroImpacto = "todos";
    var chips = '<button class="chip' + (filtroImpacto === "todos" ? " on" : "") + '" data-tipo="todos">Todo · ' + todos.length + "</button>" +
      tipos.map(function (t) { return '<button class="chip' + (filtroImpacto === t ? " on" : "") + '" data-tipo="' + t + '">' + puntoT(t) + " " + porTipo[t].length + " " + titulo(t, porTipo[t].length) + "</button>"; }).join("");
    var item = function (x) {
      var texto = (nombre(x.id) + " " + x.id + " " + porque(x)).toLowerCase();
      return '<li data-texto="' + esc(texto) + '">' + ligado(x.id) + " <small>· " + (x.nivel > 1 ? "nivel " + x.nivel : "directo") + ' · <a href="#/impacto/' + encodeURIComponent(x.id) + '">su impacto</a></small><br><small>' + esc(porque(x)) + "</small></li>";
    };
    var porNivel = function (xs) { return xs.slice().sort(function (a, b) { return a.nivel - b.nivel || (nombre(a.id) < nombre(b.id) ? -1 : 1); }); };
    var grupo = function (t) {
      var xs = porTipo[t];
      return '<section class="grupo-impacto" data-tipo="' + t + '"' + (filtroImpacto !== "todos" && filtroImpacto !== t ? " hidden" : "") + ">" +
        "<h2>" + puntoT(t) + " " + titulo(t, 2).replace(/^./, function (c) { return c.toUpperCase(); }) + ' <small class="cuenta">' + xs.length + "</small></h2>" +
        '<input type="search" class="buscar-grupo" placeholder="Buscar en ' + titulo(t, 2) + '" autocomplete="off">' +
        '<ul class="lista">' + porNivel(xs).map(item).join("") + '</ul><p class="vacio" hidden>Nada coincide.</p></section>';
    };
    var plano = function (x) { return "- " + nombre(x.id) + " (" + (TIPO[tipo(x.id)] || tipo(x.id)) + ", " + (x.nivel > 1 ? "nivel " + x.nivel : "directo") + "): " + porque(x); };
    copia = "Impacto de cambiar " + nombre(id) + " (" + id + ")\n\n" +
      (feats.length ? "Funcionalidades:\n" + porNivel(feats).map(plano).join("\n") + "\n\n" : "") +
      (tecnicas.length ? "Piezas técnicas:\n" + porNivel(tecnicas).map(plano).join("\n") + "\n" : "");
    var n = porId[id];
    raizImpacto.innerHTML = '<a class="volver" href="#/impacto">← Otra pieza</a>' +
      "<h1>Si cambia " + esc(n.n) + "</h1>" +
      '<p class="subtitulo">' + esc(TIPO[n.t] || n.t) + " · <code>" + esc(id) + "</code>" + (porFicha[id] ? ' · <a href="#/f/' + encodeURIComponent(id) + '">ficha de producto</a>' : "") + ' · <a href="#/n/' + encodeURIComponent(id) + '">ficha técnica</a> · <a href="#/grafo/' + encodeURIComponent(id) + '">mapa 3D</a></p>' +
      (todos.length
        ? '<div class="chips resumen-impacto">' + chips + '</div><p><button class="boton" id="copiar-impacto">Copiar como lista</button></p>' +
          '<div class="grupos-impacto' + (filtroImpacto === "todos" ? "" : " uno") + '">' + tipos.map(grupo).join("") + "</div>"
        : '<p class="aviso">Nada depende de esta pieza en el grafo: cambiarla no afecta a otras funcionalidades ni servicios conocidos.</p>');
    var contenedor = raizImpacto.querySelector(".grupos-impacto");
    raizImpacto.querySelectorAll(".resumen-impacto .chip").forEach(function (c) {
      c.addEventListener("click", function () {
        // Volver a tocar el elegido muestra todo otra vez.
        filtroImpacto = filtroImpacto === c.dataset.tipo ? "todos" : c.dataset.tipo;
        raizImpacto.querySelectorAll(".resumen-impacto .chip").forEach(function (o) { o.classList.toggle("on", o.dataset.tipo === filtroImpacto); });
        raizImpacto.querySelectorAll(".grupo-impacto").forEach(function (g) { g.hidden = filtroImpacto !== "todos" && g.dataset.tipo !== filtroImpacto; });
        contenedor.classList.toggle("uno", filtroImpacto !== "todos");
      });
    });
    conectarBuscadoresDeGrupo();
    var b = document.getElementById("copiar-impacto");
    if (b) b.addEventListener("click", function () {
      var listo = function () { b.textContent = "Copiado"; setTimeout(function () { b.textContent = "Copiar como lista"; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(copia).then(listo, function () { b.textContent = "No se pudo copiar"; });
    });
  }

  // ---------- Ficha técnica: qué es una pieza, sus datos y con qué se conecta ----------
  var CEREBROS = D.cerebros || [];
  var enlaceFicha = function (id) { return porFicha[id] ? "#/f/" + encodeURIComponent(id) : "#/n/" + encodeURIComponent(id); };
  var ligado = function (id) { return '<a href="' + enlaceFicha(id) + '">' + punto(id) + " " + esc(nombre(id)) + "</a>"; };
  var ev = function (x) { return x ? "<code>" + esc(x) + "</code>" : ""; };
  var fila = function (k, v) { return v ? "<tr><th>" + esc(k) + "</th><td>" + v + "</td></tr>" : ""; };
  var tablaKV = function (filas) { filas = filas.join(""); return filas ? '<table class="kv">' + filas + "</table>" : ""; };
  var seccion = function (titulo, html) { return html ? "<section><h2>" + titulo + "</h2>" + html + "</section>" : ""; };
  // Todos los pasos conocidos (recorridos de endpoints y trazas de pantallas), para columnas usadas y recorridos.
  var pasosDe = function (f) { return [].concat.apply([], (f.recorridos || []).map(function (r) { return r.pasos || []; }).concat((f.pantallas || []).map(function (p) { return (p.recorrido && p.recorrido.pasos) || []; }))); };
  function columnasUsadas(id) {
    var cols = {};
    fichas.forEach(function (f) {
      pasosDe(f).forEach(function (p) {
        (p.toca || []).forEach(function (t) {
          if (t.hasta !== id || !t.columnas) return;
          t.columnas.forEach(function (c) { var x = cols[c] = cols[c] || { lee: {}, escribe: {} }; (t.verbo === "escribe_en" ? x.escribe : x.lee)[p.evidencia] = true; });
        });
      });
    });
    return Object.keys(cols).sort().map(function (c) { return { c: c, lee: Object.keys(cols[c].lee).length, escribe: Object.keys(cols[c].escribe).length }; });
  }
  function recorridoDe(id) {
    for (var i = 0; i < fichas.length; i++) for (var j = 0; j < (fichas[i].recorridos || []).length; j++) if (fichas[i].recorridos[j].endpoint === id) return fichas[i].recorridos[j];
    return null;
  }
  function relaciones(id) {
    var salen = {}, entran = {};
    D.edges.forEach(function (e) {
      var otro, grupo;
      if (e.s === id) { otro = e.h; grupo = salen; }
      else if (e.h === id || e.p === id) { otro = e.s; grupo = entran; }
      else return;
      if (tipo(otro) === "archivo" || otro === id) return;
      var g = grupo[e.v] = grupo[e.v] || {};
      (g[otro] = g[otro] || []).push(e.ev);
    });
    var lista = function (porVerbo, titulo) {
      return Object.keys(porVerbo).sort().map(function (v) {
        var otros = Object.keys(porVerbo[v]).sort(function (a, b) { return nombre(a) < nombre(b) ? -1 : 1; });
        return '<section class="grupo-impacto"><h2>' + titulo(v) + ' <small class="cuenta">' + otros.length + "</small></h2>" +
          (otros.length > 8 ? '<input type="search" class="buscar-grupo" placeholder="Buscar" autocomplete="off">' : "") +
          '<ul class="lista">' + otros.map(function (o) {
            var evs = porVerbo[v][o].filter(Boolean);
            return '<li data-texto="' + esc((nombre(o) + " " + o).toLowerCase()) + '">' + ligado(o) + " <small>· " + esc(TIPO[tipo(o)] || tipo(o)) + (evs.length > 1 ? " · " + evs.length + " lugares" : "") + "</small>" + (evs[0] ? "<br><small>" + ev(evs[0]) + "</small>" : "") + "</li>";
          }).join("") + '</ul><p class="vacio" hidden>Nada coincide.</p></section>';
      }).join("");
    };
    var VERBO_OUT = { usa: "Usa", escribe_en: "Escribe en", lee_de: "Lee", llama_a: "Llama a", implementa: "Implementa", vive_en: "Vive en", publica_en: "Publica en", consume_de: "Consume de", depende_de: "Depende de", expone: "Expone", navega_a: "Navega a", contiene: "Contiene" };
    var VERBO_IN = { usa: "La usan", escribe_en: "Escriben en ella", lee_de: "La leen", llama_a: "La llaman", implementa: "La implementan", vive_en: "Viven acá", publica_en: "Publican acá", consume_de: "Consumen de acá", depende_de: "Dependen de ella", expone: "La expone", navega_a: "Llegan desde", contiene: "Está dentro de" };
    var mayus = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
    return lista(salen, function (v) { return VERBO_OUT[v] || mayus(v.replace(/_/g, " ")); }) + lista(entran, function (v) { return VERBO_IN[v] || mayus(v.replace(/_/g, " ")) + " (entrantes)"; });
  }
  function mostrarFicha(id) {
    var n = porId[id];
    if (!n) { raizImpacto.innerHTML = '<a class="volver" href="#/impacto">← Impacto</a><h1>No existe esa pieza</h1><p class="vacio"><code>' + esc(id) + "</code></p>"; return; }
    var at = n.at || {}, t = n.t, partes = [];
    var cerebro = CEREBROS.length > 1 && n.c !== undefined ? CEREBROS[n.c].nombre : null;
    var resumen = n.r && !/^Borrador:/.test(n.r) ? n.r : null;
    partes.push(tablaKV([
      fila("Tipo", esc(TIPO[t] || t)),
      fila("Id", ev(id)),
      cerebro ? fila("Cerebro", esc(cerebro)) : "",
      n.a && n.a.length ? fila("También se llama", esc(n.a.join(", "))) : "",
      fila("Origen", esc(n.o === "curado" ? "curado (revisado)" : n.o === "parser" ? "leído del código" : n.o || "")),
      n.e && n.e !== "vigente" ? fila("Estado", esc(n.e)) : "",
      n.p ? fila("Página", ev(n.p)) : "",
    ]));
    if (t === "endpoint") {
      partes.push(seccion("Contrato", tablaKV([
        fila("Método", esc(at.metodo || "")), fila("Ruta", ev(at.ruta)), fila("Definido en", ev(at.evidencia)),
        at.request ? fila("Recibe", "<pre>" + esc(JSON.stringify(at.request, null, 2)) + "</pre>") : "",
        at.response ? fila("Devuelve", "<pre>" + esc(JSON.stringify(at.response, null, 2)) + "</pre>") : "",
      ])));
      var r = recorridoDe(id);
      if (r && r.pasos.length) partes.push(seccion("Qué ejecuta", '<ul class="lista pasos">' + r.pasos.map(function (p) {
        var toca = (p.toca || []).map(function (x) { return esc(VERBO[x.verbo] || x.verbo) + " " + (porId[x.hasta] ? ligado(x.hasta) : esc(x.hasta)) + (x.columnas && x.columnas.length ? " <small>(" + esc(x.columnas.join(", ")) + ")</small>" : ""); }).join(" · ");
        return '<li style="padding-left:' + (p.nivel * 16) + 'px"><code>' + esc(p.simbolo) + "</code> <small>· " + esc(p.capa) + "</small>" + (toca ? "<br>" + toca : "") + "<br><small>" + ev(p.evidencia) + "</small></li>";
      }).join("") + "</ul>" + (r.truncado ? '<p class="vacio">El recorrido se cortó por tamaño.</p>' : "")));
    } else if (t === "tabla") {
      var cols = at.columnas || [];
      partes.push(seccion("Columnas del esquema", cols.length
        ? '<table class="datos"><tr><th>Columna</th><th>Tipo</th><th></th></tr>' + cols.map(function (c) { return "<tr><td><code>" + esc(c.nombre) + "</code></td><td>" + esc(c.tipo) + "</td><td><small>" + (c.pk ? "clave primaria" : "") + (c.nulo ? (c.pk ? " · " : "") + "admite nulo" : "") + "</small></td></tr>"; }).join("") + "</table>" + (at.esquema ? "<p><small>Definido en " + ev(at.esquema) + "</small></p>" : "")
        : '<p class="vacio">No se encontró la definición de la tabla (migración, entidad o esquema).</p>'));
      var usadas = columnasUsadas(id);
      if (usadas.length) partes.push(seccion("Columnas que usa el código", '<p><small>Leídas de los accesos a la tabla en los recorridos conocidos; cuenta lugares distintos del código.</small></p><table class="datos"><tr><th>Columna</th><th>Lee</th><th>Escribe</th></tr>' + usadas.map(function (u) { return "<tr><td><code>" + esc(u.c) + "</code></td><td>" + (u.lee || "") + "</td><td>" + (u.escribe || "") + "</td></tr>"; }).join("") + "</table>"));
    } else if (t === "pantalla") {
      var pa = (D.pantallas || []).filter(function (x) { return x.id === id; })[0] || {};
      partes.push(seccion("Pantalla", tablaKV([
        fila("Ruta", ev(pa.ruta)), fila("Componentes", (pa.componentes || []).map(ev).join("<br>")), fila("Definida en", ev(pa.evidencia)),
        fila("Navegación", '<a href="#/p/' + encodeURIComponent(id) + '">de dónde se llega, a dónde lleva y la traza hasta la tabla</a>'),
      ])));
    } else if (t === "svc") {
      var pe = at.puntos_de_entrada || [], infra = at.infra || [];
      if (pe.length) partes.push(seccion("Puntos de entrada", '<ul class="lista">' + pe.map(function (x) { return "<li>" + (typeof x === "string" ? ev(x) : esc(JSON.stringify(x))) + "</li>"; }).join("") + "</ul>"));
      if (infra.length) partes.push(seccion("Infraestructura", '<ul class="lista">' + infra.map(function (x) { return "<li><b>" + esc(x.clase || "") + "</b> " + esc(x.nombre || "") + (x.detalle && x.detalle.length ? "<br><small>" + x.detalle.map(esc).join("<br>") + "</small>" : "") + "<br><small>" + ev(x.evidencia) + "</small></li>"; }).join("") + "</ul>"));
    } else {
      var claves = Object.keys(at);
      if (claves.length) partes.push(seccion("Datos", tablaKV(claves.map(function (k) { var v = at[k]; return fila(k, typeof v === "string" ? esc(v) : "<pre>" + esc(JSON.stringify(v, null, 2)) + "</pre>"); }))));
    }
    var rel = relaciones(id);
    raizImpacto.innerHTML = '<a class="volver" href="javascript:history.back()">← Volver</a>' +
      '<h1>' + puntoT(t) + " " + esc(n.n) + "</h1>" +
      '<p class="subtitulo">' + esc(TIPO[t] || t) + (porFicha[id] ? ' · <a href="#/f/' + encodeURIComponent(id) + '">ficha de producto</a>' : "") + ' · <a href="#/impacto/' + encodeURIComponent(id) + '">impacto</a> · <a href="#/grafo/' + encodeURIComponent(id) + '">mapa 3D</a></p>' +
      (resumen ? '<p class="resumen">' + esc(resumen) + "</p>" : "") +
      '<div class="ficha-tecnica">' + partes.join("") + "</div>" +
      (rel ? '<h2 class="titulo-rel">Relaciones</h2><div class="grupos-impacto">' + rel + "</div>" : '<p class="vacio">Sin relaciones en el grafo.</p>');
    conectarBuscadoresDeGrupo();
  }
  function conectarBuscadoresDeGrupo() {
    raizImpacto.querySelectorAll(".buscar-grupo").forEach(function (input) {
      input.addEventListener("input", function () {
        var q = input.value.trim().toLowerCase(), g = input.parentNode, visibles = 0;
        g.querySelectorAll("li").forEach(function (li) { var ok = !q || li.dataset.texto.indexOf(q) >= 0; li.hidden = !ok; if (ok) visibles++; });
        g.querySelector(".vacio").hidden = visibles > 0;
        g.querySelector(".cuenta").textContent = q ? visibles + " de " + g.querySelectorAll("li").length : String(g.querySelectorAll("li").length);
      });
    });
  }

  // ---------- Navegación ----------
  function ir() {
    var h = decodeURIComponent(location.hash.replace(/^#/, "")), m, vista;
    // Enlaces viejos a la vista de dependencias: el mapa 3D, con la misma pieza.
    if ((m = /^\/mapa(?:\/(.+))?$/.exec(h))) {
      location.replace(m[1] ? "#/grafo/" + encodeURIComponent(m[1]) : "#/grafo");
      return;
    }
    if (/^\/grafo/.test(h)) vista = "grafo";
    else if (/^\/(impacto|n\/)/.test(h)) vista = "impacto";
    else if (h === "" && !fichas.length) vista = "grafo";
    else vista = "producto";
    // La navegación entre pantallas se dibuja en el mismo contenedor que las funcionalidades.
    var pestana = vista === "producto" && /^\/(pantallas|p\/)/.test(h) ? "pantallas" : vista;
    document.querySelectorAll("#cabecera nav a").forEach(function (a) { a.classList.toggle("activa", a.getAttribute("data-vista") === pestana); });
    Object.keys(vistas).forEach(function (k) { vistas[k].classList.toggle("oculto", k !== vista); });
    document.getElementById("presets").classList.toggle("oculto", vista !== "grafo");
    if (vista === "grafo") { V.mostrarMapa(); if ((m = /^\/grafo\/(.+)$/.exec(h))) V.enfocar(m[1]); return; }
    if (vista === "impacto" && (m = /^\/n\/(.+)$/.exec(h))) { mostrarFicha(m[1]); window.scrollTo(0, 0); return; }
    if (vista === "impacto") { m = /^\/impacto\/(.+)$/.exec(h); mostrarImpacto(m ? m[1] : null); window.scrollTo(0, 0); return; }
    if (pestana === "pantallas") window.brainPantallas.mostrar(h); else P.mostrar(h);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", ir);
  ir();
})();
`;

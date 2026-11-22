/**
 * "Sin asociar" (`#/sin-asociar`): los archivos que no son de ninguna funcionalidad ni librería, aislados y agrupados
 * por carpeta, cada uno con la funcionalidad que se le recomienda y por qué. No es un puntaje: es una lista de trabajo.
 * Si la página la sirve `flowbrain viewer --serve`, se asocia ahí mismo (el archivo, o la carpeta entera cuando nada
 * de ella tiene dueño); si no, arma el pedido para el agente. El código compartido se marca aparte: no es de una
 * funcionalidad. Un vacío siempre dice por qué. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const SIN_ASOCIAR_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("sinasociar");
  var CEREBROS = D.cerebros || [];
  var U = D.sinAsociar ? D.sinAsociar.slice() : null;
  var ED = window.FLOWBRAIN_EDICION || null;
  var CAPA = { entrada: "Entrada", logica: "Lógica", dominio: "Dominio", datos: "Datos", interfaz: "Interfaz", otros: "Otros" };
  var GRUPOS = [["", "Todos"], ["recomendada", "Con recomendación"], ["compartido", "Código compartido"], ["sinpista", "Sin pista"]];
  var PASO = 30, VISIBLES = 8, TOPE_PEDIDO = 80;
  var inicial = function () { return { ver: "", feat: "", cerebro: "", q: "", cuantas: PASO }; };
  var S = inicial();
  var CLAVE = "flowbrain.sinasociar";
  var guardar = function () { try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLAVE, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ } };
  try {
    var previo = typeof sessionStorage !== "undefined" ? JSON.parse(sessionStorage.getItem(CLAVE) || "null") : null;
    if (previo) Object.keys(S).forEach(function (k) { if (typeof previo[k] === typeof S[k]) S[k] = previo[k]; });
    if (S.cerebro !== "" && !CEREBROS[Number(S.cerebro)]) S.cerebro = "";
    S.cuantas = PASO;
  } catch (e) { /* sin almacenamiento */ }
  // OTRA: clave de la fila o carpeta con el selector abierto. MSG: { texto, error }. PEDIDO: { copiado }.
  var OTRA = null, MSG = null, PEDIDO = null, ocupado = false, hechos = 0;

  var plural = function (n, uno, varios) { return n.toLocaleString("es") + " " + (n === 1 ? uno : varios); };
  var elem = function (id) { return document.getElementById(id); };
  var nombre = function (id) { return porId[id] ? porId[id].n : id; };
  var cerebroDe = function (x) { return x.c !== undefined && CEREBROS[x.c] ? CEREBROS[x.c].nombre : ""; };
  // "cerebro/repo-x:ruta" → "repo-x:ruta": el servidor conoce los ids del cerebro, sin el prefijo del visor.
  var local = function (id, x) { var c = cerebroDe(x); return c && id.indexOf(c + "/") === 0 ? id.slice(c.length + 1) : id; };
  var carpetaDe = function (a) { var i = a.lastIndexOf("/"), j = a.indexOf(":"); return i > j ? a.slice(0, i) : a.slice(0, j + 1); };
  var rutaDe = function (a, x) { var l = local(a, x), i = l.indexOf(":"); return i < 0 ? l : l.slice(i + 1); };
  var repoDe = function (a, x) { var l = local(a, x), i = l.indexOf(":"); return i < 0 ? "" : l.slice(0, i); };
  var archivoDe = function (a) { return a.slice(a.lastIndexOf("/") + 1).replace(/^[^:]*:/, ""); };
  var clase = function (x) { return x.g ? "recomendada" : x.m ? "compartido" : "sinpista"; };
  // Funcionalidades con página, del mismo cerebro: a esas se puede asociar.
  var featsDe = function (x) {
    return D.nodes.filter(function (n) { return n.t === "feat" && n.p && (x.c === undefined || n.c === x.c); }).sort(function (a, b) { return a.n.toLowerCase() < b.n.toLowerCase() ? -1 : 1; });
  };

  function coincide(x) {
    if (S.ver && clase(x) !== S.ver) return false;
    if (S.feat && (!x.g || x.g[0] !== S.feat)) return false;
    if (S.cerebro !== "" && String(x.c) !== S.cerebro) return false;
    var q = S.q.trim().toLowerCase();
    return !q || x.a.toLowerCase().indexOf(q) >= 0 || (x.g ? nombre(x.g[0]).toLowerCase().indexOf(q) >= 0 : false);
  }
  var filtrados = function () { return U.filter(coincide); };
  function filtrosActivos() {
    var out = [];
    GRUPOS.forEach(function (g) { if (g[0] && S.ver === g[0]) out.push(g[1].toLowerCase()); });
    if (S.feat) out.push("recomendada " + nombre(S.feat));
    if (S.cerebro !== "") out.push("cerebro " + CEREBROS[Number(S.cerebro)].nombre);
    if (S.q.trim()) out.push("«" + S.q.trim() + "»");
    return out;
  }
  // Carpetas, de la que más archivos tiene a la que menos; la recomendada de cada una es la más votada por sus archivos.
  function carpetas(xs) {
    var m = {}, orden = [];
    xs.forEach(function (x) { var k = (x.c === undefined ? "" : x.c) + "|" + carpetaDe(x.a); if (!m[k]) { m[k] = { k: k, carpeta: carpetaDe(x.a), xs: [] }; orden.push(m[k]); } m[k].xs.push(x); });
    orden.forEach(function (g) {
      var votos = {}, mejor = null;
      g.xs.forEach(function (x) { if (x.g) votos[x.g[0]] = (votos[x.g[0]] || 0) + 1; });
      Object.keys(votos).sort().forEach(function (id) { if (!mejor || votos[id] > votos[mejor]) mejor = id; });
      // La carpeta tiene recomendada solo si la votan más de la mitad de sus archivos.
      if (mejor && 2 * votos[mejor] <= g.xs.length) mejor = null;
      g.feat = mejor; g.votos = mejor ? votos[mejor] : 0; g.libre = g.xs.every(function (x) { return x.cl; });
    });
    return orden.sort(function (a, b) { return b.xs.length - a.xs.length || (a.carpeta < b.carpeta ? -1 : 1); });
  }

  // ---------- Pedido para el agente ----------
  function textoDelPedido(xs) {
    var elegidos = xs.slice(0, TOPE_PEDIDO);
    var out = [
      "Asociá estos " + elegidos.length + " archivos a su funcionalidad en FlowBrain. Hoy no son de ninguna funcionalidad ni librería.",
      "Para asociar uno: sumá " + "repo:ruta" + " a la lista codigo del frontmatter de la página de la funcionalidad (product/feat-*.md del cerebro) y compilá. Si toda una carpeta es de la misma, sumá la carpeta.",
      "La recomendación es una pista: abrí el archivo antes de decidir. Lo compartido no va a una funcionalidad: sumalo al codigo de una página lib o dejalo sin asociar, y decímelo. Si ninguna funcionalidad lo cubre, proponé una nueva (flowbrain feature --guide).",
      ""
    ];
    elegidos.forEach(function (x) {
      var c = cerebroDe(x);
      out.push("- " + local(x.a, x) + (c ? " (cerebro " + c + ")" : "") + ": " +
        (x.g ? "recomendada " + local(x.g[0], x) + " (" + x.g[1] + ")" + (x.o ? "; otras: " + x.o.map(function (o) { return local(o[0], x); }).join(", ") : "")
          : x.m ? "código compartido, lo usan " + x.m + " funcionalidades"
          : "sin pista: nada lo une a una funcionalidad"));
    });
    if (xs.length > elegidos.length) out.push("", "Quedan " + (xs.length - elegidos.length) + " más para otra tanda.");
    out.push("", "Al terminar, corré " + "flowbrain unassigned" + " para ver qué quedó sin asociar y por qué.");
    return out.join("\n");
  }
  function copiar(texto, listo) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(function () { listo(true); }, function () { listo(false); }); return; }
    } catch (e) { /* sin portapapeles */ }
    listo(false);
  }
  function pedido(xs) {
    if (!PEDIDO) return "";
    return '<div class="fd-plan"><h2>Pedido para el agente</h2>' +
      '<p class="fd-nota">Trae los archivos de la lista de abajo (hasta ' + TOPE_PEDIDO + "), cada uno con su recomendación. Pegalo en tu agente: abre cada archivo, decide y los asocia.</p>" +
      '<textarea class="fd-texto" readonly rows="10" aria-label="Pedido para el agente">' + esc(textoDelPedido(xs)) + "</textarea>" +
      (PEDIDO.copiado === true ? '<span class="fd-ok">Copiado. Pegalo en tu agente.</span>' : PEDIDO.copiado === "no" ? '<span class="fd-nota">No se pudo copiar solo: seleccioná el texto y copialo.</span>' : "") + "</div>";
  }

  // ---------- Filas ----------
  function selector(clave, x) {
    var fs = featsDe(x);
    if (!fs.length) return '<p class="fd-nota">Este cerebro no tiene funcionalidades con página todavía: se crean con <code>/flowbrain-features</code>.</p>';
    return '<div class="fd-linea sa-otra"><select id="sa-feat" aria-label="Funcionalidad">' + fs.map(function (n) { return '<option value="' + esc(n.id) + '">' + esc(n.n) + "</option>"; }).join("") + "</select>" +
      '<button type="button" class="boton fd-pri" data-acc="asociar-elegida" data-k="' + esc(clave) + '"' + (ocupado ? " disabled" : "") + ">Asociar</button></div>";
  }
  function fila(x) {
    var que = x.g
      ? '<span class="sa-rec">→ <a href="#/f/' + encodeURIComponent(x.g[0]) + '">' + esc(nombre(x.g[0])) + "</a></span> <small>" + esc(x.g[1]) + "</small>"
      : x.m ? '<span class="fd-es na">Código compartido</span> <small>Lo usan ' + x.m + " funcionalidades y ninguna domina: conviene una librería, no una funcionalidad.</small>"
      : '<span class="fd-es na">Sin pista</span> <small>Nada lo une a una funcionalidad: ni imports, ni endpoints, ni vecinos de carpeta.</small>';
    var botones = "";
    if (ED) {
      var a = ' data-a="' + esc(x.a) + '"' + (ocupado ? " disabled" : "");
      botones = (x.g ? '<button type="button" class="boton fd-pri" data-acc="asociar" data-f="' + esc(x.g[0]) + '"' + a + ">Asociar a " + esc(nombre(x.g[0])) + "</button>" : "") +
        (x.o || []).map(function (o) { return '<button type="button" class="boton" data-acc="asociar" data-f="' + esc(o[0]) + '" title="' + esc(o[1]) + '"' + a + ">" + esc(nombre(o[0])) + "</button>"; }).join("") +
        '<button type="button" class="boton' + (OTRA === x.a ? " on" : "") + '" data-acc="otra" data-k="' + esc(x.a) + '">' + (x.g ? "Otra…" : "Elegir funcionalidad") + "</button>";
    }
    return '<li class="sa-fila"><div class="sa-que"><code title="' + esc(local(x.a, x)) + '">' + esc(archivoDe(x.a)) + '</code> <span class="capa capa-' + esc(x.k) + '">' + esc(CAPA[x.k] || x.k) + "</span><div>" + que + "</div></div>" +
      (botones ? '<div class="fd-hacer">' + botones + "</div>" : "") + (OTRA === x.a ? selector(x.a, x) : "") + "</li>";
  }
  function grupo(g) {
    var x0 = g.xs[0], c = CEREBROS.length > 1 ? cerebroDe(x0) : "", ruta = rutaDe(g.carpeta, x0), repo = repoDe(g.carpeta + (ruta ? "" : "x"), x0);
    var rec = g.feat
      ? '<span class="chip">Recomendada: ' + esc(nombre(g.feat)) + (g.votos < g.xs.length ? " (" + g.votos + " de " + g.xs.length + ")" : "") + "</span>"
      : "";
    var acciones = "";
    if (ED && ruta) {
      var dis = ocupado ? " disabled" : "";
      acciones = g.libre
        ? (g.feat ? '<button type="button" class="boton fd-pri" data-acc="asociar-carpeta" data-k="' + esc(g.k) + '" data-f="' + esc(g.feat) + '"' + dis + ">Asociar la carpeta a " + esc(nombre(g.feat)) + "</button>" : "") +
          '<button type="button" class="boton' + (OTRA === g.k ? " on" : "") + '" data-acc="otra" data-k="' + esc(g.k) + '">' + (g.feat ? "A otra…" : "Asociar la carpeta…") + "</button>"
        : "";
    }
    var nota = ED && ruta && !g.libre ? '<p class="fd-nota">Otros archivos de esta carpeta ya son de alguna funcionalidad: acá se asocia de a uno.</p>' : "";
    var visibles = g.xs.slice(0, VISIBLES), resto = g.xs.slice(VISIBLES);
    return '<section class="es-feat"><div class="es-cab"><h3><code>' + esc(ruta ? ruta + "/" : "(raíz del repo)") + "</code>" + (repo ? " <small>" + esc(repo) + "</small>" : "") + "</h3>" +
      '<div class="chips"><span class="chip">' + plural(g.xs.length, "archivo", "archivos") + "</span>" + rec + (c ? '<span class="chip">' + esc(c) + "</span>" : "") + "</div></div>" +
      (acciones ? '<div class="fd-hacer sa-acc">' + acciones + "</div>" : "") + (OTRA === g.k ? selector(g.k, x0) : "") + nota +
      '<ul class="lista">' + visibles.map(fila).join("") + "</ul>" +
      (resto.length ? '<details class="tf"' + (resto.some(function (x) { return OTRA === x.a; }) ? " open" : "") + "><summary>" + plural(resto.length, "archivo más", "archivos más") + '</summary><ul class="lista">' + resto.map(fila).join("") + "</ul></details>" : "") + "</section>";
  }

  // ---------- Página ----------
  function cifras() {
    var cifra = function (valor, texto, color) { return '<div class="fd-cifra"><b' + (color ? ' style="color:' + color + '"' : "") + ">" + valor.toLocaleString("es") + "</b><span>" + texto + "</span></div>"; };
    var n = function (k) { return U.filter(function (x) { return clase(x) === k; }).length; };
    return '<div class="fd-cifras">' + cifra(U.length, "archivos sin asociar", U.length ? "var(--feat)" : "") + cifra(n("recomendada"), "con una funcionalidad recomendada", n("recomendada") ? "var(--tabla)" : "") +
      cifra(n("compartido"), "de código compartido") + cifra(n("sinpista"), "sin ninguna pista") + cifra(carpetas(U).length, "carpetas") + "</div>";
  }
  function grupos() {
    return '<div class="fd-grupos" role="group" aria-label="Qué ver">' + GRUPOS.map(function (g) {
      var n = U.filter(function (x) { return !g[0] || clase(x) === g[0]; }).length;
      return '<button type="button" class="fd-grupo' + (S.ver === g[0] ? " on" : "") + '" data-ver="' + g[0] + '" aria-pressed="' + (S.ver === g[0]) + '">' + g[1] + "<small>" + n.toLocaleString("es") + "</small></button>";
    }).join("") + "</div>";
  }
  function herramientas() {
    var votos = {};
    U.forEach(function (x) { if (x.g) votos[x.g[0]] = (votos[x.g[0]] || 0) + 1; });
    var ids = Object.keys(votos).sort(function (a, b) { return votos[b] - votos[a] || (nombre(a) < nombre(b) ? -1 : 1); });
    return '<div class="fd-herr"><input id="sa-q" type="search" placeholder="Buscar por ruta o por funcionalidad recomendada…" aria-label="Buscar" autocomplete="off" value="' + esc(S.q) + '">' +
      (ids.length ? '<select id="sa-feat-filtro" aria-label="Recomendada"><option value="">Cualquier recomendada</option>' + ids.map(function (id) { return '<option value="' + esc(id) + '"' + (S.feat === id ? " selected" : "") + ">" + esc(nombre(id)) + " (" + votos[id] + ")</option>"; }).join("") + "</select>" : "") +
      (CEREBROS.length > 1 ? '<select id="sa-cerebro" aria-label="Cerebro"><option value="">Todos los cerebros</option>' + CEREBROS.map(function (c, i) { return '<option value="' + i + '"' + (String(i) === S.cerebro ? " selected" : "") + ">" + esc(c.nombre) + "</option>"; }).join("") + "</select>" : "") +
      '<button type="button" class="boton' + (PEDIDO ? " on" : "") + '" data-acc="pedido">' + (PEDIDO ? "Ocultar pedido" : "Pedido para el agente") + "</button></div>";
  }
  function lista() {
    var xs = filtrados(), activos = filtrosActivos();
    var msg = MSG ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    if (!xs.length) {
      return msg + '<p class="aviso">Ningún archivo coincide con ' + activos.map(esc).join(", ") + ". Hay " + plural(U.length, "archivo sin asociar", "archivos sin asociar") + ' en total. <button type="button" class="boton" data-acc="limpiar">Quitar filtros</button></p>';
    }
    var cs = carpetas(xs), visibles = cs.slice(0, S.cuantas);
    return msg + pedido(xs) + '<div class="fd-cab"><p class="subtitulo">' + plural(xs.length, "archivo", "archivos") + " en " + plural(cs.length, "carpeta", "carpetas") + (activos.length ? " (" + activos.map(esc).join(", ") + ")" : "") + "</p>" +
      (activos.length ? '<div class="fd-acc"><button type="button" class="boton" data-acc="limpiar">Quitar filtros</button></div>' : "") + "</div>" +
      visibles.map(grupo).join("") +
      (cs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="btn" data-acc="mas">Mostrar ' + Math.min(PASO, cs.length - visibles.length) + " carpetas más</button> <small>" + visibles.length + " de " + cs.length.toLocaleString("es") + "</small></p>" : "");
  }
  var COMO = '<p class="subtitulo">Archivos que no son de ninguna funcionalidad ni librería, por carpeta. A cada uno se le recomienda una funcionalidad según quién lo usa, qué usa, qué endpoints atiende y de quién son sus vecinos. No restan puntaje de fidelidad: es una lista para completar el catálogo.</p>';
  function aviso() {
    if (!ED) return '<p class="aviso">Esta página es de solo lectura: podés ver la recomendación de cada archivo y armar el pedido para el agente. Para asociar desde acá, abrila con <code>flowbrain viewer --serve</code>.</p>';
    return "";
  }
  function pintarLista() { var e = elem("sa-lista"); if (e) e.innerHTML = lista(); }
  function pintarTodo() {
    if (!U) {
      raiz.innerHTML = "<h1>Sin asociar</h1>" + '<p class="aviso">No hay índice de código, así que no se sabe qué archivos hay. Corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code> (o <code>flowbrain brains apply</code>).</p>';
      return;
    }
    if (!(D.funcionalidades || []).length) {
      raiz.innerHTML = "<h1>Sin asociar</h1>" + '<p class="aviso">Todavía no hay funcionalidades, así que no hay a qué asociar los archivos. Primero se deducen las funcionalidades del producto: <code>/flowbrain-features</code> en el agente (o <code>flowbrain feature --guide</code>).</p>';
      return;
    }
    if (!U.length) {
      raiz.innerHTML = "<h1>Sin asociar</h1>" + COMO + '<p class="aviso">' + (hechos ? "Listo: ya no queda ningún archivo sin asociar." : "Todos los archivos del índice son de alguna funcionalidad o librería. No hay nada para asociar.") + "</p>";
      return;
    }
    raiz.innerHTML = "<h1>Sin asociar</h1>" + COMO + aviso() + cifras() + grupos() + herramientas() + '<div id="sa-lista">' + lista() + "</div>";
  }
  function refrescar(todo) { S.cuantas = PASO; if (PEDIDO) PEDIDO.copiado = false; guardar(); if (todo) pintarTodo(); else pintarLista(); }
  var porArchivo = function (a) { for (var i = 0; i < U.length; i++) if (U[i].a === a) return U[i]; return null; };
  var porClave = function (k) { var cs = carpetas(U); for (var i = 0; i < cs.length; i++) if (cs[i].k === k) return cs[i]; return null; };
  // Asocia el archivo x (o su carpeta, si entrada viene) a la funcionalidad. Lo asociado sale de la lista sin recargar.
  function asociar(x, feat, entrada) {
    if (ocupado || !ED || !x || !feat) return;
    ocupado = true; MSG = { texto: "Guardando…" }; pintarLista();
    var cuerpo = { tipo: "funcionalidad", cerebro: cerebroDe(x), archivo: local(x.a, x), funcionalidad: local(feat, x) };
    if (entrada) cuerpo.entrada = local(entrada, x);
    fetch("/api/editar", { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "el servidor respondió " + r.status); return j; }); })
      .then(function (r) {
        ocupado = false; OTRA = null;
        var antes = U.length;
        U = U.filter(function (y) { return y.c !== x.c || (entrada ? y.a.indexOf(entrada + "/") !== 0 : y.a !== x.a); });
        hechos += antes - U.length;
        // Asociado un archivo suelto, su carpeta y las de arriba ya tienen algo con dueño: dejan de poder asociarse enteras.
        if (!entrada) U.forEach(function (y) { if (y.c === x.c && x.a.indexOf(carpetaDe(y.a) + "/") === 0) delete y.cl; });
        MSG = { texto: r.mensaje + " (" + r.escrito + ")" + (antes - U.length > 1 ? " " + (antes - U.length) + " archivos salieron de la lista." : "") };
        pintarTodo();
      }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; pintarLista(); });
  }

  raiz.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k"), g;
    if (acc === "limpiar") { S = inicial(); refrescar(true); return; }
    if (acc === "mas") { S.cuantas += PASO; pintarLista(); return; }
    if (acc === "pedido") {
      if (PEDIDO) { PEDIDO = null; pintarTodo(); return; }
      PEDIDO = { copiado: false }; pintarTodo();
      copiar(textoDelPedido(filtrados()), function (ok) { if (PEDIDO) { PEDIDO.copiado = ok ? true : "no"; pintarLista(); } });
      return;
    }
    if (acc === "otra") { OTRA = OTRA === k ? null : k; pintarLista(); return; }
    if (acc === "asociar") { asociar(porArchivo(b.getAttribute("data-a")), b.getAttribute("data-f")); return; }
    if (acc === "asociar-carpeta") { g = porClave(k); if (g) asociar(g.xs[0], b.getAttribute("data-f"), g.carpeta); return; }
    if (acc === "asociar-elegida") {
      var sel = elem("sa-feat"), feat = sel ? String(sel.value || "") : "";
      g = porClave(k);
      if (g) asociar(g.xs[0], feat, g.carpeta); else asociar(porArchivo(k), feat);
      return;
    }
    if (b.hasAttribute("data-ver")) { S.ver = b.getAttribute("data-ver"); refrescar(true); }
  });
  raiz.addEventListener("change", function (ev) {
    var id = ev.target.id || "";
    if (id === "sa-feat-filtro") { S.feat = ev.target.value; refrescar(false); }
    else if (id === "sa-cerebro") { S.cerebro = ev.target.value; refrescar(false); }
  });
  raiz.addEventListener("input", function (ev) { if (ev.target.id === "sa-q") { S.q = ev.target.value; refrescar(false); } });

  window.brainSinAsociar = { mostrar: pintarTodo };
})();
`;

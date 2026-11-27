/**
 * "Borradores" (`#/borradores`, dec. 234): cierra el ciclo pedir → revisar → confirmar sin terminal. Todo lo que el
 * agente (o `flowbrain draft`) dejó en `_drafts/` de cada cerebro: funcionalidades, especificaciones, librerías, otras
 * piezas técnicas y notas `flowbrain-nota`. Cada borrador muestra qué cambia frente a la página actual (página nueva,
 * o el diff campo por campo del frontmatter y sección por sección del cuerpo) y se puede:
 * - «Aceptar»: lo promueve el servidor con la lógica de `flowbrain promote` (si el cerebro deja de compilar, se deshace
 *   y vuelve el error); después la página se recarga para mostrar lo nuevo. «Aceptar todo» hace lo mismo con la lista
 *   filtrada (sin las notas, que no se promueven);
 * - «Descartar»: lo borra de `_drafts/` (pregunta antes: no se deshace);
 * - «Pedir corrección»: suma un ítem `borrador` al pedido al agente, el componente único (`window.brainPedido`), con
 *   la nota de quien revisa. El agente edita solo `_drafts/`.
 * Necesita el visor servido (`flowbrain viewer --serve`): la lista sale de `/api/borradores`. Sin servidor, la pantalla
 * dice por qué y da los comandos de terminal equivalentes. Cuando un lote del agente termina y dejó borradores, la
 * bandeja del pedido lo avisa con un enlace a esta pantalla, y la navegación lleva la cuenta de pendientes.
 * Un vacío siempre dice por qué. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const BORRADORES_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, esc = V.esc, porId = V.porId || {};
  var raiz = document.getElementById("borradores");
  if (!raiz) return;
  var ED = window.FLOWBRAIN_EDICION || null, PD = window.brainPedido || null;
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
  var elem = function (id) { return document.getElementById(id); };
  var CEREBROS = (D.cerebros || []).map(function (c) { return c.nombre; });
  var AVISO = "flowbrain.borradores.aviso";

  // LISTA: null hasta que el servidor responde. DIFFS: el diff de cada borrador abierto. NOTAS: lo que se escribió para
  // «Pedir corrección». MSG: el resultado de la última acción ({ texto, error, lineas }).
  var LISTA = null, CARGANDO = false, ERROR = "", DIFFS = {}, ABIERTOS = {}, NOTAS = {}, MSG = null, OCUPADO = false;
  var clave = function (x) { return x.cerebro + "|" + x.origen; };
  var porClave = function (k) { var xs = LISTA || []; for (var i = 0; i < xs.length; i++) if (clave(xs[i]) === k) return xs[i]; return null; };
  var pendientes = function () { return (LISTA || []).filter(function (x) { return x.estado !== "igual"; }); };
  var CLASES = ["funcionalidad", "especificaciones", "libreria", "tecnologia", "nota"];
  function claseEt(c, varios) {
    var T = {
      funcionalidad: [L("Feature", "Funcionalidad"), L("Features", "Funcionalidades")],
      especificaciones: [L("Specifications", "Especificaciones"), L("Specifications", "Especificaciones")],
      libreria: [L("Library", "Librería"), L("Libraries", "Librerías")],
      tecnologia: [L("Technical page", "Página técnica"), L("Technical pages", "Páginas técnicas")],
      nota: [L("Note", "Nota"), L("Notes", "Notas")]
    };
    return T[c] ? T[c][varios ? 1 : 0] : c;
  }
  function estadoEt(e) {
    return { nuevo: L("New page", "Página nueva"), distinto: L("Changes a page", "Cambia una página"), igual: L("Same as the page", "Igual a la página"), nota: L("Note to review", "Nota para revisar") }[e] || e;
  }
  var varios = function () { var m = {}; (LISTA || []).forEach(function (x) { m[x.cerebro] = true; }); return Object.keys(m).length > 1 || CEREBROS.length > 1; };

  // ---------- El filtro: el mismo componente que las demás pantallas ----------
  var fl = window.brainFiltros.crear({
    pre: "bo", clave: "flowbrain.borradores.filtro",
    unidad: function () { return L(["draft", "drafts"], ["borrador", "borradores"]); },
    todos: function () { return L("all the drafts", "todos los borradores"); },
    items: function () { return LISTA || []; },
    grupos: [{ id: "", etiqueta: function () { return L("All", "Todos"); } }].concat(CLASES.map(function (c) {
      return { id: c, etiqueta: function () { return claseEt(c, true); }, palabra: function () { return claseEt(c, true).toLowerCase(); }, es: function (x) { return x.clase === c; }, ocultarVacio: true };
    })),
    buscar: { ph: function () { return L("Search an id, a name or a path…", "Buscar un id, un nombre o una ruta…"); }, texto: function (x) { return x.id + " " + (x.nombre || "") + " " + x.origen; } },
    campos: [
      { id: "cerebro", etiqueta: function () { return L("Brain", "Cerebro"); }, propio: function () { return L("the chosen brain", "el cerebro elegido"); }, solo: varios, de: function (x) { return x.cerebro; }, palabra: function (v) { return L("brain ", "cerebro ") + v; } },
      { id: "estado", etiqueta: function () { return L("Change", "Cambio"); }, propio: function () { return L("the chosen change", "el cambio elegido"); }, de: function (x) { return x.estado; }, etiquetaDe: estadoEt, palabra: function (v) { return estadoEt(v).toLowerCase(); } },
      { id: "repo", etiqueta: function () { return "Repo"; }, propio: function () { return L("the chosen repo", "el repo elegido"); }, de: function (x) { return x.repo || ""; }, palabra: function (v) { return "repo " + v; } }
    ],
    paneles: [
      { titulo: function () { return L("By brain", "Por cerebro"); }, campo: "cerebro" },
      { titulo: function () { return L("By change", "Por cambio"); }, campo: "estado" }
    ],
    alCambiar: function (todo) { if (todo) pintar(); else pintarLista(); }
  });

  // ---------- El servidor ----------
  function llamar(ruta, cuerpo) {
    if (PD && PD.llamar) return PD.llamar(ruta, cuerpo);
    return fetch(ruta, cuerpo ? { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) } : { headers: { "x-flowbrain-token": ED.token } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); });
  }
  function cargar() {
    if (!ED || CARGANDO) return;
    CARGANDO = true;
    llamar("/api/borradores").then(function (j) {
      CARGANDO = false; ERROR = "";
      LISTA = j.borradores || [];
      // Lo que ya no está (aceptado, descartado o resuelto por el agente) se olvida.
      Object.keys(DIFFS).forEach(function (k) { if (!porClave(k)) { delete DIFFS[k]; delete ABIERTOS[k]; } });
      podar(); contar(); if (PD) PD.pintar();
      if (visible()) pintar();
    }, function (e) { CARGANDO = false; ERROR = e.message; contar(); if (visible()) pintar(); });
  }
  var visible = function () { return !raiz.classList || !raiz.classList.contains("oculto"); };
  // La cuenta en la navegación: los pendientes (los iguales a su página no cuentan).
  function contar() {
    var e = elem("nav-borradores"); if (!e) return;
    var n = pendientes().length;
    e.textContent = n ? num(n) : "";
    e.setAttribute("title", n ? L(plural(n, "draft", "drafts") + " to review", plural(n, "borrador", "borradores") + " para revisar") : "");
  }
  // Los borradores que dejó un lote del agente ya terminado: los escritos después de que empezó.
  function deLotes() {
    if (!PD || !PD.lotes || !LISTA) return [];
    var desde = null;
    PD.lotes().forEach(function (LT) { if (!PD.loteVivo(LT) && (desde === null || LT.creado < desde)) desde = LT.creado; });
    if (desde === null) return [];
    return pendientes().filter(function (x) { return x.modificado >= desde; });
  }

  // ---------- El diff ----------
  // Las líneas de un diff; lo igual largo se acorta a dos líneas de contexto a cada lado del cambio.
  function lineasDiff(ls) {
    var linea = function (l) { return '<span class="bo-l ' + (l[0] === "+" ? "bo-mas" : l[0] === "-" ? "bo-menos" : "bo-igual") + '">' + (l[0] === "=" ? " " : l[0]) + " " + esc(l[1]) + "</span>"; };
    var out = [], i = 0;
    while (i < ls.length) {
      if (ls[i][0] !== "=") { out.push(linea(ls[i])); i++; continue; }
      var j = i; while (j < ls.length && ls[j][0] === "=") j++;
      var antes = i === 0 ? 0 : 2, despues = j === ls.length ? 0 : 2, corte = (j - i) - antes - despues;
      if (corte > 1) {
        ls.slice(i, i + antes).forEach(function (l) { out.push(linea(l)); });
        out.push('<span class="bo-l bo-corte">… ' + L(plural(corte, "same line", "same lines"), plural(corte, "línea igual", "líneas iguales")) + "</span>");
        ls.slice(j - despues, j).forEach(function (l) { out.push(linea(l)); });
      } else ls.slice(i, j).forEach(function (l) { out.push(linea(l)); });
      i = j;
    }
    return '<pre class="bo-diff">' + out.join("") + "</pre>";
  }
  function htmlDiff(x, d) {
    if (!d) return '<p class="fd-nota">' + L("Loading the changes…", "Cargando los cambios…") + "</p>";
    if (d.error) return '<p class="fd-msg error">' + esc(d.error) + "</p>";
    if (x.clase === "nota") {
      var nodo = porId[x.cerebro + "/" + x.id] ? x.cerebro + "/" + x.id : porId[x.id] ? x.id : "";
      return '<p class="fd-nota">' + L("Someone saw that the code contradicts the brain about ", "Alguien vio que el código contradice al cerebro sobre ") + (nodo ? '<a href="#/n/' + esc(encodeURIComponent(nodo)) + '"><code>' + esc(x.id) + "</code></a>" : "<code>" + esc(x.id) + "</code>") +
        L(". A note is not promoted: ask the agent to resolve it (it writes the fix as a draft) or discard it once reviewed.", ". Una nota no se promueve: pedile al agente que la resuelva (escribe el arreglo como borrador) o descartala cuando la revises.") + "</p>" + lineasDiff(d.cambios[0] ? d.cambios[0].lineas : []);
    }
    if (x.estado === "nuevo") return '<p class="fd-nota">' + L("New page: there is no ", "Página nueva: todavía no hay ") + "<code>" + esc(x.destino) + "</code>" + L(" yet. Accepting it creates it.", ". Aceptarla la crea.") + "</p>" + '<pre class="bo-diff">' + esc(d.borrador) + "</pre>";
    if (!d.cambios.length) return '<p class="fd-nota">' + L("Same as ", "Igual a ") + "<code>" + esc(x.destino) + "</code>" + L(": accepting it only takes it out of the drafts; discarding it, too.", ": aceptarlo solo lo saca de los borradores; descartarlo, también.") + "</p>";
    return '<p class="fd-nota">' + L("Replaces ", "Reemplaza ") + "<code>" + esc(x.destino) + "</code> · " + L(plural(d.cambios.length, "change", "changes"), plural(d.cambios.length, "cambio", "cambios")) + "</p>" +
      d.cambios.map(function (c) {
        var donde = c.donde === "campo" ? L("Field ", "Campo ") + "<code>" + esc(c.nombre) + "</code>" : c.nombre ? L("Section «", "Sección «") + esc(c.nombre) + "»" : L("Text before the first section", "Texto antes de la primera sección");
        var que = { nuevo: L("added", "se agrega"), quitado: L("removed", "se quita"), cambiado: L("changes", "cambia") }[c.cambio] || c.cambio;
        return '<section class="bo-cambio"><h4>' + donde + ' <span class="chip ' + (c.cambio === "quitado" ? "es-falta" : c.cambio === "nuevo" ? "es-ok" : "es-aviso") + '">' + que + "</span></h4>" + lineasDiff(c.lineas) + "</section>";
      }).join("");
  }
  function abrir(k) {
    if (ABIERTOS[k]) { delete ABIERTOS[k]; pintarLista(); return; }
    ABIERTOS[k] = true;
    var x = porClave(k);
    if (!x) return;
    pintarLista();
    if (DIFFS[k]) return;
    llamar("/api/borradores/diff?cerebro=" + encodeURIComponent(x.cerebro) + "&origen=" + encodeURIComponent(x.origen)).then(function (d) { DIFFS[k] = d; pintarLista(); }, function (e) { DIFFS[k] = { error: e.message }; pintarLista(); });
  }

  // ---------- Aceptar y descartar ----------
  function aceptar(xs) {
    xs = xs.filter(function (x) { return x.clase !== "nota"; });
    if (!xs.length || OCUPADO || !ED) return;
    OCUPADO = true; MSG = { texto: L("Accepting " + plural(xs.length, "draft", "drafts") + " and compiling…", "Aceptando " + plural(xs.length, "borrador", "borradores") + " y compilando…") }; pintar();
    llamar("/api/borradores/aceptar", { borradores: xs.map(function (x) { return { cerebro: x.cerebro, origen: x.origen }; }) }).then(function (j) {
      OCUPADO = false;
      var movidos = 0, errores = [], salteados = [];
      (j.cerebros || []).forEach(function (c) {
        movidos += c.movidos.length;
        c.errores.forEach(function (e) { errores.push(c.cerebro + ": " + e); });
        c.salteados.forEach(function (s) { salteados.push(c.cerebro + ": " + s.origen + " — " + s.motivo); });
      });
      if (!errores.length && !salteados.length) {
        // Lo nuevo se ve recargando la página (el servidor la arma con lo que acaba de compilar).
        try { sessionStorage.setItem(AVISO, JSON.stringify({ n: movidos })); } catch (e) { /* sin almacenamiento */ }
        if (window.location && window.location.reload) window.location.reload();
        return;
      }
      MSG = { error: true, texto: (movidos ? L("Accepted " + num(movidos) + ", but not everything: ", "Se aceptaron " + num(movidos) + ", pero no todos: ") : L("Nothing was accepted: ", "No se aceptó nada: ")) +
        (errores.length ? L("the brain stopped compiling, so it was undone. Fix the draft (or ask for a fix) and try again.", "el cerebro dejó de compilar, así que se deshizo. Corregí el borrador (o pedí la corrección) y probá de nuevo.") : L("some were skipped.", "algunos se saltearon.")), lineas: errores.concat(salteados) };
      cargar(); pintar();
    }, function (e) { OCUPADO = false; MSG = { error: true, texto: e.message }; pintar(); });
  }
  function aceptarTodo() {
    var xs = fl.filtrar().filter(function (x) { return x.clase !== "nota"; });
    if (!xs.length) return;
    var pisa = xs.filter(function (x) { return x.estado === "distinto"; }).length;
    var pregunta = L("Accept " + plural(xs.length, "draft", "drafts") + "?" + (pisa ? " " + plural(pisa, "page is", "pages are") + " replaced by the draft." : "") + " If a brain stops compiling, its part is undone.",
      "¿Aceptar " + plural(xs.length, "borrador", "borradores") + "?" + (pisa ? " " + (pisa === 1 ? "Una página se reemplaza" : num(pisa) + " páginas se reemplazan") + " por el borrador." : "") + " Si un cerebro deja de compilar, lo suyo se deshace.");
    if (!window.confirm || !window.confirm(pregunta)) return;
    aceptar(xs);
  }
  function descartar(x) {
    if (!x || OCUPADO || !ED) return;
    var pregunta = L("Discard " + x.origen + "? It is deleted from _drafts/ and this can't be undone.", "¿Descartar " + x.origen + "? Se borra de _drafts/ y no se puede deshacer.");
    if (!window.confirm || !window.confirm(pregunta)) return;
    OCUPADO = true;
    llamar("/api/borradores/descartar", { cerebro: x.cerebro, origen: x.origen }).then(function () {
      OCUPADO = false; MSG = { texto: L("Discarded: ", "Descartado: ") + x.origen }; cargar();
    }, function (e) { OCUPADO = false; MSG = { error: true, texto: e.message }; pintar(); });
  }

  // ---------- Pedir corrección: el tipo «borrador» del pedido único ----------
  // La línea que lee el agente, en inglés (dec. 214).
  function linea(x, nota) {
    var que = x.clase === "nota" ? "note " + x.origen + " about node " + x.id : "draft " + x.origen + (x.destino ? " (" + (x.estado === "nuevo" ? "new page " : "replaces ") + x.destino + ")" : "");
    return "- brain " + x.cerebro + " · " + que + (nota ? " · the person asks: " + nota.replace(/\s+/g, " ").trim() : "");
  }
  function itemDe(k) {
    var x = porClave(k), ya = PD ? PD.items("borrador").filter(function (it) { return it.k === k; })[0] : null;
    if (!x) return ya ? [ya] : [];
    var nota = String(NOTAS[k] !== undefined ? NOTAS[k] : ya ? ya.datos.nota : "").trim();
    // Un borrador vuelve con lo que hay que corregir; una nota ya dice lo suyo.
    if (!nota && x.clase !== "nota") return [];
    return [{ tipo: "borrador", k: k, cerebro: x.cerebro, repo: x.repo, datos: { cerebro: x.cerebro, origen: x.origen, id: x.id, clase: x.clase, nombre: x.nombre || "", nota: nota, linea: linea(x, nota) } }];
  }
  var claveItem = function (o) { return o.cerebro + "|" + (o.origen || o.borrador); };
  var cuenta = function (ts, campo) { return ts.reduce(function (n, t) { return n + (t[campo] || []).length; }, 0); };
  var cifras = function (r, q) { return L(num(r) + " revised · " + num(q) + " left", num(r) + " revisados · " + num(q) + " quedan"); };
  function mdBorradores(its) {
    return ["Revise " + (its.length === 1 ? "this FlowBrain draft" : "these " + its.length + " FlowBrain drafts") + " as the person asked (run flowbrain specs --guide for the page format). Each line has the brain, the path inside .flowbrain/<brain>/ and the person's note.", "",
      its.map(function (it) { return it.datos.linea; }).join("\n"), "",
      "Edit each draft in place (same id, same tipo). For a note in _drafts/notes/, write the fix as a draft and delete the note file. Do NOT modify the project's repositories, and do NOT edit product/ or technology/ or promote anything: write ONLY in .flowbrain/<brain>/_drafts/. A person reviews and accepts the drafts.", ""].join("\n");
  }
  function enlace() {
    var n = deLotes().length;
    if (!n || /^#\/borradores/.test((window.location && window.location.hash) || "")) return "";
    return '<a class="boton bo-enlace" href="#/borradores">' + L(plural(n, "new draft", "new drafts") + " to review", plural(n, "borrador nuevo", "borradores nuevos") + " para revisar") + "</a>";
  }
  function podar() {
    if (!PD || !LISTA) return;
    PD.podar("borrador", function (it) { return porClave(it.k) ? it : null; });
  }
  if (PD) {
    PD.registrar("borrador", {
      get nombre() { return L("Drafts", "Borradores"); },
      unidad: ["draft", "drafts", "borrador", "borradores"],
      raiz: raiz,
      claves: function (k) { return [k]; },
      items: itemDe,
      orden: function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; },
      resumen: function () { return [L("Only in _drafts/: you accept what comes back", "Solo en _drafts/: lo que vuelva lo aceptás vos")]; },
      costo: function (mo) { var c = mo.costoPorPaginaUsd; return c && typeof c.borrador === "number" ? c.borrador : null; },
      lote: function (its) { return { tipo: "borrador", items: its.map(function (it) { var x = it.datos; return { cerebro: x.cerebro, funcionalidad: x.id, borrador: x.origen, linea: x.linea }; }) }; },
      md: { archivo: "borradores.md", texto: mdBorradores },
      clave: function (it) { return claveItem(it.datos); },
      enTanda: function (t) { return (t.items || []).map(claveItem); },
      hechos: function (t) { return (t.resueltos || []).map(claveItem); },
      seguimiento: {
        cuantos: function (t) { return (t.items || []).length; },
        get espera() { return L("Waits for the previous batch to finish.", "Espera a que termine la tanda anterior."); },
        get reindexando() { return L("Finishing…", "Terminando…"); },
        pidiendo: function (n) { return L("Revising " + plural(n, "draft", "drafts"), "Revisando " + plural(n, "borrador", "borradores")); },
        extraTanda: function (t) {
          if (PD.vivo(t) || (!t.resueltos && !t.quedan)) return "";
          return "<small>" + cifras((t.resueltos || []).length, (t.quedan || []).length) + "</small>" +
            (t.resultado ? '<details class="tf"><summary>' + L("What the agent said", "Lo que dijo el agente") + '</summary><p class="es-resultado">' + esc(t.resultado) + "</p></details>" : "");
        },
        resumen: function (ts) { return cifras(cuenta(ts, "resueltos"), cuenta(ts, "quedan")) + L(". Review them in Drafts", ". Revisalos en Borradores"); }
      },
      tarjeta: function (it, enTanda) {
        var x = it.datos;
        return '<p class="es-texto">' + esc(x.nombre || x.id) + " <small><code>" + esc(x.origen) + "</code></small></p>" + (x.nota ? '<p class="es-texto"><small>' + esc(x.nota) + "</small></p>" : "") +
          '<div class="chips"><span class="chip">' + esc(claseEt(x.clase)) + '</span><span class="chip es-cerebro" title="' + L("Brain", "Cerebro") + '">' + esc(x.cerebro) + "</span>" +
          (enTanda ? '<span class="chip es-ok">' + L("Revising…", "Revisándose…") + "</span>" : "") + "</div>";
      },
      despues: function () {
        var n = deLotes().length;
        return n ? '<p class="fd-nota">' + L("The agent left " + plural(n, "draft", "drafts") + ": ", "El agente dejó " + plural(n, "borrador", "borradores") + ": ") + '<a href="#/borradores">' + L("review, accept or discard them in Drafts", "revisalos, aceptalos o descartalos en Borradores") + "</a>.</p>" : "";
      },
      enlace: enlace
    });
    // Un lote que termina puede dejar borradores nuevos (o resolver alguno): se vuelve a pedir la lista.
    var vivos = 0;
    PD.escuchar(function (ev) {
      if (ev !== "trabajos") return;
      var ahora = (PD.lotes ? PD.lotes() : []).filter(PD.loteVivo).length;
      if (ahora < vivos) cargar();
      vivos = ahora;
    });
  }

  // ---------- La pantalla ----------
  var titulo = function () { return '<div class="es-titulo"><h1>' + L("Drafts", "Borradores") + "</h1></div>"; };
  var cmd = function (t) { return "<code>" + esc(t) + "</code>"; };
  function porTerminal() {
    var b = CEREBROS.length === 1 ? CEREBROS[0] : "<" + L("brain", "cerebro") + ">";
    return '<ul class="lista bo-terminal">' +
      "<li>" + cmd("flowbrain promote --brain " + b) + " <small>" + L("lists the drafts and whether each one is new or changes a page", "lista los borradores y si cada uno es nuevo o cambia una página") + "</small></li>" +
      "<li>" + cmd("flowbrain promote <id...> --write --brain " + b) + " <small>" + L("accepts them (add --overwrite to replace a page that exists; if the brain stops compiling, it is undone)", "los acepta (con --overwrite reemplaza una página que existe; si el cerebro deja de compilar, se deshace)") + "</small></li>" +
      "<li>" + cmd("flowbrain status --brain " + b) + " <small>" + L("counts the drafts not promoted and the notes", "cuenta los borradores sin promover y las notas") + "</small></li>" +
      "<li><small>" + L("Discarding is deleting the file in ", "Descartar es borrar el archivo en ") + "</small>" + cmd(".flowbrain/" + b + "/_drafts/") + "</li></ul>";
  }
  var COMO = function () {
    return '<p class="subtitulo">' + L("What the agent (or flowbrain draft) left for review in each brain's _drafts/. See what each one changes against the current page, then accept it, discard it or send it back to the agent with a note.",
      "Lo que el agente (o flowbrain draft) dejó para revisar en _drafts/ de cada cerebro. Mirá qué cambia cada uno frente a la página actual y aceptalo, descartalo o devolvéselo al agente con una nota.") + "</p>";
  };
  function aviso() {
    var out = "";
    if (MSG) out += '<div class="fd-msg' + (MSG.error ? " error" : "") + '"><span>' + esc(MSG.texto) + "</span>" + (MSG.lineas && MSG.lineas.length ? '<ul class="bo-errores">' + MSG.lineas.slice(0, 20).map(function (l) { return "<li><code>" + esc(l) + "</code></li>"; }).join("") + "</ul>" : "") + "</div>";
    return out;
  }
  function fila(x, i, recientes) {
    var k = clave(x), abierto = !!ABIERTOS[k], nuevo = recientes.indexOf(x) >= 0, ya = PD ? PD.esta("borrador", k) : false;
    var nota = NOTAS[k] !== undefined ? NOTAS[k] : ya ? (PD.items("borrador").filter(function (it) { return it.k === k; })[0] || { datos: {} }).datos.nota || "" : "";
    var botones = '<button type="button" class="boton" data-acc="ver" data-k="' + esc(k) + '" aria-expanded="' + abierto + '">' + (abierto ? L("Hide changes", "Ocultar cambios") : x.clase === "nota" ? L("Read the note", "Leer la nota") : L("See changes", "Ver cambios")) + "</button>" +
      (x.clase !== "nota" ? '<button type="button" class="boton pri" data-acc="aceptar" data-k="' + esc(k) + '"' + (OCUPADO ? " disabled" : "") + ">" + L("Accept", "Aceptar") + "</button>" : "") +
      '<button type="button" class="boton" data-acc="descartar" data-k="' + esc(k) + '"' + (OCUPADO ? " disabled" : "") + ">" + L("Discard", "Descartar") + "</button>";
    var pedir = "";
    if (abierto && PD) {
      var et = x.clase === "nota" ? L("Ask the agent to resolve it", "Pedir al agente que la resuelva") : L("Request a fix", "Pedir corrección");
      pedir = '<div class="bo-pedir"><label class="fd-campo" for="bo-nota-' + i + '"><span class="lbl">' + (x.clase === "nota" ? L("Anything to add (optional)", "Algo para sumar (opcional)") : L("What to fix", "Qué corregir")) + "</span>" +
        '<textarea id="bo-nota-' + i + '" data-k="' + esc(k) + '" rows="2" placeholder="' + esc(x.clase === "nota" ? L("The note already says what's wrong", "La nota ya dice qué está mal") : L("E.g. the name should be the one the menu shows; the second section repeats the first", "P. ej.: el nombre tiene que ser el que muestra el menú; la segunda sección repite la primera")) + '"' + (ya ? " disabled" : "") + ">" + esc(nota) + "</textarea></label>" +
        PD.boton({ tipo: "borrador", k: k, et: et }) + (x.clase !== "nota" && !ya ? " <small>" + L("Write what to fix first: the agent receives it with the draft.", "Escribí primero qué corregir: el agente lo recibe con el borrador.") + "</small>" : "") + "</div>";
    }
    return '<li class="bo-item" data-k="' + esc(k) + '"><div class="es-fila"><span><strong>' + esc(x.nombre || x.id) + "</strong> <small><code>" + esc(x.origen) + "</code></small></span>" +
      '<div class="chips"><span class="chip">' + esc(claseEt(x.clase)) + '</span><span class="chip ' + (x.estado === "distinto" ? "es-aviso" : x.estado === "nuevo" ? "es-ok" : "") + '">' + esc(estadoEt(x.estado)) + "</span>" +
      (varios() ? '<span class="chip es-cerebro" title="' + L("Brain", "Cerebro") + '">' + esc(x.cerebro) + "</span>" : "") + (x.repo ? '<span class="chip">' + esc(x.repo) + "</span>" : "") +
      (nuevo ? '<span class="chip es-ok" title="' + L("Written by an agent batch that just finished", "Lo escribió un lote del agente que acaba de terminar") + '">' + L("From the agent", "Del agente") + "</span>" : "") + (ya ? '<span class="chip es-ok">' + L("In the request", "En el pedido") + "</span>" : "") + "</div></div>" +
      '<div class="fd-acc">' + botones + "</div>" + (abierto ? '<div class="bo-detalle">' + htmlDiff(x, DIFFS[k]) + pedir + "</div>" : "") + "</li>";
  }
  function lista() {
    var xs = fl.filtrar(), recientes = deLotes(), aceptables = xs.filter(function (x) { return x.clase !== "nota"; }).length;
    var botones = aceptables ? '<button type="button" class="boton pri" data-acc="aceptar-todo"' + (OCUPADO ? " disabled" : "") + ">" + L("Accept all", "Aceptar todo") + " (" + num(aceptables) + ")</button>" : "";
    if (!xs.length) return fl.vacio(LISTA);
    return fl.resultado(xs, "", botones) + '<ul class="lista bo-lista">' + xs.map(function (x) { return fila(x, LISTA.indexOf(x), recientes); }).join("") + "</ul>";
  }
  function pintarLista() { var e = elem("bo-lista"); if (e) e.innerHTML = lista(); else pintar(); }
  function pintar() {
    // Lo aceptado antes de recargar: el aviso sobrevive a la recarga una vez.
    try { var a = JSON.parse(sessionStorage.getItem(AVISO) || "null"); if (a) { sessionStorage.removeItem(AVISO); MSG = { texto: L("Accepted " + plural(a.n, "draft", "drafts") + ": the brain compiled and the viewer already shows it.", "Se " + (a.n === 1 ? "aceptó 1 borrador" : "aceptaron " + num(a.n) + " borradores") + ": el cerebro compiló y el visor ya lo muestra.") }; } } catch (e) { /* sin almacenamiento */ }
    if (!ED) {
      raiz.innerHTML = titulo() + COMO() + '<p class="aviso">' + L("This page is read-only (it was opened as a file), so it can't read the drafts or accept them. Open the served viewer to review them here: ", "Esta página es de solo lectura (se abrió como archivo), así que no puede leer los borradores ni aceptarlos. Abrí el visor servido para revisarlos acá: ") + cmd("flowbrain viewer --serve") + L(". Or from the terminal:", ". O desde la terminal:") + "</p>" + porTerminal();
      return;
    }
    if (LISTA === null) {
      raiz.innerHTML = titulo() + COMO() + (ERROR ? '<p class="fd-msg error">' + L("The drafts could not be read: ", "No se pudieron leer los borradores: ") + esc(ERROR) + ' <button type="button" class="boton" data-acc="recargar">' + L("Try again", "Reintentar") + "</button></p>" : '<p class="fd-nota">' + L("Reading the drafts…", "Leyendo los borradores…") + "</p>");
      return;
    }
    if (!LISTA.length) {
      raiz.innerHTML = titulo() + COMO() + aviso() + '<p class="aviso">' + L("No drafts to review: every brain's _drafts/ is empty. Drafts appear when you ask the agent for features (Features), when flowbrain draft proposes pages, or when the agent leaves a note about something that contradicts the brain.",
        "No hay borradores para revisar: _drafts/ de cada cerebro está vacío. Aparecen cuando le pedís funcionalidades al agente (Funcionalidades), cuando flowbrain draft propone páginas o cuando el agente deja una nota sobre algo que contradice al cerebro.") + ' <a href="#/funcionalidades">' + L("Go to Features", "Ir a Funcionalidades") + "</a></p>";
      return;
    }
    raiz.innerHTML = titulo() + COMO() + aviso() + fl.html() + '<div id="bo-lista">' + lista() + "</div>";
  }

  raiz.addEventListener("click", function (ev) {
    if (fl.manejar(ev, "click")) return;
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b || b.disabled) return;
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k");
    if (acc === "ver") { abrir(k); return; }
    if (acc === "aceptar") { var x = porClave(k); if (x) aceptar([x]); return; }
    if (acc === "aceptar-todo") { aceptarTodo(); return; }
    if (acc === "descartar") { descartar(porClave(k)); return; }
    if (acc === "recargar") { cargar(); return; }
    // Sumar o sacar del pedido: con la nota escrita (el componente cambia el botón y el panel).
    if (acc === "pedir") {
      if (!PD) return;
      var t = raiz.querySelector ? raiz.querySelector('textarea[data-k="' + (window.CSS && window.CSS.escape ? window.CSS.escape(k) : k) + '"]') : null;
      if (t && !t.disabled) NOTAS[k] = t.value;
      var antes = PD.esta("borrador", k);
      PD.sumar("borrador", k);
      if (!antes && !PD.esta("borrador", k)) { if (t && t.focus) t.focus(); return; }
      pintarLista();
    }
  });
  raiz.addEventListener("change", function (ev) { fl.manejar(ev, "change"); });
  raiz.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t && t.tagName === "TEXTAREA" && t.getAttribute("data-k")) { NOTAS[t.getAttribute("data-k")] = t.value; return; }
    fl.manejar(ev, "input");
  });
  if (PD) PD.escuchar(function (ev) { if (ev === "lista" && visible()) pintarLista(); });

  // El enlace de la bandeja no se muestra estando en esta pantalla: al cambiar de pantalla se repinta.
  if (PD && window.addEventListener) window.addEventListener("hashchange", function () { PD.pintar(); });
  // La cuenta de la navegación se pide al cargar, en cualquier pantalla.
  cargar();
  window.brainBorradores = { mostrar: function () { pintar(); cargar(); }, cargar: cargar };
})();
`;

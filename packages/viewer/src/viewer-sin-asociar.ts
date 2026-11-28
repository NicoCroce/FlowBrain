/**
 * "Sin asociar" (`#/sin-asociar`): los archivos que no son de ninguna funcionalidad ni librería, aislados y agrupados
 * por carpeta, cada uno con la funcionalidad que se le recomienda y por qué. No es un puntaje: es una lista de trabajo.
 * Si la página la sirve `flowbrain viewer --serve`, se asocia ahí mismo (el archivo, o la carpeta entera cuando nada
 * de ella tiene dueño); si no, arma el pedido para el agente. El código compartido se marca aparte: no es de una
 * funcionalidad. Un vacío siempre dice por qué. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 *
 * Cada recomendada lleva su confianza (alta, media o baja: el criterio está en `confianzaDe` del motor), con su
 * etiqueta, su filtro y, con el servidor, «Aceptar las de confianza alta» para asociarlas en lote. El motivo llega
 * estructurado (señal, cantidad, funcionalidad) y se dice en el idioma del visor; el texto en inglés queda para el
 * pedido al agente. «Ver código» muestra el archivo con `/api/archivo?…&contenido=1`: sin servidor no aparece y el
 * aviso de solo lectura dice por qué.
 *
 * El pedido al agente es la misma experiencia que «Tests pedidos» de Especificaciones (dec. 227): cada archivo tiene
 * «Pedir» (celeste), cada carpeta «Pedir los N» y la lista filtrada «Pedir los N de la lista»; ya sumado dice «✔ En el
 * pedido» y tocarlo lo saca. Es el tipo `asociar` del pedido al agente, el componente único del visor (viewer-pedido,
 * dec. 229): la lista es una sola para todas las pantallas, con su bandeja en la barra superior y su panel lateral
 * (Proveedor y Modelo, el resumen por tipo con el costo estimado, «Pedir todos», «Descargar .md», «Vaciar la lista» y
 * una tarjeta por archivo con «Quitar»). Acá se dice qué es un archivo pedido y cómo se lo manda: «Pedir todos» manda el lote
 * (`/api/agente/lote`, tipo `asociar`, con permisos acotados: solo páginas `feat-*` y `lib-*` y borradores en
 * `_drafts/`) con lo que está en la lista, en tandas de hasta 30 por cerebro y repo; ahí mismo se ve el avance,
 * «Cancelar todo» y el resumen. El .md lleva la lista entera para cualquier agente: en la página estática o sin agente
 * es el camino.
 * Lo que el agente asoció sale de la lista; lo que sigue sin asociar queda, para decidirlo. «Proponer funcionalidad
 * nueva» y «Crear librería» son otra instrucción (escriben borradores): siguen siendo un pedido suelto (`/api/agente`)
 * que se abre junto a la fila o a la lista que lo pidió. El código compartido se asocia a
 * una librería (`lib`) o se pide crear una; lo que no tiene pista se pide como funcionalidad nueva o se marca «No es de
 * producto» (`not-product.yaml` del cerebro, con su motivo), que se deshace desde «Marcados como no de producto».
 */
export const SIN_ASOCIAR_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("sinasociar");
  var CEREBROS = D.cerebros || [];
  var U = D.sinAsociar ? D.sinAsociar.slice() : null;
  var ED = window.FLOWBRAIN_EDICION || null;
  var L = function (en, es) { return window.brainI18n && window.brainI18n.lang === "es" ? es : en; };
  var num = function (n) { return Number(n).toLocaleString(window.brainI18n && window.brainI18n.lang === "es" ? "es" : "en"); };
  var CAPA_EN = { entrada: "Entry", logica: "Logic", dominio: "Domain", datos: "Data", interfaz: "Interface", otros: "Other" };
  var CAPA_ES = { entrada: "Entrada", logica: "Lógica", dominio: "Dominio", datos: "Datos", interfaz: "Interfaz", otros: "Otros" };
  var capa = function (k) { return L(CAPA_EN[k], CAPA_ES[k]) || k; };
  // TOPE_PEDIDO: los que lleva el texto para copiar. TANDA: los archivos de una tanda del lote en el servidor.
  var PASO = 30, VISIBLES = 8, TOPE_PEDIDO = 80, TANDA = 30;
  var S = null, fl = null;
  // PEDIDO: el pedido suelto abierto ({ tipo: feat | lib, xs: los archivos, donde: el archivo de la fila o "lista", copiado, mandando, error }).
  var OTRA = null, MSG = null, PEDIDO = null, ocupado = false, hechos = 0;
  // El pedido al agente es el componente único del visor (viewer-pedido): la lista, el panel, el lote y el estado del
  // agente. Con el visor servido y un agente instalado, el pedido se manda directo; si no, se copia.
  var PD = window.brainPedido;
  var AG = PD.agente;
  // Los pedidos «asociar» mandados desde esta pestaña (sobreviven a la recarga) y los que ya recargaron la lista al terminar.
  var CLAVE_AGENTE = "flowbrain.sinasociar.agente";
  var AGS = (function () { try { var j = JSON.parse(sessionStorage.getItem(CLAVE_AGENTE) || "{}"); return { mandados: j.mandados || {}, recargados: j.recargados || {} }; } catch (e) { return { mandados: {}, recargados: {} }; } })();
  var guardarAgs = function () { try { sessionStorage.setItem(CLAVE_AGENTE, JSON.stringify(AGS)); } catch (e) { /* sin sessionStorage */ } };
  // TRABAJOS: los pedidos sueltos mandados desde acá (lo que corre el agente lo trae el componente).
  var TRABAJOS = [];
  // Marcas «No es de producto» de cada cerebro ({ e: entrada, m: motivo, n: archivos que tapa, c: cerebro }).
  var IGN = D.noProducto ? D.noProducto.slice() : [];
  // NP: archivo con el panel «No es de producto» abierto; LIB: archivo con el selector de librería abierto.
  var NP = null, LIB = null;
  // CODIGO: el archivo abierto con «Ver código» ({ a, d: respuesta del servidor o null mientras lee, error }).
  var CODIGO = null;

  var plural = function (n, uno, varios) { return num(n) + " " + (n === 1 ? uno : varios); };
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

  // ---------- Confianza y motivo ----------
  // La confianza viene del motor (g[2]); el criterio está documentado en confianzaDe (core/engine/fidelidad.ts).
  var CONF = ["alta", "media", "baja"];
  var CONF_CLASE = { alta: "ok", media: "falta", baja: "na" };
  var CONF_COLOR = { alta: "var(--bien)", media: "var(--atencion)", baja: "var(--suave)" };
  var confDe = function (x) { return x.g && x.g[2] ? x.g[2] : ""; };
  var confEt = function (v) { return v === "alta" ? L("High", "Alta") : v === "media" ? L("Medium", "Media") : v === "baja" ? L("Low", "Baja") : v; };
  var confPorQue = function (v) {
    return v === "alta" ? L("Endpoints or direct imports point to this feature, and it clearly beats the next one.", "Endpoints o imports directos señalan a esta funcionalidad, y le gana clara a la siguiente.")
      : v === "media" ? L("It has direct signals, but another feature is not far behind.", "Tiene señales directas, pero otra funcionalidad no queda lejos.")
      : L("Only folder neighbors point to it, or another feature is almost tied: open the file before deciding.", "Solo la señalan los vecinos de carpeta, o otra funcionalidad está casi empatada: abrí el archivo antes de decidir.");
  };
  var etiquetaConf = function (x) {
    var v = confDe(x);
    return v ? ' <span class="fd-es ' + CONF_CLASE[v] + ' sa-conf" title="' + esc(confPorQue(v)) + '">' + L(confEt(v) + " confidence", "Confianza " + confEt(v).toLowerCase()) + "</span>" : "";
  };
  // El motivo en el idioma del visor, armado de las señales [tipo, cantidad, carpeta?]. Sin señales (datos de antes), el texto del motor.
  function motivoDe(id, texto, senales) {
    if (!senales || !senales.length) return texto || "";
    var f = nombre(id);
    return senales.map(function (s) {
      var n = s[1];
      if (s[0] === "endpoints") return L("serves " + plural(n, "endpoint", "endpoints") + " called by " + f, "atiende " + plural(n, "endpoint", "endpoints") + " que llama " + f);
      if (s[0] === "lo_usan") return L("imported by " + plural(n, "file", "files") + " of " + f, "lo importan " + plural(n, "archivo", "archivos") + " de " + f);
      if (s[0] === "usa") return L("imports " + plural(n, "file", "files") + " of " + f, "importa " + plural(n, "archivo", "archivos") + " de " + f);
      if (s[0] === "vecinos") return L(plural(n, "folder neighbor belongs", "folder neighbors belong") + " to " + f, plural(n, "vecino de carpeta es", "vecinos de carpeta son") + " de " + f);
      if (s[0] === "arriba") return L(plural(n, "file", "files") + " in " + s[2] + "/ " + (n === 1 ? "belongs" : "belong") + " to " + f, plural(n, "archivo", "archivos") + " de " + s[2] + "/ " + (n === 1 ? "es" : "son") + " de " + f);
      return texto || "";
    }).join("; ");
  }
  // Funcionalidades con página, del mismo cerebro: a esas se puede asociar.
  var featsDe = function (x) {
    return D.nodes.filter(function (n) { return n.t === "feat" && n.p && (x.c === undefined || n.c === x.c); }).sort(function (a, b) { return a.n.toLowerCase() < b.n.toLowerCase() ? -1 : 1; });
  };

  // Librerías con página, del mismo cerebro: ahí va el código compartido.
  var libsDe = function (x) {
    return D.nodes.filter(function (n) { return n.t === "lib" && n.p && (x.c === undefined || n.c === x.c); }).sort(function (a, b) { return a.n.toLowerCase() < b.n.toLowerCase() ? -1 : 1; });
  };
  // Los archivos de la misma carpeta y cerebro con la misma clase (compartido, sin pista): el alcance de los pedidos de una fila.
  var vecinosDe = function (x) { var k = carpetaDe(x.a), cl = clase(x); return U.filter(function (y) { return y.c === x.c && carpetaDe(y.a) === k && clase(y) === cl; }); };
  var filtrados = function () { return fl.filtrar(); };
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
  // Es una instrucción para el modelo: va siempre en inglés, sin importar el idioma del visor.
  function lineaDe(x) {
    var c = cerebroDe(x);
    return "- " + local(x.a, x) + (c ? " (brain " + c + ")" : "") + ": " +
      (x.g ? "recommended " + local(x.g[0], x) + " (" + x.g[1] + ")" + (x.o ? "; others: " + x.o.map(function (o) { return local(o[0], x); }).join(", ") : "")
        : x.m ? "shared code, used by " + x.m + " features"
        : "no hint: nothing links it to a feature");
  }
  function cola(out, xs, elegidos) {
    if (xs.length > elegidos.length) out.push("", (xs.length - elegidos.length) + " more remain for another batch.");
  }
  // El .md de «Descargar .md»: la lista entera, por cerebro y repo, para cualquier agente con acceso a los repos (como
  // el de «Tests pedidos»). Son instrucciones para el modelo: solo en inglés.
  function mdDeLista(es) {
    var porRepo = {}, orden = [], cerebros = [];
    es.forEach(function (e) {
      var r = "brain " + e.cerebro + ", " + e.archivo.split(":")[0];
      if (!porRepo[r]) { porRepo[r] = []; orden.push(r); } porRepo[r].push(e);
      if (cerebros.indexOf(e.cerebro) < 0) cerebros.push(e.cerebro);
    });
    var n = function (k) { return es.filter(function (e) { return e.clase === k; }).length; };
    var out = ["# Files to assign in FlowBrain", "",
      es.length + (es.length === 1 ? " file" : " files") + " (" + n("recomendada") + " with a recommendation, " + n("compartido") + " shared, " + n("sinpista") + " with no hint) in " + orden.length + (orden.length === 1 ? " repo" : " repos") + ". Today they belong to no feature or library.", "",
      "> **You need an agent with access to the repos** (Claude Code, Codex, Gemini CLI, OpenCode…): it has to open each file. A web chat won't do.", "",
      "Open your agent in the project folder and pass it this whole file.", "",
      "## How to assign", "",
      "- To assign a file: add repo:path to the codigo list in the frontmatter of the feature's page (the brain's product/feat-*.md). If a whole folder belongs to the same feature, add the folder.",
      "- The recommendation is a hint: open the file before deciding.",
      "- Shared code does not go to a feature: add it to the codigo of a lib page (technology/lib-*.md) or leave it unassigned, and say so.",
      "- If no feature covers it, propose a new one as a draft (_drafts/product/feat-<id>.md). Tests, configuration, scripts and generated files are not product: leave them and list them.",
      "- Only edit the brain's feature and library pages and drafts in _drafts/: never the repos' code.", "",
      "## The files", ""];
    orden.forEach(function (r) {
      out.push("### " + r + " (" + porRepo[r].length + ")", "");
      porRepo[r].forEach(function (e) { out.push(e.linea); });
      out.push("");
    });
    out.push("## When done", "",
      "1. Compile each brain: \u0060flowbrain compile --brain <brain>\u0060 (" + cerebros.map(function (c) { return "\u0060" + c + "\u0060"; }).join(", ") + ").",
      "2. Run \u0060flowbrain unassigned\u0060 to see what is still unassigned and why.",
      "3. Don't commit: the changes stay for review.", "");
    return out.join("\n");
  }
  // «Proponer funcionalidad nueva» (sin pista) y «Crear librería» (código compartido): borradores que una persona revisa.
  function textoNuevo(tipo, xs) {
    var elegidos = xs.slice(0, TOPE_PEDIDO);
    var out = tipo === "feat" ? [
      "Propose a new feature in FlowBrain for " + (elegidos.length === 1 ? "this file" : "these " + elegidos.length + " files") + ". Nothing links " + (elegidos.length === 1 ? "it" : "them") + " to an existing feature: no imports, no endpoints, no folder neighbors.",
      "Open each file. If they are product code, write a draft _drafts/product/feat-<id>.md in the brain folder with them in its codigo list (the folder, when all of it belongs), a business name, a one-line summary, and its use cases and specifications (flowbrain specs --guide). If they are several features, write one draft each. If a file does belong to an existing feature, assign it there instead.",
      "Tests, configuration, scripts and generated files are not product: leave them and list them, so they get marked as not product.",
      ""
    ] : [
      "Create a library in FlowBrain for " + (elegidos.length === 1 ? "this shared file" : "these " + elegidos.length + " shared files") + ": several features use each one and none dominates, so it is common code, not a feature.",
      "If a lib page that fits already exists (technology/lib-*.md), add them to its codigo list. If not, write a draft _drafts/<repo-id>/technology/lib-<id>.md in the brain folder with tipo: lib, a name, a one-line summary and the files (or their folder) in codigo. If they are unrelated, make more than one library.",
      ""
    ];
    elegidos.forEach(function (x) { out.push(lineaDe(x)); });
    cola(out, xs, elegidos);
    out.push("", "A person reviews the drafts and promotes them with " + "flowbrain promote <id> --write" + ": do not promote them yourself.");
    return out.join("\n");
  }
  var textoActual = function () { return textoNuevo(PEDIDO.tipo, PEDIDO.xs); };
  function copiar(texto, listo) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(function () { listo(true); }, function () { listo(false); }); return; }
    } catch (e) { /* sin portapapeles */ }
    listo(false);
  }
  function abrirPedido(tipo, xs, donde) {
    PEDIDO = { tipo: tipo, xs: xs, donde: donde, copiado: false };
    pintarLista();
    // Sin agente, copiar es lo único: se copia al abrir. Con agente, copiar queda como botón.
    if (!AG) copiar(textoActual(), function (ok) { if (PEDIDO) { PEDIDO.copiado = ok ? true : "no"; pintarLista(); } });
  }
  var proveedor = function () { return PD.proveedor(); };
  var modelo = function () { return PD.modelo(); };
  var copiadoHtml = function () { return PEDIDO.copiado === true ? '<span class="fd-ok">' + L("Copied. Paste it into your agent.", "Copiado. Pegalo en tu agente.") + "</span>" : PEDIDO.copiado === "no" ? '<span class="fd-nota">' + L("Could not copy automatically: select the text and copy it.", "No se pudo copiar solo: seleccioná el texto y copialo.") + "</span>" : ""; };
  // «Proponer funcionalidad nueva» y «Crear librería»: se abre junto a la fila (donde: su archivo) o a la lista que lo pidió.
  function pedido(donde) {
    if (!PEDIDO || PEDIDO.donde !== donde) return "";
    var xs = PEDIDO.xs, n = Math.min(xs.length, TOPE_PEDIDO), t = PEDIDO.tipo;
    var titulo = t === "feat" ? L("Propose a new feature", "Proponer funcionalidad nueva") : L("Create a library", "Crear librería");
    var que = t === "feat"
      ? L("The agent opens these " + plural(n, "file", "files") + " and writes a draft feature with them in <code>_drafts/product/</code>, with its use cases and specifications. A person reviews and promotes it: until then the files stay here.", "El agente abre " + (n === 1 ? "este archivo" : "estos " + num(n) + " archivos") + " y escribe un borrador de funcionalidad con " + (n === 1 ? "él" : "ellos") + " en <code>_drafts/product/</code>, con sus casos de uso y especificaciones. Una persona lo revisa y lo promueve: hasta entonces siguen acá.")
      : L("The agent adds these " + plural(n, "shared file", "shared files") + " to a library that fits, or writes a draft library in <code>_drafts/</code>. A person reviews and promotes the draft: until then they stay here.", "El agente suma " + (n === 1 ? "este archivo compartido" : "estos " + num(n) + " archivos compartidos") + " a una librería que encaje, o escribe un borrador de librería en <code>_drafts/</code>. Una persona revisa y promueve el borrador: hasta entonces siguen acá.");
    var recorte = xs.length > TOPE_PEDIDO ? " " + L("It carries the first " + TOPE_PEDIDO + " of " + num(xs.length) + ": send the rest in another request once these are done.", "Lleva los primeros " + TOPE_PEDIDO + " de " + num(xs.length) + ": el resto va en otro pedido cuando terminen estos.") : "";
    var pr = proveedor(), mo = modelo();
    var envio = AG
      ? PD.selector("sa-ped", false) + '<div class="fd-hacer"><button type="button" class="boton pri" data-acc="mandar"' + (PEDIDO.mandando || !n ? " disabled" : "") + ">" + (PEDIDO.mandando ? L("Sending…", "Mandando…") : L("Send to the agent", "Mandar al agente") + " (" + plural(n, L("file", "archivo"), L("files", "archivos")) + ")") + "</button>" +
        '<button type="button" class="boton" data-acc="copiar">' + L("Copy the text", "Copiar el texto") + "</button></div>" +
        '<p class="fd-nota">' + L("It runs " + esc(pr ? pr.nombre : "") + (mo ? " (" + esc(mo.nombre) + ")" : "") + " in this project. It can only write the brain's feature and library pages and drafts in <code>_drafts/</code>, never the repos' code. When it finishes, the page reloads with the list up to date.", "Lo corre " + esc(pr ? pr.nombre : "") + (mo ? " (" + esc(mo.nombre) + ")" : "") + " en este proyecto. Solo puede escribir las páginas de funcionalidades y librerías del cerebro y borradores en <code>_drafts/</code>, nunca el código de los repos. Cuando termina, la página se recarga con la lista al día.") + "</p>"
      : ED
      ? '<p class="fd-nota">' + L("It can't be sent directly: ", "No se puede mandar directo: ") + esc((ED.agente && ED.agente.noDisponible) || L("the server did not report any agent", "el servidor no informó ningún agente")) + ". " + L("Copy it and paste it into your agent.", "Copialo y pegalo en tu agente.") + ' <button type="button" class="boton chico" data-acc="copiar">' + L("Copy", "Copiar") + "</button></p>"
      : '<p class="fd-nota">' + L("This page is static, so it can't send the request: paste it into your agent (with access to the repos, not a web chat). To send it from here, open the page with <code>flowbrain viewer --serve</code>.", "Esta página es estática, así que no puede mandar el pedido: pegalo en tu agente (con acceso a los repos, no un chat web). Para mandarlo desde acá, abrí la página con <code>flowbrain viewer --serve</code>.") + ' <button type="button" class="boton chico" data-acc="copiar">' + L("Copy again", "Copiar de nuevo") + "</button></p>";
    return '<div class="fd-plan sa-pedido"><div class="es-cab"><h2>' + titulo + '</h2><button type="button" class="boton chico" data-acc="cerrar-pedido" aria-label="' + L("Close the request", "Cerrar el pedido") + '">✕</button></div>' +
      '<p class="fd-nota">' + que + recorte + "</p>" + envio +
      (PEDIDO.error ? '<p class="fd-msg error">' + L("It could not be sent: ", "No se pudo mandar: ") + esc(PEDIDO.error) + "</p>" : "") +
      '<textarea class="fd-texto" readonly rows="10" aria-label="' + titulo + '">' + esc(textoActual()) + "</textarea>" + copiadoHtml() + "</div>";
  }
  // Pedidos que cubren la lista filtrada entera: los de código compartido y los sin pista, de a todos juntos.
  function pedidosDeLista(xs) {
    var comp = xs.filter(function (x) { return clase(x) === "compartido"; }).length, sin = xs.filter(function (x) { return clase(x) === "sinpista"; }).length;
    if (comp < 2 && sin < 2) return "";
    return '<div class="fd-hacer sa-lote">' +
      (comp >= 2 ? '<button type="button" class="boton" data-acc="crear-lib" data-todos="1">' + L("Create a library with the " + num(comp) + " shared ones", "Crear librería con los " + num(comp) + " compartidos") + "</button>" : "") +
      (sin >= 2 ? '<button type="button" class="boton" data-acc="nueva-feat" data-todos="1">' + L("Propose a feature for the " + num(sin) + " with no hint", "Proponer funcionalidad para los " + num(sin) + " sin pista") + "</button>" : "") +
      "<small>" + L("With the files in the list below, filters applied.", "Con los archivos de la lista de abajo, con los filtros aplicados.") + "</small></div>" + pedido("lista");
  }

  // ---------- El tipo «asociar» del pedido al agente (viewer-pedido, dec. 229) ----------
  // El ítem: { tipo: "asociar", k: "cerebro|repo:ruta", cerebro, repo, datos: { k, cerebro, archivo, nombre, clase, rec, conf, linea } }.
  var claveDe = function (x) { return cerebroDe(x) + "|" + local(x.a, x); };
  function entradaDe(x) {
    var e = { k: claveDe(x), cerebro: cerebroDe(x), archivo: local(x.a, x), nombre: archivoDe(x.a), clase: clase(x), rec: x.g ? nombre(x.g[0]) : "", conf: confDe(x), linea: lineaDe(x) };
    return { tipo: "asociar", k: e.k, cerebro: e.cerebro, repo: e.archivo.split(":")[0], datos: e };
  }
  // Lo que ya no está sin asociar (se asoció, se marcó como no de producto) sale del pedido; lo que sigue, se pone al día.
  function podarLista() {
    if (!U) return;
    var vigentes = {}; U.forEach(function (x) { vigentes[claveDe(x)] = x; });
    PD.podar("asociar", function (it) { return vigentes[it.k] ? entradaDe(vigentes[it.k]) : null; });
  }
  // Lo que suma cada botón celeste, según su data-k: «a|<archivo>», «c|<carpeta>» o «l|» (la lista filtrada).
  function xsDeBoton(k, memo) {
    if (!k || !U) return [];
    if (k.indexOf("a|") === 0) { var x = porArchivo(k.slice(2)); return x ? [x] : []; }
    // La carpeta como se ve: con los filtros aplicados (el botón dice cuántos).
    if (k.indexOf("c|") === 0) { var cs = memo ? memo.cs || (memo.cs = carpetas(filtrados())) : carpetas(filtrados()); for (var i = 0; i < cs.length; i++) if (cs[i].k === k.slice(2)) return cs[i].xs; return []; }
    if (k === "l|") return filtrados();
    return [];
  }
  var botonSumar = function (k, xs, et) { return PD.boton({ tipo: "asociar", k: k, et: et, claves: xs.map(claveDe) }); };
  var cuentaClase = function (es, k) { return es.filter(function (e) { return e.datos.clase === k; }).length; };
  // Cuántas tandas arma el servidor con la lista: por cerebro y repo, de hasta TANDA archivos.
  function tandasDeLista(es) {
    var g = {}, n = 0;
    es.forEach(function (e) { var k = e.cerebro + "|" + e.repo; g[k] = (g[k] || 0) + 1; });
    Object.keys(g).forEach(function (k) { n += Math.ceil(g[k] / TANDA); });
    return n;
  }
  PD.registrar("asociar", {
    get nombre() { return L("Files to assign", "Archivos a asociar"); },
    unidad: ["file", "files", "archivo", "archivos"],
    raiz: raiz,
    claves: function (k, memo) { return xsDeBoton(k, memo).map(claveDe); },
    items: function (k) { return xsDeBoton(k).map(entradaDe); },
    repintar: function () { if (U && U.length) pintarLista(); },
    resumen: function (es) {
      return [L(num(cuentaClase(es, "recomendada")) + " with a recommendation · " + num(cuentaClase(es, "compartido")) + " shared · " + num(cuentaClase(es, "sinpista")) + " with no hint", num(cuentaClase(es, "recomendada")) + " con recomendación · " + plural(cuentaClase(es, "compartido"), "compartido", "compartidos") + " · " + num(cuentaClase(es, "sinpista")) + " sin pista"),
        AG && es.length ? L("In " + plural(tandasDeLista(es), "batch", "batches") + " of up to " + TANDA + " files of the same repo", "En " + plural(tandasDeLista(es), "tanda", "tandas") + " de hasta " + TANDA + " archivos de un mismo repo") : ""];
    },
    costo: function (mo) { return typeof mo.costoPorArchivoUsd === "number" ? mo.costoPorArchivoUsd : null; },
    lote: function (es) { return { tipo: "asociar", archivos: es.map(function (e) { return { cerebro: e.datos.cerebro, archivo: e.datos.archivo, linea: e.datos.linea }; }) }; },
    md: { archivo: "archivos-pedidos.md", texto: function (es) { return mdDeLista(es.map(function (e) { return e.datos; })); } },
    tanda: { lista: "archivos", clave: function (a) { return a.cerebro + "|" + a.archivo; } },
    seguimiento: {
      pidiendo: function (n, repos) { return L("Assigning " + plural(n, "file", "files") + " in " + plural(repos, "repo", "repos"), "Asociando " + plural(n, "archivo", "archivos") + " en " + plural(repos, "repo", "repos")); },
    },
    // La tarjeta de cada archivo: su nombre y motivo, la recomendada con su confianza (o compartido / sin pista) y el cerebro.
    tarjeta: function (it) {
      var e = it.datos, x = porArchivoDe(e.k);
      var chips = e.clase === "recomendada"
        ? (e.conf ? '<span class="chip' + (e.conf === "alta" ? " es-ok" : e.conf === "media" ? " es-aviso" : "") + '" title="' + esc(confPorQue(e.conf)) + '">' + L(confEt(e.conf) + " confidence", "Confianza " + confEt(e.conf).toLowerCase()) + "</span>" : "") +
          '<span class="chip" title="' + L("Recommended feature", "Funcionalidad recomendada") + '">→ ' + esc(e.rec) + "</span>"
        : '<span class="chip">' + (e.clase === "compartido" ? L("Shared code", "Código compartido") : L("No hint", "Sin pista")) + "</span>";
      var motivo = !x ? "" : x.g ? motivoDe(x.g[0], x.g[1], x.g[3])
        : x.m ? L("Used by " + x.m + " features and none dominates: it fits a library.", "Lo usan " + x.m + " funcionalidades y ninguna domina: conviene una librería.")
        : L("Nothing links it to a feature: no imports, no endpoints, no folder neighbors.", "Nada lo une a una funcionalidad: ni imports, ni endpoints, ni vecinos de carpeta.");
      return '<p class="es-texto"><code>' + esc(e.nombre) + "</code>" + (motivo ? " <small>" + esc(motivo) + "</small>" : "") + '</p><div class="chips">' + chips + '<span class="chip es-cerebro" title="' + L("Brain", "Cerebro") + '">' + esc(e.cerebro) + '</span></div><small class="es-archivo">' + L("File: ", "Archivo: ") + "<code>" + esc(e.archivo) + "</code></small>";
    }
  });
  // El archivo sin asociar de una clave del pedido (para el motivo de la tarjeta).
  function porArchivoDe(k) { if (!U) return null; for (var i = 0; i < U.length; i++) if (claveDe(U[i]) === k) return U[i]; return null; }

  // ---------- El agente: lo mandado desde acá, su avance y su cancelación ----------
  var llamar = function (ruta, cuerpo) { return PD.llamar(ruta, cuerpo); };
  var vivo = function (t) { return PD.vivo(t); };
  function mandar() {
    if (!PEDIDO || !AG || PEDIDO.mandando) return;
    var xs = PEDIDO.xs.slice(0, TOPE_PEDIDO);
    if (!xs.length) return;
    var cerebros = [];
    xs.forEach(function (x) { var c = cerebroDe(x); if (c && cerebros.indexOf(c) < 0) cerebros.push(c); });
    var t = PEDIDO.tipo, pr = proveedor(), mo = modelo();
    var etiqueta = t === "feat" ? L("Propose a feature for " + plural(xs.length, "file", "files"), "Proponer funcionalidad para " + plural(xs.length, "archivo", "archivos"))
      : L("Create a library for " + plural(xs.length, "shared file", "shared files"), "Crear librería para " + plural(xs.length, "archivo compartido", "archivos compartidos"));
    PEDIDO.mandando = true; PEDIDO.error = null; pintarLista();
    llamar("/api/agente", { tipo: "asociar", pedido: textoActual(), etiqueta: etiqueta, cerebros: cerebros, proveedor: pr ? pr.id : undefined, modelo: mo ? mo.id : undefined })
      .then(function (tr) {
        AGS.mandados[tr.id] = true; guardarAgs();
        PEDIDO = null; TRABAJOS = [tr].concat(TRABAJOS.filter(function (x) { return x.id !== tr.id; }));
        repintar(); PD.actualizar();
      })
      .catch(function (e) { if (PEDIDO) { PEDIDO.mandando = false; PEDIDO.error = e.message; pintarLista(); } });
  }
  var recargar = function () { if (typeof window.location !== "undefined" && window.location && window.location.reload) { window.location.reload(); return true; } return false; };
  // Lo que corre el agente lo trae el componente para todo el visor: acá, los pedidos sueltos mandados desde esta pestaña.
  PD.escuchar(function (ev) {
    if (ev !== "trabajos") return;
    TRABAJOS = PD.trabajos().filter(function (t) { return t.tipo === "asociar" && !t.lote && AGS.mandados[t.id]; });
    // Terminó uno mandado desde acá: la página se recarga una vez, con la lista que dejó el agente (ya recompilada).
    var nuevos = TRABAJOS.filter(function (t) { return t.estado === "terminado" && !AGS.recargados[t.id]; });
    if (nuevos.length) {
      nuevos.forEach(function (t) { AGS.recargados[t.id] = true; }); guardarAgs();
      if (recargar()) return;
    }
    repintar();
  });
  var ESTADOS = function (e) { return PD.estado(e); };
  function unTrabajo(t) {
    var e = ESTADOS(t.estado), pasos = t.pasos || [];
    var cambios = (t.cambios || []).map(function (c) { return "<li><b>" + esc(c.repo) + "</b>: " + c.archivos.map(function (a) { return "<code>" + esc(a) + "</code>"; }).join(" ") + "</li>"; }).join("");
    return '<li class="es-trabajo"><div class="es-cab"><b>' + esc(t.etiqueta) + '</b><span class="fd-es ' + e[1] + '">' + e[0] + "</span></div>" +
      (vivo(t) && pasos.length ? '<ul class="es-pasos">' + pasos.slice(-4).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (t.estado === "en_cola" ? "<small>" + L("Waits for the previous request to finish.", "Espera a que termine el pedido anterior.") + "</small>" : "") +
      (t.estado === "corriendo" ? "<small>" + L("When it finishes, the page reloads with the list up to date.", "Cuando termine, la página se recarga con la lista al día.") + "</small>" : "") +
      (t.estado === "terminado" ? "<small>" + L("The list below already includes what it assigned. The drafts it wrote are reviewed and promoted with <code>flowbrain promote</code>.", "La lista de abajo ya incluye lo que asoció. Los borradores que escribió se revisan y se promueven con <code>flowbrain promote</code>.") + "</small>" : "") +
      (t.error ? '<p class="fd-msg error">' + esc(t.error) + "</p>" : "") +
      (!vivo(t) && t.resultado ? '<details class="tf"><summary>' + L("What the agent said", "Lo que dijo el agente") + '</summary><p class="es-resultado">' + esc(t.resultado) + "</p></details>" : "") +
      (cambios ? '<div class="es-cambios"><small>' + L("Changed in the repos, uncommitted:", "Cambió en los repos, sin commitear:") + "</small><ul>" + cambios + "</ul></div>" : "") +
      '<div class="fd-acc">' + (vivo(t) ? '<button type="button" class="boton" data-acc="cancelar-agente" data-k="' + esc(t.id) + '">' + L("Cancel", "Cancelar") + "</button>" : '<button type="button" class="boton" data-acc="cerrar-agente" data-k="' + esc(t.id) + '">' + L("Close", "Cerrar") + "</button>") +
      (t.estado === "fallo" || t.estado === "cancelado" ? '<button type="button" class="boton" data-acc="recargar">' + L("Reload to see what it changed", "Recargar para ver lo que cambió") + "</button>" : "") + "</div></li>";
  }
  // Los pedidos sueltos («Proponer funcionalidad», «Crear librería») se ven en la página; el lote, en el panel.
  function htmlAgente() {
    if (!AG || !TRABAJOS.length) return "";
    return '<div class="sa-agente"><h2>' + L("The agent", "El agente") + '</h2><ul class="lista">' + TRABAJOS.map(unTrabajo).join("") + "</ul></div>";
  }

  // ---------- No es de producto ----------
  var MOTIVOS = ["test", "config", "script", "generado", "otro"];
  var motivoEt = function (m) {
    return m === "test" ? L("Tests", "Tests") : m === "config" ? L("Configuration", "Configuración") : m === "script" ? L("Script", "Script") : m === "generado" ? L("Generated", "Generado") : L("Other", "Otro");
  };
  // El motivo que se propone según la ruta; la persona lo cambia si no es.
  var motivoProbable = function (a) {
    var r = archivoDe(a), ruta = a.slice(a.indexOf(":") + 1);
    if (/(^|\/)(tests?|__tests__|spec|e2e|fixtures|mocks?)\//i.test(ruta) || /[._-](test|spec)\./i.test(r)) return "test";
    if (/(^|\/)(generated|__generated__|gen|dist|build)\//i.test(ruta) || /\.(g|gen|generated)\.[^.]+$/i.test(r)) return "generado";
    if (/(^|\/)(scripts?|bin|tools)\//i.test(ruta)) return "script";
    if (/(^|\/)(config|conf|settings)\//i.test(ruta) || /(\.config\.[^.]+|rc|\.(json|ya?ml|toml|ini|env\.example))$/i.test(r)) return "config";
    return "otro";
  };
  var cubre = function (e, y) { return y.a === e || y.a.indexOf(e + "/") === 0; };
  // El archivo y las carpetas que lo contienen (hasta 4, sin la raíz del repo), con cuántos sin asociar taparía cada una.
  function alcances(x) {
    var out = [[x.a, L("This file", "Este archivo") + " (" + archivoDe(x.a) + ")"]], k = carpetaDe(x.a);
    while (out.length < 5 && k.charAt(k.length - 1) !== ":") {
      var n = U.filter(function (y) { return y.c === x.c && cubre(k, y); }).length;
      out.push([k, L("The folder ", "La carpeta ") + rutaDe(k, x) + "/ (" + plural(n, L("unassigned file", "archivo sin asociar"), L("unassigned files", "archivos sin asociar")) + ")"]);
      k = carpetaDe(k);
    }
    return out;
  }
  function panelNoProducto(x) {
    var m = motivoProbable(x.a);
    return '<div class="fd-ed sa-np"><p class="fd-nota">' + L("It stops being listed here and in <code>sin_asociar</code>. It is saved in the brain's <code>not-product.yaml</code>, and you can undo it in «Marked as not product».", "Deja de listarse acá y en <code>sin_asociar</code>. Se guarda en el <code>not-product.yaml</code> del cerebro, y se deshace en «Marcados como no de producto».") + "</p>" +
      '<div class="fd-linea"><label>' + L("What", "Qué") + ' <select id="sa-np-entrada">' + alcances(x).map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select></label> " +
      "<label>" + L("Why", "Por qué") + ' <select id="sa-np-motivo">' + MOTIVOS.map(function (v) { return '<option value="' + v + '"' + (v === m ? " selected" : "") + ">" + motivoEt(v) + "</option>"; }).join("") + "</select></label> " +
      '<button type="button" class="boton pri" data-acc="noprod-marcar" data-a="' + esc(x.a) + '"' + (ocupado ? " disabled" : "") + ">" + L("Mark as not product", "Marcar como no de producto") + "</button>" +
      '<button type="button" class="boton" data-acc="noprod" data-a="' + esc(x.a) + '">' + L("Cancel", "Cancelar") + "</button></div></div>";
  }
  var totalIgn = function () { return IGN.reduce(function (n, m) { return n + (m.n || 0); }, 0); };
  function htmlIgnorados() {
    if (!IGN.length) return "";
    var t = totalIgn();
    return '<details class="tf sa-ign"><summary>' + L("Marked as not product: " + plural(t, "file", "files") + " (" + plural(IGN.length, "entry", "entries") + ")", "Marcados como no de producto: " + plural(t, "archivo", "archivos") + " (" + plural(IGN.length, "entrada", "entradas") + ")") + "</summary>" +
      '<p class="fd-nota">' + L("Tests, configuration, scripts or generated files: they are not listed above or in <code>sin_asociar</code>. They live in each brain's <code>not-product.yaml</code>.", "Tests, configuración, scripts o generados: no se listan arriba ni en <code>sin_asociar</code>. Viven en el <code>not-product.yaml</code> de cada cerebro.") +
      (ED ? "" : " " + L("To list them again, remove the entry from that file and recompile, or open this page with <code>flowbrain viewer --serve</code> and undo it here.", "Para volver a listarlos, sacá la entrada de ese archivo y recompilá, o abrí esta página con <code>flowbrain viewer --serve</code> y deshacela acá.")) + "</p>" +
      '<ul class="lista">' + IGN.map(function (m, i) {
        var c = CEREBROS.length > 1 && CEREBROS[m.c] ? ' <span class="chip">' + esc(CEREBROS[m.c].nombre) + "</span>" : "";
        return '<li class="sa-ign-fila"><code>' + esc(local(m.e, m)) + '</code> <span class="chip">' + motivoEt(m.m) + "</span>" + c + " <small>" +
          (m.n ? plural(m.n, L("unassigned file hidden", "archivo sin asociar oculto"), L("unassigned files hidden", "archivos sin asociar ocultos")) : L("it hides no unassigned file today", "hoy no oculta ningún archivo sin asociar")) + "</small>" +
          (ED ? ' <button type="button" class="boton chico" data-acc="noprod-deshacer" data-k="' + i + '"' + (ocupado ? " disabled" : "") + ">" + L("Undo", "Deshacer") + "</button>" : "") + "</li>";
      }).join("") + "</ul></details>";
  }

  // ---------- Filas ----------
  function selector(clave, x) {
    var fs = featsDe(x);
    if (!fs.length) return '<p class="fd-nota">' + L("This brain has no features with a page yet: create them with <code>/flowbrain-features</code>.", "Este cerebro no tiene funcionalidades con página todavía: se crean con <code>/flowbrain-features</code>.") + "</p>";
    return '<div class="fd-linea sa-otra"><select id="sa-feat" aria-label="' + L("Feature", "Funcionalidad") + '">' + fs.map(function (n) { return '<option value="' + esc(n.id) + '">' + esc(n.n) + "</option>"; }).join("") + "</select>" +
      '<button type="button" class="boton pri" data-acc="asociar-elegida" data-k="' + esc(clave) + '"' + (ocupado ? " disabled" : "") + ">" + L("Assign", "Asociar") + "</button></div>";
  }
  function selectorLib(x) {
    var ls = libsDe(x);
    return '<div class="fd-linea sa-otra"><select id="sa-lib" aria-label="' + L("Library", "Librería") + '">' + ls.map(function (n) { return '<option value="' + esc(n.id) + '">' + esc(n.n) + "</option>"; }).join("") + "</select>" +
      '<button type="button" class="boton pri" data-acc="asociar-lib" data-k="' + esc(x.a) + '"' + (ocupado ? " disabled" : "") + ">" + L("Assign", "Asociar") + "</button></div>";
  }
  function fila(x) {
    var que = x.g
      ? '<span class="sa-rec">→ <a href="#/f/' + encodeURIComponent(x.g[0]) + '">' + esc(nombre(x.g[0])) + "</a></span>" + etiquetaConf(x) + " <small>" + esc(motivoDe(x.g[0], x.g[1], x.g[3])) + "</small>"
      : x.m ? '<span class="fd-es na">' + L("Shared code", "Código compartido") + "</span> <small>" + L("Used by " + x.m + " features and none dominates: it fits a library, not a feature.", "Lo usan " + x.m + " funcionalidades y ninguna domina: conviene una librería, no una funcionalidad.") +
        (ED && !libsDe(x).length ? " " + L("This brain has no library yet: «Create library» asks the agent for one.", "Este cerebro no tiene librerías todavía: «Crear librería» se la pide al agente.") : "") + "</small>"
      : '<span class="fd-es na">' + L("No hint", "Sin pista") + "</span> <small>" + L("Nothing links it to a feature: no imports, no endpoints, no folder neighbors.", "Nada lo une a una funcionalidad: ni imports, ni endpoints, ni vecinos de carpeta.") + "</small>";
    // «Sumar al pedido» va primero, como «Pedir el test» en Especificaciones: también sin servidor (ahí se copia).
    var botones = botonSumar("a|" + x.a, [x], L("Request", "Pedir"));
    if (ED) {
      var a = ' data-a="' + esc(x.a) + '"' + (ocupado ? " disabled" : "");
      botones += (x.g ? '<button type="button" class="boton pri" data-acc="asociar" data-f="' + esc(x.g[0]) + '"' + a + ">" + L("Assign to ", "Asociar a ") + esc(nombre(x.g[0])) + "</button>" : "") +
        (x.o || []).map(function (o) { return '<button type="button" class="boton" data-acc="asociar" data-f="' + esc(o[0]) + '" title="' + esc(motivoDe(o[0], o[1], o[2])) + '"' + a + ">" + esc(nombre(o[0])) + "</button>"; }).join("") +
        '<button type="button" class="boton' + (OTRA === x.a ? " on" : "") + '" data-acc="otra" data-k="' + esc(x.a) + '">' + (x.g ? L("Another…", "Otra…") : L("Choose feature", "Elegir funcionalidad")) + "</button>" +
        '<button type="button" class="boton' + (CODIGO && CODIGO.a === x.a ? " on" : "") + '" data-acc="codigo" data-a="' + esc(x.a) + '">' + (CODIGO && CODIGO.a === x.a ? L("Hide code", "Ocultar código") : L("View code", "Ver código")) + "</button>" +
        (x.m && libsDe(x).length ? '<button type="button" class="boton' + (LIB === x.a ? " on" : "") + '" data-acc="lib" data-a="' + esc(x.a) + '">' + L("Assign to a library…", "Asociar a una librería…") + "</button>" : "") +
        (clase(x) === "sinpista" ? '<button type="button" class="boton' + (NP === x.a ? " on" : "") + '" data-acc="noprod" data-a="' + esc(x.a) + '">' + L("Not product…", "No es de producto…") + "</button>" : "");
    }
    // Los pedidos al agente se arman también sin servidor: ahí se copian.
    var cl = clase(x), nv = cl === "recomendada" ? 0 : vecinosDe(x).length;
    if (cl === "compartido") botones += '<button type="button" class="boton" data-acc="crear-lib" data-a="' + esc(x.a) + '" title="' + esc(L("With the shared files of this folder", "Con los archivos compartidos de esta carpeta")) + '">' + L("Create library", "Crear librería") + (nv > 1 ? " (" + num(nv) + ")" : "") + "</button>";
    if (cl === "sinpista") botones += '<button type="button" class="boton" data-acc="nueva-feat" data-a="' + esc(x.a) + '" title="' + esc(L("With the files of this folder that have no hint", "Con los archivos sin pista de esta carpeta")) + '">' + L("Propose new feature", "Proponer funcionalidad nueva") + (nv > 1 ? " (" + num(nv) + ")" : "") + "</button>";
    return '<li class="sa-fila"><div class="sa-que"><code title="' + esc(local(x.a, x)) + '">' + esc(archivoDe(x.a)) + '</code> <span class="capa capa-' + esc(x.k) + '">' + esc(capa(x.k)) + "</span><div>" + que + "</div></div>" +
      (botones ? '<div class="fd-hacer">' + botones + "</div>" : "") + (OTRA === x.a ? selector(x.a, x) : "") + (LIB === x.a ? selectorLib(x) : "") + (NP === x.a ? panelNoProducto(x) : "") + (CODIGO && CODIGO.a === x.a ? panelCodigo(x) : "") + pedido(x.a) + "</li>";
  }
  // ---------- Ver código ----------
  function panelCodigo(x) {
    var d = CODIGO.d, ruta = local(x.a, x);
    if (CODIGO.error) return '<div class="fd-ed sa-codigo"><p class="fd-msg error">' + L("Could not read the file: ", "No se pudo leer el archivo: ") + esc(CODIGO.error) + "</p></div>";
    if (!d) return '<div class="fd-ed sa-codigo"><p class="vacio">' + L("Reading the file…", "Leyendo el archivo…") + "</p></div>";
    if (d.error) return '<div class="fd-ed sa-codigo"><p class="fd-nota">' + L("There is no code to show for <code>" + esc(ruta) + "</code>: ", "No hay código para mostrar de <code>" + esc(ruta) + "</code>: ") + esc(d.error) + "</p></div>";
    var ls = d.lineas || [];
    if (!ls.length || (ls.length === 1 && ls[0] === "")) return '<div class="fd-ed sa-codigo"><p class="fd-nota">' + L("The file <code>" + esc(ruta) + "</code> is empty.", "El archivo <code>" + esc(ruta) + "</code> está vacío.") + "</p></div>";
    var r = d.recortado;
    var nota = !r ? "" : '<p class="fd-nota">' + (r.total === null
      ? L("Showing the first " + num(r.mostradas) + " lines: the file weighs " + num(Math.round(r.bytes / 1024)) + " KB, more than this view shows. Open it in your editor to see the rest.", "Se muestran las primeras " + num(r.mostradas) + " líneas: el archivo pesa " + num(Math.round(r.bytes / 1024)) + " KB, más de lo que muestra esta vista. Abrilo en tu editor para ver el resto.")
      : L("Showing " + num(r.mostradas) + " of " + num(r.total) + " lines. Open it in your editor to see the rest.", "Se muestran " + num(r.mostradas) + " de " + num(r.total) + " líneas. Abrilo en tu editor para ver el resto.")) + "</p>";
    return '<div class="fd-ed sa-codigo"><div class="sa-codigo-cab"><code>' + esc(ruta) + "</code> <small>" + plural(ls.length, L("line", "línea"), L("lines", "líneas")) + "</small></div>" + nota +
      '<pre class="sa-pre">' + ls.map(function (l, i) { return '<span class="sa-ln">' + (i + 1) + "</span>" + esc(l); }).join("\n") + "</pre></div>";
  }
  function verCodigo(a) {
    if (CODIGO && CODIGO.a === a) { CODIGO = null; pintarLista(); return; }
    var x = porArchivo(a);
    if (!x || !ED) return;
    CODIGO = { a: a, d: null }; pintarLista();
    fetch("/api/archivo?cerebro=" + encodeURIComponent(cerebroDe(x)) + "&archivo=" + encodeURIComponent(local(x.a, x)) + "&contenido=1", { method: "GET", headers: { "x-flowbrain-token": ED.token } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); })
      .then(function (d) { if (CODIGO && CODIGO.a === a) { CODIGO.d = d; pintarLista(); } })
      .catch(function (e) { if (CODIGO && CODIGO.a === a) { CODIGO.error = e.message; pintarLista(); } });
  }
  function grupo(g) {
    var x0 = g.xs[0], c = CEREBROS.length > 1 ? cerebroDe(x0) : "", ruta = rutaDe(g.carpeta, x0), repo = repoDe(g.carpeta + (ruta ? "" : "x"), x0);
    var rec = g.feat
      ? '<span class="chip">' + L("Recommended: ", "Recomendada: ") + esc(nombre(g.feat)) + (g.votos < g.xs.length ? " (" + g.votos + L(" of ", " de ") + g.xs.length + ")" : "") + "</span>"
      : "";
    var acciones = "";
    if (ED && ruta) {
      var dis = ocupado ? " disabled" : "";
      acciones = g.libre
        ? (g.feat ? '<button type="button" class="boton pri" data-acc="asociar-carpeta" data-k="' + esc(g.k) + '" data-f="' + esc(g.feat) + '"' + dis + ">" + L("Assign the folder to ", "Asociar la carpeta a ") + esc(nombre(g.feat)) + "</button>" : "") +
          '<button type="button" class="boton' + (OTRA === g.k ? " on" : "") + '" data-acc="otra" data-k="' + esc(g.k) + '">' + (g.feat ? L("To another…", "A otra…") : L("Assign the folder…", "Asociar la carpeta…")) + "</button>"
        : "";
    }
    var nota = ED && ruta && !g.libre ? '<p class="fd-nota">' + L("Other files in this folder already belong to a feature: here you assign them one by one.", "Otros archivos de esta carpeta ya son de alguna funcionalidad: acá se asocia de a uno.") + "</p>" : "";
    var visibles = g.xs.slice(0, VISIBLES), resto = g.xs.slice(VISIBLES);
    return '<section class="es-feat"><div class="es-cab"><h3><code>' + esc(ruta ? ruta + "/" : L("(repo root)", "(raíz del repo)")) + "</code>" + (repo ? " <small>" + esc(repo) + "</small>" : "") + "</h3>" +
      '<div class="es-acciones"><div class="chips"><span class="chip">' + plural(g.xs.length, L("file", "archivo"), L("files", "archivos")) + "</span>" + rec + (c ? '<span class="chip">' + esc(c) + "</span>" : "") + "</div>" +
      botonSumar("c|" + g.k, g.xs, g.xs.length === 1 ? L("Request", "Pedir") : L("Request the " + num(g.xs.length), "Pedir los " + num(g.xs.length))) + "</div></div>" +
      (acciones ? '<div class="fd-hacer sa-acc">' + acciones + "</div>" : "") + (OTRA === g.k ? selector(g.k, x0) : "") + nota +
      '<ul class="lista">' + visibles.map(fila).join("") + "</ul>" +
      (resto.length ? '<details class="tf"' + (resto.some(function (x) { return OTRA === x.a || LIB === x.a || NP === x.a || (CODIGO && CODIGO.a === x.a) || (PEDIDO && PEDIDO.donde === x.a); }) ? " open" : "") + "><summary>" + plural(resto.length, L("more file", "archivo más"), L("more files", "archivos más")) + '</summary><ul class="lista">' + resto.map(fila).join("") + "</ul></details>" : "") + "</section>";
  }

  // ---------- Filtro y estadística: el componente compartido (viewer-filtros) ----------
  // La configuración del filtro se arma una vez; sus textos fijos se ponen en textosFiltro() y se rehacen al cambiar de idioma.
  var GRUPOS = ["", "recomendada", "compartido", "sinpista"];
  var CFG = {
    pre: "sa", clave: "flowbrain.sinasociar", unidad: ["file", "files"], todos: "",
    items: function () { return U; },
    estado: { cuantas: PASO },
    grupos: GRUPOS.map(function (g) { return { id: g, es: g ? function (x) { return clase(x) === g; } : null }; }),
    buscar: { ph: "", texto: function (x) { return x.a + " " + (x.g ? nombre(x.g[0]) : ""); } },
    campos: [
      { id: "cerebro", solo: function () { return CEREBROS.length > 1; }, de: function (x) { return x.c; },
        valores: function () { return CEREBROS.map(function (c, i) { return [i, c.nombre, U.filter(function (x) { return x.c === i; }).length]; }); },
        etiquetaDe: function (v) { return CEREBROS[Number(v)] ? CEREBROS[Number(v)].nombre : v; }, palabra: function (v) { return L("brain ", "cerebro ") + (CEREBROS[Number(v)] ? CEREBROS[Number(v)].nombre : v); } },
      { id: "recomendada", ordenPorCantidad: true, de: function (x) { return x.g ? x.g[0] : ""; },
        etiquetaDe: nombre, palabra: function (v) { return L("recommended ", "recomendada ") + nombre(v); } },
      { id: "capa", ordenPorCantidad: true, de: function (x) { return x.k; },
        etiquetaDe: capa, palabra: function (v) { return L("layer ", "capa ") + capa(v); } },
      { id: "repo", ordenPorCantidad: true, de: function (x) { return repoDe(x.a, x); }, palabra: function (v) { return "repo " + v; } },
      { id: "confianza", de: confDe, etiquetaDe: confEt, color: function (v) { return CONF_COLOR[v]; },
        valores: function () { return CONF.map(function (v) { return [v, confEt(v), U.filter(function (x) { return confDe(x) === v; }).length]; }); },
        palabra: function (v) { return L("confidence ", "confianza ") + confEt(v).toLowerCase(); } }
    ],
    paneles: [
      { campo: "cerebro" },
      { campo: "capa" },
      { campo: "recomendada", max: 8 },
      { campo: "confianza", orden: "fijo" }
    ],
    cifras: function () {
      var n = function (k) { return U.filter(function (x) { return clase(x) === k; }).length; };
      return [[U.length, L("unassigned files", "archivos sin asociar"), U.length ? "var(--atencion)" : ""], [n("recomendada"), L("with a recommended feature", "con una funcionalidad recomendada"), n("recomendada") ? "var(--bien)" : "", "recomendada"],
        [n("compartido"), L("of shared code", "de código compartido"), "", "compartido"], [n("sinpista"), L("with no hint at all", "sin ninguna pista"), "", "sinpista"], [carpetas(U).length, L("folders", "carpetas")]]
        .concat(IGN.length ? [[totalIgn(), L("marked as not product (not listed)", "marcados como no de producto (no se listan)")]] : []);
    },
    alCambiar: function (todo) { refrescar(todo); }
  };
  // Los textos fijos del filtro, en el idioma actual. Se cambian en el mismo objeto (y la misma lista de unidad), que el
  // componente compartido guardó al crearse.
  function textosFiltro() {
    var g = CFG.grupos, c = CFG.campos, p = CFG.paneles;
    CFG.unidad[0] = L("file", "archivo"); CFG.unidad[1] = L("files", "archivos");
    CFG.todos = L("all unassigned files", "todos los archivos sin asociar");
    CFG.buscar.ph = L("Search by path or by recommended feature…", "Buscar por ruta o por funcionalidad recomendada…");
    g[0].etiqueta = L("All", "Todos"); g[1].etiqueta = L("With a recommendation", "Con recomendación");
    g[2].etiqueta = L("Shared code", "Código compartido"); g[3].etiqueta = L("No hint", "Sin pista");
    c[0].etiqueta = L("Brain", "Cerebro"); c[0].propio = L("the chosen brain", "el cerebro elegido");
    c[1].etiqueta = L("Recommended", "Recomendada"); c[1].todos = L("Any", "Cualquiera"); c[1].propio = L("the chosen recommendation", "la recomendada elegida");
    c[2].etiqueta = L("Layer", "Capa"); c[2].todos = L("All", "Todas"); c[2].propio = L("the chosen layer", "la capa elegida");
    c[3].etiqueta = "Repo"; c[3].propio = L("the chosen repo", "el repo elegido");
    c[4].etiqueta = L("Confidence", "Confianza"); c[4].todos = L("Any", "Cualquiera"); c[4].propio = L("the chosen confidence", "la confianza elegida");
    p[0].titulo = L("By brain", "Por cerebro");
    p[1].titulo = L("By layer", "Por capa");
    p[2].titulo = L("Recommended feature", "Funcionalidad recomendada");
    p[2].sinValor = L("no recommendation (shared code or no hint)", "sin recomendación (código compartido o sin pista)");
    p[2].ninguno = L("None has a recommended feature: they are shared code or have no hint.", "Ninguno tiene una funcionalidad recomendada: son código compartido o no tienen pista.");
    p[3].titulo = L("Confidence of the recommendation", "Confianza de la recomendación");
    p[3].sinValor = L("no recommendation, so no confidence (shared code or no hint)", "sin recomendación, así que sin confianza (código compartido o sin pista)");
    p[3].ninguno = L("None has a recommended feature, so there is no confidence to show.", "Ninguno tiene una funcionalidad recomendada, así que no hay confianza para mostrar.");
  }
  if (U) {
    textosFiltro();
    if (window.brainI18n && window.brainI18n.alCambiar) window.brainI18n.alCambiar(textosFiltro);
    fl = window.brainFiltros.crear(CFG);
  }
  if (fl) { S = fl.S(); S.cuantas = PASO; if (S.cerebro !== "" && !CEREBROS[Number(S.cerebro)]) S.cerebro = ""; }
  var guardar = function () { if (fl) fl.guardar(); };
  function lista() {
    var xs = filtrados();
    var msg = MSG ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "";
    if (!xs.length) return msg + htmlAgente() + fl.vacio(U.length, [L("unassigned file", "archivo sin asociar"), L("unassigned files", "archivos sin asociar")]) + htmlIgnorados();
    var cs = carpetas(xs), visibles = cs.slice(0, S.cuantas);
    // «Sumar los N de la lista»: la lista filtrada entera (los filtros aplicados), al pedido.
    var sumarLista = botonSumar("l|", xs, xs.length === 1 ? L("Request it", "Pedirlo") : L("Request the " + num(xs.length) + " in the list", "Pedir los " + num(xs.length) + " de la lista"));
    return msg + htmlAgente() + lote(xs) + pedidosDeLista(xs) + fl.resultado(xs, L(" in ", " en ") + plural(cs.length, L("folder", "carpeta"), L("folders", "carpetas")), sumarLista) +
      visibles.map(grupo).join("") +
      (cs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="boton" data-acc="mas">' + L("Show " + Math.min(PASO, cs.length - visibles.length) + " more folders", "Mostrar " + Math.min(PASO, cs.length - visibles.length) + " carpetas más") + "</button> <small>" + num(visibles.length) + L(" of ", " de ") + num(cs.length) + "</small></p>" : "") + htmlIgnorados();
  }
  var COMO = function () { return '<p class="subtitulo">' + L("Files that belong to no feature or library, by folder. Each one gets a recommended feature based on who uses it, what it uses, which endpoints it serves and who owns its neighbors. They do not lower the fidelity score: it is a list to complete the catalog.", "Archivos que no son de ninguna funcionalidad ni librería, por carpeta. A cada uno se le recomienda una funcionalidad según quién lo usa, qué usa, qué endpoints atiende y de quién son sus vecinos. No restan puntaje de fidelidad: es una lista para completar el catálogo.") + "</p>"; };
  function aviso() {
    if (!ED) return '<p class="aviso">' + L("This page is read-only: you can see each file's recommendation and build the requests for the agent, to copy them. To assign from here (to a feature or a library), accept the high-confidence ones in bulk, mark what is not product, view each file's code or send the requests to the agent, open it with <code>flowbrain viewer --serve</code>: a static page cannot read the repos.", "Esta página es de solo lectura: podés ver la recomendación de cada archivo y armar los pedidos para el agente, para copiarlos. Para asociar desde acá (a una funcionalidad o a una librería), aceptar en lote las de confianza alta, marcar lo que no es de producto, ver el código de cada archivo o mandarle los pedidos al agente, abrila con <code>flowbrain viewer --serve</code>: una página estática no puede leer los repos.") + "</p>";
    return "";
  }
  // «Aceptar las de confianza alta»: solo con el servidor; cuenta las de la lista filtrada.
  function lote(xs) {
    if (!ED) return "";
    var n = xs.filter(function (x) { return confDe(x) === "alta"; }).length;
    if (!n) return '<p class="fd-nota sa-lote">' + L("No file in this list has a high-confidence recommendation to accept in bulk: review them one by one, or open the code first.", "Ningún archivo de esta lista tiene una recomendación de confianza alta para aceptar en lote: revisalos de a uno, o abrí el código antes.") + "</p>";
    return '<div class="fd-hacer sa-lote"><button type="button" class="boton pri" data-acc="aceptar-altas"' + (ocupado ? " disabled" : "") + ">" + L("Accept the high-confidence ones", "Aceptar las de confianza alta") + " (" + num(n) + ')</button> <small title="' + esc(confPorQue("alta")) + '">' +
      L("Assigns each one to its recommended feature. Only the files in the list below, with the filters applied.", "Asocia cada uno a su funcionalidad recomendada. Solo los archivos de la lista de abajo, con los filtros aplicados.") + "</small></div>";
  }
  function pintarLista() { var e = elem("sa-lista"); if (e) e.innerHTML = lista(); }
  // Lo que cambia fuera de una acción de la lista (el agente avanza): con la lista vacía no hay #sa-lista, se pinta todo.
  function repintar() { if (U && U.length) pintarLista(); else pintarTodo(); }
  var titulo = function () { return '<div class="es-titulo"><h1>' + L("Unassigned", "Sin asociar") + "</h1></div>"; };
  function pintarTodo() {
    // Lo asociado o marcado desde acá sale también del pedido.
    podarLista();
    if (!U) {
      raiz.innerHTML = titulo() + '<p class="aviso">' + L("There is no code index, so there is no telling which files exist. Run <code>flowbrain index</code> on each repo and then <code>flowbrain compile</code> (or <code>flowbrain brains apply</code>).", "No hay índice de código, así que no se sabe qué archivos hay. Corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code> (o <code>flowbrain brains apply</code>).") + "</p>";
      return;
    }
    if (!(D.funcionalidades || []).length) {
      raiz.innerHTML = titulo() + '<p class="aviso">' + L("There are no features yet, so there is nothing to assign the files to. First deduce the product's features: <code>/flowbrain-features</code> in the agent (or <code>flowbrain feature --guide</code>).", "Todavía no hay funcionalidades, así que no hay a qué asociar los archivos. Primero se deducen las funcionalidades del producto: <code>/flowbrain-features</code> en el agente (o <code>flowbrain feature --guide</code>).") + "</p>";
      return;
    }
    if (!U.length) {
      var ign = totalIgn();
      raiz.innerHTML = titulo() + COMO() + (MSG ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + "</p>" : "") + htmlAgente() + '<p class="aviso">' + (hechos ? L("Done: no unassigned files left.", "Listo: ya no queda ningún archivo sin asociar.") : L("Every file in the index belongs to a feature or library. There is nothing to assign.", "Todos los archivos del índice son de alguna funcionalidad o librería. No hay nada para asociar.")) +
        (ign ? " " + L(plural(ign, "file is", "files are") + " marked as not product and not listed: see them below.", plural(ign, "archivo está marcado", "archivos están marcados") + " como no de producto y no se " + (ign === 1 ? "lista" : "listan") + ": abajo se ven.") : "") + "</p>" + htmlIgnorados();
      return;
    }
    raiz.innerHTML = titulo() + COMO() + aviso() + fl.html() + '<div id="sa-lista">' + lista() + "</div>";
  }
  function refrescar(todo) { S.cuantas = PASO; if (PEDIDO) PEDIDO.copiado = false; guardar(); if (todo) pintarTodo(); else pintarLista(); }
  var porArchivo = function (a) { for (var i = 0; i < U.length; i++) if (U[i].a === a) return U[i]; return null; };
  var porClave = function (k) { var cs = carpetas(U); for (var i = 0; i < cs.length; i++) if (cs[i].k === k) return cs[i]; return null; };
  // Manda al servidor la asociación del archivo x (o de su carpeta, si entrada viene) a la funcionalidad.
  function pedirAsociar(x, feat, entrada) {
    var cuerpo = { tipo: "funcionalidad", cerebro: cerebroDe(x), archivo: local(x.a, x), funcionalidad: local(feat, x) };
    if (entrada) cuerpo.entrada = local(entrada, x);
    return fetch("/api/editar", { method: "POST", headers: { "content-type": "application/json", "x-flowbrain-token": ED.token }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || L("the server responded ", "el servidor respondió ") + r.status); return j; }); });
  }
  // Saca de la lista lo asociado; devuelve cuántos archivos salieron.
  function sacar(x, entrada) {
    var antes = U.length;
    U = U.filter(function (y) { return y.c !== x.c || (entrada ? y.a.indexOf(entrada + "/") !== 0 : y.a !== x.a); });
    // Asociado un archivo suelto, su carpeta y las de arriba ya tienen algo con dueño: dejan de poder asociarse enteras.
    if (!entrada) U.forEach(function (y) { if (y.c === x.c && x.a.indexOf(carpetaDe(y.a) + "/") === 0) delete y.cl; });
    if (CODIGO && !porArchivo(CODIGO.a)) CODIGO = null;
    if (LIB && !porArchivo(LIB)) LIB = null;
    if (NP && !porArchivo(NP)) NP = null;
    hechos += antes - U.length;
    return antes - U.length;
  }
  // Asocia el archivo x (o su carpeta, si entrada viene) a la funcionalidad. Lo asociado sale de la lista sin recargar.
  function asociar(x, feat, entrada) {
    if (ocupado || !ED || !x || !feat) return;
    ocupado = true; MSG = { texto: L("Saving…", "Guardando…") }; pintarLista();
    pedirAsociar(x, feat, entrada)
      .then(function (r) {
        ocupado = false; OTRA = null; LIB = null;
        var salieron = sacar(x, entrada);
        MSG = { texto: r.mensaje + " (" + r.escrito + ")" + (salieron > 1 ? " " + L(salieron + " files left the list.", salieron + " archivos salieron de la lista.") : "") };
        pintarTodo();
      }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; pintarLista(); });
  }
  // Asocia en lote, de a uno (cada asociación escribe la página y recompila), las de confianza alta de la lista filtrada.
  function aceptarAltas() {
    if (ocupado || !ED) return;
    var xs = filtrados().filter(function (x) { return confDe(x) === "alta"; });
    if (!xs.length) return;
    var pregunta = L("Assign " + plural(xs.length, "file", "files") + " to their high-confidence recommended feature? Each one is written to its feature's page.", "¿Asociar " + plural(xs.length, "archivo", "archivos") + " a su funcionalidad recomendada de confianza alta? Cada uno se escribe en la página de su funcionalidad.");
    if (!window.confirm || !window.confirm(pregunta)) return;
    ocupado = true; OTRA = null;
    var bien = 0, errores = [];
    var paso = function (i) {
      if (i >= xs.length) {
        ocupado = false;
        MSG = errores.length
          ? { texto: L(plural(bien, "file was", "files were") + " assigned; " + plural(errores.length, "failed", "failed") + ": ", plural(bien, "archivo se asoció", "archivos se asociaron") + "; " + plural(errores.length, "falló", "fallaron") + ": ") + errores.join("; "), error: true }
          : { texto: L(plural(bien, "file was", "files were") + " assigned to " + (bien === 1 ? "its" : "their") + " recommended feature.", plural(bien, "archivo se asoció", "archivos se asociaron") + " a su funcionalidad recomendada.") };
        pintarTodo();
        return;
      }
      var x = xs[i];
      MSG = { texto: L("Assigning " + num(i + 1) + " of " + num(xs.length) + "…", "Asociando " + num(i + 1) + " de " + num(xs.length) + "…") }; pintarLista();
      pedirAsociar(x, x.g[0])
        .then(function () { bien++; sacar(x); }, function (e) { errores.push(local(x.a, x) + ": " + e.message); })
        .then(function () { paso(i + 1); });
    };
    paso(0);
  }

  // «No es de producto»: marca el archivo o una carpeta suya; lo que tapa sale de la lista sin recargar.
  function marcarNoProducto(x, entrada, motivo) {
    if (ocupado || !ED || !x || !entrada) return;
    ocupado = true; MSG = { texto: L("Saving…", "Guardando…") }; pintarLista();
    llamar("/api/editar", { tipo: "no_producto", cerebro: cerebroDe(x), archivo: local(x.a, x), entrada: local(entrada, x), motivo: motivo })
      .then(function (r) {
        ocupado = false; NP = null;
        var antes = U.length;
        U = U.filter(function (y) { return y.c !== x.c || !cubre(entrada, y); });
        var salieron = antes - U.length;
        if (CODIGO && !porArchivo(CODIGO.a)) CODIGO = null;
        if (OTRA && !porArchivo(OTRA) && !porClave(OTRA)) OTRA = null;
        hechos += salieron;
        var ya = null;
        IGN.forEach(function (m) { if (m.c === x.c && local(m.e, m) === local(entrada, x)) ya = m; });
        if (ya) { ya.m = motivo; ya.n = (ya.n || 0) + salieron; } else IGN.push({ e: entrada, m: motivo, n: salieron, c: x.c });
        MSG = { texto: L(plural(salieron, "file is", "files are") + " marked as not product (" + motivoEt(motivo).toLowerCase() + ") and left the list. You can undo it in «Marked as not product».", plural(salieron, "archivo quedó marcado", "archivos quedaron marcados") + " como no de producto (" + motivoEt(motivo).toLowerCase() + ") y " + (salieron === 1 ? "salió" : "salieron") + " de la lista. Se deshace en «Marcados como no de producto».") + " (" + r.escrito + ")" };
        pintarTodo();
      }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; repintar(); });
  }
  // Deshacer: saca la marca. Los archivos vuelven con la página recargada (el servidor ya recompiló el cerebro).
  function deshacerNoProducto(i) {
    var m = IGN[i];
    if (ocupado || !ED || !m) return;
    ocupado = true; MSG = { texto: L("Saving…", "Guardando…") }; repintar();
    llamar("/api/editar", { tipo: "no_producto", cerebro: cerebroDe(m), entrada: local(m.e, m), motivo: null })
      .then(function () {
        ocupado = false; IGN.splice(i, 1);
        if (m.n && recargar()) return;
        MSG = { texto: m.n ? L(local(m.e, m) + " is no longer marked: reload the page to see its files in the list again.", local(m.e, m) + " ya no está marcado: recargá la página para volver a ver sus archivos en la lista.") : L(local(m.e, m) + " is no longer marked.", local(m.e, m) + " ya no está marcado.") };
        repintar();
      }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; repintar(); });
  }

  raiz.addEventListener("click", function (ev) {
    if (fl && fl.manejar(ev, "click")) return;
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc"), k = b.getAttribute("data-k"), g;
    if (acc === "mas") { S.cuantas += PASO; pintarLista(); return; }
    // Sumar o sacar del pedido al agente (el componente cambia los botones y el panel, sin repintar la lista).
    if (acc === "pedir") { PD.sumar("asociar", k); return; }
    if (acc === "nueva-feat" || acc === "crear-lib") {
      var cl = acc === "nueva-feat" ? "sinpista" : "compartido", x0 = porArchivo(b.getAttribute("data-a")), todos = !!b.getAttribute("data-todos");
      var xs = todos ? filtrados().filter(function (x) { return clase(x) === cl; }) : x0 ? vecinosDe(x0) : [];
      var donde = todos ? "lista" : x0 ? x0.a : "";
      if (PEDIDO && PEDIDO.donde === donde && PEDIDO.tipo === (acc === "nueva-feat" ? "feat" : "lib")) { PEDIDO = null; pintarLista(); return; }
      if (xs.length) abrirPedido(acc === "nueva-feat" ? "feat" : "lib", xs, donde);
      return;
    }
    if (acc === "cerrar-pedido") { PEDIDO = null; pintarLista(); return; }
    if (acc === "copiar") { if (PEDIDO) copiar(textoActual(), function (ok) { if (PEDIDO) { PEDIDO.copiado = ok ? true : "no"; pintarLista(); } }); return; }
    if (acc === "mandar") { mandar(); return; }
    if (acc === "cancelar-agente") { llamar("/api/agente/cancelar", { id: k }).then(PD.actualizar, PD.actualizar); return; }
    if (acc === "cerrar-agente") { delete AGS.mandados[k]; guardarAgs(); TRABAJOS = TRABAJOS.filter(function (t) { return t.id !== k; }); repintar(); return; }
    if (acc === "recargar") { recargar(); return; }
    if (acc === "lib") { var la = b.getAttribute("data-a"); LIB = LIB === la ? null : la; pintarLista(); return; }
    if (acc === "asociar-lib") { var sl = elem("sa-lib"); asociar(porArchivo(k), sl ? String(sl.value || "") : ""); return; }
    if (acc === "noprod") { var na = b.getAttribute("data-a"); NP = NP === na ? null : na; pintarLista(); return; }
    if (acc === "noprod-marcar") {
      var se = elem("sa-np-entrada"), sm = elem("sa-np-motivo"), xn = porArchivo(b.getAttribute("data-a"));
      if (xn) marcarNoProducto(xn, se && se.value ? String(se.value) : xn.a, sm && sm.value ? String(sm.value) : motivoProbable(xn.a));
      return;
    }
    if (acc === "noprod-deshacer") { deshacerNoProducto(Number(k)); return; }
    if (acc === "otra") { OTRA = OTRA === k ? null : k; pintarLista(); return; }
    if (acc === "codigo") { verCodigo(b.getAttribute("data-a")); return; }
    if (acc === "aceptar-altas") { aceptarAltas(); return; }
    if (acc === "asociar") { asociar(porArchivo(b.getAttribute("data-a")), b.getAttribute("data-f")); return; }
    if (acc === "asociar-carpeta") { g = porClave(k); if (g) asociar(g.xs[0], b.getAttribute("data-f"), g.carpeta); return; }
    if (acc === "asociar-elegida") {
      var sel = elem("sa-feat"), feat = sel ? String(sel.value || "") : "";
      g = porClave(k);
      if (g) asociar(g.xs[0], feat, g.carpeta); else asociar(porArchivo(k), feat);
      return;
    }
  });
  raiz.addEventListener("change", function (ev) {
    if (fl && fl.manejar(ev, "change")) return;
    var id = ev.target.id;
    // Proveedor y modelo del pedido suelto: los mismos del panel del pedido (el componente los guarda).
    if (id === "sa-ped-prov") PD.elegir(String(ev.target.value || ""), null);
    else if (id === "sa-ped-modelo") PD.elegir(null, String(ev.target.value || ""));
  });
  raiz.addEventListener("input", function (ev) { if (fl) fl.manejar(ev, "input"); });

  // Elegir otro proveedor o modelo cambia lo que dice el pedido suelto abierto.
  PD.escuchar(function (ev) { if (ev === "elegido" && PEDIDO) pintarLista(); });
  window.brainSinAsociar = { mostrar: function () { pintarTodo(); } };
})();
`;

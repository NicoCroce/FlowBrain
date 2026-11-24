import { DEPENDE_JS, IMPACTO_JS } from "@flowbrain/core";

/**
 * "Impacto" (si cambia esta pieza, qué se ve afectado, por niveles y con el porqué) y el enrutador de todo el visor:
 * `#/funcionalidades`, `#/f/<id>`, `#/impacto[/<id>]`, `#/fidelidad`, `#/especificaciones[/<feat>]`, `#/sin-asociar`, `#/contratos`, `#/n/<id>` (ficha técnica de cualquier pieza), `#/grafo[/<id>]`. Los enlaces viejos `#/mapa[/<id>]` (la vista
 * de dependencias, que se quitó) abren el mapa 3D. JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const MAPA_JS =
  IMPACTO_JS +
  "\n" +
  DEPENDE_JS +
  String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, P = window.brainProducto, D = V.D, porId = V.porId, esc = V.esc, color = V.color;
  var fichas = D.funcionalidades || [], deps = D.dependencias || [], CEREBROS = D.cerebros || [];
  var porFicha = {};
  fichas.forEach(function (f) { porFicha[f.id] = f; });
  // Símbolos del índice de código (clases, métodos, funciones, hooks…): no son nodos del grafo, pero también tienen
  // impacto, el de quién los llama o los usa. Id: "archivo#Nombre", como los cita el motor.
  var COD = D.codigo || null, SIMS = [], SIM = {}, simsDeArchivo = {}, llamanA = {}, llamaDe = {}, atiendeDe = {};
  if (COD) {
    COD.archivos.forEach(function (a) {
      var lista = simsDeArchivo[a[0]] = [];
      a[1].forEach(function (x) { var y = { id: a[0] + "#" + x[0], n: x[0], t: x[1], a: a[0], l: x[2], i: SIMS.length }; SIMS.push(y); SIM[y.id] = y; lista.push(y.i); });
    });
    var arista = function (v) { return function (r) { (llamanA[r[0]] = llamanA[r[0]] || []).push({ o: r[1], l: r[2], v: v }); (llamaDe[r[1]] = llamaDe[r[1]] || []).push({ o: r[0], l: r[2], v: v }); }; };
    COD.llaman.forEach(arista("llama_a"));
    COD.usan.forEach(arista("usa"));
    COD.atiende.forEach(function (r) { (atiendeDe[r[0]] = atiendeDe[r[0]] || []).push(r[1]); });
  }
  // Las funcionalidades dueñas de cada archivo.
  var duenas = {};
  fichas.forEach(function (f) { (f.codigo || []).forEach(function (a) { (duenas[a] = duenas[a] || []).push(f.id); }); });
  var nombre = function (id) { return porId[id] ? porId[id].n : SIM[id] ? SIM[id].n : id; };
  var tipo = function (id) { return porId[id] ? porId[id].t : SIM[id] ? SIM[id].t : ""; };
  // Dónde está un símbolo: "repo:ruta#Ln".
  var donde = function (id) { return SIM[id] ? SIM[id].a + "#L" + SIM[id].l : ""; };
  var plural = function (n, uno, varios) { return n + " " + (n === 1 ? uno : varios); };
  var TIPO = { feat: "funcionalidad", pantalla: "pantalla", componente: "componente", tabla: "tabla", endpoint: "endpoint", svc: "servicio", ext: "servicio externo", db: "base de datos", queue: "cola", lib: "librería", repo: "repo",
    archivo: "archivo", test: "archivo de test", contrato: "contrato", team: "equipo", decision: "decisión",
    hook: "hook", clase: "clase", metodo: "método", funcion: "función", interfaz: "interfaz", tipo: "tipo", enum: "enum", constante: "constante", modelo: "modelo", objeto: "objeto" };
  var TIPOS = { feat: "funcionalidades", pantalla: "pantallas", componente: "componentes", tabla: "tablas", endpoint: "endpoints", svc: "servicios", ext: "servicios externos", db: "bases de datos", queue: "colas", lib: "librerías", repo: "repos",
    archivo: "archivos", test: "archivos de test", contrato: "contratos", team: "equipos", decision: "decisiones",
    hook: "hooks", clase: "clases", metodo: "métodos", funcion: "funciones", interfaz: "interfaces", tipo: "tipos", enum: "enums", constante: "constantes", modelo: "modelos", objeto: "objetos" };
  var VERBO = { se_atiende_con: "se atiende con", tiene_codigo: "tiene el código de", usa: "usa", escribe_en: "escribe en", lee_de: "lee", llama_a: "llama a", implementa: "está implementada por", vive_en: "vive en", publica_en: "publica en", consume_de: "consume de", depende_de: "depende de", alimenta: "recibe mensajes de" };
  var puntoT = function (t) { return '<span class="punto" style="background:' + color(t) + '"></span>'; };
  var punto = function (id) { return puntoT(tipo(id)); };
  var entran = {}, salen = {};
  deps.forEach(function (d) { (entran[d[1]] = entran[d[1]] || []).push(d); (salen[d[0]] = salen[d[0]] || []).push(d); });
  var vistas = { producto: document.getElementById("producto"), impacto: document.getElementById("impacto"), fidelidad: document.getElementById("fidelidad"), especificaciones: document.getElementById("especificaciones"), sinasociar: document.getElementById("sinasociar"), contratos: document.getElementById("contratos"), grafo: document.getElementById("app") };

  // ---------- Impacto ----------
  var raizImpacto = vistas.impacto, copia = "";
  // Todas las piezas: cada nodo del grafo y cada símbolo del índice de código.
  var candidatos = D.nodes.concat(SIMS);
  var enlaceImpacto = function (id) { return '<a href="#/impacto/' + encodeURIComponent(id) + '">' + punto(id) + " " + esc(nombre(id)) + "</a>"; };
  var ORDEN_T = ["feat", "pantalla", "componente", "svc", "endpoint", "tabla", "ext", "queue", "db", "lib", "repo", "contrato", "archivo", "test", "hook", "clase", "metodo", "funcion", "interfaz", "tipo", "enum", "constante", "modelo", "objeto"];
  var porOrden = function (a, b) { return (ORDEN_T.indexOf(a) + 1 || 99) - (ORDEN_T.indexOf(b) + 1 || 99); };
  var mayus = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
  var tituloT = function (t, n) { return (n === 1 ? TIPO[t] : TIPOS[t]) || t; };
  var nombreCerebro = function (v) { return CEREBROS[Number(v)] ? CEREBROS[Number(v)].nombre : String(v); };
  var cerebroIdx = function (id) { var n = porId[id] || (SIM[id] && porId[SIM[id].a]); return n && n.c !== undefined ? n.c : ""; };
  // Campos que comparten la portada y el detalle: el tipo de pieza y el cerebro.
  var campoTipo = function (todos) {
    return { id: "tipo", etiqueta: "Tipo de pieza", todos: todos, propio: "el tipo elegido", de: function (x) { return x.t; },
      valores: null, etiquetaDe: function (v) { return mayus(tituloT(v, 2)); }, color: function (v) { return color(v); }, palabra: function (v) { return "solo " + tituloT(v, 2); } };
  };
  var campoCerebro = { id: "cerebro", etiqueta: "Cerebro", propio: "el cerebro elegido", solo: function () { return CEREBROS.length > 1; }, de: function (x) { return x.c; },
    etiquetaDe: nombreCerebro, palabra: function (v) { return "cerebro " + nombreCerebro(v); } };
  var FLI = null;
  // Los eventos de la raíz van al filtro que esté a la vista (portada o detalle); el resto es de la ficha técnica.
  raizImpacto.addEventListener("click", function (ev) { if (FLI) FLI.manejar(ev, "click"); });
  raizImpacto.addEventListener("change", function (ev) { if (FLI) FLI.manejar(ev, "change"); });
  raizImpacto.addEventListener("input", function (ev) { if (FLI) FLI.manejar(ev, "input"); });

  // ---------- Portada: elegir una pieza ----------
  // Cada pieza con cuántas dependen de ella en forma directa: lo más usado arriba.
  var DEPENDIENTES = [["0", "Nadie"], ["1-2", "1 o 2"], ["3-9", "De 3 a 9"], ["10+", "10 o más"]];
  var PIEZAS = candidatos.map(function (n) {
    var quien = {};
    (entran[n.id] || []).forEach(function (d) { quien[d[0]] = true; });
    // Un símbolo: quién lo llama o lo usa. Un archivo: quién, desde otro archivo, llama o usa alguno de sus símbolos.
    var propios = SIM[n.id] ? [SIM[n.id].i] : simsDeArchivo[n.id] || [];
    propios.forEach(function (i) { (llamanA[i] || []).forEach(function (r) { if (SIM[n.id] || SIMS[r.o].a !== n.id) quien[SIMS[r.o].id] = true; }); });
    var k = Object.keys(quien).length;
    return { id: n.id, t: n.t, c: cerebroIdx(n.id), dep: k, tramo: k === 0 ? "0" : k <= 2 ? "1-2" : k <= 9 ? "3-9" : "10+", texto: [n.id, n.n].concat(n.a || []).join(" ") };
  }).sort(function (a, b) { return b.dep - a.dep || porOrden(a.t, b.t) || (nombre(a.id) < nombre(b.id) ? -1 : 1); });
  var PIEZA = {};
  PIEZAS.forEach(function (x) { PIEZA[x.id] = x; });
  var VER_INICIO = 50, verInicio = VER_INICIO;
  var tramoDe = function (v) { for (var i = 0; i < DEPENDIENTES.length; i++) if (DEPENDIENTES[i][0] === v) return DEPENDIENTES[i][1]; return v; };
  var flInicio = window.brainFiltros.crear({
    pre: "im", clave: "flowbrain.impacto", unidad: ["pieza", "piezas"], todos: "todas las piezas",
    items: function () { return PIEZAS; },
    grupos: [
      { id: "", etiqueta: "Todas" },
      { id: "usadas", etiqueta: "Alguien depende de ellas", palabra: "de las que algo depende", es: function (x) { return x.dep > 0; } },
      { id: "sueltas", etiqueta: "Nadie depende de ellas", palabra: "de las que nada depende", es: function (x) { return !x.dep; } }
    ],
    buscar: { ph: "Buscar una pieza: funcionalidad, tabla, endpoint, archivo, clase, método…", texto: function (x) { return x.texto; } },
    campos: [
      campoTipo("Todos"), campoCerebro,
      { id: "dependen", etiqueta: "Cuántas dependen directo", todos: "Cualquier cantidad", propio: "la cantidad elegida", de: function (x) { return x.tramo; },
        valores: function () { return DEPENDIENTES.map(function (t) { return [t[0], t[1], PIEZAS.filter(function (x) { return x.tramo === t[0]; }).length]; }); },
        etiquetaDe: tramoDe, palabra: function (v) { return "dependen " + tramoDe(v).toLowerCase(); } }
    ],
    paneles: [
      { titulo: "Por tipo de pieza", campo: "tipo", max: 40, nota: function () { return COD ? "" : '<p class="fd-sin">Sin índice de código: no aparecen clases, métodos, funciones ni hooks. Corré <code>flowbrain index</code> y <code>flowbrain compile</code> para verlos.</p>'; } },
      { titulo: "Cuántas dependen directo", campo: "dependen", orden: "fijo" },
      { titulo: "Por cerebro", campo: "cerebro" }
    ],
    cifras: function () {
      var n = function (t) { return PIEZAS.filter(function (x) { return x.t === t; }).length; };
      return [[PIEZAS.length, "piezas"], [n("feat"), "funcionalidades"], [n("endpoint"), "endpoints"], [n("tabla"), "tablas"], [SIMS.length, "símbolos de código"], [PIEZAS.filter(function (x) { return x.dep >= 10; }).length, "con 10 o más dependientes", "var(--atencion)"]];
    },
    alCambiar: function (todo) { verInicio = VER_INICIO; if (todo) inicioImpacto(); else { var l = document.getElementById("im-lista"); if (l) l.innerHTML = listaInicio(); } }
  });
  // La portada, segmentada: arriba lo de producto y servicios en una columna por tipo (las 10 con más dependientes,
  // «Ver todas» filtra por ese tipo); abajo el código agrupado por archivo, con sus clases y métodos plegados adentro.
  // Así un archivo, su clase y sus métodos no salen como filas sueltas que se repiten.
  var COLUMNA = 10;
  var esCodigo = function (x) { return !!SIM[x.id] || x.t === "archivo" || x.t === "test"; };
  var filaPieza = function (x, conDonde) {
    // En la columna el tipo ya está en el título; dentro de un archivo se dice (clase, método…) y en qué línea.
    return "<li>" + enlaceImpacto(x.id) + " <small>· " + (conDonde ? esc(TIPO[x.t] || x.t) + (SIM[x.id] ? " · L" + SIM[x.id].l : "") + " · " : "") + (x.dep ? plural(x.dep, "pieza depende", "piezas dependen") + " directo" : "nadie depende") + "</small></li>";
  };
  function columnas(xs, S) {
    var porTipo = {};
    xs.forEach(function (x) { (porTipo[x.t] = porTipo[x.t] || []).push(x); });
    var tipos = Object.keys(porTipo).sort(porOrden), uno = tipos.length === 1;
    if (!tipos.length) return "";
    return '<h2 class="titulo-seccion">Producto y servicios</h2><div class="grupos-impacto' + (uno ? " uno" : "") + '">' + tipos.map(function (t) {
      var ys = porTipo[t], vis = uno ? ys.slice(0, verInicio) : ys.slice(0, COLUMNA);
      var mas = uno
        ? (ys.length > vis.length ? '<p class="fd-mas"><button type="button" class="boton" id="im-mas">Mostrar ' + Math.min(VER_INICIO, ys.length - vis.length) + " más</button> <small>" + vis.length + " de " + ys.length + "</small></p>" : "")
        : (ys.length > vis.length ? '<p class="fd-mas"><button type="button" class="boton" data-fl="im" data-fl-set="' + esc(JSON.stringify({ tipo: t })) + '">Ver ' + (ys.length === 1 ? "la" : "las " + ys.length) + "</button></p>" : "");
      return '<section class="grupo-impacto" data-tipo="' + t + '"><h2>' + puntoT(t) + " " + esc(mayus(tituloT(t, 2))) + ' <small class="cuenta">' + ys.length.toLocaleString("es") + "</small></h2>" +
        '<ul class="lista">' + vis.map(function (x) { return filaPieza(x, false); }).join("") + "</ul>" + mas + "</section>";
    }).join("") + "</div>";
  }
  function porArchivo(xs, S) {
    if (!xs.length) return "";
    var grupos = {}, orden = [];
    xs.forEach(function (x) {
      var a = SIM[x.id] ? SIM[x.id].a : x.id;
      var g = grupos[a];
      if (!g) { g = grupos[a] = { archivo: null, sims: [], tope: 0 }; orden.push(a); }
      if (SIM[x.id]) g.sims.push(x); else g.archivo = x;
      if (x.dep > g.tope) g.tope = x.dep;
    });
    orden.sort(function (a, b) { return grupos[b].tope - grupos[a].tope || (a < b ? -1 : 1); });
    var vis = orden.slice(0, verInicio), buscando = !!(S.q && S.q.trim());
    var html = vis.map(function (a) {
      var g = grupos[a], arch = g.archivo || PIEZA[a], ruta = a.slice(a.indexOf(":") + 1);
      // El archivo que no pasó el filtro (se buscó un método suyo) se nombra igual, para saber dónde está.
      var cab = (porId[a] ? enlaceImpacto(a) : punto(a) + " <code>" + esc(ruta) + "</code>") +
        " <small>· " + esc(TIPO[(arch && arch.t) || "archivo"]) + (arch ? " · " + (arch.dep ? plural(arch.dep, "pieza depende", "piezas dependen") + " directo" : "nadie depende") : "") +
        (g.sims.length ? " · " + plural(g.sims.length, "símbolo", "símbolos") : "") + "</small>";
      if (!g.sims.length) return '<li class="im-archivo">' + cab + "</li>";
      var sims = g.sims.slice().sort(function (x, y) { return y.dep - x.dep || (nombre(x.id) < nombre(y.id) ? -1 : 1); });
      return '<li class="im-archivo"><details' + (buscando || !g.archivo ? " open" : "") + "><summary>" + cab + '</summary><ul class="lista im-simbolos">' + sims.map(function (x) { return filaPieza(x, true); }).join("") + "</ul></details></li>";
    }).join("");
    return '<h2 class="titulo-seccion">Código, por archivo <small class="cuenta">' + plural(orden.length, "archivo", "archivos") + "</small></h2>" +
      '<p class="explica">Cada archivo con sus clases, métodos y funciones adentro, ordenados por cuántas piezas dependen de ellos. Abrí un archivo para verlos.</p>' +
      '<ul class="lista im-codigo">' + html + "</ul>" +
      (orden.length > vis.length ? '<p class="fd-mas"><button type="button" class="boton" id="im-mas">Mostrar ' + Math.min(VER_INICIO, orden.length - vis.length) + " archivos más</button> <small>" + vis.length + " de " + orden.length + "</small></p>" : "");
  }
  function listaInicio() {
    var xs = flInicio.filtrar(), S = flInicio.S();
    if (!xs.length) return flInicio.vacio(PIEZAS.length);
    var producto = xs.filter(function (x) { return !esCodigo(x); }), codigo = xs.filter(esCodigo);
    return flInicio.resultado(xs, " · lo de producto por tipo y el código por archivo; las que más dependientes tienen, primero") +
      columnas(producto, S) + porArchivo(codigo, S);
  }
  function inicioImpacto() {
    FLI = flInicio;
    raizImpacto.innerHTML = "<h1>Impacto de un cambio</h1>" +
      '<p class="subtitulo">Elegí una pieza y mirá todo lo que depende de ella, directa o indirectamente: para planificar un cambio, revisar un PR o estimar el riesgo.</p>' +
      flInicio.html() + '<div id="im-lista">' + listaInicio() + "</div>";
  }
  raizImpacto.addEventListener("keydown", function (ev) {
    if (FLI !== flInicio || ev.key !== "Enter" || !ev.target || ev.target.id !== "im-q") return;
    var c = flInicio.filtrar()[0];
    if (c) location.hash = "#/impacto/" + encodeURIComponent(c.id);
  });
  raizImpacto.addEventListener("click", function (ev) {
    if (!ev.target || ev.target.id !== "im-mas") return;
    verInicio += VER_INICIO;
    var l = document.getElementById("im-lista"); if (l) l.innerHTML = listaInicio();
  });

  /**
   * La otra dirección del impacto: de qué depende una pieza (lo que, si cambia, la afecta a ella). Desde una
   * funcionalidad: sus pantallas y servicio, lo que llaman, las tablas que tocan y las funcionalidades que usa.
   * Igual que en el impacto, "implementa" solo se sigue desde el origen, y un servicio alcanzado no se expande: sería
   * todo lo que ese servicio toca.
   */
  var VERBO_IDA = { usa: "usa", escribe_en: "escribe en", lee_de: "lee", llama_a: "llama a", implementa: "se apoya en", vive_en: "vive en", publica_en: "publica en", consume_de: "consume de", depende_de: "depende de", alimenta: "recibe mensajes de" };
  /**
   * El impacto de un símbolo o de un archivo, como quien_llama: quién lo llama o lo usa, y quién llama a esos, por
   * niveles. Desde el código salta al grafo por dos puentes: el endpoint que atiende un símbolo alcanzado y la
   * funcionalidad dueña de su archivo; de ahí sigue el impacto del grafo.
   */
  function impactoDeCodigo(id) {
    var origen = SIM[id] ? [SIM[id].i] : simsDeArchivo[id] || [];
    var visto = {}, niveles = [], puentes = [];
    visto[id] = true;
    origen.forEach(function (i) { visto[SIMS[i].id] = true; });
    var poner = function (nv, x) { while (niveles.length <= nv) niveles.push([]); niveles[nv].push(x); };
    var alPuente = function (i, nv) {
      (atiendeDe[i] || []).forEach(function (ep) { puentes.push({ id: ep, via: SIMS[i].id, verbo: "se_atiende_con", nv: nv + 1 }); });
      (duenas[SIMS[i].a] || []).forEach(function (f) { puentes.push({ id: f, via: SIMS[i].a === id ? id : SIMS[i].id, verbo: "tiene_codigo", nv: nv + 1 }); });
    };
    origen.forEach(function (i) { alPuente(i, -1); });
    var frente = origen.slice(), nv = 0;
    while (frente.length) {
      var sig = [];
      frente.forEach(function (i) {
        (llamanA[i] || []).forEach(function (r) {
          var o = SIMS[r.o];
          if (visto[o.id]) return;
          visto[o.id] = true;
          poner(nv, { id: o.id, via: SIMS[i].id, verbo: r.v });
          sig.push(r.o);
          alPuente(r.o, nv);
        });
      });
      frente = sig; nv++;
    }
    puentes.sort(function (a, b) { return a.nv - b.nv; }).forEach(function (p) {
      if (visto[p.id] || !porId[p.id]) return;
      visto[p.id] = true;
      poner(p.nv, { id: p.id, via: p.via, verbo: p.verbo });
      impacto(deps, p.id).forEach(function (nivel, j) { nivel.forEach(function (x) { if (!visto[x.id]) { visto[x.id] = true; poner(p.nv + j + 1, x); } }); });
    });
    return niveles.filter(function (x) { return x.length; }).map(function (x) { return x.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }); });
  }
  /** De qué depende un símbolo o un archivo: lo que llama y lo que usa, por niveles (hasta 8, como en el grafo). */
  function dependeDeCodigo(id) {
    var origen = SIM[id] ? [SIM[id].i] : simsDeArchivo[id] || [];
    var visto = {}, niveles = [], frente = origen.slice();
    visto[id] = true;
    origen.forEach(function (i) { visto[SIMS[i].id] = true; });
    while (frente.length && niveles.length < 8) {
      var nivel = [], sig = [];
      frente.forEach(function (i) {
        (llamaDe[i] || []).forEach(function (r) {
          var o = SIMS[r.o];
          if (visto[o.id]) return;
          visto[o.id] = true;
          nivel.push({ id: o.id, via: SIMS[i].id, verbo: r.v });
          sig.push(r.o);
        });
      });
      if (!nivel.length) break;
      niveles.push(nivel);
      frente = sig;
    }
    return niveles;
  }
  function conNivel(niveles) {
    var info = {};
    niveles.forEach(function (nv, i) { nv.forEach(function (x) { x.nivel = i + 1; info[x.id] = x; }); });
    return { todos: [].concat.apply([], niveles), info: info };
  }

  // ---------- Detalle: lo que afecta una pieza o de qué depende, con su filtro ----------
  // DET: { id, items: [{ id, t, c, nivel, porque }] } de la pestaña a la vista.
  var DET = { id: "", activa: "afecta", items: [] };
  var nivelDe = function (v) { return v === "1" ? "Directo" : "Nivel " + v; };
  var flDet = window.brainFiltros.crear({
    pre: "imd", unidad: ["pieza", "piezas", "f"], todos: "todo lo alcanzado",
    items: function () { return DET.items; },
    grupos: [
      { id: "", etiqueta: "Todo" },
      { id: "directo", etiqueta: "Directo", palabra: "directo", es: function (x) { return x.nivel === 1; } },
      { id: "indirecto", etiqueta: "Indirecto", palabra: "indirecto", es: function (x) { return x.nivel > 1; } }
    ],
    buscar: { ph: "Buscar en lo alcanzado: nombre, id o por qué…", texto: function (x) { return nombre(x.id) + " " + x.id + " " + x.porque; } },
    campos: [
      campoTipo("Todos"), campoCerebro,
      { id: "nivel", etiqueta: "Nivel", propio: "el nivel elegido", de: function (x) { return String(x.nivel); },
        valores: function () { var n = {}; DET.items.forEach(function (x) { n[x.nivel] = (n[x.nivel] || 0) + 1; }); return Object.keys(n).sort(function (a, b) { return a - b; }).map(function (v) { return [v, nivelDe(v), n[v]]; }); },
        etiquetaDe: nivelDe, palabra: function (v) { return nivelDe(v).toLowerCase(); } }
    ],
    paneles: [
      { titulo: "Por tipo de pieza", campo: "tipo" },
      { titulo: "Por nivel", campo: "nivel", orden: "fijo" },
      { titulo: "Por cerebro", campo: "cerebro" }
    ],
    alCambiar: function (todo) { var l = document.getElementById("imd-lista"); if (!todo && l) l.innerHTML = listaDetalle(); else mostrarImpacto(DET.id, DET.activa); }
  });
  var enlaceImp = function (x) { return ' · <a href="#/impacto/' + encodeURIComponent(x.id) + '">su impacto</a>'; };
  function listaDetalle() {
    var xs = flDet.filtrar();
    if (!xs.length) return flDet.vacio(DET.items.length);
    var porTipo = {};
    xs.forEach(function (x) { (porTipo[x.t] = porTipo[x.t] || []).push(x); });
    var porNivel = function (ys) { return ys.slice().sort(function (a, b) { return a.nivel - b.nivel || (nombre(a.id) < nombre(b.id) ? -1 : 1); }); };
    var item = function (x) { return "<li>" + ligado(x.id) + " <small>· " + (SIM[x.id] ? "<code>" + esc(donde(x.id)) + "</code> · " : "") + (x.nivel > 1 ? "nivel " + x.nivel : "directo") + enlaceImp(x) + "</small><br><small>" + esc(x.porque) + "</small></li>"; };
    var tipos = Object.keys(porTipo).sort(porOrden);
    return flDet.resultado(xs, "", DET.activa === "afecta" ? '<button type="button" class="boton" id="copiar-impacto">Copiar como lista</button>' : "") +
      '<div class="grupos-impacto' + (tipos.length === 1 ? " uno" : "") + '">' + tipos.map(function (t) {
        return '<section class="grupo-impacto" data-tipo="' + t + '"><h2>' + puntoT(t) + " " + esc(mayus(tituloT(t, 2))) + ' <small class="cuenta">' + porTipo[t].length + "</small></h2>" +
          '<ul class="lista">' + porNivel(porTipo[t]).map(item).join("") + "</ul></section>";
      }).join("") + "</div>";
  }
  // Copiar como lista: lo que se ve, con el porqué de cada pieza.
  raizImpacto.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.id === "copiar-impacto" ? ev.target : null;
    if (!b) return;
    var xs = flDet.filtrar(), n = porId[DET.id];
    var feats = xs.filter(function (x) { return porFicha[x.id]; }), tecnicas = xs.filter(function (x) { return !porFicha[x.id]; });
    var porNivel = function (ys) { return ys.slice().sort(function (a, b) { return a.nivel - b.nivel || (nombre(a.id) < nombre(b.id) ? -1 : 1); }); };
    var plano = function (x) { return "- " + nombre(x.id) + " (" + (TIPO[x.t] || x.t) + (SIM[x.id] ? ", " + donde(x.id) : "") + ", " + (x.nivel > 1 ? "nivel " + x.nivel : "directo") + "): " + x.porque; };
    copia = "Impacto de cambiar " + (n ? n.n : DET.id) + " (" + DET.id + ")" + (flDet.activos().length ? " — " + flDet.activos().join(", ") : "") + "\n\n" +
      (feats.length ? "Funcionalidades:\n" + porNivel(feats).map(plano).join("\n") + "\n\n" : "") +
      (tecnicas.length ? "Piezas técnicas:\n" + porNivel(tecnicas).map(plano).join("\n") + "\n" : "");
    var listo = function () { b.textContent = "Copiado"; setTimeout(function () { b.textContent = "Copiar como lista"; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(copia).then(listo, function () { b.textContent = "No se pudo copiar"; });
  });
  function mostrarImpacto(id, pestana) {
    if (!id || (!porId[id] && !SIM[id])) return inicioImpacto();
    cerebroActual = cerebroDe(id);
    var codigo = SIM[id] || simsDeArchivo[id];
    var imp = conNivel(codigo ? impactoDeCodigo(id) : impacto(deps, id)), dep = conNivel(codigo ? dependeDeCodigo(id) : dependeDe(deps, id, tipo));
    // Afectados: "lee Club, que …" (de la pieza hacia atrás). Dependencias: "se apoya en /x, que llama a …" (de la pieza hacia adelante).
    var porque = function (x) {
      var partes = [];
      for (var c = x; c; c = imp.info[c.via]) partes.push((VERBO[c.verbo] || c.verbo) + " " + nombreEn(c.via));
      return partes.join(", que ");
    };
    var camino = function (x) {
      var pasos = [];
      for (var c = x; c; c = dep.info[c.via]) pasos.unshift(c);
      return pasos.map(function (c, i) { return (i === 0 ? nombre(id) + " " : "que ") + (VERBO_IDA[c.verbo] || c.verbo) + " " + nombreEn(c.id); }).join(", ");
    };
    var todos = imp.todos;
    // Sin nada que dependa de la pieza, se abre en lo que ella necesita.
    var activa = pestana === "depende" || (pestana !== "afecta" && !todos.length && dep.todos.length) ? "depende" : "afecta";
    var fuente = activa === "afecta" ? todos : dep.todos, explica = activa === "afecta" ? porque : camino;
    if (DET.id !== id || DET.activa !== activa) DET = { id: id, activa: activa, items: fuente.map(function (x) { return { id: x.id, t: tipo(x.id), c: cerebroIdx(x.id), nivel: x.nivel, porque: explica(x) }; }) };
    FLI = flDet;
    var n = porId[id] || { n: SIM[id].n, t: SIM[id].t };
    // Por qué no hay nada: en el grafo, en el código indexado, o porque no hay índice de código.
    var porQueNada = SIM[id] ? "Nada llama ni usa " + esc(n.n) + " en el código indexado: puede llamarse con un nombre armado en tiempo de ejecución, desde fuera de los repos indexados, o no usarse."
      : (n.t === "archivo" || n.t === "test") && !codigo ? "Nada depende de " + esc(n.n) + " en el grafo. " + (COD ? "El índice de código no le encontró clases, funciones ni otros símbolos." : "Sin índice de código no se sabe quién usa su código: corré <code>flowbrain index</code> y <code>flowbrain compile</code>.")
      : codigo ? "Nada llama ni usa el código de " + esc(n.n) + " desde otro archivo, ni lo atiende un endpoint o lo tiene una funcionalidad."
      : "Nada depende de " + esc(n.n) + " en el grafo: cambiarla no rompe otras funcionalidades ni servicios conocidos.";
    var panelAfecta = todos.length
      ? '<p class="explica">Lo que se rompe o hay que revisar si cambia ' + esc(n.n) + ".</p>" + flDet.html() + '<div id="imd-lista">' + listaDetalle() + "</div>"
      : '<p class="aviso">' + porQueNada + (dep.todos.length ? ' Mirá <a href="#/impacto/' + encodeURIComponent(id) + '/depende">de qué depende</a>: si cambia alguna de esas piezas, sí la afecta.' : "") + "</p>";
    var panelDepende = dep.todos.length
      ? '<p class="explica">Lo que ' + esc(n.n) + " necesita: si cambia alguna de estas piezas, " + esc(n.n) + " puede verse afectada.</p>" + flDet.html() + '<div id="imd-lista">' + listaDetalle() + "</div>"
      : '<p class="aviso">' + esc(n.n) + (codigo ? " no llama ni usa otro código indexado." : " no depende de otras piezas en el grafo.") + "</p>";
    var tab = function (k, texto, cuenta) { return '<a class="pestana' + (activa === k ? " on" : "") + '" href="#/impacto/' + encodeURIComponent(id) + "/" + k + '">' + texto + " <b>" + cuenta + "</b></a>"; };
    raizImpacto.innerHTML = '<a class="volver" href="#/impacto">← Impacto</a>' +
      "<h1>" + esc(n.n) + "</h1>" +
      (SIM[id] ? '<p class="subtitulo">' + esc(TIPO[n.t] || n.t) + " · <code>" + esc(donde(id)) + '</code> · <a href="#/n/' + encodeURIComponent(SIM[id].a) + '">su archivo</a> · <a href="#/impacto/' + encodeURIComponent(SIM[id].a) + '">impacto del archivo</a></p>' :
      '<p class="subtitulo">' + esc(TIPO[n.t] || n.t) + " · <code>" + esc(id) + "</code>" + (porFicha[id] ? ' · <a href="#/f/' + encodeURIComponent(id) + '">ficha de producto</a>' : "") + ' · <a href="#/n/' + encodeURIComponent(id) + '">ficha técnica</a> · <a href="#/grafo/' + encodeURIComponent(id) + '">mapa 3D</a></p>') +
      '<nav class="pestanas">' + tab("afecta", "Si cambia, afecta a", todos.length) + tab("depende", "Depende de", dep.todos.length) + "</nav>" +
      '<div class="panel-impacto">' + (activa === "afecta" ? panelAfecta : panelDepende) + "</div>";
  }

  // ---------- Ficha técnica: qué es una pieza, sus datos y con qué se conecta ----------
  var enlaceFicha = function (id) { return SIM[id] ? "#/impacto/" + encodeURIComponent(id) : porFicha[id] ? "#/f/" + encodeURIComponent(id) : "#/n/" + encodeURIComponent(id); };
  // Con varios cerebros, una pieza de otro cerebro lleva su nombre: dos funcionalidades pueden llamarse igual.
  var cerebroActual = null;
  var cerebroDe = function (id) { return CEREBROS.length > 1 && id.indexOf("/") > 0 ? id.slice(0, id.indexOf("/")) : null; };
  var nombreEn = function (id) { var c = cerebroDe(id); return nombre(id) + (c && cerebroActual && c !== cerebroActual ? " (" + c + ")" : ""); };
  var ligado = function (id) { return '<a href="' + enlaceFicha(id) + '">' + punto(id) + " " + esc(nombreEn(id)) + "</a>"; };
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
      if (tipo(otro) === "archivo" || tipo(otro) === "test" || otro === id) return;
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
    cerebroActual = cerebroDe(id);
    FLI = null;
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
      if (infra.length) partes.push(seccion("Infraestructura", '<ul class="lista">' + infra.map(function (x) { return "<li><b>" + esc(x.clase || "") + "</b> " + esc(x.nombre || "") + (x.detalle && x.detalle.length ? "<br><small>" + x.detalle.map(esc).join("<br>") + "</small>" : "") + (x.atiende ? "<br><small>atiende " + esc(x.atiende.simbolo) + " · " + ev(x.atiende.evidencia) + "</small>" : "") + (x.endpoints && x.endpoints.length ? "<br><small>llega a " + (x.endpointsTotal || x.endpoints.length) + " endpoints: " + x.endpoints.map(esc).join(", ") + (x.endpointsTotal ? "…" : "") + "</small>" : "") + "<br><small>" + ev(x.evidencia) + "</small></li>"; }).join("") + "</ul>"));
    } else {
      var claves = Object.keys(at);
      if (claves.length) partes.push(seccion("Datos", tablaKV(claves.map(function (k) { var v = at[k]; return fila(k, typeof v === "string" ? esc(v) : "<pre>" + esc(JSON.stringify(v, null, 2)) + "</pre>"); }))));
    }
    // Un archivo: sus símbolos, cada uno con su impacto.
    if (simsDeArchivo[id]) partes.push(seccion("Símbolos", '<ul class="lista">' + simsDeArchivo[id].map(function (i) {
      var x = SIMS[i], k = (llamanA[i] || []).length;
      return '<li><a href="#/impacto/' + encodeURIComponent(x.id) + '">' + puntoT(x.t) + " " + esc(x.n) + "</a> <small>· " + esc(TIPO[x.t] || x.t) + " · línea " + x.l + " · " + (k ? plural(k, "lugar lo llama o lo usa", "lugares lo llaman o lo usan") : "nadie lo llama ni lo usa") + "</small></li>";
    }).join("") + "</ul>"));
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
    else if (/^\/fidelidad/.test(h)) vista = "fidelidad";
    else if (/^\/especificaciones/.test(h)) vista = "especificaciones";
    else if (/^\/sin-asociar/.test(h)) vista = "sinasociar";
    else if (/^\/contratos/.test(h)) vista = "contratos";
    else if (h === "" && !fichas.length) vista = "grafo";
    else vista = "producto";
    // La navegación entre pantallas se dibuja en el mismo contenedor que las funcionalidades.
    var pestana = vista === "producto" && /^\/(pantallas|p\/)/.test(h) ? "pantallas" : vista;
    document.querySelectorAll("#cabecera nav a").forEach(function (a) { a.classList.toggle("activa", a.getAttribute("data-vista") === pestana); });
    Object.keys(vistas).forEach(function (k) { vistas[k].classList.toggle("oculto", k !== vista); });
    document.getElementById("presets").classList.toggle("oculto", vista !== "grafo");
    if (vista === "grafo") { V.mostrarMapa(); if ((m = /^\/grafo\/(.+)$/.exec(h))) V.enfocar(m[1]); return; }
    if (vista === "fidelidad") { window.brainFidelidad.mostrar(); window.scrollTo(0, 0); return; }
    if (vista === "contratos") { window.brainContratos.mostrar(); window.scrollTo(0, 0); return; }
    if (vista === "sinasociar") { window.brainSinAsociar.mostrar(); window.scrollTo(0, 0); return; }
    if (vista === "especificaciones") { m = /^\/especificaciones\/(.+)$/.exec(h); window.scrollTo(0, 0); window.brainEspecificaciones.mostrar(m ? m[1] : null); return; }
    if (vista === "impacto" && (m = /^\/n\/(.+)$/.exec(h))) { mostrarFicha(m[1]); window.scrollTo(0, 0); return; }
    if (vista === "impacto") { m = /^\/impacto\/(.+?)(?:\/(afecta|depende))?$/.exec(h); mostrarImpacto(m ? m[1] : null, m ? m[2] : null); window.scrollTo(0, 0); return; }
    if (pestana === "pantallas") window.brainPantallas.mostrar(h); else P.mostrar(h);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", ir);
  ir();
})();
`;

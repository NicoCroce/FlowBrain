import type { Graph } from "./schema.js";

/**
 * Visor estático (`_build/viewer.html`): un único HTML con Cytoscape.js y el grafo embebidos, sin servidor ni red.
 * Filtros por tipo, estado y origen; búsqueda por id, nombre o alias; clic en un nodo → frontmatter resumido,
 * aristas con evidencia y enlace a la página. Determinístico: depende solo del grafo y de la versión de Cytoscape.
 */

/** Tipos visibles al abrir el visor: los generados (endpoints, archivos) se prenden a mano. */
const TIPOS_INICIALES = ["repo", "svc", "lib", "db", "queue", "ext", "tabla", "feat", "team", "decision"];

const seguroEnScript = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

export function renderViewer(graph: Graph, cytoscapeJs: string): string {
  const datos = {
    edges: graph.edges.map((e) => ({
      c: e.confianza,
      d: e.dato,
      e: e.estado,
      ev: e.evidencia,
      h: e.hasta,
      o: e.origen,
      p: e.endpoint,
      s: e.desde,
      v: e.verbo,
    })),
    nodes: graph.nodes.map((n) => ({
      a: n.aliases,
      act: n.actualizado,
      e: n.estado,
      id: n.id,
      n: n.nombre,
      o: n.origen,
      p: n.pagina,
      r: n.resumen,
      t: n.tipo,
      ver: n.verificado,
    })),
    tiposIniciales: TIPOS_INICIALES,
  };
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brain · visor</title>
<style>
:root {
  --fondo: #f7f7f5; --panel: #ffffff; --texto: #1d1d1b; --suave: #6b6b66; --borde: #e2e2dc; --acento: #2f6fdb;
  --svc: #2f6fdb; --repo: #6b6b66; --lib: #7a5cc7; --db: #b5651d; --tabla: #d08a3c; --queue: #1f9e89; --ext: #c2410c;
  --feat: #16a34a; --team: #a16207; --decision: #9333ea; --contrato: #94a3b8; --endpoint: #60a5fa; --archivo: #a8a29e;
  --dudoso: #dc2626;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #141413; --panel: #1e1e1c; --texto: #ecebe6; --suave: #a3a39b; --borde: #34342f; --acento: #7aa7f5;
    --svc: #7aa7f5; --repo: #a3a39b; --lib: #b39ddb; --db: #e0a060; --tabla: #f0b878; --queue: #4fd1b8; --ext: #fb8c5a;
    --feat: #4ade80; --team: #facc15; --decision: #c084fc; --contrato: #64748b; --endpoint: #93c5fd; --archivo: #78716c;
    --dudoso: #f87171;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--fondo); color: var(--texto); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
#app { display: grid; grid-template-columns: 300px 1fr 340px; height: 100vh; }
aside { background: var(--panel); border-right: 1px solid var(--borde); overflow: auto; padding: 14px; }
#detalle { border-right: 0; border-left: 1px solid var(--borde); }
h1 { font-size: 16px; margin: 0 0 10px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--suave); margin: 16px 0 6px; }
input[type=search], select { width: 100%; padding: 7px 9px; border: 1px solid var(--borde); border-radius: 6px; background: var(--fondo); color: var(--texto); font: inherit; }
label { display: flex; align-items: center; gap: 6px; padding: 2px 0; cursor: pointer; }
.punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
.cuenta { margin-left: auto; color: var(--suave); font-variant-numeric: tabular-nums; }
#resultados { list-style: none; margin: 6px 0 0; padding: 0; }
#resultados li { padding: 4px 6px; border-radius: 4px; cursor: pointer; }
#resultados li:hover { background: var(--fondo); }
#cy { width: 100%; height: 100%; }
.campo { display: grid; grid-template-columns: 96px 1fr; gap: 4px 8px; margin: 4px 0; }
.campo dt { color: var(--suave); }
.campo dd { margin: 0; word-break: break-word; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
a { color: var(--acento); }
.arista { padding: 6px 0; border-bottom: 1px solid var(--borde); }
.arista a { color: var(--acento); cursor: pointer; text-decoration: none; }
.estado-dudoso { color: var(--dudoso); font-weight: 600; }
.vacio { color: var(--suave); }
#barra { position: absolute; top: 10px; left: 10px; display: flex; gap: 6px; }
#barra button { padding: 5px 10px; border: 1px solid var(--borde); border-radius: 6px; background: var(--panel); color: var(--texto); font: inherit; cursor: pointer; }
main { position: relative; }
@media (max-width: 900px) {
  #app { grid-template-columns: 1fr; grid-template-rows: auto 60vh auto; height: auto; }
  aside, #detalle { border: 0; border-bottom: 1px solid var(--borde); }
}
</style>
</head>
<body>
<div id="app">
  <aside>
    <h1>Brain</h1>
    <input id="buscar" type="search" placeholder="Buscar por id, nombre o alias" autocomplete="off">
    <ul id="resultados"></ul>
    <h2>Tipo</h2><div id="f-tipo"></div>
    <h2>Estado</h2><div id="f-estado"></div>
    <h2>Origen</h2><div id="f-origen"></div>
    <h2>Diseño</h2>
    <select id="layout"><option value="cose">Fuerzas (cose)</option><option value="concentric">Concéntrico</option><option value="breadthfirst">Por niveles</option></select>
  </aside>
  <main>
    <div id="cy"></div>
    <div id="barra"><button id="ajustar">Ajustar</button><button id="limpiar">Limpiar selección</button></div>
  </main>
  <aside id="detalle"><p class="vacio">Hacé clic en un nodo o una arista para ver su detalle y su evidencia.</p></aside>
</div>
<script>${seguroEnScript(cytoscapeJs)}</script>
<script type="application/json" id="datos">${seguroEnScript(JSON.stringify(datos))}</script>
<script>
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("datos").textContent);
  var porId = {};
  D.nodes.forEach(function (n) { porId[n.id] = n; });
  var css = getComputedStyle(document.documentElement);
  var color = function (v) { return css.getPropertyValue("--" + v).trim() || "#888"; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  var valores = function (k, xs) { var m = {}; xs.forEach(function (x) { m[x[k]] = (m[x[k]] || 0) + 1; }); return Object.keys(m).sort().map(function (v) { return [v, m[v]]; }); };
  var activos = { t: {}, e: {}, o: {} };
  function filtros(div, k, inicial) {
    var cont = document.getElementById(div);
    valores(k, D.nodes).forEach(function (par) {
      var v = par[0];
      activos[k][v] = inicial ? inicial.indexOf(v) >= 0 : true;
      var l = document.createElement("label");
      l.innerHTML = '<input type="checkbox"' + (activos[k][v] ? " checked" : "") + '>' + (k === "t" ? '<span class="punto" style="background:' + color(v) + '"></span>' : "") + esc(v) + '<span class="cuenta">' + par[1] + "</span>";
      l.firstChild.addEventListener("change", function (ev) { activos[k][v] = ev.target.checked; aplicar(true); });
      cont.appendChild(l);
    });
  }
  filtros("f-tipo", "t", D.tiposIniciales);
  filtros("f-estado", "e");
  filtros("f-origen", "o");

  // Aristas paralelas (mismo origen, destino, verbo y estado) se dibujan como una sola, con su cantidad.
  var grupos = [], claveGrupo = {};
  D.edges.forEach(function (e, i) {
    var k = e.s + "\u0000" + e.h + "\u0000" + e.v + "\u0000" + e.e;
    if (claveGrupo[k] === undefined) { claveGrupo[k] = grupos.length; grupos.push([]); }
    grupos[claveGrupo[k]].push(i);
  });
  var cy = cytoscape({
    container: document.getElementById("cy"),
    elements: D.nodes.map(function (n) { return { group: "nodes", data: { id: n.id, label: n.n, tipo: n.t, estado: n.e } }; })
      .concat(grupos.map(function (g, i) {
        var e = D.edges[g[0]];
        return { group: "edges", data: { id: "e" + i, source: e.s, target: e.h, label: e.v + (g.length > 1 ? " ×" + g.length : ""), estado: e.e, idx: g } };
      })),
    wheelSensitivity: 0.3,
    style: [
      { selector: "node", style: { "background-color": function (n) { return color(n.data("tipo")); }, label: "data(label)", color: color("texto"), "font-size": 10, "text-valign": "bottom", "text-margin-y": 4, width: 18, height: 18 } },
      { selector: "node[tipo = 'svc'], node[tipo = 'repo']", style: { width: 26, height: 26, "font-size": 12 } },
      { selector: "node[tipo = 'db'], node[tipo = 'tabla']", style: { shape: "barrel" } },
      { selector: "node[tipo = 'ext']", style: { shape: "hexagon" } },
      { selector: "node[tipo = 'queue']", style: { shape: "round-rectangle" } },
      { selector: "node[tipo = 'feat']", style: { shape: "star" } },
      { selector: "node[estado = 'dudoso']", style: { "border-width": 2, "border-color": color("dudoso") } },
      { selector: "edge", style: { width: 1.2, "line-color": color("borde"), "target-arrow-color": color("borde"), "target-arrow-shape": "triangle", "curve-style": "bezier", "arrow-scale": 0.8, "control-point-step-size": 12 } },
      { selector: "edge[estado = 'dudoso']", style: { "line-style": "dashed", "line-color": color("dudoso"), "target-arrow-color": color("dudoso") } },
      { selector: "edge[estado = 'deprecado']", style: { "line-style": "dotted", opacity: 0.5 } },
      { selector: ".atenuado", style: { opacity: 0.12 } },
      { selector: ".foco", style: { "border-width": 3, "border-color": color("acento") } },
      { selector: "edge.vecina", style: { label: "data(label)", "font-size": 9, color: color("suave"), "line-color": color("acento"), "target-arrow-color": color("acento"), width: 2, "text-rotation": "autorotate" } }
    ]
  });

  function aplicar(relayout) {
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        var x = porId[n.id()];
        n.style("display", activos.t[x.t] && activos.e[x.e] && activos.o[x.o] ? "element" : "none");
      });
    });
    if (relayout) layout();
  }
  function layout() {
    var visibles = cy.elements(":visible");
    var nombre = document.getElementById("layout").value;
    visibles.layout({ name: nombre, animate: false, randomize: false, nodeDimensionsIncludeLabels: true, concentric: function (n) { return n.degree(); }, levelWidth: function () { return 2; }, padding: 30 }).run();
  }
  var sel = document.getElementById("layout");
  if (D.nodes.filter(function (n) { return D.tiposIniciales.indexOf(n.t) >= 0; }).length > 400) sel.value = "concentric";
  sel.addEventListener("change", layout);
  aplicar(true);

  var detalle = document.getElementById("detalle");
  function campo(k, v) { return v === null || v === undefined || (Array.isArray(v) && v.length === 0) ? "" : "<dt>" + k + "</dt><dd>" + v + "</dd>"; }
  function enlaceNodo(id) { return '<a data-id="' + esc(id) + '">' + esc(porId[id] ? porId[id].n : id) + "</a> <code>" + esc(id) + "</code>"; }
  function lineaArista(e, haciaAfuera) {
    var otro = haciaAfuera ? e.h : e.s;
    var ep = e.p ? " · <code>" + esc(porId[e.p] ? porId[e.p].n : e.p) + "</code>" : "";
    var dato = e.d ? " · dato <code>" + esc(e.d) + "</code>" : "";
    var estado = e.e !== "vigente" ? ' · <span class="estado-' + esc(e.e) + '">' + esc(e.e) + "</span>" : "";
    return '<div class="arista">' + (haciaAfuera ? "→ " : "← ") + "<strong>" + esc(e.v) + "</strong> " + enlaceNodo(otro) + ep + dato + estado +
      "<br><small>" + esc(e.o) + " · confianza " + e.c + (e.ev ? " · <code>" + esc(e.ev) + "</code>" : "") + "</small></div>";
  }
  function mostrarNodo(id) {
    var n = porId[id];
    if (!n) return;
    var sal = D.edges.filter(function (e) { return e.s === id; });
    var ent = D.edges.filter(function (e) { return e.h === id; });
    detalle.innerHTML = "<h1>" + esc(n.n) + "</h1><p><code>" + esc(n.id) + "</code></p>" +
      (n.r ? "<p>" + esc(n.r) + "</p>" : "") +
      '<dl class="campo">' + campo("tipo", esc(n.t)) + campo("estado", '<span class="estado-' + esc(n.e) + '">' + esc(n.e) + "</span>") + campo("origen", esc(n.o)) +
      campo("aliases", n.a.map(esc).join(", ")) + campo("actualizado", n.act && esc(n.act)) + campo("verificado", n.ver && esc(n.ver)) +
      campo("página", n.p && '<a href="../' + esc(n.p) + '">' + esc(n.p) + "</a>") + "</dl>" +
      "<h2>Salientes (" + sal.length + ")</h2>" + (sal.map(function (e) { return lineaArista(e, true); }).join("") || '<p class="vacio">Ninguna.</p>') +
      "<h2>Entrantes (" + ent.length + ")</h2>" + (ent.map(function (e) { return lineaArista(e, false); }).join("") || '<p class="vacio">Ninguna.</p>');
  }
  function enfocar(id) {
    var n = cy.getElementById(id);
    if (n.empty()) return;
    if (n.style("display") === "none") { var x = porId[id]; activos.t[x.t] = activos.e[x.e] = activos.o[x.o] = true; sincronizarChecks(); aplicar(true); }
    cy.elements().removeClass("atenuado foco vecina");
    var vecindario = n.closedNeighborhood();
    cy.elements().not(vecindario).addClass("atenuado");
    n.addClass("foco");
    vecindario.edges().addClass("vecina");
    cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1) }, { duration: 200 });
    mostrarNodo(id);
  }
  function sincronizarChecks() {
    [["f-tipo", "t"], ["f-estado", "e"], ["f-origen", "o"]].forEach(function (p) {
      document.querySelectorAll("#" + p[0] + " label").forEach(function (l) { l.firstChild.checked = !!activos[p[1]][l.textContent.replace(/\\d+$/, "")]; });
    });
  }
  cy.on("tap", "node", function (ev) { enfocar(ev.target.id()); });
  cy.on("tap", "edge", function (ev) {
    var es = ev.target.data("idx").map(function (i) { return D.edges[i]; });
    detalle.innerHTML = "<h1>" + esc(es[0].v) + (es.length > 1 ? " ×" + es.length : "") + "</h1>" + '<p><small>desde</small> ' + enlaceNodo(es[0].s) + "</p>" + es.map(function (e) { return lineaArista(e, true); }).join("");
  });
  cy.on("tap", function (ev) { if (ev.target === cy) cy.elements().removeClass("atenuado foco vecina"); });
  detalle.addEventListener("click", function (ev) { var id = ev.target.getAttribute && ev.target.getAttribute("data-id"); if (id) enfocar(id); });
  document.getElementById("ajustar").addEventListener("click", function () { cy.fit(cy.elements(":visible"), 30); });
  document.getElementById("limpiar").addEventListener("click", function () { cy.elements().removeClass("atenuado foco vecina"); detalle.innerHTML = '<p class="vacio">Hacé clic en un nodo o una arista para ver su detalle y su evidencia.</p>'; });

  var buscar = document.getElementById("buscar");
  var resultados = document.getElementById("resultados");
  function coincidencias(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var pesos = D.nodes.map(function (n) {
      var claves = [n.id, n.n].concat(n.a).map(function (k) { return k.toLowerCase(); });
      var p = claves.some(function (k) { return k === q; }) ? 0 : claves.some(function (k) { return k.indexOf(q) === 0; }) ? 1 : claves.some(function (k) { return k.indexOf(q) >= 0; }) ? 2 : 9;
      return [p, n];
    }).filter(function (x) { return x[0] < 9; });
    pesos.sort(function (a, b) { return a[0] - b[0] || (a[1].id < b[1].id ? -1 : 1); });
    return pesos.slice(0, 12).map(function (x) { return x[1]; });
  }
  buscar.addEventListener("input", function () {
    resultados.innerHTML = coincidencias(buscar.value).map(function (n) { return '<li data-id="' + esc(n.id) + '"><span class="punto" style="background:' + color(n.t) + '"></span> ' + esc(n.n) + " <code>" + esc(n.id) + "</code></li>"; }).join("");
  });
  buscar.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { var c = coincidencias(buscar.value)[0]; if (c) enfocar(c.id); } });
  resultados.addEventListener("click", function (ev) { var li = ev.target.closest("li"); if (li) enfocar(li.getAttribute("data-id")); });
  window.brainVisor = { cy: cy, enfocar: enfocar };
})();
</script>
</body>
</html>
`;
}

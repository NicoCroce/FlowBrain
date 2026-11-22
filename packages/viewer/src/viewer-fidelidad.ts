/**
 * "Fidelidad" (`#/fidelidad`): qué tan entendido quedó cada archivo por el índice, de 0 a 100, y qué hacer para
 * llevarlo a 100. Cada fila se explica sola: la cadena de trazabilidad (qué eslabón quedó unido, cuál se corta y cuál
 * no aplica), y por cada cosa que falta, qué pasa, qué hacer y quién lo resuelve. Lo que se resuelve con un dato que
 * una persona conoce se hace ahí mismo (si la página la sirve `flowbrain viewer --serve`); lo demás va a un plan en
 * texto para pegarle a un modelo. La estadística y los filtros finos quedan plegados. Un vacío siempre dice por qué.
 * JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const FIDELIDAD_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("fidelidad");
  var F = D.fidelidad, CEREBROS = D.cerebros || [];
  var filas = F ? F.archivos : [];
  // Fidelidad incierta: archivos sin ninguna relación para medir. No tienen puntaje ni entran al promedio.
  var INC = F ? F.inciertos || [] : [];
  var POR_QUE = ["El índice no encontró nada acá: ni símbolos, ni llamadas, ni accesos. Suele ser configuración, datos o un lenguaje que ningún parser lee.", "El índice vio código, pero ninguna relación para medir: ni llamadas, ni HTTP, ni tablas, ni endpoints, ni pantallas. Suele ser un archivo de tipos o constantes; si no lo es, hay algo que el parser no supo leer."];
  var SIGNAL = { llamadas: "Llamadas entre métodos", http: "Llamadas HTTP", datos: "Accesos a tablas", entradas: "Recorrido de endpoints", contrato: "Tipo de respuesta", pantallas: "Pantallas con llamadas" };
  var MIDE = {
    llamadas: "llamadas que el índice pudo atribuir a su destino",
    http: "llamadas HTTP unidas a un endpoint o a un externo",
    datos: "accesos a tablas con página y columnas",
    entradas: "endpoints cuyo recorrido llega a una tabla, un servicio o una cola",
    contrato: "endpoints con tipo de respuesta",
    pantallas: "pantallas desde las que se llega a una llamada HTTP"
  };
  var ORDEN_SIGNAL = ["llamadas", "http", "datos", "entradas", "contrato", "pantallas"];
  // La cadena de trazabilidad: del producto a los datos. Cada eslabón junta una o dos signals.
  var CADENA = [["Pantalla", ["pantallas"]], ["HTTP", ["http"]], ["Endpoint", ["entradas", "contrato"]], ["Llamadas", ["llamadas"]], ["Datos", ["datos"]]];
  var CAPA = { entrada: "Entrada", logica: "Lógica", dominio: "Dominio", datos: "Datos", interfaz: "Interfaz", otros: "Otros" };
  var GRUPOS = [["", "Todos"], ["vos", "Lo resolvés vos"], ["agente", "Lo resuelve el agente"], ["completos", "Completos"], ["incierta", "Fidelidad incierta"]];
  var TRAMOS = [[0, 19], [20, 39], [40, 59], [60, 79], [80, 99], [100, 100]];
  var NINGUNA = "__ninguna";
  var PASO = 100;
  var inicial = function () { return { grupo: "", min: 0, max: 100, cerebro: "", lenguaje: "", capa: "", feat: "", signal: "", q: "", orden: "asc", ver: PASO, mas: false }; };
  var S = inicial();
  // El filtro sobrevive a una recarga (después de corregir algo la página se vuelve a pedir).
  var CLAVE = "flowbrain.fidelidad";
  var guardar = function () { try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLAVE, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ } };
  try {
    var previo = typeof sessionStorage !== "undefined" ? JSON.parse(sessionStorage.getItem(CLAVE) || "null") : null;
    if (previo) Object.keys(S).forEach(function (k) { if (typeof previo[k] === typeof S[k]) S[k] = previo[k]; });
    if (S.cerebro !== "" && !CEREBROS[Number(S.cerebro)]) S.cerebro = "";
  } catch (e) { /* sin almacenamiento */ }
  // Edición: solo cuando la página la sirve flowbrain viewer --serve.
  var ED = window.FLOWBRAIN_EDICION || null;
  // abierto: { a: archivo, que: "llamadas" | "http" }. MSG: { a, texto, ... }. PEDIDO: archivo con su plan a la vista.
  var abierto = null, DET = null, MSG = null, ocupado = false, PEDIDO = null;
  // El plan de la lista: qué relaciones entran y cuántos archivos.
  var PL = { abierto: false, signals: {}, limite: 40, copiado: false };

  var plural = function (n, uno, varios) { return n.toLocaleString("es") + " " + (n === 1 ? uno : varios); };
  var tono = function (p) { return p < 40 ? "var(--dudoso)" : p < 80 ? "var(--feat)" : "var(--tabla)"; };
  var promedio = function (xs) { if (!xs.length) return null; var s = 0; xs.forEach(function (x) { s += x.p; }); return Math.round((10 * s) / xs.length) / 10; };
  var cerebroDe = function (x) { return x.c !== undefined && CEREBROS[x.c] ? CEREBROS[x.c].nombre : ""; };
  // "cerebro/repo-x:src/a.ts" → { repo: "repo-x", ruta: "src/a.ts" }
  var partes = function (x) {
    var c = cerebroDe(x), a = c && x.a.indexOf(c + "/") === 0 ? x.a.slice(c.length + 1) : x.a, i = a.indexOf(":");
    return { repo: i < 0 ? "" : a.slice(0, i), ruta: i < 0 ? a : a.slice(i + 1) };
  };
  var nombreFeat = function (id) { return porId[id] ? porId[id].n : id; };
  var lineas = function (ls) { return ls.length > 6 ? "L" + ls.slice(0, 6).join(", L") + " y " + (ls.length - 6) + " más" : "L" + ls.join(", L"); };
  var paraVos = function (x) { return x.t.some(function (t) { return t[1] === 1; }); };
  var paraAgente = function (x) { return x.t.some(function (t) { return t[1] === 0; }); };
  var enGrupo = function (x, g) { return g === "vos" ? paraVos(x) : g === "agente" ? paraAgente(x) : g === "completos" ? !x.t.length : g === "incierta" ? false : true; };

  function coincide(x) {
    if (!enGrupo(x, S.grupo)) return false;
    if (x.p < S.min || x.p > S.max) return false;
    if (S.cerebro !== "" && String(x.c) !== S.cerebro) return false;
    if (S.lenguaje && x.l !== S.lenguaje) return false;
    if (S.capa && x.k !== S.capa) return false;
    if (S.feat === NINGUNA ? !x.u : S.feat && x.f.indexOf(S.feat) < 0) return false;
    if (S.signal) { var v = x.s[S.signal]; if (!v || v[0] >= v[1]) return false; }
    if (S.q) {
      var q = S.q.trim().toLowerCase();
      if (q && x.a.toLowerCase().indexOf(q) < 0 && !x.t.some(function (t) { return t[2].toLowerCase().indexOf(q) >= 0; })) return false;
    }
    return true;
  }
  function filtradas() {
    var out = filas.filter(coincide);
    out.sort(function (a, b) { return (S.orden === "asc" ? a.p - b.p : b.p - a.p) || b.t.length - a.t.length || (a.a < b.a ? -1 : 1); });
    return out;
  }
  // Lo que hay puesto, en palabras: para decir por qué una lista quedó vacía.
  function filtrosActivos() {
    var out = [];
    if (S.grupo) out.push(S.grupo === "vos" ? "lo que resolvés vos" : S.grupo === "agente" ? "lo que resuelve el agente" : "completos");
    if (S.min > 0 || S.max < 100) out.push("puntaje de " + S.min + " a " + S.max);
    if (S.cerebro !== "") out.push("cerebro " + CEREBROS[Number(S.cerebro)].nombre);
    if (S.lenguaje) out.push("tipo " + S.lenguaje);
    if (S.capa) out.push("capa " + (CAPA[S.capa] || S.capa));
    if (S.feat) out.push(S.feat === NINGUNA ? "sin funcionalidad" : "funcionalidad " + nombreFeat(S.feat));
    if (S.signal) out.push("le falta: " + SIGNAL[S.signal]);
    if (S.q.trim()) out.push("texto «" + S.q.trim() + "»");
    return out;
  }

  // ---------- Resumen: siempre de todos los archivos ----------
  function barra(etiqueta, valor, pct, detalle, attrs, activa) {
    return '<button type="button" class="fd-barra' + (activa ? " on" : "") + '" ' + attrs + ' title="' + esc(detalle) + '">' +
      '<span class="fd-et">' + etiqueta + '</span><span class="fd-pista"><span class="fd-relleno" style="width:' + Math.max(pct, pct > 0 ? 1.5 : 0) + "%;background:" + tono(valor) + '"></span></span>' +
      '<span class="fd-val">' + esc(detalle) + "</span></button>";
  }
  function graficos() {
    var max = 1, cuentas = TRAMOS.map(function (t) { var n = filas.filter(function (x) { return x.p >= t[0] && x.p <= t[1]; }).length; if (n > max) max = n; return n; });
    var reparto = TRAMOS.map(function (t, i) {
      var et = t[0] === t[1] ? "100" : t[0] + "–" + t[1];
      return barra(et, t[0], (100 * cuentas[i]) / max, plural(cuentas[i], "archivo", "archivos"), 'data-min="' + t[0] + '" data-max="' + t[1] + '"', S.min === t[0] && S.max === t[1]);
    }).join("");
    var porCerebro = CEREBROS.length > 1 ? CEREBROS.map(function (c, i) {
      var xs = filas.filter(function (x) { return x.c === i; }), p = promedio(xs);
      if (p === null) return '<p class="fd-sin"><strong>' + esc(c.nombre) + "</strong> · sin índice de código: no hay archivos para medir</p>";
      return barra(esc(c.nombre), p, p, p + " · " + plural(xs.length, "archivo", "archivos"), 'data-cerebro="' + i + '"', S.cerebro === String(i));
    }).join("") : "";
    var signals = ORDEN_SIGNAL.map(function (s) {
      var ok = 0, total = 0, conFalta = 0;
      filas.forEach(function (x) { var v = x.s[s]; if (!v) return; ok += v[0]; total += v[1]; if (v[0] < v[1]) conFalta++; });
      if (!total) return "";
      var pct = Math.round((1000 * ok) / total) / 10;
      return barra(SIGNAL[s], pct, pct, pct + "% · " + (conFalta ? plural(conFalta, "archivo con falta", "archivos con falta") : "sin faltas"), 'data-signal="' + s + '" aria-label="' + esc(SIGNAL[s] + ": " + MIDE[s]) + '"', S.signal === s);
    }).join("");
    return '<div class="fd-graficos">' +
      '<section><h2>Reparto por puntaje</h2><div class="fd-barras">' + reparto + "</div></section>" +
      (porCerebro ? '<section><h2>Por cerebro</h2><div class="fd-barras">' + porCerebro + "</div></section>" : "") +
      '<section><h2>Qué se entendió, por signal</h2><div class="fd-barras">' + signals + "</div></section>" +
      "</div>";
  }
  function cifras() {
    var p = promedio(filas), completos = filas.filter(function (x) { return x.p === 100; }).length;
    var cifra = function (valor, texto, color) { return '<div class="fd-cifra"><b' + (color ? ' style="color:' + color + '"' : "") + ">" + valor + "</b><span>" + texto + "</span></div>"; };
    return '<div class="fd-cifras">' + cifra(p === null ? "—" : p, "puntaje promedio de lo medido", p === null ? "" : tono(p)) + cifra(filas.length.toLocaleString("es"), "archivos medidos") +
      cifra(completos.toLocaleString("es"), "en 100") + cifra((filas.length - completos).toLocaleString("es"), "con algo por completar") + cifra(INC.length.toLocaleString("es"), "de fidelidad incierta") + "</div>";
  }
  // Los tres grupos: quién puede resolver lo que falta. Un archivo con cosas de los dos tipos está en los dos.
  function grupos() {
    return '<div class="fd-grupos" role="group" aria-label="Qué ver">' + GRUPOS.map(function (g) {
      var n = g[0] === "incierta" ? INC.length : filas.filter(function (x) { return enGrupo(x, g[0]); }).length;
      if (g[0] === "incierta" && !n) return "";
      return '<button type="button" class="fd-grupo' + (S.grupo === g[0] ? " on" : "") + '" data-grupo="' + g[0] + '">' + g[1] + " <small>" + n.toLocaleString("es") + "</small></button>";
    }).join("") + "</div>";
  }

  // ---------- Filtros ----------
  function opciones(valores, actual) {
    return valores.map(function (v) { return '<option value="' + esc(v[0]) + '"' + (String(v[0]) === actual ? " selected" : "") + ">" + esc(v[1]) + (v[2] !== undefined ? " (" + v[2] + ")" : "") + "</option>"; }).join("");
  }
  function contar(clave) {
    var m = {};
    filas.forEach(function (x) { var ks = clave(x); ks.forEach(function (k) { m[k] = (m[k] || 0) + 1; }); });
    return m;
  }
  var campo = function (id, etiqueta, html) { return '<label class="fd-campo" for="' + id + '"><span class="lbl">' + etiqueta + "</span>" + html + "</label>"; };
  function filtros() {
    var lengs = contar(function (x) { return [x.l]; }), capas = contar(function (x) { return [x.k]; }), feats = contar(function (x) { return x.f; });
    var sinFeat = filas.filter(function (x) { return x.u; }).length;
    var porCantidad = function (m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }); };
    var sel = function (id, todos, ops, actual) { return '<select id="' + id + '"><option value="">' + todos + "</option>" + opciones(ops, actual) + "</select>"; };
    var featOps = Object.keys(feats).sort(function (a, b) { return nombreFeat(a).toLowerCase() < nombreFeat(b).toLowerCase() ? -1 : 1; }).map(function (id) {
      var c = CEREBROS.length > 1 && id.indexOf("/") > 0 ? " · " + id.slice(0, id.indexOf("/")) : "";
      return [id, nombreFeat(id) + c, feats[id]];
    });
    if (sinFeat) featOps.unshift([NINGUNA, "Sin funcionalidad", sinFeat]);
    return '<div class="fd-filtros">' +
      campo("fd-min", "Puntaje desde", '<input id="fd-min" type="number" min="0" max="100" step="1" value="' + S.min + '">') +
      campo("fd-max", "hasta", '<input id="fd-max" type="number" min="0" max="100" step="1" value="' + S.max + '">') +
      (CEREBROS.length > 1 ? campo("fd-cerebro", "Cerebro", sel("fd-cerebro", "Todos", CEREBROS.map(function (c, i) { return [i, c.nombre, filas.filter(function (x) { return x.c === i; }).length]; }), S.cerebro)) : "") +
      campo("fd-lenguaje", "Tipo de archivo", sel("fd-lenguaje", "Todos", porCantidad(lengs).map(function (k) { return [k, k, lengs[k]]; }), S.lenguaje)) +
      campo("fd-capa", "Capa", sel("fd-capa", "Todas", porCantidad(capas).map(function (k) { return [k, CAPA[k] || k, capas[k]]; }), S.capa)) +
      campo("fd-feat", "Funcionalidad", sel("fd-feat", "Todas", featOps, S.feat)) +
      campo("fd-signal", "Signal que falta", sel("fd-signal", "Cualquiera", ORDEN_SIGNAL.map(function (s) { return [s, SIGNAL[s]]; }), S.signal)) +
      "</div>";
  }
  var cuantosFinos = function () { return (S.min > 0 || S.max < 100 ? 1 : 0) + (S.cerebro !== "" ? 1 : 0) + (S.lenguaje ? 1 : 0) + (S.capa ? 1 : 0) + (S.feat ? 1 : 0) + (S.signal ? 1 : 0); };
  function herramientas() {
    var n = cuantosFinos();
    return '<div class="fd-herr">' +
      '<input id="fd-q" type="search" placeholder="Buscar por ruta o por lo que falta" aria-label="Buscar" autocomplete="off" value="' + esc(S.q) + '">' +
      '<button type="button" class="boton' + (S.mas ? " on" : "") + '" data-acc="mas-filtros" aria-expanded="' + (S.mas ? "true" : "false") + '">Filtros y estadística' + (n ? " (" + n + ")" : "") + "</button>" +
      '<button type="button" class="boton' + (PL.abierto ? " on" : "") + '" data-acc="plan">Generar plan para el agente</button></div>' +
      (S.mas ? filtros() + graficos() : "");
  }

  // ---------- Plan para el agente ----------
  // El mismo texto que arma flowbrain fidelity --plan: reglas, cómo se resuelve cada cosa, archivos con sus tareas y cierre.
  function textoDelPlan(xs, quiere, limite) {
    var con = xs.map(function (x) { return { x: x, t: x.t.filter(function (t) { return !quiere || quiere[t[0]]; }) }; }).filter(function (e) { return e.t.length; });
    con.sort(function (a, b) { return a.x.p - b.x.p || (a.x.a < b.x.a ? -1 : 1); });
    if (!con.length) return "";
    var elegidos = con.slice(0, limite);
    var usadas = ORDEN_SIGNAL.filter(function (s) { return elegidos.some(function (e) { return e.t.some(function (t) { return t[0] === s; }); }); });
    var out = ["# Plan de fidelidad", "",
      "Objetivo: llevar a 100 el puntaje de fidelidad de " + plural(elegidos.length, "archivo", "archivos") + " del índice de FlowBrain (hoy promedian " + promedio(elegidos.map(function (e) { return e.x; })) + "). El puntaje mide cuánto de lo que hay en cada archivo quedó unido en el grafo."];
    if (con.length > elegidos.length) out.push("", "Este plan trae los " + elegidos.length + " de menor puntaje; quedan " + (con.length - elegidos.length) + " más para otra tanda.");
    if (CEREBROS.length > 1) out.push("", "Cada archivo va como cerebro/repo:ruta. Lo que declares va en la carpeta de ese cerebro.");
    out.push("", "## Reglas", "");
    F.plan.reglas.forEach(function (r) { out.push("- " + r); });
    out.push("", "## Cómo se resuelve cada cosa", "");
    usadas.forEach(function (s) { out.push("- **" + s + "**: " + F.plan.como[s]); });
    out.push("", "## Archivos");
    elegidos.forEach(function (e) {
      out.push("", "### " + e.x.a + " (" + e.x.p + "/100)");
      e.t.forEach(function (t) { out.push("- [ ] " + t[0] + ": " + t[2] + (t[4].length ? " (" + lineas(t[4]) + ")" : "") + "."); });
    });
    out.push("", "## Al terminar", "");
    F.plan.cierre.forEach(function (c, i) { out.push((i + 1) + ". " + c); });
    return out.join("\n") + "\n";
  }
  function copiar(texto, listo) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(function () { listo(true); }, function () { listo(false); }); return; }
    } catch (e) { /* sin portapapeles */ }
    listo(false);
  }
  var cajaDeTexto = function (id, texto) { return '<textarea id="' + id + '" class="fd-texto" readonly rows="12" aria-label="Plan para el agente">' + esc(texto) + "</textarea>"; };
  var notaCopia = function (copiado) { return copiado === true ? '<span class="fd-ok">Copiado. Pegalo en tu agente.</span>' : copiado === "no" ? '<span class="fd-nota">No se pudo copiar solo: seleccioná el texto y copialo.</span>' : ""; };
  function planDeLista() {
    if (!PL.abierto) return "";
    var xs = filtradas(), presentes = ORDEN_SIGNAL.filter(function (s) { return xs.some(function (x) { return x.t.some(function (t) { return t[0] === s; }); }); });
    if (!presentes.length) return '<div class="fd-plan"><p class="aviso">No hay plan que armar: ningún archivo de la lista tiene algo por resolver. Cambiá de grupo o quitá filtros.</p></div>';
    var quiere = {};
    presentes.forEach(function (s) { quiere[s] = PL.signals[s] !== false; });
    var texto = textoDelPlan(xs, quiere, PL.limite);
    var casillas = presentes.map(function (s) {
      var n = xs.filter(function (x) { return x.t.some(function (t) { return t[0] === s; }); }).length;
      return '<label class="fd-casilla" title="' + esc(MIDE[s]) + '"><input type="checkbox" id="fd-pl-s-' + s + '"' + (quiere[s] ? " checked" : "") + "> " + SIGNAL[s] + " <small>" + n.toLocaleString("es") + "</small></label>";
    }).join("");
    return '<div class="fd-plan"><h2>Plan para el agente</h2>' +
      '<p class="fd-nota">Arma un texto con lo que les falta a los archivos de la lista de abajo y cómo se resuelve cada cosa. Pegalo en tu agente (Claude Code u otro): con el código y el MCP a mano, hace el trabajo y te dice qué quedó en 100.</p>' +
      '<div class="fd-casillas"><span class="lbl">Qué relaciones completar</span>' + casillas + "</div>" +
      '<div class="fd-linea-plan">' + campo("fd-pl-n", "Cuántos archivos, de menor a mayor", '<input id="fd-pl-n" type="number" min="1" max="500" step="1" value="' + PL.limite + '">') +
      '<button type="button" class="boton fd-pri" data-acc="copiar-plan"' + (texto ? "" : " disabled") + ">Copiar plan</button>" + notaCopia(PL.copiado) + "</div>" +
      (texto ? cajaDeTexto("fd-pl-texto", texto) : '<p class="aviso">Marcá al menos una relación para armar el plan.</p>') + "</div>";
  }

  // ---------- Lista ----------
  function cadena(x) {
    return '<div class="fd-cadena" aria-label="Trazabilidad">' + CADENA.map(function (e, i) {
      var ok = 0, total = 0;
      e[1].forEach(function (s) { var v = x.s[s]; if (v) { ok += v[0]; total += v[1]; } });
      var cls = !total ? "na" : ok >= total ? "ok" : "no";
      var titulo = !total ? "No aplica a este archivo" : e[1].filter(function (s) { return x.s[s]; }).map(function (s) { return SIGNAL[s] + ": " + x.s[s][0] + " de " + x.s[s][1] + " (" + MIDE[s] + ")"; }).join(" · ");
      return (i ? '<span class="fd-sep" aria-hidden="true">›</span>' : "") + '<span class="fd-es ' + cls + '" title="' + esc(titulo) + '">' + e[0] + (cls === "no" && total > 1 ? " " + ok + "/" + total : "") + "</span>";
    }).join("") + "</div>";
  }
  function accion(x, t) {
    if (t[1] !== 1) return '<span class="fd-quien">Lo resuelve el agente</span>';
    if (!ED) return '<span class="fd-quien vos">Lo resolvés vos</span>';
    var a = ' data-a="' + esc(x.a) + '"', on = function (que) { return abierto && abierto.a === x.a && abierto.que === que ? " on" : ""; };
    if (t[0] === "llamadas") return '<button type="button" class="boton' + on("llamadas") + '" data-acc="resolver" data-que="llamadas"' + a + ">Elegir destino</button>";
    return '<button type="button" class="boton' + on("http") + '" data-acc="resolver" data-que="http"' + a + ">Escribir la ruta</button>";
  }
  function tarea(x, t) {
    return '<div class="fd-tarea"><div class="fd-que"><p>' + esc(t[2]) + (t[4].length ? ' <span class="fd-ln">' + lineas(t[4]) + "</span>" : "") + ".</p>" +
      '<p class="fd-nota">' + esc(t[3]) + '</p></div><div class="fd-hacer">' + accion(x, t) + "</div></div>" +
      (abierto && abierto.a === x.a && abierto.que === (t[0] === "llamadas" ? t[0] : t[1] === 1 ? "http" : "") ? panel(x) : "");
  }
  function fila(x) {
    var p = partes(x), c = cerebroDe(x);
    var msg = MSG && MSG.a === x.a ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + (MSG.aplicar ? ' <button type="button" class="boton" data-acc="aplicar" data-cerebro="' + esc(MSG.aplicar) + '">Reindexar ' + esc(MSG.aplicar) + " ahora</button>" : "") + (MSG.recargar ? ' <button type="button" class="boton" data-acc="recargar">Ver el puntaje nuevo</button>' : "") + "</p>" : "";
    var pedido = PEDIDO && PEDIDO.a === x.a ? '<div class="fd-ed">' + '<p class="fd-nota">Pegale este texto a tu agente para que resuelva lo de este archivo.' + (PEDIDO.copiado ? " " + notaCopia(PEDIDO.copiado) : "") + "</p>" + cajaDeTexto("fd-pedido", textoDelPlan([x], null, 1)) + "</div>" : "";
    return '<li class="fd-fila">' +
      '<span class="fd-p" style="color:' + tono(x.p) + ";border-color:" + tono(x.p) + '">' + x.p + "</span>" +
      '<div class="fd-cuerpo"><div class="fd-ruta"><code>' + esc(p.ruta) + "</code>" + (p.repo ? " <small>" + esc(p.repo) + "</small>" : "") + "</div>" +
      '<div class="chips">' + (c && CEREBROS.length > 1 ? '<span class="chip">' + esc(c) + "</span>" : "") + '<span class="chip">' + esc(x.l) + '</span><span class="capa capa-' + esc(x.k) + '">' + esc(CAPA[x.k] || x.k) + "</span>" +
      (x.f.length ? x.f.map(function (id) { return '<a class="chip" href="#/f/' + encodeURIComponent(id) + '">' + esc(nombreFeat(id)) + "</a>"; }).join("") : x.u ? '<a class="chip fd-sinfeat" href="#/sin-asociar" title="No resta puntaje. Se asocia en Sin asociar">sin funcionalidad</a>' : "") + "</div>" +
      cadena(x) +
      (x.t.length ? x.t.map(function (t) { return tarea(x, t); }).join("") : '<p class="fd-ok">Completo: todo lo que el índice vio acá quedó unido.</p>') +
      msg +
      (x.t.length ? '<div><button type="button" class="boton' + (PEDIDO && PEDIDO.a === x.a ? " on" : "") + '" data-acc="pedido" data-a="' + esc(x.a) + '">Copiar pedido para el agente</button></div>' + pedido : "") +
      "</div></li>";
  }

  // ---------- Edición ----------
  var idServidor = function (x) { var p = partes(x); return p.repo + ":" + p.ruta; };
  // "cerebro/feat-x" → "feat-x": el servidor conoce los ids del cerebro, sin el prefijo del visor.
  var idLocal = function (x, id) { var c = cerebroDe(x); return c && id.indexOf(c + "/") === 0 ? id.slice(c.length + 1) : id; };
  var porArchivo = function (a) { for (var i = 0; i < filas.length; i++) if (filas[i].a === a) return filas[i]; return null; };
  function pedir(metodo, ruta, cuerpo) {
    return fetch(ruta, { method: metodo, headers: cuerpo ? { "content-type": "application/json", "x-flowbrain-token": ED.token } : { "x-flowbrain-token": ED.token }, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "el servidor respondió " + r.status); return j; }); });
  }
  function panel(x) {
    if (!DET) return '<div class="fd-ed"><p class="vacio">Leyendo el archivo…</p></div>';
    var html = "";
    if (abierto.que === "llamadas") {
      html = DET.llamadas.length ? DET.llamadas.map(function (l) {
        var donde = '<p class="fd-donde">L' + l.linea + " · en <code>" + esc(l.desde) + "</code> se llama a <code>" + esc(l.llamada) + "</code>. ¿A cuál va?</p>";
        var corto = function (k) { var i = k.lastIndexOf("#"); return esc(k.slice(i + 1)) + " <small>" + esc(k.slice(k.indexOf(":") + 1, i)) + "</small>"; };
        if (l.candidatos.length && l.candidatos.length <= 6) {
          return '<div class="fd-pregunta">' + donde + '<div class="fd-opciones">' + l.candidatos.map(function (k) { return '<button type="button" class="boton" data-acc="declarar-llamada" data-linea="' + l.linea + '" data-hacia="' + esc(k) + '">' + corto(k) + "</button>"; }).join("") + "</div></div>";
        }
        var destino = l.candidatos.length
          ? '<select id="fd-l-' + l.linea + '" aria-label="A qué método va">' + l.candidatos.map(function (k) { var i = k.lastIndexOf("#"); return '<option value="' + esc(k) + '">' + esc(k.slice(i + 1)) + " · " + esc(k.slice(k.indexOf(":") + 1, i)) + "</option>"; }).join("") + "</select>"
          : '<input id="fd-l-' + l.linea + '" type="search" placeholder="repo:ruta/Archivo.ext#Clase.metodo" aria-label="A qué método va" autocomplete="off">';
        return '<div class="fd-pregunta">' + donde + (l.candidatos.length ? "" : '<p class="fd-nota">El índice no encontró candidatos con ese nombre: escribilo, o dejáselo al agente con «Copiar pedido».</p>') + '<div class="fd-linea">' + destino + '<button type="button" class="boton" data-acc="declarar-llamada" data-linea="' + l.linea + '">Declarar</button></div></div>';
      }).join("") : '<p class="fd-nota">Ya no quedan llamadas sin resolver en este archivo.</p>';
    } else {
      html = DET.http.length ? DET.http.map(function (h) {
        if (!h.desde) return '<p class="fd-nota">L' + h.linea + ": no está dentro de una función, así que no se puede declarar acá. Dejáselo al agente con «Copiar pedido».</p>";
        return '<div class="fd-pregunta"><p class="fd-donde">L' + h.linea + " · en <code>" + esc(h.desde) + "</code> hay un <code>" + esc(h.metodo) + "</code>" + (h.base ? " a <code>" + esc(h.base) + "</code>" : "") + '. ¿A qué ruta llama?</p><div class="fd-linea">' +
          '<input id="fd-h-r-' + h.linea + '" type="search" placeholder="/pedidos/{id}" aria-label="Ruta" autocomplete="off">' +
          '<button type="button" class="boton" data-acc="declarar-http" data-linea="' + h.linea + '" data-metodo="' + esc(h.metodo) + '">Declarar</button></div></div>';
      }).join("") : '<p class="fd-nota">Ya no quedan llamadas HTTP sin ruta en este archivo.</p>';
    }
    return '<div class="fd-ed">' + html + "</div>";
  }
  function resolver(a, que) {
    if (abierto && abierto.a === a && abierto.que === que) { abierto = null; DET = null; pintarLista(); return; }
    abierto = { a: a, que: que }; DET = null; if (MSG && MSG.a !== a) MSG = null; pintarLista();
    var x = porArchivo(a);
    pedir("GET", "/api/archivo?cerebro=" + encodeURIComponent(cerebroDe(x)) + "&archivo=" + encodeURIComponent(idServidor(x)))
      .then(function (d) { if (abierto && abierto.a === a) { DET = d; pintarLista(); } })
      .catch(function (e) { if (abierto && abierto.a === a) { abierto = null; MSG = { a: a, texto: "No se pudo leer el archivo: " + e.message, error: true }; pintarLista(); } });
  }
  function enviar(x, cuerpo) {
    if (ocupado || !x) return;
    cuerpo.cerebro = cerebroDe(x); cuerpo.archivo = idServidor(x);
    ocupado = true; MSG = { a: x.a, texto: "Guardando…" }; pintarLista();
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
    ocupado = true; MSG = { a: a, texto: "Reindexando " + cerebro + "… puede tardar unos segundos." }; pintarLista(); pintarAviso("Reindexando " + cerebro + "…");
    pedir("POST", "/api/aplicar", { cerebro: cerebro }).then(function (r) {
      ocupado = false;
      if (r.errores.length) { MSG = { a: a, texto: "El cerebro se reindexó con errores: " + r.errores.join("; "), error: true }; pintarLista(); pintarAviso("El cerebro " + cerebro + " se reindexó con errores: " + r.errores.join("; ")); return; }
      guardar(); location.reload();
    }).catch(function (e) { ocupado = false; MSG = { a: a, texto: e.message, error: true }; pintarLista(); pintarAviso(null); });
  }
  var elem = function (id) { return document.getElementById(id); };
  var valor = function (id) { var e = elem(id); return e ? String(e.value || "").trim() : ""; };
  // Lo que se declaró y todavía no entró al índice: se dice arriba, con el botón para aplicarlo.
  function aviso(texto) {
    if (!ED) return '<p class="aviso" id="fd-aviso">Esta página es de solo lectura: podés ver qué falta y armar el plan para el agente. Para resolver desde acá lo que depende de vos, abrila con <code>flowbrain viewer --serve</code>.</p>';
    if (texto) return '<p class="aviso" id="fd-aviso">' + esc(texto) + "</p>";
    if (!ED.sinAplicar || !ED.sinAplicar.length) return '<p class="aviso oculto" id="fd-aviso"></p>';
    return '<p class="aviso" id="fd-aviso">Hay declaraciones guardadas en <code>calls.yaml</code> que todavía no entraron al índice: ' +
      ED.sinAplicar.map(function (c) { return '<button type="button" class="boton" data-acc="aplicar" data-cerebro="' + esc(c) + '">Reindexar ' + esc(c) + "</button>"; }).join(" ") + "</p>";
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
    var que = '<p class="aviso">Estos archivos no tienen puntaje: el índice no encontró en ellos ninguna relación para medir, así que no se puede decir cuánto los entendió. No cuentan como 100 ni como 0 y no entran al promedio. ' +
      "Si en alguno hay código que debería haberse leído, se enseña con un extractor (<code>flowbrain coverage --guide</code>).</p>";
    if (!xs.length) {
      return que + '<p class="aviso">Ningún archivo de fidelidad incierta coincide con los filtros. Hay ' + plural(INC.length, "archivo", "archivos") + ' en total. <button type="button" class="boton" data-acc="limpiar">Quitar filtros</button></p>';
    }
    var visibles = xs.slice(0, S.ver);
    return que + '<div class="fd-cab"><p class="subtitulo">' + plural(xs.length, "archivo", "archivos") + " de fidelidad incierta: " + conCodigo.toLocaleString("es") + " con código pero sin relaciones, " + (xs.length - conCodigo).toLocaleString("es") + " donde el índice no vio nada</p></div>" +
      '<ul class="lista fd-lista">' + visibles.map(function (x) {
        var p = partes(x), c = cerebroDe(x);
        return '<li class="fd-fila"><span class="fd-p fd-inc" title="Fidelidad incierta">?</span>' +
          '<div class="fd-cuerpo"><div class="fd-ruta"><code>' + esc(p.ruta) + "</code>" + (p.repo ? " <small>" + esc(p.repo) + "</small>" : "") + "</div>" +
          '<div class="chips">' + (c && CEREBROS.length > 1 ? '<span class="chip">' + esc(c) + "</span>" : "") + '<span class="chip">' + esc(x.l) + '</span><span class="capa capa-' + esc(x.k) + '">' + esc(CAPA[x.k] || x.k) + "</span>" +
          x.f.map(function (id) { return '<a class="chip" href="#/f/' + encodeURIComponent(id) + '">' + esc(nombreFeat(id)) + "</a>"; }).join("") + "</div>" +
          '<p class="fd-nota">' + POR_QUE[x.m] + "</p></div></li>";
      }).join("") + "</ul>" +
      (xs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="btn" data-acc="mas">Mostrar ' + Math.min(PASO, xs.length - visibles.length) + " más</button> <small>" + plural(visibles.length, "visible", "visibles") + " de " + xs.length.toLocaleString("es") + "</small></p>" : "");
  }
  function lista() {
    if (S.grupo === "incierta") return listaIncierta();
    var xs = filtradas(), activos = filtrosActivos();
    if (!xs.length) {
      return planDeLista() + '<p class="aviso">Ningún archivo coincide con ' + activos.map(esc).join(", ") + ". " +
        "Hay " + plural(filas.length, "archivo medido", "archivos medidos") + ' en total. <button type="button" class="boton" data-acc="limpiar">Quitar filtros</button></p>';
    }
    var visibles = xs.slice(0, S.ver);
    return planDeLista() + '<div class="fd-cab"><p class="subtitulo">' + (activos.length ? plural(xs.length, "archivo coincide", "archivos coinciden") + " (" + activos.map(esc).join(", ") + ") · promedio " + promedio(xs) : plural(xs.length, "archivo", "archivos") + " · promedio " + promedio(xs)) + "</p>" +
      '<div class="fd-acc"><button type="button" class="boton" data-acc="orden">' + (S.orden === "asc" ? "De menor a mayor" : "De mayor a menor") + "</button>" +
      (activos.length ? '<button type="button" class="boton" data-acc="limpiar">Quitar filtros</button>' : "") + "</div></div>" +
      '<ul class="lista fd-lista">' + visibles.map(fila).join("") + "</ul>" +
      (xs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="btn" data-acc="mas">Mostrar ' + Math.min(PASO, xs.length - visibles.length) + " más</button> <small>" + plural(visibles.length, "visible", "visibles") + " de " + xs.length.toLocaleString("es") + "</small></p>" : "");
  }

  // ---------- Página ----------
  var COMO = '<p class="subtitulo">Cuánto de cada archivo quedó unido en el grafo, de 0 a 100. Solo se mide donde hay algo que medir: el resto queda en Fidelidad incierta. En cada fila, la cadena muestra qué eslabón se entendió, dónde se corta y qué no aplica; debajo, qué falta y qué hacer.</p>' +
    '<p class="fd-leyenda"><span class="fd-es ok">Entendido</span><span class="fd-es no">Ahí se corta</span><span class="fd-es na">No aplica</span></p>';
  function pintarLista() { elem("fd-lista").innerHTML = lista(); }
  function pintarTodo() {
    if (!F) {
      raiz.innerHTML = "<h1>Fidelidad</h1>" + '<p class="aviso">No hay índice de código, así que no hay archivos para medir. La fidelidad sale de lo que deja <code>flowbrain index</code> en <code>_build/files</code> y <code>_build/extraction</code>: corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code>.</p>';
      return;
    }
    if (!filas.length && !INC.length) {
      raiz.innerHTML = "<h1>Fidelidad</h1>" + '<p class="aviso">El índice no encontró ningún archivo para medir. Corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code>.</p>';
      return;
    }
    if (S.grupo === "incierta" && !INC.length) S.grupo = "";
    var sin = INC.length && S.grupo !== "incierta" ? '<p class="aviso">' + plural(INC.length, "archivo tiene fidelidad incierta", "archivos tienen fidelidad incierta") + ': no hay en ellos ninguna relación para medir, así que no llevan puntaje ni entran al promedio. <button type="button" class="boton" data-grupo="incierta">Verlos</button></p>' : "";
    raiz.innerHTML = "<h1>Fidelidad</h1>" + COMO + aviso(null) + cifras() + grupos() + herramientas() + '<div id="fd-lista">' + lista() + "</div>" + sin;
  }
  function refrescar(todo) { S.ver = PASO; PL.copiado = false; guardar(); if (todo) pintarTodo(); else pintarLista(); }
  var entero = function (v, def, min, max) { var n = parseInt(v, 10); return isNaN(n) ? def : Math.min(max, Math.max(min, n)); };

  raiz.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc"), x = b.getAttribute("data-a") ? porArchivo(b.getAttribute("data-a")) : abierto ? porArchivo(abierto.a) : null;
    if (acc === "limpiar") { var mas = S.mas; S = inicial(); S.mas = mas; guardar(); pintarTodo(); return; }
    if (acc === "mas-filtros") { S.mas = !S.mas; guardar(); pintarTodo(); return; }
    if (acc === "plan") { PL.abierto = !PL.abierto; PL.copiado = false; pintarTodo(); return; }
    if (acc === "copiar-plan") { copiar(valor("fd-pl-texto") || textoDelPlan(filtradas(), (function () { var q = {}; ORDEN_SIGNAL.forEach(function (s) { q[s] = PL.signals[s] !== false; }); return q; })(), PL.limite), function (ok) { PL.copiado = ok ? true : "no"; pintarLista(); }); return; }
    if (acc === "pedido") {
      if (PEDIDO && PEDIDO.a === x.a) { PEDIDO = null; pintarLista(); return; }
      PEDIDO = { a: x.a, copiado: false }; pintarLista();
      copiar(textoDelPlan([x], null, 1), function (ok) { if (PEDIDO && PEDIDO.a === x.a) { PEDIDO.copiado = ok ? true : "no"; pintarLista(); } });
      return;
    }
    if (acc === "resolver") { resolver(x.a, b.getAttribute("data-que")); return; }
    if (acc === "recargar") { guardar(); location.reload(); return; }
    if (acc === "aplicar") { aplicar(b.getAttribute("data-cerebro")); return; }
    if (acc === "declarar-http") { var lh = Number(b.getAttribute("data-linea")); enviar(x, { tipo: "http", linea: lh, metodo: b.getAttribute("data-metodo"), ruta: valor("fd-h-r-" + lh) }); return; }
    if (acc === "declarar-llamada") { var ll = Number(b.getAttribute("data-linea")); enviar(x, { tipo: "llamada", linea: ll, hacia: b.getAttribute("data-hacia") || valor("fd-l-" + ll) }); return; }
    if (acc === "orden") { S.orden = S.orden === "asc" ? "desc" : "asc"; refrescar(false); return; }
    if (acc === "mas") { S.ver += PASO; pintarLista(); return; }
    if (b.hasAttribute("data-grupo")) { S.grupo = b.getAttribute("data-grupo"); refrescar(true); return; }
    // Las barras prenden y apagan su filtro.
    if (b.hasAttribute("data-min")) {
      var a = Number(b.getAttribute("data-min")), z = Number(b.getAttribute("data-max")), ya = S.min === a && S.max === z;
      S.min = ya ? 0 : a; S.max = ya ? 100 : z; refrescar(true);
    } else if (b.hasAttribute("data-cerebro")) { S.cerebro = S.cerebro === b.getAttribute("data-cerebro") ? "" : b.getAttribute("data-cerebro"); refrescar(true); }
    else if (b.hasAttribute("data-signal")) { S.signal = S.signal === b.getAttribute("data-signal") ? "" : b.getAttribute("data-signal"); refrescar(true); }
  });
  raiz.addEventListener("change", function (ev) {
    var id = ev.target.id || "";
    if (id === "fd-min") { S.min = entero(ev.target.value, 0, 0, 100); if (S.min > S.max) S.max = S.min; refrescar(true); }
    else if (id === "fd-max") { S.max = entero(ev.target.value, 100, 0, 100); if (S.max < S.min) S.min = S.max; refrescar(true); }
    else if (id === "fd-cerebro") { S.cerebro = ev.target.value; refrescar(true); }
    else if (id === "fd-lenguaje") { S.lenguaje = ev.target.value; refrescar(true); }
    else if (id === "fd-capa") { S.capa = ev.target.value; refrescar(true); }
    else if (id === "fd-feat") { S.feat = ev.target.value; refrescar(true); }
    else if (id === "fd-signal") { S.signal = ev.target.value; refrescar(true); }
    else if (id === "fd-pl-n") { PL.limite = entero(ev.target.value, 40, 1, 500); PL.copiado = false; pintarLista(); }
    else if (id.indexOf("fd-pl-s-") === 0) { PL.signals[id.slice(8)] = !!ev.target.checked; PL.copiado = false; pintarLista(); }
  });
  raiz.addEventListener("input", function (ev) { if (ev.target.id === "fd-q") { S.q = ev.target.value; refrescar(false); } });

  window.brainFidelidad = { mostrar: pintarTodo };
})();
`;

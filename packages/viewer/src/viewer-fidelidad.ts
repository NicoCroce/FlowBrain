/**
 * "Fidelidad" (`#/fidelidad`): qué tan entendido quedó cada archivo por el índice, de 0 a 100, y qué le falta. Arriba,
 * el reparto por tramos, por cerebro y por señal (cada barra filtra); abajo, la lista de menor a mayor, con filtros por
 * rango, cerebro, tipo de archivo, capa, funcionalidad y señal. Un vacío siempre dice por qué está vacío.
 * Servida por `flowbrain viewer --serve` (que deja `window.FLOWBRAIN_EDICION` con el token), cada archivo con faltas se
 * puede corregir ahí mismo; abierta como archivo, es de solo lectura y lo dice.
 * JavaScript plano dentro de `String.raw`: sin backticks ni `${`.
 */
export const FIDELIDAD_JS = String.raw`
(function () {
  "use strict";
  var V = window.brainVisor, D = V.D, porId = V.porId, esc = V.esc;
  var raiz = document.getElementById("fidelidad");
  var F = D.fidelidad, CEREBROS = D.cerebros || [];
  var filas = F ? F.archivos : [];
  var SEÑAL = { llamadas: "Llamadas entre métodos", http: "Llamadas HTTP", datos: "Accesos a tablas", entradas: "Recorrido de endpoints", contrato: "Tipo de respuesta", pantallas: "Pantallas con llamadas", funcionalidad: "Funcionalidad asignada" };
  var MIDE = {
    llamadas: "llamadas que el índice pudo atribuir a su destino",
    http: "llamadas HTTP unidas a un endpoint o a un externo",
    datos: "accesos a tablas con página y columnas",
    entradas: "endpoints cuyo recorrido llega a una tabla, un servicio o una cola",
    contrato: "endpoints con tipo de respuesta",
    pantallas: "pantallas desde las que se llega a una llamada HTTP",
    funcionalidad: "archivos que pertenecen a una funcionalidad o librería"
  };
  var ORDEN_SEÑAL = ["llamadas", "http", "datos", "entradas", "contrato", "pantallas", "funcionalidad"];
  var CAPA = { entrada: "Entrada", logica: "Lógica", dominio: "Dominio", datos: "Datos", interfaz: "Interfaz", otros: "Otros" };
  var TRAMOS = [[0, 19], [20, 39], [40, 59], [60, 79], [80, 99], [100, 100]];
  var NINGUNA = "__ninguna";
  var PASO = 100;
  var inicial = function () { return { min: 0, max: 100, cerebro: "", lenguaje: "", capa: "", feat: "", senal: "", q: "", orden: "asc", ver: PASO }; };
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
  var abierto = null, DET = null, MSG = null, ocupado = false;

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

  function coincide(x) {
    if (x.p < S.min || x.p > S.max) return false;
    if (S.cerebro !== "" && String(x.c) !== S.cerebro) return false;
    if (S.lenguaje && x.l !== S.lenguaje) return false;
    if (S.capa && x.k !== S.capa) return false;
    if (S.feat === NINGUNA ? x.f.length : S.feat && x.f.indexOf(S.feat) < 0) return false;
    if (S.senal) { var v = x.s[S.senal]; if (!v || v[0] >= v[1]) return false; }
    if (S.q) {
      var q = S.q.trim().toLowerCase();
      if (q && x.a.toLowerCase().indexOf(q) < 0 && !x.x.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; })) return false;
    }
    return true;
  }
  function filtradas() {
    var out = filas.filter(coincide);
    out.sort(function (a, b) { return (S.orden === "asc" ? a.p - b.p : b.p - a.p) || b.x.length - a.x.length || (a.a < b.a ? -1 : 1); });
    return out;
  }
  // Lo que hay puesto, en palabras: para decir por qué una lista quedó vacía.
  function filtrosActivos() {
    var out = [];
    if (S.min > 0 || S.max < 100) out.push("puntaje de " + S.min + " a " + S.max);
    if (S.cerebro !== "") out.push("cerebro " + CEREBROS[Number(S.cerebro)].nombre);
    if (S.lenguaje) out.push("tipo " + S.lenguaje);
    if (S.capa) out.push("capa " + (CAPA[S.capa] || S.capa));
    if (S.feat) out.push(S.feat === NINGUNA ? "sin funcionalidad" : "funcionalidad " + nombreFeat(S.feat));
    if (S.senal) out.push("le falta: " + SEÑAL[S.senal]);
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
    var señales = ORDEN_SEÑAL.map(function (s) {
      var ok = 0, total = 0, conFalta = 0;
      filas.forEach(function (x) { var v = x.s[s]; if (!v) return; ok += v[0]; total += v[1]; if (v[0] < v[1]) conFalta++; });
      if (!total) return "";
      var pct = Math.round((1000 * ok) / total) / 10;
      return barra(SEÑAL[s], pct, pct, pct + "% · " + (conFalta ? plural(conFalta, "archivo con falta", "archivos con falta") : "sin faltas"), 'data-senal="' + s + '" aria-label="' + esc(SEÑAL[s] + ": " + MIDE[s]) + '"', S.senal === s);
    }).join("");
    return '<div class="fd-graficos">' +
      '<section><h2>Reparto por puntaje</h2><div class="fd-barras">' + reparto + "</div></section>" +
      (porCerebro ? '<section><h2>Por cerebro</h2><div class="fd-barras">' + porCerebro + "</div></section>" : "") +
      '<section><h2>Qué se entendió, por señal</h2><div class="fd-barras">' + señales + "</div></section>" +
      "</div>";
  }
  function cifras() {
    var p = promedio(filas), completos = filas.filter(function (x) { return x.p === 100; }).length;
    var cifra = function (valor, texto, color) { return '<div class="fd-cifra"><b' + (color ? ' style="color:' + color + '"' : "") + ">" + valor + "</b><span>" + texto + "</span></div>"; };
    return '<div class="fd-cifras">' + cifra(p, "puntaje promedio", tono(p)) + cifra(filas.length.toLocaleString("es"), "archivos medidos") +
      cifra(completos.toLocaleString("es"), "en 100") + cifra((filas.length - completos).toLocaleString("es"), "con algo por completar") + cifra(F.sinDatos.toLocaleString("es"), "sin puntaje") + "</div>";
  }

  // ---------- Filtros ----------
  function opciones(valores, actual, etiqueta) {
    return valores.map(function (v) { return '<option value="' + esc(v[0]) + '"' + (String(v[0]) === actual ? " selected" : "") + ">" + esc(v[1]) + (v[2] !== undefined ? " (" + v[2] + ")" : "") + "</option>"; }).join("");
  }
  function contar(clave) {
    var m = {};
    filas.forEach(function (x) { var ks = clave(x); ks.forEach(function (k) { m[k] = (m[k] || 0) + 1; }); });
    return m;
  }
  function filtros() {
    var lengs = contar(function (x) { return [x.l]; }), capas = contar(function (x) { return [x.k]; }), feats = contar(function (x) { return x.f; });
    var sinFeat = filas.filter(function (x) { return !x.f.length; }).length;
    var porCantidad = function (m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }); };
    var campo = function (id, etiqueta, html) { return '<label class="fd-campo" for="' + id + '"><span class="lbl">' + etiqueta + "</span>" + html + "</label>"; };
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
      campo("fd-senal", "Le falta", sel("fd-senal", "Cualquier cosa", ORDEN_SEÑAL.map(function (s) { return [s, SEÑAL[s]]; }), S.senal)) +
      campo("fd-q", "Buscar", '<input id="fd-q" type="search" placeholder="Ruta o texto de la falta" autocomplete="off" value="' + esc(S.q) + '">') +
      "</div>";
  }

  // ---------- Lista ----------
  function fila(x) {
    var p = partes(x), c = cerebroDe(x);
    var señales = ORDEN_SEÑAL.filter(function (s) { return x.s[s]; }).map(function (s) {
      var v = x.s[s], ok = v[0] >= v[1];
      return '<span class="fd-s' + (ok ? "" : " falta") + '" title="' + esc(MIDE[s]) + '">' + esc(SEÑAL[s]) + " " + v[0] + "/" + v[1] + "</span>";
    }).join("");
    return '<li class="fd-fila">' +
      '<span class="fd-p" style="color:' + tono(x.p) + ";border-color:" + tono(x.p) + '">' + x.p + "</span>" +
      '<div class="fd-cuerpo"><div class="fd-ruta"><code>' + esc(p.ruta) + "</code>" + (p.repo ? " <small>" + esc(p.repo) + "</small>" : "") + "</div>" +
      '<div class="chips">' + (c && CEREBROS.length > 1 ? '<span class="chip">' + esc(c) + "</span>" : "") + '<span class="chip">' + esc(x.l) + '</span><span class="capa capa-' + esc(x.k) + '">' + esc(CAPA[x.k] || x.k) + "</span>" +
      (x.f.length ? x.f.map(function (id) { return '<a class="chip" href="#/f/' + encodeURIComponent(id) + '">' + esc(nombreFeat(id)) + "</a>"; }).join("") : '<span class="chip fd-sinfeat">sin funcionalidad</span>') + "</div>" +
      '<div class="fd-señales">' + señales + "</div>" +
      (x.x.length ? '<ul class="fd-faltas">' + x.x.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : '<p class="fd-ok">Sin faltas: todo lo que el índice vio acá quedó unido.</p>') +
      (ED && x.x.length ? '<div><button type="button" class="boton' + (abierto === x.a ? " on" : "") + '" data-acc="editar" data-a="' + esc(x.a) + '">' + (abierto === x.a ? "Cerrar" : "Corregir") + "</button></div>" + (abierto === x.a ? panel(x) : "") : "") +
      "</div></li>";
  }

  // ---------- Edición ----------
  var METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  var idServidor = function (x) { var p = partes(x); return p.repo + ":" + p.ruta; };
  var porArchivo = function (a) { for (var i = 0; i < filas.length; i++) if (filas[i].a === a) return filas[i]; return null; };
  function pedir(metodo, ruta, cuerpo) {
    return fetch(ruta, { method: metodo, headers: cuerpo ? { "content-type": "application/json", "x-flowbrain-token": ED.token } : { "x-flowbrain-token": ED.token }, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "el servidor respondió " + r.status); return j; }); });
  }
  function panel(x) {
    if (!DET) return '<div class="fd-ed"><p class="vacio">' + (MSG ? esc(MSG.texto) : "Leyendo el archivo…") + "</p></div>";
    var falta = function (s) { var v = x.s[s]; return !!v && v[0] < v[1]; };
    var html = "";
    if (falta("funcionalidad")) {
      html += '<section><h4>Sumarlo a una funcionalidad</h4>' + (DET.funcionalidades.length
        ? '<div class="fd-linea"><select id="fd-e-feat" aria-label="Funcionalidad">' + DET.funcionalidades.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.nombre) + "</option>"; }).join("") + "</select>" +
          '<select id="fd-e-entrada" aria-label="Qué sumar">' + DET.entradas.map(function (e, i) { return '<option value="' + esc(e) + '">' + (i ? "toda la carpeta " : "solo este archivo: ") + esc(e.slice(e.indexOf(":") + 1)) + "</option>"; }).join("") + "</select>" +
          '<button type="button" class="boton" data-acc="sumar">Sumar</button></div><p class="fd-nota">Se escribe en el <code>codigo</code> de la página de esa funcionalidad y el cerebro se recompila.</p>'
        : '<p class="fd-nota">El cerebro ' + esc(DET.cerebro) + " no tiene funcionalidades con página todavía: se crean con <code>/flowbrain-features</code>.</p>") + "</section>";
    }
    if (DET.http.length) {
      html += "<section><h4>Llamadas HTTP sin ruta</h4>" + DET.http.map(function (h) {
        if (!h.desde) return '<p class="fd-nota">L' + h.linea + ": no está dentro de una función con rango; se enseña con un extractor (<code>flowbrain coverage --guide</code>).</p>";
        return '<div class="fd-linea"><span class="fd-donde">L' + h.linea + " · " + esc(h.desde) + '</span><select id="fd-h-m-' + h.linea + '" aria-label="Método">' + METODOS.map(function (m) { return "<option" + (m === h.metodo ? " selected" : "") + ">" + m + "</option>"; }).join("") + "</select>" +
          '<input id="fd-h-r-' + h.linea + '" type="search" placeholder="/pedidos/{id}" aria-label="Ruta" autocomplete="off">' +
          '<button type="button" class="boton" data-acc="declarar-http" data-linea="' + h.linea + '">Declarar</button></div>';
      }).join("") + "</section>";
    }
    if (DET.llamadas.length) {
      html += "<section><h4>Llamadas sin resolver</h4>" + DET.llamadas.map(function (l) {
        var destino = l.candidatos.length
          ? '<select id="fd-l-' + l.linea + '" aria-label="A qué método va">' + l.candidatos.map(function (k) { var i = k.lastIndexOf("#"); return '<option value="' + esc(k) + '">' + esc(k.slice(i + 1)) + " · " + esc(k.slice(k.indexOf(":") + 1, i)) + "</option>"; }).join("") + "</select>"
          : '<input id="fd-l-' + l.linea + '" type="search" placeholder="repo:ruta/Archivo.ext#Clase.metodo" aria-label="A qué método va" autocomplete="off">';
        return '<div class="fd-linea"><span class="fd-donde">L' + l.linea + " · " + esc(l.desde) + " llama <code>" + esc(l.llamada) + "</code></span>" + destino +
          '<button type="button" class="boton" data-acc="declarar-llamada" data-linea="' + l.linea + '">Declarar</button></div>';
      }).join("") + '<p class="fd-nota">Se escriben en <code>calls.yaml</code> y entran al índice al reindexar el cerebro.</p></section>';
    }
    if (falta("datos") || falta("entradas") || falta("contrato") || falta("pantallas")) {
      html += '<section><p class="fd-nota">Lo demás (columnas de una tabla, recorrido o tipo de respuesta de un endpoint, pantallas sin llamadas) no se corrige con un formulario: se enseña con un extractor. Las instrucciones salen de <code>flowbrain coverage --guide</code>.</p></section>';
    }
    return '<div class="fd-ed">' + (html || '<p class="fd-nota">Nada de lo que le falta a este archivo se corrige desde acá.</p>') +
      (MSG ? '<p class="fd-msg' + (MSG.error ? " error" : "") + '">' + esc(MSG.texto) + (MSG.aplicar ? ' <button type="button" class="boton" data-acc="aplicar" data-cerebro="' + esc(MSG.aplicar) + '">Reindexar ' + esc(MSG.aplicar) + " ahora</button>" : "") + (MSG.recargar ? ' <button type="button" class="boton" data-acc="recargar">Ver el puntaje nuevo</button>' : "") + "</p>" : "") + "</div>";
  }
  function abrir(a) {
    if (abierto === a) { abierto = null; DET = null; MSG = null; pintarLista(); return; }
    abierto = a; DET = null; MSG = null; pintarLista();
    var x = porArchivo(a);
    pedir("GET", "/api/archivo?cerebro=" + encodeURIComponent(cerebroDe(x)) + "&archivo=" + encodeURIComponent(idServidor(x)))
      .then(function (d) { if (abierto === a) { DET = d; pintarLista(); } })
      .catch(function (e) { if (abierto === a) { MSG = { texto: "No se pudo leer el archivo: " + e.message, error: true }; pintarLista(); } });
  }
  function enviar(cuerpo) {
    if (ocupado) return;
    var x = porArchivo(abierto);
    cuerpo.cerebro = cerebroDe(x); cuerpo.archivo = idServidor(x);
    ocupado = true; MSG = { texto: "Guardando…" }; pintarLista();
    pedir("POST", "/api/editar", cuerpo).then(function (r) {
      ocupado = false;
      ED.sinAplicar = r.sinAplicar || [];
      MSG = { texto: r.mensaje + " (" + r.escrito + ")", aplicar: r.faltaReindexar ? cuerpo.cerebro : null, recargar: r.cambio && !r.faltaReindexar };
      pintarLista();
    }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; pintarLista(); });
  }
  function aplicar(cerebro) {
    if (ocupado) return;
    ocupado = true; MSG = { texto: "Reindexando " + cerebro + "… puede tardar unos segundos." }; pintarLista(); pintarAviso("Reindexando " + cerebro + "…");
    pedir("POST", "/api/aplicar", { cerebro: cerebro }).then(function (r) {
      ocupado = false;
      if (r.errores.length) { MSG = { texto: "El cerebro se reindexó con errores: " + r.errores.join("; "), error: true }; pintarLista(); pintarAviso(null); return; }
      guardar(); location.reload();
    }).catch(function (e) { ocupado = false; MSG = { texto: e.message, error: true }; pintarLista(); pintarAviso(null); });
  }
  var valor = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
  // Lo que se declaró y todavía no entró al índice: se dice arriba, con el botón para aplicarlo.
  function aviso(texto) {
    if (!ED) return '<p class="aviso" id="fd-aviso">Esta página es de solo lectura. Para corregir lo que falta desde acá, abrila con <code>flowbrain viewer --serve</code>.</p>';
    if (texto) return '<p class="aviso" id="fd-aviso">' + esc(texto) + "</p>";
    if (!ED.sinAplicar || !ED.sinAplicar.length) return '<p class="aviso oculto" id="fd-aviso"></p>';
    return '<p class="aviso" id="fd-aviso">Hay declaraciones guardadas en <code>calls.yaml</code> que todavía no entraron al índice: ' +
      ED.sinAplicar.map(function (c) { return '<button type="button" class="boton" data-acc="aplicar" data-cerebro="' + esc(c) + '">Reindexar ' + esc(c) + "</button>"; }).join(" ") + "</p>";
  }
  function pintarAviso(texto) { var e = document.getElementById("fd-aviso"); if (e && e.outerHTML !== undefined) e.outerHTML = aviso(texto); }
  function lista() {
    var xs = filtradas(), activos = filtrosActivos();
    if (!xs.length) {
      return '<p class="aviso">Ningún archivo coincide con ' + activos.map(esc).join(", ") + ". " +
        "Hay " + plural(filas.length, "archivo medido", "archivos medidos") + ' en total. <button type="button" class="boton" data-acc="limpiar">Quitar filtros</button></p>';
    }
    var visibles = xs.slice(0, S.ver);
    return '<div class="fd-cab"><p class="subtitulo">' + (activos.length ? plural(xs.length, "archivo coincide", "archivos coinciden") + " (" + activos.map(esc).join(", ") + ") · promedio " + promedio(xs) : plural(xs.length, "archivo", "archivos") + " · promedio " + promedio(xs)) + "</p>" +
      '<div class="fd-acc"><button type="button" class="boton" data-acc="orden">' + (S.orden === "asc" ? "De menor a mayor" : "De mayor a menor") + "</button>" +
      (activos.length ? '<button type="button" class="boton" data-acc="limpiar">Quitar filtros</button>' : "") + "</div></div>" +
      '<ul class="lista fd-lista">' + visibles.map(fila).join("") + "</ul>" +
      (xs.length > visibles.length ? '<p class="fd-mas"><button type="button" class="btn" data-acc="mas">Mostrar ' + Math.min(PASO, xs.length - visibles.length) + " más</button> <small>" + plural(visibles.length, "visible", "visibles") + " de " + xs.length.toLocaleString("es") + "</small></p>" : "");
  }

  // ---------- Página ----------
  var COMO = "<p class=\"subtitulo\">De lo que el índice vio en cada archivo, qué parte quedó entendida. Cada señal cuenta solo donde aplica; un archivo llega a 100 cuando no le falta nada. Tocá una barra para filtrar.</p>";
  function pintarLista() { document.getElementById("fd-lista").innerHTML = lista(); }
  function pintarTodo() {
    if (!F) {
      raiz.innerHTML = "<h1>Fidelidad</h1>" + '<p class="aviso">No hay índice de código, así que no hay archivos para medir. La fidelidad sale de lo que deja <code>flowbrain index</code> en <code>_build/files</code> y <code>_build/extraction</code>: corré <code>flowbrain index</code> sobre cada repo y después <code>flowbrain compile</code>.</p>';
      return;
    }
    var sin = F.sinDatos ? '<p class="aviso">' + plural(F.sinDatos, "archivo no tiene puntaje", "archivos no tienen puntaje") + ": el índice no encontró símbolos, llamadas ni accesos en ellos (configuración, datos, o un lenguaje que ningún parser lee). No cuentan como 0 ni como 100." +
      (F.ejemplosSinDatos.length ? " Por ejemplo: " + F.ejemplosSinDatos.map(function (a) { return "<code>" + esc(a) + "</code>"; }).join(", ") + "." : "") + " Si hay código ahí, se enseña con un extractor.</p>" : "";
    if (!filas.length) {
      raiz.innerHTML = "<h1>Fidelidad</h1>" + '<p class="aviso">El índice no midió ningún archivo.</p>' + sin;
      return;
    }
    raiz.innerHTML = "<h1>Fidelidad</h1>" + COMO + aviso(null) + cifras() + graficos() + filtros() + '<div id="fd-lista">' + lista() + "</div>" + sin;
  }
  function refrescar(todo) { S.ver = PASO; guardar(); if (todo) pintarTodo(); else pintarLista(); }
  var entero = function (v, def) { var n = parseInt(v, 10); return isNaN(n) ? def : Math.min(100, Math.max(0, n)); };

  raiz.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    var acc = b.getAttribute("data-acc");
    if (acc === "limpiar") { S = inicial(); guardar(); pintarTodo(); return; }
    if (acc === "editar") { abrir(b.getAttribute("data-a")); return; }
    if (acc === "recargar") { guardar(); location.reload(); return; }
    if (acc === "aplicar") { aplicar(b.getAttribute("data-cerebro")); return; }
    if (acc === "sumar") { enviar({ tipo: "funcionalidad", funcionalidad: valor("fd-e-feat"), entrada: valor("fd-e-entrada") }); return; }
    if (acc === "declarar-http") { var lh = Number(b.getAttribute("data-linea")); enviar({ tipo: "http", linea: lh, metodo: valor("fd-h-m-" + lh), ruta: valor("fd-h-r-" + lh) }); return; }
    if (acc === "declarar-llamada") { var ll = Number(b.getAttribute("data-linea")); enviar({ tipo: "llamada", linea: ll, hacia: valor("fd-l-" + ll) }); return; }
    if (acc === "orden") { S.orden = S.orden === "asc" ? "desc" : "asc"; refrescar(false); return; }
    if (acc === "mas") { S.ver += PASO; pintarLista(); return; }
    // Las barras prenden y apagan su filtro.
    if (b.hasAttribute("data-min")) {
      var a = Number(b.getAttribute("data-min")), z = Number(b.getAttribute("data-max")), ya = S.min === a && S.max === z;
      S.min = ya ? 0 : a; S.max = ya ? 100 : z; refrescar(true);
    } else if (b.hasAttribute("data-cerebro")) { S.cerebro = S.cerebro === b.getAttribute("data-cerebro") ? "" : b.getAttribute("data-cerebro"); refrescar(true); }
    else if (b.hasAttribute("data-senal")) { S.senal = S.senal === b.getAttribute("data-senal") ? "" : b.getAttribute("data-senal"); refrescar(true); }
  });
  raiz.addEventListener("change", function (ev) {
    var id = ev.target.id;
    if (id === "fd-min") { S.min = entero(ev.target.value, 0); if (S.min > S.max) S.max = S.min; refrescar(true); }
    else if (id === "fd-max") { S.max = entero(ev.target.value, 100); if (S.max < S.min) S.min = S.max; refrescar(true); }
    else if (id === "fd-cerebro") { S.cerebro = ev.target.value; refrescar(true); }
    else if (id === "fd-lenguaje") { S.lenguaje = ev.target.value; refrescar(false); }
    else if (id === "fd-capa") { S.capa = ev.target.value; refrescar(false); }
    else if (id === "fd-feat") { S.feat = ev.target.value; refrescar(false); }
    else if (id === "fd-senal") { S.senal = ev.target.value; refrescar(true); }
  });
  raiz.addEventListener("input", function (ev) { if (ev.target.id === "fd-q") { S.q = ev.target.value; refrescar(false); } });

  window.brainFidelidad = { mostrar: pintarTodo };
})();
`;

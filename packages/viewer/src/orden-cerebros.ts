/**
 * En qué vértice del polígono va cada cerebro, para que las líneas entre cerebros no se crucen.
 *
 * JavaScript plano dentro de `String.raw` (sin backticks ni `${`): lo usa el mapa 3D en el navegador y los tests lo
 * evalúan con `new Function`.
 *
 * Con los cerebros en los vértices de un polígono convexo, dos líneas (a-b) y (c-d) se cruzan si y solo si sus extremos
 * se alternan en el recorrido del polígono. Se prueban todas las asignaciones con el primer cerebro fijo en el vértice 0
 * (el del fondo): con el tope de 8 cerebros son 5.040. Gana la que menos cruces tiene, contando cada par de cruces por
 * cuántas llamadas lleva cada línea; a igual cruce, la que deja más cerca (en vértices) a los cerebros que más se
 * hablan; a igual distancia, la primera en orden, así el resultado es siempre el mismo.
 */
export const ORDEN_CEREBROS_JS = String.raw`
function ordenSinCruces(nc, pares) {
  var identidad = [];
  for (var i = 0; i < nc; i++) identidad.push(i);
  if (nc < 4) return identidad;
  // Peso de cada par de cerebros: cuántas relaciones van entre ellos, en cualquier sentido.
  var peso = {}, lineas = [];
  pares.forEach(function (p) {
    var a = Math.min(p[0], p[1]), b = Math.max(p[0], p[1]);
    if (a === b || a < 0 || b >= nc) return;
    var k = a + "-" + b;
    if (!peso[k]) { peso[k] = 0; lineas.push([a, b]); }
    peso[k]++;
  });
  lineas.forEach(function (l) { l.push(peso[l[0] + "-" + l[1]]); });
  if (lineas.length < 2) return identidad;
  var adentro = function (x, p, q) { return p < x && x < q; };
  var costo = function (slot) {
    var cruces = 0, largo = 0;
    for (var i = 0; i < lineas.length; i++) {
      var p = Math.min(slot[lineas[i][0]], slot[lineas[i][1]]), q = Math.max(slot[lineas[i][0]], slot[lineas[i][1]]);
      largo += lineas[i][2] * Math.min(q - p, nc - (q - p));
      for (var j = i + 1; j < lineas.length; j++) {
        var r = slot[lineas[j][0]], s = slot[lineas[j][1]];
        if (r === p || r === q || s === p || s === q) continue;
        if (adentro(r, p, q) !== adentro(s, p, q)) cruces += lineas[i][2] * lineas[j][2];
      }
    }
    return [cruces, largo];
  };
  var mejor = identidad.slice(), mejorCosto = costo(mejor);
  var slot = identidad.slice(), usado = [true];
  for (var u = 1; u < nc; u++) usado.push(false);
  // Cerebro c (desde el 1) en cada vértice libre, en orden: recorre las asignaciones en orden lexicográfico.
  var probar = function (c) {
    if (c === nc) {
      var k = costo(slot);
      if (k[0] < mejorCosto[0] || (k[0] === mejorCosto[0] && k[1] < mejorCosto[1])) { mejor = slot.slice(); mejorCosto = k; }
      return;
    }
    for (var v = 1; v < nc; v++) {
      if (usado[v]) continue;
      usado[v] = true; slot[c] = v;
      probar(c + 1);
      usado[v] = false;
    }
  };
  probar(1);
  return mejor;
}
`;

/**
 * Idioma del visor (dec. 214): inglés por defecto y castellano como segunda opción, con un switch EN/ES en la cabecera
 * que se guarda en este navegador (`localStorage`, `flowbrain.idioma`).
 *
 * Cada texto visible va en par: `L("Features", "Funcionalidades")`, inglés primero. `L` se evalúa al pintar, así que
 * cambiar de idioma no recarga los datos: se repinta lo estático (los elementos con `data-en`/`data-es`), corren los
 * `alCambiar` que cada pantalla registró (lo que arma una sola vez al cargar) y al final `repintar` (el router, que
 * vuelve a dibujar la pantalla abierta).
 *
 * Sin `window.brainI18n` (los tests que montan una pantalla sola) `L` devuelve el inglés.
 */

export type Idioma = "en" | "es";

const atributo = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Un texto estático de la página, en los dos idiomas: `<a ${dos("Features", "Funcionalidades")}</a>` deja los atributos y
 * el texto en inglés; el script lo cambia si el idioma guardado es castellano.
 */
export const dos = (en: string, es: string) => `data-en="${atributo(en)}" data-es="${atributo(es)}">${atributo(en)}`;

/** Atributos en dos idiomas (`placeholder`, `title`, `aria-label`): `${attr("placeholder", "Search…", "Buscar…")}`. */
export const attr = (nombre: "placeholder" | "title" | "aria-label", en: string, es: string) =>
  `${nombre}="${atributo(en)}" data-${nombre}-en="${atributo(en)}" data-${nombre}-es="${atributo(es)}"`;

/** El switch de la cabecera. */
export const SWITCH_IDIOMA = `<div id="idioma" class="idioma" role="group" aria-label="Language / Idioma"><button type="button" class="chip on" data-idioma="en" aria-pressed="true" title="English">EN</button><button type="button" class="chip" data-idioma="es" aria-pressed="false" title="Castellano">ES</button></div>`;

/** `window.brainI18n`: corre antes que cualquier pantalla. JavaScript plano dentro de `String.raw`: sin backticks ni `${`. */
export const IDIOMA_JS = String.raw`
(function () {
  "use strict";
  var CLAVE = "flowbrain.idioma";
  var guardado = null;
  try { guardado = typeof localStorage !== "undefined" ? localStorage.getItem(CLAVE) : null; } catch (e) { /* sin almacenamiento */ }
  var oyentes = [];
  var I = {
    lang: guardado === "es" ? "es" : "en",
    // El texto en el idioma actual: inglés primero.
    L: function (en, es) { return I.lang === "es" ? es : en; },
    num: function (n) { return Number(n).toLocaleString(I.lang === "es" ? "es" : "en"); },
    // Lo que una pantalla arma una sola vez al cargar y hay que rehacer al cambiar de idioma.
    alCambiar: function (fn) { oyentes.push(fn); },
    // El router (viewer-mapa) lo fija: vuelve a dibujar la pantalla abierta.
    repintar: null,
    aplicar: aplicar,
    cambiar: cambiar,
  };
  function aplicar(raiz) {
    var es = I.lang === "es";
    (raiz || document).querySelectorAll("[data-en]").forEach(function (el) { el.textContent = es ? el.getAttribute("data-es") : el.getAttribute("data-en"); });
    ["placeholder", "title", "aria-label"].forEach(function (a) {
      (raiz || document).querySelectorAll("[data-" + a + "-en]").forEach(function (el) { el.setAttribute(a, el.getAttribute("data-" + a + (es ? "-es" : "-en"))); });
    });
    document.querySelectorAll("#idioma [data-idioma]").forEach(function (b) {
      var on = b.getAttribute("data-idioma") === I.lang;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    document.documentElement.lang = I.lang;
  }
  function cambiar(nuevo) {
    if (nuevo !== "en" && nuevo !== "es") return;
    I.lang = nuevo;
    try { if (typeof localStorage !== "undefined") localStorage.setItem(CLAVE, nuevo); } catch (e) { /* sin almacenamiento */ }
    aplicar(document);
    oyentes.forEach(function (fn) { try { fn(nuevo); } catch (e) { if (typeof console !== "undefined") console.error(e); } });
    if (I.repintar) I.repintar();
  }
  window.brainI18n = I;
  if (typeof document !== "undefined" && document.querySelectorAll) {
    aplicar(document);
    var sw = document.getElementById("idioma");
    if (sw) sw.addEventListener("click", function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest("[data-idioma]") : null;
      if (b) cambiar(b.getAttribute("data-idioma"));
    });
  }
})();
`;

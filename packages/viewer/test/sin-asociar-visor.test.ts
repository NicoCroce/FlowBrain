import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import { cuentaAgente } from "./ayuda-agente.js";
import { SIN_ASOCIAR_JS } from "../src/viewer-sin-asociar.js";
import { FILTROS_JS } from "../src/viewer-filtros.js";
import { PEDIDO_JS } from "../src/viewer-pedido.js";

const DEL_PEDIDO = new Set(["panel", "etapa", "cerrar-panel", "quitar", "vaciar", "pedir-todos", "descargar-lista", "cancelar-lote", "cerrar-lote"]);

/** La pantalla Sin asociar, corrida con un DOM mínimo: qué agrupa, qué recomienda, qué dice cuando no hay nada y qué manda al asociar. */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
function montar(datos: Record<string, unknown>, opciones: { edicion?: unknown; lang?: "es"; confirmar?: (texto: string) => boolean; recargar?: () => void; local?: Map<string, string>; fetch?: (url: string, init: { method: string; body: string; headers: Record<string, string> }) => Promise<unknown> } = {}) {
  const guardado = new Map<string, string>();
  const sessionStorage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
  const local = opciones.local ?? new Map<string, string>();
  const localStorage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v) };
  const elementos = new Map<string, { innerHTML: string; value?: string; oyentes: Record<string, Oyente>; addEventListener(t: string, f: Oyente): void }>();
  const el = (id: string) => {
    if (!elementos.has(id)) {
      const e = { innerHTML: "", oyentes: {} as Record<string, Oyente>, addEventListener(t: string, f: Oyente) { e.oyentes[t] = f; } };
      elementos.set(id, e);
    }
    return elementos.get(id)!;
  };
  const porId: Record<string, { n: string }> = {};
  for (const n of (datos["nodes"] as Array<{ id: string; n: string }> | undefined) ?? []) porId[n.id] = n;
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const window = { brainVisor: { D: datos, porId, esc }, brainSinAsociar: null as null | { mostrar(): void }, FLOWBRAIN_EDICION: opciones.edicion, ...(opciones.confirmar ? { confirm: opciones.confirmar } : {}), ...(opciones.recargar ? { location: { reload: opciones.recargar } } : {}), ...(opciones.lang ? { brainI18n: { lang: opciones.lang } } : {}) };
  new Function("window", "document", "sessionStorage", FILTROS_JS)(window, { getElementById: el }, sessionStorage);
  // «Descargar .md»: el documento guarda lo que se baja.
  const bajados: Array<{ nombre: string; texto: () => Promise<string> }> = [];
  const documento = { getElementById: el, body: { appendChild() {}, removeChild() {} }, createElement: () => ({ href: "", download: "", click() { const h = this.href; bajados.push({ nombre: this.download, texto: () => resolveObjectURL(h)!.text() }); } }) };
  // El pedido al agente: el componente único del visor, con su panel (#pedido-panel) y su bandeja (#pedido-bandeja).
  new Function("window", "document", "localStorage", "fetch", PEDIDO_JS)(window, documento, localStorage, opciones.fetch);
  new Function("window", "document", "sessionStorage", "localStorage", "fetch", SIN_ASOCIAR_JS)(window, documento, sessionStorage, localStorage, opciones.fetch);
  const raiz = el("sinasociar");
  let html = "";
  Object.defineProperty(raiz, "innerHTML", {
    get: () => html,
    set: (v: string) => {
      html = v;
      const i = v.indexOf('<div id="sa-lista">');
      el("sa-lista").innerHTML = i < 0 ? "" : v.slice(i);
    },
  });
  window.brainSinAsociar!.mostrar();
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs }) });
  return {
    pagina: () => raiz.innerHTML,
    lista: () => el("sa-lista").innerHTML,
    panel: () => el("pedido-panel").innerHTML,
    panelAbierto: () => (el("pedido-panel") as unknown as { className: string }).className,
    bandeja: () => el("pedido-bandeja").innerHTML,
    carpetas: () => [...el("sa-lista").innerHTML.matchAll(/<h3><code>([^<]+)<\/code>/g)].map((m) => m[1]),
    archivos: () => [...el("sa-lista").innerHTML.matchAll(/<li class="sa-fila"><div class="sa-que"><code title="[^"]*">([^<]+)<\/code>/g)].map((m) => m[1]),
    cambiar: (id: string, value: string) => (id.startsWith("pedido-") ? el("pedido-panel") : raiz).oyentes["change"]!({ target: { id, value } }),
    escribir: (value: string) => raiz.oyentes["input"]!({ target: { id: "sa-q", value } }),
    // Los botones del pedido (panel y bandeja) son del componente; los demás, de la pantalla.
    tocar: (attrs: Record<string, string>) => (DEL_PEDIDO.has(attrs["data-acc"] ?? "") ? el(attrs["data-acc"] === "panel" ? "pedido-bandeja" : "pedido-panel") : raiz).oyentes["click"]!({ target: boton(attrs) }),
    poner: (id: string, value: string) => void (el(id).value = value),
    bajados,
  };
}

const W = "front/repo-web:";
const datos = () => ({
  cerebros: [{ nombre: "front" }, { nombre: "back" }],
  nodes: [
    { id: "front/feat-pagos", n: "Pagos", t: "feat", p: "product/feat-pagos.md", c: 0 },
    { id: "front/feat-envios", n: "Envíos", t: "feat", p: "product/feat-envios.md", c: 0 },
    { id: "back/feat-stock", n: "Stock", t: "feat", p: "product/feat-stock.md", c: 1 },
  ],
  funcionalidades: [{ id: "front/feat-pagos" }, { id: "front/feat-envios" }, { id: "back/feat-stock" }],
  sinAsociar: [
    // g: [id, motivo en inglés, confianza, señales]; o: [id, motivo, señales]. moneda.ts viene sin señales ni confianza (datos de antes).
    { a: `${W}src/shared/dinero.ts`, l: "ts", k: "otros", g: ["front/feat-pagos", "imported by 2 files of Pagos", "alta", [["lo_usan", 2]]], o: [["front/feat-envios", "imports 1 file of Envíos", [["usa", 1]]]], cl: 1, c: 0 },
    { a: `${W}src/shared/moneda.ts`, l: "ts", k: "otros", g: ["front/feat-pagos", "lo importa 1 archivo de Pagos"], cl: 1, c: 0 },
    { a: `${W}src/shared/fecha.ts`, l: "ts", k: "otros", m: 3, cl: 1, c: 0 },
    { a: `${W}src/pagos/nota.ts`, l: "ts", k: "logica", g: ["front/feat-pagos", "4 folder neighbors belong to Pagos", "baja", [["vecinos", 4]]], c: 0 },
    { a: "back/repo-api:src/Util/Texto.php", l: "php", k: "otros", cl: 1, c: 1 },
  ],
});

describe("pantalla Sin asociar", () => {
  it("aísla los archivos por carpeta, cada uno con su recomendación y el motivo", () => {
    const v = montar(datos());
    // De la carpeta con más archivos a la que menos.
    expect(v.carpetas()).toEqual(["src/shared/", "src/Util/", "src/pagos/"]);
    expect(v.archivos()).toEqual(["dinero.ts", "moneda.ts", "fecha.ts", "Texto.php", "nota.ts"]);
    const p = v.pagina();
    // Cifras: 5 sin asociar, 3 con recomendación, 1 compartido, 1 sin pista, 3 carpetas.
    expect([...p.matchAll(/<div class="fd-cifra[^"]*"[^>]*><b[^>]*>(\d+)<\/b>/g)].map((m) => m[1])).toEqual(["5", "3", "1", "1", "3"]);
    expect(p).toMatch(/→ <a href="#\/f\/front%2Ffeat-pagos">Pagos<\/a><\/span> <span class="fd-es ok sa-conf" title="[^"]+">High confidence<\/span> <small>imported by 2 files of Pagos<\/small>/);
    // Sin señales, el texto del motor y ninguna etiqueta de confianza.
    expect(p).toContain('Pagos</a></span> <small>lo importa 1 archivo de Pagos</small>');
    // La carpeta tiene recomendada porque la votan más de la mitad de sus archivos.
    expect(p).toContain("Recommended: Pagos (2 of 3)");
    expect(p).toContain("Shared code</span> <small>Used by 3 features");
    expect(p).toContain("No hint</span> <small>Nothing links it to a feature");
    // Sin servidor es de solo lectura: lo dice y no ofrece asociar.
    expect(p).toContain("flowbrain viewer --serve");
    expect(p).not.toContain('data-acc="asociar');
    // En castellano, la misma pantalla con sus textos de siempre.
    const es = montar(datos(), { lang: "es" }).pagina();
    expect(es).toContain("<h1>Sin asociar</h1>");
    expect(es).toContain("Recomendada: Pagos (2 de 3)");
    expect(es).toContain("Código compartido</span> <small>Lo usan 3 funcionalidades");
    expect(es).toContain("Sin pista</span> <small>Nada lo une a una funcionalidad");
    // El motivo y la confianza, en castellano: el visor los arma de las señales, no del texto en inglés del motor.
    expect(es).toContain(">Confianza alta</span> <small>lo importan 2 archivos de Pagos</small>");
    expect(es).toContain(">Confianza baja</span> <small>4 vecinos de carpeta son de Pagos</small>");
    expect(es).not.toContain("imported by 2 files");
  });

  it("filtra por confianza, con su panel; lo que no tiene recomendación se cuenta aparte", () => {
    const v = montar(datos());
    expect(v.pagina()).toContain("Confidence of the recommendation");
    expect(v.pagina()).toContain("no recommendation, so no confidence");
    v.cambiar("sa-confianza", "alta");
    expect(v.archivos()).toEqual(["dinero.ts"]);
    v.cambiar("sa-confianza", "baja");
    expect(v.archivos()).toEqual(["nota.ts"]);
    v.cambiar("sa-confianza", "media");
    expect(v.lista()).toContain("No file matches confidence medium. 5 unassigned files in total.");
  });

  it("filtra por tipo de pista, recomendada, cerebro y texto; un vacío dice por qué", () => {
    const v = montar(datos());
    v.tocar({ "data-fl": "sa", "data-grupo": "compartido" });
    expect(v.archivos()).toEqual(["fecha.ts"]);
    v.tocar({ "data-fl": "sa", "data-grupo": "sinpista" });
    expect(v.archivos()).toEqual(["Texto.php"]);
    v.cambiar("sa-cerebro", "0");
    expect(v.lista()).toContain("No file matches no hint, brain front. 5 unassigned files in total.");
    v.tocar({ "data-fl": "sa", "data-fl-limpiar": "1" });
    v.cambiar("sa-recomendada", "front/feat-pagos");
    expect(v.archivos()).toEqual(["dinero.ts", "moneda.ts", "nota.ts"]);
    v.cambiar("sa-recomendada", "");
    v.escribir("util");
    expect(v.archivos()).toEqual(["Texto.php"]);
  });

  it("suma al pedido de a un archivo, por carpeta o la lista filtrada; el panel lateral se abre, quita, vacía y se recuerda", async () => {
    const local = new Map<string, string>();
    const v = montar(datos(), { local });
    // Sin nada sumado, el botón «Agente» no lleva número, y cada fila, carpeta y la lista tienen su «Sumar» celeste.
    expect(cuentaAgente(v.bandeja())).toBe("");
    expect(v.lista()).toContain(`data-acc="pedir" data-tipo="asociar" data-k="a|${W}src/shared/dinero.ts" data-et="Request" aria-pressed="false"`);
    expect(v.lista()).toMatch(/class="boton es-pedir" data-acc="pedir" data-tipo="asociar" data-k="c\|0\|front\/repo-web:src\/shared"[^>]*>Request the 3<\/button>/);
    expect(v.lista()).toContain(">Request the 5 in the list</button>");
    // Un archivo: el botón pasa a «En el pedido» y el panel se abre con él.
    v.tocar({ "data-acc": "pedir", "data-k": `a|${W}src/shared/dinero.ts` });
    expect(v.lista()).toMatch(/class="boton es-pedir en-lista" data-acc="pedir" data-tipo="asociar" data-k="a\|front\/repo-web:src\/shared\/dinero.ts"[^>]*>✔ In the request<\/button>/);
    // El panel es el del pedido al agente, único para todo el visor.
    expect(v.panel()).toContain("<h2>Agent</h2>");
    expect(v.panel()).toContain("<b>1 file</b>");
    expect(v.panel()).toContain("→ Pagos</span>");
    expect(v.panel()).toContain(">High confidence</span>");
    // La tarjeta lleva el motivo, como la regla en «Tests pedidos».
    expect(v.panel()).toContain("<code>dinero.ts</code> <small>imported by 2 files of Pagos</small>");
    expect(v.panel()).toContain('<small class="es-archivo">File: <code>repo-web:src/shared/dinero.ts</code></small>');
    expect(v.bandeja()).toContain('data-acc="panel" aria-expanded="true" aria-controls="pedido-panel"');
    expect(cuentaAgente(v.bandeja())).toBe("1");
    // La carpeta suma los que faltan; tocarla otra vez los saca.
    v.tocar({ "data-acc": "pedir", "data-k": "c|0|front/repo-web:src/shared" });
    expect(v.panel()).toContain("<b>3 files</b>");
    expect(v.panel()).toContain("2 with a recommendation · 1 shared · 0 with no hint");
    v.tocar({ "data-acc": "pedir", "data-k": "c|0|front/repo-web:src/shared" });
    // Con un filtro, la carpeta suma solo lo que se ve (lo que dice el botón): fecha.ts, el único compartido.
    v.tocar({ "data-fl": "sa", "data-grupo": "compartido" });
    v.tocar({ "data-acc": "pedir", "data-k": "c|0|front/repo-web:src/shared" });
    expect(v.panel()).toContain("<b>1 file</b>");
    expect(v.panel()).toContain("<code>fecha.ts</code>");
    v.tocar({ "data-fl": "sa", "data-grupo": "" });
    v.tocar({ "data-acc": "pedir", "data-k": "c|0|front/repo-web:src/shared" });
    expect(v.panel()).toContain("<b>3 files</b>");
    v.tocar({ "data-acc": "pedir", "data-k": "c|0|front/repo-web:src/shared" });
    expect(v.panel()).toContain("Nothing to request. Click «Request» on a rule, a file or a folder, on any screen");
    // La lista filtrada entera.
    v.tocar({ "data-acc": "pedir", "data-k": "l|" });
    expect(v.panel()).toContain("<b>5 files</b>");
    // Estática: «Pedir todos» no se puede; «Descargar .md» baja la lista (en inglés: es para el modelo) y lo dice.
    const p = v.panel();
    expect(p).toContain("This page is read-only: it can't send the requests. Download the .md and give it to your agent");
    expect(p).toMatch(/data-acc="pedir-todos" disabled>Request all \(5\)<\/button><button type="button" class="boton" data-acc="descargar-lista">Download \.md<\/button><button type="button" class="boton" data-acc="vaciar">Empty the list<\/button>/);
    v.tocar({ "data-acc": "descargar-lista" });
    expect(v.bajados[0]!.nombre).toBe("archivos-pedidos.md");
    const md = await v.bajados[0]!.texto();
    expect(md).toContain("# Files to assign in FlowBrain");
    expect(md).toContain("5 files (3 with a recommendation, 1 shared, 1 with no hint) in 2 repos.");
    expect(md).toContain("### brain front, repo-web (4)");
    expect(md).toContain("- repo-web:src/shared/dinero.ts (brain front): recommended feat-pagos (imported by 2 files of Pagos); others: feat-envios");
    expect(md).toContain("- repo-web:src/shared/fecha.ts (brain front): shared code, used by 3 features");
    expect(md).toContain("- repo-api:src/Util/Texto.php (brain back): no hint");
    expect(md).toContain("`flowbrain compile` inside `.flowbrain/<brain>/` (`front`, `back`)");
    // Quitar de a uno.
    v.tocar({ "data-acc": "quitar", "data-tipo": "asociar", "data-k": "back|repo-api:src/Util/Texto.php" });
    expect(v.panel()).toContain("<b>4 files</b>");
    expect(v.panel()).not.toContain("Texto.php");
    // La lista y el panel abierto se recuerdan, en una sola clave: otra página, el mismo navegador.
    const guardado = () => JSON.parse(local.get("flowbrain.pedido")!) as { items: Array<{ tipo: string; k: string; repo: string }>; panel: boolean };
    expect(guardado().items).toHaveLength(4);
    expect(guardado().items[0]).toMatchObject({ tipo: "asociar", k: "front|repo-web:src/shared/dinero.ts", repo: "repo-web" });
    expect(guardado().panel).toBe(true);
    const otra = montar(datos(), { local });
    expect(otra.panelAbierto()).toBe("es-panel abierto");
    expect(otra.panel()).toContain("<b>4 files</b>");
    // Lo que ya no está sin asociar sale del pedido al abrir.
    const d = datos();
    d.sinAsociar = d.sinAsociar.filter((x) => !x.a.endsWith("dinero.ts"));
    expect(montar(d, { local }).panel()).toContain("<b>3 files</b>");
    // Cerrar el panel lo recuerda cerrado; el botón junto al título lo vuelve a abrir.
    otra.tocar({ "data-acc": "cerrar-panel" });
    expect(guardado().panel).toBe(false);
    expect(otra.panelAbierto()).toBe("es-panel");
    expect(otra.bandeja()).toContain('aria-expanded="false" aria-controls="pedido-panel"');
    expect(cuentaAgente(otra.bandeja())).toBe("4");
    otra.tocar({ "data-acc": "panel" });
    expect(guardado().panel).toBe(true);
    otra.tocar({ "data-acc": "vaciar" });
    expect(otra.panel()).toContain("Nothing to request.");
    expect(guardado().items).toEqual([]);
    // En castellano, los mismos textos que «Tests pedidos»; el texto para el agente, en inglés.
    const es = montar(datos(), { lang: "es" });
    expect(es.lista()).toContain(">Pedir</button>");
    expect(es.lista()).toContain(">Pedir los 3</button>");
    expect(es.lista()).toContain(">Pedir los 5 de la lista</button>");
    es.tocar({ "data-acc": "pedir", "data-k": "l|" });
    expect(es.lista()).toContain(">✔ En el pedido</button>");
    expect(es.panel()).toContain("<h2>Agente</h2>");
    expect(es.panel()).toContain("3 con recomendación · 1 compartido · 1 sin pista");
    expect(es.panel()).toContain(">Descargar .md</button>");
    expect(es.panel()).toContain(">Vaciar la lista</button>");
    expect(es.panel()).toContain("<code>dinero.ts</code> <small>lo importan 2 archivos de Pagos</small>");
  });

  it("sin índice, sin funcionalidades o sin nada que asociar explica qué pasa", () => {
    const d = datos();
    expect(montar({ ...d, sinAsociar: null }).pagina()).toContain("There is no code index");
    expect(montar({ ...d, funcionalidades: [] }).pagina()).toContain("There are no features yet");
    expect(montar({ ...d, sinAsociar: [] }).pagina()).toContain("Every file in the index belongs to a feature or library");
  });

  it("con el servidor: asocia un archivo, o la carpeta entera si nada de ella tiene dueño, y lo asociado sale de la lista", async () => {
    const pedidos: Array<Record<string, unknown>> = [];
    const fetch = (url: string, init: { method: string; body: string; headers: Record<string, string> }) => {
      pedidos.push({ url, token: init.headers["x-flowbrain-token"], ...(JSON.parse(init.body) as Record<string, unknown>) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mensaje: "Ahora es parte de Pagos.", escrito: "front/product/feat-pagos.md", cambio: true }) });
    };
    const v = montar(datos(), { edicion: { token: "secreto", sinAplicar: [] }, fetch });
    const esperar = () => new Promise((ok) => setTimeout(ok, 0));
    const l = v.lista();
    expect(l).toContain(`data-acc="asociar" data-f="front/feat-pagos" data-a="${W}src/shared/dinero.ts">Assign to Pagos</button>`);
    // La otra candidata, como botón secundario; y la carpeta libre se puede asociar entera.
    expect(l).toContain(`data-acc="asociar" data-f="front/feat-envios" title="imports 1 file of Envíos" data-a="${W}src/shared/dinero.ts">Envíos</button>`);
    expect(l).toContain(`data-acc="asociar-carpeta" data-k="0|${W}src/shared" data-f="front/feat-pagos">Assign the folder to Pagos</button>`);
    // En src/pagos ya hay archivos con dueño: se asocia de a uno, y se dice.
    expect(l).not.toContain(`data-k="0|${W}src/pagos"`);
    expect(l).toContain("here you assign them one by one");

    v.tocar({ "data-acc": "asociar", "data-a": `${W}src/pagos/nota.ts`, "data-f": "front/feat-pagos" });
    await esperar();
    // Viajan los ids del cerebro, sin el prefijo del visor.
    expect(pedidos[0]).toEqual({ url: "/api/editar", token: "secreto", tipo: "funcionalidad", cerebro: "front", archivo: "repo-web:src/pagos/nota.ts", funcionalidad: "feat-pagos" });
    expect(v.archivos()).toEqual(["dinero.ts", "moneda.ts", "fecha.ts", "Texto.php"]);
    expect(v.lista()).toContain("Ahora es parte de Pagos. (front/product/feat-pagos.md)");

    // Asociar un archivo suelto de una carpeta libre le saca a la carpeta la opción de asociarse entera.
    const otro = montar(datos(), { edicion: { token: "secreto", sinAplicar: [] }, fetch });
    otro.tocar({ "data-acc": "asociar", "data-a": `${W}src/shared/moneda.ts`, "data-f": "front/feat-pagos" });
    await esperar();
    expect(otro.lista()).not.toContain(`data-k="0|${W}src/shared"`);
    pedidos.pop();

    v.tocar({ "data-acc": "asociar-carpeta", "data-k": `0|${W}src/shared`, "data-f": "front/feat-pagos" });
    await esperar();
    expect(pedidos[1]).toMatchObject({ archivo: "repo-web:src/shared/dinero.ts", funcionalidad: "feat-pagos", entrada: "repo-web:src/shared" });
    expect(v.archivos()).toEqual(["Texto.php"]);
    expect(v.lista()).toContain("3 files left the list.");

    // Sin pista: se elige a mano, entre las funcionalidades de su mismo cerebro.
    v.tocar({ "data-acc": "otra", "data-k": "back/repo-api:src/Util/Texto.php" });
    expect(v.lista()).toContain('<option value="back/feat-stock">Stock</option>');
    expect(v.lista()).not.toContain("front/feat-envios");
    v.poner("sa-feat", "back/feat-stock");
    v.tocar({ "data-acc": "asociar-elegida", "data-k": "back/repo-api:src/Util/Texto.php" });
    await esperar();
    expect(pedidos[2]).toMatchObject({ cerebro: "back", archivo: "repo-api:src/Util/Texto.php", funcionalidad: "feat-stock" });
    expect(v.pagina()).toContain("Done: no unassigned files left.");
  });

  it("con el servidor: acepta en lote las de confianza alta, después de confirmar cuántas", async () => {
    const pedidos: Array<Record<string, unknown>> = [];
    const preguntas: string[] = [];
    let responder = false;
    const fetch = (url: string, init: { method: string; body: string; headers: Record<string, string> }) => {
      pedidos.push({ url, ...(JSON.parse(init.body) as Record<string, unknown>) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mensaje: "ok", escrito: "front/product/feat-pagos.md", cambio: true }) });
    };
    const d = datos();
    // Dos de confianza alta: una más en otra carpeta.
    (d.sinAsociar as Array<Record<string, unknown>>).push({ a: `${W}src/cobros/tarjeta.ts`, l: "ts", k: "logica", g: ["front/feat-pagos", "imports 3 files of Pagos", "alta", [["usa", 3]]], c: 0 });
    const v = montar(d, { edicion: { token: "secreto", sinAplicar: [] }, fetch, confirmar: (t) => (preguntas.push(t), responder) });
    const esperar = () => new Promise((ok) => setTimeout(ok, 0));
    expect(v.lista()).toContain('data-acc="aceptar-altas">Accept the high-confidence ones (2)</button>');
    // Sin confirmar no manda nada; la pregunta dice cuántas.
    v.tocar({ "data-acc": "aceptar-altas" });
    expect(preguntas[0]).toContain("Assign 2 files to their high-confidence recommended feature?");
    expect(pedidos).toEqual([]);
    responder = true;
    v.tocar({ "data-acc": "aceptar-altas" });
    for (let i = 0; i < 6; i++) await esperar();
    // Con el mismo endpoint que el botón Asociar, de a uno.
    expect(pedidos.map((p) => [p["url"], p["archivo"], p["funcionalidad"]])).toEqual([
      ["/api/editar", "repo-web:src/shared/dinero.ts", "feat-pagos"],
      ["/api/editar", "repo-web:src/cobros/tarjeta.ts", "feat-pagos"],
    ]);
    expect(v.archivos()).toEqual(["moneda.ts", "fecha.ts", "Texto.php", "nota.ts"]);
    expect(v.lista()).toContain("2 files were assigned to their recommended feature.");
    // Ya no queda ninguna alta: lo dice en vez de ofrecer un botón vacío.
    expect(v.lista()).toContain("No file in this list has a high-confidence recommendation to accept in bulk");
    // Respeta los filtros: con otro cerebro elegido no hay altas.
    const otro = montar(datos(), { edicion: { token: "secreto", sinAplicar: [] }, fetch, lang: "es" });
    expect(otro.lista()).toContain("Aceptar las de confianza alta (1)");
    otro.cambiar("sa-cerebro", "1");
    expect(otro.lista()).toContain("Ningún archivo de esta lista tiene una recomendación de confianza alta");
  });

  it("Ver código: con el servidor lee el archivo por /api/archivo; sin servidor no aparece y el aviso dice por qué", async () => {
    expect(montar(datos()).lista()).not.toContain('data-acc="codigo"');
    expect(montar(datos()).pagina()).toContain("view each file's code or send the requests to the agent, open it with <code>flowbrain viewer --serve</code>: a static page cannot read the repos");
    const urls: string[] = [];
    let respuesta: Record<string, unknown> = { lineas: ["export const x = 1;", "if (a < b) {}"], recortado: { mostradas: 2, total: 2500, bytes: 90000 } };
    const fetch = (url: string, init: { method: string; headers: Record<string, string> }) => {
      urls.push(url + " " + init.method + " " + init.headers["x-flowbrain-token"]);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(respuesta) });
    };
    const v = montar(datos(), { edicion: { token: "secreto", sinAplicar: [] }, fetch: fetch as never });
    const esperar = () => new Promise((ok) => setTimeout(ok, 0));
    expect(v.lista()).toContain(`data-acc="codigo" data-a="${W}src/shared/dinero.ts">View code</button>`);
    v.tocar({ "data-acc": "codigo", "data-a": `${W}src/shared/dinero.ts` });
    expect(v.lista()).toContain("Reading the file…");
    await esperar(); await esperar();
    expect(urls).toEqual(["/api/archivo?cerebro=front&archivo=repo-web%3Asrc%2Fshared%2Fdinero.ts&contenido=1 GET secreto"]);
    const l = v.lista();
    expect(l).toContain('<span class="sa-ln">2</span>if (a &#60; b) {}');
    expect(l).toContain("Showing 2 of 2,500 lines.");
    expect(l).toContain(">Hide code</button>");
    // Tocarlo otra vez lo cierra; un archivo que ya no está lo explica.
    v.tocar({ "data-acc": "codigo", "data-a": `${W}src/shared/dinero.ts` });
    expect(v.lista()).not.toContain("sa-pre");
    respuesta = { error: "the file is not in the clone" };
    v.tocar({ "data-acc": "codigo", "data-a": `${W}src/pagos/nota.ts` });
    await esperar(); await esperar();
    expect(v.lista()).toContain("There is no code to show for <code>repo-web:src/pagos/nota.ts</code>: the file is not in the clone");
  });

  it("manda la lista del panel como Pedir todos: proveedor y modelo, tandas, avance, Cancelar todo y el resumen; sin agente, el .md", async () => {
    const pedidos: Array<Record<string, any>> = [];
    let recargas = 0;
    const estado: { trabajos: Array<Record<string, unknown>>; lotes: Array<Record<string, unknown>> } = { trabajos: [{ id: "otro", tipo: "test", lote: "LT", estado: "corriendo", etiqueta: "De otra pantalla", pasos: [] }], lotes: [{ id: "LT", tipo: "test", estado: "corriendo" }] };
    const fetch = (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      pedidos.push({ url, metodo: init.method, ...(init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}) });
      const j = url === "/api/agente" && init.method === "GET" ? estado
        : url === "/api/agente/lote" ? { lote: { id: "L1", tipo: "asociar", estado: "corriendo", cerebros: ["front", "back"] }, trabajos: [] }
        : url === "/api/agente" ? { id: "s1", tipo: "asociar", estado: "en_cola", etiqueta: "Propose a feature for 1 file", pasos: [], cambios: [] }
        : { trabajos: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
    };
    const agente = { noDisponible: null, proveedores: [{ id: "claude-code", nombre: "Claude Code", version: "1", modelos: [{ id: "claude-sonnet-5-5", nombre: "Sonnet 5.5", costoPorArchivoUsd: 0.03 }, { id: "claude-opus-5-5", nombre: "Opus 5.5", porDefecto: true, costoPorArchivoUsd: 0.08 }] }] };
    const local = new Map<string, string>();
    const v = montar(datos(), { edicion: { token: "secreto", sinAplicar: [], agente }, fetch: fetch as never, recargar: () => void recargas++, local });
    const esperar = async () => { for (let i = 0; i < 4; i++) await new Promise((ok) => setTimeout(ok, 0)); };
    await esperar();
    // Al abrir, el componente mira cómo está el agente; los pedidos sueltos de otra pantalla no se muestran en esta.
    expect(pedidos[0]).toMatchObject({ url: "/api/agente", metodo: "GET" });
    expect(v.pagina()).not.toContain("De otra pantalla");
    // Un lote de tests en curso (de Especificaciones) no frena el de archivos: cada tipo manda el suyo.
    // Ya no hay un recuadro del pedido en medio de la página: se suma y se manda desde el panel.
    expect(v.pagina()).not.toContain('data-acc="pedido"');
    // Se suman 4 de los 5: sin dinero.ts.
    v.tocar({ "data-acc": "pedir", "data-k": "l|" });
    v.tocar({ "data-acc": "quitar", "data-tipo": "asociar", "data-k": "front|repo-web:src/shared/dinero.ts" });
    let p = v.panel();
    expect(p).toContain('<option value="claude-code" selected>Claude Code</option>');
    expect(p).toContain('<option value="claude-opus-5-5" selected>Opus 5.5 (default)</option>');
    expect(p).toContain("<b>4 files</b>");
    expect(p).toContain("2 with a recommendation · 1 shared · 1 with no hint");
    // front/repo-web y back/repo-api: dos tandas.
    expect(p).toContain("In 2 batches of up to 30 files of the same repo");
    expect(p).toContain('data-acc="pedir-todos">Request all (4)</button>');
    expect(p).toContain('data-acc="descargar-lista">Download .md</button>');
    // El costo estimado, por archivo y con el modelo elegido (como en «Tests pedidos»).
    expect(p).toContain("Estimated cost: ≈ US$ 0.32 <small>(approx., with Opus 5.5)</small>");
    // El modelo elegido se recuerda en este navegador, en la clave del pedido.
    v.cambiar("pedido-modelo", "claude-sonnet-5-5");
    expect(JSON.parse(local.get("flowbrain.pedido")!).elegido).toEqual({ proveedor: "claude-code", modelo: "claude-sonnet-5-5" });
    expect(v.panel()).toContain("Estimated cost: ≈ US$ 0.12 <small>(approx., with Sonnet 5.5)</small>");

    v.tocar({ "data-acc": "pedir-todos" });
    estado.lotes = [{ id: "L1", tipo: "asociar", estado: "corriendo", cerebros: ["front", "back"] }, ...estado.lotes];
    estado.trabajos = [
      { id: "t1", tipo: "asociar", lote: "L1", repo: "repo-web", tanda: { n: 1, de: 1 }, estado: "corriendo", pasos: ["Lee src/shared/fecha.ts"], archivos: ["moneda", "fecha"].map((n) => ({ cerebro: "front", archivo: `repo-web:src/shared/${n}.ts` })).concat([{ cerebro: "front", archivo: "repo-web:src/pagos/nota.ts" }]) },
      { id: "t2", tipo: "asociar", lote: "L1", repo: "repo-api", tanda: { n: 1, de: 1 }, estado: "en_cola", pasos: [], archivos: [{ cerebro: "back", archivo: "repo-api:src/Util/Texto.php" }] },
      ...estado.trabajos,
    ];
    await esperar();
    // Manda lo que está en la lista, no todo lo filtrado.
    const post = pedidos.find((x) => x.url === "/api/agente/lote")!;
    expect(post).toMatchObject({ tipo: "asociar", proveedor: "claude-code", modelo: "claude-sonnet-5-5" });
    expect(post["archivos"]).toHaveLength(4);
    expect(post["archivos"].map((a: { archivo: string }) => a.archivo)).not.toContain("repo-web:src/shared/dinero.ts");
    expect(post["archivos"][0]).toEqual({ cerebro: "front", archivo: "repo-web:src/shared/moneda.ts", linea: "- repo-web:src/shared/moneda.ts (brain front): recommended feat-pagos (lo importa 1 archivo de Pagos)" });
    p = v.panel();
    expect(p).toContain("Assigning 4 files in 2 repos");
    expect(p).toContain("0 of 2 batches");
    expect(p).toContain("Lee src/shared/fecha.ts");
    expect(p).toContain("Waits for the previous batch to finish.");
    expect(p).toContain('data-acc="cancelar-lote" data-k="L1">Cancel all</button>');
    // Al mandar, el panel pasa a «Trabajando»: lo que está en una tanda no se puede quitar, y no queda nada por pedir.
    expect(p).toContain('<div class="pd-etapa" data-etapa="trabajando">');
    expect(p).toContain('<p class="pd-estado na">The agent is working on it…</p>');
    expect(p).not.toMatch(/data-acc="quitar" data-tipo="asociar" data-k="back\|repo-api:src\/Util\/Texto.php"/);
    v.tocar({ "data-acc": "etapa", "data-k": "pedir" });
    expect(v.panel()).toContain("Nothing to request");
    v.tocar({ "data-acc": "etapa", "data-k": "trabajando" });
    v.tocar({ "data-acc": "cancelar-lote", "data-k": "L1" });
    await esperar();
    expect(pedidos.find((x) => x.url === "/api/agente/lote/cancelar")).toMatchObject({ id: "L1" });

    // Se sigue aunque se recargue: otra página, el mismo navegador, lo ve al abrir. Lo asociado sale de la lista.
    estado.lotes[0]!["estado"] = "terminado";
    estado.trabajos[0] = { ...estado.trabajos[0], estado: "terminado", costoUsd: 0.3, resultado: "Asocié 2; dejé nota.ts: no sé de quién es.", terminado: Date.now() + 60_000, asociados: ["moneda", "fecha"].map((n) => ({ cerebro: "front", archivo: `repo-web:src/shared/${n}.ts` })), siguen: [{ cerebro: "front", archivo: "repo-web:src/pagos/nota.ts" }],
      desenlaces: [
        ...["moneda", "fecha"].map((n) => ({ item: { cerebro: "front", archivo: `repo-web:src/shared/${n}.ts` }, resuelto: true, cambio: { asociado: true } })),
        { item: { cerebro: "front", archivo: "repo-web:src/pagos/nota.ts" }, resuelto: false, motivo: { codigo: "sigue", agente: "No feature covers notes" } },
      ] };
    estado.trabajos[1] = { ...estado.trabajos[1], estado: "cancelado" };
    const otra = montar(datos(), { edicion: { token: "secreto", sinAplicar: [], agente }, fetch: fetch as never, recargar: () => void recargas++, local });
    await esperar();
    p = otra.panel();
    expect(p).toContain("Finished");
    expect(p).toContain("2 of 2 batches");
    expect(p).toContain("Actual cost: US$ 0.30");
    expect(p).toContain("2 resolved · 1 could not be resolved · 1 batch canceled.");
    expect(p).toContain("Asocié 2; dejé nota.ts: no sé de quién es.");
    expect(p).not.toContain("Reload to see the changes");
    expect(p).toContain("It could not resolve it: after the batch it is still pending. The agent says: «No feature covers notes»");
    expect(p).toContain('data-acc="otra-vez" data-tipo="asociar" data-k="front|repo-web:src/pagos/nota.ts">Request again</button>');
    // Lo de la tanda cancelada antes de empezar sigue en la lista («Por pedir»); lo demás salió con su desenlace.
    expect(p).toContain('data-k="pedir">To request <span class="pd-num">1</span>');
    expect(JSON.parse(local.get("flowbrain.pedido")!).items.map((e: { k: string }) => e.k)).toEqual(["back|repo-api:src/Util/Texto.php"]);
    // La fila del archivo que quedó lleva la marca, y su botón dice «Pedir de nuevo».
    expect(otra.lista()).toContain('>Request again</button><span class="pd-marca no"');
    // El lote cambió algo después de cargar la página: los datos nuevos se traen solos (sin «Recargar» a mano).
    expect(recargas).toBeGreaterThanOrEqual(1);
    otra.tocar({ "data-acc": "cerrar-lote", "data-k": "L1" });
    expect(otra.panel()).not.toContain('<section class="es-lote" data-tipo="asociar"');
    expect(JSON.parse(local.get("flowbrain.pedido")!).ocultos).toEqual(["L1"]);

    // «Proponer funcionalidad nueva» sigue siendo un pedido suelto, junto a su fila, con el modelo elegido.
    otra.tocar({ "data-acc": "nueva-feat", "data-a": "back/repo-api:src/Util/Texto.php" });
    expect(otra.lista()).toMatch(/Texto\.php[\s\S]*<h2>Propose a new feature<\/h2>/);
    expect(otra.lista()).toContain('<select id="sa-ped-modelo">');
    otra.tocar({ "data-acc": "mandar" });
    await esperar();
    expect(pedidos.filter((x) => x.url === "/api/agente" && x.metodo === "POST").pop()).toMatchObject({ tipo: "asociar", cerebros: ["back"], modelo: "claude-sonnet-5-5" });

    // En castellano, el mismo panel.
    const es = montar(datos(), { lang: "es", edicion: { token: "secreto", sinAplicar: [], agente }, fetch: fetch as never, local: new Map() });
    await esperar();
    es.tocar({ "data-acc": "pedir", "data-k": "l|" });
    expect(es.panel()).toContain("Pedir todos (5)");
    expect(es.panel()).toContain("En 2 tandas de hasta 30 archivos de un mismo repo");
    es.tocar({ "data-acc": "etapa", "data-k": "trabajando" });
    expect(es.panel()).toContain("Trabajando <span");
    expect(es.panel()).toContain("Costo real: US$ 0.30");
    expect(es.panel()).toContain("2 resueltos · 1 sin resolver");
    expect(es.panel()).not.toContain("Recargar para ver los cambios");

    // Con el servidor pero sin agente: lo dice y ofrece el .md.
    const sin = montar(datos(), { edicion: { token: "secreto", sinAplicar: [], agente: { noDisponible: "Claude Code (claude) was not found on this machine", proveedores: [] } }, fetch: fetch as never });
    sin.tocar({ "data-acc": "pedir", "data-k": "l|" });
    expect(sin.panel()).toContain("There's no agent installed on this machine: Claude Code (claude) was not found on this machine. Download the .md and give it to your agent");
    expect(sin.panel()).toMatch(/data-acc="pedir-todos" disabled/);
    expect(sin.panel()).toContain('data-acc="descargar-lista">Download .md</button>');
  });

  it("el lote y el .md llevan toda la lista, sin el tope de 80; un modelo sin costo por archivo lo dice", async () => {
    const d = datos();
    (d as Record<string, unknown>).sinAsociar = Array.from({ length: 85 }, (_, i) => ({ a: `${W}src/x/a${i}.ts`, l: "ts", k: "otros", c: 0 }));
    const v = montar(d, { edicion: { token: "t", sinAplicar: [], agente: { noDisponible: null, proveedores: [{ id: "claude-code", nombre: "Claude Code", modelos: [{ id: "m", nombre: "Otro" }] }] } } });
    v.tocar({ "data-acc": "pedir", "data-k": "l|" });
    const p = v.panel();
    expect(p).toContain("Request all (85)");
    expect(p).toContain("In 3 batches");
    expect(p).toContain("Estimated cost: no estimate for this model: the actual cost shows while it runs");
    v.tocar({ "data-acc": "descargar-lista" });
    const md = await v.bajados[0]!.texto();
    expect(md.match(/^- repo-web:src\/x\/a\d+\.ts/gm)).toHaveLength(85);
  });

  it("código compartido: se asocia a una librería del mismo cerebro, o se pide crear una", async () => {
    const pedidos: Array<Record<string, unknown>> = [];
    const fetch = (url: string, init: { method: string; body: string; headers: Record<string, string> }) => {
      pedidos.push({ url, ...(JSON.parse(init.body) as Record<string, unknown>) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mensaje: "Ahora es parte de Común.", escrito: "front/technology/lib-comun.md", cambio: true }) });
    };
    // Sin librerías en el cerebro, lo dice y no ofrece asociar a una.
    const sinLib = montar(datos(), { edicion: { token: "t", sinAplicar: [] }, fetch });
    expect(sinLib.lista()).toContain("This brain has no library yet: «Create library» asks the agent for one.");
    expect(sinLib.lista()).not.toContain('data-acc="lib"');
    const d = datos();
    (d.nodes as Array<Record<string, unknown>>).push({ id: "front/lib-comun", n: "Común", t: "lib", p: "technology/lib-comun.md", c: 0 }, { id: "back/lib-util", n: "Util", t: "lib", p: "technology/lib-util.md", c: 1 });
    const v = montar(d, { edicion: { token: "t", sinAplicar: [] }, fetch });
    const esperar = () => new Promise((ok) => setTimeout(ok, 0));
    expect(v.lista()).toContain(`data-acc="lib" data-a="${W}src/shared/fecha.ts">Assign to a library…</button>`);
    v.tocar({ "data-acc": "lib", "data-a": `${W}src/shared/fecha.ts` });
    // Solo las librerías de su cerebro.
    expect(v.lista()).toContain('<option value="front/lib-comun">Común</option>');
    expect(v.lista()).not.toContain("back/lib-util");
    v.poner("sa-lib", "front/lib-comun");
    v.tocar({ "data-acc": "asociar-lib", "data-k": `${W}src/shared/fecha.ts` });
    await esperar();
    expect(pedidos[0]).toEqual({ url: "/api/editar", tipo: "funcionalidad", cerebro: "front", archivo: "repo-web:src/shared/fecha.ts", funcionalidad: "lib-comun" });
    expect(v.archivos()).not.toContain("fecha.ts");

    // «Crear librería» arma el pedido (estática: para copiar) con los compartidos de su carpeta.
    const est = montar(datos());
    est.tocar({ "data-acc": "crear-lib", "data-a": `${W}src/shared/fecha.ts` });
    const l = est.lista();
    expect(l).toContain("<h2>Create a library</h2>");
    expect(l).toContain("Create a library in FlowBrain for this shared file");
    expect(l).toContain("_drafts/&#60;repo-id&#62;/technology/lib-&#60;id&#62;.md");
    expect(l).toContain("- repo-web:src/shared/fecha.ts (brain front): shared code, used by 3 features");
    expect(l).toContain("This page is static");
  });

  it("sin pista: propone una funcionalidad nueva, o se marca «No es de producto» (archivo o carpeta) y se deshace", async () => {
    const pedidos: Array<Record<string, unknown>> = [];
    let recargas = 0;
    const fetch = (url: string, init: { method: string; body: string; headers: Record<string, string> }) => {
      pedidos.push({ url, ...(JSON.parse(init.body) as Record<string, unknown>) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mensaje: "ok", escrito: "back/not-product.yaml", cambio: true }) });
    };
    const est = montar(datos(), { lang: "es" });
    est.tocar({ "data-acc": "nueva-feat", "data-a": "back/repo-api:src/Util/Texto.php" });
    expect(est.lista()).toContain("<h2>Proponer funcionalidad nueva</h2>");
    expect(est.lista()).toContain("Propose a new feature in FlowBrain for this file");
    expect(est.lista()).toContain("_drafts/product/feat-&#60;id&#62;.md");
    // Estática: no se puede marcar.
    expect(est.lista()).not.toContain('data-acc="noprod"');

    const v = montar(datos(), { edicion: { token: "t", sinAplicar: [] }, fetch, recargar: () => void recargas++ });
    const esperar = () => new Promise((ok) => setTimeout(ok, 0));
    // Solo los sin pista lo ofrecen.
    expect(v.lista().match(/data-acc="noprod"/g)).toHaveLength(1);
    v.tocar({ "data-acc": "noprod", "data-a": "back/repo-api:src/Util/Texto.php" });
    const l = v.lista();
    expect(l).toContain('<option value="back/repo-api:src/Util/Texto.php">This file (Texto.php)</option>');
    expect(l).toContain('<option value="back/repo-api:src/Util">The folder src/Util/ (1 unassigned file)</option>');
    expect(l).toContain('<option value="back/repo-api:src">The folder src/ (1 unassigned file)</option>');
    expect(l).toContain("not-product.yaml");
    v.poner("sa-np-entrada", "back/repo-api:src/Util");
    v.poner("sa-np-motivo", "script");
    v.tocar({ "data-acc": "noprod-marcar", "data-a": "back/repo-api:src/Util/Texto.php" });
    await esperar();
    expect(pedidos[0]).toEqual({ url: "/api/editar", tipo: "no_producto", cerebro: "back", archivo: "repo-api:src/Util/Texto.php", entrada: "repo-api:src/Util", motivo: "script" });
    expect(v.archivos()).toEqual(["dinero.ts", "moneda.ts", "fecha.ts", "nota.ts"]);
    expect(v.lista()).toContain("1 file is marked as not product (script) and left the list.");
    expect(v.lista()).toContain("Marked as not product: 1 file (1 entry)");
    expect(v.pagina()).toContain("marked as not product (not listed)");
    // Deshacer saca la marca y recarga para que sus archivos vuelvan.
    v.tocar({ "data-acc": "noprod-deshacer", "data-k": "0" });
    await esperar();
    expect(pedidos[1]).toEqual({ url: "/api/editar", tipo: "no_producto", cerebro: "back", entrada: "repo-api:src/Util", motivo: null });
    expect(recargas).toBe(1);
  });

  it("lo marcado como no de producto se cuenta y se explica, también con la lista vacía y en la página estática", () => {
    const d = { ...datos(), noProducto: [{ e: "front/repo-web:scripts", m: "script", n: 2, c: 0 }, { e: "front/repo-web:tools/viejo.ts", m: "otro", n: 0, c: 0 }] };
    const v = montar(d);
    expect([...v.pagina().matchAll(/<div class="fd-cifra[^"]*"[^>]*><b[^>]*>(\d+)<\/b>/g)].map((m) => m[1])).toEqual(["5", "3", "1", "1", "3", "2"]);
    const l = v.lista();
    expect(l).toContain("Marked as not product: 2 files (2 entries)");
    expect(l).toContain("<code>repo-web:scripts</code>");
    expect(l).toContain("it hides no unassigned file today");
    expect(l).toContain("remove the entry from that file and recompile");
    expect(l).not.toContain("noprod-deshacer");
    const vacia = montar({ ...d, sinAsociar: [] }).pagina();
    expect(vacia).toContain("Every file in the index belongs to a feature or library. There is nothing to assign. 2 files are marked as not product and not listed: see them below.");
    expect(vacia).toContain("Marked as not product: 2 files");
  });
});

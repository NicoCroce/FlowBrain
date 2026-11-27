import { describe, expect, it } from "vitest";
import { SIN_ASOCIAR_JS } from "../src/viewer-sin-asociar.js";
import { FILTROS_JS } from "../src/viewer-filtros.js";

/** La pantalla Sin asociar, corrida con un DOM mínimo: qué agrupa, qué recomienda, qué dice cuando no hay nada y qué manda al asociar. */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
function montar(datos: Record<string, unknown>, opciones: { edicion?: unknown; lang?: "es"; confirmar?: (texto: string) => boolean; fetch?: (url: string, init: { method: string; body: string; headers: Record<string, string> }) => Promise<unknown> } = {}) {
  const guardado = new Map<string, string>();
  const sessionStorage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
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
  const window = { brainVisor: { D: datos, porId, esc }, brainSinAsociar: null as null | { mostrar(): void }, FLOWBRAIN_EDICION: opciones.edicion, ...(opciones.confirmar ? { confirm: opciones.confirmar } : {}), ...(opciones.lang ? { brainI18n: { lang: opciones.lang } } : {}) };
  new Function("window", "document", "sessionStorage", FILTROS_JS)(window, { getElementById: el }, sessionStorage);
  new Function("window", "document", "sessionStorage", "fetch", SIN_ASOCIAR_JS)(window, { getElementById: el }, sessionStorage, opciones.fetch);
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
    carpetas: () => [...el("sa-lista").innerHTML.matchAll(/<h3><code>([^<]+)<\/code>/g)].map((m) => m[1]),
    archivos: () => [...el("sa-lista").innerHTML.matchAll(/<li class="sa-fila"><div class="sa-que"><code title="[^"]*">([^<]+)<\/code>/g)].map((m) => m[1]),
    cambiar: (id: string, value: string) => raiz.oyentes["change"]!({ target: { id, value } }),
    escribir: (value: string) => raiz.oyentes["input"]!({ target: { id: "sa-q", value } }),
    tocar: (attrs: Record<string, string>) => raiz.oyentes["click"]!({ target: boton(attrs) }),
    poner: (id: string, value: string) => void (el(id).value = value),
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

  it("arma el pedido para el agente con los archivos de la lista y su recomendación", () => {
    const v = montar(datos());
    v.tocar({ "data-acc": "pedido" });
    const l = v.lista();
    expect(l).toContain("Assign these 5 files");
    expect(l).toContain("- repo-web:src/shared/dinero.ts (brain front): recommended feat-pagos (imported by 2 files of Pagos); others: feat-envios");
    expect(l).toContain("- repo-web:src/shared/fecha.ts (brain front): shared code, used by 3 features");
    expect(l).toContain("- repo-api:src/Util/Texto.php (brain back): no hint");
    // El pedido es para el modelo: va en inglés aunque el visor esté en castellano.
    const es = montar(datos(), { lang: "es" });
    es.tocar({ "data-acc": "pedido" });
    expect(es.lista()).toContain("<h2>Pedido para el agente</h2>");
    expect(es.lista()).toContain("Assign these 5 files");
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
    expect(montar(datos()).pagina()).toContain("view each file's code, open it with <code>flowbrain viewer --serve</code>: a static page cannot read the repos");
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
});

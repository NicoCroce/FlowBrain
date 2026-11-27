import { describe, expect, it } from "vitest";
import { BORRADORES_JS } from "../src/viewer-borradores.js";
import { FILTROS_JS } from "../src/viewer-filtros.js";
import { PEDIDO_JS } from "../src/viewer-pedido.js";

/**
 * La pantalla Borradores (dec. 234), con el componente único del pedido y el filtro, sobre un DOM mínimo y un servidor
 * falso: lista lo de `_drafts/`, muestra el diff, acepta (y recarga), descarta (preguntando), devuelve al agente con una
 * nota como un ítem `borrador` del pedido, y avisa en la bandeja cuando un lote terminado dejó borradores.
 */
type Oyente = (ev: { target: Record<string, unknown>; type?: string }) => void;
interface Llamada { url: string; cuerpo: Record<string, unknown> | null }
const DEL_PEDIDO = new Set(["panel", "cerrar-panel", "quitar", "vaciar", "pedir-todos", "descargar-lista", "cancelar-lote", "cerrar-lote"]);

const B = (o: Record<string, unknown>) => ({ cerebro: "tienda", repo: null, nombre: null, modificado: 1000, ...o });
const LISTA = [
  B({ origen: "_drafts/product/feat-avisos.md", id: "feat-avisos", destino: "product/feat-avisos.md", estado: "nuevo", clase: "funcionalidad", nombre: "Avisos", modificado: 5000 }),
  B({ origen: "_drafts/product/feat-checkout.md", id: "feat-checkout", destino: "product/feat-checkout.md", estado: "distinto", clase: "especificaciones", nombre: "Checkout" }),
  B({ origen: "_drafts/repo-tienda/technology/lib-ui.md", id: "lib-ui", destino: "technology/lib-ui.md", estado: "nuevo", clase: "libreria", repo: "repo-tienda" }),
  B({ origen: "_drafts/notes/tabla-pagos.md", id: "tabla-pagos", destino: null, estado: "nota", clase: "nota" }),
];
const DIFF = {
  ...LISTA[1], borrador: "---\nresumen: Nuevo.\n---\n", actual: "---\nresumen: Viejo.\n---\n",
  cambios: [{ donde: "campo", nombre: "resumen", cambio: "cambiado", lineas: [["-", "resumen: Viejo."], ["+", "resumen: Nuevo."]] }],
};
const AGENTE = { noDisponible: null, proveedores: [{ id: "claude", nombre: "Claude Code", modelos: [{ id: "opus", nombre: "Opus", porDefecto: true, costoPorPaginaUsd: { borrador: 0.25 } }] }] };

function montar(opciones: { edicion?: boolean; lista?: unknown[]; lotes?: unknown[]; aceptar?: unknown; confirmar?: boolean } = {}) {
  const llamadas: Llamada[] = [];
  let lista = [...((opciones.lista ?? LISTA) as Array<Record<string, unknown>>)];
  const responder = (url: string, cuerpo: Record<string, unknown> | null): [number, unknown] => {
    if (url === "/api/borradores") return [200, { borradores: lista }];
    if (url.startsWith("/api/borradores/diff")) return [200, DIFF];
    if (url === "/api/borradores/aceptar") return [200, opciones.aceptar ?? { cerebros: [{ cerebro: "tienda", movidos: (cuerpo!["borradores"] as Array<{ origen: string }>).map((b) => b.origen), salteados: [], errores: [] }] }];
    if (url === "/api/borradores/descartar") { lista = lista.filter((x) => x["origen"] !== cuerpo!["origen"]); return [200, { descartado: cuerpo!["origen"] }]; }
    if (url === "/api/agente") return [200, { trabajos: [], lotes: opciones.lotes ?? [] }];
    if (url === "/api/agente/lote") return [200, { lote: { id: "l1", tipo: "borrador", creado: 1, estado: "corriendo" }, trabajos: [] }];
    return [404, { error: "no" }];
  };
  const fetch = (url: string, init?: { body?: string }) => {
    const cuerpo = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    llamadas.push({ url, cuerpo });
    const [estado, j] = responder(url, cuerpo);
    return Promise.resolve({ ok: estado === 200, status: estado, json: () => Promise.resolve(j) });
  };
  const guardado = new Map<string, string>();
  const sessionStorage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v), removeItem: (k: string) => void guardado.delete(k) };
  const local = new Map<string, string>();
  const localStorage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v) };
  type El = { innerHTML: string; textContent: string; atributos: Record<string, string>; oyentes: Record<string, Oyente>; addEventListener(t: string, f: Oyente): void; setAttribute(k: string, v: string): void };
  const elementos = new Map<string, El>();
  const el = (id: string) => {
    if (!elementos.has(id)) {
      const e: El = { innerHTML: "", textContent: "", atributos: {}, oyentes: {}, addEventListener(t, f) { e.oyentes[t] = f; }, setAttribute(k, v) { e.atributos[k] = v; } };
      elementos.set(id, e);
    }
    return elementos.get(id)!;
  };
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let recargas = 0;
  const preguntas: string[] = [];
  const window = {
    brainVisor: { D: { cerebros: [{ nombre: "tienda" }] }, porId: { "tabla-pagos": { n: "pagos" } }, esc },
    FLOWBRAIN_EDICION: opciones.edicion === false ? undefined : { token: "t", sinAplicar: [], agente: AGENTE },
    location: { hash: "#/borradores", reload: () => { recargas++; } },
    confirm: (p: string) => { preguntas.push(p); return opciones.confirmar !== false; },
    addEventListener() {},
    brainBorradores: null as null | { mostrar(): void },
    brainPedido: null as null | { pintar(): void },
  };
  const documento = { getElementById: el, body: { appendChild() {}, removeChild() {} } };
  const raiz = el("borradores");
  let html = "";
  Object.defineProperty(raiz, "innerHTML", {
    get: () => html,
    set: (v: string) => {
      html = v;
      const i = v.indexOf('<div id="bo-lista">');
      el("bo-lista").innerHTML = i < 0 ? "" : v.slice(i);
    },
  });
  new Function("window", "document", "sessionStorage", FILTROS_JS)(window, documento, sessionStorage);
  new Function("window", "document", "localStorage", "fetch", PEDIDO_JS)(window, documento, localStorage, fetch);
  new Function("window", "document", "sessionStorage", "fetch", BORRADORES_JS)(window, documento, sessionStorage, fetch);
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ disabled: false, getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs }) });
  const esperar = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    llamadas, guardado, preguntas, local,
    recargas: () => recargas,
    irA: (h: string) => { window.location.hash = h; window.brainPedido!.pintar(); },
    mostrar: async () => { window.brainBorradores!.mostrar(); await esperar(); return html; },
    pagina: () => html,
    lista: () => el("bo-lista").innerHTML,
    cuenta: () => el("nav-borradores").textContent,
    panel: () => el("pedido-panel").innerHTML,
    bandeja: () => el("pedido-bandeja").innerHTML,
    tocar: async (attrs: Record<string, string>) => {
      const destino = DEL_PEDIDO.has(attrs["data-acc"] ?? "") ? el(attrs["data-acc"] === "panel" ? "pedido-bandeja" : "pedido-panel") : raiz;
      destino.oyentes["click"]!({ target: boton(attrs) });
      await esperar();
    },
    escribir: (k: string, texto: string) => raiz.oyentes["input"]!({ type: "input", target: { tagName: "TEXTAREA", value: texto, getAttribute: (a: string) => (a === "data-k" ? k : null) } }),
  };
}
const K = (origen: string) => `tienda|${origen}`;

describe("pantalla Borradores", () => {
  it("sin servidor no inventa una lista: dice por qué y da los comandos de terminal", async () => {
    const v = montar({ edicion: false });
    const h = await v.mostrar();
    expect(h).toContain("read-only");
    expect(h).toContain("flowbrain viewer --serve");
    expect(h).toContain("flowbrain promote &#60;id...&#62; --write --brain tienda");
    expect(v.llamadas.filter((l) => l.url.startsWith("/api/borradores"))).toEqual([]);
  });

  it("lista los borradores con su clase y su cambio, cuenta los pendientes en la navegación y filtra por clase", async () => {
    const v = montar();
    const h = await v.mostrar();
    expect(v.cuenta()).toBe("4");
    for (const t of ["Avisos", "Checkout", "lib-ui", "tabla-pagos", "New page", "Changes a page", "Note to review", "Accept all (3)"]) expect(h).toContain(t);
    // Los grupos del filtro común: uno por clase con lo que hay.
    expect(h).toContain('data-grupo="nota"');
    expect(h).not.toContain('data-grupo="tecnologia"');
    await v.tocar({ "data-fl": "bo", "data-grupo": "nota" });
    expect(v.pagina()).not.toContain("Avisos");
    expect(v.pagina()).not.toContain("Accept all");
  });

  it("vacío: explica de dónde salen los borradores y ofrece el camino", async () => {
    const v = montar({ lista: [] });
    const h = await v.mostrar();
    expect(h).toContain("No drafts to review");
    expect(h).toContain('href="#/funcionalidades"');
  });

  it("«Ver cambios» trae el diff campo por campo contra la página", async () => {
    const v = montar();
    await v.mostrar();
    await v.tocar({ "data-acc": "ver", "data-k": K("_drafts/product/feat-checkout.md") });
    expect(v.llamadas.some((l) => l.url === "/api/borradores/diff?cerebro=tienda&origen=_drafts%2Fproduct%2Ffeat-checkout.md")).toBe(true);
    expect(v.lista()).toContain("Replaces <code>product/feat-checkout.md</code>");
    expect(v.lista()).toContain('<span class="bo-l bo-menos">- resumen: Viejo.</span><span class="bo-l bo-mas">+ resumen: Nuevo.</span>');
  });

  it("«Aceptar» manda ese borrador, y si compiló recarga la página con un aviso para después", async () => {
    const v = montar();
    await v.mostrar();
    await v.tocar({ "data-acc": "aceptar", "data-k": K("_drafts/product/feat-avisos.md") });
    expect(v.llamadas.find((l) => l.url === "/api/borradores/aceptar")?.cuerpo).toEqual({ borradores: [{ cerebro: "tienda", origen: "_drafts/product/feat-avisos.md" }] });
    expect(v.recargas()).toBe(1);
    expect(v.guardado.get("flowbrain.borradores.aviso")).toBe('{"n":1}');
    // Al volver a pintar (después de recargar), el aviso se muestra una vez.
    expect(await v.mostrar()).toContain("Accepted 1 draft");
    expect(v.guardado.has("flowbrain.borradores.aviso")).toBe(false);
  });

  it("si el cerebro deja de compilar no recarga: muestra que se deshizo y los errores", async () => {
    const v = montar({ aceptar: { cerebros: [{ cerebro: "tienda", movidos: [], salteados: [], errores: ["technology/lib-ui.md:3: unknown repo"] }] } });
    await v.mostrar();
    await v.tocar({ "data-acc": "aceptar", "data-k": K("_drafts/repo-tienda/technology/lib-ui.md") });
    expect(v.recargas()).toBe(0);
    expect(v.pagina()).toContain("Nothing was accepted: the brain stopped compiling, so it was undone");
    expect(v.pagina()).toContain("technology/lib-ui.md:3: unknown repo");
  });

  it("«Aceptar todo» lleva la lista filtrada sin las notas y avisa cuántas páginas reemplaza", async () => {
    const v = montar();
    await v.mostrar();
    await v.tocar({ "data-acc": "aceptar-todo" });
    expect(v.preguntas[0]).toContain("Accept 3 drafts? 1 page is replaced");
    expect((v.llamadas.find((l) => l.url === "/api/borradores/aceptar")?.cuerpo?.["borradores"] as Array<{ origen: string }>).map((b) => b.origen)).toEqual([
      "_drafts/product/feat-avisos.md", "_drafts/product/feat-checkout.md", "_drafts/repo-tienda/technology/lib-ui.md",
    ]);
  });

  it("«Descartar» pregunta (no se deshace); sin confirmar no borra nada", async () => {
    const no = montar({ confirmar: false });
    await no.mostrar();
    await no.tocar({ "data-acc": "descartar", "data-k": K("_drafts/notes/tabla-pagos.md") });
    expect(no.preguntas[0]).toContain("can't be undone");
    expect(no.llamadas.some((l) => l.url === "/api/borradores/descartar")).toBe(false);
    const v = montar();
    await v.mostrar();
    await v.tocar({ "data-acc": "descartar", "data-k": K("_drafts/notes/tabla-pagos.md") });
    expect(v.llamadas.find((l) => l.url === "/api/borradores/descartar")?.cuerpo).toEqual({ cerebro: "tienda", origen: "_drafts/notes/tabla-pagos.md" });
    expect(v.pagina()).toContain("Discarded: _drafts/notes/tabla-pagos.md");
    expect(v.cuenta()).toBe("3");
  });

  it("«Pedir corrección» suma un ítem «borrador» al pedido único con la nota, y sale en un lote en inglés", async () => {
    const v = montar();
    await v.mostrar();
    const k = K("_drafts/product/feat-checkout.md");
    await v.tocar({ "data-acc": "ver", "data-k": k });
    expect(v.lista()).toContain('data-acc="pedir" data-tipo="borrador"');
    // Sin nota, un borrador no se suma: el agente necesita saber qué corregir.
    await v.tocar({ "data-acc": "pedir", "data-tipo": "borrador", "data-k": k });
    expect(v.bandeja()).toBe("");
    v.escribir(k, "El resumen tiene que decir que se paga con tarjeta");
    await v.tocar({ "data-acc": "pedir", "data-tipo": "borrador", "data-k": k });
    expect(v.bandeja()).toContain("Request (1)");
    expect(v.panel()).toContain("El resumen tiene que decir que se paga con tarjeta");
    expect(v.panel()).toContain("≈ US$ 0.25");
    await v.tocar({ "data-acc": "pedir-todos" });
    expect(v.llamadas.find((l) => l.url === "/api/agente/lote")?.cuerpo).toEqual({
      tipo: "borrador", proveedor: "claude", modelo: "opus",
      items: [{ cerebro: "tienda", funcionalidad: "feat-checkout", borrador: "_drafts/product/feat-checkout.md", linea: "- brain tienda · draft _drafts/product/feat-checkout.md (replaces product/feat-checkout.md) · the person asks: El resumen tiene que decir que se paga con tarjeta" }],
    });
    // Una nota ya dice lo suyo: se pide sin escribir nada.
    await v.tocar({ "data-acc": "pedir", "data-tipo": "borrador", "data-k": K("_drafts/notes/tabla-pagos.md") });
    expect(v.bandeja()).toContain("Request (2)");
  });

  it("cuando un lote terminado dejó borradores, la bandeja enlaza a la pantalla (fuera de ella)", async () => {
    const v = montar({ lotes: [{ id: "l0", tipo: "funcionalidad", creado: 4000, estado: "terminado", cerebros: ["tienda"] }] });
    await v.mostrar();
    // En la pantalla misma no hace falta el enlace; la fila marca lo que dejó el agente.
    expect(v.bandeja()).not.toContain('href="#/borradores"');
    expect(v.lista()).toContain("From the agent");
    expect(v.panel()).toContain("The agent left 1 draft");
    v.irA("#/funcionalidades");
    expect(v.bandeja()).toContain('<a class="boton bo-enlace" href="#/borradores">1 new draft to review</a>');
  });
});

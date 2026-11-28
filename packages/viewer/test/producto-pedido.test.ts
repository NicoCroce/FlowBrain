import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import { cuentaAgente } from "./ayuda-agente.js";
import { ESPECIFICACIONES_JS } from "../src/viewer-especificaciones.js";
import { FILTROS_JS } from "../src/viewer-filtros.js";
import { PEDIDO_JS } from "../src/viewer-pedido.js";
import { PRODUCTO_JS } from "../src/viewer-producto.js";

/**
 * Funcionalidades en el pedido al agente (el componente único, dec. 233): «Pedir descripción» en la ficha, «Pedir las
 * N» en el catálogo, el pedido «escribir» de Especificaciones con su misma clave, y en la pantalla vacía, proponer las
 * funcionalidades de cada cerebro. Se corren Funcionalidades y Especificaciones con un DOM mínimo, junto con el componente.
 */
const DEL_PEDIDO = new Set(["panel", "cerrar-panel", "quitar", "vaciar", "pedir-todos", "descargar-lista", "cancelar-lote", "cerrar-lote"]);
type Oyente = (ev: { target: Record<string, unknown> }) => void;
type Fetch = (url: string, init: { method: string; body?: string }) => Promise<unknown>;
function montar(datos: Record<string, unknown>, opciones: { edicion?: unknown; fetch?: Fetch; local?: Map<string, string> } = {}) {
  const guardado = new Map<string, string>();
  const sessionStorage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
  const local = opciones.local ?? new Map<string, string>();
  const localStorage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v) };
  const elementos = new Map<string, { innerHTML: string; oyentes: Record<string, Oyente>; addEventListener(t: string, f: Oyente): void }>();
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
  const window = { brainVisor: { D: datos, porId, esc }, brainProducto: null as null | { mostrar(h: string): void }, brainEspecificaciones: null as null | { mostrar(f?: string | null): void }, FLOWBRAIN_EDICION: opciones.edicion, scrollTo() {} };
  const bajados: Array<{ nombre: string; texto: () => Promise<string> }> = [];
  const documento = { getElementById: el, body: { appendChild() {}, removeChild() {} }, createElement: () => ({ href: "", download: "", click() { const h = this.href; bajados.push({ nombre: this.download, texto: () => resolveObjectURL(h)!.text() }); } }) };
  const raiz = el("producto");
  const especs = el("especificaciones");
  let html = "", htmlEs = "";
  Object.defineProperty(raiz, "innerHTML", {
    get: () => html,
    set: (v: string) => {
      html = v;
      const i = v.indexOf('<div id="tarjetas">');
      el("tarjetas").innerHTML = i < 0 ? "" : v.slice(i);
    },
  });
  Object.defineProperty(especs, "innerHTML", {
    get: () => htmlEs,
    set: (v: string) => {
      htmlEs = v;
      const i = v.indexOf('<div id="es-lista">');
      el("es-lista").innerHTML = i < 0 ? "" : v.slice(i);
    },
  });
  new Function("window", "document", "sessionStorage", FILTROS_JS)(window, documento, sessionStorage);
  new Function("window", "document", "localStorage", "fetch", PEDIDO_JS)(window, documento, localStorage, opciones.fetch);
  new Function("window", "document", "sessionStorage", PRODUCTO_JS)(window, documento, sessionStorage);
  new Function("window", "document", "sessionStorage", "localStorage", "fetch", ESPECIFICACIONES_JS)(window, documento, sessionStorage, localStorage, opciones.fetch);
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs }) });
  const botones = (h: string) => [...h.matchAll(/data-acc="pedir" data-tipo="([^"]+)" data-k="([^"]+)" data-et="([^"]+)" aria-pressed="(true|false)"/g)].map((m) => ({ tipo: m[1], k: m[2], et: m[3], ya: m[4] === "true" }));
  return {
    ir: (h: string) => window.brainProducto!.mostrar(h),
    especificaciones: () => { window.brainEspecificaciones!.mostrar(); return htmlEs; },
    pagina: () => raiz.innerHTML,
    botones: () => botones(raiz.innerHTML),
    botonesEs: () => botones(htmlEs),
    tocar: (attrs: Record<string, string>) => (DEL_PEDIDO.has(attrs["data-acc"] ?? "") ? el(attrs["data-acc"] === "panel" ? "pedido-bandeja" : "pedido-panel") : raiz).oyentes["click"]!({ target: boton(attrs) }),
    panel: () => el("pedido-panel").innerHTML,
    bandeja: () => el("pedido-bandeja").innerHTML,
    local,
    bajados,
  };
}

const feat = (id: string, extra: Record<string, unknown> = {}) => ({
  id, expone: [], usa: [], datos: [], usaFuncionalidades: [], usadaPor: [], codigo: [], archivos: 3, recorridos: [], dominio: [], implementan: [], tests: [], cuerpo: "", casos: [], especificaciones: [], ...extra,
});
// feat-pagos en dos cerebros: en front con descripción, en back sin; feat-envios (front) sin descripción ni nada escrito.
const conFuncionalidades = () => ({
  cerebros: [{ nombre: "front" }, { nombre: "back" }],
  nodes: [{ id: "front/feat-pagos", n: "Pagos", c: 0, r: "Cobrar el carrito." }, { id: "back/feat-pagos", n: "Pagos", c: 1, r: "Draft: generado" }, { id: "front/feat-envios", n: "Envíos", c: 0 }],
  edges: [],
  funcionalidades: [
    feat("front/feat-pagos", { especificaciones: [{ id: "vencida", texto: "No se paga con tarjeta vencida.", tipo: "negocio", estado: "propuesta", archivos: [], tests: [], rotos: [] }] }),
    feat("back/feat-pagos"),
    feat("front/feat-envios", { expone: ["front/svc:GET:/envios"] }),
  ],
});
// Sin ninguna funcionalidad: dos cerebros, cada uno con su repo.
const vacio = () => ({ cerebros: [{ nombre: "tienda" }, { nombre: "admin" }], nodes: [{ id: "tienda/repo-api", n: "repo-api", t: "repo", c: 0 }, { id: "admin/repo-admin", n: "repo-admin", t: "repo", c: 1 }], edges: [], funcionalidades: [] });
const agente = { proveedores: [{ id: "claude-code", nombre: "Claude Code", modelos: [{ id: "claude-opus-5-5", nombre: "Opus 5.5", porDefecto: true, costoPorPaginaUsd: { agrupar: 0.15, escribir: 1.2, corregir: 0.25, funcionalidad: 0.22, proponer: 2.5 } }] }] };
const responder = (pedidos: Array<{ url: string; cuerpo: Record<string, unknown> | null }>): Fetch => (url, init) => {
  pedidos.push({ url, cuerpo: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null });
  const json = url === "/api/agente/lote" ? { lote: { id: "l1", tipo: "funcionalidad", estado: "corriendo" }, trabajos: [] } : { trabajos: [], lotes: [] };
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
};
const listo = () => new Promise((r) => setTimeout(r, 0));

describe("Funcionalidades: el pedido al agente", () => {
  it("el catálogo pide las fichas sin descripción de la lista («Request the 2») y las suma al panel único", () => {
    const v = montar(conFuncionalidades());
    v.ir("");
    expect(v.botones()).toEqual([{ tipo: "funcionalidad", k: "sindesc", et: "Request the 2", ya: false }]);
    v.tocar({ "data-acc": "pedir", "data-tipo": "funcionalidad", "data-k": "sindesc" });
    expect(v.panel()).toContain("2 tasks");
    expect(v.panel()).toContain("Pagos");
    expect(v.panel()).toContain("Envíos");
    expect(v.panel()).toContain("Only drafts in _drafts/product/");
    expect(cuentaAgente(v.bandeja())).toBe("2");
    // Tocarlo otra vez lo saca.
    v.tocar({ "data-acc": "pedir", "data-tipo": "funcionalidad", "data-k": "sindesc" });
    expect(cuentaAgente(v.bandeja())).toBe("");
  });

  it("la ficha pide su descripción y los casos de uso con la misma clave que Especificaciones", () => {
    const v = montar(conFuncionalidades());
    v.ir("/f/front/feat-envios");
    expect(v.botones()).toEqual([
      { tipo: "funcionalidad", k: "f|front/feat-envios", et: "Request description", ya: false },
      { tipo: "escribir", k: "escribir|feat-envios", et: "Request use cases and specifications", ya: false },
    ]);
    v.tocar({ "data-acc": "pedir", "data-tipo": "escribir", "data-k": "escribir|feat-envios" });
    expect(v.panel()).toContain('data-tipo="escribir"');
    expect(v.panel()).toContain("Envíos");
    // En Especificaciones, el mismo botón ya dice «✔ En el pedido».
    v.especificaciones();
    expect(v.botonesEs().find((b) => b.k === "escribir|feat-envios")).toMatchObject({ tipo: "escribir", ya: true });
    // Una ficha con descripción no la pide; una con reglas en otro cerebro no pide casos de uso.
    v.ir("/f/front/feat-pagos");
    expect(v.botones()).toEqual([]);
    v.ir("/f/back/feat-pagos");
    expect(v.botones()).toEqual([{ tipo: "funcionalidad", k: "f|back/feat-pagos", et: "Request description", ya: false }]);
  });

  it("«Request all» manda un lote «funcionalidad» con las fichas, y el costo se estima por ítem", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown> | null }> = [];
    const v = montar(conFuncionalidades(), { edicion: { token: "t", agente }, fetch: responder(pedidos) });
    v.ir("/f/front/feat-envios");
    v.tocar({ "data-acc": "pedir", "data-tipo": "funcionalidad", "data-k": "f|front/feat-envios" });
    expect(v.botones()[0]).toMatchObject({ k: "f|front/feat-envios" });
    expect(v.panel()).toContain("≈ US$ 0.22");
    v.tocar({ "data-acc": "pedir-todos" });
    await listo();
    const lote = pedidos.find((p) => p.url === "/api/agente/lote")!.cuerpo!;
    expect(lote).toMatchObject({ tipo: "funcionalidad", proveedor: "claude-code", modelo: "claude-opus-5-5" });
    expect(lote["items"]).toEqual([{ cerebro: "front", funcionalidad: "feat-envios", linea: "- feat-envios (today: Envíos), brain front: 1 endpoint, 3 files. No business name or description yet." }]);
  });

  it("lo que ya tiene descripción sale de la lista al cargar", () => {
    const local = new Map([["flowbrain.pedido", JSON.stringify({ v: 1, items: [
      { tipo: "funcionalidad", k: "front/feat-pagos", cerebro: "front", repo: null, datos: { cerebro: "front", funcionalidad: "feat-pagos", nombre: "Pagos", linea: "-" } },
      { tipo: "funcionalidad", k: "front/feat-envios", cerebro: "front", repo: null, datos: { cerebro: "front", funcionalidad: "feat-envios", nombre: "Envíos", linea: "-" } },
    ] })]]);
    const v = montar(conFuncionalidades(), { local });
    v.ir("");
    expect(cuentaAgente(v.bandeja())).toBe("1");
    expect(JSON.parse(local.get("flowbrain.pedido")!).items.map((x: { k: string }) => x.k)).toEqual(["front/feat-envios"]);
  });
});

describe("Funcionalidades vacía: proponerlas por cerebro", () => {
  it("cada cerebro tiene su botón, y la terminal queda como alternativa sin agente", () => {
    const v = montar(vacio());
    v.ir("");
    expect(v.botones().map((b) => b.k)).toEqual(["proponer|", "proponer|tienda", "proponer|admin"]);
    expect(v.botones()[1]!.et).toBe("Request the features");
    expect(v.pagina()).toContain("repo-api");
    expect(v.pagina()).toContain("flowbrain draft &lt;repo&gt;");
    expect(v.pagina()).toContain("Without an agent on this machine");
  });

  it("con agente, la terminal va plegada; el lote lleva un ítem por cerebro, sin funcionalidad, y el .md la guía", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown> | null }> = [];
    const v = montar(vacio(), { edicion: { token: "t", agente }, fetch: responder(pedidos) });
    v.ir("");
    expect(v.pagina()).toContain("Or from the terminal");
    v.tocar({ "data-acc": "pedir", "data-tipo": "funcionalidad", "data-k": "proponer|" });
    expect(v.panel()).toContain("2 brains to propose features for");
    expect(v.panel()).toContain("≈ US$ 5.00");
    v.tocar({ "data-acc": "descargar-lista" });
    const md = await v.bajados[0]!.texto();
    expect(v.bajados[0]!.nombre).toBe("funcionalidades.md");
    expect(md).toContain("These 2 FlowBrain brains have no features yet");
    expect(md).toContain("flowbrain features --guide");
    expect(md).toContain("- brain tienda (repos: repo-api): it has no features yet.");
    expect(md).toContain("write ONLY drafts in .flowbrain/<brain>/_drafts/product/");
    v.tocar({ "data-acc": "pedir-todos" });
    await listo();
    expect(pedidos.find((p) => p.url === "/api/agente/lote")!.cuerpo!["items"]).toEqual([
      { cerebro: "admin", linea: "- brain admin (repos: repo-admin): it has no features yet." },
      { cerebro: "tienda", linea: "- brain tienda (repos: repo-api): it has no features yet." },
    ]);
  });

  it("con funcionalidades en un cerebro y no en otro, el catálogo ofrece proponer las del que no tiene", () => {
    const d = conFuncionalidades();
    d.cerebros.push({ nombre: "admin" });
    const v = montar(d);
    v.ir("");
    expect(v.botones().map((b) => b.k)).toEqual(["proponer|admin", "sindesc"]);
    expect(v.pagina()).toContain("The brain admin has no features yet.");
  });
});

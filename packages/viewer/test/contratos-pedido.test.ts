import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import { cuentaAgente } from "./ayuda-agente.js";
import type { Graph, GraphNode } from "@flowbrain/core";
import { datosDeCerebros } from "../src/cerebros.js";
import type { DerivaVisor } from "../src/viewer.js";
import { CONTRATOS_JS } from "../src/viewer-contratos.js";
import { FILTROS_JS } from "../src/viewer-filtros.js";
import { PEDIDO_JS } from "../src/viewer-pedido.js";

/**
 * La deriva de Contratos suma sus problemas al pedido al agente (el componente único, dec. 232) y marca un endpoint
 * «Sin uso a propósito». Se corre la pantalla con un DOM mínimo, junto con el componente del pedido.
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
  const window = { brainVisor: { D: datos, porId, esc }, brainFiltros: null as unknown, brainContratos: null as null | { mostrar(): void }, FLOWBRAIN_EDICION: opciones.edicion };
  const bajados: Array<{ nombre: string; texto: () => Promise<string> }> = [];
  const documento = { getElementById: el, body: { appendChild() {}, removeChild() {} }, createElement: () => ({ href: "", download: "", click() { const h = this.href; bajados.push({ nombre: this.download, texto: () => resolveObjectURL(h)!.text() }); } }) };
  const raiz = el("contratos");
  let html = "";
  Object.defineProperty(raiz, "innerHTML", {
    get: () => html,
    set: (v: string) => {
      html = v;
      const i = v.indexOf('<div id="ct-lista">');
      el("ct-lista").innerHTML = i < 0 ? "" : v.slice(i);
    },
  });
  new Function("window", "document", "sessionStorage", FILTROS_JS)(window, documento, sessionStorage);
  new Function("window", "document", "localStorage", "fetch", PEDIDO_JS)(window, documento, localStorage, opciones.fetch);
  new Function("window", "document", "sessionStorage", CONTRATOS_JS)(window, documento, sessionStorage);
  window.brainContratos!.mostrar();
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs }) });
  return {
    pagina: () => raiz.innerHTML,
    tocar: (attrs: Record<string, string>) => (DEL_PEDIDO.has(attrs["data-acc"] ?? "") ? el(attrs["data-acc"] === "panel" ? "pedido-bandeja" : "pedido-panel") : raiz).oyentes["click"]!({ target: boton(attrs) }),
    panel: () => el("pedido-panel").innerHTML,
    bandeja: () => el("pedido-bandeja").innerHTML,
    bajados,
    // Los data-k de los botones «Pedir» de la página, en orden.
    botones: () => [...raiz.innerHTML.matchAll(/data-acc="pedir" data-tipo="deriva" data-k="([^"]+)"/g)].map((m) => m[1]!.replace(/&#124;/g, "|").replace(/&#36;/g, "$")),
  };
}

const nodo = (id: string, tipo: GraphNode["tipo"], atributos: Record<string, unknown> = {}): GraphNode => ({ actualizado: null, aliases: [], atributos, estado: "vigente", id, nombre: id, origen: "parser", pagina: null, resumen: null, tecnologia: [], tipo, verificado: null });
const graph: Graph = {
  version: 1,
  nodes: [nodo("svc-api", "svc"), nodo("svc-web", "svc"), nodo("svc-api:GET:/salud", "endpoint", { metodo: "GET", ruta: "/salud" }), nodo("svc-api:POST:/hook", "endpoint", { metodo: "POST", ruta: "/hook" }), nodo("svc-api:GET:/pedidos", "endpoint", { metodo: "GET", ruta: "/pedidos" })],
  edges: [],
};
const deriva: DerivaVisor = {
  llamadasSinEndpoint: [{ desde: "svc-web", llamada: "GET ${API}/pedido-viejo", ev: "repo-web:src/cliente.ts#L6", existeConOtroMetodo: ["svc-api:GET:/pedidos"] }],
  llamadasAmbiguas: [],
  endpointsSinLlamadasDetectadas: [{ endpoint: "svc-api:GET:/salud", ev: "repo-api:src/app.ts#L5" }, { endpoint: "svc-api:POST:/hook", ev: "repo-api:src/app.ts#L4" }],
  consumidoresIndexados: { "svc-api": ["svc-web"] },
  campos: { llamadasUnidas: 1, comparadas: 1, sinDiferencias: 0, conDiferencias: 1, noComparables: [] },
  camposQueNoCoinciden: [{ llamada: "GET /pedidos", ev: "repo-web:src/cliente.ts#L3", endpoint: "svc-api:GET:/pedidos", evEndpoint: "repo-api:src/app.ts#L3", respuesta: { front: "Pedido", back: "PedidoDto", esperaYNoViene: ["total"] } }],
  avisos: [],
};
const datos = (d: DerivaVisor = deriva) => datosDeCerebros([{ nombre: "tienda", sinRevisar: false, graph, funcionalidades: [], deriva: d }], [], []) as unknown as Record<string, unknown>;
const agente = { proveedores: [{ id: "claude-code", nombre: "Claude Code", modelos: [{ id: "claude-opus-5-5", nombre: "Opus 5.5", porDefecto: true, costoPorDerivaUsd: 0.3 }] }] };
const K_ROTA = "p|sinEndpoint|0|repo-web:src/cliente.ts#L6|GET ${API}/pedido-viejo";
const responder = (pedidos: Array<{ url: string; cuerpo: Record<string, unknown> | null }>, extra: Record<string, unknown> = {}): Fetch => (url, init) => {
  pedidos.push({ url, cuerpo: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null });
  const json = url === "/api/agente/lote" ? { lote: { id: "l1", tipo: "deriva", estado: "corriendo" }, trabajos: [] } : url === "/api/editar" ? { escrito: "tienda/not-product.yaml", ...extra } : { trabajos: [], lotes: [] };
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
};

describe("Contratos: la deriva en el pedido al agente", () => {
  it("cada problema y cada sección tiene su botón celeste «Pedir»; el endpoint sin llamadas, también por servicio", () => {
    const v = montar(datos());
    expect(v.botones()).toEqual(["s|sinEndpoint", K_ROTA, "s|sinLlamadas", "g|0|tienda/svc-api", "p|sinLlamadas|0|tienda/svc-api:GET:/salud", "p|sinLlamadas|0|tienda/svc-api:POST:/hook", "s|campos", "p|campos|0|repo-web:src/cliente.ts#L3|GET /pedidos"]);
    expect(v.pagina()).toContain("Request the 2");
    // Sin servidor no se puede marcar: sí sumar (sale como .md).
    expect(v.pagina()).not.toContain('data-acc="sin-uso"');
  });

  it("«Pedir» suma la tarjeta (qué está roto, dónde, Quitar) y el botón pasa a «✔ En el pedido»; el .md lleva las reglas", async () => {
    const v = montar(datos());
    v.tocar({ "data-acc": "pedir", "data-tipo": "deriva", "data-k": K_ROTA });
    expect(v.panel()).toContain("Nobody handles them");
    expect(v.panel()).toContain("<code>repo-web:src/cliente.ts#L6</code>");
    expect(v.panel()).toContain('data-acc="quitar" data-tipo="deriva"');
    expect(cuentaAgente(v.bandeja())).toBe("1");
    v.tocar({ "data-acc": "pedir", "data-tipo": "deriva", "data-k": "s|sinLlamadas" });
    expect(cuentaAgente(v.bandeja())).toBe("3");
    v.tocar({ "data-acc": "descargar-lista" });
    expect(v.bajados[0]!.nombre).toBe("drift-fixes.md");
    const md = await v.bajados[0]!.texto();
    expect(md).toContain("# Contract drift to fix");
    expect(md).toContain("**Never make a destructive change.**");
    expect(md).toContain("- **endpoint nobody calls**: Look for who uses it");
    expect(md).toContain("### tienda / repo-api");
    expect(md).toContain("- [ ] call nobody serves: GET ${API}/pedido-viejo at repo-web:src/cliente.ts#L6. Nobody serves this call, made from svc-web. It exists with another method: GET /pedidos.");
    expect(md).toContain("- [ ] endpoint nobody calls: svc-api:GET:/salud at repo-api:src/app.ts#L5. No indexed consumer calls this endpoint (its service is called by svc-web).");
    expect(md).toContain("## When done");
  });

  it("servida con un agente: estima el costo por problema y «Pedir todos» manda un lote «deriva»", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown> | null }> = [];
    const v = montar(datos(), { edicion: { token: "t", agente }, fetch: responder(pedidos) });
    v.tocar({ "data-acc": "pedir", "data-tipo": "deriva", "data-k": K_ROTA });
    v.tocar({ "data-acc": "pedir", "data-tipo": "deriva", "data-k": "s|campos" });
    expect(v.panel()).toContain("≈ US$ 0.60");
    expect(v.panel()).toContain("In 1 batch of up to 10 problems of the same repo");
    v.tocar({ "data-acc": "pedir-todos" });
    await new Promise((ok) => setTimeout(ok, 0));
    const lote = pedidos.find((p) => p.url === "/api/agente/lote")!.cuerpo!;
    expect(lote).toMatchObject({ tipo: "deriva", proveedor: "claude-code", modelo: "claude-opus-5-5" });
    expect(lote["problemas"]).toEqual([
      { cerebro: "tienda", clase: "sinEndpoint", ev: "repo-web:src/cliente.ts#L6", llamada: "GET ${API}/pedido-viejo", que: "Nobody serves this call, made from svc-web. It exists with another method: GET /pedidos." },
      { cerebro: "tienda", clase: "campos", ev: "repo-web:src/cliente.ts#L3", llamada: "GET /pedidos", que: "Response (Pedido -> PedidoDto): expected but missing: total. Endpoint svc-api:GET:/pedidos, handled at repo-api:src/app.ts#L3." },
    ]);
  });

  it("«Sin uso a propósito» guarda la marca, saca el endpoint de la deriva y del pedido, y se deshace desde la misma pantalla", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown> | null }> = [];
    const v = montar(datos(), { edicion: { token: "t", agente }, fetch: responder(pedidos) });
    const k = "sinLlamadas|0|tienda/svc-api:POST:/hook";
    v.tocar({ "data-acc": "pedir", "data-tipo": "deriva", "data-k": "p|" + k });
    expect(cuentaAgente(v.bandeja())).toBe("1");
    v.tocar({ "data-acc": "sin-uso", "data-k": k });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(pedidos.find((p) => p.url === "/api/editar")!.cuerpo).toEqual({ tipo: "no_producto", cerebro: "tienda", entrada: "svc-api:POST:/hook", motivo: "sin-uso" });
    expect(v.botones()).not.toContain("p|" + k);
    expect(v.pagina()).toContain("Unused on purpose");
    expect(v.pagina()).toContain("is marked as unused on purpose and left the drift");
    expect(v.pagina()).toContain('data-acc="deshacer-sin-uso" data-c="0" data-e="tienda/svc-api:POST:/hook"');
    expect(cuentaAgente(v.bandeja())).not.toBe("1");
    v.tocar({ "data-acc": "deshacer-sin-uso", "data-c": "0", "data-e": "tienda/svc-api:POST:/hook" });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(pedidos.filter((p) => p.url === "/api/editar")[1]!.cuerpo).toEqual({ tipo: "no_producto", cerebro: "tienda", entrada: "svc-api:POST:/hook", motivo: null });
    expect(v.botones()).toContain("p|" + k);
    expect(v.pagina()).not.toContain('data-acc="deshacer-sin-uso"');
  });

  it("lo que llega ya marcado se lista aparte y se deshace; si alguien lo llama, no vuelve a la deriva", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown> | null }> = [];
    const marcada = { ...deriva, endpointsSinLlamadasDetectadas: [deriva.endpointsSinLlamadasDetectadas[0]!], sinUsoAProposito: [{ endpoint: "svc-api:POST:/hook", ev: "repo-api:src/app.ts#L4", nadieLoLlama: false }] };
    const v = montar(datos(marcada), { edicion: { token: "t", agente }, fetch: responder(pedidos) });
    expect(v.pagina()).toContain("Unused on purpose");
    v.tocar({ "data-acc": "deshacer-sin-uso", "data-c": "0", "data-e": "tienda/svc-api:POST:/hook" });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(v.botones()).not.toContain("p|sinLlamadas|0|tienda/svc-api:POST:/hook");
    expect(v.pagina()).toContain("is no longer marked.");
  });

  it("al cargar, lo que ya no está en la deriva sale del pedido guardado", () => {
    const local = new Map<string, string>();
    const v = montar(datos(), { local });
    v.tocar({ "data-acc": "pedir", "data-tipo": "deriva", "data-k": K_ROTA });
    const sin = { ...deriva, llamadasSinEndpoint: [] };
    const otra = montar(datos(sin), { local });
    expect(cuentaAgente(otra.bandeja())).not.toBe("1");
  });
});

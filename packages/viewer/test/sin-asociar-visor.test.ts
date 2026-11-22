import { describe, expect, it } from "vitest";
import { SIN_ASOCIAR_JS } from "../src/viewer-sin-asociar.js";

/** La pantalla Sin asociar, corrida con un DOM mínimo: qué agrupa, qué recomienda, qué dice cuando no hay nada y qué manda al asociar. */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
function montar(datos: Record<string, unknown>, opciones: { edicion?: unknown; fetch?: (url: string, init: { method: string; body: string; headers: Record<string, string> }) => Promise<unknown> } = {}) {
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
  const window = { brainVisor: { D: datos, porId, esc }, brainSinAsociar: null as null | { mostrar(): void }, FLOWBRAIN_EDICION: opciones.edicion };
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
    { a: `${W}src/shared/dinero.ts`, l: "ts", k: "otros", g: ["front/feat-pagos", "lo importan 2 archivos de Pagos"], o: [["front/feat-envios", "importa 1 archivo de Envíos"]], cl: 1, c: 0 },
    { a: `${W}src/shared/moneda.ts`, l: "ts", k: "otros", g: ["front/feat-pagos", "lo importa 1 archivo de Pagos"], cl: 1, c: 0 },
    { a: `${W}src/shared/fecha.ts`, l: "ts", k: "otros", m: 3, cl: 1, c: 0 },
    { a: `${W}src/pagos/nota.ts`, l: "ts", k: "logica", g: ["front/feat-pagos", "4 vecinos de carpeta son de Pagos"], c: 0 },
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
    expect([...p.matchAll(/<div class="fd-cifra"><b[^>]*>(\d+)<\/b>/g)].map((m) => m[1])).toEqual(["5", "3", "1", "1", "3"]);
    expect(p).toContain('→ <a href="#/f/front%2Ffeat-pagos">Pagos</a></span> <small>lo importan 2 archivos de Pagos</small>');
    // La carpeta tiene recomendada porque la votan más de la mitad de sus archivos.
    expect(p).toContain("Recomendada: Pagos (2 de 3)");
    expect(p).toContain("Código compartido</span> <small>Lo usan 3 funcionalidades");
    expect(p).toContain("Sin pista</span> <small>Nada lo une a una funcionalidad");
    // Sin servidor es de solo lectura: lo dice y no ofrece asociar.
    expect(p).toContain("flowbrain viewer --serve");
    expect(p).not.toContain('data-acc="asociar');
  });

  it("filtra por tipo de pista, recomendada, cerebro y texto; un vacío dice por qué", () => {
    const v = montar(datos());
    v.tocar({ "data-ver": "compartido" });
    expect(v.archivos()).toEqual(["fecha.ts"]);
    v.tocar({ "data-ver": "sinpista" });
    expect(v.archivos()).toEqual(["Texto.php"]);
    v.cambiar("sa-cerebro", "0");
    expect(v.lista()).toContain("Ningún archivo coincide con sin pista, cerebro front. Hay 5 archivos sin asociar en total.");
    v.tocar({ "data-acc": "limpiar" });
    v.cambiar("sa-feat-filtro", "front/feat-pagos");
    expect(v.archivos()).toEqual(["dinero.ts", "moneda.ts", "nota.ts"]);
    v.cambiar("sa-feat-filtro", "");
    v.escribir("util");
    expect(v.archivos()).toEqual(["Texto.php"]);
  });

  it("arma el pedido para el agente con los archivos de la lista y su recomendación", () => {
    const v = montar(datos());
    v.tocar({ "data-acc": "pedido" });
    const l = v.lista();
    expect(l).toContain("Asociá estos 5 archivos");
    expect(l).toContain("- repo-web:src/shared/dinero.ts (cerebro front): recomendada feat-pagos (lo importan 2 archivos de Pagos); otras: feat-envios");
    expect(l).toContain("- repo-web:src/shared/fecha.ts (cerebro front): código compartido, lo usan 3 funcionalidades");
    expect(l).toContain("- repo-api:src/Util/Texto.php (cerebro back): sin pista");
  });

  it("sin índice, sin funcionalidades o sin nada que asociar explica qué pasa", () => {
    const d = datos();
    expect(montar({ ...d, sinAsociar: null }).pagina()).toContain("No hay índice de código");
    expect(montar({ ...d, funcionalidades: [] }).pagina()).toContain("Todavía no hay funcionalidades");
    expect(montar({ ...d, sinAsociar: [] }).pagina()).toContain("Todos los archivos del índice son de alguna funcionalidad o librería");
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
    expect(l).toContain(`data-acc="asociar" data-f="front/feat-pagos" data-a="${W}src/shared/dinero.ts">Asociar a Pagos</button>`);
    // La otra candidata, como botón secundario; y la carpeta libre se puede asociar entera.
    expect(l).toContain(`data-acc="asociar" data-f="front/feat-envios" title="importa 1 archivo de Envíos" data-a="${W}src/shared/dinero.ts">Envíos</button>`);
    expect(l).toContain(`data-acc="asociar-carpeta" data-k="0|${W}src/shared" data-f="front/feat-pagos">Asociar la carpeta a Pagos</button>`);
    // En src/pagos ya hay archivos con dueño: se asocia de a uno, y se dice.
    expect(l).not.toContain(`data-k="0|${W}src/pagos"`);
    expect(l).toContain("acá se asocia de a uno");

    v.tocar({ "data-acc": "asociar", "data-a": `${W}src/pagos/nota.ts`, "data-f": "front/feat-pagos" });
    await esperar();
    // Viajan los ids del cerebro, sin el prefijo del visor.
    expect(pedidos[0]).toEqual({ url: "/api/editar", token: "secreto", tipo: "funcionalidad", cerebro: "front", archivo: "repo-web:src/pagos/nota.ts", funcionalidad: "feat-pagos" });
    expect(v.archivos()).toEqual(["dinero.ts", "moneda.ts", "fecha.ts", "Texto.php"]);
    expect(v.lista()).toContain("Ahora es parte de Pagos. (front/product/feat-pagos.md)");

    v.tocar({ "data-acc": "asociar-carpeta", "data-k": `0|${W}src/shared`, "data-f": "front/feat-pagos" });
    await esperar();
    expect(pedidos[1]).toMatchObject({ archivo: "repo-web:src/shared/dinero.ts", funcionalidad: "feat-pagos", entrada: "repo-web:src/shared" });
    expect(v.archivos()).toEqual(["Texto.php"]);
    expect(v.lista()).toContain("3 archivos salieron de la lista.");

    // Sin pista: se elige a mano, entre las funcionalidades de su mismo cerebro.
    v.tocar({ "data-acc": "otra", "data-k": "back/repo-api:src/Util/Texto.php" });
    expect(v.lista()).toContain('<option value="back/feat-stock">Stock</option>');
    expect(v.lista()).not.toContain("front/feat-envios");
    v.poner("sa-feat", "back/feat-stock");
    v.tocar({ "data-acc": "asociar-elegida", "data-k": "back/repo-api:src/Util/Texto.php" });
    await esperar();
    expect(pedidos[2]).toMatchObject({ cerebro: "back", archivo: "repo-api:src/Util/Texto.php", funcionalidad: "feat-stock" });
    expect(v.pagina()).toContain("Listo: ya no queda ningún archivo sin asociar.");
  });
});

import { describe, expect, it } from "vitest";
import { ESPECIFICACIONES_JS } from "../src/viewer-especificaciones.js";

/** La pantalla Especificaciones, corrida con un DOM mínimo: qué lista, cómo filtra, qué dice cuando falta algo y qué manda al confirmar. */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
function montar(datos: Record<string, unknown>, opciones: { edicion?: unknown; fetch?: (url: string, init: { method: string; body: string; headers: Record<string, string> }) => Promise<unknown> } = {}) {
  const guardado = new Map<string, string>();
  const sessionStorage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
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
  const window = { brainVisor: { D: datos, porId, esc }, brainEspecificaciones: null as null | { mostrar(f?: string | null): void }, FLOWBRAIN_EDICION: opciones.edicion, scrollTo() {} };
  new Function("window", "document", "sessionStorage", "fetch", ESPECIFICACIONES_JS)(window, { getElementById: el }, sessionStorage, opciones.fetch);
  const raiz = el("especificaciones");
  let html = "";
  Object.defineProperty(raiz, "innerHTML", {
    get: () => html,
    set: (v: string) => {
      html = v;
      const i = v.indexOf('<div id="es-lista">');
      el("es-lista").innerHTML = i < 0 ? "" : v.slice(i);
    },
  });
  window.brainEspecificaciones!.mostrar();
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs }) });
  return {
    pagina: () => raiz.innerHTML,
    lista: () => el("es-lista").innerHTML,
    textos: () => [...el("es-lista").innerHTML.matchAll(/<p class="es-texto">([^<]+)<\/p>/g)].map((m) => m[1]),
    cambiar: (id: string, value: string) => raiz.oyentes["change"]!({ target: { id, value } }),
    escribir: (value: string) => raiz.oyentes["input"]!({ target: { id: "es-q", value } }),
    tocar: (attrs: Record<string, string>) => raiz.oyentes["click"]!({ target: boton(attrs) }),
  };
}

const caso = (nombre: string, linea: number) => ({ nombre, linea });
const ficha = (id: string, especificaciones: unknown[], tests: unknown[] = []) => ({ id, especificaciones, tests });
const TEST_PAGOS = "front/repo-web:src/pagos/cobrar.test.ts";
const datos = () => ({
  cerebros: [{ nombre: "front" }, { nombre: "back" }],
  nodes: [{ id: "front/feat-pagos", n: "Pagos", c: 0 }, { id: "front/feat-envios", n: "Envíos", c: 0 }, { id: "back/feat-stock", n: "Stock", c: 1 }],
  funcionalidades: [
    ficha(
      "front/feat-pagos",
      [
        { id: "tarjeta-vencida", texto: "No se puede pagar con una tarjeta vencida.", tipo: "negocio", estado: "confirmada", archivos: ["front/repo-web:src/pagos/cobrar.ts#L4"], tests: [{ archivo: TEST_PAGOS, caso: "rechaza una tarjeta vencida", linea: 3 }], rotos: [] },
        { id: "motivo", texto: "Si el pago falla se muestra el motivo.", tipo: "producto", estado: "propuesta", archivos: [], tests: [], rotos: ["front/repo-web:src/pagos/viejo.test.ts::muestra el motivo"] },
      ],
      [{ archivo: TEST_PAGOS, por: "ubicacion", casos: [caso("rechaza una tarjeta vencida", 3), caso("avisa por mail", 15)] }],
    ),
    ficha("front/feat-envios", [], [{ archivo: "front/repo-web:src/envios/enviar.test.ts", por: "ubicacion", casos: [caso("calcula el costo", 2)] }]),
    ficha("back/feat-stock", [{ id: "sin-stock", texto: "No se vende lo que no hay.", tipo: "negocio", estado: "propuesta", archivos: ["back/repo-api:src/Stock.php"], tests: [{ archivo: "back/repo-api:tests/StockTest.php", casos: 4 }], rotos: [] }]),
  ],
});

describe("pantalla Especificaciones", () => {
  it("lista cada funcionalidad con sus requisitos en llano, el archivo que los cumple y el test que los verifica", () => {
    const v = montar(datos());
    expect(v.textos()).toEqual(["No se puede pagar con una tarjeta vencida.", "Si el pago falla se muestra el motivo.", "No se vende lo que no hay."]);
    const p = v.pagina();
    // Cifras: 3 especificaciones, 1 confirmada, 1 sin test, 1 caso suelto, 1 funcionalidad sin ninguna.
    expect([...p.matchAll(/<div class="fd-cifra"><b[^>]*>(\d+)<\/b>/g)].map((m) => m[1])).toEqual(["3", "1", "1", "1", "1"]);
    expect(p).toContain("<code title=\"repo-web:src/pagos/cobrar.ts#L4\">src/pagos/cobrar.ts#L4</code>");
    expect(p).toContain("rechaza una tarjeta vencida <small><code>src/pagos/cobrar.test.ts</code> L3</small>");
    expect(p).toContain("Todo el archivo (4 casos)");
    // Lo que falta se dice: sin test, referencia rota, caso de test suelto y la funcionalidad que no tiene ninguna.
    expect(p).toContain('<span class="fd-es no">Sin test</span>');
    expect(p).toContain("El índice ya no encuentra <code>repo-web:src/pagos/viejo.test.ts::muestra el motivo</code>");
    expect(p).toContain("1 caso de test no verifica ninguna especificación");
    expect(p).toContain("avisa por mail");
    expect(p).toContain("Sin especificaciones (1)");
    expect(p).toContain('<a href="#/f/front/feat-envios">Envíos</a> <small>1 caso de test · front</small>');
    // Sin servidor es de solo lectura: lo dice y no ofrece confirmar.
    expect(p).toContain("flowbrain viewer --serve");
    expect(p).not.toContain('data-acc="estado"');
  });

  it("filtra por estado, tipo, cerebro y texto, y un vacío dice por qué", () => {
    const v = montar(datos());
    v.tocar({ "data-grupo": "propuesta" });
    expect(v.textos()).toEqual(["Si el pago falla se muestra el motivo.", "No se vende lo que no hay."]);
    v.tocar({ "data-grupo": "sintest" });
    expect(v.textos()).toEqual(["Si el pago falla se muestra el motivo."]);
    v.cambiar("es-tipo", "negocio");
    expect(v.lista()).toContain("Ninguna especificación coincide con sin test, tipo negocio. Hay 3 especificaciones en total.");
    v.tocar({ "data-acc": "limpiar" });
    v.cambiar("es-cerebro", "1");
    expect(v.textos()).toEqual(["No se vende lo que no hay."]);
    expect(v.pagina()).not.toContain("Sin especificaciones (");
    v.cambiar("es-cerebro", "");
    v.escribir("vencida");
    expect(v.textos()).toEqual(["No se puede pagar con una tarjeta vencida."]);
    expect(v.lista()).toContain("1 de 2 especificaciones");
  });

  it("arma el pedido para el agente con las funcionalidades que no tienen ninguna", () => {
    const v = montar(datos());
    v.tocar({ "data-acc": "pedido", "data-f": "" });
    const l = v.lista();
    expect(l).toContain("flowbrain specs --guide");
    expect(l).toContain("- feat-envios (Envíos), cerebro front: 1 caso de test.");
    expect(l).toContain("No se pudo copiar solo");
    v.tocar({ "data-acc": "pedido", "data-f": "" });
    expect(v.lista()).not.toContain("Pedido para el agente");
  });

  it("sin especificaciones o sin funcionalidades explica qué hacer", () => {
    const d = datos();
    const sin = montar({ ...d, funcionalidades: d.funcionalidades.map((f) => ({ ...f, especificaciones: [] })) }).pagina();
    expect(sin).toContain("Todavía no hay ninguna especificación escrita");
    expect(sin).toContain("Sin especificaciones (3)");
    expect(montar({ ...d, funcionalidades: [] }).pagina()).toContain("No hay funcionalidades");
    // Un visor generado antes de esta versión no trae el campo: se lee como "ninguna", no rompe.
    expect(montar({ ...d, funcionalidades: [{ id: "front/feat-pagos" }] }).pagina()).toContain("Sin especificaciones (1)");
  });

  it("con el servidor, confirmar manda la edición con los ids del cerebro y se refleja sin recargar", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown>; token: string | undefined }> = [];
    const fetch = (url: string, init: { method: string; body: string; headers: Record<string, string> }) => {
      pedidos.push({ url, cuerpo: JSON.parse(init.body) as Record<string, unknown>, token: init.headers["x-flowbrain-token"] });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mensaje: "La especificación motivo de Pagos quedó confirmada.", escrito: "front/product/feat-pagos.md", cambio: true }) });
    };
    const v = montar(datos(), { edicion: { token: "secreto", sinAplicar: [] }, fetch });
    expect(v.pagina()).not.toContain("solo lectura");
    expect(v.lista()).toContain('data-acc="estado" data-f="front/feat-pagos" data-id="motivo" data-estado="confirmada"');
    expect(v.lista()).toContain('data-id="tarjeta-vencida" data-estado="propuesta"');
    v.tocar({ "data-acc": "estado", "data-f": "front/feat-pagos", "data-id": "motivo", "data-estado": "confirmada" });
    await new Promise((r) => setTimeout(r, 0));
    expect(pedidos).toEqual([{ url: "/api/editar", cuerpo: { tipo: "especificacion", cerebro: "front", funcionalidad: "feat-pagos", id: "motivo", estado: "confirmada" }, token: "secreto" }]);
    expect(v.lista()).toContain("La especificación motivo de Pagos quedó confirmada. (front/product/feat-pagos.md)");
    expect(v.lista()).toContain('data-id="motivo" data-estado="propuesta"');
    expect([...v.pagina().matchAll(/<div class="fd-cifra"><b[^>]*>(\d+)<\/b>/g)].map((m) => m[1])[1]).toBe("2");
  });
});

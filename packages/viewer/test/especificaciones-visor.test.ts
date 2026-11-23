import { describe, expect, it } from "vitest";
import { ESPECIFICACIONES_JS } from "../src/viewer-especificaciones.js";

/** La pantalla Especificaciones, corrida con un DOM mínimo: casos de uso unidos entre cerebros, filtros, lo que falta y "Esto está mal". */
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
  let borrador = "";
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
    casos: () => [...el("es-lista").innerHTML.matchAll(/<p class="es-nombre">([^<]+)<\/p>/g)].map((m) => m[1]),
    reglas: () => [...el("es-lista").innerHTML.matchAll(/<p class="es-texto">([^<]+?) <span/g)].map((m) => m[1]),
    cambiar: (id: string, value: string) => raiz.oyentes["change"]!({ target: { id, value } }),
    escribir: (value: string, id = "es-q") => { borrador = value; raiz.oyentes["input"]!({ target: { id, value } }); },
    tocar: (attrs: Record<string, string>) => raiz.oyentes["click"]!({ target: boton(attrs) }),
  };
}

const caso = (nombre: string, linea: number) => ({ nombre, linea });
const regla = (id: string, texto: string, archivos: string[], tests: unknown[]) => ({ id, texto, tipo: "negocio", estado: "propuesta", archivos, tests, rotos: [] });
const T = (archivo: string, caso: string, linea: number) => ({ archivo, caso, linea });
// La misma funcionalidad (feat-pagos) en dos cerebros, con el caso "pagar" en los dos; feat-envios sin nada escrito.
const datos = () => ({
  cerebros: [{ nombre: "front" }, { nombre: "back" }],
  nodes: [{ id: "front/feat-pagos", n: "Pagos", c: 0, r: "Cobrar el carrito." }, { id: "back/feat-pagos", n: "Pagos", c: 1 }, { id: "front/feat-envios", n: "Envíos", c: 0 }],
  funcionalidades: [
    {
      id: "front/feat-pagos",
      especificaciones: [
        regla("vencida", "No se puede pagar con una tarjeta vencida.", ["front/repo-web:src/pagos/cobrar.ts#L4"], [T("front/repo-web:src/pagos/cobrar.test.ts", "rechaza una tarjeta vencida", 3)]),
        regla("motivo", "Si el pago falla se muestra el motivo.", ["front/repo-web:src/pagos/Error.tsx"], []),
        regla("suelta", "El botón de pagar se ve abajo.", ["front/repo-web:src/pagos/Boton.tsx"], []),
      ],
      casos: [
        { id: "pagar", nombre: "Pagar el carrito", quien: "Cliente", especificaciones: ["vencida", "motivo"] },
        { id: "ver-recibo", nombre: "Ver el recibo", especificaciones: [] },
      ],
      tests: [{ archivo: "front/repo-web:src/pagos/cobrar.test.ts", por: "ubicacion", casos: [caso("rechaza una tarjeta vencida", 3)] }],
    },
    {
      id: "back/feat-pagos",
      especificaciones: [regla("cobro-unico", "Un carrito no se cobra dos veces.", ["back/repo-api:src/Cobro.php"], [{ archivo: "back/repo-api:tests/CobroTest.php", casos: 4 }])],
      casos: [{ id: "pagar", nombre: "Pagar el carrito", especificaciones: ["cobro-unico"], problema: "falta el reintento" }],
    },
    { id: "front/feat-envios", especificaciones: [], tests: [{ archivo: "front/repo-web:src/envios/enviar.test.ts", por: "ubicacion", casos: [caso("calcula el costo", 2)] }] },
  ],
});

describe("pantalla Especificaciones", () => {
  it("une la funcionalidad y el caso entre cerebros, con una fila por cerebro y su estado", () => {
    const v = montar(datos());
    const p = v.pagina();
    // Cifras: 2 casos, 0 cumplidos, 1 sin test (pagar: motivo no tiene test), 1 marcado, 1 regla sin caso, 1 funcionalidad sin nada.
    expect([...p.matchAll(/<div class="fd-cifra[^"]*"[^>]*><b[^>]*>(\d+)<\/b>/g)].map((m) => m[1])).toEqual(["2", "0", "1", "1", "1", "1"]);
    // Plegada: el nombre y los números, sin el detalle; una sola "Pagos" con los dos cerebros.
    expect(v.casos()).toEqual([]);
    expect(v.lista().match(/<h3>Pagos<\/h3>/g)).toHaveLength(1);
    expect(v.lista()).toContain('<span class="chip">2 casos de uso</span>');
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    // Lo marcado como mal y lo que falta, primero.
    expect(v.casos()).toEqual(["Pagar el carrito", "Ver el recibo"]);
    const l = v.lista();
    expect(l).toContain("Quién: Cliente");
    expect(l).toContain('<tr><th scope="row">front</th>');
    expect(l).toContain("1 de 2 reglas sin test");
    expect(l).toContain('<tr><th scope="row">back</th><td><code title="repo-api:src/Cobro.php">Cobro.php</code></td><td><span class="es-bien">✔ 1 test</span></td></tr>');
    expect(l).toContain("«falta el reintento» <small>(back)</small>");
    expect(l).toContain("✘ Sin reglas");
    // La regla que ningún caso agrupa se dice, con el pedido para el agente.
    expect(l).toContain("1 regla sin caso de uso");
    expect(v.reglas()).toContain("El botón de pagar se ve abajo.");
    expect(p).toContain("Sin casos de uso ni reglas (1)");
    // Sin servidor es de solo lectura: lo dice y no ofrece marcar.
    expect(p).toContain("flowbrain viewer --serve");
    expect(l).not.toContain('data-acc="marcar"');
  });

  it("filtra por sin test, marcados, cumplidos, cerebro y texto, y un vacío dice por qué", () => {
    const v = montar(datos());
    v.tocar({ "data-acc": "todas" });
    v.tocar({ "data-acc": "grupo", "data-k": "problema" });
    expect(v.casos()).toEqual(["Pagar el carrito"]);
    expect(v.lista()).toContain("Copiar pedido para el agente");
    v.tocar({ "data-acc": "grupo", "data-k": "sintest" });
    expect(v.casos()).toEqual(["Pagar el carrito"]);
    expect(v.reglas()).toContain("El botón de pagar se ve abajo.");
    v.tocar({ "data-acc": "grupo", "data-k": "cumplido" });
    expect(v.lista()).toContain("Nada coincide con los filtros: cumplidos. Hay 2 casos de uso en total.");
    v.tocar({ "data-acc": "limpiar" });
    v.cambiar("es-cerebro", "1");
    v.tocar({ "data-acc": "todas" });
    expect(v.casos()).toEqual(["Pagar el carrito"]);
    expect(v.pagina()).not.toContain("Sin casos de uso ni reglas (");
    v.cambiar("es-cerebro", "");
    v.escribir("recibo");
    expect(v.casos()).toEqual(["Ver el recibo"]);
  });

  it("arma los pedidos para el agente: agrupar, escribir y corregir", () => {
    const v = montar(datos());
    v.tocar({ "data-acc": "pedido", "data-k": "agrupar|" });
    expect(v.pagina()).toContain("Agrupá en casos de uso");
    expect(v.pagina()).toContain("- feat-pagos (Pagos): 1 especificación en front.");
    expect(v.pagina()).toContain("No se pudo copiar solo");
    v.tocar({ "data-acc": "pedido", "data-k": "escribir|" });
    expect(v.lista()).toContain("- feat-envios (Envíos), cerebro front: 1 caso de test.");
    v.tocar({ "data-acc": "grupo", "data-k": "problema" });
    v.tocar({ "data-acc": "pedido", "data-k": "corregir|" });
    expect(v.lista()).toContain("- feat-pagos / pagar (Pagar el carrito), cerebro back: falta el reintento");
  });

  it("sin nada escrito o sin funcionalidades explica qué hacer", () => {
    const d = datos();
    const sin = montar({ ...d, funcionalidades: d.funcionalidades.map((f) => ({ ...f, especificaciones: [], casos: [] })) }).pagina();
    expect(sin).toContain("Todavía no hay casos de uso ni reglas escritas");
    expect(sin).toContain("Sin casos de uso ni reglas (2)");
    expect(montar({ ...d, funcionalidades: [] }).pagina()).toContain("No hay funcionalidades");
    // Un visor generado antes de esta versión no trae los campos: se lee como "ninguna", no rompe.
    expect(montar({ ...d, funcionalidades: [{ id: "front/feat-pagos" }] }).pagina()).toContain("Sin casos de uso ni reglas (1)");
    // Solo reglas, sin casos: lo dice y los números cuentan reglas.
    const solo = montar({ ...d, funcionalidades: d.funcionalidades.map((f) => ({ ...f, casos: [] })) }).pagina();
    expect(solo).toContain("Todavía no hay casos de uso: hay 4 reglas escritas");
    expect(solo).toContain("Todavía no hay casos de uso: los números cuentan reglas.");
  });

  it("con el servidor, Esto está mal guarda el comentario en cada cerebro del caso y se refleja sin recargar", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown>; token: string | undefined }> = [];
    const fetch = (url: string, init: { method: string; body: string; headers: Record<string, string> }) => {
      pedidos.push({ url, cuerpo: JSON.parse(init.body) as Record<string, unknown>, token: init.headers["x-flowbrain-token"] });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mensaje: "ok", escrito: "x", cambio: true }) });
    };
    const v = montar(datos(), { edicion: { token: "secreto", sinAplicar: [] }, fetch });
    expect(v.pagina()).not.toContain("solo lectura");
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    v.tocar({ "data-acc": "marcar", "data-k": "feat-pagos|ver-recibo" });
    expect(v.lista()).toContain('<textarea id="es-nota"');
    // Sin texto no guarda: el comentario es lo que lee el agente.
    v.tocar({ "data-acc": "guardar", "data-k": "feat-pagos|ver-recibo" });
    expect(v.lista()).toContain("Escribí qué está mal");
    expect(pedidos).toEqual([]);
    v.escribir("no existe el recibo", "es-nota");
    v.tocar({ "data-acc": "guardar", "data-k": "feat-pagos|ver-recibo" });
    await new Promise((r) => setTimeout(r, 0));
    expect(pedidos).toEqual([{ url: "/api/editar", cuerpo: { tipo: "caso", cerebro: "front", funcionalidad: "feat-pagos", id: "ver-recibo", problema: "no existe el recibo" }, token: "secreto" }]);
    expect(v.lista()).toContain("Quedó marcado como mal en front.");
    expect(v.lista()).toContain("«no existe el recibo»");
    // "pagar" está en los dos cerebros: sacarle la marca va a los dos.
    pedidos.length = 0;
    v.tocar({ "data-acc": "desmarcar", "data-k": "feat-pagos|pagar" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(pedidos.map((x) => [x.cuerpo["cerebro"], x.cuerpo["problema"]])).toEqual([["front", null], ["back", null]]);
    expect(v.lista()).not.toContain("falta el reintento");
  });
});

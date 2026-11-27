import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import { GUIA_TESTS } from "@flowbrain/core";
import { ESPECIFICACIONES_JS } from "../src/viewer-especificaciones.js";
import { FILTROS_JS } from "../src/viewer-filtros.js";
import { PEDIDO_JS } from "../src/viewer-pedido.js";

const DEL_PEDIDO = new Set(["panel", "cerrar-panel", "quitar", "vaciar", "pedir-todos", "descargar-lista", "cancelar-lote", "cerrar-lote", "regla-mal", "codigo-mal", "deshacer", "corregir-reglas", "descargar-desarrollo"]);

/** La pantalla Especificaciones, corrida con un DOM mínimo: casos de uso unidos entre cerebros, filtros, lo que falta y "Esto está mal". */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
function montar(datos: Record<string, unknown>, opciones: { edicion?: unknown; fetch?: (url: string, init: { method: string; body: string; headers: Record<string, string> }) => Promise<unknown>; local?: Map<string, string>; lang?: "es" } = {}) {
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
  let borrador = "";
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const window = { brainVisor: { D: datos, porId, esc }, brainEspecificaciones: null as null | { mostrar(f?: string | null): void }, FLOWBRAIN_EDICION: opciones.edicion, FLOWBRAIN_GUIA_TESTS: GUIA_TESTS, scrollTo() {}, brainI18n: opciones.lang ? { lang: opciones.lang } : undefined };
  const descargas: Array<{ archivo: string; texto: () => Promise<string> }> = [];
  const documento = {
    getElementById: el,
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ href: "", download: "", click() { const h = this.href; descargas.push({ archivo: this.download, texto: () => resolveObjectURL(h)!.text() }); } }),
  };
  new Function("window", "document", "sessionStorage", FILTROS_JS)(window, documento, sessionStorage);
  new Function("window", "document", "localStorage", "fetch", PEDIDO_JS)(window, documento, localStorage, opciones.fetch);
  new Function("window", "document", "sessionStorage", "localStorage", "fetch", ESPECIFICACIONES_JS)(window, documento, sessionStorage, localStorage, opciones.fetch);
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
    panel: () => el("pedido-panel").innerHTML,
    bandeja: () => el("pedido-bandeja").innerHTML,
    descargas,
    casos: () => [...el("es-lista").innerHTML.matchAll(/<p class="es-nombre">([^<]+)<\/p>/g)].map((m) => m[1]),
    reglas: () => [...el("es-lista").innerHTML.matchAll(/<p class="es-texto">([^<]+?) <span/g)].map((m) => m[1]),
    cambiar: (id: string, value: string) => (id.startsWith("pedido-") ? el("pedido-panel") : raiz).oyentes["change"]!({ target: { id, value } }),
    escribir: (value: string, id = "es-q") => { borrador = value; raiz.oyentes["input"]!({ target: { id, value } }); },
    // Los botones del pedido (panel y bandeja) son del componente, igual que los resultados del lote (en el panel).
    tocar: (attrs: Record<string, string>) => (DEL_PEDIDO.has(attrs["data-acc"] ?? "") ? el(attrs["data-acc"] === "panel" ? "pedido-bandeja" : "pedido-panel") : raiz).oyentes["click"]!({ target: boton(attrs) }),
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
    expect(v.lista()).toContain('<span class="chip">2 use cases</span>');
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    // Lo marcado como mal y lo que falta, primero.
    expect(v.casos()).toEqual(["Pagar el carrito", "Ver el recibo"]);
    const l = v.lista();
    expect(l).toContain("Who: Cliente");
    expect(l).toContain('<tr><th scope="row">front</th>');
    expect(l).toContain("1 of 2 rules untested");
    expect(l).toContain('<tr><th scope="row">back</th><td><code title="repo-api:src/Cobro.php">Cobro.php</code></td><td><div class="es-verifica"><span><span class="es-bien">✔ 1 test</span></span></div></td></tr>');
    expect(l).toContain("«falta el reintento» <small>(back)</small>");
    expect(l).toContain("✘ No rules");
    // La regla que ningún caso agrupa se dice, con el pedido para el agente.
    expect(l).toContain("1 rule without a use case");
    expect(v.reglas()).toContain("El botón de pagar se ve abajo.");
    expect(p).toContain("No use cases or rules (1)");
    // Sin servidor es de solo lectura: lo dice y no ofrece marcar.
    expect(p).toContain("flowbrain viewer --serve");
    expect(l).not.toContain('data-acc="marcar"');
  });

  it("filtra por sin test, marcados, cumplidos, cerebro y texto, y un vacío dice por qué", () => {
    const v = montar(datos());
    v.tocar({ "data-acc": "todas" });
    v.tocar({ "data-acc": "grupo", "data-k": "problema" });
    expect(v.casos()).toEqual(["Pagar el carrito"]);
    expect(v.lista()).toContain("Request the fix");
    v.tocar({ "data-acc": "grupo", "data-k": "sintest" });
    expect(v.casos()).toEqual(["Pagar el carrito"]);
    expect(v.reglas()).toContain("El botón de pagar se ve abajo.");
    v.tocar({ "data-acc": "grupo", "data-k": "cumplido" });
    // La frase la arma el filtro compartido; lo de esta pantalla es la unidad, el grupo y la cuenta.
    expect(v.lista()).toContain("use case");
    expect(v.lista()).toContain("fulfilled");
    expect(v.lista()).toContain("2 use cases and 1 rule without a use case");
    v.tocar({ "data-fl": "es", "data-fl-limpiar": "1" });
    v.tocar({ "data-acc": "cerebro", "data-k": "back" });
    v.tocar({ "data-acc": "todas" });
    expect(v.casos()).toEqual(["Pagar el carrito"]);
    expect(v.pagina()).not.toContain("No use cases or rules (");
    v.tocar({ "data-acc": "cerebro", "data-k": "" });
    v.escribir("recibo");
    expect(v.casos()).toEqual(["Ver el recibo"]);
  });

  it("elige varios cerebros: los casos cuentan solo lo elegido, lo demás se nombra y la elección queda guardada", () => {
    const local = new Map<string, string>();
    const v = montar(datos(), { local });
    expect(v.pagina()).toContain('data-acc="cerebro" data-k="" aria-pressed="true">All</button>');
    v.tocar({ "data-acc": "cerebro", "data-k": "back" });
    // Solo back: "pagar" pasa a cumplido (su regla de back tiene test) y "Ver el recibo" (solo en front) no está.
    expect([...v.pagina().matchAll(/<div class="fd-cifra[^"]*"[^>]*><b[^>]*>(\d+)<\/b>/g)].map((m) => m[1]).slice(0, 4)).toEqual(["1", "1", "0", "1"]);
    expect(v.pagina()).toContain("You see back: use cases only count what's in that brain.");
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    expect(v.casos()).toEqual(["Pagar el carrito"]);
    expect(v.lista()).toContain("1 more brain outside the chosen ones: front.");
    expect(v.lista()).not.toContain('<tr><th scope="row">front</th>');
    expect(v.lista()).toContain('<span class="chip es-cerebro fuera"');
    expect(JSON.parse(local.get("flowbrain.especificaciones.cerebros")!)).toEqual(["back"]);
    // Otra vez abierta, recuerda la elección; elegir todos vuelve a "Todos".
    const otra = montar(datos(), { local });
    expect(otra.pagina()).toContain('data-k="back" aria-pressed="true">✔ back</button>');
    otra.tocar({ "data-acc": "cerebro", "data-k": "front" });
    expect(otra.pagina()).toContain('data-k="" aria-pressed="true">All</button>');
    expect(JSON.parse(local.get("flowbrain.especificaciones.cerebros")!)).toEqual([]);
  });

  it("agrupar, escribir y corregir se suman al pedido único: tarjeta, «Quitar», .md en inglés y nada de recuadros", async () => {
    const v = montar(datos());
    expect(v.pagina()).toContain('data-acc="pedir" data-tipo="agrupar" data-k="agrupar|"');
    v.tocar({ "data-acc": "pedir", "data-k": "agrupar|" });
    let p = v.panel();
    expect(p).toContain("<b>1 feature</b>");
    expect(p).toContain('<p class="es-texto">Pagos</p>');
    expect(p).toContain('data-acc="quitar" data-tipo="agrupar" data-k="front/feat-pagos"');
    v.tocar({ "data-acc": "pedir", "data-k": "escribir|" });
    expect(v.lista()).toContain('data-k="escribir|" data-et="Request them all" aria-pressed="true"');
    v.tocar({ "data-acc": "grupo", "data-k": "problema" });
    v.tocar({ "data-acc": "pedir", "data-k": "corregir|" });
    p = v.panel();
    for (const t of ["Group into use cases", "Write use cases", "Fixes", "Marked as wrong", "«falta el reintento»", "Envíos"]) expect(p).toContain(t);
    expect(v.bandeja()).toContain(">Request (3)</button>");
    // El pedido ya no se muestra en un recuadro para copiar: va en el .md (y en el lote), en inglés.
    expect(v.pagina()).not.toContain("<textarea");
    v.tocar({ "data-acc": "descargar-lista" });
    const md = await v.descargas.pop()!.texto();
    expect(md).toContain("Group into use cases the specifications");
    expect(md).toContain("- feat-pagos (Pagos), brain front: 1 specification without a use case.");
    expect(md).toContain("- feat-envios (Envíos), brain front: 1 test case.");
    expect(md).toContain("- feat-pagos / pagar (Pagar el carrito), brain back: falta el reintento");
    expect(md).toContain("flowbrain specs <feature> --brain <brain>");
    // Tocar otra vez lo saca; «Quitar» también.
    v.tocar({ "data-acc": "pedir", "data-k": "corregir|" });
    expect(v.panel()).not.toContain("Fixes");
    v.tocar({ "data-acc": "quitar", "data-tipo": "agrupar", "data-k": "front/feat-pagos" });
    expect(v.panel()).not.toContain("Group into use cases");
    expect(v.bandeja()).toContain(">Request (1)</button>");
  });

  it("dice qué te toca hacer y arma el pedido de tests, de una regla, de un cerebro o del caso entero", () => {
    const v = montar(datos());
    const p = v.pagina();
    expect(p).toContain("What you need to do");
    expect(p).toContain("Ask it to group 1 loose rule into use cases");
    expect(p).toContain("Pass 1 use case marked as wrong to the agent");
    // Cuenta las reglas de los casos (la suelta va en "agrupar"): "motivo", de negocio, no tiene test.
    expect(p).toContain("Request the missing tests</b><small>1 business rule untested.");
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    expect(v.lista()).toContain('class="boton es-pedir" data-acc="pedir" data-tipo="test" data-k="test|feat-pagos|pagar"');
    expect(v.lista()).toContain("Request the missing test</button>");
    expect(v.lista()).toContain("No test verifies it: if someone breaks it, nothing warns you.");
    // Pedir el test no manda nada: suma la regla a la lista y abre el panel.
    expect(v.panel()).toContain("The list is empty");
    v.tocar({ "data-acc": "pedir", "data-k": "test|feat-pagos|pagar" });
    const l = v.lista(), pn = v.panel();
    expect(l).toContain("✔ In the request");
    // La bandeja de la barra superior cuenta lo pedido, desde cualquier pantalla.
    expect(v.bandeja()).toContain(">Request (1)</button>");
    expect(l).not.toContain("Send to the agent");
    expect(pn).toContain("Si el pago falla se muestra el motivo.");
    expect(pn).toContain(">Business<");
    expect(pn).toContain("Pagar el carrito");
    expect(pn).toContain("Pagos");
    expect(pn).toContain(">front<");
    expect(pn).toContain("<code>repo-web:src/pagos/Error.tsx</code>");
    expect(pn).toContain("<b>1 rule</b>");
    // Sin servidor no se ofrece "No necesita test": no hay dónde guardarlo.
    expect(l).not.toContain('data-acc="manual"');
    v.tocar({ "data-acc": "pedir", "data-k": "test|feat-pagos|pagar" });
    expect(v.panel()).toContain("The list is empty");
  });

  it("con el servidor, No necesita test guarda el motivo, deja de contar y se puede deshacer", async () => {
    const pedidos: Array<Record<string, unknown>> = [];
    const fetch = (_url: string, init: { body: string }) => {
      pedidos.push(JSON.parse(init.body) as Record<string, unknown>);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mensaje: "ok" }) });
    };
    const v = montar(datos(), { edicion: { token: "t", sinAplicar: [] }, fetch });
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    v.tocar({ "data-acc": "manual", "data-k": "front/feat-pagos|motivo" });
    expect(v.lista()).toContain('<input id="es-motivo"');
    v.tocar({ "data-acc": "guardar-manual", "data-k": "front/feat-pagos|motivo" });
    expect(v.lista()).toContain("Write why it&#39;s tested by hand");
    expect(pedidos).toEqual([]);
    v.escribir("se ve a mano en cada versión", "es-motivo");
    v.tocar({ "data-acc": "guardar-manual", "data-k": "front/feat-pagos|motivo" });
    await new Promise((r) => setTimeout(r, 0));
    expect(pedidos).toEqual([{ tipo: "manual", cerebro: "front", funcionalidad: "feat-pagos", id: "motivo", motivo: "se ve a mano en cada versión" }]);
    const l = v.lista();
    expect(l).toContain("Tested by hand: se ve a mano en cada versión");
    expect(l).toContain("Marked as tested by hand");
    // "pagar" ya no tiene reglas sin verificar: queda cumplido.
    expect(v.pagina()).toContain("✔ Every rule has its test or is tested by hand");
    expect(l).toContain("✔ Fulfilled");
    v.tocar({ "data-acc": "automatico", "data-k": "front/feat-pagos|motivo" });
    await new Promise((r) => setTimeout(r, 0));
    expect(pedidos[1]).toEqual({ tipo: "manual", cerebro: "front", funcionalidad: "feat-pagos", id: "motivo", motivo: null });
    expect(v.lista()).toContain("It counts as untested again");
  });

  const PROVEEDORES = [{ id: "claude-code", nombre: "Claude Code", version: "9.9.9", modelos: [
    { id: "claude-fable-5-2", nombre: "Fable 5.2", costoPorReglaUsd: 0.9 }, { id: "claude-opus-5-5", nombre: "Opus 5.5", porDefecto: true, costoPorReglaUsd: 0.4 },
    { id: "claude-sonnet-5-5", nombre: "Sonnet 5.5", costoPorReglaUsd: 0.15 }, { id: "claude-haiku-5-5", nombre: "Haiku 5.5", costoPorReglaUsd: 0.04, costoPorPaginaUsd: { agrupar: 0.015, escribir: 0.12, corregir: 0.025 } }] }];
  const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

  it("sin Claude Code en la máquina, la lista sigue y dice por qué no se manda: se descarga el .md", () => {
    const v = montar(datos(), { edicion: { token: "t", sinAplicar: [], agente: { noDisponible: "no se encontró Claude Code (claude) en esta máquina" } }, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) });
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    v.tocar({ "data-acc": "pedir", "data-k": "test|feat-pagos|pagar" });
    expect(v.panel()).toContain("There's no agent installed on this machine: no se encontró Claude Code");
    expect(v.panel()).toContain("Download the .md");
    expect(v.panel()).not.toContain('id="pedido-prov"');
    expect(v.panel()).toMatch(/data-acc="pedir-todos" disabled/);
  });

  it("la lista queda guardada, se quita de a una o se vacía, y el .md trae la guía, las reglas por repo y el cierre", async () => {
    const local = new Map<string, string>();
    const d = datos();
    const v = montar(d, { local });
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    v.tocar({ "data-acc": "pedir", "data-k": "test|front/feat-pagos|motivo" });
    v.tocar({ "data-acc": "pedir", "data-k": "test|front/feat-pagos|suelta" });
    expect(v.panel()).toContain("<b>2 rules</b>");
    // Recargar la página: la lista vuelve igual, con el panel abierto.
    const w = montar(d, { local });
    expect(w.panel()).toContain("<b>2 rules</b>");
    expect(w.panel()).toContain("El botón de pagar se ve abajo.");
    w.tocar({ "data-acc": "quitar", "data-tipo": "test", "data-k": "front/feat-pagos|suelta" });
    expect(w.panel()).toContain("<b>1 rule</b>");
    expect(JSON.parse(local.get("flowbrain.pedido")!).items).toHaveLength(1);
    w.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    w.tocar({ "data-acc": "pedir", "data-k": "test|front/feat-pagos|suelta" });
    w.tocar({ "data-acc": "descargar-lista" });
    expect(w.descargas[0]!.archivo).toBe("tests-pedidos.md");
    const md = await w.descargas[0]!.texto();
    expect(md).toContain("# Tests requested from FlowBrain");
    expect(md).toContain("You need an agent with access to the repo");
    expect(md).toContain("A web chat won't do");
    // La guía viene entera de @flowbrain/core (sin su frontmatter), sea cual sea su texto.
    const titulos = GUIA_TESTS.split("\n").filter((x) => x.startsWith("## "));
    expect(titulos.length).toBeGreaterThan(0);
    for (const t of titulos) expect(md).toContain(t);
    expect(md).not.toContain("$ARGUMENTS");
    expect(md).toContain("### repo-web (2)");
    expect(md).toContain("rule motivo [negocio]: Si el pago falla se muestra el motivo.");
    expect(md).toContain("## When done");
    expect(md).toContain("`flowbrain compile`");
    expect(md).toContain("flowbrain specs <feature> --brain <brain>");
    w.tocar({ "data-acc": "vaciar" });
    expect(w.panel()).toContain("The list is empty");
    expect(JSON.parse(local.get("flowbrain.pedido")!).items).toEqual([]);
  });

  it("pedir todos: elige proveedor y modelo, estima el costo, manda el lote, muestra el avance y separa lo que volvió", async () => {
    const d = datos();
    (d.funcionalidades[0]!.especificaciones[2] as { tipo: string }).tipo = "producto";
    const estado: { trabajos: unknown[]; lotes: unknown[] } = { trabajos: [], lotes: [] };
    const llamadas: Array<{ url: string; cuerpo: Record<string, any> | null }> = [];
    const fetch = (url: string, init: { method?: string; body?: string }) => {
      const cuerpo = init.body ? (JSON.parse(init.body) as Record<string, any>) : null;
      llamadas.push({ url, cuerpo });
      const j = url === "/api/agente/lote" ? { lote: { id: "L1" }, trabajos: [] } : url === "/api/agente" ? { ...estado, proveedores: PROVEEDORES } : { mensaje: "ok", cambio: true };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
    };
    const v = montar(d, { edicion: { token: "t", sinAplicar: [], agente: { noDisponible: null, proveedores: PROVEEDORES } }, fetch });
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    v.tocar({ "data-acc": "pedir", "data-k": "test|front/feat-pagos|suelta" });
    v.tocar({ "data-acc": "pedir", "data-k": "test|front/feat-pagos|motivo" });
    let p = v.panel();
    // El selector muestra los proveedores instalados; el modelo por defecto va marcado.
    expect(p).toContain('<option value="claude-code" selected>Claude Code</option>');
    expect(p).toContain('<option value="claude-opus-5-5" selected>Opus 5.5 (default)</option>');
    for (const m of ["Fable 5.2", "Sonnet 5.5", "Haiku 5.5"]) expect(p).toContain(">" + m + "</option>");
    expect(p).toContain("<b>2 rules</b>");
    expect(p).toContain("1 business (they go first) · 1 screen");
    expect(p.indexOf("Si el pago falla")).toBeLessThan(p.indexOf("El botón de pagar"));
    expect(p).toContain("Estimated cost: ≈ US$ 0.80");
    v.cambiar("pedido-modelo", "claude-haiku-5-5");
    p = v.panel();
    expect(p).toContain("Estimated cost: ≈ US$ 0.080");
    expect(p).toContain('<option value="claude-haiku-5-5" selected>Haiku 5.5</option>');
    expect(p).toContain("Request all (2)");
    expect(p).toContain("Download .md");
    // Nada se mandó hasta ahora, salvo mirar cómo está el agente.
    expect(llamadas.filter((x) => x.cuerpo)).toEqual([]);

    v.tocar({ "data-acc": "pedir-todos" });
    estado.lotes = [{ id: "L1", estado: "corriendo", cerebros: ["front"] }];
    estado.trabajos = [{ id: "t1", lote: "L1", repo: "repo-web", tanda: { n: 1, de: 1 }, estado: "corriendo", pasos: ["Lee src/pagos/Error.tsx", "Corre: npx vitest run"], reglas: [{ cerebro: "front", funcionalidad: "feat-pagos", regla: "motivo" }, { cerebro: "front", funcionalidad: "feat-pagos", regla: "suelta" }] }];
    await tick();
    const post = llamadas.find((x) => x.url === "/api/agente/lote")!;
    expect(post.cuerpo).toMatchObject({ proveedor: "claude-code", modelo: "claude-haiku-5-5" });
    expect((post.cuerpo!["reglas"] as Array<Record<string, unknown>>).map((r) => r["regla"])).toEqual(["motivo", "suelta"]);
    expect(post.cuerpo!["reglas"][0]).toMatchObject({ cerebro: "front", funcionalidad: "feat-pagos", repo: "repo-web" });
    expect(String(post.cuerpo!["reglas"][0].linea)).toContain("rule motivo [negocio]: Si el pago falla se muestra el motivo.");
    p = v.panel();
    expect(p).toContain("Requesting 2 rules in 1 repo at once");
    expect(p).toContain("0 of 1 batches");
    expect(p).toContain("repo-web");
    expect(p).toContain("Corre: npx vitest run");
    expect(p).toContain("Requesting…");
    expect(p).toContain('data-acc="cancelar-lote"');
    expect(p).toMatch(/data-acc="pedir-todos" disabled/);

    // Terminó: una verificada con un test nuevo y una con el código que no la cumple. Cuesta, de verdad, 0.12.
    estado.lotes = [{ id: "L1", estado: "terminado", cerebros: ["front"] }];
    estado.trabajos = [{ ...(estado.trabajos[0] as object), estado: "terminado", costoUsd: 0.12, resultados: [
      { cerebro: "front", funcionalidad: "feat-pagos", regla: "motivo", resultado: "a", tests: ["repo-web:src/pagos/Error.test.tsx::muestra el motivo"] },
      { cerebro: "front", funcionalidad: "feat-pagos", regla: "suelta", resultado: "c", hoy: "src/pagos/Boton.tsx#L9: el botón se ve arriba", cambio: "Mover el botón abajo.", test: "it('abajo', () => {})" }] }];
    (v as { cambiar: (a: string, b: string) => void }).cambiar("pedido-modelo", "claude-haiku-5-5");
    // El panel vuelve a pedir el estado cada 2 s; acá se fuerza con otro pedido.
    v.tocar({ "data-acc": "panel", "data-k": "" }); v.tocar({ "data-acc": "panel", "data-k": "" });
    await new Promise((r) => setTimeout(r, 2100));
    p = v.panel();
    expect(p).toContain("Finished");
    expect(p).toContain("Actual cost: US$ 0.12");
    expect(p).toContain("1 verified with a new test · 0 already covered · 1 with code that doesn't fulfill it · 0 that can't be tested without touching code");
    expect(p).toContain("Verified");
    expect(p).toContain("repo-web:src/pagos/Error.test.tsx::muestra el motivo");
    expect(p).toContain("To decide");
    expect(p).toContain("src/pagos/Boton.tsx#L9: el botón se ve arriba");
    expect(p).toContain("Mover el botón abajo.");
    expect(p).toContain("The test that proves it");
    expect(p).toContain('data-acc="regla-mal"');
    expect(p).toContain('data-acc="codigo-mal"');
    // Lo que ya tiene resultado sale de la lista.
    expect(p).toContain("The list is empty");

    // «El código está mal» lo pasa a desarrollo y queda guardado en la página.
    v.tocar({ "data-acc": "codigo-mal", "data-k": "front/feat-pagos|suelta" });
    await tick();
    const dec = llamadas.filter((x) => x.url === "/api/editar").pop()!;
    expect(dec.cuerpo).toEqual({ tipo: "decision", cerebro: "front", funcionalidad: "feat-pagos", id: "suelta", decision: "codigo_mal" });
    p = v.panel();
    expect(p).toContain("For development");
    expect(p).toContain("Nothing to decide.");
    expect(p).toContain("Download .md for tickets");
    v.tocar({ "data-acc": "descargar-desarrollo" });
    const md = await v.descargas.pop()!.texto();
    expect(md).toContain("# For development");
    expect(md).toContain("## 1. El botón de pagar se ve abajo.");
    expect(md).toContain("**What the code does today:** src/pagos/Boton.tsx#L9: el botón se ve arriba");
    expect(md).toContain("**What should change:** Mover el botón abajo.");
    expect(md).toContain("it('abajo', () => {})");

    // «La regla está mal»: la corrige el agente.
    v.tocar({ "data-acc": "deshacer", "data-k": "front/feat-pagos|suelta" });
    await tick();
    v.tocar({ "data-acc": "regla-mal", "data-k": "front/feat-pagos|suelta" });
    await tick();
    p = v.panel();
    expect(p).toContain("The rule gets fixed");
    expect(p).toContain('data-acc="pedir" data-tipo="corregir" data-k="corregir|reglas" data-et="Request the fix"');
    // «Pedir la corrección» se suma al pedido como cualquier otro: desde el mismo panel.
    v.tocar({ "data-acc": "pedir", "data-k": "corregir|reglas" });
    p = v.panel();
    expect(p).toContain("The rule is wrong");
    expect(p).toContain("The code today: src/pagos/Boton.tsx#L9: el botón se ve arriba");
    expect(p).toContain("Estimated cost: ≈ US$ 0.025");
    expect(p).toContain("✔ In the request");
    v.tocar({ "data-acc": "pedir-todos" });
    await tick();
    const corr = llamadas.find((x) => x.url === "/api/agente/lote" && x.cuerpo?.["tipo"] === "corregir")!;
    expect(corr.cuerpo).toMatchObject({ proveedor: "claude-code", modelo: "claude-haiku-5-5", items: [{ cerebro: "front", funcionalidad: "feat-pagos", regla: "suelta" }] });
    expect(String(corr.cuerpo!["items"][0].linea)).toContain("rule suelta: «El botón de pagar se ve abajo.». The code today: src/pagos/Boton.tsx#L9");
    expect(llamadas.some((x) => x.url === "/api/agente" && x.cuerpo)).toBe(false);
  }, 15_000);

  it("en castellano (brainI18n.lang = es) dice lo mismo en castellano; los pedidos al agente siguen en inglés", async () => {
    const v = montar(datos(), { lang: "es" });
    const p = v.pagina();
    expect(p).toContain("<h1>Especificaciones</h1>");
    expect(p).toContain("Qué te toca hacer");
    expect(p).toContain("Pedir que agrupe 1 regla suelta en casos de uso");
    expect(p).toContain("Pedir los tests que faltan</b><small>1 regla de negocio sin test.");
    expect(v.lista()).toContain('<span class="chip">2 casos de uso</span>');
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    expect(v.lista()).toContain("1 de 2 reglas sin test");
    expect(v.lista()).toContain("Pedir el test que falta</button>");
    v.tocar({ "data-acc": "pedir", "data-k": "test|feat-pagos|pagar" });
    expect(v.panel()).toContain("<b>1 regla</b>");
    expect(v.panel()).toContain("Pedido al agente");
    expect(v.bandeja()).toContain(">Pedido (1)</button>");
    v.tocar({ "data-acc": "pedir", "data-k": "agrupar|" });
    expect(v.panel()).toContain("Agrupar en casos de uso");
    expect(v.panel()).toContain("1 regla sin caso de uso");
    v.tocar({ "data-acc": "descargar-lista" });
    expect(await v.descargas.pop()!.texto()).toContain("Group into use cases the specifications");
  });

  it("sin nada escrito o sin funcionalidades explica qué hacer", () => {
    const d = datos();
    const sin = montar({ ...d, funcionalidades: d.funcionalidades.map((f) => ({ ...f, especificaciones: [], casos: [] })) }).pagina();
    expect(sin).toContain("There are no use cases or written rules yet");
    expect(sin).toContain("No use cases or rules (2)");
    expect(montar({ ...d, funcionalidades: [] }).pagina()).toContain("There are no features");
    // Un visor generado antes de esta versión no trae los campos: se lee como "ninguna", no rompe.
    expect(montar({ ...d, funcionalidades: [{ id: "front/feat-pagos" }] }).pagina()).toContain("No use cases or rules (1)");
    // Solo reglas, sin casos: lo dice y los números cuentan reglas.
    const solo = montar({ ...d, funcionalidades: d.funcionalidades.map((f) => ({ ...f, casos: [] })) }).pagina();
    expect(solo).toContain("There are no use cases yet: there are 4 written rules");
    expect(solo).toContain("There are no use cases yet: the numbers count rules.");
  });

  it("con el servidor, Esto está mal guarda el comentario en cada cerebro del caso y se refleja sin recargar", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown>; token: string | undefined }> = [];
    const fetch = (url: string, init: { method: string; body: string; headers: Record<string, string> }) => {
      pedidos.push({ url, cuerpo: JSON.parse(init.body) as Record<string, unknown>, token: init.headers["x-flowbrain-token"] });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mensaje: "ok", escrito: "x", cambio: true }) });
    };
    const v = montar(datos(), { edicion: { token: "secreto", sinAplicar: [] }, fetch });
    expect(v.pagina()).not.toContain("read-only");
    v.tocar({ "data-acc": "abrir", "data-k": "feat-pagos" });
    v.tocar({ "data-acc": "marcar", "data-k": "feat-pagos|ver-recibo" });
    expect(v.lista()).toContain('<textarea id="es-nota"');
    // Sin texto no guarda: el comentario es lo que lee el agente.
    v.tocar({ "data-acc": "guardar", "data-k": "feat-pagos|ver-recibo" });
    expect(v.lista()).toContain("Write what&#39;s wrong");
    expect(pedidos).toEqual([]);
    v.escribir("no existe el recibo", "es-nota");
    v.tocar({ "data-acc": "guardar", "data-k": "feat-pagos|ver-recibo" });
    await new Promise((r) => setTimeout(r, 0));
    expect(pedidos).toEqual([{ url: "/api/editar", cuerpo: { tipo: "caso", cerebro: "front", funcionalidad: "feat-pagos", id: "ver-recibo", problema: "no existe el recibo" }, token: "secreto" }]);
    expect(v.lista()).toContain("Marked as wrong in front.");
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

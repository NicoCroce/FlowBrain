import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import { cuentaAgente } from "./ayuda-agente.js";
import { PEDIDO_JS } from "../src/viewer-pedido.js";

/** El pedido al agente, el componente único del visor, con un DOM mínimo y dos tipos de prueba registrados. */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
type Item = { tipo: string; k: string; cerebro: string; repo: string | null; datos: Record<string, unknown> };
interface Pedido {
  registrar(tipo: string, def: Record<string, unknown>): void;
  boton(o: { tipo: string; k: string; et: string; claves?: string[] }): string;
  sumar(tipo: string, k: string): void;
  actualizar(): void;
  esta(tipo: string, k: string): boolean;
  items(tipo: string): Item[];
  podar(tipo: string, fn: (x: Item) => Item | null): void;
  escuchar(f: (ev: string) => void): void;
}

function montar(opciones: { local?: Map<string, string>; agente?: boolean; fetch?: (url: string, init: { method: string; body?: string }) => Promise<unknown>; lang?: "es" } = {}) {
  const local = opciones.local ?? new Map<string, string>();
  const localStorage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) };
  const elementos = new Map<string, { innerHTML: string; className: string; oyentes: Record<string, Oyente>; addEventListener(t: string, f: Oyente): void }>();
  const el = (id: string) => {
    if (!elementos.has(id)) {
      const e = { innerHTML: "", className: "", oyentes: {} as Record<string, Oyente>, addEventListener(t: string, f: Oyente) { e.oyentes[t] = f; } };
      elementos.set(id, e);
    }
    return elementos.get(id)!;
  };
  const bajados: Array<{ nombre: string; texto: () => Promise<string> }> = [];
  const clases = new Set<string>();
  const documento = {
    getElementById: el,
    body: { appendChild() {}, removeChild() {}, classList: { add: (c: string) => void clases.add(c), remove: (c: string) => void clases.delete(c) } },
    createElement: () => ({ href: "", download: "", click() { const h = this.href; bajados.push({ nombre: this.download, texto: () => resolveObjectURL(h)!.text() }); } }),
  };
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const agente = { noDisponible: null, proveedores: [{ id: "claude-code", nombre: "Claude Code", modelos: [{ id: "opus", nombre: "Opus", porDefecto: true, costoPorReglaUsd: 0.4, costoPorArchivoUsd: 0.1 }, { id: "otro", nombre: "Otro" }] }] };
  const window = { brainVisor: { esc }, FLOWBRAIN_EDICION: opciones.agente ? { token: "t", agente } : null, brainI18n: opciones.lang ? { lang: opciones.lang } : undefined, brainPedido: null as unknown as Pedido };
  new Function("window", "document", "localStorage", "fetch", PEDIDO_JS)(window, documento, localStorage, opciones.fetch);
  const P = window.brainPedido;
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null }) });
  return {
    P,
    panel: () => el("pedido-panel").innerHTML,
    abierto: () => el("pedido-panel").className === "es-panel abierto" && clases.has("con-pedido"),
    bandeja: () => el("pedido-bandeja").innerHTML,
    tocar: (attrs: Record<string, string>) => el(attrs["data-acc"] === "panel" ? "pedido-bandeja" : "pedido-panel").oyentes["click"]!({ target: boton(attrs) }),
    cambiar: (id: string, value: string) => el("pedido-panel").oyentes["change"]!({ target: { id, value } }),
    guardado: () => JSON.parse(local.get("flowbrain.pedido")!) as { items: Item[]; panel: boolean; elegido: Record<string, string>; ocultos: string[]; etapa: string },
    bajados,
  };
}

// Dos tipos de prueba: reglas (como Especificaciones) y archivos (como Sin asociar). Cada botón «k» suma sus ítems.
const regla = (id: string, cerebro = "web"): Item => ({ tipo: "test", k: `${cerebro}/feat|${id}`, cerebro, repo: "repo-web", datos: { regla: id, texto: `La regla ${id}` } });
const archivo = (ruta: string): Item => ({ tipo: "asociar", k: `web|repo-web:${ruta}`, cerebro: "web", repo: "repo-web", datos: { archivo: `repo-web:${ruta}` } });
const BOTONES: Record<string, Item[]> = { r1: [regla("r1")], caso: [regla("r1"), regla("r2")], a: [archivo("src/a.ts")], carpeta: [archivo("src/a.ts"), archivo("src/b.ts"), archivo("src/c.ts")] };
// Lo que el tipo «test» tiene para revisar (las reglas para decidir): un lote que deja más pasa el panel a «A revisar».
const REVISAR = { n: 1, cargando: false };
function registrar(P: Pedido) {
  REVISAR.n = 1; REVISAR.cargando = false;
  P.registrar("test", {
    nombre: "Tests", unidad: ["rule", "rules", "regla", "reglas"],
    claves: (k: string) => (BOTONES[k] ?? []).filter((x) => x.tipo === "test").map((x) => x.k),
    items: (k: string) => (BOTONES[k] ?? []).filter((x) => x.tipo === "test"),
    tarjeta: (it: Item) => `<p>${String(it.datos["texto"])}</p>`,
    resumen: (xs: Item[]) => [`${xs.length} de negocio`],
    costo: (mo: { costoPorReglaUsd?: number }) => mo.costoPorReglaUsd ?? null,
    lote: (xs: Item[]) => ({ tipo: "test", reglas: xs.map((x) => ({ regla: x.datos["regla"] })) }),
    md: { archivo: "tests-pedidos.md", texto: (xs: Item[]) => `# Tests\n${xs.map((x) => `- ${String(x.datos["regla"])}`).join("\n")}\n` },
    clave: (it: Item) => String(it.datos["regla"]),
    tanda: { lista: "reglas", clave: (x: string) => x },
    seguimiento: { reindexando: "Reindexando", pidiendo: (n: number) => `Pidiendo ${n} reglas`, resumen: () => "listo" },
    revisar: () => ({ n: REVISAR.n, html: "<p>Resultados de los tests</p>", cargando: REVISAR.cargando }),
  });
  P.registrar("asociar", {
    nombre: "Files to assign", unidad: ["file", "files", "archivo", "archivos"],
    claves: (k: string) => (BOTONES[k] ?? []).filter((x) => x.tipo === "asociar").map((x) => x.k),
    items: (k: string) => (BOTONES[k] ?? []).filter((x) => x.tipo === "asociar"),
    tarjeta: (it: Item) => `<code>${String(it.datos["archivo"])}</code>`,
    costo: (mo: { costoPorArchivoUsd?: number }) => mo.costoPorArchivoUsd ?? null,
    lote: (xs: Item[]) => ({ tipo: "asociar", archivos: xs.map((x) => ({ archivo: x.datos["archivo"] })) }),
    md: { archivo: "archivos-pedidos.md", texto: (xs: Item[]) => `# Files\n${xs.map((x) => `- ${String(x.datos["archivo"])}`).join("\n")}\n` },
    tanda: { lista: "archivos", clave: (x: string) => x },
    seguimiento: { pidiendo: (n: number) => `Asociando ${n}` },
  });
}
const esperar = async () => { for (let i = 0; i < 6; i++) await new Promise((ok) => setTimeout(ok, 0)); };

describe("el pedido al agente (componente único)", () => {
  it("una sola lista para todos los tipos: el botón celeste, el botón «Agente» con UN número y el panel en tres etapas", () => {
    const v = montar();
    registrar(v.P);
    // El botón «Agente» siempre está; su número es lo que espera a la persona: por pedir + a revisar («1» para decidir).
    expect(v.bandeja()).toContain('data-acc="panel" aria-expanded="false" aria-controls="pedido-panel"');
    expect(v.bandeja()).toContain("Agent");
    expect(cuentaAgente(v.bandeja())).toBe("1");
    expect(cuentaAgente(montar().bandeja())).toBe("");
    expect(v.P.boton({ tipo: "test", k: "caso", et: "Request the test" })).toContain('data-acc="pedir" data-tipo="test" data-k="caso" data-et="Request the test" aria-pressed="false"');
    v.P.sumar("test", "r1");
    // Ya pedido: el mismo botón dice «✔ In the request»; el del caso entero no, porque le falta r2.
    expect(v.P.boton({ tipo: "test", k: "r1", et: "Request" })).toContain('aria-pressed="true" title="Click to remove it from the request">✔ In the request</button>');
    expect(v.P.boton({ tipo: "test", k: "caso", et: "Request" })).toContain('aria-pressed="false"');
    v.P.sumar("asociar", "carpeta");
    v.P.sumar("test", "caso");
    expect(v.abierto()).toBe(true);
    // UN número: 5 por pedir + 1 a revisar; el detalle va en el título y en las etapas.
    expect(cuentaAgente(v.bandeja())).toBe("6");
    expect(v.bandeja()).toContain('title="5 to request · 0 working · 1 to review"');
    const p = v.panel();
    expect(p).toContain("<h2>Agent</h2>");
    expect(p).toContain('data-acc="etapa" data-k="pedir">To request <span class="pd-num">5</span>');
    expect(p).toContain('data-acc="etapa" data-k="trabajando">Working <span class="pd-num">0</span>');
    expect(p).toContain('data-acc="etapa" data-k="revisar">To review <span class="pd-num">1</span>');
    expect(p).toContain('<div class="pd-etapa" data-etapa="pedir">');
    expect(p).toContain("<b>2 rules</b><small>Tests</small><span>2 de negocio</span>");
    expect(p).toContain("<b>3 files</b><small>Files to assign</small>");
    expect(p).toContain('<section class="pd-grupo" data-tipo="test"><h3>Tests <span class="chip">2</span></h3>');
    expect(p).toContain('<code>repo-web:src/b.ts</code></div><button type="button" class="boton chico" data-acc="quitar" data-tipo="asociar" data-k="web|repo-web:src/b.ts"');
    // Lo de un tipo para revisar va en «A revisar», no en «Por pedir».
    expect(p).not.toContain("<p>Resultados de los tests</p>");
    v.tocar({ "data-acc": "etapa", "data-k": "revisar" });
    expect(v.panel()).toContain('<div class="pd-etapa" data-etapa="revisar"><section class="pd-revisar" data-tipo="test"><p>Resultados de los tests</p></section></div>');
    expect(v.guardado().etapa).toBe("revisar");
    v.tocar({ "data-acc": "etapa", "data-k": "trabajando" });
    expect(v.panel()).toContain("Nothing runs from this page");
    v.tocar({ "data-acc": "etapa", "data-k": "pedir" });
    // Sin servidor: no se manda, se baja el .md.
    expect(p).toContain("This page is read-only");
    expect(p).toMatch(/data-acc="pedir-todos" disabled>Request all \(5\)<\/button>/);
    // Tocar otra vez un botón ya pedido lo saca; «Quitar» saca uno; «Vaciar» todo.
    v.P.sumar("test", "caso");
    expect(v.P.items("test")).toEqual([]);
    v.tocar({ "data-acc": "quitar", "data-tipo": "asociar", "data-k": "web|repo-web:src/b.ts" });
    expect(v.P.items("asociar").map((x) => x.k)).toEqual(["web|repo-web:src/a.ts", "web|repo-web:src/c.ts"]);
    expect(v.guardado().items).toHaveLength(2);
    // Un botón «Pedir» pintado dentro del panel (lo que un tipo pone al final) suma igual que en la pantalla.
    v.tocar({ "data-acc": "pedir", "data-tipo": "test", "data-k": "r1" });
    expect(v.P.items("test").map((x) => x.k)).toEqual(["web/feat|r1"]);
    v.tocar({ "data-acc": "vaciar" });
    expect(v.panel()).toContain("Nothing to request. Click «Request» on a rule, a file or a folder, on any screen");
    expect(v.panel()).toContain('data-acc="etapa" data-k="revisar">Review what came back</button>');
    // En castellano.
    const es = montar({ lang: "es" });
    registrar(es.P);
    es.P.sumar("asociar", "a");
    expect(es.bandeja()).toContain("Agente");
    expect(cuentaAgente(es.bandeja())).toBe("2");
    expect(es.panel()).toContain("<h2>Agente</h2>");
    expect(es.panel()).toContain("Por pedir <span");
    expect(es.panel()).toContain("A revisar <span");
    expect(es.panel()).toContain("<b>1 archivo</b>");
    expect(es.P.boton({ tipo: "asociar", k: "a", et: "Pedir" })).toContain(">✔ En el pedido</button>");
  });

  it("dura en una sola clave, sigue al recargar y se abre y se cierra desde la bandeja", () => {
    const local = new Map<string, string>();
    const v = montar({ local });
    registrar(v.P);
    v.P.sumar("test", "r1");
    v.P.sumar("asociar", "a");
    expect([...local.keys()]).toEqual(["flowbrain.pedido"]);
    expect(v.guardado()).toMatchObject({ panel: true, items: [{ tipo: "test", k: "web/feat|r1", cerebro: "web", repo: "repo-web" }, { tipo: "asociar", k: "web|repo-web:src/a.ts" }] });
    // Otra página, el mismo navegador: la lista vuelve, aunque el tipo todavía no esté registrado.
    const w = montar({ local });
    expect(cuentaAgente(w.bandeja())).toBe("2");
    registrar(w.P);
    expect(w.P.esta("test", "web/feat|r1")).toBe(true);
    w.tocar({ "data-acc": "cerrar-panel" });
    expect(w.abierto()).toBe(false);
    expect(w.guardado().panel).toBe(false);
    w.tocar({ "data-acc": "panel" });
    expect(w.abierto()).toBe(true);
    // Podar: la pantalla saca lo que ya no está pendiente (se asoció en otro lado) y pone al día el resto.
    w.P.podar("asociar", () => null);
    expect(w.guardado().items.map((x) => x.tipo)).toEqual(["test"]);
  });

  it("pasa las listas de antes (una por pantalla) a la clave nueva, sin perder nada, y borra las viejas", () => {
    const local = new Map<string, string>([
      ["flowbrain.especificaciones.pedidos", JSON.stringify([{ k: "web/feat-pagos|motivo", cerebro: "web", funcionalidad: "feat-pagos", regla: "motivo", tipo: "negocio", texto: "El motivo", archivos: [], repo: "repo-web", linea: "- Brain web…" }, { roto: true }])],
      ["flowbrain.especificaciones.panel", "false"],
      ["flowbrain.especificaciones.agente", JSON.stringify({ proveedor: "claude-code", modelo: "otro" })],
      ["flowbrain.especificaciones.lotes", JSON.stringify(["L0", "oculto:L1"])],
      ["flowbrain.sinasociar.pedidos", JSON.stringify([{ k: "web|repo-web:src/a.ts", cerebro: "web", archivo: "repo-web:src/a.ts", nombre: "a.ts", clase: "sinpista", linea: "- repo-web:src/a.ts" }])],
      ["flowbrain.sinasociar.panel", "true"],
      ["flowbrain.sinasociar.lotes", JSON.stringify(["L2"])],
      ["flowbrain.especificaciones.cerebros", JSON.stringify(["web"])],
    ]);
    const v = montar({ local, agente: true });
    const g = v.guardado();
    expect(g.items).toEqual([
      { tipo: "test", k: "web/feat-pagos|motivo", cerebro: "web", repo: "repo-web", datos: expect.objectContaining({ regla: "motivo", texto: "El motivo" }) },
      { tipo: "asociar", k: "web|repo-web:src/a.ts", cerebro: "web", repo: "repo-web", datos: expect.objectContaining({ nombre: "a.ts" }) },
    ]);
    expect(g.panel).toBe(true);
    expect(g.elegido).toEqual({ proveedor: "claude-code", modelo: "otro" });
    expect(g.ocultos).toEqual(["L1", "L2"]);
    // Las claves del pedido de antes se borran; lo que no es del pedido (los cerebros elegidos) queda.
    expect([...local.keys()].sort()).toEqual(["flowbrain.especificaciones.cerebros", "flowbrain.pedido"]);
    expect(cuentaAgente(v.bandeja())).toBe("2");
    // Una vez migrado, no se vuelve a migrar.
    local.set("flowbrain.sinasociar.pedidos", JSON.stringify([{ k: "otro", linea: "x" }]));
    expect(montar({ local }).guardado().items).toHaveLength(2);
  });

  it("con agente: estima el costo total, Pedir todos manda un lote por tipo y sigue cada uno; lo resuelto sale de la lista", async () => {
    const llamadas: Array<{ url: string; cuerpo: Record<string, any> | null }> = [];
    const estado: { trabajos: Array<Record<string, unknown>>; lotes: Array<Record<string, unknown>> } = { trabajos: [], lotes: [] };
    const fetch = (url: string, init: { method: string; body?: string }) => {
      const cuerpo = init.body ? (JSON.parse(init.body) as Record<string, any>) : null;
      llamadas.push({ url, cuerpo });
      const j = url === "/api/agente/lote" ? { lote: { id: cuerpo!["tipo"] === "test" ? "LT" : "LA", tipo: cuerpo!["tipo"], estado: "corriendo" }, trabajos: [] } : url === "/api/agente" ? estado : {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
    };
    const local = new Map<string, string>();
    const v = montar({ agente: true, fetch, local });
    registrar(v.P);
    const avisos: string[] = [];
    v.P.escuchar((ev) => avisos.push(ev));
    await esperar();
    v.P.sumar("test", "caso");
    v.P.sumar("asociar", "a");
    let p = v.panel();
    expect(p).toContain('<select id="pedido-modelo">');
    // Por tipo y en total: 2 reglas a 0.40 y 1 archivo a 0.10.
    expect(p).toContain("Estimated cost: ≈ US$ 0.80 <small>(approx., with Opus)</small>");
    expect(p).toContain("Estimated cost: ≈ US$ 0.10 <small>(approx., with Opus)</small>");
    expect(p).toContain("<b>Total: 3 items</b><span>Estimated cost: ≈ US$ 0.90</span>");
    expect(p).toContain('data-acc="pedir-todos">Request all (3)</button>');
    // Un modelo sin estimación lo dice, y el total avisa que falta.
    v.cambiar("pedido-modelo", "otro");
    expect(v.guardado().elegido).toEqual({ proveedor: "claude-code", modelo: "otro" });
    expect(avisos).toContain("elegido");
    expect(v.panel()).toContain("no estimate for this model");
    expect(v.panel()).toContain(" (plus what has no estimate)");
    v.cambiar("pedido-modelo", "opus");

    v.tocar({ "data-acc": "pedir-todos" });
    estado.lotes = [{ id: "LT", tipo: "test", estado: "corriendo" }, { id: "LA", tipo: "asociar", estado: "corriendo" }];
    estado.trabajos = [
      { id: "t1", lote: "LT", repo: "repo-web", tanda: { n: 1, de: 1 }, estado: "corriendo", pasos: ["Corre los tests"], reglas: ["r1", "r2"] },
      { id: "a1", lote: "LA", repo: "repo-web", tanda: { n: 1, de: 1 }, estado: "corriendo", pasos: [], archivos: ["web|repo-web:src/a.ts"] },
    ];
    await esperar();
    const lotes = llamadas.filter((x) => x.url === "/api/agente/lote").map((x) => x.cuerpo);
    expect(lotes).toEqual([
      { tipo: "test", reglas: [{ regla: "r1" }, { regla: "r2" }], proveedor: "claude-code", modelo: "opus" },
      { tipo: "asociar", archivos: [{ archivo: "repo-web:src/a.ts" }], proveedor: "claude-code", modelo: "opus" },
    ]);
    p = v.panel();
    expect(p).toContain('<section class="es-lote" data-tipo="test"><div class="es-cab"><h3>Pidiendo 2 reglas</h3>');
    expect(p).toContain("<h3>Asociando 1</h3>");
    expect(p).toContain("Corre los tests");
    // Al mandar, el panel pasa solo a «Trabajando»: lo que va en una tanda se ve ahí, sin «Quitar», y no suma al botón.
    expect(p).toContain('<div class="pd-etapa" data-etapa="trabajando">');
    expect(v.guardado().etapa).toBe("trabajando");
    expect(p).toContain('<p class="pd-estado na">The agent is working on it…</p>');
    expect(p).not.toMatch(/data-acc="quitar" data-tipo="test"/);
    expect(p).toContain('data-k="trabajando">Working <span class="pd-num">3</span>');
    expect(p).toContain('data-k="pedir">To request <span class="pd-num">0</span>');
    expect(cuentaAgente(v.bandeja())).toBe("1");
    expect(v.bandeja()).toContain('<span class="pd-corre"');
    // Con los dos lotes en curso no se manda otro.
    v.tocar({ "data-acc": "etapa", "data-k": "pedir" });
    expect(v.panel()).toContain("Nothing to request");
    expect(v.panel()).toContain('data-acc="etapa" data-k="trabajando">See what\'s running</button>');
    v.tocar({ "data-acc": "etapa", "data-k": "trabajando" });

    // Terminan con el panel cerrado: r1 se resolvió, r2 no volvió; el archivo se asoció. Cada ítem trae su desenlace.
    v.tocar({ "data-acc": "cerrar-panel" });
    estado.lotes = [{ id: "LT", tipo: "test", estado: "terminado" }, { id: "LA", tipo: "asociar", estado: "terminado" }];
    estado.trabajos = [
      { ...estado.trabajos[0], estado: "terminado", costoUsd: 0.5, resultado: "Listo.", desenlaces: [{ item: "r1", resuelto: true, cambio: { resultado: "a", tests: ["repo-web:a.test.ts::r1"] } }, { item: "r2", resuelto: false, motivo: { codigo: "sin_respuesta", agente: "Needs a database", detalle: "the agent did not return a valid outcome for this rule" } }] },
      { ...estado.trabajos[1], estado: "terminado", desenlaces: [{ item: "web|repo-web:src/a.ts", resuelto: true, cambio: { asociado: true } }] },
    ];
    v.tocar({ "data-acc": "cancelar-lote", "data-k": "LT" });
    await esperar();
    expect(llamadas.find((x) => x.url === "/api/agente/lote/cancelar")!.cuerpo).toEqual({ id: "LT" });
    p = v.panel();
    // No dejó nada nuevo para revisar: se queda en «Trabajando», que muestra cómo terminó cada ítem.
    expect(v.guardado().etapa).toBe("trabajando");
    expect(p).toContain("Finished · Tests");
    expect(p).toContain("Actual cost: US$ 0.50");
    // Todo lo de las tandas sale de la lista y queda con su desenlace (dec. 235), igual para los dos tipos.
    expect(v.P.items("test")).toEqual([]);
    expect(v.P.items("asociar")).toEqual([]);
    expect(avisos).toContain("trabajos");
    expect(avisos).toContain("lista");
    expect(p).toContain("<span>1 resolved · 1 could not be resolved · listo.</span>");
    expect(p).toContain("<small>1 resolved · 1 could not be resolved</small>");
    expect(p).toContain('<summary>What the agent said</summary><p class="es-resultado">Listo.</p>');
    expect(p).toContain('<p class="pd-estado no">✕ It could not resolve it: the agent didn\'t return a valid result. The agent says: «Needs a database» <small>(the agent did not return a valid outcome for this rule)</small></p>');
    expect(p).toContain('<button type="button" class="boton chico" data-acc="otra-vez" data-tipo="test" data-k="web/feat|r2">Request again</button>');
    expect(p).toContain('<p class="pd-estado ok">✔ Resolved by the agent · new test <code>repo-web:a.test.ts::r1</code></p>');
    expect(p).toContain('<p class="pd-estado ok">✔ Resolved by the agent · file assigned</p>');
    expect(p).not.toContain("Reload to see the changes");
    // La misma marca junto a cada botón «Pedir»: resuelto, o no (y el botón dice «Pedir de nuevo»).
    expect(v.P.boton({ tipo: "test", k: "r1", et: "Request" })).toContain('>Request</button><span class="pd-marca ok" title="Resolved by the agent: new test repo-web:a.test.ts::r1">✔ Resolved by the agent · new test <code>repo-web:a.test.ts::r1</code></span>');
    expect(v.P.boton({ tipo: "test", k: "caso", et: "Request both" })).toContain('>Request again</button><span class="pd-marca no" title="the agent didn&#39;t return a valid result. The agent says: «Needs a database» (the agent did not return a valid outcome for this rule)">✕ It could not resolve it</span>');
    expect(v.P.boton({ tipo: "asociar", k: "a", et: "Request" })).toContain("✔ Resolved by the agent · file assigned");
    // El botón «Agente» avisa que terminó (con el panel cerrado) hasta que se abre el panel.
    expect(v.bandeja()).toContain('<span class="pd-aviso"');
    expect(v.bandeja()).toContain(">finished</span>");
    v.tocar({ "data-acc": "panel" });
    v.tocar({ "data-acc": "panel" });
    expect(v.bandeja()).not.toContain("pd-aviso");
    // «Pedir de nuevo» lo vuelve a sumar, con su marca fuera.
    v.tocar({ "data-acc": "otra-vez", "data-tipo": "test", "data-k": "web/feat|r2" });
    expect(v.P.items("test").map((x) => x.k)).toEqual(["web/feat|r2"]);
    expect(v.P.boton({ tipo: "test", k: "caso", et: "Request both" })).not.toContain("pd-marca");
    v.tocar({ "data-acc": "etapa", "data-k": "pedir" });
    expect(v.panel()).toContain('data-acc="pedir-todos">Request all (1)</button>');
    v.tocar({ "data-acc": "etapa", "data-k": "trabajando" });
    // Cerrar un resumen lo oculta (y se recuerda), con los desenlaces de ese lote.
    v.tocar({ "data-acc": "cerrar-lote", "data-k": "LT" });
    expect(v.P.boton({ tipo: "test", k: "r1", et: "Request" })).not.toContain("pd-marca");
    expect(v.P.boton({ tipo: "asociar", k: "a", et: "Request" })).toContain("pd-marca ok");
    expect(v.panel()).not.toContain('data-tipo="test"><div class="es-cab"><h3>Finished');
    expect(v.guardado().ocultos).toEqual(["LT"]);
    // Una tanda limpia la lista una sola vez: si se vuelve a pedir r1, queda.
    v.P.sumar("test", "r1");
    v.P.sumar("test", "r1");
    v.P.sumar("test", "r1");
    await esperar();
    expect(v.P.esta("test", "web/feat|r1")).toBe(true);

    // Prueba real: un lote cancelado no informa costo (no muestra «US$ 0» como si no hubiera gastado), y lo que está en
    // curso va arriba de los resúmenes terminados, para que «Cancelar todo» no quede fuera de la vista.
    estado.lotes = [{ id: "LT3", tipo: "test", estado: "terminado" }, { id: "LA2", tipo: "asociar", estado: "corriendo" }];
    estado.trabajos = [
      { id: "t3", lote: "LT3", repo: "repo-web", tanda: { n: 1, de: 1 }, estado: "cancelado", pasos: [], reglas: ["r9"], desenlaces: [{ item: "r9", resuelto: false, motivo: { codigo: "cancelado" } }] },
      { id: "a2", lote: "LA2", repo: "repo-web", tanda: { n: 1, de: 1 }, estado: "corriendo", pasos: [], archivos: ["web|repo-web:src/b.ts"] },
    ];
    v.P.actualizar();
    await esperar();
    v.tocar({ "data-acc": "etapa", "data-k": "trabajando" });
    p = v.panel();
    const enCurso = p.indexOf('<section class="es-lote" data-tipo="asociar">'), terminado = p.indexOf('<section class="es-lote" data-tipo="test">');
    expect(enCurso).toBeGreaterThanOrEqual(0);
    expect(terminado).toBeGreaterThan(enCurso);
    expect(p).toContain('<small class="pd-sin-costo"> (without the canceled batches: the agent reports no cost for them)</small>');
  });

  it("un lote que termina y deja algo nuevo para revisar pasa el panel a «A revisar» (y se recuerda al recargar)", async () => {
    const estado: { trabajos: Array<Record<string, unknown>>; lotes: Array<Record<string, unknown>> } = { trabajos: [], lotes: [] };
    const fetch = (url: string, init: { body?: string }) => {
      const cuerpo = init.body ? (JSON.parse(init.body) as Record<string, any>) : null;
      const j = url === "/api/agente/lote" ? { lote: { id: "LT", tipo: cuerpo!["tipo"], estado: "corriendo" }, trabajos: [] } : url === "/api/agente" ? estado : {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
    };
    const local = new Map<string, string>();
    const v = montar({ agente: true, fetch, local });
    registrar(v.P);
    await esperar();
    v.P.sumar("test", "r1");
    estado.lotes = [{ id: "LT", tipo: "test", estado: "corriendo" }];
    estado.trabajos = [{ id: "t1", lote: "LT", repo: "repo-web", tanda: { n: 1, de: 1 }, estado: "corriendo", reglas: ["r1"] }];
    v.tocar({ "data-acc": "pedir-todos" });
    await esperar();
    expect(v.guardado().etapa).toBe("trabajando");
    // Termina; mientras la pantalla vuelve a leer lo suyo, el panel espera (no decide con el número viejo).
    REVISAR.cargando = true;
    estado.lotes = [{ id: "LT", tipo: "test", estado: "terminado" }];
    estado.trabajos = [{ ...estado.trabajos[0], estado: "terminado", desenlaces: [{ item: "r1", resuelto: true, cambio: { resultado: "c" } }] }];
    (v.P as unknown as { actualizar(): void }).actualizar();
    await esperar();
    expect(v.guardado().etapa).toBe("trabajando");
    // Ya leyó: hay una regla más para decidir.
    REVISAR.n = 2; REVISAR.cargando = false;
    (v.P as unknown as { pintar(): void }).pintar();
    await esperar();
    expect(v.guardado().etapa).toBe("revisar");
    expect(v.panel()).toContain('<div class="pd-etapa" data-etapa="revisar">');
    expect(cuentaAgente(v.bandeja())).toBe("2");
    // Con el panel abierto, la etapa que cambió sola ya lo muestra: el botón no suma el aviso «terminó».
    expect(v.bandeja()).not.toContain("pd-aviso");
    // La etapa abierta se recuerda.
    const otra = montar({ local });
    registrar(otra.P);
    expect(otra.panel()).toContain('<div class="pd-etapa" data-etapa="revisar">');
  });

  it("el .md lleva cada tipo; con un solo tipo, su archivo", async () => {
    const v = montar();
    registrar(v.P);
    v.P.sumar("asociar", "a");
    v.tocar({ "data-acc": "descargar-lista" });
    expect(v.bajados[0]!.nombre).toBe("archivos-pedidos.md");
    v.P.sumar("test", "r1");
    v.tocar({ "data-acc": "descargar-lista" });
    expect(v.bajados[1]!.nombre).toBe("flowbrain-request.md");
    expect(await v.bajados[1]!.texto()).toBe("# Tests\n- r1\n\n---\n\n# Files\n- repo-web:src/a.ts\n");
  });
});

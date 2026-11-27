import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import { FIDELIDAD_JS } from "../src/viewer-fidelidad.js";
import { FILTROS_JS } from "../src/viewer-filtros.js";
import { PEDIDO_JS } from "../src/viewer-pedido.js";

const DEL_PEDIDO = new Set(["panel", "cerrar-panel", "quitar", "vaciar", "pedir-todos", "descargar-lista", "cancelar-lote", "cerrar-lote"]);

/**
 * La pantalla Fidelidad es JavaScript plano que corre en el navegador. Acá se la corre con un DOM mínimo (elementos con
 * `innerHTML` y oyentes) para fijar lo que importa: qué lista, cómo filtra y qué dice cuando queda vacía.
 */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
function montar(datos: Record<string, unknown>, opciones: { edicion?: unknown; lang?: "es"; guardado?: Map<string, string>; local?: Map<string, string>; fetch?: (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => Promise<unknown> } = {}) {
  const guardado = opciones.guardado ?? new Map<string, string>();
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
  const window = { brainVisor: { D: datos, porId, esc }, brainFiltros: null as unknown, brainFidelidad: null as null | { mostrar(): void }, FLOWBRAIN_EDICION: opciones.edicion, ...(opciones.lang ? { brainI18n: { lang: opciones.lang } } : {}) };
  let recargas = 0;
  new Function("window", "document", "sessionStorage", FILTROS_JS)(window, { getElementById: el }, sessionStorage);
  // «Descargar .md»: el documento guarda lo que se baja.
  const bajados: Array<{ nombre: string; texto: () => Promise<string> }> = [];
  const documento = { getElementById: el, body: { appendChild() {}, removeChild() {} }, createElement: () => ({ href: "", download: "", click() { const h = this.href; bajados.push({ nombre: this.download, texto: () => resolveObjectURL(h)!.text() }); } }) };
  // El pedido al agente: el componente único del visor, con su panel (#pedido-panel) y su bandeja (#pedido-bandeja).
  new Function("window", "document", "localStorage", "fetch", PEDIDO_JS)(window, documento, localStorage, opciones.fetch);
  new Function("window", "document", "sessionStorage", "fetch", "location", FIDELIDAD_JS)(window, documento, sessionStorage, opciones.fetch, { reload: () => void recargas++ });
  const raiz = el("fidelidad");
  // Al repintar la página entera, la lista va adentro: se la deja también en su elemento, como haría el navegador.
  let html = "";
  Object.defineProperty(raiz, "innerHTML", {
    get: () => html,
    set: (v: string) => {
      html = v;
      const i = v.indexOf('<div id="fd-lista">');
      el("fd-lista").innerHTML = i < 0 ? "" : v.slice(i);
      const g = v.indexOf('<div id="fd-graficos">');
      el("fd-graficos").innerHTML = g < 0 ? "" : v.slice(g, i < 0 ? undefined : i);
    },
  });
  window.brainFidelidad!.mostrar();
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs }) });
  return {
    pagina: () => raiz.innerHTML,
    graficos: () => el("fd-graficos").innerHTML,
    lista: () => el("fd-lista").innerHTML,
    rutas: () => [...el("fd-lista").innerHTML.matchAll(/<div class="fd-ruta"><code>([^<]+)<\/code>/g)].map((m) => m[1]),
    cambiar: (id: string, value: string) => raiz.oyentes["change"]!({ target: { id, value } }),
    escribir: (value: string) => raiz.oyentes["input"]!({ target: { id: "fd-q", value } }),
    // Los botones del pedido (panel y bandeja) son del componente; los demás, de la pantalla.
    tocar: (attrs: Record<string, string>) => (DEL_PEDIDO.has(attrs["data-acc"] ?? "") ? el(attrs["data-acc"] === "panel" ? "pedido-bandeja" : "pedido-panel") : raiz).oyentes["click"]!({ target: boton(attrs) }),
    panel: () => el("pedido-panel").innerHTML,
    bandeja: () => el("pedido-bandeja").innerHTML,
    bajados,
    // Del filtro compartido: un grupo o una barra de la estadística.
    grupo: (g: string) => raiz.oyentes["click"]!({ target: boton({ "data-fl": "fd", "data-grupo": g }) }),
    barra: (set: Record<string, string | number>) => raiz.oyentes["click"]!({ target: boton({ "data-fl": "fd", "data-fl-set": JSON.stringify(set) }) }),
    poner: (id: string, value: string) => void ((el(id) as unknown as { value: string }).value = value),
    // Una casilla: se marca en el elemento y, salvo que se pida que no, se avisa el cambio.
    marcar: (id: string, checked: boolean, avisar = true) => {
      (el(id) as unknown as { checked: boolean }).checked = checked;
      if (avisar) raiz.oyentes["change"]!({ target: { id, checked } });
    },
    recargas: () => recargas,
  };
}

type T = [string, 0 | 1, string, string, number[]];
const fila = (c: number, a: string, p: number, f: string[], s: Record<string, [number, number]>, t: T[], l = "ts", k = "otros", u?: 1) => ({ a, c, p, l, k, f, s, t, ...(u ? { u } : {}) });
const datos = {
  cerebros: [{ nombre: "front" }, { nombre: "back" }],
  nodes: [{ id: "front/feat-pedidos", n: "Pedidos" }],
  fidelidad: {
    archivos: [
      fila(0, "front/repo-web:src/Pedidos.tsx", 100, ["front/feat-pedidos"], { pantallas: [1, 1] }, [], "tsx", "interfaz"),
      fila(0, "front/repo-web:src/api.ts", 50, ["front/feat-pedidos"], { http: [1, 2] }, [["http", 1, "1 llamada HTTP cuya ruta no se pudo leer", "Escribir la ruta.", [14]]]),
      // Sin funcionalidad: no resta puntaje ni tiene tareas; se asocia en la pantalla Sin asociar.
      fila(0, "front/repo-web:src/suelto.ts", 100, [], {}, [], "ts", "otros", 1),
      fila(1, "back/repo-api:src/Servicio.php", 60, [], { llamadas: [1, 2], datos: [1, 2] }, [["llamadas", 1, "1 llamada que no se sabe a qué método va", "Decir a qué método va.", [6]], ["datos", 0, "1 acceso a una tabla sin saber qué columnas toca", "Enseñarlo con un extractor.", []]], "php", "logica"),
    ],
    inciertos: [
      { a: "back/repo-api:config.json", m: 0, l: "json", k: "otros", f: [], c: 1 },
      { a: "front/repo-web:src/tipos.ts", m: 1, l: "ts", k: "dominio", f: ["front/feat-pedidos"], c: 0 },
    ],
    plan: { reglas: ["Editá solo archivos del cerebro."], como: { llamadas: "declarala en calls.yaml", http: "declarala en la sección http", datos: "seguí flowbrain coverage --guide" }, cierre: ["Reindexá: flowbrain brains apply <cerebro>."] },
  },
};

describe("pantalla Fidelidad", () => {
  it("lista los archivos de todos los cerebros, de menor a mayor, con qué falta y qué hacer", () => {
    const v = montar(datos);
    expect(v.rutas()).toEqual(["src/api.ts", "src/Servicio.php", "src/Pedidos.tsx", "src/suelto.ts"]);
    expect(v.pagina()).toContain("average score");
    expect(v.lista()).toContain("1 llamada HTTP cuya ruta no se pudo leer");
    expect(v.lista()).toContain("Escribir la ruta.");
    expect(v.lista()).toContain('<a class="chip fd-sinfeat" href="#/sin-asociar"');
    expect(v.lista()).toContain("Complete: everything the index saw here is linked.");
    // Lo que no se pudo medir se explica, no se esconde.
    expect(v.pagina()).toContain("2 files have uncertain fidelity");
    expect(v.pagina()).toContain('data-grupo="incierta" aria-pressed="false">Uncertain fidelity <small>2</small>');
    v.tocar({ "data-acc": "orden" });
    expect(v.rutas()[0]).toBe("src/Pedidos.tsx");
  });

  it("cadena de trazabilidad: lo entendido, dónde se corta y lo que no aplica", () => {
    const v = montar(datos);
    const cadenas = [...v.lista().matchAll(/<div class="fd-cadena"[^>]*>(.*?)<\/div>/g)].map((m) => [...m[1]!.matchAll(/class="fd-es (\w+)"[^>]*>([^<]+)</g)].map((e) => `${e[2]}:${e[1]}`));
    // api.ts: una de dos llamadas HTTP quedó sin unir.
    expect(cadenas[0]).toEqual(["Screen:na", "HTTP 1/2:no", "Endpoint:na", "Calls:na", "Data:na"]);
    expect(cadenas[2]).toEqual(["Screen:ok", "HTTP:na", "Endpoint:na", "Calls:na", "Data:na"]);
    // suelto.ts: no hay nada que medir, y que no tenga funcionalidad no entra en la cadena.
    expect(cadenas[3]).toEqual(["Screen:na", "HTTP:na", "Endpoint:na", "Calls:na", "Data:na"]);
  });

  it("agrupa por quién resuelve lo que falta; un archivo con las dos cosas está en los dos grupos", () => {
    const v = montar(datos);
    expect(v.pagina()).toContain('data-grupo="vos" aria-pressed="false">You resolve it <small>2</small>');
    expect(v.pagina()).toContain('data-grupo="agente" aria-pressed="false">The agent resolves it <small>1</small>');
    expect(v.pagina()).toContain('data-grupo="completos" aria-pressed="false">Complete <small>2</small>');
    v.grupo("agente");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.grupo("completos");
    expect(v.rutas()).toEqual(["src/Pedidos.tsx", "src/suelto.ts"]);
    v.grupo("vos");
    expect(v.rutas()).toEqual(["src/api.ts", "src/Servicio.php"]);
  });

  it("los filtros y la estadística se ven siempre, y filtran por rango, cerebro, tipo, funcionalidad, signal y texto", () => {
    const v = montar(datos);
    expect(v.pagina()).not.toContain('data-acc="mas-filtros"');
    expect(v.pagina()).toContain('id="fd-lenguaje"');
    expect(v.pagina()).toContain("By brain");
    v.cambiar("fd-min", "40");
    v.cambiar("fd-max", "60");
    expect(v.rutas()).toEqual(["src/api.ts", "src/Servicio.php"]);
    v.cambiar("fd-cerebro", "1");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.tocar({ "data-fl": "fd", "data-fl-limpiar": "1" });
    v.cambiar("fd-feat", "front/feat-pedidos");
    expect(v.rutas()).toEqual(["src/api.ts", "src/Pedidos.tsx"]);
    v.cambiar("fd-feat", "__ninguna");
    expect(v.rutas()).toEqual(["src/suelto.ts"]);
    v.cambiar("fd-feat", "");
    v.cambiar("fd-lenguaje", "php");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.cambiar("fd-lenguaje", "");
    // Las barras del resumen prenden y apagan su filtro.
    v.barra({ signal: "http" });
    expect(v.rutas()).toEqual(["src/api.ts"]);
    v.barra({ signal: "http" });
    v.barra({ min: 100, max: 100 });
    expect(v.rutas()).toEqual(["src/Pedidos.tsx", "src/suelto.ts"]);
    v.barra({ min: 100, max: 100 });
    v.escribir("a qué método");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
  });

  it("la estadística se calcula sobre el mismo conjunto que la lista; cada panel no aplica su propio filtro", () => {
    const v = montar(datos);
    const seccion = (titulo: string) => { const p = v.graficos(), i = p.indexOf("<h2>" + titulo); return p.slice(i, p.indexOf("</section>", i)); };
    const barra = (sec: string, attr: string) => { const i = sec.indexOf(attr); return sec.slice(i, sec.indexOf("</button>", i)); };
    // Sin filtros: todos los archivos medidos.
    expect(seccion("Score distribution")).toContain("Across all measured files · 4 files");
    expect(barra(seccion("Score distribution"), 'data-fl-set="{&#34;min&#34;:100,&#34;max&#34;:100}"')).toContain("2 files");
    expect(barra(seccion("What was understood"), 'data-fl-set="{&#34;signal&#34;:&#34;http&#34;}"')).toContain("50% · 1 file with gaps");
    // Cerebro back: el reparto y las signals cuentan solo sus archivos; Por cerebro sigue mostrando todos, con back marcado.
    v.cambiar("fd-cerebro", "1");
    expect(seccion("Score distribution")).toContain("Across brain back · 1 file");
    expect(barra(seccion("Score distribution"), 'data-fl-set="{&#34;min&#34;:100,&#34;max&#34;:100}"')).toContain("0 files");
    expect(barra(seccion("Score distribution"), 'data-fl-set="{&#34;min&#34;:60,&#34;max&#34;:79}"')).toContain("1 file");
    expect(seccion("What was understood")).toContain("Across brain back · 1 file");
    expect(seccion("What was understood")).not.toContain('data-fl-set="{&#34;signal&#34;:&#34;http&#34;}"');
    expect(seccion("What was understood")).toContain("Not applicable to these files: HTTP calls, Endpoint flow, Response type, Screens with calls.");
    expect(barra(seccion("What was understood"), 'data-fl-set="{&#34;signal&#34;:&#34;llamadas&#34;}"')).toContain("50% · 1 file with gaps");
    expect(seccion("By brain")).toContain("Across all measured files · 4 files · ignoring the chosen brain");
    expect(seccion("By brain")).toContain('data-fl-set="{&#34;cerebro&#34;:&#34;0&#34;}"');
    expect(seccion("By brain")).toMatch(/fd-barra on" data-fl="fd" data-fl-set="\{&#34;cerebro&#34;:&#34;1&#34;\}"/);
    // Los demás filtros también: tipo tsx deja un solo archivo en todos los paneles, y un cerebro sin coincidencias lo dice.
    v.cambiar("fd-cerebro", "");
    v.cambiar("fd-lenguaje", "tsx");
    expect(seccion("Score distribution")).toContain("Across type tsx · 1 file");
    expect(seccion("By brain")).toContain("<strong>back</strong> · no file matches the other filters");
    // El rango de puntaje filtra la lista, pero el reparto no se lo aplica a sí mismo: lo marca en su barra.
    v.cambiar("fd-lenguaje", "");
    v.barra({ min: 40, max: 59 });
    expect(seccion("Score distribution")).toContain("Across all measured files · 4 files · ignoring the score range");
    expect(seccion("Score distribution")).toMatch(/fd-barra on" data-fl="fd" data-fl-set="\{&#34;min&#34;:40,&#34;max&#34;:59\}"/);
    expect(seccion("What was understood")).toContain("Across score 40 to 59 · 1 file");
    // Un conjunto vacío lo dice y ofrece salir.
    v.escribir("no-existe");
    // Buscar repinta la estadística junto con la lista.
    expect(seccion("Score distribution")).toContain("No file matches the other filters");
  });

  it("fidelidad incierta: un apartado sin puntaje, con el porqué de cada archivo, fuera del promedio", () => {
    const v = montar(datos);
    // El promedio es solo de los medidos: (50 + 60 + 100 + 100) / 4.
    expect(v.pagina()).toContain("<b style=\"color:var(--atencion)\">77.5</b><span>average score of what was measured</span>");
    expect(v.pagina()).toContain("<b>2</b><span>of uncertain fidelity</span>");
    v.grupo("incierta");
    // Primero los que tienen código; cada uno dice por qué no se lo puede medir.
    expect(v.rutas()).toEqual(["src/tipos.ts", "config.json"]);
    expect(v.lista()).toContain('<span class="fd-p fd-inc" title="Uncertain fidelity">?</span>');
    expect(v.lista()).toContain("The index saw code, but no relationship to measure");
    expect(v.lista()).toContain("The index found nothing here");
    expect(v.lista()).toContain("2 files of uncertain fidelity: 1 with code but no relationships, 1 where the index saw nothing");
    expect(v.lista()).toContain('<a class="chip" href="#/f/front%2Ffeat-pedidos">Pedidos</a>');
    // No hay plan ni tareas para ellos, y la búsqueda también los filtra.
    expect(v.lista()).not.toContain('data-acc="plan"');
    v.escribir("config");
    expect(v.rutas()).toEqual(["config.json"]);
    v.escribir("nada-que-coincida");
    expect(v.lista()).toContain("No uncertain-fidelity file matches the filters. There are 2 files in total.");
  });

  it("un vacío dice por qué está vacío y ofrece salir", () => {
    const v = montar(datos);
    v.cambiar("fd-cerebro", "1");
    v.cambiar("fd-lenguaje", "tsx");
    expect(v.rutas()).toEqual([]);
    expect(v.lista()).toContain("No file matches brain back, type tsx");
    expect(v.lista()).toContain("4 measured files in total");
    expect(v.lista()).toContain('data-fl-limpiar="1"');
    // Sin índice de código no hay lista: se dice cómo conseguirla.
    expect(montar({ cerebros: [], nodes: [], fidelidad: null }).pagina()).toContain("There is no code index");
  });

  it("recuerda el filtro al recargar", () => {
    const guardado = new Map<string, string>();
    const v = montar(datos, { guardado });
    v.grupo("agente");
    expect(montar(datos, { guardado }).rutas()).toEqual(["src/Servicio.php"]);
  });

  it("pedido al agente: «Pedir» por archivo y «Pedir los N de la lista», con las relaciones marcadas, al panel único", async () => {
    const local = new Map<string, string>();
    const v = montar(datos, { local });
    // Nada para copiar y pegar: ni textos ni botones de copiar.
    expect(v.pagina()).not.toContain("<textarea");
    expect(v.pagina()).not.toContain("Copy");
    // Los dos archivos con faltas tienen su «Pedir»; arriba, las casillas y «Pedir los 2 de la lista».
    expect(v.lista().match(/data-acc="pedir" data-tipo="fidelidad" data-k="a\|/g)).toHaveLength(2);
    expect(v.lista()).toContain('data-k="l|" data-et="Request the 2 in the list"');
    expect(v.lista()).toContain('id="fd-pl-s-http" checked');
    // Sin HTTP marcado, api.ts (que solo tiene eso) ya no se pide.
    v.marcar("fd-pl-s-http", false);
    expect(v.lista()).toContain('data-et="Request it"');
    expect(v.lista().match(/data-k="a\|/g)).toHaveLength(1);
    v.marcar("fd-pl-s-http", true);
    v.tocar({ "data-acc": "pedir", "data-tipo": "fidelidad", "data-k": "a|front/repo-web:src/api.ts" });
    expect(v.lista()).toContain("✔ In the request");
    expect(v.bandeja()).toContain(">Request (1)</button>");
    // La tarjeta: el archivo, su puntaje y lo que le falta.
    expect(v.panel()).toContain("<code>src/api.ts</code> <small>repo-web</small>");
    expect(v.panel()).toContain(">50/100</span>");
    expect(v.panel()).toContain('title="1 llamada HTTP cuya ruta no se pudo leer">HTTP calls · L14</span>');
    expect(v.panel()).toContain('data-acc="quitar" data-tipo="fidelidad" data-k="front/repo-web:src/api.ts"');
    // La lista entera: suma lo que falta (Servicio.php, solo con lo de llamadas si se desmarca datos).
    v.marcar("fd-pl-s-datos", false);
    v.tocar({ "data-acc": "pedir", "data-tipo": "fidelidad", "data-k": "l|" });
    expect(v.bandeja()).toContain(">Request (2)</button>");
    const items = (JSON.parse(local.get("flowbrain.pedido")!) as { items: Array<{ tipo: string; k: string; cerebro: string; repo: string; datos: { archivo: string; p: number; t: unknown[] } }> }).items;
    expect(items.map((x) => [x.tipo, x.k, x.cerebro, x.repo, x.datos.archivo])).toEqual([["fidelidad", "front/repo-web:src/api.ts", "front", "repo-web", "repo-web:src/api.ts"], ["fidelidad", "back/repo-api:src/Servicio.php", "back", "repo-api", "repo-api:src/Servicio.php"]]);
    expect(items[1]!.datos.t).toEqual([["llamadas", "1 llamada que no se sabe a qué método va", [6]]]);
    // El .md: el mismo plan que flowbrain fidelity --plan, en inglés, de menor a mayor puntaje.
    v.tocar({ "data-acc": "descargar-lista" });
    expect(v.bajados[0]!.nombre).toBe("fidelity-plan.md");
    const md = await v.bajados[0]!.texto();
    expect(md).toContain("Goal: bring the fidelity score of 2 files");
    expect(md).toContain("- [ ] llamadas: 1 llamada que no se sabe a qué método va (L6).");
    expect(md).not.toContain("- [ ] datos");
    expect(md).toContain("- **http**: declarala en la sección http");
    expect(md).toContain("1. Reindexá: flowbrain brains apply <cerebro>.");
    expect(md.indexOf("src/api.ts")).toBeLessThan(md.indexOf("src/Servicio.php"));
    // Otra vez la lista entera: ya está todo, así que lo saca.
    v.tocar({ "data-acc": "pedir", "data-tipo": "fidelidad", "data-k": "l|" });
    expect(v.bandeja()).not.toContain("Request (");
  });

  it("al volver, lo pedido se pone al día con lo que mide la página: lo que ya no falta sale", () => {
    const local = new Map<string, string>();
    const v = montar(datos, { local });
    v.tocar({ "data-acc": "pedir", "data-tipo": "fidelidad", "data-k": "l|" });
    expect(v.bandeja()).toContain(">Request (2)</button>");
    // Se reindexó: api.ts llegó a 100 y Servicio.php ya no tiene la falta de datos.
    const archivos = (datos.fidelidad.archivos as Array<Record<string, unknown>>).map((x) =>
      x["a"] === "front/repo-web:src/api.ts" ? { ...x, p: 100, s: { http: [2, 2] }, t: [] } : x["a"] === "back/repo-api:src/Servicio.php" ? { ...x, t: (x["t"] as T[]).filter((t) => t[0] !== "datos") } : x);
    const otra = montar({ ...datos, fidelidad: { ...datos.fidelidad, archivos } }, { local });
    expect(otra.bandeja()).toContain(">Request (1)</button>");
    const items = (JSON.parse(local.get("flowbrain.pedido")!) as { items: Array<{ k: string; datos: { t: unknown[] } }> }).items;
    expect(items.map((x) => [x.k, x.datos.t.length])).toEqual([["back/repo-api:src/Servicio.php", 1]]);
  });

  it("servida con un agente: el panel estima el costo por archivo y «Pedir todos» manda un lote «fidelidad»", async () => {
    const pedidos: Array<{ url: string; cuerpo: Record<string, unknown> | null }> = [];
    const fetch = (url: string, init: { method: string; body?: string }) => {
      pedidos.push({ url, cuerpo: init.body ? JSON.parse(init.body) : null });
      const json = url === "/api/agente/lote" ? { lote: { id: "l1", tipo: "fidelidad", estado: "corriendo" }, trabajos: [] } : { trabajos: [], lotes: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
    };
    const agente = { proveedores: [{ id: "claude-code", nombre: "Claude Code", modelos: [{ id: "claude-opus-5-5", nombre: "Opus 5.5", porDefecto: true, costoPorFidelidadUsd: 0.25 }] }] };
    const v = montar(datos, { edicion: { token: "t", sinAplicar: [], agente }, fetch });
    v.tocar({ "data-acc": "pedir", "data-tipo": "fidelidad", "data-k": "l|" });
    expect(v.panel()).toContain("≈ US$ 0.50");
    expect(v.panel()).toContain("3 gaps to resolve");
    expect(v.panel()).toContain("In 2 batches of up to 10 files of the same repo");
    v.tocar({ "data-acc": "pedir-todos" });
    await new Promise((ok) => setTimeout(ok, 0));
    const lote = pedidos.find((p) => p.url === "/api/agente/lote")!.cuerpo!;
    expect(lote).toMatchObject({ tipo: "fidelidad", proveedor: "claude-code", modelo: "claude-opus-5-5" });
    expect(lote["archivos"]).toEqual([
      { cerebro: "front", archivo: "repo-web:src/api.ts", puntaje: 50, tareas: [{ signal: "http", que: "1 llamada HTTP cuya ruta no se pudo leer", lineas: [14] }] },
      { cerebro: "back", archivo: "repo-api:src/Servicio.php", puntaje: 60, tareas: [{ signal: "llamadas", que: "1 llamada que no se sabe a qué método va", lineas: [6] }, { signal: "datos", que: "1 acceso a una tabla sin saber qué columnas toca", lineas: [] }] },
    ]);
  });

  it("abierta como archivo es de solo lectura y lo dice; servida, ofrece resolver lo que depende de una persona", () => {
    const fija = montar(datos);
    expect(fija.pagina()).toContain("This page is read-only");
    expect(fija.pagina()).toContain("flowbrain viewer --serve");
    expect(fija.lista()).not.toContain('data-acc="resolver"');
    expect(fija.lista()).toContain("You resolve it");
    // Sumar al pedido no necesita servidor: sale como .md.
    expect(fija.lista().match(/data-acc="pedir" data-tipo="fidelidad" data-k="a\|/g)).toHaveLength(2);
    const servida = montar(datos, { edicion: { token: "t", sinAplicar: ["back"] } });
    expect(servida.pagina()).not.toContain("read-only");
    // Lo que resuelve una persona tiene su botón; lo del agente, no. Asociar a una funcionalidad ya no se hace acá.
    expect(servida.lista()).not.toContain("sumar-sugerida");
    expect(servida.lista()).toContain(">Write the route</button>");
    expect(servida.lista()).toContain(">Choose target</button>");
    expect(servida.lista().match(/The agent resolves it/g)).toHaveLength(1);
    expect(servida.pagina()).toContain('data-acc="aplicar" data-cerebro="back">Reindex back');
  });

  it("en castellano: los textos de siempre, y el plan para el modelo sigue en inglés", () => {
    const v = montar(datos, { lang: "es" });
    expect(v.pagina()).toContain("<h1>Fidelidad</h1>");
    expect(v.pagina()).toContain('data-grupo="vos" aria-pressed="false">Lo resolvés vos <small>2</small>');
    expect(v.pagina()).toContain("Reparto por puntaje");
    expect(v.pagina()).toContain("2 archivos tienen fidelidad incierta");
    expect(v.lista()).toContain('<span class="fd-es na" title="No aplica a este archivo">Pantalla</span>');
    expect(v.lista()).toContain("Qué relaciones pedir");
    expect(v.lista()).toContain('data-et="Pedir los 2 de la lista"');
    v.tocar({ "data-acc": "pedir", "data-tipo": "fidelidad", "data-k": "l|" });
    expect(v.panel()).toContain("<h2>Pedido al agente</h2>");
    v.tocar({ "data-acc": "descargar-lista" });
    return v.bajados[0]!.texto().then((md) => expect(md).toContain("# Fidelity plan"));
  });

  it("al cambiar de idioma, los textos fijos del filtro se rehacen", () => {
    const oyentes: Array<() => void> = [];
    const i18n = { lang: "en", alCambiar: (fn: () => void) => void oyentes.push(fn) };
    const guardado = new Map<string, string>();
    const sessionStorage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
    const els = new Map<string, { innerHTML: string; addEventListener(): void }>();
    const el = (id: string) => { if (!els.has(id)) els.set(id, { innerHTML: "", addEventListener() {} }); return els.get(id)!; };
    const window = { brainVisor: { D: datos, porId: {}, esc: (x: unknown) => String(x) }, brainFiltros: null, brainI18n: i18n, brainFidelidad: null as null | { mostrar(): void } };
    new Function("window", "document", "sessionStorage", FILTROS_JS)(window, { getElementById: el }, sessionStorage);
    new Function("window", "document", PEDIDO_JS)(window, { getElementById: el });
    new Function("window", "document", "sessionStorage", FIDELIDAD_JS)(window, { getElementById: el }, sessionStorage);
    window.brainFidelidad!.mostrar();
    expect(el("fidelidad").innerHTML).toContain("Score distribution");
    i18n.lang = "es";
    oyentes.forEach((fn) => fn());
    window.brainFidelidad!.mostrar();
    expect(el("fidelidad").innerHTML).toContain("Reparto por puntaje");
    expect(el("fidelidad").innerHTML).toContain("Buscar por ruta o por lo que falta…");
  });

  it("resolver: elegir destino muestra los candidatos como botones y manda los ids del cerebro", async () => {
    const pedidos: Array<{ url: string; metodo: string; token: string | undefined; cuerpo: unknown }> = [];
    const detalle = {
      cerebro: "back", entradas: ["repo-api:src/Servicio.php", "repo-api:src"], funcionalidades: [{ id: "feat-stock", nombre: "Stock" }], dueñas: [],
      http: [{ linea: 9, metodo: "POST", base: "${api}", desde: "Servicio.avisar" }],
      llamadas: [{ linea: 6, desde: "Servicio.buscar", llamada: "repo.traer", candidatos: ["repo-api:src/RepoA.php#RepoA.traer", "repo-api:src/RepoB.php#RepoB.traer"] }],
    };
    const fetch = (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      pedidos.push({ url, metodo: init.method, token: init.headers["x-flowbrain-token"], cuerpo: init.body ? JSON.parse(init.body) : null });
      const json = url.startsWith("/api/archivo") ? detalle : { escrito: "back/calls.yaml", cambio: true, faltaReindexar: false, mensaje: "Declarado.", sinAplicar: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
    };
    const v = montar(datos, { edicion: { token: "secreto", sinAplicar: [] }, fetch });
    const esperar = () => new Promise((ok) => setTimeout(ok, 0));
    v.tocar({ "data-acc": "resolver", "data-que": "llamadas", "data-a": "back/repo-api:src/Servicio.php" });
    expect(v.lista()).toContain("Reading the file");
    await esperar();
    // El id que viaja es el del cerebro, sin el prefijo que le pone el visor.
    expect(pedidos[0]).toEqual({ url: "/api/archivo?cerebro=back&archivo=repo-api%3Asrc%2FServicio.php", metodo: "GET", token: "secreto", cuerpo: null });
    expect(v.lista()).toContain("there is a call to <code>repo.traer</code>. Where does it go?");
    expect(v.lista()).toContain('data-acc="declarar-llamada" data-linea="6" data-hacia="repo-api:src/RepoA.php#RepoA.traer">RepoA.traer');
    expect(v.lista()).not.toContain("<select");
    v.tocar({ "data-acc": "declarar-llamada", "data-linea": "6", "data-hacia": "repo-api:src/RepoB.php#RepoB.traer" });
    await esperar();
    expect(pedidos[1]!.cuerpo).toEqual({ tipo: "llamada", linea: 6, hacia: "repo-api:src/RepoB.php#RepoB.traer", cerebro: "back", archivo: "repo-api:src/Servicio.php" });
    expect(v.lista()).toContain("Declarado. (back/calls.yaml)");
    v.tocar({ "data-acc": "recargar" });
    expect(v.recargas()).toBe(1);
  });
});

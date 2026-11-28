import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Graph } from "@flowbrain/core";
import { RED_FLUJO_JS, TRAZABILIDAD_JS, redDeFlujo, trazabilidad } from "@flowbrain/core";
import { renderViewer } from "../src/index.js";
import { GRAFO3D_JS } from "../src/viewer-3d.js";
import { TRAZA_VISTAS_JS } from "../src/viewer-traza.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const graph = async () => JSON.parse(await readFile(join(RAIZ, "fixtures/checkout/expected/graph.json"), "utf8")) as Graph;
const datos = (html: string) => JSON.parse(/<script type="application\/json" id="datos">([\s\S]*?)<\/script>/.exec(html)![1]!.replace(/<\\\//g, "</").replace(/<\\!--/g, "<!--"));

type Pos = Record<string, { x: number; y: number; w: number; h: number }>;
type Vistas = {
  acomodarDiagrama: (r: unknown) => { pos: Pos; cajas: Array<{ c: number; x: number; ancho: number }> };
  fichaDe: (id: string) => string;
  cerebrosEnOrden: (r: unknown) => number[];
};

/** Las funciones de las vistas con el alcance que les da el mapa 3D, armado a mano (en español). */
function vistas(D: any, multi: boolean, origen: string): Vistas {
  const porId: Record<string, any> = {};
  D.nodes.forEach((n: any) => { porId[n.id] = n; });
  const red = redDeFlujo({ multi, nodos: D.nodes.map((n: any) => ({ id: n.id, tipo: n.t, c: n.c || 0, nombre: n.n })), aristas: D.edges, fichas: D.funcionalidades || [], cruzado: D.cruzado || null });
  const r = trazabilidad(red, origen)!;
  const idx: Record<string, unknown> = {};
  r.nodos.forEach((x) => { idx[x.id] = x; });
  const ctx = {
    D, porId, by: {}, MULTI: multi, CEREBROS: D.cerebros || [], RED: red,
    TZ: { id: origen, r, idx, ficha: origen, codigo: null, ns: new Set(), es: [] },
    TIPO: { tabla: { uno: "Tabla" }, endpoint: { uno: "Endpoint" }, pantalla: { uno: "Pantalla" }, feat: { uno: "Funcionalidad" }, archivo: { uno: "Archivo" } },
    CAPAS_TZ: Array.from({ length: 10 }, (_, i) => ["L" + i, "C" + i]),
  };
  const f = new Function("ctx", "impacto", "window",
    "var D = ctx.D, porId = ctx.porId, by = ctx.by, MULTI = ctx.MULTI, CEREBROS = ctx.CEREBROS, RED = ctx.RED, TZ = ctx.TZ, TIPO = ctx.TIPO, CAPAS_TZ = ctx.CAPAS_TZ;" +
    "var L = function (en, es) { return es; }, num = String, pl = function (n, a, b) { return n === 1 ? a : b; };" +
    "var esc = function (s) { return String(s).replace(/[&<>\"']/g, ''); }, colorC = function () { return '#8FA6FF'; }, huecoTxt = String;" +
    "var en3 = function () { return null; }, ui = function () {}, $ = function () { return null; }, canvas = null;" +
    TRAZA_VISTAS_JS + "; return { acomodarDiagrama: acomodarDiagrama, fichaDe: fichaDe, cerebrosEnOrden: cerebrosEnOrden };");
  return f(ctx, () => [], {}) as Vistas;
}

describe("trazabilidad: Diagrama (2D) y ficha del nodo", () => {
  it("la página trae las dos vistas con su selector, sin carriles ni librerías de afuera", async () => {
    const html = renderViewer(await graph());
    for (const t of ["Diagrama (2D)", "En los cerebros (3D)", "Trazar desde acá", "Ver código", "Pedir al agente", 'stdDeviation: "6"']) expect(html).toContain(t);
    expect(html).not.toContain("En carriles");
    expect(html).not.toMatch(/<script[^>]+src=|https?:\/\//);
  });

  it("las funciones de las vistas no pisan ningún nombre del mapa 3D (comparten su alcance)", () => {
    const declarados = (js: string) => new Set(Array.from(js.matchAll(/^ {2}(?:function|var) ([A-Za-z_$][\w$]*)/gm), (m) => m[1]!));
    const mapa = GRAFO3D_JS.replace(TRAZA_VISTAS_JS, "").replace(RED_FLUJO_JS, "").replace(TRAZABILIDAD_JS, "");
    const propios = declarados(TRAZA_VISTAS_JS), ajenos = declarados(mapa);
    expect([...propios].filter((n) => ajenos.has(n))).toEqual([]);
    expect(GRAFO3D_JS).toContain(TRAZA_VISTAS_JS);
  });

  it("el diagrama pone una caja por cerebro en el sentido de los saltos y una columna por capa, sin piezas encimadas", () => {
    const D = {
      cerebros: [{ nombre: "api" }, { nombre: "web" }],
      nodes: [
        { id: "web/pantalla:/x", t: "pantalla", n: "/x", c: 1 },
        { id: "web/repo:src/api.ts", t: "archivo", n: "src/api.ts", c: 1 },
        { id: "api/svc:GET:/x", t: "endpoint", n: "GET /x", c: 0, at: { metodo: "GET", ruta: "/x", request: "XReq", response: "XRes" } },
        { id: "api/tabla-x", t: "tabla", n: "x", c: 0, at: { columnas: [{ nombre: "id", tipo: "number", nulo: false, pk: true }] } },
        { id: "api/tabla-y", t: "tabla", n: "y", c: 0, at: { columnas: [] } },
      ],
      edges: [
        { s: "web/pantalla:/x", h: "web/repo:src/api.ts", v: "llama_a", ev: "repo:src/x.tsx#L3", p: null },
        { s: "web/repo:src/api.ts", h: "api/svc:GET:/x", v: "llama_a", ev: "repo:src/api.ts#L9", p: null },
        { s: "api/svc:GET:/x", h: "api/tabla-x", v: "lee_de", ev: "repo-api:x.ts#L4", p: null },
        { s: "api/svc:GET:/x", h: "api/tabla-y", v: "escribe_en", ev: "repo-api:x.ts#L5", p: null },
      ],
      dependencias: [],
    };
    const v = vistas(D, true, "api/svc:GET:/x");
    const red = redDeFlujo({ multi: true, nodos: D.nodes.map((n) => ({ id: n.id, tipo: n.t, c: n.c, nombre: n.n })), aristas: D.edges });
    const r = trazabilidad(red, "api/svc:GET:/x")!;
    expect(v.cerebrosEnOrden(r)).toEqual([1, 0]);
    const m = v.acomodarDiagrama(r);
    expect(m.cajas.map((c) => c.c)).toEqual([1, 0]);
    expect(m.cajas[0]!.x + m.cajas[0]!.ancho).toBeLessThan(m.cajas[1]!.x);
    const p = m.pos;
    expect(Object.keys(p).sort()).toEqual(D.nodes.map((n) => n.id).sort());
    expect(p["web/pantalla:/x"]!.x).toBeLessThan(p["web/repo:src/api.ts"]!.x);
    expect(p["api/svc:GET:/x"]!.x).toBeLessThan(p["api/tabla-x"]!.x);
    // Las dos tablas van en la misma columna, una debajo de la otra.
    expect(p["api/tabla-x"]!.x).toBe(p["api/tabla-y"]!.x);
    expect(Math.abs(p["api/tabla-x"]!.y - p["api/tabla-y"]!.y)).toBeGreaterThanOrEqual(p["api/tabla-x"]!.h);
  });

  it("la ficha muestra solo lo que el grafo tiene y dice lo que falta", () => {
    const D = {
      cerebros: [], dependencias: [],
      nodes: [
        { id: "svc:GET:/x", t: "endpoint", n: "GET /x", at: { metodo: "GET", ruta: "/x", request: "XReq", response: "XRes", evidencia: "repo:x.ts#L2" } },
        { id: "tabla-x", t: "tabla", n: "x", at: { columnas: [{ nombre: "id", tipo: "number", nulo: false, pk: true }] } },
      ],
      edges: [{ s: "svc:GET:/x", h: "tabla-x", v: "lee_de", ev: "repo:x.ts#L4", p: null }],
    };
    const tabla = vistas(D, false, "tabla-x").fichaDe("tabla-x");
    expect(tabla).toContain("Columnas");
    expect(tabla).toContain("number");
    expect(tabla).toContain("El grafo no registra claves foráneas.");
    expect(tabla).toContain("Quién la lee");
    expect(tabla).toContain("La fidelidad se mide por archivo");
    const ep = vistas(D, false, "svc:GET:/x").fichaDe("svc:GET:/x");
    expect(ep).toContain("GET /x");
    expect(ep).toContain("XReq");
    expect(ep).toContain("sus campos no están en el grafo");
    expect(ep).toContain("El grafo no tiene infraestructura de su servicio.");
    expect(ep).toContain("repo:x.ts#L2");
  });

  it("con los datos de la página de un ejemplo real, cada pieza de la cadena tiene ficha", async () => {
    const D = datos(renderViewer(await graph()));
    const ep = D.nodes.find((n: any) => n.t === "endpoint" && D.edges.some((e: any) => e.s === n.id && (e.v === "lee_de" || e.v === "escribe_en")));
    const v = vistas(D, false, ep.id);
    const red = redDeFlujo({ nodos: D.nodes.map((n: any) => ({ id: n.id, tipo: n.t, c: 0, nombre: n.n })), aristas: D.edges, fichas: D.funcionalidades || [] });
    for (const x of trazabilidad(red, ep.id)!.nodos) expect(v.fichaDe(x.id)).toContain('class="m3-caja tz-ficha"');
  });
});

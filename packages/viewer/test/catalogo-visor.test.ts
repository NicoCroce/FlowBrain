import { describe, expect, it } from "vitest";
import { FILTROS_JS } from "../src/viewer-filtros.js";
import { PRODUCTO_JS } from "../src/viewer-producto.js";

/** El catálogo de Funcionalidades con un DOM mínimo: usa el mismo filtro y estadística que las demás pantallas de lista. */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
const feat = (id: string, tests = 0) => ({
  id, expone: [], usa: [], codigo: [], archivos: 3, datos: [], usaFuncionalidades: [], usadaPor: [],
  tests: tests ? [{ archivo: `${id}.test.ts`, casos: Array.from({ length: tests }, (_, i) => ({ nombre: `caso ${i}`, linea: i + 1 })) }] : [],
});
function montar() {
  const funcionalidades = [feat("front/feat-agenda", 2), feat("back/feat-agenda"), feat("back/feat-cobros")];
  const porId: Record<string, { n: string; r: string | null }> = {
    "front/feat-agenda": { n: "Agenda", r: "Calendario del club" },
    "back/feat-agenda": { n: "Agenda", r: "Calendario del club" },
    "back/feat-cobros": { n: "Cobros", r: null },
  };
  const guardado = new Map<string, string>();
  const sessionStorage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
  const oyentes: Record<string, Oyente[]> = {};
  const raiz = { innerHTML: "", addEventListener(t: string, f: Oyente) { (oyentes[t] ??= []).push(f); } };
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const colorCerebro = (v: string) => ({ front: "#111111", back: "#222222" })[v] ?? "";
  const window = { brainVisor: { D: { funcionalidades, edges: [] }, porId, esc, colorCerebro }, brainFiltros: null as unknown, brainProducto: null as null | { mostrar(h: string): void } };
  const document = { getElementById: (id: string) => (id === "producto" ? raiz : null) };
  new Function("window", "document", "sessionStorage", FILTROS_JS)(window, document, sessionStorage);
  new Function("window", "document", "sessionStorage", PRODUCTO_JS)(window, document, sessionStorage);
  window.brainProducto!.mostrar("/funcionalidades");
  const disparar = (tipo: string, target: Record<string, unknown>) => (oyentes[tipo] ?? []).forEach((f) => f({ target }));
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null }) });
  return {
    pagina: () => raiz.innerHTML,
    tocar: (attrs: Record<string, string>) => disparar("click", boton(attrs)),
    cambiar: (id: string, value: string) => disparar("change", { id, value }),
    escribir: (value: string) => disparar("input", { id: "fu-q", value }),
    cifras: () => [...raiz.innerHTML.matchAll(/<div class="fd-cifra[^"]*"[^>]*><b[^>]*>([^<]+)<\/b><span>([^<]+)</g)].map((m) => `${m[1]} ${m[2]}`),
    tarjetas: () => [...raiz.innerHTML.matchAll(/<h3><a [^>]*>([^<]+)<\/a><\/h3>/g)].map((m) => m[1]),
  };
}

describe("pantalla Funcionalidades", () => {
  it("tiene las cifras, los grupos, el buscador, el filtro por cerebro y la estadística de las demás pantallas", () => {
    const v = montar();
    expect(v.cifras()).toEqual(["2 funcionalidades", "3 fichas, una por cerebro que la tiene", "1 sin descripción", "1 sin tests"]);
    expect(v.pagina()).toContain('placeholder="Buscar por nombre o descripción…"');
    expect(v.pagina()).toContain("<h2>Por cerebro</h2>");
    // El cerebro lleva su color, el mismo del mapa 3D, en la barra y en la tarjeta.
    expect(v.pagina()).toContain("background:#222222");
    expect(v.pagina()).toContain('<span class="pc" style="background:#111111"></span>front');
    expect(v.tarjetas()).toEqual(["Agenda", "Cobros"]);
  });

  it("filtra por grupo, cerebro y texto, y un vacío dice por qué", () => {
    const v = montar();
    v.tocar({ "data-fl": "fu", "data-grupo": "sintests" });
    expect(v.tarjetas()).toEqual(["Cobros"]);
    v.tocar({ "data-fl": "fu", "data-grupo": "sintests" });
    v.cambiar("fu-cerebro", "front");
    expect(v.tarjetas()).toEqual(["Agenda"]);
    v.escribir("cobros");
    v.cambiar("fu-cerebro", "front");
    expect(v.pagina()).toContain("Ninguna funcionalidad coincide con");
    expect(v.pagina()).toContain("Quitar filtros");
  });
});

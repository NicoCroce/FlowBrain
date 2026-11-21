import { describe, expect, it } from "vitest";
import { FIDELIDAD_JS } from "../src/viewer-fidelidad.js";

/**
 * La pantalla Fidelidad es JavaScript plano que corre en el navegador. Acá se la corre con un DOM mínimo (elementos con
 * `innerHTML` y oyentes) para fijar lo que importa: qué lista, cómo filtra y qué dice cuando queda vacía.
 */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
function montar(datos: Record<string, unknown>) {
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
  const window = { brainVisor: { D: datos, porId, esc }, brainFidelidad: null as null | { mostrar(): void } };
  new Function("window", "document", FIDELIDAD_JS)(window, { getElementById: el });
  const raiz = el("fidelidad");
  // Al repintar la página entera, la lista va adentro: se la deja también en su elemento, como haría el navegador.
  let html = "";
  Object.defineProperty(raiz, "innerHTML", {
    get: () => html,
    set: (v: string) => {
      html = v;
      const i = v.indexOf('<div id="fd-lista">');
      el("fd-lista").innerHTML = i < 0 ? "" : v.slice(i);
    },
  });
  window.brainFidelidad!.mostrar();
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs }) });
  return {
    pagina: () => raiz.innerHTML,
    lista: () => el("fd-lista").innerHTML,
    rutas: () => [...el("fd-lista").innerHTML.matchAll(/<div class="fd-ruta"><code>([^<]+)<\/code>/g)].map((m) => m[1]),
    cambiar: (id: string, value: string) => raiz.oyentes["change"]!({ target: { id, value } }),
    escribir: (value: string) => raiz.oyentes["input"]!({ target: { id: "fd-q", value } }),
    tocar: (attrs: Record<string, string>) => raiz.oyentes["click"]!({ target: boton(attrs) }),
  };
}

const fila = (c: number, a: string, p: number, f: string[], s: Record<string, [number, number]>, x: string[], l = "ts", k = "otros") => ({ a, c, p, l, k, f, s, x });
const datos = {
  cerebros: [{ nombre: "front" }, { nombre: "back" }],
  nodes: [{ id: "front/feat-pedidos", n: "Pedidos" }],
  fidelidad: {
    archivos: [
      fila(0, "front/repo-web:src/Pedidos.tsx", 100, ["front/feat-pedidos"], { pantallas: [1, 1], funcionalidad: [1, 1] }, [], "tsx", "interfaz"),
      fila(0, "front/repo-web:src/api.ts", 50, ["front/feat-pedidos"], { http: [1, 2], funcionalidad: [1, 1] }, ["1 llamadas HTTP sin ruta (L14)"]),
      fila(0, "front/repo-web:src/suelto.ts", 0, [], { funcionalidad: [0, 1] }, ["no pertenece a ninguna funcionalidad ni librería"]),
      fila(1, "back/repo-api:src/Servicio.php", 60, [], { llamadas: [1, 2], datos: [1, 2] }, ["1 llamadas sin resolver (L6)"], "php", "logica"),
    ],
    sinDatos: 2,
    ejemplosSinDatos: ["back/repo-api:config.json"],
  },
};

describe("pantalla Fidelidad", () => {
  it("lista los archivos de todos los cerebros, de menor a mayor, con sus faltas", () => {
    const v = montar(datos);
    expect(v.rutas()).toEqual(["src/suelto.ts", "src/api.ts", "src/Servicio.php", "src/Pedidos.tsx"]);
    expect(v.pagina()).toContain("puntaje promedio");
    expect(v.pagina()).toContain("Por cerebro");
    expect(v.lista()).toContain("1 llamadas HTTP sin ruta (L14)");
    expect(v.lista()).toContain("Sin faltas");
    // Lo que no se pudo medir se explica, no se esconde.
    expect(v.pagina()).toContain("2 archivos no tienen puntaje");
    v.tocar({ "data-acc": "orden" });
    expect(v.rutas()[0]).toBe("src/Pedidos.tsx");
  });

  it("filtra por rango, cerebro, tipo, funcionalidad, señal y texto", () => {
    const v = montar(datos);
    v.cambiar("fd-min", "40");
    v.cambiar("fd-max", "60");
    expect(v.rutas()).toEqual(["src/api.ts", "src/Servicio.php"]);
    v.cambiar("fd-cerebro", "1");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.tocar({ "data-acc": "limpiar" });
    v.cambiar("fd-feat", "front/feat-pedidos");
    expect(v.rutas()).toEqual(["src/api.ts", "src/Pedidos.tsx"]);
    v.cambiar("fd-feat", "__ninguna");
    expect(v.rutas()).toEqual(["src/suelto.ts", "src/Servicio.php"]);
    v.cambiar("fd-feat", "");
    v.cambiar("fd-lenguaje", "php");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.cambiar("fd-lenguaje", "");
    // Las barras del resumen prenden y apagan su filtro.
    v.tocar({ "data-senal": "http" });
    expect(v.rutas()).toEqual(["src/api.ts"]);
    v.tocar({ "data-senal": "http" });
    v.tocar({ "data-min": "0", "data-max": "19" });
    expect(v.rutas()).toEqual(["src/suelto.ts"]);
    v.tocar({ "data-min": "0", "data-max": "19" });
    v.escribir("sin resolver");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
  });

  it("un vacío dice por qué está vacío y ofrece salir", () => {
    const v = montar(datos);
    v.cambiar("fd-cerebro", "1");
    v.cambiar("fd-lenguaje", "tsx");
    expect(v.rutas()).toEqual([]);
    expect(v.lista()).toContain("Ningún archivo coincide con cerebro back, tipo tsx");
    expect(v.lista()).toContain("Hay 4 archivos medidos en total");
    expect(v.lista()).toContain('data-acc="limpiar"');
    // Sin índice de código no hay lista: se dice cómo conseguirla.
    expect(montar({ cerebros: [], nodes: [], fidelidad: null }).pagina()).toContain("No hay índice de código");
  });
});

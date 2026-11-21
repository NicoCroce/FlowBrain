import { describe, expect, it } from "vitest";
import { FIDELIDAD_JS } from "../src/viewer-fidelidad.js";

/**
 * La pantalla Fidelidad es JavaScript plano que corre en el navegador. Acá se la corre con un DOM mínimo (elementos con
 * `innerHTML` y oyentes) para fijar lo que importa: qué lista, cómo filtra y qué dice cuando queda vacía.
 */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
function montar(datos: Record<string, unknown>, opciones: { edicion?: unknown; guardado?: Map<string, string>; fetch?: (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => Promise<unknown> } = {}) {
  const guardado = opciones.guardado ?? new Map<string, string>();
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
  const window = { brainVisor: { D: datos, porId, esc }, brainFidelidad: null as null | { mostrar(): void }, FLOWBRAIN_EDICION: opciones.edicion };
  let recargas = 0;
  new Function("window", "document", "sessionStorage", "fetch", "location", FIDELIDAD_JS)(window, { getElementById: el }, sessionStorage, opciones.fetch, { reload: () => void recargas++ });
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
    poner: (id: string, value: string) => void ((el(id) as unknown as { value: string }).value = value),
    recargas: () => recargas,
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

  it("recuerda el filtro al recargar", () => {
    const guardado = new Map<string, string>();
    const v = montar(datos, { guardado });
    v.cambiar("fd-lenguaje", "php");
    expect(montar(datos, { guardado }).rutas()).toEqual(["src/Servicio.php"]);
  });

  it("abierta como archivo es de solo lectura y lo dice; servida, ofrece corregir lo que tiene faltas", () => {
    const fija = montar(datos);
    expect(fija.pagina()).toContain("Esta página es de solo lectura");
    expect(fija.pagina()).toContain("flowbrain viewer --serve");
    expect(fija.lista()).not.toContain('data-acc="editar"');
    const servida = montar(datos, { edicion: { token: "t", sinAplicar: ["back"] } });
    expect(servida.pagina()).not.toContain("solo lectura");
    // Un botón por archivo con faltas (tres de cuatro), y el aviso de lo declarado que no entró al índice.
    expect(servida.lista().match(/data-acc="editar"/g)).toHaveLength(3);
    expect(servida.pagina()).toContain('data-acc="aplicar" data-cerebro="back">Reindexar back');
  });

  it("corregir: pide el detalle del archivo, manda la edición con el token y muestra qué pasó", async () => {
    const pedidos: Array<{ url: string; metodo: string; token: string | undefined; cuerpo: unknown }> = [];
    const detalle = { cerebro: "front", entradas: ["repo-web:src/suelto.ts", "repo-web:src"], funcionalidades: [{ id: "feat-pedidos", nombre: "Pedidos" }], dueñas: [], http: [], llamadas: [] };
    const fetch = (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      pedidos.push({ url, metodo: init.method, token: init.headers["x-flowbrain-token"], cuerpo: init.body ? JSON.parse(init.body) : null });
      const json = url.startsWith("/api/archivo") ? detalle : { escrito: "front/product/feat-pedidos.md", cambio: true, faltaReindexar: false, mensaje: "Sumado.", sinAplicar: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
    };
    const v = montar(datos, { edicion: { token: "secreto", sinAplicar: [] }, fetch });
    const esperar = () => new Promise((ok) => setTimeout(ok, 0));
    v.tocar({ "data-acc": "editar", "data-a": "front/repo-web:src/suelto.ts" });
    expect(v.lista()).toContain("Leyendo el archivo");
    await esperar();
    // El id que viaja es el del cerebro, sin el prefijo que le pone el visor.
    expect(pedidos[0]).toEqual({ url: "/api/archivo?cerebro=front&archivo=repo-web%3Asrc%2Fsuelto.ts", metodo: "GET", token: "secreto", cuerpo: null });
    expect(v.lista()).toContain("Sumarlo a una funcionalidad");
    expect(v.lista()).toContain("toda la carpeta src");
    v.poner("fd-e-feat", "feat-pedidos");
    v.poner("fd-e-entrada", "repo-web:src/suelto.ts");
    v.tocar({ "data-acc": "sumar" });
    await esperar();
    expect(pedidos[1]).toEqual({ url: "/api/editar", metodo: "POST", token: "secreto", cuerpo: { tipo: "funcionalidad", funcionalidad: "feat-pedidos", entrada: "repo-web:src/suelto.ts", cerebro: "front", archivo: "repo-web:src/suelto.ts" } });
    expect(v.lista()).toContain("Sumado. (front/product/feat-pedidos.md)");
    v.tocar({ "data-acc": "recargar" });
    expect(v.recargas()).toBe(1);
  });
});

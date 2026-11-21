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
    // Una casilla: se marca en el elemento y, salvo que se pida que no, se avisa el cambio.
    marcar: (id: string, checked: boolean, avisar = true) => {
      (el(id) as unknown as { checked: boolean }).checked = checked;
      if (avisar) raiz.oyentes["change"]!({ target: { id, checked } });
    },
    recargas: () => recargas,
  };
}

type T = [string, 0 | 1, string, string, number[]];
const fila = (c: number, a: string, p: number, f: string[], s: Record<string, [number, number]>, t: T[], l = "ts", k = "otros", g?: [string, string]) => ({ a, c, p, l, k, f, s, t, ...(g ? { g } : {}) });
const datos = {
  cerebros: [{ nombre: "front" }, { nombre: "back" }],
  nodes: [{ id: "front/feat-pedidos", n: "Pedidos" }],
  fidelidad: {
    archivos: [
      fila(0, "front/repo-web:src/Pedidos.tsx", 100, ["front/feat-pedidos"], { pantallas: [1, 1], funcionalidad: [1, 1] }, [], "tsx", "interfaz"),
      fila(0, "front/repo-web:src/api.ts", 50, ["front/feat-pedidos"], { http: [1, 2], funcionalidad: [1, 1] }, [["http", 1, "1 llamada HTTP cuya ruta no se pudo leer", "Escribir la ruta.", [14]]]),
      fila(0, "front/repo-web:src/suelto.ts", 0, [], { funcionalidad: [0, 1] }, [["funcionalidad", 1, "No es parte de ninguna funcionalidad ni librería", "Sumarlo a la que corresponda.", []]], "ts", "otros", ["front/feat-pedidos", "2 archivos de src/ son de Pedidos"]),
      fila(1, "back/repo-api:src/Servicio.php", 60, [], { llamadas: [1, 2], datos: [1, 2] }, [["llamadas", 1, "1 llamada que no se sabe a qué método va", "Decir a qué método va.", [6]], ["datos", 0, "1 acceso a una tabla sin saber qué columnas toca", "Enseñarlo con un extractor.", []]], "php", "logica"),
    ],
    sinDatos: 2,
    ejemplosSinDatos: ["back/repo-api:config.json"],
    plan: { reglas: ["Editá solo archivos del cerebro."], como: { funcionalidad: "sumá repo:ruta al codigo", llamadas: "declarala en calls.yaml", http: "declarala en la sección http", datos: "seguí flowbrain coverage --guide" }, cierre: ["Reindexá: flowbrain brains apply <cerebro>."] },
  },
};

describe("pantalla Fidelidad", () => {
  it("lista los archivos de todos los cerebros, de menor a mayor, con qué falta y qué hacer", () => {
    const v = montar(datos);
    expect(v.rutas()).toEqual(["src/suelto.ts", "src/api.ts", "src/Servicio.php", "src/Pedidos.tsx"]);
    expect(v.pagina()).toContain("puntaje promedio");
    expect(v.lista()).toContain("1 llamada HTTP cuya ruta no se pudo leer");
    expect(v.lista()).toContain("Escribir la ruta.");
    expect(v.lista()).toContain("Pista: 2 archivos de src/ son de Pedidos.");
    expect(v.lista()).toContain("Completo: todo lo que el índice vio acá quedó unido.");
    // Lo que no se pudo medir se explica, no se esconde.
    expect(v.pagina()).toContain("2 archivos no tienen puntaje");
    v.tocar({ "data-acc": "orden" });
    expect(v.rutas()[0]).toBe("src/Pedidos.tsx");
  });

  it("cadena de trazabilidad: lo entendido, dónde se corta y lo que no aplica", () => {
    const v = montar(datos);
    const cadenas = [...v.lista().matchAll(/<div class="fd-cadena"[^>]*>(.*?)<\/div>/g)].map((m) => [...m[1]!.matchAll(/class="fd-es (\w+)"[^>]*>([^<]+)</g)].map((e) => `${e[2]}:${e[1]}`));
    // suelto.ts: solo se mide la funcionalidad, y falta.
    expect(cadenas[0]).toEqual(["Funcionalidad:no", "Pantalla:na", "HTTP:na", "Endpoint:na", "Llamadas:na", "Datos:na"]);
    // api.ts: una de dos llamadas HTTP quedó sin unir.
    expect(cadenas[1]).toEqual(["Funcionalidad:ok", "Pantalla:na", "HTTP 1/2:no", "Endpoint:na", "Llamadas:na", "Datos:na"]);
    expect(cadenas[3]).toEqual(["Funcionalidad:ok", "Pantalla:ok", "HTTP:na", "Endpoint:na", "Llamadas:na", "Datos:na"]);
  });

  it("agrupa por quién resuelve lo que falta; un archivo con las dos cosas está en los dos grupos", () => {
    const v = montar(datos);
    expect(v.pagina()).toContain('data-grupo="vos">Lo resolvés vos <small>3</small>');
    expect(v.pagina()).toContain('data-grupo="agente">Lo resuelve el agente <small>1</small>');
    expect(v.pagina()).toContain('data-grupo="completos">Completos <small>1</small>');
    v.tocar({ "data-grupo": "agente" });
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.tocar({ "data-grupo": "completos" });
    expect(v.rutas()).toEqual(["src/Pedidos.tsx"]);
    v.tocar({ "data-grupo": "vos" });
    expect(v.rutas()).toEqual(["src/suelto.ts", "src/api.ts", "src/Servicio.php"]);
  });

  it("los filtros finos y la estadística están plegados; abiertos, filtran por rango, cerebro, tipo, funcionalidad, signal y texto", () => {
    const v = montar(datos);
    expect(v.pagina()).not.toContain('id="fd-lenguaje"');
    expect(v.pagina()).not.toContain("Por cerebro");
    v.tocar({ "data-acc": "mas-filtros" });
    expect(v.pagina()).toContain('id="fd-lenguaje"');
    expect(v.pagina()).toContain("Por cerebro");
    v.cambiar("fd-min", "40");
    v.cambiar("fd-max", "60");
    expect(v.rutas()).toEqual(["src/api.ts", "src/Servicio.php"]);
    expect(v.pagina()).toContain("Filtros y estadística (1)");
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
    v.tocar({ "data-signal": "http" });
    expect(v.rutas()).toEqual(["src/api.ts"]);
    v.tocar({ "data-signal": "http" });
    v.tocar({ "data-min": "0", "data-max": "19" });
    expect(v.rutas()).toEqual(["src/suelto.ts"]);
    v.tocar({ "data-min": "0", "data-max": "19" });
    v.escribir("a qué método");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
  });

  it("un vacío dice por qué está vacío y ofrece salir", () => {
    const v = montar(datos);
    v.tocar({ "data-acc": "mas-filtros" });
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
    v.tocar({ "data-grupo": "agente" });
    expect(montar(datos, { guardado }).rutas()).toEqual(["src/Servicio.php"]);
  });

  it("plan para el agente: de los archivos de la lista, con las relaciones que se elijan", () => {
    const v = montar(datos);
    const plan = () => /<textarea id="fd-pl-texto"[^>]*>([\s\S]*?)<\/textarea>/.exec(v.lista())?.[1]?.replace(/&#(\d+);/g, (_, c: string) => String.fromCharCode(Number(c))) ?? "";
    expect(v.lista()).not.toContain("fd-pl-texto");
    v.tocar({ "data-acc": "plan" });
    expect(plan()).toContain("llevar a 100 el puntaje de fidelidad de 3 archivos");
    expect(plan()).toContain("### front/repo-web:src/suelto.ts (0/100)\nPista: 2 archivos de src/ son de Pedidos (front/feat-pedidos).\n- [ ] funcionalidad: No es parte de ninguna funcionalidad ni librería.");
    expect(plan()).toContain("- [ ] llamadas: 1 llamada que no se sabe a qué método va (L6).");
    expect(plan()).toContain("- **datos**: seguí flowbrain coverage --guide");
    expect(plan()).toContain("1. Reindexá: flowbrain brains apply <cerebro>.");
    expect(plan()).not.toContain("Pedidos.tsx");
    // Se saca una relación: sus tareas y su explicación salen del plan.
    v.marcar("fd-pl-s-funcionalidad", false);
    expect(plan()).toContain("de 2 archivos");
    expect(plan()).not.toContain("suelto.ts");
    expect(plan()).not.toContain("**funcionalidad**");
    // El plan sigue a la lista: con un grupo puesto, solo sus archivos.
    v.tocar({ "data-grupo": "agente" });
    expect(plan()).toContain("de 1 archivo ");
    v.cambiar("fd-pl-n", "1");
    v.tocar({ "data-grupo": "completos" });
    expect(v.lista()).toContain("No hay plan que armar");
    // Por archivo: el pedido de ese solo.
    v.tocar({ "data-grupo": "" });
    v.tocar({ "data-acc": "pedido", "data-a": "front/repo-web:src/api.ts" });
    expect(v.lista()).toContain('<textarea id="fd-pedido"');
    expect(v.lista()).toContain("### front/repo-web:src/api.ts (50/100)");
  });

  it("abierta como archivo es de solo lectura y lo dice; servida, ofrece resolver lo que depende de una persona", () => {
    const fija = montar(datos);
    expect(fija.pagina()).toContain("Esta página es de solo lectura");
    expect(fija.pagina()).toContain("flowbrain viewer --serve");
    expect(fija.lista()).not.toContain('data-acc="resolver"');
    expect(fija.lista()).toContain("Lo resolvés vos");
    // El pedido para el agente no necesita servidor.
    expect(fija.lista().match(/data-acc="pedido"/g)).toHaveLength(3);
    const servida = montar(datos, { edicion: { token: "t", sinAplicar: ["back"] } });
    expect(servida.pagina()).not.toContain("solo lectura");
    // Con sugerencia, un botón que suma directo y otro para elegir; lo del agente no tiene botón.
    expect(servida.lista()).toContain('data-acc="sumar-sugerida" data-a="front/repo-web:src/suelto.ts">Sumar a Pedidos</button>');
    expect(servida.lista()).toContain(">Otra…</button>");
    expect(servida.lista()).toContain(">Escribir la ruta</button>");
    expect(servida.lista()).toContain(">Elegir destino</button>");
    expect(servida.lista().match(/Lo resuelve el agente/g)).toHaveLength(1);
    expect(servida.pagina()).toContain('data-acc="aplicar" data-cerebro="back">Reindexar back');
  });

  it("resolver: un clic suma a la funcionalidad sugerida; elegir destino muestra los candidatos como botones", async () => {
    const pedidos: Array<{ url: string; metodo: string; token: string | undefined; cuerpo: unknown }> = [];
    const detalle = {
      cerebro: "back", entradas: ["repo-api:src/Servicio.php", "repo-api:src"], funcionalidades: [{ id: "feat-stock", nombre: "Stock" }], dueñas: [],
      http: [{ linea: 9, metodo: "POST", base: "${api}", desde: "Servicio.avisar" }],
      llamadas: [{ linea: 6, desde: "Servicio.buscar", llamada: "repo.traer", candidatos: ["repo-api:src/RepoA.php#RepoA.traer", "repo-api:src/RepoB.php#RepoB.traer"] }],
    };
    const fetch = (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      pedidos.push({ url, metodo: init.method, token: init.headers["x-flowbrain-token"], cuerpo: init.body ? JSON.parse(init.body) : null });
      const json = url.startsWith("/api/archivo") ? detalle : { escrito: "front/product/feat-pedidos.md", cambio: true, faltaReindexar: false, mensaje: "Sumado.", sinAplicar: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
    };
    const v = montar(datos, { edicion: { token: "secreto", sinAplicar: [] }, fetch });
    const esperar = () => new Promise((ok) => setTimeout(ok, 0));
    // El id que viaja es el del cerebro, sin el prefijo que le pone el visor.
    v.tocar({ "data-acc": "sumar-sugerida", "data-a": "front/repo-web:src/suelto.ts" });
    await esperar();
    expect(pedidos[0]).toEqual({ url: "/api/editar", metodo: "POST", token: "secreto", cuerpo: { tipo: "funcionalidad", funcionalidad: "feat-pedidos", cerebro: "front", archivo: "repo-web:src/suelto.ts" } });
    expect(v.lista()).toContain("Sumado. (front/product/feat-pedidos.md)");
    v.tocar({ "data-acc": "recargar" });
    expect(v.recargas()).toBe(1);

    v.tocar({ "data-acc": "resolver", "data-que": "llamadas", "data-a": "back/repo-api:src/Servicio.php" });
    expect(v.lista()).toContain("Leyendo el archivo");
    await esperar();
    expect(pedidos[1]).toEqual({ url: "/api/archivo?cerebro=back&archivo=repo-api%3Asrc%2FServicio.php", metodo: "GET", token: "secreto", cuerpo: null });
    expect(v.lista()).toContain("se llama a <code>repo.traer</code>. ¿A cuál va?");
    expect(v.lista()).toContain('data-acc="declarar-llamada" data-linea="6" data-hacia="repo-api:src/RepoA.php#RepoA.traer">RepoA.traer');
    expect(v.lista()).not.toContain("<select");
    v.tocar({ "data-acc": "declarar-llamada", "data-linea": "6", "data-hacia": "repo-api:src/RepoB.php#RepoB.traer" });
    await esperar();
    expect(pedidos[2]!.cuerpo).toEqual({ tipo: "llamada", linea: 6, hacia: "repo-api:src/RepoB.php#RepoB.traer", cerebro: "back", archivo: "repo-api:src/Servicio.php" });

    // Elegir otra funcionalidad: un solo selector, y la carpeta como casilla.
    v.tocar({ "data-acc": "resolver", "data-que": "funcionalidad", "data-a": "front/repo-web:src/suelto.ts" });
    await esperar();
    expect(v.lista().match(/<select/g)).toHaveLength(1);
    expect(v.lista()).toContain("Sumar toda la carpeta <code>src</code>");
    v.poner("fd-e-feat", "feat-stock");
    v.marcar("fd-e-carpeta", true, false);
    v.tocar({ "data-acc": "sumar" });
    await esperar();
    expect(pedidos[4]!.cuerpo).toMatchObject({ tipo: "funcionalidad", funcionalidad: "feat-stock", entrada: "repo-api:src" });
  });
});

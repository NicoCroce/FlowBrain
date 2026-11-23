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
    expect(v.pagina()).toContain("puntaje promedio");
    expect(v.lista()).toContain("1 llamada HTTP cuya ruta no se pudo leer");
    expect(v.lista()).toContain("Escribir la ruta.");
    expect(v.lista()).toContain('<a class="chip fd-sinfeat" href="#/sin-asociar"');
    expect(v.lista()).toContain("Completo: todo lo que el índice vio acá quedó unido.");
    // Lo que no se pudo medir se explica, no se esconde.
    expect(v.pagina()).toContain("2 archivos tienen fidelidad incierta");
    expect(v.pagina()).toContain('data-grupo="incierta">Fidelidad incierta <small>2</small>');
    v.tocar({ "data-acc": "orden" });
    expect(v.rutas()[0]).toBe("src/Pedidos.tsx");
  });

  it("cadena de trazabilidad: lo entendido, dónde se corta y lo que no aplica", () => {
    const v = montar(datos);
    const cadenas = [...v.lista().matchAll(/<div class="fd-cadena"[^>]*>(.*?)<\/div>/g)].map((m) => [...m[1]!.matchAll(/class="fd-es (\w+)"[^>]*>([^<]+)</g)].map((e) => `${e[2]}:${e[1]}`));
    // api.ts: una de dos llamadas HTTP quedó sin unir.
    expect(cadenas[0]).toEqual(["Pantalla:na", "HTTP 1/2:no", "Endpoint:na", "Llamadas:na", "Datos:na"]);
    expect(cadenas[2]).toEqual(["Pantalla:ok", "HTTP:na", "Endpoint:na", "Llamadas:na", "Datos:na"]);
    // suelto.ts: no hay nada que medir, y que no tenga funcionalidad no entra en la cadena.
    expect(cadenas[3]).toEqual(["Pantalla:na", "HTTP:na", "Endpoint:na", "Llamadas:na", "Datos:na"]);
  });

  it("agrupa por quién resuelve lo que falta; un archivo con las dos cosas está en los dos grupos", () => {
    const v = montar(datos);
    expect(v.pagina()).toContain('data-grupo="vos">Lo resolvés vos <small>2</small>');
    expect(v.pagina()).toContain('data-grupo="agente">Lo resuelve el agente <small>1</small>');
    expect(v.pagina()).toContain('data-grupo="completos">Completos <small>2</small>');
    v.tocar({ "data-grupo": "agente" });
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.tocar({ "data-grupo": "completos" });
    expect(v.rutas()).toEqual(["src/Pedidos.tsx", "src/suelto.ts"]);
    v.tocar({ "data-grupo": "vos" });
    expect(v.rutas()).toEqual(["src/api.ts", "src/Servicio.php"]);
  });

  it("los filtros y la estadística se ven siempre, y filtran por rango, cerebro, tipo, funcionalidad, signal y texto", () => {
    const v = montar(datos);
    expect(v.pagina()).not.toContain('data-acc="mas-filtros"');
    expect(v.pagina()).toContain('id="fd-lenguaje"');
    expect(v.pagina()).toContain("Por cerebro");
    v.cambiar("fd-min", "40");
    v.cambiar("fd-max", "60");
    expect(v.rutas()).toEqual(["src/api.ts", "src/Servicio.php"]);
    v.cambiar("fd-cerebro", "1");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.tocar({ "data-acc": "limpiar" });
    v.cambiar("fd-feat", "front/feat-pedidos");
    expect(v.rutas()).toEqual(["src/api.ts", "src/Pedidos.tsx"]);
    v.cambiar("fd-feat", "__ninguna");
    expect(v.rutas()).toEqual(["src/suelto.ts"]);
    v.cambiar("fd-feat", "");
    v.cambiar("fd-lenguaje", "php");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
    v.cambiar("fd-lenguaje", "");
    // Las barras del resumen prenden y apagan su filtro.
    v.tocar({ "data-signal": "http" });
    expect(v.rutas()).toEqual(["src/api.ts"]);
    v.tocar({ "data-signal": "http" });
    v.tocar({ "data-min": "100", "data-max": "100" });
    expect(v.rutas()).toEqual(["src/Pedidos.tsx", "src/suelto.ts"]);
    v.tocar({ "data-min": "100", "data-max": "100" });
    v.escribir("a qué método");
    expect(v.rutas()).toEqual(["src/Servicio.php"]);
  });

  it("la estadística se calcula sobre el mismo conjunto que la lista; cada panel no aplica su propio filtro", () => {
    const v = montar(datos);
    const seccion = (titulo: string) => { const p = v.graficos(), i = p.indexOf("<h2>" + titulo); return p.slice(i, p.indexOf("</section>", i)); };
    const barra = (sec: string, attr: string) => { const i = sec.indexOf(attr); return sec.slice(i, sec.indexOf("</button>", i)); };
    // Sin filtros: todos los archivos medidos.
    expect(seccion("Reparto por puntaje")).toContain("Sobre todos los archivos medidos · 4 archivos");
    expect(barra(seccion("Reparto por puntaje"), 'data-min="100"')).toContain("2 archivos");
    expect(barra(seccion("Qué se entendió"), 'data-signal="http"')).toContain("50% · 1 archivo con falta");
    // Cerebro back: el reparto y las signals cuentan solo sus archivos; Por cerebro sigue mostrando todos, con back marcado.
    v.cambiar("fd-cerebro", "1");
    expect(seccion("Reparto por puntaje")).toContain("Sobre cerebro back · 1 archivo");
    expect(barra(seccion("Reparto por puntaje"), 'data-min="100"')).toContain("0 archivos");
    expect(barra(seccion("Reparto por puntaje"), 'data-min="60"')).toContain("1 archivo");
    expect(seccion("Qué se entendió")).toContain("Sobre cerebro back · 1 archivo");
    expect(seccion("Qué se entendió")).not.toContain('data-signal="http"');
    expect(seccion("Qué se entendió")).toContain("No aplican a estos archivos: Llamadas HTTP, Recorrido de endpoints, Tipo de respuesta, Pantallas con llamadas.");
    expect(barra(seccion("Qué se entendió"), 'data-signal="llamadas"')).toContain("50% · 1 archivo con falta");
    expect(seccion("Por cerebro")).toContain("Sobre todos los archivos medidos · 4 archivos · sin aplicar el cerebro elegido");
    expect(seccion("Por cerebro")).toContain('data-cerebro="0"');
    expect(seccion("Por cerebro")).toMatch(/fd-barra on" data-cerebro="1"/);
    // Los demás filtros también: tipo tsx deja un solo archivo en todos los paneles, y un cerebro sin coincidencias lo dice.
    v.cambiar("fd-cerebro", "");
    v.cambiar("fd-lenguaje", "tsx");
    expect(seccion("Reparto por puntaje")).toContain("Sobre tipo tsx · 1 archivo");
    expect(seccion("Por cerebro")).toContain("<strong>back</strong> · ningún archivo coincide con los demás filtros");
    // El rango de puntaje filtra la lista, pero el reparto no se lo aplica a sí mismo: lo marca en su barra.
    v.cambiar("fd-lenguaje", "");
    v.tocar({ "data-min": "40", "data-max": "59" });
    expect(seccion("Reparto por puntaje")).toContain("Sobre todos los archivos medidos · 4 archivos · sin aplicar el rango de puntaje");
    expect(seccion("Reparto por puntaje")).toMatch(/fd-barra on" data-min="40"/);
    expect(seccion("Qué se entendió")).toContain("Sobre puntaje de 40 a 59 · 1 archivo");
    // Un conjunto vacío lo dice y ofrece salir.
    v.escribir("no-existe");
    // Buscar repinta la estadística junto con la lista.
    expect(seccion("Reparto por puntaje")).toContain("Ningún archivo medido coincide con los demás filtros");
  });

  it("fidelidad incierta: un apartado sin puntaje, con el porqué de cada archivo, fuera del promedio", () => {
    const v = montar(datos);
    // El promedio es solo de los medidos: (50 + 60 + 100 + 100) / 4.
    expect(v.pagina()).toContain("<b style=\"color:var(--feat)\">77.5</b><span>puntaje promedio de lo medido</span>");
    expect(v.pagina()).toContain("<b>2</b><span>de fidelidad incierta</span>");
    v.tocar({ "data-grupo": "incierta" });
    // Primero los que tienen código; cada uno dice por qué no se lo puede medir.
    expect(v.rutas()).toEqual(["src/tipos.ts", "config.json"]);
    expect(v.lista()).toContain('<span class="fd-p fd-inc" title="Fidelidad incierta">?</span>');
    expect(v.lista()).toContain("El índice vio código, pero ninguna relación para medir");
    expect(v.lista()).toContain("El índice no encontró nada acá");
    expect(v.lista()).toContain("2 archivos de fidelidad incierta: 1 con código pero sin relaciones, 1 donde el índice no vio nada");
    expect(v.lista()).toContain('<a class="chip" href="#/f/front%2Ffeat-pedidos">Pedidos</a>');
    // No hay plan ni tareas para ellos, y la búsqueda también los filtra.
    expect(v.lista()).not.toContain('data-acc="plan"');
    v.escribir("config");
    expect(v.rutas()).toEqual(["config.json"]);
    v.escribir("nada-que-coincida");
    expect(v.lista()).toContain("Ningún archivo de fidelidad incierta coincide con los filtros. Hay 2 archivos en total.");
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
    v.tocar({ "data-grupo": "agente" });
    expect(montar(datos, { guardado }).rutas()).toEqual(["src/Servicio.php"]);
  });

  it("plan para el agente: de los archivos de la lista, con las relaciones que se elijan", () => {
    const v = montar(datos);
    const plan = () => /<textarea id="fd-pl-texto"[^>]*>([\s\S]*?)<\/textarea>/.exec(v.lista())?.[1]?.replace(/&#(\d+);/g, (_, c: string) => String.fromCharCode(Number(c))) ?? "";
    expect(v.lista()).not.toContain("fd-pl-texto");
    v.tocar({ "data-acc": "plan" });
    expect(plan()).toContain("llevar a 100 el puntaje de fidelidad de 2 archivos");
    expect(plan()).not.toContain("suelto.ts");
    expect(plan()).toContain("- [ ] llamadas: 1 llamada que no se sabe a qué método va (L6).");
    expect(plan()).toContain("- **datos**: seguí flowbrain coverage --guide");
    expect(plan()).toContain("1. Reindexá: flowbrain brains apply <cerebro>.");
    expect(plan()).not.toContain("Pedidos.tsx");
    // Se saca una relación: sus tareas y su explicación salen del plan.
    v.marcar("fd-pl-s-http", false);
    expect(plan()).toContain("de 1 archivo ");
    expect(plan()).not.toContain("src/api.ts");
    expect(plan()).not.toContain("**http**");
    v.marcar("fd-pl-s-http", true);
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
    expect(fija.lista().match(/data-acc="pedido"/g)).toHaveLength(2);
    const servida = montar(datos, { edicion: { token: "t", sinAplicar: ["back"] } });
    expect(servida.pagina()).not.toContain("solo lectura");
    // Lo que resuelve una persona tiene su botón; lo del agente, no. Asociar a una funcionalidad ya no se hace acá.
    expect(servida.lista()).not.toContain("sumar-sugerida");
    expect(servida.lista()).toContain(">Escribir la ruta</button>");
    expect(servida.lista()).toContain(">Elegir destino</button>");
    expect(servida.lista().match(/Lo resuelve el agente/g)).toHaveLength(1);
    expect(servida.pagina()).toContain('data-acc="aplicar" data-cerebro="back">Reindexar back');
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
    expect(v.lista()).toContain("Leyendo el archivo");
    await esperar();
    // El id que viaja es el del cerebro, sin el prefijo que le pone el visor.
    expect(pedidos[0]).toEqual({ url: "/api/archivo?cerebro=back&archivo=repo-api%3Asrc%2FServicio.php", metodo: "GET", token: "secreto", cuerpo: null });
    expect(v.lista()).toContain("se llama a <code>repo.traer</code>. ¿A cuál va?");
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

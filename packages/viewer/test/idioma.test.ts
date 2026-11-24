import { describe, expect, it } from "vitest";
import { IDIOMA_JS, renderViewer } from "../src/index.js";

/** Un DOM mínimo: elementos con atributos, `querySelectorAll` por atributo y el switch. */
function montar(guardado: string | null = null) {
  const almacen = new Map<string, string>(guardado ? [["flowbrain.idioma", guardado]] : []);
  const localStorage = { getItem: (k: string) => almacen.get(k) ?? null, setItem: (k: string, v: string) => void almacen.set(k, v) };
  const el = (attrs: Record<string, string>) => {
    const a = new Map(Object.entries(attrs));
    const clases = new Set<string>();
    return {
      textContent: "",
      getAttribute: (k: string) => a.get(k) ?? null,
      setAttribute: (k: string, v: string) => void a.set(k, v),
      classList: { toggle: (c: string, on: boolean) => void (on ? clases.add(c) : clases.delete(c)), contains: (c: string) => clases.has(c) },
    };
  };
  const nav = el({ "data-en": "Features", "data-es": "Funcionalidades" });
  const buscar = el({ "data-placeholder-en": "Search…", "data-placeholder-es": "Buscar…", placeholder: "Search…" });
  const botones = [el({ "data-idioma": "en" }), el({ "data-idioma": "es" })];
  let clic: ((ev: unknown) => void) | null = null;
  const sw = { addEventListener: (_: string, fn: (ev: unknown) => void) => void (clic = fn) };
  const documentElement = { lang: "" };
  const document = {
    documentElement,
    getElementById: (id: string) => (id === "idioma" ? sw : null),
    querySelectorAll: (sel: string) => {
      if (sel === "[data-en]") return [nav];
      if (sel === "[data-placeholder-en]") return [buscar];
      if (sel === "#idioma [data-idioma]") return botones;
      return [];
    },
  };
  const window: { brainI18n?: { lang: string; L(en: string, es: string): string; num(n: number): string; alCambiar(fn: () => void): void; repintar: (() => void) | null; cambiar(l: string): void } } = {};
  new Function("window", "document", "localStorage", IDIOMA_JS)(window, document, localStorage);
  const tocar = (lang: string) => clic!({ target: { closest: () => botones.find((b) => b.getAttribute("data-idioma") === lang) } });
  return { I: window.brainI18n!, nav, buscar, botones, almacen, documentElement, tocar };
}

describe("idioma del visor", () => {
  it("por defecto, inglés", () => {
    const { I, nav, documentElement, botones } = montar();
    expect(I.lang).toBe("en");
    expect(I.L("Features", "Funcionalidades")).toBe("Features");
    expect(nav.textContent).toBe("Features");
    expect(documentElement.lang).toBe("en");
    expect(botones[0]!.classList.contains("on")).toBe(true);
    expect(I.num(1234)).toBe("1,234");
  });

  it("arranca en castellano si quedó guardado", () => {
    const { I, nav, buscar, botones } = montar("es");
    expect(I.lang).toBe("es");
    expect(nav.textContent).toBe("Funcionalidades");
    expect(buscar.getAttribute("placeholder")).toBe("Buscar…");
    expect(botones[1]!.classList.contains("on")).toBe(true);
    expect(I.num(1234)).toBe((1234).toLocaleString("es"));
  });

  it("el switch cambia todo sin recargar: lo estático, lo que registró cada pantalla y la pantalla abierta, y queda guardado", () => {
    const { I, nav, buscar, almacen, documentElement, tocar } = montar();
    const vistos: string[] = [];
    I.alCambiar(() => vistos.push(`tabla:${I.L("Table", "Tabla")}`));
    I.repintar = () => vistos.push(`pantalla:${I.L("Impact", "Impacto")}`);
    tocar("es");
    expect(nav.textContent).toBe("Funcionalidades");
    expect(buscar.getAttribute("placeholder")).toBe("Buscar…");
    expect(documentElement.lang).toBe("es");
    expect(almacen.get("flowbrain.idioma")).toBe("es");
    // Primero lo que cada pantalla arma al cargar, después la pantalla abierta.
    expect(vistos).toEqual(["tabla:Tabla", "pantalla:Impacto"]);
    tocar("en");
    expect(nav.textContent).toBe("Features");
    expect(almacen.get("flowbrain.idioma")).toBe("en");
    I.cambiar("fr");
    expect(I.lang).toBe("en");
  });

  it("la página trae el switch EN/ES en la cabecera y los textos estáticos en los dos idiomas", () => {
    const html = renderViewer({ nodes: [], edges: [] } as never);
    expect(html).toContain('<html lang="en">');
    expect(html).toMatch(/<header id="cabecera">[\s\S]*id="idioma"[\s\S]*data-idioma="en"[\s\S]*data-idioma="es"[\s\S]*<\/header>/);
    expect(html).toContain('data-en="Features" data-es="Funcionalidades">Features</a>');
    expect(html).toContain('placeholder="Search table, endpoint, feature…"');
    // El idioma corre antes que cualquier pantalla.
    expect(html.indexOf("window.brainI18n = I")).toBeLessThan(html.indexOf("window.brainVisor ="));
  });
});

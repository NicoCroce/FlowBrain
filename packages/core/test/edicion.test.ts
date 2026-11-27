import { describe, expect, it } from "vitest";
import { agregarCodigoAPagina, leerNoProducto, marcarNoProducto, agregarDeclaracion, cambiarEstadoDeEspecificacion, leerLlamadasDeclaradas } from "../src/index.js";

const PAGINA = `---
id: feat-pedidos
tipo: feat
nombre: "Pedidos" # el nombre de negocio
aliases: ["orders"]
codigo:
  - repo-tienda:apps/web/src/pedidos
---
# Pedidos

Texto que no se toca.
`;

describe("sumar código a una funcionalidad", () => {
  it("agrega la entrada y deja el resto de la página igual, con sus comentarios", () => {
    const r = agregarCodigoAPagina("product/feat-pedidos.md", PAGINA, "repo-tienda:apps/web/src/api/pedidos.ts");
    expect(r.cambio).toBe(true);
    expect(r.contenido).toBe(PAGINA.replace("  - repo-tienda:apps/web/src/pedidos\n", "  - repo-tienda:apps/web/src/pedidos\n  - repo-tienda:apps/web/src/api/pedidos.ts\n"));
  });

  it("no repite lo que la página ya cubre, y crea `codigo` si no estaba", () => {
    expect(agregarCodigoAPagina("p.md", PAGINA, "repo-tienda:apps/web/src/pedidos/Lista.tsx")).toEqual({ contenido: PAGINA, cambio: false });
    const sin = PAGINA.replace("codigo:\n  - repo-tienda:apps/web/src/pedidos\n", "");
    expect(agregarCodigoAPagina("p.md", sin, "repo-tienda:apps/api").contenido).toContain('aliases: ["orders"]\ncodigo:\n  - repo-tienda:apps/api\n---\n# Pedidos');
    expect(() => agregarCodigoAPagina("p.md", PAGINA, "../fuera")).toThrow(/invalid code entry/);
  });
});

describe("declarar en calls.yaml", () => {
  const llamada = { desde: "repo-x:src/A.php#A.crear", linea: 42, hacia: "repo-x:src/B.php#B.emitir", origen: "persona" };
  const http = { desde: "repo-x:src/api.ts#traer", linea: 14, metodo: "GET", ruta: "/pedidos/{id}", origen: "persona" };

  it("crea el archivo, suma a cada sección y lo que escribe se vuelve a leer igual", () => {
    const a = agregarDeclaracion(null, "llamadas", llamada);
    const b = agregarDeclaracion(a.contenido, "http", http);
    expect(b.contenido.startsWith("# Calls the code does not declare")).toBe(true);
    expect(leerLlamadasDeclaradas(b.contenido)).toEqual({ llamadas: [llamada], http: [http], rechazadas: [] });
  });

  it("conserva lo que había y no repite la misma línea del mismo método", () => {
    const previo = '# resueltas a mano\nllamadas:\n  - desde: "repo-x:src/A.php#A.crear"\n    linea: 42\n    hacia: "repo-x:src/B.php#B.emitir"\n    nota: "ver services.yaml#L12"\n';
    expect(agregarDeclaracion(previo, "llamadas", llamada)).toEqual({ contenido: previo, cambio: false });
    const r = agregarDeclaracion(previo, "llamadas", { ...llamada, linea: 50 });
    expect(r.contenido.startsWith(previo)).toBe(true);
    expect(leerLlamadasDeclaradas(r.contenido).llamadas.map((x) => x.linea)).toEqual([42, 50]);
    expect(() => agregarDeclaracion("llamadas: [", "http", http)).toThrow(/invalid YAML/);
  });
});

describe("confirmar una especificación", () => {
  const CON = PAGINA.replace("---\n# Pedidos", ["especificaciones:", "  - id: sin-stock # la más pedida", "    texto: No se puede pedir algo sin stock.", "    tipo: negocio", "  - { id: orden, texto: Los más nuevos van primero., tipo: producto, estado: confirmada }", "---", "# Pedidos"].join("\n"));

  it("cambia solo el estado de esa especificación y deja el resto igual", () => {
    const r = cambiarEstadoDeEspecificacion("product/feat-pedidos.md", CON, "sin-stock", "confirmada");
    expect(r.cambio).toBe(true);
    expect(r.contenido).toContain("  - id: sin-stock # la más pedida\n    texto: No se puede pedir algo sin stock.\n    tipo: negocio\n    estado: confirmada\n");
    expect(r.contenido).toContain('nombre: "Pedidos" # el nombre de negocio');
    expect(r.contenido.endsWith("---\n# Pedidos\n\nTexto que no se toca.\n")).toBe(true);
    const vuelta = cambiarEstadoDeEspecificacion("p.md", CON, "orden", "propuesta");
    expect(vuelta.contenido).toContain("estado: propuesta");
    expect(vuelta.contenido).not.toContain("estado: confirmada");
  });

  it("no escribe lo que ya está dicho, ni una especificación o un estado que no existen", () => {
    expect(cambiarEstadoDeEspecificacion("p.md", CON, "orden", "confirmada")).toEqual({ contenido: CON, cambio: false });
    expect(cambiarEstadoDeEspecificacion("p.md", CON, "sin-stock", "propuesta")).toEqual({ contenido: CON, cambio: false });
    expect(() => cambiarEstadoDeEspecificacion("p.md", CON, "otra", "confirmada")).toThrow(/has no specification with id otra/);
    expect(() => cambiarEstadoDeEspecificacion("p.md", PAGINA, "sin-stock", "confirmada")).toThrow(/has no specification/);
    expect(() => cambiarEstadoDeEspecificacion("p.md", CON, "sin-stock", "lista")).toThrow(/unknown estado/);
  });
});

describe("marcar como no de producto (not-product.yaml)", () => {
  it("agrega, cambia el motivo y saca la marca sin tocar los comentarios; sin cambios no escribe", () => {
    const a = marcarNoProducto(null, "repo-x:scripts", "script");
    expect(a.cambio).toBe(true);
    expect(a.contenido).toContain("# Files that are not product code");
    expect(leerNoProducto(a.contenido).marcas).toEqual([{ entrada: "repo-x:scripts", motivo: "script", origen: "persona" }]);
    expect(a.contenido).toContain('entrada: "repo-x:scripts"');
    expect(marcarNoProducto(a.contenido, "repo-x:scripts", "script")).toEqual({ contenido: a.contenido, cambio: false });
    const b = marcarNoProducto(a.contenido, "repo-x:src/gen/api.ts", "generado");
    const c = marcarNoProducto(b.contenido, "repo-x:scripts", "config");
    expect(leerNoProducto(c.contenido).marcas.map((m) => [m.entrada, m.motivo])).toEqual([["repo-x:scripts", "config"], ["repo-x:src/gen/api.ts", "generado"]]);
    const d = marcarNoProducto(c.contenido, "repo-x:scripts", null);
    expect(d.cambio).toBe(true);
    expect(d.contenido).toContain("# Files that are not product code");
    expect(leerNoProducto(d.contenido).marcas.map((m) => m.entrada)).toEqual(["repo-x:src/gen/api.ts"]);
    expect(marcarNoProducto(d.contenido, "repo-x:scripts", null).cambio).toBe(false);
    expect(() => marcarNoProducto(null, "../fuera", "otro")).toThrow(/invalid entry/);
    expect(() => marcarNoProducto(null, "repo-x:a", "porque sí")).toThrow(/unknown motivo/);
  });

  it("al leer descarta lo mal formado y dice por qué", () => {
    const r = leerNoProducto("no_producto:\n  - entrada: repo-x:a\n  - entrada: nada\n  - entrada: repo-x:b\n    motivo: raro\n  - entrada: repo-x:a\n    motivo: test\n");
    expect(r.marcas).toEqual([{ entrada: "repo-x:a", motivo: "otro" }]);
    expect(r.rechazadas).toHaveLength(2);
    expect(leerNoProducto("no_producto: [").rechazadas[0]).toMatch(/invalid YAML/);
  });
});

import { describe, expect, it } from "vitest";
import { agregarCodigoAPagina, agregarDeclaracion, leerLlamadasDeclaradas } from "../src/index.js";

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
    expect(() => agregarCodigoAPagina("p.md", PAGINA, "../fuera")).toThrow(/inválida/);
  });
});

describe("declarar en calls.yaml", () => {
  const llamada = { desde: "repo-x:src/A.php#A.crear", linea: 42, hacia: "repo-x:src/B.php#B.emitir", origen: "persona" };
  const http = { desde: "repo-x:src/api.ts#traer", linea: 14, metodo: "GET", ruta: "/pedidos/{id}", origen: "persona" };

  it("crea el archivo, suma a cada sección y lo que escribe se vuelve a leer igual", () => {
    const a = agregarDeclaracion(null, "llamadas", llamada);
    const b = agregarDeclaracion(a.contenido, "http", http);
    expect(b.contenido.startsWith("# Llamadas que el código no declara")).toBe(true);
    expect(leerLlamadasDeclaradas(b.contenido)).toEqual({ llamadas: [llamada], http: [http], rechazadas: [] });
  });

  it("conserva lo que había y no repite la misma línea del mismo método", () => {
    const previo = '# resueltas a mano\nllamadas:\n  - desde: "repo-x:src/A.php#A.crear"\n    linea: 42\n    hacia: "repo-x:src/B.php#B.emitir"\n    nota: "ver services.yaml#L12"\n';
    expect(agregarDeclaracion(previo, "llamadas", llamada)).toEqual({ contenido: previo, cambio: false });
    const r = agregarDeclaracion(previo, "llamadas", { ...llamada, linea: 50 });
    expect(r.contenido.startsWith(previo)).toBe(true);
    expect(leerLlamadasDeclaradas(r.contenido).llamadas.map((x) => x.linea)).toEqual([42, 50]);
    expect(() => agregarDeclaracion("llamadas: [", "http", http)).toThrow(/YAML inválido/);
  });
});

import { describe, expect, it } from "vitest";
import { leerControles } from "../src/index.js";

describe("controles (checks.yaml)", () => {
  it("lee los cuatro tipos y dice cuáles están mal formados", () => {
    const r = leerControles(
      [
        "controles:",
        '  - { tipo: endpoint, metodo: post, ruta: "/api/login" }',
        '  - { tipo: pantalla, ruta: "/login" }',
        '  - { tipo: llamada, archivo: "src/api.ts", metodo: GET, ruta: "/pedidos" }',
        '  - { tipo: traza, endpoint: "POST /api/login", tabla: "user", nota: "actualiza el token" }',
        '  - { tipo: traza, endpoint: "login", tabla: "user" }',
        "  - { tipo: otra }",
      ].join("\n"),
    );
    expect(r.controles.map((c) => c.tipo)).toEqual(["endpoint", "pantalla", "llamada", "traza"]);
    expect(r.controles[0]).toEqual({ tipo: "endpoint", metodo: "POST", ruta: "/api/login" });
    expect(r.malFormados).toHaveLength(2);
    expect(leerControles("controles: [").malFormados[0]).toContain("invalid YAML");
  });
});

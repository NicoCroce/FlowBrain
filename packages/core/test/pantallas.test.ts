import { describe, expect, it } from "vitest";
import { grafoDePantallas, pantallaDeRuta, type EstructuraArchivo } from "../src/index.js";

const est = (invoca: EstructuraArchivo["invoca"], importa: string[] = []): EstructuraArchivo => ({ simbolos: [], importa, invoca });

describe("pantallas y navegación", () => {
  it("una ruta lleva a la pantalla igual o con parámetros, la más específica", () => {
    const ps = [{ ruta: "/perfil/{id}" }, { ruta: "/perfil/editar" }, { ruta: "/" }];
    expect(pantallaDeRuta("/perfil/editar", ps)?.ruta).toBe("/perfil/editar");
    expect(pantallaDeRuta("/perfil/{param}", ps)?.ruta).toBe("/perfil/{id}");
    expect(pantallaDeRuta("/otra", ps)).toBeNull();
  });

  it("navega_a sale de lo que la pantalla llama o dibuja y de los datos que importa; los layouts quedan aparte", () => {
    const estructura = new Map<string, EstructuraArchivo>([
      ["repo-w:src/Login.tsx", est([{ desde: "Login", archivo: "src/Form.tsx", simbolo: "Form", linea: 3 }], ["src/menu.ts"])],
      ["repo-w:src/Form.tsx", est([])],
      ["repo-w:src/menu.ts", est([])],
      ["repo-w:src/Shell.tsx", est([])],
    ]);
    const pantallas = [
      { paquete: "", ruta: "/login", archivo: "src/router.tsx", linea: 5, componente: { archivo: "src/Login.tsx", simbolo: "Login" }, envuelta: [{ archivo: "src/Shell.tsx", simbolo: "Shell" }] },
      { paquete: "", ruta: "/", archivo: "src/router.tsx", linea: 6, componente: { archivo: "src/Home.tsx", simbolo: "Home" }, envuelta: [] },
      { paquete: "", ruta: "/ayuda", archivo: "src/router.tsx", linea: 7, componente: { archivo: "src/Ayuda.tsx", simbolo: "Ayuda" }, envuelta: [] },
    ];
    const navegaciones = [
      { paquete: "", archivo: "src/Form.tsx", linea: 9, desde: "Form", ruta: "/", tipo: "navega" as const },
      { paquete: "", archivo: "src/menu.ts", linea: 2, desde: null, ruta: "/ayuda", tipo: "enlace" as const },
      { paquete: "", archivo: "src/Shell.tsx", linea: 4, desde: "Shell", ruta: "/ayuda", tipo: "enlace" as const },
      { paquete: "", archivo: "src/Otro.tsx", linea: 1, desde: "Otro", ruta: "/login", tipo: "navega" as const },
    ];
    const g = grafoDePantallas("repo-w", pantallas, navegaciones, estructura, () => "svc-w");
    expect(g.aristas.map((a) => `${a.desde} → ${a.hasta} ${a.evidencia}`)).toEqual([
      "svc-w:pantalla:/login → svc-w:pantalla:/ repo-w:src/Form.tsx#L9",
      "svc-w:pantalla:/login → svc-w:pantalla:/ayuda repo-w:src/menu.ts#L2",
    ]);
    const login = g.nodos.find((n) => n.id === "svc-w:pantalla:/login")!;
    expect(login.aliases).toEqual(["Login"]);
    expect(login.atributos.envuelta).toEqual([{ componente: "repo-w:src/Shell.tsx#Shell", sale: [{ a: "svc-w:pantalla:/ayuda", ruta: "/ayuda", tipo: "enlace", evidencia: "repo-w:src/Shell.tsx#L4" }] }]);
    expect(g.nodos.find((n) => n.id === "svc-w:pantalla:/ayuda")!.atributos.desdeEnvolturas).toEqual([{ componente: "repo-w:src/Shell.tsx#Shell", tipo: "enlace", evidencia: "repo-w:src/Shell.tsx#L4" }]);
  });
});

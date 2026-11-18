import { describe, expect, it } from "vitest";
import { aplicarLlamadasDeclaradas, httpDeclaradasDe, leerLlamadasDeclaradas } from "../src/index.js";

const archivos = () => [
  {
    ruta: "src/PedidoController.php",
    simbolos: [{ nombre: "PedidoController", linea: 5 }, { nombre: "PedidoController.crear", linea: 10, fin: 20 }],
    sinResolver: [{ desde: "PedidoController.crear", linea: 14, llamada: "$svc->emitir" }],
  } as { ruta: string; simbolos: Array<{ nombre: string; linea: number; fin?: number }>; invoca?: Array<{ desde: string; archivo: string; simbolo: string; linea: number }>; sinResolver?: Array<{ desde: string; linea: number; llamada: string }> },
  { ruta: "src/Facturador.php", simbolos: [{ nombre: "Facturador.emitir", linea: 8, fin: 12 }] },
];
const yaml = (extra: string[]) => ["llamadas:", ...extra].join("\n");
const bien = ['  - desde: "repo-x:src/PedidoController.php#PedidoController.crear"', "    linea: 14", '    hacia: "repo-x:src/Facturador.php#Facturador.emitir"', "    origen: modelo"];

describe("llamadas declaradas (calls.yaml)", () => {
  it("la que se puede comprobar entra al índice y deja de estar sin resolver", () => {
    const a = archivos();
    const { llamadas, rechazadas } = leerLlamadasDeclaradas(yaml(bien));
    expect(rechazadas).toEqual([]);
    expect(aplicarLlamadasDeclaradas(a, "repo-x", llamadas)).toEqual({ aplicadas: 1, rechazadas: [] });
    expect(a[0]!.invoca).toEqual([{ desde: "PedidoController.crear", archivo: "src/Facturador.php", simbolo: "Facturador.emitir", linea: 14 }]);
    expect(a[0]!.sinResolver).toBeUndefined();
    // Aplicarla de nuevo no la duplica, y no toca otro repo.
    aplicarLlamadasDeclaradas(a, "repo-x", llamadas);
    expect(a[0]!.invoca).toHaveLength(1);
    expect(aplicarLlamadasDeclaradas(archivos(), "repo-otro", llamadas)).toEqual({ aplicadas: 0, rechazadas: [] });
  });

  it("la que no se puede comprobar se rechaza con el motivo, sin tocar el índice", () => {
    const caso = (cambio: (l: string[]) => string[]) => {
      const a = archivos();
      const r = aplicarLlamadasDeclaradas(a, "repo-x", leerLlamadasDeclaradas(yaml(cambio([...bien]))).llamadas);
      expect(a[0]!.invoca).toBeUndefined();
      return r.rechazadas[0];
    };
    expect(caso((l) => ((l[2] = '    hacia: "repo-x:src/Facturador.php#Facturador.noExiste"'), l))).toContain("no existe repo-x:src/Facturador.php#Facturador.noExiste en el índice");
    expect(caso((l) => ((l[1] = "    linea: 99"), l))).toContain("la línea 99 no está dentro de PedidoController.crear (10-20)");
    expect(caso((l) => ((l[2] = '    hacia: "repo-y:src/Facturador.php#Facturador.emitir"'), l))).toContain("el destino está en otro repo");
    expect(leerLlamadasDeclaradas(yaml(['  - desde: "sin-forma"', "    linea: 1"])).rechazadas).toHaveLength(1);
    expect(leerLlamadasDeclaradas("llamadas: [").rechazadas[0]).toContain("YAML inválido");
  });

  it("llamadas HTTP declaradas: valen las que caen dentro de un símbolo que existe", () => {
    const y = ["http:", '  - desde: "repo-x:src/PedidoController.php#PedidoController.crear"', "    linea: 15", "    metodo: get", '    ruta: "/facturas/{id}"', "    base: API_URL", '  - desde: "repo-x:src/PedidoController.php#PedidoController.crear"', "    linea: 99", "    metodo: GET", '    ruta: "/x"', '  - desde: "repo-x:src/PedidoController.php#PedidoController.crear"', "    linea: 15", "    metodo: GET", "    ruta: sin-barra"].join("\n");
    const d = leerLlamadasDeclaradas(y);
    expect(d.http.map((h) => `${h.metodo} ${h.ruta} ${h.base ?? ""}`)).toEqual(["GET /facturas/{id} API_URL", "GET /x "]);
    expect(d.rechazadas).toHaveLength(1);
    const r = httpDeclaradasDe(archivos(), "repo-x", d.http);
    expect(r.validas.map((h) => `${h.archivo}#L${h.linea} ${h.ruta}`)).toEqual(["src/PedidoController.php#L15 /facturas/{id}"]);
    expect(r.rechazadas[0]).toContain("la línea 99 no está dentro de PedidoController.crear");
  });
});

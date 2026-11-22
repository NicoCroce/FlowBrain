import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { casosDeTest, nombreLlano } from "../src/casos-de-test.js";
import { agregarCasosDeTest } from "../src/indexar.js";
import { leerRepo } from "../src/repo.js";
import type { Extraccion } from "../src/tipos.js";

const nombres = (texto: string) => casosDeTest(texto).map((c) => (c.grupo ? `${c.grupo} › ` : "") + c.nombre);

describe("casos de test, por el texto", () => {
  it("llamadas con el nombre como texto, con sus grupos (Jest, Vitest, Mocha, Pest, Dart)", () => {
    const casos = casosDeTest(
      [
        'describe("Carrito", () => {',
        '  it("suma un producto", () => {});',
        "  describe('con cupón', () => {",
        "    test.each([[1], [2]])('aplica el descuento %i', () => {});",
        "    it.skip(`no acepta un cupón vencido`, () => {});",
        "  });",
        '  it("se vacía al pagar", () => {});',
        "});",
        'test("fuera de todo grupo", () => {});',
      ].join("\n"),
    );
    expect(casos).toEqual([
      { nombre: "suma un producto", linea: 2, grupo: "Carrito" },
      { nombre: "aplica el descuento %i", linea: 4, grupo: "Carrito › con cupón" },
      { nombre: "no acepta un cupón vencido", linea: 5, grupo: "Carrito › con cupón" },
      { nombre: "se vacía al pagar", linea: 7, grupo: "Carrito" },
      { nombre: "fuera de todo grupo", linea: 9 },
    ]);
  });

  it("sin paréntesis (RSpec, ExUnit) y con el nombre en una variable", () => {
    expect(nombres('describe "Pedido" do\n  it "calcula el total" do\n  end\nend')).toEqual(["Pedido › calcula el total"]);
    expect(nombres('  test "rechaza un pago duplicado" do\n  end')).toEqual(["rechaza un pago duplicado"]);
    expect(nombres("for (const [name, fn] of casos) {\n  it(name, async () => {});\n}")).toEqual(["(varios casos armados al correr, por `name`)"]);
  });

  it("funciones que se llaman test… (PHPUnit, pytest, Go, XCTest)", () => {
    expect(nombres("class PagoTest extends TestCase {\n  public function testRechazaTarjetaVencida(): void {}\n  private function armar() {}\n}")).toEqual(["rechaza tarjeta vencida"]);
    expect(nombres("def test_calcula_el_total():\n    pass\n\nasync def test_sin_stock(cliente):\n    pass\n\ndef ayuda():\n    pass")).toEqual(["calcula el total", "sin stock"]);
    expect(nombres("func TestCreaElPedido(t *testing.T) {}\nfunc ayuda() {}")).toEqual(["crea el pedido"]);
    expect(nombres("  func testGuardaElBorrador() throws {}")).toEqual(["guarda el borrador"]);
  });

  it("una marca antes de la función (JUnit, PHPUnit, Rust, xUnit, NUnit)", () => {
    expect(nombres("class PagoTest {\n  @Test\n  @DisplayName(\"x\")\n  void rechazaTarjetaVencida() {}\n  void ayuda() {}\n}")).toEqual(["rechaza tarjeta vencida"]);
    expect(nombres("  @Test\n  fun `rechaza una tarjeta vencida`() {}")).toEqual(["rechaza una tarjeta vencida"]);
    expect(nombres("  #[Test]\n  public function rechaza_tarjeta_vencida(): void {}")).toEqual(["rechaza tarjeta vencida"]);
    expect(nombres("    /** @test */\n    public function it_cobra(): void {}")).toEqual(["it cobra"]);
    expect(nombres("#[test]\nfn suma_dos_numeros() {}\nfn ayuda() {}")).toEqual(["suma dos numeros"]);
    expect(nombres("    [Fact]\n    public async Task RechazaTarjetaVencida() {}")).toEqual(["rechaza tarjeta vencida"]);
  });

  it("nombres de función a palabras; una frase queda como está", () => {
    expect(nombreLlano("testHTTPClientFails")).toBe("http client fails");
    expect(nombreLlano("test_user_can_login")).toBe("user can login");
    expect(nombreLlano("`el usuario entra`")).toBe("el usuario entra");
  });

  it("un archivo sin casos devuelve vacío", () => {
    expect(casosDeTest("export const item = { test: 1 };\nfunction describeUser() {}\n")).toEqual([]);
  });
});

describe("casos de test en el índice", () => {
  it("lee los de cualquier lenguaje; un archivo que solo se llama Test no es un test", () => {
    const raiz = mkdtempSync(join(tmpdir(), "fb-casos-"));
    const escribir = (ruta: string, texto: string) => {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), texto);
    };
    escribir("src/carrito.test.ts", 'it("suma", () => {});');
    escribir("src/generado.test.ts", "export const x = 1;");
    escribir("tests/test_pagos.py", "def test_cobra():\n    pass\n");
    escribir("app/PagoTest.php", "<?php class PagoTest { public function testCobra() {} }");
    escribir("app/Entity/WellnessTest.php", "<?php class WellnessTest { public function getId() {} }");
    escribir("src/carrito.ts", "export const x = 1;");
    escribir("tests/fixtures/datos.test.ts", 'it("no cuenta", () => {});');
    const x = { archivos: [{ ruta: "src/carrito.test.ts", lenguaje: "ts", simbolos: [] }, { ruta: "src/generado.test.ts", lenguaje: "ts", simbolos: [] }, { ruta: "src/carrito.ts", lenguaje: "ts", simbolos: [] }] } as unknown as Extraccion;
    agregarCasosDeTest(leerRepo(raiz), x);
    expect(x.archivos.map((a) => [a.ruta, a.lenguaje, a.casos?.map((c) => c.nombre)])).toEqual([
      ["app/PagoTest.php", "php", ["cobra"]],
      ["src/carrito.test.ts", "ts", ["suma"]],
      ["src/carrito.ts", "ts", undefined],
      // Es un test por su nombre, pero sin casos legibles: queda marcado, vacío.
      ["src/generado.test.ts", "ts", []],
      ["tests/test_pagos.py", "py", ["cobra"]],
    ]);
  });
});

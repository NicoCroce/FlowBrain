import type { CasoDeTest } from "./tipos.js";

/**
 * Casos de prueba de un archivo de test, leídos del texto: sirve para cualquier lenguaje, sin su parser. Reconoce las
 * tres formas en que los frameworks nombran un caso:
 * - una llamada con el nombre como texto: `it("…")`, `test('…')`, `it "…" do` (Jest, Vitest, Mocha, Pest, RSpec,
 *   ExUnit, Dart, Deno), con sus `describe`/`context`/`group` como grupo;
 * - una marca antes de la función: `@Test`, `#[Test]`, `#[test]`, `[Fact]`, `@test` (JUnit, PHPUnit, Rust, xUnit, NUnit);
 * - una función que se llama `test…`: `testAlgo`, `test_algo`, `TestAlgo` (PHPUnit, pytest, Go, XCTest).
 * No ejecuta nada ni entiende el cuerpo del test: solo dice qué casos hay, cómo se llaman y en qué línea.
 */

/** Extensiones de código: un `.snap`, un `.json` o una imagen dentro de `tests/` no tienen casos. */
export const ES_CODIGO_DE_TEST = /\.(?:[cm]?[jt]sx?|vue|svelte|php|py|rb|go|java|kt|kts|cs|rs|swift|dart|exs?|scala|groovy)$/i;

const LLAMADA = /^(\s*)(it|test|specify|scenario|example|describe|context|suite|group|feature)(?:\.(?:only|skip|todo|concurrent|sequential|fails|each\s*\([^)]*\)|each))*\s*\(?\s*(["'`])((?:\\.|(?!\3).)+)\3/;
/** `it(nombre, …)`: el nombre es una variable; los casos se arman al correr (una tabla de escenarios). */
const DINAMICA = /^(\s*)(?:it|test)(?:\.(?:only|skip|concurrent|each))*\s*\(\s*([A-Za-z_$][\w$.]*)\s*,/;
const ES_GRUPO = new Set(["describe", "context", "suite", "group", "feature"]);
const MARCA = /(?:^|\s|\*)@(?:Test|ParameterizedTest|RepeatedTest|test)\b|#\[(?:Test|test|tokio::test|DataProvider)\b|#\[[\w:]*::test\b|\[(?:Fact|Theory|Test|TestMethod|TestCase)\b/;
const FUNCION = /\b(?:function|fun|fn|def|func)\s+(`[^`]+`|[A-Za-z_$][\w$]*)\s*[(<]|\b(?:void|Task|Unit)\s+([A-Za-z_$][\w$]*)\s*\(/;
const POR_NOMBRE = /\b(?:function|def|func|fun)\s+(?:\([^)]*\)\s*)?(test[A-Z_0-9]\w*|Test[A-Z_0-9]\w*)\s*[(<]/;
const TOPE = 500;

/** `testUserCanLogin`, `test_user_can_login` → "user can login". Un nombre que ya es una frase queda como está. */
export function nombreLlano(nombre: string): string {
  const n = nombre.replace(/^`|`$/g, "");
  if (/\s/.test(n)) return n.trim();
  const sinPrefijo = n.replace(/^(?:test|Test)_*/, "") || n;
  return sinPrefijo
    .replace(/_+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .toLowerCase();
}

export function casosDeTest(texto: string): CasoDeTest[] {
  const casos: CasoDeTest[] = [];
  const vistos = new Set<number>();
  // Grupos abiertos, por sangría: un caso pertenece a los `describe` que están menos sangrados que él.
  const grupos: Array<{ sangria: number; nombre: string }> = [];
  let marca = 0;
  const agregar = (nombre: string, linea: number, sangria: number) => {
    if (vistos.has(linea) || casos.length >= TOPE) return;
    vistos.add(linea);
    const grupo = grupos.filter((g) => g.sangria < sangria).map((g) => g.nombre).join(" › ");
    casos.push({ nombre: nombre.replace(/\s+/g, " ").trim().slice(0, 200), linea, ...(grupo ? { grupo: grupo.slice(0, 200) } : {}) });
  };
  const lineas = texto.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (l.length > 2000) continue;
    const m = LLAMADA.exec(l);
    if (m) {
      const sangria = m[1]!.length;
      while (grupos.length && grupos[grupos.length - 1]!.sangria >= sangria) grupos.pop();
      if (ES_GRUPO.has(m[2]!)) grupos.push({ sangria, nombre: m[4]! });
      else agregar(m[4]!, i + 1, sangria);
      continue;
    }
    const sangria = l.length - l.trimStart().length;
    const d = DINAMICA.exec(l);
    if (d) {
      agregar(`(varios casos armados al correr, por \`${d[2]}\`)`, i + 1, d[1]!.length);
      continue;
    }
    const f = FUNCION.exec(l);
    if (marca > 0 && f) {
      agregar(nombreLlano(f[1] ?? f[2]!), i + 1, sangria);
      marca = 0;
      continue;
    }
    const n = POR_NOMBRE.exec(l);
    if (n) agregar(nombreLlano(n[1]!), i + 1, sangria);
    // La marca vale para la función que viene en las próximas líneas (puede haber otras anotaciones en el medio).
    if (MARCA.test(l)) marca = 6;
    else if (marca > 0 && l.trim()) marca--;
  }
  return casos;
}

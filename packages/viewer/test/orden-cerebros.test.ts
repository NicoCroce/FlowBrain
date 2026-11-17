import { describe, expect, it } from "vitest";
import { GRAFO3D_JS, ORDEN_CEREBROS_JS } from "../src/index.js";

const ordenSinCruces = new Function(`${ORDEN_CEREBROS_JS}; return ordenSinCruces;`)() as (nc: number, pares: number[][]) => number[];

/** Cuántos pares de líneas se cruzan con esta asignación de vértices. */
function cruces(slot: number[], pares: number[][]): number {
  const lineas = [...new Set(pares.map(([a, b]) => `${Math.min(a!, b!)}-${Math.max(a!, b!)}`))].map((k) => k.split("-").map(Number) as [number, number]);
  let n = 0;
  for (let i = 0; i < lineas.length; i++) {
    const [p, q] = [slot[lineas[i]![0]]!, slot[lineas[i]![1]]!].sort((x, y) => x - y) as [number, number];
    for (let j = i + 1; j < lineas.length; j++) {
      const r = slot[lineas[j]![0]]!, s = slot[lineas[j]![1]]!;
      if ([p, q].includes(r) || [p, q].includes(s)) continue;
      if ((p < r && r < q) !== (p < s && s < q)) n++;
    }
  }
  return n;
}
const repetir = (par: number[], veces: number) => Array.from({ length: veces }, () => par);

describe("orden de los cerebros en el polígono", () => {
  it("sin líneas, o con menos de cuatro cerebros, respeta el orden del registro", () => {
    expect(ordenSinCruces(6, [])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ordenSinCruces(3, [[0, 2], [1, 2]])).toEqual([0, 1, 2]);
  });

  it("deshace los cruces del orden del registro y deja juntos a los que se hablan", () => {
    // Tres fronts (0, 1, 2) y dos APIs (3, 4), más dos cerebros sueltos (5, 6). En el orden del registro las líneas se cruzan.
    const pares = [...repetir([0, 3], 90), ...repetir([1, 4], 400), ...repetir([2, 4], 90)];
    const identidad = [0, 1, 2, 3, 4, 5, 6];
    expect(cruces(identidad, pares)).toBeGreaterThan(0);
    const slot = ordenSinCruces(7, pares);
    expect(slot[0]).toBe(0);
    expect([...slot].sort()).toEqual(identidad);
    expect(cruces(slot, pares)).toBe(0);
    const vecinos = (a: number, b: number) => [1, 6].includes(Math.abs(slot[a]! - slot[b]!));
    expect(vecinos(0, 3) && vecinos(1, 4) && vecinos(2, 4)).toBe(true);
  });

  it("si no se pueden evitar todos los cruces, sacrifica las líneas con menos llamadas", () => {
    // Cuatro cerebros todos conectados con todos: siempre se cruza un par de diagonales; que sean las livianas.
    const pares = [...repetir([0, 1], 50), ...repetir([2, 3], 50), ...repetir([0, 2], 50), ...repetir([1, 3], 50), ...repetir([0, 3], 1), ...repetir([1, 2], 1)];
    const slot = ordenSinCruces(4, pares);
    const diagonal = (a: number, b: number) => Math.abs(slot[a]! - slot[b]!) === 2;
    expect(diagonal(0, 3) && diagonal(1, 2)).toBe(true);
  });

  it("es determinista y el mapa 3D lo trae", () => {
    const pares = [...repetir([0, 5], 3), ...repetir([1, 6], 2), ...repetir([2, 7], 1), ...repetir([3, 4], 4)];
    expect(ordenSinCruces(8, pares)).toEqual(ordenSinCruces(8, pares));
    expect(GRAFO3D_JS).toContain("function ordenSinCruces(");
    expect(GRAFO3D_JS).toContain("brilloCruce(e)");
    expect(() => new Function(GRAFO3D_JS)).not.toThrow();
  });
});

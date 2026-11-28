import { describe, expect, it } from "vitest";
// @ts-expect-error: script de Node sin tipos
import { changelogHasta, compararVersiones, leerArgumentos, notasDe, problemaDeOrden, ramaDeRelease, siguienteVersion, versionesDelChangelog } from "../../../scripts/release.mjs";

const md = [
  "# Cambios",
  "",
  "## 0.3.0 · 2026-11-27",
  "",
  "- Tres.",
  "",
  "## 0.2.0 · 2026-11-27",
  "",
  "- Dos.",
  "",
  "## 0.1.10 · 2026-11-25",
  "",
  "- Diez.",
  "",
  "## 0.1.1 · 2026-11-25",
  "",
  "- README.",
  "",
].join("\n");

describe("pnpm release", () => {
  it("calcula la versión siguiente", () => {
    expect(siguienteVersion("0.1.1", undefined)).toBe("0.1.1");
    expect(siguienteVersion("0.1.1", "patch")).toBe("0.1.2");
    expect(siguienteVersion("0.1.1", "minor")).toBe("0.2.0");
    expect(siguienteVersion("0.1.1", "major")).toBe("1.0.0");
    expect(siguienteVersion("0.1.1", "0.3.0")).toBe("0.3.0");
    expect(() => siguienteVersion("0.1.1", "otra")).toThrow(/patch, minor, major/);
  });
  it("toma las notas de la versión del CHANGELOG", () => {
    const corto = "# Cambios\n\n## 0.1.1 · 2026-11-25\n\n- README.\n\n## 0.1.0 · 2026-11-24\n\n- Primera.\n";
    expect(notasDe(corto, "0.1.1")).toBe("- README.");
    expect(notasDe(corto, "0.1.0")).toBe("- Primera.");
    expect(notasDe(corto, "0.1.10")).toBeNull();
    expect(notasDe(corto, "0.2.0")).toBeNull();
    expect(notasDe(md, "0.2.0")).toBe("- Dos.");
  });
  it("compara versiones por número, no como texto", () => {
    expect(compararVersiones("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compararVersiones("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compararVersiones("1.0.0", "1.0.0")).toBe(0);
  });
  it("lista las versiones del CHANGELOG", () => {
    expect(versionesDelChangelog(md)).toEqual(["0.3.0", "0.2.0", "0.1.10", "0.1.1"]);
  });
  it("corta el CHANGELOG en una versión: saca las posteriores y deja el resto igual", () => {
    expect(changelogHasta(md, "0.3.0")).toBe(md);
    const hasta02 = changelogHasta(md, "0.2.0");
    expect(hasta02.startsWith("# Cambios\n\n## 0.2.0 · 2026-11-27\n\n- Dos.\n\n## 0.1.10")).toBe(true);
    expect(hasta02).not.toContain("Tres");
    expect(hasta02.endsWith("- README.\n")).toBe(true);
    expect(changelogHasta(md, "0.1.9")).toBe("# Cambios\n\n## 0.1.1 · 2026-11-25\n\n- README.\n");
  });
  it("publica en orden: nada menor que la última de npm ni saltear una del CHANGELOG", () => {
    const npm = ["0.0.0-stage", "0.1.0", "0.1.1"];
    const cl = ["0.5.0", "0.4.0", "0.3.0", "0.2.0", "0.1.1", "0.1.0"];
    expect(problemaDeOrden("0.2.0", npm, cl)).toBeNull();
    expect(problemaDeOrden("0.4.0", npm, cl)).toMatch(/antes hay que publicar 0\.2\.0, 0\.3\.0/);
    expect(problemaDeOrden("0.3.0", [...npm, "0.2.0"], cl)).toBeNull();
    expect(problemaDeOrden("0.1.5", [...npm, "0.2.0"], cl)).toMatch(/menor que la última publicada en npm \(0\.2\.0\)/);
    // Ya publicada: se puede volver a correr para terminar el tag.
    expect(problemaDeOrden("0.2.0", [...npm, "0.2.0", "0.3.0"], cl)).toBeNull();
    // Una pre-release no cuenta como la última.
    expect(problemaDeOrden("0.1.2", ["0.1.1", "0.2.0-beta.1"], [])).toBeNull();
    expect(problemaDeOrden("0.1.0", [], [])).toBeNull();
  });
  it("lee los argumentos del modo --desde", () => {
    expect(leerArgumentos(["minor", "--dry-run"])).toEqual({ pedido: "minor", desde: null, seco: true, preparar: false });
    expect(leerArgumentos(["0.3.0", "--desde", "a4486a8"])).toEqual({ pedido: "0.3.0", desde: "a4486a8", seco: false, preparar: false });
    expect(leerArgumentos(["--desde=a4486a8", "0.3.0", "--preparar"])).toEqual({ pedido: "0.3.0", desde: "a4486a8", seco: false, preparar: true });
    expect(() => leerArgumentos(["0.3.0", "--desde"])).toThrow(/necesita un commit/);
    expect(() => leerArgumentos(["minor", "--desde", "a4486a8"])).toThrow(/versión va explícita/);
    expect(() => leerArgumentos(["0.3.0", "--preparar"])).toThrow(/--preparar es para --desde/);
    expect(ramaDeRelease("0.3.0")).toBe("release/v0.3.0");
  });
});

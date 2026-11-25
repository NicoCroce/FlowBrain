import { describe, expect, it } from "vitest";
// @ts-expect-error: script de Node sin tipos
import { notasDe, siguienteVersion } from "../../../scripts/release.mjs";

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
    const md = "# Cambios\n\n## 0.1.1 · 2026-11-25\n\n- README.\n\n## 0.1.0 · 2026-11-24\n\n- Primera.\n";
    expect(notasDe(md, "0.1.1")).toBe("- README.");
    expect(notasDe(md, "0.1.0")).toBe("- Primera.");
    expect(notasDe(md, "0.1.10")).toBeNull();
    expect(notasDe(md, "0.2.0")).toBeNull();
  });
});

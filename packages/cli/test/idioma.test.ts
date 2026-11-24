import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fijarIdioma, guardarIdioma, idioma, L, resolverIdioma } from "../src/idioma.js";

const YAML = (lang?: string) => `version: 1\n${lang ? `lang: ${lang}\n` : ""}cerebros:\n  - nombre: tienda\n    repos: []\n`;

async function proyecto(lang?: string) {
  const dir = await mkdtemp(join(tmpdir(), "fb-idioma-"));
  await mkdir(join(dir, ".flowbrain"));
  await writeFile(join(dir, ".flowbrain/flowbrain.yaml"), YAML(lang));
  return dir;
}

afterEach(() => fijarIdioma("en"));

describe("idioma de la CLI", () => {
  it("por defecto, inglés", async () => {
    expect(await resolverIdioma({ env: {}, cwd: await proyecto() })).toBe("en");
    expect(L("ready", "listo")).toBe("ready");
  });

  it("orden: --lang, FLOWBRAIN_LANG, la preferencia guardada, lang en flowbrain.yaml", async () => {
    const cwd = await proyecto("es");
    const home = await mkdtemp(join(tmpdir(), "fb-home-"));
    expect(await resolverIdioma({ env: { HOME: home }, cwd })).toBe("es");
    expect(L("ready", "listo")).toBe("listo");
    const archivo = await guardarIdioma({ HOME: home }, "en");
    expect(archivo).toBe(join(home, ".config/flowbrain/config.json"));
    expect(JSON.parse(await readFile(archivo!, "utf8"))).toEqual({ lang: "en" });
    expect(await resolverIdioma({ env: { HOME: home }, cwd })).toBe("en");
    expect(await resolverIdioma({ env: { HOME: home, FLOWBRAIN_LANG: "es" }, cwd })).toBe("es");
    expect(await resolverIdioma({ flag: "en", env: { HOME: home, FLOWBRAIN_LANG: "es" }, cwd })).toBe("en");
  });

  it("un valor inválido se ignora", async () => {
    expect(await resolverIdioma({ flag: "fr", env: { FLOWBRAIN_LANG: "de" }, cwd: await proyecto() })).toBe("en");
    expect(idioma()).toBe("en");
  });

  it("flowbrain.yaml rechaza un idioma que no existe", async () => {
    const { interpretarRegistro } = await import("@flowbrain/core");
    expect(interpretarRegistro(YAML("es"), "/tmp/x").lang).toBe("es");
    expect(interpretarRegistro(YAML(), "/tmp/x").lang).toBeNull();
    expect(() => interpretarRegistro(YAML("fr"), "/tmp/x")).toThrow(/lang/);
  });
});

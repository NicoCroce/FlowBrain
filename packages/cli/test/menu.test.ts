import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accion, contextoMenu, dibujar, elegir, opciones, PROMPT_ANALISIS, type ContextoMenu, type Entorno } from "../src/menu.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-menu-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Un entorno de mentira: anota lo que se corre y responde con las teclas y respuestas dadas. */
function falso(teclas: string[] = [], respuestas: string[] = []) {
  const corridas: string[] = [];
  const salida: string[] = [];
  const e: Entorno = {
    flowbrain: async (args, cwd) => {
      corridas.push(`flowbrain ${args.join(" ")} @${cwd}`);
      return { codigo: 0, stdout: "hecho\n", stderr: "" };
    },
    correr: async (p, args, cwd) => {
      corridas.push(`${p} ${args.join(" ").slice(0, 40)} @${cwd}`);
      return 0;
    },
    escribir: (t) => void salida.push(t),
    tecla: async () => teclas.shift() ?? "salir",
    preguntar: async () => respuestas.shift() ?? "",
    limpiar: () => {},
  };
  return { e, corridas, salida };
}

const base: ContextoMenu = { proyecto: "/p", registro: null, cerebros: [], visor: null, mcp: false, claude: true, version: "dev" };

describe("menú", () => {
  it("sin configurar: primero configurar; reindexar, visor y estado no aparecen", () => {
    const ops = opciones(base).map((o) => o.clave);
    expect(ops).toEqual(["configurar", "analizar", "mcp", "actualizar", "salir"]);
    expect(opciones(base)[1]!.detalle).toContain("antes lo configura");
  });

  it("configurado y con visor: todas las opciones, y el estado en la cabecera", () => {
    const c = { ...base, registro: "/p/.flowbrain", cerebros: ["web", "api"], visor: "/p/.flowbrain/flowbrain.html", mcp: true };
    expect(opciones(c).map((o) => o.clave)).toEqual(["configurar", "analizar", "reindexar", "visor", "estado", "mcp", "actualizar", "salir"]);
    const t = dibujar(c, opciones(c), 0);
    expect(t).toContain("2 cerebros: web, api");
    expect(t).toContain("MCP conectado");
  });

  it("detecta el proyecto desde un subdirectorio y lee sus cerebros", async () => {
    await mkdir(join(dir, ".flowbrain"), { recursive: true });
    await writeFile(join(dir, ".flowbrain/flowbrain.yaml"), "version: 1\ncerebros:\n  - nombre: web\n    repos:\n      - ruta: \"../web\"\n");
    await mkdir(join(dir, "web/src"), { recursive: true });
    const c = await contextoMenu(join(dir, "web/src"), { hayComando: () => false, mcpConfig: [] });
    expect(c.proyecto).toBe(dir);
    expect(c.cerebros).toEqual(["web"]);
    expect(c.claude).toBe(false);
    expect(opciones(c).find((o) => o.clave === "analizar")!.detalle).toContain("necesita Claude Code");
  });

  it("se elige con flechas, con el número o se sale con q", async () => {
    const ops = opciones(base);
    expect((await elegir(base, ops, falso(["abajo", "abajo", "arriba", "enter"]).e)).clave).toBe("analizar");
    expect((await elegir(base, ops, falso(["3"]).e)).clave).toBe("mcp");
    expect((await elegir(base, ops, falso(["9", "salir"]).e)).clave).toBe("salir");
  });

  it("analizar sin configurar: configura y abre Claude Code con el análisis completo, en el proyecto", async () => {
    const f = falso();
    expect(await accion(opciones(base)[1]!, base, f.e)).toBe(true);
    expect(f.corridas).toEqual(["flowbrain install @/p", `claude ${PROMPT_ANALISIS.slice(0, 40)} @/p`]);
    expect(PROMPT_ANALISIS).toMatch(/coverage --guide[\s\S]*evidence --guide[\s\S]*feature --guide/);
  });

  it("conectar el MCP pide confirmación; sin un sí no corre nada", async () => {
    const mcp = opciones(base).find((o) => o.clave === "mcp")!;
    const no = falso([], ["n"]);
    await accion(mcp, base, no.e);
    expect(no.corridas).toEqual([]);
    const si = falso([], ["s"]);
    await accion(mcp, base, si.e);
    expect(si.corridas).toHaveLength(1);
    expect(si.corridas[0]).toMatch(/^sh -c claude mcp add --scope user flowbrain/);
  });

  it("salir termina el menú", async () => {
    expect(await accion({ clave: "salir", titulo: "Salir", detalle: "" }, base, falso().e)).toBe(false);
  });
});

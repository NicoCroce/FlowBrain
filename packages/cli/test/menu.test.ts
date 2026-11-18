import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { asistente } from "../src/asistente.js";
import { ejecutar } from "../src/main.js";
import { accion, contextoMenu, dibujar, elegir, opciones, PROMPT_ANALISIS, siguiente, type ContextoMenu, type Entorno } from "../src/menu.js";

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

const base: ContextoMenu = { proyecto: "/p", registro: null, cerebros: [], faltaIndice: [], faltaAnalisis: [], visor: null, mcp: false, claude: true, git: true, version: "dev" };

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

  it("analizar configurado: indexa lo que falta y abre Claude Code con el análisis completo, en el proyecto", async () => {
    const f = falso();
    const c = { ...base, registro: "/p/.flowbrain", cerebros: ["web"], faltaIndice: ["web"], faltaAnalisis: ["web"] };
    expect(await accion(opciones(c)[1]!, c, f.e)).toBe(true);
    expect(f.corridas).toEqual(["flowbrain brains apply @/p", `claude ${PROMPT_ANALISIS.slice(0, 40)} @/p`]);
    expect(PROMPT_ANALISIS).toMatch(/coverage --guide[\s\S]*evidence --guide[\s\S]*feature --guide/);
  });

  it("el siguiente paso sigue el orden repos → índice → análisis → MCP, y el menú arranca parado en él", async () => {
    const c = { ...base, registro: "/p/.flowbrain", cerebros: ["web", "api"] };
    expect(siguiente(base)?.clave).toBe("configurar");
    expect(siguiente({ ...c, faltaIndice: ["web"], faltaAnalisis: ["web", "api"] })?.clave).toBe("reindexar");
    expect(siguiente({ ...c, faltaAnalisis: ["web", "api"] })).toEqual({ clave: "analizar", motivo: "falta el análisis completo en todos los cerebros" });
    expect(siguiente(c)?.clave).toBe("mcp");
    expect(siguiente({ ...c, mcp: true })).toBeNull();
    const conAnalisis = { ...c, faltaAnalisis: ["api"] };
    expect(dibujar(conAnalisis, opciones(conAnalisis), 0)).toContain("Siguiente paso:");
    expect((await elegir(conAnalisis, opciones(conAnalisis), falso(["enter"]).e)).clave).toBe("analizar");
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

/** Un proyecto con dos subrepos sintéticos: un front y una API. */
async function proyecto(): Promise<string> {
  const p = join(dir, "tienda");
  const w = async (f: string, t: string) => {
    await mkdir(join(p, f, ".."), { recursive: true });
    await writeFile(join(p, f), t);
  };
  await mkdir(join(p, "web/.git"), { recursive: true });
  await mkdir(join(p, "api/.git"), { recursive: true });
  await w("web/package.json", '{ "name": "web", "dependencies": { "react": "18.0.0" } }');
  await w("web/src/main.ts", "export const hola = () => fetch(\"/api/pedidos\");\n");
  await w("api/package.json", '{ "name": "api", "dependencies": { "express": "4.0.0" } }');
  await w("api/src/app.ts", "import express from \"express\";\nconst app = express();\napp.get(\"/api/pedidos\", (_q, r) => r.json([]));\n");
  return p;
}

describe("asistente de un proyecto nuevo", () => {
  /** Entorno de prueba: `setup` no toca la máquina; el resto de flowbrain corre de verdad. */
  function entorno(respuestas: string[]) {
    const f = falso([], respuestas);
    f.e.flowbrain = async (args, cwd) => {
      f.corridas.push(`flowbrain ${args.join(" ")}`);
      return args[0] === "setup" ? { codigo: 0, stdout: "", stderr: "" } : ejecutar(args, { FLOWBRAIN_COMANDO: "flowbrain" }, cwd, async () => "");
    };
    f.e.contexto = (cwd) => contextoMenu(cwd, { hayComando: () => true, mcpConfig: [] });
    return f;
  }

  it("en orden: máquina, repos (confirmados), índice; MCP y análisis solo con un sí", async () => {
    const p = await proyecto();
    // carpeta (Enter), afuera (ninguno), uno por repo, confirmar, MCP no, análisis no, visor no.
    const f = entorno(["", "", "1", "", "n", "n", "n"]);
    await asistente(await f.e.contexto!(p), f.e);
    expect(f.corridas).toEqual(["flowbrain setup", "flowbrain brains apply"]);
    for (const b of ["web", "api"]) expect(existsSync(join(p, ".flowbrain", b, "_build/graph.json"))).toBe(true);
    const texto = f.salida.join("");
    expect(texto).toMatch(/1\. api: express[\s\S]*2\. web: react/);
    expect(texto).toContain("Lo que quedó sin tilde sigue pendiente");
    // Retoma: el proyecto ya está configurado e indexado; lo que sigue es el análisis.
    expect(siguiente(await f.e.contexto!(p))?.clave).toBe("analizar");
  });

  it("deja afuera los repos elegidos y, con un sí, arranca el análisis completo", async () => {
    const p = await proyecto();
    const f = entorno(["", "2", "", "n", "s", "n"]);
    await asistente(await f.e.contexto!(p), f.e);
    expect(existsSync(join(p, ".flowbrain/flowbrain.yaml"))).toBe(true);
    const c = await f.e.contexto!(p);
    // Un solo repo: un cerebro con el nombre del proyecto, sin el repo que se dejó afuera.
    expect(c.cerebros).toEqual(["tienda"]);
    const yaml = readFileSync(join(p, ".flowbrain/flowbrain.yaml"), "utf8");
    expect(yaml).toMatch(/ruta: "\.\.\/api"/);
    expect(yaml).not.toMatch(/ruta: "\.\.\/web"/);
    expect(f.corridas.at(-1)).toBe(`claude ${PROMPT_ANALISIS.slice(0, 40)} @${p}`);
  });

  it("sin código no crea nada: lo dice y espera a que haya código", async () => {
    await writeFile(join(dir, "README.md"), "# idea\n");
    const f = entorno(["", "n"]);
    await asistente(await f.e.contexto!(dir), f.e);
    expect(existsSync(join(dir, ".flowbrain"))).toBe(false);
    expect(f.salida.join("")).toContain("No encontré código");
  });

  it("si no se confirma, no toca nada", async () => {
    const p = await proyecto();
    const f = entorno(["", "", "1", "n"]);
    await asistente(await f.e.contexto!(p), f.e);
    expect(existsSync(join(p, ".flowbrain"))).toBe(false);
  });
});


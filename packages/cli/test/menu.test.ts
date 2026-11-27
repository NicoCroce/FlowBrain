import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { agentesConMcp, partir, refrescarMcp } from "../src/agentes.js";
import { asistente } from "../src/asistente.js";
import { ejecutar } from "../src/main.js";
import { fijarIdioma, idioma } from "../src/idioma.js";
import { accion, contextoMenu, dibujar, elegir, esMasNueva, opciones, PROMPT_ANALISIS, siguiente, type ContextoMenu, type Entorno } from "../src/menu.js";

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

const base: ContextoMenu = { proyecto: "/p", registro: null, cerebros: [], faltaIndice: [], faltaAnalisis: [], visor: null, mcp: false, mcpEn: [], agentes: ["claude"], git: true, version: "dev", nueva: null };

describe("menú", () => {
  it("sin configurar: primero configurar; reindexar, visor y estado no aparecen", () => {
    const ops = opciones(base).map((o) => o.clave);
    expect(ops).toEqual(["configurar", "analizar", "mcp", "actualizar", "idioma", "salir"]);
    expect(opciones(base)[1]!.detalle).toContain("sets it up first");
  });

  it("configurado y con visor: todas las opciones, y el estado en la cabecera", () => {
    const c = { ...base, registro: "/p/.flowbrain", cerebros: ["web", "api"], visor: "/p/.flowbrain/flowbrain.html", mcp: true };
    expect(opciones(c).map((o) => o.clave)).toEqual(["configurar", "analizar", "reindexar", "visor", "estado", "mcp", "actualizar", "idioma", "salir"]);
    const t = dibujar(c, opciones(c), 0);
    expect(t).toContain("2 brains: web, api");
    expect(t).toContain("MCP connected");
  });

  it("detecta el proyecto desde un subdirectorio y lee sus cerebros", async () => {
    await mkdir(join(dir, ".flowbrain"), { recursive: true });
    await writeFile(join(dir, ".flowbrain/flowbrain.yaml"), "version: 1\ncerebros:\n  - nombre: web\n    repos:\n      - ruta: \"../web\"\n");
    await mkdir(join(dir, "web/src"), { recursive: true });
    const c = await contextoMenu(join(dir, "web/src"), { hayComando: () => false, mcpConfig: [] });
    expect(c.proyecto).toBe(dir);
    expect(c.cerebros).toEqual(["web"]);
    expect(c.agentes).toEqual([]);
    expect(opciones(c).find((o) => o.clave === "analizar")!.detalle).toContain("I give you the instructions");
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
    expect(PROMPT_ANALISIS).toMatch(/coverage --guide[\s\S]*evidence --guide[\s\S]*feature --guide[\s\S]*specs --guide/);
  });

  it("el análisis se hace con el agente elegido, o con las instrucciones para pegar en cualquiera", async () => {
    const c = { ...base, registro: "/p/.flowbrain", cerebros: ["web"], faltaAnalisis: ["web"], agentes: ["claude", "codex", "opencode"] as ContextoMenu["agentes"] };
    const analizar = opciones(c)[1]!;
    const codex = falso([], ["2"]);
    await accion(analizar, c, codex.e);
    expect(codex.corridas).toEqual([`codex ${PROMPT_ANALISIS.slice(0, 40)} @/p`]);
    const oc = falso([], ["3"]);
    await accion(analizar, c, oc.e);
    expect(oc.corridas).toEqual([`opencode --prompt ${PROMPT_ANALISIS.slice(0, 31)} @/p`]);
    // "Otro" (y sin ningún agente instalado): no corre nada, imprime el pedido completo.
    for (const [ctx, resp] of [[c, "4"], [{ ...c, agentes: [] }, ""]] as Array<[ContextoMenu, string]>) {
      const otro = falso([], [resp]);
      await accion(analizar, ctx, otro.e);
      expect(otro.corridas).toEqual([]);
      expect(otro.salida.join("")).toContain(PROMPT_ANALISIS);
    }
  });

  it("MCP en Codex corre su comando; en OpenCode, y en otro, muestra qué pegar", async () => {
    const c = { ...base, agentes: ["claude", "codex", "opencode"] as ContextoMenu["agentes"], mcpEn: ["codex"] as ContextoMenu["mcpEn"], mcp: true };
    const mcp = opciones(c).find((o) => o.clave === "mcp")!;
    expect(mcp.detalle).toContain("connected in Codex (OpenAI)");
    const codex = falso([], ["2", "s"]);
    await accion(mcp, c, codex.e);
    // Ya estaba conectado: lo quita y lo vuelve a registrar.
    expect(codex.corridas[0]).toBe("codex mcp remove flowbrain @/p");
    expect(codex.corridas[1]).toMatch(/^sh -c codex mcp add flowbrain -- /);
    const oc = falso([], ["3"]);
    await accion(mcp, c, oc.e);
    expect(oc.corridas).toEqual([]);
    expect(oc.salida.join("")).toMatch(/opencode\.json[\s\S]*"type": "local"[\s\S]*"serve",\s*"--sync"/);
    const otro = falso([], ["4"]);
    await accion(mcp, c, otro.e);
    expect(otro.salida.join("")).toMatch(/Claude Code:[\s\S]*Codex \(OpenAI\):[\s\S]*OpenCode, in[\s\S]*serve --sync {2}\(stdio\)/);
  });

  it("detecta en qué agentes está registrado el MCP y separa el comando en palabras", async () => {
    await mkdir(join(dir, ".codex"), { recursive: true });
    await writeFile(join(dir, ".codex/config.toml"), 'model = "x"\n\n[mcp_servers.flowbrain]\ncommand = "flowbrain"\n');
    await writeFile(join(dir, "opencode.json"), '{ "mcp": { "otro": {}, "flowbrain": { "type": "local" } } }');
    await writeFile(join(dir, "claude.json"), '{ "mcpServers": {} }');
    expect(await agentesConMcp([join(dir, "claude.json"), join(dir, ".codex/config.toml"), join(dir, "opencode.json"), join(dir, "no-existe.json")])).toEqual(["codex", "opencode"]);
    expect(partir(`'/a b/tsx' /c/main.ts`)).toEqual(["/a b/tsx", "/c/main.ts"]);
    expect(partir(`'it'\\''s' x`)).toEqual(["it's", "x"]);
  });

  it("el siguiente paso sigue el orden repos → índice → análisis → MCP, y el menú arranca parado en él", async () => {
    const c = { ...base, registro: "/p/.flowbrain", cerebros: ["web", "api"] };
    expect(siguiente(base)?.clave).toBe("configurar");
    expect(siguiente({ ...c, faltaIndice: ["web"], faltaAnalisis: ["web", "api"] })?.clave).toBe("reindexar");
    expect(siguiente({ ...c, faltaAnalisis: ["web", "api"] })).toEqual({ clave: "analizar", motivo: "full analysis missing in all the brains" });
    expect(siguiente(c)?.clave).toBe("mcp");
    expect(siguiente({ ...c, mcp: true })).toBeNull();
    const conAnalisis = { ...c, faltaAnalisis: ["api"] };
    expect(dibujar(conAnalisis, opciones(conAnalisis), 0)).toContain("Next step:");
    expect((await elegir(conAnalisis, opciones(conAnalisis), falso(["enter"]).e)).clave).toBe("analizar");
  });

  it("conectar el MCP pide confirmación; sin un sí no corre nada", async () => {
    const mcp = opciones(base).find((o) => o.clave === "mcp")!;
    const no = falso([], ["1", "n"]);
    await accion(mcp, base, no.e);
    expect(no.corridas).toEqual([]);
    const si = falso([], ["1", "s"]);
    await accion(mcp, base, si.e);
    expect(si.corridas).toHaveLength(1);
    expect(si.corridas[0]).toMatch(/^sh -c claude mcp add --scope user flowbrain/);
  });

  it("la opción de idioma alterna inglés y castellano, lo guarda, dice dónde y el menú se redibuja en el nuevo idioma", async () => {
    try {
      const guardados: string[] = [];
      const f = falso();
      f.e.guardarIdioma = async (lang) => (guardados.push(lang), "/home/x/.config/flowbrain/config.json");
      const op = opciones(base).find((o) => o.clave === "idioma")!;
      expect(op.titulo).toBe("Language: English · switch to Español");
      expect(await accion(op, base, f.e)).toBe(true);
      expect(idioma()).toBe("es");
      expect(guardados).toEqual(["es"]);
      expect(f.salida.join("")).toContain("Quedó guardado en /home/x/.config/flowbrain/config.json");
      const es = dibujar(base, opciones(base), 0);
      expect(es).toContain("Configurar este proyecto");
      expect(es).toContain("Idioma: castellano · cambiar a English");
      // Y de vuelta; sin dónde guardarlo, lo dice.
      const g = falso();
      g.e.guardarIdioma = async () => null;
      await accion(opciones(base).find((o) => o.clave === "idioma")!, base, g.e);
      expect(idioma()).toBe("en");
      expect(g.salida.join("")).toContain("only for this session");
      expect(dibujar(base, opciones(base), 0)).toContain("Set up / update this project");
    } finally {
      fijarIdioma("en");
    }
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
    expect(texto).toContain("Whatever is left unchecked is still pending");
    // Retoma: el proyecto ya está configurado e indexado; lo que sigue es el análisis.
    expect(siguiente(await f.e.contexto!(p))?.clave).toBe("analizar");
  });

  it("deja afuera los repos elegidos y, con un sí, arranca el análisis completo", async () => {
    const p = await proyecto();
    const f = entorno(["", "2", "", "n", "s", "1", "n"]);
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
    expect(f.salida.join("")).toContain("No code found");
  });

  it("si no se confirma, no toca nada", async () => {
    const p = await proyecto();
    const f = entorno(["", "", "1", "n"]);
    await asistente(await f.e.contexto!(p), f.e);
    expect(existsSync(join(p, ".flowbrain"))).toBe(false);
  });
});


describe("versión nueva y Actualizar FlowBrain", () => {
  it("compara versiones publicadas; un sufijo (-stage) nunca gana", () => {
    expect(esMasNueva("0.1.2", "0.1.1")).toBe(true);
    expect(esMasNueva("0.10.0", "0.9.9")).toBe(true);
    expect(esMasNueva("0.1.1", "0.1.1")).toBe(false);
    expect(esMasNueva("0.1.0", "0.1.1")).toBe(false);
    expect(esMasNueva("0.0.0-stage", "0.1.1")).toBe(false);
    expect(esMasNueva("0.2.0", "dev")).toBe(false);
  });

  it("el menú muestra la versión y recomienda actualizar cuando hay una nueva", () => {
    const c: ContextoMenu = { ...base, version: "0.1.1", nueva: "0.1.2" };
    const ops = opciones(c);
    const texto = dibujar(c, ops, 0);
    expect(texto).toContain("0.1.1");
    expect(texto).toMatch(/New version 0\.1\.2 available.*you have 0\.1\.1.*Update FlowBrain/);
    expect(ops.find((o) => o.clave === "actualizar")?.detalle).toContain("installs 0.1.2");
    expect(dibujar({ ...c, nueva: null }, ops, 0)).not.toContain("New version");
  });

  it("instala la nueva y la deja registrar el MCP con su versión (setup --mcp)", async () => {
    const f = falso([], ["s"]);
    const c: ContextoMenu = { ...base, version: "0.1.1", nueva: "0.1.2" };
    await accion(opciones(c).find((o) => o.clave === "actualizar")!, c, f.e);
    expect(f.corridas).toEqual(["npm install -g @nicocroce/flowbrain@latest @/p", "flowbrain setup --mcp @/p"]);
  });

  it("refrescarMcp registra de nuevo solo donde apunta a otra versión", async () => {
    const cmd = "npx -y @nicocroce/flowbrain@0.1.2";
    const claude = join(dir, "claude.json"), codex = join(dir, "config.toml"), opencode = join(dir, "opencode.json");
    await writeFile(claude, JSON.stringify({ mcpServers: { flowbrain: { command: "npx", args: ["-y", "@nicocroce/flowbrain@0.1.1", "serve", "--sync"] } } }));
    await writeFile(codex, '[mcp_servers.flowbrain]\ncommand = "npx"\nargs = ["-y", "@nicocroce/flowbrain@0.1.2", "serve", "--sync"]\n');
    await writeFile(opencode, JSON.stringify({ mcp: { flowbrain: { type: "local", command: ["npx", "-y", "@nicocroce/flowbrain@0.1.1", "serve", "--sync"] } } }));
    const corridas: string[] = [];
    const lineas = await refrescarMcp(cmd, { configs: { claude, codex, opencode: [opencode] }, correr: (p, a) => (corridas.push(`${p} ${a.join(" ")}`), 0) });
    // Claude Code estaba en la 0.1.1: se quita y se vuelve a agregar; Codex ya estaba en la 0.1.2: no se toca.
    expect(corridas).toEqual(["claude mcp remove --scope user flowbrain", `sh -c claude mcp add --scope user flowbrain -- ${cmd} serve --sync`]);
    expect(lineas.join("\n")).toMatch(/Claude Code registered again/);
    expect(lineas.join("\n")).toMatch(/OpenCode is configured by hand[\s\S]*0\.1\.2/);
  });
});

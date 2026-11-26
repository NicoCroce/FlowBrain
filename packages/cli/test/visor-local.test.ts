import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abrirVisor, type ContextoMenu, type Entorno } from "../src/menu.js";
import { crearServidorVisor, servirVisor, type ServidorVisor } from "../src/servidor-visor.js";
import { cerrarServidor, depsReales, prepararVisor, puertosCandidatos, type DepsVisorLocal } from "../src/visor-local.js";

const ocupado = () => Object.assign(new Error("ocupado"), { code: "EADDRINUSE" });
/** Un servidor de mentira que dice escuchar en `p`. */
const falsoServidor = (p: number, cerrados: number[] = []): ServidorVisor => {
  const s = crearServidorVisor("/x");
  s.url = () => `http://127.0.0.1:${p}/`;
  s.server.close = ((cb?: () => void) => (cerrados.push(p), cb?.(), s.server)) as typeof s.server.close;
  return s;
};
const deps = (d: Partial<DepsVisorLocal>): DepsVisorLocal => ({
  quien: async () => null,
  servir: async (p) => falsoServidor(p),
  pagina: async () => ({ estado: 200 }),
  mismaRuta: (a, b) => a === b,
  ...d,
});

describe("elegir el visor en localhost", () => {
  it("los puertos van desde 4780 y no pasan de 65535", () => {
    expect(puertosCandidatos()).toEqual([4780, 4781, 4782, 4783, 4784, 4785, 4786, 4787, 4788, 4789]);
    expect(puertosCandidatos(65534, 5)).toEqual([65534, 65535]);
  });

  it("reusa un visor de FlowBrain que ya atiende este mismo registro, aunque esté en otro puerto", async () => {
    const levantados: number[] = [];
    const r = await prepararVisor("/p/.flowbrain", deps({
      quien: async (p) => (p === 4780 ? "/otro/.flowbrain" : p === 4782 ? "/p/.flowbrain" : null),
      servir: async (p) => (levantados.push(p), falsoServidor(p)),
    }));
    expect(r).toEqual({ modo: "reusa", url: "http://127.0.0.1:4782/" });
    expect(levantados).toEqual([]);
  });

  it("si el puerto está ocupado prueba el siguiente", async () => {
    const r = await prepararVisor("/p/.flowbrain", deps({ servir: async (p) => (p < 4783 ? Promise.reject(ocupado()) : falsoServidor(p)) }));
    expect(r.modo).toBe("nuevo");
    expect(r.modo === "nuevo" && r.url).toBe("http://127.0.0.1:4783/");
  });

  it("cae al estático y dice por qué: todos ocupados, otro error, o la página que no carga (y cierra el servidor)", async () => {
    expect(await prepararVisor("/p", deps({ servir: async () => Promise.reject(ocupado()) }), { intentos: 3 })).toEqual({
      modo: "estatico",
      motivo: "ports 4780 to 4782 are taken by other programs",
    });
    const e = await prepararVisor("/p", deps({ servir: async () => Promise.reject(Object.assign(new Error("permiso denegado"), { code: "EACCES" })) }));
    expect(e).toEqual({ modo: "estatico", motivo: "the server could not listen on port 4780: permiso denegado" });
    const cerrados: number[] = [];
    const p = await prepararVisor("/p", deps({ servir: async (x) => falsoServidor(x, cerrados), pagina: async () => ({ estado: 409, error: "ningún cerebro está compilado" }) }));
    expect(p).toEqual({ modo: "estatico", motivo: "the server started but the page did not load (409: ningún cerebro está compilado)" });
    expect(cerrados).toEqual([4780]);
  });
});

describe("contra servidores de verdad", () => {
  let dir: string, abiertos: Array<() => Promise<void>>;
  // Puertos altos al azar, para no chocar con un visor real ni con otra prueba.
  const base = 40000 + Math.floor(Math.random() * 20000);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "brain-visor-local-"));
    abiertos = [];
  });
  afterEach(async () => {
    for (const c of abiertos) await c();
    await rm(dir, { recursive: true, force: true });
  });

  it("pregunta por /api/quien: reusa el del mismo registro y no confunde otro programa con un visor", async () => {
    // Otro programa en el primer puerto: responde, pero no es un visor de FlowBrain.
    const otro: Server = createServer((_q, res) => res.writeHead(404).end("no"));
    await new Promise<void>((ok) => otro.listen(base, "127.0.0.1", ok));
    abiertos.push(() => new Promise((ok) => (otro.close(() => ok()), otro.closeAllConnections())));
    const s = await servirVisor(dir, base + 1);
    abiertos.push(() => cerrarServidor(s));
    expect(await prepararVisor(dir, depsReales(dir), { base, intentos: 3 })).toEqual({ modo: "reusa", url: `http://127.0.0.1:${base + 1}/` });
    // Otro registro: no lo reusa; salta los dos ocupados y levanta uno en el tercero, pero sin cerebros la página no carga.
    const otroReg = join(dir, "otro");
    const r = await prepararVisor(otroReg, depsReales(otroReg), { base, intentos: 3 });
    expect(r.modo).toBe("estatico");
    expect(r.modo === "estatico" && r.motivo).toMatch(/^the server started but the page did not load \((400|409|500)/);
  });
});

describe("la opción Abrir el visor del menú", () => {
  const c: ContextoMenu = { proyecto: "/p", registro: "/p/.flowbrain", cerebros: ["web"], faltaIndice: [], faltaAnalisis: [], visor: "/p/.flowbrain/flowbrain.html", mcp: true, mcpEn: [], agentes: [], git: true, version: "dev", nueva: null };
  function entorno(visorLocal: NonNullable<Entorno["visorLocal"]>) {
    const corridas: string[] = [], salida: string[] = [];
    let cortes = 0;
    const e: Entorno = {
      flowbrain: async () => ({ codigo: 0, stdout: "", stderr: "" }),
      correr: async (p, args) => (corridas.push(`${p} ${args.join(" ")}`), 0),
      escribir: (t) => void salida.push(t),
      tecla: async () => "salir",
      preguntar: async () => "",
      limpiar: () => {},
      visorLocal,
      esperarCorte: async () => void cortes++,
    };
    return { e, corridas, texto: () => salida.join(""), cortes: () => cortes };
  }

  it("levanta el servidor, abre la URL, explica Ctrl+C y lo cierra al cortarlo", async () => {
    const cerrados: number[] = [];
    const f = entorno(async () => ({ modo: "nuevo", url: "http://127.0.0.1:4781/", servidor: falsoServidor(4781, cerrados) }));
    await abrirVisor(c, f.e);
    expect(f.corridas).toEqual([expect.stringMatching(/ http:\/\/127\.0\.0\.1:4781\/$/)]);
    expect(f.texto()).toContain("Editable viewer at http://127.0.0.1:4781/");
    expect(f.texto()).toContain("Ctrl+C stops it and you go back to the menu");
    expect(f.cortes()).toBe(1);
    expect(cerrados).toEqual([4781]);
  });

  it("si ya hay uno para este registro abre esa URL y no espera nada", async () => {
    const f = entorno(async () => ({ modo: "reusa", url: "http://127.0.0.1:4780/" }));
    await abrirVisor(c, f.e);
    expect(f.corridas).toEqual([expect.stringMatching(/ http:\/\/127\.0\.0\.1:4780\/$/)]);
    expect(f.texto()).toContain("A FlowBrain viewer was already running");
    expect(f.cortes()).toBe(0);
  });

  it("sin servidor abre el estático y dice el motivo; sin estático, cómo generarlo", async () => {
    const f = entorno(async () => ({ modo: "estatico", motivo: "ports 4780 to 4789 are taken by other programs" }));
    await abrirVisor(c, f.e);
    expect(f.corridas).toEqual([expect.stringMatching(/flowbrain\.html$/)]);
    expect(f.texto()).toContain("Could not open the viewer on localhost: ports 4780 to 4789 are taken");
    expect(f.texto()).toContain("does not save fixes");
    const g = entorno(async () => Promise.reject(new Error("se rompió")));
    await abrirVisor({ ...c, visor: null }, g.e);
    expect(g.corridas).toEqual([]);
    expect(g.texto()).toContain("Could not open the viewer on localhost: se rompió");
    expect(g.texto()).toContain("pick Re-index");
  });
});

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarContexto, fidelidad, leerRegistro } from "@flowbrain/core";
import { crearAgente } from "../src/agente.js";
import { rutaDentro } from "../src/edicion.js";
import { ejecutar } from "../src/main.js";
import { crearServidorVisor, type ServidorVisor } from "../src/servidor-visor.js";

/**
 * Un back mínimo con tres faltas conocidas en `src/avisos.ts`: no es de ninguna funcionalidad, tiene una llamada sin
 * resolver (L4) y una llamada HTTP sin ruta (L5). Se corrigen las tres por el servidor del visor y se mide de nuevo.
 */
let dir: string, reg: string, s: ServidorVisor;
const R = "repo-tienda-api", AVISOS = `${R}:src/avisos.ts`;
const w = async (ruta: string, lineas: string[]) => {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), lineas.join("\n") + "\n");
};

interface Respuesta { estado: number; cuerpo: string; json: Record<string, unknown> }
function pedir(metodo: string, ruta: string, opciones: { cuerpo?: unknown; headers?: Record<string, string>; token?: string | null } = {}): Promise<Respuesta> {
  const puerto = (s.server.address() as { port: number }).port;
  const datos = opciones.cuerpo === undefined ? null : typeof opciones.cuerpo === "string" ? opciones.cuerpo : JSON.stringify(opciones.cuerpo);
  const token = opciones.token === undefined ? s.token : opciones.token;
  return new Promise((ok, mal) => {
    const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { host: `127.0.0.1:${puerto}`, ...(datos !== null ? { "content-type": "application/json" } : {}), ...(token ? { "x-flowbrain-token": token } : {}), ...opciones.headers } }, (res) => {
      let cuerpo = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (cuerpo += c));
      res.on("end", () => {
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(cuerpo) as Record<string, unknown>; } catch { /* html */ }
        ok({ estado: res.statusCode ?? 0, cuerpo, json });
      });
    });
    req.on("error", mal);
    req.end(datos ?? undefined);
  });
}
const editar = (cuerpo: Record<string, unknown>) => pedir("POST", "/api/editar", { cuerpo: { cerebro: "tienda", archivo: AVISOS, ...cuerpo } });
const medir = async () => fidelidad(await cargarContexto(join(reg, "tienda")), { archivo: "src/avisos.ts" }) as unknown as { puntaje: number; faltas: string[]; funcionalidades: string[] };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-visor-"));
  reg = join(dir, "registro");
  await mkdir(reg, { recursive: true });
  await w("repos/tienda-api/package.json", ['{ "name": "tienda-api", "dependencies": { "express": "4" } }']);
  await w("repos/tienda-api/src/main.ts", [
    'import { Router, type Request, type Response } from "express";',
    'import { avisar } from "./avisos";',
    "export async function crearPedido(req: Request, res: Response) {",
    "  await avisar(req.body);",
    "  res.status(201).end();",
    "}",
    "export const router = Router();",
    'router.post("/pedidos", crearPedido);',
  ]);
  await w("repos/tienda-api/src/avisos.ts", [
    "const destinos: Record<string, string> = {};",
    "export async function avisar(pedido: { canal: string }) {",
    "  const servicio: any = pedido;",
    "  servicio.registrar(pedido);",
    '  await fetch(destinos[pedido.canal]!, { method: "POST" });',
    "}",
    "export function registrar(pedido: unknown) {",
    "  return pedido;",
    "}",
  ]);
  await writeFile(join(reg, "flowbrain.yaml"), ["version: 1", "cerebros:", "  - nombre: tienda", "    repos: [{ ruta: ../repos/tienda-api }]", ""].join("\n"));
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
  await writeFile(join(reg, "tienda/product/feat-pedidos.md"), ["---", "id: feat-pedidos", "tipo: feat", 'nombre: "Pedidos"', 'resumen: "Alta de pedidos." # lo que ve el cliente', "codigo:", `  - ${R}:src/main.ts`, "---", "# Pedidos", ""].join("\n"));
  expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
  // Sin Claude Code de verdad: el agente se prueba en agente.test.ts.
  s = crearServidorVisor(reg, { agente: crearAgente(() => leerRegistro(reg), { comando: join(dir, "sin-claude") }) });
  await new Promise<void>((ok) => s.server.listen(0, "127.0.0.1", ok));
}, 60_000);
afterAll(async () => {
  await new Promise((ok) => s.server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

describe("flowbrain viewer --serve", () => {
  it("sirve el visor con el token de edición adentro, y sin nada de afuera", async () => {
    const r = await pedir("GET", "/", { token: null });
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toContain(`window.FLOWBRAIN_EDICION={"token":"${s.token}","sinAplicar":[],"agente":{"noDisponible":`);
    expect(r.cuerpo).not.toMatch(/<script[^>]+src=|<link[^>]+href="(?!data:)/);
    // El archivo en disco sigue siendo de solo lectura: el token no se escribe nunca.
    expect(await readFile(join(reg, "flowbrain.html"), "utf8")).not.toContain("FLOWBRAIN_EDICION=");
  });

  it("no atiende a otro host, a otro origen ni a quien no trae el token", async () => {
    const puerto = (s.server.address() as { port: number }).port;
    expect((await pedir("GET", "/", { headers: { host: "otro.example" } })).estado).toBe(403);
    expect((await pedir("GET", "/", { headers: { host: `otro.example:${puerto}` } })).estado).toBe(403);
    expect((await editar({ tipo: "funcionalidad", funcionalidad: "feat-pedidos" }).then(() => pedir("POST", "/api/editar", { cuerpo: {}, headers: { origin: "http://otro.example" } }))).estado).toBe(403);
    expect((await pedir("GET", `/api/archivo?cerebro=tienda&archivo=${encodeURIComponent(AVISOS)}`, { token: null })).estado).toBe(403);
    expect((await pedir("POST", "/api/editar", { cuerpo: {}, token: "x".repeat(64) })).estado).toBe(403);
    expect((await pedir("POST", "/api/editar", { cuerpo: "no es json" })).estado).toBe(400);
    expect((await pedir("GET", "/flowbrain.yaml")).estado).toBe(404);
  });

  it("sumar un archivo a una funcionalidad escribe su página y recompila: deja de estar sin asociar", async () => {
    // El pedido de arriba ya lo sumó: la página quedó con la entrada y con su comentario.
    const pagina = await readFile(join(reg, "tienda/product/feat-pedidos.md"), "utf8");
    expect(pagina).toContain(`  - ${R}:src/main.ts\n  - ${AVISOS}\n---\n# Pedidos`);
    expect(pagina).toContain("# lo que ve el cliente");
    const m = await medir();
    expect(m.funcionalidades).toEqual(["feat-pedidos"]);
    // Tener funcionalidad no cambia el puntaje: siguen faltando sus dos llamadas.
    expect(m.puntaje).toBe(0);
    expect((await ejecutar(["unassigned", "--root", join(reg, "tienda")], {}, dir)).stdout).not.toContain("src/avisos.ts");
    // Repetirlo no escribe nada.
    expect((await editar({ tipo: "funcionalidad", funcionalidad: "feat-pedidos" })).json).toMatchObject({ cambio: false, faltaReindexar: false });
  });

  it("dice qué se puede corregir en un archivo", async () => {
    const r = await pedir("GET", `/api/archivo?cerebro=tienda&archivo=${encodeURIComponent(AVISOS)}`);
    expect(r.json).toMatchObject({
      cerebro: "tienda",
      entradas: [AVISOS, `${R}:src`],
      funcionalidades: [{ id: "feat-pedidos", nombre: "Pedidos" }],
      dueñas: ["feat-pedidos"],
      http: [{ linea: 5, metodo: "POST", desde: "avisar" }],
      llamadas: [{ linea: 4, desde: "avisar", llamada: "servicio.registrar" }],
    });
    expect((await pedir("GET", "/api/archivo?cerebro=tienda&archivo=repo-x:no/existe.ts")).estado).toBe(404);
  });

  it("con contenido=1 devuelve el código del archivo, leído del clon indexado («Ver código» de Sin asociar)", async () => {
    const r = await pedir("GET", `/api/archivo?cerebro=tienda&archivo=${encodeURIComponent(`${R}:src/main.ts`)}&contenido=1`);
    expect(r.json).toMatchObject({ cerebro: "tienda", archivo: `${R}:src/main.ts`, repo: R, ruta: "src/main.ts" });
    expect((r.json["lineas"] as string[])[0]).toBe('import { Router, type Request, type Response } from "express";');
    expect(r.json["lineas"]).toHaveLength(8);
    expect(r.json["recortado"]).toBeUndefined();
    // Solo archivos del índice, y con el token de la sesión.
    expect((await pedir("GET", "/api/archivo?cerebro=tienda&archivo=repo-x:no/existe.ts&contenido=1")).estado).toBe(404);
    expect((await pedir("GET", `/api/archivo?cerebro=tienda&archivo=${encodeURIComponent(`${R}:src/main.ts`)}&contenido=1`, { token: null })).estado).toBe(403);
  });

  it("declarar las llamadas escribe calls.yaml; entran al índice al reindexar y el archivo llega a 100", async () => {
    const http = await editar({ tipo: "http", linea: 5, metodo: "post", ruta: "/avisos" });
    expect(http.json).toMatchObject({ escrito: "tienda/calls.yaml", cambio: true, faltaReindexar: true, sinAplicar: ["tienda"] });
    expect((await editar({ tipo: "llamada", linea: 4, hacia: `${AVISOS}#registrar` })).json).toMatchObject({ cambio: true });
    const calls = await readFile(join(reg, "tienda/calls.yaml"), "utf8");
    expect(calls).toContain(`desde: "${AVISOS}#avisar"`);
    expect(calls).toContain('ruta: "/avisos"');
    expect(calls).toContain(`hacia: "${AVISOS}#registrar"`);
    // Guardado, pero todavía no medido: lo dice la página al recargar.
    expect((await pedir("GET", "/")).cuerpo).toContain('"sinAplicar":["tienda"]');
    expect((await medir()).puntaje).toBe(0);
    const ap = await pedir("POST", "/api/aplicar", { cuerpo: { cerebro: "tienda" } });
    expect(ap.json).toMatchObject({ cerebro: "tienda", errores: [], sinAplicar: [] });
    expect(await medir()).toMatchObject({ puntaje: 100, faltas: [] });
  }, 60_000);

  it("rechaza lo que no puede comprobar contra el índice", async () => {
    const mal = async (cuerpo: Record<string, unknown>) => (await editar(cuerpo)).estado;
    expect(await mal({ tipo: "http", linea: 8, metodo: "GET", ruta: "/x" })).toBe(400); // ahí no hay una llamada HTTP sin ruta
    expect(await mal({ tipo: "http", linea: 5, metodo: "BORRAR", ruta: "/x" })).toBe(400);
    expect(await mal({ tipo: "http", linea: 5, metodo: "GET", ruta: "sin-barra" })).toBe(400);
    expect(await mal({ tipo: "llamada", linea: 4, hacia: "repo-otro:src/x.ts#f" })).toBe(400);
    expect(await mal({ tipo: "funcionalidad", funcionalidad: "feat-pedidos", entrada: `${R}:src/otra-carpeta` })).toBe(400);
    expect(await mal({ tipo: "funcionalidad", funcionalidad: "feat-no-existe" })).toBe(404);
    expect(await mal({ tipo: "borrar-todo" })).toBe(400);
    expect((await pedir("POST", "/api/editar", { cuerpo: { cerebro: "no-existe", archivo: AVISOS, tipo: "http" } })).estado).toBe(404);
  });

  it("confirma una especificación: cambia el estado en la página y el cerebro queda recompilado", async () => {
    const ruta = join(reg, "tienda/product/feat-pedidos.md");
    const previa = await readFile(ruta, "utf8");
    await writeFile(ruta, previa.replace("\n---\n# Pedidos", "\nespecificaciones:\n  - id: alta\n    texto: Se puede dar de alta un pedido.\n    tipo: producto\n    archivos: [" + R + ":src/main.ts]\n---\n# Pedidos"));
    expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
    const estado = async () => ((await ejecutar(["specs", "pedidos", "--root", join(reg, "tienda")], {}, dir)).stdout.match(/"estado": "(\w+)"/) ?? [])[1];
    expect(await estado()).toBe("propuesta");
    const confirmar = (cuerpo: Record<string, unknown>) => pedir("POST", "/api/editar", { cuerpo: { cerebro: "tienda", tipo: "especificacion", funcionalidad: "feat-pedidos", id: "alta", estado: "confirmada", ...cuerpo } });
    const r = await confirmar({});
    expect(r.estado).toBe(200);
    expect(r.json).toMatchObject({ escrito: "tienda/product/feat-pedidos.md", cambio: true, faltaReindexar: false });
    expect(await readFile(ruta, "utf8")).toContain("    tipo: producto\n    archivos: [" + R + ":src/main.ts]\n    estado: confirmada\n");
    expect(await estado()).toBe("confirmada");
    expect((await confirmar({})).json).toMatchObject({ cambio: false });
    expect((await confirmar({ id: "no-existe" })).estado).toBe(404);
    expect((await confirmar({ estado: "lista" })).estado).toBe(400);
    expect((await confirmar({ funcionalidad: "feat-no-existe" })).estado).toBe(404);
    expect((await confirmar({ estado: "propuesta" })).json).toMatchObject({ cambio: true });
  }, 60_000);

  it("marca un caso de uso como mal: escribe problema en la página, el agente lo ve y vacío lo saca", async () => {
    const ruta = join(reg, "tienda/product/feat-pedidos.md");
    const previa = await readFile(ruta, "utf8");
    if (!previa.includes("casos:")) await writeFile(ruta, previa.replace("\n---\n# Pedidos", "\ncasos:\n  - id: dar-de-alta\n    nombre: Dar de alta un pedido\n    especificaciones: [alta]\n---\n# Pedidos"));
    expect((await ejecutar(["brains", "apply", "--root", reg], {}, dir)).codigo).toBe(0);
    const marcar = (cuerpo: Record<string, unknown>) => pedir("POST", "/api/editar", { cuerpo: { cerebro: "tienda", tipo: "caso", funcionalidad: "feat-pedidos", id: "dar-de-alta", problema: "falta pedir el domicilio", ...cuerpo } });
    const r = await marcar({});
    expect(r.estado).toBe(200);
    expect(r.json).toMatchObject({ escrito: "tienda/product/feat-pedidos.md", cambio: true });
    expect(await readFile(ruta, "utf8")).toContain('    problema: "falta pedir el domicilio"\n');
    const specs = (await ejecutar(["specs", "pedidos", "--problems", "--root", join(reg, "tienda")], {}, dir)).stdout;
    expect(specs).toContain('"problema": "falta pedir el domicilio"');
    expect((await marcar({ id: "no-existe" })).estado).toBe(404);
    expect((await marcar({ problema: 3 })).estado).toBe(400);
    expect((await marcar({ problema: null })).json).toMatchObject({ cambio: true });
    expect(await readFile(ruta, "utf8")).not.toContain("problema");
  }, 60_000);

  it("No necesita test guarda el motivo en la especificación y deja de contar como sin test", async () => {
    const ruta = join(reg, "tienda/product/feat-pedidos.md");
    const poner = (motivo: unknown) => pedir("POST", "/api/editar", { cuerpo: { cerebro: "tienda", tipo: "manual", funcionalidad: "feat-pedidos", id: "alta", motivo } });
    const r = await poner("se prueba a mano");
    expect(r.estado).toBe(200);
    expect(r.json).toMatchObject({ cambio: true });
    expect(await readFile(ruta, "utf8")).toContain('    manual: "se prueba a mano"\n');
    const specs = (await ejecutar(["specs", "pedidos", "--root", join(reg, "tienda")], {}, dir)).stdout;
    expect(specs).toContain('"manual": "se prueba a mano"');
    expect((await poner(3)).estado).toBe(400);
    expect((await poner(null)).json).toMatchObject({ cambio: true });
    expect(await readFile(ruta, "utf8")).not.toContain("manual:");
  }, 60_000);

  it("No es de producto: escribe not-product.yaml, recompila (el visor y sin_asociar lo cuentan) y se deshace", async () => {
    const ruta = join(reg, "tienda/not-product.yaml");
    const marcar = (cuerpo: Record<string, unknown>) => pedir("POST", "/api/editar", { cuerpo: { cerebro: "tienda", tipo: "no_producto", archivo: AVISOS, ...cuerpo } });
    // Solo el archivo o una carpeta que lo contiene, con un motivo conocido.
    expect((await marcar({ entrada: `${R}:otra`, motivo: "script" })).estado).toBe(400);
    expect((await marcar({ entrada: `${R}:src`, motivo: "porque sí" })).estado).toBe(400);
    expect((await marcar({ entrada: `${R}:src`, motivo: 3 })).estado).toBe(400);
    expect((await marcar({ archivo: `${R}:no-existe.ts`, entrada: `${R}:no-existe.ts`, motivo: "otro" })).estado).toBe(404);
    const r = await marcar({ entrada: `${R}:src`, motivo: "config" });
    expect(r.estado).toBe(200);
    expect(r.json).toMatchObject({ cambio: true, escrito: "tienda/not-product.yaml", faltaReindexar: false });
    expect(await readFile(ruta, "utf8")).toContain(`  - entrada: "${R}:src"\n    motivo: config\n    origen: persona\n`);
    // El contexto de disco y el visor recompilado traen la marca (src/ ya tiene dueño: no tapa ningún archivo sin asociar).
    const q = JSON.parse((await ejecutar(["unassigned", "--root", join(reg, "tienda")], {}, dir)).stdout) as { ignorados: number; noProducto: unknown[] };
    expect(q.noProducto).toEqual([{ entrada: `${R}:src`, motivo: "config", archivos: 0 }]);
    expect(q.ignorados).toBe(0);
    expect(await readFile(join(reg, "tienda/_build/viewer.html"), "utf8")).toContain(`"noProducto":[{"e":"${R}:src","m":"config","n":0}]`);
    expect((await marcar({ entrada: `${R}:src`, motivo: "config" })).json).toMatchObject({ cambio: false });
    // Deshacer: con motivo nulo, sin archivo.
    const d = await pedir("POST", "/api/editar", { cuerpo: { cerebro: "tienda", tipo: "no_producto", entrada: `${R}:src`, motivo: null } });
    expect(d.json).toMatchObject({ cambio: true });
    expect(await readFile(ruta, "utf8")).not.toContain("entrada:");
    expect(await readFile(join(reg, "tienda/_build/viewer.html"), "utf8")).toContain('"noProducto":[]');
  }, 60_000);

  it("asocia código compartido a una librería: escribe el codigo de su página lib", async () => {
    const { compileDirConVisor } = await import("@flowbrain/viewer");
    const ruta = join(reg, "tienda/technology/lib-comun.md");
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, ["---", "id: lib-comun", "tipo: lib", 'nombre: "Común"', 'resumen: "Código que usan varias funcionalidades."', "---", "# Común", ""].join("\n"));
    await compileDirConVisor(join(reg, "tienda"));
    const r = await pedir("POST", "/api/editar", { cuerpo: { cerebro: "tienda", tipo: "funcionalidad", archivo: AVISOS, funcionalidad: "lib-comun" } });
    expect(r.estado).toBe(200);
    expect(r.json).toMatchObject({ cambio: true, escrito: "tienda/technology/lib-comun.md" });
    expect(await readFile(ruta, "utf8")).toContain(`codigo:\n  - ${AVISOS}\n---`);
    // Otro tipo de página no: solo funcionalidades y librerías declaran código.
    expect((await pedir("POST", "/api/editar", { cuerpo: { cerebro: "tienda", tipo: "funcionalidad", archivo: AVISOS, funcionalidad: R } })).estado).toBe(404);
  }, 60_000);

  it("nunca escribe fuera de la carpeta del cerebro", async () => {
    const base = join(reg, "tienda");
    await expect(rutaDentro(base, "../flowbrain.yaml")).rejects.toThrow(/leaves the brain folder/);
    await expect(rutaDentro(base, "/etc/hosts")).rejects.toThrow(/leaves the brain folder/);
    // Una carpeta del cerebro que en realidad es un enlace hacia afuera tampoco pasa.
    await symlink(dir, join(base, "afuera"));
    await expect(rutaDentro(base, "afuera/nota.md")).rejects.toThrow(/leaves the brain folder/);
    expect(await rutaDentro(base, "calls.yaml")).toMatch(/tienda\/calls\.yaml$/);
  });
});

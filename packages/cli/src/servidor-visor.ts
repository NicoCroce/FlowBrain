import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConsultaError, leerRegistro, type Registro } from "@flowbrain/core";
import { aplicarCerebro, htmlDelVisor } from "./cerebros.js";
import { crearAgente, esTipoDePagina, TIPOS_DE_PEDIDO, type Agente, type ArchivoDePedido, type ItemDePagina, type ReglaDePedido, type TipoDePedido } from "./agente.js";
import { codigoDeArchivo, detalleDeArchivo, editar, type Edicion } from "./edicion.js";
import { L } from "./idioma.js";
import { VERSION } from "./init.js";

/**
 * `flowbrain viewer --serve`: el visor servido desde esta máquina, con edición. El archivo `flowbrain.html` es estático
 * y no puede guardar nada; este servidor entrega la misma página y, además, recibe las correcciones que se hacen desde
 * la pantalla Fidelidad y las escribe en los archivos del cerebro.
 *
 * Escribe en disco, así que se cuida de quién le habla:
 * - escucha solo en `127.0.0.1`;
 * - cada pedido tiene que venir a `127.0.0.1` o `localhost` con el puerto propio (una página de otro sitio que apunte un
 *   nombre suyo a esta máquina no pasa), y si trae `Origin`, tiene que ser el propio;
 * - todo lo que no es la página pide un token que se genera al arrancar y solo viaja dentro de la página servida.
 */

export const PUERTO_VISOR = 4780;

/**
 * Qué código atiende este visor. El menú reusa un visor ya abierto solo si su huella es la misma: uno levantado antes
 * de actualizar FlowBrain sigue sirviendo la pantalla vieja. Publicado es la versión; en desarrollo (`dev`), un hash
 * de las fechas y tamaños de los fuentes de `packages/` (cambia con cada edición o `git pull`).
 */
export const HUELLA: string = VERSION !== "dev" ? VERSION : huellaDev();

function huellaDev(): string {
  const h = createHash("sha1");
  const paquetes = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const recorrer = (d: string): void => {
    let entradas: string[];
    try {
      entradas = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const n of entradas) {
      const f = join(d, n);
      const st = statSync(f, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) recorrer(f);
      else if (n.endsWith(".ts")) h.update(`${f}:${st.mtimeMs}:${st.size}\n`);
    }
  };
  try {
    for (const p of readdirSync(paquetes).sort()) recorrer(join(paquetes, p, "src"));
  } catch {
    return "dev";
  }
  return "dev-" + h.digest("hex").slice(0, 12);
}

/** La ruta sin symlinks, para comparar el registro de dos servidores. */
export function rutaReal(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}
const MAX_CUERPO = 64 * 1024;
const MARCA_DATOS = '<script type="application/json" id="datos">';

export interface ServidorVisor {
  server: Server;
  token: string;
  /** `http://127.0.0.1:<puerto>/` una vez que escucha. */
  url(): string;
}

class ErrorHttp extends Error {
  constructor(readonly estado: number, mensaje: string) {
    super(mensaje);
  }
}

async function cuerpoJson(req: IncomingMessage, maximo = MAX_CUERPO): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new ErrorHttp(415, "the body must be application/json");
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > maximo) throw new ErrorHttp(413, "the request is too large");
    partes.push(p as Buffer);
  }
  try {
    const j: unknown = JSON.parse(Buffer.concat(partes).toString("utf8"));
    if (j === null || typeof j !== "object" || Array.isArray(j)) throw new Error("not an object");
    return j as Record<string, unknown>;
  } catch {
    throw new ErrorHttp(400, "the body is not a valid JSON object");
  }
}

/** El servidor, sin escuchar todavía. `carpeta` es la del registro (`.flowbrain`). */
export function crearServidorVisor(carpeta: string, opciones: { token?: string; agente?: Agente } = {}): ServidorVisor {
  const token = opciones.token ?? randomBytes(32).toString("hex");
  const carpetaReal = rutaReal(carpeta);
  /** Cerebros con declaraciones en `calls.yaml` que todavía no entraron al índice. */
  const sinAplicar = new Set<string>();
  // Las escrituras van de a una: dos ediciones seguidas del mismo archivo no se pisan.
  let cola: Promise<unknown> = Promise.resolve();
  const enCola = <T>(f: () => Promise<T>): Promise<T> => {
    const r = cola.then(f, f);
    cola = r.catch(() => undefined);
    return r;
  };
  // Los pedidos que la página le manda al agente (pantallas Especificaciones y Sin asociar). Lo que el agente resuelve se anota por
  // la misma cola de ediciones, y al terminar un lote se actualiza el índice del cerebro.
  const agente = opciones.agente ?? crearAgente(() => leerRegistro(carpeta), {
    aplicar: async (ed) => enCola(async () => editar(await leerRegistro(carpeta), ed)),
    reindexar: async (nombre) => {
      await enCola(async () => {
        const c = (await leerRegistro(carpeta)).cerebro(nombre);
        if (c) {
          await aplicarCerebro(c);
          sinAplicar.delete(nombre);
        }
      });
    },
  });
  const puerto = () => (server.address() as { port: number } | null)?.port ?? 0;
  const propios = () => new Set([`127.0.0.1:${puerto()}`, `localhost:${puerto()}`]);

  const tokenValido = (req: IncomingMessage) => {
    const t = req.headers["x-flowbrain-token"];
    if (typeof t !== "string" || t.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(t), Buffer.from(token));
  };

  async function atender(req: IncomingMessage, url: URL, registro: Registro): Promise<{ estado?: number; html?: string; json?: unknown }> {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await htmlDelVisor(registro);
      if (html === null) throw new ErrorHttp(409, "no brain is compiled: run flowbrain brains apply");
      const edicion = JSON.stringify({ token, sinAplicar: [...sinAplicar].sort(), agente: { noDisponible: agente.noDisponible(), proveedores: agente.proveedores() } }).replace(/</g, "\\u003c");
      return { html: html.replace(MARCA_DATOS, `<script>window.FLOWBRAIN_EDICION=${edicion};</script>\n${MARCA_DATOS}`) };
    }
    if (!url.pathname.startsWith("/api/")) throw new ErrorHttp(404, "not found");
    if (!tokenValido(req)) throw new ErrorHttp(403, "the edit token is missing or is not this session's: reload the page");
    if (req.method === "GET" && url.pathname === "/api/archivo") {
      // Con contenido=1, el código del archivo («Ver código» de Sin asociar); sin él, lo que se puede corregir (Fidelidad).
      if (url.searchParams.get("contenido") === "1") return { json: await codigoDeArchivo(registro, url.searchParams.get("cerebro"), url.searchParams.get("archivo")) };
      return { json: await detalleDeArchivo(registro, url.searchParams.get("cerebro"), url.searchParams.get("archivo")) };
    }
    if (req.method === "POST" && url.pathname === "/api/editar") {
      const ed = (await cuerpoJson(req)) as unknown as Edicion;
      return {
        json: await enCola(async () => {
          const r = await editar(registro, ed);
          if (r.faltaReindexar) sinAplicar.add(ed.cerebro);
          return { ...r, sinAplicar: [...sinAplicar].sort() };
        }),
      };
    }
    if (req.method === "GET" && url.pathname === "/api/agente") return { json: { noDisponible: agente.noDisponible(), proveedores: agente.proveedores(), trabajos: agente.lista(), lotes: agente.lotes() } };
    if (req.method === "POST" && url.pathname === "/api/agente/lote") {
      // Un lote: reglas a testear (Especificaciones, `tipo` test o sin tipo), archivos a asociar (Sin asociar) o
      // funcionalidades, casos y reglas a agrupar, escribir o corregir (Especificaciones). Todos con los mismos límites:
      // hasta 3000 y 2 MB.
      const b = await cuerpoJson(req, 2 * 1024 * 1024);
      const tipo = b["tipo"] ?? "test", proveedor = b["proveedor"], modelo = b["modelo"];
      if (tipo !== "test" && tipo !== "asociar" && !esTipoDePagina(tipo)) throw new ErrorHttp(400, `unknown batch type: ${String(tipo)}`);
      if ((proveedor !== undefined && typeof proveedor !== "string") || (modelo !== undefined && typeof modelo !== "string")) throw new ErrorHttp(400, "proveedor and modelo must be text");
      const elegido = { ...(proveedor ? { proveedor } : {}), ...(modelo ? { modelo } : {}) };
      if (tipo === "asociar") {
        const archivos = b["archivos"];
        if (!Array.isArray(archivos) || !archivos.length || archivos.length > 3000) throw new ErrorHttp(400, "archivos must be a list of 1 to 3000 files");
        const vistos = new Set<string>();
        const validos: ArchivoDePedido[] = archivos.map((x: Record<string, unknown>) => {
          const { cerebro, archivo, linea } = x ?? {};
          // `repo-x:ruta`, de una línea: el repo sale de ahí y arma las tandas.
          if (typeof cerebro !== "string" || !registro.cerebro(cerebro) || typeof archivo !== "string" || !/^[^:\s]+:[^\n]+$/.test(archivo) || archivo.length > 1000 || typeof linea !== "string" || !linea.trim() || linea.length > 4000) throw new ErrorHttp(400, `invalid file: ${JSON.stringify(x).slice(0, 160)}`);
          if (vistos.has(`${cerebro}|${archivo}`)) throw new ErrorHttp(400, `repeated file: ${cerebro} ${archivo}`);
          vistos.add(`${cerebro}|${archivo}`);
          return { cerebro, archivo, linea };
        });
        const no = agente.noDisponible();
        if (no) throw new ErrorHttp(409, no);
        return { json: agente.encolarLote({ tipo: "asociar", archivos: validos, ...elegido }) };
      }
      if (esTipoDePagina(tipo)) {
        const items = b["items"];
        if (!Array.isArray(items) || !items.length || items.length > 3000) throw new ErrorHttp(400, "items must be a list of 1 to 3000 items");
        const vistos = new Set<string>();
        const texto = (v: unknown) => typeof v === "string" && /^[^\s|]{1,200}$/.test(v);
        const validos: ItemDePagina[] = items.map((x: Record<string, unknown>) => {
          const { cerebro, funcionalidad, caso, regla, linea } = x ?? {};
          // agrupar y escribir: una funcionalidad. corregir: un caso marcado o una regla, de una funcionalidad (uno de los dos).
          const forma = tipo === "corregir" ? (caso === undefined) !== (regla === undefined) && (caso === undefined || texto(caso)) && (regla === undefined || texto(regla)) : caso === undefined && regla === undefined;
          if (typeof cerebro !== "string" || !registro.cerebro(cerebro) || !texto(funcionalidad) || !forma || typeof linea !== "string" || !linea.trim() || linea.length > 4000) throw new ErrorHttp(400, `invalid item: ${JSON.stringify(x).slice(0, 160)}`);
          const k = `${cerebro}|${String(funcionalidad)}|${String(caso ?? "")}|${String(regla ?? "")}`;
          if (vistos.has(k)) throw new ErrorHttp(400, `repeated item: ${k}`);
          vistos.add(k);
          return { cerebro, funcionalidad: funcionalidad as string, ...(typeof caso === "string" ? { caso } : {}), ...(typeof regla === "string" ? { regla } : {}), linea };
        });
        const no = agente.noDisponible();
        if (no) throw new ErrorHttp(409, no);
        return { json: agente.encolarLote({ tipo, items: validos, ...elegido }) };
      }
      const reglas = b["reglas"];
      if (!Array.isArray(reglas) || !reglas.length || reglas.length > 3000) throw new ErrorHttp(400, "reglas must be a list of 1 to 3000 rules");
      const validas: ReglaDePedido[] = reglas.map((x: Record<string, unknown>) => {
        const { cerebro, funcionalidad, regla, repo, linea } = x ?? {};
        if (typeof cerebro !== "string" || !registro.cerebro(cerebro) || typeof funcionalidad !== "string" || typeof regla !== "string" || typeof linea !== "string" || !linea.trim() || linea.length > 4000 || (repo !== null && repo !== undefined && typeof repo !== "string")) throw new ErrorHttp(400, `invalid rule: ${JSON.stringify(x).slice(0, 160)}`);
        return { cerebro, funcionalidad, regla, repo: typeof repo === "string" ? repo : null, linea };
      });
      const no = agente.noDisponible();
      if (no) throw new ErrorHttp(409, no);
      return { json: agente.encolarLote({ reglas: validas, ...elegido }) };
    }
    if (req.method === "POST" && url.pathname === "/api/agente/lote/cancelar") {
      const { id } = await cuerpoJson(req);
      const ts = typeof id === "string" ? agente.cancelarLote(id) : null;
      if (!ts) throw new ErrorHttp(404, `no such batch: ${String(id)}`);
      return { json: { trabajos: ts } };
    }
    if (req.method === "POST" && url.pathname === "/api/agente") {
      const b = await cuerpoJson(req);
      const tipo = b["tipo"], pedido = b["pedido"], etiqueta = b["etiqueta"], cerebros = b["cerebros"], proveedor = b["proveedor"], modelo = b["modelo"];
      if (!TIPOS_DE_PEDIDO.includes(tipo as TipoDePedido)) throw new ErrorHttp(400, `unknown request type: ${String(tipo)}`);
      if (typeof pedido !== "string" || !pedido.trim() || pedido.length > 40_000) throw new ErrorHttp(400, "the request is missing, or too long");
      if (!Array.isArray(cerebros) || cerebros.some((c) => typeof c !== "string" || !registro.cerebro(c))) throw new ErrorHttp(400, "cerebros must be a list of brains from the registry");
      const no = agente.noDisponible();
      if (no) throw new ErrorHttp(409, no);
      return { json: agente.encolar({ tipo: tipo as TipoDePedido, pedido, etiqueta: typeof etiqueta === "string" && etiqueta.trim() ? etiqueta.trim().slice(0, 200) : "Viewer request", cerebros: cerebros as string[], ...(typeof proveedor === "string" ? { proveedor } : {}), ...(typeof modelo === "string" ? { modelo } : {}) }) };
    }
    if (req.method === "POST" && url.pathname === "/api/agente/cancelar") {
      const { id } = await cuerpoJson(req);
      const t = typeof id === "string" ? agente.cancelar(id) : null;
      if (!t) throw new ErrorHttp(404, `no such request: ${String(id)}`);
      return { json: t };
    }
    if (req.method === "POST" && url.pathname === "/api/aplicar") {
      const { cerebro } = await cuerpoJson(req);
      const c = typeof cerebro === "string" ? registro.cerebro(cerebro) : null;
      if (!c) throw new ErrorHttp(404, `no such brain: ${String(cerebro)}`);
      return {
        json: await enCola(async () => {
          const r = await aplicarCerebro(c);
          const errores = [...r.errores, ...r.repos.filter((x) => x.error).map((x) => `${x.ruta}: ${x.error}`)];
          if (!errores.length) sinAplicar.delete(c.nombre);
          return { cerebro: c.nombre, nodos: r.nodos, relaciones: r.relaciones, errores, sinAplicar: [...sinAplicar].sort() };
        }),
      };
    }
    throw new ErrorHttp(404, "not found");
  }

  const server = createServer((req, res: ServerResponse) => {
    const responder = (estado: number, tipo: string, cuerpo: string) => {
      res.writeHead(estado, {
        "content-type": `${tipo}; charset=utf-8`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        // La página es autocontenida: nada de afuera, y solo se conecta a este mismo servidor.
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      res.end(cuerpo);
    };
    void (async () => {
      try {
        const host = req.headers.host ?? "";
        if (!propios().has(host)) throw new ErrorHttp(403, "this server only serves 127.0.0.1");
        const origen = req.headers.origin;
        if (origen !== undefined && origen !== `http://${host}`) throw new ErrorHttp(403, "request from another origin");
        const url = new URL(req.url ?? "/", `http://${host}`);
        // Sin token ni registro: el menú pregunta si en un puerto ya hay un visor de FlowBrain para su registro, y lo reusa.
        if (req.method === "GET" && url.pathname === "/api/quien") return responder(200, "application/json", JSON.stringify({ flowbrain: true, registro: carpetaReal, huella: HUELLA }));
        // El registro se lee en cada pedido: si alguien lo edita a mano, vale lo que hay en disco.
        const r = await atender(req, url, await leerRegistro(carpeta));
        if (r.html !== undefined) responder(200, "text/html", r.html);
        else responder(200, "application/json", JSON.stringify(r.json));
      } catch (e) {
        const estado = e instanceof ErrorHttp ? e.estado : e instanceof ConsultaError ? (e.codigo === "nodo_inexistente" ? 404 : 400) : 500;
        responder(estado, "application/json", JSON.stringify({ error: (e as Error).message }));
      }
    })();
  });
  return { server, token, url: () => `http://127.0.0.1:${puerto()}/` };
}

/** Arranca el servidor en `127.0.0.1` y espera a que escuche. Con `puerto` 0, el sistema elige uno libre. */
export function servirVisor(carpeta: string, puerto = PUERTO_VISOR): Promise<ServidorVisor> {
  const s = crearServidorVisor(carpeta);
  return new Promise((ok, mal) => {
    s.server.once("error", (e: NodeJS.ErrnoException) => mal(e.code === "EADDRINUSE" ? Object.assign(new Error(L(`port ${puerto} is in use: try --port <another>`, `el puerto ${puerto} está en uso: probá con --port <otro>`)), { code: e.code }) : e));
    s.server.listen(puerto, "127.0.0.1", () => ok(s));
  });
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { ConsultaError, leerRegistro, type Registro } from "@flowbrain/core";
import { aplicarCerebro, htmlDelVisor } from "./cerebros.js";
import { crearAgente, TIPOS_DE_PEDIDO, type Agente, type TipoDePedido } from "./agente.js";
import { detalleDeArchivo, editar, type Edicion } from "./edicion.js";

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

async function cuerpoJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new ErrorHttp(415, "el cuerpo tiene que ser application/json");
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > MAX_CUERPO) throw new ErrorHttp(413, "el pedido es demasiado grande");
    partes.push(p as Buffer);
  }
  try {
    const j: unknown = JSON.parse(Buffer.concat(partes).toString("utf8"));
    if (j === null || typeof j !== "object" || Array.isArray(j)) throw new Error("no es un objeto");
    return j as Record<string, unknown>;
  } catch {
    throw new ErrorHttp(400, "el cuerpo no es un objeto JSON válido");
  }
}

/** El servidor, sin escuchar todavía. `carpeta` es la del registro (`.flowbrain`). */
export function crearServidorVisor(carpeta: string, opciones: { token?: string; agente?: Agente } = {}): ServidorVisor {
  const token = opciones.token ?? randomBytes(32).toString("hex");
  // Los pedidos que la página le manda a Claude Code (pantalla Especificaciones), de a uno.
  const agente = opciones.agente ?? crearAgente(() => leerRegistro(carpeta));
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
      if (html === null) throw new ErrorHttp(409, "ningún cerebro está compilado: corré flowbrain brains apply");
      const edicion = JSON.stringify({ token, sinAplicar: [...sinAplicar].sort(), agente: { noDisponible: agente.noDisponible() } }).replace(/</g, "\\u003c");
      return { html: html.replace(MARCA_DATOS, `<script>window.FLOWBRAIN_EDICION=${edicion};</script>\n${MARCA_DATOS}`) };
    }
    if (!url.pathname.startsWith("/api/")) throw new ErrorHttp(404, "no existe");
    if (!tokenValido(req)) throw new ErrorHttp(403, "falta el token de edición o no es el de esta sesión: recargá la página");
    if (req.method === "GET" && url.pathname === "/api/archivo") {
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
    if (req.method === "GET" && url.pathname === "/api/agente") return { json: { noDisponible: agente.noDisponible(), trabajos: agente.lista() } };
    if (req.method === "POST" && url.pathname === "/api/agente") {
      const b = await cuerpoJson(req);
      const tipo = b["tipo"], pedido = b["pedido"], etiqueta = b["etiqueta"], cerebros = b["cerebros"];
      if (!TIPOS_DE_PEDIDO.includes(tipo as TipoDePedido)) throw new ErrorHttp(400, `tipo de pedido desconocido: ${String(tipo)}`);
      if (typeof pedido !== "string" || !pedido.trim() || pedido.length > 40_000) throw new ErrorHttp(400, "falta el pedido, o es demasiado largo");
      if (!Array.isArray(cerebros) || cerebros.some((c) => typeof c !== "string" || !registro.cerebro(c))) throw new ErrorHttp(400, "cerebros tiene que ser una lista de cerebros del registro");
      const no = agente.noDisponible();
      if (no) throw new ErrorHttp(409, no);
      return { json: agente.encolar({ tipo: tipo as TipoDePedido, pedido, etiqueta: typeof etiqueta === "string" && etiqueta.trim() ? etiqueta.trim().slice(0, 200) : "Pedido del visor", cerebros: cerebros as string[] }) };
    }
    if (req.method === "POST" && url.pathname === "/api/agente/cancelar") {
      const { id } = await cuerpoJson(req);
      const t = typeof id === "string" ? agente.cancelar(id) : null;
      if (!t) throw new ErrorHttp(404, `no existe el pedido: ${String(id)}`);
      return { json: t };
    }
    if (req.method === "POST" && url.pathname === "/api/aplicar") {
      const { cerebro } = await cuerpoJson(req);
      const c = typeof cerebro === "string" ? registro.cerebro(cerebro) : null;
      if (!c) throw new ErrorHttp(404, `no existe el cerebro: ${String(cerebro)}`);
      return {
        json: await enCola(async () => {
          const r = await aplicarCerebro(c);
          const errores = [...r.errores, ...r.repos.filter((x) => x.error).map((x) => `${x.ruta}: ${x.error}`)];
          if (!errores.length) sinAplicar.delete(c.nombre);
          return { cerebro: c.nombre, nodos: r.nodos, relaciones: r.relaciones, errores, sinAplicar: [...sinAplicar].sort() };
        }),
      };
    }
    throw new ErrorHttp(404, "no existe");
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
        if (!propios().has(host)) throw new ErrorHttp(403, "este servidor solo atiende a 127.0.0.1");
        const origen = req.headers.origin;
        if (origen !== undefined && origen !== `http://${host}`) throw new ErrorHttp(403, "pedido de otro origen");
        const url = new URL(req.url ?? "/", `http://${host}`);
        // Sin token ni registro: el menú pregunta si en un puerto ya hay un visor de FlowBrain para su registro, y lo reusa.
        if (req.method === "GET" && url.pathname === "/api/quien") return responder(200, "application/json", JSON.stringify({ flowbrain: true, registro: carpetaReal }));
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
    s.server.once("error", (e: NodeJS.ErrnoException) => mal(e.code === "EADDRINUSE" ? Object.assign(new Error(`el puerto ${puerto} está en uso: probá con --port <otro>`), { code: e.code }) : e));
    s.server.listen(puerto, "127.0.0.1", () => ok(s));
  });
}

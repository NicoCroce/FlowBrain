import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Forma, RepoFuente } from "./tipos.js";

/**
 * Entradas que no son HTTP (decisión 197): tareas programadas y rpcs de gRPC. Cada una es un endpoint con método `CRON`
 * o `GRPC`, con la evidencia en el método que la ejecuta, para que el recorrido la siga como a cualquier endpoint.
 * Acá está lo que comparten los parsers: leer los `.proto`, reconocer un horario y nombrar la entrada.
 */

export interface RpcProto {
  nombre: string;
  linea: number;
  request: string;
  response: string;
}

export interface ServicioProto {
  /** `package` del archivo (`pedidos.v1`), o vacío. */
  paquete: string;
  nombre: string;
  archivo: string;
  linea: number;
  rpcs: RpcProto[];
}

export interface Protos {
  servicios: ServicioProto[];
  /** Mensajes del `.proto` como formas: `campo` → tipo (`repeated X` → `X[]`; `optional` → `X | undefined`). */
  mensajes: Record<string, Forma>;
}

const lineaDe = (t: string, i: number) => t.slice(0, i).split("\n").length;
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

/** Bloque `{ … }` que empieza en `desde` (la posición de la llave): su cuerpo, sin las llaves. */
function bloque(t: string, desde: number): string {
  let n = 0;
  for (let i = desde; i < t.length; i++) {
    if (t[i] === "{") n++;
    else if (t[i] === "}" && --n === 0) return t.slice(desde + 1, i);
  }
  return t.slice(desde + 1);
}

const ESCALARES: Record<string, string> = { double: "number", float: "number", int32: "number", int64: "string", uint32: "number", uint64: "string", sint32: "number", sint64: "string", fixed32: "number", fixed64: "string", sfixed32: "number", sfixed64: "string", bool: "boolean", string: "string", bytes: "Uint8Array" };
const corto = (tipo: string) => tipo.replace(/^\./, "").split(".").pop()!;

/** Lee los `.proto` del repo: servicios con sus rpcs (y la línea de cada uno) y los mensajes como formas. */
export function leerProtos(repo: RepoFuente): Protos {
  const out: Protos = { servicios: [], mensajes: {} };
  for (const archivo of repo.archivos.filter((a) => a.endsWith(".proto"))) {
    let t: string;
    try {
      t = sinComentarios(readFileSync(join(repo.raiz, archivo), "utf8"));
    } catch {
      continue;
    }
    const paquete = /^\s*package\s+([\w.]+)\s*;/m.exec(t)?.[1] ?? "";
    for (const m of t.matchAll(/\bservice\s+(\w+)\s*\{/g)) {
      const abre = m.index! + m[0].length - 1;
      const cuerpo = bloque(t, abre);
      const rpcs: RpcProto[] = [];
      for (const r of cuerpo.matchAll(/\brpc\s+(\w+)\s*\(\s*(stream\s+)?([\w.]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([\w.]+)\s*\)/g)) {
        rpcs.push({ nombre: r[1]!, linea: lineaDe(t, abre + 1 + r.index!), request: (r[2] ? "stream " : "") + corto(r[3]!), response: (r[4] ? "stream " : "") + corto(r[5]!) });
      }
      out.servicios.push({ paquete, nombre: m[1]!, archivo, linea: lineaDe(t, m.index!), rpcs });
    }
    // Mensajes de primer nivel y anidados, por su nombre corto (el que usan los rpcs).
    for (const m of t.matchAll(/\bmessage\s+(\w+)\s*\{/g)) {
      const cuerpo = bloque(t, m.index! + m[0].length - 1).replace(/\b(message|enum|oneof)\s+\w+\s*\{[^{}]*\}/g, "");
      const forma: Forma = {};
      for (const c of cuerpo.matchAll(/(?:^|[;{\n])\s*(repeated\s+|optional\s+)?(map\s*<\s*[\w.]+\s*,\s*[\w.]+\s*>|[\w.]+)\s+(\w+)\s*=\s*\d+/g)) {
        const crudo = c[2]!.replace(/\s+/g, "");
        const tipo = crudo.startsWith("map<") ? `Record<${crudo.slice(4, -1).split(",").map((x) => ESCALARES[x] ?? corto(x)).join(", ")}>` : (ESCALARES[crudo] ?? corto(crudo));
        forma[c[3]!] = c[1]?.startsWith("repeated") ? `${tipo}[]` : c[1]?.startsWith("optional") ? `${tipo} | undefined` : tipo;
      }
      out.mensajes[m[1]!] ??= forma;
    }
  }
  return out;
}

/** Ruta HTTP/2 de un rpc: `/paquete.Servicio/Metodo`. */
export const rutaGrpc = (s: ServicioProto, rpc: string) => `/${s.paquete ? `${s.paquete}.` : ""}${s.nombre}/${rpc}`;

/** El rpc de un servicio por el nombre con que lo usa el código: igual, o con la primera letra en minúscula (grpc-js). */
export function rpcDe(s: ServicioProto, metodo: string): RpcProto | null {
  return s.rpcs.find((r) => r.nombre === metodo) ?? s.rpcs.find((r) => r.nombre.toLowerCase() === metodo.toLowerCase()) ?? null;
}

/**
 * Servicios del proto que nombra el código: `proto.pkg.Greeter.service`, `GreeterService` (código generado),
 * `GreeterClient`, `'Greeter'` o `'pkg.Greeter'`. Más de uno si el nombre se repite en paquetes distintos.
 */
export function servicioProto(protos: Protos, nombre: string): ServicioProto[] {
  const limpio = nombre.replace(/\.service$/, "");
  const partes = limpio.split(".");
  const corto = partes.pop()!;
  const paquete = partes.join(".");
  for (const n of [corto, corto.replace(/(Client|Service)$/, "")]) {
    const hits = protos.servicios.filter((s) => s.nombre === n && (!paquete || s.paquete === paquete || paquete.endsWith(s.paquete) || !s.paquete));
    if (hits.length) return hits;
  }
  return [];
}

/** Expresión de cron (5 a 7 campos) o macro (`@daily`, `@every 5m`). */
export const ES_CRON = /^(?:@(?:yearly|annually|monthly|weekly|daily|midnight|hourly|reboot)|@every\s+\S+|(?:[\d*?/,LW#A-Za-z-]+\s+){4,6}[\d*?/,LW#A-Za-z-]+)$/;
export const esCron = (s: string) => ES_CRON.test(s.trim()) && /[\d*@]/.test(s);

/** Nombre de la entrada como segmento de ruta: `emails:send` → `emails-send`, `Tareas.limpiar` igual. */
export const rutaCron = (nombre: string) => "/" + nombre.replace(/[^A-Za-z0-9._~@-]+/g, "-").replace(/^-+|-+$/g, "");

export interface LineaCrontab {
  linea: number;
  horario: string;
  /** El comando de consola que corre (`app:sync`, `emails:send`), si es de Symfony o Laravel. */
  comando: string;
}

/**
 * Líneas de crontab que corren un comando de consola del repo: en un `crontab`, un `.cron`, un Dockerfile
 * (`echo "0 3 * * * … bin/console app:x" | crontab -`), un `.ebextensions` o un script. Las comentadas no cuentan.
 */
export function leerCrontabs(repo: RepoFuente): Array<LineaCrontab & { archivo: string }> {
  const out: Array<LineaCrontab & { archivo: string }> = [];
  const candidato = /(^|\/)(Dockerfile[^/]*|[^/]*crontab[^/]*|[^/]*\.cron|cron\.d\/[^/]+|\.ebextensions\/[^/]+|[^/]+\.sh)$/i;
  for (const archivo of repo.archivos.filter((a) => candidato.test(a))) {
    let t: string;
    try {
      t = readFileSync(join(repo.raiz, archivo), "utf8");
    } catch {
      continue;
    }
    if (t.length > 500_000) continue;
    t.split("\n").forEach((l, i) => {
      if (/^\s*#/.test(l)) return;
      const m = /(?:^|["'\s])((?:@\w+)|(?:[\d*?/,-]+\s+){4}[\d*?/,A-Za-z-]+)\s+[^"'\n]*?\b(?:bin\/console|symfony\s+console|artisan)\s+([\w:.-]+)/.exec(l);
      if (m && esCron(m[1]!)) out.push({ archivo, linea: i + 1, horario: m[1]!.trim(), comando: m[2]! });
    });
  }
  return out;
}

/** Horario de un intervalo en milisegundos: `cada 5000 ms`, o el nombre de lo que lo fija si no es un número. */
export const cadaMs = (texto: string) => (/^\d[\d_]*$/.test(texto) ? `cada ${texto.replace(/_/g, "")} ms` : `cada ${texto} ms`);

import { cmpTuple, stringifyCompact } from "../canonical.js";
import type { Estado, GraphEdge, GraphNode, Verbo } from "../schema.js";
import type { Contexto } from "./contexto.js";

export const PROYECCIONES = ["resumen", "relaciones", "contrato", "completo"] as const;
export type Proyeccion = (typeof PROYECCIONES)[number];

/** Verbos que no se muestran como relaciones de un nodo (se ven por la proyección `contrato`). */
const VERBOS_OCULTOS: readonly Verbo[] = ["contiene", "expone"];

export interface AristaProyectada {
  confianza: number;
  direccion: "in" | "out";
  endpoint: string | null;
  estado: Estado;
  evidencia: string | null;
  nodo: string;
  verbo: Verbo;
}

export interface TipoExpandido {
  forma: Record<string, string> | null;
  nombre: string;
}

export interface EndpointProyectado {
  evidencia: string;
  id: string;
  llamado_por: string[];
  metodo: string;
  request: TipoExpandido | null;
  response: TipoExpandido | null;
  /** Parámetros de query, si el contrato los trae. */
  query?: TipoExpandido;
  ruta: string;
}

export interface Item {
  estado: Estado;
  id: string;
  nombre: string;
  resumen: string | null;
  tipo: string;
  aristas?: AristaProyectada[];
  endpoints?: EndpointProyectado[];
  prosa?: string;
  [extra: string]: unknown;
}

export interface Omitidos {
  aristas: number;
  endpoints: number;
  nodos: number;
  prosa: number;
  saltos: number;
}

export const tokens = (valor: unknown): number => Math.ceil(stringifyCompact(valor).length / 4);

const confNodo = (n: GraphNode) => (n.origen === "curado" ? 1 : n.origen === "parser" ? 0.9 : 0.5);
export { confNodo };

function aristasDe(ctx: Contexto, id: string): AristaProyectada[] {
  const out: AristaProyectada[] = [];
  const push = (e: GraphEdge, direccion: "in" | "out") => {
    if (VERBOS_OCULTOS.includes(e.verbo)) return;
    out.push({
      confianza: e.confianza,
      direccion,
      endpoint: e.endpoint,
      estado: e.estado,
      evidencia: e.evidencia,
      nodo: direccion === "out" ? e.hasta : e.desde,
      verbo: e.verbo,
    });
  };
  for (const e of ctx.salientes.get(id) ?? []) push(e, "out");
  for (const e of ctx.entrantes.get(id) ?? []) push(e, "in");
  return out.sort(
    (a, b) =>
      b.confianza - a.confianza ||
      cmpTuple([a.direccion === "out" ? "0" : "1", a.verbo, a.nodo, a.endpoint ?? ""], [b.direccion === "out" ? "0" : "1", b.verbo, b.nodo, b.endpoint ?? ""]),
  );
}

function expandir(ctx: Contexto, svc: string, nombre: string | null): TipoExpandido | null {
  if (nombre === null) return null;
  return { forma: ctx.contratos.get(svc)?.tipos[nombre] ?? null, nombre };
}

/** Endpoints de un svc (desde su contrato), con tipos expandidos y quién los llama. */
export function endpointsDe(ctx: Contexto, svc: string): EndpointProyectado[] {
  const out: EndpointProyectado[] = [];
  for (const e of ctx.salientes.get(svc) ?? []) {
    if (e.verbo !== "contiene") continue;
    const n = ctx.nodo.get(e.hasta);
    if (n?.tipo !== "endpoint") continue;
    const a = n.atributos as { evidencia: string; metodo: string; request: string | null; response: string | null; ruta: string; query?: string };
    const query = a.query ? expandir(ctx, svc, a.query) : null;
    const llamado_por = [...new Set((ctx.entrantes.get(svc) ?? []).filter((x) => x.endpoint === n.id).map((x) => x.desde))].sort();
    out.push({
      evidencia: a.evidencia,
      id: n.id,
      llamado_por,
      metodo: a.metodo,
      request: expandir(ctx, svc, a.request),
      response: expandir(ctx, svc, a.response),
      ...(query ? { query } : {}),
      ruta: a.ruta,
    });
  }
  return out;
}

/** Proyecta un nodo. `extra` se agrega tal cual (nivel, via, coincidencia…). */
export function proyectar(ctx: Contexto, n: GraphNode, p: Proyeccion, extra: Record<string, unknown> = {}): Item {
  const it: Item = { estado: n.estado, id: n.id, nombre: n.nombre, resumen: n.resumen, tipo: n.tipo, ...extra };
  if (p === "resumen") return it;
  it.aristas = aristasDe(ctx, n.id);
  if (p === "relaciones") return it;
  if (n.tipo === "svc" && ctx.contratos.has(n.id)) it.endpoints = endpointsDe(ctx, n.id);
  if (p === "contrato") return it;
  const prosa = ctx.prosa.get(n.id);
  if (prosa !== undefined) it.prosa = prosa;
  return it;
}

export type ConPresupuesto<R> = R & { omitidos: Omitidos; truncado: boolean };

/**
 * Recorta `r` hasta que entre en `budget` tokens. Orden: prosa → endpoints → aristas (menor confianza
 * primero; a igual confianza, en orden inverso al canónico) → nodos desde el final → saltos desde el final.
 */
export function ajustar<R extends { nodos: Item[]; saltos?: unknown[] }>(entrada: R, budget: number | null): ConPresupuesto<R> {
  const r = structuredClone(entrada);
  const om: Omitidos = { aristas: 0, endpoints: 0, nodos: 0, prosa: 0, saltos: 0 };
  const salida = (): ConPresupuesto<R> => ({ ...r, omitidos: { ...om }, truncado: Object.values(om).some((v) => v > 0) });
  const entra = () => budget === null || tokens(salida()) <= budget;
  if (entra()) return salida();

  for (let i = r.nodos.length - 1; i >= 0; i--) {
    if (r.nodos[i]!.prosa === undefined) continue;
    delete r.nodos[i]!.prosa;
    om.prosa++;
    if (entra()) return salida();
  }
  for (let i = r.nodos.length - 1; i >= 0; i--) {
    const eps = r.nodos[i]!.endpoints;
    if (eps === undefined) continue;
    om.endpoints += eps.length;
    delete r.nodos[i]!.endpoints;
    if (entra()) return salida();
  }

  // Aristas: orden de eliminación fijo; búsqueda binaria de la menor cantidad que hace entrar.
  const pool: Array<{ i: number; j: number; c: number }> = [];
  r.nodos.forEach((n, i) => n.aristas?.forEach((a, j) => pool.push({ i, j, c: a.confianza })));
  pool.sort((a, b) => a.c - b.c || b.i - a.i || b.j - a.j);
  const originales = r.nodos.map((n) => n.aristas);
  const quitar = (k: number) => {
    const fuera = new Set(pool.slice(0, k).map((x) => `${x.i}:${x.j}`));
    r.nodos.forEach((n, i) => {
      const o = originales[i];
      if (o !== undefined) n.aristas = o.filter((_, j) => !fuera.has(`${i}:${j}`));
    });
    om.aristas = k;
  };
  if (pool.length > 0) {
    quitar(pool.length);
    if (entra()) {
      let lo = 1;
      let hi = pool.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        quitar(mid);
        if (entra()) hi = mid;
        else lo = mid + 1;
      }
      quitar(lo);
      return salida();
    }
  }

  const recortarLista = (lista: unknown[], clave: "nodos" | "saltos") => {
    while (lista.length > 0 && !entra()) {
      lista.pop();
      om[clave]++;
    }
  };
  recortarLista(r.nodos, "nodos");
  if (r.saltos) recortarLista(r.saltos, "saltos");
  return salida();
}

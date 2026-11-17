import type { Cruce, Ficha, Graph, ResumenConexion } from "@brain/core";
import { datosDelVisor, paginaDelVisor, type DatosVisor } from "./viewer.js";

/**
 * Visor de varios cerebros: une los datos de cada uno en una sola página. Cada id lleva el nombre de su cerebro
 * (`cerebro/id`), porque dos cerebros pueden tener un `repo-x` o una `tabla-user` distintos, y cada nodo dice a
 * qué cerebro pertenece. Las relaciones entre cerebros son los cruces calculados con la comunicación activa.
 */

export interface CerebroVisor {
  nombre: string;
  sinRevisar: boolean;
  graph: Graph;
  funcionalidades: Ficha[];
}

/** Reemplaza, a cualquier profundidad, los textos que son ids de nodos del cerebro por su versión con prefijo. */
function conPrefijo<T>(valor: T, ids: Set<string>, pre: (id: string) => string): T {
  if (typeof valor === "string") return (ids.has(valor) ? pre(valor) : valor) as T;
  if (Array.isArray(valor)) return valor.map((v) => conPrefijo(v, ids, pre)) as T;
  if (valor !== null && typeof valor === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) out[ids.has(k) ? pre(k) : k] = conPrefijo(v, ids, pre);
    return out as T;
  }
  return valor;
}

export function datosDeCerebros(cerebros: CerebroVisor[], cruces: Cruce[], conexiones: ResumenConexion[]) {
  const partes = cerebros.map((c, i) => {
    const ids = new Set(c.graph.nodes.map((n) => n.id));
    const d = conPrefijo(datosDelVisor(c.graph, c.funcionalidades), ids, (id) => `${c.nombre}/${id}`) as DatosVisor;
    return { ...d, nodes: d.nodes.map((n) => ({ ...n, c: i })) };
  });
  const svcDe = (ep: string) => ep.slice(0, ep.indexOf(":"));
  // Lo que viaja entre cerebros: una arista por (servicio que llama, endpoint que atiende), con cuántas llamadas.
  const viajan = new Map<string, { a: string; b: string; ev: string; veces: number }>();
  for (const x of cruces) {
    const a = `${x.desde.cerebro}/${x.desde.svc}`, b = `${x.hacia.cerebro}/${x.hacia.endpoint}`;
    const v = viajan.get(`${a}\u0000${b}`);
    if (v) v.veces++;
    else viajan.set(`${a}\u0000${b}`, { a, b, ev: x.desde.evidencia, veces: 1 });
  }
  const cruzan = [...viajan.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
  return {
    cerebros: cerebros.map((c, i) => ({ nombre: c.nombre, sinRevisar: c.sinRevisar, nodos: partes[i]!.nodes.length })),
    conexiones,
    dependencias: partes.flatMap((p) => p.dependencias),
    funcionalidades: partes.flatMap((p) => p.funcionalidades),
    pantallas: partes.flatMap((p) => p.pantallas),
    mapa3d: {
      aristas: [...partes.flatMap((p) => p.mapa3d.aristas), ...cruzan.map((x) => [x.a, x.b, "llama_a", x.veces] as [string, string, string, number])],
      uso: Object.assign({}, ...partes.map((p) => p.mapa3d.uso)) as Record<string, number>,
      padres: { feat: Object.assign({}, ...partes.map((p) => p.mapa3d.padres.feat)) as Record<string, string>, svc: Object.assign({}, ...partes.map((p) => p.mapa3d.padres.svc)) as Record<string, string> },
    },
    edges: [
      ...partes.flatMap((p) => p.edges),
      ...cruzan.map((x) => ({ c: 0.9, d: null, e: "vigente", ev: x.ev, h: `${x.b.slice(0, x.b.indexOf("/"))}/${svcDe(x.b.slice(x.b.indexOf("/") + 1))}`, o: "parser", p: x.b, s: x.a, v: "llama_a" })),
    ],
    nodes: partes.flatMap((p) => p.nodes),
    tiposIniciales: partes[0]?.tiposIniciales ?? [],
  };
}

export function renderViewerCerebros(cerebros: CerebroVisor[], cruces: Cruce[], conexiones: ResumenConexion[], cytoscapeJs: string): string {
  return paginaDelVisor(datosDeCerebros(cerebros, cruces, conexiones), cytoscapeJs);
}

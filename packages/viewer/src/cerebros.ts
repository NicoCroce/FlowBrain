import type { Cruce, Ficha, Graph, ResumenConexion, TrazasCruzadas } from "@flowbrain/core";
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

export function datosDeCerebros(cerebros: CerebroVisor[], cruces: Cruce[], conexiones: ResumenConexion[], trazas: TrazasCruzadas = { pantallas: {}, backs: {} }) {
  const partes = cerebros.map((c, i) => {
    const ids = new Set(c.graph.nodes.map((n) => n.id));
    const d = conPrefijo(datosDelVisor(c.graph, c.funcionalidades), ids, (id) => `${c.nombre}/${id}`) as DatosVisor;
    return { ...d, nodes: d.nodes.map((n) => ({ ...n, c: i })) };
  });
  const svcDe = (ep: string) => ep.slice(0, ep.indexOf(":"));
  // Lo que viaja entre cerebros: una arista por (quién llama, endpoint que atiende), con cuántas llamadas. Quién llama
  // es cada pantalla que llega a la llamada; si no es de ninguna pantalla (un job, un back), el servicio.
  const viajan = new Map<string, { a: string; b: string; ev: string; veces: number; sinPantalla: boolean }>();
  for (const x of cruces) {
    const b = `${x.hacia.cerebro}/${x.hacia.endpoint}`;
    for (const origen of x.desde.pantallas.length ? x.desde.pantallas : [x.desde.svc]) {
      const a = `${x.desde.cerebro}/${origen}`;
      const v = viajan.get(`${a}\u0000${b}`);
      if (v) v.veces++;
      else viajan.set(`${a}\u0000${b}`, { a, b, ev: x.desde.evidencia, veces: 1, sinPantalla: !x.desde.pantallas.length });
    }
  }
  const cruzan = [...viajan.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
  // El impacto y las relaciones entre funcionalidades también cruzan de cerebro: la pantalla de un front llama al
  // endpoint de un back, y la funcionalidad de esa pantalla usa a la que implementa el endpoint. Sin esto, cambiar una
  // tabla del back no llegaba nunca a las pantallas que la muestran.
  const implementadaPor = new Map<string, string[]>();
  for (const d of partes.flatMap((p) => p.dependencias)) if (d[2] === "implementa") (implementadaPor.get(d[1]) ?? implementadaPor.set(d[1], []).get(d[1])!).push(d[0]);
  // Solo las que salen de una pantalla: una llamada a nombre del servicio entero, a través de él, alcanzaría a todas las
  // funcionalidades del front, y eso no dice nada.
  const desdePantallas = cruzan.filter((x) => !x.sinPantalla);
  const usaEntre = new Map<string, { a: string; b: string; endpoints: Set<string> }>();
  for (const x of desdePantallas) {
    for (const fa of implementadaPor.get(x.a) ?? []) {
      for (const fb of implementadaPor.get(x.b) ?? []) {
        if (fa === fb) continue;
        const k = `${fa}\u0000${fb}`;
        (usaEntre.get(k) ?? usaEntre.set(k, { a: fa, b: fb, endpoints: new Set() }).get(k)!).endpoints.add(x.b);
      }
    }
  }
  const depsCruzadas: Array<[string, string, string, number]> = [
    ...desdePantallas.map((x) => [x.a, x.b, "llama_a", x.veces] as [string, string, string, number]),
    ...[...usaEntre.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1)).map((u) => [u.a, u.b, "usa", u.endpoints.size] as [string, string, string, number]),
  ];
  return {
    cerebros: cerebros.map((c, i) => ({ nombre: c.nombre, sinRevisar: c.sinRevisar, nodos: partes[i]!.nodes.length })),
    conexiones,
    // Trazas de punta a punta que cruzan de un cerebro a otro; ya vienen con los ids prefijados.
    cruzado: trazas,
    dependencias: [...partes.flatMap((p) => p.dependencias), ...depsCruzadas],
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

export function renderViewerCerebros(cerebros: CerebroVisor[], cruces: Cruce[], conexiones: ResumenConexion[], trazas?: TrazasCruzadas): string {
  return paginaDelVisor(datosDeCerebros(cerebros, cruces, conexiones, trazas));
}

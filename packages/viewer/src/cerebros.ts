import type { CodigoVisor, Cruce, DependenciaCruzada, Ficha, Graph, ResumenConexion, TrazasCruzadas, UsoCruzado } from "@flowbrain/core";
import { datosDelVisor, paginaDelVisor, type DatosVisor, type DerivaVisor, type FidelidadVisor } from "./viewer.js";

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
  /** Fidelidad de sus archivos, ya con las llamadas que cruzan a otros cerebros contadas como unidas. */
  fidelidad?: FidelidadVisor;
  /** Su deriva, ya cruzada con los cerebros comunicados. */
  deriva?: DerivaVisor;
  /** Sus símbolos de código (`simbolosDelVisor`); ausente sin índice de código. */
  codigo?: CodigoVisor | null;
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

/** Lo que une a los cerebros por paquetes: componentes que dibuja otro cerebro y dependencias declaradas. */
export interface PorPaquetes {
  componentes: UsoCruzado[];
  dependencias: DependenciaCruzada[];
}

export function datosDeCerebros(cerebros: CerebroVisor[], cruces: Cruce[], conexiones: ResumenConexion[], trazas: TrazasCruzadas = { pantallas: {}, backs: {} }, paquetes: PorPaquetes = { componentes: [], dependencias: [] }) {
  const partes = cerebros.map((c, i) => {
    const ids = new Set(c.graph.nodes.map((n) => n.id));
    const d = conPrefijo(datosDelVisor(c.graph, c.funcionalidades, c.fidelidad, c.deriva, c.codigo), ids, (id) => `${c.nombre}/${id}`) as DatosVisor;
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
  // Por paquetes: cada pantalla (o el servicio, si no sale de una) usa el componente del otro cerebro, y su
  // funcionalidad también, para que cambiar el componente llegue hasta ella en el impacto.
  const usan = new Map<string, { a: string; b: string; ev: string; v: string }>();
  for (const u of paquetes.componentes) {
    const b = `${u.hacia.cerebro}/${u.hacia.componente}`;
    for (const o of u.desde.pantallas.length ? u.desde.pantallas : [u.desde.svc]) {
      const a = `${u.desde.cerebro}/${o}`;
      if (!usan.has(`${a}\u0000${b}`)) usan.set(`${a}\u0000${b}`, { a, b, ev: u.desde.evidencia, v: "usa" });
      for (const f of implementadaPor.get(a) ?? []) if (!usan.has(`${f}\u0000${b}`)) usan.set(`${f}\u0000${b}`, { a: f, b, ev: u.desde.evidencia, v: "usa" });
    }
  }
  for (const d of paquetes.dependencias) {
    const a = `${d.desde.cerebro}/${d.desde.svc}`, b = `${d.hacia.cerebro}/${d.hacia.nodo}`;
    if (!usan.has(`${a}\u0000${b}`)) usan.set(`${a}\u0000${b}`, { a, b, ev: d.desde.evidencia, v: "depende_de" });
  }
  const porPaquete = [...usan.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
  const depsCruzadas: Array<[string, string, string, number]> = [
    ...porPaquete.map((x) => [x.a, x.b, x.v, 1] as [string, string, string, number]),
    ...desdePantallas.map((x) => [x.a, x.b, "llama_a", x.veces] as [string, string, string, number]),
    ...[...usaEntre.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1)).map((u) => [u.a, u.b, "usa", u.endpoints.size] as [string, string, string, number]),
  ];
  return {
    cerebros: cerebros.map((c, i) => ({ nombre: c.nombre, sinRevisar: c.sinRevisar, nodos: partes[i]!.nodes.length })),
    // Cada fila dice de qué cerebro es (`c`); los que no tienen índice de código no aportan filas.
    fidelidad: partes.some((p) => p.fidelidad)
      ? {
          archivos: partes.flatMap((p, i) => (p.fidelidad?.archivos ?? []).map((a) => ({ ...a, c: i }))),
          inciertos: partes.flatMap((p, i) => (p.fidelidad?.inciertos ?? []).map((a) => ({ ...a, c: i }))),
          plan: partes.find((p) => p.fidelidad)!.fidelidad!.plan,
        }
      : null,
    // La deriva de cada cerebro que tiene índice de código, con el suyo (`c`).
    deriva: partes.some((p) => p.deriva) ? partes.flatMap((p, i) => (p.deriva ?? []).map((d) => ({ ...d, c: i }))) : null,
    // Sin asociar de todos los cerebros, cada uno con el suyo (`c`); `null` si ninguno tiene índice de código.
    sinAsociar: partes.some((p) => p.sinAsociar) ? partes.flatMap((p, i) => (p.sinAsociar ?? []).map((a) => ({ ...a, c: i }))) : null,
    // Las marcas «No es de producto» de cada cerebro, con el suyo (`c`).
    noProducto: partes.some((p) => p.noProducto) ? partes.flatMap((p, i) => (p.noProducto ?? []).map((a) => ({ ...a, c: i }))) : null,
    // Los símbolos de todos los cerebros en una lista: los índices de cada uno se corren por los de los anteriores.
    codigo: partes.some((p) => p.codigo) ? unirCodigo(partes.map((p) => p.codigo)) : null,
    conexiones,
    // Trazas de punta a punta que cruzan de un cerebro a otro; ya vienen con los ids prefijados.
    cruzado: trazas,
    dependencias: [...partes.flatMap((p) => p.dependencias), ...depsCruzadas],
    funcionalidades: partes.flatMap((p) => p.funcionalidades),
    pantallas: partes.flatMap((p) => p.pantallas),
    mapa3d: {
      aristas: [
        ...partes.flatMap((p) => p.mapa3d.aristas),
        ...cruzan.map((x) => [x.a, x.b, "llama_a", x.veces] as [string, string, string, number]),
        ...porPaquete.filter((x) => !x.a.includes("/feat-")).map((x) => [x.a, x.b, x.v, 1] as [string, string, string, number]),
      ],
      uso: Object.assign({}, ...partes.map((p) => p.mapa3d.uso)) as Record<string, number>,
      padres: { feat: Object.assign({}, ...partes.map((p) => p.mapa3d.padres.feat)) as Record<string, string>, svc: Object.assign({}, ...partes.map((p) => p.mapa3d.padres.svc)) as Record<string, string> },
    },
    edges: [
      ...partes.flatMap((p) => p.edges),
      ...cruzan.map((x) => ({ c: 0.9, d: null, e: "vigente", ev: x.ev, h: `${x.b.slice(0, x.b.indexOf("/"))}/${svcDe(x.b.slice(x.b.indexOf("/") + 1))}`, o: "parser", p: x.b, s: x.a, v: "llama_a" })),
      ...porPaquete.filter((x) => !x.a.includes("/feat-")).map((x) => ({ c: 0.9, d: null, e: "vigente", ev: x.ev, h: x.b, o: "parser", p: null, s: x.a, v: x.v })),
    ],
    nodes: partes.flatMap((p) => p.nodes),
    tiposIniciales: partes[0]?.tiposIniciales ?? [],
  };
}

function unirCodigo(xs: Array<CodigoVisor | null>): CodigoVisor {
  const out: CodigoVisor = { archivos: [], llaman: [], usan: [], atiende: [] };
  let base = 0;
  for (const x of xs) {
    if (!x) continue;
    const b = base;
    out.archivos.push(...x.archivos);
    out.llaman.push(...x.llaman.map(([d, o, l]) => [d + b, o + b, l] as [number, number, number]));
    out.usan.push(...x.usan.map(([d, o, l]) => [d + b, o + b, l] as [number, number, number]));
    out.atiende.push(...x.atiende.map(([s, e]) => [s + b, e] as [number, string]));
    base += x.archivos.reduce((n, a) => n + a[1].length, 0);
  }
  return out;
}

export function renderViewerCerebros(cerebros: CerebroVisor[], cruces: Cruce[], conexiones: ResumenConexion[], trazas?: TrazasCruzadas, paquetes?: PorPaquetes): string {
  return paginaDelVisor(datosDeCerebros(cerebros, cruces, conexiones, trazas, paquetes));
}

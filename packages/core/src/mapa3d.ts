import type { Ficha } from "./funcionalidades.js";
import type { Graph } from "./schema.js";

/**
 * Datos del "Mapa 3D" del visor: aristas agregadas (con cuántas veces aparece cada relación en el código), el uso de
 * cada nodo y quién es "padre" de quién según cómo se agrupe (por funcionalidad o por servicio). Arrastrar o separar
 * un nodo se lleva a sus hijos. Combina el grafo con las fichas de funcionalidades, que son las que unen endpoints,
 * tablas y archivos con su funcionalidad.
 */
export interface Mapa3D {
  /** `[desde, hasta, verbo, veces]`, ordenadas. `recorrido` une un endpoint con los archivos que atraviesa. */
  aristas: Array<[string, string, string, number]>;
  /** Apariciones en el código: suma de `veces` de sus aristas, sin contar `contiene` ni `vive_en`. */
  uso: Record<string, number>;
  /** Padre de cada nodo al agrupar por funcionalidad (`feat`) o por servicio (`svc`). */
  padres: { feat: Record<string, string>; svc: Record<string, string> };
}

const ESTRUCTURALES = new Set(["contiene", "vive_en"]);

export function mapa3dDelGrafo(graph: Graph, fichas: Ficha[] = []): Mapa3D {
  const tipo = new Map(graph.nodes.map((n) => [n.id, n.tipo]));
  const agregadas = new Map<string, [string, string, string, number]>();
  const agregar = (desde: string, hasta: string, verbo: string, veces = 1) => {
    if (!tipo.has(desde) || !tipo.has(hasta) || tipo.get(desde) === "contrato" || tipo.get(hasta) === "contrato") return;
    const k = desde + "\u0000" + hasta + "\u0000" + verbo;
    const a = agregadas.get(k);
    if (a) a[3] += veces;
    else agregadas.set(k, [desde, hasta, verbo, veces]);
  };

  const repoDe: Record<string, string> = {};
  const dbDe: Record<string, string> = {};
  for (const e of graph.edges) {
    if (e.verbo === "expone") continue;
    if (e.verbo === "llama_a" && e.endpoint && tipo.get(e.endpoint) === "endpoint") agregar(e.desde, e.endpoint, "llama_a");
    else agregar(e.desde, e.hasta, e.verbo);
    if (e.verbo === "vive_en" && tipo.get(e.hasta) === "repo" && !repoDe[e.desde]) repoDe[e.desde] = e.hasta;
    if (e.verbo === "vive_en" && tipo.get(e.hasta) === "db" && !dbDe[e.desde]) dbDe[e.desde] = e.hasta;
    if (e.verbo === "contiene" && tipo.get(e.desde) === "repo" && tipo.get(e.hasta) === "archivo" && !repoDe[e.hasta]) repoDe[e.hasta] = e.desde;
  }

  // Un endpoint vive en el servicio de su id (`svc-x:GET:/ruta`).
  const svcDe: Record<string, string> = {};
  for (const n of graph.nodes) {
    if (n.tipo !== "endpoint") continue;
    const svc = n.id.split(":")[0]!;
    if (tipo.get(svc) === "svc") {
      svcDe[n.id] = svc;
      if (!agregadas.has(svc + "\u0000" + n.id + "\u0000contiene")) agregar(svc, n.id, "contiene");
    }
  }

  const featDeEndpoint: Record<string, string> = {};
  const endpointDeArchivo: Record<string, string> = {};
  const featDeArchivo: Record<string, string> = {};
  const duenaDeTabla: Record<string, [string, number]> = {};
  const featDePantalla: Record<string, string> = {};
  const archivos = graph.nodes.filter((n) => n.tipo === "archivo").map((n) => n.id);
  for (const f of fichas) {
    for (const ep of f.expone) {
      agregar(ep, f.id, "implementa");
      if (!featDeEndpoint[ep] && tipo.has(ep)) featDeEndpoint[ep] = f.id;
    }
    for (const d of f.datos) {
      if (d.lee) agregar(f.id, d.tabla, "lee_de", d.lee);
      if (d.escribe) agregar(f.id, d.tabla, "escribe_en", d.escribe);
      const peso = d.lee + d.escribe;
      const actual = duenaDeTabla[d.tabla];
      if (!actual || peso > actual[1]) duenaDeTabla[d.tabla] = [f.id, peso];
    }
    for (const u of f.usa) agregar(f.id, u.endpoint && tipo.has(u.endpoint) ? u.endpoint : u.hasta, "llama_a", u.veces);
    for (const r of f.recorridos)
      for (const p of r.pasos) {
        const archivo = p.evidencia.split("#")[0]!;
        if (tipo.get(archivo) !== "archivo") continue;
        agregar(r.endpoint, archivo, "recorrido");
        if (!endpointDeArchivo[archivo]) endpointDeArchivo[archivo] = r.endpoint;
      }
    for (const p of f.pantallas ?? []) {
      if (!featDePantalla[p.id]) featDePantalla[p.id] = f.id;
      // Como un endpoint: la pantalla es parte de la funcionalidad que dibuja su componente.
      agregar(p.id, f.id, "implementa");
      for (const ep of p.endpoints) agregar(p.id, ep, "llama_a");
    }
    for (const c of f.codigo)
      for (const a of archivos) if (!featDeArchivo[a] && (a === c || a.startsWith(c + "/"))) featDeArchivo[a] = f.id;
  }

  const aristas = [...agregadas.values()].sort((a, b) => (a[0] + "\u0000" + a[1] + "\u0000" + a[2] < b[0] + "\u0000" + b[1] + "\u0000" + b[2] ? -1 : 1));
  const uso: Record<string, number> = {};
  for (const n of graph.nodes) if (n.tipo !== "contrato") uso[n.id] = 0;
  for (const [d, h, v, c] of aristas) {
    if (ESTRUCTURALES.has(v)) continue;
    uso[d]! += c;
    uso[h]! += c;
  }

  const padres: Mapa3D["padres"] = { feat: {}, svc: {} };
  for (const n of graph.nodes) {
    const id = n.id;
    let feat: string | undefined, svc: string | undefined;
    if (n.tipo === "svc" || n.tipo === "lib") feat = svc = repoDe[id];
    else if (n.tipo === "endpoint") {
      feat = featDeEndpoint[id] ?? svcDe[id];
      svc = svcDe[id];
    } else if (n.tipo === "tabla") {
      feat = duenaDeTabla[id]?.[0];
      svc = dbDe[id];
    } else if (n.tipo === "pantalla") {
      svc = n.id.slice(0, n.id.indexOf(":pantalla:"));
      feat = featDePantalla[id] ?? svc;
    } else if (n.tipo === "archivo") {
      feat = endpointDeArchivo[id] ?? featDeArchivo[id] ?? repoDe[id];
      svc = endpointDeArchivo[id] ?? repoDe[id];
    }
    if (feat && feat !== id) padres.feat[id] = feat;
    if (svc && svc !== id) padres.svc[id] = svc;
  }
  return { aristas, uso, padres };
}

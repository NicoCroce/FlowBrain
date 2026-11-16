import { cmp, cmpTuple } from "./canonical.js";
import { MARCA_FIN, MARCA_INICIO } from "./render.js";
import { dentroDe, type Graph } from "./schema.js";

/**
 * Vista de producto de cada funcionalidad (`feat`), derivada de las rutas de su campo `codigo`:
 * qué expone, qué usa, qué datos toca y con qué otras funcionalidades se relaciona. Sale de la extracción de los
 * parsers (`_build/extraccion/*.json`), que conserva cada llamada y cada acceso con su evidencia; el grafo, en cambio,
 * deduplica por (desde, verbo, hasta, endpoint) y se queda con una sola evidencia por par.
 */

export const RUTA_FUNCIONALIDADES = "_build/funcionalidades.json";

export interface AristaExtraccion {
  desde: string;
  verbo: string;
  hasta: string;
  endpoint: string | null;
  evidencia: string;
}

export interface Uso {
  /** Servicio o sistema externo llamado. */
  hasta: string;
  endpoint: string | null;
  /** Primera evidencia (orden alfabético) y cantidad de llamadas. */
  evidencia: string;
  veces: number;
}

export interface Dato {
  tabla: string;
  lee: number;
  escribe: number;
  evidencia: string;
}

export interface Ficha {
  id: string;
  codigo: string[];
  /** Cuerpo Markdown de la página, sin los backlinks generados. */
  cuerpo: string;
  archivos: number;
  /** Servicios (o repos) que la implementan. */
  implementan: string[];
  expone: string[];
  usa: Uso[];
  datos: Dato[];
  /** Funcionalidades dueñas de los endpoints que esta llama, y las que llaman a los que esta expone. */
  usaFuncionalidades: string[];
  usadaPor: string[];
}

export interface PaginaFeat {
  id: string;
  codigo: string[];
  cuerpo: string;
}

const sinBacklinks = (cuerpo: string) => {
  const i = cuerpo.indexOf(MARCA_INICIO);
  if (i < 0) return cuerpo.trim();
  const f = cuerpo.indexOf(MARCA_FIN, i);
  return (cuerpo.slice(0, i) + (f >= 0 ? cuerpo.slice(f + MARCA_FIN.length) : "")).trim();
};

/** Aristas de todos los JSON de extracción; los que no se pueden leer se ignoran (los reporta `index`). */
export function aristasDeExtracciones(contenidos: string[]): AristaExtraccion[] {
  const out: AristaExtraccion[] = [];
  for (const c of contenidos) {
    try {
      const j = JSON.parse(c) as { aristas?: AristaExtraccion[] };
      for (const a of j.aristas ?? []) if (a && typeof a.evidencia === "string") out.push(a);
    } catch {
      /* ignorado */
    }
  }
  return out;
}

export function fichasDeFuncionalidades(graph: Graph, feats: PaginaFeat[], aristas: AristaExtraccion[]): Ficha[] {
  const nodo = new Map(graph.nodes.map((n) => [n.id, n]));
  const enCodigo = (ev: string | null | undefined, codigo: string[]) => !!ev && codigo.some((c) => dentroDe(ev, c));
  const dueñas = (ev: string | null | undefined, salvo: string) => (ev ? feats.filter((f) => f.id !== salvo && enCodigo(ev, f.codigo)).map((f) => f.id) : []);
  const evidenciaEndpoint = (id: string) => {
    const ev = nodo.get(id)?.atributos["evidencia"];
    return typeof ev === "string" ? ev : null;
  };

  const fichas = feats.map((f): Ficha => {
    const usa = new Map<string, Uso>();
    const datos = new Map<string, Dato>();
    const usaFeats = new Set<string>();
    for (const a of aristas) {
      if (!enCodigo(a.evidencia, f.codigo)) continue;
      if (a.verbo === "llama_a") {
        const k = `${a.hasta}\u0000${a.endpoint ?? ""}`;
        const u = usa.get(k);
        if (!u) usa.set(k, { hasta: a.hasta, endpoint: a.endpoint, evidencia: a.evidencia, veces: 1 });
        else {
          u.veces++;
          if (cmp(a.evidencia, u.evidencia) < 0) u.evidencia = a.evidencia;
        }
        if (a.endpoint) for (const d of dueñas(evidenciaEndpoint(a.endpoint), f.id)) usaFeats.add(d);
      } else if (a.verbo === "lee_de" || a.verbo === "escribe_en") {
        const d = datos.get(a.hasta) ?? { tabla: a.hasta, lee: 0, escribe: 0, evidencia: a.evidencia };
        if (a.verbo === "lee_de") d.lee++;
        else d.escribe++;
        if (cmp(a.evidencia, d.evidencia) < 0) d.evidencia = a.evidencia;
        datos.set(a.hasta, d);
      }
    }
    return {
      id: f.id,
      codigo: [...f.codigo].sort(cmp),
      cuerpo: sinBacklinks(f.cuerpo),
      archivos: graph.nodes.filter((n) => n.tipo === "archivo" && enCodigo(n.id, f.codigo)).length,
      implementan: [...new Set(graph.edges.filter((e) => e.verbo === "implementa" && e.hasta === f.id).map((e) => e.desde))].sort(cmp),
      expone: graph.nodes.filter((n) => n.tipo === "endpoint" && enCodigo(evidenciaEndpoint(n.id), f.codigo)).map((n) => n.id),
      usa: [...usa.values()].sort((a, b) => cmpTuple([a.hasta, a.endpoint ?? ""], [b.hasta, b.endpoint ?? ""])),
      datos: [...datos.values()].sort((a, b) => cmp(a.tabla, b.tabla)),
      usaFuncionalidades: [...usaFeats].sort(cmp),
      usadaPor: [],
    };
  });
  const porId = new Map(fichas.map((f) => [f.id, f]));
  for (const f of fichas) for (const u of f.usaFuncionalidades) porId.get(u)?.usadaPor.push(f.id);
  for (const f of fichas) f.usadaPor.sort(cmp);
  return fichas.sort((a, b) => cmp(a.id, b.id));
}

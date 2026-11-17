import { crearRecorredor, ES_TEST, LIMITES_PANTALLA, type AristaExtraccion, type EstructuraArchivo, type PaginaFeat, type Paso, type Toque } from "./funcionalidades.js";
import { CONFIANZA, dentroDe, ORIGENES, verboAdmite, type Graph, type GraphEdge, type Origen, type Verbo } from "./schema.js";

/**
 * Relaciones finas: lo que el grafo a nivel servicio no dice. Salen de la extracción y de los recorridos, con la
 * línea del acceso o de la llamada como evidencia:
 *
 * - endpoint → tabla (`lee_de`/`escribe_en`) y endpoint → servicio o externo (`llama_a`, con `endpoint` si se conoce):
 *   lo que toca el método que lo atiende y lo que llama, sin cruzar HTTP.
 * - pantalla → servicio (`llama_a`, con `endpoint`): las llamadas al back en el árbol de sus componentes.
 * - endpoint → funcionalidad (`implementa`): el handler está en el `codigo` de la funcionalidad.
 * - funcionalidad → tabla, servicio, externo o cola: accesos, llamadas y mensajes dentro de su `codigo`.
 * - endpoint → cola (`publica_en`/`consume_de`): los mensajes que publica o consume su recorrido.
 * - funcionalidad → funcionalidad (`depende_de`): llama a un endpoint que implementa la otra.
 * - funcionalidad → librería (`depende_de`): un archivo suyo importa o llama a uno del `codigo` de la librería.
 *
 * Cada arista hereda el origen y el dato del acceso o la llamada de la extracción de la que sale: una llamada
 * inferida da una relación inferida.
 */

const EV = /^([^:]+:[^#]+)(?:#L(\d+))?/;
const ES_VERBO_SERVICIO = new Set(["llama_a", "lee_de", "escribe_en", "publica_en", "consume_de"]);
/** Recorrido de un endpoint dentro de su servicio: completo, sin saltar a otros por HTTP. */
const LIMITES_ENDPOINT = { pasos: 200, nivel: 12 };

export function aristasFinas(
  graph: Graph,
  feats: PaginaFeat[],
  aristas: AristaExtraccion[],
  estructura: Map<string, EstructuraArchivo>,
  sinPagina: Array<{ verbo: string; tabla: string; evidencia: string }>,
  libs: Array<{ id: string; codigo: string[] }> = [],
): GraphEdge[] {
  const nodo = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: GraphEdge[] = [];
  type Cita = { evidencia: string; origen?: string | undefined; dato?: string | null | undefined };
  const agregar = (desde: string, verbo: Verbo, hasta: string, c: Cita, endpoint: string | null = null) => {
    const d = nodo.get(desde), h = nodo.get(hasta);
    if (!d || !h || desde === hasta || !verboAdmite(verbo, d.tipo, h.tipo)) return;
    if (endpoint !== null && nodo.get(endpoint)?.tipo !== "endpoint") endpoint = null;
    const origen: Origen = (ORIGENES as readonly string[]).includes(c.origen ?? "") && c.origen !== "curado" ? (c.origen as Origen) : "parser";
    out.push({ confianza: CONFIANZA[origen], dato: c.dato ?? null, desde, endpoint, estado: "vigente", evidencia: c.evidencia, hasta, origen, verbo });
  };

  // Accesos y llamadas por archivo, para citar la línea exacta de lo que toca un paso.
  const porArchivo = new Map<string, Array<{ linea: number; a: AristaExtraccion }>>();
  for (const a of aristas) {
    const m = EV.exec(a.evidencia);
    if (!m?.[2]) continue;
    (porArchivo.get(m[1]!) ?? porArchivo.set(m[1]!, []).get(m[1]!)!).push({ linea: Number(m[2]), a });
  }
  const citaDe = (p: Paso, t: Toque): Cita => {
    const m = EV.exec(p.evidencia);
    if (!m?.[2]) return { evidencia: p.evidencia };
    const desdeL = Number(m[2]);
    const s = estructura.get(m[1]!)?.simbolos.find((x) => x.nombre === p.simbolo && x.linea === desdeL);
    const hastaL = s?.fin ?? desdeL;
    const primero = (porArchivo.get(m[1]!) ?? [])
      .filter((x) => x.linea >= desdeL && x.linea <= hastaL && x.a.verbo === t.verbo && x.a.hasta === t.hasta && x.a.endpoint === t.endpoint)
      .sort((x, y) => x.linea - y.linea)[0];
    return primero ? primero.a : { evidencia: p.evidencia };
  };
  /** Lo que toca cada paso propio de un recorrido (los repetidos solo resumen lo ya visto). */
  const toques = (pasos: Paso[]) => pasos.filter((p) => !p.repite).flatMap((p) => p.toca.filter((t) => !t.sinPagina).map((t) => ({ p, t })));

  const rec = crearRecorredor(graph, estructura, aristas, sinPagina, LIMITES_ENDPOINT);
  const recPantalla = crearRecorredor(graph, estructura, aristas, sinPagina, LIMITES_PANTALLA);
  const enCodigo = (ev: string, codigo: string[]) => codigo.some((c) => dentroDe(ev, c));
  const dueñasDe = new Map<string, string[]>();

  for (const n of graph.nodes) {
    if (n.tipo === "endpoint") {
      const ev = n.atributos["evidencia"];
      const dueñas = typeof ev === "string" ? feats.filter((f) => enCodigo(ev, f.codigo)).map((f) => f.id) : [];
      dueñasDe.set(n.id, dueñas);
      for (const f of dueñas) agregar(n.id, "implementa", f, { evidencia: ev as string });
      for (const { p, t } of toques(rec.desdeEndpoint(n.id).pasos)) {
        if (t.verbo === "lee_de" || t.verbo === "escribe_en") agregar(n.id, t.verbo, t.hasta, citaDe(p, t));
        else if (t.verbo === "llama_a") agregar(n.id, "llama_a", t.hasta, citaDe(p, t), t.endpoint);
        else if (t.verbo === "publica_en" || t.verbo === "consume_de") agregar(n.id, t.verbo, t.hasta, citaDe(p, t));
      }
    } else if (n.tipo === "pantalla") {
      for (const c of (n.atributos as { componentes?: string[] }).componentes ?? []) {
        const i = c.lastIndexOf("#");
        if (i < 0) continue;
        for (const { p, t } of toques(recPantalla.desdeSimbolo(c.slice(0, i), c.slice(i + 1)).pasos)) {
          if (t.verbo === "llama_a") agregar(n.id, "llama_a", t.hasta, citaDe(p, t), t.endpoint);
        }
      }
    }
  }

  // Entre servicios: lo que el índice resolvió vale aunque la página del servicio no lo declare. Si la página lo
  // declara, gana la curada; así un brain recién indexado ya tiene sus relaciones sin editar páginas a mano.
  for (const a of aristas) {
    if (!ES_VERBO_SERVICIO.has(a.verbo) || nodo.get(a.desde)?.tipo !== "svc" || ES_TEST.test(a.evidencia.replace(/#L.*$/, ""))) continue;
    agregar(a.desde, a.verbo as Verbo, a.hasta, a, a.endpoint);
  }

  for (const f of feats) {
    for (const a of aristas) {
      if (!enCodigo(a.evidencia, f.codigo) || ES_TEST.test(a.evidencia.replace(/#L.*$/, ""))) continue;
      if (a.verbo === "lee_de" || a.verbo === "escribe_en" || a.verbo === "publica_en" || a.verbo === "consume_de") agregar(f.id, a.verbo, a.hasta, a);
      else if (a.verbo === "llama_a") {
        agregar(f.id, "llama_a", a.hasta, a, a.endpoint);
        for (const otra of a.endpoint ? (dueñasDe.get(a.endpoint) ?? []) : []) agregar(f.id, "depende_de", otra, { evidencia: a.evidencia, origen: a.origen });
      }
    }
  }
  // Código compartido: una funcionalidad (u otra librería) depende de una librería si un archivo suyo importa o llama
  // a uno de la librería. La evidencia es el archivo que importa, el primero en orden.
  if (libs.length) {
    const usan = new Map<string, string>();
    for (const [archivo, e] of [...estructura.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (ES_TEST.test(archivo.slice(archivo.indexOf(":") + 1))) continue;
      const repo = archivo.slice(0, archivo.indexOf(":"));
      const destinos = new Set([...e.importa, ...e.invoca.map((i) => i.archivo)].map((r) => `${repo}:${r}`));
      const dueños = [...feats, ...libs].filter((d) => enCodigo(archivo, d.codigo));
      for (const destino of destinos) {
        for (const lib of libs) {
          if (!enCodigo(destino, lib.codigo)) continue;
          for (const d of dueños) {
            const k = `${d.id}\u0000${lib.id}`;
            if (d.id !== lib.id && !enCodigo(destino, d.codigo) && !usan.has(k)) usan.set(k, archivo);
          }
        }
      }
    }
    for (const [k, archivo] of usan) agregar(k.slice(0, k.indexOf("\u0000")), "depende_de", k.slice(k.indexOf("\u0000") + 1), { evidencia: archivo });
  }
  return out;
}

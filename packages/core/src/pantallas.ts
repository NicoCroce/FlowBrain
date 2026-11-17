import { cmp } from "./canonical.js";
import type { EstructuraArchivo } from "./funcionalidades.js";

/**
 * Pantallas del front y navegación entre ellas, a partir de lo que extrae el parser (`_build/files/<repo>.json`).
 * Una pantalla navega a otra si su componente, o algo que el componente llama o dibuja, navega a esa ruta.
 */

export interface RefSimbolo {
  archivo: string;
  simbolo: string;
}
export interface PantallaCruda {
  paquete: string;
  ruta: string;
  archivo: string;
  linea: number;
  componente: RefSimbolo | null;
  envuelta: RefSimbolo[];
}
export interface NavegacionCruda {
  paquete: string;
  archivo: string;
  linea: number;
  desde: string | null;
  ruta: string;
  tipo: "navega" | "enlace" | "redirige";
}

export interface Salida {
  /** Pantalla destino (id) o `null` si la ruta no coincide con ninguna pantalla conocida. */
  a: string | null;
  ruta: string;
  tipo: NavegacionCruda["tipo"];
  evidencia: string;
}
export interface AtributosPantalla {
  ruta: string;
  /** Componentes que la dibujan (`repo:archivo#Simbolo`); más de uno si la misma ruta se declara varias veces. */
  componentes: string[];
  /** Dónde se declara la ruta. */
  evidencia: string;
  /** Layouts y guardas que la envuelven, de afuera hacia adentro, con a dónde llevan (menús, redirecciones). */
  envuelta: Array<{ componente: string; sale: Salida[] }>;
  /** A dónde lleva la pantalla misma. */
  sale: Salida[];
  /** Layouts o guardas (de cualquier pantalla) que llevan a esta: menús globales, redirecciones. */
  desdeEnvolturas: Array<{ componente: string; tipo: Salida["tipo"]; evidencia: string }>;
}
export interface NodoPantalla {
  id: string;
  nombre: string;
  aliases: string[];
  atributos: AtributosPantalla;
}

const PROFUNDIDAD = 8;
const esParam = (s: string) => s.startsWith("{") && s.endsWith("}");
const clave = (repo: string, r: RefSimbolo) => `${repo}:${r.archivo}#${r.simbolo}`;

/** Pantalla a la que lleva una ruta: igual, o con `{param}` en algún lado; gana la de más segmentos literales iguales. */
export function pantallaDeRuta<P extends { ruta: string }>(ruta: string, pantallas: P[]): P | null {
  const exacta = pantallas.find((p) => p.ruta === ruta);
  if (exacta) return exacta;
  const a = ruta.split("/");
  let mejor: P | null = null;
  let puntos = 0;
  for (const p of pantallas) {
    const b = p.ruta.split("/");
    if (a.length !== b.length || !a.every((s, i) => s === b[i] || esParam(s) || esParam(b[i]!))) continue;
    const n = a.filter((s, i) => s !== "" && !esParam(s) && s === b[i]).length;
    if (n > puntos) [mejor, puntos] = [p, n];
  }
  return mejor;
}

/** Símbolos (`repo:archivo#Simbolo`) y archivos que alcanza un símbolo siguiendo sus llamadas dentro del repo. */
function alcance(repo: string, inicio: RefSimbolo, estructura: Map<string, EstructuraArchivo>) {
  const simbolos = new Set<string>([clave(repo, inicio)]);
  const archivos = new Set<string>([inicio.archivo]);
  let frente: RefSimbolo[] = [inicio];
  for (let nivel = 0; nivel < PROFUNDIDAD && frente.length; nivel++) {
    const siguiente: RefSimbolo[] = [];
    for (const r of frente) {
      for (const i of estructura.get(`${repo}:${r.archivo}`)?.invoca ?? []) {
        if (i.desde !== r.simbolo || i.via) continue;
        const k = clave(repo, i);
        if (simbolos.has(k)) continue;
        simbolos.add(k);
        archivos.add(i.archivo);
        siguiente.push({ archivo: i.archivo, simbolo: i.simbolo });
      }
    }
    frente = siguiente;
  }
  // Datos que importa lo recorrido (`actionItems.ts` con `{ to: ROUTES.x }`): sus navegaciones sueltas también cuentan.
  const importados = new Set<string>();
  for (const a of archivos) for (const i of estructura.get(`${repo}:${a}`)?.importa ?? []) importados.add(i);
  return { simbolos, archivos, importados };
}

export function grafoDePantallas(
  repo: string,
  pantallas: PantallaCruda[],
  navegaciones: NavegacionCruda[],
  estructura: Map<string, EstructuraArchivo>,
  dueñoDe: (archivo: string) => string,
): { nodos: NodoPantalla[]; aristas: Array<{ desde: string; hasta: string; evidencia: string }> } {
  // Una pantalla por (dueño, ruta): la misma ruta declarada dos veces (rutas generadas, variantes) es una sola.
  const grupos = new Map<string, PantallaCruda[]>();
  for (const p of [...pantallas].sort((a, b) => cmp(a.archivo, b.archivo) || a.linea - b.linea)) {
    const id = `${dueñoDe(p.componente?.archivo ?? p.archivo)}:pantalla:${p.ruta}`;
    grupos.set(id, [...(grupos.get(id) ?? []), p]);
  }
  const conocidas = [...grupos.entries()].map(([id, ps]) => ({ id, ruta: ps[0]!.ruta }));
  const ev = (archivo: string, linea: number) => `${repo}:${archivo}#L${linea}`;
  const salidasDe = (refs: RefSimbolo[]): Salida[] => {
    const simbolos = new Set<string>();
    const archivos = new Set<string>();
    for (const r of refs) {
      const x = alcance(repo, r, estructura);
      x.simbolos.forEach((s) => simbolos.add(s));
      x.archivos.forEach((a) => archivos.add(a));
      x.importados.forEach((a) => archivos.add(a));
    }
    const out = new Map<string, Salida>();
    for (const n of navegaciones) {
      const alcanzada = n.desde ? simbolos.has(`${repo}:${n.archivo}#${n.desde}`) : archivos.has(n.archivo);
      if (!alcanzada) continue;
      const a = pantallaDeRuta(n.ruta, conocidas)?.id ?? null;
      const k = `${a ?? n.ruta}\u0000${n.tipo}`;
      if (!out.has(k)) out.set(k, { a, ruta: n.ruta, tipo: n.tipo, evidencia: ev(n.archivo, n.linea) });
    }
    return [...out.values()].sort((x, y) => cmp(x.a ?? x.ruta, y.a ?? y.ruta) || cmp(x.tipo, y.tipo));
  };

  const nodos: NodoPantalla[] = [];
  const aristas: Array<{ desde: string; hasta: string; evidencia: string }> = [];
  const envolturas = new Map<string, Salida[]>();
  for (const [id, ps] of grupos) {
    const comps = ps.flatMap((p) => (p.componente ? [p.componente] : []));
    const componentes = [...new Set(comps.map((c) => clave(repo, c)))];
    const envuelta: AtributosPantalla["envuelta"] = [];
    for (const e of ps[0]!.envuelta) {
      const k = clave(repo, e);
      if (!envolturas.has(k)) envolturas.set(k, salidasDe([e]));
      envuelta.push({ componente: k, sale: envolturas.get(k)! });
    }
    const sale = salidasDe(comps).filter((s) => s.a !== id);
    for (const s of sale) if (s.a && !aristas.some((x) => x.desde === id && x.hasta === s.a)) aristas.push({ desde: id, hasta: s.a, evidencia: s.evidencia });
    nodos.push({
      id,
      nombre: ps[0]!.ruta,
      aliases: [...new Set(comps.map((c) => c.simbolo))].sort(cmp),
      atributos: { ruta: ps[0]!.ruta, componentes, evidencia: ev(ps[0]!.archivo, ps[0]!.linea), envuelta, sale, desdeEnvolturas: [] },
    });
  }
  for (const [componente, salidas] of [...envolturas.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    for (const s of salidas) {
      const n = s.a ? nodos.find((x) => x.id === s.a) : undefined;
      if (n && !n.atributos.desdeEnvolturas.some((d) => d.componente === componente)) n.atributos.desdeEnvolturas.push({ componente, tipo: s.tipo, evidencia: s.evidencia });
    }
  }
  return { nodos: nodos.sort((a, b) => cmp(a.id, b.id)), aristas };
}

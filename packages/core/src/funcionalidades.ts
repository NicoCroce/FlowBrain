import { cmp, cmpTuple } from "./canonical.js";
import { MARCA_FIN, MARCA_INICIO } from "./render.js";
import { dentroDe, TEST_REF, type Especificacion, type Graph } from "./schema.js";

/**
 * Vista de producto de cada funcionalidad (`feat`), derivada de las rutas de su campo `codigo`:
 * qué expone, qué usa, qué datos toca y con qué otras funcionalidades se relaciona. Sale de la extracción de los
 * parsers (`_build/extraction/*.json`), que conserva cada llamada y cada acceso con su evidencia; el grafo, en cambio,
 * deduplica por (desde, verbo, hasta, endpoint) y se queda con una sola evidencia por par.
 */

export const RUTA_FUNCIONALIDADES = "_build/features.json";

export interface AristaExtraccion {
  desde: string;
  verbo: string;
  hasta: string;
  endpoint: string | null;
  evidencia: string;
  /** Presentes en la extracción de `flowbrain index`; ausentes en índices viejos. */
  origen?: string;
  dato?: string | null;
  /** Columnas leídas o escritas, en los accesos a tablas donde se conocen. */
  columnas?: string[];
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
  /** Cómo está construida: recorrido de cada endpoint y elementos de dominio que usa. */
  recorridos: Recorrido[];
  dominio: ElementoDominio[];
  /** Pantallas del front cuyo componente está en `codigo`, con su navegación y su recorrido hasta las llamadas al back. */
  pantallas: PantallaFicha[];
  /** Archivos de test que la prueban, con sus casos. */
  tests: TestDeFicha[];
  /** Requisitos de negocio y de producto declarados en su página, con sus archivos y los casos que los verifican. */
  especificaciones: EspecificacionDeFicha[];
}

export interface EspecificacionDeFicha {
  id: string;
  texto: string;
  tipo: Especificacion["tipo"];
  estado: NonNullable<Especificacion["estado"]>;
  /** Archivos que la cumplen, como se declararon (`repo:ruta` o `repo:ruta#Ln`). */
  archivos: string[];
  /** Casos que la verifican: con `caso` y `linea`, uno; sin `caso`, el archivo entero y cuántos casos tiene. */
  tests: Array<{ archivo: string; caso?: string; linea?: number; casos?: number }>;
  /** Referencias que el índice ya no encuentra (archivo movido, caso renombrado): hay que corregirlas en la página. */
  rotos: string[];
}

export interface PantallaFicha {
  id: string;
  ruta: string;
  /** Componente que la dibuja (`repo:archivo#Simbolo`), el de esta funcionalidad si hay varios. */
  componente: string | null;
  /** Layouts y guardas que la envuelven, de afuera hacia adentro. */
  envuelta: Array<{ componente: string; sale: Array<{ a: string | null; ruta: string; tipo: string; evidencia: string }> }>;
  /** Pantallas que llevan a esta (`desde` es un id de pantalla) o layouts/guardas (`desde` es su componente). */
  llegaDesde: Array<{ desde: string; evidencia: string; tipo?: string }>;
  vaA: Array<{ a: string | null; ruta: string; tipo: string; evidencia: string }>;
  /** Endpoints que llama, en el orden del recorrido. */
  endpoints: string[];
  recorrido: { pasos: Paso[]; truncado?: true };
}

/** Capa de un archivo, por convención de nombres (sufijo del archivo y, si no, la carpeta más profunda que coincida). */
export type Capa = "entrada" | "logica" | "dominio" | "datos" | "interfaz" | "otros";
export const CAPAS: readonly Capa[] = ["entrada", "logica", "dominio", "datos", "interfaz", "otros"];

const SUFIJOS: Array<[RegExp, Capa]> = [
  [/[.-](controller|resolver|routes?|router|gateway)\.[^.]+$|Controller\.php$|(^|\/)route\.[cm]?[jt]sx?$/i, "entrada"],
  [/[.-](service|use-?case|interactor|command|handler|saga|job|listener|action)\.[^.]+$|(Service|Action|Job|Listener)\.php$/i, "logica"],
  [/[.-](repository|repo|dao|sql|migration|client|adapter|api)\.[^.]+$|Repository\.php$/i, "datos"],
  [/[.-](entity|model|vo|value-object|aggregate|enum|types?)\.[^.]+$|(^|\/)(types?|models?|entities)\.[^./]+$/i, "dominio"],
  [/\.(tsx|jsx|vue|svelte|blade\.php|twig)$/i, "interfaz"],
];
const CARPETAS: Array<[RegExp, Capa]> = [
  [/^(controllers?|routes?|resolvers?|endpoints?)$/i, "entrada"],
  [/^(services?|application|use-?cases?|usecases|actions|commands|queries|hooks|store|stores|slices|state|jobs|listeners)$/i, "logica"],
  [/^(domain|domains|entities|entity|models?|value-?objects?|types|enums)$/i, "dominio"],
  [/^(repositor(y|ies)|persistence|infrastructure|infra|db|database|migrations|dao|api|clients?|adapters|integrations|external)$/i, "datos"],
  [/^(components?|pages?|views?|screens?|ui|layouts?|templates|resources)$/i, "interfaz"],
];

export function capaDe(ruta: string): Capa {
  for (const [re, c] of SUFIJOS) if (re.test(ruta)) return c;
  const carpetas = ruta.split("/").slice(0, -1).reverse();
  for (const d of carpetas) for (const [re, c] of CARPETAS) if (re.test(d)) return c;
  return "otros";
}

/** Lo que guarda `_build/files/*.json` de cada archivo, por `repo:ruta`. */
export interface EstructuraArchivo {
  simbolos: Array<{ nombre: string; tipo: string; linea: number; fin?: number | undefined }>;
  importa: string[];
  invoca: Array<{ desde: string; archivo: string; simbolo: string; linea: number; via?: string | undefined }>;
  /** Tipos, interfaces, enums, clases y constantes del repo que nombra cada símbolo (de `_build/files`). */
  referencias?: Array<{ desde: string; archivo: string; simbolo: string; linea: number }> | undefined;
  /** Llamadas que el parser no pudo atribuir (tipo `any`, interfaz sin implementación conocida). */
  sinResolver?: Array<{ desde: string; linea: number; llamada: string; candidatos?: string[] | undefined; motivo?: string | undefined }> | undefined;
  /** Casos de prueba que define, si es un archivo de test. Vacío: es un test, pero no se le pudieron leer los casos. */
  casos?: CasoDeTest[] | undefined;
}

export interface CasoDeTest {
  nombre: string;
  linea: number;
  /** Los `describe`/`context` que lo contienen, de afuera hacia adentro. */
  grupo?: string | undefined;
}

/** Un archivo de test de una funcionalidad. */
export interface TestDeFicha {
  archivo: string;
  casos: CasoDeTest[];
  /**
   * Por qué es de esta funcionalidad: `ubicacion`, está dentro de su `codigo`; `importa`, está en otro lado y de
   * ninguna otra funcionalidad importa más archivos que de esta.
   */
  por: "ubicacion" | "importa";
}

/** Lo que toca un paso: una tabla (`lee_de`/`escribe_en`), un servicio o externo (`llama_a`) o una cola (`publica_en`/`consume_de`). */
export interface Toque {
  verbo: string;
  hasta: string;
  endpoint: string | null;
  /** La tabla existe en el código pero no tiene página en el brain: `hasta` es su nombre físico. */
  sinPagina?: true;
  /** Columnas de la tabla que ese paso lee o escribe, si el índice las conoce. */
  columnas?: string[];
}

/** Accesos a tablas que el índice no pudo resolver porque la tabla no tiene página (`pendientes` de la extracción). */
export function tablasSinPagina(contenidos: string[]): Array<{ verbo: string; tabla: string; evidencia: string }> {
  const out: Array<{ verbo: string; tabla: string; evidencia: string }> = [];
  for (const c of contenidos) {
    try {
      const j = JSON.parse(c) as { pendientes?: Array<{ verbo: string; referencia: string; objetivo?: string; evidencia: string; candidatos?: unknown[] }> };
      for (const p of j.pendientes ?? []) {
        if ((p.verbo === "lee_de" || p.verbo === "escribe_en") && !p.candidatos?.length) out.push({ verbo: p.verbo, tabla: p.objetivo ?? p.referencia, evidencia: p.evidencia });
      }
    } catch {
      /* ignorado */
    }
  }
  return out;
}

export interface Paso {
  simbolo: string;
  evidencia: string;
  capa: Capa;
  /** Profundidad en el recorrido (0 = el método que atiende el endpoint) y quién lo llama. */
  nivel: number;
  desde: string | null;
  toca: Toque[];
  /** Hueco conocido: p. ej. un repositorio sin acceso a tabla detectado. Ausente si no hay nada que advertir. */
  aviso?: string;
  /**
   * El método ya apareció antes en este recorrido: no se expande de nuevo y `toca` resume lo que tocó esa vez
   * (él y lo que llama). `ciclo` si se llega a sí mismo mientras se recorre (recursión).
   */
  repite?: "antes" | "ciclo";
  /** Se llega en diferido, por un evento o una cola con esta clave; o por HTTP (`HTTP <endpoint>`) al cruzar de servicio. */
  via?: string;
}

export interface Recorrido {
  endpoint: string;
  /** Pasos en orden de llamada (recorrido en profundidad). Vacío si no se encontró el método que lo atiende. */
  pasos: Paso[];
  /** Presente si el recorrido se cortó por profundidad o cantidad de pasos. */
  truncado?: true;
}

export interface ElementoDominio {
  archivo: string;
  /** Clases, interfaces, tipos y enums del archivo; las funciones solo se cuentan. */
  elementos: string[];
  funciones: number;
  /** Funcionalidad dueña del archivo, si es otra. */
  de: string | null;
  /** Otras funcionalidades que también lo usan. */
  usadoPor: string[];
}

export interface PaginaFeat {
  id: string;
  codigo: string[];
  cuerpo: string;
  especificaciones?: Especificacion[];
}

const llano = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Une cada especificación con el índice: el caso de test por su nombre (o `grupo › nombre`), no por su línea, que se
 * corre con cada cambio. Lo que no se encuentra queda en `rotos`; de un repo sin indexar no se puede saber, y no se marca.
 */
export function resolverEspecificaciones(especificaciones: Especificacion[], estructura: Map<string, EstructuraArchivo>): EspecificacionDeFicha[] {
  const indexados = new Set([...estructura.keys()].map((k) => k.slice(0, k.indexOf(":"))));
  return especificaciones.map((e) => {
    const rotos: string[] = [];
    for (const a of e.archivos ?? []) {
      const k = a.replace(/#.*$/, "");
      if (indexados.has(k.slice(0, k.indexOf(":"))) && !estructura.has(k)) rotos.push(a);
    }
    const tests: EspecificacionDeFicha["tests"] = [];
    for (const t of e.tests ?? []) {
      const m = TEST_REF.exec(t);
      if (!m) continue;
      const archivo = `${m[1]}:${m[2]}`;
      const casos = estructura.get(archivo)?.casos;
      if (!casos) {
        if (indexados.has(m[1]!)) rotos.push(t);
        else tests.push({ archivo, ...(m[3] ? { caso: m[3].trim() } : {}) });
        continue;
      }
      if (!m[3]) {
        tests.push({ archivo, casos: casos.length });
        continue;
      }
      const q = llano(m[3]);
      const c = casos.find((x) => llano(x.nombre) === q) ?? casos.find((x) => llano(`${x.grupo ?? ""} › ${x.nombre}`) === q);
      if (c) tests.push({ archivo, caso: c.nombre, linea: c.linea });
      else rotos.push(t);
    }
    return { id: e.id, texto: e.texto, tipo: e.tipo, estado: e.estado ?? "propuesta", archivos: [...(e.archivos ?? [])], tests, rotos };
  });
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
      // `accesos` trae cada acceso con su evidencia; `aristas` (índices viejos) solo uno por par.
      const j = JSON.parse(c) as { aristas?: AristaExtraccion[]; accesos?: AristaExtraccion[] };
      for (const a of j.accesos ?? j.aristas ?? []) if (a && typeof a.evidencia === "string") out.push(a);
    } catch {
      /* ignorado */
    }
  }
  return out;
}

const TIPOS_DOMINIO = new Set(["clase", "interfaz", "tipo", "enum"]);
export const ES_TEST = /[._-](test|spec)\.[^./]+$|(^|\/)(__tests__|__mocks__|tests?|e2e|cypress|fixtures)\//;

/**
 * Deja los pasos que importan: métodos de clases y lo que toca datos o servicios. Las funciones sueltas que no tocan
 * nada (formatear, validar, escapar) se omiten y sus hijos cuelgan del paso visible más cercano.
 */
export function podar(pasos: Paso[]): Paso[] {
  // Las funciones en el camino hacia algo que toca datos o servicios también se ven: en el front son los
  // componentes y hooks entre la pantalla y la llamada a la API.
  const camino = new Set<Paso>();
  pasos.forEach((p, i) => {
    if (!p.toca.length || p.repite) return;
    let nivel = p.nivel;
    for (let j = i - 1; j >= 0 && nivel > 0; j--) {
      if (pasos[j]!.nivel < nivel) {
        camino.add(pasos[j]!);
        nivel = pasos[j]!.nivel;
      }
    }
  });
  const visible = (p: Paso) => p.nivel === 0 || p.simbolo.includes(".") || p.toca.length > 0 || camino.has(p);
  const out: Paso[] = [];
  const pila: Array<{ nivel: number; visible: Paso | null }> = [];
  for (const p of pasos) {
    while (pila.length && pila[pila.length - 1]!.nivel >= p.nivel) pila.pop();
    const padre = [...pila].reverse().find((x) => x.visible)?.visible ?? null;
    if (visible(p)) {
      const q = { ...p, nivel: padre ? padre.nivel + 1 : 0, desde: padre ? padre.simbolo : null };
      out.push(q);
      pila.push({ nivel: p.nivel, visible: q });
    } else pila.push({ nivel: p.nivel, visible: null });
  }
  return out;
}
/** Solo la raíz, lo que toca datos o servicios y los pasos en el camino hacia eso (para recorridos de pantallas). */
export function soloCamino(pasos: Paso[]): Paso[] {
  const quedan = new Set<number>();
  pasos.forEach((p, i) => {
    if (p.nivel === 0) quedan.add(i);
    if (!p.toca.length) return;
    quedan.add(i);
    let nivel = p.nivel;
    for (let j = i - 1; j >= 0 && nivel > 0; j--) if (pasos[j]!.nivel < nivel) { quedan.add(j); nivel = pasos[j]!.nivel; }
  });
  return pasos.filter((_, i) => quedan.has(i));
}
/** Límites del recorrido: pasos visibles (los que quedan después de `podar`) y profundidad. */
export interface LimitesRecorrido {
  pasos: number;
  nivel: number;
  /** Seguir una llamada HTTP a un endpoint conocido hasta el método que lo atiende (front → back, servicio → servicio). */
  cruzarHttp?: boolean;
}
/** Para la ficha del visor: lo que una persona lee. */
export const LIMITES_FICHA: LimitesRecorrido = { pasos: 25, nivel: 6 };
/** Para las pantallas de la ficha: el árbol de componentes es ancho; se recorre hondo y después queda solo el camino a la API. */
export const LIMITES_PANTALLA: LimitesRecorrido = { pasos: 300, nivel: 12 };
/** Para las consultas de un agente: completo; el presupuesto de tokens recorta después. */
export const LIMITES_AGENTE: LimitesRecorrido = { pasos: 200, nivel: 12, cruzarHttp: true };
const EV = /^([^:]+:[^#]+)(?:#L(\d+))?/;
const elementos = (e: EstructuraArchivo | undefined) => (e?.simbolos ?? []).filter((s) => s.tipo !== "metodo" && s.tipo !== "constante").map((s) => s.nombre);

/** Método o función que atiende la línea de un endpoint: el que la contiene, o el siguiente método si la línea es su decorador. */
export function simboloDeLinea(e: EstructuraArchivo, linea: number): EstructuraArchivo["simbolos"][number] | null {
  const fn = e.simbolos.filter((s) => s.tipo === "metodo" || s.tipo === "funcion");
  const dentro = fn.filter((s) => s.linea <= linea && linea <= (s.fin ?? s.linea));
  if (dentro.length) return dentro.reduce((a, b) => (b.linea > a.linea ? b : a));
  const despues = fn.filter((s) => s.tipo === "metodo" && s.linea > linea && s.linea - linea <= 40);
  return despues.length ? despues.reduce((a, b) => (b.linea < a.linea ? b : a)) : null;
}

const PARECE_REPOSITORIO = /repositor|[/.-]dao[/.]|[.-]sql\.|Repository\.php$/i;
export const AVISO_SIN_TABLA = "no se detectó a qué tabla accede (posible SQL armado a mano o tabla dinámica)";

/** Marca los pasos de repositorio que no tocan ninguna tabla, ni ellos ni lo que llaman: el silencio no es "no toca nada". */
function marcarHuecos(pasos: Paso[]): Paso[] {
  return pasos.map((p, i) => {
    if (p.toca.length || p.repite === "ciclo" || !PARECE_REPOSITORIO.test(p.evidencia)) return p;
    for (let j = i + 1; j < pasos.length && pasos[j]!.nivel > p.nivel; j++) if (pasos[j]!.toca.length) return p;
    return { ...p, aviso: AVISO_SIN_TABLA };
  });
}

/** Lo que un método puede tocar: tablas, servicios y colas. */
const VERBOS_TOQUE = new Set(["lee_de", "escribe_en", "llama_a", "publica_en", "consume_de"]);
const mismoToque = (a: Toque, b: Toque) => a.verbo === b.verbo && a.hasta === b.hasta && a.endpoint === b.endpoint;
const ordenToque = (a: Toque, b: Toque) => cmpTuple([a.verbo, a.hasta, a.endpoint ?? ""], [b.verbo, b.hasta, b.endpoint ?? ""]);

export interface Recorredor {
  /** Método o función que atiende un endpoint (por la evidencia del endpoint). */
  atiende(endpoint: string): { archivo: string; simbolo: string } | null;
  desdeEndpoint(endpoint: string): Recorrido;
  desdeSimbolo(archivo: string, simbolo: string): { pasos: Paso[]; truncado: boolean };
}

/** Recorridos sobre las invocaciones de `_build/files`, con los accesos y llamadas de la extracción atribuidos a cada método. */
export function crearRecorredor(
  graph: Graph,
  estructura: Map<string, EstructuraArchivo>,
  aristas: AristaExtraccion[],
  sinPagina: Array<{ verbo: string; tabla: string; evidencia: string }> = [],
  limites: LimitesRecorrido = LIMITES_FICHA,
): Recorredor {
  const nodo = new Map(graph.nodes.map((n) => [n.id, n]));
  const toques = new Map<string, Array<{ linea: number; toque: Toque }>>();
  for (const a of aristas) {
    if (!VERBOS_TOQUE.has(a.verbo)) continue;
    const m = EV.exec(a.evidencia);
    if (!m?.[2]) continue;
    toques.set(m[1]!, [...(toques.get(m[1]!) ?? []), { linea: Number(m[2]), toque: { verbo: a.verbo, hasta: a.hasta, endpoint: a.endpoint, ...(a.columnas?.length ? { columnas: a.columnas } : {}) } }]);
  }
  for (const p of sinPagina) {
    const m = EV.exec(p.evidencia);
    if (!m?.[2]) continue;
    toques.set(m[1]!, [...(toques.get(m[1]!) ?? []), { linea: Number(m[2]), toque: { verbo: p.verbo, hasta: p.tabla, endpoint: null, sinPagina: true } }]);
  }
  const atiende = (ep: string) => {
    const ev = nodo.get(ep)?.atributos["evidencia"];
    const m = typeof ev === "string" ? EV.exec(ev) : null;
    const e = m?.[2] ? estructura.get(m[1]!) : undefined;
    const h = e ? simboloDeLinea(e, Number(m![2])) : null;
    return h ? { archivo: m![1]!, simbolo: h.nombre } : null;
  };
  const desdeSimbolo = (inicio: string, simboloInicio: string) => {
    const pasos: Paso[] = [];
    let truncado = false;
    // Lo que tocó cada método visitado, sumando lo que llama; `null` mientras se está recorriendo (recursión).
    const resumen = new Map<string, Toque[] | null>();
    let visibles = 0;
    const visitar = (archivo: string, simbolo: string, nivel: number, desde: string | null, via?: string) => {
      const k = `${archivo}#${simbolo}`;
      // Solo cuentan los pasos que se ven; las funciones sueltas que no tocan nada se podan después.
      if (visibles >= limites.pasos || pasos.length >= limites.pasos * 5 || nivel > limites.nivel) {
        truncado = true;
        return;
      }
      const est = estructura.get(archivo);
      const s = est?.simbolos.find((x) => x.nombre === simbolo);
      const desdeL = s?.linea ?? 1, hastaL = s?.fin ?? desdeL;
      const base = { simbolo, evidencia: `${archivo}#L${desdeL}`, capa: capaDe(archivo.slice(archivo.indexOf(":") + 1)), nivel, desde, ...(via ? { via } : {}) };
      if (resumen.has(k)) {
        const r = resumen.get(k);
        pasos.push({ ...base, toca: r ? [...r] : [], repite: r ? "antes" : "ciclo" });
        if (simbolo.includes(".") || r?.length) visibles++;
        return;
      }
      resumen.set(k, null);
      const toca: Toque[] = [];
      for (const t of toques.get(archivo) ?? []) {
        if (t.linea < desdeL || t.linea > hastaL) continue;
        const ya = toca.find((x) => mismoToque(x, t.toque));
        // Dos accesos a la misma tabla en el mismo método: un toque, con las columnas de los dos.
        if (!ya) toca.push({ ...t.toque });
        else if (t.toque.columnas?.length) ya.columnas = [...new Set([...(ya.columnas ?? []), ...t.toque.columnas])].sort();
      }
      toca.sort(ordenToque);
      const desdeI = pasos.length;
      pasos.push({ ...base, toca });
      if (nivel === 0 || simbolo.includes(".") || toca.length) visibles++;
      const repo = archivo.slice(0, archivo.indexOf(":"));
      const hijos = new Set<string>();
      for (const i of est?.invoca ?? []) {
        if (i.desde !== simbolo) continue;
        const h = `${i.archivo}#${i.simbolo}\u0000${i.via ?? ""}`;
        if (hijos.has(h)) continue;
        hijos.add(h);
        visitar(`${repo}:${i.archivo}`, i.simbolo, nivel + 1, simbolo, i.via);
      }
      if (limites.cruzarHttp) {
        for (const t of toca) {
          const h = t.verbo === "llama_a" && t.endpoint ? atiende(t.endpoint) : null;
          if (h) visitar(h.archivo, h.simbolo, nivel + 1, simbolo, `HTTP ${t.endpoint}`);
        }
      }
      const total: Toque[] = [];
      for (const p of pasos.slice(desdeI)) for (const t of p.toca) if (!total.some((x) => mismoToque(x, t))) total.push(t);
      resumen.set(k, total.sort(ordenToque));
    };
    visitar(inicio, simboloInicio, 0, null);
    return { pasos: marcarHuecos(podar(pasos)), truncado };
  };
  return {
    atiende,
    desdeSimbolo,
    desdeEndpoint: (ep) => {
      const h = atiende(ep);
      if (!h) return { endpoint: ep, pasos: [] };
      const r = desdeSimbolo(h.archivo, h.simbolo);
      return r.truncado ? { endpoint: ep, pasos: r.pasos, truncado: true } : { endpoint: ep, pasos: r.pasos };
    },
  };
}

export function fichasDeFuncionalidades(
  graph: Graph,
  feats: PaginaFeat[],
  aristas: AristaExtraccion[],
  estructura: Map<string, EstructuraArchivo> = new Map(),
  sinPagina: Array<{ verbo: string; tabla: string; evidencia: string }> = [],
): Ficha[] {
  const nodo = new Map(graph.nodes.map((n) => [n.id, n]));
  const enCodigo = (ev: string | null | undefined, codigo: string[]) => !!ev && codigo.some((c) => dentroDe(ev, c));
  const dueñas = (ev: string | null | undefined, salvo: string) => (ev ? feats.filter((f) => f.id !== salvo && enCodigo(ev, f.codigo)).map((f) => f.id) : []);
  const evidenciaEndpoint = (id: string) => {
    const ev = nodo.get(id)?.atributos["evidencia"];
    return typeof ev === "string" ? ev : null;
  };

  const rec = crearRecorredor(graph, estructura, aristas, sinPagina);
  const recPantalla = crearRecorredor(graph, estructura, aristas, sinPagina, LIMITES_PANTALLA);
  const entrantes = new Map<string, Array<{ desde: string; evidencia: string }>>();
  for (const e of graph.edges) if (e.verbo === "navega_a") entrantes.set(e.hasta, [...(entrantes.get(e.hasta) ?? []), { desde: e.desde, evidencia: e.evidencia ?? "" }]);
  const pantallasDe = (codigo: string[]): PantallaFicha[] =>
    graph.nodes
      .filter((n) => n.tipo === "pantalla")
      .flatMap((n): PantallaFicha[] => {
        const a = n.atributos as { ruta: string; componentes: string[]; envuelta: PantallaFicha["envuelta"]; sale: PantallaFicha["vaA"]; desdeEnvolturas?: Array<{ componente: string; tipo: string; evidencia: string }> };
        const propio = a.componentes.find((c) => enCodigo(c.slice(0, c.lastIndexOf("#")), codigo));
        if (!propio) return [];
        // Lo que la envuelve (layouts y guardas) primero: sus llamadas también son de la pantalla.
        const crudos = [...a.envuelta.map((e) => e.componente).filter((c) => c !== propio), propio]
          .map((c) => ({ c, r: recPantalla.desdeSimbolo(c.slice(0, c.lastIndexOf("#")), c.slice(c.lastIndexOf("#") + 1)) }))
          .filter((x) => x.c === propio || x.r.pasos.some((p) => p.toca.length))
          .map((x) => x.r);
        const r = { pasos: soloCamino(crudos.flatMap((c) => c.pasos)), truncado: crudos.some((c) => c.truncado) };
        const endpoints = [...new Set(r.pasos.flatMap((p) => p.toca.flatMap((t) => (t.verbo === "llama_a" && t.endpoint ? [t.endpoint] : []))))];
        return [
          {
            id: n.id,
            ruta: a.ruta,
            componente: propio,
            envuelta: a.envuelta,
            llegaDesde: [...(entrantes.get(n.id) ?? []), ...(a.desdeEnvolturas ?? []).map((d) => ({ desde: d.componente, evidencia: d.evidencia, tipo: d.tipo }))],
            vaA: a.sale,
            endpoints,
            recorrido: { pasos: r.pasos, ...(r.truncado ? { truncado: true as const } : {}) },
          },
        ];
      })
      .sort((x, y) => cmp(x.ruta, y.ruta));
  const recorrido = rec.desdeEndpoint;
  const dominiosDe = new Map<string, Set<string>>();

  // Tests de cada funcionalidad. Un test que vive en el código de una funcionalidad es de esa. Uno que vive afuera
  // (una carpeta `tests/` aparte) es de la funcionalidad de la que más archivos importa; si empatan, de todas ellas.
  const testsDe = new Map<string, TestDeFicha[]>();
  for (const [k, e] of estructura) {
    // Es un test si el índice le leyó casos (`casos` viene, aunque vacío, en todo archivo de test).
    if (!e.casos) continue;
    const agregar = (id: string, por: TestDeFicha["por"]) => (testsDe.get(id) ?? testsDe.set(id, []).get(id)!).push({ archivo: k, casos: e.casos!, por });
    const dueñasDelTest = feats.filter((f) => enCodigo(k, f.codigo));
    if (dueñasDelTest.length) {
      for (const f of dueñasDelTest) agregar(f.id, "ubicacion");
      continue;
    }
    const repo = k.slice(0, k.indexOf(":"));
    const cuenta = new Map<string, number>();
    for (const i of e.importa) {
      if (ES_TEST.test(i)) continue;
      for (const f of feats) if (enCodigo(`${repo}:${i}`, f.codigo)) cuenta.set(f.id, (cuenta.get(f.id) ?? 0) + 1);
    }
    const max = Math.max(0, ...cuenta.values());
    for (const [id, n] of cuenta) if (n === max) agregar(id, "importa");
  }

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
    const propios = [...estructura.keys()].filter((k) => enCodigo(k, f.codigo) && !ES_TEST.test(k)).sort(cmp);
    const expone = graph.nodes.filter((n) => n.tipo === "endpoint" && enCodigo(evidenciaEndpoint(n.id), f.codigo)).map((n) => n.id);
    const recorridos = expone.map((ep) => recorrido(ep));
    const dominio = new Set<string>();
    const agregarDominio = (k: string) => {
      const e = estructura.get(k);
      if (!e) return;
      if (capaDe(k.slice(k.indexOf(":") + 1)) === "dominio") dominio.add(k);
      const repo = k.slice(0, k.indexOf(":"));
      for (const i of e.importa) if (capaDe(i) === "dominio" && !ES_TEST.test(i)) dominio.add(`${repo}:${i}`);
    };
    propios.forEach(agregarDominio);
    for (const r of recorridos) for (const p of r.pasos) agregarDominio(EV.exec(p.evidencia)![1]!);
    dominiosDe.set(f.id, dominio);
    const tests = (testsDe.get(f.id) ?? []).sort((a, b) => cmp(a.archivo, b.archivo));
    return {
      tests,
      especificaciones: resolverEspecificaciones(f.especificaciones ?? [], estructura),
      recorridos,
      dominio: [],
      id: f.id,
      codigo: [...f.codigo].sort(cmp),
      cuerpo: sinBacklinks(f.cuerpo),
      archivos: graph.nodes.filter((n) => n.tipo === "archivo" && enCodigo(n.id, f.codigo)).length,
      implementan: [...new Set(graph.edges.filter((e) => e.verbo === "implementa" && e.hasta === f.id).map((e) => e.desde))].sort(cmp),
      expone,
      usa: [...usa.values()].sort((a, b) => cmpTuple([a.hasta, a.endpoint ?? ""], [b.hasta, b.endpoint ?? ""])),
      datos: [...datos.values()].sort((a, b) => cmp(a.tabla, b.tabla)),
      usaFuncionalidades: [...usaFeats].sort(cmp),
      usadaPor: [],
      pantallas: pantallasDe(f.codigo),
    };
  });
  const porId = new Map(fichas.map((f) => [f.id, f]));
  for (const f of fichas) for (const u of f.usaFuncionalidades) porId.get(u)?.usadaPor.push(f.id);
  for (const f of fichas) f.usadaPor.sort(cmp);
  const dueña = (k: string) => feats.find((f) => enCodigo(k, f.codigo))?.id ?? null;
  for (const f of fichas) {
    f.dominio = [...(dominiosDe.get(f.id) ?? [])].sort(cmp).map((k) => {
      const de = dueña(k);
      return {
        archivo: k,
        elementos: (estructura.get(k)?.simbolos ?? []).filter((s) => TIPOS_DOMINIO.has(s.tipo)).map((s) => s.nombre),
        funciones: (estructura.get(k)?.simbolos ?? []).filter((s) => s.tipo === "funcion").length,
        de: de === f.id ? null : de,
        usadoPor: fichas.filter((g) => g.id !== f.id && dominiosDe.get(g.id)?.has(k)).map((g) => g.id),
      };
    });
  }
  return fichas.sort((a, b) => cmp(a.id, b.id));
}

/** Contratos entre parsers e indexador. Todo lo que sale de un parser es crudo: sin ids de nodos. */

export interface RepoFuente {
  /** Ruta absoluta al repo. */
  raiz: string;
  /** Archivos relativos a la raíz, con `/`, ordenados. Excluye node_modules, dist, etc. */
  archivos: string[];
  /** Raíces de paquete (apps) relativas a la raíz; `""` es la raíz misma. Ordenadas. */
  paquetes: string[];
}

export interface Simbolo {
  linea: number;
  nombre: string;
  tipo: string;
}

export interface ArchivoCrudo {
  lenguaje: string;
  ruta: string;
  simbolos: Simbolo[];
}

export interface EndpointCrudo {
  paquete: string;
  metodo: string;
  ruta: string;
  request: string | null;
  response: string | null;
  archivo: string;
  linea: number;
}

/** URL analizada estáticamente. `ruta` usa `{param}` para segmentos dinámicos. */
export interface UrlAnalizada {
  /** `literal`: host escrito en el código; `dinamica`: viene de env/variables; `relativa`: sin host. */
  base: "literal" | "dinamica" | "relativa";
  host: string | null;
  ruta: string | null;
  /** Texto reconstruido, con `${…}` en las partes dinámicas. */
  texto: string;
}

export interface LlamadaCruda {
  paquete: string;
  archivo: string;
  linea: number;
  metodo: string;
  url: UrlAnalizada;
  /** Nombre del tipo del cuerpo enviado, si se puede determinar. */
  dato: string | null;
}

export interface AccesoTabla {
  paquete: string;
  archivo: string;
  linea: number;
  modelo: string;
  verbo: "lee_de" | "escribe_en";
}

export interface ModeloCrudo {
  paquete: string;
  nombre: string;
  /** Nombre físico de la tabla si difiere del modelo (`@@map`, `@Entity("x")`). */
  tabla: string | null;
  archivo: string;
  linea: number;
}

export type Forma = Record<string, string>;

export interface Extraccion {
  parser: string;
  archivos: ArchivoCrudo[];
  endpoints: EndpointCrudo[];
  llamadas: LlamadaCruda[];
  tablas: AccesoTabla[];
  modelos: ModeloCrudo[];
  /** Formas de tipos declarados, por paquete y nombre. */
  formas: Record<string, Record<string, Forma>>;
  /** Paquetes cuyos endpoints declara este parser con autoridad (OpenAPI). */
  autoritativo: string[];
}

export interface Parser {
  nombre: string;
  detect(repo: RepoFuente): boolean;
  extract(repo: RepoFuente): Extraccion;
}

export const extraccionVacia = (parser: string): Extraccion => ({
  parser,
  archivos: [],
  endpoints: [],
  llamadas: [],
  tablas: [],
  modelos: [],
  formas: {},
  autoritativo: [],
});

/** Paquete (raíz de app más larga) que contiene un archivo. */
export function paqueteDe(repo: RepoFuente, archivo: string): string {
  let mejor = "";
  for (const p of repo.paquetes) if (p !== "" && (archivo === p || archivo.startsWith(p + "/")) && p.length > mejor.length) mejor = p;
  return mejor;
}

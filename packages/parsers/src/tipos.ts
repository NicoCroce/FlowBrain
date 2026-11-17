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
  /** Última línea del símbolo, si el parser la conoce (para atribuir una línea al método que la contiene). */
  fin?: number;
}

/** Un método o función que llama a otro símbolo del repo (`Clase.metodo` o `funcion`). */
export interface Invocacion {
  desde: string;
  archivo: string;
  simbolo: string;
  linea: number;
  /** Llamada indirecta: por un evento o una cola con esta clave (`emit("x")` → `@OnEvent("x")`, `enqueue(JOB)` → `register(JOB, …)`). */
  via?: string;
}

/** Llamada que el análisis no pudo atribuir a un símbolo del repo (tipo `any`, interfaz sin implementación conocida). */
export interface LlamadaSinResolver {
  desde: string;
  linea: number;
  llamada: string;
}

export interface ArchivoCrudo {
  lenguaje: string;
  ruta: string;
  simbolos: Simbolo[];
  /** Archivos del mismo repo que importa, ordenados. */
  importa?: string[];
  /** Llamadas de sus métodos y funciones a símbolos de otros archivos o clases del repo. */
  invoca?: Invocacion[];
  sinResolver?: LlamadaSinResolver[];
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

/** Símbolo del repo: archivo y nombre (`funcion` o `Clase.metodo`). */
export interface RefSimbolo {
  archivo: string;
  simbolo: string;
}

/** Pantalla del front: una ruta del router y el componente que la dibuja. */
export interface PantallaCruda {
  paquete: string;
  /** Ruta normalizada (`/pedidos/{id}`). */
  ruta: string;
  /** Dónde se declara la ruta. */
  archivo: string;
  linea: number;
  componente: RefSimbolo | null;
  /** Componentes de rutas contenedoras sin `path` (`<RequireAuth />`): guardas o layouts. */
  envuelta: RefSimbolo[];
}

/** Navegación hacia una ruta del front: `navigate("/x")`, `<Link to="/x">`, `<Navigate to="/x">` o un ítem de menú. */
export interface NavegacionCruda {
  paquete: string;
  archivo: string;
  linea: number;
  /** Función o método que navega; `null` si está a nivel de archivo (un menú declarado como dato). */
  desde: string | null;
  ruta: string;
  tipo: "navega" | "enlace" | "redirige";
}

/** Mensaje que un método publica o consume: un evento en proceso o una cola, por su clave. */
export interface EventoCrudo {
  paquete: string;
  archivo: string;
  linea: number;
  /** Clave del mensaje: el literal, el valor de la constante o, si no es un texto, su nombre en el código. */
  nombre: string;
  direccion: "publica" | "consume";
}

export type Forma = Record<string, string>;

export interface Extraccion {
  parser: string;
  archivos: ArchivoCrudo[];
  endpoints: EndpointCrudo[];
  llamadas: LlamadaCruda[];
  tablas: AccesoTabla[];
  modelos: ModeloCrudo[];
  pantallas: PantallaCruda[];
  navegaciones: NavegacionCruda[];
  /** Mensajes publicados y consumidos. Opcional: no todos los parsers los detectan. */
  eventos?: EventoCrudo[];
  /** Formas de tipos declarados, por paquete y nombre. */
  formas: Record<string, Record<string, Forma>>;
  /** Paquetes cuyos endpoints declara este parser con autoridad (OpenAPI). */
  autoritativo: string[];
}

export interface Parser {
  nombre: string;
  detect(repo: RepoFuente): boolean;
  extract(repo: RepoFuente): Extraccion | Promise<Extraccion>;
}

export const extraccionVacia = (parser: string): Extraccion => ({
  parser,
  archivos: [],
  endpoints: [],
  llamadas: [],
  tablas: [],
  modelos: [],
  pantallas: [],
  navegaciones: [],
  formas: {},
  autoritativo: [],
});

/** Paquete (raíz de app más larga) que contiene un archivo. */
export function paqueteDe(repo: RepoFuente, archivo: string): string {
  let mejor = "";
  for (const p of repo.paquetes) if (p !== "" && (archivo === p || archivo.startsWith(p + "/")) && p.length > mejor.length) mejor = p;
  return mejor;
}

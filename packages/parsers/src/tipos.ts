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
  /** Símbolos del repo (`Clase.metodo`) que se llaman así: a alguno de ellos puede ir la llamada. */
  candidatos?: string[];
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
  /** Tipo de los parámetros de query, si el parser lo determina. */
  query?: string | null;
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
  /** Columnas que ese acceso lee o escribe, si se pudieron determinar. */
  columnas?: string[];
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

export interface ColumnaCruda {
  nombre: string;
  /** Tipo tal como está declarado, en minúsculas (`varchar(255)`, `int`). */
  tipo: string;
  nulo: boolean;
  pk: boolean;
}

/** Tabla del esquema de base de datos, con el nombre físico. */
export interface TablaEsquema {
  paquete: string;
  tabla: string;
  /** Dónde se crea. */
  archivo: string;
  linea: number;
  columnas: ColumnaCruda[];
  fks: Array<{ columnas: string[]; tabla: string; columnasRef: string[]; archivo: string; linea: number }>;
}

/** Pieza de infraestructura declarada en un archivo del repo. */
export interface InfraCruda {
  paquete: string;
  archivo: string;
  linea: number;
  clase: "imagen" | "servicio" | "pipeline" | "variables" | "proxy";
  /** Imagen base, servicio de compose, pipeline o job, archivo de variables, o ruta del proxy. */
  nombre: string;
  /** Datos en texto: puertos, comandos, pasos, nombres de variables (nunca valores). */
  detalle: string[];
  /** Servicios de compose de los que depende (`depends_on`), por su nombre en el archivo. */
  dependeDe?: string[];
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
  /** Esquema de base de datos: tablas con columnas y claves foráneas. */
  esquema?: TablaEsquema[];
  /** Infraestructura: imágenes, compose, pipelines, variables de ejemplo y proxy. */
  infra?: InfraCruda[];
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

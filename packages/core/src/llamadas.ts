import { parse } from "yaml";

/**
 * Llamadas declaradas: lo que el código no dice con tipos y alguien (una persona o un modelo) resolvió leyéndolo.
 * Viven en `calls.yaml`, en la raíz del brain, y se suman al índice de cada repo al indexar: sobreviven a reindexar.
 *
 * ```yaml
 * llamadas:
 *   - desde: "repo-x:src/Controller/PedidoController.php#PedidoController.crear"
 *     linea: 42                       # línea de la llamada, dentro del método que llama
 *     hacia: "repo-x:src/Service/Facturador.php#Facturador.emitir"
 *     origen: modelo                  # o persona
 *     nota: "el contenedor registra 'facturador' como App\\Service\\Facturador (services.yaml#L12)"
 *
 * http:                               # llamadas HTTP salientes que el parser no vio o no pudo rutear
 *   - desde: "repo-web:src/premios/api.ts#premiosApi.estado"
 *     linea: 30
 *     metodo: GET
 *     ruta: "/premios/estado"
 *     base: "API_URL"                 # opcional: variable u host de donde sale la URL
 *     origen: modelo
 *     nota: "request() arma la URL con una tabla de rutas (rutas.ts#L4)"
 * ```
 */
export const ARCHIVO_LLAMADAS = "calls.yaml";

/** Una llamada HTTP saliente declarada: el parser no la vio, o la vio sin poder determinar su ruta. */
export interface HttpDeclarada {
  desde: string;
  linea: number;
  metodo: string;
  ruta: string;
  base?: string;
  origen?: string;
  nota?: string;
}

export interface LlamadaDeclarada {
  desde: string;
  hacia: string;
  linea: number;
  origen?: string;
  nota?: string;
}

interface ArchivoIndexado {
  ruta: string;
  simbolos: Array<{ nombre: string; linea: number; fin?: number | undefined }>;
  invoca?: Array<{ desde: string; archivo: string; simbolo: string; linea: number; via?: string | undefined }> | undefined;
  sinResolver?: Array<{ desde: string; linea: number; llamada: string }> | undefined;
}

const partes = (k: string) => {
  const i = k.indexOf(":"), j = k.lastIndexOf("#");
  return i < 0 || j < i ? null : { repo: k.slice(0, i), ruta: k.slice(i + 1, j), simbolo: k.slice(j + 1) };
};

/** Lee `calls.yaml`. Devuelve las llamadas bien formadas y por qué se descartó cada una de las otras. */
export function leerLlamadasDeclaradas(texto: string): { llamadas: LlamadaDeclarada[]; http: HttpDeclarada[]; rechazadas: string[] } {
  const llamadas: LlamadaDeclarada[] = [], http: HttpDeclarada[] = [], rechazadas: string[] = [];
  let doc: unknown;
  try {
    doc = parse(texto);
  } catch (e) {
    return { llamadas, http, rechazadas: [`${ARCHIVO_LLAMADAS}: invalid YAML (${(e as Error).message.split("\n")[0]})`] };
  }
  const texto_ = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const listaHttp = (doc as { http?: unknown } | null)?.http;
  (Array.isArray(listaHttp) ? listaHttp : []).forEach((x: Record<string, unknown>, i) => {
    const desde = texto_(x?.["desde"]), metodo = texto_(x?.["metodo"]), ruta = texto_(x?.["ruta"]), base = texto_(x["base"]), origen = texto_(x["origen"]), nota = texto_(x["nota"]);
    if (desde && partes(desde) && metodo && ruta?.startsWith("/") && Number.isInteger(x["linea"])) {
      http.push({ desde, linea: x["linea"] as number, metodo: metodo.toUpperCase(), ruta, ...(base ? { base } : {}), ...(origen ? { origen } : {}), ...(nota ? { nota } : {}) });
    } else rechazadas.push(`http ${i + 1}: missing \`desde\` (repo:path#Symbol), \`linea\`, \`metodo\` or \`ruta\` (starting with /)`);
  });
  const lista = (doc as { llamadas?: unknown } | null)?.llamadas;
  if (!Array.isArray(lista)) return { llamadas, http, rechazadas };
  lista.forEach((x: Record<string, unknown>, i) => {
    if (typeof x?.["desde"] === "string" && typeof x["hacia"] === "string" && Number.isInteger(x["linea"]) && partes(x["desde"]) && partes(x["hacia"])) {
      llamadas.push({ desde: x["desde"], hacia: x["hacia"], linea: x["linea"] as number, ...(typeof x["origen"] === "string" ? { origen: x["origen"] } : {}), ...(typeof x["nota"] === "string" ? { nota: x["nota"] } : {}) });
    } else rechazadas.push(`call ${i + 1}: missing \`desde\` and \`hacia\` (repo:path#Symbol) or \`linea\``);
  });
  return { llamadas, http, rechazadas };
}

/** Las llamadas HTTP declaradas de `repo` que se pueden comprobar: el símbolo existe y la línea cae dentro de él. */
export function httpDeclaradasDe(archivos: ArchivoIndexado[], repo: string, declaradas: HttpDeclarada[]): { validas: Array<HttpDeclarada & { archivo: string }>; rechazadas: string[] } {
  const porRuta = new Map(archivos.map((a) => [a.ruta, a]));
  const validas: Array<HttpDeclarada & { archivo: string }> = [], rechazadas: string[] = [];
  for (const d of declaradas) {
    const de = partes(d.desde)!;
    if (de.repo !== repo) continue;
    const s = porRuta.get(de.ruta)?.simbolos.find((x) => x.nombre === de.simbolo);
    if (!s) rechazadas.push(`${d.desde}: not in the index`);
    else if (d.linea < s.linea || d.linea > (s.fin ?? s.linea)) rechazadas.push(`${d.desde}: line ${d.linea} is not inside ${de.simbolo} (${s.linea}-${s.fin ?? s.linea})`);
    else validas.push({ ...d, archivo: de.ruta });
  }
  return { validas, rechazadas };
}

/**
 * Suma a los archivos indexados de `repo` las llamadas declaradas que le tocan. Solo entra la que se puede comprobar:
 * los dos símbolos existen en el índice y la línea cae dentro del método que llama. Las demás se devuelven con el motivo.
 */
export function aplicarLlamadasDeclaradas(archivos: ArchivoIndexado[], repo: string, declaradas: LlamadaDeclarada[]): { aplicadas: number; rechazadas: string[] } {
  const porRuta = new Map(archivos.map((a) => [a.ruta, a]));
  const rechazadas: string[] = [];
  let aplicadas = 0;
  for (const d of declaradas) {
    const de = partes(d.desde)!, a = partes(d.hacia)!;
    if (de.repo !== repo) continue;
    const motivo = (() => {
      if (a.repo !== repo) return "the target is in another repo: a declared call is between methods of the same repo";
      const origen = porRuta.get(de.ruta), destino = porRuta.get(a.ruta);
      const s = origen?.simbolos.find((x) => x.nombre === de.simbolo);
      if (!origen || !s) return `${d.desde} is not in the index`;
      if (!destino?.simbolos.some((x) => x.nombre === a.simbolo)) return `${d.hacia} is not in the index`;
      if (d.linea < s.linea || d.linea > (s.fin ?? s.linea)) return `line ${d.linea} is not inside ${de.simbolo} (${s.linea}-${s.fin ?? s.linea})`;
      if (!(origen.invoca ?? []).some((x) => x.desde === de.simbolo && x.archivo === a.ruta && x.simbolo === a.simbolo)) {
        (origen.invoca ??= []).push({ desde: de.simbolo, archivo: a.ruta, simbolo: a.simbolo, linea: d.linea });
        origen.invoca.sort((x, y) => x.linea - y.linea || (x.simbolo < y.simbolo ? -1 : 1));
      }
      // Ya no está sin resolver.
      if (origen.sinResolver) {
        origen.sinResolver = origen.sinResolver.filter((x) => !(x.desde === de.simbolo && x.linea === d.linea));
        if (!origen.sinResolver.length) delete origen.sinResolver;
      }
      return null;
    })();
    if (motivo) rechazadas.push(`${d.desde} → ${d.hacia}: ${motivo}`);
    else aplicadas++;
  }
  return { aplicadas, rechazadas };
}

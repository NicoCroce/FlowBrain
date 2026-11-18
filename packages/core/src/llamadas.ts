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
 * ```
 */
export const ARCHIVO_LLAMADAS = "calls.yaml";

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
export function leerLlamadasDeclaradas(texto: string): { llamadas: LlamadaDeclarada[]; rechazadas: string[] } {
  const llamadas: LlamadaDeclarada[] = [], rechazadas: string[] = [];
  let doc: unknown;
  try {
    doc = parse(texto);
  } catch (e) {
    return { llamadas, rechazadas: [`${ARCHIVO_LLAMADAS}: YAML inválido (${(e as Error).message.split("\n")[0]})`] };
  }
  const lista = (doc as { llamadas?: unknown } | null)?.llamadas;
  if (!Array.isArray(lista)) return { llamadas, rechazadas };
  lista.forEach((x: Record<string, unknown>, i) => {
    if (typeof x?.["desde"] === "string" && typeof x["hacia"] === "string" && Number.isInteger(x["linea"]) && partes(x["desde"]) && partes(x["hacia"])) {
      llamadas.push({ desde: x["desde"], hacia: x["hacia"], linea: x["linea"] as number, ...(typeof x["origen"] === "string" ? { origen: x["origen"] } : {}), ...(typeof x["nota"] === "string" ? { nota: x["nota"] } : {}) });
    } else rechazadas.push(`llamada ${i + 1}: faltan \`desde\` y \`hacia\` (repo:ruta#Simbolo) o \`linea\``);
  });
  return { llamadas, rechazadas };
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
      if (a.repo !== repo) return "el destino está en otro repo: una llamada declarada es entre métodos del mismo repo";
      const origen = porRuta.get(de.ruta), destino = porRuta.get(a.ruta);
      const s = origen?.simbolos.find((x) => x.nombre === de.simbolo);
      if (!origen || !s) return `no existe ${d.desde} en el índice`;
      if (!destino?.simbolos.some((x) => x.nombre === a.simbolo)) return `no existe ${d.hacia} en el índice`;
      if (d.linea < s.linea || d.linea > (s.fin ?? s.linea)) return `la línea ${d.linea} no está dentro de ${de.simbolo} (${s.linea}-${s.fin ?? s.linea})`;
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

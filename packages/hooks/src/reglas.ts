import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cmp, repoPorDirectorio, type Contexto, type GraphNode } from "@flowbrain/core";

/**
 * Generadores de reglas (`flowbrain gen claude|agents|cursor|windsurf`): el bloque que le dice al agente que existe el
 * brain, qué nodo es este repo y cómo consultarlo. Determinísticos: dependen solo del grafo y del repo.
 */

export const PREFIJO_NOTA = "flowbrain-nota";
export const MARCA_REGLAS_INICIO = "<!-- flowbrain:reglas:inicio -->";
export const MARCA_REGLAS_FIN = "<!-- flowbrain:reglas:fin -->";

export const DESTINOS = ["claude", "agents", "cursor", "windsurf"] as const;
export type Destino = (typeof DESTINOS)[number];

/** Verbos que cuentan como dependencia (el superverbo `depende_de` del SCHEMA). */
/** Nodos de las relaciones finas: en el resumen de un servicio solo cuentan piezas técnicas con página. */
const FINOS = new Set(["endpoint", "pantalla", "feat"]);
const DEPENDENCIA = new Set(["depende_de", "llama_a", "publica_en", "consume_de", "lee_de", "escribe_en"]);
const MAX_LISTA = 8;

const lista = (ids: string[]) => {
  const u = [...new Set(ids)].sort(cmp);
  if (u.length === 0) return "—";
  const ver = u.slice(0, MAX_LISTA).map((x) => `\`${x}\``).join(", ");
  return u.length > MAX_LISTA ? `${ver} (+${u.length - MAX_LISTA} más)` : ver;
};

/** Sección "este repo en el brain": servicios que viven acá, de qué dependen y quién los usa. */
function seccionRepo(ctx: Contexto, repo: GraphNode): string[] {
  const svcs = (ctx.entrantes.get(repo.id) ?? []).filter((e) => e.verbo === "vive_en").map((e) => ctx.nodo.get(e.desde)!).filter(Boolean);
  svcs.sort((a, b) => cmp(a.id, b.id));
  const lineas = [`Este repo es \`${repo.id}\` (${repo.nombre}) en el brain.${repo.resumen ? ` ${repo.resumen}` : ""}`];
  if (svcs.length > 0) {
    lineas.push("", "Lo que vive acá:");
    for (const s of svcs) {
      const usa = (ctx.salientes.get(s.id) ?? []).filter((e) => DEPENDENCIA.has(e.verbo) && e.hasta !== s.id).map((e) => e.hasta);
      const usan = (ctx.entrantes.get(s.id) ?? []).filter((e) => DEPENDENCIA.has(e.verbo) && e.desde !== s.id && !FINOS.has(ctx.nodo.get(e.desde)?.tipo ?? "")).map((e) => e.desde);
      lineas.push(`- \`${s.id}\`${s.resumen ? ` — ${s.resumen}` : ""} Depende de: ${lista(usa)}. Lo usan: ${lista(usan)}.`);
    }
  }
  return lineas;
}

/** Bloque Markdown de reglas. Con `ctx` y `repo`, incluye el nodo del repo y sus servicios. */
export function bloqueReglas(ctx?: Contexto | null, repo?: GraphNode | null): string {
  return [
    "## FlowBrain",
    "",
    ...(ctx && repo ? [...seccionRepo(ctx, repo), ""] : []),
    "Antes de explorar el código con grep, consultá el grafo de conocimiento por MCP (servidor `brain`):",
    "- `buscar_nodo` para ubicar servicios, repos, tablas o features por nombre, y clases o métodos del código (con archivo y línea).",
    "- `recorrer_grafo` con `verbos: [\"depende_de\"], direccion: \"in\"` para saber qué se rompe si cambiás algo.",
    "- `contrato_de` para ver qué devuelve un endpoint.",
    "- `trazar` para seguir un flujo desde una ruta HTTP o un archivo.",
    "- `recorrido` para ver qué ejecuta un endpoint, un método o un hook del front (front → endpoint → controller → servicio → repositorio → tabla), con archivo y línea; `via` marca saltos por HTTP, eventos o colas.",
    "- `pantalla` para una pantalla del front (`/login`, `LoginScreen`): de dónde se llega, a dónde lleva, qué guardas la envuelven y qué llama del back, de punta a punta.",
    "- `quien_llama` antes de cambiar un método: quién lo llama (también por eventos, colas y HTTP desde otros repos) y qué endpoints y funcionalidades alcanza.",
    "- `impacto` para saber qué funcionalidades se ven afectadas si cambia una tabla, un endpoint o un servicio.",
    "- `riesgo` con un diff o los archivos que vas a tocar, antes de un cambio grande: qué alcanza y a quién avisar.",
    "- `deriva` para ver llamadas que ningún endpoint atiende y endpoints que nadie llama; `paridad` para saber qué falta migrar de un servicio a otro.",
    "- `infra` para saber cómo se construye, despliega y configura un servicio: imagen, pipelines, variables de entorno y proxy.",
    "- `funcionalidad` para la ficha de una funcionalidad de producto: endpoints, consumo, datos y relaciones.",
    "Los `avisos` de cada respuesta son huecos conocidos (no hay dato, no \"no pasa nada\"): llamadas sin resolver o índice desactualizado; ahí sí conviene mirar el código. `indice` dice de qué commit salió.",
    "Sin MCP, los mismos comandos por CLI: `flowbrain search <texto>`, `flowbrain traverse <nodo>`, `flowbrain contract <nodo>`, `flowbrain trace --from <ruta>`, `flowbrain flow <endpoint|Clase.metodo>`, `flowbrain screen </ruta>`, `flowbrain callers <Clase.metodo>`, `flowbrain impact <pieza>`, `flowbrain feature <id>`.",
    "Cada arista trae evidencia (`repo:ruta#Lnn`); abrí ese archivo antes de afirmar algo.",
    `Si el código contradice al brain, escribí en tu respuesta una línea \`${PREFIJO_NOTA} <id-del-nodo>: <qué cambió>\`. Al cerrar la sesión el hook la guarda en \`_drafts/notes/\` para revisión.`,
    "",
  ].join("\n");
}

export interface Reglas {
  destino: Destino;
  /** Ruta relativa a la raíz del repo. */
  ruta: string;
  /** `bloque`: se inserta entre marcadores en un archivo compartido; `archivo`: el archivo es de brain. */
  modo: "bloque" | "archivo";
  contenido: string;
  repo: string | null;
}

/** Resuelve el nodo del repo por id o por nombre de directorio. */
export function repoDe(ctx: Contexto, idONombre: string | null): GraphNode | null {
  if (!idONombre) return null;
  const n = ctx.nodo.get(idONombre);
  if (n?.tipo === "repo") return n;
  return repoPorDirectorio(ctx, idONombre);
}

export function generarReglas(destino: Destino, ctx: Contexto | null, repo: GraphNode | null): Reglas {
  const bloque = bloqueReglas(ctx, repo);
  const envuelto = `${MARCA_REGLAS_INICIO}\n${bloque}${MARCA_REGLAS_FIN}\n`;
  const r = { destino, repo: repo?.id ?? null };
  switch (destino) {
    case "claude":
      return { ...r, ruta: "CLAUDE.md", modo: "bloque", contenido: envuelto };
    case "agents":
      return { ...r, ruta: "AGENTS.md", modo: "bloque", contenido: envuelto };
    case "cursor":
      return {
        ...r,
        ruta: ".cursor/rules/flowbrain.mdc",
        modo: "archivo",
        contenido: `---\ndescription: Grafo de conocimiento FlowBrain: servicios, contratos y dependencias de este repo\nalwaysApply: true\n---\n\n${bloque}`,
      };
    case "windsurf":
      return { ...r, ruta: ".windsurf/rules/flowbrain.md", modo: "archivo", contenido: `---\ntrigger: always_on\n---\n\n${bloque}` };
  }
}

/** Inserta o reemplaza el bloque entre marcadores; si no hay marcadores, lo agrega al final. */
export function fusionarBloque(previo: string | null, envuelto: string): string {
  if (previo === null || previo.trim() === "") return envuelto;
  // Bloques escritos antes del cambio de nombre (marcadores `brain:reglas`): se reemplazan igual, sin duplicar.
  previo = previo.replace("<!-- brain:reglas:inicio -->", MARCA_REGLAS_INICIO).replace("<!-- brain:reglas:fin -->", MARCA_REGLAS_FIN);
  const i = previo.indexOf(MARCA_REGLAS_INICIO);
  const f = previo.indexOf(MARCA_REGLAS_FIN);
  if (i >= 0 && f > i) {
    const resto = previo.slice(f + MARCA_REGLAS_FIN.length).replace(/^\n/, "");
    return previo.slice(0, i) + envuelto + resto;
  }
  return `${previo.replace(/\n*$/, "\n\n")}${envuelto}`;
}

/** Escribe las reglas en el repo. Devuelve si el archivo cambió. */
export async function escribirReglas(dirRepo: string, r: Reglas): Promise<boolean> {
  const destino = join(dirRepo, r.ruta);
  const previo = await readFile(destino, "utf8").catch(() => null);
  const nuevo = r.modo === "bloque" ? fusionarBloque(previo, r.contenido) : r.contenido;
  if (nuevo === previo) return false;
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, nuevo, "utf8");
  return true;
}

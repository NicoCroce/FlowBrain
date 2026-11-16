import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { cmp, cmpTuple, commitDe, ConsultaError, FrontmatterSchema, parsePagina, stringifyCanonical, type Contrato } from "@brain/core";
import { leerRepo } from "./repo.js";
import { openapiParser } from "./openapi-parser.js";
import { tsParser } from "./ts-parser.js";
import { phpParser } from "./php-parser.js";
import type { Extraccion, Forma, LlamadaCruda, Parser } from "./tipos.js";

/** Parsers en orden de prioridad: los posteriores pisan formas y, si son autoritativos, endpoints. */
export const PARSERS: Parser[] = [tsParser, phpParser, openapiParser];

export interface NodoPagina {
  id: string;
  tipo: string;
  nombre: string;
  aliases: string[];
  vive_en: string[];
  puntos_de_entrada: Record<string, string>;
}

export interface AristaExtraida {
  dato: string | null;
  desde: string;
  endpoint: string | null;
  evidencia: string;
  hasta: string;
  origen: "parser" | "inferido";
  verbo: "llama_a" | "lee_de" | "escribe_en";
}

export interface Pendiente {
  candidatos: Array<{ endpoint: string | null; hasta: string }>;
  desde: string;
  evidencia: string;
  motivo: string;
  /** Lo que falta en el brain para resolverla: host (`host sin nodo`) o tabla física (`modelo sin tabla`). */
  objetivo: string | null;
  verbo: "llama_a" | "lee_de" | "escribe_en";
  /** URL reconstruida o modelo de datos. */
  referencia: string;
}

export interface ResultadoIndex {
  repo: string;
  /** El repo no tiene página en el brain (solo con `permitirRepoNuevo`). */
  repoNuevo: boolean;
  servicios: Array<{ nuevo: boolean; paquete: string; svc: string }>;
  /** Una arista por (desde, verbo, hasta, endpoint): lo que proponen los borradores. */
  aristas: AristaExtraida[];
  /** Todas las aristas resueltas, una por evidencia: la vista por método y por funcionalidad necesita cada acceso. */
  accesos: AristaExtraida[];
  pendientes: Pendiente[];
  contratos: Contrato[];
  archivos: { archivos: Extraccion["archivos"]; repo: string; commit?: string; /** Ruta del clon relativa al brain, para comparar su HEAD actual con `commit`. */ raiz: string };
}

export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
export const slug = (s: string) => normalizar(s).replace(/^@[^/]+\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sinPrefijo = (id: string) => id.slice(id.indexOf("-") + 1);
const clavesDe = (n: NodoPagina) => new Set([n.id, sinPrefijo(n.id), n.nombre, ...n.aliases].map(normalizar));

/** Nodos de página leídos de forma tolerante (las páginas inválidas se ignoran; `compile` las reporta). */
export async function leerNodosPaginas(raizBrain: string): Promise<NodoPagina[]> {
  const out: NodoPagina[] = [];
  for (const dir of ["producto", "tecnologia"]) {
    let nombres: string[] = [];
    try {
      nombres = (await readdir(join(raizBrain, dir))).filter((n) => n.endsWith(".md")).sort(cmp);
    } catch {
      continue;
    }
    for (const n of nombres) {
      try {
        const p = parsePagina(`${dir}/${n}`, await readFile(join(raizBrain, dir, n), "utf8"));
        const r = FrontmatterSchema.safeParse(p.data);
        if (!r.success) continue;
        const fm = r.data;
        out.push({
          id: fm.id,
          tipo: fm.tipo,
          nombre: fm.nombre,
          aliases: fm.aliases ?? [],
          vive_en: fm.vive_en ?? [],
          puntos_de_entrada: fm.puntos_de_entrada ?? {},
        });
      } catch {
        /* página ilegible: la reporta compile */
      }
    }
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

async function leerContratos(raizBrain: string): Promise<Contrato[]> {
  const dir = join(raizBrain, "_build/contratos");
  let nombres: string[] = [];
  try {
    nombres = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort(cmp);
  } catch {
    return [];
  }
  return Promise.all(nombres.map(async (n) => JSON.parse(await readFile(join(dir, n), "utf8")) as Contrato));
}

/** Archivos de test y mocks: sus rutas y llamadas no describen el sistema real. */
export const esArchivoDeTest = (ruta: string) =>
  /(^|\/)(__tests__|__mocks__|tests?|e2e|cypress|fixtures)\//.test(ruta) || /\.(test|spec|e2e-spec|cy)\.[cm]?[jt]sx?$/.test(ruta) || /Test\.php$/.test(ruta);

/**
 * Une extracciones: archivos por ruta (gana el primero), endpoints autoritativos por paquete, formas pisadas en orden.
 * Descarta endpoints, llamadas y accesos a tablas de archivos de test, y deja un solo endpoint por (paquete, método,
 * ruta): el de menor (archivo, línea).
 */
export function fusionar(xs: Extraccion[]): Extraccion {
  const autoritativos = new Set(xs.flatMap((x) => x.autoritativo));
  const archivos = new Map<string, Extraccion["archivos"][number]>();
  const formas: Record<string, Record<string, Forma>> = {};
  const out: Extraccion = { parser: xs.map((x) => x.parser).join("+"), archivos: [], endpoints: [], llamadas: [], tablas: [], modelos: [], formas, autoritativo: [...autoritativos].sort(cmp) };
  // Un endpoint declarado por una spec autoritativa pisa al inferido del código con el mismo (paquete, método, ruta);
  // los que solo existen en el código se conservan.
  const clave = (e: { paquete: string; metodo: string; ruta: string }) => `${e.paquete}\u0000${e.metodo}\u0000${e.ruta}`;
  const declarados = new Set(xs.flatMap((x) => x.endpoints.filter((e) => x.autoritativo.includes(e.paquete)).map(clave)));
  for (const x of xs) {
    for (const a of x.archivos) if (!archivos.has(a.ruta)) archivos.set(a.ruta, a);
    for (const e of x.endpoints) {
      if (esArchivoDeTest(e.archivo)) continue;
      if (x.autoritativo.includes(e.paquete) || !declarados.has(clave(e))) out.endpoints.push(e);
    }
    out.llamadas.push(...x.llamadas.filter((l) => !esArchivoDeTest(l.archivo)));
    out.tablas.push(...x.tablas.filter((t) => !esArchivoDeTest(t.archivo)));
    out.modelos.push(...x.modelos);
    for (const [p, fs] of Object.entries(x.formas)) Object.assign((formas[p] ??= {}), fs);
  }
  out.archivos = [...archivos.values()].sort((a, b) => cmp(a.ruta, b.ruta));
  const unicos = new Map<string, Extraccion["endpoints"][number]>();
  for (const e of [...out.endpoints].sort((a, b) => cmpTuple([a.archivo, String(a.linea).padStart(9, "0")], [b.archivo, String(b.linea).padStart(9, "0")]))) {
    if (!unicos.has(clave(e))) unicos.set(clave(e), e);
  }
  out.endpoints = out.endpoints.filter((e) => unicos.get(clave(e)) === e);
  return out;
}

const esParam = (s: string) => s.startsWith("{") && s.endsWith("}");

/** Coincidencia de rutas con `{param}` como comodín en cualquiera de los dos lados. */
function rutasCoinciden(a: string, b: string): boolean {
  const x = a.split("/");
  const y = b.split("/");
  return x.length === y.length && x.every((s, i) => s === y[i] || esParam(s) || esParam(y[i]!));
}

/** Segmentos literales iguales en ambos lados: mide qué tan específica es una coincidencia. */
const literalesIguales = (a: string, b: string) => {
  const y = b.split("/");
  return a.split("/").filter((s, i) => s !== "" && !esParam(s) && s === y[i]).length;
};

/**
 * Endpoints que puede alcanzar una llamada con base dinámica o relativa. Primero coincidencia exacta; si no hay,
 * por sufijo (la base suele incluir un prefijo fijo como `/api` o `/v1`: el endpoint es `<prefijo literal> + ruta`).
 * Entre varias, se queda con las más específicas (más segmentos literales iguales); exige al menos uno.
 */
export function endpointsAlcanzables<E extends { ruta: string; metodo: string }>(eps: E[], metodo: string, ruta: string): E[] {
  if (!ruta.split("/").some((s) => s !== "" && !esParam(s))) return [];
  const delMetodo = eps.filter((e) => e.metodo === metodo);
  const segs = ruta.split("/").filter(Boolean);
  /** Cola del endpoint con la misma cantidad de segmentos que la llamada. */
  const cola = (e: E) => "/" + e.ruta.split("/").filter(Boolean).slice(-segs.length).join("/");
  const puntaje = (e: E) => literalesIguales(cola(e), "/" + segs.join("/"));
  let hits = delMetodo.filter((e) => rutasCoinciden(e.ruta, ruta));
  if (!hits.some((e) => puntaje(e) > 0)) {
    hits = delMetodo.filter((e) => {
      const todos = e.ruta.split("/").filter(Boolean);
      const prefijo = todos.slice(0, todos.length - segs.length);
      return prefijo.length > 0 && prefijo.every((x) => !esParam(x)) && rutasCoinciden(cola(e), "/" + segs.join("/"));
    });
  }
  // Al menos un segmento literal debe coincidir: un parámetro solo no alcanza para afirmar la arista.
  const max = Math.max(0, ...hits.map(puntaje));
  return max === 0 ? [] : hits.filter((e) => puntaje(e) === max);
}

/**
 * `brain index <repo>`: corre los parsers, resuelve contra las páginas del brain y devuelve contratos,
 * árbol de archivos y aristas extraídas (más las pendientes, para el indexador del paso 7). Puro salvo lecturas.
 */
export async function indexar(
  rutaRepo: string,
  raizBrain: string,
  opciones: { repo?: string; permitirRepoNuevo?: boolean } = {},
): Promise<ResultadoIndex> {
  const repo = leerRepo(rutaRepo);
  const commit = await commitDe(repo.raiz);
  const ubicacion = relative(resolve(raizBrain), repo.raiz) || ".";
  const nodos = await leerNodosPaginas(raizBrain);
  const porId = new Map(nodos.map((n) => [n.id, n]));

  const repoId =
    opciones.repo ??
    (() => {
      const q = normalizar(basename(repo.raiz));
      const hits = nodos.filter((n) => n.tipo === "repo" && clavesDe(n).has(q));
      if (hits.length === 0 && opciones.permitirRepoNuevo) return `repo-${slug(basename(repo.raiz))}`;
      if (hits.length !== 1) throw new ConsultaError("parametro_invalido", `no se pudo identificar el repo "${basename(repo.raiz)}" en el brain; usá --repo <repo-id>`);
      return hits[0]!.id;
    })();
  const repoNuevo = !porId.has(repoId) && opciones.permitirRepoNuevo === true;
  if (!repoNuevo && porId.get(repoId)?.tipo !== "repo") throw new ConsultaError("nodo_inexistente", `repo inexistente en el brain: ${repoId}`);

  const x = fusionar(await Promise.all(PARSERS.filter((p) => p.detect(repo)).map((p) => p.extract(repo))));
  const ev = (archivo: string, linea: number) => `${repoId}:${archivo}#L${linea}`;

  // ---------- Paquetes → servicios ----------
  const svcsDelRepo = nodos.filter((n) => n.tipo === "svc" && n.vive_en.includes(repoId));
  const servicios: ResultadoIndex["servicios"] = [];
  const svcsDe = new Map<string, string[]>();
  for (const paquete of repo.paquetes) {
    const ids = svcsDelRepo
      .filter((s) => {
        const rutas = Object.values(s.puntos_de_entrada);
        if (paquete === "") return true;
        return rutas.some((r) => r === paquete || r.startsWith(paquete + "/"));
      })
      .map((s) => s.id)
      .sort(cmp);
    if (ids.length === 0) {
      const id = `svc-${slug(paquete === "" ? basename(repo.raiz) : basename(paquete))}`;
      servicios.push({ nuevo: true, paquete, svc: id });
      svcsDe.set(paquete, [id]);
    } else {
      for (const id of ids) servicios.push({ nuevo: false, paquete, svc: id });
      svcsDe.set(paquete, ids);
    }
  }
  const esNuevo = new Set(servicios.filter((s) => s.nuevo).map((s) => s.svc));

  // ---------- Contratos ----------
  const contratos: Contrato[] = [];
  const llamadasPorSvc = new Map<string, LlamadaCruda[]>();
  for (const l of x.llamadas) for (const s of svcsDe.get(l.paquete) ?? []) llamadasPorSvc.set(s, [...(llamadasPorSvc.get(s) ?? []), l]);
  for (const { paquete, svc } of servicios) {
    if (esNuevo.has(svc)) continue;
    const eps = x.endpoints.filter((e) => e.paquete === paquete);
    if (eps.length === 0) continue;
    const fuente = x.autoritativo.includes(paquete) ? "openapi-parser" : eps.some((e) => e.archivo.endsWith(".php")) ? "php-parser" : "ts-parser";
    contratos.push({
      endpoints: eps
        .map((e) => ({ evidencia: ev(e.archivo, e.linea), metodo: e.metodo as Contrato["endpoints"][number]["metodo"], request: e.request, response: e.response, ruta: e.ruta }))
        .sort((a, b) => cmpTuple([a.ruta, a.metodo], [b.ruta, b.metodo])),
      eventos: [],
      fuente,
      svc,
      tipos: {},
    });
  }
  const conocidos = new Map<string, Contrato>((await leerContratos(raizBrain)).map((c) => [c.svc, c]));
  for (const c of contratos) conocidos.set(c.svc, c);
  const endpointsConocidos = [...conocidos.values()].flatMap((c) => c.endpoints.map((e) => ({ svc: c.svc, metodo: e.metodo, ruta: e.ruta })));
  const epId = (svc: string, metodo: string, ruta: string) => `${svc}:${metodo}:${ruta}`;

  // ---------- Llamadas ----------
  const aristas: AristaExtraida[] = [];
  const pendientes: Pendiente[] = [];
  const destinosPorClave = (clave: string, tipos: string[]) => nodos.filter((n) => tipos.includes(n.tipo) && clavesDe(n).has(clave));
  // Prefijo que aporta cada base dinámica (`${env.apiBaseUrl}` → `/api`), aprendido de las llamadas que
  // resuelven sin ambigüedad. Si es único, desempata las que coinciden con varios endpoints.
  const baseDe = (l: LlamadaCruda) => (l.url.base === "dinamica" ? (/^\$\{[^}]*\}/.exec(l.url.texto)?.[0] ?? "") : "");
  const prefijo = (ruta: string, deLlamada: string) => {
    const s = ruta.split("/").filter(Boolean);
    return "/" + s.slice(0, s.length - deLlamada.split("/").filter(Boolean).length).join("/");
  };
  const prefijosPorBase = new Map<string, Set<string>>();
  for (const l of x.llamadas) {
    if (l.url.base === "literal" || !l.url.ruta) continue;
    const c = endpointsAlcanzables(endpointsConocidos, l.metodo, l.url.ruta);
    if (c.length === 1) prefijosPorBase.set(baseDe(l), (prefijosPorBase.get(baseDe(l)) ?? new Set()).add(prefijo(c[0]!.ruta, l.url.ruta)));
  }

  for (const l of x.llamadas) {
    for (const desde of svcsDe.get(l.paquete) ?? []) {
      const evidencia = ev(l.archivo, l.linea);
      const pendiente = (motivo: string, candidatos: Pendiente["candidatos"], objetivo: string | null = null) =>
        pendientes.push({ candidatos, desde, evidencia, motivo, objetivo, referencia: `${l.metodo} ${l.url.texto}`, verbo: "llama_a" });
      if (l.url.base === "literal" && l.url.host) {
        const etiquetas = [l.url.host, ...l.url.host.split(/[.]/)].map(normalizar);
        const hits = [...new Set(etiquetas.flatMap((e) => destinosPorClave(e, ["svc", "ext"]).map((n) => n.id)))].sort(cmp);
        if (hits.length !== 1) {
          pendiente(hits.length === 0 ? `host sin nodo: ${l.url.host}` : "host ambiguo", hits.map((h) => ({ endpoint: null, hasta: h })), l.url.host);
          continue;
        }
        const hasta = hits[0]!;
        const ep = l.url.ruta ? endpointsConocidos.find((e) => e.svc === hasta && e.metodo === l.metodo && rutasCoinciden(e.ruta, l.url.ruta!)) : undefined;
        aristas.push({ dato: ep ? null : l.dato, desde, endpoint: ep ? epId(ep.svc, ep.metodo, ep.ruta) : null, evidencia, hasta, origen: "parser", verbo: "llama_a" });
        continue;
      }
      if (!l.url.ruta) {
        pendiente("URL sin ruta reconocible", []);
        continue;
      }
      const cands = endpointsAlcanzables(endpointsConocidos, l.metodo, l.url.ruta);
      const conocido = prefijosPorBase.get(baseDe(l));
      const desempate = cands.length > 1 && conocido?.size === 1 ? cands.filter((c) => conocido.has(prefijo(c.ruta, l.url.ruta!))) : [];
      if (cands.length === 1 || desempate.length === 1) {
        const c = (desempate[0] ?? cands[0])!;
        aristas.push({ dato: null, desde, endpoint: epId(c.svc, c.metodo, c.ruta), evidencia, hasta: c.svc, origen: "inferido", verbo: "llama_a" });
      } else {
        pendiente(
          cands.length === 0 ? `base dinámica y ningún endpoint conocido coincide con ${l.metodo} ${l.url.ruta}` : "varios endpoints coinciden",
          cands.map((c) => ({ endpoint: epId(c.svc, c.metodo, c.ruta), hasta: c.svc })).sort((a, b) => cmp(a.endpoint, b.endpoint)),
        );
      }
    }
  }

  // ---------- Tablas ----------
  for (const t of x.tablas) {
    const modelo = x.modelos.find((m) => m.nombre === t.modelo && (m.paquete === t.paquete || true));
    const claves = [t.modelo, modelo?.tabla].filter((k): k is string => !!k).map(normalizar);
    const hits = [...new Set(claves.flatMap((k) => destinosPorClave(k, ["tabla"]).map((n) => n.id)))].sort(cmp);
    for (const desde of svcsDe.get(t.paquete) ?? []) {
      const evidencia = ev(t.archivo, t.linea);
      if (hits.length === 1) aristas.push({ dato: t.modelo, desde, endpoint: null, evidencia, hasta: hits[0]!, origen: "parser", verbo: t.verbo });
      else
        pendientes.push({
          candidatos: hits.map((h) => ({ endpoint: null, hasta: h })),
          desde,
          evidencia,
          motivo: hits.length === 0 ? `modelo sin tabla en el brain: ${t.modelo}` : "modelo ambiguo",
          objetivo: modelo?.tabla ?? t.modelo,
          referencia: t.modelo,
          verbo: t.verbo,
        });
    }
  }

  // ---------- Dedupe (gana la primera evidencia en orden archivo/línea) y orden ----------
  const unicas = new Map<string, AristaExtraida>();
  for (const a of aristas) {
    const k = [a.desde, a.verbo, a.hasta, a.endpoint ?? ""].join("\u0000");
    if (!unicas.has(k)) unicas.set(k, a);
  }
  const todas = new Map<string, AristaExtraida>();
  for (const a of aristas) todas.set([a.evidencia, a.verbo, a.hasta, a.endpoint ?? "", a.desde].join("\u0000"), a);
  const accesos = [...todas.values()].sort((a, b) => cmpTuple([a.evidencia, a.verbo, a.hasta, a.endpoint ?? "", a.desde], [b.evidencia, b.verbo, b.hasta, b.endpoint ?? "", b.desde]));
  const aristasFinales = [...unicas.values()].sort((a, b) => cmpTuple([a.desde, a.verbo, a.hasta, a.endpoint ?? ""], [b.desde, b.verbo, b.hasta, b.endpoint ?? ""]));
  pendientes.sort((a, b) => cmpTuple([a.desde, a.evidencia, a.referencia], [b.desde, b.evidencia, b.referencia]));

  // ---------- Tipos de cada contrato: los nombrados por endpoints y por datos salientes del svc ----------
  for (const c of contratos) {
    const paquete = servicios.find((s) => s.svc === c.svc)!.paquete;
    const formas = x.formas[paquete] ?? {};
    const nombres = new Set<string>();
    for (const e of c.endpoints) for (const n of [e.request, e.response]) if (n) nombres.add(n.replace(/\[\]$/, ""));
    for (const a of aristasFinales) if (a.desde === c.svc && a.dato) nombres.add(a.dato);
    for (const n of [...nombres].sort(cmp)) if (formas[n]) c.tipos[n] = formas[n]!;
  }

  return {
    repo: repoId,
    repoNuevo,
    servicios,
    aristas: aristasFinales,
    accesos,
    pendientes,
    contratos: contratos.sort((a, b) => cmp(a.svc, b.svc)),
    archivos: { archivos: x.archivos, raiz: ubicacion, repo: repoId, ...(commit ? { commit } : {}) },
  };
}

export { commitDe };

export const rutasIndex = (repo: string) => ({
  archivos: `_build/archivos/${repo}.json`,
  extraccion: `_build/extraccion/${repo}.json`,
  contrato: (svc: string) => `_build/contratos/${svc}.json`,
});

/** Escribe los JSON del index en el brain. Solo toca archivos cuyo contenido cambió. */
export async function escribirIndex(raizBrain: string, r: ResultadoIndex): Promise<string[]> {
  const rutas = rutasIndex(r.repo);
  const salidas: Record<string, string> = {
    [rutas.archivos]: stringifyCanonical(r.archivos),
    [rutas.extraccion]: stringifyCanonical({ accesos: r.accesos, aristas: r.aristas, pendientes: r.pendientes, repo: r.repo, servicios: r.servicios }),
  };
  for (const c of r.contratos) salidas[rutas.contrato(c.svc)] = stringifyCanonical(c);
  const escritos: string[] = [];
  for (const ruta of Object.keys(salidas).sort(cmp)) {
    const destino = join(raizBrain, ruta);
    let previo: string | null = null;
    try {
      previo = await readFile(destino, "utf8");
    } catch {
      previo = null;
    }
    if (previo === salidas[ruta]) continue;
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, salidas[ruta]!, "utf8");
    escritos.push(ruta);
  }
  return escritos;
}

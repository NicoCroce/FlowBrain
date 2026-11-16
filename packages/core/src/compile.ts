import type { ZodIssue } from "zod";
import { cmp, cmpTuple, stringifyCanonical } from "./canonical.js";
import { CompileError, parsePagina, type ErrorCompilacion } from "./frontmatter.js";
import { aplicarBacklinks, renderBacklinksJson, renderIndex, renderMermaid } from "./render.js";
import {
  ArchivosSchema,
  CARPETA_POR_TIPO,
  CONFIANZA,
  ContratoSchema,
  ENDPOINT_REF,
  FrontmatterSchema,
  ID_PAGINA,
  VERBOS,
  VERBOS_RELACION,
  endpointId,
  evidenciaValida,
  normalizarRuta,
  verboAdmite,
  type Estado,
  type Frontmatter,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Origen,
  type Verbo,
} from "./schema.js";

/** Un archivo de entrada. `ruta` es relativa a la raíz del brain, con `/`. */
export interface Fuente {
  ruta: string;
  contenido: string;
}

export interface Entradas {
  paginas: Fuente[];
  contratos: Fuente[];
  archivos: Fuente[];
}

export interface Salidas {
  graph: Graph;
  /** Archivos generados: ruta relativa → contenido. */
  generados: Record<string, string>;
  /** Todas las páginas con la sección de backlinks inyectada: ruta relativa → contenido. */
  paginas: Record<string, string>;
}

export const RUTAS_SALIDA = {
  graph: "_build/graph.json",
  backlinks: "_build/backlinks.json",
  mapa: "_build/mapa.mmd",
  index: "INDEX.md",
} as const;

interface PaginaValida {
  ruta: string;
  fm: Frontmatter;
  frontmatter: string;
  cuerpo: string;
  lineaDe: (path: ReadonlyArray<string | number>) => number;
}

/**
 * Compilador puro: mismas entradas → mismas salidas byte a byte, sin importar el orden de las entradas.
 * Junta todos los errores que puede y lanza `CompileError` si hay alguno.
 */
export function compile(entradas: Entradas): Salidas {
  const errores: ErrorCompilacion[] = [];
  const porRuta = (a: Fuente, b: Fuente) => cmp(a.ruta, b.ruta);
  const paginasIn = [...entradas.paginas].sort(porRuta);
  const contratosIn = [...entradas.contratos].sort(porRuta);
  const archivosIn = [...entradas.archivos].sort(porRuta);

  const nodos = new Map<string, GraphNode>();
  const aristas: GraphEdge[] = [];

  const agregarNodo = (n: GraphNode, archivo: string, linea: number | null) => {
    if (nodos.has(n.id)) errores.push({ archivo, linea, mensaje: `id duplicado: ${n.id}` });
    else nodos.set(n.id, n);
  };

  // ---------- 1. Páginas: parseo y validación de forma ----------
  const paginas: PaginaValida[] = [];
  // Ids de páginas que no validaron: las referencias a ellas no generan errores en cascada.
  const rotos = new Set<string>();
  const idProbable = (ruta: string, data: unknown): string => {
    const id = (data as { id?: unknown } | null)?.id;
    return typeof id === "string" ? id : (ruta.split("/").pop() ?? "").replace(/\.md$/, "");
  };
  for (const f of paginasIn) {
    let parsed;
    try {
      parsed = parsePagina(f.ruta, f.contenido);
    } catch (e) {
      if (e instanceof CompileError) {
        errores.push(...e.errores);
        rotos.add(idProbable(f.ruta, null));
        continue;
      }
      throw e;
    }
    const res = FrontmatterSchema.safeParse(parsed.data);
    if (!res.success) {
      for (const issue of res.error.issues) {
        for (const { path, mensaje } of mensajesZod(issue)) {
          errores.push({ archivo: f.ruta, linea: parsed.lineaDe(path), mensaje });
        }
      }
      rotos.add(idProbable(f.ruta, parsed.data));
      continue;
    }
    const fm = res.data;
    const L = parsed.lineaDe;
    const [carpeta, nombreArchivo, ...extra] = f.ruta.split("/");
    if (!ID_PAGINA.test(fm.id)) errores.push({ archivo: f.ruta, linea: L(["id"]), mensaje: `id inválido: "${fm.id}"` });
    if (extra.length > 0 || nombreArchivo !== `${fm.id}.md`) {
      errores.push({ archivo: f.ruta, linea: L(["id"]), mensaje: `el id "${fm.id}" no coincide con el nombre del archivo` });
    }
    if (!fm.id.startsWith(`${fm.tipo}-`)) {
      errores.push({ archivo: f.ruta, linea: L(["tipo"]), mensaje: `el id "${fm.id}" debe empezar con "${fm.tipo}-"` });
    }
    if (carpeta !== CARPETA_POR_TIPO[fm.tipo]) {
      errores.push({ archivo: f.ruta, linea: L(["tipo"]), mensaje: `una página de tipo ${fm.tipo} va en ${CARPETA_POR_TIPO[fm.tipo]}/` });
    }
    if (fm.puntos_de_entrada && fm.tipo !== "svc") {
      errores.push({ archivo: f.ruta, linea: L(["puntos_de_entrada"]), mensaje: "puntos_de_entrada solo aplica a svc" });
    }
    if (fm.puntos_de_entrada && (fm.vive_en?.length ?? 0) !== 1) {
      errores.push({
        archivo: f.ruta,
        linea: L(["puntos_de_entrada"]),
        mensaje: "con puntos_de_entrada, vive_en debe tener exactamente un repo",
      });
    }
    paginas.push({ ruta: f.ruta, fm, frontmatter: parsed.frontmatter, cuerpo: parsed.cuerpo, lineaDe: L });
    agregarNodo(
      {
        actualizado: fm.actualizado ?? null,
        aliases: fm.aliases ?? [],
        atributos: fm.puntos_de_entrada ? { puntos_de_entrada: fm.puntos_de_entrada } : {},
        estado: fm.estado ?? "vigente",
        id: fm.id,
        nombre: fm.nombre,
        origen: fm.origen ?? "curado",
        pagina: f.ruta,
        resumen: fm.resumen,
        tecnologia: fm.tecnologia ?? [],
        tipo: fm.tipo,
        verificado: fm.verificado ?? null,
      },
      f.ruta,
      L(["id"]),
    );
  }

  const esRepo = (id: string) => nodos.get(id)?.tipo === "repo";
  const checkEvidencia = (ev: string, archivo: string, linea: number | null, donde: string) => {
    if (!evidenciaValida(ev)) {
      errores.push({ archivo, linea, mensaje: `${donde}: evidencia con formato inválido: "${ev}"` });
      return;
    }
    const repo = ev.slice(0, ev.indexOf(":"));
    if (!esRepo(repo) && !rotos.has(repo)) errores.push({ archivo, linea, mensaje: `${donde}: la evidencia cita un repo inexistente: ${repo}` });
  };

  // ---------- 2. Contratos ----------
  for (const f of contratosIn) {
    const data = parseJson(f, errores);
    if (data === undefined) continue;
    const res = ContratoSchema.safeParse(data);
    if (!res.success) {
      for (const issue of res.error.issues) for (const { mensaje } of mensajesZod(issue)) errores.push({ archivo: f.ruta, linea: null, mensaje });
      continue;
    }
    const c = res.data;
    if (f.ruta !== `_build/contratos/${c.svc}.json`) {
      errores.push({ archivo: f.ruta, linea: null, mensaje: `el archivo debe llamarse _build/contratos/${c.svc}.json` });
    }
    if (nodos.get(c.svc)?.tipo !== "svc") {
      if (!rotos.has(c.svc)) errores.push({ archivo: f.ruta, linea: null, mensaje: `svc inexistente: ${c.svc}` });
      continue;
    }
    const contratoId = `${c.svc}:contrato`;
    agregarNodo(generado(contratoId, "contrato", `contrato ${c.svc}`, { fuente: c.fuente, svc: c.svc }), f.ruta, null);
    aristas.push(arista(c.svc, "expone", contratoId, "parser"));
    c.endpoints.forEach((ep, i) => {
      const ruta = normalizarRuta(ep.ruta);
      const id = endpointId(c.svc, ep.metodo, ruta);
      checkEvidencia(ep.evidencia, f.ruta, null, `endpoints[${i}]`);
      agregarNodo(
        generado(id, "endpoint", `${ep.metodo} ${ruta}`, {
          evidencia: ep.evidencia,
          metodo: ep.metodo,
          request: ep.request,
          response: ep.response,
          ruta,
        }),
        f.ruta,
        null,
      );
      aristas.push(arista(c.svc, "contiene", id, "parser", { evidencia: ep.evidencia }));
    });
    c.eventos.forEach((ev, i) => {
      checkEvidencia(ev.evidencia, f.ruta, null, `eventos[${i}]`);
      if (ev.cola !== null && nodos.get(ev.cola)?.tipo !== "queue") {
        errores.push({ archivo: f.ruta, linea: null, mensaje: `eventos[${i}]: cola inexistente: ${ev.cola}` });
      }
    });
  }

  // ---------- 3. Árboles de archivos ----------
  for (const f of archivosIn) {
    const data = parseJson(f, errores);
    if (data === undefined) continue;
    const res = ArchivosSchema.safeParse(data);
    if (!res.success) {
      for (const issue of res.error.issues) for (const { mensaje } of mensajesZod(issue)) errores.push({ archivo: f.ruta, linea: null, mensaje });
      continue;
    }
    const a = res.data;
    if (f.ruta !== `_build/archivos/${a.repo}.json`) {
      errores.push({ archivo: f.ruta, linea: null, mensaje: `el archivo debe llamarse _build/archivos/${a.repo}.json` });
    }
    if (!esRepo(a.repo)) {
      if (!rotos.has(a.repo)) errores.push({ archivo: f.ruta, linea: null, mensaje: `repo inexistente: ${a.repo}` });
      continue;
    }
    a.archivos.forEach((arc, i) => {
      if (!evidenciaValida(`${a.repo}:${arc.ruta}`)) {
        errores.push({ archivo: f.ruta, linea: null, mensaje: `archivos[${i}]: ruta inválida: "${arc.ruta}"` });
        return;
      }
      const id = `${a.repo}:${arc.ruta}`;
      agregarNodo(generado(id, "archivo", arc.ruta, { lenguaje: arc.lenguaje, repo: a.repo, ruta: arc.ruta }), f.ruta, null);
      aristas.push(arista(a.repo, "contiene", id, "parser"));
    });
  }

  // ---------- 4. Aristas de páginas ----------
  for (const p of paginas) {
    const { fm, ruta, lineaDe: L } = p;
    const campo = (verbo: "vive_en" | "pertenece_a", destinos: string[] | undefined) => {
      (destinos ?? []).forEach((d, i) => {
        const destino = nodos.get(d);
        if (!destino) {
          if (!rotos.has(d)) errores.push({ archivo: ruta, linea: L([verbo, i]), mensaje: `${verbo}: destino inexistente: ${d}` });
        } else if (!verboAdmite(verbo, fm.tipo, destino.tipo)) {
          errores.push({ archivo: ruta, linea: L([verbo, i]), mensaje: `${verbo} no admite ${fm.tipo} → ${destino.tipo}` });
        } else {
          aristas.push(arista(fm.id, verbo, d, "curado"));
        }
      });
    };
    campo("vive_en", fm.vive_en);
    campo("pertenece_a", fm.pertenece_a);

    (fm.relaciones ?? []).forEach((r, i) => {
      const at = (k?: string) => L(k ? ["relaciones", i, k] : ["relaciones", i]);
      const err = (k: string | undefined, mensaje: string) => errores.push({ archivo: ruta, linea: at(k), mensaje });
      if (!(VERBOS as readonly string[]).includes(r.verbo)) return err("verbo", `verbo desconocido: "${r.verbo}"`);
      const verbo = r.verbo as Verbo;
      if (!(VERBOS_RELACION as readonly string[]).includes(verbo)) {
        return err(
          "verbo",
          verbo === "vive_en" || verbo === "pertenece_a"
            ? `${verbo} se escribe como campo de primer nivel, no en relaciones`
            : `${verbo} lo genera el compilador; no se escribe en páginas`,
        );
      }
      const destino = nodos.get(r.destino);
      if (!destino) return rotos.has(r.destino) ? undefined : err("destino", `destino inexistente: ${r.destino}`);
      if (!verboAdmite(verbo, fm.tipo, destino.tipo)) return err("verbo", `${verbo} no admite ${fm.tipo} → ${destino.tipo}`);
      const origen: Origen = r.origen ?? "curado";
      if (origen !== "curado" && r.evidencia === undefined) err("origen", `una arista de origen ${origen} requiere evidencia`);
      if (r.evidencia !== undefined) checkEvidencia(r.evidencia, ruta, at("evidencia"), `relaciones[${i}]`);
      let endpoint: string | null = null;
      if (r.endpoint !== undefined) {
        const m = ENDPOINT_REF.exec(r.endpoint);
        if (verbo !== "llama_a" || destino.tipo !== "svc") return err("endpoint", "endpoint solo aplica a llama_a hacia un svc");
        if (!m) return err("endpoint", `endpoint con formato inválido: "${r.endpoint}" (se espera "MÉTODO /ruta")`);
        endpoint = endpointId(r.destino, m[1]!, m[2]!);
        if (nodos.get(endpoint)?.tipo !== "endpoint") return err("endpoint", `endpoint inexistente en el contrato de ${r.destino}: ${r.endpoint}`);
      }
      aristas.push(
        arista(fm.id, verbo, r.destino, origen, {
          dato: r.dato ?? null,
          endpoint,
          estado: r.estado ?? "vigente",
          evidencia: r.evidencia ?? null,
        }),
      );
    });
  }

  if (errores.length > 0) throw new CompileError(ordenarErrores(errores));

  // ---------- 5. Dedupe y orden ----------
  const graph: Graph = {
    edges: dedupe(aristas).sort((a, b) => cmpTuple(claveArista(a), claveArista(b))),
    nodes: [...nodos.values()].sort((a, b) => cmp(a.id, b.id)),
    version: 1,
  };

  // ---------- 6. Salidas ----------
  const generados: Record<string, string> = {
    [RUTAS_SALIDA.graph]: stringifyCanonical(graph),
    [RUTAS_SALIDA.backlinks]: renderBacklinksJson(graph),
    [RUTAS_SALIDA.mapa]: renderMermaid(graph),
    [RUTAS_SALIDA.index]: renderIndex(graph),
  };
  const salidaPaginas: Record<string, string> = {};
  for (const p of paginas) {
    salidaPaginas[p.ruta] = `---\n${p.frontmatter}---\n${aplicarBacklinks(p.cuerpo, p.fm.id, graph, p.ruta)}`;
  }
  return { graph, generados, paginas: salidaPaginas };
}

// ---------- helpers ----------

function generado(id: string, tipo: GraphNode["tipo"], nombre: string, atributos: Record<string, unknown>): GraphNode {
  return {
    actualizado: null,
    aliases: [],
    atributos,
    estado: "vigente",
    id,
    nombre,
    origen: "parser",
    pagina: null,
    resumen: null,
    tecnologia: [],
    tipo,
    verificado: null,
  };
}

function arista(
  desde: string,
  verbo: Verbo,
  hasta: string,
  origen: Origen,
  opts: { dato?: string | null; endpoint?: string | null; estado?: Estado; evidencia?: string | null } = {},
): GraphEdge {
  return {
    confianza: CONFIANZA[origen],
    dato: opts.dato ?? null,
    desde,
    endpoint: opts.endpoint ?? null,
    estado: opts.estado ?? "vigente",
    evidencia: opts.evidencia ?? null,
    hasta,
    origen,
    verbo,
  };
}

export const claveArista = (e: GraphEdge): string[] => [e.desde, e.verbo, e.hasta, e.endpoint ?? ""];

/** Misma (desde, verbo, hasta, endpoint) → gana mayor confianza; hereda evidencia si le falta. */
function dedupe(aristas: GraphEdge[]): GraphEdge[] {
  const porClave = new Map<string, GraphEdge>();
  const mejor = (a: GraphEdge, b: GraphEdge): GraphEdge => {
    if (a.confianza !== b.confianza) return a.confianza > b.confianza ? a : b;
    if ((a.evidencia === null) !== (b.evidencia === null)) return a.evidencia !== null ? a : b;
    return cmp(a.evidencia ?? "", b.evidencia ?? "") <= 0 ? a : b;
  };
  for (const e of aristas) {
    const k = claveArista(e).join("\u0000");
    const prev = porClave.get(k);
    if (!prev) {
      porClave.set(k, e);
      continue;
    }
    const gana = mejor(prev, e);
    const pierde = gana === prev ? e : prev;
    porClave.set(k, gana.evidencia === null && pierde.evidencia !== null ? { ...gana, evidencia: pierde.evidencia } : gana);
  }
  return [...porClave.values()];
}

function parseJson(f: Fuente, errores: ErrorCompilacion[]): unknown {
  try {
    return JSON.parse(f.contenido);
  } catch (e) {
    errores.push({ archivo: f.ruta, linea: null, mensaje: `JSON inválido: ${(e as Error).message}` });
    return undefined;
  }
}

function pathTexto(path: ReadonlyArray<string | number>): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("") || "(raíz)";
}

/** Traduce un issue de zod a mensajes en castellano con su path. */
function mensajesZod(issue: ZodIssue): Array<{ path: Array<string | number>; mensaje: string }> {
  const campo = pathTexto(issue.path);
  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys.map((k) => ({ path: [...issue.path, k], mensaje: `campo desconocido: ${pathTexto([...issue.path, k])}` }));
    case "invalid_enum_value":
      return [
        {
          path: issue.path,
          mensaje: `${campo}: valor inválido "${String(issue.received)}"; se espera uno de: ${issue.options.join(", ")}`,
        },
      ];
    case "invalid_type":
      return [
        {
          path: issue.path,
          mensaje: issue.received === "undefined" ? `${campo}: obligatorio` : `${campo}: se espera ${issue.expected}, llegó ${issue.received}`,
        },
      ];
    default:
      return [{ path: issue.path, mensaje: `${campo}: ${issue.message}` }];
  }
}

function ordenarErrores(errores: ErrorCompilacion[]): ErrorCompilacion[] {
  return [...errores].sort(
    (a, b) => cmp(a.archivo, b.archivo) || (a.linea ?? 0) - (b.linea ?? 0) || cmp(a.mensaje, b.mensaje),
  );
}

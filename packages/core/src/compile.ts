import type { ZodIssue } from "zod";
import { cmp, cmpTuple, stringifyCanonical } from "./canonical.js";
import { CompileError, parsePagina, type ErrorCompilacion } from "./frontmatter.js";
import { aplicarBacklinks, renderBacklinksJson, renderIndex, renderMermaid } from "./render.js";
import {
  ArchivosSchema,
  carpetasDeTipo,
  CONFIANZA,
  ContratoSchema,
  claveDudosa,
  VerificacionSchema,
  ENDPOINT_REF,
  FrontmatterSchema,
  ID_PAGINA,
  VERBOS,
  VERBOS_RELACION,
  endpointId,
  evidenciaValida,
  CODIGO,
  normalizarRuta,
  verboAdmite,
  type Estado,
  type Frontmatter,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Origen,
  dentroDe,
  type Verbo,
} from "./schema.js";
import { aristasDeExtracciones, fichasDeFuncionalidades, tablasSinPagina, RUTA_FUNCIONALIDADES, type EstructuraArchivo, type Ficha } from "./funcionalidades.js";
import { aristasFinas } from "./finas.js";
import { alcancePorPantalla, grafoDePantallas } from "./pantallas.js";
import { componentesDelCerebro } from "./componentes.js";

/** Un archivo de entrada. `ruta` es relativa a la raíz del brain, con `/`. */
export interface Fuente {
  ruta: string;
  contenido: string;
}

export interface Entradas {
  paginas: Fuente[];
  contratos: Fuente[];
  archivos: Fuente[];
  /** `_build/verification.json` de `flowbrain verify`: sus aristas salen con estado `dudoso`. */
  verificacion?: Fuente | null;
  /** `_build/extraction/*.json` de `flowbrain index`: alimentan las fichas de funcionalidades y las relaciones finas del grafo. */
  extracciones?: Fuente[];
}

export interface Salidas {
  graph: Graph;
  /** Archivos generados: ruta relativa → contenido. */
  generados: Record<string, string>;
  /** Todas las páginas con la sección de backlinks inyectada: ruta relativa → contenido. */
  paginas: Record<string, string>;
  /** Vista de producto de cada `feat` (también va a `_build/features.json`). */
  funcionalidades: Ficha[];
}

export const RUTAS_SALIDA = {
  graph: "_build/graph.json",
  backlinks: "_build/backlinks.json",
  mapa: "_build/map.mmd",
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
    if (!carpetasDeTipo(fm.tipo).includes(carpeta as "product")) {
      errores.push({ archivo: f.ruta, linea: L(["tipo"]), mensaje: `una página de tipo ${fm.tipo} va en ${carpetasDeTipo(fm.tipo).join("/ o ")}/` });
    }
    if (fm.puntos_de_entrada && fm.tipo !== "svc") {
      errores.push({ archivo: f.ruta, linea: L(["puntos_de_entrada"]), mensaje: "puntos_de_entrada solo aplica a svc" });
    }
    if (fm.codigo && fm.tipo !== "feat" && fm.tipo !== "lib") {
      errores.push({ archivo: f.ruta, linea: L(["codigo"]), mensaje: "codigo solo aplica a feat y lib" });
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
        atributos: fm.puntos_de_entrada ? { puntos_de_entrada: fm.puntos_de_entrada } : fm.tipo === "lib" && fm.codigo?.length ? { codigo: [...fm.codigo].sort(cmp) } : {},
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
    if (f.ruta !== `_build/contracts/${c.svc}.json`) {
      errores.push({ archivo: f.ruta, linea: null, mensaje: `el archivo debe llamarse _build/contracts/${c.svc}.json` });
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
          ...(ep.query ? { query: ep.query } : {}),
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
  /** Símbolos, imports e invocaciones por `repo:ruta`: alimentan las fichas de funcionalidades y las relaciones finas del grafo. */
  const estructura = new Map<string, EstructuraArchivo>();
  /** Por repo: lo que hace falta para unir componentes entre paquetes cuando ya se leyeron todos. */
  const leidos: Parameters<typeof componentesDelCerebro>[0] = [];
  for (const f of archivosIn) {
    const data = parseJson(f, errores);
    if (data === undefined) continue;
    const res = ArchivosSchema.safeParse(data);
    if (!res.success) {
      for (const issue of res.error.issues) for (const { mensaje } of mensajesZod(issue)) errores.push({ archivo: f.ruta, linea: null, mensaje });
      continue;
    }
    const a = res.data;
    if (f.ruta !== `_build/files/${a.repo}.json`) {
      errores.push({ archivo: f.ruta, linea: null, mensaje: `el archivo debe llamarse _build/files/${a.repo}.json` });
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
      estructura.set(id, { simbolos: arc.simbolos, importa: arc.importa ?? [], invoca: arc.invoca ?? [], sinResolver: arc.sinResolver });
      agregarNodo(generado(id, "archivo", arc.ruta, { lenguaje: arc.lenguaje, repo: a.repo, ruta: arc.ruta }), f.ruta, null);
      aristas.push(arista(a.repo, "contiene", id, "parser"));
    });
    // Esquema: las columnas quedan en el nodo de la tabla; cada clave foránea es una dependencia entre tablas.
    for (const [i, t] of (a.esquema ?? []).entries()) {
      const n = nodos.get(t.tabla);
      if (n?.tipo !== "tabla") {
        if (!rotos.has(t.tabla)) errores.push({ archivo: f.ruta, linea: null, mensaje: `esquema[${i}]: tabla inexistente: ${t.tabla}` });
        continue;
      }
      checkEvidencia(t.evidencia, f.ruta, null, `esquema[${i}]`);
      n.atributos = { ...n.atributos, columnas: t.columnas, esquema: t.evidencia };
      for (const fk of t.fks) {
        if (nodos.get(fk.hasta)?.tipo !== "tabla" || fk.hasta === t.tabla) continue;
        aristas.push(arista(t.tabla, "depende_de", fk.hasta, "parser", { dato: `${fk.columnas.join(", ")} → ${fk.columnasRef.join(", ")}`, evidencia: fk.evidencia }));
      }
    }
    // Infraestructura: queda en el nodo dueño; `depends_on` de compose es una dependencia entre nodos.
    for (const [i, it] of (a.infra ?? []).entries()) {
      const n = nodos.get(it.de);
      if (!n) {
        if (!rotos.has(it.de)) errores.push({ archivo: f.ruta, linea: null, mensaje: `infra[${i}]: nodo inexistente: ${it.de}` });
        continue;
      }
      checkEvidencia(it.evidencia, f.ruta, null, `infra[${i}]`);
      const previa = (n.atributos["infra"] as unknown[] | undefined) ?? [];
      n.atributos = { ...n.atributos, infra: [...previa, { clase: it.clase, nombre: it.nombre, detalle: it.detalle, evidencia: it.evidencia }] };
      for (const d of it.dependeDe ?? []) {
        const h = nodos.get(d);
        if (h && verboAdmite("depende_de", n.tipo, h.tipo)) aristas.push(arista(it.de, "depende_de", d, "parser", { evidencia: it.evidencia }));
      }
    }
    // Pantallas del front: cada una es del servicio cuya raíz contiene su componente (o del repo, si no tiene).
    const svcs = paginas.filter((q) => q.fm.tipo === "svc" && (q.fm.vive_en ?? []).includes(a.repo));
    const dueñoDe = (archivo: string) => {
      const precisos = svcs.filter((q) => {
        const r = raizDeServicio(q.fm.puntos_de_entrada);
        return r !== null && (r === "" || archivo === r || archivo.startsWith(`${r}/`));
      });
      const elegido = (precisos.length ? precisos : svcs).map((q) => q.fm.id).sort(cmp)[0];
      return elegido ?? a.repo;
    };
    let pantallasDelRepo: Array<{ id: string; atributos: { componentes: string[] } }> = [];
    if (a.pantallas?.length) {
      const pg = grafoDePantallas(a.repo, a.pantallas, a.navegaciones ?? [], estructura, dueñoDe);
      for (const n of pg.nodos) {
        agregarNodo({ ...generado(n.id, "pantalla", n.nombre, n.atributos as unknown as Record<string, unknown>), aliases: n.aliases }, f.ruta, null);
        aristas.push(arista(n.id.slice(0, n.id.indexOf(":pantalla:")), "contiene", n.id, "parser", { evidencia: n.atributos.evidencia }));
      }
      for (const e of pg.aristas) aristas.push(arista(e.desde, "navega_a", e.hasta, "parser", { evidencia: e.evidencia }));
      pantallasDelRepo = pg.nodos;
    }
    leidos.push({ repo: a.repo, archivos: a.archivos, paquetes: a.paquetes ?? [], dueñoDe, alcance: () => alcancePorPantalla(a.repo, pantallasDelRepo, estructura) });
  }

  // ---------- 3b. Componentes y dependencias entre paquetes del cerebro ----------
  // Un sistema de diseño (o cualquier librería) en un repo y quien lo importa en otro: cada componente que exporta es
  // un nodo, y cada pantalla que lo dibuja lo `usa`. Lo que se importa de un paquete de otro cerebro se une al consultar.
  const comps = componentesDelCerebro(leidos);
  for (const n of comps.nodos) agregarNodo({ ...generado(n.id, "componente", n.nombre, n.atributos), aliases: n.aliases }, "_build/files", null);
  for (const e of comps.aristas) if (nodos.has(e.desde) && nodos.has(e.hasta) && verboAdmite(e.verbo, nodos.get(e.desde)!.tipo, nodos.get(e.hasta)!.tipo)) aristas.push(arista(e.desde, e.verbo, e.hasta, "parser", { evidencia: e.evidencia, ...(e.dato ? { dato: e.dato } : {}) }));

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

    // codigo de una feat: cada servicio que vive en ese repo la implementa (o el repo, si no tiene servicios).
    (fm.tipo === "feat" || fm.tipo === "lib" ? (fm.codigo ?? []) : []).forEach((c, i) => {
      const m = CODIGO.exec(c);
      if (!m) return void errores.push({ archivo: ruta, linea: L(["codigo", i]), mensaje: `codigo con formato inválido: "${c}" (se espera "repo-x:ruta/a/carpeta")` });
      const repo = m[1]!;
      if (!esRepo(repo)) return rotos.has(repo) ? undefined : void errores.push({ archivo: ruta, linea: L(["codigo", i]), mensaje: `codigo: repo inexistente: ${repo}` });
      // El `codigo` de una librería solo delimita qué archivos son suyos: nadie la "implementa".
      if (fm.tipo === "lib") return;
      const enRepo = paginas.filter((q) => q.fm.tipo === "svc" && (q.fm.vive_en ?? []).includes(repo));
      // En un monorepo, solo los servicios cuya raíz (por puntos_de_entrada) contiene la ruta o está dentro de ella.
      const precisos = enRepo.filter((q) => {
        const r = raizDeServicio(q.fm.puntos_de_entrada);
        return r !== null && (r === "" || m[2] === r || m[2]!.startsWith(`${r}/`) || r.startsWith(`${m[2]}/`));
      });
      const svcs = (precisos.length ? precisos : enRepo).map((q) => q.fm.id);
      for (const d of svcs.length ? svcs : [repo]) aristas.push(arista(d, "implementa", fm.id, "parser", { evidencia: `${repo}:${m[2]}` }));
    });

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

  // ---------- 4a. Pantallas → funcionalidad: la que tiene el componente de la pantalla en su `codigo` ----------
  const feats = paginas.filter((p) => p.fm.tipo === "feat");
  for (const n of nodos.values()) {
    if (n.tipo !== "pantalla") continue;
    const comps = ((n.atributos as { componentes?: string[] }).componentes ?? []).map((c) => c.slice(0, c.lastIndexOf("#")));
    for (const q of feats) {
      const c = comps.find((x) => (q.fm.codigo ?? []).some((k) => dentroDe(x, k)));
      if (c) aristas.push(arista(n.id, "implementa", q.fm.id, "parser", { evidencia: c }));
    }
  }

  // ---------- 4b. Verificación: aristas cuya evidencia ya no está → dudoso (deprecado manda) ----------
  const dudosas = new Set<string>();
  if (entradas.verificacion) {
    const v = VerificacionSchema.safeParse(parseJson(entradas.verificacion, errores));
    if (v.success) for (const d of v.data.dudosas) dudosas.add(claveDudosa(d));
    else if (entradas.verificacion.contenido.trim() !== "") errores.push({ archivo: entradas.verificacion.ruta, linea: null, mensaje: "verificación con formato inválido; borrala y corré flowbrain verify" });
  }

  if (errores.length > 0) throw new CompileError(ordenarErrores(errores));

  // ---------- 5. Relaciones finas, dedupe y orden ----------
  const featsPagina = paginas.filter((p) => p.fm.tipo === "feat").map((p) => ({ id: p.fm.id, codigo: p.fm.codigo ?? [], cuerpo: p.cuerpo }));
  const extracciones = [...(entradas.extracciones ?? [])].sort(porRuta).map((f) => f.contenido);
  const accesos = aristasDeExtracciones(extracciones);
  const sinPagina = tablasSinPagina(extracciones);
  const nodes = [...nodos.values()].sort((a, b) => cmp(a.id, b.id));
  const base = dedupe(aristas);
  // Si una página ya declara la misma relación, gana la curada (dedupe por confianza).
  const libsPagina = paginas.filter((p) => p.fm.tipo === "lib" && p.fm.codigo?.length).map((p) => ({ id: p.fm.id, codigo: p.fm.codigo ?? [] }));
  const finas = aristasFinas({ edges: base, nodes, version: 1 }, featsPagina, accesos, estructura, sinPagina, libsPagina);
  const graph: Graph = {
    edges: dedupe([...base, ...finas])
      .map((e) => (e.estado === "vigente" && e.evidencia !== null && dudosas.has(claveDudosa({ ...e, evidencia: e.evidencia })) ? { ...e, estado: "dudoso" as const } : e))
      .sort((a, b) => cmpTuple(claveArista(a), claveArista(b))),
    nodes,
    version: 1,
  };

  // ---------- 6. Salidas ----------
  const generados: Record<string, string> = {
    [RUTAS_SALIDA.graph]: stringifyCanonical(graph),
    [RUTAS_SALIDA.backlinks]: renderBacklinksJson(graph),
    [RUTAS_SALIDA.mapa]: renderMermaid(graph),
    [RUTAS_SALIDA.index]: renderIndex(graph),
  };
  const funcionalidades = fichasDeFuncionalidades(graph, featsPagina, accesos, estructura, sinPagina);
  if (funcionalidades.length > 0) generados[RUTA_FUNCIONALIDADES] = stringifyCanonical({ funcionalidades, version: 1 });
  const salidaPaginas: Record<string, string> = {};
  for (const p of paginas) {
    salidaPaginas[p.ruta] = `---\n${p.frontmatter}---\n${aplicarBacklinks(p.cuerpo, p.fm.id, graph, p.ruta)}`;
  }
  return { graph, generados, paginas: salidaPaginas, funcionalidades };
}

// ---------- helpers ----------

/** Carpeta común a los puntos de entrada de un servicio (`""` = el repo entero; `null` = no declarados). */
export function raizDeServicio(puntos: Record<string, string> | undefined): string | null {
  const dirs = Object.values(puntos ?? {}).map((v) => {
    const t = v.replace(/^\.\/?/, "");
    return (t.endsWith("/") ? t.slice(0, -1) : t.includes("/") ? t.slice(0, t.lastIndexOf("/")) : "").split("/").filter(Boolean);
  });
  if (dirs.length === 0) return null;
  const comun: string[] = [];
  for (let i = 0; dirs.every((d) => i < d.length && d[i] === dirs[0]![i]); i++) comun.push(dirs[0]![i]!);
  return comun.join("/");
}

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

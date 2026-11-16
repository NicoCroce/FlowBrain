import { isMap, isScalar, isSeq, parseDocument, Document, Scalar, YAMLSeq } from "yaml";
import { cmp, dentroDe, FrontmatterSchema, MARCA_INICIO, normalizarRuta, parsePagina, simboloDeLinea, type Fuente } from "@brain/core";
import { slug, type AristaExtraida, type Pendiente, type ResultadoIndex } from "@brain/parsers";

/**
 * Generador de borradores del indexador (`brain draft`). Determinístico y sin LLM: a partir de la extracción
 * propone páginas para `_drafts/<repo>/tecnologia/` y deja en "Preguntas abiertas" lo que no pudo resolver.
 * Un agente puede refinarlas con `PROMPT.md`; un humano las revisa y las mueve a `tecnologia/`.
 */

export const RESUMEN_PENDIENTE = "Borrador: completar resumen.";
export const TITULO_PREGUNTAS = "## Preguntas abiertas";
const AVISO = "> Borrador generado por `brain draft`. Revisalo, completalo y movelo a `tecnologia/`.";
const AVISO_PRODUCTO = "> Borrador generado por `brain draft` a partir de la estructura del código. Revisalo, completalo y movelo a `producto/`.";
export const QUE_ES_PENDIENTE = "_Completar: qué problema resuelve para quien la usa, quién la usa y cuál es el flujo principal._";

/** Carpetas que agrupan funcionalidades por convención, en cualquier lenguaje o framework. */
const RAICES_FUNCIONALIDAD = new Set(["features", "feature", "modules", "module", "domains", "domain"]);
/** Hijas de esas carpetas que no son funcionalidades sino código compartido. */
const NO_FUNCIONALIDAD = new Set(["shared", "common", "core", "utils", "util", "helpers", "lib", "libs", "types", "config", "constants", "test", "tests", "__tests__", "__mocks__"]);

/**
 * Carpetas de funcionalidad de un repo: cada hija de `features/`, `modules/` o `domains/` (hasta 4 niveles de
 * profundidad) que contenga archivos. Se toma la raíz más externa: `modules/x/features/y` da `modules/x`. Lo que cuelga
 * de una carpeta de código compartido (`shared/domain/x`, `core/modules/y`) no es una funcionalidad.
 */
export function carpetasDeFuncionalidad(rutas: string[]): string[] {
  const out = new Set<string>();
  for (const r of rutas) {
    const segs = r.split("/");
    for (let i = 0; i < Math.min(segs.length - 2, 4); i++) {
      const hija = segs[i + 1]!;
      if (NO_FUNCIONALIDAD.has(segs[i]!.toLowerCase())) break;
      if (!RAICES_FUNCIONALIDAD.has(segs[i]!.toLowerCase())) continue;
      if (!NO_FUNCIONALIDAD.has(hija.toLowerCase()) && !/^[._]/.test(hija)) out.add(segs.slice(0, i + 2).join("/"));
      break;
    }
  }
  return [...out].sort(cmp);
}

/** `videoAnalysis` → `Video analysis`; `premios-hi` → `Premios hi`. */
export function nombreDeCarpeta(carpeta: string): string {
  const t = carpeta.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_.]+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface RelacionBorrador {
  verbo: string;
  destino: string;
  endpoint?: string;
  dato?: string;
  evidencia: string;
  origen: "parser" | "inferido";
}

interface PaginaExistente {
  ruta: string;
  id: string;
  tipo: string;
  frontmatter: string;
  cuerpo: string;
  relaciones: Set<string>;
  viveEn: string[];
  codigo: string[];
}

export interface Borradores {
  /** Ruta relativa a la raíz del brain (`_drafts/<repo>/…`) → contenido. */
  archivos: Record<string, string>;
  resumen: { paginas: number; relaciones: number; preguntas: number; tablas: number; externos: number; funcionalidades: number };
}

const claveRel = (verbo: string, destino: string, endpoint: string | null | undefined) => {
  const ep = endpoint ? endpoint.replace(/^([A-Za-z]+)\s+(.*)$/, (_, m: string, r: string) => `${m.toUpperCase()} ${normalizarRuta(r)}`) : "";
  return `${verbo}\u0000${destino}\u0000${ep}`;
};

/** `svc-x:POST:/a/{id}` → `POST /a/{id}` (formato de `endpoint` en las páginas). */
const endpointPagina = (id: string, svc: string) => id.slice(svc.length + 1).replace(":", " ");

/** Etiqueta significativa de un host público: `api.pasarela.example` → `pasarela`. */
export function etiquetaHost(host: string): string | null {
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host === "localhost") return null;
  const partes = host.split(".").slice(0, -1);
  return partes[partes.length - 1] ?? null;
}

function leerPaginas(paginas: Fuente[]): Map<string, PaginaExistente> {
  const out = new Map<string, PaginaExistente>();
  for (const f of paginas) {
    try {
      const p = parsePagina(f.ruta, f.contenido);
      const r = FrontmatterSchema.safeParse(p.data);
      if (!r.success) continue;
      const relaciones = new Set((r.data.relaciones ?? []).map((x) => claveRel(x.verbo, x.destino, x.endpoint)));
      out.set(r.data.id, { ruta: f.ruta, id: r.data.id, tipo: r.data.tipo, frontmatter: p.frontmatter, cuerpo: p.cuerpo, relaciones, viveEn: r.data.vive_en ?? [], codigo: r.data.codigo ?? [] });
    } catch {
      /* páginas rotas: las reporta compile */
    }
  }
  return out;
}

/** Serializa un frontmatter con relaciones en estilo flujo, una por línea (como las páginas escritas a mano). */
function conRelaciones(frontmatter: string, nuevas: RelacionBorrador[]): string {
  const doc = parseDocument(frontmatter, { version: "1.2", schema: "core" });
  if (nuevas.length > 0) {
    let seq = doc.get("relaciones", true);
    if (!isSeq(seq)) {
      seq = new YAMLSeq();
      doc.set("relaciones", seq);
    }
    for (const r of nuevas) {
      const nodo = doc.createNode(r);
      if (isMap(nodo)) {
        nodo.flow = true;
        for (const it of nodo.items) {
          if (isScalar(it.key) && ["evidencia", "endpoint"].includes(String(it.key.value)) && isScalar(it.value)) it.value.type = Scalar.QUOTE_DOUBLE;
        }
      }
      (seq as YAMLSeq).items.push(nodo);
    }
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

function nuevoFrontmatter(campos: Record<string, unknown>, nuevas: RelacionBorrador[]): string {
  const doc = new Document(campos);
  for (const k of ["aliases", "vive_en"]) {
    const n = doc.get(k, true);
    if (isSeq(n)) n.flow = true;
  }
  return conRelaciones(doc.toString({ lineWidth: 0, flowCollectionPadding: false }), nuevas);
}

/** Reemplaza (o agrega) la sección de preguntas abiertas, antes de los backlinks generados. */
function conPreguntas(cuerpo: string, lineas: string[]): string {
  let texto = cuerpo;
  const i = texto.indexOf(TITULO_PREGUNTAS);
  if (i >= 0) {
    const resto = texto.slice(i + TITULO_PREGUNTAS.length);
    const fin = resto.search(/^## |^<!-- brain:backlinks:inicio -->/m);
    texto = texto.slice(0, i) + (fin >= 0 ? resto.slice(fin) : "");
  }
  if (lineas.length === 0) return texto;
  const seccion = `${TITULO_PREGUNTAS}\n\n${lineas.join("\n")}\n`;
  const b = texto.indexOf(MARCA_INICIO);
  const antes = b >= 0 ? texto.slice(0, b) : texto;
  const despues = b >= 0 ? `\n${texto.slice(b)}` : "";
  return (antes.trim() === "" ? "\n" : antes.replace(/\n*$/, "\n\n")) + seccion + despues;
}

const pagina = (frontmatter: string, cuerpo: string) => `---\n${frontmatter}---\n${cuerpo}`;

/** Preguntas abiertas de un svc: pendientes agrupados por (motivo, referencia), con evidencia y candidatos. */
function preguntas(pendientes: Pendiente[]): string[] {
  const grupos = new Map<string, Pendiente[]>();
  for (const p of pendientes) {
    const k = `${p.motivo}\u0000${p.referencia}`;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  return [...grupos.values()].map((ps) => {
    const p = ps[0]!;
    const evs = ps.map((x) => `\`${x.evidencia}\``);
    const mas = evs.length > 3 ? ` (+${evs.length - 3} más)` : "";
    const cands = [...new Set(ps.flatMap((x) => x.candidatos.map((c) => c.endpoint ?? c.hasta)))].sort(cmp);
    return `- \`${p.verbo}\` \`${p.referencia}\`: ${p.motivo}. Evidencia: ${evs.slice(0, 3).join(", ")}${mas}.${cands.length ? ` Candidatos: ${cands.map((c) => `\`${c}\``).join(", ")}.` : ""}`;
  });
}

export function generarBorradores(r: ResultadoIndex, paginas: Fuente[], carpetaRepo: string, borradoresProducto: Fuente[] = []): Borradores {
  const existentes = leerPaginas(paginas);
  const base = `_drafts/${r.repo}`;
  const archivos: Record<string, string> = {};
  const resumen = { paginas: 0, relaciones: 0, preguntas: 0, tablas: 0, externos: 0, funcionalidades: 0 };

  // ---------- 1. Propuestas: tablas y sistemas externos que el brain no tiene ----------
  const propuestas = new Map<string, { tipo: "tabla" | "ext"; nombre: string; aliases: Set<string>; evidencias: string[]; modelos: Set<string> }>();
  const propuestas_aristas: AristaExtraida[] = [];
  const restantes: Pendiente[] = [];
  for (const p of r.pendientes) {
    let id: string | null = null;
    if (p.candidatos.length === 0 && p.objetivo && p.motivo.startsWith("modelo sin tabla")) {
      const s = slug(p.objetivo);
      id = s ? `tabla-${s}` : null;
    } else if (p.candidatos.length === 0 && p.objetivo && p.motivo.startsWith("host sin nodo")) {
      const e = etiquetaHost(p.objetivo);
      id = e && slug(e) ? `ext-${slug(e)}` : null;
    }
    if (!id || existentes.has(id)) {
      restantes.push(p);
      continue;
    }
    const tipo = id.startsWith("tabla-") ? "tabla" : "ext";
    const prop = propuestas.get(id) ?? { tipo, nombre: p.objetivo!, aliases: new Set<string>(), evidencias: [], modelos: new Set<string>() };
    prop.aliases.add(p.objetivo!);
    if (tipo === "tabla") {
      prop.aliases.add(p.referencia);
      prop.modelos.add(p.referencia);
    }
    prop.evidencias.push(p.evidencia);
    propuestas.set(id, prop);
    propuestas_aristas.push({
      dato: tipo === "tabla" ? p.referencia : null,
      desde: p.desde,
      endpoint: null,
      evidencia: p.evidencia,
      hasta: id,
      origen: "parser",
      verbo: p.verbo,
    });
  }

  // Para las tablas: qué método hace cada acceso (por la estructura del índice) y de qué funcionalidad es.
  const estructura = new Map(r.archivos.archivos.map((a) => [`${r.repo}:${a.ruta}`, a]));
  const metodoDe = (ev: string) => {
    const m = /^([^#]+)#L(\d+)$/.exec(ev);
    const a = m ? estructura.get(m[1]!) : undefined;
    const s = a ? simboloDeLinea({ simbolos: a.simbolos, importa: [], invoca: [] }, Number(m![2])) : null;
    return s ? `${s.nombre} @ ${m![1]}#L${s.linea}` : ev;
  };
  const featsConCodigo = [...existentes.values()].filter((p) => p.tipo === "feat" && p.codigo.length);
  const featDe = (ev: string) => featsConCodigo.filter((f) => f.codigo.some((c) => dentroDe(ev.replace(/#L\d+$/, ""), c))).map((f) => f.id);
  // Base probable: donde viven las tablas con página que tocan los mismos servicios, si es una sola.
  const basesDe = (servicios: Set<string>) => {
    const dbs = new Set<string>();
    for (const a of r.aristas) {
      if ((a.verbo === "lee_de" || a.verbo === "escribe_en") && servicios.has(a.desde)) for (const d of existentes.get(a.hasta)?.viveEn ?? []) dbs.add(d);
    }
    return [...dbs].sort(cmp);
  };

  for (const [id, prop] of [...propuestas].sort((a, b) => cmp(a[0], b[0]))) {
    const evs = [...new Set(prop.evidencias)].sort(cmp);
    const campos: Record<string, unknown> = {
      id,
      tipo: prop.tipo,
      nombre: prop.nombre,
      resumen: RESUMEN_PENDIENTE,
      aliases: [...prop.aliases].sort(cmp),
    };
    const titulo = `# ${prop.nombre}\n\n${AVISO}\n\n`;
    let detalle =
      prop.tipo === "tabla"
        ? `Modelo${prop.modelos.size > 1 ? "s" : ""} ${[...prop.modelos].sort(cmp).map((m) => `\`${m}\``).join(", ")}; primer acceso en \`${evs[0]}\` (${evs.length} en total).\n`
        : `Host \`${[...prop.aliases].sort(cmp).join("`, `")}\`; primera llamada en \`${evs[0]}\` (${evs.length} en total).\n`;
    let pregunta =
      prop.tipo === "tabla"
        ? "- ¿En qué base de datos vive? Agregá `vive_en: [db-…]` (y la página de la base si no existe)."
        : "- ¿Es un sistema de terceros (`ext`) o un servicio propio (`svc`)? Si es propio, renombrá la página.";
    if (prop.tipo === "tabla") {
      const accesos = propuestas_aristas.filter((a) => a.hasta === id);
      const porMetodo = new Map<string, Set<string>>();
      for (const a of accesos) {
        const k = metodoDe(a.evidencia);
        porMetodo.set(k, (porMetodo.get(k) ?? new Set<string>()).add(a.verbo === "escribe_en" ? "escribe" : "lee"));
      }
      const lista = [...porMetodo].sort((a, b) => cmp(a[0], b[0]));
      const fs = [...new Set(accesos.flatMap((a) => featDe(a.evidencia)))].sort(cmp);
      detalle +=
        "\n## Quién la usa\n\n" +
        lista
          .slice(0, 30)
          .map(([m, v]) => `- \`${m}\` (${[...v].sort(cmp).join(" y ")})`)
          .join("\n") +
        (lista.length > 30 ? `\n- … y ${lista.length - 30} métodos más` : "") +
        "\n" +
        (fs.length ? `\nFuncionalidades: ${fs.map((f) => `[[${f}]]`).join(", ")}.\n` : "");
      const dbs = basesDe(new Set(accesos.map((a) => a.desde)));
      if (dbs.length === 1) {
        campos["vive_en"] = dbs;
        pregunta = `- Se propone \`vive_en: [${dbs[0]}]\` porque las demás tablas que usan esos servicios viven ahí: confirmalo.`;
      }
    }
    archivos[`${base}/tecnologia/${id}.md`] = pagina(nuevoFrontmatter(campos, []), conPreguntas(titulo + detalle, [pregunta]));
    resumen.paginas++;
    resumen.preguntas++;
    if (prop.tipo === "tabla") resumen.tablas++;
    else resumen.externos++;
  }

  // ---------- 2. Página del repo, si no existe ----------
  const svcs = [...new Map(r.servicios.map((s) => [s.svc, s])).values()].sort((a, b) => cmp(a.svc, b.svc));
  if (r.repoNuevo || !existentes.has(r.repo)) {
    const campos = { id: r.repo, tipo: "repo", nombre: carpetaRepo, resumen: RESUMEN_PENDIENTE, aliases: [carpetaRepo] };
    const lista = svcs.map((s) => `- \`${s.svc}\` (paquete \`${s.paquete || "."}\`)`).join("\n");
    const cuerpo = `# ${carpetaRepo}\n\n${AVISO}\n\n${r.archivos.archivos.length} archivos indexados. Servicios detectados:\n\n${lista}\n`;
    archivos[`${base}/tecnologia/${r.repo}.md`] = pagina(nuevoFrontmatter(campos, []), cuerpo);
    resumen.paginas++;
  }

  // ---------- 3. Una página por svc: relaciones nuevas + preguntas abiertas ----------
  const aristas = [...r.aristas, ...propuestas_aristas];
  for (const s of svcs) {
    const previa = existentes.get(s.svc);
    const vistas = new Set(previa?.relaciones ?? []);
    const nuevas: RelacionBorrador[] = [];
    for (const a of aristas.filter((x) => x.desde === s.svc).sort((x, y) => cmp(`${x.verbo} ${x.hasta} ${x.endpoint ?? ""}`, `${y.verbo} ${y.hasta} ${y.endpoint ?? ""}`) || cmp(x.evidencia, y.evidencia))) {
      const endpoint = a.endpoint ? endpointPagina(a.endpoint, a.hasta) : undefined;
      const k = claveRel(a.verbo, a.hasta, endpoint);
      if (vistas.has(k)) continue;
      vistas.add(k);
      nuevas.push({
        verbo: a.verbo,
        destino: a.hasta,
        ...(endpoint ? { endpoint } : {}),
        ...(a.dato ? { dato: a.dato } : {}),
        evidencia: a.evidencia,
        origen: a.origen,
      });
    }
    const qs = preguntas(restantes.filter((p) => p.desde === s.svc));
    if (previa && nuevas.length === 0 && qs.length === 0) continue;
    let contenido: string;
    if (previa) {
      contenido = pagina(conRelaciones(previa.frontmatter, nuevas), conPreguntas(previa.cuerpo, qs));
    } else {
      const nombre = s.paquete === "" ? carpetaRepo : (s.paquete.split("/").pop() ?? s.paquete);
      const campos = {
        id: s.svc,
        tipo: "svc",
        nombre,
        resumen: RESUMEN_PENDIENTE,
        vive_en: [r.repo],
        puntos_de_entrada: { raiz: s.paquete || "." },
      };
      contenido = pagina(nuevoFrontmatter(campos, nuevas), conPreguntas(`# ${nombre}\n\n${AVISO}\n`, qs));
    }
    archivos[`${base}/tecnologia/${s.svc}.md`] = contenido;
    resumen.paginas++;
    resumen.relaciones += nuevas.length;
    resumen.preguntas += qs.length;
  }

  // ---------- 4. Funcionalidades: una por carpeta de features/modules/domains ----------
  // Van a `_drafts/producto/` (una funcionalidad puede abarcar varios repos). Si ya existe una página o un borrador
  // con el mismo id, se le suma la ruta a `codigo`: así `wellness` del front y `wellness` del back quedan juntas.
  const feats = new Map<string, { ruta: string; frontmatter: string; cuerpo: string; codigo: string[]; borrador: boolean }>();
  const cargar = (fuentes: Fuente[], borrador: boolean) => {
    for (const f of fuentes) {
      try {
        const p = parsePagina(f.ruta, f.contenido);
        const d = FrontmatterSchema.safeParse(p.data);
        if (d.success && d.data.tipo === "feat") feats.set(d.data.id, { ruta: f.ruta, frontmatter: p.frontmatter, cuerpo: p.cuerpo, codigo: d.data.codigo ?? [], borrador });
      } catch {
        /* páginas rotas: las reporta compile */
      }
    }
  };
  cargar(paginas.filter((f) => f.ruta.startsWith("producto/")), false);
  cargar(borradoresProducto, true);
  // Una carpeta repartida entre varias funcionalidades (cada subcarpeta en el `codigo` de alguna) también está
  // cubierta: los archivos sueltos de su raíz (`player.module.ts`) solo cablean las partes.
  const rutasRepo = r.archivos.archivos.map((a) => a.ruta);
  const cubierta = (c: string): boolean => {
    if ([...feats.values()].some((f) => f.codigo.some((x) => x === c || dentroDe(c, x)))) return true;
    const carpeta = c.slice(c.indexOf(":") + 1);
    const hijas = new Set(rutasRepo.filter((a) => a.startsWith(carpeta + "/") && a.slice(carpeta.length + 1).includes("/")).map((a) => a.slice(carpeta.length + 1).split("/")[0]!));
    return hijas.size > 0 && [...hijas].every((h) => cubierta(`${c}/${h}`));
  };
  for (const carpeta of carpetasDeFuncionalidad(r.archivos.archivos.map((a) => a.ruta))) {
    const codigo = `${r.repo}:${carpeta}`;
    if (cubierta(codigo)) continue;
    const hoja = carpeta.split("/").pop()!;
    const id = `feat-${slug(hoja.replace(/([a-z0-9])([A-Z])/g, "$1-$2"))}`;
    if (id === "feat-") continue;
    const previa = feats.get(id);
    let frontmatter: string;
    let cuerpo: string;
    if (previa) {
      const doc = parseDocument(previa.frontmatter, { version: "1.2", schema: "core" });
      let seq = doc.get("codigo", true);
      if (!isSeq(seq)) {
        seq = new YAMLSeq();
        doc.set("codigo", seq);
      }
      (seq as YAMLSeq).items.push(doc.createNode(codigo));
      frontmatter = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
      cuerpo = previa.cuerpo;
    } else {
      const nombre = nombreDeCarpeta(hoja);
      const doc = new Document({ id, tipo: "feat", nombre, resumen: RESUMEN_PENDIENTE, aliases: [hoja], codigo: [codigo] });
      const al = doc.get("aliases", true);
      if (isSeq(al)) al.flow = true;
      frontmatter = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
      cuerpo = conPreguntas(`# ${nombre}\n\n${AVISO_PRODUCTO}\n\n## Qué es\n\n${QUE_ES_PENDIENTE}\n`, [
        "- ¿Es el nombre que usa el negocio? Si no, cambiá `nombre` y dejá el nombre técnico en `aliases`.",
        "- ¿Es la misma funcionalidad que otra con otro nombre (por ejemplo en otro repo)? Uní sus rutas de `codigo` en una sola página y borrá la otra.",
        "- ¿Qué equipo es responsable? Agregá `pertenece_a: [team-…]`.",
      ]);
    }
    const nueva = { ruta: `_drafts/producto/${id}.md`, frontmatter, cuerpo, codigo: [...(previa?.codigo ?? []), codigo], borrador: true };
    feats.set(id, nueva);
    archivos[nueva.ruta] = pagina(frontmatter, cuerpo);
    if (!previa) resumen.funcionalidades++;
  }
  resumen.paginas += resumen.funcionalidades;

  archivos[`${base}/PROMPT.md`] = promptAgente(r.repo, Object.keys(archivos).filter((k) => k.startsWith(`${base}/`) && k.endsWith(".md")).map((k) => k.slice(base.length + 1)).sort(cmp));
  return { archivos, resumen };
}

/** Prompt fijo para que un agente refine los borradores sin inventar nada. */
export function promptAgente(repo: string, paginas: string[]): string {
  return [
    `# Revisión de borradores de \`${repo}\``,
    "",
    "Estos borradores los generó `brain draft` a partir del código, sin LLM. Tu trabajo es refinarlos, no reescribirlos.",
    "",
    "Reglas:",
    "",
    `1. Trabajá solo dentro de \`_drafts/${repo}/\`. Nunca escribas en \`tecnologia/\` ni en \`producto/\`: un humano mueve los borradores tras revisarlos.`,
    `2. Reemplazá cada \`resumen: ${RESUMEN_PENDIENTE}\` por una línea (máximo 140 caracteres) que diga qué hace el nodo, sacada de leer el código.`,
    "3. Para cada ítem de \"Preguntas abiertas\": abrí la evidencia citada. Si podés resolverlo con certeza, agregá la relación con `evidencia: \"<repo>:<ruta>#L<n>\"` y `origen: inferido`, y borrá el ítem. Si no, dejalo como está.",
    "4. No agregues relaciones sin evidencia, no cambies ids ni borres relaciones con `origen: parser`.",
    `5. En \`_drafts/producto/\`, completá "Qué es" de cada funcionalidad leyendo las pantallas y textos de su \`codigo\`: qué le permite hacer a quien la usa, en lenguaje de producto, sin nombres de archivos ni de clases. Si no queda claro, dejá el texto pendiente.`,
    "6. Al terminar, verificá que el borrador compile: copiá `tecnologia/` del borrador sobre una copia del brain, corré `brain index <repo>` y `brain compile`.",
    "",
    "Páginas:",
    "",
    ...paginas.map((p) => `- \`${p}\``),
    "",
  ].join("\n");
}

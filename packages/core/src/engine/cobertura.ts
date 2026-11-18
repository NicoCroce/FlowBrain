import { parse } from "yaml";
import { llamadasDePantalla, llamadasPorResolver, type PorResolverParams } from "./codigo.js";
import type { Contexto } from "./contexto.js";
import { ConsultaError, normalizar, rutaCoincide } from "./herramientas.js";

/**
 * Cobertura del índice de un brain: qué parte de lo que hay en el código quedó conectada. Es el número que tiene que
 * subir quien completa el índice (una persona, o un modelo que escribe extractores), y el que avisa cuando algo se
 * rompe. Los controles (`checks.yaml`, en la raíz del brain) son hechos verificados a mano que tienen que seguir saliendo.
 *
 * ```yaml
 * controles:
 *   - { tipo: endpoint, metodo: POST, ruta: "/api/login" }
 *   - { tipo: pantalla, ruta: "/login" }
 *   - { tipo: llamada, archivo: "src/features/auth/api.ts", metodo: POST, ruta: "/login" }
 *   - { tipo: traza, endpoint: "POST /api/login", tabla: "user", nota: "el login actualiza el token del usuario" }
 *   - { tipo: alcanza, pantalla: "/login", metodo: POST, ruta: "/login", nota: "la traza de un front: pantalla → llamada" }
 * ```
 */
export const ARCHIVO_CONTROLES = "checks.yaml";

export interface Control {
  tipo: "endpoint" | "pantalla" | "llamada" | "traza" | "alcanza";
  pantalla?: string;
  metodo?: string;
  ruta?: string;
  archivo?: string;
  endpoint?: string;
  tabla?: string;
  nota?: string;
}

export function leerControles(texto: string): { controles: Control[]; malFormados: string[] } {
  const controles: Control[] = [], malFormados: string[] = [];
  let doc: unknown;
  try {
    doc = parse(texto);
  } catch (e) {
    return { controles, malFormados: [`${ARCHIVO_CONTROLES}: YAML inválido (${(e as Error).message.split("\n")[0]})`] };
  }
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const lista = (doc as { controles?: unknown } | null)?.controles;
  (Array.isArray(lista) ? lista : []).forEach((x: Record<string, unknown>, i) => {
    const c = { tipo: t(x?.["tipo"]), pantalla: t(x?.["pantalla"]), metodo: t(x?.["metodo"])?.toUpperCase(), ruta: t(x?.["ruta"]), archivo: t(x?.["archivo"]), endpoint: t(x?.["endpoint"]), tabla: t(x?.["tabla"]), nota: t(x?.["nota"]) };
    const ok =
      (c.tipo === "endpoint" && c.metodo && c.ruta) || (c.tipo === "pantalla" && c.ruta) || (c.tipo === "llamada" && c.archivo && c.metodo && c.ruta) || (c.tipo === "traza" && c.endpoint && /^[A-Za-z]+ \//.test(c.endpoint) && c.tabla) || (c.tipo === "alcanza" && c.pantalla && c.metodo && c.ruta?.startsWith("/"));
    if (ok) controles.push(Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as unknown as Control);
    else malFormados.push(`control ${i + 1}: tipo desconocido o faltan campos (${JSON.stringify(x).slice(0, 120)})`);
  });
  return { controles, malFormados };
}

export interface InformeExtractorBreve {
  repo: string;
  extractor: string;
  error?: string;
  aceptados: Record<string, number>;
  rechazados: number;
  motivos: string[];
  antes?: number;
  caida?: true;
}

export interface CoberturaParams extends PorResolverParams {
  controles?: Control[];
  extractores?: InformeExtractorBreve[];
}

const pct = (n: number, de: number) => (de ? Math.round((1000 * n) / de) / 10 : null);

export function cobertura(ctx: Contexto, p: CoberturaParams = {}) {
  const ix = ctx.codigo;
  if (!ix) throw new ConsultaError("parametro_invalido", "no hay índice de código: corré `flowbrain index <repo>` y `flowbrain compile`");
  const r = llamadasPorResolver(ctx, { limite: 0, ...(p.declaradas ? { declaradas: p.declaradas } : {}) });
  const lado = (r as { delLadoQueLlama?: { pantallas?: number; pantallasSinLlamadas?: number; funcionalidadesSinLlamadas?: unknown[]; httpSinRuta: { total: number } } }).delLadoQueLlama;
  const pendientes = ix.llamadasPendientes.filter((l) => l.llamada);
  let unidas = 0;
  for (const xs of ix.llamanEndpoint.values()) unidas += xs.length;
  const http = unidas + pendientes.length, sinRuta = lado?.httpSinRuta.total ?? 0;
  const conMetodo = r.endpoints - r.sinMetodo.total;

  // ---------- Controles: hechos verificados a mano que tienen que seguir saliendo ----------
  const endpoints = ctx.graph.nodes.filter((n) => n.tipo === "endpoint");
  const epDe = (metodo: string, ruta: string) => endpoints.find((n) => String(n.atributos["metodo"]).toUpperCase() === metodo && rutaCoincide(String(n.atributos["ruta"]), ruta) && String(n.atributos["ruta"]).split("/").length === ruta.split("/").length);
  const cumple = (c: Control): boolean => {
    if (c.tipo === "endpoint") return !!epDe(c.metodo!, c.ruta!);
    if (c.tipo === "pantalla") return ctx.graph.nodes.some((n) => n.tipo === "pantalla" && n.atributos["ruta"] === c.ruta);
    if (c.tipo === "llamada") {
      const enArchivo = (ev: string) => ev.replace(/#L\d+$/, "").endsWith(c.archivo!);
      if (pendientes.some((l) => enArchivo(l.evidencia) && l.llamada!.metodo === c.metodo && l.llamada!.ruta === c.ruta)) return true;
      for (const [ep, xs] of ix.llamanEndpoint) {
        const n = ctx.nodo.get(ep);
        if (n && String(n.atributos["metodo"]).toUpperCase() === c.metodo && String(n.atributos["ruta"]).endsWith(c.ruta!) && xs.some((x) => enArchivo(x.evidencia))) return true;
      }
      return false;
    }
    if (c.tipo === "alcanza") {
      // La ruta del control puede ser la del front (`/login`) o la del endpoint (`/api/login`): alcanza con que una
      // termine en la otra, segmento a segmento.
      const igual = (a: string, b: string) => {
        const x = a.split("/").filter(Boolean), y = b.split("/").filter(Boolean), k = Math.min(x.length, y.length);
        return k > 0 && (rutaCoincide(x.slice(-k).join("/"), y.slice(-k).join("/")) || rutaCoincide(y.slice(-k).join("/"), x.slice(-k).join("/")));
      };
      return ctx.graph.nodes.filter((n) => n.tipo === "pantalla" && n.atributos["ruta"] === c.pantalla).some((n) => llamadasDePantalla(ctx, n.id).some((l) => l.metodo === c.metodo && igual(l.ruta, c.ruta!)));
    }
    const [metodo, ...resto] = c.endpoint!.split(" ");
    const ep = epDe(metodo!.toUpperCase(), resto.join(" "));
    const tabla = normalizar(c.tabla!);
    return !!ep && ix.recorredor.desdeEndpoint(ep.id).pasos.some((x) => x.toca.some((t) => (t.verbo === "lee_de" || t.verbo === "escribe_en") && [t.hasta, t.hasta.replace(/^tabla-/, ""), ctx.nodo.get(t.hasta)?.nombre ?? ""].some((k) => normalizar(k) === tabla)));
  };
  const fallan = (p.controles ?? []).filter((c) => !cumple(c));
  const extractores = p.extractores ?? [];
  const avisos = [
    ...extractores.filter((e) => e.error).map((e) => `el extractor ${e.repo}/${e.extractor} no corrió: ${e.error}`),
    ...extractores.filter((e) => e.caida).map((e) => `el extractor ${e.repo}/${e.extractor} devolvió bastante menos que la vez anterior (${e.antes} antes): el código cambió y puede haber quedado viejo`),
    ...extractores.filter((e) => e.rechazados).map((e) => `el extractor ${e.repo}/${e.extractor} tuvo ${e.rechazados} datos rechazados: ${e.motivos[0] ?? ""}`),
    ...(fallan.length ? [`${fallan.length} de ${(p.controles ?? []).length} controles ya no se cumplen: algo que estaba verificado dejó de salir`] : []),
  ];
  return {
    herramienta: "cobertura",
    // Del lado que llama (un front, o un servicio que consume a otro).
    pantallas: lado?.pantallas !== undefined ? { total: lado.pantallas, conLlamadas: lado.pantallas - (lado.pantallasSinLlamadas ?? 0), pct: pct(lado.pantallas - (lado.pantallasSinLlamadas ?? 0), lado.pantallas) } : null,
    funcionalidadesSinLlamadas: lado?.funcionalidadesSinLlamadas?.length ?? 0,
    llamadasHttp: { total: http, conRuta: http - sinRuta, pct: pct(http - sinRuta, http) },
    // Del lado que atiende.
    endpoints: { total: r.endpoints, conMetodo, pctConMetodo: pct(conMetodo, r.endpoints), lleganATabla: conMetodo - r.sinLlegarATabla, pctLleganATabla: pct(conMetodo - r.sinLlegarATabla, r.endpoints) },
    endpointsConLlamadasPorResolver: r.conLlamadasPorResolver,
    llamadasSinResolver: r.sinResolverEnTotal,
    accesosATablas: { total: ix.accesos.total, conColumnas: ix.accesos.conColumnas, pct: pct(ix.accesos.conColumnas, ix.accesos.total) },
    extractores: extractores.map((e) => ({ extractor: `${e.repo}/${e.extractor}`, aceptados: Object.fromEntries(Object.entries(e.aceptados).filter(([, n]) => n)), rechazados: e.rechazados, ...(e.error ? { error: e.error } : {}), ...(e.caida ? { caida: true } : {}) })),
    controles: { total: (p.controles ?? []).length, fallan: fallan.slice(0, 20) },
    avisos,
  };
}

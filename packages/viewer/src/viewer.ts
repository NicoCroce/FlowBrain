import { CIERRE_DEL_PLAN, COMO_RESOLVER, GUIA_TESTS, dependenciasDelGrafo, REGLAS_DEL_PLAN, type ArchivoIncierto, type CodigoVisor, type ArchivoSinAsociar, type IgnoradoSinAsociar, type SenalDeRecomendacion, type Ficha, type FidelidadArchivo, type Graph } from "@flowbrain/core";
import { CONTRATOS_JS } from "./viewer-contratos.js";
import { ESPECIFICACIONES_JS } from "./viewer-especificaciones.js";
import { FIDELIDAD_JS } from "./viewer-fidelidad.js";
import { FILTROS_JS } from "./viewer-filtros.js";
import { mapa3dDelGrafo } from "./mapa3d.js";
import { GRAFO3D_JS } from "./viewer-3d.js";
import { MAPA_JS } from "./viewer-mapa.js";
import { PANTALLAS_JS } from "./viewer-pantallas.js";
import { PRODUCTO_JS } from "./viewer-producto.js";
import { SIN_ASOCIAR_JS } from "./viewer-sin-asociar.js";
import { attr, dos, IDIOMA_JS, SWITCH_IDIOMA } from "./idioma.js";

/**
 * Visor estático (`_build/viewer.html`): un único HTML con el grafo embebido, sin servidor ni red. Vistas:
 * funcionalidades, mapa 3D del grafo entero (`viewer-3d.ts`), impacto y fidelidad (`viewer-fidelidad.ts`).
 * Determinístico: depende solo del grafo, las funcionalidades y la versión de Cytoscape.
 */

/** Tipos visibles al abrir el mapa 3D: los archivos son miles y se prenden a mano. */
const TIPOS_INICIALES = ["feat", "pantalla", "componente", "endpoint", "tabla", "svc", "repo", "lib", "ext", "queue", "db", "team", "decision"];

const seguroEnScript = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** Fidelidad de un brain tal como la calcula el motor (`fidelidadDeArchivos`). */
export interface FidelidadVisor {
  archivos: FidelidadArchivo[];
  /** Archivos sin ninguna relación para medir: no tienen puntaje. */
  inciertos: ArchivoIncierto[];
  /** Archivos sin funcionalidad ni librería, con la recomendada. Ausente en quien arma la fidelidad a mano. */
  sinAsociar?: ArchivoSinAsociar[];
  /** Las marcas «No es de producto» con cuántos archivos tapa cada una. */
  noProducto?: IgnoradoSinAsociar[];
}

/** Las marcas «No es de producto» en formato corto: e: entrada, m: motivo, n: archivos sin dueño que tapa hoy. */
export function noProductoDelVisor(f: FidelidadVisor | undefined) {
  if (!f?.sinAsociar) return null;
  return (f.noProducto ?? []).map((x) => ({ e: x.entrada, m: x.motivo, n: x.archivos }));
}

/**
 * Los archivos sin asociar en formato corto: a: archivo, l: lenguaje, k: capa, g: recomendada [id, motivo en inglés,
 * confianza, señales], o: otras [id, motivo, señales], m: funcionalidades que lo comparten, cl: carpeta libre. Cada
 * señal es [tipo, cantidad] o [tipo, cantidad, carpeta]: con ellas el visor dice el motivo en su idioma.
 */
const senalesCortas = (xs: SenalDeRecomendacion[]) => xs.map((s) => (s.carpeta ? [s.tipo, s.cantidad, s.carpeta] : [s.tipo, s.cantidad]));
export function sinAsociarDelVisor(f: FidelidadVisor | undefined) {
  if (!f?.sinAsociar) return null;
  return f.sinAsociar.map((x) => ({
    a: x.archivo, l: x.lenguaje, k: x.capa,
    ...(x.recomendada ? { g: [x.recomendada.id, x.recomendada.motivo, x.recomendada.confianza, senalesCortas(x.recomendada.senales)] } : {}),
    ...(x.otras.length ? { o: x.otras.map((o) => [o.id, o.motivo, senalesCortas(o.senales)]) } : {}),
    ...(x.compartido ? { m: x.compartido.funcionalidades } : {}),
    ...(x.carpetaLibre ? { cl: 1 } : {}),
  }));
}

/** Fidelidad en el formato corto que embebe el visor: una fila por archivo medido. */
export function fidelidadDelVisor(f: FidelidadVisor | undefined) {
  if (!f) return null;
  return {
    // a: archivo, p: puntaje, l: lenguaje, k: capa, f: funcionalidades, s: signal → [ok, total],
    // t: tareas [signal, 1 si la resuelve una persona, qué pasa, qué hacer, líneas], u: 1 si no es de ninguna funcionalidad ni librería.
    archivos: f.archivos.map((x) => ({
      a: x.archivo, p: x.puntaje, l: x.lenguaje, k: x.capa, f: x.funcionalidades,
      s: Object.fromEntries(Object.entries(x.signals).map(([k, v]) => [k, [v.ok, v.total]])),
      t: x.tareas.map((t) => [t.signal, t.resuelve === "persona" ? 1 : 0, t.que, t.hacer, t.lineas]),
      ...(x.sinAsociar ? { u: 1 } : {}),
    })),
    // Los textos del plan para el modelo: los mismos que usan el CLI y el MCP.
    plan: { reglas: REGLAS_DEL_PLAN, como: COMO_RESOLVER, cierre: CIERRE_DEL_PLAN },
    // Fidelidad incierta: a: archivo, m: 1 si el índice vio código pero ninguna relación (0: no vio nada), l, k, f.
    inciertos: f.inciertos.map((x) => ({ a: x.archivo, m: x.motivo === "sin_relaciones" ? 1 : 0, l: x.lenguaje, k: x.capa, f: x.funcionalidades })),
  };
}

/** La deriva de un brain tal como la devuelve el motor (`deriva`, sin recorte). */
export interface DerivaVisor {
  llamadasSinEndpoint: Array<{ desde: string; llamada: string; ev: string; existeConOtroMetodo?: string[] }>;
  llamadasAmbiguas: Array<{ desde: string; llamada: string; ev: string; candidatos: string[] }>;
  endpointsSinLlamadasDetectadas: Array<{ endpoint: string; ev: string }>;
  consumidoresIndexados: Record<string, string[]>;
  comunicadoCon?: string[];
  atendidasEnOtrosCerebros?: Array<{ cerebro: string; llamadas: number; endpoints: number }>;
  disputadasEntreCerebros?: Array<{ desde: string; llamada: string; ev: string; candidatos: string[] }>;
  /** Llamadas al propio servidor que el registro declara internas (`internas` en flowbrain.yaml): no son deriva. */
  internasDelServicio?: number;
  /** Comparación de campos (ausente en una deriva calculada antes de que existiera). */
  campos?: { llamadasUnidas: number; comparadas: number; sinDiferencias: number; conDiferencias: number; noComparables: Array<{ lado: string; motivo: string; llamadas: number; tipos?: string[] }> };
  camposQueNoCoinciden?: Array<{ llamada: string; ev: string; endpoint: string; cerebro?: string; evEndpoint: string } & Partial<Record<"cuerpo" | "query" | "respuesta", Record<string, unknown>>>>;
  avisos: string[];
}

/** La deriva en formato corto. d: desde, l: llamada, ev, o: existe con otro método, k: candidatos; e: endpoint. */
export function derivaDelVisor(d: DerivaVisor | undefined) {
  if (!d) return null;
  return {
    sinEndpoint: d.llamadasSinEndpoint.map((x) => ({ d: x.desde, l: x.llamada, ev: x.ev, ...(x.existeConOtroMetodo ? { o: x.existeConOtroMetodo } : {}) })),
    ambiguas: d.llamadasAmbiguas.map((x) => ({ d: x.desde, l: x.llamada, ev: x.ev, k: x.candidatos })),
    disputadas: (d.disputadasEntreCerebros ?? []).map((x) => ({ d: x.desde, l: x.llamada, ev: x.ev, k: x.candidatos })),
    atendidas: (d.atendidasEnOtrosCerebros ?? []).map((x) => ({ cerebro: x.cerebro, llamadas: x.llamadas, endpoints: x.endpoints })),
    sinLlamadas: d.endpointsSinLlamadasDetectadas.map((x) => ({ e: x.endpoint, ev: x.ev })),
    consumidores: d.consumidoresIndexados,
    // Campos: `null` si la deriva no los trae. l: llamada, ev, e: endpoint, c: cerebro, eb: evidencia del endpoint.
    campos: d.campos ?? null,
    difieren: (d.camposQueNoCoinciden ?? []).map((x) => ({ l: x.llamada, ev: x.ev, e: x.endpoint, ...(x.cerebro ? { c: x.cerebro } : {}), eb: x.evEndpoint, ...(x.cuerpo ? { cuerpo: x.cuerpo } : {}), ...(x.query ? { query: x.query } : {}), ...(x.respuesta ? { respuesta: x.respuesta } : {}) })),
    // `null`: no se cruzó con otros cerebros (un brain solo). Vacío: se cruzó y no tiene comunicación con ninguno.
    comunicadoCon: d.comunicadoCon ?? null,
    internas: d.internasDelServicio ?? 0,
    avisos: d.avisos,
  };
}

/** Lo que el visor embebe de un brain. */
export function datosDelVisor(graph: Graph, funcionalidades: Ficha[] = [], fidelidad?: FidelidadVisor, deriva?: DerivaVisor, codigo?: CodigoVisor | null) {
  // Los archivos de test de alguna funcionalidad se dibujan como tipo propio (`test`), para prenderlos y apagarlos aparte.
  const tests = new Set(funcionalidades.flatMap((f) => (f.tests ?? []).map((t) => t.archivo)));
  return {
    fidelidad: fidelidadDelVisor(fidelidad),
    sinAsociar: sinAsociarDelVisor(fidelidad),
    noProducto: noProductoDelVisor(fidelidad),
    // Una entrada por cerebro; `null` si no hay índice de código (sin él no se sabe qué se llama).
    deriva: deriva ? [derivaDelVisor(deriva)!] : null,
    dependencias: dependenciasDelGrafo(graph, funcionalidades),
    // Símbolos del índice de código (clases, métodos, funciones, hooks…) con quién los llama y los usa, para Impacto;
    // `null` sin índice de código.
    codigo: codigo ?? null,
    funcionalidades,
    // Pantallas del front con su envoltura y a dónde llevan; el recorrido de cada una viene en su funcionalidad.
    pantallas: graph.nodes.filter((n) => n.tipo === "pantalla").map((n) => ({ id: n.id, ...n.atributos })),
    mapa3d: mapa3dDelGrafo(graph, funcionalidades),
    edges: graph.edges.map((e) => ({
      c: e.confianza,
      d: e.dato,
      e: e.estado,
      ev: e.evidencia,
      h: e.hasta,
      o: e.origen,
      p: e.endpoint,
      s: e.desde,
      v: e.verbo,
    })),
    nodes: graph.nodes.map((n) => ({
      a: n.aliases,
      act: n.actualizado,
      e: n.estado,
      id: n.id,
      n: n.nombre,
      o: n.origen,
      p: n.pagina,
      r: n.resumen,
      t: n.tipo === "archivo" && tests.has(n.id) ? "test" : n.tipo,
      ver: n.verificado,
      // Atributos para la ficha técnica (columnas de una tabla, método y ruta de un endpoint, infraestructura de un
      // servicio). Los archivos no tienen ficha y las pantallas ya vienen en `pantallas`.
      ...(n.tipo !== "archivo" && n.tipo !== "pantalla" && Object.keys(n.atributos).length ? { at: n.atributos } : {}),
    })),
    tiposIniciales: TIPOS_INICIALES,
  };
}

export type DatosVisor = ReturnType<typeof datosDelVisor>;

export function renderViewer(graph: Graph, funcionalidades: Ficha[] = [], fidelidad?: FidelidadVisor, deriva?: DerivaVisor, codigo?: CodigoVisor | null): string {
  return paginaDelVisor(datosDelVisor(graph, funcionalidades, fidelidad, deriva, codigo));
}

/** La página autocontenida, a partir de los datos (de un brain, o de varios cerebros ya unidos). */
export function paginaDelVisor(datos: unknown): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlowBrain · viewer</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHJlY3Qgd2lkdGg9JzI0JyBoZWlnaHQ9JzI0JyByeD0nNicgZmlsbD0nIzBBMEMxMScvPjxnIGZpbGw9J25vbmUnIHN0cm9rZT0nIzlEQjRGRicgc3Ryb2tlLXdpZHRoPScxLjgnIHN0cm9rZS1saW5lY2FwPSdyb3VuZCc+PGNpcmNsZSBjeD0nNicgY3k9JzcnIHI9JzIuMicvPjxjaXJjbGUgY3g9JzE4JyBjeT0nNicgcj0nMS42Jy8+PGNpcmNsZSBjeD0nMTInIGN5PScxNycgcj0nMycvPjxwYXRoIGQ9J003LjggOC40bDIuNiA2TTE2LjggNy4ybC0zLjQgNy40TTguMiA3bDguMi0uOCcvPjwvZz48L3N2Zz4=">
<style>
:root {
  color-scheme: dark;
  --sans: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; --display: "Space Grotesk", Inter, system-ui, -apple-system, sans-serif;
  --fondo: #0A0C11; --panel: #0D1016; --tarjeta: #10141C; --hover: #171B25; --text: #E6E8EE; --claro: #D5DAE4; --medio: #A3ABBD; --suave: #8A93A6;
  --borde: #1F2433; --borde2: #2A3142; --linea: #3A4256; --acento: #9DB4FF; --primario: #4F6BFF;
  --feat: #F5A524; --pantalla: #E879F9; --componente: #A3E635; --endpoint: #7DD3FC; --tabla: #4ADE80; --svc: #5B7CFF; --repo: #B794F6; --lib: #FDE68A; --ext: #F472B6; --queue: #FB7185;
  --db: #14B8A6; --team: #FCA5A5; --decision: #C4B5FD; --contrato: #64748B; --archivo: #94A3B8; --test: #2DD4BF; --dudoso: #F87171;
  /* Estados: lo mismo se pinta igual en todas las pantallas. Bien: está hecho. Atención: falta completar. Mal: algo está roto. */
  --bien: #4ADE80; --bien-fondo: #10201A; --bien-borde: #1F4A3A; --atencion: #F5A524; --atencion-borde: #5A4316; --mal: #F87171; --mal-fondo: #2A1416; --mal-borde: #5B2A2A;
  /* Controles: el seleccionado, el hover y los campos, iguales en todas las pantallas. */
  --sel-fondo: #1D2740; --sel-texto: #C7D4FF; --borde-hover: #3B4560; --campo-fondo: #0E1118; --campo-borde: #262C3A; --primario-hover: #3F5BEF;
  --pedir: #0EA5E9; --pedir-hover: #38BDF8; --pedir-en-lista: #0B6FA0;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --clase: #F59E0B; --metodo: var(--pedir-hover); --funcion: #818CF8; --hook: #22D3EE; --interfaz: #C084FC; --tipo: #A78BFA; --enum: #FB923C; --constante: #CBD5E1; --modelo: #34D399; --objeto: #FCD34D;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--fondo); color: var(--text); font: 14px/1.5 var(--sans); }
a { color: var(--acento); } a:hover { color: var(--sel-texto); }
h1, h2, h3 { font-family: var(--display); letter-spacing: -0.01em; }
code { font: 12px var(--mono); color: var(--suave); overflow-wrap: anywhere; }
.oculto { display: none !important; }
::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-thumb { background: #262C3A; border-radius: 8px; }

#cabecera { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; min-height: 56px; padding: 10px 20px; background: var(--fondo); border-bottom: 1px solid #1A1F2B; position: sticky; top: 0; z-index: 5; }
.marca { display: flex; align-items: center; gap: 10px; font-family: var(--display); font-weight: 600; font-size: 18px; }
#cabecera nav { display: flex; gap: 4px; flex-wrap: wrap; }
#cabecera nav a { padding: 8px 12px; border-radius: 8px; color: var(--medio); text-decoration: none; font-size: 13px; font-weight: 500; }
#cabecera nav a:hover { color: var(--text); }
#cabecera nav a.activa { background: var(--hover); color: #FFFFFF; }
#presets { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
#presets .lbl { margin-right: 4px; }
.idioma { display: flex; gap: 4px; margin-left: 8px; } #presets.oculto + .idioma { margin-left: auto; } .idioma .chip { min-height: 26px; padding: 0 9px; font-size: 11px; letter-spacing: .04em; }

.lbl { font: 600 11px var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--suave); margin: 0; }
.sw, .punto { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; box-shadow: inset 0 -2px 3px rgba(0,0,0,.35); }
.punto { width: 10px; height: 10px; vertical-align: -1px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1px solid var(--borde2); border-radius: 999px; background: #121620; color: #C9CFDB; font: 500 12px var(--sans); text-decoration: none; }
a.chip { color: var(--acento); } a.chip:hover { border-color: var(--borde-hover); }
button.chip { min-height: 30px; padding: 0 11px; cursor: pointer; }
button.chip:hover { border-color: var(--borde-hover); color: #FFFFFF; }
.chip.on { background: var(--sel-fondo); border-color: var(--primario); color: #FFFFFF; }
.btn, .boton { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 14px; border: 1px solid var(--borde2); border-radius: 10px; background: #151A25; color: var(--text); font: 500 13px var(--sans); cursor: pointer; }
.boton { min-height: 32px; padding: 0 12px; font-size: 12px; }
.btn:hover, .boton:hover { background: #1B2130; border-color: var(--borde-hover); }
.btn.pri, .boton.pri { background: var(--primario); border-color: var(--primario); color: #FFFFFF; } .btn.pri:hover, .boton.pri:hover { background: var(--primario-hover); }
/* Un botón prendido (abre un panel, activa un modo) se ve igual en todas las pantallas. */
.btn.on, .boton.on { border-color: var(--primario); color: var(--sel-texto); }
.btn[disabled], .boton[disabled] { opacity: .5; cursor: default; }
input[type=search], select { width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--campo-borde); border-radius: 10px; background: var(--campo-fondo); color: var(--text); font: 400 13px var(--sans); outline: none; }
input[type=search]:focus, select:focus { border-color: var(--primario); }
input[type=range] { width: 100%; accent-color: var(--primario); }
label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.vacio, .pendiente { color: var(--suave); }
.pendiente { font-style: italic; }
.estado-dudoso { color: var(--dudoso); font-weight: 600; }
.aviso { padding: 12px 14px; border: 1px dashed var(--borde2); border-radius: 12px; color: var(--medio); background: var(--tarjeta); margin: 0 0 16px; }

/* Páginas: funcionalidades, ficha, impacto */
.pagina { max-width: none; margin: 0 auto; padding: 32px 32px 72px; }
.pagina h1 { font-size: 28px; font-weight: 600; margin: 0 0 6px; }
.pagina h2 { font: 600 11px var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--suave); margin: 0 0 10px; }
.pagina h3 { font-size: 17px; font-weight: 600; margin: 24px 0 8px; }
.pagina h4 { font-size: 14px; margin: 16px 0 6px; }
.subtitulo { color: var(--medio); margin: 0 0 20px; }
.ficha-cerebros { align-items: center; margin: 0 0 10px; } .ficha-cerebros small { margin: 0 2px 0 6px; }
.volver { display: inline-block; margin-bottom: 14px; text-decoration: none; font-size: 13px; }
.pagina h1.ruta { font-family: var(--mono); font-size: 24px; overflow-wrap: anywhere; }
.grupo-pant { margin-bottom: 14px; padding: 6px 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.grupo-pant h3 { margin: 10px 0 4px; font-size: 15px; } .grupo-pant h3 a { color: var(--text); text-decoration: none; } .grupo-pant h3 small { color: var(--suave); font-weight: 500; }
.recorrido h4 { margin: 14px 0 4px; font-size: 13px; color: var(--claro); }
.tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.tarjeta { display: block; padding: 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); color: var(--text); text-decoration: none; transition: border-color .15s; }
.tarjeta:hover { border-color: var(--primario); color: var(--text); }
.tarjeta h3 { margin: 0 0 6px; font-size: 16px; }
.tarjeta h3 a { color: inherit; text-decoration: none; }
.tarjeta h3 a:hover { color: var(--primario); }
.tarjeta .cerebros { margin-top: 8px; }
.tarjeta p { margin: 0 0 12px; color: var(--medio); font-size: 13px; }
.columnas { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 28px; margin-top: 16px; }
.columnas section { padding: 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.resumen-impacto { margin: 4px 0 14px; }
.resumen-impacto .chip { font-size: 13px; color: var(--text); }
.grupos-impacto { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-top: 16px; }
.grupos-impacto.uno { grid-template-columns: 1fr; }
.titulo-seccion { display: flex; align-items: center; gap: 8px; margin: 28px 0 10px !important; }
.im-codigo > li { padding: 6px 0; } .im-codigo summary { cursor: pointer; } .im-simbolos { margin: 6px 0 2px 22px; } .im-simbolos li { padding: 5px 0; }
.pestanas { display: flex; gap: 4px; margin: 6px 0 16px; border-bottom: 1px solid var(--borde); }
.pestana { padding: 8px 14px; border-bottom: 2px solid transparent; color: var(--medio); text-decoration: none; font: 500 13px var(--sans); }
.pestana b { color: var(--suave); font-weight: 600; margin-left: 4px; }
button.pestana { border-top: 0; border-left: 0; border-right: 0; background: none; cursor: pointer; }
.pestana:hover { color: #FFFFFF; } .pestana.on { color: #FFFFFF; border-bottom-color: var(--primario); } .pestana.on b { color: var(--acento); }
.explica { color: var(--medio); margin: 0 0 8px; }
.grupo-impacto { padding: 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); min-width: 0; }
.grupo-impacto[hidden], .grupo-impacto li[hidden], .grupo-impacto .vacio[hidden] { display: none; }
.grupo-impacto h2 { display: flex; align-items: center; gap: 8px; }
.grupo-impacto .cuenta { color: var(--suave); font-weight: 500; }
.grupo-impacto .buscar-grupo { margin: 4px 0 12px; }
.grupos-impacto:not(.uno) .grupo-impacto .lista { max-height: 420px; overflow-y: auto; }
.ficha-tecnica { display: grid; gap: 16px; max-width: 980px; }
.ficha-tecnica section { padding: 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); overflow-x: auto; }
.ficha-tecnica h2 { margin: 0 0 10px; } .titulo-rel { margin: 28px 0 10px; font-size: 15px; }
.kv, .datos { border-collapse: collapse; width: 100%; font-size: 13px; }
.kv th { width: 150px; text-align: left; vertical-align: top; color: var(--suave); font-weight: 500; padding: 4px 12px 4px 0; }
.kv td, .datos td { padding: 4px 12px 4px 0; vertical-align: top; word-break: break-word; }
.datos th { text-align: left; color: var(--suave); font-weight: 500; padding: 4px 12px 6px 0; border-bottom: 1px solid var(--borde); }
.datos tr + tr td { border-top: 1px solid var(--borde); }
.kv pre { margin: 0; white-space: pre-wrap; font-size: 12px; }
.resumen { max-width: 820px; color: var(--claro); }
.pasos li { border-left: 2px solid var(--borde2); margin-bottom: 6px; }
.ficha { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 32px; }
.ficha .texto { line-height: 1.6; }
.ficha .texto blockquote { margin: 0; padding: 8px 14px; border-radius: 10px; background: var(--tarjeta); color: var(--medio); }
.ficha section { margin-bottom: 18px; padding: 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.ficha section h2 { margin-top: 0; }
.lista { list-style: none; margin: 0; padding: 0; }
.lista li { padding: 8px 0; border-bottom: 1px solid var(--borde); }
.lista li:last-child { border-bottom: 0; }
.lista small { color: var(--suave); }
.capa { display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; color: #0A0C11; background: var(--archivo); }
.capa-entrada { background: var(--svc); color: #FFFFFF; } .capa-logica { background: var(--repo); } .capa-dominio { background: var(--feat); }
.capa-datos { background: var(--tabla); } .capa-interfaz { background: var(--endpoint); } .capa-otros { background: var(--archivo); }
.recorrido { border: 1px solid var(--borde); border-radius: 12px; padding: 10px 14px; margin: 0 0 8px; background: var(--tarjeta); }
.recorrido summary { cursor: pointer; }
.traza { margin: 8px 0 4px; border: 1px solid var(--borde); border-radius: 10px; overflow: hidden; background: var(--fondo); }
.tz-fila { display: grid; grid-template-columns: minmax(320px, 42%) minmax(0, 1fr); align-items: center; min-height: 28px; border-bottom: 1px solid #141925; }
.tz-fila:last-child { border-bottom: 0; } .tz-fila:hover { background: var(--hover); }
.tz-nom { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 3px 10px; font-size: 12.5px; white-space: nowrap; overflow: hidden; }
.tz-nom strong { font-weight: 600; color: var(--claro); overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
.tz-nom small { color: var(--suave); overflow: hidden; text-overflow: ellipsis; flex: 1 1 0; min-width: 0; }
.tz-pt { flex: none; width: 8px; height: 8px; border-radius: 2px; background: var(--tz); }
.tz-pista { position: relative; height: 28px; border-left: 1px solid #1A1F2B; background: repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), #141925 calc(10% - 1px), #141925 10%); }
.tz-barra { position: absolute; top: 8px; height: 12px; border-radius: 3px; background: var(--tz); opacity: .9; }
/* Los mismos colores que el grafo: el front es de la pantalla, la llamada va a un endpoint, el back es el servicio. */
.tz-front { --tz: var(--pantalla); } .tz-http { --tz: var(--endpoint); } .tz-back { --tz: var(--svc); } .tz-tabla { --tz: var(--tabla); } .tz-ext { --tz: var(--ext); } .tz-cola { --tz: var(--queue); }
.tz-http .tz-nom strong, .tz-tabla .tz-nom strong { color: var(--tz); }
.tz-resumen { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin: 8px 0 0; font-size: 12px; color: var(--medio); }
.tz-ley { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 0 9px; border: 1px solid var(--borde2); border-radius: 999px; background: #121620; color: var(--suave); font: 500 12px var(--sans); cursor: pointer; }
.tz-ley b { color: var(--medio); font-weight: 600; } .tz-ley:hover { color: #FFFFFF; border-color: var(--borde-hover); }
.tz-ley.on { background: var(--sel-fondo); border-color: var(--tz); color: #FFFFFF; } .tz-ley:first-of-type { margin-left: auto; }
.tz-bloque.filtrada .tz-ley:not(.on) { opacity: .55; }
.pasos { list-style: none; margin: 10px 0 2px; padding: 0; }
.pasos li { padding: 4px 0; }
.pasos .flecha { color: var(--suave); }
.toca { margin: 4px 0 0 0; }

/* Fidelidad */
.fd-cifras { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0 0 20px; }
.fd-cifra { padding: 14px 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.fd-cifra b { display: block; font: 600 28px var(--display); font-variant-numeric: tabular-nums; }
.fd-cifra span { font-size: 12px; color: var(--suave); }
.fd-graficos { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin: 0 0 20px; }
.fd-graficos section { padding: 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); min-width: 0; }
.fd-barras { display: flex; flex-direction: column; gap: 2px; }
.fd-barra { display: grid; grid-template-columns: minmax(64px, 34%) minmax(0, 1fr) minmax(120px, auto); align-items: center; gap: 10px; width: 100%; min-height: 32px; padding: 4px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--claro); font: 500 13px var(--sans); text-align: left; cursor: pointer; }
.fd-barra:hover { background: var(--hover); color: #FFFFFF; } .fd-barra.on { background: var(--sel-fondo); border-color: var(--primario); color: #FFFFFF; }
.fd-et { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-pista { height: 8px; border-radius: 999px; background: #0E1118; border: 1px solid var(--borde); overflow: hidden; }
.fd-relleno { display: block; height: 100%; border-radius: 999px; }
.fd-val { font-size: 12px; color: var(--suave); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fd-sin { margin: 4px 8px; font-size: 12px; color: var(--suave); }
.fd-sobre { margin: -4px 0 10px; font-size: 12px; color: var(--suave); }
.fd-filtros { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0 0 20px; padding: 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.fd-campo { flex-direction: column; align-items: stretch; gap: 6px; cursor: default; }
.fd-campo input[type=number] { width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--campo-borde); border-radius: 10px; background: var(--campo-fondo); color: var(--text); font: 400 13px var(--sans); outline: none; }
.fd-campo input[type=number]:focus { border-color: var(--primario); }
.fd-cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.fd-cab .subtitulo { margin: 0; } .fd-acc { display: flex; gap: 8px; }
.fd-fila { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 14px; align-items: start; padding: 12px 0 !important; }
.fd-p { display: inline-flex; align-items: center; justify-content: center; height: 40px; border: 1px solid; border-radius: 10px; font: 600 16px var(--display); font-variant-numeric: tabular-nums; }
.fd-inc { color: var(--suave); border-color: var(--borde2); border-style: dashed; }
.fd-cuerpo { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.fd-ruta code { font-size: 13px; color: var(--text); }
.fd-sinfeat { color: var(--mal); border-color: var(--mal-borde); }
.fd-leyenda { display: flex; gap: 8px; margin: -8px 0 16px; }
.fd-grupos { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
.fd-grupo { height: 38px; padding: 0 14px; border: 1px solid var(--borde); border-radius: 10px; background: var(--tarjeta); color: var(--claro); font: 500 13px var(--sans); cursor: pointer; }
.fd-grupo small { margin-left: 6px; color: var(--suave); font-variant-numeric: tabular-nums; }
.fd-grupo:hover { background: var(--hover); color: #FFFFFF; } .fd-grupo.on { background: var(--sel-fondo); border-color: var(--primario); color: #FFFFFF; }
.fd-herr { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; } .fd-herr input[type=search] { flex: 1 1 260px; min-width: 0; }
.fd-plan { display: flex; flex-direction: column; gap: 12px; margin: 0 0 20px; padding: 16px; border: 1px solid var(--primario); border-radius: 12px; background: var(--tarjeta); }
.fd-plan h2 { margin: 0; }
.fd-casillas { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.fd-casilla { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--claro); cursor: pointer; } .fd-casilla small { color: var(--suave); }
.fd-linea-plan { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; } .fd-linea-plan .fd-campo { width: 260px; }
.fd-texto { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid var(--campo-borde); border-radius: 10px; background: var(--campo-fondo); color: var(--claro); font: 400 12px/1.5 var(--mono); resize: vertical; }
.fd-cadena { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.fd-es { padding: 2px 9px; border: 1px solid var(--borde); border-radius: 8px; font-size: 12px; white-space: nowrap; }
.fd-es.ok { color: var(--bien); border-color: var(--bien-borde); background: var(--bien-fondo); }
.fd-es.no { color: var(--mal); border-color: var(--mal-borde); background: var(--mal-fondo); }
.fd-es.na { color: var(--suave); border-style: dashed; }
.fd-es.falta { color: var(--atencion); border-color: var(--atencion-borde); }
.fd-sep { color: var(--suave); font-size: 13px; }
.fd-tarea { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding-top: 8px; border-top: 1px solid var(--borde); }
.fd-que { flex: 1 1 320px; min-width: 0; } .fd-que p { margin: 0; font-size: 13px; color: var(--claro); overflow-wrap: anywhere; }
.fd-ln { color: var(--suave); font-variant-numeric: tabular-nums; }
.fd-hacer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.fd-quien { padding: 2px 9px; border: 1px solid var(--borde); border-radius: 8px; font-size: 12px; color: var(--suave); white-space: nowrap; } .fd-quien.vos { color: var(--feat); }
.fd-pregunta { display: flex; flex-direction: column; gap: 6px; } .fd-opciones { display: flex; flex-wrap: wrap; gap: 8px; } .fd-opciones small { color: var(--suave); margin-left: 4px; }
.tf { margin: 0; padding: 6px 0; border-top: 1px solid var(--borde); } .tf summary { cursor: pointer; overflow-wrap: anywhere; } .tf summary code { font-size: 12px; } .tf .lista { margin-top: 6px; }
.fd-ok { margin: 0; font-size: 13px; color: var(--bien); }
.fd-ed { margin-top: 4px; padding: 12px 14px; border: 1px solid var(--borde2); border-radius: 10px; background: var(--fondo); display: flex; flex-direction: column; gap: 12px; }
.fd-linea { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.fd-donde { margin: 0; font-size: 13px; color: var(--claro); overflow-wrap: anywhere; }
.fd-nota { margin: 0; font-size: 12px; color: var(--suave); }
.fd-msg { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--bien-fondo); color: var(--bien); font-size: 13px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.fd-msg.error { background: var(--mal-fondo); color: var(--mal); }
#fd-aviso .boton { margin-left: 6px; }
.fd-mas { display: flex; align-items: center; gap: 12px; margin-top: 16px; color: var(--suave); }

/* Especificaciones */
.es-feat { scroll-margin-top: 84px; margin: 0 0 12px; padding: 12px 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.es-feat.abierta { padding-bottom: 16px; }
.es-toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 4px 0; border: 0; background: none; color: var(--text); text-align: left; cursor: pointer; font: inherit; }
.es-toggle h3 { margin: 0; font-size: 16px; } .es-toggle:hover h3 { color: var(--acento); } .es-flecha { width: 14px; color: var(--suave); }
.es-feat > .chips { margin: 6px 0 0 24px; }
.es-cuerpo { margin: 12px 0 0 24px; } .es-resumen { margin: 0 0 8px; color: var(--medio); font-size: 13px; }
.es-cab { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin-bottom: 8px; }
.es-cab h3, .es-cab h4, .es-cab p { margin: 0; }
.es-caso { display: flex; flex-direction: column; gap: 8px; padding: 14px 0 !important; scroll-margin-top: 84px; }
.es-cabeza { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.es-cabeza small { color: var(--suave); }
.es-nombre { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
.es-acciones { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.es-patas { width: 100%; border-collapse: collapse; font-size: 13px; }
.es-patas th, .es-patas td { padding: 6px 10px 6px 0; border-top: 1px solid var(--borde); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.es-patas thead th { border-top: 0; font: 600 11px var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--suave); }
.es-patas tbody th { width: 120px; font-weight: 500; color: var(--claro); white-space: nowrap; overflow-wrap: normal; }
.es-patas td:last-child { width: 34%; }
.es-mal { color: var(--mal); } .es-bien { color: var(--bien); } .es-sep { color: var(--suave); }
.es-problema { padding: 10px 12px; border: 1px solid var(--mal-borde); border-radius: 8px; background: var(--mal-fondo); color: var(--claro); font-size: 13px; }
.es-problema b { color: var(--mal); } .es-problema p { margin: 4px 0; } .es-problema .boton { margin-top: 8px; }
.es-form { display: flex; flex-direction: column; gap: 6px; } .es-form label { font-size: 13px; color: var(--claro); } .es-form textarea { width: 100%; }
.es-form small { color: var(--suave); }
.es-reglas summary { font-size: 13px; color: var(--medio); }
.es-regla { display: flex; flex-direction: column; gap: 6px; padding: 10px 0 !important; }
.es-texto { margin: 0; font-size: 14px; color: var(--text); overflow-wrap: anywhere; } .es-texto .chip { margin-left: 4px; font-size: 11px; padding: 1px 8px; }
.es-ref { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px; align-items: baseline; font-size: 13px; color: var(--claro); }
.es-ref code { font-size: 12px; overflow-wrap: anywhere; } .es-ref small { color: var(--suave); }
.es-roto { display: block; } .es-roto code { overflow-wrap: anywhere; }
.es-sueltas { margin-top: 12px; padding: 12px; border: 1px dashed var(--borde2); border-radius: 10px; }
.es-agrupar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; } .es-agrupar p { margin: 0; flex: 1 1 360px; } .es-agrupar .fd-plan { flex: 1 1 100%; }
#especificaciones .fd-herr select { flex: 0 0 auto; width: auto; }
.es-cerebros { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 16px; }
.es-cerebros .lbl { margin-right: 4px; } .es-cerebros small { flex-basis: 100%; color: var(--suave); }
.es-cer { height: 30px; padding: 0 12px; border: 1px solid var(--borde); border-radius: 999px; background: var(--tarjeta); color: var(--claro); font: 500 12px var(--sans); cursor: pointer; }
.es-cer:hover { background: var(--hover); color: #FFFFFF; } .es-cer.on { background: var(--sel-fondo); border-color: var(--primario); color: #FFFFFF; }
.chip.es-cerebro.fuera { opacity: .45; text-decoration: line-through; }
.es-ocultas { margin: 0 0 4px; color: var(--suave); }
.es-hacer { margin: 0 0 16px; padding: 14px 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.es-hacer h2 { margin: 0 0 10px; }
.es-hacer ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.es-hacer li { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.es-hacer li > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.es-hacer li small { color: var(--suave); } .es-hacer li.hecho b { color: var(--bien); font-weight: 500; }
.es-hacer li .boton { flex: 0 0 auto; }
.es-manual { color: var(--suave); font-style: italic; }
.es-regla .fd-acc { margin-top: 8px; }
.boton.es-pedir { background: var(--pedir); border-color: var(--pedir); color: #FFFFFF; } .boton.es-pedir:hover { background: var(--pedir-hover); border-color: var(--pedir-hover); }
.es-verifica { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; } .es-verifica .boton { margin-left: auto; }
.es-agente { margin: 0 0 16px; padding: 14px 16px; border: 1px solid var(--primario); border-radius: 12px; background: var(--tarjeta); }
.es-agente h2 { margin: 0 0 10px; } .es-trabajo { display: grid; gap: 6px; }
.es-trabajo .es-cab { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.es-pasos { margin: 0; padding-left: 18px; font-size: 12px; color: var(--suave); } .es-pasos li { overflow-wrap: anywhere; }
.es-resultado { white-space: pre-wrap; font-size: 13px; } .es-cambios ul { margin: 4px 0 0; padding-left: 18px; font-size: 12px; } .boton.chico { height: 26px; padding: 0 10px; font-size: 12px; }
.es-falta { color: var(--mal); border-color: var(--mal-borde); } .es-ok { color: var(--bien); border-color: var(--bien-borde); } .es-aviso { color: var(--atencion); border-color: var(--atencion-borde); } .es-cerebro { color: var(--medio); }
.es-titulo { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; } .es-titulo h1 { margin: 0; }
.boton.es-pedir.en-lista { background: var(--pedir-en-lista); border-color: var(--pedir-en-lista); }
.es-panel { display: none; position: fixed; top: 56px; right: 0; bottom: 0; width: min(440px, 100vw); overflow-y: auto; padding: 16px; background: var(--panel); border-left: 1px solid var(--borde2, var(--borde)); box-shadow: -8px 0 24px rgba(0, 0, 0, .35); z-index: 30; }
.es-panel.abierto { display: block; } .es-panel > * + * { margin-top: 12px; }
.es-panel-cab { display: flex; align-items: center; justify-content: space-between; } .es-panel-cab h2 { margin: 0; font-size: 16px; }
@media (min-width: 1100px) { #especificaciones.es-con-panel { padding-right: 460px; } }
.es-agsel { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .es-agsel label { display: grid; gap: 4px; font-size: 12px; color: var(--suave); } .es-agsel select { width: 100%; }
.es-totales { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--borde); border-radius: 10px; background: var(--tarjeta); font-size: 13px; } .es-totales b { font-size: 15px; } .es-totales span { color: var(--suave); } .es-totales small { color: var(--suave); }
.es-pedidos { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.es-pedido { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 10px 12px; border: 1px solid var(--borde); border-radius: 10px; background: var(--tarjeta); } .es-pedido > div { min-width: 0; } .es-pedido .es-texto { margin: 0 0 6px; font-size: 13px; }
.es-archivo { display: block; margin-top: 6px; color: var(--suave); overflow-wrap: anywhere; } .chip.es-neg { color: #7DD3FC; border-color: var(--pedir-en-lista); }
.es-lote { padding: 12px; border: 1px solid var(--primario); border-radius: 12px; background: var(--tarjeta); display: grid; gap: 8px; } .es-lote .es-cab { display: flex; justify-content: space-between; align-items: center; gap: 8px; } .es-lote h3 { margin: 0; font-size: 14px; }
.es-lote progress { width: 100%; height: 8px; accent-color: var(--primario); } .es-repo h4 { margin: 4px 0; font-size: 13px; } .es-repo ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.es-tanda { padding: 8px 10px; border: 1px solid var(--borde); border-radius: 8px; font-size: 12px; display: grid; gap: 4px; } .es-tanda .es-cab { display: flex; justify-content: space-between; gap: 8px; }
.es-fin { display: grid; gap: 2px; font-size: 13px; } .es-fin span { color: var(--suave); }
.es-res { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid var(--borde); } .es-res .es-cab { display: flex; justify-content: space-between; align-items: center; gap: 8px; } .es-res h3 { margin: 0; font-size: 14px; } .es-res small { color: var(--suave); }
.es-hallazgo, .es-verif { padding: 10px 12px; border: 1px solid var(--borde); border-radius: 10px; background: var(--tarjeta); display: grid; gap: 6px; } .es-hallazgo .es-texto, .es-verif .es-texto { margin: 0; font-size: 13px; }
.es-verif small { overflow-wrap: anywhere; } .es-verif code { overflow-wrap: anywhere; } .es-panel h2 { text-transform: none; letter-spacing: 0; color: var(--text); font-size: 16px; }
.es-test { margin: 6px 0 0; padding: 8px; background: #0B0F17; border-radius: 6px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.es-ir { cursor: pointer; } .es-ir:hover { border-color: var(--borde2); }
@media (max-width: 640px) { .es-cuerpo, .es-feat > .chips { margin-left: 0; } .es-patas tbody th { width: auto; } .es-patas td:last-child { width: auto; } }
.es-fila { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; } .es-fila .fd-plan { flex: 1 1 100%; margin: 4px 0 0; }
.sa-fila { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
.sa-que { flex: 1 1 320px; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 13px; } .sa-que > div { flex: 1 1 100%; color: var(--claro); } .sa-que small { color: var(--suave); }
.sa-rec a { color: var(--feat); text-decoration: none; font-weight: 500; } .sa-rec a:hover { text-decoration: underline; }
.sa-otra { flex: 1 1 100%; max-width: 520px; } .sa-acc { margin-bottom: 8px; }
.sa-conf { font-size: 11px; padding: 1px 8px; } .sa-lote { margin: 0 0 12px; align-items: center; } .sa-lote small { color: var(--suave); }
.sa-codigo { flex: 1 1 100%; min-width: 0; gap: 8px; } .sa-codigo-cab { font-size: 12px; color: var(--claro); } .sa-codigo-cab small { color: var(--suave); }
.sa-pre { margin: 0; max-height: 460px; overflow: auto; padding: 10px 0; border: 1px solid var(--borde); border-radius: 8px; background: var(--campo-fondo); color: var(--claro); font: 400 12px/1.5 var(--mono); white-space: pre; tab-size: 2; }
.sa-ln { display: inline-block; width: 4.5em; padding-right: 12px; margin-right: 8px; text-align: right; color: var(--suave); border-right: 1px solid var(--borde); user-select: none; }
#sinasociar .fd-herr select { flex: 0 0 auto; width: auto; max-width: 280px; } #sinasociar .es-cab h3 code { font-size: 14px; }
.ct-sec > summary { cursor: pointer; list-style-position: outside; } .ct-sec > summary h3 { display: inline; margin: 0; font-size: 15px; } .ct-sec > summary small { margin-left: 6px; color: var(--suave); font-weight: 400; font-variant-numeric: tabular-nums; }
.ct-sec[open] > summary { margin-bottom: 10px; } .ct-sec li code { overflow-wrap: anywhere; } .ct-sec h4 small { color: var(--suave); font-weight: 400; }
.ct-par { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 12px; align-items: end; margin: 0 0 20px; padding: 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.ct-par select { width: 100%; } .ct-barra { margin: -8px 0 20px; } #contratos h2 { margin-top: 24px; }
@media (max-width: 720px) { .ct-par { grid-template-columns: 1fr; } }

a.nb { text-decoration: none; }

/* Mapa 3D */
#app { display: grid; grid-template-columns: 280px minmax(0, 1fr) var(--der, 300px); height: calc(100vh - 56px); min-height: 640px; }
.m3-panel { background: var(--panel); overflow-y: auto; padding: 18px 14px; display: flex; flex-direction: column; gap: 22px; min-width: 0; }
.m3-izq { border-right: 1px solid #1A1F2B; }
.m3-der { border-left: 1px solid #1A1F2B; padding: 18px 16px; }
.m3-panel section { display: flex; flex-direction: column; gap: 8px; }
.m3-titulo { display: flex; align-items: baseline; justify-content: space-between; padding: 0 4px 2px; }
.m3-titulo span { font-size: 12px; color: var(--suave); }
.m3-lbl { padding: 0 4px 2px; }
.m3-ayuda { margin: 0; padding: 0 4px; font-size: 12px; line-height: 1.5; color: var(--suave); }
.m3-busca { position: relative; }
.m3-busca svg { position: absolute; left: 11px; top: 11px; }
.m3-busca input { padding-left: 34px; }
#m3-res { margin-top: 6px; padding: 4px; border: 1px solid #232838; border-radius: 10px; background: var(--tarjeta); }
.tg { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; padding: 6px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text); font: 500 13px var(--sans); cursor: pointer; text-align: left; }
.tg:hover { background: var(--hover); }
.tg.off { color: #6B7489; } .tg.off .sw { opacity: .25; }
.ct { margin-left: auto; font: 500 12px var(--sans); color: var(--suave); font-variant-numeric: tabular-nums; }
#m3-tipos, #m3-cerebros { display: flex; flex-direction: column; gap: 2px; }
#m3-cerebros:not(:empty) { padding-bottom: 8px; margin-bottom: 6px; border-bottom: 1px solid var(--borde); }
#m3-todo { display: flex; gap: 6px; padding: 0 4px 6px; }
.m3-cer { border: 1px solid var(--borde); border-radius: 10px; padding: 10px; margin-top: 8px; }
.m3-cer h3 { margin: 0 0 4px; font: 600 14px var(--display); color: var(--text); }
.m3-cer p { margin: 2px 0 8px; font-size: 12px; color: var(--suave); }
.m3-cer .m3-acciones { margin-top: 8px; }
#m3-verbos { display: flex; flex-wrap: wrap; gap: 6px; }
.seg { display: flex; padding: 3px; background: #0E1118; border: 1px solid #232838; border-radius: 10px; gap: 2px; }
.sb { flex: 1; min-height: 32px; border: 0; border-radius: 7px; background: transparent; color: var(--medio); font: 500 12px var(--sans); cursor: pointer; padding: 0 6px; }
.sb:hover { color: var(--text); } .sb.on { background: #232A3B; color: #FFFFFF; }
.m3-escala { display: flex; justify-content: space-between; font-size: 12px; color: var(--medio); padding: 0 4px; }
.m3-escala span { color: var(--text); font-variant-numeric: tabular-nums; }
.m3-centro { position: relative; min-width: 0; background: var(--fondo); }
#m3-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.m3-barra { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; gap: 8px; flex-wrap: wrap; pointer-events: none; }
.m3-barra > div { display: flex; gap: 8px; flex-wrap: wrap; pointer-events: auto; }
.m3-barra > div:last-child { margin-left: auto; }
.ov { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 12px; border: 1px solid #262C3A; border-radius: 10px; background: rgba(14,17,24,.86); color: var(--claro); font: 500 12px var(--sans); cursor: pointer; backdrop-filter: blur(6px); }
.ov:hover { border-color: var(--borde-hover); color: #FFFFFF; } .ov.on { border-color: var(--primario); color: var(--sel-texto); }
.m3-guia { position: absolute; left: 14px; bottom: 14px; display: flex; gap: 14px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--borde); border-radius: 10px; background: rgba(14,17,24,.82); font-size: 12px; color: var(--medio); pointer-events: none; }
.m3-guia b { color: var(--text); font-weight: 500; }
.nb { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--claro); font: 400 13px var(--sans); cursor: pointer; text-align: left; }
.nb:hover { background: var(--hover); color: #FFFFFF; }
.corta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vb { margin-left: auto; font: 500 11px var(--sans); color: var(--suave); white-space: nowrap; }
#m3-detalle { display: flex; flex-direction: column; gap: 18px; }
.m3-vacio { display: flex; flex-direction: column; gap: 14px; padding: 6px 4px; }
.m3-vacio p { margin: 0; font-size: 14px; line-height: 1.55; color: #C9CFDB; }
.m3-rc { cursor: default; min-height: 28px; } .m3-rc .vb { white-space: normal; text-align: right; }
.m3-sub { margin-top: 8px; }
.m3-caja { display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.m3-cab { display: flex; flex-direction: column; gap: 8px; padding: 0 4px; }
.m3-tipo { display: flex; align-items: center; gap: 8px; } .m3-tipo .lbl { color: var(--medio); }
.m3-fijado { margin-left: auto; font-size: 11px; color: var(--sel-texto); border: 1px solid #36457A; border-radius: 999px; padding: 2px 8px; }
.m3-nombre { margin: 0; font-size: 22px; font-weight: 600; line-height: 1.2; word-break: break-word; color: var(--text); text-transform: none; letter-spacing: -0.01em; }
.m3-resumen { margin: 0; font-size: 13px; color: var(--medio); }
.m3-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.m3-stats div { padding: 10px; border: 1px solid var(--borde); border-radius: 10px; background: var(--tarjeta); }
.m3-stats b { display: block; font: 600 22px var(--display); }
.m3-stats span { font-size: 11px; color: var(--suave); }
.m3-acciones { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.m3-acciones .ancho { grid-column: 1 / -1; }
.m3-enlaces { display: flex; flex-direction: column; gap: 6px; padding: 0 4px; font-size: 13px; }
#m3-detalle h3.lbl { padding: 0 4px 6px; display: flex; align-items: center; gap: 7px; }
#m3-detalle h3.lbl .ct { margin-left: auto; font: 500 11px var(--sans); color: var(--suave); text-transform: none; letter-spacing: 0; }
#m3-detalle .m3-tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 4px 10px; }
.m3-tab { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 4px 10px; border: 1px solid var(--borde); border-radius: 999px; background: transparent; color: var(--medio); font: 500 12px var(--sans); cursor: pointer; }
.m3-tab:hover { background: var(--hover); color: #FFFFFF; }
.m3-tab.on { background: var(--tarjeta); color: var(--text); }
.m3-tab .ct { font-size: 11px; color: var(--suave); }
.m3-grupo { display: flex; flex-direction: column; border-left: 2px solid transparent; padding-left: 4px; }
.m3-grupo .btn { margin: 6px 4px 0; }
.pc { flex: none; width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.m3-cer h3 .pc { margin-right: 7px; }
.mc { flex: none; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 6px; padding: 1px 7px; border: 1px solid; border-radius: 999px; font: 600 10px var(--sans); }
.nb .vb { flex: none; }
#m3-asa { position: absolute; top: 0; right: 0; bottom: 0; width: 8px; z-index: 5; cursor: col-resize; touch-action: none; }
#m3-asa::after { content: ""; position: absolute; top: 0; bottom: 0; right: 0; width: 2px; background: transparent; }
#m3-asa:hover::after, #m3-asa.on::after { background: var(--svc); }

@media (max-width: 900px) {
  .ficha { grid-template-columns: 1fr; }
  #app { grid-template-columns: 1fr; grid-template-rows: auto 70vh auto; height: auto; }
  #m3-asa { display: none; }
  .m3-izq, .m3-der, .derecha { border: 0; border-bottom: 1px solid #1A1F2B; }
  #presets { margin-left: 0; }
}
</style>
</head>
<body>
<header id="cabecera">
  <div class="marca"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9DB4FF" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="7" r="2.2"></circle><circle cx="18" cy="6" r="1.6"></circle><circle cx="12" cy="17" r="3"></circle><path d="M7.8 8.4l2.6 6M16.8 7.2l-3.4 7.4M8.2 7l8.2-.8"></path></svg>FlowBrain</div>
  <nav ${attr("aria-label", "Sections", "Secciones")}><a href="#/funcionalidades" data-vista="producto" ${dos("Features", "Funcionalidades")}</a><a href="#/pantallas" data-vista="pantallas" ${dos("Screens", "Pantallas")}</a><a href="#/grafo" data-vista="grafo" ${dos("3D map", "Mapa 3D")}</a><a href="#/especificaciones" data-vista="especificaciones" ${dos("Specifications", "Especificaciones")}</a><a href="#/sin-asociar" data-vista="sinasociar" ${dos("Unassigned", "Sin asociar")}</a><a href="#/impacto" data-vista="impacto" ${dos("Impact", "Impacto")}</a><a href="#/contratos" data-vista="contratos" ${dos("Contracts", "Contratos")}</a><a href="#/fidelidad" data-vista="fidelidad" ${dos("Fidelity", "Fidelidad")}</a></nav>
  <div id="presets" class="oculto"></div>
  ${SWITCH_IDIOMA}
</header>
<div id="producto" class="pagina"></div>
<div id="impacto" class="pagina oculto"></div>
<div id="fidelidad" class="pagina oculto"></div>
<div id="especificaciones" class="pagina oculto"></div>
<div id="sinasociar" class="pagina oculto"></div>
<div id="contratos" class="pagina oculto"></div>
<div id="app" class="oculto">
  <aside class="m3-panel m3-izq">
    <div class="m3-busca">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A93A6" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
      <input id="m3-buscar" type="search" ${attr("placeholder", "Search table, endpoint, feature…", "Buscar tabla, endpoint, funcionalidad…")} ${attr("aria-label", "Search node", "Buscar nodo")} autocomplete="off">
      <div id="m3-res" class="oculto"></div>
    </div>
    <section>
      <div class="m3-titulo"><h2 class="lbl" ${dos("What is shown", "Qué se ve")}</h2><span id="m3-vis"></span></div>
      <div id="m3-cerebros"></div>
      <div id="m3-todo"></div>
      <div id="m3-tipos"></div>
      <div id="m3-ocultos"></div>
    </section>
    <section>
      <h2 class="lbl m3-lbl" ${dos("Relations", "Relaciones")}</h2>
      <div id="m3-verbos"></div>
    </section>
    <section>
      <h2 class="lbl m3-lbl" ${dos("Dot size by", "Tamaño del punto según")}</h2>
      <div id="m3-tam" class="seg" role="group" ${attr("aria-label", "Size by", "Tamaño según")}></div>
      <label for="m3-escala" class="m3-escala"><span ${dos("Scale", "Escala")}</span> <span id="m3-escala-txt">0.6×</span></label>
      <input id="m3-escala" type="range" min="0.4" max="2.4" step="0.1" value="0.6">
    </section>
    <section>
      <h2 class="lbl m3-lbl" ${dos("Pulses", "Impulsos")}</h2>
      <label for="m3-int" class="m3-escala"><span ${dos("Intensity", "Intensidad")}</span> <span id="m3-int-txt">40%</span></label>
      <input id="m3-int" type="range" min="0" max="100" step="5" value="40">
    </section>
    <section id="m3-lin-sec">
      <h2 class="lbl m3-lbl" ${dos("Lines between brains", "Líneas entre cerebros")}</h2>
      <label for="m3-lin" class="m3-escala"><span ${dos("Opacity", "Opacidad")}</span> <span id="m3-lin-txt">60%</span></label>
      <input id="m3-lin" type="range" min="0" max="100" step="5" value="60">
    </section>
    <section>
      <h2 class="lbl m3-lbl" ${dos("Group by", "Agrupar por")}</h2>
      <div id="m3-grupo" class="seg" role="group" ${attr("aria-label", "Group by", "Agrupar por")}></div>
      <p class="m3-ayuda" ${dos("Defines which nodes are “children” of which. Dragging or separating a node takes all its children along.", "Define qué nodos son “hijos” de cuál. Al arrastrar o separar un nodo, se lleva a todos sus hijos.")}</p>
    </section>
    <section>
      <h2 class="lbl m3-lbl" ${dos("Labels", "Etiquetas")}</h2>
      <div id="m3-etq" class="seg" role="group" ${attr("aria-label", "Labels", "Etiquetas")}></div>
    </section>
  </aside>
  <main class="m3-centro">
    <canvas id="m3-canvas" role="img" ${attr("aria-label", "3D map of the brains: drag to rotate, scroll to zoom, drag a node to move it with its children", "Mapa 3D de los cerebros: arrastrá para rotar, rueda para acercar, arrastrá un nodo para moverlo con sus hijos")}></canvas>
    <div class="m3-barra">
      <div>
        <button type="button" class="ov" data-acc="explode"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3 3M15.4 15.4l3 3M5.6 18.4l3-3M15.4 8.6l3-3"></path></svg><span ${dos("Separate groups", "Separar grupos")}</span></button>
        <button type="button" class="ov" data-acc="relayout"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"></path></svg><span ${dos("Rearrange", "Reorganizar")}</span></button>
        <button type="button" class="ov" data-acc="recenter"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path></svg><span ${dos("Center", "Centrar")}</span></button>
      </div>
      <div>
        <button type="button" class="ov on" id="m3-drag" aria-pressed="true" data-acc="drag"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="3"></circle><circle cx="17" cy="15" r="2"></circle><circle cx="10" cy="18" r="1.6"></circle><path d="M9 9.5l6.5 4M8 10l1.6 6.2"></path></svg><span ${dos("Drag with children", "Arrastrar con hijos")}</span></button>
        <button type="button" class="ov on" id="m3-rot" aria-pressed="true" data-acc="rot"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="4"></ellipse><path d="M17 6.5l2.5 1.5-1.2 2.6"></path></svg><span ${dos("Spin", "Girar")}</span></button>
        <button type="button" class="ov on" id="m3-imp" aria-pressed="true" data-acc="imp"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"></path></svg><span ${dos("Pulses", "Impulsos")}</span></button>
      </div>
    </div>
    <div class="m3-guia"><span><b ${dos("Drag background", "Arrastrar fondo")}</b> <span ${dos("rotates", "rota")}</span></span><span><b ${dos("Wheel", "Rueda")}</b> <span ${dos("zooms", "acerca")}</span></span><span><b ${dos("Drag node", "Arrastrar nodo")}</b> <span ${dos("moves it with its children", "lo mueve con sus hijos")}</span></span><span class="solo-multi"><b ${dos("Drag the name", "Arrastrar el nombre")}</b> <span ${dos("moves the whole brain", "mueve el cerebro entero")}</span></span><span><b>Shift</b> <span ${dos("moves only the node", "mueve solo el nodo")}</span></span><span><b ${dos("Double click", "Doble clic")}</b> <span ${dos("focuses", "enfoca")}</span></span></div>
    <div id="m3-asa" role="separator" aria-orientation="vertical" ${attr("title", "Drag to change the width of the detail (double click: original width)", "Arrastrá para cambiar el ancho del detalle (doble clic: ancho original)")}></div>
  </main>
  <aside class="m3-panel m3-der"><div id="m3-detalle"></div></aside>
</div>
<script type="application/json" id="datos">${seguroEnScript(JSON.stringify(datos))}</script>
<script>${seguroEnScript(IDIOMA_JS)}</script>
<script>${seguroEnScript(GRAFO3D_JS)}</script>
<script>${seguroEnScript(FILTROS_JS)}</script>
<script>${seguroEnScript(PRODUCTO_JS)}</script>
<script>${seguroEnScript(PANTALLAS_JS)}</script>
<script>${seguroEnScript(FIDELIDAD_JS)}</script>
<script>window.FLOWBRAIN_GUIA_TESTS=${seguroEnScript(JSON.stringify(GUIA_TESTS))};
${seguroEnScript(ESPECIFICACIONES_JS)}</script>
<script>${seguroEnScript(SIN_ASOCIAR_JS)}</script>
<script>${seguroEnScript(CONTRATOS_JS)}</script>
<script>${seguroEnScript(MAPA_JS)}</script>
</body>
</html>
`;
}

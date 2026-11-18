import { dependenciasDelGrafo, type Ficha, type Graph } from "@flowbrain/core";
import { mapa3dDelGrafo } from "./mapa3d.js";
import { GRAFO3D_JS } from "./viewer-3d.js";
import { MAPA_JS } from "./viewer-mapa.js";
import { PANTALLAS_JS } from "./viewer-pantallas.js";
import { PRODUCTO_JS } from "./viewer-producto.js";

/**
 * Visor estático (`_build/viewer.html`): un único HTML con el grafo embebido, sin servidor ni red. Vistas:
 * funcionalidades, mapa 3D del grafo entero (`viewer-3d.ts`) e impacto.
 * Determinístico: depende solo del grafo, las funcionalidades y la versión de Cytoscape.
 */

/** Tipos visibles al abrir el mapa 3D: los archivos son miles y se prenden a mano. */
const TIPOS_INICIALES = ["feat", "pantalla", "endpoint", "tabla", "svc", "repo", "lib", "ext", "queue", "db", "team", "decision"];

const seguroEnScript = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** Lo que el visor embebe de un brain. */
export function datosDelVisor(graph: Graph, funcionalidades: Ficha[] = []) {
  return {
    dependencias: dependenciasDelGrafo(graph, funcionalidades),
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
      t: n.tipo,
      ver: n.verificado,
      // Atributos para la ficha técnica (columnas de una tabla, método y ruta de un endpoint, infraestructura de un
      // servicio). Los archivos no tienen ficha y las pantallas ya vienen en `pantallas`.
      ...(n.tipo !== "archivo" && n.tipo !== "pantalla" && Object.keys(n.atributos).length ? { at: n.atributos } : {}),
    })),
    tiposIniciales: TIPOS_INICIALES,
  };
}

export type DatosVisor = ReturnType<typeof datosDelVisor>;

export function renderViewer(graph: Graph, funcionalidades: Ficha[] = []): string {
  return paginaDelVisor(datosDelVisor(graph, funcionalidades));
}

/** La página autocontenida, a partir de los datos (de un brain, o de varios cerebros ya unidos). */
export function paginaDelVisor(datos: unknown): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlowBrain · visor</title>
<style>
:root {
  color-scheme: dark;
  --sans: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; --display: "Space Grotesk", Inter, system-ui, -apple-system, sans-serif;
  --fondo: #0A0C11; --panel: #0D1016; --tarjeta: #10141C; --hover: #171B25; --text: #E6E8EE; --claro: #D5DAE4; --medio: #A3ABBD; --suave: #8A93A6;
  --borde: #1F2433; --borde2: #2A3142; --linea: #3A4256; --acento: #9DB4FF; --primario: #4F6BFF;
  --feat: #F5A524; --pantalla: #E879F9; --endpoint: #7DD3FC; --tabla: #4ADE80; --svc: #5B7CFF; --repo: #B794F6; --lib: #FDE68A; --ext: #F472B6; --queue: #FB7185;
  --db: #14B8A6; --team: #FCA5A5; --decision: #C4B5FD; --contrato: #64748B; --archivo: #94A3B8; --dudoso: #F87171;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--fondo); color: var(--text); font: 14px/1.5 var(--sans); }
a { color: var(--acento); } a:hover { color: #C7D4FF; }
h1, h2, h3 { font-family: var(--display); letter-spacing: -0.01em; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--suave); overflow-wrap: anywhere; }
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

.lbl { font: 600 11px var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--suave); margin: 0; }
.sw, .punto { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; box-shadow: inset 0 -2px 3px rgba(0,0,0,.35); }
.punto { width: 10px; height: 10px; vertical-align: -1px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1px solid var(--borde2); border-radius: 999px; background: #121620; color: #C9CFDB; font: 500 12px var(--sans); text-decoration: none; }
a.chip { color: var(--acento); } a.chip:hover { border-color: #3B4560; }
button.chip { min-height: 30px; padding: 0 11px; cursor: pointer; }
button.chip:hover { border-color: #3B4560; color: #FFFFFF; }
.chip.on { background: #1D2740; border-color: var(--primario); color: #FFFFFF; }
.btn, .boton { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 14px; border: 1px solid var(--borde2); border-radius: 10px; background: #151A25; color: var(--text); font: 500 13px var(--sans); cursor: pointer; }
.boton { min-height: 32px; padding: 0 12px; font-size: 12px; }
.btn:hover, .boton:hover { background: #1B2130; border-color: #3B4560; }
.btn.pri { background: var(--primario); border-color: var(--primario); color: #FFFFFF; } .btn.pri:hover { background: #3F5BEF; }
.btn.on { border-color: var(--primario); color: #C7D4FF; }
input[type=search], select { width: 100%; height: 38px; padding: 0 12px; border: 1px solid #262C3A; border-radius: 10px; background: #0E1118; color: var(--text); font: 400 13px var(--sans); outline: none; }
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
.volver { display: inline-block; margin-bottom: 14px; text-decoration: none; font-size: 13px; }
#filtro-feat, #filtro-pant, #buscar-impacto { max-width: 460px; margin-bottom: 20px; }
.pagina h1.ruta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 24px; overflow-wrap: anywhere; }
.grupo-pant { margin-bottom: 14px; padding: 6px 16px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.grupo-pant h3 { margin: 10px 0 4px; font-size: 15px; } .grupo-pant h3 a { color: var(--text); text-decoration: none; } .grupo-pant h3 small { color: var(--suave); font-weight: 500; }
.recorrido h4 { margin: 14px 0 4px; font-size: 13px; color: var(--claro); }
#resultados-impacto { max-width: 560px; margin-bottom: 18px; }
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
.pestanas { display: flex; gap: 4px; margin: 6px 0 16px; border-bottom: 1px solid var(--borde); }
.pestana { padding: 8px 14px; border-bottom: 2px solid transparent; color: var(--medio); text-decoration: none; font: 500 13px var(--sans); }
.pestana b { color: var(--suave); font-weight: 600; margin-left: 4px; }
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
.ficha-tecnica h2, .titulo-rel { margin: 0 0 10px; font-size: 15px; }
.titulo-rel { margin-top: 28px; }
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
.tz-ley b { color: var(--medio); font-weight: 600; } .tz-ley:hover { color: #FFFFFF; border-color: #3B4560; }
.tz-ley.on { background: #1D2740; border-color: var(--tz); color: #FFFFFF; } .tz-ley:first-of-type { margin-left: auto; }
.tz-bloque.filtrada .tz-ley:not(.on) { opacity: .55; }
.pasos { list-style: none; margin: 10px 0 2px; padding: 0; }
.pasos li { padding: 4px 0; }
.pasos .flecha { color: var(--suave); }
.toca { margin: 4px 0 0 0; }

a.nb { text-decoration: none; }

/* Mapa 3D */
#app { display: grid; grid-template-columns: 280px minmax(0, 1fr) var(--der, 300px); height: calc(100vh - 56px); min-height: 640px; }
.m3-panel { background: var(--panel); overflow-y: auto; padding: 18px 14px; display: flex; flex-direction: column; gap: 22px; min-width: 0; }
.m3-izq { border-right: 1px solid #1A1F2B; }
.m3-der { border-left: 1px solid #1A1F2B; padding: 18px 16px; }
.m3-panel section { display: flex; flex-direction: column; gap: 8px; }
.m3-titulo { display: flex; align-items: baseline; justify-content: space-between; padding: 0 4px 2px; }
.m3-titulo span { font-size: 12px; color: var(--suave); }
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
.ov:hover { border-color: #3B4560; color: #FFFFFF; } .ov.on { border-color: var(--primario); color: #C7D4FF; }
.m3-guia { position: absolute; left: 14px; bottom: 14px; display: flex; gap: 14px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--borde); border-radius: 10px; background: rgba(14,17,24,.82); font-size: 12px; color: var(--medio); pointer-events: none; }
.m3-guia b { color: var(--text); font-weight: 500; }
.nb { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--claro); font: 400 13px var(--sans); cursor: pointer; text-align: left; }
.nb:hover { background: var(--hover); color: #FFFFFF; }
.corta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vb { margin-left: auto; font: 500 11px var(--sans); color: var(--suave); white-space: nowrap; }
#m3-detalle { display: flex; flex-direction: column; gap: 18px; }
.m3-vacio { display: flex; flex-direction: column; gap: 14px; padding: 6px 4px; }
.m3-vacio p { margin: 0; font-size: 14px; line-height: 1.55; color: #C9CFDB; }
.m3-caja { display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid var(--borde); border-radius: 12px; background: var(--tarjeta); }
.m3-cab { display: flex; flex-direction: column; gap: 8px; padding: 0 4px; }
.m3-tipo { display: flex; align-items: center; gap: 8px; } .m3-tipo .lbl { color: var(--medio); }
.m3-fijado { margin-left: auto; font-size: 11px; color: #C7D4FF; border: 1px solid #36457A; border-radius: 999px; padding: 2px 8px; }
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
#m3-asa:hover::after, #m3-asa.on::after { background: #5B7CFA; }

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
  <nav aria-label="Secciones"><a href="#/funcionalidades" data-vista="producto">Funcionalidades</a><a href="#/pantallas" data-vista="pantallas">Navegación</a><a href="#/grafo" data-vista="grafo">Mapa 3D</a><a href="#/impacto" data-vista="impacto">Impacto</a></nav>
  <div id="presets" class="oculto"></div>
</header>
<div id="producto" class="pagina"></div>
<div id="impacto" class="pagina oculto"></div>
<div id="app" class="oculto">
  <aside class="m3-panel m3-izq">
    <div class="m3-busca">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A93A6" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
      <input id="m3-buscar" type="search" placeholder="Buscar tabla, endpoint, funcionalidad…" aria-label="Buscar nodo" autocomplete="off">
      <div id="m3-res" class="oculto"></div>
    </div>
    <section>
      <div class="m3-titulo"><h2 class="lbl">Qué se ve</h2><span id="m3-vis"></span></div>
      <div id="m3-cerebros"></div>
      <div id="m3-todo"></div>
      <div id="m3-tipos"></div>
      <div id="m3-ocultos"></div>
    </section>
    <section>
      <h2 class="lbl" style="padding: 0 4px 2px">Relaciones</h2>
      <div id="m3-verbos"></div>
    </section>
    <section>
      <h2 class="lbl" style="padding: 0 4px">Tamaño del punto según</h2>
      <div id="m3-tam" class="seg" role="group" aria-label="Tamaño según"></div>
      <label for="m3-escala" class="m3-escala">Escala <span id="m3-escala-txt">0.6×</span></label>
      <input id="m3-escala" type="range" min="0.4" max="2.4" step="0.1" value="0.6">
    </section>
    <section>
      <h2 class="lbl" style="padding: 0 4px">Impulsos</h2>
      <label for="m3-int" class="m3-escala">Intensidad <span id="m3-int-txt">40%</span></label>
      <input id="m3-int" type="range" min="0" max="100" step="5" value="40">
    </section>
    <section id="m3-lin-sec">
      <h2 class="lbl" style="padding: 0 4px">Líneas entre cerebros</h2>
      <label for="m3-lin" class="m3-escala">Opacidad <span id="m3-lin-txt">60%</span></label>
      <input id="m3-lin" type="range" min="0" max="100" step="5" value="60">
    </section>
    <section>
      <h2 class="lbl" style="padding: 0 4px">Agrupar por</h2>
      <div id="m3-grupo" class="seg" role="group" aria-label="Agrupar por"></div>
      <p class="m3-ayuda">Define qué nodos son “hijos” de cuál. Al arrastrar o separar un nodo, se lleva a todos sus hijos.</p>
    </section>
    <section>
      <h2 class="lbl" style="padding: 0 4px">Etiquetas</h2>
      <div id="m3-etq" class="seg" role="group" aria-label="Etiquetas"></div>
    </section>
  </aside>
  <main class="m3-centro">
    <canvas id="m3-canvas" role="img" aria-label="Grafo 3D del brain: arrastrá para rotar, rueda para acercar, arrastrá un nodo para moverlo con sus hijos"></canvas>
    <div class="m3-barra">
      <div>
        <button type="button" class="ov" data-acc="explode"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3 3M15.4 15.4l3 3M5.6 18.4l3-3M15.4 8.6l3-3"></path></svg>Separar grupos</button>
        <button type="button" class="ov" data-acc="relayout"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"></path></svg>Reorganizar</button>
        <button type="button" class="ov" data-acc="recenter"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path></svg>Centrar</button>
      </div>
      <div>
        <button type="button" class="ov on" id="m3-drag" aria-pressed="true" data-acc="drag"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="3"></circle><circle cx="17" cy="15" r="2"></circle><circle cx="10" cy="18" r="1.6"></circle><path d="M9 9.5l6.5 4M8 10l1.6 6.2"></path></svg>Arrastrar con hijos</button>
        <button type="button" class="ov on" id="m3-rot" aria-pressed="true" data-acc="rot"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="4"></ellipse><path d="M17 6.5l2.5 1.5-1.2 2.6"></path></svg>Girar</button>
        <button type="button" class="ov on" id="m3-imp" aria-pressed="true" data-acc="imp"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"></path></svg>Impulsos</button>
      </div>
    </div>
    <div class="m3-guia"><span><b>Arrastrar fondo</b> rota</span><span><b>Rueda</b> acerca</span><span><b>Arrastrar nodo</b> lo mueve con sus hijos</span><span class="solo-multi"><b>Arrastrar el nombre</b> mueve el cerebro entero</span><span><b>Shift</b> mueve solo el nodo</span><span><b>Doble clic</b> enfoca</span></div>
    <div id="m3-asa" role="separator" aria-orientation="vertical" title="Arrastrá para cambiar el ancho del detalle (doble clic: ancho original)"></div>
  </main>
  <aside class="m3-panel m3-der"><div id="m3-detalle"></div></aside>
</div>
<script type="application/json" id="datos">${seguroEnScript(JSON.stringify(datos))}</script>
<script>${seguroEnScript(GRAFO3D_JS)}</script>
<script>${seguroEnScript(PRODUCTO_JS)}</script>
<script>${seguroEnScript(PANTALLAS_JS)}</script>
<script>${seguroEnScript(MAPA_JS)}</script>
</body>
</html>
`;
}

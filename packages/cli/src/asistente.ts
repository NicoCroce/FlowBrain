import { mkdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { CARPETA_PROYECTO, MAX_CEREBROS } from "@flowbrain/core";
import { asegurarGitignore, crearRegistro, detectarRepo, encontrarRepos, lenguajesDeCarpeta, type RepoDetectado } from "./cerebros.js";
import { AGENTES, analizarCon, conectarMcp, elegirAgente } from "./agentes.js";
import { accion, contextoMenu, si, siPorDefecto, PROMPT_ANALISIS, type ContextoMenu, type Entorno } from "./menu.js";

/**
 * El asistente de un proyecto nuevo. Los pasos van en el único orden que funciona, porque cada uno usa lo que deja
 * el anterior: la máquina, los repos (qué subrepositorios hay y cómo se agrupan en cerebros), el índice (lo que leen
 * los parsers), el MCP y por último el análisis del modelo, que arranca midiendo lo que el índice ya tiene. Cada paso
 * mira primero si ya está hecho, así que cortarlo a la mitad y volver a empezar sigue desde el primero pendiente.
 */

export const PASOS = ["Requisitos", "Repositorios", "Índice", "Agente (MCP)", "Análisis completo", "Visor"] as const;

const NEGRITA = "\x1b[1m", TENUE = "\x1b[2m", VERDE = "\x1b[32m", FIN = "\x1b[0m";

export function cabecera(actual: number, hechos: boolean[]): string {
  const filas = PASOS.map((p, i) => {
    const marca = hechos[i] ? `${VERDE}✓${FIN}` : i === actual ? "→" : " ";
    return `  ${marca} ${i + 1}. ${i === actual ? `${NEGRITA}${p}${FIN}` : hechos[i] ? `${TENUE}${p}${FIN}` : p}`;
  });
  return [`${NEGRITA}FlowBrain · configuración del proyecto${FIN}`, "", ...filas, ""].join("\n") + "\n";
}

/** Una línea por repo: nombre, tecnología y lo que se ve a primera vista. */
export function lineaRepo(r: RepoDetectado, extensiones: string[], base: string): string {
  const tecno = [...new Set([...r.pila, ...(r.lenguajes.length ? r.lenguajes : extensiones.slice(0, 3))])];
  const cuenta = (n: number, uno: string, varios: string) => (n ? `${n} ${n === 1 ? uno : varios}` : "");
  const datos = [cuenta(r.endpoints, "endpoint", "endpoints"), cuenta(r.pantallas, "pantalla", "pantallas"), cuenta(r.tablas, "tabla", "tablas")].filter(Boolean).join(", ");
  return `${relative(base, r.ruta) || basename(r.ruta)}: ${tecno.join(", ") || "sin código reconocido"}${datos ? ` · ${datos}` : ""}`;
}

/** Números separados por coma o espacio, dentro de 1..n. */
export const numeros = (t: string, n: number) => [...new Set(t.split(/[\s,]+/).filter(Boolean).map(Number))].filter((x) => Number.isInteger(x) && x >= 1 && x <= n);

export async function asistente(c0: ContextoMenu, e: Entorno): Promise<void> {
  let c = c0;
  const recargar = (p: string) => (e.contexto ?? contextoMenu)(p);
  const hechos = PASOS.map(() => false);
  const paso = (i: number) => {
    e.limpiar();
    e.escribir(cabecera(i, hechos));
  };
  const mostrar = (r: { stdout: string; stderr: string }) => e.escribir(r.stdout + (r.stderr ? r.stderr : ""));

  // 1. Requisitos: la máquina lista (comando, hooks y comandos de Claude Code) y qué falta instalar.
  paso(0);
  if (!c.git) e.escribir("No encontré git: FlowBrain sabe si un repo cambió por su commit. Instalalo cuando puedas.\n");
  if (!c.agentes.length)
    e.escribir(
      `No encontré ${AGENTES.map((a) => `${a.nombre} (${a.comando})`).join(", ")}. Sigo igual: para el análisis te doy las instrucciones y las pegás en el agente de código que uses.\n`,
    );
  const setup = await e.flowbrain(["setup"], c.proyecto);
  if (setup.codigo !== 0) {
    mostrar(setup);
    e.escribir("No pude preparar la máquina: revisá lo de arriba.\n");
    return;
  }
  hechos[0] = true;

  // 2. Repositorios: dónde están, cuáles entran y cómo se agrupan. Nada se escribe hasta que se confirma.
  if (!c.registro) {
    paso(1);
    const resp = (await e.preguntar(`¿En qué carpeta están los repositorios? (Enter: ${c.proyecto}) `)).trim();
    const carpeta = resolve(c.proyecto, resp || ".");
    e.escribir("Buscando repositorios…\n");
    let rutas = await encontrarRepos(carpeta);
    if (!rutas.length) {
      // Sin subrepos: la carpeta misma es el repo, si tiene código.
      if (!lenguajesDeCarpeta(carpeta).length) {
        e.escribir(
          `\nNo encontré código en ${carpeta}. FlowBrain se arma sobre código que ya existe: cuando el proyecto tenga código, volvé a escribir flowbrain y sigo desde acá.\n`,
        );
        if (!c.mcp && c.agentes.length && siPorDefecto(await e.preguntar("Mientras tanto, ¿conecto tu agente con FlowBrain (MCP)? (S/n) "))) await conectarMcp(c, e, false);
        return;
      }
      rutas = [carpeta];
    }
    e.escribir(`Leyendo ${rutas.length === 1 ? "el repo" : `los ${rutas.length} repos`}…\n`);
    const repos: RepoDetectado[] = [];
    for (const r of rutas) repos.push(await detectarRepo(r));
    e.escribir(`\nEncontré ${repos.length === 1 ? "1 repo" : `${repos.length} repos`}:\n`);
    repos.forEach((r, i) => e.escribir(`  ${i + 1}. ${lineaRepo(r, lenguajesDeCarpeta(r.ruta), carpeta)}\n`));
    let elegidos = repos;
    if (repos.length > 1) {
      const fuera = numeros(await e.preguntar("\n¿Dejo afuera alguno? Números separados por coma (Enter: ninguno) "), repos.length);
      elegidos = repos.filter((_, i) => !fuera.includes(i + 1));
      if (!elegidos.length) {
        e.escribir("Sin repos no hay nada que armar. Volvé a escribir flowbrain cuando quieras.\n");
        return;
      }
    }
    let dividir = false;
    if (elegidos.length > MAX_CEREBROS) e.escribir(`Son ${elegidos.length} repos y el máximo es ${MAX_CEREBROS} cerebros: van todos en uno (después se pueden agrupar en .flowbrain/flowbrain.yaml).\n`);
    else if (elegidos.length > 1) {
      e.escribir(
        "\nCada cerebro es un mapa: un repo por cerebro sirve cuando cada uno es un servicio (un front, una API); todos en uno, cuando son partes de lo mismo.\n",
      );
      dividir = (await e.preguntar("¿Un cerebro por repo (1) o todos en uno (2)? (Enter: 1) ")).trim() !== "2";
    }
    const cuantos = dividir ? elegidos.length : 1;
    if (!siPorDefecto(await e.preguntar(`\nVoy a crear ${CARPETA_PROYECTO}/ en ${c.proyecto} con ${elegidos.length === 1 ? "1 repo" : `${elegidos.length} repos`} en ${cuantos === 1 ? "un cerebro" : `${cuantos} cerebros`}. ¿Sigo? (S/n) `))) {
      e.escribir("No toqué nada.\n");
      return;
    }
    const reg = join(c.proyecto, CARPETA_PROYECTO);
    await mkdir(reg, { recursive: true });
    const creado = await crearRegistro(reg, c.proyecto, elegidos.map((r) => r.ruta), dividir);
    await asegurarGitignore(reg);
    e.escribir(`Registro creado: ${creado.cerebros.join(", ")}.\n`);
    c = await recargar(c.proyecto);
  }
  hechos[1] = true;

  // 3. Índice: los parsers leen cada repo. Va antes del análisis porque el modelo arranca de lo que ya se leyó.
  if (c.faltaIndice.length) {
    paso(2);
    e.escribir("Indexando (los parsers leen cada repo; puede tardar un par de minutos)…\n");
    const r = await e.flowbrain(["brains", "apply"], c.proyecto);
    mostrar(r);
    c = await recargar(c.proyecto);
    if (c.faltaIndice.length) {
      e.escribir(`\nNo se pudo indexar ${c.faltaIndice.join(", ")}: revisá lo de arriba y volvé a escribir flowbrain para seguir.\n`);
      return;
    }
  }
  hechos[2] = true;

  // 4. MCP: antes del análisis, así el agente ya consulta FlowBrain mientras analiza.
  if (!c.mcp && c.agentes.length) {
    paso(3);
    e.escribir("Con el MCP, tu agente de código consulta FlowBrain en cualquier proyecto: impacto, pantallas, recorridos.\n");
    if (siPorDefecto(await e.preguntar("¿Lo conecto? (S/n) "))) {
      await conectarMcp(c, e, false);
      c = await recargar(c.proyecto);
    }
  }
  hechos[3] = c.mcp;

  // 5. Análisis completo: siempre profundo, con el agente que la persona elija. Es lo que más tarda: se pide el ok.
  if (c.faltaAnalisis.length) {
    paso(4);
    e.escribir(
      "Un agente de código estudia cada repo de punta a punta, escribe los extractores que completan lo que los parsers no ven, une los servicios entre sí y completa las funcionalidades de producto. Tarda: según el tamaño, de varios minutos a más de una hora.\n",
    );
    if (si(await e.preguntar("¿Lo arranco ahora? (s/N) "))) {
      await analizarCon(await elegirAgente(c, e, "analizar"), PROMPT_ANALISIS, c, e);
      c = await recargar(c.proyecto);
    } else e.escribir("Queda pendiente: escribí flowbrain cuando quieras y es el siguiente paso.\n");
  }
  hechos[4] = !c.faltaAnalisis.length;

  // 6. Visor.
  paso(5);
  if (c.visor && siPorDefecto(await e.preguntar(`El visor está en ${c.visor}. ¿Lo abro? (S/n) `))) await accion({ clave: "visor", titulo: "", detalle: "" }, c, e);
  hechos[5] = !!c.visor;
  paso(-1);
  e.escribir(
    hechos.every(Boolean)
      ? "Listo. Escribí flowbrain cuando quieras reindexar, ver el estado o actualizar.\n"
      : "Lo que quedó sin tilde sigue pendiente: escribí flowbrain y el menú te lleva al siguiente paso.\n",
  );
}

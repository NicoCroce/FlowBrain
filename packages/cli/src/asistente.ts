import { mkdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { CARPETA_PROYECTO, MAX_CEREBROS } from "@flowbrain/core";
import { asegurarGitignore, crearRegistro, detectarRepo, encontrarRepos, lenguajesDeCarpeta, type RepoDetectado } from "./cerebros.js";
import { AGENTES, analizarCon, conectarMcp, elegirAgente } from "./agentes.js";
import { L } from "./idioma.js";
import { accion, contextoMenu, si, siPorDefecto, PROMPT_ANALISIS, type ContextoMenu, type Entorno } from "./menu.js";

/**
 * El asistente de un proyecto nuevo. Los pasos van en el único orden que funciona, porque cada uno usa lo que deja
 * el anterior: la máquina, los repos (qué subrepositorios hay y cómo se agrupan en cerebros), el índice (lo que leen
 * los parsers), el MCP y por último el análisis del modelo, que arranca midiendo lo que el índice ya tiene. Cada paso
 * mira primero si ya está hecho, así que cortarlo a la mitad y volver a empezar sigue desde el primero pendiente.
 */

/** Los pasos del asistente, en el idioma actual. */
export const pasos = () => [
  L("Requirements", "Requisitos"),
  L("Repositories", "Repositorios"),
  L("Index", "Índice"),
  L("Agent (MCP)", "Agente (MCP)"),
  L("Full analysis", "Análisis completo"),
  L("Viewer", "Visor"),
];

const NEGRITA = "\x1b[1m", TENUE = "\x1b[2m", VERDE = "\x1b[32m", FIN = "\x1b[0m";

export function cabecera(actual: number, hechos: boolean[]): string {
  const filas = pasos().map((p, i) => {
    const marca = hechos[i] ? `${VERDE}✓${FIN}` : i === actual ? "→" : " ";
    return `  ${marca} ${i + 1}. ${i === actual ? `${NEGRITA}${p}${FIN}` : hechos[i] ? `${TENUE}${p}${FIN}` : p}`;
  });
  return [`${NEGRITA}FlowBrain · ${L("project setup", "configuración del proyecto")}${FIN}`, "", ...filas, ""].join("\n") + "\n";
}

/** Una línea por repo: nombre, tecnología y lo que se ve a primera vista. */
export function lineaRepo(r: RepoDetectado, extensiones: string[], base: string): string {
  const tecno = [...new Set([...r.pila, ...(r.lenguajes.length ? r.lenguajes : extensiones.slice(0, 3))])];
  const cuenta = (n: number, uno: string, varios: string) => (n ? `${n} ${n === 1 ? uno : varios}` : "");
  const datos = [cuenta(r.endpoints, "endpoint", "endpoints"), cuenta(r.pantallas, L("screen", "pantalla"), L("screens", "pantallas")), cuenta(r.tablas, L("table", "tabla"), L("tables", "tablas"))].filter(Boolean).join(", ");
  return `${relative(base, r.ruta) || basename(r.ruta)}: ${tecno.join(", ") || L("no recognized code", "sin código reconocido")}${datos ? ` · ${datos}` : ""}`;
}

/** Números separados por coma o espacio, dentro de 1..n. */
export const numeros = (t: string, n: number) => [...new Set(t.split(/[\s,]+/).filter(Boolean).map(Number))].filter((x) => Number.isInteger(x) && x >= 1 && x <= n);

export async function asistente(c0: ContextoMenu, e: Entorno): Promise<void> {
  let c = c0;
  const recargar = (p: string) => (e.contexto ?? contextoMenu)(p);
  const hechos = pasos().map(() => false);
  const paso = (i: number) => {
    e.limpiar();
    e.escribir(cabecera(i, hechos));
  };
  const mostrar = (r: { stdout: string; stderr: string }) => e.escribir(r.stdout + (r.stderr ? r.stderr : ""));

  // 1. Requisitos: la máquina lista (comando, hooks y comandos de Claude Code) y qué falta instalar.
  paso(0);
  if (!c.git) e.escribir(L("git not found: FlowBrain knows whether a repo changed by its commit. Install it when you can.\n", "No encontré git: FlowBrain sabe si un repo cambió por su commit. Instalalo cuando puedas.\n"));
  if (!c.agentes.length)
    e.escribir(
      L(
        `${AGENTES.map((a) => `${a.nombre} (${a.comando})`).join(", ")} not found. Going on anyway: for the analysis I give you the instructions and you paste them into the coding agent you use.\n`,
        `No encontré ${AGENTES.map((a) => `${a.nombre} (${a.comando})`).join(", ")}. Sigo igual: para el análisis te doy las instrucciones y las pegás en el agente de código que uses.\n`,
      ),
    );
  const setup = await e.flowbrain(["setup"], c.proyecto);
  if (setup.codigo !== 0) {
    mostrar(setup);
    e.escribir(L("Could not get the machine ready: check the output above.\n", "No pude preparar la máquina: revisá lo de arriba.\n"));
    return;
  }
  hechos[0] = true;

  // 2. Repositorios: dónde están, cuáles entran y cómo se agrupan. Nada se escribe hasta que se confirma.
  if (!c.registro) {
    paso(1);
    const resp = (await e.preguntar(L(`Which folder are the repositories in? (Enter: ${c.proyecto}) `, `¿En qué carpeta están los repositorios? (Enter: ${c.proyecto}) `))).trim();
    const carpeta = resolve(c.proyecto, resp || ".");
    e.escribir(L("Looking for repositories…\n", "Buscando repositorios…\n"));
    let rutas = await encontrarRepos(carpeta);
    if (!rutas.length) {
      // Sin subrepos: la carpeta misma es el repo, si tiene código.
      if (!lenguajesDeCarpeta(carpeta).length) {
        e.escribir(
          L(
            `\nNo code found in ${carpeta}. FlowBrain is built on code that already exists: when the project has code, type flowbrain again and I will continue from here.\n`,
            `\nNo encontré código en ${carpeta}. FlowBrain se arma sobre código que ya existe: cuando el proyecto tenga código, volvé a escribir flowbrain y sigo desde acá.\n`,
          ),
        );
        if (!c.mcp && c.agentes.length && siPorDefecto(await e.preguntar(L("Meanwhile, shall I connect your agent to FlowBrain (MCP)? (Y/n) ", "Mientras tanto, ¿conecto tu agente con FlowBrain (MCP)? (S/n) ")))) await conectarMcp(c, e, false);
        return;
      }
      rutas = [carpeta];
    }
    e.escribir(L(`Reading ${rutas.length === 1 ? "the repo" : `the ${rutas.length} repos`}…\n`, `Leyendo ${rutas.length === 1 ? "el repo" : `los ${rutas.length} repos`}…\n`));
    const repos: RepoDetectado[] = [];
    for (const r of rutas) repos.push(await detectarRepo(r));
    e.escribir(L(`\nFound ${repos.length === 1 ? "1 repo" : `${repos.length} repos`}:\n`, `\nEncontré ${repos.length === 1 ? "1 repo" : `${repos.length} repos`}:\n`));
    repos.forEach((r, i) => e.escribir(`  ${i + 1}. ${lineaRepo(r, lenguajesDeCarpeta(r.ruta), carpeta)}\n`));
    let elegidos = repos;
    if (repos.length > 1) {
      const fuera = numeros(await e.preguntar(L("\nLeave any out? Numbers separated by commas (Enter: none) ", "\n¿Dejo afuera alguno? Números separados por coma (Enter: ninguno) ")), repos.length);
      elegidos = repos.filter((_, i) => !fuera.includes(i + 1));
      if (!elegidos.length) {
        e.escribir(L("Without repos there is nothing to build. Type flowbrain again whenever you want.\n", "Sin repos no hay nada que armar. Volvé a escribir flowbrain cuando quieras.\n"));
        return;
      }
    }
    let dividir = false;
    if (elegidos.length > MAX_CEREBROS) e.escribir(
        L(
          `There are ${elegidos.length} repos and the maximum is ${MAX_CEREBROS} brains: they all go in one (you can group them later in .flowbrain/flowbrain.yaml).\n`,
          `Son ${elegidos.length} repos y el máximo es ${MAX_CEREBROS} cerebros: van todos en uno (después se pueden agrupar en .flowbrain/flowbrain.yaml).\n`,
        ),
      );
    else if (elegidos.length > 1) {
      e.escribir(
        L(
          "\nEach brain is a map: one repo per brain works when each one is a service (a front end, an API); all in one, when they are parts of the same thing.\n",
          "\nCada cerebro es un mapa: un repo por cerebro sirve cuando cada uno es un servicio (un front, una API); todos en uno, cuando son partes de lo mismo.\n",
        ),
      );
      dividir = (await e.preguntar(L("One brain per repo (1) or all in one (2)? (Enter: 1) ", "¿Un cerebro por repo (1) o todos en uno (2)? (Enter: 1) "))).trim() !== "2";
    }
    const cuantos = dividir ? elegidos.length : 1;
    if (!siPorDefecto(
        await e.preguntar(
          L(
            `\nI will create ${CARPETA_PROYECTO}/ in ${c.proyecto} with ${elegidos.length === 1 ? "1 repo" : `${elegidos.length} repos`} in ${cuantos === 1 ? "one brain" : `${cuantos} brains`}. Continue? (Y/n) `,
            `\nVoy a crear ${CARPETA_PROYECTO}/ en ${c.proyecto} con ${elegidos.length === 1 ? "1 repo" : `${elegidos.length} repos`} en ${cuantos === 1 ? "un cerebro" : `${cuantos} cerebros`}. ¿Sigo? (S/n) `,
          ),
        )
      )) {
      e.escribir(L("Nothing was touched.\n", "No toqué nada.\n"));
      return;
    }
    const reg = join(c.proyecto, CARPETA_PROYECTO);
    await mkdir(reg, { recursive: true });
    const creado = await crearRegistro(reg, c.proyecto, elegidos.map((r) => r.ruta), dividir);
    await asegurarGitignore(reg);
    e.escribir(L(`Registry created: ${creado.cerebros.join(", ")}.\n`, `Registro creado: ${creado.cerebros.join(", ")}.\n`));
    c = await recargar(c.proyecto);
  }
  hechos[1] = true;

  // 3. Índice: los parsers leen cada repo. Va antes del análisis porque el modelo arranca de lo que ya se leyó.
  if (c.faltaIndice.length) {
    paso(2);
    e.escribir(L("Indexing (the parsers read each repo; it can take a couple of minutes)…\n", "Indexando (los parsers leen cada repo; puede tardar un par de minutos)…\n"));
    const r = await e.flowbrain(["brains", "apply"], c.proyecto);
    mostrar(r);
    c = await recargar(c.proyecto);
    if (c.faltaIndice.length) {
      e.escribir(
        L(
          `\nCould not index ${c.faltaIndice.join(", ")}: check the output above and type flowbrain again to continue.\n`,
          `\nNo se pudo indexar ${c.faltaIndice.join(", ")}: revisá lo de arriba y volvé a escribir flowbrain para seguir.\n`,
        ),
      );
      return;
    }
  }
  hechos[2] = true;

  // 4. MCP: antes del análisis, así el agente ya consulta FlowBrain mientras analiza.
  if (!c.mcp && c.agentes.length) {
    paso(3);
    e.escribir(L("With the MCP, your coding agent queries FlowBrain in any project: impact, screens, flows.\n", "Con el MCP, tu agente de código consulta FlowBrain en cualquier proyecto: impacto, pantallas, recorridos.\n"));
    if (siPorDefecto(await e.preguntar(L("Connect it? (Y/n) ", "¿Lo conecto? (S/n) ")))) {
      await conectarMcp(c, e, false);
      c = await recargar(c.proyecto);
    }
  }
  hechos[3] = c.mcp;

  // 5. Análisis completo: siempre profundo, con el agente que la persona elija. Es lo que más tarda: se pide el ok.
  if (c.faltaAnalisis.length) {
    paso(4);
    e.escribir(
      L(
        "A coding agent studies each repo end to end, writes the extractors that complete what the parsers do not see, joins the services together and completes the product features. It takes time: depending on the size, from several minutes to over an hour.\n",
        "Un agente de código estudia cada repo de punta a punta, escribe los extractores que completan lo que los parsers no ven, une los servicios entre sí y completa las funcionalidades de producto. Tarda: según el tamaño, de varios minutos a más de una hora.\n",
      ),
    );
    if (si(await e.preguntar(L("Start it now? (y/N) ", "¿Lo arranco ahora? (s/N) ")))) {
      await analizarCon(await elegirAgente(c, e, "analizar"), PROMPT_ANALISIS, c, e);
      c = await recargar(c.proyecto);
    } else e.escribir(L("Left pending: type flowbrain whenever you want and it is the next step.\n", "Queda pendiente: escribí flowbrain cuando quieras y es el siguiente paso.\n"));
  }
  hechos[4] = !c.faltaAnalisis.length;

  // 6. Visor.
  paso(5);
  if (c.visor && siPorDefecto(await e.preguntar(L(`The viewer is at ${c.visor}. Open it? (Y/n) `, `El visor está en ${c.visor}. ¿Lo abro? (S/n) `)))) await accion({ clave: "visor", titulo: "", detalle: "" }, c, e);
  hechos[5] = !!c.visor;
  paso(-1);
  e.escribir(
    hechos.every(Boolean)
      ? L("Done. Type flowbrain whenever you want to reindex, see the status or update.\n", "Listo. Escribí flowbrain cuando quieras reindexar, ver el estado o actualizar.\n")
      : L("Whatever is left unchecked is still pending: type flowbrain and the menu takes you to the next step.\n", "Lo que quedó sin tilde sigue pendiente: escribí flowbrain y el menú te lleva al siguiente paso.\n"),
  );
}

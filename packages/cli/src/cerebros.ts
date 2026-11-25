import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { ARCHIVO_REGISTRO, avisar, type Progreso, cerebroLiviano, cmp, contextoDeFuentes, contratoDeEndpoint, deriva, derivaCruzadaDe, fidelidadDeArchivos, simbolosDelVisor, CompileError, crucesDelRegistro, usosEntreCerebros, esRegistro, leerRegistro, MAX_CEREBROS, resumenConexiones, trazasCruzadas, type Cerebro, type FuenteTraza, type CerebroLiviano, type Contrato, type Cruce, type Ficha, type Graph, type Registro } from "@flowbrain/core";
import { draftDir } from "@flowbrain/indexer";
import { escribirIndex, fusionar, IGNORAR, indexar, leerRepo, PARSERS, slug } from "@flowbrain/parsers";
import { compileDirConVisor, visorDeCerebros, type CerebroVisor } from "@flowbrain/viewer";
import { init } from "./init.js";
import { L } from "./idioma.js";
import { borradoresPromovibles, promover } from "./promover.js";

/**
 * Varios cerebros: `proponer` explora una carpeta y deja un borrador de `flowbrain.yaml` con lo que pudo detectar y
 * las preguntas que no puede responder sola; `aplicar` crea e indexa cada cerebro a partir del archivo ya revisado.
 */

const existe = (p: string) => stat(p).then(() => true, () => false);
/** Manifiestos que delatan un proyecto en cualquier lenguaje (para encontrar repos sin `.git`). */
const MANIFIESTOS = ["package.json", "composer.json", "go.mod", "pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "pubspec.yaml", "Package.swift", "Cargo.toml", "mix.exs"];
const tieneManifiesto = async (dir: string) =>
  (await Promise.all(MANIFIESTOS.map((m) => existe(join(dir, m))))).some(Boolean) || (await readdir(dir).catch(() => [] as string[])).some((n) => /\.(csproj|sln)$/.test(n));

/**
 * Repos bajo una carpeta: los directorios con `.git`, o con manifiesto si nada por encima es un repo. No entra en un
 * repo, salvo en la carpeta de partida cuando tiene otros repos (`.git`) adentro.
 */
export async function encontrarRepos(carpeta: string, profundidad = 3): Promise<string[]> {
  const out: string[] = [];
  const andar = async (dir: string, nivel: number) => {
    if ((await existe(join(dir, ".git"))) || (nivel > 0 && (await tieneManifiesto(dir)))) {
      out.push(dir);
      return;
    }
    if (nivel >= profundidad) return;
    for (const e of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => cmp(a.name, b.name))) {
      if (e.isDirectory() && !IGNORAR.has(e.name) && !e.name.startsWith(".")) await andar(join(dir, e.name), nivel + 1);
    }
  };
  const raiz = resolve(carpeta);
  // Una carpeta que es un repo y además guarda otros repos adentro (un repo que orquesta clones): valen los de adentro.
  if (await existe(join(raiz, ".git"))) {
    const anidados: string[] = [];
    const buscar = async (dir: string, nivel: number) => {
      for (const e of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => cmp(a.name, b.name))) {
        if (!e.isDirectory() || IGNORAR.has(e.name) || e.name.startsWith(".")) continue;
        const d = join(dir, e.name);
        if (await existe(join(d, ".git"))) anidados.push(d);
        else if (nivel < profundidad) await buscar(d, nivel + 1);
      }
    };
    await buscar(raiz, 1);
    if (anidados.length) return anidados.sort(cmp);
  }
  await andar(raiz, 0);
  return out.sort(cmp);
}

/** Extensiones de código (no configuración ni documentación) que delatan que hay un programa. */
const EXT_CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|php|py|go|rb|java|kt|kts|scala|groovy|cs|fs|vb|swift|m|mm|dart|rs|ex|exs|erl|clj|c|cc|cpp|h|hpp|lua|r|sql)$/i;

/** Las extensiones de código de una carpeta, de la más usada a la menos (vacío: no hay código). */
export function lenguajesDeCarpeta(ruta: string): string[] {
  const n = new Map<string, number>();
  for (const f of leerRepo(ruta).archivos) {
    const m = EXT_CODIGO.exec(f);
    if (m) n.set(m[1]!.toLowerCase(), (n.get(m[1]!.toLowerCase()) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([e]) => e);
}

/** Lo derivado no se versiona; las páginas, los borradores y el registro sí. */
export async function asegurarGitignore(carpetaRegistro: string): Promise<void> {
  if (!(await existe(join(carpetaRegistro, ".gitignore")))) await writeFile(join(carpetaRegistro, ".gitignore"), `*/_build/\n${ARCHIVO_VISOR}\n`, "utf8");
}

export interface RepoDetectado {
  ruta: string;
  nombre: string;
  lenguajes: string[];
  /** Marcos y librerías que delatan la pila, por las dependencias declaradas. */
  pila: string[];
  endpoints: number;
  pantallas: number;
  tablas: number;
  /** De dónde salen las URLs de sus llamadas HTTP: una variable (`${env.API}`) o un host, con cuántas llamadas. */
  bases: Array<{ base: string; llamadas: number }>;
}

const PILAS = ["@nestjs/core", "express", "fastify", "koa", "next", "react", "react-native", "vue", "@angular/core", "svelte", "prisma", "typeorm", "kysely", "sequelize", "laravel/framework", "symfony/framework-bundle", "doctrine/orm"];

export async function detectarRepo(ruta: string): Promise<RepoDetectado> {
  const repo = leerRepo(ruta);
  const x = fusionar(await Promise.all(PARSERS.filter((p) => p.detect(repo)).map((p) => p.extract(repo))));
  const deps = new Set<string>();
  for (const a of repo.archivos.filter((f) => /(^|\/)(package|composer)\.json$/.test(f) && f.split("/").length <= 4)) {
    try {
      const j = JSON.parse(await readFile(join(repo.raiz, a), "utf8")) as Record<string, Record<string, string> | undefined>;
      for (const k of ["dependencies", "devDependencies", "require"]) for (const d of Object.keys(j[k] ?? {})) deps.add(d);
    } catch {
      /* manifiesto ilegible: no aporta */
    }
  }
  const bases = new Map<string, number>();
  for (const l of x.llamadas) {
    const b = l.url.base === "literal" ? (l.url.host ?? "") : l.url.base === "dinamica" ? (/^\$\{[^}]*\}/.exec(l.url.texto)?.[0] ?? "") : "";
    if (b) bases.set(b, (bases.get(b) ?? 0) + 1);
  }
  return {
    ruta: repo.raiz,
    nombre: basename(repo.raiz),
    lenguajes: [...new Set(x.archivos.map((a) => a.lenguaje))].sort(cmp),
    pila: PILAS.filter((p) => deps.has(p)),
    endpoints: x.endpoints.length,
    pantallas: x.pantallas.length,
    tablas: new Set([...x.modelos.map((m) => m.tabla ?? m.nombre), ...x.tablas.map((t) => t.modelo), ...(x.esquema ?? []).map((t) => t.tabla)].map((t) => t.toLowerCase())).size,
    bases: [...bases.entries()].map(([base, llamadas]) => ({ base, llamadas })).sort((a, b) => b.llamadas - a.llamadas || cmp(a.base, b.base)),
  };
}

const y = (s: string) => JSON.stringify(s);

/** Texto de `flowbrain.yaml` propuesto: un solo cerebro con todo, lo detectado y las preguntas abiertas. */
export function textoPropuesta(carpetaRegistro: string, nombre: string, repos: RepoDetectado[], grupos: Array<{ nombre: string; repos: RepoDetectado[] }> = [{ nombre, repos }]): string {
  // Relativa si el repo está cerca del registro (así el archivo sirve en otra máquina); si no, absoluta.
  const rel = (p: string) => {
    const r = relative(resolve(carpetaRegistro), p) || ".";
    return r.split("/").filter((x) => x === "..").length > 2 ? p : r;
  };
  // Solo se pregunta por las bases que parecen una variable de configuración y concentran llamadas; el resto queda en `detectado`.
  const preguntable = (b: { base: string; llamadas: number }) => b.llamadas >= 3 && /^\$\{[\w.:$>-]+\}$/.test(b.base);
  const preguntas = [
    grupos.length > 1
      ? `There is one brain per repo (${grupos.length}). Should some be merged? A brain can hold several repos (up to ${MAX_CEREBROS} brains).`
      : `How should these ${repos.length} repos be grouped into brains (up to ${MAX_CEREBROS}), and what is each one called? Today they are all in "${nombre}".`,
    "Does any brain hold outdated information, or one you won't curate? Set `curado: false`: it is indexed without review and every answer warns about it.",
    ...repos.flatMap((r) => r.bases.filter(preguntable).map((b) => `${r.nombre} calls through ${b.base} (${b.llamadas} calls): which service does it point to? If it is in another brain, add a connection with \`por: ${b.base.replace(/^\$\{|\}$/g, "")}\`.`)),
    grupos.length > 1 ? "Communication is active between all brains. Set `activa: false` on the pairs that don't talk to each other." : "Between which brains should communication be active? Add a pair under `comunicacion` for each one.",
  ];
  const pares = grupos.flatMap((a, i) => grupos.slice(i + 1).map((b) => `  - { entre: [${a.nombre}, ${b.nombre}], activa: true }`));
  return [
    "# Brain registry. Written by `flowbrain brains propose`; review it and run `flowbrain brains apply`.",
    "# Paths are relative to this folder. Each brain lives in a subfolder named after it.",
    "version: 1",
    "cerebros:",
    ...grupos.flatMap((g) => [`  - nombre: ${g.nombre}`, "    curado: true", "    repos:", ...g.repos.map((r) => `      - ruta: ${y(rel(r.ruta))}`)]),
    "",
    "# Communication between brains: without an active pair, a brain knows nothing about the others.",
    ...(pares.length ? ["comunicacion:", ...pares] : ["# comunicacion:", "#   - entre: [uno, otro]", "#     activa: true"]),
    "",
    "# Declared connections: which service of one brain calls which service of another, and how to tell it apart in the code.",
    "# conexiones:",
    "#   - desde: uno/svc-web",
    "#     hacia: otro/svc-api",
    "#     por: API_URL          # base URL variable or host; optional",
    "",
    "# Questions the tool can't answer on its own. Delete them as you answer them.",
    "preguntas:",
    ...preguntas.map((p) => `  - ${y(p)}`),
    "",
    "# What was detected in each repo. Informational: `brains apply` doesn't use it.",
    "detectado:",
    ...repos.flatMap((r) => [
      `  - repo: ${y(rel(r.ruta))}`,
      `    lenguajes: [${r.lenguajes.join(", ")}]`,
      `    pila: [${r.pila.map(y).join(", ")}]`,
      `    endpoints: ${r.endpoints}`,
      `    pantallas: ${r.pantallas}`,
      `    tablas: ${r.tablas}`,
      ...(r.bases.length ? ["    llama_por:", ...r.bases.map((b) => `      - { base: ${y(b.base)}, llamadas: ${b.llamadas} }`)] : []),
    ]),
    "",
  ].join("\n");
}

/** `flowbrain brains propose <carpeta…>`: escribe el borrador del registro. No pisa un registro existente. */
export async function proponer(carpetaRegistro: string, carpetas: string[], comoRepo = false): Promise<{ archivo: string; repos: RepoDetectado[] }> {
  // `comoRepo`: cada carpeta es un repo tal cual, sin buscar adentro.
  const rutas = comoRepo ? carpetas.map((c) => resolve(c)) : [...new Set((await Promise.all(carpetas.map((c) => encontrarRepos(c)))).flat())].sort(cmp);
  const repos: RepoDetectado[] = [];
  for (const r of rutas) repos.push(await detectarRepo(r));
  const nombre = slug(basename(resolve(carpetas[0] ?? carpetaRegistro))) || "principal";
  const archivo = join(carpetaRegistro, (await esRegistro(carpetaRegistro)) ? "flowbrain.proposal.yaml" : ARCHIVO_REGISTRO);
  await writeFile(archivo, textoPropuesta(carpetaRegistro, nombre, repos), "utf8");
  return { archivo, repos };
}

/**
 * Registro nuevo para `flowbrain install`: todos los repos en un cerebro, o un cerebro por repo con la comunicación
 * activa entre todos. Devuelve los nombres de los cerebros.
 */
export async function crearRegistro(carpetaRegistro: string, proyecto: string, rutas: string[], dividir: boolean): Promise<{ archivo: string; repos: RepoDetectado[]; cerebros: string[] }> {
  const repos: RepoDetectado[] = [];
  for (const r of rutas) repos.push(await detectarRepo(r));
  const nombre = slug(basename(resolve(proyecto))) || "principal";
  const usados = new Set<string>();
  const unico = (base: string) => {
    let n = base || "repo";
    for (let i = 2; usados.has(n); i++) n = `${base}-${i}`;
    usados.add(n);
    return n;
  };
  const grupos = dividir ? repos.map((r) => ({ nombre: unico(slug(r.nombre)), repos: [r] })) : [{ nombre, repos }];
  const archivo = join(carpetaRegistro, ARCHIVO_REGISTRO);
  await writeFile(archivo, textoPropuesta(carpetaRegistro, nombre, repos, grupos), "utf8");
  return { archivo, repos, cerebros: grupos.map((g) => g.nombre) };
}

export interface ResultadoCerebro {
  nombre: string;
  raiz: string;
  curado: boolean;
  repos: Array<{ ruta: string; repo: string | null; error?: string }>;
  nodos: number;
  relaciones: number;
  /** Páginas que se crearon solas desde los borradores. */
  promovidas: number;
  /** Borradores que quedaron para revisar (funcionalidades de un cerebro curado, o los que no compilaron). */
  borradores: number;
  errores: string[];
  /** Cuánto tardó, en milisegundos. */
  ms: number;
}

/**
 * Promueve borradores nuevos sin intervención: las páginas técnicas siempre (salen del código), las de producto solo
 * en un cerebro sin curar. Si alguna no compila, la deja en borradores y reintenta con el resto.
 */
async function promoverSolos(raiz: string, curado: boolean): Promise<{ promovidas: number; errores: string[] }> {
  const errores: string[] = [];
  let promovidas = 0;
  const excluidos = new Set<string>();
  for (let intento = 0; intento < 6; intento++) {
    const ids = (await borradoresPromovibles(raiz)).filter((c) => c.estado === "nuevo" && !excluidos.has(c.destino) && (c.destino.startsWith("technology/") || !curado)).map((c) => c.origen);
    if (!ids.length) break;
    const r = await promover(raiz, { ids, escribir: true });
    promovidas += r.movidos.length;
    if (!r.errores.length) break;
    // Cada error empieza con el archivo de la página que no compila: esas vuelven a quedar como borrador.
    const malos = new Set(r.errores.map((e) => /^((?:technology|product)\/[^:]+\.md)/.exec(e)?.[1]).filter((x): x is string => !!x));
    if (!malos.size) {
      errores.push(...r.errores);
      break;
    }
    for (const m of malos) excluidos.add(m);
    errores.push(...r.errores.filter((e) => [...malos].some((m) => e.startsWith(m))));
  }
  return { promovidas, errores };
}

/** Crea e indexa un cerebro: borradores → páginas → índice de cada repo → segunda pasada → compilar. */
export async function aplicarCerebro(c: Cerebro, progreso?: Progreso): Promise<ResultadoCerebro> {
  const inicio = Date.now();
  const res: ResultadoCerebro = { nombre: c.nombre, raiz: c.raiz, curado: c.curado, repos: [], nodos: 0, relaciones: 0, promovidas: 0, borradores: 0, errores: [], ms: 0 };
  await init(c.raiz);
  const indexables: Array<{ ruta: string; repo: string }> = [];
  // Tres vueltas por repo: borradores y dos pasadas de índice.
  const vuelta = (repo: string, n: number, pasada: number) => avisar(progreso, { etapa: "repo", repo, n, de: c.repos.length, pasada, pasadas: 3 });
  for (const [i, r] of c.repos.entries()) {
    vuelta(r.id ?? basename(r.ruta), i + 1, 1);
    if (!(await existe(r.ruta))) {
      res.repos.push({ ruta: r.ruta, repo: null, error: L("the folder does not exist", "la carpeta no existe") });
      continue;
    }
    try {
      const d = await draftDir(r.ruta, c.raiz, { ...(r.id ? { repo: r.id } : {}), ...(progreso ? { progreso } : {}) });
      avisar(progreso, { etapa: "paginas" });
      const p = await promoverSolos(c.raiz, c.curado);
      res.promovidas += p.promovidas;
      res.errores.push(...p.errores);
      indexables.push({ ruta: r.ruta, repo: d.repo });
      res.repos.push({ ruta: r.ruta, repo: d.repo });
    } catch (e) {
      res.repos.push({ ruta: r.ruta, repo: null, error: (e as Error).message });
    }
  }
  // Dos pasadas: en la primera cada repo deja sus contratos; en la segunda las llamadas se unen a endpoints de
  // cualquier repo del cerebro, sin importar el orden en que se indexaron.
  for (let pasada = 0; pasada < 2; pasada++) {
    for (const [i, r] of indexables.entries()) {
      vuelta(r.repo, i + 1, pasada + 2);
      try {
        await escribirIndex(c.raiz, await indexar(r.ruta, c.raiz, { repo: r.repo, ...(progreso ? { progreso } : {}) }));
      } catch (e) {
        if (pasada === 1) res.repos.find((x) => x.ruta === r.ruta)!.error = (e as Error).message;
      }
    }
  }
  try {
    const { salidas } = await compileDirConVisor(c.raiz, progreso);
    res.nodos = salidas.graph.nodes.length;
    res.relaciones = salidas.graph.edges.length;
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    res.errores.push(e.message);
  }
  res.borradores = (await borradoresPromovibles(c.raiz)).filter((b) => b.estado !== "igual").length;
  res.ms = Date.now() - inicio;
  return res;
}

/**
 * `flowbrain brains apply [nombre]`. Un repo que falla queda anotado en su resultado y se sigue con los demás.
 * `alTerminar` recibe cada cerebro apenas termina (para mostrar su resumen sin esperar al resto).
 */
export async function aplicar(registro: Registro, solo?: string, opciones: { progreso?: Progreso; alTerminar?: (r: ResultadoCerebro) => void } = {}): Promise<ResultadoCerebro[]> {
  const out: ResultadoCerebro[] = [];
  const elegidos = registro.cerebros.filter((c) => !solo || c.nombre === solo);
  for (const [i, c] of elegidos.entries()) {
    avisar(opciones.progreso, { etapa: "cerebro", cerebro: c.nombre, n: i + 1, de: elegidos.length });
    const r = await aplicarCerebro(c, opciones.progreso);
    out.push(r);
    avisar(opciones.progreso, { etapa: "cerebro_listo", cerebro: c.nombre, n: i + 1, de: elegidos.length, ms: r.ms, fallidos: r.repos.filter((x) => x.error).length });
    opciones.alTerminar?.(r);
  }
  return out;
}

/** `flowbrain brains`: qué hay en el registro y en qué estado está cada cerebro. */
export async function listar(carpeta: string): Promise<string> {
  const r = await leerRegistro(carpeta);
  const lineas: string[] = [];
  for (const c of r.cerebros) {
    let grafo = L("not indexed (run flowbrain brains apply)", "sin indexar (corré flowbrain brains apply)");
    try {
      const g = JSON.parse(await readFile(join(c.raiz, "_build/graph.json"), "utf8")) as { nodes: unknown[]; edges: unknown[] };
      grafo = L(`${g.nodes.length} nodes, ${g.edges.length} relations`, `${g.nodes.length} nodos, ${g.edges.length} relaciones`);
    } catch {
      /* sin compilar */
    }
    const vecinos = r.vecinos(c.nombre).map((v) => v.nombre);
    lineas.push(`${c.nombre}${c.curado ? "" : L(" (not curated)", " (sin curar)")}: ${grafo}`, `  ${L("folder", "carpeta")}: ${c.raiz}`, ...c.repos.map((x) => `  repo: ${x.ruta}`), `  ${L("talks to", "comunicado con")}: ${vecinos.length ? vecinos.join(", ") : L("none", "ninguno")}`);
  }
  if (r.conexiones.length) lineas.push(L("declared connections:", "conexiones declaradas:"), ...r.conexiones.map((x) => `  ${x.desde.cerebro}/${x.desde.svc} → ${x.hacia.cerebro}/${x.hacia.svc}${x.por ? L(` (through ${x.por})`, ` (por ${x.por})`) : ""}`));
  return lineas.join("\n") + "\n";
}

export const ARCHIVO_VISOR = "flowbrain.html";

/**
 * Visor de todo el registro: un cerebro dibujado por cada cerebro compilado, y entre ellos las llamadas que cruzan
 * (solo entre los que tienen la comunicación activa). Devuelve la ruta escrita, o `null` si no hay nada compilado.
 */
export async function escribirVisor(registro: Registro, progreso?: Progreso): Promise<string | null> {
  avisar(progreso, { etapa: "visor", todos: true });
  const html = await htmlDelVisor(registro);
  if (html === null) return null;
  const archivo = join(registro.carpeta, ARCHIVO_VISOR);
  await writeFile(archivo, html, "utf8");
  return archivo;
}

/** La página del visor de todo el registro, sin escribirla (`null` si ningún cerebro está compilado). */
export async function htmlDelVisor(registro: Registro): Promise<string | null> {
  const visibles: CerebroVisor[] = [];
  const fuentes: FuenteTraza[] = [];
  const livianos = new Map<string, CerebroLiviano>();
  const conIndice: Array<{ visible: CerebroVisor; funcionalidades: Ficha[]; extracciones: string[]; archivos: string[]; contratos: Contrato[] }> = [];
  for (const c of registro.cerebros) {
    let graph: Graph;
    try {
      graph = JSON.parse(await readFile(join(c.raiz, "_build/graph.json"), "utf8")) as Graph;
    } catch {
      continue;
    }
    const funcionalidades = await readFile(join(c.raiz, "_build/features.json"), "utf8").then((t) => (JSON.parse(t) as { funcionalidades: Ficha[] }).funcionalidades, () => [] as Ficha[]);
    const dir = join(c.raiz, "_build/extraction");
    const extracciones = await Promise.all((await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort(cmp).map((n) => readFile(join(dir, n), "utf8")));
    const visible: CerebroVisor = { nombre: c.nombre, sinRevisar: !c.curado, graph, funcionalidades };
    visibles.push(visible);
    const dirA = join(c.raiz, "_build/files");
    const archivos = await Promise.all((await readdir(dirA).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort(cmp).map((n) => readFile(join(dirA, n), "utf8")));
    livianos.set(c.nombre, cerebroLiviano(c.nombre, graph, extracciones, archivos));
    fuentes.push({ nombre: c.nombre, graph, extracciones, archivos });
    const dirC = join(c.raiz, "_build/contracts");
    const contratos = await Promise.all((await readdir(dirC).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort(cmp).map(async (n) => JSON.parse(await readFile(join(dirC, n), "utf8")) as Contrato));
    if (archivos.length) conIndice.push({ visible, funcionalidades, extracciones, archivos, contratos });
  }
  if (!visibles.length) return null;
  const todos = crucesDelRegistro([...livianos.values()], registro.comunicados, registro.conexiones, registro.internas);
  const cruces: Cruce[] = todos.cruces;
  // Fidelidad de cada cerebro: una llamada que cruza a otro cerebro cuenta como unida; una que no llega a ninguno, como falta.
  const contextos = new Map(conIndice.map((x) => [x.visible.nombre, contextoDeFuentes(x.visible.graph, x.funcionalidades, x.archivos, x.extracciones, x.contratos)]));
  // Los campos de una llamada que atiende otro cerebro se comparan con el contrato del endpoint en ese cerebro.
  const contratoDe = (cerebro: string, endpoint: string) => (contextos.has(cerebro) ? contratoDeEndpoint(contextos.get(cerebro)!, endpoint) : null);
  for (const x of conIndice) {
    // Unida cuenta la que cruza a otro cerebro y la que el registro declara interna del propio servicio.
    const cruzadas = new Set([...cruces.filter((k) => k.desde.cerebro === x.visible.nombre).map((k) => k.desde.evidencia), ...todos.internas.filter((k) => k.cerebro === x.visible.nombre).map((k) => k.evidencia)]);
    const ctx = contextos.get(x.visible.nombre)!;
    x.visible.fidelidad = fidelidadDeArchivos(ctx, { cruzadas });
    x.visible.codigo = simbolosDelVisor(ctx);
    // Y su deriva, con la misma regla: lo que atiende o llama otro cerebro comunicado no es deriva.
    const vecinos = visibles.map((v) => v.nombre).filter((n) => n !== x.visible.nombre && registro.comunicados(x.visible.nombre, n));
    x.visible.deriva = deriva(ctx, { budget_tokens: null, ...(visibles.length > 1 ? { cruzadas: { ...derivaCruzadaDe(x.visible.nombre, todos, vecinos), contratoDe } } : {}) }) as unknown as NonNullable<CerebroVisor["deriva"]>;
  }
  const conexiones = resumenConexiones(cruces, registro.conexiones.filter((x) => registro.comunicados(x.desde.cerebro, x.hacia.cerebro)));
  return visorDeCerebros(visibles, cruces, conexiones, trazasCruzadas(fuentes, cruces), usosEntreCerebros([...livianos.values()]));
}

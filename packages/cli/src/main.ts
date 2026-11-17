import { compileDirConVisor } from "@brain/viewer";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  buscarNodo,
  ARCHIVO_REGISTRO,
  cargarContexto,
  esRegistro,
  leerRegistro,
  CompileError,
  ConsultaError,
  contratoDe,
  deriva,
  funcionalidad,
  impactoDe,
  infra,
  riesgo,
  quienLlama,
  recorrido,
  pantalla,
  paridad,
  formatError,
  recorrerGrafo,
  stringifyCanonical,
  trazar,
  contextoParaPrompt,
  evaluar,
  leerPreguntas,
  verifyDir,
  type Contexto,
  type Proyeccion,
} from "@brain/core";
import { crearMulti } from "@brain/mcp";
import { anotar, BUDGET_HOOK, DESTINOS, escribirReglas, generarReglas, hookSessionEnd, hookUserPromptSubmit, nombreRepo, repoDe, type Destino } from "@brain/hooks";
import { draftDir } from "@brain/indexer";
import { aplicar, listar, proponer } from "./cerebros.js";
import { doctor, estado, reposIndexados, sync, textoEstado } from "./estado.js";
import { init, VERSION } from "./init.js";
import { promover } from "./promover.js";
import { escribirIndex, indexar } from "@brain/parsers";

const AYUDA = `brain <comando> [opciones]

Comandos:
  init [dir] [--claude-code]                crea un brain en dir (por defecto el actual) y lo compila;
                                            con --claude-code registra los hooks en ~/.claude/settings.json
  compile                                   compila páginas y JSON → _build/, INDEX.md, backlinks
  index <ruta-repo> [--repo <repo-id>]      corre los parsers y escribe contratos, archivos y extracción en _build/
  draft <ruta-repo> [--repo <repo-id>]      borradores en _drafts/<repo>/ y funcionalidades en _drafts/producto/
                                            (no toca tecnologia/, producto/ ni _build/)
  cerebros                                  lista los cerebros del registro (cerebros.yaml en --raiz) y su estado
  cerebros proponer <carpeta...>            explora carpetas y escribe un borrador de cerebros.yaml con preguntas abiertas
  cerebros aplicar [nombre]                 crea e indexa los cerebros del registro (o uno solo)
  conexiones [--cerebro <nombre>]           qué llamadas viajan entre un cerebro y los que tiene comunicados
  sync [--repos <dir>] [--forzar]           reindexa los repos cuyo clon avanzó desde el último index y recompila
  estado [--repos <dir>] [--json]           repos al día o no, conteos del grafo y huecos conocidos;
                                            sale con 1 si algún repo quedó desactualizado
  doctor [--repos <dir>]                    diagnóstico: grafo, índice, clones, hooks y MCP registrados (solo lee)
  promover [id...] [--todos] [--escribir]   pasa borradores revisados de _drafts/ a tecnologia/ y producto/ y compila;
           [--pisar]                        sin --escribir solo lista; si el brain deja de compilar, deshace todo
  verify [--repos <dir>] [--clon id=ruta]   verifica evidencias contra los clones locales; marca dudosas
         [--dias n] [--hoy AAAA-MM-DD]      sale con 1 si aparecen dudosas nuevas (apto para CI)
  nota <nodo> <texto>                       agrega una nota a _drafts/notas/<nodo>.md
  gen claude|agents|cursor|windsurf         reglas para el agente (CLAUDE.md, AGENTS.md, .cursor/rules, .windsurf/rules)
      [--repo <dir|repo-id>] [--escribir]   imprime por stdout; con --escribir las deja en el repo
  buscar <texto> [--tipos a,b] [--limite n]
  recorrer <nodo> [--verbos a,b] [--direccion out|in|both] [--profundidad n]
  contrato <nodo> [--endpoint "MÉTODO /ruta"]
  trazar --desde <nodo|URL|ruta|archivo> [--hasta <nodo>]
  funcionalidad <id|nombre>                 ficha compacta: endpoints, consumo, datos, relaciones, dominio compartido
  recorrido <"MÉTODO /ruta"|Clase.metodo>   pasos controller → servicio → repositorio, con lo que toca cada uno
  pantalla </ruta|Componente>               pantalla del front de punta a punta: de dónde se llega, a dónde lleva, qué llama del back
  quien-llama <Clase.metodo|Clase> [--profundidad n]
  impacto <pieza>                           qué se ve afectado si cambia una tabla, endpoint, servicio, feat o símbolo
  riesgo [archivo...] [--diff <archivo|->]  alcance de un cambio: desde un diff (git diff | brain riesgo --diff -) o archivos
         [--repo <repo-id>]                 tocados, qué funcionalidades, endpoints, pantallas, tablas y repos alcanza
  paridad <svc-viejo> <svc-nuevo>           qué falta migrar de un servicio a otro: endpoints, pantallas y tablas
  deriva [svc]                              llamadas que ningún endpoint atiende y endpoints que nadie llama
  infra [nodo] [--texto <t>]                imágenes, compose, pipelines, variables de entorno y proxy, con su archivo
  evaluar [archivo] [--minimo pct]          corre preguntas con respuesta conocida (por defecto evals/preguntas.json)
                                            y da el porcentaje de aciertos; sale con 1 si queda debajo de --minimo
  context --prompt <texto> [--repo <dir>]   contexto para inyectar en un prompt (budget por defecto 1500)
  hook claude-code                          hooks UserPromptSubmit y SessionEnd: lee el JSON de Claude Code por stdin
  serve [--sync]                            servidor MCP por stdio; con --sync reindexa solo cuando un clon avanzó

Opciones comunes:
  --raiz <dir>          raíz del brain, o carpeta con cerebros.yaml (por defecto $BRAIN_ROOT o el directorio actual)
  --cerebro <nombre>    con varios cerebros, cuál usar (por defecto, el del repo donde estás parado)
  --proyeccion <p>      resumen | relaciones | contrato | completo
  --budget <n|none>     presupuesto de tokens (por defecto 2000)
`;

type Salida = { codigo: number; stdout: string; stderr: string };

const lista = (v: string | undefined) => (v === undefined ? undefined : v.split(",").map((s) => s.trim()).filter(Boolean));
const entero = (v: string | undefined, nombre: string) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ConsultaError("parametro_invalido", `${nombre} debe ser entero`);
  return n;
};

/** Ejecuta la CLI sin efectos sobre el proceso: devuelve código y salidas. Testeable. */
export async function ejecutar(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  stdin: () => Promise<string> = async () => "",
): Promise<Salida> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        raiz: { type: "string" },
        cerebro: { type: "string" },
        proyeccion: { type: "string" },
        budget: { type: "string" },
        tipos: { type: "string" },
        limite: { type: "string" },
        verbos: { type: "string" },
        direccion: { type: "string" },
        profundidad: { type: "string" },
        endpoint: { type: "string" },
        desde: { type: "string" },
        hasta: { type: "string" },
        prompt: { type: "string" },
        repo: { type: "string" },
        repos: { type: "string" },
        clon: { type: "string", multiple: true },
        dias: { type: "string" },
        hoy: { type: "string" },
        minimo: { type: "string" },
        texto: { type: "string" },
        diff: { type: "string" },
        escribir: { type: "boolean" },
        forzar: { type: "boolean" },
        todos: { type: "boolean" },
        pisar: { type: "boolean" },
        json: { type: "boolean" },
        "claude-code": { type: "boolean" },
        settings: { type: "string" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    return { codigo: 2, stdout: "", stderr: `${(e as Error).message}\n\n${AYUDA}` };
  }
  const { values: o, positionals } = parsed;
  const [comando, arg] = positionals;
  if (o.version) return { codigo: 0, stdout: `${VERSION}\n`, stderr: "" };
  if (o.help || !comando) return { codigo: comando || o.help ? 0 : 2, stdout: AYUDA, stderr: "" };
  let raiz = resolve(cwd, o.raiz ?? env.BRAIN_ROOT ?? ".");

  try {
    if (comando === "init") {
      const r = await init(resolve(cwd, arg ?? "."), { claudeCode: o["claude-code"] === true, ...(o.settings !== undefined ? { settings: resolve(cwd, o.settings) } : {}), env });
      const lineas = [
        `brain listo en ${r.raiz}`,
        ...r.creados.map((c) => `  ${c}`),
        "",
        "Servidor MCP (una línea, una sola vez):",
        `  ${r.mcp}`,
        "",
        r.hooks
          ? `Hooks de Claude Code ${r.hooks.cambio ? "registrados" : "ya estaban registrados"} en ${r.hooks.settings} (UserPromptSubmit y SessionEnd).`
          : "Hooks de Claude Code: repetí con --claude-code para registrarlos en ~/.claude/settings.json.",
        "",
        `Siguiente: ${r.comando} draft /ruta/a/un/repo --raiz ${r.raiz}`,
      ];
      return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "cerebros") {
      if (arg === "proponer") {
        const carpetas = positionals.slice(2).map((c) => resolve(cwd, c));
        if (!carpetas.length) throw new ConsultaError("parametro_invalido", "uso: brain cerebros proponer <carpeta...> --raiz <carpeta del registro>");
        const r = await proponer(raiz, carpetas);
        const lineas = [
          `propuesta en ${r.archivo}: ${r.repos.length} repos`,
          ...r.repos.map((x) => `  ${x.nombre}: ${[...x.pila, ...x.lenguajes].join(", ") || "sin código reconocido"}; ${x.endpoints} endpoints, ${x.pantallas} pantallas, ${x.tablas} tablas${x.bases.length ? `; llama por ${x.bases.map((b) => b.base).join(", ")}` : ""}`),
          "revisá el archivo (agrupá los repos en cerebros y respondé las preguntas) y corré: brain cerebros aplicar",
        ];
        return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (!(await esRegistro(raiz))) throw new ConsultaError("parametro_invalido", `no hay ${ARCHIVO_REGISTRO} en ${raiz}; creálo con: brain cerebros proponer <carpeta> --raiz ${raiz}`);
      if (arg === "aplicar") {
        const registro = await leerRegistro(raiz);
        const solo = positionals[2];
        if (solo && !registro.cerebro(solo)) throw new ConsultaError("nodo_inexistente", `no existe el cerebro: ${solo}`);
        const rs = await aplicar(registro, solo);
        const lineas = rs.flatMap((r) => [
          `${r.nombre}${r.curado ? "" : " (sin curar)"}: ${r.nodos} nodos, ${r.relaciones} relaciones; ${r.promovidas} páginas creadas, ${r.borradores} borradores para revisar`,
          ...r.repos.map((x) => `  ${x.repo ?? "(sin indexar)"} ← ${x.ruta}${x.error ? `: ${x.error}` : ""}`),
          ...r.errores.slice(0, 10).map((e) => `  no compiló y quedó como borrador: ${e}`),
          ...(r.errores.length > 10 ? [`  … y ${r.errores.length - 10} más`] : []),
        ]);
        return { codigo: rs.some((r) => r.repos.some((x) => x.error) || r.nodos === 0) ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (arg) throw new ConsultaError("parametro_invalido", `subcomando desconocido: cerebros ${arg}`);
      return { codigo: 0, stdout: await listar(raiz), stderr: "" };
    }

    // Con un registro de cerebros, el resto de los comandos trabaja sobre uno: el pedido, o el del repo actual.
    // El hook elige el suyo más abajo, por el directorio que le manda Claude Code, y nunca falla.
    const raizRegistro = (await esRegistro(raiz)) ? raiz : null;
    if (comando === "conexiones") {
      if (!raizRegistro) throw new ConsultaError("parametro_invalido", `conexiones necesita un registro: no hay ${ARCHIVO_REGISTRO} en ${raiz}`);
      return { codigo: 0, stdout: stringifyCanonical(await crearMulti(raizRegistro, { cwd }).conexiones(o.cerebro)), stderr: "" };
    }
    if (raizRegistro && comando !== "hook") {
      const registro = await leerRegistro(raiz);
      const c = o.cerebro ? registro.cerebro(o.cerebro) : (registro.deDirectorio(cwd) ?? (registro.cerebros.length === 1 ? registro.cerebros[0]! : null));
      if (!c) throw new ConsultaError("parametro_invalido", o.cerebro ? `no existe el cerebro: ${o.cerebro}` : `hay varios cerebros (${registro.cerebros.map((x) => x.nombre).join(", ")}); elegí uno con --cerebro`);
      raiz = c.raiz;
    } else if (o.cerebro) throw new ConsultaError("parametro_invalido", `--cerebro necesita un registro: no hay ${ARCHIVO_REGISTRO} en ${raiz}`);

    if (comando === "compile") {
      const { salidas, escritos } = await compileDirConVisor(raiz);
      const resumen = `compilado: ${salidas.graph.nodes.length} nodos, ${salidas.graph.edges.length} aristas; ${escritos.length} archivos escritos\n`;
      return { codigo: 0, stdout: resumen + escritos.map((e) => `  ${e}\n`).join(""), stderr: "" };
    }

    if (comando === "index") {
      if (!arg) throw new ConsultaError("parametro_invalido", "falta <ruta-repo>");
      const r = await indexar(resolve(cwd, arg), raiz, o.repo !== undefined ? { repo: o.repo } : {});
      const escritos = await escribirIndex(raiz, r);
      const nuevos = r.servicios.filter((s) => s.nuevo).map((s) => `${s.svc} (${s.paquete || "."})`);
      const lineas = [
        `indexado ${r.repo}: ${r.contratos.length} contratos, ${r.aristas.length} aristas, ${r.pendientes.length} pendientes; ${escritos.length} archivos escritos`,
        ...escritos.map((e) => `  ${e}`),
        ...(nuevos.length ? [`servicios sin página (los propone el indexador): ${nuevos.join(", ")}`] : []),
      ];
      return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "sync" || comando === "estado" || comando === "doctor") {
      const carpetas = (o.repos ?? env.BRAIN_REPOS ?? "").split(":").filter(Boolean).map((d) => resolve(cwd, d));
      if (comando === "sync") {
        const r = await sync(raiz, { carpetas, forzar: o.forzar === true });
        const lineas = [
          ...r.repos.map((x) => `${x.repo}: ${x.reindexado ? "reindexado" : x.estado === "sin clon" ? "sin clon (no se reindexó)" : "al día"}`),
          r.repos.length ? (r.compilados ? `compilado: ${r.compilados.length} archivos cambiaron` : "sin cambios: no hizo falta compilar") : "no hay repos indexados (corré brain index <ruta-repo>)",
        ];
        return { codigo: r.repos.some((x) => x.estado === "sin clon") ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
      }
      if (comando === "estado") {
        const e = await estado(raiz, carpetas);
        return { codigo: e.desactualizado ? 1 : 0, stdout: o.json ? stringifyCanonical(e) : textoEstado(e), stderr: "" };
      }
      const cs = await doctor(raiz, { carpetas, ...(o.settings !== undefined ? { settings: resolve(cwd, o.settings) } : {}) });
      return { codigo: cs.every((c) => c.ok) ? 0 : 1, stdout: cs.map((c) => `${c.ok ? "ok   " : "falta"} ${c.que}: ${c.detalle}`).join("\n") + "\n", stderr: "" };
    }

    if (comando === "promover") {
      const r = await promover(raiz, { ids: positionals.slice(1), todos: o.todos === true, escribir: o.escribir === true, pisar: o.pisar === true });
      const fila = (c: { origen: string; destino: string; estado: string }) => `  ${c.origen} → ${c.destino} (${c.estado})`;
      const lineas = o.escribir
        ? [
            ...(r.movidos.length ? [`promovidos ${r.movidos.length}:`, ...r.movidos.map(fila)] : []),
            ...(r.salteados.length ? ["sin mover:", ...r.salteados.map((c) => `${fila(c)}: ${c.motivo}`)] : []),
            ...(r.errores.length ? ["no se promovió nada; errores:", ...r.errores.map((e) => `  ${e}`)] : []),
            ...(!r.movidos.length && !r.salteados.length && !r.errores.length ? ["nada para promover (pasá ids o --todos)"] : []),
          ]
        : [
            ...(r.candidatos.length ? [`borradores (${r.candidatos.length}):`, ...r.candidatos.map(fila), "promové con: brain promover <id...> --escribir (o --todos --escribir)"] : ["no hay borradores en _drafts/"]),
            ...r.errores,
          ];
      return { codigo: r.errores.length ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "draft") {
      if (!arg) throw new ConsultaError("parametro_invalido", "falta <ruta-repo>");
      const r = await draftDir(resolve(cwd, arg), raiz, o.repo !== undefined ? { repo: o.repo } : {});
      const { paginas, relaciones, preguntas, tablas, externos, funcionalidades } = r.resumen;
      const lineas = [
        `borradores de ${r.repo}: ${paginas} páginas (${funcionalidades} funcionalidades, ${tablas} tablas y ${externos} externos propuestos), ${relaciones} relaciones nuevas, ${preguntas} preguntas abiertas; ${r.escritos.length} archivos escritos`,
        ...r.escritos.map((e) => `  ${e}`),
        `revisá _drafts/${r.repo}/ y _drafts/producto/ (o pasale PROMPT.md a un agente), movelos a tecnologia/ y producto/ y corré brain index + brain compile`,
      ];
      return { codigo: 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "verify") {
      const clones: Record<string, string> = {};
      for (const c of o.clon ?? []) {
        const i = c.indexOf("=");
        if (i <= 0) throw new ConsultaError("parametro_invalido", `--clon espera <repo-id>=<ruta>, llegó "${c}"`);
        clones[c.slice(0, i)] = resolve(cwd, c.slice(i + 1));
      }
      const carpetas = (o.repos ?? env.BRAIN_REPOS ?? "").split(":").filter(Boolean).map((d) => resolve(cwd, d));
      // Sin `--clon` para un repo, vale el clon que registró `brain index`.
      for (const r of await reposIndexados(raiz, carpetas)) if (r.clon && !clones[r.repo]) clones[r.repo] = r.clon;
      const hoy = o.hoy ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) throw new ConsultaError("parametro_invalido", "--hoy debe ser AAAA-MM-DD");
      const r = await verifyDir(raiz, { repos: clones, carpetas, hoy, dias: entero(o.dias, "--dias") ?? 90 });
      const ev = (d: { desde: string; verbo: string; hasta: string; evidencia: string; motivo: string }) => `  ${d.desde} ${d.verbo} ${d.hasta} — ${d.evidencia}: ${d.motivo}`;
      const lineas = [
        `verificadas ${r.verificadas} aristas: ${r.dudosas.length} dudosas (${r.nuevas.length} nuevas, ${r.recuperadas.length} recuperadas)`,
        ...(r.nuevas.length ? ["nuevas dudosas:", ...r.nuevas.map(ev)] : []),
        ...(r.recuperadas.length ? ["recuperadas:", ...r.recuperadas.map(ev)] : []),
        ...(r.noVerificables.length ? [`sin clon local (no verificadas): ${r.noVerificables.map((x) => `${x.repo} (${x.aristas})`).join(", ")}`] : []),
        ...(r.sinVerificar.length
          ? [
              `nodos sin verificar en ${entero(o.dias, "--dias") ?? 90} días (${r.sinVerificar.length}): ${r.sinVerificar
                .slice(0, 20)
                .map((n) => n.id)
                .join(", ")}${r.sinVerificar.length > 20 ? `, … (+${r.sinVerificar.length - 20} más)` : ""}`,
            ]
          : []),
      ];
      return { codigo: r.nuevas.length > 0 ? 1 : 0, stdout: lineas.join("\n") + "\n", stderr: "" };
    }

    if (comando === "gen") {
      if (!arg || !(DESTINOS as readonly string[]).includes(arg)) throw new ConsultaError("parametro_invalido", `destino inválido: ${arg ?? "(falta)"}; usá ${DESTINOS.join(" | ")}`);
      const ctx = await cargarContexto(raiz);
      const dir = resolve(cwd, o.repo !== undefined && !ctx.nodo.has(o.repo) ? o.repo : ".");
      const repo = repoDe(ctx, o.repo !== undefined && ctx.nodo.has(o.repo) ? o.repo : await nombreRepo(dir));
      const r = generarReglas(arg as Destino, ctx, repo);
      if (!o.escribir) return { codigo: 0, stdout: r.contenido, stderr: repo ? "" : "brain gen: el repo no está en el brain; se genera el bloque genérico\n" };
      const cambio = await escribirReglas(dir, r);
      return { codigo: 0, stdout: `${cambio ? "escrito" : "sin cambios"}: ${r.ruta}${repo ? ` (${repo.id})` : " (sin nodo de repo)"}\n`, stderr: "" };
    }

    if (comando === "nota") {
      const texto = positionals.slice(2).join(" ").trim();
      if (!arg || !texto) throw new ConsultaError("parametro_invalido", "uso: brain nota <nodo> <texto>");
      const escritos = await anotar(raiz, [{ id: arg, texto }], "manual");
      return { codigo: 0, stdout: escritos.length ? `nota agregada: ${escritos.join(", ")}\n` : "la nota ya existía\n", stderr: "" };
    }

    if (comando === "hook") {
      if (arg !== "claude-code") return { codigo: 2, stdout: "", stderr: `hook desconocido: ${arg ?? ""}\n` };
      try {
        const entrada = JSON.parse((await stdin()) || "{}") as { prompt?: string; cwd?: string; hook_event_name?: string; session_id?: string; transcript_path?: string };
        if (raizRegistro) {
          // Solo el cerebro del repo donde se está trabajando; fuera de todo repo conocido, nada.
          const c = entrada.cwd ? (await leerRegistro(raizRegistro)).deDirectorio(entrada.cwd) : null;
          if (!c) return { codigo: 0, stdout: "", stderr: "" };
          raiz = c.raiz;
        }
        if (entrada.hook_event_name === "SessionEnd") {
          const escritos = await hookSessionEnd(entrada, raiz);
          return { codigo: 0, stdout: "", stderr: escritos.length ? `brain: notas guardadas en ${escritos.join(", ")}\n` : "" };
        }
        const budget = o.budget === undefined ? BUDGET_HOOK : (entero(o.budget, "--budget") ?? BUDGET_HOOK);
        return { codigo: 0, stdout: await hookUserPromptSubmit(entrada, () => cargarContexto(raiz), budget), stderr: "" };
      } catch (e) {
        // Un hook roto nunca debe bloquear el prompt del usuario.
        return { codigo: 0, stdout: "", stderr: `brain hook: ${(e as Error).message}\n` };
      }
    }

    const budget = o.budget === undefined ? undefined : o.budget === "none" ? null : entero(o.budget, "--budget");
    const comunes = {
      ...(o.proyeccion !== undefined ? { proyeccion: o.proyeccion as Proyeccion } : {}),
      ...(budget !== undefined ? { budget_tokens: budget } : {}),
    };
    const ctx: Contexto = await cargarContexto(raiz);
    let resultado: unknown;
    switch (comando) {
      case "buscar":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <texto>");
        resultado = buscarNodo(ctx, { texto: arg, ...opt("tipos", lista(o.tipos)), ...opt("limite", entero(o.limite, "--limite")), ...comunes });
        break;
      case "recorrer":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <nodo>");
        resultado = recorrerGrafo(ctx, {
          nodo: arg,
          ...opt("verbos", lista(o.verbos)),
          ...opt("direccion", o.direccion as "out" | "in" | "both" | undefined),
          ...opt("profundidad", entero(o.profundidad, "--profundidad")),
          ...comunes,
        });
        break;
      case "contrato":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <nodo>");
        resultado = contratoDe(ctx, { nodo: arg, ...opt("endpoint", o.endpoint), ...comunes });
        break;
      case "trazar": {
        const desde = o.desde ?? arg;
        if (!desde) throw new ConsultaError("parametro_invalido", "falta --desde");
        resultado = trazar(ctx, { desde, ...opt("hasta", o.hasta), ...comunes });
        break;
      }
      case "funcionalidad":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <id>");
        resultado = funcionalidad(ctx, { id: arg, ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "recorrido":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <endpoint o símbolo>");
        resultado = recorrido(ctx, { desde: arg, ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "pantalla":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta </ruta>");
        resultado = pantalla(ctx, { ruta: arg, ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "quien-llama":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <símbolo>");
        resultado = quienLlama(ctx, { simbolo: arg, ...opt("profundidad", entero(o.profundidad, "--profundidad")), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "impacto":
        if (!arg) throw new ConsultaError("parametro_invalido", "falta <pieza>");
        resultado = impactoDe(ctx, { pieza: arg, ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "riesgo": {
        const diff = o.diff === undefined ? undefined : o.diff === "-" ? await stdin() : await readFile(resolve(cwd, o.diff), "utf8");
        const archivos = positionals.slice(1);
        resultado = riesgo(ctx, { ...opt("diff", diff), ...(archivos.length ? { archivos } : {}), ...opt("repo", o.repo), ...opt("profundidad", entero(o.profundidad, "--profundidad")), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      }
      case "paridad":
        if (!arg || !positionals[2]) throw new ConsultaError("parametro_invalido", "uso: brain paridad <svc-viejo> <svc-nuevo>");
        resultado = paridad(ctx, { viejo: arg, nuevo: positionals[2], ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "deriva":
        resultado = deriva(ctx, { ...opt("nodo", arg), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "infra":
        resultado = infra(ctx, { ...opt("nodo", arg), ...opt("texto", o.texto), ...opt("budget_tokens", comunes.budget_tokens) });
        break;
      case "evaluar": {
        const archivo = resolve(raiz, arg ?? "evals/preguntas.json");
        const r = evaluar(ctx, leerPreguntas(await readFile(archivo, "utf8")));
        const minimo = o.minimo === undefined ? null : Number(o.minimo);
        if (minimo !== null && Number.isNaN(minimo)) throw new ConsultaError("parametro_invalido", "--minimo debe ser un número");
        return { codigo: minimo !== null && r.porcentaje < minimo ? 1 : 0, stdout: stringifyCanonical(r), stderr: `${r.aciertos}/${r.total} correctas (${r.porcentaje}%), cobertura de lo esperado ${r.cobertura}%${r.sinPreguntas.length ? `; sin preguntas: ${r.sinPreguntas.join(", ")}` : ""}\n` };
      }
      case "context": {
        if (!o.prompt) throw new ConsultaError("parametro_invalido", "falta --prompt");
        const repoDir = o.repo !== undefined ? await nombreRepo(resolve(cwd, o.repo)) : null;
        const r = contextoParaPrompt(ctx, {
          prompt: o.prompt,
          repoDir,
          budget_tokens: typeof budget === "number" ? budget : BUDGET_HOOK,
        });
        return { codigo: 0, stdout: r.texto, stderr: "" };
      }
      default:
        return { codigo: 2, stdout: "", stderr: `comando desconocido: ${comando}\n\n${AYUDA}` };
    }
    return { codigo: 0, stdout: stringifyCanonical(resultado), stderr: "" };
  } catch (e) {
    if (e instanceof CompileError) return { codigo: 1, stdout: "", stderr: e.errores.map(formatError).join("\n") + "\n" };
    if (e instanceof ConsultaError) {
      return { codigo: 2, stdout: stringifyCanonical({ error: { codigo: e.codigo, mensaje: e.message } }), stderr: "" };
    }
    throw e;
  }
}

/** Omite la clave si el valor es undefined (exactOptionalPropertyTypes). */
function opt<K extends string, V>(k: K, v: V | undefined): { [P in K]?: V } {
  return (v === undefined ? {} : { [k]: v }) as { [P in K]?: V };
}

async function leerStdin(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const p of process.stdin) partes.push(p as Buffer);
  return Buffer.concat(partes).toString("utf8");
}

// npx y `npm i -g` invocan el bin a través de un symlink: se compara contra la ruta real.
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const esMain = process.argv[1] !== undefined && real(fileURLToPath(import.meta.url)) === real(process.argv[1]);
if (esMain && process.argv[2] === "serve") {
  const { servir } = await import("@brain/mcp");
  await servir(process.argv.slice(3), process.env, (raiz) => sync(raiz, { carpetas: (process.env.BRAIN_REPOS ?? "").split(":").filter(Boolean) }));
} else if (esMain) {
  const r = await ejecutar(process.argv.slice(2), process.env, process.cwd(), leerStdin);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.codigo;
}

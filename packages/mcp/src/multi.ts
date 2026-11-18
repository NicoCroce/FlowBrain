import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ARCHIVO_REGISTRO,
  cerebroLiviano,
  cmp,
  ConsultaError,
  crucesDelRegistro,
  impactoCruzado,
  impactoDe,
  leerRegistro,
  pistas,
  resumenConexiones,
  type CerebroLiviano,
  type Contexto,
  type Cruce,
  type Graph,
  type Registro,
} from "@flowbrain/core";
import { cargadorConCache, type CerebroResuelto, type Multi } from "./server.js";

const mtime = (p: string) => stat(p).then((s) => s.mtimeMs, () => 0);

/**
 * Varios cerebros detrás de un servidor. El contexto completo se carga solo del cerebro consultado; de los vecinos
 * (los que tienen la comunicación activa con él) se lee una versión liviana, para pistas y cruces. El registro se
 * relee cuando cambia: prender o apagar la comunicación no requiere reiniciar el servidor ni reindexar.
 */
export function crearMulti(carpeta: string, opciones: { cwd?: string; sincronizar?: (raiz: string) => Promise<unknown> } = {}): Multi & { conexiones(cerebro?: string): Promise<unknown>; registro(): Promise<Registro> } {
  let reg: { m: number; r: Registro } | null = null;
  const registro = async () => {
    const m = await mtime(join(carpeta, ARCHIVO_REGISTRO));
    if (!reg || reg.m !== m) reg = { m, r: await leerRegistro(carpeta) };
    return reg.r;
  };
  const cargadores = new Map<string, () => Promise<Contexto>>();
  const cargador = (raiz: string) => {
    if (!cargadores.has(raiz)) cargadores.set(raiz, cargadorConCache(raiz, opciones.sincronizar ? () => opciones.sincronizar!(raiz) : undefined));
    return cargadores.get(raiz)!;
  };
  const livianos = new Map<string, { m: number; c: CerebroLiviano }>();
  const liviano = async (nombre: string, raiz: string): Promise<CerebroLiviano | null> => {
    const m = await mtime(join(raiz, "_build/graph.json"));
    if (!m) return null;
    const previo = livianos.get(raiz);
    if (previo && previo.m === m && previo.c.nombre === nombre) return previo.c;
    const graph = JSON.parse(await readFile(join(raiz, "_build/graph.json"), "utf8")) as Graph;
    const dir = join(raiz, "_build/extraction");
    const extracciones = await Promise.all((await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort(cmp).map((n) => readFile(join(dir, n), "utf8")));
    const dirA = join(raiz, "_build/files");
    const archivos = await Promise.all((await readdir(dirA).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort(cmp).map((n) => readFile(join(dirA, n), "utf8")));
    const c = cerebroLiviano(nombre, graph, extracciones, archivos);
    livianos.set(raiz, { m, c });
    return c;
  };
  const elegir = async (nombre?: string) => {
    const r = await registro();
    const c = nombre ? r.cerebro(nombre) : (r.deDirectorio(opciones.cwd ?? process.cwd()) ?? r.cerebros[0]!);
    if (!c) throw new ConsultaError("nodo_inexistente", `no existe el cerebro: ${nombre}; hay ${r.cerebros.map((x) => x.nombre).join(", ")}`);
    return { r, c };
  };
  /** El cerebro y sus vecinos en versión liviana; los vecinos sin compilar se saltean. */
  const vecindario = async (r: Registro, nombre: string, raiz: string) => {
    const propio = await liviano(nombre, raiz);
    const vecinos: CerebroLiviano[] = [];
    for (const v of r.vecinos(nombre)) {
      const l = await liviano(v.nombre, v.raiz);
      if (l) vecinos.push(l);
    }
    return { propio, vecinos };
  };

  /** Todos los cruces del registro, con los cerebros que estén compilados. Una llamada se cruza contra todos los vecinos de su cerebro a la vez. */
  const crucesDe = async (r: Registro) => {
    const ls: CerebroLiviano[] = [];
    for (const x of r.cerebros) {
      const l = await liviano(x.nombre, x.raiz);
      if (l) ls.push(l);
    }
    return crucesDelRegistro(ls, r.comunicados, r.conexiones);
  };

  return {
    registro,
    descripcion: [
      "Este servidor tiene varios cerebros, cada uno con sus repos. Por defecto se consulta el del repo donde estás; pasá `cerebro` para consultar otro. Cada respuesta dice de qué `cerebro` salió.",
      "Si la respuesta trae `otrosCerebros`, hay algo con el mismo nombre en otro cerebro: decíselo al usuario en una línea (qué cerebro y qué encontraste) y consultalo solo si la tarea lo necesita o si te lo pide.",
      "`llamadoDesdeOtrosCerebros` son llamadas HTTP reales desde otro cerebro a un endpoint de la respuesta: contalas como afectadas por un cambio; si traen `pantallas`, son las pantallas del otro cerebro que dependen de ese endpoint. `sinRevisar: true` marca un cerebro indexado sin revisión humana: decilo al citar sus datos.",
      "En `impacto`, `enOtrosCerebros` sigue el cambio a los cerebros que llaman a los endpoints alcanzados: sus funcionalidades y pantallas también quedan afectadas. `servicios` son llamadas que no salen de una pantalla (un job, otro back): para ver hasta dónde llega, consultá `impacto` en ese cerebro sobre ese servicio.",
      "`conexiones` resume qué servicios de un cerebro llaman a servicios de otro.",
    ].join("\n"),
    async resolver(nombre?: string): Promise<CerebroResuelto> {
      const { r, c } = await elegir(nombre);
      const ctx = await cargador(c.raiz)();
      return {
        ctx,
        nombre: c.nombre,
        sinRevisar: !c.curado,
        async anotar(herramienta, args, resultado) {
          const { propio, vecinos } = await vecindario(r, c.nombre, c.raiz);
          if (!propio || !vecinos.length) return {};
          const extra: Record<string, unknown> = {};
          const ps = pistas(args, vecinos);
          if (ps.length) extra["otrosCerebros"] = ps;
          // El impacto sigue en los cerebros que llaman a los endpoints alcanzados: sus pantallas y funcionalidades.
          const pieza = (resultado as { pieza?: unknown } | null)?.pieza;
          if (herramienta === "impacto" && typeof pieza === "string") {
            const completo = impactoDe(ctx, { pieza, budget_tokens: null }) as { pieza: string; tipo: string; tecnicas: Array<{ id: string; tipo: string }> };
            const eps = [...(completo.tipo === "endpoint" ? [completo.pieza] : []), ...completo.tecnicas.filter((t) => t.tipo === "endpoint").map((t) => t.id)];
            const cruzado = eps.length ? impactoCruzado(c.nombre, eps, (await crucesDe(r)).cruces, vecinos) : [];
            if (cruzado.length) {
              extra["enOtrosCerebros"] = cruzado.map((x) => ({
                cerebro: x.cerebro,
                funcionalidades: x.funcionalidades.slice(0, 30),
                pantallas: { total: x.pantallas.length, primeras: x.pantallas.slice(0, 10).map((p) => ({ id: p.id, endpoints: p.endpoints.slice(0, 2), ...(p.endpoints.length > 2 ? { masEndpoints: p.endpoints.length - 2 } : {}), ev: p.ev })) },
                ...(x.servicios.length ? { servicios: { total: x.servicios.length, primeros: x.servicios.slice(0, 3) } } : {}),
                ...(x.funcionalidades.length > 30 ? { masFuncionalidades: x.funcionalidades.length - 30 } : {}),
              }));
            }
            return extra;
          }
          // Llamadas desde otros cerebros a endpoints que aparecen en esta respuesta.
          const texto = JSON.stringify(resultado);
          const entrantes: Cruce[] = (await crucesDe(r)).cruces.filter((x) => x.hacia.cerebro === c.nombre && texto.includes(JSON.stringify(x.hacia.endpoint)));
          if (entrantes.length) {
            extra["llamadoDesdeOtrosCerebros"] = { total: entrantes.length, llamadas: entrantes.slice(0, 10).map((x) => ({ endpoint: x.hacia.endpoint, cerebro: x.desde.cerebro, desde: x.desde.svc, ev: x.desde.evidencia, ...(x.desde.pantallas.length ? { pantallas: x.desde.pantallas.slice(0, 3) } : {}) })) };
          }
          return extra;
        },
      };
    },
    async conexiones(nombre?: string) {
      const { r, c } = await elegir(nombre);
      const { propio, vecinos } = await vecindario(r, c.nombre, c.raiz);
      if (!propio) throw new ConsultaError("parametro_invalido", `el cerebro ${c.nombre} no está compilado: corré flowbrain brains apply`);
      const mios = (x: { desde: { cerebro: string }; hacia: { cerebro: string } }) => x.desde.cerebro === c.nombre || x.hacia.cerebro === c.nombre;
      const global = await crucesDe(r);
      const todos = global.cruces.filter(mios);
      // Disputadas que tocan a este cerebro: las que salen de él y las que lo tienen entre sus destinos posibles.
      const disputadas = global.entreCerebros.filter((d) => d.cerebro === c.nombre || d.candidatos.some((k) => k.startsWith(`${c.nombre}/`)));
      const ambiguas = crucesDelRegistro([propio, ...vecinos], (a, b) => (a === c.nombre || b === c.nombre) && r.comunicados(a, b), r.conexiones).ambiguas;
      const resumen = resumenConexiones(todos, r.conexiones.filter(mios).filter((x) => r.comunicados(x.desde.cerebro, x.hacia.cerebro)));
      const apagados = r.cerebros.filter((x) => x.nombre !== c.nombre && !r.comunicados(c.nombre, x.nombre)).map((x) => x.nombre);
      return {
        cerebro: c.nombre,
        comunicadoCon: vecinos.map((v) => v.nombre),
        conexiones: resumen,
        avisos: [
          ...resumen.filter((x) => x.declarada && x.llamadas === 0).map((x) => `conexión declarada sin llamadas que la respalden: ${x.desde} → ${x.hacia}`),
          ...resumen.filter((x) => !x.declarada).map((x) => `llamadas detectadas sin conexión declarada: ${x.desde} → ${x.hacia} (${x.llamadas})`),
          ...(ambiguas ? [`${ambiguas} llamadas coinciden con varios endpoints de un mismo cerebro: no se unen a ninguno`] : []),
          ...(disputadas.length ? [`${disputadas.length} llamadas coinciden con endpoints de más de un cerebro y no se unieron a ninguno: falta declarar a qué servicio va cada base de URL (flowbrain evidence las lista)`] : []),
          ...(apagados.length ? [`comunicación desactivada con: ${apagados.join(", ")}`] : []),
        ],
      };
    },
  };
}

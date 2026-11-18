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
  riesgo,
  usosEntreCerebros,
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
  const crucesDe = async (r: Registro) => (await todoDe(r)).cruces;
  const todoDe = async (r: Registro) => {
    const ls: CerebroLiviano[] = [];
    for (const x of r.cerebros) {
      const l = await liviano(x.nombre, x.raiz);
      if (l) ls.push(l);
    }
    return { cruces: crucesDelRegistro(ls, r.comunicados, r.conexiones), livianos: ls };
  };

  /**
   * Lo que une al cerebro `nombre` con otros por paquetes: los componentes suyos que dibujan otros cerebros (de los
   * nodos en `ids`) y los componentes de otros cerebros que dibujan sus pantallas (las de `ids`). Un import nombra el
   * paquete sin dudas, así que no depende de la comunicación entre cerebros.
   */
  const porPaquetes = async (r: Registro, nombre: string, ids: (id: string) => boolean) => {
    const { livianos } = await todoDe(r);
    const u = usosEntreCerebros(livianos);
    const out: Record<string, unknown> = {};
    const entran = u.componentes.filter((x) => x.hacia.cerebro === nombre && ids(x.hacia.componente));
    if (entran.length) {
      const por = new Map<string, { pantallas: Set<string>; servicios: Set<string>; componentes: Set<string>; funcionalidades: Map<string, string> }>();
      for (const x of entran) {
        const b = por.get(x.desde.cerebro) ?? por.set(x.desde.cerebro, { pantallas: new Set(), servicios: new Set(), componentes: new Set(), funcionalidades: new Map() }).get(x.desde.cerebro)!;
        b.componentes.add(x.hacia.componente);
        if (!x.desde.pantallas.length) b.servicios.add(x.desde.svc);
        const fd = livianos.find((l) => l.nombre === x.desde.cerebro)?.funcionalidadesDe ?? {};
        for (const p of x.desde.pantallas) {
          b.pantallas.add(p);
          for (const f of fd[p] ?? []) b.funcionalidades.set(f.id, f.nombre);
        }
      }
      out["usadoEnOtrosCerebros"] = [...por.entries()].sort(([a], [b]) => cmp(a, b)).map(([cerebro, b]) => ({
        cerebro,
        componentes: [...b.componentes].sort(cmp).slice(0, 20),
        funcionalidades: [...b.funcionalidades.entries()].sort(([a], [b2]) => cmp(a, b2)).slice(0, 30).map(([id, n]) => ({ id, nombre: n })),
        pantallas: { total: b.pantallas.size, primeras: [...b.pantallas].sort(cmp).slice(0, 15) },
        ...(b.servicios.size ? { servicios: [...b.servicios].sort(cmp) } : {}),
      }));
    }
    const dependen = u.dependencias.filter((x) => x.hacia.cerebro === nombre && ids(x.hacia.nodo));
    if (dependen.length) out["dependenDesdeOtrosCerebros"] = dependen.slice(0, 20).map((x) => ({ cerebro: x.desde.cerebro, desde: x.desde.svc, paquete: x.hacia.paquete, ev: x.desde.evidencia }));
    const salen = u.componentes.filter((x) => x.desde.cerebro === nombre && x.desde.pantallas.some(ids));
    if (salen.length) {
      const por = new Map<string, { cerebro: string; componente: string; ev: string; pantallas: Set<string> }>();
      for (const x of salen) {
        const k = `${x.hacia.cerebro}/${x.hacia.componente}`;
        const v = por.get(k) ?? por.set(k, { cerebro: x.hacia.cerebro, componente: x.hacia.componente, ev: x.desde.evidencia, pantallas: new Set() }).get(k)!;
        for (const p of x.desde.pantallas) if (ids(p)) v.pantallas.add(p);
      }
      const lista = [...por.values()].sort((a, b) => cmp(a.cerebro + a.componente, b.cerebro + b.componente));
      out["usaDeOtrosCerebros"] = { total: lista.length, componentes: lista.slice(0, 40).map((v) => ({ cerebro: v.cerebro, componente: v.componente, ev: v.ev, pantallas: [...v.pantallas].sort(cmp).slice(0, 3) })) };
    }
    return out;
  };

  /**
   * El impacto de unos endpoints de `cerebro`, siguiendo a quien los llama de cerebro en cerebro. Una llamada desde una
   * pantalla deja afectadas la pantalla y sus funcionalidades; una llamada desde otro back (sin pantalla) deja afectado
   * lo que, en ese cerebro, llega a la línea que llama (sus endpoints, pantallas y funcionalidades), y desde esos
   * endpoints sigue el salto siguiente. Hasta `SALTOS` saltos, sin repetir un endpoint.
   */
  const SALTOS = 4;
  const impactoEnCadena = async (r: Registro, cerebro: string, endpoints: string[]) => {
    const { cruces, livianos } = await todoDe(r);
    const out: Array<Record<string, unknown>> = [];
    const vistos = new Set(endpoints.map((e) => `${cerebro}/${e}`));
    let frente: Array<{ cerebro: string; endpoints: string[]; via: string | null }> = [{ cerebro, endpoints, via: null }];
    for (let salto = 1; salto <= SALTOS && frente.length; salto++) {
      const siguiente: typeof frente = [];
      for (const f of frente) {
        for (const x of impactoCruzado(f.cerebro, f.endpoints, cruces.cruces, livianos.filter((l) => l.nombre !== f.cerebro))) {
          // Lo que alcanza, en su cerebro, cada llamada que no sale de una pantalla: quién llega a esa línea.
          const alcance = { endpoints: new Set<string>(), funcionalidades: new Set<string>(), pantallas: new Set<string>() };
          const reg = r.cerebros.find((y) => y.nombre === x.cerebro);
          if (reg && x.servicios.length) {
            const ctxX = await cargador(reg.raiz)();
            for (const sv of x.servicios) {
              const m = /^(repo-[a-z0-9-]+):([^#]+)#L(\d+)/.exec(sv.ev);
              if (!m) continue;
              try {
                const rr = riesgo(ctxX, { diff: `--- a/${m[2]}\n+++ b/${m[2]}\n@@ -${m[3]} +${m[3]} @@\n`, repo: m[1]!, budget_tokens: null }) as { endpoints?: string[]; funcionalidades?: string[]; pantallas?: string[] };
                for (const e of rr.endpoints ?? []) alcance.endpoints.add(e);
                for (const e of rr.funcionalidades ?? []) alcance.funcionalidades.add(e);
                for (const e of rr.pantallas ?? []) alcance.pantallas.add(e);
              } catch {
                /* la línea ya no está en el índice: queda solo el servicio */
              }
            }
          }
          const nuevos = [...alcance.endpoints].filter((e) => !vistos.has(`${x.cerebro}/${e}`));
          for (const e of nuevos) vistos.add(`${x.cerebro}/${e}`);
          if (nuevos.length) siguiente.push({ cerebro: x.cerebro, endpoints: nuevos, via: f.cerebro });
          out.push({
            salto,
            cerebro: x.cerebro,
            ...(f.via ? { porQue: `llama a endpoints de ${f.cerebro} alcanzados desde ${f.via}` } : {}),
            funcionalidades: x.funcionalidades.slice(0, 30),
            ...(x.funcionalidades.length > 30 ? { masFuncionalidades: x.funcionalidades.length - 30 } : {}),
            pantallas: { total: x.pantallas.length, primeras: x.pantallas.slice(0, 10).map((p) => ({ id: p.id, endpoints: p.endpoints.slice(0, 2), ...(p.endpoints.length > 2 ? { masEndpoints: p.endpoints.length - 2 } : {}), ev: p.ev })) },
            ...(x.servicios.length ? { servicios: { total: x.servicios.length, primeros: x.servicios.slice(0, 3) } } : {}),
            ...(alcance.endpoints.size || alcance.funcionalidades.size
              ? { alcanceDeLosServicios: { endpoints: [...alcance.endpoints].sort(cmp).slice(0, 20), funcionalidades: [...alcance.funcionalidades].sort(cmp).slice(0, 20), pantallas: [...alcance.pantallas].sort(cmp).slice(0, 10) } }
              : {}),
          });
        }
      }
      frente = siguiente;
    }
    return out;
  };

  return {
    registro,
    descripcion: [
      "Este servidor tiene varios cerebros, cada uno con sus repos. Por defecto se consulta el del repo donde estás; pasá `cerebro` para consultar otro. Cada respuesta dice de qué `cerebro` salió.",
      "Si la respuesta trae `otrosCerebros`, hay algo con el mismo nombre en otro cerebro: decíselo al usuario en una línea (qué cerebro y qué encontraste) y consultalo solo si la tarea lo necesita o si te lo pide.",
      "`llamadoDesdeOtrosCerebros` son llamadas HTTP reales desde otro cerebro a un endpoint de la respuesta: contalas como afectadas por un cambio; si traen `pantallas`, son las pantallas del otro cerebro que dependen de ese endpoint. `sinRevisar: true` marca un cerebro indexado sin revisión humana: decilo al citar sus datos.",
      "En `impacto`, `enOtrosCerebros` sigue el cambio a los cerebros que llaman a los endpoints alcanzados: sus funcionalidades y pantallas también quedan afectadas. `servicios` son llamadas que no salen de una pantalla (un job, otro back); `alcanceDeLosServicios` es lo que, en ese cerebro, llega a esas llamadas, y desde ahí el impacto sigue al salto siguiente (`salto` 2, 3…).",
      "`llamaAOtrosCerebros` son los endpoints de otro cerebro que llaman las pantallas de la respuesta: la otra mitad de la pantalla o de la funcionalidad; para ver qué ejecutan, `recorrido` con ese endpoint y `cerebro`.",
      "`conexiones` resume qué servicios de un cerebro llaman a servicios de otro.",
      "`usadoEnOtrosCerebros` son componentes de este cerebro (un sistema de diseño, una librería) que dibujan pantallas de otro cerebro: un cambio en ellos las afecta, y con ellas a sus funcionalidades. `usaDeOtrosCerebros` son los componentes de otro cerebro que dibujan las pantallas de la respuesta. `dependenDesdeOtrosCerebros`: repos de otro cerebro que declaran en su manifiesto depender de un paquete de este. Salen de los imports y los manifiestos, sin depender de la comunicación entre cerebros.",
    ].join("\n"),
    async resolver(nombre?: string): Promise<CerebroResuelto> {
      const { r, c } = await elegir(nombre);
      const ctx = await cargador(c.raiz)();
      return {
        ctx,
        nombre: c.nombre,
        sinRevisar: !c.curado,
        async anotar(herramienta, args, resultado) {
          const texto = JSON.stringify(resultado);
          // Por paquetes (un sistema de diseño en otro cerebro): no depende de la comunicación.
          const pieza0 = (resultado as { pieza?: unknown } | null)?.pieza;
          const enRespuesta =
            herramienta === "impacto" && typeof pieza0 === "string"
              ? (id: string) => id === pieza0 || id.startsWith(`${pieza0}:componente:`) || texto.includes(JSON.stringify(id))
              : (id: string) => texto.includes(JSON.stringify(id));
          const paquetes = r.cerebros.length > 1 ? await porPaquetes(r, c.nombre, enRespuesta) : {};
          const { propio, vecinos } = await vecindario(r, c.nombre, c.raiz);
          if (!propio || !vecinos.length) return paquetes;
          const extra: Record<string, unknown> = { ...paquetes };
          const ps = pistas(args, vecinos);
          if (ps.length) extra["otrosCerebros"] = ps;
          // El impacto sigue en los cerebros que llaman a los endpoints alcanzados: sus pantallas y funcionalidades.
          const pieza = (resultado as { pieza?: unknown } | null)?.pieza;
          if (herramienta === "impacto" && typeof pieza === "string") {
            const completo = impactoDe(ctx, { pieza, budget_tokens: null }) as { pieza: string; tipo: string; tecnicas: Array<{ id: string; tipo: string }> };
            const eps = [...(completo.tipo === "endpoint" ? [completo.pieza] : []), ...completo.tecnicas.filter((t) => t.tipo === "endpoint").map((t) => t.id)];
            const cruzado = eps.length ? await impactoEnCadena(r, c.nombre, eps) : [];
            if (cruzado.length) extra["enOtrosCerebros"] = cruzado;
            return extra;
          }
          // Llamadas desde otros cerebros a endpoints que aparecen en esta respuesta.
          const todos = (await crucesDe(r)).cruces;
          const entrantes: Cruce[] = todos.filter((x) => x.hacia.cerebro === c.nombre && texto.includes(JSON.stringify(x.hacia.endpoint)));
          // Y la otra mitad: lo que las pantallas de la respuesta (una pantalla, las de una funcionalidad) llaman en otro cerebro.
          const salientes = todos.filter((x) => x.desde.cerebro === c.nombre && x.desde.pantallas.some((p) => texto.includes(JSON.stringify(p))));
          if (salientes.length) {
            const porEndpoint = new Map<string, { cerebro: string; endpoint: string; ev: string; pantallas: Set<string> }>();
            for (const x of salientes) {
              const k = `${x.hacia.cerebro}/${x.hacia.endpoint}`;
              const v = porEndpoint.get(k) ?? porEndpoint.set(k, { cerebro: x.hacia.cerebro, endpoint: x.hacia.endpoint, ev: x.desde.evidencia, pantallas: new Set() }).get(k)!;
              for (const p of x.desde.pantallas) if (texto.includes(JSON.stringify(p))) v.pantallas.add(p);
            }
            const lista = [...porEndpoint.values()].sort((a, b) => cmp(a.cerebro + a.endpoint, b.cerebro + b.endpoint));
            extra["llamaAOtrosCerebros"] = { total: lista.length, llamadas: lista.slice(0, 30).map((v) => ({ cerebro: v.cerebro, endpoint: v.endpoint, ev: v.ev, pantallas: [...v.pantallas].sort(cmp).slice(0, 3) })) };
          }
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
      // Por paquetes: componentes que una pantalla toma de una librería de otro cerebro y dependencias declaradas.
      const u = usosEntreCerebros((await todoDe(r)).livianos);
      const pares = new Map<string, { desde: string; hacia: string; paquetes: Set<string>; componentes: Set<string>; pantallas: Set<string>; ejemplo: string }>();
      const par = (desde: string, hacia: string, ev: string) => pares.get(`${desde}\u0000${hacia}`) ?? pares.set(`${desde}\u0000${hacia}`, { desde, hacia, paquetes: new Set(), componentes: new Set(), pantallas: new Set(), ejemplo: ev }).get(`${desde}\u0000${hacia}`)!;
      for (const x of u.dependencias) if (mios(x)) par(`${x.desde.cerebro}/${x.desde.svc}`, `${x.hacia.cerebro}/${x.hacia.nodo}`, x.desde.evidencia).paquetes.add(x.hacia.paquete);
      for (const x of u.componentes) {
        if (!mios(x)) continue;
        const dueño = x.hacia.componente.slice(0, x.hacia.componente.indexOf(":componente:"));
        const v = par(`${x.desde.cerebro}/${x.desde.svc}`, `${x.hacia.cerebro}/${dueño}`, x.desde.evidencia);
        v.componentes.add(x.hacia.componente);
        x.desde.pantallas.forEach((p) => v.pantallas.add(p));
      }
      const porPaquete = [...pares.values()].sort((a, b) => cmp(a.desde + a.hacia, b.desde + b.hacia)).map((v) => ({ desde: v.desde, hacia: v.hacia, paquetes: [...v.paquetes].sort(cmp), componentes: v.componentes.size, pantallas: v.pantallas.size, ejemplo: v.ejemplo }));
      return {
        cerebro: c.nombre,
        comunicadoCon: vecinos.map((v) => v.nombre),
        conexiones: resumen,
        ...(porPaquete.length ? { porPaquetes: porPaquete } : {}),
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

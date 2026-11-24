import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { ConsultaError, TEST_REF, type Registro } from "@flowbrain/core";
import { compileDirConVisor } from "@flowbrain/viewer";
import type { Edicion } from "./edicion.js";
import { GUIA_ESPECIFICACIONES, GUIA_TESTS } from "./guia.js";
import { claudeCode, HERRAMIENTAS_PERMITIDAS, HERRAMIENTAS_PROHIBIDAS, pasosDeEvento, PROVEEDORES, type AdaptadorDeAgente, type ModeloDeAgente } from "./proveedores.js";

export { HERRAMIENTAS_PERMITIDAS, HERRAMIENTAS_PROHIBIDAS, pasosDeEvento };

/**
 * El agente que atiende los pedidos del visor (`flowbrain viewer --serve`): en vez de copiar el pedido y pegarlo en
 * un agente, la página se lo manda al servidor y este corre el agente elegido (hoy Claude Code, sin conversación) en la
 * carpeta del proyecto, con la guía que corresponde y permisos acotados (`proveedores.ts`). La página ve el avance,
 * puede cancelar y, al terminar, qué archivos cambió en cada repo (sin commitear: los revisa una persona).
 *
 * Hay dos formas de pedir:
 * - un pedido suelto (`encolar`): va de a uno, en cola;
 * - un lote de reglas a testear (`encolarLote`): se reparte por repo, los repos corren en paralelo y cada uno va en
 *   tandas de 10 a 15 reglas, una detrás de otra. Una tanda que falla no frena a las demás. Cada tanda responde, regla
 *   por regla, uno de cuatro resultados y el servidor lo anota en las páginas (las tandas no editan páginas: dos repos
 *   en paralelo no se pisan).
 */

export type TipoDePedido = "test" | "agrupar" | "escribir" | "corregir";
export const TIPOS_DE_PEDIDO: readonly TipoDePedido[] = ["test", "agrupar", "escribir", "corregir"];

/** Cómo termina cada regla de un pedido de tests: a y b la verifican; c y d son hallazgos que no se resuelven con un test. */
export type ResultadoDeTest = "a" | "b" | "c" | "d";

export interface ResultadoDeRegla {
  cerebro: string;
  /** Id local de la funcionalidad (`feat-mvp`). */
  funcionalidad: string;
  regla: string;
  resultado: ResultadoDeTest;
  /** a y b: los tests que la verifican (`repo-x:ruta::caso`). */
  tests?: string[];
  /** c: qué hace hoy el código (`archivo#Ln`). */
  hoy?: string;
  /** c: qué habría que cambiar, en palabras. d: el ajuste mínimo para poder testearla. */
  cambio?: string;
  /** c: el test que lo demuestra (va solo en el informe; no queda en el repo). */
  test?: string;
}

export interface ReglaDePedido {
  cerebro: string;
  funcionalidad: string;
  regla: string;
  /** Repo que la cumple (`repo-web`); sin él, el primero del cerebro. */
  repo: string | null;
  /** La regla como se la lee el agente: cerebro, funcionalidad, caso, id, tipo, texto y archivo. */
  linea: string;
}

export interface Trabajo {
  id: string;
  tipo: TipoDePedido;
  /** Qué se pidió, corto: "2 tests de Recuperar la contraseña". */
  etiqueta: string;
  pedido: string;
  /** Cerebros que toca: se recompilan al terminar. */
  cerebros: string[];
  estado: "en_cola" | "corriendo" | "terminado" | "fallo" | "cancelado";
  creado: number;
  empezado?: number;
  terminado?: number;
  /** Lo que va haciendo, en llano: "Lee src/x.ts", "Corre: npx vitest …". Los últimos. */
  pasos: string[];
  /** Lo que respondió al final. */
  resultado?: string;
  error?: string;
  costoUsd?: number;
  /** Archivos que cambiaron en cada repo durante el trabajo (según `git status`). */
  cambios: Array<{ repo: string; archivos: string[] }>;
  proveedor?: string;
  modelo?: string;
  /** Si es una tanda de un lote: de cuál, de qué repo, cuál es de cuántas. */
  lote?: string;
  repo?: string;
  tanda?: { n: number; de: number };
  /** Las reglas que se le pidieron (tanda de un lote). */
  reglas?: Array<{ cerebro: string; funcionalidad: string; regla: string }>;
  /** Lo que resolvió de cada regla, ya anotado en las páginas. */
  resultados?: ResultadoDeRegla[];
  /** Reglas pedidas de las que no volvió un resultado válido: quedan en la lista para reintentar. */
  sinResultado?: Array<{ cerebro: string; funcionalidad: string; regla: string; motivo: string }>;
}

export interface Lote {
  id: string;
  creado: number;
  cerebros: string[];
  /** `reindexando`: las tandas terminaron y se actualiza el índice para que los tests nuevos cuenten. */
  estado: "corriendo" | "reindexando" | "terminado";
  error?: string;
}

export interface ProveedorVisible {
  id: string;
  nombre: string;
  version: string;
  modelos: ModeloDeAgente[];
}

const MAX_PASOS = 60;
const MAX_TRABAJOS = 400;
const TANDA_MAX = 15;

/** Cuántas reglas lleva cada tanda: lo más parejo posible y nunca más de 15. */
export function tamanioDeTanda(n: number): number {
  return Math.ceil(n / Math.max(1, Math.ceil(n / TANDA_MAX)));
}

/** El texto que recibe el agente: la guía del tipo de pedido, con el pedido en lugar de `$ARGUMENTS`. */
export function indicacionesDelPedido(tipo: TipoDePedido, pedido: string): string {
  const guia = (tipo === "test" ? GUIA_TESTS : GUIA_ESPECIFICACIONES).replace(/^---\n[\s\S]*?\n---\n/, "");
  return guia.replace("$ARGUMENTS", `Lo que pide la persona, desde el visor de FlowBrain:\n\n${pedido.trim()}\n`);
}

/** El pedido de una tanda: las reglas y cómo tiene que responder (el servidor anota; el agente no toca las páginas). */
export function pedidoDeTanda(reglas: ReglaDePedido[], repo: string, n: number, de: number): string {
  return [
    `Resolvé ${reglas.length === 1 ? "esta regla" : `estas ${reglas.length} reglas`} de FlowBrain (repo ${repo}${de > 1 ? `, tanda ${n} de ${de}` : ""}), siguiendo la guía.`,
    "Es un pedido del visor: NO edites las páginas de las funcionalidades ni compiles; el servidor anota los tests y los hallazgos a partir de lo que respondas. NUNCA cambies el código del producto, ni dejes un test que falla en el repo.",
    "Cada regla termina en uno de los cuatro resultados (a, b, c, d) de la guía. Al final respondé con el bloque `flowbrain-resultados` de la guía, con una entrada por regla (cerebro, funcionalidad y regla tal cual figuran abajo).",
    "",
    ...reglas.map((r) => r.linea),
  ].join("\n");
}

/** Lo que el agente respondió: la lista del último bloque ```flowbrain-resultados, ya validada. */
export function extraerResultados(texto: string): { resultados: ResultadoDeRegla[]; errores: string[] } {
  const bloques = [...texto.matchAll(/```flowbrain-resultados\s*\n([\s\S]*?)```/g)];
  const ultimo = bloques[bloques.length - 1];
  if (!ultimo) return { resultados: [], errores: ["la respuesta no trae el bloque flowbrain-resultados"] };
  let lista: unknown;
  try {
    lista = JSON.parse(ultimo[1]!);
  } catch (e) {
    return { resultados: [], errores: [`el bloque flowbrain-resultados no es JSON válido: ${(e as Error).message}`] };
  }
  if (!Array.isArray(lista)) return { resultados: [], errores: ["el bloque flowbrain-resultados tiene que ser una lista"] };
  const texto1 = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const resultados: ResultadoDeRegla[] = [];
  const errores: string[] = [];
  for (const x of lista as Array<Record<string, unknown>>) {
    const cerebro = texto1(x?.["cerebro"], 200), funcionalidad = texto1(x?.["funcionalidad"], 200), regla = texto1(x?.["regla"], 200);
    const r = typeof x?.["resultado"] === "string" ? x["resultado"].trim().toLowerCase() : "";
    if (!cerebro || !funcionalidad || !regla || !["a", "b", "c", "d"].includes(r)) {
      errores.push(`entrada inválida: ${JSON.stringify(x).slice(0, 120)}`);
      continue;
    }
    const id = `${cerebro}/${funcionalidad}/${regla}`;
    const tests = Array.isArray(x["tests"]) ? (x["tests"] as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.trim()) : [];
    const cambio = texto1(x["cambio"], 1200) ?? texto1(x["ajuste"], 1200);
    if ((r === "a" || r === "b") && (!tests.length || tests.some((t) => !TEST_REF.test(t)))) {
      errores.push(`${id}: el resultado ${r} necesita los tests como repo-x:ruta::nombre del caso`);
      continue;
    }
    if ((r === "c" || r === "d") && !cambio) {
      errores.push(`${id}: el resultado ${r} necesita decir qué habría que cambiar`);
      continue;
    }
    resultados.push({ cerebro, funcionalidad, regla, resultado: r as ResultadoDeTest, ...(tests.length ? { tests } : {}), ...(texto1(x["hoy"], 1200) ? { hoy: texto1(x["hoy"], 1200)! } : {}), ...(cambio ? { cambio } : {}), ...(texto1(x["test"], 4000) ? { test: texto1(x["test"], 4000)! } : {}) });
  }
  return { resultados, errores };
}

export interface Agente {
  /** `null` si se puede usar (hay al menos un proveedor instalado); si no, por qué. */
  noDisponible(): string | null;
  /** Los proveedores instalados en la máquina, con sus modelos. */
  proveedores(): ProveedorVisible[];
  encolar(p: { tipo: TipoDePedido; pedido: string; etiqueta: string; cerebros: string[]; proveedor?: string; modelo?: string }): Trabajo;
  /** Reparte las reglas por repo (en paralelo) y cada repo en tandas. */
  encolarLote(p: { reglas: ReglaDePedido[]; proveedor?: string; modelo?: string }): { lote: Lote; trabajos: Trabajo[] };
  lista(): Trabajo[];
  lotes(): Lote[];
  cancelar(id: string): Trabajo | null;
  cancelarLote(id: string): Trabajo[] | null;
}

/** Archivos con cambios sin commitear de un repo, o `null` si no es un repo de git. */
function estadoGit(repo: string): Set<string> | null {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf8", timeout: 20_000 });
  if (r.status !== 0) return null;
  return new Set(r.stdout.split("\n").filter(Boolean).map((l) => l.slice(3)));
}

export interface OpcionesDeAgente {
  /** Ejecutable de Claude Code (atajo para probar con otro): arma el único proveedor. */
  comando?: string;
  proveedores?: AdaptadorDeAgente[];
  /** Escribe en las páginas de un cerebro (la misma cola de ediciones del servidor). */
  aplicar?: (ed: Edicion) => Promise<unknown>;
  /** Actualiza el índice de un cerebro: así los tests nuevos entran y cuentan como verificados. */
  reindexar?: (cerebro: string) => Promise<void>;
}

/** `registro()` se lee cada vez: si el registro cambia, vale lo que hay en disco. */
export function crearAgente(registro: () => Promise<Registro>, opciones: OpcionesDeAgente = {}): Agente {
  const adaptadores = opciones.proveedores ?? (opciones.comando ? [claudeCode(opciones.comando)] : PROVEEDORES.map((f) => f()));
  const instalados = () => adaptadores.filter((a) => a.detectar().instalado);
  const noDisponible = () => {
    if (instalados().length) return null;
    return adaptadores.map((a) => a.detectar().motivo).filter(Boolean)[0] ?? "no hay ningún agente instalado en esta máquina: instalá Claude Code, o copiá el pedido y pegáselo a tu agente";
  };
  const elegir = (proveedor?: string, modelo?: string) => {
    const a = proveedor ? adaptadores.find((x) => x.id === proveedor) : instalados()[0];
    if (!a) throw new ConsultaError("parametro_invalido", proveedor ? `no existe el proveedor ${proveedor}` : "no hay ningún agente instalado");
    const det = a.detectar();
    if (!det.instalado) throw new ConsultaError("parametro_invalido", det.motivo ?? `${a.nombre} no está instalado`);
    const modelos = a.modelos();
    if (modelo && !modelos.some((m) => m.id === modelo)) throw new ConsultaError("parametro_invalido", `${a.nombre} no ofrece el modelo ${modelo}`);
    return { a, modelo: modelo ?? modelos.find((m) => m.porDefecto)?.id };
  };

  const trabajos: Trabajo[] = [];
  const lotes: Lote[] = [];
  const procesos = new Map<string, ChildProcess>();
  const adaptadorDe = new Map<string, AdaptadorDeAgente>();
  let corriendo = false;

  const vivo = (t: Trabajo) => t.estado === "en_cola" || t.estado === "corriendo";
  function podar() {
    // Los viejos que ya terminaron se olvidan; los que siguen vivos, no.
    while (trabajos.length > MAX_TRABAJOS) {
      const i = trabajos.findIndex((x) => !vivo(x));
      if (i < 0) break;
      trabajos.splice(i, 1);
    }
  }
  const nuevo = (p: Omit<Trabajo, "id" | "estado" | "creado" | "pasos" | "cambios">): Trabajo => ({ id: randomBytes(6).toString("hex"), estado: "en_cola", creado: Date.now(), pasos: [], cambios: [], ...p });

  function siguiente() {
    if (corriendo) return;
    const t = trabajos.find((x) => x.estado === "en_cola" && !x.lote);
    if (!t) return;
    corriendo = true;
    void correr(t, {}).finally(() => {
      corriendo = false;
      siguiente();
    });
  }

  /** Corre el agente de un trabajo. `soloRepo`: la ruta del repo cuyos cambios se cuentan (una tanda de un lote). */
  async function lanzar(t: Trabajo, soloRepo?: string) {
    const a = adaptadorDe.get(t.id)!;
    t.estado = "corriendo";
    t.empezado = Date.now();
    const reg = await registro();
    const cwd = dirname(reg.carpeta);
    const todos = [...new Set(reg.cerebros.flatMap((c) => c.repos.map((r) => r.ruta)))];
    const repos = soloRepo ? [soloRepo] : todos;
    const antes = new Map(repos.map((r) => [r, estadoGit(r)]));
    const afuera = todos.filter((r) => !resolve(r).startsWith(cwd + sep));
    const { comando, args } = a.armar({ prompt: indicacionesDelPedido(t.tipo, t.pedido), ...(t.modelo ? { modelo: t.modelo } : {}), cwd, carpetasExtra: afuera });
    await new Promise<void>((listo) => {
      const p = spawn(comando, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FLOWBRAIN_ROOT: reg.carpeta } });
      procesos.set(t.id, p);
      let resto = "", errores = "";
      const paso = (s: string) => {
        t.pasos.push(s);
        if (t.pasos.length > MAX_PASOS) t.pasos.splice(0, t.pasos.length - MAX_PASOS);
      };
      p.stdout!.setEncoding("utf8");
      p.stdout!.on("data", (d: string) => {
        resto += d;
        const lineas = resto.split("\n");
        resto = lineas.pop() ?? "";
        for (const l of lineas) {
          if (!l.trim()) continue;
          const ev = a.leerLinea(l, cwd);
          if (!ev) continue;
          ev.pasos.forEach(paso);
          if (ev.resultado !== undefined) t.resultado = ev.resultado;
          if (ev.costoUsd !== undefined) t.costoUsd = ev.costoUsd;
          if (ev.error !== undefined) t.error = ev.error;
        }
      });
      p.stderr!.setEncoding("utf8");
      p.stderr!.on("data", (d: string) => {
        errores = (errores + d).slice(-2000);
      });
      p.on("error", (e) => {
        t.error = `no se pudo lanzar ${a.nombre}: ${e.message}`;
        listo();
      });
      p.on("close", (codigo) => {
        procesos.delete(t.id);
        if (t.estado === "cancelado") return listo();
        if (codigo !== 0 && !t.error) t.error = errores.trim().split("\n").slice(-3).join(" ") || `${a.nombre} terminó con código ${codigo}`;
        listo();
      });
    });
    for (const r of repos) {
      const antesR = antes.get(r), despues = estadoGit(r);
      if (!antesR || !despues) continue;
      const nuevos = [...despues].filter((x) => !antesR.has(x)).sort();
      if (nuevos.length) t.cambios.push({ repo: relative(cwd, r) || r, archivos: nuevos });
    }
    return reg;
  }

  /** Un pedido suelto: al terminar, recompila los cerebros que toca. */
  async function correr(t: Trabajo, _: object) {
    const reg = await lanzar(t);
    for (const nombre of t.cerebros) {
      const c = reg.cerebro(nombre);
      if (!c) continue;
      try {
        await compileDirConVisor(c.raiz);
      } catch (e) {
        t.error = `${t.error ? `${t.error}. ` : ""}No compila ${nombre}: ${(e as Error).message.split("\n")[0]}`;
      }
    }
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error ? "fallo" : "terminado";
  }

  /** Una tanda: corre el agente y anota lo que respondió regla por regla. */
  async function correrTanda(t: Trabajo, repoRuta: string | undefined) {
    try {
      await lanzar(t, repoRuta);
      if (t.estado !== "cancelado" && !t.error && t.resultado !== undefined) await anotarTanda(t);
      else if (t.estado !== "cancelado" && !t.error) t.error = "el agente terminó sin responder";
    } catch (e) {
      t.error = `${t.error ? `${t.error}. ` : ""}${(e as Error).message}`;
    }
    t.terminado = Date.now();
    if ((t.estado as Trabajo["estado"]) !== "cancelado") t.estado = t.error && !t.resultados?.length ? "fallo" : "terminado";
  }

  async function anotarTanda(t: Trabajo) {
    const pedidas = new Set((t.reglas ?? []).map((r) => `${r.cerebro}|${r.funcionalidad}|${r.regla}`));
    const { resultados, errores } = extraerResultados(t.resultado ?? "");
    const buenos: ResultadoDeRegla[] = [];
    const vistos = new Set<string>();
    for (const r of resultados) {
      const k = `${r.cerebro}|${r.funcionalidad}|${r.regla}`;
      if (!pedidas.has(k)) errores.push(`${r.cerebro}/${r.funcionalidad}/${r.regla}: no estaba entre las pedidas`);
      else if (vistos.has(k)) errores.push(`${r.cerebro}/${r.funcionalidad}/${r.regla}: repetida`);
      else {
        vistos.add(k);
        buenos.push(r);
      }
    }
    t.resultados = [];
    t.sinResultado = [];
    // Una edición por funcionalidad: una escritura y una compilación, no una por regla.
    const grupos = new Map<string, ResultadoDeRegla[]>();
    for (const r of buenos) grupos.set(`${r.cerebro}|${r.funcionalidad}`, [...(grupos.get(`${r.cerebro}|${r.funcionalidad}`) ?? []), r]);
    for (const [k, rs] of grupos) {
      const [cerebro, funcionalidad] = k.split("|") as [string, string];
      const items = rs.map((r) => ({
        id: r.regla,
        ...(r.resultado === "a" || r.resultado === "b" ? { tests: r.tests ?? [] } : {}),
        ...(r.resultado === "c" ? { hallazgo: { resultado: "codigo_no_cumple" as const, ...(r.hoy ? { hoy: r.hoy } : {}), cambio: r.cambio!, ...(r.test ? { test: r.test } : {}) } } : {}),
        ...(r.resultado === "d" ? { hallazgo: { resultado: "no_testeable" as const, cambio: r.cambio! } } : {}),
      }));
      try {
        if (!opciones.aplicar) throw new Error("el servidor no puede escribir las páginas");
        await opciones.aplicar({ tipo: "resultados", cerebro, funcionalidad, items });
        t.resultados.push(...rs);
      } catch (e) {
        for (const r of rs) t.sinResultado.push({ cerebro: r.cerebro, funcionalidad: r.funcionalidad, regla: r.regla, motivo: `no se pudo anotar: ${(e as Error).message}` });
      }
    }
    for (const r of t.reglas ?? []) {
      if (!vistos.has(`${r.cerebro}|${r.funcionalidad}|${r.regla}`)) t.sinResultado.push({ ...r, motivo: "el agente no devolvió un resultado válido para esta regla" });
    }
    if (errores.length && !t.resultados.length) t.error = errores[0] ?? "respuesta inválida";
  }

  async function terminarLote(l: Lote) {
    l.estado = "reindexando";
    for (const c of l.cerebros) {
      try {
        if (opciones.reindexar) await opciones.reindexar(c);
        else {
          const cer = (await registro()).cerebro(c);
          if (cer) await compileDirConVisor(cer.raiz);
        }
      } catch (e) {
        l.error = `${l.error ? `${l.error}. ` : ""}No se pudo actualizar ${c}: ${(e as Error).message.split("\n")[0]}`;
      }
    }
    l.estado = "terminado";
  }

  return {
    noDisponible,
    proveedores: () => instalados().map((a) => ({ id: a.id, nombre: a.nombre, version: a.detectar().version ?? "", modelos: a.modelos() })),
    encolar(p) {
      const no = noDisponible();
      if (no) throw new Error(no);
      const { a, modelo } = elegir(p.proveedor, p.modelo);
      const t = nuevo({ tipo: p.tipo, etiqueta: p.etiqueta, pedido: p.pedido, cerebros: p.cerebros, proveedor: a.id, ...(modelo ? { modelo } : {}) });
      adaptadorDe.set(t.id, a);
      trabajos.push(t);
      podar();
      siguiente();
      return t;
    },
    encolarLote(p) {
      const no = noDisponible();
      if (no) throw new Error(no);
      if (!p.reglas.length) throw new ConsultaError("parametro_invalido", "no hay reglas para pedir");
      const { a, modelo } = elegir(p.proveedor, p.modelo);
      const cerebros = [...new Set(p.reglas.map((r) => r.cerebro))];
      const lote: Lote = { id: randomBytes(6).toString("hex"), creado: Date.now(), cerebros, estado: "corriendo" };
      lotes.push(lote);
      const porRepo = new Map<string, ReglaDePedido[]>();
      for (const r of p.reglas) porRepo.set(r.repo ?? `cerebro ${r.cerebro}`, [...(porRepo.get(r.repo ?? `cerebro ${r.cerebro}`) ?? []), r]);
      const hechos: Trabajo[] = [];
      const cadenas: Array<{ repo: string; ts: Trabajo[] }> = [];
      for (const [repo, reglas] of porRepo) {
        const tam = tamanioDeTanda(reglas.length);
        const de = Math.ceil(reglas.length / tam);
        const ts: Trabajo[] = [];
        for (let n = 1; n <= de; n++) {
          const parte = reglas.slice((n - 1) * tam, n * tam);
          const t = nuevo({
            tipo: "test", etiqueta: `${repo}${de > 1 ? ` · tanda ${n} de ${de}` : ""} · ${parte.length} ${parte.length === 1 ? "regla" : "reglas"}`,
            pedido: pedidoDeTanda(parte, repo, n, de), cerebros: [...new Set(parte.map((r) => r.cerebro))], proveedor: a.id, ...(modelo ? { modelo } : {}),
            lote: lote.id, repo, tanda: { n, de }, reglas: parte.map((r) => ({ cerebro: r.cerebro, funcionalidad: r.funcionalidad, regla: r.regla })),
          });
          adaptadorDe.set(t.id, a);
          trabajos.push(t);
          ts.push(t);
          hechos.push(t);
        }
        cadenas.push({ repo, ts });
      }
      podar();
      // Los repos corren en paralelo; dentro de cada uno, una tanda después de otra (dos agentes en el mismo repo se pisarían).
      void (async () => {
        const reg = await registro();
        await Promise.all(cadenas.map(async ({ repo, ts }) => {
          const ruta = reg.cerebros.flatMap((c) => c.repos).find((r) => r.id === repo)?.ruta;
          for (const t of ts) {
            if (t.estado === "cancelado") continue;
            await correrTanda(t, ruta);
          }
        }));
        await terminarLote(lote);
      })();
      return { lote, trabajos: hechos };
    },
    lista: () => trabajos.slice().reverse(),
    lotes: () => lotes.slice().reverse(),
    cancelar(id) {
      const t = trabajos.find((x) => x.id === id);
      if (!t || !vivo(t)) return t ?? null;
      const p = procesos.get(id);
      t.estado = "cancelado";
      t.terminado = Date.now();
      if (p) p.kill("SIGTERM");
      return t;
    },
    cancelarLote(id) {
      if (!lotes.some((l) => l.id === id)) return null;
      const ts = trabajos.filter((t) => t.lote === id);
      for (const t of ts) if (vivo(t)) this.cancelar(t.id);
      return ts;
    },
  };
}

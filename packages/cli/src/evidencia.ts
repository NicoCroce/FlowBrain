import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { cerebroLiviano, cmp, crucesDelRegistro, endpointsQueAtienden, type CerebroLiviano, type Graph, type Registro } from "@flowbrain/core";
import { leerRepo } from "@flowbrain/parsers";

/**
 * Evidencia de comunicación real entre servicios, para que un modelo (o una persona) decida a qué servicio va cada
 * llamada. Método y ruta no alcanzan: dos APIs pueden exponer las mismas rutas. Lo que sí distingue un destino es la
 * base de la URL (una variable o un host), así que el informe agrupa las llamadas por base y junta, para cada una,
 * dónde se define y con qué endpoints de qué cerebros coincide.
 *
 * No decide nada ni escribe en el registro. Tampoco abre archivos `.env` reales: solo los de ejemplo.
 */

export interface EvidenciaBase {
  /** `cerebro/svc` que hace las llamadas. */
  desde: string;
  /** Base de la URL tal como está en el código: `${VARIABLE}`, una expresión o un host. */
  base: string;
  llamadas: number;
  ejemplos: Array<{ llamada: string; evidencia: string }>;
  /** Con qué servicios de otros cerebros coinciden esas llamadas por método y ruta, sin mirar la comunicación ni las conexiones. */
  coincide: Array<{ destino: string; llamadas: number; soloAhi: number }>;
  /** Llamadas que no coinciden con ningún endpoint de ningún cerebro. */
  sinDestino: number;
  /** Dónde se define cada identificador de la base, en el código y en archivos de configuración o de ejemplo. */
  definiciones: Array<{ nombre: string; archivo: string; texto: string | null }>;
  /** Conexiones ya declaradas en el registro que aplican a esta base. */
  declaradas: Array<{ hacia: string; por: string | null; origen: string }>;
}

export interface Evidencia {
  registro: string;
  cerebros: Array<{ nombre: string; repos: string[]; comunicadoCon: string[]; servicios: Array<{ id: string; endpoints: number; prefijos: Array<{ prefijo: string; endpoints: number }> }> }>;
  bases: EvidenciaBase[];
  /** Con la comunicación y las conexiones de hoy: cuántas llamadas no se unieron por coincidir en más de un cerebro, por base. */
  disputadas: Array<{ desde: string; base: string; llamadas: number; entre: string[] }>;
  avisos: string[];
}

const MAX_BYTES = 400_000;
const TEXTO = /\.(?:[cm]?[jt]sx?|php|json|ya?ml|toml|ini|conf|properties|env|example|sample|dist|template|md|sh|gradle|xml|plist)$|(?:^|\/)(?:Dockerfile|Caddyfile|Makefile)[^/]*$/i;
/** Archivos de entorno reales: nunca se abren. Los de ejemplo sí. */
const ES_ENV = /(?:^|[./_-])env(?:[./_-]|$)/i;
const ES_EJEMPLO = /example|sample|dist|template|defaults/i;
const esSecreto = (ruta: string) => {
  const n = basename(ruta);
  return ES_ENV.test(n) && !ES_EJEMPLO.test(n) && !/\.(?:[cm]?[jt]sx?|php|md)$/i.test(n);
};
const DELATA_SECRETO = /secret|token|passw|api[_-]?key|private|credential|bearer/i;
const GENERICOS = new Set(["env", "process", "import", "meta", "string", "trim", "replace", "this", "config", "const", "window", "location", "origin", "base", "url", "uri", "api", "http", "https", "true", "false", "null", "undefined", "new", "return", "query", "params", "options"]);

/** Identificadores de una base: `${env:VITE_API_URL}` → `VITE_API_URL`; `${getApiBase() || import.meta.env.API}` → `getApiBase`, `API`. */
export function identificadores(base: string): string[] {
  if (!base.includes("${")) return [];
  return [...new Set((base.match(/[A-Za-z_$][\w$]*/g) ?? []).map((x) => x.replace(/^\$/, "")).filter((x) => x.length >= 3 && !GENERICOS.has(x.toLowerCase())))].slice(0, 4);
}

async function definicionesEn(repos: string[], nombres: string[]): Promise<Map<string, Array<{ archivo: string; texto: string | null }>>> {
  const out = new Map<string, Array<{ archivo: string; texto: string | null; peso: number }>>(nombres.map((n) => [n, []]));
  if (!nombres.length) return new Map();
  const patrones = nombres.map((n) => ({ n, re: new RegExp(`(?:^|[^\\w$.])${n.replace(/[$]/g, "\\$")}\\s*(?::\\s*[\\w<>\\[\\] |]+)?\\s*[=:(]`) }));
  for (const raiz of repos) {
    let archivos: string[];
    try {
      archivos = leerRepo(raiz).archivos;
    } catch {
      continue;
    }
    for (const a of archivos) {
      if (!TEXTO.test(a) || esSecreto(a) || /(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock|composer\.lock)/.test(a)) continue;
      const abs = join(raiz, a);
      if ((await stat(abs).then((s) => s.size, () => MAX_BYTES + 1)) > MAX_BYTES) continue;
      const texto = await readFile(abs, "utf8").catch(() => "");
      if (!nombres.some((n) => texto.includes(n))) continue;
      texto.split("\n").forEach((linea, i) => {
        for (const { n, re } of patrones) {
          if (!linea.includes(n) || !re.test(linea)) continue;
          const conUrl = /https?:\/\/|localhost|\d+\.\d+\.\d+\.\d+|:\d{2,5}\b/.test(linea);
          out.get(n)!.push({ archivo: `${basename(raiz)}/${a}#L${i + 1}`, texto: DELATA_SECRETO.test(linea) ? null : linea.trim().slice(0, 220), peso: (conUrl ? 2 : 0) + (ES_EJEMPLO.test(a) || /compose|docker|\.ya?ml$|config/i.test(a) ? 1 : 0) });
        }
      });
    }
  }
  // Primero las que traen una URL o un host, y las de configuración; hasta 6 por identificador.
  return new Map([...out.entries()].map(([n, xs]) => [n, xs.sort((x, y) => y.peso - x.peso || cmp(x.archivo, y.archivo)).slice(0, 6).map(({ archivo, texto }) => ({ archivo, texto }))]));
}

async function livianoDe(nombre: string, raiz: string): Promise<CerebroLiviano | null> {
  const leer = async (d: string) => Promise.all((await readdir(join(raiz, d)).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort(cmp).map((n) => readFile(join(raiz, d, n), "utf8")));
  try {
    return cerebroLiviano(nombre, JSON.parse(await readFile(join(raiz, "_build/graph.json"), "utf8")) as Graph, await leer("_build/extraction"), await leer("_build/files"));
  } catch {
    return null;
  }
}

/** `flowbrain evidence [--brain <nombre>]`: el informe de todo el registro, o solo de las llamadas que salen de un cerebro. */
export async function evidencia(registro: Registro, solo?: string): Promise<Evidencia> {
  const avisos: string[] = [];
  const livianos: CerebroLiviano[] = [];
  for (const c of registro.cerebros) {
    const l = await livianoDe(c.nombre, c.raiz);
    if (l) livianos.push(l);
    else avisos.push(`brain ${c.nombre} is not indexed: run flowbrain brains apply ${c.nombre}`);
  }
  const svcDe = (ep: string) => ep.slice(0, ep.indexOf(":"));
  const bases: EvidenciaBase[] = [];
  for (const o of livianos) {
    if (solo && o.nombre !== solo) continue;
    const grupos = new Map<string, typeof o.pendientes>();
    for (const p of o.pendientes) {
      const k = `${p.desde}\u0000${p.base}`;
      grupos.set(k, [...(grupos.get(k) ?? []), p]);
    }
    const repos = registro.cerebro(o.nombre)!.repos.map((r) => r.ruta);
    const defs = await definicionesEn(repos, [...new Set([...grupos.keys()].flatMap((k) => identificadores(k.slice(k.indexOf("\u0000") + 1))))]);
    for (const [k, ps] of grupos) {
      const svc = k.slice(0, k.indexOf("\u0000")), base = k.slice(k.indexOf("\u0000") + 1);
      const por = new Map<string, { llamadas: number; soloAhi: number }>();
      let sinDestino = 0;
      for (const p of ps) {
        const hits = [...new Set(livianos.filter((d) => d.nombre !== o.nombre).flatMap((d) => {
          const cs = endpointsQueAtienden(d, p.metodo, p.ruta, null);
          return cs.length === 1 ? [`${d.nombre}/${svcDe(cs[0]!.id)}`] : [];
        }))];
        if (!hits.length) sinDestino++;
        for (const h of hits) {
          const x = por.get(h) ?? { llamadas: 0, soloAhi: 0 };
          x.llamadas++;
          if (hits.length === 1) x.soloAhi++;
          por.set(h, x);
        }
      }
      bases.push({
        desde: `${o.nombre}/${svc}`,
        base,
        llamadas: ps.length,
        ejemplos: ps.slice(0, 3).map((p) => ({ llamada: `${p.metodo} ${p.ruta}`, evidencia: p.evidencia })),
        coincide: [...por.entries()].map(([destino, x]) => ({ destino, ...x })).sort((a, b) => b.llamadas - a.llamadas || cmp(a.destino, b.destino)),
        sinDestino,
        definiciones: identificadores(base).flatMap((n) => (defs.get(n) ?? []).map((d) => ({ nombre: n, ...d }))),
        declaradas: registro.conexiones.filter((c) => c.desde.cerebro === o.nombre && c.desde.svc === svc && (c.por === null || base.includes(c.por))).map((c) => ({ hacia: `${c.hacia.cerebro}/${c.hacia.svc}`, por: c.por, origen: c.origen })),
      });
    }
  }
  bases.sort((a, b) => cmp(a.desde, b.desde) || b.llamadas - a.llamadas || cmp(a.base, b.base));
  const disp = new Map<string, { desde: string; base: string; llamadas: number; entre: Set<string> }>();
  for (const d of crucesDelRegistro(livianos, registro.comunicados, registro.conexiones, registro.internas).entreCerebros) {
    if (solo && d.cerebro !== solo) continue;
    const k = `${d.cerebro}/${d.svc}\u0000${d.base}`;
    const x = disp.get(k) ?? { desde: `${d.cerebro}/${d.svc}`, base: d.base, llamadas: 0, entre: new Set<string>() };
    x.llamadas++;
    for (const c of d.candidatos) x.entre.add(c.slice(0, c.indexOf("/")));
    disp.set(k, x);
  }
  return {
    registro: registro.carpeta,
    cerebros: registro.cerebros.map((c) => {
      const l = livianos.find((x) => x.nombre === c.nombre);
      const porSvc = new Map<string, string[]>();
      for (const e of l?.endpoints ?? []) porSvc.set(e.svc, [...(porSvc.get(e.svc) ?? []), e.ruta]);
      return {
        nombre: c.nombre,
        repos: c.repos.map((r) => r.ruta),
        comunicadoCon: registro.vecinos(c.nombre).map((v) => v.nombre),
        servicios: [...porSvc.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, rutas]) => {
          const pre = new Map<string, number>();
          for (const r of rutas) pre.set(`/${r.split("/").filter(Boolean)[0] ?? ""}`, (pre.get(`/${r.split("/").filter(Boolean)[0] ?? ""}`) ?? 0) + 1);
          return { id, endpoints: rutas.length, prefijos: [...pre.entries()].map(([prefijo, endpoints]) => ({ prefijo, endpoints })).sort((a, b) => b.endpoints - a.endpoints || cmp(a.prefijo, b.prefijo)).slice(0, 4) };
        }),
      };
    }),
    bases,
    disputadas: [...disp.values()].map((x) => ({ desde: x.desde, base: x.base, llamadas: x.llamadas, entre: [...x.entre].sort(cmp) })).sort((a, b) => b.llamadas - a.llamadas || cmp(a.desde, b.desde)),
    avisos,
  };
}

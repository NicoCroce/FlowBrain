import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizarRuta } from "@flowbrain/core";
import type { RepoFuente } from "./tipos.js";

/**
 * Rutas por archivo: los frameworks en los que la ruta de una pantalla sale del camino del archivo, no de una
 * declaración. Se detectan por paquete (dependencia en su `package.json` o archivo de configuración) y por la carpeta
 * de rutas que existe:
 *
 * - Next `pages/` (o `src/pages/`): cada archivo es una pantalla; `_app`, `_document` y `_error` no; `api/` son endpoints.
 * - Next `app/` (o `src/app/`): `page.tsx` es una pantalla, `layout.tsx` y `template.tsx` la envuelven, `route.ts` es un
 *   endpoint; `(grupo)` y `@slot` no suman segmento, una carpeta `_privada` y una ruta interceptora `(.)x` no son rutas.
 * - Nuxt `pages/` (o `app/pages/`): cada `.vue` es una pantalla; `x.vue` junto a una carpeta `x/` envuelve a sus hijas
 *   (si hay `x/index.vue`, deja de ser pantalla); `_id` (Nuxt 2) es un parámetro. `server/api/` y `server/routes/` son
 *   endpoints, con el método en el nombre (`[id].get.ts`).
 * - SvelteKit `src/routes/`: `+page.svelte` es una pantalla, `+layout.svelte` la envuelve, `+server.ts` es un endpoint;
 *   `[id=matcher]` es `{id}`.
 * - Expo Router `app/` (o `src/app/`): cada archivo es una pantalla; `_layout` la envuelve, `x+api.ts` es un endpoint y
 *   los especiales (`+not-found`, `+html`) no son pantallas; el sufijo de plataforma (`.ios`, `.web`) no cambia la ruta.
 *
 * En todos: `index` es la carpeta, `[id]` / `[...slug]` / `[[...opt]]` / `[[opt]]` son `{id}` / `{slug}` / `{opt}`.
 */
export type MarcoRutas = "next-pages" | "next-app" | "nuxt" | "sveltekit" | "expo-router";

/** Carpeta de rutas de un framework en un paquete, relativa a la raíz del repo. */
export interface CarpetaDeRutas {
  marco: MarcoRutas;
  paquete: string;
  dir: string;
}

export interface RutaDeArchivo {
  marco: MarcoRutas;
  /** `pantalla`: una ruta del front. `layout`: envuelve las pantallas de su carpeta. `api`: un endpoint por archivo. */
  clase: "pantalla" | "layout" | "api";
  ruta: string;
  /** Con segmentos opcionales (`[[seccion]]`, `[[...slug]]`): la ruta sin ellos, que lleva a la misma pantalla. */
  sinOpcionales?: string;
  /** Método fijado por el nombre del archivo (Nuxt `x.get.ts`); si no, los dice el código. */
  metodo?: string;
}

const EXT_CODIGO = /\.(tsx|ts|jsx|js|mts|mjs)$/;
const PLATAFORMA = /\.(ios|android|web|native)$/;

/** Dependencias y archivos de configuración que delatan a cada framework. */
const MARCAS: Array<{ marcos: MarcoRutas[]; dep: RegExp; config: RegExp; dirs: string[][] }> = [
  { marcos: ["next-pages", "next-app"], dep: /^next$/, config: /^next\.config\.[cm]?[jt]s$/, dirs: [["pages", "src/pages"], ["app", "src/app"]] },
  { marcos: ["nuxt"], dep: /^nuxt3?$/, config: /^nuxt\.config\.[cm]?[jt]s$/, dirs: [["app/pages", "pages", "src/pages"]] },
  { marcos: ["sveltekit"], dep: /^@sveltejs\/kit$/, config: /^svelte\.config\.[cm]?js$/, dirs: [["src/routes"]] },
  { marcos: ["expo-router"], dep: /^expo-router$/, config: /^$/, dirs: [["app", "src/app"]] },
];

/** Carpetas de rutas por archivo del repo: por paquete, el framework que declara y la primera carpeta que existe. */
export function carpetasDeRutas(repo: RepoFuente): CarpetaDeRutas[] {
  const out: CarpetaDeRutas[] = [];
  for (const paquete of repo.paquetes) {
    const en = (r: string) => (paquete ? `${paquete}/${r}` : r);
    let deps: string[] = [];
    try {
      const pj = JSON.parse(readFileSync(join(repo.raiz, en("package.json")), "utf8")) as Record<string, Record<string, string> | undefined>;
      deps = [...Object.keys(pj["dependencies"] ?? {}), ...Object.keys(pj["devDependencies"] ?? {})];
    } catch {
      /* sin package.json: solo por archivo de configuración */
    }
    const propios = repo.archivos.filter((a) => (paquete ? a.startsWith(paquete + "/") : true)).map((a) => (paquete ? a.slice(paquete.length + 1) : a));
    const raiz = new Set(propios.filter((a) => !a.includes("/")));
    for (const m of MARCAS) {
      if (!deps.some((d) => m.dep.test(d)) && ![...raiz].some((a) => m.config.test(a))) continue;
      m.marcos.forEach((marco, i) => {
        const dir = m.dirs[i]!.find((d) => propios.some((a) => a.startsWith(d + "/")) && existsSync(join(repo.raiz, en(d))));
        if (dir) out.push({ marco, paquete, dir: en(dir) });
      });
    }
  }
  return out;
}

/** Un segmento de carpeta o de archivo a segmento de ruta: `""` si no suma (grupo, slot, `index`). */
function segmento(s: string, marco: MarcoRutas): string {
  if (/^\(.*\)$/.test(s) || s.startsWith("@") || s === "index") return "";
  // Nuxt 2: `_id` es un parámetro, `_` solo es el comodín.
  if (marco === "nuxt" && s.startsWith("_")) return s === "_" ? "{pathMatch}" : `{${s.slice(1)}}`;
  return s.replace(/\[\[?(?:\.\.\.)?([^\]=]+)(?:=[^\]]+)?\]?\]/g, "{$1}");
}

const armar = (segs: string[], marco: MarcoRutas) => normalizarRuta("/" + segs.map((s) => segmento(s, marco)).filter(Boolean).join("/"));
/** Pantalla con su ruta y, si tiene segmentos opcionales, la ruta sin ellos. */
const pantalla = (marco: MarcoRutas, segs: string[]): RutaDeArchivo => {
  const ruta = armar(segs, marco);
  const sin = segs.some((s) => /^\[\[.*\]\]$/.test(s)) ? armar(segs.filter((s) => !/^\[\[.*\]\]$/.test(s)), marco) : null;
  return { marco, clase: "pantalla", ruta, ...(sin && sin !== ruta ? { sinOpcionales: sin } : {}) };
};

/**
 * Qué es un archivo dentro de una carpeta de rutas: una pantalla, un layout o un endpoint, con su ruta. `null` si no es
 * ninguno (un componente que vive al lado, `_app`, `loading.tsx`, `+error.svelte`, un archivo privado).
 */
export function rutaDeArchivo(c: CarpetaDeRutas, archivo: string, hay: (a: string) => boolean): RutaDeArchivo | null {
  if (!archivo.startsWith(c.dir + "/")) return null;
  const rel = archivo.slice(c.dir.length + 1);
  const partes = rel.split("/");
  const nombre = partes.pop()!;
  const { marco } = c;
  switch (marco) {
    case "next-pages": {
      if (!EXT_CODIGO.test(nombre) || nombre.endsWith(".d.ts")) return null;
      const base = nombre.replace(EXT_CODIGO, "");
      if (partes[0] === "api") return { marco, clase: "api", ruta: armar([...partes, base], marco) };
      if (base.startsWith("_") || partes.some((p) => p.startsWith("_"))) return null;
      return pantalla(marco, [...partes, base]);
    }
    case "next-app": {
      if (partes.some((p) => p.startsWith("_") || /^\(\.+\)/.test(p))) return null;
      const base = nombre.replace(EXT_CODIGO, "");
      if (!EXT_CODIGO.test(nombre)) return null;
      if (base === "page") return pantalla(marco, partes);
      if (base === "layout" || base === "template") return { marco, clase: "layout", ruta: armar(partes, marco) };
      // `route.ts` ya lo lee el parser de endpoints (exports GET, POST…).
      return null;
    }
    case "nuxt": {
      if (!nombre.endsWith(".vue")) return null;
      const base = nombre.slice(0, -4);
      const carpeta = [...partes, base].join("/");
      // `x.vue` con carpeta `x/`: envuelve a sus hijas; si hay `x/index.vue`, ella es la pantalla de `/x`.
      if (hay(`${c.dir}/${carpeta}/index.vue`)) return { marco, clase: "layout", ruta: armar([...partes, base], marco) };
      return pantalla(marco, [...partes, base]);
    }
    case "sveltekit": {
      if (nombre === "+page.svelte") return pantalla(marco, partes);
      if (nombre === "+layout.svelte") return { marco, clase: "layout", ruta: armar(partes, marco) };
      if (/^\+server\.[jt]s$/.test(nombre)) return { marco, clase: "api", ruta: armar(partes, marco) };
      return null;
    }
    case "expo-router": {
      if (!EXT_CODIGO.test(nombre) || nombre.endsWith(".d.ts")) return null;
      const base = nombre.replace(EXT_CODIGO, "").replace(PLATAFORMA, "");
      if (base.endsWith("+api")) return { marco, clase: "api", ruta: armar([...partes, base.slice(0, -4)], marco) };
      if (base === "_layout") return { marco, clase: "layout", ruta: armar(partes, marco) };
      if (base.startsWith("+") || base.startsWith("_")) return null;
      return pantalla(marco, [...partes, base]);
    }
  }
}

/** Endpoints de Nuxt por archivo: `server/api/x/[id].get.ts` → `GET /api/x/{id}`; `server/routes/` sin el prefijo `/api`. */
export function endpointNuxt(paquete: string, archivo: string): RutaDeArchivo | null {
  const pre = paquete ? paquete + "/" : "";
  const m = new RegExp(`^${pre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:src/)?server/(api|routes)/(.+)\\.[cm]?[jt]s$`).exec(archivo);
  if (!m) return null;
  const partes = m[2]!.split("/");
  let base = partes.pop()!;
  const met = /\.(get|post|put|patch|delete|head|options)$/.exec(base);
  if (met) base = base.slice(0, -met[0].length);
  const segs = [...(m[1] === "api" ? ["api"] : []), ...partes, base];
  return { marco: "nuxt", clase: "api", ruta: armar(segs, "nuxt"), ...(met ? { metodo: met[1]!.toUpperCase() } : {}) };
}

/**
 * Layouts que envuelven a una ruta, de afuera hacia adentro: los de su carpeta y los de arriba (Next app, SvelteKit,
 * Expo), o el archivo hermano de cada carpeta de arriba (Nuxt: `pages/x.vue` envuelve a `pages/x/**`, sea o no pantalla).
 * `layouts` son los archivos de clase `layout` de la carpeta de rutas; `hay` dice si un archivo existe.
 */
export function layoutsDe(c: CarpetaDeRutas, archivo: string, layouts: string[], hay: (a: string) => boolean): string[] {
  const rel = archivo.slice(c.dir.length + 1).split("/");
  rel.pop();
  const out: string[] = [];
  for (let i = 0; i <= rel.length; i++) {
    if (c.marco === "nuxt") {
      const hermano = i > 0 ? `${[c.dir, ...rel.slice(0, i - 1)].join("/")}/${rel[i - 1]}.vue` : null;
      if (hermano && hay(hermano)) out.push(hermano);
      continue;
    }
    const dir = [c.dir, ...rel.slice(0, i)].join("/");
    out.push(...layouts.filter((l) => l.slice(0, l.lastIndexOf("/")) === dir).sort());
  }
  return out.filter((l) => l !== archivo);
}

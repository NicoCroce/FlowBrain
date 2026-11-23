import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { cmp, normalizarRuta } from "@flowbrain/core";
import { analizarUrl, type Parte } from "./url.js";
import { libreriaPorAliasDe, libreriasPorAlias } from "./alias.js";
import { carpetasDeRutas, endpointNuxt, layoutsDe, rutaDeArchivo, type CarpetaDeRutas, type RutaDeArchivo } from "./rutas-archivo.js";
import {
  type RefSimbolo,
  extraccionVacia,
  nombreDePaquete,
  paqueteDe,
  type AccesoTabla,
  type ArchivoCrudo,
  type LlamadaSinResolver,
  type Referencia,
  type EndpointCrudo,
  type Extraccion,
  type Forma,
  type LlamadaCruda,
  type ModeloCrudo,
  type Parser,
  type RepoFuente,
  type Simbolo,
  type ComponenteCrudo,
  type UsoDePaquete,
  type CamposLlamada,
  type LadoLlamada,
} from "./tipos.js";

/**
 * ts-parser: API del compilador de TypeScript, sin LLM. Extrae:
 * - endpoints de Express, Fastify, NestJS y rutas `app/**\/route.ts` de Next;
 * - llamadas salientes con `fetch`, `axios`, Angular `HttpClient`, `ky` y `$fetch`/`ofetch`/`useFetch` de Nuxt
 *   (incluidas instancias con base: `axios.create({ baseURL })`, `ky.create({ prefixUrl })`, `ofetch.create`);
 * - modelos de Prisma (schema.prisma) y TypeORM (`@Entity`), y accesos `x.<modelo>.<op>()` de Prisma;
 * - símbolos: funciones, clases y sus métodos, interfaces, tipos y enums, con su rango de líneas;
 * - qué archivos del repo importa cada archivo y a qué métodos o funciones de otros archivos llama cada método
 *   (las llamadas a una interfaz o a un método abstracto se atribuyen a las clases que lo implementan).
 * La resolución de módulos solo sigue imports relativos dentro del repo: el resultado no depende de node_modules.
 */

const EXT_TS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const METODOS_HTTP = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const OPS_PRISMA_ESCRITURA = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
/** Kysely: método del query builder → verbo sobre la tabla del primer argumento. */
/**
 * Tablas nombradas en un SQL escrito a mano: INSERT/REPLACE INTO, UPDATE y DELETE FROM escriben; FROM y JOIN leen.
 * Ignora los CTE (`WITH x AS`) y el `FROM` de funciones (`EXTRACT(YEAR FROM fecha)`, `TRIM(x FROM y)`).
 */
/** Nombres de CTE (`WITH x AS (…), y AS (…)`) en minúsculas. */
export function ctesDeSql(sql: string): Set<string> {
  return new Set([...sql.matchAll(/(?:\bwith(?:\s+recursive)?|,)\s+(\w+)\s+as\s*\(/gi)].map((m) => m[1]!.toLowerCase()));
}

export function tablasDeSql(sql: string): Array<{ tabla: string; verbo: "lee_de" | "escribe_en"; saltos: number }> {
  const out: Array<{ tabla: string; verbo: "lee_de" | "escribe_en"; saltos: number }> = [];
  // Nombre con comillas opcionales (`x`, "x", [x]) y esquema opcional: se queda con la tabla.
  const nombre = "[`\"\\[]?(?:\\w+[`\"\\]]?\\.[`\"\\[]?)?(\\w+)[`\"\\]]?";
  const ctes = ctesDeSql(sql);
  const saltos = (i: number) => (sql.slice(0, i).match(/\n/g) ?? []).length;
  const ocupado = new Set<number>();
  const agregar = (m: RegExpMatchArray, verbo: "lee_de" | "escribe_en") => {
    const tabla = m[1]!;
    if (ctes.has(tabla.toLowerCase()) || /^(select|set|values|dual|lateral|unnest|json_table)$/i.test(tabla)) return;
    out.push({ tabla, verbo, saltos: saltos(m.index!) });
  };
  for (const m of sql.matchAll(new RegExp("\\b(?:insert\\s+(?:ignore\\s+)?into|replace\\s+into|(?<!\\bkey\\s+)update(?:\\s+ignore)?|delete\\s+from)\\s+" + nombre, "gi"))) {
    ocupado.add(m.index! + m[0].length);
    agregar(m, "escribe_en");
  }
  for (const m of sql.matchAll(new RegExp("\\b(?:from|join)\\s+" + nombre, "gi"))) {
    if (ocupado.has(m.index! + m[0].length)) continue;
    const antes = sql.slice(0, m.index!);
    const abre = antes.lastIndexOf("(");
    if (abre >= 0 && !antes.slice(abre).includes(")") && /\b(extract|trim|substring|position|overlay)\s*$/i.test(antes.slice(0, abre))) continue;
    agregar(m, "lee_de");
  }
  return out;
}

const OPS_KYSELY: Record<string, "lee_de" | "escribe_en"> = {
  selectFrom: "lee_de",
  innerJoin: "lee_de",
  leftJoin: "lee_de",
  rightJoin: "lee_de",
  fullJoin: "lee_de",
  insertInto: "escribe_en",
  replaceInto: "escribe_en",
  updateTable: "escribe_en",
  deleteFrom: "escribe_en",
  mergeInto: "escribe_en",
};
const OPS_PRISMA_LECTURA = new Set(["findMany", "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const DECORADORES_NEST: Record<string, string> = { Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE", Head: "HEAD", Options: "OPTIONS" };

const esFuenteTs = (a: string) => (EXT_TS.test(a) && !a.endsWith(".d.ts")) || EXT_SFC.test(a);
/** Componentes de un solo archivo (Vue, Svelte, Astro): se analiza su `<script>`, con las mismas líneas. */
const EXT_SFC = /\.(vue|svelte|astro)$/;
/** Nombre con el que el compilador ve un componente de un solo archivo (`X.vue` → `X.vue.ts`). */
const SUFIJO_SFC = ".ts";
/**
 * El código de un componente de un solo archivo como TypeScript: el contenido de sus `<script>` (y el frontmatter de
 * Astro) en su lugar, y todo lo demás en blanco, conservando los saltos de línea para que la evidencia apunte bien.
 */
export function scriptDeSfc(texto: string): string {
  const out = texto.replace(/[^\n]/g, " ").split("");
  const copiar = (desde: number, hasta: number) => {
    for (let i = desde; i < hasta; i++) out[i] = texto[i]!;
  };
  for (const m of texto.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const ini = m.index! + m[0].indexOf(">") + 1;
    copiar(ini, ini + m[1]!.length);
  }
  const astro = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  if (astro) copiar(4, 4 + astro[1]!.length);
  // Siempre un módulo (un `<script setup>` sin imports sería un script suelto y no se podría importar), al final para no mover líneas.
  return out.join("") + "\nexport {};";
}
const lenguajeDe = (a: string) => (EXT_SFC.test(a) ? a.slice(a.lastIndexOf(".") + 1) : /\.(ts|tsx|mts|cts)$/.test(a) ? "typescript" : "javascript");
/** Nombre del componente de un archivo `.vue`/`.svelte`/`.astro`: el del archivo (`ReservasView`), o el de su carpeta si el archivo es `index` o `+page`. */
export function nombreSfc(archivo: string): string {
  const partes = archivo.split("/");
  let base = partes.pop()!.replace(EXT_SFC, "");
  if (/^(index|\+page|\+layout|\+error|page|layout)$/i.test(base)) base = (partes.pop() ?? "raiz").replace(/[[\]()+.]/g, "") + (base.replace("+", "").charAt(0).toUpperCase() + base.replace("+", "").slice(1));
  // Un parámetro de ruta por archivo (`[id].vue`, `[...slug].vue`, `_id.vue` de Nuxt 2): la carpeta y el parámetro (`usuariosId`).
  const param = /^(?:\[+(?:\.\.\.)?([^\]=]+)[^\]]*\]+|_([a-z]\w*))$/.exec(base);
  if (param) {
    const p = (param[1] ?? param[2])!;
    base = (partes.pop() ?? "raiz").replace(/[[\]()+.]/g, "") + p.charAt(0).toUpperCase() + p.slice(1);
  }
  return base.replace(/[^\w$]/g, "_");
}
/** `X.vue.ts` (como lo ve el compilador) → `X.vue` (el archivo del repo). */
const sfcReal = (r: string) => (r.endsWith(SUFIJO_SFC) && EXT_SFC.test(r.slice(0, -SUFIJO_SFC.length)) ? r.slice(0, -SUFIJO_SFC.length) : r);

export const tsParser: Parser = {
  nombre: "ts-parser",
  detect: (repo) => repo.archivos.some(esFuenteTs) || repo.archivos.some((a) => a.endsWith(".prisma")),
  extract: (repo) => extraer(repo),
};

function crearPrograma(repo: RepoFuente): ts.Program {
  const opciones: ts.CompilerOptions = {
    noLib: true,
    noEmit: true,
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    skipLibCheck: true,
    experimentalDecorators: true,
  };
  const host = ts.createCompilerHost(opciones, true);
  // Alias de `paths` de los tsconfig de cada paquete (p. ej. `@infra/*`), además de los imports relativos.
  const opcionesPorPaquete = new Map<string, ts.CompilerOptions>();
  for (const paquete of repo.paquetes) {
    const tsconfigs = repo.archivos.filter((a) => {
      const dir = a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : "";
      return dir === paquete && /(^|\/)tsconfig[^/]*\.json$/.test(a);
    });
    const o: ts.CompilerOptions = { ...opciones };
    for (const t of tsconfigs) {
      const abs = join(repo.raiz, t);
      const leido = ts.readConfigFile(abs, ts.sys.readFile);
      if (leido.error) continue;
      const parsed = ts.parseJsonConfigFileContent(leido.config, ts.sys, join(abs, ".."), undefined, abs);
      if (parsed.options.paths && !o.paths) {
        o.paths = parsed.options.paths;
        o.baseUrl = parsed.options.baseUrl ?? join(abs, "..");
        if (parsed.options.pathsBasePath) o.pathsBasePath = parsed.options.pathsBasePath;
      }
    }
    opcionesPorPaquete.set(paquete, o);
  }
  // Solo resoluciones dentro del repo: determinístico e independiente de node_modules.
  host.resolveModuleNameLiterals = (literales, contenedor, _redir, opts) => {
    const relContenedor = contenedor.startsWith(repo.raiz + "/") ? contenedor.slice(repo.raiz.length + 1) : "";
    const o = opcionesPorPaquete.get(paqueteDe(repo, relContenedor)) ?? opts;
    return literales.map((lit) => {
      const r = ts.resolveModuleName(lit.text, contenedor, lit.text.startsWith(".") ? opts : o, host);
      const m = r.resolvedModule;
      if (!m || m.isExternalLibraryImport || !m.resolvedFileName.startsWith(repo.raiz + "/") || m.resolvedFileName.includes("/node_modules/")) {
        return { resolvedModule: undefined };
      }
      return r;
    });
  };
  // Los componentes de un solo archivo entran como `X.vue.ts` con solo su `<script>`; los imports de `./X.vue` van ahí.
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (nombre, idioma, onError, crear) => {
    if (nombre.endsWith(SUFIJO_SFC) && EXT_SFC.test(nombre.slice(0, -SUFIJO_SFC.length))) {
      const texto = ts.sys.readFile(nombre.slice(0, -SUFIJO_SFC.length));
      return texto === undefined ? undefined : ts.createSourceFile(nombre, scriptDeSfc(texto), idioma, true, ts.ScriptKind.TS);
    }
    return original(nombre, idioma, onError, crear);
  };
  const existe = host.fileExists.bind(host);
  host.fileExists = (f) => (f.endsWith(SUFIJO_SFC) && EXT_SFC.test(f.slice(0, -SUFIJO_SFC.length)) ? existe(f.slice(0, -SUFIJO_SFC.length)) : existe(f));
  const resolverConAlias = host.resolveModuleNameLiterals;
  host.resolveModuleNameLiterals = (literales, contenedor, redir, opts, ...resto) => {
    const base = resolverConAlias!(literales, contenedor, redir, opts, ...resto);
    return literales.map((lit, i) => {
      if (!EXT_SFC.test(lit.text) || base[i]?.resolvedModule) return base[i]!;
      // `./X.vue` relativo, o con un alias (`@/components/X.vue`): se busca el archivo real y se apunta a su versión `.ts`.
      const relContenedor = contenedor.startsWith(repo.raiz + "/") ? contenedor.slice(repo.raiz.length + 1) : "";
      const o = lit.text.startsWith(".") ? opts : (opcionesPorPaquete.get(paqueteDe(repo, relContenedor)) ?? opts);
      const r = ts.resolveModuleName(lit.text + SUFIJO_SFC, contenedor, { ...o, allowImportingTsExtensions: true }, host).resolvedModule;
      return r && r.resolvedFileName.startsWith(repo.raiz + "/") ? { resolvedModule: { resolvedFileName: r.resolvedFileName, extension: ts.Extension.Ts, isExternalLibraryImport: false } } : base[i]!;
    });
  };
  const archivos = repo.archivos.filter(esFuenteTs).map((a) => join(repo.raiz, a) + (EXT_SFC.test(a) ? SUFIJO_SFC : ""));
  return ts.createProgram(archivos, opciones, host);
}

function extraer(repo: RepoFuente): Extraccion {
  const out = extraccionVacia("ts-parser");
  // Los CTE pueden declararse en un fragmento y usarse en otro (`${ctes(…)} … ${FROM}`): se filtran con los de todo el repo.
  const ctesRepo = new Set<string>();
  const deSql = new Set<object>();
  const programa = crearPrograma(repo);
  const checker = programa.getTypeChecker();
  const rel = (sf: ts.SourceFile) => sfcReal(sf.fileName.slice(repo.raiz.length + 1).split("\\").join("/"));
  const linea = (n: ts.Node) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;

  // ---------- Prisma ----------
  for (const a of repo.archivos.filter((x) => x.endsWith(".prisma"))) {
    const texto = readFileSync(join(repo.raiz, a), "utf8");
    const simbolos: Simbolo[] = [];
    const lineas = texto.split("\n");
    lineas.forEach((l, i) => {
      const m = /^\s*model\s+(\w+)\s*\{/.exec(l);
      if (!m) return;
      simbolos.push({ linea: i + 1, nombre: m[1]!, tipo: "modelo" });
      let tabla: string | null = null;
      for (let j = i + 1; j < lineas.length && !/^\s*}/.test(lineas[j]!); j++) {
        const map = /@@map\(\s*"([^"]+)"\s*\)/.exec(lineas[j]!);
        if (map) tabla = map[1]!;
      }
      out.modelos.push({ paquete: paqueteDe(repo, a), nombre: m[1]!, tabla, archivo: a, linea: i + 1 });
    });
    out.archivos.push({ lenguaje: "prisma", ruta: a, simbolos });
  }
  const modelosPrisma = new Map(out.modelos.map((m) => [m.nombre.charAt(0).toLowerCase() + m.nombre.slice(1), m.nombre]));

  // ---------- Helpers de resolución ----------
  const resolver = (n: ts.Node): ts.Symbol | undefined => {
    let s = checker.getSymbolAtLocation(n);
    if (s && s.flags & ts.SymbolFlags.Alias) {
      try {
        const t = checker.getAliasedSymbol(s);
        if (t.declarations?.length) s = t;
      } catch {
        /* alias sin resolver: se usa el local */
      }
    }
    return s;
  };

  /** Módulo de origen de un identificador importado (`import x from "axios"` → "axios"). */
  const moduloDe = (id: ts.Node): string | null => {
    const s = checker.getSymbolAtLocation(id);
    for (const d of s?.declarations ?? []) {
      let n: ts.Node | undefined = d;
      while (n && !ts.isImportDeclaration(n)) n = n.parent;
      if (n && ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) return n.moduleSpecifier.text;
    }
    return null;
  };

  const declaracion = (n: ts.Node, prof = 0): ts.Declaration | undefined => {
    const d = resolver(n)?.declarations?.[0];
    if (d && ts.isExportAssignment(d) && prof < 3) return declaracion(d.expression, prof + 1);
    return d;
  };
  const inicializador = (n: ts.Node): ts.Expression | undefined => {
    const d = declaracion(n);
    return d && ts.isVariableDeclaration(d) ? d.initializer : undefined;
  };

  /** ¿La expresión es `express()`, `Router()`, `express.Router()` o `fastify()`? */
  const frameworkDeInstancia = (receptor: ts.Expression): "express" | "fastify" | null => {
    const ini = ts.isIdentifier(receptor) ? inicializador(receptor) : undefined;
    if (!ini || !ts.isCallExpression(ini)) return null;
    const c = ini.expression;
    const base = ts.isPropertyAccessExpression(c) ? c.expression : c;
    if (!ts.isIdentifier(base)) return null;
    const mod = moduloDe(base);
    if (mod === "express") return "express";
    if (mod === "fastify") return "fastify";
    return null;
  };

  /**
   * ¿La expresión es un cliente HTTP conocido o una instancia suya? Devuelve cuál y su base, si la tiene:
   * - axios y `axios.create({ baseURL })`;
   * - Angular: una propiedad, parámetro o variable de tipo `HttpClient` (`@angular/common/http`), inyectado por
   *   constructor o con `inject(HttpClient)`;
   * - ky y `ky.create`/`.extend({ prefixUrl })` (la instancia hereda la base de la que extiende; `separar`: ky pone
   *   una barra entre la base y la URL);
   * - `$fetch` (global de Nuxt o importado de `ofetch`), `ofetch` y `$fetch.create`/`ofetch.create({ baseURL })`.
   */
  type Cliente = { tipo: "axios" | "angular" | "ky" | "ofetch"; baseURL: ts.Expression | null; separar?: boolean };
  const MODULOS_NUXT = new Set(["ofetch", "#app", "#imports", "nuxt/app"]);
  /** `$fetch`/`useFetch`/… global (auto-importado por Nuxt, sin declaración) o importado de `ofetch` o de Nuxt. */
  const globalNuxt = (e: ts.Identifier) => !resolver(e)?.declarations?.length || MODULOS_NUXT.has(moduloDe(e) ?? "");
  const esHttpClient = (t: ts.TypeNode | undefined) => !!t && ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && t.typeName.text === "HttpClient" && moduloDe(t.typeName) === "@angular/common/http";
  const clienteDe = (e: ts.Expression, prof = 0): Cliente | null => {
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    if (prof > 4) return null;
    if (ts.isIdentifier(e)) {
      const mod = moduloDe(e);
      if (mod === "axios") return { tipo: "axios", baseURL: null };
      if (mod === "ky") return { tipo: "ky", baseURL: null, separar: true };
      if ((e.text === "$fetch" || e.text === "ofetch") && globalNuxt(e)) return { tipo: "ofetch", baseURL: null };
    }
    // Angular: `this.http`, `http` o `this.api.http` cuya declaración es de tipo `HttpClient` o vale `inject(HttpClient)`.
    const nombre = ts.isIdentifier(e) ? e : ts.isPropertyAccessExpression(e) ? e.name : null;
    const d = nombre ? resolver(nombre)?.declarations?.[0] : undefined;
    if (d && (ts.isParameter(d) || ts.isPropertyDeclaration(d) || ts.isVariableDeclaration(d))) {
      if (esHttpClient(d.type)) return { tipo: "angular", baseURL: null };
      const ini = d.initializer;
      if (ini && ts.isCallExpression(ini) && ts.isIdentifier(ini.expression) && ini.expression.text === "inject") {
        const a = ini.arguments[0];
        if (a && ts.isIdentifier(a) && a.text === "HttpClient" && moduloDe(a) === "@angular/common/http") return { tipo: "angular", baseURL: null };
      }
    }
    // Instancias: `axios.create(cfg)`, `ky.create(cfg)`, `api.extend(cfg)`, `$fetch.create(cfg)`.
    const ini = ts.isIdentifier(e) ? inicializador(e) : undefined;
    if (ini && ts.isCallExpression(ini) && ts.isPropertyAccessExpression(ini.expression) && /^(create|extend)$/.test(ini.expression.name.text)) {
      const padre = clienteDe(ini.expression.expression, prof + 1);
      if (!padre || padre.tipo === "angular" || (padre.tipo !== "ky" && ini.expression.name.text === "extend")) return null;
      const cfg = ini.arguments[0];
      const clave = padre.tipo === "ky" ? "prefixUrl" : "baseURL";
      const base = cfg && ts.isObjectLiteralExpression(cfg) ? (propiedad(cfg, clave) ?? (padre.tipo === "ky" ? propiedad(cfg, "prefix") : undefined)) : undefined;
      return { ...padre, baseURL: base ?? padre.baseURL };
    }
    return null;
  };

  /** Nombre de un tipo anotado: sin `Promise`/`Observable`, `Array<T>` como `T[]` y los genéricos con su texto. */
  const nombreTipo = (t: ts.TypeNode | undefined): string | null => {
    if (!t) return null;
    if (ts.isParenthesizedTypeNode(t)) return nombreTipo(t.type);
    if (ts.isArrayTypeNode(t)) {
      const e = nombreTipo(t.elementType);
      return e ? `${e}[]` : null;
    }
    if (ts.isTypeReferenceNode(t)) {
      const n = t.typeName.getText();
      const [a] = t.typeArguments ?? [];
      if ((n === "Promise" || n === "Observable") && a) return nombreTipo(a);
      if ((n === "Array" || n === "ReadonlyArray") && a) {
        const e = nombreTipo(a);
        return e ? `${e}[]` : null;
      }
      return a ? limpiar(t.getText()) : n;
    }
    return null;
  };

  const nombreTipoDeExpr = (e: ts.Expression): string | null => {
    let x = e;
    if (ts.isCallExpression(x) && x.expression.getText() === "JSON.stringify" && x.arguments[0]) x = x.arguments[0];
    const t = checker.getTypeAtLocation(x);
    const s = t.aliasSymbol ?? t.getSymbol();
    if (!s || s.name.startsWith("__")) return null;
    return s.name;
  };

  const nombreDecorador = (d: ts.Decorator): string => {
    const e = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
    return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";
  };

  /** `Clase.metodo` o `funcion` de una declaración, para nombrar la forma de lo que devuelve. */
  const nombreDeFuncion = (fn: ts.Node): string | null => {
    if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) return ts.isClassDeclaration(fn.parent) && fn.parent.name ? `${fn.parent.name.text}.${fn.name.text}` : fn.name.text;
    if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
    if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
    return null;
  };

  /** Tipo de un valor de un objeto literal, sin inventar: lo que no se sabe es `unknown`. */
  const tipoDeValor = (x: ts.Expression): string => {
    if (ts.isStringLiteralLike(x) || ts.isTemplateExpression(x)) return "string";
    if (ts.isNumericLiteral(x)) return "number";
    if (x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword) return "boolean";
    if (x.kind === ts.SyntaxKind.NullKeyword) return "null";
    if (ts.isArrayLiteralExpression(x)) return "unknown[]";
    if (ts.isObjectLiteralExpression(x)) return "object";
    const t = limpiar(checker.typeToString(checker.getTypeAtLocation(x)));
    return /\bany\b/.test(t) || t.length > 80 ? "unknown" : t;
  };

  /**
   * Lo que devuelve un handler sin tipo de retorno anotado: sigue cada `return` hasta una anotación (la del método
   * del servicio al que delega, hasta 4 niveles) o un objeto literal, cuya forma se guarda como `<Clase.metodo>:respuesta`.
   */
  const tipoDeRetorno = (fn: ts.SignatureDeclaration, formas: Record<string, Forma>, prof = 0): string | null => {
    if (fn.type) return nombreTipo(fn.type);
    const cuerpo = (fn as ts.FunctionLikeDeclaration).body;
    if (!cuerpo || prof >= 4) return null;
    const retornos: ts.Expression[] = [];
    if (!ts.isBlock(cuerpo)) retornos.push(cuerpo);
    else {
      const ver = (n: ts.Node): void => {
        if (ts.isFunctionLike(n)) return;
        if (ts.isReturnStatement(n) && n.expression) retornos.push(n.expression);
        ts.forEachChild(n, ver);
      };
      ts.forEachChild(cuerpo, ver);
    }
    const nombres = new Set<string>();
    const literales: Forma[] = [];
    for (let e of retornos) {
      while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || (ts.isAsExpression(e) && e.type.getText() === "const")) e = e.expression;
      let n: string | null = null;
      if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) n = nombreTipo(e.type);
      else if (ts.isCallExpression(e)) {
        const c = e.expression;
        const id = ts.isPropertyAccessExpression(c) ? c.name : ts.isIdentifier(c) ? c : null;
        let d: ts.Node | undefined = id ? real(checker.getSymbolAtLocation(id))?.declarations?.[0] : undefined;
        if (d && ts.isVariableDeclaration(d) && d.initializer) d = d.initializer;
        if (d && ts.isPropertyDeclaration(d) && d.initializer) d = d.initializer;
        if (d && ts.isFunctionLike(d) && delRepo(d.getSourceFile())) n = tipoDeRetorno(d, formas, prof + 1);
      } else if (ts.isObjectLiteralExpression(e)) {
        const dueño = nombreDeFuncion(fn);
        if (dueño) {
          const forma: Forma = {};
          for (const p of e.properties) {
            if (ts.isPropertyAssignment(p)) forma[p.name.getText().replace(/["']/g, "")] = tipoDeValor(p.initializer);
            else if (ts.isShorthandPropertyAssignment(p)) forma[p.name.text] = tipoDeValor(p.name);
            else forma["…"] = "unknown";
          }
          literales.push(forma);
          n = `${dueño}:respuesta`;
        }
      } else n = nombreTipoDeExpr(e);
      if (n === null) return null;
      nombres.add(n);
    }
    // Varios `return` con objetos literales dan una sola forma: la unión de sus claves; la que falta en alguno lleva `?`,
    // y si el tipo difiere se listan todos.
    if (literales.length) {
      const n = `${nombreDeFuncion(fn)}:respuesta`;
      if (!(n in formas)) {
        const forma: Forma = {};
        for (const k of [...new Set(literales.flatMap((l) => Object.keys(l)))]) {
          const tipos = [...new Set(literales.flatMap((l) => (k in l ? [l[k]!] : [])))].sort(cmp);
          forma[literales.every((l) => k in l) || k === "…" ? k : `${k}?`] = tipos.join(" | ");
        }
        formas[n] = forma;
      }
    }
    return nombres.size ? [...nombres].sort(cmp).join(" | ") : null;
  };

  /** Parámetros de query de un handler: `@Query() q: Dto` → el tipo; `@Query("a") a: string` → una forma con cada uno. */
  const tipoDeQuery = (m: ts.MethodDeclaration, formas: Record<string, Forma>): string | null => {
    const sueltos: Forma = {};
    let entero: string | null = null;
    for (const p of m.parameters) {
      const d = (ts.getDecorators(p) ?? []).find((x) => /^Query/.test(nombreDecorador(x)));
      if (!d) continue;
      const arg = ts.isCallExpression(d.expression) ? d.expression.arguments[0] : undefined;
      if (arg && ts.isStringLiteralLike(arg)) sueltos[`${arg.text}${p.questionToken ? "?" : ""}`] = p.type ? limpiar(p.type.getText()) : "unknown";
      else entero ??= nombreTipo(p.type);
    }
    if (entero) return entero;
    const dueño = nombreDeFuncion(m);
    if (!Object.keys(sueltos).length || !dueño) return null;
    formas[`${dueño}:query`] ??= sueltos;
    return `${dueño}:query`;
  };

  // ---------- Evaluación estática de URLs ----------
  type Ligaduras = Map<ts.Node, Parte[]>;
  /** Cuerpo evaluable de una función auxiliar: arrow con expresión o bloque con un único `return`. */
  const cuerpoDe = (callee: ts.Expression): { params: readonly ts.ParameterDeclaration[]; cuerpo: ts.Expression } | null => {
    let f: ts.Node | undefined = ts.isIdentifier(callee) || ts.isPropertyAccessExpression(callee) ? declaracion(callee) : undefined;
    if (f && ts.isVariableDeclaration(f)) f = f.initializer;
    if (f && ts.isPropertyAssignment(f)) f = f.initializer;
    if (!f || !(ts.isArrowFunction(f) || ts.isFunctionExpression(f) || ts.isFunctionDeclaration(f)) || !f.body) return null;
    if (!ts.isBlock(f.body)) return { params: f.parameters, cuerpo: f.body };
    const [unico] = f.body.statements;
    if (f.body.statements.length === 1 && unico && ts.isReturnStatement(unico) && unico.expression) return { params: f.parameters, cuerpo: unico.expression };
    return null;
  };
  const empiezaConRuta = (p: Parte[]) => {
    const a = p[0];
    return !!a && "lit" in a && a.lit.startsWith("/");
  };
  const evaluar = (e: ts.Expression | undefined, prof = 0, lig: Ligaduras = new Map()): Parte[] => {
    if (!e) return [];
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [{ lit: e.text }];
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return evaluar(e.expression, prof, lig);
    if (ts.isTemplateExpression(e)) {
      const p: Parte[] = [{ lit: e.head.text }];
      for (const s of e.templateSpans) p.push(...evaluar(s.expression, prof, lig), { lit: s.literal.text });
      return p;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...evaluar(e.left, prof, lig), ...evaluar(e.right, prof, lig)];
    if (ts.isPropertyAccessExpression(e)) {
      const t = e.getText();
      const env = /^(?:process\.env|import\.meta\.env)\.(\w+)$/.exec(t);
      if (env) return [{ din: `env:${env[1]}` }];
      // `ENDPOINTS.x` donde ENDPOINTS es un objeto literal: se evalúa la propiedad.
      const d = prof < 4 ? checker.getSymbolAtLocation(e)?.declarations?.[0] : undefined;
      if (d && ts.isPropertyAssignment(d)) return evaluar(d.initializer, prof + 1);
      return [{ din: t }];
    }
    if (ts.isIdentifier(e)) {
      const d = declaracion(e);
      if (d && lig.has(d)) return lig.get(d)!;
      if (prof < 4 && d && ts.isVariableDeclaration(d) && d.initializer && ts.isVariableDeclarationList(d.parent) && d.parent.flags & ts.NodeFlags.Const) {
        return evaluar(d.initializer, prof + 1);
      }
    }
    if (ts.isCallExpression(e) && prof < 4) {
      // Auxiliar del repo (`withId = (ep, id) => \`${ep}/${id}\``): se evalúa su cuerpo con los argumentos ligados.
      const f = cuerpoDe(e.expression);
      if (f) {
        const nuevas: Ligaduras = new Map();
        f.params.forEach((p, i) => nuevas.set(p, e.arguments[i] ? evaluar(e.arguments[i], prof + 1, lig) : [{ din: p.name.getText() }]));
        return evaluar(f.cuerpo, prof + 1, nuevas);
      }
      // Constructor de rutas de librería (`generatePath("/x/:id", {id})`): la plantilla es el primer argumento.
      const primero = evaluar(e.arguments[0], prof + 1, lig);
      if (e.arguments.length <= 2 && empiezaConRuta(primero) && (!e.arguments[1] || ts.isObjectLiteralExpression(e.arguments[1]))) return primero;
    }
    return [{ din: e.getText() }];
  };

  // Kysely solo si algún paquete lo declara como dependencia (evita confundir `.leftJoin("x")` de otras librerías).
  const usaKysely = repo.archivos
    .filter((a) => a === "package.json" || a.endsWith("/package.json"))
    .some((a) => /"kysely"\s*:/.test(readFileSync(join(repo.raiz, a), "utf8")));

  // Router del front: solo si algún paquete declara uno (evita leer como pantalla cualquier objeto con `path`).
  const usaRouter = repo.archivos
    .filter((a) => a === "package.json" || a.endsWith("/package.json"))
    .some((a) => /"(react-router|react-router-dom|@remix-run\/react|@tanstack\/react-router|vue-router|@angular\/router)"\s*:/.test(readFileSync(join(repo.raiz, a), "utf8")));
  // React Navigation (apps React Native): las pantallas son `<Stack.Screen name component>` y se navega por nombre,
  // sin URL; la ruta de la pantalla es `/<name>`.
  const usaNavegacionNativa = repo.archivos
    .filter((a) => a === "package.json" || a.endsWith("/package.json"))
    .some((a) => /"@react-navigation\/[\w-]+"\s*:/.test(readFileSync(join(repo.raiz, a), "utf8")));

  // ---------- Componentes entre paquetes (un sistema de diseño y quien lo usa) ----------
  // Una librería se publica para que otro la importe: su package.json dice por dónde entrar (`main`, `exports`…).
  // Una app no lo dice. Solo los componentes de una librería son piezas del grafo; los de una app ya son sus pantallas.
  const librerias = new Map<string, string | null>();
  /** Nombre de la librería que es el paquete, o `null` si no lo es. */
  const libreria = (paquete: string): string | null => {
    if (!librerias.has(paquete)) {
      let pj: Record<string, unknown> = {};
      try {
        pj = JSON.parse(readFileSync(join(repo.raiz, paquete, "package.json"), "utf8")) as Record<string, unknown>;
      } catch {
        /* sin package.json: no es una librería de JavaScript */
      }
      librerias.set(paquete, typeof pj["name"] === "string" && ["main", "module", "exports", "types", "typings", "svelte"].some((k) => pj[k] !== undefined) ? pj["name"] : null);
    }
    return librerias.get(paquete)!;
  };
  // Una carpeta que se importa con un alias exacto del tsconfig (`@ds`) también es una librería, con el alias de nombre.
  const porAlias = libreriasPorAlias(repo);
  /** Librería a la que pertenece un archivo: la de alias más específica, o el paquete si es una librería. */
  const libreriaDeArchivo = (archivo: string): string | null => libreriaPorAliasDe(porAlias, archivo)?.nombre ?? libreria(paqueteDe(repo, archivo));
  // Historias, tests y las páginas de muestra de la librería (`Boton.page.tsx`, `Boton.demo.tsx`, `examples/`).
  const NO_ES_FUENTE = /\.(stories|story|test|spec|page|demo|example|examples|docs)\.[^.]+$|(^|\/)(__tests__|__mocks__|stories|demos?|examples?)\//;
  // Con mayúscula inicial y alguna minúscula: `COLORES` o `API_URL` son constantes, no componentes.
  const esComponente = (n: string) => /^[A-Z][A-Za-z0-9]*$/.test(n) && /[a-z]/.test(n);
  /** Componentes que exporta un archivo de una librería: funciones, clases y constantes con nombre de componente. */
  const componentesExportados = (sf: ts.SourceFile, archivo: string): ComponenteCrudo[] => {
    if (NO_ES_FUENTE.test(archivo)) return [];
    const out = new Map<string, number>();
    const exportado = (st: ts.Statement) => ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const locales = new Map<string, number>();
    for (const st of sf.statements) {
      const nombres: string[] = [];
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) nombres.push(st.name.text);
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) nombres.push(d.name.text);
      for (const n of nombres) {
        locales.set(n, linea(st));
        if (exportado(st) && esComponente(n)) out.set(n, linea(st));
      }
    }
    // `export { Boton, Tarjeta }` y `export default Boton` sobre declaraciones del mismo archivo.
    for (const st of sf.statements) {
      if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text;
          if (esComponente(el.name.text) && locales.has(local)) out.set(el.name.text, locales.get(local)!);
        }
      }
      if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression) && esComponente(st.expression.text) && locales.has(st.expression.text)) out.set(st.expression.text, locales.get(st.expression.text)!);
    }
    // Un componente de un solo archivo (`Boton.vue`) es el archivo entero.
    if (EXT_SFC.test(archivo) && esComponente(nombreSfc(archivo))) out.set(nombreSfc(archivo), 1);
    return [...out.entries()].map(([nombre, l]) => ({ nombre, linea: l })).sort((a, b) => a.linea - b.linea || cmp(a.nombre, b.nombre));
  };
  /**
   * Componentes importados de un paquete que no es del repo (`import { Boton } from "@empresa/ui"`), con el símbolo
   * del archivo que los usa. En un componente de un solo archivo lo que el `<script>` no usa lo usa el template.
   */
  const usosDePaquetes = (sf: ts.SourceFile, simbolos: Simbolo[], sfc: string | null, archivoPropio: string): UsoDePaquete[] => {
    const propia = libreriaDeArchivo(archivoPropio);
    const importados = new Map<string, { paquete: string; simbolo: string; linea: number }>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause || st.importClause.isTypeOnly) continue;
      const mod = st.moduleSpecifier.text;
      if (mod.startsWith("node:")) continue;
      const relativo = mod.startsWith(".") || mod.startsWith("/");
      // Un alias del propio repo (`@/components/x`) se resuelve a un archivo del repo: eso ya es `importa`. Salvo que
      // sea otra librería del mismo monorepo (`@empresa/ui` en `packages/ui`) o una carpeta con alias propio (`@ds`):
      // ahí también cuenta como uso de esa librería.
      const d = checker.getSymbolAtLocation(st.moduleSpecifier)?.declarations?.[0];
      let paquete = nombreDePaquete(mod);
      if (d && ts.isSourceFile(d) && delRepo(d)) {
        const nombre = libreriaDeArchivo(rel(d));
        if (!nombre || nombre === propia) continue;
        paquete = nombre;
      } else if (relativo) continue;
      const ic = st.importClause;
      if (ic.name && esComponente(ic.name.text)) importados.set(ic.name.text, { paquete, simbolo: ic.name.text, linea: linea(st) });
      if (ic.namedBindings && ts.isNamedImports(ic.namedBindings)) {
        for (const el of ic.namedBindings.elements) {
          const exportado = (el.propertyName ?? el.name).text;
          if (!el.isTypeOnly && esComponente(exportado)) importados.set(el.name.text, { paquete, simbolo: exportado, linea: linea(st) });
        }
      }
    }
    if (!importados.size) return [];
    // El símbolo más chico que contiene la línea: el que figura como `desde` en `invoca`.
    const dueño = (l: number) => {
      let mejor: Simbolo | null = null;
      for (const s of simbolos) if ((s.tipo === "funcion" || s.tipo === "metodo") && s.linea <= l && l <= (s.fin ?? s.linea) && (!mejor || (s.fin ?? s.linea) - s.linea < (mejor.fin ?? mejor.linea) - mejor.linea)) mejor = s;
      return mejor?.nombre ?? null;
    };
    const out = new Map<string, UsoDePaquete>();
    const usados = new Set<string>();
    // Un componente se dibuja: `<Boton />` en JSX. Una clase o un decorador con mayúscula (`Router`, `Injectable`) no.
    const ver = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n)) return;
      const etiqueta = ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n) ? n.tagName : null;
      const id = etiqueta && ts.isIdentifier(etiqueta) ? etiqueta : null;
      if (id) usados.add(id.text);
      if (id && importados.has(id.text)) {
        const i = importados.get(id.text)!;
        const l = linea(id);
        const desde = dueño(l);
        const k = `${desde}\u0000${i.paquete}\u0000${i.simbolo}`;
        if (!out.has(k)) out.set(k, { desde, paquete: i.paquete, simbolo: i.simbolo, linea: l });
      }
      ts.forEachChild(n, ver);
    };
    ts.forEachChild(sf, ver);
    // En un componente de un solo archivo lo dibuja el template, que no es TypeScript: cuenta lo importado con nombre
    // de componente que el `<script>` no usa como valor (si lo usa, es una clase o una función, no algo que se dibuja).
    if (sfc) {
      const enScript = new Set<string>();
      const valores = (n: ts.Node): void => {
        if (ts.isImportDeclaration(n)) return;
        if (ts.isIdentifier(n) && importados.has(n.text) && !(ts.isPropertyAssignment(n.parent) || ts.isShorthandPropertyAssignment(n.parent))) enScript.add(n.text);
        ts.forEachChild(n, valores);
      };
      ts.forEachChild(sf, valores);
      for (const [local, i] of importados) if (!enScript.has(local) && !usados.has(local)) out.set(`${sfc}\u0000${i.paquete}\u0000${i.simbolo}`, { desde: sfc, paquete: i.paquete, simbolo: i.simbolo, linea: i.linea });
    }
    return [...out.values()].sort((a, b) => a.linea - b.linea || cmp(a.paquete + a.simbolo, b.paquete + b.simbolo) || cmp(a.desde ?? "", b.desde ?? ""));
  };

  // ---------- Recorrido ----------
  const fuentes = programa
    .getSourceFiles()
    .filter((sf) => sf.fileName.startsWith(repo.raiz + "/") && !sf.isDeclarationFile)
    .sort((a, b) => cmp(a.fileName, b.fileName));

  // ---------- Estructura interna: símbolos con rango, imports e invocaciones ----------
  const delRepo = (sf: ts.SourceFile | undefined): sf is ts.SourceFile =>
    !!sf && sf.fileName.startsWith(repo.raiz + "/") && !sf.isDeclarationFile && !sf.fileName.includes("/node_modules/");
  const finDe = (n: ts.Node) => n.getSourceFile().getLineAndCharacterOfPosition(n.getEnd()).line + 1;
  const nombreMiembro = (m: ts.ClassElement | ts.TypeElement): string | null =>
    m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : null;
  const esFuncionMiembro = (m: ts.ClassElement) =>
    ts.isMethodDeclaration(m) || (ts.isPropertyDeclaration(m) && !!m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer)));
  const contenedor = (d: ts.Node): (ts.ClassLikeDeclaration | ts.InterfaceDeclaration) | null =>
    d.parent && (ts.isClassLike(d.parent) || ts.isInterfaceDeclaration(d.parent)) ? d.parent : null;
  const real = (sym: ts.Symbol | undefined) => (sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);
  // Implementaciones: interfaz o clase abstracta → clases que la implementan o extienden.
  const implementan = new Map<ts.Node, ts.ClassLikeDeclaration[]>();
  for (const sf of fuentes) {
    const ver = (n: ts.Node): void => {
      if (ts.isClassLike(n)) {
        for (const h of n.heritageClauses ?? []) {
          for (const t of h.types) {
            const d = real(checker.getSymbolAtLocation(t.expression))?.declarations?.[0];
            if (d && (ts.isInterfaceDeclaration(d) || ts.isClassLike(d)) && delRepo(d.getSourceFile())) implementan.set(d, [...(implementan.get(d) ?? []), n]);
          }
        }
      }
      ts.forEachChild(n, ver);
    };
    ver(sf);
  }
  // Ligaduras de inyección explícitas: `{ provide: TOKEN, useClass | useExisting: Clase }` (Nest y similares) y
  // `bind(TOKEN).to(Clase)` (Inversify). Lo inyectado con `@Inject(TOKEN)` y tipado con una interfaz o clase abstracta
  // se atribuye a esa clase aunque no declare `implements`.
  const declDe = (e: ts.Expression | undefined): ts.Declaration | undefined => {
    if (!e) return undefined;
    const n = ts.isPropertyAccessExpression(e) ? e.name : ts.isIdentifier(e) ? e : null;
    return n ? real(checker.getSymbolAtLocation(n))?.declarations?.[0] : undefined;
  };
  const ligadas = new Map<ts.Node, ts.ClassLikeDeclaration[]>();
  const ligar = (token: ts.Declaration | undefined, clase: ts.Declaration | undefined) => {
    if (!token || !clase || !ts.isClassLike(clase) || !delRepo(clase.getSourceFile())) return;
    const l = ligadas.get(token) ?? [];
    if (!l.includes(clase)) ligadas.set(token, [...l, clase]);
  };
  const agregarImpl = (tipo: ts.Node, clase: ts.ClassLikeDeclaration) => {
    if (tipo === clase) return;
    const l = implementan.get(tipo) ?? [];
    if (!l.includes(clase)) implementan.set(tipo, [...l, clase]);
  };
  for (const sf of fuentes) {
    const ver = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        const provide = propiedad(n, "provide");
        const clase = propiedad(n, "useClass") ?? propiedad(n, "useExisting");
        if (provide && clase) ligar(declDe(provide), declDe(clase));
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "to") {
        const b = n.expression.expression;
        if (ts.isCallExpression(b) && ts.isPropertyAccessExpression(b.expression) && b.expression.name.text === "bind") ligar(declDe(b.arguments[0]), declDe(n.arguments[0]));
      }
      ts.forEachChild(n, ver);
    };
    ver(sf);
  }
  for (const [token, clases] of ligadas) {
    // Un token que es la propia clase abstracta o interfaz.
    if (ts.isClassLike(token) || ts.isInterfaceDeclaration(token)) for (const c of clases) agregarImpl(token, c);
  }
  for (const sf of fuentes) {
    const ver = (n: ts.Node): void => {
      if ((ts.isParameter(n) || ts.isPropertyDeclaration(n)) && n.type) {
        const d = decorador(n, "Inject") ?? decorador(n, "inject");
        const token = d && ts.isCallExpression(d) ? declDe(d.arguments[0]) : undefined;
        const clases = token ? ligadas.get(token) : undefined;
        if (clases && ts.isTypeReferenceNode(n.type)) {
          const tipo = real(checker.getSymbolAtLocation(n.type.typeName))?.declarations?.[0];
          if (tipo && (ts.isInterfaceDeclaration(tipo) || ts.isClassLike(tipo)) && delRepo(tipo.getSourceFile())) for (const c of clases) agregarImpl(tipo, c);
        }
      }
      ts.forEachChild(n, ver);
    };
    ver(sf);
  }

  /** `const api = { m: () => … }` en el nivel superior: el nombre del objeto (sus funciones son símbolos `api.m`). */
  const nombreObjeto = (o: ts.ObjectLiteralExpression): string | null => {
    let p: ts.Node = o.parent;
    while (ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isParenthesizedExpression(p)) p = p.parent;
    return ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && ts.isVariableStatement(p.parent.parent) && ts.isSourceFile(p.parent.parent.parent) ? p.name.text : null;
  };
  /** Función literal, también envuelta en un HOC de componentes (`memo(() => …)`, `forwardRef(function …)`). */
  const HOC = new Set(["memo", "forwardRef", "observer"]);
  const funcionLiteral = (e: ts.Expression | undefined): ts.ArrowFunction | ts.FunctionExpression | null => {
    if (!e) return null;
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
    if (ts.isCallExpression(e) && e.arguments.length >= 1) {
      const c = e.expression;
      const n = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
      if (HOC.has(n)) return funcionLiteral(e.arguments[0]);
    }
    return null;
  };
  /** Funciones de un objeto literal de nivel superior: `[nombre, nodo, cuerpo]`. */
  const funcionesDeObjeto = (o: ts.ObjectLiteralExpression): Array<[string, ts.Node, ts.Node]> => {
    const out: Array<[string, ts.Node, ts.Node]> = [];
    for (const p of o.properties) {
      if (!p.name || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
      const f = ts.isPropertyAssignment(p) ? funcionLiteral(p.initializer) : null;
      if (f) out.push([p.name.text, p, f.body]);
      else if (ts.isMethodDeclaration(p) && p.body) out.push([p.name.text, p, p.body]);
    }
    return out;
  };

  /** Símbolo destino de una declaración: `Clase.metodo` o `funcion`, con su archivo. Varios si es una interfaz. */
  const destinos = (d: ts.Declaration): Array<{ archivo: string; simbolo: string }> => {
    const sf = d.getSourceFile();
    if (!delRepo(sf)) return [];
    if (ts.isFunctionDeclaration(d) && d.name) return [{ archivo: rel(sf), simbolo: d.name.text }];
    if ((ts.isPropertyAssignment(d) || ts.isMethodDeclaration(d)) && ts.isObjectLiteralExpression(d.parent)) {
      const o = nombreObjeto(d.parent);
      const es = ts.isMethodDeclaration(d) || !!funcionLiteral(d.initializer);
      return o && es && d.name && (ts.isIdentifier(d.name) || ts.isStringLiteral(d.name)) ? [{ archivo: rel(sf), simbolo: `${o}.${d.name.text}` }] : [];
    }
    if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && funcionLiteral(d.initializer)) {
      return [{ archivo: rel(sf), simbolo: d.name.text }];
    }
    if (ts.isClassDeclaration(d) && d.name) return [{ archivo: rel(sf), simbolo: d.name.text }];
    if (ts.isMethodDeclaration(d) || ts.isMethodSignature(d) || ts.isPropertyDeclaration(d) || ts.isPropertySignature(d)) {
      const c = contenedor(d), m = nombreMiembro(d);
      if (!c?.name || !m) return [];
      const abstracto = ts.isMethodSignature(d) || ts.isPropertySignature(d) || !!ts.getModifiers(d as ts.HasModifiers)?.some((x) => x.kind === ts.SyntaxKind.AbstractKeyword);
      const impls = abstracto ? (implementan.get(c) ?? []).filter((k) => k.name && k.members.some((x) => nombreMiembro(x) === m)) : [];
      if (impls.length) return impls.map((k) => ({ archivo: rel(k.getSourceFile()), simbolo: k.name!.text + "." + m }));
      return [{ archivo: rel(sf), simbolo: c.name.text + "." + m }];
    }
    return [];
  };
  /**
   * El receptor está tipado explícitamente como `any` (`private readonly cola: any`, `(x: any) => x.y()`): la llamada
   * existe pero no se sabe a dónde va. Lo inferido o de librerías no cuenta (sin lib, todo eso es desconocido).
   */
  const receptorAny = (e: ts.PropertyAccessExpression): boolean => {
    const r = e.expression;
    const n = ts.isPropertyAccessExpression(r) ? r.name : ts.isIdentifier(r) ? r : null;
    const d = n ? checker.getSymbolAtLocation(n)?.declarations?.[0] : undefined;
    const tipo = d && (ts.isParameter(d) || ts.isPropertyDeclaration(d) || ts.isVariableDeclaration(d) || ts.isPropertySignature(d)) ? d.type : undefined;
    return tipo?.kind === ts.SyntaxKind.AnyKeyword;
  };
  /** La expresión es un valor que se entrega (argumento, propiedad de un objeto, atributo JSX o retorno), no algo que se llama ni un receptor. */
  const comoValor = (n: ts.Expression): boolean => {
    const p = n.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === n) return false;
    if (ts.isIdentifier(n) && ts.isPropertyAccessExpression(p)) return false;
    return (
      ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression !== n && !!p.arguments?.includes(n)) ||
      (ts.isPropertyAssignment(p) && p.initializer === n) ||
      ts.isShorthandPropertyAssignment(p) ||
      ts.isJsxExpression(p) ||
      (ts.isArrowFunction(p) && p.body === n)
    );
  };
  const esFuncion = (d: ts.Declaration): boolean =>
    ts.isFunctionDeclaration(d) ||
    ts.isMethodDeclaration(d) ||
    (ts.isPropertyAssignment(d) && !!funcionLiteral(d.initializer)) ||
    (ts.isVariableDeclaration(d) && !!funcionLiteral(d.initializer));
  const invocacionesDe = (
    cuerpo: ts.Node,
    desde: string,
    archivo: string,
    out: Map<string, { desde: string; archivo: string; simbolo: string; linea: number }>,
    sinResolver?: LlamadaSinResolver[],
  ) => {
    const agregar = (d: ts.Declaration, n: ts.Node) => {
      for (const t of destinos(d)) {
        if (t.archivo === archivo && t.simbolo === desde) continue;
        // Cada llamada con su línea: `quien_llama` las cita todas; el recorrido sigue un paso por destino.
        const l = linea(n), k = `${desde}\u0000${t.archivo}\u0000${t.simbolo}\u0000${l}`;
        if (!out.has(k)) out.set(k, { desde, archivo: t.archivo, simbolo: t.simbolo, linea: l });
      }
    };
    // `export const api = { crear, listar: traerPedidos }`: la propiedad es otro nombre de esa función.
    const seguir = (d: ts.Declaration | undefined): ts.Declaration | undefined => {
      for (let i = 0; d && i < 3; i++) {
        const s = ts.isShorthandPropertyAssignment(d) ? checker.getShorthandAssignmentValueSymbol(d) : ts.isPropertyAssignment(d) && ts.isIdentifier(d.initializer) ? checker.getSymbolAtLocation(d.initializer) : undefined;
        const t = s ? real(s)?.declarations?.[0] : undefined;
        if (!t) break;
        d = t;
      }
      return d;
    };
    const ver = (n: ts.Node): void => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const e = n.expression;
        const nombre = ts.isPropertyAccessExpression(e) ? e.name : ts.isIdentifier(e) ? e : null;
        const d = seguir(nombre ? real(checker.getSymbolAtLocation(nombre))?.declarations?.[0] : undefined);
        if (sinResolver && ts.isPropertyAccessExpression(e)) {
          // Un método de un objeto `any`, o de una interfaz del repo que ninguna clase conocida implementa.
          const c = d ? contenedor(d) : null;
          const huerfana = !!d && delRepo(d.getSourceFile()) && (ts.isMethodSignature(d) || ts.isPropertySignature(d)) && !!c && !(implementan.get(c)?.length);
          if ((!d && receptorAny(e)) || huerfana) sinResolver.push({ desde, linea: linea(n), llamada: e.getText().replace(/\s+/g, " ").slice(0, 80) });
        }
        if (d) agregar(d, n);
      } else if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /^[A-Z]/.test(n.tagName.getText().split(".").pop()!)) {
        // `<Formulario />` dibuja (llama) al componente.
        const t = n.tagName;
        const d = ts.isIdentifier(t) || ts.isPropertyAccessExpression(t) ? declDe(t) : undefined;
        if (d && (esFuncion(d) || ts.isClassDeclaration(d))) agregar(d, n);
      } else if ((ts.isPropertyAccessExpression(n) || ts.isIdentifier(n)) && comoValor(n)) {
        // Una función pasada como valor (`mutationFn: api.remove`, `onClick={guardar}`, `.then(procesar)`) se va a llamar.
        const d = real(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n) ? n.name : n))?.declarations?.[0];
        if (d && esFuncion(d)) agregar(d, n);
      }
      ts.forEachChild(n, ver);
    };
    ver(cuerpo);
  };

  /**
   * Símbolo de nivel superior que no se invoca y que nombra un identificador: tipo, interfaz, enum, clase o constante
   * (`const` que no es una función) del repo. Las funciones ya están en `invoca`.
   */
  const referido = (id: ts.Identifier): { archivo: string; simbolo: string } | null => {
    const p = id.parent;
    // `a.b`: `b` es un miembro, nunca un símbolo de nivel superior.
    if ((ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) && (p as ts.PropertyAccessExpression).name === id) return null;
    const d = resolver(id)?.declarations?.[0];
    if (!d) return null;
    const sf = d.getSourceFile();
    if (!delRepo(sf)) return null;
    if ((ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isEnumDeclaration(d) || ts.isClassDeclaration(d)) && d.name && ts.isSourceFile(d.parent)) return { archivo: rel(sf), simbolo: d.name.text };
    if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && !funcionLiteral(d.initializer) && d.parent.flags & ts.NodeFlags.Const && ts.isVariableStatement(d.parent.parent) && ts.isSourceFile(d.parent.parent.parent)) {
      return { archivo: rel(sf), simbolo: d.name.text };
    }
    return null;
  };
  /** Referencias de `nodo` (atribuidas a `desde`) a tipos, interfaces, enums, clases y constantes del repo. */
  const referenciasDe = (nodo: ts.Node, desde: string, archivo: string, out: Map<string, Referencia>) => {
    const ver = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const r = referido(n);
        if (r && !(r.archivo === archivo && r.simbolo === desde)) {
          const k = `${desde}\u0000${r.archivo}\u0000${r.simbolo}`;
          if (!out.has(k)) out.set(k, { desde, archivo: r.archivo, simbolo: r.simbolo, linea: linea(n) });
        }
        return;
      }
      ts.forEachChild(n, ver);
    };
    ver(nodo);
  };
  /** Cada parte de una sentencia de nivel superior con el símbolo al que pertenece (el mismo nombre que en `simbolos`). */
  const partesDe = (st: ts.Statement): Array<[ts.Node, string]> => {
    if (ts.isFunctionDeclaration(st) && st.name) return [[st, st.name.text]];
    if ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) return [[st, st.name.text]];
    if (ts.isClassDeclaration(st) && st.name) {
      const c = st.name.text;
      // Los decoradores de la clase quedan afuera: son registro (`@Module({ providers: [X] })`), no uso; el cambio de
      // un servicio no alcanza al módulo que lo declara. Los de un método sí cuentan (un guard, un pipe, un DTO).
      const out: Array<[ts.Node, string]> = [...(st.heritageClauses ?? []), ...(st.typeParameters ?? [])].map((n) => [n, c] as [ts.Node, string]);
      for (const m of st.members) {
        const nm = nombreMiembro(m);
        out.push([m, nm && esFuncionMiembro(m) ? `${c}.${nm}` : c]);
      }
      return out;
    }
    if (!ts.isVariableStatement(st)) return [];
    const out: Array<[ts.Node, string]> = [];
    const constante = !!(st.declarationList.flags & ts.NodeFlags.Const);
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const nombre = d.name.text;
      if (funcionLiteral(d.initializer)) {
        out.push([d, nombre]);
        continue;
      }
      let o: ts.Expression = d.initializer;
      while (ts.isAsExpression(o) || ts.isSatisfiesExpression(o) || ts.isParenthesizedExpression(o)) o = o.expression;
      const fns = ts.isObjectLiteralExpression(o) ? funcionesDeObjeto(o) : [];
      if (fns.length) {
        const propias = new Map(fns.map(([m, nodo]) => [nodo, `${nombre}.${m}`]));
        if (d.type) out.push([d.type, nombre]);
        for (const p of (o as ts.ObjectLiteralExpression).properties) out.push([p, propias.get(p) ?? nombre]);
        if (ts.isAsExpression(d.initializer) || ts.isSatisfiesExpression(d.initializer)) out.push([d.initializer.type, nombre]);
      } else if (constante) out.push([d, nombre]);
    }
    return out;
  };

  // ---------- Eventos y colas ----------
  // Quien publica con una clave (`emit("x")`, `enqueue(JOB)`) llama, en diferido, a quien se suscribe con la misma
  // clave (`@OnEvent("x")`, `on("x", h)`, `register(JOB, { handle })`). La clave es un literal o una constante del
  // repo (la misma declaración en los dos lados), así un `Set.add(x)` no se confunde con una cola.
  const porRuta = new Map<string, ArchivoCrudo>();
  const publicaciones: Array<{ clave: string; texto: string; archivo: string; desde: string; linea: number }> = [];
  const suscripciones = new Map<string, Array<{ archivo: string; simbolo: string }>>();
  /** Cada publicación y suscripción vista, para el contrato de eventos. `fuerte`: la forma no deja dudas de que es un mensaje. */
  const mensajesVistos: Array<{ clave: string; nombre: string; archivo: string; linea: number; direccion: "publica" | "consume"; fuerte: boolean }> = [];
  const nombreMensaje = (k: { clave: string; texto: string }) => (k.clave.startsWith("s:") ? k.clave.slice(2) : k.texto);
  /** Verbos que solo se usan para publicar; `add`, `send`, `trigger` y `fire` también nombran otras cosas. */
  const PUBLICA_FUERTE = new Set(["emit", "emitAsync", "publish", "enqueue", "produce", "dispatch"]);
  const claveMensaje = (e: ts.Expression | undefined): { clave: string; texto: string } | null => {
    if (!e) return null;
    if (ts.isStringLiteralLike(e)) return e.text ? { clave: `s:${e.text}`, texto: `"${e.text}"` } : null;
    if (!ts.isIdentifier(e) && !ts.isPropertyAccessExpression(e)) return null;
    const d = declDe(e);
    if (!d || !delRepo(d.getSourceFile())) return null;
    const ini = ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isEnumMember(d) ? d.initializer : undefined;
    if (ini && ts.isStringLiteralLike(ini)) return { clave: `s:${ini.text}`, texto: e.getText() };
    return { clave: `d:${rel(d.getSourceFile())}:${d.pos}`, texto: e.getText() };
  };
  const simboloContenedor = (n: ts.Node): string | null => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isClassElement(p) && p.parent && ts.isClassDeclaration(p.parent) && p.parent.name && ts.isSourceFile(p.parent.parent)) {
        const m = nombreMiembro(p);
        return m && esFuncionMiembro(p) ? `${p.parent.name.text}.${m}` : null;
      }
      if (ts.isFunctionDeclaration(p) && p.name && ts.isSourceFile(p.parent)) return p.name.text;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && funcionLiteral(p.initializer)) {
        if (ts.isVariableStatement(p.parent.parent) && ts.isSourceFile(p.parent.parent.parent)) return p.name.text;
      }
    }
    return null;
  };
  const HANDLER = ["handle", "handler", "process", "run", "execute", "perform", "consume"];
  const destinosHandler = (e: ts.Expression, archivo: string): Array<{ archivo: string; simbolo: string }> => {
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
      const tmp = new Map<string, { desde: string; archivo: string; simbolo: string; linea: number }>();
      invocacionesDe(e.body, "\u0000", archivo, tmp);
      return [...tmp.values()].map(({ archivo: a, simbolo }) => ({ archivo: a, simbolo }));
    }
    if (ts.isObjectLiteralExpression(e)) {
      const p = HANDLER.map((h) => propiedad(e, h)).find(Boolean);
      if (p) return destinosHandler(p, archivo);
      const m = e.properties.find((x) => ts.isMethodDeclaration(x) && x.name && HANDLER.includes(x.name.getText()));
      if (m && ts.isMethodDeclaration(m) && m.body) {
        const tmp = new Map<string, { desde: string; archivo: string; simbolo: string; linea: number }>();
        invocacionesDe(m.body, "\u0000", archivo, tmp);
        return [...tmp.values()].map(({ archivo: a, simbolo }) => ({ archivo: a, simbolo }));
      }
      return [];
    }
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "bind") return destinosHandler(e.expression.expression, archivo);
    const d = declDe(e);
    return d ? destinos(d) : [];
  };
  const PUBLICA = new Set(["emit", "emitAsync", "publish", "enqueue", "add", "send", "dispatch", "trigger", "produce", "fire"]);
  const SUSCRIBE = new Set(["on", "once", "addListener", "subscribe", "register", "registerHandler", "handle", "process", "consume", "listen"]);
  const DECORADORES = ["OnEvent", "Process", "EventPattern", "MessagePattern", "Subscribe", "SqsMessageHandler", "OnQueueEvent"];
  const suscribir = (clave: string, t: Array<{ archivo: string; simbolo: string }>) => suscripciones.set(clave, [...(suscripciones.get(clave) ?? []), ...t]);
  const mensajes = (n: ts.Node, archivo: string) => {
    if (ts.isMethodDeclaration(n) && ts.isClassDeclaration(n.parent) && n.parent.name) {
      for (const nd of DECORADORES) {
        const d = decorador(n, nd);
        const k = d && ts.isCallExpression(d) ? claveMensaje(d.arguments[0]) : null;
        const m = nombreMiembro(n);
        if (k && m) {
          suscribir(k.clave, [{ archivo, simbolo: `${n.parent.name.text}.${m}` }]);
          mensajesVistos.push({ clave: k.clave, nombre: nombreMensaje(k), archivo, linea: linea(n), direccion: "consume", fuerte: true });
        }
      }
    }
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || !n.arguments.length) return;
    const metodo = n.expression.name.text;
    if (PUBLICA.has(metodo)) {
      const k = claveMensaje(n.arguments[0]);
      const desde = k ? simboloContenedor(n) : null;
      if (k && desde) {
        publicaciones.push({ ...k, archivo, desde, linea: linea(n) });
        mensajesVistos.push({ clave: k.clave, nombre: nombreMensaje(k), archivo, linea: linea(n), direccion: "publica", fuerte: PUBLICA_FUERTE.has(metodo) });
      }
    }
    if (SUSCRIBE.has(metodo) && n.arguments.length >= 2) {
      const k = claveMensaje(n.arguments[0]);
      if (k) {
        suscribir(k.clave, destinosHandler(n.arguments[1]!, archivo));
        mensajesVistos.push({ clave: k.clave, nombre: nombreMensaje(k), archivo, linea: linea(n), direccion: "consume", fuerte: false });
      }
    }
  };

  // ---------- Pantallas y navegación del front ----------
  /** Ruta de navegación evaluada estáticamente (`ROUTES.x`, `buildPath(ROUTES.y, {id})`, "/a/" + id). */
  /** Rutas posibles de una expresión: las dos ramas de `a ?? b`, `a || b` y `c ? a : b`. */
  const rutasFront = (e: ts.Expression | undefined): string[] => {
    if (!e) return [];
    let x = e;
    while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x)) x = x.expression;
    if (ts.isConditionalExpression(x)) return [...rutasFront(x.whenTrue), ...rutasFront(x.whenFalse)];
    if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return [...rutasFront(x.left), ...rutasFront(x.right)];
    }
    const r = rutaFront(x);
    return r ? [r] : [];
  };
  const rutaFront = (e: ts.Expression | undefined): string | null => {
    if (!e) return null;
    const partes = evaluar(e);
    if (!partes.length || !("lit" in partes[0]!)) return null;
    const t = partes.map((p) => ("lit" in p ? p.lit : `{${/^[A-Za-z_]\w*$/.test(p.din.split(/\W+/).filter(Boolean).pop() ?? "") ? p.din.split(/\W+/).filter(Boolean).pop() : "param"}}`)).join("");
    // Vacía (`path: ""`, la hija por defecto) o relativa con parámetro (`path: ":id"`): valen como ruta hija.
    if (t === "") return "";
    return /^[/\w{:]/.test(t) && !/^https?:/.test(t) && !/\s/.test(t) ? t.split(/[?#]/)[0]! : null;
  };
  const MARCAS_PANTALLA = ["element", "Component", "component", "lazy", "loadComponent"];
  const esObjetoRuta = (o: ts.ObjectLiteralExpression) => !!propiedad(o, "path") || propiedad(o, "index")?.kind === ts.SyntaxKind.TrueKeyword;
  /** Componente (función o clase del repo) de una expresión: `<X />`, `X`, `lazy(() => import("./x"), m => m.X)`. */
  /** Si el módulo es un componente de un solo archivo del repo, su función sintética. */
  const componenteSfc = (modulo: ts.Symbol): RefSimbolo | null => {
    const sf = modulo.valueDeclaration ?? modulo.declarations?.[0];
    if (!sf || !ts.isSourceFile(sf) || !delRepo(sf)) return null;
    const archivo = rel(sf);
    return EXT_SFC.test(archivo) ? { archivo, simbolo: nombreSfc(archivo) } : null;
  };
  const componenteDe = (e: ts.Expression | undefined): RefSimbolo | null => {
    if (!e) return null;
    let x: ts.Expression = e;
    while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
    // `render={() => <X />}` (React Router v5): el componente es lo que dibuja la función.
    if ((ts.isArrowFunction(x) || ts.isFunctionExpression(x)) && !ts.isBlock(x.body)) {
      const cuerpo = x.body;
      if (ts.isJsxSelfClosingElement(cuerpo) || ts.isJsxElement(cuerpo) || ts.isParenthesizedExpression(cuerpo)) return componenteDe(cuerpo);
    }
    if (ts.isJsxSelfClosingElement(x) || ts.isJsxElement(x)) {
      const tag = ts.isJsxElement(x) ? x.openingElement.tagName : x.tagName;
      // Por la misma vía que un identificador: así `const X = lazy(() => import("./X"))` llega al componente real.
      return ts.isIdentifier(tag) || ts.isPropertyAccessExpression(tag) ? componenteDe(tag) : null;
    }
    if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x)) {
      // `import ReservasView from "./ReservasView.vue"`: el componente es el archivo.
      const imp = checker.getSymbolAtLocation(ts.isIdentifier(x) ? x : x.name)?.declarations?.[0];
      const decl = imp && (ts.isImportClause(imp) ? imp.parent : ts.isImportSpecifier(imp) ? imp.parent.parent.parent : null);
      if (decl && ts.isImportDeclaration(decl)) {
        const m = checker.getSymbolAtLocation(decl.moduleSpecifier);
        const c = m ? componenteSfc(m) : null;
        if (c) return c;
      }
      const d = declDe(x);
      if (d && (esFuncion(d) || ts.isClassDeclaration(d))) return destinos(d)[0] ?? null;
      // `lazy: zoneScreen` con `const zoneScreen = lazyScreen(…)`: se mira su valor.
      return d && ts.isVariableDeclaration(d) && d.initializer && d.getSourceFile() === x.getSourceFile() ? componenteDe(d.initializer) : null;
    }
    // Carga diferida: el módulo del `import("…")` y el nombre que se elige (`m => m.X`, `.then(m => m.X)`), o el default.
    let modulo: ts.Symbol | undefined;
    let elegido: string | null = null;
    const ver = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && !modulo) modulo = checker.getSymbolAtLocation(n.arguments[0]);
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parameters.length === 1 && !ts.isBlock(n.body)) {
        const b = n.body;
        const p = n.parameters[0]!.name;
        if (ts.isPropertyAccessExpression(b) && ts.isIdentifier(b.expression) && ts.isIdentifier(p) && b.expression.text === p.text) elegido ??= b.name.text;
      }
      ts.forEachChild(n, ver);
    };
    ver(x);
    if (!modulo) return null;
    const sfcDe = componenteSfc(modulo);
    if (sfcDe) return sfcDe;
    const exp = checker.getExportsOfModule(modulo).find((s) => s.name === (elegido ?? "default"));
    const d = real(exp)?.declarations?.[0];
    if (!d) return null;
    const dd = ts.isExportAssignment(d) && ts.isIdentifier(d.expression) ? declDe(d.expression) : d;
    return dd ? (destinos(dd)[0] ?? null) : null;
  };
  /** `<Route>` y envolturas propias que terminan en `Route` (`<LayoutRoute>`, `<PrivateRoute>`), no `<Routes>`/`<Router>`. */
  const esTagRuta = (t: string) => /^[\w.]*Route$/.test(t);
  const tagJsx = (x: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(x) ? x.openingElement : x).tagName.getText();
  /** ¿Hay alguna ruta dentro de este elemento? Entonces es un layout que envuelve rutas, no una pantalla. */
  const contieneRutas = (el: ts.Node): boolean => {
    let hay = false;
    const ver = (x: ts.Node): void => {
      if (hay) return;
      if ((ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x)) && x !== el && esTagRuta(tagJsx(x))) hay = true;
      else ts.forEachChild(x, ver);
    };
    ts.forEachChild(el, ver);
    return hay;
  };
  /** Primer hijo dibujado: `<Route path="/x"><X /></Route>` (v5) o `<Stack.Screen name="x">{(p) => <X {...p} />}</Stack.Screen>`. */
  const hijoDibujado = (el: ts.JsxElement): ts.Expression | undefined => {
    for (const c of el.children) {
      if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) return c;
      if (ts.isJsxExpression(c) && c.expression) return c.expression;
    }
    return undefined;
  };
  /**
   * Lo que dibuja una ruta, sin los marcos que lo envuelven: `<Marco titulo="x"><Pagina /></Marco>` o
   * `{() => <Proveedor><Pagina /></Proveedor>}`. La pantalla es la página de adentro; el marco y el proveedor son
   * envolturas. Solo se baja mientras haya un único hijo dibujado: con varios, no se sabe cuál es la página.
   */
  const capas = (e: ts.Expression | undefined): { comp: RefSimbolo | null; marcos: RefSimbolo[] } => {
    const abrir = (x: ts.Expression): ts.Expression => {
      while (ts.isParenthesizedExpression(x) || ((ts.isArrowFunction(x) || ts.isFunctionExpression(x)) && !ts.isBlock(x.body))) x = ts.isParenthesizedExpression(x) ? x.expression : (x.body as ts.Expression);
      return x;
    };
    if (!e) return { comp: null, marcos: [] };
    let x = abrir(e);
    const marcos: RefSimbolo[] = [];
    while (ts.isJsxElement(x)) {
      const hijos = x.children.filter((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || (ts.isJsxExpression(c) && !!c.expression) || ts.isJsxFragment(c));
      if (hijos.length !== 1) break;
      const h = hijos[0]!;
      const dentro = ts.isJsxExpression(h) ? abrir(h.expression!) : (h as ts.Expression);
      if (!ts.isJsxElement(dentro) && !ts.isJsxSelfClosingElement(dentro)) break;
      const marco = componenteDe(x.openingElement.tagName as ts.Expression);
      if (marco) marcos.push(marco);
      x = dentro;
    }
    const comp = componenteDe(x);
    // Si adentro no hay un componente del repo (`<div>`), la pantalla es el último marco.
    if (!comp) return { comp: marcos.pop() ?? componenteDe(e), marcos };
    return { comp, marcos };
  };
  /** `<Redirect>`/`<Navigate>` (o una función que los devuelve): no es una pantalla. */
  const esRedireccion = (e: ts.Expression): boolean => {
    let x: ts.Node = e;
    while (ts.isParenthesizedExpression(x) || ((ts.isArrowFunction(x) || ts.isFunctionExpression(x)) && !ts.isBlock(x.body))) x = ts.isParenthesizedExpression(x) ? x.expression : x.body;
    return (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x)) && /^(Navigate|Redirect)$/.test(tagJsx(x));
  };
  /** Rutas del router: objetos `{ path, element | Component | lazy | … }`, `<Route path element>` (v6) o `<Route path component | render>`
   * y `<Route path><X /></Route>` (v5), y `<X.Screen name component>` de React Navigation, con el path de sus padres. */
  const pantallas = (n: ts.Node, archivo: string, paquete: string) => {
    let path: string | null = null;
    let comp: RefSimbolo | null = null;
    let marca = false;
    let envolturaPropia: RefSimbolo | null = null;
    let marcos: RefSimbolo[] = [];
    const tomar = (v: ts.Expression | undefined) => {
      if (comp) return;
      const c = capas(v);
      comp = c.comp;
      if (comp) marcos = c.marcos;
    };
    // Una ruta con hijas es un layout (`AppShell`): envuelve a sus pantallas, no es una.
    if (ts.isObjectLiteralExpression(n) && esObjetoRuta(n) && !propiedad(n, "children")) {
      const pe = propiedad(n, "path");
      path = pe ? rutaFront(pe) : "";
      for (const m of MARCAS_PANTALLA) {
        const v = propiedad(n, m);
        if (v) {
          marca = true;
          tomar(v);
        }
      }
    } else if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tag = n.tagName.getText();
      const attr = (k: string) => n.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === k);
      const valor = (a: ts.JsxAttribute | undefined) => (a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer : undefined);
      const hijo = ts.isJsxOpeningElement(n) ? hijoDibujado(n.parent) : undefined;
      if (usaRouter && esTagRuta(tag) && !(ts.isJsxOpeningElement(n) && contieneRutas(n.parent))) {
        const pa = attr("path");
        if (!pa && !attr("index")) return;
        path = pa ? rutaFront(valor(pa)) : "";
        for (const v of [...["element", "Component", "component", "render"].map((m) => valor(attr(m))), hijo]) {
          if (!v || esRedireccion(v)) continue;
          marca = true;
          tomar(v);
        }
        // `<LayoutRoute component={X}>`: la envoltura propia dibuja la pantalla dentro de su layout o guarda.
        if (tag !== "Route") envolturaPropia = componenteDe(n.tagName as ts.Expression);
      } else if (usaNavegacionNativa && /\.Screen$/.test(tag)) {
        const nombre = rutaFront(valor(attr("name")));
        if (!nombre) return;
        path = "/" + nombre.replace(/^\//, "");
        marca = true;
        for (const v of [valor(attr("component")), valor(attr("getComponent")), hijo]) tomar(v);
      } else return;
    } else return;
    if (path === null || !marca) return;
    // Padres: objetos con `children` (o `<Route>` anidados). Sin path: guardas o layouts que envuelven a la pantalla.
    const envuelta: RefSimbolo[] = [];
    let completa = path;
    const saltos = new Set<ts.Node>();
    let ancla: ts.Node = n;
    for (let p: ts.Node | undefined = n.parent; p && !ts.isSourceFile(p); p = p.parent) {
      // Rutas en una constante aparte (`const appRoutes = [...]` y después `children: appRoutes`): se sigue desde donde se usa.
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && !saltos.has(p)) {
        saltos.add(p);
        const nombreVar = p.name;
        const sym = checker.getSymbolAtLocation(nombreVar);
        let uso: ts.Node | undefined;
        const buscar = (x: ts.Node): void => {
          if (uso) return;
          if (ts.isIdentifier(x) && x !== nombreVar && checker.getSymbolAtLocation(x) === sym) uso = x;
          else ts.forEachChild(x, buscar);
        };
        if (sym) buscar(p.getSourceFile());
        if (uso) p = ancla = uso;
        continue;
      }
      let padre: { path: string | null; elemento: ts.Expression | undefined } | null = null;
      if (ts.isObjectLiteralExpression(p) && p !== n) {
        const hijos = propiedad(p, "children");
        if (hijos && hijos.pos <= ancla.pos && ancla.end <= hijos.end) {
          const pe = propiedad(p, "path");
          padre = { path: pe ? rutaFront(pe) : null, elemento: propiedad(p, "element") ?? propiedad(p, "Component") ?? propiedad(p, "component") };
        }
      } else if (ts.isJsxElement(p) && p.openingElement !== n && esTagRuta(p.openingElement.tagName.getText())) {
        const at = (k: string) => p.openingElement.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === k);
        const v = (a: ts.JsxAttribute | undefined) => (a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer : undefined);
        padre = { path: at("path") ? rutaFront(v(at("path"))) : null, elemento: v(at("element")) ?? v(at("component")) ?? hijoDibujado(p) };
      }
      if (!padre) continue;
      const c = componenteDe(padre.elemento);
      if (c) envuelta.unshift(c);
      if (padre.path !== null && !completa.startsWith("/")) completa = `${padre.path.replace(/\/$/, "")}/${completa}`;
    }
    if (envolturaPropia) envuelta.push(envolturaPropia);
    envuelta.push(...marcos);
    out.pantallas.push({ paquete, ruta: normalizarRuta(completa || "/"), archivo, linea: linea(n), componente: comp, envuelta });
    // Ruta con nombre (`{ path, name: "reservar", component }`): se navega a ella por el nombre.
    const nm = ts.isObjectLiteralExpression(n) ? propiedad(n, "name") : undefined;
    if (nm && ts.isStringLiteralLike(nm)) rutasConNombre.set(`${paquete}\u0000${nm.text}`, normalizarRuta(completa || "/"));
  };
  /** Nombre de ruta → ruta, por paquete; las navegaciones por nombre se resuelven al final, con todas las rutas vistas. */
  const rutasConNombre = new Map<string, string>();
  const POR_NOMBRE = "\u0000nombre:";
  const NAVEGA = new Set(["navigate", "push", "replace", "redirect", "navigateByUrl", "navigateTo", "goto"]);
  const navegaciones = (n: ts.Node, archivo: string, paquete: string) => {
    const agregar = (destinos: string[], tipo: "navega" | "enlace" | "redirige") => {
      for (let destino of new Set(destinos)) {
        // React Navigation navega por nombre de pantalla (`navigate("homeScreen")`): su ruta es `/homeScreen`.
        if (usaNavegacionNativa && /^[A-Za-z_][\w-]*$/.test(destino)) destino = "/" + destino;
        const porNombre = destino.startsWith(POR_NOMBRE);
        if (!destino.startsWith("/") && !porNombre) continue;
        out.navegaciones.push({ paquete, archivo, linea: linea(n), desde: simboloContenedor(n), ruta: porNombre ? destino : normalizarRuta(destino), tipo });
      }
    };
    if (ts.isCallExpression(n) && n.arguments.length) {
      const e = n.expression;
      const nombre = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
      if (nombre && NAVEGA.has(nombre)) agregar(rutasFront(n.arguments[0]), nombre === "redirect" ? "redirige" : "navega");
      if (usaNavegacionNativa && nombre && (NAVEGA.has(nombre) || nombre === "reset") && ts.isObjectLiteralExpression(n.arguments[0]!)) {
        // `navigate({ name: "x", params })` y `reset({ index, routes: [{ name: "x" }] })`: la última pantalla nombrada.
        const nombres: string[] = [];
        const ver = (x: ts.Node): void => {
          if (ts.isPropertyAssignment(x) && x.name.getText() === "name") nombres.push(...rutasFront(x.initializer));
          ts.forEachChild(x, ver);
        };
        ver(n.arguments[0]!);
        if (nombres.length) agregar([nombres[nombres.length - 1]!], nombre === "navigate" || nombre === "push" ? "navega" : "redirige");
      } else if (nombre && NAVEGA.has(nombre) && ts.isObjectLiteralExpression(n.arguments[0]!)) {
        // `router.push({ name: "reservar", params })` (vue-router y otros routers con rutas nombradas).
        const nm = propiedad(n.arguments[0], "name");
        const pa = propiedad(n.arguments[0], "path");
        if (nm && ts.isStringLiteralLike(nm)) agregar([POR_NOMBRE + nm.text], "navega");
        else if (pa) agregar(rutasFront(pa), "navega");
      }
    } else if (ts.isJsxAttribute(n) && (n.name.getText() === "to" || n.name.getText() === "href") && n.initializer) {
      const v = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
      const tag = n.parent.parent.tagName.getText();
      if (tag !== "Route") agregar(rutasFront(v), /^(Navigate|Redirect)$/.test(tag) ? "redirige" : "enlace");
    } else if (ts.isPropertyAssignment(n) && /^(path|to|href|route)$/.test(n.name.getText()) && ts.isObjectLiteralExpression(n.parent)) {
      // Ítems de menú declarados como datos (`{ path: ROUTES.inicio, title }`), salvo las propias definiciones de rutas.
      const o = n.parent;
      if (!MARCAS_PANTALLA.some((m) => propiedad(o, m)) && !propiedad(o, "children")) agregar(rutasFront(n.initializer), "enlace");
    }
  };

  // ---------- Llamadas HTTP salientes: la forma de la llamada y las funciones que la envuelven ----------
  const formaSaliente = (call: ts.CallExpression): FormaSaliente | null => {
    const c = call.expression;
    let url: ts.Expression | undefined;
    let base: ts.Expression | null = null;
    let metodo = "GET";
    let cuerpo: ts.Expression | undefined;
    let config: ts.Expression | undefined;
    // Se sabe qué lleva: la config está escrita en la llamada (o no hay), no viene armada de otro lado.
    let directa = true;
    let separar = false;
    let claves: string[] | undefined;
    let respuesta: ts.TypeNode | undefined;
    // `fetch` global, o el que el framework le pasa a la función (`load({ fetch })` de SvelteKit, loaders de Remix).
    const fetchInyectado = (d: ts.Declaration | undefined) => !!d && (ts.isBindingElement(d) || ts.isParameter(d));
    if (ts.isIdentifier(c) && c.text === "fetch" && (!resolver(c)?.declarations?.length || fetchInyectado(resolver(c)?.declarations?.[0]))) {
      url = call.arguments[0];
      let init = call.arguments[1];
      // `fetch(url, { method: "POST", body } as any)`: las opciones también vienen envueltas en un cast.
      while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init) || ts.isTypeAssertionExpression(init))) init = init.expression;
      directa = !init || ts.isObjectLiteralExpression(init);
      if (init && ts.isObjectLiteralExpression(init)) {
        const m = propiedad(init, "method");
        if (m && ts.isStringLiteralLike(m)) metodo = m.text.toUpperCase();
        cuerpo = propiedad(init, "body");
      }
    } else if (ts.isPropertyAccessExpression(c) && ((METODOS_HTTP as readonly string[]).includes(c.name.text) || c.name.text === "request")) {
      const cl = clienteDe(c.expression);
      if (!cl || cl.tipo === "ofetch") return null;
      base = cl.baseURL;
      separar = !!cl.separar;
      directa = !call.arguments.some((a) => ts.isSpreadElement(a));
      if (c.name.text === "request") {
        // Angular `http.request("POST", url, { body, params })`.
        if (cl.tipo !== "angular") return null;
        const m = call.arguments[0];
        if (!m || !ts.isStringLiteralLike(m)) return null;
        metodo = m.text.toUpperCase();
        url = call.arguments[1];
        config = call.arguments[2];
        cuerpo = config && ts.isObjectLiteralExpression(config) ? propiedad(config, "body") : undefined;
      } else if (cl.tipo === "ky") {
        // ky: `ky.post(url, { json, searchParams })`; el cuerpo es `json` (o `body`).
        metodo = c.name.text.toUpperCase();
        url = call.arguments[0];
        config = call.arguments[1];
        if (config && ts.isObjectLiteralExpression(config)) cuerpo = propiedad(config, "json") ?? propiedad(config, "body");
        else directa = directa && !config;
        claves = ["searchParams"];
      } else {
        // axios y Angular: `m(url, body, config)` con cuerpo, `m(url, config)` sin.
        metodo = c.name.text.toUpperCase();
        url = call.arguments[0];
        const conCuerpo = ["post", "put", "patch"].includes(c.name.text);
        if (conCuerpo) cuerpo = call.arguments[1];
        config = call.arguments[conCuerpo ? 2 : 1];
        // Angular `delete(url, { body })`.
        if (!conCuerpo && cl.tipo === "angular" && config && ts.isObjectLiteralExpression(config)) cuerpo = propiedad(config, "body");
      }
    } else if (ts.isIdentifier(c) && /^use(Lazy)?Fetch$/.test(c.text) && globalNuxt(c)) {
      // Nuxt `useFetch(url, { method, body, query, baseURL })`; la URL puede venir como función (`() => \`/x/${id}\``).
      let u = call.arguments[0];
      if (u && (ts.isArrowFunction(u) || ts.isFunctionExpression(u))) u = ts.isArrowFunction(u) && !ts.isBlock(u.body) ? u.body : undefined;
      if (!u) return null;
      ({ url, metodo, cuerpo, config, base, directa } = opcionesFetch(u, call.arguments[1], null));
      claves = ["query", "params"];
    } else if (ts.isIdentifier(c) && clienteDe(c)) {
      const cl = clienteDe(c)!;
      if (cl.tipo === "angular") return null;
      if (cl.tipo === "axios") {
        const cfg = call.arguments[0];
        if (!cfg || !ts.isObjectLiteralExpression(cfg)) return null;
        url = propiedad(cfg, "url");
        const m = propiedad(cfg, "method");
        if (m && ts.isStringLiteralLike(m)) metodo = m.text.toUpperCase();
        cuerpo = propiedad(cfg, "data");
        config = cfg;
        base = cl.baseURL;
      } else {
        // `ky(url, { method, json })`, `$fetch(url, { method, body, query, baseURL })`.
        if (!call.arguments[0]) return null;
        ({ url, metodo, cuerpo, config, base, directa } = opcionesFetch(call.arguments[0], call.arguments[1], cl.baseURL));
        if (cl.tipo === "ky") {
          separar = true;
          cuerpo = config && ts.isObjectLiteralExpression(config) ? (propiedad(config, "json") ?? propiedad(config, "body")) : undefined;
          claves = ["searchParams"];
        } else claves = ["query", "params"];
      }
    } else return null;
    // ky: `ky.get(url).json<T>()` — el genérico de `.json<T>()` es el tipo de la respuesta.
    const pj = call.parent;
    if (ts.isPropertyAccessExpression(pj) && pj.expression === call && pj.name.text === "json" && ts.isCallExpression(pj.parent) && pj.parent.typeArguments?.[0]) respuesta = pj.parent.typeArguments[0];
    // `_method` en el cuerpo de un POST (Symfony, Laravel, Rails): el back lo atiende como ese método.
    if (metodo === "POST" && cuerpo) metodo = metodoSobrescrito(cuerpo, call) ?? metodo;
    return url ? { url, base, metodo, cuerpo, config, directa, ...(separar ? { separar } : {}), ...(claves ? { claves } : {}), ...(respuesta ? { respuesta } : {}) } : null;
  };
  /** Opciones al estilo `fetch` (`$fetch`, `useFetch`, `ky(url, init)`): método, cuerpo y `baseURL` de la llamada. */
  const opcionesFetch = (url: ts.Expression, opts: ts.Expression | undefined, base: ts.Expression | null) => {
    let init = opts;
    while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression;
    let metodo = "GET";
    let cuerpo: ts.Expression | undefined;
    if (init && ts.isObjectLiteralExpression(init)) {
      const m = propiedad(init, "method");
      if (m && ts.isStringLiteralLike(m)) metodo = m.text.toUpperCase();
      cuerpo = propiedad(init, "body");
      base = propiedad(init, "baseURL") ?? base;
    }
    return { url, metodo, cuerpo, config: init, base, directa: !init || ts.isObjectLiteralExpression(init) };
  };
  /** `{ _method: "PUT" }`, o un `FormData` al que la misma función le hace `.append("_method", "PUT")`. */
  /**
   * Lado de una llamada a partir de un tipo: su nombre y, si es un objeto con campos conocidos, sus campos de primer
   * nivel. Lo que no tiene campos que comparar queda sin `forma`: `any`/`unknown`, primitivos, arreglos, tipos de
   * librería (`FormData`, `Blob`, `URLSearchParams`) y objetos de claves libres (`Record<string, …>`).
   */
  const ladoDeTipo = (t: ts.Type, en: ts.Node, nombre: string): LadoLlamada => {
    const tipo = nombre.length > 80 ? `${nombre.slice(0, 77)}...` : nombre;
    const partes = (t.isUnion() ? t.types : [t]).filter((x) => !(x.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
    const sinCampos = (x: ts.Type) => {
      if (x.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.TypeParameter)) return true;
      if (!(x.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) || checker.isArrayType(x) || checker.isTupleType(x) || checker.getIndexInfosOfType(x).length) return true;
      const s = x.aliasSymbol ?? x.getSymbol();
      const d = s?.declarations?.[0];
      // Un tipo con nombre declarado fuera del repo es de una librería; un literal anónimo (`{ a: string }`) vale.
      return !!d && !delRepo(d.getSourceFile()) && !s!.name.startsWith("__");
    };
    if (!partes.length || partes.some(sinCampos)) return { tipo };
    const forma: Forma = {};
    const opcional = new Set<string>();
    const vistos = new Map<string, number>();
    for (const x of partes) {
      for (const p of checker.getPropertiesOfType(x)) {
        if (p.flags & ts.SymbolFlags.Method || p.name.startsWith("__")) continue;
        const pt = checker.getTypeOfSymbolAtLocation(p, en);
        const texto = limpiar(checker.typeToString(pt));
        vistos.set(p.name, (vistos.get(p.name) ?? 0) + 1);
        if (p.flags & ts.SymbolFlags.Optional || (pt.isUnion() && pt.types.some((y) => y.flags & ts.TypeFlags.Undefined))) opcional.add(p.name);
        forma[p.name] ??= /\bany\b/.test(texto) || texto.length > 80 ? "unknown" : texto;
      }
    }
    // Un campo que no está en todas las variantes de una unión puede faltar.
    for (const [k, n] of vistos) if (n < partes.length) opcional.add(k);
    const out: Forma = {};
    for (const k of Object.keys(forma).sort(cmp).slice(0, 60)) out[opcional.has(k) ? `${k}?` : k] = forma[k]!;
    return { tipo, forma: out };
  };
  const ladoDeExpr = (e: ts.Expression): LadoLlamada => {
    let x = e;
    if (ts.isCallExpression(x) && x.expression.getText() === "JSON.stringify" && x.arguments[0]) x = x.arguments[0];
    const t = checker.getTypeAtLocation(x);
    return ladoDeTipo(t, x, nombreTipoDeExpr(x) ?? limpiar(checker.typeToString(t)));
  };
  /** Claves de un texto `a=1&b=${x}` (un cuerpo `x-www-form-urlencoded` o la query de una URL), si lo es. */
  const clavesDeFormulario = (texto: string): Forma | null => {
    if (!/^[\w.[\]-]+=/.test(texto)) return null;
    const forma: Forma = {};
    for (const m of texto.matchAll(/(?:^|&)([\w.[\]-]+)=/g)) forma[m[1]!] = "string";
    return forma;
  };
  const sinVacio = (t: ts.Type) => (t.isUnion() ? t.types.filter((x) => !(x.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void))) : [t]);
  /**
   * Lo que una llamada manda (cuerpo), pasa por query (`params` de la config, o la query de la URL) y espera (el
   * genérico `<T>` de la respuesta). En una llamada directa (no una envoltura) sin cuerpo ni `params`, se sabe que no
   * manda nada: queda con forma vacía.
   */
  const camposDeLlamada = (call: ts.CallExpression, f: FormaSaliente): CamposLlamada | null => {
    const c: CamposLlamada = {};
    const conCuerpo = ["POST", "PUT", "PATCH"].includes(f.metodo);
    if (f.cuerpo) {
      const t = checker.getTypeAtLocation(f.cuerpo);
      const texto = ts.isStringLiteralLike(f.cuerpo) ? f.cuerpo.text : ts.isTemplateExpression(f.cuerpo) ? f.cuerpo.getText().slice(1, -1) : null;
      const formulario = texto !== null ? clavesDeFormulario(texto) : null;
      if (formulario) c.envia = { tipo: "formulario", forma: formulario };
      else if (!sinVacio(t).length) {
        if (conCuerpo && f.directa) c.envia = { tipo: "sin cuerpo", forma: {} };
      } else c.envia = ladoDeExpr(f.cuerpo);
    } else if (conCuerpo && f.directa) c.envia = { tipo: "sin cuerpo", forma: {} };
    // `params` de la config: por su tipo, así vale también una variable o un `cond ? { params } : undefined`.
    const enUrl = /\?(.*)$/.exec(f.url.getText().replace(/^[`'"]|[`'"]$/g, ""))?.[1];
    const deUrl = enUrl ? clavesDeFormulario(enUrl) : null;
    let query: LadoLlamada | null = null;
    if (f.config) {
      const tc = checker.getTypeAtLocation(f.config);
      const partes = sinVacio(tc);
      const claves = f.claves ?? ["params"];
      const conParams = partes.map((x) => claves.map((k) => x.getProperty(k)).find(Boolean)).filter((x): x is ts.Symbol => !!x);
      if (conParams.length) {
        const lados = conParams.map((x) => {
          const t = checker.getTypeOfSymbolAtLocation(x, f.config!);
          return ladoDeTipo(t, f.config!, limpiar(checker.typeToString(t)));
        });
        const params = ts.isObjectLiteralExpression(f.config) ? claves.map((k) => propiedad(f.config as ts.ObjectLiteralExpression, k)).find(Boolean) : undefined;
        const tipo = (params ? nombreTipoDeExpr(params) : null) ?? lados[0]!.tipo;
        if (lados.some((l) => !l.forma)) query = { tipo };
        else {
          const forma: Forma = {};
          for (const l of lados) for (const [k, v] of Object.entries(l.forma!)) forma[k] ??= v;
          // Si alguna variante de la config no lleva `params` (`cond ? { params } : undefined`), ningún campo es seguro.
          // (sin `strictNullChecks` el `undefined` no queda en el tipo: también se mira la forma de la expresión).
          let e: ts.Expression = f.config;
          while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
          const condicional = ts.isConditionalExpression(e) || (ts.isBinaryExpression(e) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind));
          const opcional = condicional || conParams.length < (tc.isUnion() ? tc.types.length : 1);
          query = { tipo, forma: opcional ? Object.fromEntries(Object.entries(forma).map(([k, v]) => [k.endsWith("?") ? k : `${k}?`, v])) : forma };
        }
      } else if (partes.every((x) => !(x.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)))) query = { tipo: "sin query", forma: {} };
    } else if (f.directa) query = { tipo: "sin query", forma: {} };
    if (deUrl) query = { tipo: query?.forma && Object.keys(query.forma).length ? query.tipo : "query de la URL", forma: { ...(query?.forma ?? {}), ...deUrl } };
    if (query && (query.tipo !== "sin query" || f.metodo === "GET")) c.query = query;
    // El `<T>` de una envoltura que lo transforma (`Envelope<T>` → `data.data`) no es la respuesta HTTP: no se usa.
    const gen = f.directa || f.generico ? (call.typeArguments?.[0] ?? f.respuesta) : undefined;
    if (gen) c.espera = ladoDeTipo(checker.getTypeFromTypeNode(gen), gen, limpiar(gen.getText()));
    return c.envia || c.query || c.espera ? c : null;
  };
  const metodoSobrescrito = (cuerpo: ts.Expression, call: ts.Node): string | null => {
    let c: ts.Expression = cuerpo;
    while (ts.isAsExpression(c) || ts.isParenthesizedExpression(c)) c = c.expression;
    const lit = (e: ts.Expression | undefined) => (e && ts.isStringLiteralLike(e) && /^(put|patch|delete)$/i.test(e.text) ? e.text.toUpperCase() : null);
    if (ts.isObjectLiteralExpression(c)) return lit(propiedad(c, "_method"));
    if (!ts.isIdentifier(c)) return null;
    let f: ts.Node | undefined = call.parent;
    while (f && !ts.isFunctionLike(f) && !ts.isSourceFile(f)) f = f.parent;
    let m: string | null = null;
    const ver = (n: ts.Node): void => {
      if (m) return;
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(append|set)$/.test(n.expression.name.text) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === (c as ts.Identifier).text) {
        const [k, v] = n.arguments;
        if (k && ts.isStringLiteralLike(k) && k.text === "_method") m = lit(v);
      }
      ts.forEachChild(n, ver);
    };
    if (f) ver(f);
    return m;
  };
  /** Si la expresión es un parámetro de una función con nombre, esa función (su declaración) y la posición del parámetro. */
  const parametroDe = (e: ts.Expression): { fn: ts.Node; idx: number } | null => {
    if (!ts.isIdentifier(e)) return null;
    const d = resolver(e)?.declarations?.[0];
    if (!d || !ts.isParameter(d)) return null;
    const f = d.parent;
    const idx = f.parameters.indexOf(d);
    if (idx < 0) return null;
    const nombrada = ts.isFunctionDeclaration(f) || ts.isMethodDeclaration(f) ? f : (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && (ts.isVariableDeclaration(f.parent) || ts.isPropertyAssignment(f.parent)) ? f.parent : null;
    return nombrada ? { fn: nombrada, idx } : null;
  };
  /**
   * Funciones del repo que envuelven una llamada HTTP pasándole la URL que reciben por parámetro
   * (`const get = (url) => cliente.get(url)`): la llamada real, con su ruta, está en quien las invoca.
   */
  /**
   * Una envoltura del repo: qué argumento es la URL, con qué método y base. `generico`: su `<T>` llega tal cual al
   * cliente HTTP (`get<T>(url) { return axios.get<T>(url) }`), así que es el tipo de la respuesta; si lo envuelve
   * (`axios.get<Envelope<T>>` y devuelve `data.data`), no lo es.
   */
  type Envoltura = { idx: number; metodo: string; base: ts.Expression | null; generico: boolean; separar?: boolean | undefined };
  const envolturas = new Map<ts.Node, Envoltura>();
  const genericoPropio = (call: ts.CallExpression) => {
    const g = call.typeArguments?.[0];
    const d = g && ts.isTypeReferenceNode(g) ? checker.getSymbolAtLocation(g.typeName)?.declarations?.[0] : undefined;
    return !!d && ts.isTypeParameterDeclaration(d);
  };
  const envolturaDe = (call: ts.CallExpression): Envoltura | null => {
    if (!envolturas.size) return null;
    const c = call.expression;
    const nombre = ts.isIdentifier(c) ? c : ts.isPropertyAccessExpression(c) ? c.name : null;
    const d = nombre ? resolver(nombre)?.declarations?.[0] : undefined;
    return d ? (envolturas.get(d) ?? null) : null;
  };
  // Dos vueltas más para las envolturas de envolturas (`apiGet` que llama a `get`).
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    let nuevas = 0;
    for (const sf of fuentes) {
      const ver = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const f = formaSaliente(n);
          const e = f ? null : envolturaDe(n);
          const url = f ? f.url : e ? n.arguments[e.idx] : undefined;
          const p = url ? parametroDe(url) : null;
          if (p && !envolturas.has(p.fn)) {
            envolturas.set(p.fn, { idx: p.idx, metodo: f ? f.metodo : e!.metodo, base: f ? f.base : e!.base, generico: genericoPropio(n) && (f ? true : e!.generico), separar: f ? f.separar : e!.separar });
            nuevas++;
          }
        }
        ts.forEachChild(n, ver);
      };
      ts.forEachChild(sf, ver);
    }
    if (!nuevas) break;
  }

  // ---------- Rutas por archivo (Next, Nuxt, SvelteKit, Expo Router) ----------
  // La ruta sale del camino del archivo: cada archivo de ruta es una pantalla, un layout o un endpoint (ver rutas-archivo.ts).
  const carpetasRuta = carpetasDeRutas(repo);
  const existe = new Set(repo.archivos);
  const hay = (a: string) => existe.has(a);
  const porArchivoRuta = new Map<string, { carpeta: CarpetaDeRutas | null; r: RutaDeArchivo }>();
  for (const a of repo.archivos) {
    for (const c of carpetasRuta) {
      const r = rutaDeArchivo(c, a, hay);
      if (r) porArchivoRuta.set(a, { carpeta: c, r });
    }
    if (carpetasRuta.some((c) => c.marco === "nuxt" && c.paquete === paqueteDe(repo, a))) {
      const r = endpointNuxt(paqueteDe(repo, a), a);
      if (r) porArchivoRuta.set(a, { carpeta: null, r });
    }
  }
  const paquetesConRutas = new Set(carpetasRuta.map((c) => c.paquete));
  /** El `export default` de un archivo de ruta sin nombre (`export default function () {}`, `defineEventHandler(…)`): su cuerpo. */
  const defaultAnonimo = (st: ts.Statement): ts.Node | null => {
    if (ts.isFunctionDeclaration(st) && !st.name && st.body && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return st.body;
    if (!ts.isExportAssignment(st) || st.isExportEquals) return null;
    let e: ts.Expression = st.expression;
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e.body;
    // `defineEventHandler(async (event) => …)`, `memo(() => …)`: la función que se pasa.
    if (ts.isCallExpression(e)) return e.arguments.map((a) => funcionLiteral(a)).find(Boolean)?.body ?? null;
    return null;
  };

  for (const sf of fuentes) {
    const archivo = rel(sf);
    const paquete = paqueteDe(repo, archivo);
    const simbolos: Simbolo[] = [];
    const formas = (out.formas[paquete] ??= {});

    // Símbolos, formas de tipos, imports e invocaciones.
    const invoca = new Map<string, { desde: string; archivo: string; simbolo: string; linea: number }>();
    const referencias = new Map<string, Referencia>();
    const sinResolver: LlamadaSinResolver[] = [];
    const importa = new Set<string>();
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) {
        simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "funcion", fin: finDe(st) });
        if (st.body) invocacionesDe(st.body, st.name.text, archivo, invoca, sinResolver);
      } else if (ts.isClassDeclaration(st) && st.name) {
        simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "clase", fin: finDe(st) });
        for (const m of st.members) {
          const nm = nombreMiembro(m);
          if (!nm || !esFuncionMiembro(m)) continue;
          const sim = st.name.text + "." + nm;
          // La línea del nombre, no la del primer decorador: es la que contiene el nombre del método.
          simbolos.push({ linea: linea(m.name!), nombre: sim, tipo: "metodo", fin: finDe(m) });
          // Solo el cuerpo: los decoradores del método (`@UseGuards(...)`) no son llamadas del método.
          const cuerpo = ts.isMethodDeclaration(m) ? m.body : (m as ts.PropertyDeclaration).initializer;
          if (cuerpo) invocacionesDe(cuerpo, sim, archivo, invoca, sinResolver);
        }
      } else if (ts.isInterfaceDeclaration(st)) simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "interfaz", fin: finDe(st) });
      else if (ts.isTypeAliasDeclaration(st)) simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "tipo", fin: finDe(st) });
      else if (ts.isEnumDeclaration(st)) simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "enum", fin: finDe(st) });
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const fl = ts.isIdentifier(d.name) ? funcionLiteral(d.initializer) : null;
          if (fl && ts.isIdentifier(d.name)) {
            simbolos.push({ linea: linea(st), nombre: d.name.text, tipo: "funcion", fin: finDe(st) });
            invocacionesDe(fl, d.name.text, archivo, invoca, sinResolver);
          } else if (ts.isIdentifier(d.name) && d.initializer) {
            // `const api = { remove: (id) => http.delete(…) }`: cada función del objeto es un símbolo `api.remove`.
            let o: ts.Expression = d.initializer;
            while (ts.isAsExpression(o) || ts.isSatisfiesExpression(o) || ts.isParenthesizedExpression(o)) o = o.expression;
            const fns = ts.isObjectLiteralExpression(o) ? funcionesDeObjeto(o) : [];
            // Una constante de nivel superior (`const LIMITE = 10`, `const ESTADOS = {…}`): sus usos van en `referencias`.
            if (!fns.length && st.declarationList.flags & ts.NodeFlags.Const) simbolos.push({ linea: linea(st), nombre: d.name.text, tipo: "constante", fin: finDe(st) });
            if (fns.length) simbolos.push({ linea: linea(st), nombre: d.name.text, tipo: "objeto", fin: finDe(st) });
            for (const [m, nodo, cuerpo] of fns) {
              const sim = `${d.name.text}.${m}`;
              simbolos.push({ linea: linea((nodo as ts.PropertyAssignment).name), nombre: sim, tipo: "metodo", fin: finDe(nodo) });
              invocacionesDe(cuerpo, sim, archivo, invoca, sinResolver);
            }
          }
        }
      }
      if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier) {
        const d = checker.getSymbolAtLocation(st.moduleSpecifier)?.declarations?.[0];
        if (d && ts.isSourceFile(d) && delRepo(d) && d !== sf) importa.add(rel(d));
      }
      const forma = formaDe(st);
      if (forma && !(forma.nombre in formas)) formas[forma.nombre] = forma.forma;
    }
    // Un archivo de ruta con un `export default` sin nombre: el símbolo `default`, con lo que hace su cuerpo.
    if (porArchivoRuta.has(archivo) && !EXT_SFC.test(archivo)) {
      for (const st of sf.statements) {
        const cuerpo = defaultAnonimo(st);
        if (!cuerpo) continue;
        simbolos.push({ linea: linea(st), nombre: "default", tipo: "funcion", fin: finDe(st) });
        invocacionesDe(cuerpo, "default", archivo, invoca, sinResolver);
      }
    }
    for (const st of sf.statements) for (const [n, desde] of partesDe(st)) referenciasDe(n, desde, archivo, referencias);
    // Un componente de un solo archivo es una función con el nombre del archivo, que abarca todo el archivo: tiene las
    // funciones de su `<script>` y hace lo que su código suelto hace (`onMounted(() => cargar())`). Así una pantalla
    // que lo dibuja llega a sus llamadas y navegaciones.
    if (EXT_SFC.test(archivo)) {
      const comp = nombreSfc(archivo);
      simbolos.push({ linea: 1, nombre: comp, tipo: "funcion", fin: sf.getLineAndCharacterOfPosition(sf.getEnd()).line });
      for (const st of sf.statements) {
        const propia = (ts.isFunctionDeclaration(st) && st.name) || (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => funcionLiteral(d.initializer)));
        if (!propia && !ts.isImportDeclaration(st)) invocacionesDe(st, comp, archivo, invoca, sinResolver);
        if (!partesDe(st).length && !ts.isImportDeclaration(st)) referenciasDe(st, comp, archivo, referencias);
      }
      // Las funciones del `<script>` que el código suelto no llama las usa el template (`@click="guardar"`): también son suyas.
      const llamadas = new Set([...invoca.values()].filter((i) => i.desde === comp && i.archivo === archivo).map((i) => i.simbolo));
      for (const f of simbolos) if (f.nombre !== comp && !llamadas.has(f.nombre) && (f.tipo === "funcion" || f.tipo === "objeto")) invoca.set(`${comp}\u0000${archivo}\u0000${f.nombre}`, { desde: comp, archivo, simbolo: f.nombre, linea: f.linea });
      // Navegaciones del template (fuera del `<script>`): enlaces y llamadas al router en los eventos.
      const original = readFileSync(join(repo.raiz, archivo), "utf8").split("\n");
      const script = scriptDeSfc(original.join("\n")).split("\n");
      original.forEach((l, i) => {
        if (script[i]!.trim()) return;
        const enlace = (ruta: string) => out.navegaciones.push({ paquete, archivo, linea: i + 1, desde: comp, ruta, tipo: "enlace" });
        for (const m of l.matchAll(/(?:^|\s)(:?to|href)\s*=\s*"\s*'?(\/[^"'\s{]*)/g)) enlace(normalizarRuta(m[2]!));
        // `:to="\`/clubes/\${c.id}\`"`: cada `\${…}` es un parámetro con el nombre de lo último que usa.
        for (const m of l.matchAll(/(?:^|\s):(?:to|href)\s*=\s*"\s*`(\/[^`"]*)`/g)) enlace(normalizarRuta(m[1]!.replace(/\$\{([^}]*)\}/g, (_, e: string) => `{${e.split(/\W+/).filter(Boolean).pop() ?? "param"}}`)));
        // `:to="{ name: 'pago-reserva', params }"`: por el nombre de la ruta.
        for (const m of l.matchAll(/(?:^|\s):(?:to|href)\s*=\s*"\s*\{[^"]*?\bname\s*:\s*'([^']+)'/g)) enlace(POR_NOMBRE + m[1]!);
        for (const m of l.matchAll(/\b(?:\$?router\.(?:push|replace)|navigateTo|goto)\(\s*['"`](\/[^'"`$]*)['"`]/g)) out.navegaciones.push({ paquete, archivo, linea: i + 1, desde: comp, ruta: normalizarRuta(m[1]!), tipo: "navega" });
      });
    }
    const usaPaquetes = usosDePaquetes(sf, simbolos, EXT_SFC.test(archivo) ? nombreSfc(archivo) : null, archivo);
    const componentes = libreriaDeArchivo(archivo) ? componentesExportados(sf, archivo) : [];
    simbolos.sort((a, b) => a.linea - b.linea || cmp(a.nombre, b.nombre));
    const arc: ArchivoCrudo = { lenguaje: lenguajeDe(archivo), ruta: archivo, simbolos };
    if (componentes.length) arc.componentes = componentes;
    if (usaPaquetes.length) arc.usaPaquetes = usaPaquetes;
    if (importa.size) arc.importa = [...importa].sort(cmp);
    if (invoca.size) arc.invoca = [...invoca.values()];
    const llamados = new Set([...invoca.values()].map((i) => `${i.desde}\u0000${i.archivo}\u0000${i.simbolo}`));
    const refs = [...referencias.entries()].filter(([k]) => !llamados.has(k)).map(([, r]) => r);
    if (refs.length) arc.referencias = refs.sort((a, b) => a.linea - b.linea || cmp(a.desde, b.desde) || cmp(a.archivo, b.archivo) || cmp(a.simbolo, b.simbolo));
    if (sinResolver.length) arc.sinResolver = sinResolver.sort((a, b) => a.linea - b.linea || cmp(a.llamada, b.llamada));
    out.archivos.push(arc);
    porRuta.set(archivo, arc);

    // Next.js app router: app/**/route.ts con exports GET/POST/…; igual SvelteKit `+server.ts` y Expo Router `x+api.ts`.
    const next = /(?:^|\/)app\/((?:[^/]+\/)*)route\.[cm]?[jt]sx?$/.exec(archivo.slice(paquete ? paquete.length + 1 : 0));
    const api = porArchivoRuta.get(archivo)?.r;
    if (api?.clase === "api" && (api.marco === "next-pages" || api.marco === "nuxt")) {
      // Un handler por defecto (`export default function handler(req, res)`, `defineEventHandler`): el método lo fija el
      // nombre del archivo (Nuxt `x.get.ts`) o lo comparan en el código (`req.method === "POST"`, `isMethod(event, "PUT")`).
      // Sin ninguno atiende cualquier método: se registran GET y POST, los que usa un front.
      const texto = sf.getFullText();
      const vistos = new Set<string>();
      for (const m of texto.matchAll(/\.method\s*[!=]==?\s*['"`](\w+)['"`]|\bisMethod\(\s*\w+\s*,\s*['"`](\w+)['"`]|\bcase\s+['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*:/gi)) vistos.add((m[1] ?? m[2] ?? m[3])!.toUpperCase());
      const metodos = api.metodo ? [api.metodo] : vistos.size ? [...vistos].filter((x) => (METODOS_HTTP as readonly string[]).includes(x.toLowerCase())) : ["GET", "POST"];
      const def = sf.statements.find((st) => ts.isExportAssignment(st) || (ts.isFunctionDeclaration(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)));
      const decl = def && ts.isExportAssignment(def) && ts.isIdentifier(def.expression) ? declDe(def.expression) : undefined;
      const lin = decl && decl.getSourceFile() === sf ? linea(decl) : def ? linea(def) : 1;
      for (const metodo of metodos) out.endpoints.push({ paquete, metodo, ruta: api.ruta, request: null, response: null, archivo, linea: lin });
    }
    if (next || (api?.clase === "api" && (api.marco === "sveltekit" || api.marco === "expo-router"))) {
      const segs = next ? next[1]!.split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@")) : [];
      const ruta = next ? normalizarRuta("/" + segs.map((s) => s.replace(/^\[\[?(?:\.\.\.)?([^\]]+)\]?\]$/, "{$1}")).join("/")) : api!.ruta;
      for (const st of sf.statements) {
        const exportado = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!exportado) continue;
        const nombres: Array<[string, ts.Node]> = [];
        if (ts.isFunctionDeclaration(st) && st.name) nombres.push([st.name.text, st]);
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) nombres.push([d.name.text, st]);
        for (const [n, nodo] of nombres) {
          if ((METODOS_HTTP as readonly string[]).includes(n.toLowerCase()) && n === n.toUpperCase()) {
            out.endpoints.push({ paquete, metodo: n, ruta, request: null, response: null, archivo, linea: linea(nodo) });
          }
        }
      }
    }

    const visitar = (n: ts.Node): void => {
      if (ts.isClassDeclaration(n)) nest(n);
      mensajes(n, archivo);
      if (usaKysely && ts.isTaggedTemplateExpression(n)) sqlCrudo(n);
      if ((usaRouter || usaNavegacionNativa) && (/\.[cm]?[jt]sx?$/.test(archivo) || EXT_SFC.test(archivo))) {
        pantallas(n, archivo, paquete);
        navegaciones(n, archivo, paquete);
      } else if (paquetesConRutas.has(paquete) && (/\.[cm]?[jt]sx?$/.test(archivo) || EXT_SFC.test(archivo))) navegaciones(n, archivo, paquete);
      if (ts.isCallExpression(n)) {
        ruta(n) || saliente(n) || prisma(n) || (usaKysely && kysely(n));
      }
      ts.forEachChild(n, visitar);
    };

    // Un decorador del repo que, adentro, aplica uno de ruta de Nest. La ruta sale del literal o del argumento que recibe.
    const rutaEnvuelta = (d: ts.Decorator): { metodo: string; ruta: string | null } | null => {
      const call = ts.isCallExpression(d.expression) ? d.expression : null;
      const id = call ? call.expression : d.expression;
      if (!ts.isIdentifier(id) || Object.hasOwn(DECORADORES_NEST, id.text)) return null;
      const decl = declDe(id);
      if (!decl || !delRepo(decl.getSourceFile())) return null;
      const fn = ts.isFunctionDeclaration(decl) ? decl : ts.isVariableDeclaration(decl) ? funcionLiteral(decl.initializer) : null;
      if (!fn?.body) return null;
      let r: { metodo: string; ruta: string | null } | null = null;
      const ver = (n: ts.Node): void => {
        if (r) return;
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && Object.hasOwn(DECORADORES_NEST, n.expression.text)) {
          const a = n.arguments[0];
          let ruta: string | null = null;
          if (a && ts.isStringLiteralLike(a)) ruta = a.text;
          else if (a && ts.isIdentifier(a) && call) {
            const i = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === a.text);
            const arg = i >= 0 ? call.arguments[i] : undefined;
            if (arg && ts.isStringLiteralLike(arg)) ruta = arg.text;
          }
          r = { metodo: DECORADORES_NEST[n.expression.text]!, ruta };
          return;
        }
        ts.forEachChild(n, ver);
      };
      ver(fn.body);
      return r;
    };

    // NestJS: @Controller("x") + @Get("y")
    const nest = (c: ts.ClassDeclaration) => {
      const ctrl = decorador(c, "Controller");
      if (!ctrl) return;
      const prefijo = argTexto(ctrl) ?? "";
      for (const m of c.members) {
        if (!ts.isMethodDeclaration(m)) continue;
        const rutas: Array<{ metodo: string; ruta: string | null }> = [];
        for (const [nombre, metodo] of Object.entries(DECORADORES_NEST)) {
          const d = decorador(m, nombre);
          if (d) rutas.push({ metodo, ruta: argTexto(d) });
        }
        // Decoradores propios que envuelven uno de Nest: `MiPost = (p) => applyDecorators(Post(p), HttpCode(200))`.
        for (const d of ts.getDecorators(m) ?? []) {
          const r = rutaEnvuelta(d);
          if (r) rutas.push(r);
        }
        for (const { metodo, ruta } of rutas) {
          // El cuerpo llega por `@Body()` o por un decorador propio que lo envuelve (`@FormBody()`, `@JsonBody()`).
          const body = m.parameters.find((p) => (ts.getDecorators(p) ?? []).some((d) => /Body$/.test(nombreDecorador(d))));
          out.endpoints.push({
            paquete,
            metodo,
            ruta: normalizarRuta(`/${prefijo}/${ruta ?? ""}`),
            request: nombreTipo(body?.type),
            response: tipoDeRetorno(m, formas),
            query: tipoDeQuery(m, formas),
            archivo,
            linea: linea(m),
          });
        }
      }
    };

    // Express / Fastify: app.get("/x", handler)
    const ruta = (call: ts.CallExpression): boolean => {
      if (!ts.isPropertyAccessExpression(call.expression)) return false;
      const metodo = call.expression.name.text;
      if (!(METODOS_HTTP as readonly string[]).includes(metodo)) return false;
      const [primero] = call.arguments;
      if (!primero || !(ts.isStringLiteral(primero) || ts.isNoSubstitutionTemplateLiteral(primero)) || !primero.text.startsWith("/")) return false;
      const fw = frameworkDeInstancia(call.expression.expression);
      if (!fw) return false;
      let request: string | null = null;
      let response: string | null = null;
      let lineaEv = linea(call);
      if (fw === "fastify") {
        const gen = call.typeArguments?.[0];
        if (gen && ts.isTypeLiteralNode(gen)) {
          for (const mem of gen.members) {
            if (!ts.isPropertySignature(mem) || !mem.name) continue;
            const k = mem.name.getText();
            if (k === "Body") request = nombreTipo(mem.type);
            if (k === "Reply") response = nombreTipo(mem.type);
          }
        }
      } else {
        const handler = funcionDe(call.arguments[call.arguments.length - 1]);
        if (handler) {
          if (handler.nombrada) lineaEv = linea(handler.nodo);
          const [req, res] = handler.fn.parameters;
          const reqT = req?.type && ts.isTypeReferenceNode(req.type) ? req.type.typeArguments : undefined;
          const resT = res?.type && ts.isTypeReferenceNode(res.type) ? res.type.typeArguments : undefined;
          request = nombreTipo(reqT?.[2]);
          response = nombreTipo(resT?.[0]) ?? nombreTipo(reqT?.[1]);
        }
      }
      out.endpoints.push({ paquete, metodo: metodo.toUpperCase(), ruta: normalizarRuta(primero.text), request, response, archivo, linea: lineaEv });
      return true;
    };

    const funcionDe = (e: ts.Expression | undefined): { fn: ts.SignatureDeclaration; nodo: ts.Node; nombrada: boolean } | null => {
      if (!e) return null;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return { fn: e, nodo: e, nombrada: false };
      if (ts.isIdentifier(e)) {
        const d = resolver(e)?.declarations?.[0];
        if (d && ts.isFunctionDeclaration(d)) return { fn: d, nodo: d, nombrada: true };
        if (d && ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          return { fn: d.initializer, nodo: d.parent.parent, nombrada: true };
        }
      }
      return null;
    };

    // Salientes: fetch(url, init), axios.m(url, body), axios(config), instancia.m(url, body), y las funciones del
    // repo que envuelven alguna de esas pasándole la URL que reciben.
    const emitir = (call: ts.CallExpression, f: FormaSaliente): boolean => {
      let partes = evaluar(f.url);
      const primera = partes[0];
      const absoluta = primera && "lit" in primera && /^https?:\/\//.test(primera.lit);
      // ky pone una barra entre `prefixUrl` y la URL; las barras dobles se normalizan.
      if (f.base && !absoluta) partes = [...evaluar(f.base), ...(f.separar ? [{ lit: "/" }] : []), ...partes];
      // Una URL que no se puede analizar igual es una llamada HTTP: queda sin ruta, para que se vea que falta.
      const u = analizarUrl(partes) ?? { base: "dinamica" as const, host: null, ruta: null, texto: f.url.getText().replace(/\s+/g, " ").slice(0, 80) };
      const campos = camposDeLlamada(call, f);
      const llamada: LlamadaCruda = { paquete, archivo, linea: linea(call), metodo: f.metodo, url: u, dato: f.cuerpo ? nombreTipoDeExpr(f.cuerpo) : null, ...(campos ? { campos } : {}) };
      out.llamadas.push(llamada);
      return true;
    };
    const saliente = (call: ts.CallExpression): boolean => {
      const f = formaSaliente(call);
      if (f) {
        // La URL es un parámetro de la función que contiene la llamada: la llamada real es la de quien la invoca.
        if (parametroDe(f.url)) return true;
        return emitir(call, f);
      }
      const e = envolturaDe(call);
      if (!e) return false;
      const url = call.arguments[e.idx];
      if (!url || parametroDe(url)) return !!url;
      return emitir(call, { url, base: e.base, metodo: e.metodo, generico: e.generico, separar: e.separar });
    };

    // Prisma: x.<modelo>.<op>(…)
    const prisma = (call: ts.CallExpression): boolean => {
      const c = call.expression;
      if (!ts.isPropertyAccessExpression(c) || !ts.isPropertyAccessExpression(c.expression)) return false;
      const op = c.name.text;
      const modelo = modelosPrisma.get(c.expression.name.text);
      if (!modelo) return false;
      const verbo: AccesoTabla["verbo"] | null = OPS_PRISMA_ESCRITURA.has(op) ? "escribe_en" : OPS_PRISMA_LECTURA.has(op) ? "lee_de" : null;
      if (!verbo) return false;
      out.tablas.push({ paquete, archivo, linea: linea(call), modelo, verbo });
      return true;
    };

    // Kysely: db.selectFrom("tabla as t"), .insertInto("tabla"), .innerJoin("otra as o", …). Solo literales.
    const kysely = (call: ts.CallExpression): boolean => {
      const c = call.expression;
      if (!ts.isPropertyAccessExpression(c) || !Object.hasOwn(OPS_KYSELY, c.name.text)) return false;
      const arg = call.arguments[0];
      const literales = arg && ts.isArrayLiteralExpression(arg) ? arg.elements : arg ? [arg] : [];
      let alguna = false;
      for (const l of literales) {
        if (!ts.isStringLiteralLike(l)) continue;
        const tabla = l.text.trim().split(/\s+as\s+/i)[0]!.split(".").pop()!;
        if (!/^\w+$/.test(tabla)) continue;
        out.tablas.push({ paquete, archivo, linea: linea(call), modelo: tabla, verbo: OPS_KYSELY[c.name.text]! });
        alguna = true;
      }
      return alguna;
    };

    // Kysely: sql`UPDATE user SET …` → tablas por el texto del SQL (las sustituciones `${…}` no aportan nombres).
    const sqlCrudo = (t: ts.TaggedTemplateExpression) => {
      if (!ts.isIdentifier(t.tag) || t.tag.text !== "sql" || moduloDe(t.tag) !== "kysely") return;
      const tpl = t.template;
      const texto = ts.isNoSubstitutionTemplateLiteral(tpl) ? tpl.text : [tpl.head.text, ...tpl.templateSpans.map((x) => x.literal.text)].join(" ? ");
      const base = linea(tpl);
      for (const c of ctesDeSql(texto)) ctesRepo.add(c);
      for (const a of tablasDeSql(texto)) deSql.add(out.tablas[out.tablas.push({ paquete, archivo, linea: base + a.saltos, modelo: a.tabla, verbo: a.verbo }) - 1]!);
      // Fragmentos compartidos: `${BASE_FROM}` → la constante es otro sql`…`; sus tablas van a la línea donde se usa.
      const fragmentos = (tp: ts.TemplateLiteral, l: number | null, prof: number) => {
        if (ts.isNoSubstitutionTemplateLiteral(tp) || prof > 3) return;
        for (const sp of tp.templateSpans) {
          const d = declDe(sp.expression);
          const ini = d && (ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d)) ? d.initializer : undefined;
          if (!ini || !ts.isTaggedTemplateExpression(ini) || !ts.isIdentifier(ini.tag) || ini.tag.text !== "sql") continue;
          const t2 = ini.template;
          const txt = ts.isNoSubstitutionTemplateLiteral(t2) ? t2.text : [t2.head.text, ...t2.templateSpans.map((x) => x.literal.text)].join(" ? ");
          const donde = l ?? linea(sp.expression);
          for (const c of ctesDeSql(txt)) ctesRepo.add(c);
          for (const a of tablasDeSql(txt)) deSql.add(out.tablas[out.tablas.push({ paquete, archivo, linea: donde, modelo: a.tabla, verbo: a.verbo }) - 1]!);
          fragmentos(t2, donde, prof + 1);
        }
      };
      fragmentos(tpl, null, 0);
    };

    // TypeORM: @Entity("tabla") class X
    for (const st of sf.statements) {
      if (!ts.isClassDeclaration(st) || !st.name) continue;
      const ent = decorador(st, "Entity");
      if (ent) out.modelos.push({ paquete, nombre: st.name.text, tabla: argTexto(ent), archivo, linea: linea(st) });
    }

    ts.forEachChild(sf, visitar);
  }

  for (const p of publicaciones) {
    const arc = porRuta.get(p.archivo);
    for (const t of suscripciones.get(p.clave) ?? []) {
      if (!arc || (t.archivo === p.archivo && t.simbolo === p.desde)) continue;
      const inv = (arc.invoca ??= []);
      if (!inv.some((i) => i.via && i.desde === p.desde && i.archivo === t.archivo && i.simbolo === t.simbolo)) inv.push({ desde: p.desde, archivo: t.archivo, simbolo: t.simbolo, linea: p.linea, via: p.texto });
    }
  }
  // Eventos del contrato: los de forma inequívoca, y los dudosos solo si la misma clave se publica y se consume en el repo.
  const publicadas = new Set(mensajesVistos.filter((m) => m.direccion === "publica").map((m) => m.clave));
  const consumidas = new Set(mensajesVistos.filter((m) => m.direccion === "consume").map((m) => m.clave));
  out.eventos = mensajesVistos
    // Una clave que no es un texto (una variable, un símbolo) solo cuenta si se ve de los dos lados: sola, puede ser cualquier argumento.
    .filter((m) => (m.fuerte && m.clave.startsWith("s:")) || (publicadas.has(m.clave) && consumidas.has(m.clave)))
    .map((m) => ({ paquete: paqueteDe(repo, m.archivo), archivo: m.archivo, linea: m.linea, nombre: m.nombre, direccion: m.direccion }));
  // Pantallas por archivo: su componente es el `export default` del archivo (o el archivo, si es `.vue`/`.svelte`), y la
  // envuelven los layouts de su carpeta y de las de arriba.
  const sfDe = new Map(fuentes.map((sf) => [rel(sf), sf]));
  const componenteDeArchivo = (archivo: string): { ref: RefSimbolo; linea: number } | null => {
    if (EXT_SFC.test(archivo)) return porRuta.has(archivo) ? { ref: { archivo, simbolo: nombreSfc(archivo) }, linea: 1 } : null;
    const sf = sfDe.get(archivo);
    const mod = sf && checker.getSymbolAtLocation(sf);
    const exp = mod && checker.getExportsOfModule(mod).find((x) => x.name === "default");
    const d = real(exp)?.declarations?.[0];
    if (!sf || !d) return null;
    if (porRuta.get(archivo)?.simbolos.some((x) => x.nombre === "default") && (ts.isExportAssignment(d) ? !ts.isIdentifier(d.expression) : ts.isFunctionDeclaration(d) && !d.name)) {
      return { ref: { archivo, simbolo: "default" }, linea: linea(d) };
    }
    const dd = ts.isExportAssignment(d) && ts.isIdentifier(d.expression) ? declDe(d.expression) : d;
    const ref = dd ? destinos(dd)[0] : undefined;
    return ref ? { ref, linea: dd!.getSourceFile() === sf ? linea(dd!) : linea(d) } : null;
  };
  const yaDeclaradas = new Set(out.pantallas.map((p) => `${p.paquete}\u0000${p.ruta}`));
  const layoutsPorCarpeta = new Map<CarpetaDeRutas, string[]>();
  for (const [a, { carpeta, r }] of porArchivoRuta) if (carpeta && r.clase === "layout") layoutsPorCarpeta.set(carpeta, [...(layoutsPorCarpeta.get(carpeta) ?? []), a]);
  const invocaSintetica = (archivo: string, desde: string, destino: string, simbolo: string) => {
    const arc = porRuta.get(archivo), dest = porRuta.get(destino);
    if (!arc || !dest?.simbolos.some((x) => x.nombre === simbolo)) return;
    (arc.invoca ??= []).push({ desde, archivo: destino, simbolo, linea: dest.simbolos.find((x) => x.nombre === simbolo)!.linea });
  };
  for (const [archivo, { carpeta, r }] of porArchivoRuta) {
    if (!carpeta || r.clase === "api") continue;
    const comp = componenteDeArchivo(archivo);
    // La carga de datos del lado del servidor es parte de la pantalla: SvelteKit `+page.ts`/`+page.server.ts` (`load`)
    // y Next `pages/` (`getServerSideProps`, `getStaticProps`). Se ve como una llamada del componente.
    if (comp && carpeta.marco === "sveltekit") {
      const dir = archivo.slice(0, archivo.lastIndexOf("/") + 1) + (r.clase === "pantalla" ? "+page" : "+layout");
      for (const ext of [".ts", ".js", ".server.ts", ".server.js"]) invocaSintetica(archivo, comp.ref.simbolo, dir + ext, "load");
    }
    if (comp && carpeta.marco === "next-pages") for (const f of ["getServerSideProps", "getStaticProps", "getInitialProps"]) invocaSintetica(archivo, comp.ref.simbolo, archivo, f);
    if (r.clase !== "pantalla") continue;
    const paquete = paqueteDe(repo, archivo);
    if (yaDeclaradas.has(`${paquete}\u0000${r.ruta}`)) continue;
    const envolturas = layoutsDe(carpeta, archivo, layoutsPorCarpeta.get(carpeta) ?? [], hay);
    // Next `pages/_app` envuelve a todas las pantallas.
    if (carpeta.marco === "next-pages") envolturas.unshift(...repo.archivos.filter((a) => a.startsWith(carpeta.dir + "/_app.")));
    const envuelta = envolturas.map((l) => componenteDeArchivo(l)?.ref).filter((x): x is RefSimbolo => !!x);
    for (const ruta of [r.ruta, ...(r.sinOpcionales && !yaDeclaradas.has(`${paquete}\u0000${r.sinOpcionales}`) ? [r.sinOpcionales] : [])]) {
      out.pantallas.push({ paquete, ruta, archivo, linea: comp?.linea ?? 1, componente: comp?.ref ?? null, envuelta });
    }
  }

  for (const arc of porRuta.values()) arc.invoca?.sort((a, b) => cmp(a.desde, b.desde) || cmp(a.archivo, b.archivo) || cmp(a.simbolo, b.simbolo) || a.linea - b.linea || cmp(a.via ?? "", b.via ?? ""));

  out.tablas = out.tablas.filter((t) => !deSql.has(t) || !ctesRepo.has(t.modelo.toLowerCase()));
  // Navegaciones por nombre de ruta: a la ruta con ese nombre en el mismo paquete; sin una, se descartan.
  out.navegaciones = out.navegaciones.flatMap((v) => {
    if (!v.ruta.startsWith(POR_NOMBRE)) return [v];
    const ruta = rutasConNombre.get(`${v.paquete}\u0000${v.ruta.slice(POR_NOMBRE.length)}`);
    return ruta ? [{ ...v, ruta }] : [];
  });
  ordenar(out);
  return out;
}

/** Una llamada HTTP saliente reconocida: URL, base, método, y el cuerpo y la config (axios) si los tiene. */
interface FormaSaliente {
  url: ts.Expression;
  base: ts.Expression | null;
  metodo: string;
  cuerpo?: ts.Expression | undefined;
  config?: ts.Expression | undefined;
  /** Llamada directa al cliente HTTP (no una envoltura del repo): lo que no lleva, se sabe que no lo manda. */
  directa?: boolean;
  /** Envoltura cuyo `<T>` llega tal cual al cliente: es el tipo de la respuesta. */
  generico?: boolean;
  /** ky: la URL va después de la base con una barra en el medio. */
  separar?: boolean | undefined;
  /** Claves de la config que llevan la query (`params` en axios y Angular, `searchParams` en ky, `query` en ofetch). */
  claves?: string[];
  /** Tipo de la respuesta que no está en la llamada misma (`ky.get(url).json<T>()`). */
  respuesta?: ts.TypeNode;
}

function propiedad(o: ts.ObjectLiteralExpression, nombre: string): ts.Expression | undefined {
  for (const p of o.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText().replace(/["']/g, "") === nombre) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === nombre) return p.name;
  }
  return undefined;
}

function decorador(n: ts.Node, nombre: string): ts.CallExpression | ts.Identifier | null {
  if (!ts.canHaveDecorators(n)) return null;
  for (const d of ts.getDecorators(n) ?? []) {
    const e = d.expression;
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === nombre) return e;
    if (ts.isIdentifier(e) && e.text === nombre) return e;
  }
  return null;
}

function argTexto(d: ts.CallExpression | ts.Identifier): string | null {
  if (!ts.isCallExpression(d)) return null;
  const a = d.arguments[0];
  return a && ts.isStringLiteralLike(a) ? a.text : null;
}

const limpiar = (s: string) => s.replace(/\s+/g, " ").replace(/"/g, "'").trim();

function formaDe(st: ts.Statement): { nombre: string; forma: Forma } | null {
  let nombre: string;
  let miembros: ts.NodeArray<ts.TypeElement>;
  if (ts.isInterfaceDeclaration(st)) {
    nombre = st.name.text;
    miembros = st.members;
  } else if (ts.isTypeAliasDeclaration(st) && ts.isTypeLiteralNode(st.type)) {
    nombre = st.name.text;
    miembros = st.type.members;
  } else if (ts.isClassDeclaration(st) && st.name) {
    // Clases de datos (DTO): sus propiedades públicas con tipo. Las clases sin ninguna no tienen forma.
    const oculto = (m: ts.PropertyDeclaration) =>
      (ts.getModifiers(m) ?? []).some((x) => [ts.SyntaxKind.StaticKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(x.kind));
    const forma: Forma = {};
    for (const m of st.members) {
      if (!ts.isPropertyDeclaration(m) || !m.type || !ts.isIdentifier(m.name) || oculto(m)) continue;
      const t = limpiar(m.type.getText());
      forma[m.name.text] = m.questionToken ? `${t} | undefined` : t;
    }
    return Object.keys(forma).length ? { nombre: st.name.text, forma } : null;
  } else return null;
  const forma: Forma = {};
  for (const m of miembros) {
    if (!ts.isPropertySignature(m) || !m.name) continue;
    const k = m.name.getText().replace(/["']/g, "");
    const t = m.type ? limpiar(m.type.getText()) : "unknown";
    forma[k] = m.questionToken ? `${t} | undefined` : t;
  }
  return { nombre, forma };
}

function ordenar(x: Extraccion) {
  const porPos = (a: { archivo: string; linea: number }, b: { archivo: string; linea: number }) => cmp(a.archivo, b.archivo) || a.linea - b.linea;
  x.archivos.sort((a: ArchivoCrudo, b: ArchivoCrudo) => cmp(a.ruta, b.ruta));
  for (const a of x.archivos) a.simbolos.sort((p, q) => p.linea - q.linea || cmp(p.nombre, q.nombre));
  x.endpoints.sort((a: EndpointCrudo, b: EndpointCrudo) => porPos(a, b) || cmp(a.metodo, b.metodo));
  x.llamadas.sort((a: LlamadaCruda, b: LlamadaCruda) => porPos(a, b));
  x.tablas.sort((a: AccesoTabla, b: AccesoTabla) => porPos(a, b));
  x.modelos.sort((a: ModeloCrudo, b: ModeloCrudo) => porPos(a, b));
  x.eventos?.sort((a, b) => porPos(a, b) || cmp(a.nombre, b.nombre) || cmp(a.direccion, b.direccion));
}

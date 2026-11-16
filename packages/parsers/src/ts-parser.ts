import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { cmp, normalizarRuta } from "@brain/core";
import { analizarUrl, type Parte } from "./url.js";
import {
  extraccionVacia,
  paqueteDe,
  type AccesoTabla,
  type ArchivoCrudo,
  type EndpointCrudo,
  type Extraccion,
  type Forma,
  type LlamadaCruda,
  type ModeloCrudo,
  type Parser,
  type RepoFuente,
  type Simbolo,
} from "./tipos.js";

/**
 * ts-parser: API del compilador de TypeScript, sin LLM. Extrae:
 * - endpoints de Express, Fastify, NestJS y rutas `app/**\/route.ts` de Next;
 * - llamadas salientes con `fetch` y `axios` (incluidas instancias `axios.create({ baseURL })`);
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
export function tablasDeSql(sql: string): Array<{ tabla: string; verbo: "lee_de" | "escribe_en"; saltos: number }> {
  const out: Array<{ tabla: string; verbo: "lee_de" | "escribe_en"; saltos: number }> = [];
  // Nombre con comillas opcionales (`x`, "x", [x]) y esquema opcional: se queda con la tabla.
  const nombre = "[`\"\\[]?(?:\\w+[`\"\\]]?\\.[`\"\\[]?)?(\\w+)[`\"\\]]?";
  const ctes = new Set([...sql.matchAll(/(?:\bwith(?:\s+recursive)?|,)\s+(\w+)\s+as\s*\(/gi)].map((m) => m[1]!.toLowerCase()));
  const saltos = (i: number) => (sql.slice(0, i).match(/\n/g) ?? []).length;
  const ocupado = new Set<number>();
  const agregar = (m: RegExpMatchArray, verbo: "lee_de" | "escribe_en") => {
    const tabla = m[1]!;
    if (ctes.has(tabla.toLowerCase()) || /^(select|set|values|dual|lateral|unnest|json_table)$/i.test(tabla)) return;
    out.push({ tabla, verbo, saltos: saltos(m.index!) });
  };
  for (const m of sql.matchAll(new RegExp("\\b(?:insert\\s+(?:ignore\\s+)?into|replace\\s+into|update(?:\\s+ignore)?|delete\\s+from)\\s+" + nombre, "gi"))) {
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

const esFuenteTs = (a: string) => EXT_TS.test(a) && !a.endsWith(".d.ts");
const lenguajeDe = (a: string) => (/\.(ts|tsx|mts|cts)$/.test(a) ? "typescript" : "javascript");

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
  const archivos = repo.archivos.filter(esFuenteTs).map((a) => join(repo.raiz, a));
  return ts.createProgram(archivos, opciones, host);
}

function extraer(repo: RepoFuente): Extraccion {
  const out = extraccionVacia("ts-parser");
  const programa = crearPrograma(repo);
  const checker = programa.getTypeChecker();
  const rel = (sf: ts.SourceFile) => sf.fileName.slice(repo.raiz.length + 1).split("\\").join("/");
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

  /** ¿La expresión es axios o una instancia de axios? Devuelve el `baseURL` (o null) si lo es. */
  const axiosDe = (e: ts.Expression): { baseURL: ts.Expression | null } | null => {
    if (ts.isIdentifier(e) && moduloDe(e) === "axios") return { baseURL: null };
    const ini = ts.isIdentifier(e) ? inicializador(e) : undefined;
    if (ini && ts.isCallExpression(ini) && ts.isPropertyAccessExpression(ini.expression) && ini.expression.name.text === "create") {
      const recv = ini.expression.expression;
      if (ts.isIdentifier(recv) && moduloDe(recv) === "axios") {
        const cfg = ini.arguments[0];
        const base = cfg && ts.isObjectLiteralExpression(cfg) ? propiedad(cfg, "baseURL") : undefined;
        return { baseURL: base ?? null };
      }
    }
    return null;
  };

  const nombreTipo = (t: ts.TypeNode | undefined): string | null => {
    if (!t) return null;
    if (ts.isTypeReferenceNode(t)) {
      const n = t.typeName.getText();
      if ((n === "Promise" || n === "Observable") && t.typeArguments?.[0]) return nombreTipo(t.typeArguments[0]);
      return n;
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
  /** Símbolo destino de una declaración: `Clase.metodo` o `funcion`, con su archivo. Varios si es una interfaz. */
  const destinos = (d: ts.Declaration): Array<{ archivo: string; simbolo: string }> => {
    const sf = d.getSourceFile();
    if (!delRepo(sf)) return [];
    if (ts.isFunctionDeclaration(d) && d.name) return [{ archivo: rel(sf), simbolo: d.name.text }];
    if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
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
  const invocacionesDe = (cuerpo: ts.Node, desde: string, archivo: string, out: Map<string, { desde: string; archivo: string; simbolo: string; linea: number }>) => {
    const ver = (n: ts.Node): void => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const e = n.expression;
        const nombre = ts.isPropertyAccessExpression(e) ? e.name : ts.isIdentifier(e) ? e : null;
        const d = nombre ? real(checker.getSymbolAtLocation(nombre))?.declarations?.[0] : undefined;
        if (d) {
          for (const t of destinos(d)) {
            if (t.archivo === archivo && t.simbolo === desde) continue;
            const k = `${desde}\u0000${t.archivo}\u0000${t.simbolo}`, l = linea(n);
            const prev = out.get(k);
            if (!prev || l < prev.linea) out.set(k, { desde, archivo: t.archivo, simbolo: t.simbolo, linea: l });
          }
        }
      }
      ts.forEachChild(n, ver);
    };
    ver(cuerpo);
  };

  for (const sf of fuentes) {
    const archivo = rel(sf);
    const paquete = paqueteDe(repo, archivo);
    const simbolos: Simbolo[] = [];
    const formas = (out.formas[paquete] ??= {});

    // Símbolos, formas de tipos, imports e invocaciones.
    const invoca = new Map<string, { desde: string; archivo: string; simbolo: string; linea: number }>();
    const importa = new Set<string>();
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) {
        simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "funcion", fin: finDe(st) });
        if (st.body) invocacionesDe(st.body, st.name.text, archivo, invoca);
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
          if (cuerpo) invocacionesDe(cuerpo, sim, archivo, invoca);
        }
      } else if (ts.isInterfaceDeclaration(st)) simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "interfaz", fin: finDe(st) });
      else if (ts.isTypeAliasDeclaration(st)) simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "tipo", fin: finDe(st) });
      else if (ts.isEnumDeclaration(st)) simbolos.push({ linea: linea(st), nombre: st.name.text, tipo: "enum", fin: finDe(st) });
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
            simbolos.push({ linea: linea(st), nombre: d.name.text, tipo: "funcion", fin: finDe(st) });
            invocacionesDe(d.initializer, d.name.text, archivo, invoca);
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
    simbolos.sort((a, b) => a.linea - b.linea || cmp(a.nombre, b.nombre));
    const arc: ArchivoCrudo = { lenguaje: lenguajeDe(archivo), ruta: archivo, simbolos };
    if (importa.size) arc.importa = [...importa].sort(cmp);
    if (invoca.size) arc.invoca = [...invoca.values()].sort((a, b) => cmp(a.desde, b.desde) || cmp(a.archivo, b.archivo) || cmp(a.simbolo, b.simbolo));
    out.archivos.push(arc);

    // Next.js app router: app/**/route.ts con exports GET/POST/…
    const next = /(?:^|\/)app\/((?:[^/]+\/)*)route\.[cm]?[jt]sx?$/.exec(archivo.slice(paquete ? paquete.length + 1 : 0));
    if (next) {
      const segs = next[1]!.split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
      const ruta = normalizarRuta("/" + segs.map((s) => s.replace(/^\[\[?(?:\.\.\.)?([^\]]+)\]?\]$/, "{$1}")).join("/"));
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
      if (usaKysely && ts.isTaggedTemplateExpression(n)) sqlCrudo(n);
      if (ts.isCallExpression(n)) {
        ruta(n) || saliente(n) || prisma(n) || (usaKysely && kysely(n));
      }
      ts.forEachChild(n, visitar);
    };

    // NestJS: @Controller("x") + @Get("y")
    const nest = (c: ts.ClassDeclaration) => {
      const ctrl = decorador(c, "Controller");
      if (!ctrl) return;
      const prefijo = argTexto(ctrl) ?? "";
      for (const m of c.members) {
        if (!ts.isMethodDeclaration(m)) continue;
        for (const [nombre, metodo] of Object.entries(DECORADORES_NEST)) {
          const d = decorador(m, nombre);
          if (!d) continue;
          const body = m.parameters.find((p) => decorador(p, "Body"));
          out.endpoints.push({
            paquete,
            metodo,
            ruta: normalizarRuta(`/${prefijo}/${argTexto(d) ?? ""}`),
            request: nombreTipo(body?.type),
            response: nombreTipo(m.type),
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

    // Salientes: fetch(url, init), axios.m(url, body), axios(config), instancia.m(url, body)
    const saliente = (call: ts.CallExpression): boolean => {
      const c = call.expression;
      let url: ts.Expression | undefined;
      let base: ts.Expression | null = null;
      let metodo = "GET";
      let cuerpo: ts.Expression | undefined;
      if (ts.isIdentifier(c) && c.text === "fetch" && !resolver(c)?.declarations?.length) {
        url = call.arguments[0];
        const init = call.arguments[1];
        if (init && ts.isObjectLiteralExpression(init)) {
          const m = propiedad(init, "method");
          if (m && ts.isStringLiteralLike(m)) metodo = m.text.toUpperCase();
          cuerpo = propiedad(init, "body");
        }
      } else if (ts.isPropertyAccessExpression(c) && (METODOS_HTTP as readonly string[]).includes(c.name.text)) {
        const ax = axiosDe(c.expression);
        if (!ax) return false;
        base = ax.baseURL;
        metodo = c.name.text.toUpperCase();
        url = call.arguments[0];
        if (["post", "put", "patch"].includes(c.name.text)) cuerpo = call.arguments[1];
      } else if (ts.isIdentifier(c) && axiosDe(c)) {
        const cfg = call.arguments[0];
        if (!cfg || !ts.isObjectLiteralExpression(cfg)) return false;
        url = propiedad(cfg, "url");
        const m = propiedad(cfg, "method");
        if (m && ts.isStringLiteralLike(m)) metodo = m.text.toUpperCase();
        cuerpo = propiedad(cfg, "data");
      } else return false;
      if (!url) return false;
      let partes = evaluar(url);
      const primera = partes[0];
      const absoluta = primera && "lit" in primera && /^https?:\/\//.test(primera.lit);
      if (base && !absoluta) partes = [...evaluar(base), ...partes];
      const u = analizarUrl(partes);
      if (!u) return false;
      const llamada: LlamadaCruda = { paquete, archivo, linea: linea(call), metodo, url: u, dato: cuerpo ? nombreTipoDeExpr(cuerpo) : null };
      out.llamadas.push(llamada);
      return true;
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
      for (const a of tablasDeSql(texto)) out.tablas.push({ paquete, archivo, linea: base + a.saltos, modelo: a.tabla, verbo: a.verbo });
    };

    // TypeORM: @Entity("tabla") class X
    for (const st of sf.statements) {
      if (!ts.isClassDeclaration(st) || !st.name) continue;
      const ent = decorador(st, "Entity");
      if (ent) out.modelos.push({ paquete, nombre: st.name.text, tabla: argTexto(ent), archivo, linea: linea(st) });
    }

    ts.forEachChild(sf, visitar);
  }

  ordenar(out);
  return out;
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
}

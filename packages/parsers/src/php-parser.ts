import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser as TSParser, type Node } from "web-tree-sitter";
import { normalizarRuta } from "@flowbrain/core";
import { analizarUrl, type Parte } from "./url.js";
import { leerCrontabs, rutaCron } from "./entradas.js";
import { extraccionVacia, paqueteDe, type Extraccion, type Forma, type Parser, type RepoFuente, type Simbolo } from "./tipos.js";

/**
 * php-parser: tree-sitter-php (WASM, sin binarios nativos). Extrae:
 * - rutas de Laravel (`routes/*.php`, `Route::prefix()->group()`, `[Ctrl::class, 'm']` y `'Ctrl@m'`)
 *   y de Symfony (atributos `#[Route]` y anotaciones `@Route` en docblocks, con prefijo de clase);
 * - tipos de request (FormRequest → forma desde `rules()`) y de response (tipo de retorno; JsonResource → claves de `toArray()`);
 * - llamadas HTTP: facade `Http::`, clientes tipo Guzzle con URL absoluta, `->request('POST', url)` y `curl_init(url)`;
 * - modelos Eloquent (`$table` o nombre por convención) y entidades Doctrine (`Entity`/`Table`), con sus accesos.
 */

const METODOS = ["get", "post", "put", "patch", "delete", "options"];
const SIN_TIPO = new Set(["JsonResponse", "Response", "RedirectResponse", "mixed", "void", "array", "ResponseInterface", "Responsable", "View", "string", "int", "bool"]);
const ELOQUENT_LECTURA = new Set(["where", "whereIn", "find", "findOrFail", "first", "firstWhere", "all", "get", "query", "paginate", "count", "pluck", "with", "latest", "oldest"]);
const ELOQUENT_ESCRITURA = new Set(["create", "insert", "update", "updateOrCreate", "firstOrCreate", "upsert", "destroy", "forceCreate"]);
const BASES_MODELO = new Set(["Model", "Authenticatable", "Pivot"]);

let parserListo: Promise<TSParser> | null = null;
/** Inicializa tree-sitter WASM una sola vez por proceso. */
function obtenerParser(): Promise<TSParser> {
  parserListo ??= (async () => {
    const req = createRequire(import.meta.url);
    await TSParser.init();
    // El paquete publicado trae la gramática junto al bundle (dist/), así no instala tree-sitter-php, que compila
    // un binario nativo al instalarse. En desarrollo se toma del paquete.
    const junto = join(dirname(fileURLToPath(import.meta.url)), "tree-sitter-php.wasm");
    const php = await Language.load(existsSync(junto) ? junto : req.resolve("tree-sitter-php/tree-sitter-php.wasm"));
    const p = new TSParser();
    p.setLanguage(php);
    return p;
  })();
  return parserListo;
}

export const phpParser: Parser = {
  nombre: "php-parser",
  detect: (repo) => repo.archivos.some((a) => a.endsWith(".php")),
  extract: async (repo) => extraer(repo, await obtenerParser()),
};

// ---------- helpers de árbol ----------

const hijos = (n: Node | null | undefined): Node[] => (n ? (n.namedChildren.filter(Boolean) as Node[]) : []);
const campo = (n: Node | null | undefined, f: string): Node | null => n?.childForFieldName(f) ?? null;
const ultimo = (s: string) => s.replace(/^\\/, "").split("\\").pop() ?? s;
const linea = (n: Node) => n.startPosition.row + 1;
const listaArgs = (call: Node): Node | null => campo(call, "arguments") ?? campo(call, "parameters");
const args = (call: Node): Node[] =>
  hijos(listaArgs(call)).map((a) => (a.type === "argument" ? (hijos(a).find((x) => x.type !== "name") ?? a) : a));
const argNombrado = (call: Node, nombre: string): Node | null => {
  for (const a of hijos(listaArgs(call))) {
    const n = campo(a, "name");
    if (a.type === "argument" && n?.text === nombre) return hijos(a).find((x) => x !== n && x.type !== "name") ?? null;
  }
  return null;
};

function textoString(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "string" || n.type === "encapsed_string") {
    if (hijos(n).some((c) => c.type !== "string_content" && c.type !== "escape_sequence")) return null;
    return hijos(n)
      .map((c) => c.text)
      .join("");
  }
  return null;
}

function evaluar(n: Node | null | undefined): Parte[] {
  if (!n) return [];
  switch (n.type) {
    case "string":
      return [{ lit: textoString(n) ?? "" }];
    case "encapsed_string":
      return hijos(n).map((c) => (c.type === "string_content" ? { lit: c.text } : { din: c.text }));
    case "parenthesized_expression":
      return evaluar(hijos(n)[0]);
    case "binary_expression":
      if (campo(n, "operator")?.text === ".") return [...evaluar(campo(n, "left")), ...evaluar(campo(n, "right"))];
      return [{ din: n.text }];
    case "function_call_expression": {
      const f = campo(n, "function")?.text;
      const a = textoString(args(n)[0]);
      if ((f === "env" || f === "getenv") && a) return [{ din: `env:${a}` }];
      if (f === "config" && a) return [{ din: `config:${a}` }];
      return [{ din: n.text }];
    }
    default:
      return [{ din: n.text }];
  }
}

/** Raíz de una cadena `A::x()->y()->z()`. */
function raizCadena(n: Node): Node {
  let x = n;
  for (;;) {
    const o = x.type === "member_call_expression" ? campo(x, "object") : null;
    if (!o) return x;
    x = o;
  }
}

interface Metodo {
  nombre: string;
  linea: number;
  params: Array<string | null>;
  retorno: string | null;
  nodo: Node;
}
interface Clase {
  nombre: string;
  extiende: string | null;
  archivo: string;
  linea: number;
  metodos: Map<string, Metodo>;
  tabla: string | null;
  doc: string;
  nodo: Node;
}

const tipoDe = (n: Node | null): string | null => (n ? ultimo(n.text.replace(/^\?/, "")) : null);
const docblock = (n: Node): string => {
  const prev = n.previousNamedSibling;
  return prev?.type === "comment" ? prev.text : "";
};
const atributos = (n: Node): Node[] => hijos(campo(n, "attributes")).flatMap((l) => l.descendantsOfType("attribute").filter(Boolean) as Node[]);
const atributo = (n: Node, nombre: string): Node | null => atributos(n).find((a) => ultimo(hijos(a)[0]?.text ?? "") === nombre) ?? null;
/** Clase instanciada por `new X()` directo o asignada a la variable dentro de la función que contiene `desde`. */
function claseCreada(desde: Node, arg: Node | undefined): string | null {
  if (!arg) return null;
  const nueva = (n: Node | null | undefined) => (n?.type === "object_creation_expression" ? ultimo(hijos(n)[0]?.text ?? "") : null);
  if (arg.type === "object_creation_expression") return nueva(arg);
  if (arg.type !== "variable_name") return null;
  let f: Node | null = desde.parent;
  while (f && !["method_declaration", "function_definition", "anonymous_function", "arrow_function"].includes(f.type)) f = f.parent;
  let cls: string | null = null;
  for (const a of (f ?? desde).descendantsOfType("assignment_expression").filter(Boolean) as Node[]) {
    if (a.startIndex > desde.startIndex) break;
    if (campo(a, "left")?.text === arg.text) cls = nueva(campo(a, "right")) ?? cls;
  }
  return cls;
}
const snakePlural =(s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase() + "s";

function extraer(repo: RepoFuente, parser: TSParser): Extraccion {
  const out = extraccionVacia("php-parser");
  const arboles: Array<{ archivo: string; raiz: Node }> = [];
  for (const archivo of repo.archivos.filter((a) => a.endsWith(".php"))) {
    const arbol = parser.parse(readFileSync(join(repo.raiz, archivo), "utf8"));
    if (arbol) arboles.push({ archivo, raiz: arbol.rootNode });
  }

  // ---------- 1. Clases y símbolos ----------
  const clases = new Map<string, Clase>();
  for (const { archivo, raiz } of arboles) {
    const simbolos: Simbolo[] = [];
    for (const c of raiz.descendantsOfType("class_declaration").filter(Boolean) as Node[]) {
      const nombre = campo(c, "name")?.text;
      if (!nombre) continue;
      const lineaClase = linea(campo(c, "name")!);
      simbolos.push({ linea: lineaClase, nombre, tipo: "clase", fin: c.endPosition.row + 1 });
      const base = hijos(c).find((x) => x.type === "base_clause");
      const metodos = new Map<string, Metodo>();
      let tabla: string | null = null;
      for (const m of hijos(campo(c, "body"))) {
        if (m.type === "method_declaration") {
          const nm = campo(m, "name")?.text ?? "";
          const params = hijos(campo(m, "parameters")).map((p) => tipoDe(campo(p, "type")));
          metodos.set(nm, { nombre: nm, linea: linea(campo(m, "name") ?? m), params, retorno: tipoDe(campo(m, "return_type")), nodo: m });
          // Con rango, para atribuir cada acceso o llamada al método que lo contiene y encontrar el que atiende un endpoint.
          if (nm) simbolos.push({ linea: linea(campo(m, "name") ?? m), nombre: `${nombre}.${nm}`, tipo: "metodo", fin: m.endPosition.row + 1 });
        }
        if (m.type === "property_declaration" && /\$table\b/.test(m.text)) tabla = textoString(m.descendantsOfType("string")[0]);
      }
      const info: Clase = {
        nombre,
        extiende: base ? ultimo(hijos(base)[0]?.text ?? "") : null,
        archivo,
        linea: lineaClase,
        metodos,
        tabla,
        doc: docblock(c),
        nodo: c,
      };
      if (!clases.has(nombre)) clases.set(nombre, info);
    }
    // Interfaces, enums y traits: no tienen métodos que se recorran, pero sus usos se siguen (`referencias`).
    for (const d of raiz.descendantsOfType(["interface_declaration", "enum_declaration", "trait_declaration"]).filter(Boolean) as Node[]) {
      const nombre = campo(d, "name")?.text;
      if (nombre) simbolos.push({ linea: linea(campo(d, "name")!), nombre, tipo: d.type === "enum_declaration" ? "enum" : d.type === "trait_declaration" ? "clase" : "interfaz", fin: d.endPosition.row + 1 });
    }
    for (const f of raiz.descendantsOfType("function_definition").filter(Boolean) as Node[]) {
      const nombre = campo(f, "name")?.text;
      if (nombre) simbolos.push({ linea: linea(f), nombre, tipo: "funcion" });
    }
    simbolos.sort((a, b) => a.linea - b.linea);
    out.archivos.push({ lenguaje: "php", ruta: archivo, simbolos });
  }
  // ---------- 1b. Llamadas entre métodos: de quién es cada `->metodo()` ----------
  // El tipo del receptor sale de lo que el código declara: `$this`, propiedades tipadas o inyectadas por el constructor,
  // parámetros tipados del método (inyección en la acción), `new`, llamadas estáticas y `getRepository(X::class)`.
  // Sin tipo declarado no se adivina.
  const implementan = new Map<string, string[]>();
  for (const c of clases.values()) {
    for (const i of hijos(hijos(c.nodo).find((x) => x.type === "class_interface_clause"))) implementan.set(ultimo(i.text), [...(implementan.get(ultimo(i.text)) ?? []), c.nombre]);
  }
  /** La clase del repo para un tipo: ella misma, o la única que implementa esa interfaz. */
  const concreta = (t: string | null | undefined): string | null => (!t ? null : clases.has(t) ? t : implementan.get(t)?.length === 1 ? implementan.get(t)![0]! : null);
  const metodoDe = (cls: string | null, nombre: string): { clase: Clase; m: Metodo } | null => {
    for (let i = 0, n = cls; n && i < 8; i++) {
      const c = clases.get(n);
      const m = c?.metodos.get(nombre);
      if (c && m) return { clase: c, m };
      n = c?.extiende ?? null;
    }
    return null;
  };
  const sinPesos = (t: string | undefined) => (t ?? "").replace(/^\$/, "");
  // Qué clases del repo definen cada nombre de método: una llamada sin tipo a ese nombre puede ir a alguna de ellas.
  const definen = new Map<string, string[]>();
  // Solo cuentan los métodos que hacen algo: un getter o setter que no llama a nada no lleva a ninguna tabla.
  const LLAMA = ["member_call_expression", "nullsafe_member_call_expression", "scoped_call_expression", "function_call_expression", "object_creation_expression"];
  for (const c of clases.values()) {
    for (const [m, info] of c.metodos) if (m && !m.startsWith("__") && info.nodo.descendantsOfType(LLAMA).length) definen.set(m, [...(definen.get(m) ?? []), c.nombre]);
  }
  const porRuta = new Map(out.archivos.map((a) => [a.ruta, a]));
  for (const c of clases.values()) {
    const arch = porRuta.get(c.archivo);
    if (!arch) continue;
    const props = new Map<string, string>();
    for (const m of hijos(campo(c.nodo, "body"))) {
      if (m.type !== "property_declaration") continue;
      const t = tipoDe(campo(m, "type"));
      if (t) for (const v of m.descendantsOfType("variable_name").filter(Boolean) as Node[]) props.set(sinPesos(v.text), t);
    }
    const ctor = c.metodos.get("__construct");
    if (ctor) {
      const tipos = new Map<string, string>();
      for (const p of hijos(campo(ctor.nodo, "parameters"))) {
        const t = tipoDe(campo(p, "type")), nm = sinPesos(campo(p, "name")?.text);
        if (!t || !nm) continue;
        tipos.set(nm, t);
        if (p.type === "property_promotion_parameter") props.set(nm, t);
      }
      for (const a of ctor.nodo.descendantsOfType("assignment_expression").filter(Boolean) as Node[]) {
        const l = campo(a, "left"), r = campo(a, "right");
        if (l?.type === "member_access_expression" && campo(l, "object")?.text === "$this" && r?.type === "variable_name") {
          const t = tipos.get(sinPesos(r.text)), nm = campo(l, "name")?.text;
          if (t && nm) props.set(nm, t);
        }
      }
    }
    for (const m of c.metodos.values()) {
      const desde = `${c.nombre}.${m.nombre}`;
      const locales = new Map<string, string>();
      for (const p of hijos(campo(m.nodo, "parameters"))) {
        const t = tipoDe(campo(p, "type")), nm = sinPesos(campo(p, "name")?.text);
        if (t && nm) locales.set(nm, t);
      }
      for (const a of m.nodo.descendantsOfType("assignment_expression").filter(Boolean) as Node[]) {
        const l = campo(a, "left"), r = campo(a, "right");
        if (l?.type === "variable_name" && r?.type === "object_creation_expression") locales.set(sinPesos(l.text), ultimo(hijos(r)[0]?.text ?? ""));
      }
      const vistos = new Set<string>();
      for (const n of m.nodo.descendantsOfType(["member_call_expression", "nullsafe_member_call_expression", "scoped_call_expression"]).filter(Boolean) as Node[]) {
        const nombre = campo(n, "name")?.text;
        if (!nombre) continue;
        let cls: string | null | undefined = null;
        if (n.type === "scoped_call_expression") {
          const sc = ultimo(campo(n, "scope")?.text ?? "");
          cls = sc === "self" || sc === "static" ? c.nombre : sc === "parent" ? c.extiende : sc;
        } else {
          const o = campo(n, "object");
          if (o?.type === "variable_name") cls = o.text === "$this" ? c.nombre : locales.get(sinPesos(o.text));
          else if (o?.type === "member_access_expression" && campo(o, "object")?.text === "$this") cls = props.get(campo(o, "name")?.text ?? "");
          else if (o?.type === "member_call_expression" && campo(o, "name")?.text === "getRepository") {
            // Doctrine: el repositorio de una entidad es, por convención, `<Entidad>Repository`.
            const ent = ultimo((args(o)[0]?.text ?? "").replace(/::class$/, ""));
            cls = ent ? `${ent}Repository` : null;
          }
        }
        const r = metodoDe(concreta(cls), nombre);
        if (!r) {
          // Sin tipo declarado para el receptor y con algún método del repo que se llama así: queda anotada, con sus
          // candidatos, para que alguien (una persona o un modelo) diga a cuál va. Un tipo declarado que no es del
          // repo es del framework: no se anota.
          const cand = definen.get(nombre);
          const receptor = n.type === "scoped_call_expression" ? campo(n, "scope") : campo(n, "object");
          // La variable de donde arranca la cadena (`$request->request->all()` → `$request`): si tiene un tipo
          // declarado que no es del repo, todo lo que cuelga de ella es del framework.
          let base: Node | null = receptor;
          while (base && base.type !== "variable_name") base = campo(base, "object");
          const tipoBase = base && base.text !== "$this" ? locales.get(sinPesos(base.text)) : undefined;
          const ajeno = !!tipoBase && !concreta(tipoBase);
          if (!cls && cand && receptor && receptor.text !== "$this" && !ajeno) {
            const llamada = `${receptor.text.replace(/\s+/g, " ").slice(0, 60)}->${nombre}`;
            if (!(arch.sinResolver ?? []).some((x) => x.linea === linea(n) && x.llamada === llamada)) {
              (arch.sinResolver ??= []).push({ desde, linea: linea(n), llamada, candidatos: cand.slice(0, 6).map((k) => `${k}.${nombre}`).sort() });
            }
          }
          continue;
        }
        const simbolo = `${r.clase.nombre}.${r.m.nombre}`;
        if (simbolo === desde || vistos.has(simbolo)) continue;
        vistos.add(simbolo);
        (arch.invoca ??= []).push({ desde, archivo: r.clase.archivo, simbolo, linea: linea(n) });
      }
    }
  }

  const hereda = (nombre: string | null, bases: Set<string>): boolean => {
    for (let i = 0, n = nombre; n && i < 8; i++) {
      if (bases.has(n)) return true;
      n = clases.get(n)?.extiende ?? null;
    }
    return false;
  };
  const esModelo = (n: string) => hereda(clases.get(n)?.extiende ?? null, BASES_MODELO);
  const esEntidad = (c: Clase) => !!atributo(c.nodo, "Entity") || /@(ORM\\)?Entity\b/.test(c.doc);

  // ---------- 1c. Referencias: quién nombra una clase, interfaz, enum o trait del repo ----------
  // En una firma, una propiedad tipada, `new X`, `X::metodo()`, `X::CONSTANTE`, `instanceof`, `catch`, un atributo o
  // `extends`/`implements`. Un nombre que declaran dos archivos no se adivina.
  const declarados = new Map<string, { archivo: string; nombre: string } | null>();
  const TIPOS_PHP = ["class_declaration", "interface_declaration", "enum_declaration", "trait_declaration"];
  for (const { archivo, raiz } of arboles) {
    for (const d of raiz.descendantsOfType(TIPOS_PHP).filter(Boolean) as Node[]) {
      const nombre = campo(d, "name")?.text;
      if (nombre) declarados.set(nombre, declarados.has(nombre) ? null : { archivo, nombre });
    }
  }
  const NOMBRA = new Set(["named_type", "base_clause", "class_interface_clause", "object_creation_expression", "binary_expression", "attribute", "qualified_name"]);
  const nombraTipo = (n: Node): boolean => {
    const p = n.parent;
    if (!p) return false;
    if (NOMBRA.has(p.type)) return true;
    if (p.type === "scoped_call_expression" || p.type === "scoped_property_access_expression") return campo(p, "name")?.id !== n.id;
    if (p.type === "class_constant_access_expression") return hijos(p)[0]?.id === n.id;
    return false;
  };
  for (const { archivo, raiz } of arboles) {
    const arch = porRuta.get(archivo);
    if (!arch) continue;
    const refs = new Map<string, { desde: string; archivo: string; simbolo: string; linea: number }>();
    const llamados = new Set((arch.invoca ?? []).map((i) => `${i.desde}\u0000${i.archivo}\u0000${i.simbolo}`));
    const anotar = (parte: Node, desde: string) => {
      for (const n of parte.descendantsOfType("name").filter(Boolean) as Node[]) {
        if (!nombraTipo(n)) continue;
        const t = declarados.get(n.text);
        if (!t || (t.archivo === archivo && t.nombre === desde)) continue;
        const k = `${desde}\u0000${t.archivo}\u0000${t.nombre}`;
        if (!refs.has(k) && !llamados.has(k)) refs.set(k, { desde, archivo: t.archivo, simbolo: t.nombre, linea: linea(n) });
      }
    };
    for (const d of raiz.descendantsOfType(TIPOS_PHP).filter(Boolean) as Node[]) {
      const nombre = campo(d, "name")?.text;
      if (!nombre) continue;
      for (const h of hijos(d)) {
        // Los atributos de la clase son registro (ruta base, entidad), no uso: quedan afuera, como en el ts-parser.
        if (h.type === "attribute_list") continue;
        if (h.type !== "declaration_list" && h.type !== "enum_declaration_list") {
          anotar(h, nombre);
          continue;
        }
        for (const m of hijos(h)) anotar(m, d.type === "class_declaration" && m.type === "method_declaration" && campo(m, "name") ? `${nombre}.${campo(m, "name")!.text}` : nombre);
      }
    }
    for (const f of raiz.descendantsOfType("function_definition").filter(Boolean) as Node[]) {
      const nombre = campo(f, "name")?.text;
      if (nombre) anotar(f, nombre);
    }
    if (refs.size) arch.referencias = [...refs.values()].sort((a, b) => a.linea - b.linea || (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0) || (a.simbolo < b.simbolo ? -1 : a.simbolo > b.simbolo ? 1 : 0));
  }

  // ---------- 2. Formas: FormRequest y JsonResource ----------
  const formaDeArray = (metodo: Metodo | undefined, valor: (v: Node | null) => string): Forma | null => {
    const ret = metodo?.nodo.descendantsOfType("return_statement")[0];
    const arr = ret?.descendantsOfType("array_creation_expression")[0];
    if (!arr) return null;
    const forma: Forma = {};
    for (const el of hijos(arr)) {
      const [k, v] = hijos(el);
      const clave = textoString(k);
      if (clave && v) forma[clave] = valor(v);
    }
    return forma;
  };
  const tipoDeRegla = (v: Node | null): string => {
    const reglas = (v?.type === "array_creation_expression" ? hijos(v).map((e) => textoString(hijos(e)[0]) ?? "") : (textoString(v) ?? "").split("|")).filter(Boolean);
    let t = reglas.some((r) => /^(integer|numeric|decimal)/.test(r)) ? "number" : reglas.includes("boolean") ? "boolean" : reglas.includes("array") ? "unknown[]" : "string";
    if (reglas.includes("nullable")) t += " | null";
    if (!reglas.includes("required")) t += " | undefined";
    return t;
  };
  for (const c of clases.values()) {
    const p = paqueteDe(repo, c.archivo);
    let forma: Forma | null = null;
    if (hereda(c.extiende, new Set(["FormRequest"]))) forma = formaDeArray(c.metodos.get("rules"), tipoDeRegla);
    else if (hereda(c.extiende, new Set(["JsonResource", "Resource"]))) forma = formaDeArray(c.metodos.get("toArray"), () => "unknown");
    if (forma) (out.formas[p] ??= {})[c.nombre] = forma;
  }
  const tipoRequest = (m: Metodo): string | null =>
    m.params.find((t) => t !== null && t !== "Request" && (hereda(t, new Set(["FormRequest", "Request"])) || /Request$/.test(t))) ?? null;
  const tipoResponse = (m: Metodo): string | null => (m.retorno && !SIN_TIPO.has(m.retorno) ? m.retorno : null);

  // ---------- 3. Rutas de Laravel ----------
  const agregarRuta = (paquete: string, metodo: string, ruta: string, handler: Node | undefined, call: Node, archivo: string) => {
    let ctrl: string | null = null;
    let accion: string | null = null;
    if (handler?.type === "array_creation_expression") {
      const [c, a] = hijos(handler).map((e) => hijos(e)[0]);
      if (c?.type === "class_constant_access_expression") ctrl = ultimo(hijos(c)[0]?.text ?? "");
      accion = textoString(a);
    } else {
      const s = textoString(handler);
      if (s?.includes("@")) [ctrl, accion] = [ultimo(s.split("@")[0]!), s.split("@")[1]!];
    }
    const m = ctrl && accion ? clases.get(ctrl)?.metodos.get(accion) : undefined;
    const clase = ctrl ? clases.get(ctrl) : undefined;
    out.endpoints.push({
      paquete,
      metodo,
      ruta: normalizarRuta(ruta),
      request: m ? tipoRequest(m) : null,
      response: m ? tipoResponse(m) : null,
      archivo: m && clase ? clase.archivo : archivo,
      linea: m ? m.linea : linea(call),
    });
  };
  const unir = (...ps: string[]) => "/" + ps.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");

  for (const { archivo, raiz } of arboles) {
    const m = /(?:^|\/)routes\/([^/]+)\.php$/.exec(archivo);
    if (!m) continue;
    const paquete = paqueteDe(repo, archivo);
    const base = m[1] === "api" ? "api" : "";
    const visitar = (n: Node, prefijo: string): void => {
      // ...->group(closure) con prefix() en la cadena, o Route::group(['prefix' => 'x'], closure)
      const esGroup = (n.type === "member_call_expression" || n.type === "scoped_call_expression") && campo(n, "name")?.text === "group";
      if (esGroup) {
        let p = "";
        for (let x: Node | null = n; x; x = x.type === "member_call_expression" ? campo(x, "object") : null) {
          if (campo(x, "name")?.text === "prefix") p = textoString(args(x)[0]) ?? p;
        }
        const as = args(n);
        const cfg = as.find((a) => a.type === "array_creation_expression");
        for (const el of hijos(cfg)) {
          const [k, v] = hijos(el);
          if (textoString(k) === "prefix") p = textoString(v) ?? p;
        }
        const cierre = as.find((a) => a.type === "anonymous_function" || a.type === "anonymous_function_creation_expression" || a.type === "arrow_function");
        if (cierre) {
          visitar(cierre, unir(prefijo, p));
          return;
        }
      }
      const nombre = campo(n, "name")?.text ?? "";
      if ((n.type === "scoped_call_expression" || n.type === "member_call_expression") && METODOS.includes(nombre)) {
        const r = raizCadena(n);
        const esRoute = (r.type === "scoped_call_expression" && ultimo(campo(r, "scope")?.text ?? "") === "Route") || ultimo(campo(n, "scope")?.text ?? "") === "Route";
        const [ruta, handler] = args(n);
        const t = textoString(ruta);
        if (esRoute && t !== null) {
          agregarRuta(paquete, nombre.toUpperCase(), unir(base, prefijo, t), handler, n, archivo);
          return;
        }
      }
      for (const h of hijos(n)) visitar(h, prefijo);
    };
    visitar(raiz, "");
  }

  // ---------- 4. Rutas de Symfony ----------
  const rutaSymfony = (n: Node): { ruta: string; metodos: string[] } | null => {
    const a = atributo(n, "Route");
    if (a) {
      const ruta = textoString(argNombrado(a, "path")) ?? textoString(args(a)[0]) ?? "";
      const ms = argNombrado(a, "methods");
      const metodos = ms ? (ms.type === "array_creation_expression" ? hijos(ms).map((e) => textoString(hijos(e)[0]) ?? "") : [textoString(ms) ?? ""]) : [];
      return { ruta, metodos: metodos.filter(Boolean) };
    }
    const d = /@Route\(\s*"([^"]*)"([^)]*)\)/.exec(docblock(n));
    if (d) {
      const ms = /methods\s*=\s*\{([^}]*)\}/.exec(d[2]!);
      return { ruta: d[1]!, metodos: ms ? [...ms[1]!.matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]!) : [] };
    }
    return null;
  };
  for (const c of clases.values()) {
    const prefijo = rutaSymfony(c.nodo)?.ruta ?? "";
    for (const m of c.metodos.values()) {
      const r = rutaSymfony(m.nodo);
      if (!r) continue;
      let ms = r.metodos.map((x) => x.toUpperCase()).filter((x) => x !== "OPTIONS" && x !== "HEAD");
      if (ms.length === 0) ms = ["GET"];
      for (const metodo of [...new Set(ms)]) {
        out.endpoints.push({
          paquete: paqueteDe(repo, c.archivo),
          metodo,
          ruta: normalizarRuta(unir(prefijo, r.ruta)),
          request: tipoRequest(m),
          response: tipoResponse(m),
          archivo: c.archivo,
          linea: m.linea,
        });
      }
    }
  }

  // ---------- 5. Llamadas HTTP y accesos a datos ----------
  for (const c of clases.values()) {
    if (esModelo(c.nombre)) out.modelos.push({ paquete: paqueteDe(repo, c.archivo), nombre: c.nombre, tabla: c.tabla ?? snakePlural(c.nombre), archivo: c.archivo, linea: c.linea });
    else if (esEntidad(c)) {
      const t = atributo(c.nodo, "Table");
      const tabla = (t && textoString(argNombrado(t, "name"))) ?? /@(?:ORM\\)?Table\(\s*name\s*=\s*"([^"]+)"/.exec(c.doc)?.[1] ?? null;
      out.modelos.push({ paquete: paqueteDe(repo, c.archivo), nombre: c.nombre, tabla, archivo: c.archivo, linea: c.linea });
    }
  }
  const entidades = new Set(out.modelos.map((m) => m.nombre));

  for (const { archivo, raiz } of arboles) {
    const paquete = paqueteDe(repo, archivo);
    const llamada = (n: Node, metodo: string, url: Node | undefined) => {
      const u = analizarUrl(evaluar(url));
      if (u) out.llamadas.push({ paquete, archivo, linea: linea(n), metodo, url: u, dato: null });
    };
    for (const n of raiz.descendantsOfType(["member_call_expression", "scoped_call_expression", "function_call_expression"]).filter(Boolean) as Node[]) {
      const nombre = campo(n, n.type === "function_call_expression" ? "function" : "name")?.text ?? "";
      const as = args(n);
      if (n.type === "function_call_expression") {
        if (nombre === "curl_init" && as[0]) llamada(n, "GET", as[0]);
        continue;
      }
      if (n.type === "scoped_call_expression") {
        const scope = ultimo(campo(n, "scope")?.text ?? "");
        if (scope === "Http" && METODOS.includes(nombre)) llamada(n, nombre.toUpperCase(), as[0]);
        else if (entidades.has(scope) && esModelo(scope)) {
          const verbo = ELOQUENT_ESCRITURA.has(nombre) ? "escribe_en" : ELOQUENT_LECTURA.has(nombre) ? "lee_de" : null;
          if (verbo) out.tablas.push({ paquete, archivo, linea: linea(n), modelo: scope, verbo });
        }
        continue;
      }
      // member_call_expression
      if (METODOS.includes(nombre)) {
        const r = raizCadena(n);
        const viaHttp = r !== n && r.type === "scoped_call_expression" && ultimo(campo(r, "scope")?.text ?? "") === "Http";
        const primera = evaluar(as[0])[0];
        const absoluta = !!primera && "lit" in primera && /^https?:\/\//.test(primera.lit);
        if (viaHttp || absoluta) llamada(n, nombre.toUpperCase(), as[0]);
      } else if (nombre === "request") {
        const m = textoString(as[0])?.toUpperCase();
        if (m && METODOS.includes(m.toLowerCase()) && as[1]) llamada(n, m, as[1]);
      } else if (nombre === "persist" || nombre === "remove") {
        // Doctrine: `$em->persist($x)` con `$x = new Entidad(...)` en la misma función, o `persist(new Entidad())`.
        const cls = claseCreada(n, as[0]);
        if (cls && entidades.has(cls)) out.tablas.push({ paquete, archivo, linea: linea(n), modelo: cls, verbo: "escribe_en" });
      } else if (nombre === "getRepository") {
        const a = as[0];
        const cls = a?.type === "class_constant_access_expression" ? ultimo(hijos(a)[0]?.text ?? "") : null;
        if (cls && entidades.has(cls)) out.tablas.push({ paquete, archivo, linea: linea(n), modelo: cls, verbo: "lee_de" });
      }
    }
  }
  // ---------- 6. Tareas programadas (decisión 197) ----------
  // Un comando de consola (Symfony `#[AsCommand]`/`$defaultName`/`setName`, Laravel `$signature`/`$name`) que corre un
  // horario: `$schedule->command(…)` en `Kernel.php`, `Schedule::command(…)` en `routes/console.php`, una línea de
  // crontab del repo, o una tarea de Symfony Scheduler. Cada una es una entrada `CRON` en el método que la ejecuta.
  const comandos = new Map<string, { clase: Clase; m: Metodo }>();
  const ejecutor = (c: Clase) => c.metodos.get("execute") ?? c.metodos.get("handle") ?? c.metodos.get("__invoke") ?? null;
  for (const c of clases.values()) {
    const m = ejecutor(c);
    if (!m) continue;
    const a = atributo(c.nodo, "AsCommand");
    const props = hijos(campo(c.nodo, "body")).filter((x) => x.type === "property_declaration");
    const prop = (nombre: string) => textoString(props.find((p) => p.descendantsOfType("variable_name").some((v) => v?.text === `$${nombre}`))?.descendantsOfType("string")[0]);
    const setName = c.metodos.get("configure")?.nodo.descendantsOfType("member_call_expression").find((x) => campo(x, "name")?.text === "setName");
    const nombre = (a && (textoString(argNombrado(a, "name")) ?? textoString(args(a)[0]))) ?? prop("defaultName") ?? prop("signature")?.split(/\s/)[0] ?? (setName ? textoString(args(setName)[0]) : null) ?? (c.metodos.has("handle") ? prop("name") : null);
    if (nombre) comandos.set(nombre, { clase: c, m });
  }
  const usadas = new Set<string>();
  const entrada = (nombre: string, horario: string, destino: { clase: Clase; m: Metodo } | null, archivo: string, lin: number) => {
    const donde = destino ? { archivo: destino.clase.archivo, linea: destino.m.linea } : { archivo, linea: lin };
    const paquete = paqueteDe(repo, donde.archivo);
    const base = rutaCron(nombre);
    let ruta = base;
    for (let i = 2; usadas.has(`${paquete}\u0000${ruta}`); i++) ruta = `${base}-${i}`;
    usadas.add(`${paquete}\u0000${ruta}`);
    out.endpoints.push({ paquete, metodo: "CRON", ruta, request: null, response: null, ...donde, horario });
  };
  const claseDe = (n: Node | undefined): Clase | null => {
    if (!n || (n.type !== "class_constant_access_expression" && n.type !== "object_creation_expression")) return null;
    return clases.get(ultimo(hijos(n)[0]?.text ?? "")) ?? null;
  };
  const FRECUENCIA = /^(cron|every\w*|daily\w*|hourly\w*|weekly\w*|monthly\w*|quarterly\w*|yearly\w*|twice\w*|lastDayOfMonth|weekdays|weekends|sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|days|at|between|unlessBetween)$/;
  for (const { archivo, raiz } of arboles) {
    if (!/(^|\/)(Kernel\.php|routes\/console\.php)$/.test(archivo)) continue;
    for (const n of raiz.descendantsOfType(["member_call_expression", "scoped_call_expression"]).filter(Boolean) as Node[]) {
      const que = campo(n, "name")?.text ?? "";
      const receptor = n.type === "member_call_expression" ? campo(n, "object")?.text : ultimo(campo(n, "scope")?.text ?? "");
      const artisan = n.type === "scoped_call_expression" && receptor === "Artisan" && que === "command";
      if (!artisan && !(["command", "job", "call", "exec"].includes(que) && (receptor === "$schedule" || receptor === "Schedule"))) continue;
      // La frecuencia es la cadena que sigue: `->daily()`, `->cron('0 3 * * *')`, `->dailyAt('13:00')`.
      const partes: string[] = [];
      for (let x: Node = n; x.parent?.type === "member_call_expression" && campo(x.parent, "object")?.id === x.id; x = x.parent) {
        const nm = campo(x.parent, "name")?.text ?? "";
        if (FRECUENCIA.test(nm)) partes.push(nm === "cron" ? (textoString(args(x.parent)[0]) ?? "cron") : `${nm}(${args(x.parent).map((a) => textoString(a) ?? a.text).join(", ")})`.replace(/\(\)$/, ""));
      }
      if (!partes.length) continue;
      const a0 = args(n)[0];
      let nombre = que;
      let destino: { clase: Clase; m: Metodo } | null = null;
      if (que === "command" || artisan) {
        const t = textoString(a0)?.split(/\s/)[0];
        const c = claseDe(a0);
        if (t) [nombre, destino] = [t, artisan ? null : (comandos.get(t) ?? null)];
        else if (c && ejecutor(c)) [nombre, destino] = [c.nombre, { clase: c, m: ejecutor(c)! }];
      } else if (que === "job") {
        const c = claseDe(a0);
        if (c) [nombre, destino] = [c.nombre, ejecutor(c) ? { clase: c, m: ejecutor(c)! } : null];
      }
      entrada(nombre, partes.join(" "), destino, archivo, linea(n));
    }
  }
  // Symfony Scheduler: `#[AsCronTask('0 3 * * *')]`, `#[AsPeriodicTask(frequency: '1 hour')]`, y
  // `RecurringMessage::cron|every(…, new Mensaje())` atendido por el `#[AsMessageHandler]` de ese mensaje.
  const manejadores = new Map<string, { clase: Clase; m: Metodo }>();
  for (const c of clases.values()) {
    const a = atributo(c.nodo, "AsMessageHandler");
    const m = c.metodos.get("__invoke");
    if (a && m?.params[0]) manejadores.set(m.params[0], { clase: c, m });
    for (const [attr, clave] of [["AsCronTask", "expression"], ["AsPeriodicTask", "frequency"]] as const) {
      const t = atributo(c.nodo, attr);
      if (!t) continue;
      const h = textoString(argNombrado(t, clave)) ?? textoString(args(t)[0]);
      const metodo = c.metodos.get(textoString(argNombrado(t, "method")) ?? "__invoke") ?? ejecutor(c);
      if (h) entrada(c.nombre, attr === "AsPeriodicTask" ? `cada ${h}` : h, metodo ? { clase: c, m: metodo } : null, c.archivo, c.linea);
    }
  }
  for (const { archivo, raiz } of arboles) {
    for (const n of raiz.descendantsOfType("scoped_call_expression").filter(Boolean) as Node[]) {
      if (ultimo(campo(n, "scope")?.text ?? "") !== "RecurringMessage") continue;
      const que = campo(n, "name")?.text ?? "";
      const [h, msg] = args(n);
      const t = textoString(h);
      const c = claseDe(msg);
      if (!t || !c || !["cron", "every"].includes(que)) continue;
      entrada(c.nombre, que === "every" ? `cada ${t}` : t, manejadores.get(c.nombre) ?? null, archivo, linea(n));
    }
  }
  // Líneas de crontab del repo que corren un comando suyo (`0 3 * * * php bin/console app:x`).
  for (const l of leerCrontabs(repo)) {
    const d = comandos.get(l.comando);
    if (d) entrada(l.comando, l.horario, d, l.archivo, l.linea);
  }
  return out;
}

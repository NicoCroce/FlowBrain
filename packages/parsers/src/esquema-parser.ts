import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cmp } from "@brain/core";
import { extraccionVacia, paqueteDe, type ColumnaCruda, type Extraccion, type Parser, type RepoFuente, type TablaEsquema } from "./tipos.js";

/**
 * Esquema de base de datos: tablas, columnas y claves foráneas. No depende del lenguaje: busca DDL (`CREATE TABLE`,
 * `ALTER TABLE`, `DROP TABLE`) en archivos `.sql` y dentro del texto de cualquier archivo de código (las migraciones
 * suelen llevar el SQL en un string), y modelos en `schema.prisma`. Las sentencias se aplican en orden de ruta, que en
 * migraciones con fecha o número es el cronológico; el resultado es el esquema final.
 */

const CON_DDL = /\.(sql|php|ts|js|mjs|cjs|py|rb|go|java|kt|cs|ex|exs)$/i;
const ES_PRISMA = /(^|\/)[^/]*\.prisma$/;
const HAY_DDL = /\b(CREATE|ALTER|DROP)\s+TABLE\b/i;
const ID = "[`\"\\[]?([A-Za-z_][\\w$]*)[`\"\\]]?";
const NOMBRE = `(?:${ID}\\s*\\.\\s*)?${ID}`;
const limpio = (s: string) => s.replace(/[`"[\]]/g, "").trim();
const lista = (s: string) => s.split(",").map(limpio).filter(Boolean);

/** Parte `a, b(c, d), e` por las comas de nivel cero. */
function partes(cuerpo: string): Array<{ texto: string; pos: number }> {
  const out: Array<{ texto: string; pos: number }> = [];
  let nivel = 0, desde = 0;
  for (let i = 0; i <= cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === "(") nivel++;
    else if (c === ")") nivel--;
    if (i === cuerpo.length || (c === "," && nivel === 0)) {
      out.push({ texto: cuerpo.slice(desde, i), pos: desde });
      desde = i + 1;
    }
  }
  return out.filter((p) => p.texto.trim() !== "");
}

/** Posición del paréntesis que cierra al que está en `abre`; -1 si no cierra. */
function cierre(texto: string, abre: number): number {
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")" && --nivel === 0) return i;
  }
  return -1;
}

const FK = new RegExp(`FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s*REFERENCES\\s+${NOMBRE}\\s*\\(([^)]*)\\)`, "i");
const REF_EN_LINEA = new RegExp(`\\bREFERENCES\\s+${NOMBRE}\\s*\\(([^)]*)\\)`, "i");
const NO_ES_COLUMNA = /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|KEY|INDEX|CHECK|FULLTEXT|SPATIAL|EXCLUDE|LIKE)\b/i;

function columna(def: string): ColumnaCruda | null {
  const m = new RegExp(`^\\s*${ID}\\s+(.+)$`, "s").exec(def);
  if (!m || NO_ES_COLUMNA.test(def.trim())) return null;
  const resto = m[2]!.trim();
  const tipo = /^[A-Za-z_]+(?:\s+(?:VARYING|PRECISION|UNSIGNED|WITH(?:OUT)?\s+TIME\s+ZONE))*(?:\s*\([^)]*\))?(?:\s*\[\])?/i.exec(resto)?.[0] ?? resto.split(/\s+/)[0]!;
  return { nombre: m[1]!, tipo: tipo.replace(/\s+/g, " ").toLowerCase(), nulo: !/\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i.test(resto), pk: /\bPRIMARY\s+KEY\b/i.test(resto) };
}

interface Estado {
  tablas: Map<string, TablaEsquema>;
}

function aplicarDefinicion(t: TablaEsquema, def: string, archivo: string, linea: number) {
  const fk = FK.exec(def);
  if (fk) {
    t.fks.push({ columnas: lista(fk[1]!), tabla: fk[3]!, columnasRef: lista(fk[4]!), archivo, linea });
    return;
  }
  const pk = /^\s*(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(def);
  if (pk) {
    for (const c of lista(pk[1]!)) {
      const col = t.columnas.find((x) => x.nombre === c);
      if (col) { col.pk = true; col.nulo = false; }
    }
    return;
  }
  const col = columna(def);
  if (!col) return;
  t.columnas = t.columnas.filter((x) => x.nombre !== col.nombre);
  t.columnas.push(col);
  const ref = REF_EN_LINEA.exec(def);
  if (ref) t.fks.push({ columnas: [col.nombre], tabla: ref[2]!, columnasRef: lista(ref[3]!), archivo, linea });
}

function aplicarDdl(e: Estado, texto: string, archivo: string) {
  const lineaDe = (pos: number) => texto.slice(0, pos).split("\n").length;
  const sentencia = new RegExp(`\\b(CREATE|ALTER|DROP)\\s+(?:TEMPORARY\\s+|UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?(?:ONLY\\s+)?${NOMBRE}`, "gi");
  for (let m = sentencia.exec(texto); m; m = sentencia.exec(texto)) {
    const accion = m[1]!.toUpperCase(), nombre = m[3]!;
    const fin = m.index + m[0].length;
    if (accion === "DROP") {
      e.tablas.delete(nombre);
      continue;
    }
    if (accion === "CREATE") {
      const abre = texto.indexOf("(", fin);
      // `CREATE TABLE x AS SELECT …` o texto suelto: sin lista de columnas no hay esquema.
      if (abre < 0 || texto.slice(fin, abre).trim() !== "") continue;
      const cierra = cierre(texto, abre);
      if (cierra < 0) continue;
      const t: TablaEsquema = { paquete: "", tabla: nombre, archivo, linea: lineaDe(m.index), columnas: [], fks: [] };
      for (const p of partes(texto.slice(abre + 1, cierra))) aplicarDefinicion(t, p.texto, archivo, lineaDe(abre + 1 + p.pos + (p.texto.length - p.texto.trimStart().length)));
      e.tablas.set(nombre, t);
      continue;
    }
    // ALTER TABLE x <acciones separadas por coma> hasta el `;` o el fin del string que lo contiene.
    const resto = texto.slice(fin, fin + 4000);
    const corte = /;|['"`]\s*[),;]/.exec(resto);
    const acciones = resto.slice(0, corte ? corte.index : resto.length);
    const t = e.tablas.get(nombre) ?? { paquete: "", tabla: nombre, archivo, linea: lineaDe(m.index), columnas: [], fks: [] };
    let toco = false;
    for (const p of partes(acciones)) {
      const a = p.texto.trim();
      const l = lineaDe(fin + p.pos);
      const agrega = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(.+)$/is.exec(a);
      const quita = new RegExp(`^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?${ID}`, "i").exec(a);
      const cambia = new RegExp(`^(?:MODIFY|CHANGE)\\s+(?:COLUMN\\s+)?(?:${ID}\\s+)?(${ID}\\s+.+)$`, "is").exec(a);
      if (agrega) {
        const def = agrega[1]!.replace(/^CONSTRAINT\s+\S+\s+(?=FOREIGN|PRIMARY)/i, "");
        const antes = t.columnas.length + t.fks.length;
        aplicarDefinicion(t, def, archivo, l);
        toco ||= t.columnas.length + t.fks.length !== antes || /PRIMARY/i.test(def);
      } else if (quita && !/^DROP\s+(CONSTRAINT|INDEX|FOREIGN|PRIMARY|KEY)\b/i.test(a)) {
        t.columnas = t.columnas.filter((c) => c.nombre !== quita[1]);
        t.fks = t.fks.filter((f) => !f.columnas.includes(quita[1]!));
        toco = true;
      } else if (cambia) {
        const viejo = /^CHANGE/i.test(a) ? cambia[1] : undefined;
        if (viejo) t.columnas = t.columnas.filter((c) => c.nombre !== viejo);
        aplicarDefinicion(t, cambia[2]!, archivo, l);
        toco = true;
      }
    }
    if (toco) e.tablas.set(nombre, t);
  }
}

/** Modelos de Prisma: campos escalares como columnas, `@relation(fields, references)` como clave foránea, `@@map` como nombre. */
function aplicarPrisma(e: Estado, texto: string, archivo: string) {
  const lineas = texto.split("\n");
  const modelos = new Map<string, { tabla: string; inicio: number; fin: number }>();
  for (let i = 0; i < lineas.length; i++) {
    const m = /^\s*model\s+(\w+)\s*\{/.exec(lineas[i]!);
    if (!m) continue;
    let fin = i;
    while (fin < lineas.length && !/^\s*\}/.test(lineas[fin]!)) fin++;
    const mapa = lineas.slice(i, fin).map((l) => /@@map\(\s*"([^"]+)"/.exec(l)?.[1]).find(Boolean);
    modelos.set(m[1]!, { tabla: mapa ?? m[1]!, inicio: i, fin });
  }
  for (const [, mod] of modelos) {
    const t: TablaEsquema = { paquete: "", tabla: mod.tabla, archivo, linea: mod.inicio + 1, columnas: [], fks: [] };
    for (let i = mod.inicio + 1; i < mod.fin; i++) {
      const c = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(lineas[i]!);
      if (!c || lineas[i]!.trim().startsWith("//") || lineas[i]!.trim().startsWith("@@")) continue;
      const [, nombre, tipo, esLista, opcional, resto] = c;
      const otro = modelos.get(tipo!);
      if (otro) {
        const rel = /@relation\([^)]*fields:\s*\[([^\]]*)\][^)]*references:\s*\[([^\]]*)\]/.exec(resto!);
        if (rel) t.fks.push({ columnas: lista(rel[1]!), tabla: otro.tabla, columnasRef: lista(rel[2]!), archivo, linea: i + 1 });
        continue;
      }
      if (esLista && !/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)$/.test(tipo!)) continue;
      const fisico = /@map\(\s*"([^"]+)"/.exec(resto!)?.[1] ?? nombre!;
      t.columnas.push({ nombre: fisico, tipo: `${tipo!.toLowerCase()}${esLista ? "[]" : ""}`, nulo: !!opcional, pk: /@id\b/.test(resto!) });
    }
    e.tablas.set(mod.tabla, t);
  }
}

export const esquemaParser: Parser = {
  nombre: "esquema-parser",
  detect: (repo) => repo.archivos.some((a) => CON_DDL.test(a) || ES_PRISMA.test(a)),
  extract(repo: RepoFuente): Extraccion {
    const out = extraccionVacia("esquema-parser");
    const e: Estado = { tablas: new Map() };
    for (const archivo of repo.archivos) {
      const prisma = ES_PRISMA.test(archivo);
      if (!prisma && !CON_DDL.test(archivo)) continue;
      let texto: string;
      try {
        texto = readFileSync(join(repo.raiz, archivo), "utf8");
      } catch {
        continue;
      }
      if (prisma) aplicarPrisma(e, texto, archivo);
      else if (HAY_DDL.test(texto)) aplicarDdl(e, texto, archivo);
    }
    out.esquema = [...e.tablas.values()]
      .filter((t) => t.columnas.length > 0)
      .map((t) => ({ ...t, paquete: paqueteDe(repo, t.archivo) }))
      .sort((a, b) => cmp(a.tabla, b.tabla));
    return out;
  },
};

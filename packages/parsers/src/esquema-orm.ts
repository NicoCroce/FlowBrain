import type { ColumnaCruda, TablaEsquema } from "./tipos.js";

/**
 * Esquema declarado por un ORM o por un constructor de migraciones, sin SQL. Cada lector reconoce su forma por el texto
 * (no por dependencias del repo): así un repo con varios ORMs, o con uno que se agregue después, se lee solo.
 *
 * - **Migraciones como código** (Laravel `Schema::create`, Knex `createTable`, Rails `create_table`): son el esquema
 *   real y se aplican en orden, como el DDL (`migraciones`).
 * - **Declaraciones del esquema** (Drizzle `pgTable`, tipos de Kysely): también son el esquema real (`migraciones`, sin
 *   orden que importe).
 * - **Modelos** (TypeORM, MikroORM, sequelize-typescript, Sequelize, Mongoose, Doctrine, JPA/Hibernate, Django,
 *   SQLAlchemy, GORM): describen la tabla desde el código; solo completan las tablas que el esquema real no definió
 *   (`modelos`). El nombre de la tabla sale de la declaración o, si no está, de la convención de cada ORM.
 *
 * Lo que ninguno entiende lo completa un extractor del proyecto (sección `esquema`), y la cobertura dice qué tablas
 * quedaron sin columnas.
 */

export interface Aplicador {
  /** Tabla nueva o reemplazada (esquema real). */
  crear(t: Omit<TablaEsquema, "paquete">): void;
  /** Cambios sobre una tabla existente (migración incremental). */
  agregar(tabla: string, cols: ColumnaCruda[], archivo: string, linea: number): void;
  quitar(tabla: string, columnas: string[]): void;
  borrar(tabla: string): void;
  /** Tabla descrita por un modelo: solo cuenta si el esquema real no la trae. */
  modelo(t: Omit<TablaEsquema, "paquete">): void;
}

// ------------------------------------------------------------------ utilidades

const lineaDe = (texto: string, pos: number) => texto.slice(0, pos).split("\n").length;
export const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();
export function plural(s: string): string {
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + "es";
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + "ies";
  return s + "s";
}
const col = (nombre: string, tipo: string, nulo: boolean, pk = false): ColumnaCruda => ({ nombre, tipo: (tipo || "?").replace(/\s+/g, " ").trim().slice(0, 80), nulo: pk ? false : nulo, pk });

/** Posición del cierre que corresponde a la apertura en `abre` (`(`, `{` o `[`), saltando strings y comentarios; -1 si no cierra. */
export function cierreDe(texto: string, abre: number): number {
  const par: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const a = texto[abre]!, c = par[a];
  if (!c) return -1;
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    const ch = texto[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < texto.length && texto[i] !== ch; i++) if (texto[i] === "\\") i++;
      continue;
    }
    if (ch === "/" && texto[i + 1] === "/") { i = texto.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (ch === "/" && texto[i + 1] === "*") { i = texto.indexOf("*/", i + 2); if (i < 0) return -1; i++; continue; }
    if (ch === a) nivel++;
    else if (ch === c && --nivel === 0) return i;
  }
  return -1;
}

/** Entradas `clave: valor` de nivel cero de un objeto literal (sin las llaves). */
function entradas(cuerpo: string, base: number): Array<{ clave: string; valor: string; pos: number }> {
  const out: Array<{ clave: string; valor: string; pos: number }> = [];
  let i = 0;
  while (i < cuerpo.length) {
    const m = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(?:(["'])([^"']+)\1|([A-Za-z_$][\w$]*))\s*:\s*/.exec(cuerpo.slice(i));
    if (!m) {
      const sig = cuerpo.indexOf(",", i);
      if (sig < 0) break;
      i = sig + 1;
      continue;
    }
    const desde = i + m[0].length;
    let j = desde;
    for (; j < cuerpo.length && cuerpo[j] !== ","; j++) {
      const ch = cuerpo[j]!;
      if (ch === "(" || ch === "{" || ch === "[") { const k = cierreDe(cuerpo, j); if (k < 0) { j = cuerpo.length; break; } j = k; }
      else if (ch === '"' || ch === "'" || ch === "`") { for (j++; j < cuerpo.length && cuerpo[j] !== ch; j++) if (cuerpo[j] === "\\") j++; }
    }
    out.push({ clave: m[2] ?? m[3]!, valor: cuerpo.slice(desde, j).trim(), pos: base + i + m[0].search(/\S/) });
    i = j + 1;
  }
  return out;
}

const cadena = (s: string | undefined) => (s ? /^\s*["'`]([^"'`]+)["'`]/.exec(s)?.[1] : undefined);
const opcion = (args: string, ...nombres: string[]) => {
  for (const n of nombres) {
    const m = new RegExp(`\\b${n}\\s*[:=]\\s*["'\`]([^"'\`]+)["'\`]`).exec(args);
    if (m) return m[1];
  }
  return undefined;
};
const verdadero = (args: string, ...nombres: string[]) => nombres.some((n) => new RegExp(`\\b${n}\\s*[:=]\\s*(true|True)\\b`).test(args));
const falso = (args: string, ...nombres: string[]) => nombres.some((n) => new RegExp(`\\b${n}\\s*[:=]\\s*(false|False)\\b`).test(args));

// ------------------------------------------------------------------ TypeScript / JavaScript

const DECO_TABLA = /@(Entity|Table|Schema)\s*(\()?/g;
const DECO_COLUMNA = /^(Column|PrimaryGeneratedColumn|PrimaryColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn|ObjectIdColumn|Property|PrimaryKey|SerializedPrimaryKey|Enum|Prop|JoinColumn)$/;

/** Clases con decoradores: TypeORM y MikroORM (`@Entity`), sequelize-typescript (`@Table`), Mongoose de Nest (`@Schema` + `@Prop`). */
function decoradores(texto: string, archivo: string, ap: Aplicador) {
  for (let m = DECO_TABLA.exec(texto); m; m = DECO_TABLA.exec(texto)) {
    const tipoDeco = m[1]!;
    let args = "";
    if (m[2]) {
      const k = cierreDe(texto, m.index + m[0].length - 1);
      if (k < 0) continue;
      args = texto.slice(m.index + m[0].length, k);
    }
    const cl = /^[\s\S]*?\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/.exec(texto.slice(m.index, m.index + 3000));
    if (!cl) continue;
    const abre = m.index + cl[0].length - 1, cierra = cierreDe(texto, abre);
    if (cierra < 0) continue;
    const clase = cl[1]!, cuerpo = texto.slice(abre + 1, cierra);
    const columnas: ColumnaCruda[] = [];
    let pendientes: Array<{ nombre: string; args: string }> = [];
    let i = 0;
    while (i < cuerpo.length) {
      const resto = cuerpo.slice(i);
      const blanco = /^(\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(resto);
      if (blanco) { i += blanco[0].length; continue; }
      const deco = /^@([A-Za-z_$][\w$]*)\s*/.exec(resto);
      if (deco) {
        let a = "", fin = i + deco[0].length;
        if (cuerpo[fin] === "(") { const k = cierreDe(cuerpo, fin); if (k < 0) break; a = cuerpo.slice(fin + 1, k); fin = k + 1; }
        pendientes.push({ nombre: deco[1]!, args: a });
        i = fin;
        continue;
      }
      const prop = /^(?:(?:public|private|protected|readonly|declare|override|static|accessor)\s+)*([A-Za-z_$][\w$]*)\s*([?!])?\s*:\s*([^;=\n]+)/.exec(resto);
      const decos = pendientes.filter((d) => DECO_COLUMNA.test(d.nombre) || d.nombre === "AllowNull" || d.nombre === "AutoIncrement");
      if (prop && decos.some((d) => DECO_COLUMNA.test(d.nombre))) {
        const todo = decos.map((d) => d.args).join(" ");
        const join = decos.find((d) => d.nombre === "JoinColumn");
        const tsTipo = prop[3]!.trim();
        const nombre = (join ? opcion(join.args, "name") : undefined) ?? opcion(todo, "name", "field", "fieldName") ?? prop[1]!;
        const pk = decos.some((d) => /^(PrimaryGeneratedColumn|PrimaryColumn|PrimaryKey|SerializedPrimaryKey|ObjectIdColumn)$/.test(d.nombre)) || verdadero(todo, "primary", "primaryKey");
        const tipo = opcion(todo, "type", "columnType") ?? cadena(decos.find((d) => /Column$/.test(d.nombre))?.args) ?? /DataTypes?\.(\w+)/.exec(todo)?.[1]?.toLowerCase() ?? (join ? "fk" : tsTipo.replace(/\s*\|\s*(null|undefined)\b/g, ""));
        const nulo = verdadero(todo, "nullable", "allowNull") || decos.some((d) => d.nombre === "AllowNull" && !/false/.test(d.args)) || (prop[2] === "?" && !falso(todo, "nullable")) || /\|\s*null\b/.test(tsTipo) || (tipoDeco === "Schema" && !verdadero(todo, "required"));
        if (!columnas.some((c) => c.nombre === nombre)) columnas.push(col(nombre, tipo, nulo, pk));
      }
      pendientes = [];
      const fin = resto.search(/[;\n]/);
      if (fin < 0) break;
      // Un método: saltar su cuerpo entero.
      const linea = resto.slice(0, fin);
      const llave = linea.indexOf("{");
      if (!prop && llave >= 0 && /\)\s*(:\s*[^{]+)?\{/.test(linea)) { const k = cierreDe(cuerpo, i + llave); i = k < 0 ? cuerpo.length : k + 1; continue; }
      i += fin + 1;
    }
    if (!columnas.length) continue;
    const explicito = cadena(args) ?? opcion(args, "name", "tableName", "collection");
    const tabla = explicito ?? (tipoDeco === "Entity" ? snake(clase) : tipoDeco === "Table" ? plural(clase) : plural(clase.toLowerCase()));
    if (tipoDeco === "Schema" && !columnas.some((c) => c.nombre === "_id")) columnas.unshift(col("_id", "ObjectId", false, true));
    ap.modelo({ tabla, archivo, linea: lineaDe(texto, m.index), columnas, fks: [] });
  }
}

/** Sequelize sin decoradores: `sequelize.define('Pedido', {…}, { tableName })` y `Pedido.init({…}, { tableName })`. */
function sequelize(texto: string, archivo: string, ap: Aplicador) {
  const re = /\.define\(\s*["'`](\w+)["'`]\s*,\s*\{|\b([A-Z][\w$]*)\.init\(\s*\{/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const abre = m.index + m[0].length - 1, cierra = cierreDe(texto, abre);
    if (cierra < 0) continue;
    const despues = texto.slice(cierra + 1, cierra + 600);
    const opciones = /^\s*,\s*\{/.test(despues) ? despues.slice(0, Math.max(0, cierreDe(despues, despues.indexOf("{")))) : "";
    const modelo = m[1] ?? opcion(opciones, "modelName") ?? m[2]!;
    const tabla = opcion(opciones, "tableName") ?? (verdadero(opciones, "freezeTableName") ? modelo : plural(modelo));
    const columnas = entradas(texto.slice(abre + 1, cierra), abre + 1).map((e) => {
      const tipo = /(?:DataTypes?|Sequelize)\.(\w+)/.exec(e.valor)?.[1]?.toLowerCase() ?? "?";
      const obj = e.valor.startsWith("{");
      return col(obj ? opcion(e.valor, "field") ?? e.clave : e.clave, tipo, obj ? !falso(e.valor, "allowNull") && !verdadero(e.valor, "primaryKey") : true, obj && verdadero(e.valor, "primaryKey"));
    });
    if (columnas.length) ap.modelo({ tabla, archivo, linea: lineaDe(texto, m.index), columnas, fks: [] });
  }
}

/** Mongoose: `const s = new Schema({…}, { collection })` unido a su `model('Usuario', s)`. Sin `collection`, el nombre del modelo en minúscula y plural. */
function mongoose(texto: string, archivo: string, ap: Aplicador) {
  const esquemas = new Map<string, { campos: ColumnaCruda[]; coleccion: string | undefined; pos: number }>();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+(?:mongoose\.)?Schema\s*(?:<[^>]*>)?\s*\(\s*\{/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const abre = m.index + m[0].length - 1, cierra = cierreDe(texto, abre);
    if (cierra < 0) continue;
    const despues = texto.slice(cierra + 1, cierra + 400);
    const campos = entradas(texto.slice(abre + 1, cierra), abre + 1).map((e) => {
      const tipo = /^\[/.test(e.valor) ? "array" : /^\{/.test(e.valor) ? (/\btype\s*:\s*([\w.[\]]+)/.exec(e.valor)?.[1] ?? "object") : e.valor.split(/[\s,]/)[0]!;
      return col(e.clave, tipo.replace(/^(mongoose\.)?Schema\.Types\./, ""), !verdadero(e.valor, "required"));
    });
    esquemas.set(m[1]!, { campos: [col("_id", "ObjectId", false, true), ...campos], coleccion: /^\s*,\s*\{/.test(despues) ? opcion(despues, "collection") : undefined, pos: m.index });
  }
  const mod = /\bmodel\s*(?:<[^>]*>)?\(\s*["'`](\w+)["'`]\s*,\s*([A-Za-z_$][\w$]*)\s*(?:,\s*["'`](\w+)["'`])?/g;
  for (let m = mod.exec(texto); m; m = mod.exec(texto)) {
    const s = esquemas.get(m[2]!);
    if (!s) continue;
    ap.modelo({ tabla: m[3] ?? s.coleccion ?? plural(m[1]!.toLowerCase()), archivo, linea: lineaDe(texto, s.pos), columnas: s.campos, fks: [] });
  }
}

/** Drizzle: `pgTable('pedidos', { id: serial('id').primaryKey(), … })` (también `mysqlTable`, `sqliteTable`). Es el esquema real. */
function drizzle(texto: string, archivo: string, ap: Aplicador) {
  const re = /\b(?:pg|mysql|sqlite|singlestore)Table\s*\(\s*["'`]([\w.]+)["'`]\s*,\s*(?:\([^)]*\)\s*=>\s*\(?\s*)?\{/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const abre = m.index + m[0].length - 1, cierra = cierreDe(texto, abre);
    if (cierra < 0) continue;
    const columnas = entradas(texto.slice(abre + 1, cierra), abre + 1).map((e) => {
      const b = /^(?:\w+\.)?(\w+)\s*\(\s*(?:["'`](\w+)["'`])?/.exec(e.valor);
      const pk = /\.primaryKey\(/.test(e.valor);
      return col(b?.[2] ?? e.clave, b?.[1] ?? "?", !pk && !/\.notNull\(/.test(e.valor), pk);
    });
    if (columnas.length) ap.crear({ tabla: m[1]!.split(".").pop()!, archivo, linea: lineaDe(texto, m.index), columnas, fks: [] });
  }
}

/**
 * Constructores de migraciones con una variable por tabla (`t.string('nombre')`, `$table->string('nombre')`): Knex y
 * Laravel. `nuloPorDefecto` dice si una columna sin modificadores admite nulo (Knex sí, Laravel no).
 */
function cuerpoDeConstructor(cuerpo: string, base: number, texto: string, v: string, flecha: string, nuloPorDefecto: boolean) {
  const cols: ColumnaCruda[] = [], quita: string[] = [];
  const re = new RegExp(`${v.replace(/\$/g, "\\$")}\\s*${flecha}\\s*(\\w+)\\s*\\(([^)]*)\\)([^;\\n]*)`, "g");
  for (let m = re.exec(cuerpo); m; m = re.exec(cuerpo)) {
    const metodo = m[1]!, args = m[2]!, mods = m[3]!;
    const nombre = cadena(args);
    const nulo = /notNullable\s*\(|\bnullable\s*\(\s*false/.test(mods) ? false : /\bnullable\s*\(\s*(true)?\s*\)/.test(mods) ? true : nuloPorDefecto;
    const pkMod = /->primary\(\)|\.primary\(\)/.test(mods);
    if (/^dropColumns?$/.test(metodo)) { quita.push(...[...args.matchAll(/["'`](\w+)["'`]/g)].map((x) => x[1]!)); continue; }
    if (metodo === "id" || metodo === "increments" || metodo === "bigIncrements") { cols.push(col(nombre ?? "id", metodo === "id" ? "bigint" : metodo, false, true)); continue; }
    if (/^(timestamps|timestampsTz|nullableTimestamps)$/.test(metodo)) { cols.push(col("created_at", "timestamp", true), col("updated_at", "timestamp", true)); continue; }
    if (/^softDeletes(Tz)?$/.test(metodo)) { cols.push(col(nombre ?? "deleted_at", "timestamp", true)); continue; }
    if (metodo === "rememberToken") { cols.push(col("remember_token", "string", true)); continue; }
    if (/^(index|unique|primary|foreign|drop\w*|rename\w*|engine|charset|collation|comment|temporary|after|check|spatialIndex|fullText|references|inTable|onDelete|onUpdate|setNullable|dropNullable)$/.test(metodo)) {
      if (metodo === "primary") for (const x of args.matchAll(/["'`](\w+)["'`]/g)) { const c = cols.find((y) => y.nombre === x[1]); if (c) { c.pk = true; c.nulo = false; } }
      continue;
    }
    if (!nombre) continue;
    cols.push(col(nombre, metodo === "foreignId" || metodo === "foreignUuid" ? "fk" : metodo, nulo, pkMod));
  }
  return { cols, quita, linea: (pos: number) => lineaDe(texto, base + pos) };
}

function knex(texto: string, archivo: string, ap: Aplicador) {
  const re = /\.(createTable(?:IfNotExists)?|alterTable|table)\s*\(\s*["'`](\w+)["'`]\s*,\s*(?:async\s*)?(?:function\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*(?:=>)?\s*\{/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const abre = m.index + m[0].length - 1, cierra = cierreDe(texto, abre);
    if (cierra < 0) continue;
    const { cols, quita } = cuerpoDeConstructor(texto.slice(abre + 1, cierra), abre + 1, texto, m[3]!, "\\.", true);
    const linea = lineaDe(texto, m.index);
    if (m[1]!.startsWith("create")) ap.crear({ tabla: m[2]!, archivo, linea, columnas: cols, fks: [] });
    else { ap.agregar(m[2]!, cols, archivo, linea); if (quita.length) ap.quitar(m[2]!, quita); }
  }
  for (const m of texto.matchAll(/\.dropTable(?:IfExists)?\s*\(\s*["'`](\w+)["'`]/g)) ap.borrar(m[1]!);
}

// ------------------------------------------------------------------ PHP

function laravel(texto: string, archivo: string, ap: Aplicador) {
  const re = /Schema::(create|table)\s*\(\s*["'](\w+)["']\s*,\s*(?:static\s+)?function\s*\(\s*(?:Blueprint\s+)?(\$\w+)\s*\)\s*(?:use\s*\([^)]*\)\s*)?\{/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const abre = m.index + m[0].length - 1, cierra = cierreDe(texto, abre);
    if (cierra < 0) continue;
    const { cols, quita } = cuerpoDeConstructor(texto.slice(abre + 1, cierra), abre + 1, texto, m[3]!, "->", false);
    const linea = lineaDe(texto, m.index);
    if (m[1] === "create") ap.crear({ tabla: m[2]!, archivo, linea, columnas: cols, fks: [] });
    else { ap.agregar(m[2]!, cols, archivo, linea); if (quita.length) ap.quitar(m[2]!, quita); }
  }
  for (const m of texto.matchAll(/Schema::drop(?:IfExists)?\s*\(\s*["'](\w+)["']/g)) ap.borrar(m[1]!);
}

/** Doctrine: entidad con atributos (`#[ORM\Column]`) o anotaciones (`@ORM\Column`). Sin nombre de tabla, la clase en snake_case. */
function doctrine(texto: string, archivo: string, ap: Aplicador) {
  const cl = /\bclass\s+(\w+)[^{]*\{/.exec(texto);
  if (!cl || !/(ORM\\Entity|@Entity\b|#\[Entity\b)/.test(texto.slice(0, cl.index + cl[0].length))) return;
  const cabeza = texto.slice(0, cl.index);
  const tabla = /(?:ORM\\)?Table\s*\(\s*(?:name\s*[:=]\s*)?["'](\w+)["']/.exec(cabeza)?.[1] ?? snake(cl[1]!);
  const columnas: ColumnaCruda[] = [];
  const re = /((?:\s*(?:#\[[^\]]*(?:\[[^\]]*\][^\]]*)*\]|\/\*\*[\s\S]*?\*\/))+)\s*(?:public|protected|private)\s+(?:readonly\s+)?(\??[\w\\|]+\s+)?\$(\w+)/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const meta = m[1]!;
    const join = /JoinColumn\s*\(([^)]*)\)/.exec(meta);
    const columna = /(?:ORM\\|@|#\[)Column\b\s*(?:\(([^)]*)\))?/.exec(meta);
    if (!columna && !join) continue;
    const args = columna?.[1] ?? join?.[1] ?? "";
    const nombre = opcion(args, "name") ?? (join ? `${snake(m[3]!)}_id` : snake(m[3]!));
    const tipo = opcion(args, "type") ?? /Types::(\w+)/.exec(args)?.[1]?.toLowerCase() ?? (join ? "fk" : (m[2] ?? "").replace(/^\?/, "").trim());
    columnas.push(col(nombre, tipo, verdadero(args, "nullable") || (m[2] ?? "").startsWith("?"), /(ORM\\|@|#\[)Id\b/.test(meta)));
  }
  if (columnas.length) ap.modelo({ tabla, archivo, linea: lineaDe(texto, cl.index), columnas, fks: [] });
}

// ------------------------------------------------------------------ Java (JPA / Hibernate)

function jpa(texto: string, archivo: string, ap: Aplicador) {
  const cl = /@Entity\b[\s\S]*?\bclass\s+(\w+)[^{]*\{/.exec(texto);
  if (!cl) return;
  const abre = cl.index + cl[0].length - 1, cierra = cierreDe(texto, abre);
  if (cierra < 0) return;
  const tabla = /@Table\s*\(\s*(?:name\s*=\s*)?"(\w+)"/.exec(cl[0])?.[1] ?? snake(cl[1]!);
  const cuerpo = texto.slice(abre + 1, cierra);
  const columnas: ColumnaCruda[] = [];
  const re = /((?:\s*@\w+(?:\([^)]*\))?)*)\s*(?:private|protected|public)\s+(?!static\b)(?:final\s+)?([\w<>,.?\s[\]]+?)\s+(\w+)\s*(?:=[^;]*)?;/g;
  for (let m = re.exec(cuerpo); m; m = re.exec(cuerpo)) {
    const anot = m[1]!;
    if (/@(Transient|OneToMany|ManyToMany)\b/.test(anot)) continue;
    const args = /@Column\s*\(([^)]*)\)/.exec(anot)?.[1] ?? /@JoinColumn\s*\(([^)]*)\)/.exec(anot)?.[1] ?? "";
    const join = /@(ManyToOne|OneToOne)\b/.test(anot);
    const nombre = opcion(args, "name") ?? (join ? `${snake(m[3]!)}_id` : snake(m[3]!));
    columnas.push(col(nombre, join ? "fk" : m[2]!.trim(), !falso(args, "nullable") && !/@(Id|NotNull)\b/.test(anot) && !/^(int|long|boolean|double|float|short|byte|char)$/.test(m[2]!.trim()), /@Id\b/.test(anot)));
  }
  if (columnas.length) ap.modelo({ tabla, archivo, linea: lineaDe(texto, cl.index), columnas, fks: [] });
}

// ------------------------------------------------------------------ Go (GORM)

function gorm(texto: string, archivo: string, ap: Aplicador) {
  const re = /type\s+(\w+)\s+struct\s*\{/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const abre = m.index + m[0].length - 1, cierra = cierreDe(texto, abre);
    if (cierra < 0) continue;
    const cuerpo = texto.slice(abre + 1, cierra);
    if (!/gorm:"/.test(cuerpo) && !/^\s*gorm\.Model\s*$/m.test(cuerpo)) continue;
    const columnas: ColumnaCruda[] = [];
    if (/^\s*gorm\.Model\s*$/m.test(cuerpo)) columnas.push(col("id", "uint", false, true), col("created_at", "time.Time", true), col("updated_at", "time.Time", true), col("deleted_at", "gorm.DeletedAt", true));
    for (const f of cuerpo.matchAll(/^\s*([A-Z]\w*)\s+([*\w.[\]]+)\s*(`[^`]*`)?/gm)) {
      const tag = /gorm:"([^"]*)"/.exec(f[3] ?? "")?.[1] ?? "";
      if (tag === "-" || /^\[\]/.test(f[2]!)) continue;
      const nombre = /column:(\w+)/.exec(tag)?.[1] ?? snake(f[1]!);
      columnas.push(col(nombre, /type:([^;]+)/.exec(tag)?.[1] ?? f[2]!.replace(/^\*/, ""), f[2]!.startsWith("*") && !/not null/i.test(tag), /primaryKey|primary_key/i.test(tag) || f[1] === "ID"));
    }
    const explicito = new RegExp(`func\\s*\\(\\w*\\s*\\*?${m[1]}\\)\\s*TableName\\(\\)\\s*string\\s*\\{\\s*return\\s*"(\\w+)"`).exec(texto)?.[1];
    if (columnas.length) ap.modelo({ tabla: explicito ?? plural(snake(m[1]!)), archivo, linea: lineaDe(texto, m.index), columnas, fks: [] });
  }
}

// ------------------------------------------------------------------ Python

/** Clases de Python con su cuerpo (las líneas más indentadas que la clase). */
function clasesPy(texto: string): Array<{ nombre: string; bases: string; cuerpo: string; pos: number }> {
  const out: Array<{ nombre: string; bases: string; cuerpo: string; pos: number }> = [];
  for (const m of texto.matchAll(/^([ \t]*)class\s+(\w+)\s*\(([^)]*)\)\s*:/gm)) {
    const sangria = m[1]!.length, desde = m.index! + m[0].length;
    const lineas = texto.slice(desde).split("\n").slice(1);
    const cuerpo: string[] = [];
    for (const l of lineas) {
      if (l.trim() && l.length - l.trimStart().length <= sangria) break;
      cuerpo.push(l);
    }
    out.push({ nombre: m[2]!, bases: m[3]!, cuerpo: cuerpo.join("\n"), pos: m.index! });
  }
  return out;
}

function django(texto: string, archivo: string, ap: Aplicador) {
  const partes = archivo.split("/");
  const app = partes[partes.length - 2] === "models" ? partes[partes.length - 3] : partes[partes.length - 2];
  for (const c of clasesPy(texto)) {
    if (!/\bModel\b/.test(c.bases) || /abstract\s*=\s*True/.test(c.cuerpo)) continue;
    const columnas: ColumnaCruda[] = [];
    for (const f of c.cuerpo.matchAll(/^\s+(\w+)\s*=\s*(?:models\.)?(\w+(?:Field|Key))\s*\((.*)$/gm)) {
      if (f[2] === "ManyToManyField") continue;
      const fk = f[2] === "ForeignKey" || f[2] === "OneToOneField";
      columnas.push(col(opcion(f[3]!, "db_column") ?? (fk ? `${f[1]}_id` : f[1]!), fk ? "fk" : f[2]!, verdadero(f[3]!, "null"), verdadero(f[3]!, "primary_key")));
    }
    if (!columnas.some((x) => x.pk)) columnas.unshift(col("id", "AutoField", false, true));
    const tabla = /db_table\s*=\s*["'](\w+)["']/.exec(c.cuerpo)?.[1] ?? `${app ?? "app"}_${c.nombre.toLowerCase()}`;
    ap.modelo({ tabla, archivo, linea: lineaDe(texto, c.pos), columnas, fks: [] });
  }
}

function sqlalchemy(texto: string, archivo: string, ap: Aplicador) {
  for (const c of clasesPy(texto)) {
    const tabla = /__tablename__\s*=\s*["'](\w+)["']/.exec(c.cuerpo)?.[1];
    if (!tabla) continue;
    const columnas: ColumnaCruda[] = [];
    for (const f of c.cuerpo.matchAll(/^\s+(\w+)\s*(?::\s*Mapped\[(.+?)\])?\s*=\s*(?:\w+\.)?(Column|mapped_column)\s*\((.*)$/gm)) {
      const args = f[4]!;
      const nombre = cadena(args) ?? f[1]!;
      const tipo = /^\s*(?:["'][^"']*["']\s*,\s*)?(?:\w+\.)?(\w+)\b(?!\s*=)/.exec(args)?.[1] ?? f[2]?.replace(/^Optional\[(.*)\]$/, "$1").replace(/\s*\|\s*None$/, "") ?? "?";
      const pk = verdadero(args, "primary_key");
      columnas.push(col(nombre, /ForeignKey/.test(args) ? "fk" : tipo, verdadero(args, "nullable") || (!falso(args, "nullable") && !pk && (f[2] ? /Optional\[|\|\s*None/.test(f[2]) : true)), pk));
    }
    if (columnas.length) ap.modelo({ tabla, archivo, linea: lineaDe(texto, c.pos), columnas, fks: [] });
  }
  // Estilo "core": Table('pedidos', metadata, Column('id', Integer, primary_key=True), …)
  for (const m of texto.matchAll(/\bTable\s*\(\s*["'](\w+)["']\s*,/g)) {
    const abre = texto.indexOf("(", m.index!), cierra = cierreDe(texto, abre);
    if (cierra < 0) continue;
    const columnas = [...texto.slice(abre, cierra).matchAll(/Column\s*\(\s*["'](\w+)["']\s*,\s*(?:\w+\.)?(\w+)([^)]*(?:\([^)]*\)[^)]*)*)\)/g)].map((x) => col(x[1]!, x[2]!, !falso(x[3]!, "nullable") && !verdadero(x[3]!, "primary_key"), verdadero(x[3]!, "primary_key")));
    if (columnas.length) ap.crear({ tabla: m[1]!, archivo, linea: lineaDe(texto, m.index!), columnas, fks: [] });
  }
}

// ------------------------------------------------------------------ Ruby (Rails)

function rails(texto: string, archivo: string, ap: Aplicador) {
  const lineas = texto.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const ct = /^\s*create_table\s+[:"']?(\w+)["']?([^\n]*?)\bdo\s*\|(\w+)\|/.exec(lineas[i]!);
    const ch = /^\s*change_table\s+[:"']?(\w+)["']?[^\n]*?\bdo\s*\|(\w+)\|/.exec(lineas[i]!);
    if (ct || ch) {
      const v = ct ? ct[3]! : ch![2]!;
      const cols: ColumnaCruda[] = [];
      if (ct && !/\bid:\s*false/.test(ct[2]!)) cols.push(col("id", "bigint", false, true));
      let j = i + 1;
      for (; j < lineas.length && !/^\s*end\b/.test(lineas[j]!); j++) {
        const t = new RegExp(`^\\s*${v}\\.(\\w+)\\s+[:"']?(\\w+)["']?(.*)$`).exec(lineas[j]!);
        if (new RegExp(`^\\s*${v}\\.timestamps\\b`).test(lineas[j]!)) { cols.push(col("created_at", "datetime", false), col("updated_at", "datetime", false)); continue; }
        if (!t || /^(index|remove_index|check_constraint|foreign_key)$/.test(t[1]!)) continue;
        if (/^(references|belongs_to)$/.test(t[1]!)) { cols.push(col(`${t[2]}_id`, "fk", !/null:\s*false/.test(t[3]!))); continue; }
        cols.push(col(t[2]!, t[1]!, !/null:\s*false/.test(t[3]!), /primary_key:\s*true/.test(t[3]!)));
      }
      if (ct) ap.crear({ tabla: ct[1]!, archivo, linea: i + 1, columnas: cols, fks: [] });
      else ap.agregar(ch![1]!, cols, archivo, i + 1);
      i = j;
      continue;
    }
    const add = /^\s*add_column\s+[:"']?(\w+)["']?\s*,\s*[:"']?(\w+)["']?\s*,\s*[:"']?(\w+)["']?(.*)$/.exec(lineas[i]!);
    if (add) ap.agregar(add[1]!, [col(add[2]!, add[3]!, !/null:\s*false/.test(add[4]!))], archivo, i + 1);
    const rm = /^\s*remove_column\s+[:"']?(\w+)["']?\s*,\s*[:"']?(\w+)["']?/.exec(lineas[i]!);
    if (rm) ap.quitar(rm[1]!, [rm[2]!]);
    const drop = /^\s*drop_table\s+[:"']?(\w+)["']?/.exec(lineas[i]!);
    if (drop) ap.borrar(drop[1]!);
  }
}

// ------------------------------------------------------------------ despacho

/** Aplica los lectores que reconocen el archivo. Cada uno se fija en una marca propia del texto. */
export function aplicarOrm(texto: string, archivo: string, ap: Aplicador) {
  const ext = archivo.slice(archivo.lastIndexOf(".") + 1).toLowerCase();
  if (/^[cm]?[jt]sx?$/.test(ext)) {
    if (/@(Entity|Table|Schema)\s*\(/.test(texto)) decoradores(texto, archivo, ap);
    if (/\.define\(\s*["'`]\w+["'`]\s*,\s*\{|\.init\(\s*\{/.test(texto) && /DataTypes?\./.test(texto)) sequelize(texto, archivo, ap);
    if (/new\s+(?:mongoose\.)?Schema\s*(?:<[^>]*>)?\s*\(/.test(texto)) mongoose(texto, archivo, ap);
    if (/\b(?:pg|mysql|sqlite|singlestore)Table\s*\(/.test(texto)) drizzle(texto, archivo, ap);
    if (/\.(createTable|alterTable|dropTable)\w*\s*\(/.test(texto) || /\.schema\.table\s*\(/.test(texto)) knex(texto, archivo, ap);
  } else if (ext === "php") {
    if (/Schema::(create|table|drop)/.test(texto)) laravel(texto, archivo, ap);
    if (/(ORM\\Entity|@Entity\b|#\[Entity\b)/.test(texto)) doctrine(texto, archivo, ap);
  } else if (ext === "java" || ext === "kt") {
    if (/@Entity\b/.test(texto)) jpa(texto, archivo, ap);
  } else if (ext === "go") {
    if (/gorm/.test(texto)) gorm(texto, archivo, ap);
  } else if (ext === "py") {
    if (/\bmodels\.Model\b|\(Model\)/.test(texto) && /models\.\w+Field|from django/.test(texto)) django(texto, archivo, ap);
    if (/__tablename__|\bTable\s*\(\s*["']/.test(texto) && /sqlalchemy|mapped_column|Column\(/.test(texto)) sqlalchemy(texto, archivo, ap);
  } else if (ext === "rb") {
    if (/\b(create_table|change_table|add_column|remove_column|drop_table)\b/.test(texto)) rails(texto, archivo, ap);
  }
}

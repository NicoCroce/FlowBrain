import { isMap, isPair, isScalar, LineCounter, parseDocument, type Document } from "yaml";

export interface ErrorCompilacion {
  archivo: string;
  linea: number | null;
  mensaje: string;
}

export class CompileError extends Error {
  constructor(public readonly errores: ErrorCompilacion[]) {
    super(errores.map(formatError).join("\n"));
    this.name = "CompileError";
  }
}

export function formatError(e: ErrorCompilacion): string {
  return `${e.archivo}${e.linea !== null ? `:${e.linea}` : ""}: ${e.mensaje}`;
}

export interface PaginaParseada {
  /** Datos crudos del YAML (sin validar). */
  data: unknown;
  /** Texto del frontmatter, sin los delimitadores. */
  frontmatter: string;
  /** Cuerpo Markdown después del delimitador de cierre. */
  cuerpo: string;
  /** Devuelve la línea (1-based, en el archivo) del nodo YAML en `path`, o la del ancestro más cercano. */
  lineaDe(path: ReadonlyArray<string | number>): number;
}

const APERTURA = "---\n";

/**
 * Separa y parsea el frontmatter con `yaml` (YAML 1.2 core): las fechas quedan como strings
 * y cada nodo conserva su posición para reportar errores con línea.
 */
export function parsePagina(archivo: string, contenido: string): PaginaParseada {
  const texto = contenido.replace(/\r\n/g, "\n");
  if (!texto.startsWith(APERTURA)) {
    throw new CompileError([{ archivo, linea: 1, mensaje: "missing frontmatter (the page must start with ---)" }]);
  }
  const resto = texto.slice(APERTURA.length);
  const m = /^---[ \t]*$/m.exec(resto);
  if (!m) throw new CompileError([{ archivo, linea: 1, mensaje: "frontmatter without closing delimiter ---" }]);
  const frontmatter = resto.slice(0, m.index);
  const tras = resto.slice(m.index + m[0].length);
  const cuerpo = tras.startsWith("\n") ? tras.slice(1) : tras;

  const lineCounter = new LineCounter();
  const doc = parseDocument(frontmatter, { lineCounter, version: "1.2", schema: "core", uniqueKeys: true });
  const offset = 1; // la línea 1 del archivo es `---`
  if (doc.errors.length > 0) {
    throw new CompileError(
      doc.errors.map((err) => ({
        archivo,
        linea: (err.linePos?.[0]?.line ?? 1) + offset,
        mensaje: `invalid YAML: ${err.message.split("\n")[0]}`,
      })),
    );
  }

  const lineaDe = (path: ReadonlyArray<string | number>): number => {
    for (let n = path.length; n >= 0; n--) {
      const pos = posicion(doc, path.slice(0, n));
      if (pos !== null) return lineCounter.linePos(pos).line + offset;
    }
    return 1 + offset;
  };

  return { data: doc.toJS(), frontmatter, cuerpo, lineaDe };
}

/** Offset del nodo en `path`. Para una clave de mapa devuelve la posición de la clave. */
function posicion(doc: Document, path: ReadonlyArray<string | number>): number | null {
  if (path.length === 0) {
    const r = doc.contents?.range;
    return r ? r[0] : null;
  }
  const padre = path.length === 1 ? doc.contents : doc.getIn(path.slice(0, -1), true);
  const ultimo = path[path.length - 1];
  if (isMap(padre)) {
    for (const item of padre.items) {
      if (isPair(item) && isScalar(item.key) && item.key.value === ultimo && item.key.range) {
        return item.key.range[0];
      }
    }
  }
  const nodo = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
  return nodo?.range ? nodo.range[0] : null;
}

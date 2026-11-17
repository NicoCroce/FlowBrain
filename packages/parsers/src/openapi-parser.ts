import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isPair, isScalar, LineCounter, parseDocument, type YAMLMap } from "yaml";
import { cmp, normalizarRuta } from "@flowbrain/core";
import { extraccionVacia, paqueteDe, type Extraccion, type Forma, type Parser, type RepoFuente } from "./tipos.js";

/**
 * openapi-parser: cualquier `openapi.*` / `swagger.*` (YAML o JSON). Sus endpoints y tipos prevalecen sobre
 * los inferidos del código para el paquete que lo contiene (`autoritativo`).
 */

const ES_SPEC = /(?:^|\/)(openapi|swagger)\.(ya?ml|json)$/i;
const METODOS = ["get", "post", "put", "patch", "delete", "head", "options"];

export const openapiParser: Parser = {
  nombre: "openapi-parser",
  detect: (repo) => repo.archivos.some((a) => ES_SPEC.test(a)),
  extract: (repo) => extraer(repo),
};

type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const refNombre = (v: unknown): string | null => {
  if (!esObj(v)) return null;
  if (typeof v.$ref === "string") return v.$ref.split("/").pop() ?? null;
  if (v.type === "array" && esObj(v.items) && typeof v.items.$ref === "string") return `${v.items.$ref.split("/").pop()}[]`;
  return null;
};

function tipoTexto(s: unknown): string {
  if (!esObj(s)) return "unknown";
  const r = refNombre(s);
  if (r) return r;
  if (Array.isArray(s.enum)) return s.enum.map((x) => (typeof x === "string" ? `'${x}'` : String(x))).join(" | ");
  if (s.type === "array") return `${tipoTexto(s.items)}[]`;
  if (s.type === "integer") return "number";
  if (typeof s.type === "string") return s.nullable === true ? `${s.type} | null` : s.type;
  return "unknown";
}

function extraer(repo: RepoFuente): Extraccion {
  const out = extraccionVacia("openapi-parser");
  for (const archivo of repo.archivos.filter((a) => ES_SPEC.test(a))) {
    const texto = readFileSync(join(repo.raiz, archivo), "utf8");
    const lc = new LineCounter();
    const doc = parseDocument(texto, { lineCounter: lc, version: "1.2", schema: "core" });
    if (doc.errors.length > 0) continue;
    const spec = doc.toJS() as Obj;
    if (!esObj(spec) || !(typeof spec.openapi === "string" || typeof spec.swagger === "string")) continue;
    const paquete = paqueteDe(repo, archivo);
    out.autoritativo.push(paquete);
    out.archivos.push({ lenguaje: "openapi", ruta: archivo, simbolos: [] });

    // Línea de cada operación: posición de la clave del método dentro de `paths`.
    const pathsNodo = doc.get("paths", true);
    const lineaDe = (ruta: string, metodo: string): number => {
      if (!isMap(pathsNodo)) return 1;
      const pr = (pathsNodo as YAMLMap).items.find((it) => isPair(it) && isScalar(it.key) && it.key.value === ruta);
      const opMap = pr && isPair(pr) ? pr.value : null;
      if (isMap(opMap)) {
        const op = opMap.items.find((it) => isPair(it) && isScalar(it.key) && it.key.value === metodo);
        if (op && isPair(op) && isScalar(op.key) && op.key.range) return lc.linePos(op.key.range[0]).line;
      }
      if (pr && isPair(pr) && isScalar(pr.key) && pr.key.range) return lc.linePos(pr.key.range[0]).line;
      return 1;
    };

    const paths = esObj(spec.paths) ? spec.paths : {};
    for (const ruta of Object.keys(paths).sort(cmp)) {
      const ops = paths[ruta];
      if (!esObj(ops)) continue;
      for (const metodo of METODOS) {
        const op = ops[metodo];
        if (!esObj(op)) continue;
        const rb = esObj(op.requestBody) && esObj(op.requestBody.content) ? op.requestBody.content : {};
        const reqSchema = esObj(rb["application/json"]) ? rb["application/json"].schema : undefined;
        // OpenAPI 2: parámetro `in: body`
        const body2 = Array.isArray(op.parameters) ? op.parameters.find((p) => esObj(p) && p.in === "body") : undefined;
        const request = refNombre(reqSchema) ?? (esObj(body2) ? refNombre(body2.schema) : null);
        let response: string | null = null;
        const resps = esObj(op.responses) ? op.responses : {};
        for (const code of Object.keys(resps).sort(cmp)) {
          if (!/^2\d\d$/.test(code)) continue;
          const r = resps[code];
          const c = esObj(r) && esObj(r.content) && esObj(r.content["application/json"]) ? r.content["application/json"].schema : esObj(r) ? r.schema : undefined;
          response = refNombre(c);
          break;
        }
        out.endpoints.push({ paquete, metodo: metodo.toUpperCase(), ruta: normalizarRuta(ruta), request, response, archivo, linea: lineaDe(ruta, metodo) });
      }
    }

    const schemas = esObj(spec.components) && esObj(spec.components.schemas) ? spec.components.schemas : esObj(spec.definitions) ? spec.definitions : {};
    const formas = (out.formas[paquete] ??= {});
    for (const nombre of Object.keys(schemas).sort(cmp)) {
      const s = schemas[nombre];
      if (!esObj(s) || !esObj(s.properties)) continue;
      const req = new Set(Array.isArray(s.required) ? s.required : []);
      const forma: Forma = {};
      for (const k of Object.keys(s.properties).sort(cmp)) {
        const t = tipoTexto(s.properties[k]);
        forma[k] = req.has(k) || !Array.isArray(s.required) ? t : `${t} | undefined`;
      }
      formas[nombre] = forma;
    }
  }
  return out;
}

/** Utilidades compartidas por los lectores de infraestructura (`infra-parser` e `infra-nube`). */

export type Mapa = Record<string, unknown>;
export const base = (a: string) => a.slice(a.lastIndexOf("/") + 1);
export const dir = (a: string) => (a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : "");
export const esMapa = (v: unknown): v is Mapa => typeof v === "object" && v !== null && !Array.isArray(v);
export const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
export const corto = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s).replace(/\s+/g, " ").trim();
export const texto = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

/** Línea (desde 1) de la primera aparición de un texto a partir de `desde`; la de `desde` si no está. */
export const lineaDe = (t: string, aguja: string | RegExp, desde = 0) => {
  const resto = t.slice(desde);
  const i = typeof aguja === "string" ? resto.indexOf(aguja) : resto.search(aguja);
  return t.slice(0, desde + Math.max(i, 0)).split("\n").length;
};
export const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const lineaClave = (t: string, clave: string, desde = 0) => lineaDe(t, new RegExp(`^[ \\t]*['"]?${escapar(clave)}['"]?\\s*:`, "m"), desde);

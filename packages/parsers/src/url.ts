import { normalizarRuta } from "@flowbrain/core";
import type { UrlAnalizada } from "./tipos.js";

/** Pieza de una URL evaluada estáticamente: literal o dinámica (env, variable, llamada…). */
export type Parte = { lit: string } | { din: string };

/** Reconstruye host y ruta a partir de las partes. Común a todos los parsers. */
export function analizarUrl(partes: Parte[]): UrlAnalizada | null {
  const unidas: Parte[] = [];
  for (const p of partes) {
    const u = unidas[unidas.length - 1];
    if ("lit" in p && u && "lit" in u) u.lit += p.lit;
    else if (!("lit" in p && p.lit === "")) unidas.push({ ...p });
  }
  if (unidas.length === 0) return null;
  const texto = unidas.map((p) => ("lit" in p ? p.lit : `\${${p.din}}`)).join("");
  const aRuta = (ps: Parte[]): string | null => {
    // El query string pegado a la ruta no es un segmento: `/items${query}`, `/items${qs ? `?${qs}` : ""}`. Se corta en la
    // parte dinámica que arma un `?`, o en la última si va pegada a una palabra (después de una barra es un parámetro).
    const corte = ps.findIndex((p, i) => {
      if ("lit" in p) return false;
      if (/[`'"]\?/.test(p.din)) return true;
      const prev = ps[i - 1], resto = ps.slice(i + 1);
      const ultima = resto.every((q) => "lit" in q && (q.lit === "" || /^[?#]/.test(q.lit)));
      return ultima && !!prev && "lit" in prev && /[A-Za-z0-9]$/.test(prev.lit);
    });
    const t = (corte >= 0 ? ps.slice(0, corte) : ps)
      .map((p) => ("lit" in p ? p.lit : "{param}"))
      .join("")
      .replace(/[?#].*$/, "");
    return t.startsWith("/") ? normalizarRuta(t) : null;
  };
  const primera = unidas[0]!;
  if ("lit" in primera) {
    const m = /^https?:\/\/([^/]*)(.*)$/.exec(primera.lit);
    if (m) {
      const hostCompleto = unidas.length === 1 || m[2] !== "" || !("din" in (unidas[1] ?? {}));
      if (!hostCompleto || m[1] === "") return { base: "dinamica", host: null, ruta: aRuta(unidas.slice(2)), texto };
      const host = m[1]!.replace(/:\d+$/, "").toLowerCase();
      return { base: "literal", host, ruta: aRuta([{ lit: m[2] || "/" }, ...unidas.slice(1)]), texto };
    }
    if (primera.lit.startsWith("/")) return { base: "relativa", host: null, ruta: aRuta(unidas), texto };
    return null;
  }
  return { base: "dinamica", host: null, ruta: aRuta(unidas.slice(1)), texto };
}

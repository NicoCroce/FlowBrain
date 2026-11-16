/** Comparación por code units UTF-16. Nunca localeCompare (depende del entorno). */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compara tuplas de strings elemento a elemento. */
export function cmpTuple(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = cmp(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** Copia con claves de objeto ordenadas alfabéticamente a cualquier profundidad. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort(cmp)) {
      const v = obj[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** Serialización canónica legible: claves ordenadas, 2 espacios, `\n` final. */
export function stringifyCanonical(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2) + "\n";
}

/** Serialización canónica compacta: base para estimar tokens. */
export function stringifyCompact(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

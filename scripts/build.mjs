// Empaqueta el CLI (y con él core, motor, parsers, indexador, hooks y MCP) en un único ESM para `brain-graph`.
// Las dependencias de terceros quedan externas: se instalan con el paquete y se resuelven en tiempo de ejecución
// (Cytoscape y la gramática WASM de PHP se leen por ruta).
import { build } from "esbuild";
import { chmod, copyFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(raiz, "packages/brain-graph");
const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"));
const salida = join(pkgDir, "dist/brain.mjs");

await rm(join(pkgDir, "dist"), { recursive: true, force: true });
await build({
  entryPoints: [join(raiz, "packages/cli/src/main.ts")],
  outfile: salida,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: Object.keys(pkg.dependencies),
  define: { __BRAIN_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "warning",
});
await chmod(salida, 0o755);
for (const f of ["SCHEMA.md", "LICENSE"]) await copyFile(join(raiz, f), join(pkgDir, f));
console.log(`brain-graph@${pkg.version} → ${salida}`);

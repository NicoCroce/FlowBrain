// Empaqueta el CLI (y con él core, motor, parsers, indexador, hooks y MCP) en un único ESM para `flowbrain`.
// Las dependencias de terceros quedan externas: se instalan con el paquete y se resuelven en tiempo de ejecución
// (Cytoscape se lee por ruta). La gramática WASM de PHP se copia a dist/: así el paquete no depende de
// tree-sitter-php, que compila un binario nativo al instalarse aunque solo se use su .wasm.
import { build } from "esbuild";
import { chmod, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(raiz, "packages/flowbrain");
const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"));
const salida = join(pkgDir, "dist/flowbrain.mjs");

await rm(join(pkgDir, "dist"), { recursive: true, force: true });
await build({
  entryPoints: [join(raiz, "packages/cli/src/main.ts")],
  outfile: salida,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: Object.keys(pkg.dependencies),
  define: { __FLOWBRAIN_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "warning",
});
await chmod(salida, 0o755);
const reqParsers = createRequire(join(raiz, "packages/parsers/package.json"));
await copyFile(reqParsers.resolve("tree-sitter-php/tree-sitter-php.wasm"), join(pkgDir, "dist/tree-sitter-php.wasm"));
for (const f of ["SCHEMA.md", "LICENSE"]) await copyFile(join(raiz, f), join(pkgDir, f));
// El README del paquete es el del repo: npm no resuelve rutas relativas, así que imágenes y links pasan a GitHub.
const GITHUB = "https://github.com/NicoCroce/FlowBrain";
const absoluta = (ruta, imagen) =>
  /^([a-z]+:|#|\/)/i.test(ruta) ? ruta : imagen ? `https://raw.githubusercontent.com/NicoCroce/FlowBrain/main/${ruta}` : `${GITHUB}/blob/main/${ruta}`;
export const readmeParaNpm = (md) =>
  md
    .replace(/(<img[^>]*\ssrc=")([^"]+)"/g, (_, a, r) => `${a}${absoluta(r, true)}"`)
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (_, img, t, r) => `${img}[${t}](${absoluta(r, img === "!")})`);
for (const f of ["README.md", "README.es.md"]) await writeFile(join(pkgDir, f), readmeParaNpm(await readFile(join(raiz, f), "utf8")), "utf8");
console.log(`${pkg.name}@${pkg.version} → ${salida}`);

// `pnpm release [patch|minor|major|x.y.z] [--dry-run]`: publica @nicocroce/flowbrain en npm y deja el tag vX.Y.Z en GitHub.
// Cada paso mira si ya está hecho (versión en npm, tag local, tag en origin), así que se puede repetir si algo falla a
// mitad. Sin argumento usa la versión actual de packages/flowbrain/package.json.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Versión siguiente: patch, minor, major o una explícita (x.y.z); sin pedido, la actual. */
export function siguienteVersion(actual, pedido) {
  if (!pedido) return actual;
  if (/^\d+\.\d+\.\d+$/.test(pedido)) return pedido;
  const [ma, mi, pa] = actual.split(".").map(Number);
  if (pedido === "patch") return `${ma}.${mi}.${pa + 1}`;
  if (pedido === "minor") return `${ma}.${mi + 1}.0`;
  if (pedido === "major") return `${ma + 1}.0.0`;
  throw new Error(`no entiendo la versión "${pedido}": usá patch, minor, major o x.y.z`);
}

/** Las notas de una versión en el CHANGELOG (lo que hay bajo `## x.y.z` hasta la siguiente versión), o null. */
export function notasDe(changelog, version) {
  const lineas = changelog.split("\n");
  const i = lineas.findIndex((l) => new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|$)`).test(l));
  if (i < 0) return null;
  const fin = lineas.findIndex((l, j) => j > i && l.startsWith("## "));
  return lineas.slice(i + 1, fin < 0 ? undefined : fin).join("\n").trim();
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(raiz, "packages/flowbrain");
const pkgPath = join(pkgDir, "package.json");
const changelogPath = join(pkgDir, "CHANGELOG.md");

function correr(cmd, args, { cwd = raiz, mostrar = true, tolerar = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: mostrar ? "inherit" : "pipe", encoding: "utf8" });
  if (r.status !== 0 && !tolerar) {
    if (!mostrar) process.stderr.write(r.stderr ?? "");
    throw new Error(`falló: ${cmd} ${args.join(" ")}`);
  }
  return { ok: r.status === 0, salida: (r.stdout ?? "").trim() };
}
const git = (...args) => correr("git", args, { mostrar: false }).salida;
const enNpm = (nombre, version) => correr("npm", ["view", `${nombre}@${version}`, "version"], { mostrar: false, tolerar: true }).salida === version;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const seco = args.includes("--dry-run");
  const pedido = args.find((a) => !a.startsWith("--"));
  const paso = (t) => console.log(`\n▸ ${t}`);

  // 1. Repo en orden: en main, sin cambios (salvo el CHANGELOG) y al día con origin.
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("estás fuera de main: cambiá a main para publicar");
  const sucios = git("status", "--porcelain").split("\n").filter(Boolean).filter((l) => !l.endsWith("packages/flowbrain/CHANGELOG.md"));
  if (sucios.length) throw new Error(`hay cambios sin commitear:\n${sucios.join("\n")}\nCommitealos (o descartalos) antes de publicar: el paquete se arma con lo que hay en disco.`);
  git("fetch", "-q", "origin", "main");
  if (git("rev-list", "--count", "HEAD..origin/main") !== "0") throw new Error("origin/main tiene commits que no tenés: hacé git pull --ff-only");

  // 2. Versión y CHANGELOG.
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const version = siguienteVersion(pkg.version, pedido);
  const tag = `v${version}`;
  const notas = notasDe(readFileSync(changelogPath, "utf8"), version);
  if (notas === null) throw new Error(`packages/flowbrain/CHANGELOG.md no tiene "## ${version}": agregá qué cambia en esta versión y volvé a correr`);
  const publicada = enNpm(pkg.name, version);
  const tagLocal = git("tag", "--list", tag) === tag;
  const tagRemoto = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`) !== "";
  console.log(`${pkg.name} ${pkg.version} → ${version}`);
  console.log(`  npm: ${publicada ? "ya publicada" : "falta publicar"} · tag ${tag}: ${tagRemoto ? "ya está en GitHub" : tagLocal ? "local, falta subirlo" : "falta crearlo"}`);
  if (publicada && tagRemoto) return console.log("\nNada que hacer: esa versión ya está publicada y con su tag.");
  if (seco) return console.log("\n(--dry-run: no se cambió nada)");

  // 3. Commit de la versión (si cambió) y push, así GitHub tiene lo que se publica (el README de npm usa sus imágenes).
  if (version !== pkg.version || git("status", "--porcelain")) {
    paso(`Commit de la versión ${version}`);
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    correr("git", ["add", pkgPath, changelogPath]);
    correr("git", ["commit", "-q", "-m", `Versión ${version}`]);
  }
  paso("Push de main");
  correr("git", ["push", "-q", "origin", "main"]);

  // 4. Publicar. npm pide el 2FA y después procesa la versión unos minutos: se espera a verla en vez de reintentar
  //    (reintentar en ese lapso da E409 "Cannot publish over previously staged version").
  if (!publicada) {
    paso("npm publish (corre typecheck, tests y build; después te pide el 2FA)");
    correr("npm", ["publish"], { cwd: pkgDir });
    paso("Esperando que npm termine de procesar la versión");
    const limite = Date.now() + 15 * 60_000;
    while (!enNpm(pkg.name, version)) {
      if (Date.now() > limite) throw new Error(`npm no muestra ${version} después de 15 minutos. No vuelvas a publicar: esperá y corré de nuevo \`pnpm release ${version}\` para crear el tag.`);
      process.stdout.write(".");
      await esperar(15_000);
    }
    console.log(` ${pkg.name}@${version} disponible.`);
  }

  // 5. Tag anotado con las notas del CHANGELOG, y una release en GitHub si está `gh`.
  if (!tagLocal) {
    paso(`Tag ${tag}`);
    correr("git", ["tag", "-a", tag, "-m", `${pkg.name} ${version}\n\n${notas}`]);
  }
  if (!tagRemoto) {
    paso(`Push del tag ${tag}`);
    correr("git", ["push", "-q", "origin", tag]);
  }
  if (correr("gh", ["--version"], { mostrar: false, tolerar: true }).ok) {
    const existe = correr("gh", ["release", "view", tag], { mostrar: false, tolerar: true }).ok;
    if (!existe) {
      paso(`Release ${tag} en GitHub`);
      const r = correr("gh", ["release", "create", tag, "--title", `${pkg.name} ${version}`, "--notes", notas], { tolerar: true });
      if (!r.ok) console.log("  No pude crear la release (el tag sí quedó). Se puede crear a mano desde GitHub.");
    }
  }
  console.log(`\nListo: ${pkg.name}@${version} en npm y ${tag} en GitHub.\nVerificá con: npx -y ${pkg.name}@${version} --version`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`\n✗ ${e.message}`);
    process.exit(1);
  });
}

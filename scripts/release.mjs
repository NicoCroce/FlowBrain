// `pnpm release [patch|minor|major|x.y.z] [--dry-run]`: publica @nicocroce/flowbrain desde main y deja el tag vX.Y.Z.
// `pnpm release x.y.z --desde <commit> [--preparar|--dry-run]`: publica una versión cortada en un commit anterior a
// HEAD. Arma la rama `release/vX.Y.Z` (el corte más un commit «Version X.Y.Z» con la versión y el CHANGELOG hasta esa
// versión) en un worktree temporal, así el checkout de main no se toca, y publica, tagea y pushea desde ahí.
// Cada paso mira si ya está hecho (versión en npm, tag local, tag en origin), así que se puede repetir si algo falla a
// mitad. Las versiones van en orden: no publica una menor que la última en npm ni saltea una del CHANGELOG.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const esEstable = (v) => /^\d+\.\d+\.\d+$/.test(v);

/** Compara dos versiones x.y.z: negativo si a < b, 0 si son iguales, positivo si a > b. */
export function compararVersiones(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Las versiones (x.y.z) que tienen sección `## x.y.z` en el CHANGELOG, en el orden en que aparecen. */
export function versionesDelChangelog(changelog) {
  return [...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?=\s|$)/gm)].map((m) => m[1]);
}

/** El CHANGELOG sin las secciones de versiones posteriores a `version` (lo que había al publicarla). */
export function changelogHasta(changelog, version) {
  const bloques = changelog.split(/^(?=## )/m);
  const quedan = bloques.filter((b) => {
    const v = /^## (\d+\.\d+\.\d+)(?=\s|$)/.exec(b)?.[1];
    return !v || compararVersiones(v, version) <= 0;
  });
  return quedan.join("");
}

/**
 * Por qué no se puede publicar `version` ahora, o null si se puede. Una ya publicada sí (para seguir con el tag); una
 * menor que la última estable de npm no; y antes tienen que estar publicadas las del CHANGELOG que van en el medio.
 */
export function problemaDeOrden(version, publicadas, delChangelog) {
  if (publicadas.includes(version)) return null;
  const estables = publicadas.filter(esEstable).sort(compararVersiones);
  const ultima = estables.at(-1);
  if (ultima && compararVersiones(version, ultima) < 0)
    return `${version} es menor que la última publicada en npm (${ultima}): npm la marcaría como latest y los que actualicen bajarían de versión`;
  const faltan = delChangelog
    .filter((v) => (!ultima || compararVersiones(v, ultima) > 0) && compararVersiones(v, version) < 0 && !publicadas.includes(v))
    .sort(compararVersiones);
  if (faltan.length) return `antes hay que publicar ${faltan.join(", ")} (están en el CHANGELOG y van antes que ${version})`;
  return null;
}

/** La rama de una versión publicada desde un corte. */
export const ramaDeRelease = (version) => `release/v${version}`;

/** Los argumentos: versión pedida, corte (`--desde x` o `--desde=x`) y modos. */
export function leerArgumentos(args) {
  const desdeI = args.findIndex((a) => a === "--desde" || a.startsWith("--desde="));
  let desde = null;
  const resto = [...args];
  if (desdeI >= 0) {
    if (args[desdeI].includes("=")) desde = args[desdeI].split("=")[1];
    else {
      desde = args[desdeI + 1];
      resto.splice(desdeI + 1, 1);
    }
    if (!desde || desde.startsWith("--")) throw new Error("--desde necesita un commit: pnpm release x.y.z --desde <commit>");
  }
  const pedido = resto.find((a) => !a.startsWith("--"));
  const seco = args.includes("--dry-run");
  const preparar = args.includes("--preparar");
  if (desde && !/^\d+\.\d+\.\d+$/.test(pedido ?? "")) throw new Error("con --desde, la versión va explícita: pnpm release x.y.z --desde <commit>");
  if (preparar && !desde) throw new Error("--preparar es para --desde: pnpm release x.y.z --desde <commit> --preparar");
  return { pedido, desde, seco, preparar };
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_REL = "packages/flowbrain";
const pkgDir = join(raiz, PKG_REL);
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
const gitEn = (cwd, ...args) => correr("git", args, { cwd, mostrar: false }).salida;
const gitOk = (...args) => correr("git", args, { mostrar: false, tolerar: true }).ok;
const enNpm = (nombre, version) => correr("npm", ["view", `${nombre}@${version}`, "version"], { mostrar: false, tolerar: true }).salida === version;
const publicadasEnNpm = (nombre) => {
  const r = correr("npm", ["view", nombre, "versions", "--json"], { mostrar: false, tolerar: true });
  if (!r.ok) return [];
  const v = JSON.parse(r.salida || "[]");
  return Array.isArray(v) ? v : [v];
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const paso = (t) => console.log(`\n▸ ${t}`);

/** Repo en orden: en main, sin cambios (salvo lo permitido) y sin commits de origin/main que falten. */
function controlarMain({ permitirChangelog }) {
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("estás fuera de main: cambiá a main para publicar");
  const sucios = git("status", "--porcelain").split("\n").filter(Boolean)
    .filter((l) => !(permitirChangelog && l.endsWith(`${PKG_REL}/CHANGELOG.md`)))
    // Un archivo sin seguimiento fuera de packages/ (una captura en la raíz) no entra al paquete: no frena.
    .filter((l) => !(l.startsWith("?? ") && !l.slice(3).startsWith("packages/")));
  if (sucios.length) throw new Error(`hay cambios sin commitear:\n${sucios.join("\n")}\nCommitealos (o descartalos) antes de publicar: el paquete se arma con lo que hay en disco.`);
  git("fetch", "-q", "origin", "main");
  if (git("rev-list", "--count", "HEAD..origin/main") !== "0") throw new Error("origin/main tiene commits que no tenés: hacé git pull --ff-only");
}

/** Espera a que npm termine de procesar la versión: reintentar `npm publish` en ese lapso da E409. */
async function esperarNpm(nombre, version, reintento) {
  paso("Esperando que npm termine de procesar la versión");
  const limite = Date.now() + 15 * 60_000;
  while (!enNpm(nombre, version)) {
    if (Date.now() > limite) throw new Error(`npm no muestra ${version} después de 15 minutos. No vuelvas a publicar: esperá y corré de nuevo \`${reintento}\` para crear el tag.`);
    process.stdout.write(".");
    await esperar(15_000);
  }
  console.log(` ${nombre}@${version} disponible.`);
}

/** Tag anotado con las notas en `commit`, push del tag y release en GitHub si está `gh`. */
function tagYRelease({ nombre, version, notas, commit, tagLocal, tagRemoto }) {
  const tag = `v${version}`;
  if (!tagLocal) {
    paso(`Tag ${tag}`);
    correr("git", ["tag", "-a", tag, commit, "-m", `${nombre} ${version}\n\n${notas}`]);
  }
  if (!tagRemoto) {
    paso(`Push del tag ${tag}`);
    correr("git", ["push", "-q", "origin", `refs/tags/${tag}`]);
  }
  if (correr("gh", ["--version"], { mostrar: false, tolerar: true }).ok) {
    const existe = correr("gh", ["release", "view", tag], { mostrar: false, tolerar: true }).ok;
    if (!existe) {
      paso(`Release ${tag} en GitHub`);
      const r = correr("gh", ["release", "create", tag, "--verify-tag", "--title", `${nombre} ${version}`, "--notes", notas], { tolerar: true });
      if (!r.ok) console.log("  No pude crear la release (el tag sí quedó). Se puede crear a mano desde GitHub.");
    }
  }
}

async function publicarDesdeMain({ pedido, seco }) {
  controlarMain({ permitirChangelog: true });

  // Versión y CHANGELOG.
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const version = siguienteVersion(pkg.version, pedido);
  const tag = `v${version}`;
  const changelog = readFileSync(changelogPath, "utf8");
  const notas = notasDe(changelog, version);
  if (notas === null) throw new Error(`${PKG_REL}/CHANGELOG.md no tiene "## ${version}": agregá qué cambia en esta versión y volvé a correr`);
  const orden = problemaDeOrden(version, publicadasEnNpm(pkg.name), versionesDelChangelog(changelog));
  if (orden && !seco) throw new Error(orden);
  if (orden) console.log(`⚠ Todavía no se puede publicar: ${orden}.`);
  const publicada = enNpm(pkg.name, version);
  const tagLocal = git("tag", "--list", tag) === tag;
  const tagRemoto = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`) !== "";
  console.log(`${pkg.name} ${pkg.version} → ${version}`);
  console.log(`  npm: ${publicada ? "ya publicada" : "falta publicar"} · tag ${tag}: ${tagRemoto ? "ya está en GitHub" : tagLocal ? "local, falta subirlo" : "falta crearlo"}`);
  if (publicada && tagRemoto) return console.log("\nNada que hacer: esa versión ya está publicada y con su tag.");
  if (seco) return console.log("\n(--dry-run: no se cambió nada)");

  // Commit de la versión (si cambió) y push, así GitHub tiene lo que se publica (el README de npm usa sus imágenes).
  if (version !== pkg.version || git("status", "--porcelain", "--", PKG_REL)) {
    paso(`Commit de la versión ${version}`);
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    correr("git", ["add", pkgPath, changelogPath]);
    correr("git", ["commit", "-q", "-m", `Version ${version}`]);
  }
  paso("Push de main");
  correr("git", ["push", "-q", "origin", "main"]);

  if (!publicada) {
    paso("npm publish (corre typecheck, tests y build; después te pide el 2FA)");
    correr("npm", ["publish"], { cwd: pkgDir });
    await esperarNpm(pkg.name, version, `pnpm release ${version}`);
  }
  tagYRelease({ nombre: pkg.name, version, notas, commit: "HEAD", tagLocal, tagRemoto });
  console.log(`\nListo: ${pkg.name}@${version} en npm y ${tag} en GitHub.\nVerificá con: npx -y ${pkg.name}@${version} --version`);
}

async function publicarDesdeCorte({ pedido: version, desde, seco, preparar }) {
  controlarMain({ permitirChangelog: false });
  const tag = `v${version}`;
  const rama = ramaDeRelease(version);
  const reintento = `pnpm release ${version} --desde ${desde}`;

  // El corte tiene que ser un commit de main; el CHANGELOG de main tiene que tener la versión.
  if (!gitOk("rev-parse", "--verify", "-q", `${desde}^{commit}`)) throw new Error(`no encuentro el commit ${desde}`);
  const corte = git("rev-parse", `${desde}^{commit}`);
  if (!gitOk("merge-base", "--is-ancestor", corte, "HEAD")) throw new Error(`${desde} no es un commit de main`);
  const changelog = readFileSync(changelogPath, "utf8");
  const notas = notasDe(changelog, version);
  if (notas === null) throw new Error(`${PKG_REL}/CHANGELOG.md de main no tiene "## ${version}": escribila en main y commiteala antes`);
  const nombre = JSON.parse(readFileSync(pkgPath, "utf8")).name;
  const publicadas = publicadasEnNpm(nombre);
  // Preparar o mirar no publica nada: el orden solo se avisa. Publicar sí lo exige.
  const orden = problemaDeOrden(version, publicadas, versionesDelChangelog(changelog));
  if (orden && !(seco || preparar)) throw new Error(orden);
  if (orden) console.log(`⚠ Todavía no se puede publicar: ${orden}.`);

  // Estado: rama, npm y tags.
  const ramaExiste = gitOk("rev-parse", "--verify", "-q", `refs/heads/${rama}`);
  if (ramaExiste) {
    if (git("rev-parse", `${rama}^`) !== corte) throw new Error(`la rama ${rama} ya existe pero no sale de ${desde}: borrala (git branch -D ${rama}) o usá su corte`);
    const v = JSON.parse(git("show", `${rama}:${PKG_REL}/package.json`)).version;
    if (v !== version) throw new Error(`la rama ${rama} tiene la versión ${v}, no ${version}`);
  }
  const publicada = publicadas.includes(version) || enNpm(nombre, version);
  const tagLocal = git("tag", "--list", tag) === tag;
  const tagRemoto = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`) !== "";
  if (tagLocal && ramaExiste && git("rev-parse", `${tag}^{commit}`) !== git("rev-parse", rama)) throw new Error(`el tag ${tag} no apunta a la rama ${rama}`);
  console.log(`${nombre} ${version} desde ${git("rev-parse", "--short", corte)} (${git("log", "-1", "--format=%s", corte).slice(0, 80)})`);
  console.log(`  rama ${rama}: ${ramaExiste ? "lista" : "falta crearla"} · npm: ${publicada ? "ya publicada" : "falta publicar"} · tag ${tag}: ${tagRemoto ? "ya está en GitHub" : tagLocal ? "local, falta subirlo" : "falta crearlo"}`);
  if (publicada && tagRemoto) return console.log("\nNada que hacer: esa versión ya está publicada y con su tag.");
  if (publicada && !ramaExiste) throw new Error(`${version} ya está en npm pero no hay rama ${rama} para tagear: creá el tag a mano en el commit que se publicó`);
  if (seco) return console.log("\n(--dry-run: no se cambió nada)");

  // Worktree temporal con la rama: el checkout de main no se toca.
  const dir = join(tmpdir(), `flowbrain-release-v${version}`);
  git("worktree", "prune");
  const registrado = git("worktree", "list", "--porcelain").split("\n").includes(`worktree ${dir}`);
  if (!registrado) {
    if (existsSync(dir)) throw new Error(`${dir} existe y no es un worktree de este repo: borralo y volvé a correr`);
    paso(`Worktree ${dir}`);
    if (ramaExiste) correr("git", ["worktree", "add", "-q", dir, rama]);
    else correr("git", ["worktree", "add", "-q", "-b", rama, dir, corte]);
  } else if (gitEn(dir, "rev-parse", "--abbrev-ref", "HEAD") !== rama) throw new Error(`el worktree ${dir} no está en ${rama}: borralo (git worktree remove --force ${dir})`);
  const pkgDirW = join(dir, PKG_REL);

  // Commit «Version x.y.z»: la versión y el CHANGELOG hasta esa versión.
  if (git("rev-parse", rama) === corte) {
    paso(`Commit de la versión ${version} en ${rama}`);
    const pkgW = JSON.parse(readFileSync(join(pkgDirW, "package.json"), "utf8"));
    pkgW.version = version;
    writeFileSync(join(pkgDirW, "package.json"), JSON.stringify(pkgW, null, 2) + "\n");
    writeFileSync(join(pkgDirW, "CHANGELOG.md"), changelogHasta(changelog, version));
    correr("git", ["add", `${PKG_REL}/package.json`, `${PKG_REL}/CHANGELOG.md`], { cwd: dir });
    correr("git", ["commit", "-q", "-m", `Version ${version}`], { cwd: dir });
  }
  const commit = git("rev-parse", rama);

  paso("Dependencias del worktree");
  correr("pnpm", ["install", "--frozen-lockfile", "--prefer-offline", "--silent"], { cwd: dir });

  if (preparar) {
    paso("Typecheck, tests y build");
    correr("pnpm", ["-s", "typecheck"], { cwd: dir });
    correr("pnpm", ["-s", "test"], { cwd: dir });
    correr("node", ["scripts/build.mjs"], { cwd: dir });
    paso("npm pack --dry-run");
    correr("npm", ["pack", "--dry-run"], { cwd: pkgDirW });
    return console.log(`\nPreparada: rama ${rama} (${commit.slice(0, 7)}) en ${dir}. No se publicó ni se pusheó nada.\nPara publicar: ${reintento}`);
  }

  if (!publicada) {
    paso("npm publish (corre typecheck, tests y build; después te pide el 2FA)");
    correr("npm", ["publish"], { cwd: pkgDirW });
    await esperarNpm(nombre, version, reintento);
  }
  paso(`Push de la rama ${rama}`);
  correr("git", ["push", "-q", "origin", `refs/heads/${rama}:refs/heads/${rama}`]);
  tagYRelease({ nombre, version, notas, commit, tagLocal, tagRemoto });
  correr("git", ["worktree", "remove", "--force", dir], { tolerar: true });
  console.log(`\nListo: ${nombre}@${version} en npm, ${tag} en GitHub (en ${rama}).\nVerificá con: npx -y ${nombre}@${version} --version`);
}

async function main() {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (opciones.desde) await publicarDesdeCorte(opciones);
  else await publicarDesdeMain(opciones);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`\n✗ ${e.message}`);
    process.exit(1);
  });
}

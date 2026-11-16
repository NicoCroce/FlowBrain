import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileDir, parsePagina, stringifyCanonical } from "@brain/core";
import { escribirIndex, indexar } from "@brain/parsers";
import { draftDir, etiquetaHost, generarBorradores, RESUMEN_PENDIENTE } from "../src/index.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const F = (p: string) => join(RAIZ, "fixtures", p);

let dir: string;
let brain: string;
let clon: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-draft-"));
  brain = join(dir, "brain");
  clon = join(dir, "clones/envios");
  await cp(F("repos/envios"), clon, { recursive: true });
  await mkdir(join(brain, "tecnologia"), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const relaciones = async (ruta: string) => (parsePagina(ruta, await readFile(ruta, "utf8")).data as { relaciones?: unknown[] }).relaciones ?? [];

describe("brain draft sobre un brain casi vacío", () => {
  beforeEach(async () => {
    await cp(F("envios-brain/tecnologia/svc-notificaciones.md"), join(brain, "tecnologia/svc-notificaciones.md"));
  });

  it("propone repo, svc, tablas y externos, y escribe solo en _drafts/", async () => {
    const r = await draftDir(clon, brain);
    expect(r.repo).toBe("repo-envios");
    expect(r.escritos).toEqual([
      "_drafts/repo-envios/PROMPT.md",
      "_drafts/repo-envios/tecnologia/ext-correo.md",
      "_drafts/repo-envios/tecnologia/repo-envios.md",
      "_drafts/repo-envios/tecnologia/svc-envios.md",
      "_drafts/repo-envios/tecnologia/tabla-envios.md",
      "_drafts/repo-envios/tecnologia/tabla-tarifas.md",
    ]);
    expect(await readdir(join(brain, "tecnologia"))).toEqual(["svc-notificaciones.md"]);
    expect(await readdir(brain)).toEqual(["_drafts", "tecnologia"]);
    expect(r.resumen).toEqual({ paginas: 5, relaciones: 4, preguntas: 4, tablas: 2, externos: 1, funcionalidades: 0 });
  });

  it("las relaciones del borrador son las aristas etiquetadas a mano, con evidencia", async () => {
    await draftDir(clon, brain);
    const etiquetas = JSON.parse(await readFile(F("repos/envios.etiquetas.json"), "utf8")) as { aristas: Array<Record<string, unknown>> };
    const esperadas = etiquetas.aristas
      .map((a) => ({ verbo: a.verbo, destino: a.hasta, ...(a.dato ? { dato: a.dato } : {}), evidencia: a.evidencia, origen: a.origen }))
      .map((x) => stringifyCanonical(x))
      .sort();
    const reales = (await relaciones(join(brain, "_drafts/repo-envios/tecnologia/svc-envios.md"))).map((x) => stringifyCanonical(x)).sort();
    expect(reales).toEqual(esperadas);
  });

  it("lo no resuelto queda en Preguntas abiertas, con evidencia", async () => {
    await draftDir(clon, brain);
    const svc = await readFile(join(brain, "_drafts/repo-envios/tecnologia/svc-envios.md"), "utf8");
    expect(svc).toContain("## Preguntas abiertas\n\n- `llama_a` `GET ${env:TRACKING_URL}/track`: base dinámica");
    expect(svc).toContain("`repo-envios:app/Services/Correo.php#L21`");
    expect(svc).toContain(`resumen: "${RESUMEN_PENDIENTE}"`);
  });

  it("movido a tecnologia/, index + compile pasan y el grafo tiene las aristas", async () => {
    await draftDir(clon, brain);
    const d = join(brain, "_drafts/repo-envios/tecnologia");
    for (const f of await readdir(d)) await cp(join(d, f), join(brain, "tecnologia", f));
    await escribirIndex(brain, await indexar(clon, brain));
    const { salidas } = await compileDir(brain);
    const aristas = salidas.graph.edges.filter((e) => e.desde === "svc-envios" && ["llama_a", "lee_de", "escribe_en"].includes(e.verbo)).map((e) => `${e.verbo} ${e.hasta}`);
    expect(aristas).toEqual(["escribe_en tabla-envios", "lee_de tabla-tarifas", "llama_a ext-correo", "llama_a svc-notificaciones"]);
    // Una vez movido, un nuevo borrador no propone nada que ya esté.
    const otra = await draftDir(clon, brain);
    expect(otra.resumen).toEqual({ paginas: 1, relaciones: 0, preguntas: 1, tablas: 0, externos: 0, funcionalidades: 0 });
  });

  it("es determinístico e idempotente", async () => {
    const a = await draftDir(clon, brain);
    const b = await draftDir(clon, brain);
    expect(b.escritos).toEqual([]);
    expect(stringifyCanonical(b.archivos)).toBe(stringifyCanonical(a.archivos));
  });
});

describe("brain draft sobre páginas existentes", () => {
  beforeEach(async () => {
    await cp(F("envios-brain/tecnologia"), join(brain, "tecnologia"), { recursive: true });
  });

  it("agrega relaciones al frontmatter existente sin tocar el resto", async () => {
    await draftDir(clon, brain);
    const original = await readFile(F("envios-brain/tecnologia/svc-envios.md"), "utf8");
    const borrador = await readFile(join(brain, "_drafts/repo-envios/tecnologia/svc-envios.md"), "utf8");
    const fm = original.split("---\n")[1]!;
    expect(borrador.startsWith(`---\n${fm}relaciones:\n  - {verbo: escribe_en, destino: tabla-envios, dato: Envio, evidencia: "repo-envios:app/Http/Controllers/EnvioController.php#L20", origen: parser}\n`)).toBe(true);
    expect(await readdir(join(brain, "_drafts/repo-envios/tecnologia"))).toEqual(["svc-envios.md"]);
  });

  it("conserva comentarios YAML, no duplica relaciones ya escritas y reemplaza la sección de preguntas", async () => {
    const r = await indexar(clon, brain);
    const pagina = [
      "---",
      "id: svc-envios",
      "tipo: svc",
      "nombre: Envíos",
      "resumen: Crea envíos.",
      "vive_en: [repo-envios] # comentario",
      "relaciones:",
      '  - { verbo: llama_a, destino: ext-correo, evidencia: "repo-envios:app/Services/Correo.php#L17", origen: curado }',
      "---",
      "# Envíos",
      "",
      "## Preguntas abiertas",
      "",
      "- vieja",
      "",
      "## Notas",
      "",
      "texto",
      "",
    ].join("\n");
    const b = generarBorradores(r, [{ ruta: "tecnologia/svc-envios.md", contenido: pagina }], "envios");
    const t = b.archivos["_drafts/repo-envios/tecnologia/svc-envios.md"]!;
    expect(t).toContain("vive_en: [repo-envios] # comentario");
    expect(t.match(/destino: ext-correo/g)).toHaveLength(1);
    expect(t).not.toContain("- vieja");
    expect(t.match(/## Preguntas abiertas/g)).toHaveLength(1);
    expect(t).toContain("## Notas\n\ntexto");
  });
});

describe("etiquetaHost", () => {
  it("toma la etiqueta registrable y descarta hosts internos", () => {
    expect(etiquetaHost("api.pasarela.example")).toBe("pasarela");
    expect(etiquetaHost("platform.wyscout.com")).toBe("wyscout");
    expect(etiquetaHost("notificaciones")).toBeNull();
    expect(etiquetaHost("10.0.0.1")).toBeNull();
  });
});

describe("repo no identificado", () => {
  it("draft acepta un repo sin página; index no", async () => {
    await writeFile(join(brain, "tecnologia/.keep"), "");
    await expect(indexar(clon, brain)).rejects.toThrow(/no se pudo identificar/);
    expect((await draftDir(clon, brain)).repo).toBe("repo-envios");
  });
});

describe("brain draft: funcionalidades", () => {
  it("toma las hijas de features/, modules/ y domains/, salvo código compartido", async () => {
    const { carpetasDeFuncionalidad, nombreDeCarpeta } = await import("../src/index.js");
    expect(
      carpetasDeFuncionalidad([
        "src/features/payments/api.ts",
        "src/features/videoAnalysis/ui/Lista.tsx",
        "src/features/shared/x.ts",
        "src/features/_borrador/x.ts",
        "modules/billing/afip/repo.ts",
        "modules/billing/features/otra/x.ts",
        "shared/domain/brand/x.ts",
        "src/core/modules/positions/x.ts",
        "src/features/suelto.ts",
      ]),
    ).toEqual(["modules/billing", "src/features/payments", "src/features/videoAnalysis"]);
    expect(nombreDeCarpeta("videoAnalysis")).toBe("Video analysis");
    expect(nombreDeCarpeta("premios-hi")).toBe("Premios hi");
  });

  it("propone una feat por carpeta y une la misma carpeta de otro repo en una sola", async () => {
    const { generarBorradores } = await import("../src/index.js");
    const r = (repo: string, rutas: string[]) =>
      ({ repo, repoNuevo: false, aristas: [], pendientes: [], servicios: [], archivos: { repo, archivos: rutas.map((ruta) => ({ ruta, lenguaje: "ts", simbolos: [] })) } }) as never;
    const front = generarBorradores(r("repo-front", ["src/features/wellness/a.ts", "src/features/pagos/b.ts"]), [], "front");
    expect(Object.keys(front.archivos).filter((k) => k.includes("producto"))).toEqual(["_drafts/producto/feat-pagos.md", "_drafts/producto/feat-wellness.md"]);
    expect(front.resumen.funcionalidades).toBe(2);
    const previos = Object.entries(front.archivos).filter(([k]) => k.startsWith("_drafts/producto/")).map(([ruta, contenido]) => ({ ruta, contenido }));
    const back = generarBorradores(r("repo-back", ["modules/wellness/c.ts"]), [], "back", previos);
    expect(back.resumen.funcionalidades).toBe(0);
    const wellness = back.archivos["_drafts/producto/feat-wellness.md"]!;
    expect(wellness).toContain("  - repo-front:src/features/wellness\n  - repo-back:modules/wellness\n");
    // Una segunda corrida no duplica la ruta.
    const otra = generarBorradores(r("repo-back", ["modules/wellness/c.ts"]), [], "back", [{ ruta: "_drafts/producto/feat-wellness.md", contenido: wellness }]);
    expect(otra.archivos["_drafts/producto/feat-wellness.md"]).toBeUndefined();
  });
});

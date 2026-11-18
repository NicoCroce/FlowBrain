import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cerebroLiviano, usosEntreCerebros, type Graph } from "@flowbrain/core";
import { crearMulti } from "@flowbrain/mcp";
import { leerRepo, paquetesPublicados, tsParser } from "@flowbrain/parsers";
import { datosDeCerebros } from "@flowbrain/viewer";
import { crearRegistro } from "../src/cerebros.js";
import { ejecutar } from "../src/main.js";

/**
 * Un sistema de diseño en un repo y un front que lo usa en otro: los componentes son nodos, las pantallas que los
 * dibujan los `usan`, y eso vale dentro de un cerebro y entre cerebros (lo que suele pasar: un repo por cerebro).
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-comp-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const escribir = async (base: string, archivos: Record<string, string>) => {
  for (const [f, t] of Object.entries(archivos)) {
    await mkdir(join(base, f, ".."), { recursive: true });
    await writeFile(join(base, f), t);
  }
};

async function proyecto(): Promise<string> {
  const p = join(dir, "tienda");
  await mkdir(join(p, "ui/.git"), { recursive: true });
  await mkdir(join(p, "web/.git"), { recursive: true });
  await escribir(p, {
    "ui/package.json": '{ "name": "@tienda/ui", "main": "src/index.ts", "dependencies": { "react": "18.0.0" } }',
    "ui/src/Boton.tsx": "export function Boton(props: { texto: string }) {\n  return <button>{props.texto}</button>;\n}\n",
    "ui/src/Tarjeta.tsx": "export const Tarjeta = (props: { children?: unknown }) => <div>{props.children as never}</div>;\n",
    "ui/src/Boton.stories.tsx": "export const Primario = () => null;\n",
    "ui/src/index.ts": 'export { Boton } from "./Boton";\nexport { Tarjeta } from "./Tarjeta";\n',
    "web/package.json": '{\n  "name": "web",\n  "private": true,\n  "dependencies": {\n    "@tienda/ui": "1.0.0",\n    "react-router-dom": "6.0.0"\n  }\n}\n',
    "web/src/paginas/Pedidos.tsx":
      'import { Boton, Tarjeta } from "@tienda/ui";\nimport { Router } from "express";\n\nexport function Pedidos() {\n  void Router;\n  return (\n    <Tarjeta>\n      <Boton texto="Pedir" />\n    </Tarjeta>\n  );\n}\n',
    "web/src/paginas/Inicio.tsx": 'import { Tarjeta } from "@tienda/ui";\nexport function Inicio() {\n  return <Tarjeta>hola</Tarjeta>;\n}\n',
    "web/src/App.tsx":
      'import { createBrowserRouter } from "react-router-dom";\nimport { Pedidos } from "./paginas/Pedidos";\nimport { Inicio } from "./paginas/Inicio";\n\nexport const router = createBrowserRouter([\n  { path: "/", element: <Inicio /> },\n  { path: "/pedidos", element: <Pedidos /> },\n]);\n',
  });
  return p;
}

async function indexado(dividir: boolean): Promise<{ p: string; reg: string }> {
  const p = await proyecto();
  const reg = join(p, ".flowbrain");
  await mkdir(reg, { recursive: true });
  await crearRegistro(reg, p, [join(p, "ui"), join(p, "web")], dividir);
  const r = await ejecutar(["brains", "apply", "--root", reg], { FLOWBRAIN_COMANDO: "flowbrain" }, p, async () => "");
  expect(r.codigo, r.stderr).toBe(0);
  return { p, reg };
}

const grafo = async (raiz: string) => JSON.parse(await readFile(join(raiz, "_build/graph.json"), "utf8")) as Graph;
const archivosDe = async (raiz: string) => Promise.all(["repo-ui", "repo-web"].map((r) => readFile(join(raiz, "_build/files", `${r}.json`), "utf8").catch(() => "")).filter(Boolean));

describe("componentes entre paquetes", () => {
  it("el parser anota lo que exporta una librería y lo que una pantalla dibuja de otro paquete; las clases no", async () => {
    const p = await proyecto();
    const ui = await tsParser.extract(leerRepo(join(p, "ui")));
    const comps = ui.archivos.flatMap((a) => (a.componentes ?? []).map((c) => `${a.ruta}#${c.nombre}`));
    expect(comps).toEqual(["src/Boton.tsx#Boton", "src/Tarjeta.tsx#Tarjeta"]);
    const web = await tsParser.extract(leerRepo(join(p, "web")));
    const usos = web.archivos.flatMap((a) => (a.usaPaquetes ?? []).map((u) => `${a.ruta}:${u.desde}:${u.paquete}/${u.simbolo}`));
    expect(usos).toEqual(["src/paginas/Inicio.tsx:Inicio:@tienda/ui/Tarjeta", "src/paginas/Pedidos.tsx:Pedidos:@tienda/ui/Tarjeta", "src/paginas/Pedidos.tsx:Pedidos:@tienda/ui/Boton"]);
    // Un front que no es librería no exporta componentes como piezas del grafo.
    expect(web.archivos.some((a) => a.componentes?.length)).toBe(false);
    expect(paquetesPublicados(leerRepo(join(p, "web")))).toEqual([{ carpeta: "", manifiesto: "package.json", nombre: "web", dependeDe: [{ nombre: "@tienda/ui", linea: 5 }, { nombre: "react-router-dom", linea: 6 }] }]);
  });

  it("Vue: lo que el template dibuja cuenta; en un monorepo, una librería de otro workspace también", async () => {
    const p = join(dir, "mono");
    await escribir(p, {
      "package.json": '{ "name": "mono", "private": true, "workspaces": ["apps/*", "packages/*"] }',
      "packages/ui/package.json": '{ "name": "@mono/ui", "main": "src/index.ts" }',
      "packages/ui/src/Boton.vue": "<template><button><slot /></button></template>\n<script setup lang=\"ts\">\n</script>\n",
      "packages/ui/src/index.ts": 'export { default as Boton } from "./Boton.vue";\n',
      "apps/web/package.json": '{ "name": "@mono/web", "dependencies": { "@mono/ui": "workspace:*", "vue": "3.0.0" } }',
      "apps/web/src/Pedidos.vue": '<template><Boton>Pedir</Boton><Grafico /></template>\n<script setup lang="ts">\nimport { Boton } from "@mono/ui";\nimport { Chart } from "chart.js";\nimport Grafico from "vue-chart";\nnew Chart();\n</script>\n',
      "apps/web/src/Lista.tsx": 'import { Boton } from "../../../packages/ui/src";\nexport const Lista = () => <Boton />;\n',
    });
    const x = await tsParser.extract(leerRepo(p));
    expect(x.archivos.flatMap((a) => (a.componentes ?? []).map((c) => `${a.ruta}#${c.nombre}`))).toEqual(["packages/ui/src/Boton.vue#Boton"]);
    const usos = x.archivos.flatMap((a) => (a.usaPaquetes ?? []).map((u) => `${a.ruta}:${u.desde}:${u.paquete}/${u.simbolo}`));
    // `Chart` se usa como valor en el script: es una clase, no algo que dibuja el template.
    expect(usos).toEqual(["apps/web/src/Lista.tsx:Lista:@mono/ui/Boton", "apps/web/src/Pedidos.vue:Pedidos:@mono/ui/Boton", "apps/web/src/Pedidos.vue:Pedidos:vue-chart/Grafico"]);
  });

  it("un extractor declara componentes y usos para un lenguaje que el parser no lee; lo que no se comprueba se descarta", async () => {
    const { p, reg } = await indexado(false);
    await escribir(p, { "web/lib/pedidos_page.dart": "class PedidosPage {\n  Widget build() {\n    return BotonPrimario();\n  }\n}\n" });
    await escribir(reg, {
      "tienda/extractors/repo-web/dart.mjs": `console.log(JSON.stringify({
  simbolos: [{ archivo: "lib/pedidos_page.dart", nombre: "PedidosPage.build", tipo: "metodo", linea: 2, fin: 4 }],
  usos: [
    { archivo: "lib/pedidos_page.dart", linea: 3, paquete: "@tienda/ui", simbolo: "BotonPrimario", desde: "PedidosPage.build" },
    { archivo: "lib/pedidos_page.dart", linea: 1, paquete: "@tienda/ui", simbolo: "BotonPrimario" },
  ],
  componentes: [{ archivo: "lib/pedidos_page.dart", nombre: "Inventado", linea: 2 }],
}));\n`,
    });
    const r = await ejecutar(["brains", "apply", "--root", reg], { FLOWBRAIN_COMANDO: "flowbrain" }, p, async () => "");
    expect(r.codigo, r.stderr).toBe(0);
    const inf = JSON.parse(await readFile(join(reg, "tienda/_build/extractors/repo-web.json"), "utf8")) as { extractores: Array<{ aceptados: Record<string, number>; rechazados: number; motivos: string[] }> };
    const e = inf.extractores[0]!;
    expect(e.aceptados["usos"]).toBe(1);
    expect(e.rechazados).toBe(2);
    expect(e.motivos.join("\n")).toMatch(/componentes: el nombre no aparece en esa línea[\s\S]*usos: el símbolo no aparece en esa línea/);
    const files = JSON.parse(await readFile(join(reg, "tienda/_build/files/repo-web.json"), "utf8")) as { archivos: Array<{ ruta: string; usaPaquetes?: unknown[] }> };
    expect(files.archivos.find((a) => a.ruta === "lib/pedidos_page.dart")?.usaPaquetes).toEqual([{ desde: "PedidosPage.build", linea: 3, paquete: "@tienda/ui", simbolo: "BotonPrimario" }]);
  });

  it("los manifiestos de otros lenguajes dicen qué publica cada repo y de qué depende", async () => {
    const p = join(dir, "multi");
    await escribir(p, {
      "go.mod": "module github.com/empresa/pagos\n\ngo 1.22\n\nrequire (\n\tgithub.com/empresa/comun v1.2.0\n)\n",
      "app/pubspec.yaml": "name: tienda_app\ndependencies:\n  flutter:\n    sdk: flutter\n  empresa_ui:\n    path: ../ui\n",
    });
    const repo = { ...leerRepo(p), paquetes: ["app"] };
    expect(paquetesPublicados(repo)).toEqual([
      { carpeta: "", manifiesto: "go.mod", nombre: "github.com/empresa/pagos", dependeDe: [{ nombre: "github.com/empresa/comun", linea: 6 }] },
      { carpeta: "app", manifiesto: "app/pubspec.yaml", nombre: "tienda_app", dependeDe: [{ nombre: "flutter", linea: 3 }, { nombre: "empresa_ui", linea: 5 }] },
    ]);
  });

  it("en un cerebro: un nodo por componente, cada pantalla usa los que dibuja y el front depende de la librería", async () => {
    const { reg } = await indexado(false);
    const g = await grafo(join(reg, "tienda"));
    expect(g.nodes.filter((n) => n.tipo === "componente").map((n) => n.id)).toEqual(["svc-ui:componente:Boton", "svc-ui:componente:Tarjeta"]);
    const usa = g.edges.filter((e) => e.verbo === "usa").map((e) => `${e.desde} → ${e.hasta}`);
    expect(usa).toEqual(["svc-web:pantalla:/ → svc-ui:componente:Tarjeta", "svc-web:pantalla:/pedidos → svc-ui:componente:Boton", "svc-web:pantalla:/pedidos → svc-ui:componente:Tarjeta"]);
    expect(g.edges.some((e) => e.verbo === "depende_de" && e.desde === "svc-web" && e.hasta === "svc-ui")).toBe(true);
    // Impacto: cambiar el botón llega a la pantalla que lo dibuja.
    const r = await ejecutar(["impact", "svc-ui:componente:Boton", "--root", reg, "--brain", "tienda"], {}, reg, async () => "");
    expect(r.stdout).toContain("svc-web:pantalla:/pedidos");
  });

  it("entre cerebros: se unen por el nombre del paquete, en el visor, en el impacto del MCP y en conexiones", async () => {
    const { reg } = await indexado(true);
    const cerebros = await Promise.all(
      ["ui", "web"].map(async (n) => ({ nombre: n, graph: await grafo(join(reg, n)), archivos: await archivosDe(join(reg, n)) })),
    );
    const livianos = cerebros.map((c) => cerebroLiviano(c.nombre, c.graph, [], c.archivos));
    const u = usosEntreCerebros(livianos);
    expect(u.componentes.map((x) => `${x.desde.pantallas.join(",")} → ${x.hacia.cerebro}/${x.hacia.componente}`).sort()).toEqual([
      "svc-web:pantalla:/ → ui/svc-ui:componente:Tarjeta",
      "svc-web:pantalla:/pedidos → ui/svc-ui:componente:Boton",
      "svc-web:pantalla:/pedidos → ui/svc-ui:componente:Tarjeta",
    ]);
    expect(u.dependencias.map((d) => `${d.desde.cerebro}/${d.desde.svc} → ${d.hacia.cerebro}/${d.hacia.nodo} (${d.hacia.paquete}) ${d.desde.evidencia}`)).toEqual([
      "web/svc-web → ui/svc-ui (@tienda/ui) repo-web:package.json#L5",
    ]);

    // Visor: las aristas cruzan de cerebro.
    const d = datosDeCerebros(cerebros.map((c) => ({ nombre: c.nombre, sinRevisar: false, graph: c.graph, funcionalidades: [] })), [], [], undefined, u);
    expect(d.edges.filter((e) => e.v === "usa").map((e) => `${e.s} → ${e.h}`)).toContain("web/svc-web:pantalla:/pedidos → ui/svc-ui:componente:Boton");
    expect(d.mapa3d.aristas.some((a) => a[0] === "web/svc-web" && a[1] === "ui/svc-ui" && a[2] === "depende_de")).toBe(true);

    // MCP: el impacto del componente llega a las pantallas del otro cerebro, sin comunicación activa.
    const m = crearMulti(reg);
    const ui = await m.resolver("ui");
    const extra = await ui.anotar("impacto", { pieza: "svc-ui:componente:Tarjeta" }, { pieza: "svc-ui:componente:Tarjeta", tecnicas: [] });
    expect(extra["usadoEnOtrosCerebros"]).toEqual([{ cerebro: "web", componentes: ["svc-ui:componente:Tarjeta"], funcionalidades: [], pantallas: { total: 2, primeras: ["svc-web:pantalla:/", "svc-web:pantalla:/pedidos"] } }]);
    const web = await m.resolver("web");
    const deWeb = (await web.anotar("pantalla", {}, { id: "svc-web:pantalla:/pedidos" })) as { usaDeOtrosCerebros?: { total: number } };
    expect(deWeb.usaDeOtrosCerebros?.total).toBe(2);
    const con = (await m.conexiones("web")) as { porPaquetes?: Array<{ desde: string; hacia: string; componentes: number; pantallas: number }> };
    expect(con.porPaquetes).toEqual([{ desde: "web/svc-web", hacia: "ui/svc-ui", paquetes: ["@tienda/ui"], componentes: 2, pantallas: 2, ejemplo: "repo-web:package.json#L5" }]);
  });
});

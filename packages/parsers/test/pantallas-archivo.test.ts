import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarContexto, compileDir, pantalla, recorrido, type Contexto } from "@flowbrain/core";
import { escribirIndex, indexar } from "../src/index.js";
import { rutaDeArchivo, type CarpetaDeRutas } from "../src/rutas-archivo.js";

/** Un fixture por framework en `fixtures/pantallas/<framework>`; el brain se arma en un directorio temporal. */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pagina = (id: string, tipo: string, extra: string[] = []) => ["---", `id: ${id}`, `tipo: ${tipo}`, `nombre: ${id}`, `resumen: ${id}.`, ...extra, "---", `# ${id}`].join("\n") + "\n";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

/** Indexa el fixture contra un brain con un repo y un servicio `svc-web`; devuelve el contexto compilado. */
async function montar(framework: string): Promise<Contexto> {
  const brain = await mkdtemp(join(tmpdir(), `brain-pantallas-${framework}-`));
  dirs.push(brain);
  const repo = `repo-${framework}`;
  await mkdir(join(brain, "technology"), { recursive: true });
  await writeFile(join(brain, "technology", `${repo}.md`), pagina(repo, "repo"));
  await writeFile(join(brain, "technology", "svc-web.md"), pagina("svc-web", "svc", [`vive_en: [${repo}]`]));
  const r = await indexar(join(RAIZ, "fixtures/pantallas", framework), brain);
  await escribirIndex(brain, r);
  await compileDir(brain);
  return cargarContexto(brain);
}

/** Pantallas del grafo: ruta y evidencia de dónde se declara. */
const rutas = (ctx: Contexto) =>
  ctx.graph.nodes
    .filter((n) => n.tipo === "pantalla")
    .map((n) => `${String(n.atributos["ruta"])} ${String(n.atributos["evidencia"])}`)
    .sort();
const endpoints = (ctx: Contexto) => ctx.graph.nodes.filter((n) => n.tipo === "endpoint").map((n) => n.id).sort();
const ver = (ctx: Contexto, ruta: string) => {
  const r = pantalla(ctx, { ruta, budget_tokens: null });
  return { componente: r.componente, envuelta: r.envuelta.map((e) => e.componente), vaA: r.vaA.map((v) => v.a), llamaAlBack: r.llamaAlBack, recorrido: r.recorrido.map((p) => p.simbolo) };
};
const atiende = (ctx: Contexto, ep: string) => (recorrido(ctx, { desde: ep, budget_tokens: null }) as { pasos: Array<{ simbolo: string; ev: string }> }).pasos.map((p) => `${p.simbolo} ${p.ev}`)[0];

describe("rutas por archivo: segmentos", () => {
  const c = (marco: CarpetaDeRutas["marco"], dir: string): CarpetaDeRutas => ({ marco, paquete: "", dir });
  const nada = () => false;
  it("dinámicos, opcionales, grupos, slots, index, privados e interceptores", () => {
    expect(rutaDeArchivo(c("next-pages", "pages"), "pages/blog/[...slug].tsx", nada)).toMatchObject({ clase: "pantalla", ruta: "/blog/{slug}" });
    expect(rutaDeArchivo(c("next-pages", "pages"), "pages/docs/[[...opt]].tsx", nada)).toMatchObject({ ruta: "/docs/{opt}", sinOpcionales: "/docs" });
    expect(rutaDeArchivo(c("next-pages", "pages"), "pages/_app.tsx", nada)).toBeNull();
    expect(rutaDeArchivo(c("next-pages", "pages"), "pages/api/x/[id].ts", nada)).toMatchObject({ clase: "api", ruta: "/api/x/{id}" });
    expect(rutaDeArchivo(c("next-app", "app"), "app/(mkt)/precios/page.tsx", nada)).toMatchObject({ clase: "pantalla", ruta: "/precios" });
    expect(rutaDeArchivo(c("next-app", "app"), "app/_lib/page.tsx", nada)).toBeNull();
    expect(rutaDeArchivo(c("next-app", "app"), "app/fotos/(..)foto/page.tsx", nada)).toBeNull();
    expect(rutaDeArchivo(c("next-app", "app"), "app/fotos/Tarjeta.tsx", nada)).toBeNull();
    expect(rutaDeArchivo(c("next-app", "app"), "app/fotos/route.ts", nada)).toBeNull();
    expect(rutaDeArchivo(c("nuxt", "pages"), "pages/clubes/_id/index.vue", nada)).toMatchObject({ ruta: "/clubes/{id}" });
    expect(rutaDeArchivo(c("nuxt", "pages"), "pages/[[pagina]].vue", nada)).toMatchObject({ ruta: "/{pagina}", sinOpcionales: "/" });
    expect(rutaDeArchivo(c("sveltekit", "src/routes"), "src/routes/(app)/[id=entero]/+page.svelte", nada)).toMatchObject({ ruta: "/{id}" });
    expect(rutaDeArchivo(c("sveltekit", "src/routes"), "src/routes/+error.svelte", nada)).toBeNull();
    expect(rutaDeArchivo(c("sveltekit", "src/routes"), "src/routes/+page.server.ts", nada)).toBeNull();
    expect(rutaDeArchivo(c("expo-router", "app"), "app/(tabs)/index.web.tsx", nada)).toMatchObject({ clase: "pantalla", ruta: "/" });
    expect(rutaDeArchivo(c("expo-router", "app"), "app/+html.tsx", nada)).toBeNull();
  });
});

describe("pantallas por archivo: Next pages/", () => {
  let ctx: Contexto;
  beforeAll(async () => (ctx = await montar("next-pages")));

  it("una pantalla por archivo de pages/, sin _app ni _document ni api/; el opcional vale también sin el segmento", () => {
    expect(rutas(ctx)).toEqual([
      "/ repo-next-pages:pages/index.tsx#L3",
      "/docs repo-next-pages:pages/docs/[[...slug]].tsx#L1",
      "/docs/{slug} repo-next-pages:pages/docs/[[...slug]].tsx#L1",
      "/pedidos repo-next-pages:pages/pedidos/index.tsx#L8",
      "/pedidos/{id} repo-next-pages:pages/pedidos/[id].tsx#L6",
    ]);
  });

  it("la pantalla llega a sus llamadas (también las de getServerSideProps), va a donde navega y la envuelve _app", () => {
    expect(ver(ctx, "/pedidos")).toEqual({
      componente: "Pedidos @ repo-next-pages:pages/pedidos/index.tsx#L8",
      envuelta: ["App @ repo-next-pages:pages/_app.tsx#L1"],
      vaA: ["/pedidos/{id}"],
      llamaAlBack: ["svc-web:GET:/api/pedidos"],
      recorrido: ["Pedidos", "cargarPedidos"],
    });
    // `export default function ()` sin nombre: el símbolo `default` del archivo.
    expect(ver(ctx, "/pedidos/{id}")).toMatchObject({ componente: "default @ repo-next-pages:pages/pedidos/[id].tsx#L6", llamaAlBack: ["svc-web:GET:/api/pedidos/{id}"], recorrido: ["default", "getServerSideProps"] });
    expect(ver(ctx, "/").vaA).toEqual(["/pedidos"]);
  });

  it("pages/api son endpoints atendidos por su handler; el método sale del código, o GET y POST si no lo fija", () => {
    expect(endpoints(ctx)).toEqual(["svc-web:GET:/api/pedidos", "svc-web:GET:/api/pedidos/{id}", "svc-web:POST:/api/pedidos", "svc-web:POST:/api/pedidos/{id}"]);
    expect(atiende(ctx, "svc-web:POST:/api/pedidos")).toBe("handler repo-next-pages:pages/api/pedidos/index.ts#L5");
  });
});

describe("pantallas por archivo: Next app/", () => {
  let ctx: Contexto;
  beforeAll(async () => (ctx = await montar("next-app")));

  it("page.tsx es la pantalla; grupos y slots no suman segmento; privadas, interceptoras y loading no son pantallas", () => {
    expect(rutas(ctx)).toEqual([
      "/ repo-next-app:src/app/page.tsx#L3",
      "/login repo-next-app:src/app/@modal/login/page.tsx#L1",
      "/productos/{id} repo-next-app:src/app/(tienda)/productos/[id]/page.tsx#L6",
    ]);
  });

  it("los layouts de arriba la envuelven, de afuera hacia adentro, y llega al endpoint de route.ts", () => {
    expect(ver(ctx, "/productos/{id}")).toEqual({
      componente: "Producto @ repo-next-app:src/app/(tienda)/productos/[id]/page.tsx#L6",
      envuelta: ["RootLayout @ repo-next-app:src/app/layout.tsx#L1", "TiendaLayout @ repo-next-app:src/app/(tienda)/layout.tsx#L1"],
      vaA: [],
      llamaAlBack: ["svc-web:GET:/api/productos/{id}"],
      recorrido: ["Producto", "producto"],
    });
    expect(atiende(ctx, "svc-web:GET:/api/productos/{id}")).toBe("GET repo-next-app:src/app/api/productos/[id]/route.ts#L1");
  });
});

describe("pantallas por archivo: Nuxt", () => {
  let ctx: Contexto;
  beforeAll(async () => (ctx = await montar("nuxt")));

  it("cada .vue de pages/ es una pantalla; `_slug` (Nuxt 2) es un parámetro; el padre con index/ deja de ser pantalla", () => {
    expect(rutas(ctx)).toEqual([
      "/ repo-nuxt:pages/index.vue#L1",
      "/legado/{slug} repo-nuxt:pages/legado/_slug.vue#L1",
      "/usuarios repo-nuxt:pages/usuarios/index.vue#L1",
      "/usuarios/{id} repo-nuxt:pages/usuarios/[id].vue#L1",
    ]);
  });

  it("el padre `usuarios.vue` envuelve a sus hijas, que llegan a los endpoints de server/api", () => {
    expect(ver(ctx, "/usuarios/{id}")).toEqual({
      componente: "usuariosId @ repo-nuxt:pages/usuarios/[id].vue#L1",
      envuelta: ["usuarios @ repo-nuxt:pages/usuarios.vue#L1"],
      vaA: [],
      llamaAlBack: ["svc-web:GET:/api/usuarios/{id}"],
      recorrido: ["usuariosId", "cargar"],
    });
    expect(ver(ctx, "/usuarios").llamaAlBack).toEqual(["svc-web:POST:/api/usuarios"]);
    expect(ver(ctx, "/").vaA).toEqual(["/usuarios"]);
  });

  it("server/api: el método sale del nombre (`[id].get.ts`) y lo atiende el `defineEventHandler` del archivo", () => {
    expect(endpoints(ctx)).toEqual(["svc-web:GET:/api/usuarios/{id}", "svc-web:POST:/api/usuarios"]);
    expect(atiende(ctx, "svc-web:GET:/api/usuarios/{id}")).toBe("default repo-nuxt:server/api/usuarios/[id].get.ts#L3");
  });
});

describe("pantallas por archivo: SvelteKit", () => {
  let ctx: Contexto;
  beforeAll(async () => (ctx = await montar("sveltekit")));

  it("+page.svelte es la pantalla; +error no; `[[seccion]]` vale con y sin el segmento", () => {
    expect(rutas(ctx)).toEqual([
      "/ repo-sveltekit:src/routes/+page.svelte#L1",
      "/ajustes repo-sveltekit:src/routes/(app)/ajustes/[[seccion]]/+page.svelte#L1",
      "/ajustes/{seccion} repo-sveltekit:src/routes/(app)/ajustes/[[seccion]]/+page.svelte#L1",
      "/blog/{slug} repo-sveltekit:src/routes/blog/[slug]/+page.svelte#L1",
    ]);
  });

  it("el `load` de +page.ts es parte de la pantalla (con el `fetch` que recibe), y +server.ts es el endpoint", () => {
    expect(ver(ctx, "/blog/{slug}")).toEqual({
      componente: "slugPage @ repo-sveltekit:src/routes/blog/[slug]/+page.svelte#L1",
      envuelta: ["routesLayout @ repo-sveltekit:src/routes/+layout.svelte#L1"],
      vaA: [],
      llamaAlBack: ["svc-web:GET:/api/posts/{slug}"],
      recorrido: ["slugPage", "load"],
    });
    expect(ver(ctx, "/").vaA).toEqual(["/ajustes"]);
    expect(atiende(ctx, "svc-web:GET:/api/posts/{slug}")).toBe("GET repo-sveltekit:src/routes/api/posts/[slug=slug]/+server.ts#L1");
  });
});

describe("pantallas por archivo: Expo Router", () => {
  let ctx: Contexto;
  beforeAll(async () => (ctx = await montar("expo-router")));

  it("cada archivo de app/ es una pantalla; _layout y +not-found no; la variante .ios es la misma ruta", () => {
    expect(rutas(ctx)).toEqual([
      "/ repo-expo-router:app/(tabs)/index.tsx#L3",
      "/ajustes repo-expo-router:app/ajustes.ios.tsx#L1",
      "/perfil repo-expo-router:app/(tabs)/perfil.tsx#L1",
      "/producto/{id} repo-expo-router:app/producto/[id].tsx#L8",
      "/{resto} repo-expo-router:app/[...resto].tsx#L1",
    ]);
    expect(ver(ctx, "/ajustes").recorrido).toEqual(["AjustesIos", "Ajustes"]);
  });

  it("los _layout la envuelven, navega con router.push y llega al endpoint de `+api.ts`", () => {
    expect(ver(ctx, "/producto/{id}")).toEqual({
      componente: "Producto @ repo-expo-router:app/producto/[id].tsx#L8",
      envuelta: ["Raiz @ repo-expo-router:app/_layout.tsx#L3"],
      vaA: ["/perfil"],
      llamaAlBack: ["svc-web:GET:/api/productos/{id}"],
      recorrido: ["Producto", "cargar"],
    });
    expect(ver(ctx, "/").envuelta).toEqual(["Raiz @ repo-expo-router:app/_layout.tsx#L3", "Pestanas @ repo-expo-router:app/(tabs)/_layout.tsx#L3"]);
    expect(atiende(ctx, "svc-web:GET:/api/productos/{id}")).toBe("GET repo-expo-router:app/api/productos/[id]+api.ts#L1");
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarContexto, compileDir, pantalla, quienLlama, type Contexto } from "@flowbrain/core";
import { escribirIndex, indexar, leerRepo, tsParser, type Extraccion } from "../src/index.js";

/**
 * Lo que en el proyecto real resolvían extractores (decisión 159): rutas que cuelgan de un layout, funciones publicadas
 * en un contexto y el objeto que devuelve un hook. Un fixture por caso en `fixtures/hooks-y-contexto/<caso>`: una web
 * React y una API Express.
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FX = (c: string) => join(RAIZ, "fixtures/hooks-y-contexto", c);
const pagina = (id: string, tipo: string, extra: string[] = []) => ["---", `id: ${id}`, `tipo: ${tipo}`, `nombre: ${id}`, `resumen: ${id}.`, ...extra, "---", `# ${id}`].join("\n") + "\n";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

async function montar(c: string): Promise<Contexto> {
  const brain = await mkdtemp(join(tmpdir(), `brain-hooks-${c}-`));
  dirs.push(brain);
  const repo = `repo-${c}`;
  await mkdir(join(brain, "technology"), { recursive: true });
  await writeFile(join(brain, "technology", `${repo}.md`), pagina(repo, "repo"));
  await writeFile(join(brain, "technology", "svc-api.md"), pagina("svc-api", "svc", [`vive_en: [${repo}]`, "puntos_de_entrada:", "  arranque: apps/api/src/rutas.ts"]));
  await writeFile(join(brain, "technology", "svc-web.md"), pagina("svc-web", "svc", [`vive_en: [${repo}]`, "puntos_de_entrada:", "  arranque: apps/web/src/App.tsx"]));
  await escribirIndex(brain, await indexar(FX(c), brain));
  await compileDir(brain);
  return cargarContexto(brain);
}
const extraer = (c: string) => tsParser.extract(leerRepo(FX(c))) as Extraccion;
const archivo = (x: Extraccion, ruta: string) => x.archivos.find((a) => a.ruta === `apps/web/src/${ruta}`)!;
const invoca = (x: Extraccion, ruta: string) => (archivo(x, ruta).invoca ?? []).map((i) => `${i.desde} → ${i.simbolo} L${i.linea}`).sort();
const llama = (ctx: Contexto, ruta: string) => pantalla(ctx, { ruta, budget_tokens: null }).llamaAlBack;

describe("layout: la pantalla hereda lo que hace lo que la envuelve (fixtures/hooks-y-contexto/layout)", () => {
  let ctx: Contexto;
  beforeAll(async () => (ctx = await montar("layout")));

  it("las rutas relativas de un componente cuelgan de la ruta que lo monta, con el componente como envoltura", () => {
    const ps = extraer("layout").pantallas.map((p) => `${p.ruta} ${p.componente?.simbolo} [${p.envuelta.map((e) => e.simbolo).join(", ")}]${p.pendiente ? " pendiente" : ""}`);
    expect(ps.sort()).toEqual([
      "/ Inicio [Marco]",
      // React Router 6: <Routes> descendientes dentro de `Admin`, montado en /admin/*.
      "/admin/* Admin [Marco]",
      "/admin/usuarios Usuarios [Marco, Admin]",
      "/admin/usuarios/{uid} Usuario [Marco, Admin]",
      // Un componente que ninguna ruta monta: sus rutas relativas van desde la raíz, como en el <Routes> de la app.
      "/perdida Huerfana []",
      "/torneos/{id} Torneo []",
      // React Router 5: `${path}/listas` con el path de useRouteMatch.
      "/torneos/{id}/listas Listas [Torneo]",
      // `${url}/x` en un componente que nadie monta: no se sabe el prefijo.
      "/{url}/x Huerfana [] pendiente",
    ]);
  });

  it("las llamadas del layout (<Outlet />) y del componente que monta las rutas son de la pantalla", () => {
    expect(llama(ctx, "/admin/usuarios")).toEqual(["svc-api:GET:/api/sesion", "svc-api:GET:/api/permisos", "svc-api:GET:/api/usuarios"]);
    expect(llama(ctx, "/")).toEqual(["svc-api:GET:/api/sesion"]);
    expect(llama(ctx, "/torneos/{id}/listas")).toEqual(["svc-api:GET:/api/listas"]);
    expect(pantalla(ctx, { ruta: "/admin/usuarios", budget_tokens: null }).avisos).toContain("the flow includes what its layouts and guards do (Marco, Admin): their calls belong to the screen");
  });

  it("la navegación del layout no pasa a la pantalla, y la ruta sin resolver lo dice", () => {
    const r = pantalla(ctx, { ruta: "/{url}/x", budget_tokens: null });
    expect(r.avisos.some((a) => a.startsWith("unresolved route: ruta armada con el `path` de la ruta que monta a Perdido"))).toBe(true);
  });
});

describe("contexto: lo que publica un Provider llega a quien lo consume (fixtures/hooks-y-contexto/contexto)", () => {
  let ctx: Contexto;
  beforeAll(async () => (ctx = await montar("contexto")));

  it("las funciones del value del Provider son símbolos propios, con su rango", () => {
    const x = extraer("contexto");
    const s = (r: string) => archivo(x, r).simbolos.filter((y) => y.nombre.includes(".")).map((y) => `${y.nombre} ${y.linea}-${y.fin}`);
    // `value={{ usuario, permisos, entrar, cerrar: salir }}`: `usuario` y `permisos` son datos. `guardarToken` no se
    // publica, pero es del Provider y `entrar` la llama: también es un símbolo, así la cadena sigue.
    expect(s("contexto/SesionProvider.jsx")).toEqual(["SesionProvider.guardarToken 9-11", "SesionProvider.entrar 12-17", "SesionProvider.salir 18-21"]);
    expect(invoca(x, "contexto/SesionProvider.jsx")).toContain("SesionProvider.entrar → SesionProvider.guardarToken L15");
    // `value={valor}` con `useMemo(() => ({ agregar, vaciar: () => … }))`.
    expect(s("contexto/Carrito.tsx")).toEqual(["CarritoProvider.agregar 11-13", "CarritoProvider.vaciar 17-19"]);
  });

  it("useContext directo, un hook del contexto, desestructurado o con punto: va a la función del Provider", () => {
    const x = extraer("contexto");
    expect(invoca(x, "paginas/Login.jsx")).toEqual(["Login → SesionProvider.entrar L6", "Login → useSesion L4"]);
    // `onClick={sesion.cerrar}`: la clave `cerrar` es `salir`.
    // Leer el contexto es depender de los datos que carga el Provider: `permisos` sale de `usePermisos()`.
    expect(invoca(x, "paginas/Perfil.jsx")).toEqual(["Perfil → SesionProvider.salir L6", "Perfil → usePermisos L5"]);
    expect(invoca(x, "contexto/SesionProvider.jsx")).toContain("useSesion → usePermisos L27");
    expect(invoca(x, "paginas/Tienda.tsx")).toEqual(["Tienda → CarritoProvider.agregar L9", "Tienda → CarritoProvider.vaciar L10", "Tienda → useCarrito L6"]);
  });

  it("lo que el contexto no expone queda sin resolver, con el motivo", () => {
    expect(archivo(extraer("contexto"), "paginas/Login.jsx").sinResolver).toEqual([{ desde: "Login", linea: 7, llamada: "recargar", motivo: "useSesion (SesionContext) no expone `recargar`" }]);
  });

  it("las pantallas llegan a lo que llama el Provider, aunque el Provider esté arriba del router", () => {
    expect([...llama(ctx, "/login")].sort()).toEqual(["svc-api:GET:/api/permisos", "svc-api:POST:/api/login", "svc-api:PUT:/api/token"]);
    expect([...llama(ctx, "/perfil")].sort()).toEqual(["svc-api:GET:/api/permisos", "svc-api:POST:/api/logout"]);
    expect([...llama(ctx, "/tienda")].sort()).toEqual(["svc-api:DELETE:/api/carrito", "svc-api:POST:/api/carrito/{id}"]);
    expect(quienLlama(ctx, { simbolo: "SesionProvider.entrar", budget_tokens: null }).llamadas.filter((l) => l.nivel === 1).map((l) => l.quien.split(" @ ")[0]).sort()).toEqual(["Login", "SesionProvider"]);
  });
});

describe("objeto de un hook: la llamada va a la función de adentro del hook (fixtures/hooks-y-contexto/objeto-hook)", () => {
  let ctx: Contexto;
  beforeAll(async () => (ctx = await montar("objeto-hook")));

  it("las funciones del objeto devuelto son símbolos, con lo que llaman", () => {
    const x = extraer("objeto-hook");
    expect(archivo(x, "hooks/usePedidos.ts").simbolos.filter((y) => y.nombre.includes(".")).map((y) => y.nombre)).toEqual(["usePedidos.cargar", "usePedidos.guardar", "usePedidos.borrar"]);
    expect(invoca(x, "hooks/usePedidos.ts")).toContain("usePedidos.guardar → api.crear L12");
    // En JavaScript también: `useOtp` es una flecha que devuelve `{ abrir, cerrar }`.
    expect(archivo(x, "hooks/useOtp.js").simbolos.map((y) => y.nombre)).toEqual(["useOtp", "useOtp.abrir", "useOtp.cerrar"]);
  });

  it("desestructurado (con alias) o con punto, en TypeScript y en JavaScript", () => {
    const x = extraer("objeto-hook");
    // `enviar({ grabar })`: pasada en un objeto abreviado también es un uso.
    expect(invoca(x, "paginas/Pedidos.tsx")).toEqual(["Pedidos → enviar L13", "Pedidos → usePedidos L9", "Pedidos → usePedidos.cargar L11", "Pedidos → usePedidos.guardar L13"]);
    // Antes `otp.abrir` iba a un `abrir` suelto que no existe, y `pedidos.borrar` a ningún lado.
    expect(invoca(x, "paginas/Pedido.tsx")).toEqual(["Pedido → useOtp L6", "Pedido → useOtp.abrir L10", "Pedido → usePedidos L5", "Pedido → usePedidos.borrar L9"]);
    expect(archivo(x, "paginas/Pedido.tsx").sinResolver).toEqual([{ desde: "Pedido", linea: 11, llamada: "otp.reenviar", motivo: "useOtp no expone `reenviar`" }]);
  });

  it("quien_llama llega de la función del hook a la pantalla, y la pantalla a los endpoints", () => {
    expect(quienLlama(ctx, { simbolo: "usePedidos.borrar", budget_tokens: null }).llamadas.filter((l) => l.nivel === 1).map((l) => l.quien.split(" @ ")[0]).sort()).toEqual(["Pedido", "usePedidos"]);
    expect([...llama(ctx, "/pedidos/{id}")].sort()).toEqual(["svc-api:DELETE:/api/pedidos/{id}", "svc-api:GET:/api/pedidos", "svc-api:POST:/api/otp", "svc-api:POST:/api/pedidos"]);
  });
});

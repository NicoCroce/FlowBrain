import { describe, expect, it } from "vitest";
import { cerebroLiviano, crucesDelRegistro, crucesEntre, impactoCruzado, resumenConexiones, trazasCruzadas, type Graph, type GraphNode } from "../src/index.js";

const nodo = (id: string, tipo: GraphNode["tipo"], atributos: Record<string, unknown> = {}): GraphNode => ({ actualizado: null, aliases: [], atributos, estado: "vigente", id, nombre: id, origen: "parser", pagina: null, resumen: null, tecnologia: [], tipo, verificado: null });

/**
 * Un front con dos llamadas que su cerebro no pudo unir: una dentro de un hook que usa una pantalla y otra en un
 * script suelto. El back, en otro cerebro, atiende las dos.
 */
const front: Graph = {
  version: 1,
  nodes: [nodo("svc-web", "svc"), nodo("svc-web:/pedidos", "pantalla", { ruta: "/pedidos", componentes: ["repo-web:src/Pedidos.tsx#Pedidos"] })],
  edges: [],
};
const back: Graph = {
  version: 1,
  nodes: [nodo("svc-api", "svc"), nodo("svc-api:GET:/pedidos", "endpoint", { metodo: "GET", ruta: "/pedidos" }), nodo("svc-api:POST:/pedidos", "endpoint", { metodo: "POST", ruta: "/pedidos" })],
  edges: [],
};
const pendiente = (evidencia: string, metodo: string) => ({ verbo: "llama_a", desde: "svc-web", evidencia, llamada: { metodo, ruta: "/pedidos", base: "API_URL" } });
const extraccion = JSON.stringify({ pendientes: [pendiente("repo-web:src/hooks/usePedidos.ts#L3", "GET"), pendiente("repo-web:scripts/carga.ts#L2", "POST")] });
const archivos = JSON.stringify({
  repo: "repo-web",
  archivos: [
    { ruta: "src/Pedidos.tsx", simbolos: [{ nombre: "Pedidos", tipo: "funcion", linea: 2, fin: 6 }], invoca: [{ desde: "Pedidos", archivo: "src/hooks/usePedidos.ts", simbolo: "usePedidos", linea: 3 }] },
    { ruta: "src/hooks/usePedidos.ts", simbolos: [{ nombre: "usePedidos", tipo: "funcion", linea: 1, fin: 5 }] },
    { ruta: "scripts/carga.ts", simbolos: [{ nombre: "cargar", tipo: "funcion", linea: 1, fin: 4 }] },
  ],
});

describe("cruces entre cerebros", () => {
  it("cada llamada dice desde qué pantallas se llega a ella; la que no es de ninguna queda a nombre del servicio", () => {
    const { cruces } = crucesEntre(cerebroLiviano("front", front, [extraccion], [archivos]), cerebroLiviano("back", back, []), []);
    expect(cruces.map((c) => `${c.desde.evidencia} [${c.desde.pantallas.join(",")}] → ${c.hacia.endpoint}`)).toEqual([
      "repo-web:scripts/carga.ts#L2 [] → svc-api:POST:/pedidos",
      "repo-web:src/hooks/usePedidos.ts#L3 [svc-web:/pedidos] → svc-api:GET:/pedidos",
    ]);
    expect(resumenConexiones(cruces, []).map((r) => [r.llamadas, r.endpoints, r.pantallas])).toEqual([[2, 2, 1]]);
  });

  it("el impacto cruza de cerebro: las pantallas que llaman a un endpoint alcanzado y sus funcionalidades; la llamada sin pantalla queda como servicio", () => {
    const conFeat: Graph = { ...front, nodes: [...front.nodes, { ...nodo("feat-pedidos", "feat"), nombre: "Pedidos" }], edges: [{ desde: "svc-web:/pedidos", verbo: "implementa", hasta: "feat-pedidos" } as Graph["edges"][number]] };
    const f = cerebroLiviano("front", conFeat, [extraccion], [archivos]), b = cerebroLiviano("back", back, []);
    const { cruces } = crucesEntre(f, b, []);
    expect(impactoCruzado("back", ["svc-api:GET:/pedidos", "svc-api:POST:/pedidos"], cruces, [f, b])).toEqual([
      {
        cerebro: "front",
        funcionalidades: [{ id: "feat-pedidos", nombre: "Pedidos", pantallas: 1 }],
        pantallas: [{ id: "svc-web:/pedidos", endpoints: ["svc-api:GET:/pedidos"], ev: "repo-web:src/hooks/usePedidos.ts#L3" }],
        servicios: [{ svc: "svc-web", endpoint: "svc-api:POST:/pedidos", ev: "repo-web:scripts/carga.ts#L2" }],
      },
    ]);
    // Un endpoint que nadie de afuera llama no alcanza nada; tampoco cuentan los cruces hacia otro cerebro.
    expect(impactoCruzado("back", ["svc-api:DELETE:/pedidos"], cruces, [f, b])).toEqual([]);
    expect(impactoCruzado("otro", ["svc-api:GET:/pedidos"], cruces, [f, b])).toEqual([]);
  });

  it("sin la estructura de archivos no se inventan pantallas", () => {
    const { cruces } = crucesEntre(cerebroLiviano("front", front, [extraccion]), cerebroLiviano("back", back, []), []);
    expect(cruces.map((c) => c.desde.pantallas)).toEqual([[], []]);
  });

  it("una llamada que coincide con un endpoint en dos cerebros no se une a ninguno hasta que una conexión diga a cuál va", () => {
    const viejo: Graph = { version: 1, nodes: [nodo("svc-vieja", "svc"), nodo("svc-vieja:GET:/pedidos", "endpoint", { metodo: "GET", ruta: "/pedidos" })], edges: [] };
    const f = cerebroLiviano("front", front, [extraccion], [archivos]), b = cerebroLiviano("back", back, []), v = cerebroLiviano("viejo", viejo, []);
    const todos = () => true;
    const r = crucesDelRegistro([f, b, v], todos, []);
    // GET /pedidos está en los dos; POST /pedidos solo en el back.
    expect(r.cruces.map((c) => c.hacia.endpoint)).toEqual(["svc-api:POST:/pedidos"]);
    expect(r.entreCerebros).toEqual([{ base: "API_URL", candidatos: ["back/svc-api:GET:/pedidos", "viejo/svc-vieja:GET:/pedidos"], cerebro: "front", evidencia: "repo-web:src/hooks/usePedidos.ts#L3", metodo: "GET", ruta: "/pedidos", svc: "svc-web" }]);
    const conexion = { desde: { cerebro: "front", svc: "svc-web" }, hacia: { cerebro: "viejo", svc: "svc-vieja" }, por: "API_URL", origen: "modelo" as const, evidencia: [], nota: null };
    const d = crucesDelRegistro([f, b, v], todos, [conexion]);
    // Declarado: todo lo que va por esa base es para el viejo; lo que el viejo no atiende no se le cuelga al otro.
    expect(d.cruces.map((c) => `${c.hacia.cerebro}/${c.hacia.endpoint} ${c.declarada}`)).toEqual(["viejo/svc-vieja:GET:/pedidos true"]);
    expect(d.entreCerebros).toEqual([]);
    expect(resumenConexiones(d.cruces, [conexion]).map((x) => [x.hacia, x.origen, x.llamadas])).toEqual([["viejo/svc-vieja", "modelo", 1]]);
  });

  it("traza de punta a punta: la pantalla de un cerebro llega a la tabla del otro, con cada id rotulado con su cerebro", () => {
    const api: Graph = {
      version: 1,
      nodes: [...back.nodes.map((n) => (n.id === "svc-api:GET:/pedidos" ? { ...n, atributos: { ...n.atributos, evidencia: "repo-api:src/pedidos.controller.ts#L3" } } : n)), nodo("tabla-pedidos", "tabla")],
      edges: [],
    };
    const archivosApi = JSON.stringify({
      repo: "repo-api",
      archivos: [
        { ruta: "src/pedidos.controller.ts", simbolos: [{ nombre: "PedidosController.listar", tipo: "metodo", linea: 3, fin: 5 }], invoca: [{ desde: "PedidosController.listar", archivo: "src/pedidos.repository.ts", simbolo: "PedidosRepository.todos", linea: 4 }] },
        { ruta: "src/pedidos.repository.ts", simbolos: [{ nombre: "PedidosRepository.todos", tipo: "metodo", linea: 2, fin: 4 }] },
      ],
    });
    const extraccionApi = JSON.stringify({ accesos: [{ desde: "svc-api", verbo: "lee_de", hasta: "tabla-pedidos", endpoint: null, evidencia: "repo-api:src/pedidos.repository.ts#L3" }] });
    const fuentes = [{ nombre: "front", graph: front, extracciones: [extraccion], archivos: [archivos] }, { nombre: "back", graph: api, extracciones: [extraccionApi], archivos: [archivosApi] }];
    const { cruces } = crucesEntre(cerebroLiviano("front", front, [extraccion], [archivos]), cerebroLiviano("back", api, [extraccionApi], [archivosApi]), []);
    const t = trazasCruzadas(fuentes, cruces);
    const linea = (p: { nivel: number; simbolo: string; toca: Array<{ verbo: string; hasta: string; endpoint: string | null }> }) => `${p.nivel} ${p.simbolo}${p.toca.map((x) => ` → ${x.verbo} ${x.endpoint ?? x.hasta}`).join("")}`;
    expect(Object.keys(t.pantallas)).toEqual(["front/svc-web:/pedidos"]);
    expect(t.pantallas["front/svc-web:/pedidos"]!.pasos.map(linea)).toEqual(["0 Pedidos", "1 usePedidos → llama_a back/svc-api:GET:/pedidos"]);
    expect(t.pantallas["front/svc-web:/pedidos"]!.endpoints).toEqual(["back/svc-api:GET:/pedidos"]);
    // El script suelto no es de ninguna pantalla: su endpoint no entra en las trazas.
    expect(Object.keys(t.backs)).toEqual(["back/svc-api:GET:/pedidos"]);
    expect(t.backs["back/svc-api:GET:/pedidos"]!.pasos.map(linea)).toEqual(["0 PedidosController.listar", "1 PedidosRepository.todos → lee_de back/tabla-pedidos"]);
    // Sin cruces (comunicación apagada) no hay trazas.
    expect(trazasCruzadas(fuentes, [])).toEqual({ pantallas: {}, backs: {} });
  });

  it("la traza sigue de un back a otro: la API que cobra en el servicio de pagos llega a la tabla de pagos", () => {
    const api: Graph = { version: 1, nodes: [nodo("svc-api", "svc"), nodo("svc-api:GET:/pedidos", "endpoint", { metodo: "GET", ruta: "/pedidos", evidencia: "repo-api:src/pedidos.py#L3" })], edges: [] };
    const archivosApi = JSON.stringify({ repo: "repo-api", archivos: [{ ruta: "src/pedidos.py", simbolos: [{ nombre: "listar", tipo: "funcion", linea: 3, fin: 6 }] }] });
    const extraccionApi = JSON.stringify({ pendientes: [{ verbo: "llama_a", desde: "svc-api", evidencia: "repo-api:src/pedidos.py#L5", llamada: { metodo: "POST", ruta: "/v1/cobros", base: "PAGOS_URL" } }] });
    const pagos: Graph = { version: 1, nodes: [nodo("svc-pagos", "svc"), nodo("svc-pagos:POST:/v1/cobros", "endpoint", { metodo: "POST", ruta: "/v1/cobros", evidencia: "repo-pagos:handlers.go#L10" }), nodo("svc-pagos:GET:/v1/pagos/{id}", "endpoint", { metodo: "GET", ruta: "/v1/pagos/{id}" }), nodo("tabla-pagos", "tabla")], edges: [] };
    const archivosPagos = JSON.stringify({ repo: "repo-pagos", archivos: [{ ruta: "handlers.go", simbolos: [{ nombre: "Cobrar", tipo: "funcion", linea: 10, fin: 14 }] }] });
    const extraccionPagos = JSON.stringify({ accesos: [{ desde: "svc-pagos", verbo: "escribe_en", hasta: "tabla-pagos", endpoint: null, evidencia: "repo-pagos:handlers.go#L12" }] });
    const frontApi = JSON.stringify({ pendientes: [pendiente("repo-web:src/hooks/usePedidos.ts#L3", "GET"), { verbo: "llama_a", desde: "svc-web", evidencia: "repo-web:src/hooks/usePedidos.ts#L4", llamada: { metodo: "GET", ruta: "/clubes", base: "API_URL" } }] });
    const livianos = [cerebroLiviano("front", front, [frontApi], [archivos]), cerebroLiviano("api", api, [extraccionApi], [archivosApi]), cerebroLiviano("pagos", pagos, [extraccionPagos], [archivosPagos])];
    const { cruces, entreCerebros } = crucesDelRegistro(livianos, () => true, []);
    // `GET /clubes` no es `GET /v1/pagos/{id}`: un parámetro solo no alcanza para unir una llamada.
    expect(cruces.map((c) => `${c.desde.cerebro} → ${c.hacia.cerebro}/${c.hacia.endpoint}`).sort()).toEqual(["api → pagos/svc-pagos:POST:/v1/cobros", "front → api/svc-api:GET:/pedidos"]);
    expect(entreCerebros).toEqual([]);
    const t = trazasCruzadas(
      [
        { nombre: "front", graph: front, extracciones: [frontApi], archivos: [archivos] },
        { nombre: "api", graph: api, extracciones: [extraccionApi], archivos: [archivosApi] },
        { nombre: "pagos", graph: pagos, extracciones: [extraccionPagos], archivos: [archivosPagos] },
      ],
      cruces,
    );
    const linea = (p: { nivel: number; simbolo: string; toca: Array<{ verbo: string; hasta: string; endpoint: string | null }> }) => `${p.nivel} ${p.simbolo}${p.toca.map((x) => ` → ${x.verbo} ${x.endpoint ?? x.hasta}`).join("")}`;
    expect(Object.keys(t.backs)).toEqual(["api/svc-api:GET:/pedidos", "pagos/svc-pagos:POST:/v1/cobros"]);
    expect(t.backs["api/svc-api:GET:/pedidos"]!.pasos.map(linea)).toEqual(["0 listar → llama_a pagos/svc-pagos:POST:/v1/cobros"]);
    expect(t.backs["pagos/svc-pagos:POST:/v1/cobros"]!.pasos.map(linea)).toEqual(["0 Cobrar → escribe_en pagos/tabla-pagos"]);
  });

  it("entre dos rutas que coinciden gana la más literal, como en un router", () => {
    const g: Graph = { version: 1, nodes: [nodo("svc-api", "svc"), nodo("svc-api:POST:/api/login", "endpoint", { metodo: "POST", ruta: "/api/login" }), nodo("svc-api:POST:/api/imagen/{id}", "endpoint", { metodo: "POST", ruta: "/api/imagen/{id}" })], edges: [] };
    const llama = (ruta: string) => JSON.stringify({ pendientes: [{ verbo: "llama_a", desde: "svc-web", evidencia: "repo-web:src/api.ts#L1", llamada: { metodo: "POST", ruta, base: "API" } }] });
    const cruza = (ruta: string) => crucesEntre(cerebroLiviano("front", front, [llama(ruta)]), cerebroLiviano("back", g, []), []);
    expect(cruza("/login").cruces.map((c) => c.hacia.endpoint)).toEqual(["svc-api:POST:/api/login"]);
    // Una sola candidata con parámetro sigue valiendo.
    expect(cruza("/imagen/7").cruces.map((c) => c.hacia.endpoint)).toEqual(["svc-api:POST:/api/imagen/{id}"]);
  });
});

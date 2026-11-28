import { describe, expect, it } from "vitest";
import { ConsultaError, crearContexto, redDeFlujo, redDelGrafo, trazabilidad, trazabilidadDe, type EntradaRed, type Graph, type GraphNode, type Paso } from "../src/index.js";

const paso = (simbolo: string, evidencia: string, nivel: number, toca: Paso["toca"] = [], extra: Partial<Paso> = {}): Paso => ({ simbolo, evidencia, capa: "logica", nivel, desde: null, toca, ...extra });

/**
 * Dos cerebros: un front (`web`) con dos pantallas de la misma funcionalidad y un back (`api`) con dos endpoints que
 * comparten el repositorio. La pantalla de reservas llama al GET por HTTP (traza cruzada).
 */
const entrada = (): EntradaRed => ({
  multi: true,
  nodos: [
    { id: "web/feat-reservas", tipo: "feat", c: 0 },
    { id: "web/svc-web", tipo: "svc", c: 0 },
    { id: "web/svc-web:pantalla:/reservas", tipo: "pantalla", c: 0 },
    { id: "web/svc-web:pantalla:/perfil", tipo: "pantalla", c: 0 },
    { id: "web/svc-web:componente:Boton", tipo: "componente", c: 0, nombre: "Boton", archivo: "web/repo-web:ds/Boton.tsx" },
    { id: "web/repo-web:src/Reservas.tsx", tipo: "archivo", c: 0 },
    { id: "web/repo-web:src/useReservas.ts", tipo: "archivo", c: 0 },
    { id: "web/repo-web:ds/Boton.tsx", tipo: "archivo", c: 0 },
    { id: "api/feat-agenda", tipo: "feat", c: 1 },
    { id: "api/svc-api", tipo: "svc", c: 1 },
    { id: "api/svc-api:GET:/reservas", tipo: "endpoint", c: 1 },
    { id: "api/svc-api:POST:/reservas", tipo: "endpoint", c: 1 },
    { id: "api/svc-api:DELETE:/reservas", tipo: "endpoint", c: 1 },
    { id: "api/tabla-reservas", tipo: "tabla", c: 1 },
    { id: "api/tabla-auditoria", tipo: "tabla", c: 1 },
    { id: "api/queue-avisos", tipo: "queue", c: 1 },
    { id: "api/repo-api:src/reservas.repo.ts", tipo: "archivo", c: 1 },
    { id: "api/repo-api:src/reservas.service.ts", tipo: "archivo", c: 1 },
  ],
  aristas: [
    { s: "web/svc-web:pantalla:/reservas", h: "web/feat-reservas", v: "implementa", ev: "repo-web:src/rutas.tsx#L3" },
    { s: "web/svc-web:pantalla:/perfil", h: "web/feat-reservas", v: "implementa", ev: "repo-web:src/rutas.tsx#L4" },
    { s: "web/svc-web:pantalla:/reservas", h: "web/svc-web:componente:Boton", v: "usa", ev: "repo-web:src/Reservas.tsx#L9" },
    { s: "web/svc-web:pantalla:/perfil", h: "web/svc-web:componente:Boton", v: "usa", ev: "repo-web:src/Perfil.tsx#L9" },
    { s: "web/svc-web", h: "web/svc-web:pantalla:/reservas", v: "contiene" },
    { s: "api/svc-api:GET:/reservas", h: "api/feat-agenda", v: "implementa", ev: "repo-api:src/reservas.controller.ts#L5" },
    { s: "api/svc-api:POST:/reservas", h: "api/feat-agenda", v: "implementa", ev: "repo-api:src/reservas.controller.ts#L9" },
    { s: "api/svc-api:DELETE:/reservas", h: "api/feat-agenda", v: "implementa", ev: "repo-api:src/reservas.controller.ts#L14" },
    // Lo mismo que dicen los pasos, a nivel de pieza: no se duplica.
    { s: "api/svc-api:GET:/reservas", h: "api/tabla-reservas", v: "lee_de", ev: "repo-api:src/reservas.repo.ts#L4" },
    // Lo que el recorrido no alcanzó (se cortó): se completa desde el grafo.
    { s: "api/svc-api:POST:/reservas", h: "api/tabla-auditoria", v: "escribe_en", ev: "repo-api:src/auditoria.ts#L2" },
    { s: "web/svc-web:pantalla:/reservas", h: "api/svc-api", v: "llama_a", p: "api/svc-api:GET:/reservas", ev: "repo-web:src/useReservas.ts#L6" },
  ],
  fichas: [
    {
      id: "api/feat-agenda",
      recorridos: [
        {
          endpoint: "api/svc-api:GET:/reservas",
          pasos: [
            paso("ReservasController.listar", "repo-api:src/reservas.controller.ts#L5", 0),
            paso("ReservasService.listar", "repo-api:src/reservas.service.ts#L3", 1),
            paso("ReservasRepo.buscar", "repo-api:src/reservas.repo.ts#L4", 2, [{ verbo: "lee_de", hasta: "api/tabla-reservas", endpoint: null }]),
            paso("ReservasService.avisar", "repo-api:src/reservas.service.ts#L12", 1, [{ verbo: "publica_en", hasta: "api/queue-avisos", endpoint: null }]),
          ],
        },
        {
          endpoint: "api/svc-api:POST:/reservas",
          truncado: true,
          pasos: [
            paso("ReservasController.crear", "repo-api:src/reservas.controller.ts#L9", 0),
            paso("ReservasRepo.buscar", "repo-api:src/reservas.repo.ts#L4", 1, [{ verbo: "lee_de", hasta: "api/tabla-reservas", endpoint: null }], { repite: "antes" }),
            paso("ReservasRepo.legado", "repo-api:src/reservas.repo.ts#L20", 1, [{ verbo: "escribe_en", hasta: "reservas_viejas", endpoint: null, sinPagina: true }], { aviso: "acceso a tabla sin resolver" }),
          ],
        },
        { endpoint: "api/svc-api:DELETE:/reservas", pasos: [] },
      ],
    },
  ],
  cruzado: {
    pantallas: {
      "web/svc-web:pantalla:/reservas": {
        pasos: [
          paso("Reservas", "repo-web:src/Reservas.tsx#L2", 0, [], { capa: "interfaz" }),
          paso("useReservas", "repo-web:src/useReservas.ts#L1", 1, [{ verbo: "llama_a", hasta: "api/svc-api", endpoint: "api/svc-api:GET:/reservas" }]),
        ],
      },
    },
    backs: {},
  },
  huecos: [{ pref: "web/", ev: "repo-web:src/useReservas.ts#L8", texto: "GET ${base}/extra" }],
});

const ids = (t: ReturnType<typeof trazabilidad>) => t!.nodos.map((n) => n.id);

describe("trazabilidad de un nodo", () => {
  it("desde una pantalla: sube a su funcionalidad y baja por el hook y el HTTP hasta la tabla del otro cerebro, sin vecinos laterales", () => {
    const t = trazabilidad(redDeFlujo(entrada()), "web/svc-web:pantalla:/reservas")!;
    expect(ids(t)).toEqual([
      "web/feat-reservas",
      "web/svc-web:pantalla:/reservas",
      "m:web/repo-web:src/Reservas.tsx#Reservas",
      "m:web/repo-web:src/useReservas.ts#useReservas",
      "api/svc-api:GET:/reservas",
      "web/svc-web",
      "m:api/repo-api:src/reservas.controller.ts#ReservasController.listar",
      "m:api/repo-api:src/reservas.service.ts#ReservasService.avisar",
      "m:api/repo-api:src/reservas.service.ts#ReservasService.listar",
      "m:api/repo-api:src/reservas.repo.ts#ReservasRepo.buscar",
      "api/queue-avisos",
      "api/tabla-reservas",
    ]);
    // Ni la otra pantalla de la funcionalidad, ni el componente que dibuja, ni el POST que comparte el repositorio.
    expect(ids(t)).not.toContain("web/svc-web:pantalla:/perfil");
    expect(ids(t)).not.toContain("api/svc-api:POST:/reservas");
    const salto = t.aristas.filter((a) => a.cruza);
    expect(salto).toEqual([{ desde: "m:web/repo-web:src/useReservas.ts#useReservas", hasta: "api/svc-api:GET:/reservas", verbo: "llama_a", ev: "repo-web:src/useReservas.ts#L1", via: null, cruza: true }]);
    // La arista directa pantalla → endpoint no se suma: los pasos ya llegan a ese endpoint.
    expect(t.aristas.some((a) => a.desde === "web/svc-web:pantalla:/reservas" && a.hasta === "api/svc-api:GET:/reservas")).toBe(false);
    expect(t.huecos).toEqual([{ en: "m:web/repo-web:src/useReservas.ts#useReservas", texto: "sin_resolver:GET ${base}/extra", ev: "repo-web:src/useReservas.ts#L8" }]);
    expect(t.truncado).toBeNull();
    expect(t.nodos.find((n) => n.id === "web/feat-reservas")!.lado).toBe("arriba");
    expect(t.nodos.find((n) => n.id === "api/tabla-reservas")!.lado).toBe("abajo");
  });

  it("desde una tabla: sube solo por los métodos que la tocan, hasta las pantallas y funcionalidades de los dos cerebros", () => {
    const t = trazabilidad(redDeFlujo(entrada()), "api/tabla-reservas")!;
    expect(ids(t)).toEqual(expect.arrayContaining(["web/feat-reservas", "web/svc-web:pantalla:/reservas", "api/feat-agenda", "api/svc-api:GET:/reservas", "api/svc-api:POST:/reservas", "m:api/repo-api:src/reservas.repo.ts#ReservasRepo.buscar"]));
    // El método que avisa por la cola no toca la tabla: no está en la cadena.
    expect(ids(t)).not.toContain("m:api/repo-api:src/reservas.service.ts#ReservasService.avisar");
    expect(ids(t)).not.toContain("api/queue-avisos");
    expect(ids(t)).not.toContain("api/tabla-auditoria");
    expect(t.nodos.every((n) => n.lado !== "abajo")).toBe(true);
  });

  it("desde un endpoint sin método conocido o con el recorrido cortado: los huecos se dicen, no se callan", () => {
    const red = redDeFlujo(entrada());
    expect(trazabilidad(red, "api/svc-api:DELETE:/reservas")!.huecos).toEqual([{ en: "api/svc-api:DELETE:/reservas", texto: "sin_metodo", ev: null }]);
    const post = trazabilidad(red, "api/svc-api:POST:/reservas")!;
    expect(post.huecos.map((h) => h.texto).sort()).toEqual(["acceso a tabla sin resolver", "sin_pagina", "truncado"]);
    // La tabla sin página entra como tabla propia y la auditoría, que el recorrido no alcanzó, se completa desde el grafo.
    expect(ids(post)).toEqual(expect.arrayContaining(["t:api/reservas_viejas", "api/tabla-auditoria", "api/tabla-reservas"]));
  });

  it("desde un archivo o un componente: arranca por los pasos que viven en él", () => {
    const red = redDeFlujo(entrada());
    const archivo = trazabilidad(red, "api/repo-api:src/reservas.service.ts")!;
    expect(archivo.nodos.filter((n) => n.lado === "origen").map((n) => n.id)).toEqual(["api/repo-api:src/reservas.service.ts", "m:api/repo-api:src/reservas.service.ts#ReservasService.avisar", "m:api/repo-api:src/reservas.service.ts#ReservasService.listar"]);
    expect(ids(archivo)).toEqual(expect.arrayContaining(["api/queue-avisos", "api/tabla-reservas", "web/svc-web:pantalla:/reservas"]));
    // Un componente sube a las pantallas que lo dibujan y a sus funcionalidades.
    const boton = trazabilidad(red, "web/svc-web:componente:Boton")!;
    expect(ids(boton).sort()).toEqual(["web/feat-reservas", "web/svc-web:componente:Boton", "web/svc-web:pantalla:/perfil", "web/svc-web:pantalla:/reservas", "web/svc-web"].sort());
  });

  it("con un tope: se queda con lo más cercano y dice cuánto quedó afuera, por tipo", () => {
    const t = trazabilidad(redDeFlujo(entrada()), "web/svc-web:pantalla:/reservas", 4)!;
    expect(t.nodos).toHaveLength(4);
    expect(t.truncado).toEqual({ total: 12, mostrados: 4, fuera: { endpoint: 1, metodo: 5, queue: 1, tabla: 1 } });
    expect(t.aristas.every((a) => ids(t).includes(a.desde) && ids(t).includes(a.hasta))).toBe(true);
  });

  it("un servicio alcanzado no se expande; como origen, baja a lo que contiene", () => {
    const red = redDeFlujo(entrada());
    expect(trazabilidad(red, "nada")).toBeNull();
    const svc = trazabilidad(red, "web/svc-web")!;
    expect(ids(svc)).toContain("api/tabla-reservas");
    expect(ids(svc)).not.toContain("web/svc-web:pantalla:/perfil");
  });

  it("un brain solo, desde el grafo y las fichas", () => {
    const n = (id: string, tipo: GraphNode["tipo"]): GraphNode => ({ actualizado: null, aliases: [], atributos: {}, estado: "vigente", id, nombre: id, origen: "parser", pagina: null, resumen: null, tecnologia: [], tipo, verificado: null });
    const e = (desde: string, verbo: string, hasta: string, evidencia = "repo-a:x.ts#L1") => ({ desde, verbo, hasta, evidencia, confianza: 0.9, origen: "parser", estado: "vigente", endpoint: null, dato: null }) as unknown as Graph["edges"][number];
    const g: Graph = { version: 1, nodes: [n("feat-a", "feat"), n("svc-a", "svc"), n("svc-a:GET:/x", "endpoint"), n("tabla-x", "tabla")], edges: [e("svc-a:GET:/x", "implementa", "feat-a"), e("svc-a:GET:/x", "lee_de", "tabla-x", "repo-a:x.ts#L7")] };
    const t = trazabilidad(redDelGrafo(g), "tabla-x")!;
    expect(ids(t)).toEqual(["feat-a", "svc-a:GET:/x", "svc-a", "tabla-x"]);
    expect(t.aristas.find((a) => a.hasta === "tabla-x")!.ev).toBe("repo-a:x.ts#L7");
    expect(t.aristas.every((a) => !a.cruza)).toBe(true);
    // La herramienta del MCP: por nombre, con la capa de cada paso y su evidencia.
    const ctx = crearContexto(g, [], new Map());
    const r = trazabilidadDe(ctx, { nodo: "tabla-x" });
    expect(r.cadena.map((c) => `${c.capa} ${c.id} ${c.lado}`)).toEqual(["feature feat-a arriba", "endpoint svc-a:GET:/x arriba", "service/method svc-a arriba", "table tabla-x origen"]);
    expect(r.aristas).toContainEqual({ desde: "svc-a:GET:/x", verbo: "lee_de", hasta: "tabla-x", ev: "repo-a:x.ts#L7" });
    expect(() => trazabilidadDe(ctx, { nodo: "nada" })).toThrow(ConsultaError);
  });
});

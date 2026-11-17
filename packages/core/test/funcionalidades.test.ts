import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { AVISO_SIN_TABLA, capaDe, crearRecorredor, compile, podar, soloCamino, CompileError, contextoDeSalidas, dentroDe, dependenciasDelGrafo, impacto, impactoDe, leerEntradas, raizDeServicio, type Contrato, type Entradas } from "../src/index.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");

let base: Entradas;
beforeAll(async () => {
  base = await leerEntradas(FIXTURE);
});

/** feat-checkout con `codigo` en el BFF, una feat-carrito en la web y una extracción que conecta ambas. */
function conFuncionalidades(codigoCheckout = "repo-tienda:apps/bff/src/routes"): Entradas {
  const paginas = base.paginas.map((p) =>
    p.ruta === "producto/feat-checkout.md" ? { ...p, contenido: p.contenido.replace("verificado: 2026-11-15\n", `verificado: 2026-11-15\ncodigo:\n  - ${codigoCheckout}\n`) } : p,
  );
  paginas.push({
    ruta: "producto/feat-carrito.md",
    contenido: "---\nid: feat-carrito\ntipo: feat\nnombre: Carrito\nresumen: El cliente arma el pedido.\ncodigo: [\"repo-tienda:apps/web/src\"]\n---\n# Carrito\n\nArma el pedido.\n",
  });
  const extraccion = {
    aristas: [
      { dato: null, desde: "svc-web", endpoint: "svc-bff:POST:/checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L8", hasta: "svc-bff", origen: "parser", verbo: "llama_a" },
      { dato: null, desde: "svc-web", endpoint: "svc-bff:POST:/checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L20", hasta: "svc-bff", origen: "parser", verbo: "llama_a" },
      { dato: "Pago", desde: "svc-bff", endpoint: null, evidencia: "repo-tienda:apps/bff/src/routes/checkout.ts#L30", hasta: "tabla-pagos", origen: "parser", verbo: "escribe_en" },
      { dato: "Pago", desde: "svc-payments", endpoint: null, evidencia: "repo-tienda:apps/payments/src/x.ts#L3", hasta: "tabla-pagos", origen: "parser", verbo: "lee_de" },
    ],
    pendientes: [],
    repo: "repo-tienda",
    servicios: [],
  };
  return { ...base, paginas, extracciones: [{ ruta: "_build/extraccion/repo-tienda.json", contenido: JSON.stringify(extraccion) }] };
}

describe("funcionalidades", () => {
  it("dentroDe compara por carpeta completa, no por prefijo de texto", () => {
    expect(dentroDe("repo-a:src/features/pay/x.ts#L3", "repo-a:src/features/pay")).toBe(true);
    expect(dentroDe("repo-a:src/features/payments/x.ts", "repo-a:src/features/pay")).toBe(false);
    expect(dentroDe("repo-b:src/features/pay/x.ts", "repo-a:src/features/pay")).toBe(false);
  });

  it("la raíz de un servicio es la carpeta común de sus puntos de entrada", () => {
    expect(raizDeServicio({ a: "apps/bff/src/main.ts", b: "apps/bff/src/routes/" })).toBe("apps/bff/src");
    expect(raizDeServicio({ raiz: "." })).toBe("");
    expect(raizDeServicio(undefined)).toBeNull();
  });

  it("codigo genera implementa solo desde el servicio del monorepo que contiene la ruta", () => {
    const { graph } = compile(conFuncionalidades());
    // Las tres `implementa` hacia checkout están escritas a mano (curado gana); la del BFF toma la evidencia del codigo.
    const impl = graph.edges.filter((e) => e.verbo === "implementa").map((e) => `${e.desde}→${e.hasta} ${e.origen} ${e.evidencia}`);
    expect(impl).toEqual([
      "svc-bff→feat-checkout curado repo-tienda:apps/bff/src/routes",
      "svc-bff:POST:/checkout→feat-checkout parser repo-tienda:apps/bff/src/routes/checkout.ts#L14",
      "svc-payments→feat-checkout curado null",
      "svc-web→feat-carrito parser repo-tienda:apps/web/src",
      "svc-web→feat-checkout curado null",
    ]);
  });

  it("la ficha deriva qué expone, qué usa, qué datos toca y con qué se relaciona", () => {
    const { funcionalidades, generados } = compile(conFuncionalidades());
    const carrito = funcionalidades.find((f) => f.id === "feat-carrito")!;
    const checkout = funcionalidades.find((f) => f.id === "feat-checkout")!;
    expect(carrito.usa).toEqual([{ endpoint: "svc-bff:POST:/checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L20", hasta: "svc-bff", veces: 2 }]);
    expect(carrito.usaFuncionalidades).toEqual(["feat-checkout"]);
    expect(checkout.usadaPor).toEqual(["feat-carrito"]);
    expect(checkout.expone).toEqual(["svc-bff:POST:/checkout"]);
    expect(checkout.datos).toEqual([{ escribe: 1, evidencia: "repo-tienda:apps/bff/src/routes/checkout.ts#L30", lee: 0, tabla: "tabla-pagos" }]);
    expect(checkout.cuerpo).not.toContain("brain:backlinks");
    expect(generados["_build/funcionalidades.json"]).toContain('"feat-carrito"');
  });

  it("codigo con formato inválido o en una página que no es feat falla", () => {
    expect(() => compile(conFuncionalidades("repo-tienda:apps/bff#L3"))).toThrow(CompileError);
    expect(() => compile(conFuncionalidades("repo-noexiste:src"))).toThrow(/repo inexistente/);
    const mal = { ...base, paginas: base.paginas.map((p) => (p.ruta === "tecnologia/svc-bff.md" ? { ...p, contenido: p.contenido.replace("vive_en:", "codigo: [\"repo-tienda:apps\"]\nvive_en:") } : p)) };
    expect(() => compile(mal)).toThrow(/codigo solo aplica a feat/);
  });

  it("el modelo de dependencias une el grafo técnico con lo que derivan las fichas", () => {
    const { graph, funcionalidades } = compile(conFuncionalidades());
    const deps = dependenciasDelGrafo(graph, funcionalidades);
    expect(deps).toContainEqual(["feat-carrito", "feat-checkout", "usa", 1]);
    expect(deps).toContainEqual(["feat-carrito", "svc-bff:POST:/checkout", "llama_a", 2]);
    expect(deps).toContainEqual(["feat-checkout", "tabla-pagos", "escribe_en", 1]);
    expect(deps).toContainEqual(["svc-web", "svc-bff:POST:/checkout", "llama_a", 1]);
    expect(deps).toContainEqual(["feat-checkout", "svc-bff", "implementa", 1]);
    expect(deps).toContainEqual(["tabla-pagos", "db-tienda", "vive_en", 1]);
    expect(deps.map((d) => d.slice(0, 3).join(" "))).toEqual([...deps.map((d) => d.slice(0, 3).join(" "))].sort());
  });

  it("impacto recorre hacia atrás por niveles y dice por qué", () => {
    const { graph, funcionalidades } = compile(conFuncionalidades());
    const deps = dependenciasDelGrafo(graph, funcionalidades);
    const niveles = (id: string) => impacto(deps, id).map((nv) => nv.map((x) => `${x.id}<${x.verbo}<${x.via}`));
    expect(niveles("tabla-pagos")).toEqual([
      // La extracción de este test dice que el BFF también escribe en la tabla: entra al grafo aunque su página no lo declare.
      ["feat-checkout<escribe_en<tabla-pagos", "svc-bff<escribe_en<tabla-pagos", "svc-payments<escribe_en<tabla-pagos"],
      ["ext-pasarela<llama_a<svc-payments", "feat-carrito<usa<feat-checkout", "svc-web<llama_a<svc-bff"],
    ]);
    // implementa solo se sigue desde el origen: llegar a svc-web por propagación no arrastra a sus funcionalidades.
    expect(niveles("svc-bff")).toEqual([["feat-checkout<implementa<svc-bff", "svc-web<llama_a<svc-bff"], ["feat-carrito<usa<feat-checkout"]]);
    expect(niveles("feat-carrito")).toEqual([]);
    expect(niveles("no-existe")).toEqual([]);
  });

  it("capaDe clasifica por sufijo y, si no, por la carpeta más profunda", () => {
    expect(capaDe("modules/billing/infrastructure/http/payment.controller.ts")).toBe("entrada");
    expect(capaDe("modules/billing/payment/application/payment.service.ts")).toBe("logica");
    expect(capaDe("modules/billing/payment/domain/payment.ts")).toBe("dominio");
    expect(capaDe("modules/billing/payment/infrastructure/persistence/payment.repository.ts")).toBe("datos");
    expect(capaDe("app/Http/Controllers/EnvioController.php")).toBe("entrada");
    expect(capaDe("app/Models/Envio.php")).toBe("dominio");
    expect(capaDe("src/features/payments/ui/Planes.tsx")).toBe("interfaz");
    expect(capaDe("src/features/payments/hooks/usePlanes.ts")).toBe("logica");
    expect(capaDe("shared/infrastructure/external/http/outbound-http.ts")).toBe("datos");
    expect(capaDe("src/main.ts")).toBe("otros");
  });

  it("la ficha muestra cómo está construida: recorrido de cada endpoint con lo que toca, y dominio", () => {
    const e = conFuncionalidades("repo-tienda:apps/bff/src");
    const extra = { aristas: [{ dato: null, desde: "svc-bff", endpoint: "svc-payments:POST:/payments", evidencia: "repo-tienda:apps/bff/src/clients/payments.ts#L11", hasta: "svc-payments", origen: "parser", verbo: "llama_a" }], pendientes: [], repo: "repo-tienda", servicios: [] };
    const { funcionalidades } = compile({ ...e, extracciones: [...e.extracciones!, { ruta: "_build/extraccion/zz.json", contenido: JSON.stringify(extra) }] });
    const f = funcionalidades.find((x) => x.id === "feat-checkout")!;
    expect(f.recorridos).toEqual([
      {
        endpoint: "svc-bff:POST:/checkout",
        pasos: [
          { simbolo: "postCheckout", evidencia: "repo-tienda:apps/bff/src/routes/checkout.ts#L14", capa: "entrada", nivel: 0, desde: null, toca: [] },
          {
            simbolo: "crearPago",
            evidencia: "repo-tienda:apps/bff/src/clients/payments.ts#L10",
            capa: "datos",
            nivel: 1,
            desde: "postCheckout",
            toca: [{ verbo: "llama_a", hasta: "svc-payments", endpoint: "svc-payments:POST:/payments" }],
          },
        ],
      },
    ]);
    expect(f.dominio).toEqual([]);
  });

  it("el recorrido omite funciones sueltas que no tocan nada ni llevan a algo que toca, y cuelga sus hijos del paso visible más cercano", () => {
    const p = (simbolo: string, nivel: number, toca: number = 0) => ({ simbolo, evidencia: "repo-a:x.ts#L1", capa: "logica" as const, nivel, desde: null, toca: Array.from({ length: toca }, () => ({ verbo: "lee_de", hasta: "tabla-x", endpoint: null })) });
    const r = podar([p("Ctrl.get", 0), p("ayuda", 1), p("Svc.armar", 2), p("formatear", 3), p("formatear", 1), p("leerCrudo", 1, 1)]);
    expect(r.map((x) => `${x.nivel} ${x.simbolo} <${x.desde}`)).toEqual(["0 Ctrl.get <null", "1 Svc.armar <Ctrl.get", "1 leerCrudo <Ctrl.get"]);
    // En el camino hacia algo que toca (un hook entre la pantalla y la API), la función suelta se ve.
    const front = podar([p("Pantalla", 0), p("useGuardar", 1), p("api.guardar", 2, 1), p("formatear", 1)]);
    expect(front.map((x) => `${x.nivel} ${x.simbolo} <${x.desde}`)).toEqual(["0 Pantalla <null", "1 useGuardar <Pantalla", "2 api.guardar <useGuardar"]);
  });
  it("el recorrido de una pantalla deja solo la raíz y el camino hasta lo que toca datos o servicios", () => {
    const p = (simbolo: string, nivel: number, toca: number = 0) => ({ simbolo, evidencia: "repo-a:x.ts#L1", capa: "interfaz" as const, nivel, desde: null, toca: Array.from({ length: toca }, () => ({ verbo: "llama_a", hasta: "svc-b", endpoint: "svc-b:GET:/x" })) });
    const r = soloCamino([p("Pantalla", 0), p("analytics.track", 1), p("Provider.track", 2), p("useDatos", 1), p("api.get", 2, 1), p("Boton.render", 1)]);
    expect(r.map((x) => `${x.nivel} ${x.simbolo}`)).toEqual(["0 Pantalla", "1 useDatos", "2 api.get"]);
  });
  it("un método repetido en el recorrido hereda lo que tocó la primera vez y no se marca como hueco", () => {
    const graph = { nodes: [], edges: [] } as unknown as Parameters<typeof crearRecorredor>[0];
    const est = new Map([
      ["r:svc.ts", { simbolos: [{ nombre: "Svc.a", tipo: "metodo", linea: 1, fin: 5 }, { nombre: "Svc.rec", tipo: "metodo", linea: 6, fin: 8 }, { nombre: "Svc.otro", tipo: "metodo", linea: 9, fin: 10 }], importa: [], invoca: [
        { desde: "Svc.a", archivo: "pago.repository.ts", simbolo: "Repo.find", linea: 2 },
        { desde: "Svc.a", archivo: "pago.repository.ts", simbolo: "Repo.find", linea: 3 },
        { desde: "Svc.a", archivo: "svc.ts", simbolo: "Svc.otro", linea: 3 },
        { desde: "Svc.otro", archivo: "pago.repository.ts", simbolo: "Repo.find", linea: 9 },
        { desde: "Svc.a", archivo: "pago.repository.ts", simbolo: "Repo.vacio", linea: 4 },
        { desde: "Svc.a", archivo: "svc.ts", simbolo: "Svc.rec", linea: 4 },
        { desde: "Svc.rec", archivo: "svc.ts", simbolo: "Svc.rec", linea: 7 },
      ] }],
      ["r:pago.repository.ts", { simbolos: [{ nombre: "Repo.find", tipo: "metodo", linea: 1, fin: 3 }, { nombre: "Repo.vacio", tipo: "metodo", linea: 4, fin: 5 }], importa: [], invoca: [{ desde: "Repo.find", archivo: "pago.repository.ts", simbolo: "Repo.find", linea: 2 }] }],
    ]);
    const aristas = [{ dato: null, desde: "svc-x", endpoint: null, evidencia: "r:pago.repository.ts#L2", hasta: "tabla-x", origen: "parser", verbo: "lee_de" }];
    const { pasos } = crearRecorredor(graph, est, aristas).desdeSimbolo("r:svc.ts", "Svc.a");
    expect(pasos.map((p) => [p.nivel, p.simbolo, p.toca.map((t) => t.hasta).join(","), p.repite ?? "", p.aviso ?? ""])).toEqual([
      [0, "Svc.a", "", "", ""],
      [1, "Repo.find", "tabla-x", "", ""],
      [2, "Repo.find", "", "ciclo", ""],
      [1, "Svc.otro", "", "", ""],
      [2, "Repo.find", "tabla-x", "antes", ""],
      [1, "Repo.vacio", "", "", AVISO_SIN_TABLA],
      [1, "Svc.rec", "", "", ""],
      [2, "Svc.rec", "", "ciclo", ""],
    ]);
  });
  it("un paso al que se llega por evento o cola lleva la clave en via", () => {
    const graph = { nodes: [], edges: [] } as unknown as Parameters<typeof crearRecorredor>[0];
    const est = new Map([
      ["r:a.ts", { simbolos: [{ nombre: "A.pedir", tipo: "metodo", linea: 1, fin: 3 }, { nombre: "A.mandar", tipo: "metodo", linea: 4, fin: 6 }], importa: [], invoca: [{ desde: "A.pedir", archivo: "a.ts", simbolo: "A.mandar", linea: 2, via: "AVISO_JOB" }] }],
    ]);
    const { pasos } = crearRecorredor(graph, est, []).desdeSimbolo("r:a.ts", "A.pedir");
    expect(pasos.map((p) => `${p.nivel} ${p.simbolo} ${p.via ?? ""}`)).toEqual(["0 A.pedir ", "1 A.mandar AVISO_JOB"]);
  });
});

describe("código compartido, decisiones y equipos", () => {
  const pagina = (ruta: string, lineas: string[]) => ({ ruta, contenido: ["---", ...lineas, "---", "# x", ""].join("\n") });
  const conLib = (): Entradas => {
    const e = conFuncionalidades();
    const paginas = e.paginas.map((p) =>
      p.ruta === "tecnologia/tabla-pagos.md" ? { ...p, contenido: p.contenido.replace("\n---\n", "\npertenece_a: [team-cobros]\nrelaciones:\n  - { verbo: decidido_por, destino: decision-pagos-idempotentes }\n---\n") } : p,
    );
    paginas.push(
      pagina("tecnologia/lib-clientes.md", ["id: lib-clientes", "tipo: lib", "nombre: Clientes HTTP", "resumen: Clientes de otros servicios.", 'codigo: ["repo-tienda:apps/bff/src/clients"]']),
      pagina("producto/team-cobros.md", ["id: team-cobros", "tipo: team", "nombre: Cobros", "resumen: Equipo de cobros."]),
      pagina("producto/decision-pagos-idempotentes.md", ["id: decision-pagos-idempotentes", "tipo: decision", "nombre: Pagos idempotentes", "resumen: Cada pago lleva una clave de idempotencia."]),
    );
    return { ...e, paginas };
  };

  it("una funcionalidad depende de la librería cuyo código importa; el impacto de la librería llega a la funcionalidad", () => {
    const { graph, funcionalidades } = compile(conLib());
    expect(graph.edges.filter((x) => x.hasta === "lib-clientes").map((x) => `${x.desde} ${x.verbo} · ${x.evidencia}`)).toEqual(["feat-checkout depende_de · repo-tienda:apps/bff/src/routes/checkout.ts"]);
    expect((graph.nodes.find((n) => n.id === "lib-clientes")!.atributos as { codigo: string[] }).codigo).toEqual(["repo-tienda:apps/bff/src/clients"]);
    const niveles = impacto(dependenciasDelGrafo(graph, funcionalidades), "lib-clientes");
    expect(niveles[0]!.map((x) => `${x.id}<${x.verbo}`)).toEqual(["feat-checkout<depende_de"]);
  });

  it("impacto trae las decisiones que explican la pieza y los equipos dueños", () => {
    const e = conLib();
    const ctx = contextoDeSalidas(compile(e), e.contratos.map((c) => JSON.parse(c.contenido) as Contrato), { archivos: e.archivos.map((a) => a.contenido), extracciones: (e.extracciones ?? []).map((x) => x.contenido) });
    const r = impactoDe(ctx, { pieza: "tabla-pagos" }) as { decisiones: unknown; equipos: unknown };
    expect(r.decisiones).toEqual([{ id: "decision-pagos-idempotentes", nombre: "Pagos idempotentes", resumen: "Cada pago lleva una clave de idempotencia." }]);
    expect(r.equipos).toEqual([{ equipo: "team-cobros", nombre: "Cobros", por: ["tabla-pagos"] }]);
    // Sin nada curado, los campos no aparecen.
    expect(impactoDe(ctx, { pieza: "svc-bff" })).not.toHaveProperty("decisiones");
  });

  it("codigo en una página que no es feat ni lib falla", () => {
    const e = conLib();
    const paginas = e.paginas.map((p) => (p.ruta === "producto/team-cobros.md" ? { ...p, contenido: p.contenido.replace("resumen: Equipo de cobros.", 'resumen: Equipo de cobros.\ncodigo: ["repo-tienda:apps"]') } : p));
    expect(() => compile({ ...e, paginas })).toThrow(CompileError);
  });
});

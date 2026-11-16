import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { capaDe, compile, podar, CompileError, dentroDe, dependenciasDelGrafo, impacto, leerEntradas, raizDeServicio, renderViewer, type Entradas } from "../src/index.js";

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
    expect(renderViewer(compile(conFuncionalidades()).graph, "/* lib */", funcionalidades)).toContain('"usaFuncionalidades"');
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
      ["feat-checkout<escribe_en<tabla-pagos", "svc-payments<escribe_en<tabla-pagos"],
      ["ext-pasarela<llama_a<svc-payments", "feat-carrito<usa<feat-checkout", "svc-bff<llama_a<svc-payments"],
      ["svc-web<llama_a<svc-bff"],
    ]);
    // implementa solo se sigue desde el origen: llegar a svc-web por propagación no arrastra a sus funcionalidades.
    expect(niveles("svc-bff")).toEqual([["feat-checkout<implementa<svc-bff", "svc-web<llama_a<svc-bff"], ["feat-carrito<usa<feat-checkout"]]);
    expect(niveles("feat-carrito")).toEqual([]);
    expect(niveles("no-existe")).toEqual([]);
  });

  it("el visor embebe las dependencias y las vistas de mapa e impacto", () => {
    const { graph, funcionalidades } = compile(conFuncionalidades());
    const html = renderViewer(graph, "/* lib */", funcionalidades);
    expect(html).toContain('"dependencias":[[');
    expect(html).toContain('href="#/impacto"');
    expect(html).toContain('href="#/grafo"');
    expect(html).toContain("function impacto(deps, origen)");
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

  it("la ficha muestra cómo está construida: capas, recorrido de cada endpoint con lo que toca, y dominio", () => {
    const e = conFuncionalidades("repo-tienda:apps/bff/src");
    const extra = { aristas: [{ dato: null, desde: "svc-bff", endpoint: "svc-payments:POST:/payments", evidencia: "repo-tienda:apps/bff/src/clients/payments.ts#L11", hasta: "svc-payments", origen: "parser", verbo: "llama_a" }], pendientes: [], repo: "repo-tienda", servicios: [] };
    const { funcionalidades } = compile({ ...e, extracciones: [...e.extracciones!, { ruta: "_build/extraccion/zz.json", contenido: JSON.stringify(extra) }] });
    const f = funcionalidades.find((x) => x.id === "feat-checkout")!;
    expect(f.capas.map((c) => `${c.capa}: ${c.archivos.map((a) => a.archivo.split("/").pop()).join(", ")}`)).toEqual(["entrada: checkout.ts", "datos: payments.ts", "otros: main.ts"]);
    expect(f.capas[0]!.archivos[0]!.elementos).toEqual(["CheckoutRequest", "CheckoutResponse", "postCheckout"]);
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

  it("el recorrido omite funciones sueltas que no tocan nada y cuelga sus hijos del paso visible más cercano", () => {
    const p = (simbolo: string, nivel: number, toca: number = 0) => ({ simbolo, evidencia: "repo-a:x.ts#L1", capa: "logica" as const, nivel, desde: null, toca: Array.from({ length: toca }, () => ({ verbo: "lee_de", hasta: "tabla-x", endpoint: null })) });
    const r = podar([p("Ctrl.get", 0), p("ayuda", 1), p("Svc.leer", 2), p("Repo.find", 3, 1), p("formatear", 1), p("leerCrudo", 1, 1)]);
    expect(r.map((x) => `${x.nivel} ${x.simbolo} <${x.desde}`)).toEqual(["0 Ctrl.get <null", "1 Svc.leer <Ctrl.get", "2 Repo.find <Svc.leer", "1 leerCrudo <Ctrl.get"]);
  });
});

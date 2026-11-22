import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { actualizarHeads, archivosDeDiff, simbolosTocados, buscarNodo, crearContexto, deriva, paridad, paridadEntre, riesgo, type Graph, type GraphEdge, type GraphNode, commitDe, compile, recorrerGrafo, ConsultaError, evaluar, leerPreguntas, contextoDeSalidas, funcionalidad, impactoDe, leerEntradas, pantalla, quienLlama, recorrido, tokens, cobertura, leerControles, type Contexto, type Contrato } from "../src/index.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/checkout");

let ctx: Contexto;
let sinIndice: Contexto;
let archivosCheckout: string[], extraccionCheckout: string, salidasCheckout: ReturnType<typeof compile>, contratosCheckout: Contrato[];
beforeAll(async () => {
  const base = await leerEntradas(FIXTURE);
  const paginas = base.paginas.map((p) =>
    p.ruta === "product/feat-checkout.md" ? { ...p, contenido: p.contenido.replace("verificado: 2026-11-15\n", "verificado: 2026-11-15\ncodigo:\n  - repo-tienda:apps/bff/src\n") } : p,
  );
  paginas.push({ ruta: "product/feat-carrito.md", contenido: "---\nid: feat-carrito\ntipo: feat\nnombre: Carrito\nresumen: Arma el pedido.\ncodigo: [\"repo-tienda:apps/web/src\"]\n---\n# Carrito\n" });
  const extraccion = JSON.stringify({
    aristas: [
      { dato: null, desde: "svc-web", endpoint: "svc-bff:POST:/checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L8", hasta: "svc-bff", origen: "parser", verbo: "llama_a" },
      { dato: null, desde: "svc-bff", endpoint: "svc-payments:POST:/payments", evidencia: "repo-tienda:apps/bff/src/clients/payments.ts#L11", hasta: "svc-payments", origen: "parser", verbo: "llama_a" },
      { dato: "Pago", desde: "svc-bff", endpoint: null, evidencia: "repo-tienda:apps/bff/src/routes/checkout.ts#L16", hasta: "tabla-pagos", origen: "parser", verbo: "escribe_en" },
    ],
    pendientes: [
      { candidatos: [], desde: "svc-web", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L30", motivo: "base dinámica y ningún endpoint conocido coincide con GET /checkout", objetivo: null, referencia: "GET ${base}/checkout", verbo: "llama_a" },
      { candidatos: [], desde: "svc-web", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L40", motivo: "URL sin ruta reconocible", objetivo: null, referencia: "GET ${url}", verbo: "llama_a" },
    ],
    repo: "repo-tienda",
    servicios: [],
  });
  // Una pantalla del front (`/checkout`, dibujada por `main`) que llama a `confirmarCheckout`.
  const archivos = base.archivos.map((a) => {
    const j = JSON.parse(a.contenido) as { archivos: Array<{ ruta: string; invoca?: unknown[] }>; pantallas?: unknown[] };
    const main = j.archivos.find((x) => x.ruta === "apps/web/src/main.tsx");
    if (!main) return a;
    main.invoca = [{ desde: "main", archivo: "apps/web/src/api/checkout.ts", simbolo: "confirmarCheckout", linea: 2 }];
    j.pantallas = [{ paquete: "apps/web", ruta: "/checkout", archivo: "apps/web/src/main.tsx", linea: 1, componente: { archivo: "apps/web/src/main.tsx", simbolo: "main" }, envuelta: [] }];
    return { ...a, contenido: JSON.stringify(j) };
  });
  const entradas = { ...base, paginas, archivos, extracciones: [{ ruta: "_build/extraction/repo-tienda.json", contenido: extraccion }] };
  const contratos = base.contratos.map((c) => JSON.parse(c.contenido) as Contrato);
  const salidas = compile(entradas);
  ctx = contextoDeSalidas(salidas, contratos, { archivos: archivos.map((a) => a.contenido), extracciones: [extraccion] });
  [archivosCheckout, extraccionCheckout, salidasCheckout, contratosCheckout] = [archivos.map((a) => a.contenido), extraccion, salidas, contratos];
  sinIndice = contextoDeSalidas(salidas, contratos);
});

const RIESGO_CLIENTE = {
  avisos: [],
  cambia: ["crearPago @ repo-tienda:apps/bff/src/clients/payments.ts#L10"],
  endpoints: ["svc-bff:POST:/checkout"],
  funcionalidades: ["feat-carrito", "feat-checkout"],
  indice: {},
  llamadores: ["postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L14"],
  motivos: ["alcanza 1 endpoint", "alcanza 1 pantalla", "alcanza 2 funcionalidades"],
  nivel: "medio",
  otrosRepos: [],
  pantallas: ["svc-web:pantalla:/checkout"],
  tablas: [],
  usos: [],
};

const SIMBOLOS_CHECKOUT = [
  "CheckoutRequest repo-tienda:apps/bff/src/routes/checkout.ts#L4 prefijo",
  "CheckoutRequest repo-tienda:apps/web/src/api/checkout.ts#L1 prefijo",
  "CheckoutResponse repo-tienda:apps/bff/src/routes/checkout.ts#L9 prefijo",
  "confirmarCheckout repo-tienda:apps/web/src/api/checkout.ts#L8 contiene",
  "postCheckout repo-tienda:apps/bff/src/routes/checkout.ts#L14 contiene",
];

const FINAS_ESPERADAS = [
  "feat-carrito depende_de feat-checkout · parser repo-tienda:apps/web/src/api/checkout.ts#L8",
  "feat-carrito llama_a svc-bff:POST:/checkout · parser repo-tienda:apps/web/src/api/checkout.ts#L8",
  "feat-checkout escribe_en tabla-pagos · parser repo-tienda:apps/bff/src/routes/checkout.ts#L16",
  "feat-checkout llama_a svc-payments:POST:/payments · parser repo-tienda:apps/bff/src/clients/payments.ts#L11",
  "svc-bff:POST:/checkout escribe_en tabla-pagos · parser repo-tienda:apps/bff/src/routes/checkout.ts#L16",
  "svc-bff:POST:/checkout implementa feat-checkout · parser repo-tienda:apps/bff/src/routes/checkout.ts#L14",
  "svc-bff:POST:/checkout llama_a svc-payments:POST:/payments · parser repo-tienda:apps/bff/src/clients/payments.ts#L11",
  "svc-web:pantalla:/checkout implementa feat-carrito · parser repo-tienda:apps/web/src/main.tsx",
  "svc-web:pantalla:/checkout llama_a svc-bff:POST:/checkout · parser repo-tienda:apps/web/src/api/checkout.ts#L8",
];

describe("consultas de código", () => {
  it("deriva: llamadas que ningún endpoint atiende y endpoints sin llamadas, con lo que no se pudo medir", () => {
    const r = deriva(ctx, {}) as { llamadasSinEndpoint: unknown[]; endpointsSinLlamadasDetectadas: Array<{ endpoint: string }>; consumidoresIndexados: Record<string, string[]>; avisos: string[] };
    // La ruta existe, pero con otro método.
    expect(r.llamadasSinEndpoint).toEqual([{ desde: "svc-web", llamada: "GET ${base}/checkout", ev: "repo-tienda:apps/web/src/api/checkout.ts#L30", existeConOtroMetodo: ["svc-bff:POST:/checkout"] }]);
    expect(r.consumidoresIndexados).toEqual({ "svc-bff": ["svc-web"], "svc-payments": ["svc-bff"] });
    // Todos los endpoints del fixture tienen quién los llame (al webhook, un externo desde una página curada).
    expect(r.endpointsSinLlamadasDetectadas.map((e) => e.endpoint)).toEqual([]);
    expect(r.avisos[0]).toContain("1 llamadas con URL armada en tiempo de ejecución");
    expect(() => deriva(ctx, { nodo: "tabla-pagos" })).toThrow(ConsultaError);
  });

  it("deriva entre cerebros: lo que atiende otro cerebro no es deriva, y un endpoint que llama otro cerebro tiene consumidor", () => {
    const L30 = "repo-tienda:apps/web/src/api/checkout.ts#L30";
    type R = { llamadasSinEndpoint: unknown[]; atendidasEnOtrosCerebros: unknown[]; disputadasEntreCerebros?: unknown[]; comunicadoCon: string[]; consumidoresIndexados: Record<string, string[]>; endpointsSinLlamadasDetectadas: Array<{ endpoint: string }>; avisos: string[] };
    const vacio = { vecinos: ["otro"], salientes: new Map(), entrantes: new Map(), disputadas: new Map() };
    // La llamada que acá no atiende nadie la atiende un endpoint de otro cerebro: sale de "sin endpoint".
    const r = deriva(ctx, { cruzadas: { ...vacio, salientes: new Map([[L30, { cerebro: "otro", endpoint: "svc-x:GET:/checkout" }]]), entrantes: new Map([["svc-payments:POST:/payments", new Set(["otro/svc-app"])]]) } }) as unknown as R;
    expect(r.llamadasSinEndpoint).toEqual([]);
    expect(r.comunicadoCon).toEqual(["otro"]);
    expect(r.atendidasEnOtrosCerebros).toEqual([{ cerebro: "otro", llamadas: 1, endpoints: 1, ejemplos: [{ llamada: "GET ${base}/checkout", endpoint: "svc-x:GET:/checkout", ev: L30 }] }]);
    // Quien llama desde otro cerebro cuenta como consumidor, con su cerebro adelante.
    expect(r.consumidoresIndexados["svc-payments"]).toEqual(["otro/svc-app", "svc-bff"]);
    // Sin nadie que la atienda en ningún cerebro, sigue siendo deriva, y se dice dónde se buscó.
    const sola = deriva(ctx, { cruzadas: vacio }) as unknown as R;
    expect(sola.llamadasSinEndpoint).toHaveLength(1);
    expect(sola.atendidasEnOtrosCerebros).toEqual([]);
    expect(sola.avisos.join(" ")).toContain("no las atiende ni este cerebro ni otro");
    // Coincide con endpoints de dos cerebros: no es deriva ni está unida; va aparte, con los candidatos.
    const disp = deriva(ctx, { cruzadas: { ...vacio, disputadas: new Map([[L30, ["a/svc-a:GET:/checkout", "b/svc-b:GET:/checkout"]]]) } }) as unknown as R;
    expect(disp.llamadasSinEndpoint).toEqual([]);
    expect(disp.disputadasEntreCerebros).toEqual([{ desde: "svc-web", llamada: "GET ${base}/checkout", ev: L30, candidatos: ["a/svc-a:GET:/checkout", "b/svc-b:GET:/checkout"] }]);
    // Sin comunicación con nadie, se avisa por qué todo figura como sin endpoint.
    expect((deriva(ctx, { cruzadas: { ...vacio, vecinos: [] } }) as unknown as R).avisos.join(" ")).toContain("no tiene la comunicación activa con ningún otro");
    // Sin `cruzadas` (un solo cerebro) la respuesta no cambia de forma.
    expect(deriva(ctx, {})).not.toHaveProperty("atendidasEnOtrosCerebros");
  });

  it("deriva compara campos de una llamada que atiende otro cerebro, con el contrato de ese cerebro", () => {
    const L8 = "repo-tienda:apps/web/src/api/checkout.ts#L8";
    const L30 = "repo-tienda:apps/web/src/api/checkout.ts#L30";
    type R = { campos: { llamadasUnidas: number; comparadas: number; noComparables: Array<{ lado: string; motivo: string; llamadas: number }> }; camposQueNoCoinciden: Array<Record<string, unknown>>; avisos: string[] };
    // El índice viejo (sin `campos`) no compara: lo dice y pide reindexar.
    const viejo = deriva(ctx, { budget_tokens: null }) as unknown as R;
    expect(viejo.campos.comparadas).toBe(0);
    expect(viejo.avisos.join(" ")).toContain("el índice de repo-tienda no trae los campos de las llamadas");
    const extraccion = JSON.stringify({
      ...JSON.parse(extraccionCheckout),
      campos: {
        [L8]: { envia: { tipo: "CheckoutRequest", forma: { carritoId: "string", medioDePago: "string" } }, espera: { tipo: "Confirmacion", forma: { pedidoId: "string", estado: "string", recibo: "string" } } },
        [L30]: { query: { tipo: "Filtro", forma: { desde: "string" } }, espera: { tipo: "Resumen", forma: { total: "number", "items?": "unknown[]" } } },
      },
    });
    const nuevo = contextoDeSalidas(salidasCheckout, contratosCheckout, { archivos: archivosCheckout, extracciones: [extraccion] });
    const vacio = { vecinos: ["otro"], entrantes: new Map(), disputadas: new Map() };
    const salientes = new Map([[L30, { cerebro: "otro", endpoint: "svc-x:GET:/checkout" }]]);
    const contrato = { ev: "repo-otro:src/checkout.ts#L5", request: null, response: "ResumenDto | Vacio", query: "FiltroDto", tipos: { ResumenDto: { total: "number" }, Vacio: { ok: "boolean" }, FiltroDto: { desde: "string", hasta: "string" } } };
    const r = deriva(nuevo, { budget_tokens: null, cruzadas: { ...vacio, salientes, contratoDe: (c, e) => (c === "otro" && e === "svc-x:GET:/checkout" ? contrato : null) } }) as unknown as R;
    // En este cerebro (L8, contra el contrato del bff) y en el otro (L30, contra el contrato que da `contratoDe`).
    expect(r.campos).toMatchObject({ llamadasUnidas: 3, comparadas: 2 });
    expect(r.camposQueNoCoinciden).toEqual([
      { llamada: "GET ${base}/checkout", ev: L30, endpoint: "svc-x:GET:/checkout", cerebro: "otro", evEndpoint: contrato.ev, query: { front: "Filtro", back: "FiltroDto", requeridosQueNoManda: ["hasta"] }, respuesta: { front: "Resumen", back: "ResumenDto | Vacio", opcionalesQueNoVienen: ["items"] } },
      { llamada: "POST /checkout", ev: L8, endpoint: "svc-bff:POST:/checkout", evEndpoint: "repo-tienda:apps/bff/src/routes/checkout.ts#L14", respuesta: { front: "Confirmacion", back: "CheckoutResponse", esperaYNoViene: ["recibo"] } },
    ]);
    // La llamada del bff al servicio de pagos no tiene campos registrados: no se compara, y se dice.
    expect(r.campos.noComparables.find((n) => n.lado === "cuerpo")).toMatchObject({ motivo: "no se sabe qué cuerpo manda la llamada", llamadas: 1 });
    // Sin el contrato del otro cerebro, esa llamada no se compara: no es coincidencia.
    const sin = deriva(nuevo, { budget_tokens: null, cruzadas: { ...vacio, salientes } }) as unknown as R;
    expect(sin.campos.comparadas).toBe(1);
    expect(sin.campos.noComparables.map((n) => n.motivo)).toContain("no se cargó el contrato del endpoint en otro");
    expect(sin.avisos.join(" ")).not.toContain("no trae los campos");
  });

  it("riesgo: de un diff a los métodos que cambian, quién los llama y lo que queda alcanzado", () => {
    const diff = ["diff --git a/apps/bff/src/clients/payments.ts b/apps/bff/src/clients/payments.ts", "--- a/apps/bff/src/clients/payments.ts", "+++ b/apps/bff/src/clients/payments.ts", "@@ -11,2 +11,3 @@ export async function crearPago", "-  viejo", "+  nuevo", "+  otro"].join("\n");
    expect(archivosDeDiff(diff)).toEqual([{ ruta: "apps/bff/src/clients/payments.ts", rangos: [[11, 13]] }]);
    expect(riesgo(ctx, { diff })).toEqual(RIESGO_CLIENTE);
    // Tocar el método que escribe en una tabla sube el nivel; un archivo que no está en el índice se avisa.
    const r = riesgo(ctx, { archivos: ["apps/bff/src/routes/checkout.ts", "docs/LEEME.md"], repo: "repo-tienda" }) as { nivel: string; motivos: string[]; tablas: string[]; avisos: string[] };
    expect(r.nivel).toBe("alto");
    expect(r.motivos[0]).toBe("cambia código que escribe en tabla-pagos");
    expect(r.tablas).toEqual(["escribe_en tabla-pagos"]);
    expect(r.avisos).toContain("archivos fuera del índice (no se pudo medir su alcance): docs/LEEME.md");
    expect(() => riesgo(ctx, {})).toThrow(ConsultaError);
  });

  it("riesgo sigue un tipo o una constante cambiados hasta quienes los usan", () => {
    const diffDe = (ruta: string, desde: number, n: number) => [`--- a/${ruta}`, `+++ b/${ruta}`, `@@ -${desde},${n} +${desde},${n} @@`, "+x"].join("\n");
    // La interfaz `PagoCreado` (L5-8) la usa `crearPago`, que llama `postCheckout`, que atiende el endpoint del checkout.
    const r = riesgo(ctx, { diff: diffDe("apps/bff/src/clients/payments.ts", 6, 1) }) as typeof RIESGO_CLIENTE;
    expect(r.cambia).toEqual(["PagoCreado @ repo-tienda:apps/bff/src/clients/payments.ts#L5"]);
    expect(r.usos).toEqual(["PagoCreado ← crearPago @ repo-tienda:apps/bff/src/clients/payments.ts#L10"]);
    expect(r.llamadores).toEqual(["crearPago @ repo-tienda:apps/bff/src/clients/payments.ts#L10", "postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L14"]);
    expect(r.endpoints).toEqual(["svc-bff:POST:/checkout"]);
    expect(r.pantallas).toEqual(["svc-web:pantalla:/checkout"]);
    expect(r.nivel).toBe("medio");
    expect(r.avisos).toEqual([]);
    // Una constante (`PAYMENTS_URL`, L3) igual.
    const c = riesgo(ctx, { diff: diffDe("apps/bff/src/clients/payments.ts", 3, 1) }) as typeof RIESGO_CLIENTE;
    expect(c.cambia).toEqual(["PAYMENTS_URL @ repo-tienda:apps/bff/src/clients/payments.ts#L3"]);
    expect(c.endpoints).toEqual(["svc-bff:POST:/checkout"]);
    // Una constante que solo usa código suelto (`router.post(…)`) lo dice, en vez de quedar muda.
    const s = riesgo(ctx, { diff: diffDe("apps/bff/src/routes/checkout.ts", 19, 1) }) as typeof RIESGO_CLIENTE;
    expect(s.cambia).toEqual(["router @ repo-tienda:apps/bff/src/routes/checkout.ts#L19"]);
    expect(s.avisos).toEqual(["tipos o constantes que ningún símbolo indexado nombra (si se usan, es fuera del código analizado: otro repo, plantillas, texto o reflexión): router"]);
    // Un import no cae en ningún símbolo.
    expect((riesgo(ctx, { diff: diffDe("apps/bff/src/routes/checkout.ts", 2, 1) }) as typeof RIESGO_CLIENTE).avisos[0]).toMatch(/^cambios fuera de todo símbolo/);
  });

  it("riesgo avisa cuando el índice no registra los usos de tipos (indexado con una versión anterior)", () => {
    const viejo = archivosCheckout.map((c) => {
      const j = JSON.parse(c) as { archivos: Array<{ referencias?: unknown }> };
      for (const a of j.archivos) delete a.referencias;
      return JSON.stringify(j);
    });
    const v = contextoDeSalidas(salidasCheckout, contratosCheckout, { archivos: viejo, extracciones: [extraccionCheckout] });
    const r = riesgo(v, { diff: ["--- a/apps/bff/src/clients/payments.ts", "+++ b/apps/bff/src/clients/payments.ts", "@@ -6,1 +6,1 @@", "+x"].join("\n") }) as typeof RIESGO_CLIENTE;
    expect(r.cambia).toEqual(["PagoCreado @ repo-tienda:apps/bff/src/clients/payments.ts#L5"]);
    expect(r.endpoints).toEqual([]);
    expect(r.avisos).toEqual(["el índice de repo-tienda no registra quién usa tipos y constantes (indexado antes de registrarlos, o su parser no los sigue): corré `flowbrain index` y `flowbrain compile` para seguirlos"]);
  });

  it("simbolosTocados: una clase cuenta solo si el cambio cae fuera de sus métodos", () => {
    const simbolos = [
      { nombre: "Servicio", tipo: "clase", linea: 1, fin: 20 },
      { nombre: "Servicio.crear", tipo: "metodo", linea: 5, fin: 10 },
      { nombre: "Estado", tipo: "enum", linea: 22, fin: 25 },
      { nombre: "Pago", tipo: "modelo", linea: 30 },
    ];
    expect(simbolosTocados(simbolos, [[6, 7]]).map((s) => s.nombre)).toEqual(["Servicio.crear"]);
    expect(simbolosTocados(simbolos, [[3, 3]]).map((s) => s.nombre)).toEqual(["Servicio"]);
    expect(simbolosTocados(simbolos, [[9, 12]]).map((s) => s.nombre)).toEqual(["Servicio", "Servicio.crear"]);
    expect(simbolosTocados(simbolos, [[23, 23]]).map((s) => s.nombre)).toEqual(["Estado"]);
    expect(simbolosTocados(simbolos, []).map((s) => s.nombre)).toEqual(["Servicio", "Servicio.crear", "Estado"]);
  });

  it("buscar_nodo encuentra símbolos de código, con archivo y línea, y texto dentro de nombres y páginas", () => {
    const sim = (texto: string, extra: Record<string, unknown> = {}) => (buscarNodo(ctx, { texto, ...extra }) as { simbolos?: Array<{ simbolo: string; ev: string; coincidencia: string }> }).simbolos?.map((x) => `${x.simbolo} ${x.ev} ${x.coincidencia}`);
    expect(sim("postCheckout")).toEqual(["postCheckout repo-tienda:apps/bff/src/routes/checkout.ts#L14 exacta"]);
    expect(sim("crear")).toEqual([
      "CrearPagoRequest repo-tienda:apps/payments/src/routes/payments.ts#L28 prefijo",
      "crearPago repo-tienda:apps/bff/src/clients/payments.ts#L10 prefijo",
    ]);
    expect(sim("Checkout", { tipos: ["simbolo"] })).toEqual(SIMBOLOS_CHECKOUT);
    // Filtrar por un tipo de nodo deja afuera los símbolos; sin índice de código no hay campo.
    expect(sim("postCheckout", { tipos: ["svc"] })).toBeUndefined();
    expect((buscarNodo(sinIndice, { texto: "postCheckout" }) as { simbolos?: unknown }).simbolos).toBeUndefined();
    // Con poco presupuesto los símbolos se recortan y queda dicho cuántos.
    const corto = buscarNodo(ctx, { texto: "Checkout", tipos: ["simbolo"], budget_tokens: 120 }) as { simbolos: unknown[]; simbolosOmitidos?: number; truncado: boolean };
    expect(corto.truncado).toBe(true);
    expect(corto.simbolos.length + corto.simbolosOmitidos!).toBe(SIMBOLOS_CHECKOUT.length);
    expect(tokens(corto)).toBeLessThanOrEqual(120);
    // Texto del resumen: "orquesta" no está en ningún nombre.
    expect(buscarNodo(ctx, { texto: "orquesta" }).nodos.map((n) => `${n.id} ${n.coincidencia}`)).toEqual(["svc-bff texto"]);
  });

  it("relaciones finas en el grafo: endpoint, pantalla y funcionalidad con lo que tocan y llaman", () => {
    const FINOS = new Set(["endpoint", "pantalla", "feat"]);
    const finas = ctx.graph.edges
      .filter((e) => FINOS.has(ctx.nodo.get(e.desde)!.tipo) && e.verbo !== "navega_a")
      .map((e) => `${e.desde} ${e.verbo} ${e.endpoint ?? e.hasta} · ${e.origen} ${e.evidencia}`);
    expect(finas).toEqual(FINAS_ESPERADAS);
    // Desde la tabla hacia atrás se llega al endpoint que la escribe, a la pantalla que lo llama y a las funcionalidades.
    const r = recorrerGrafo(ctx, { nodo: "tabla-pagos", verbos: ["depende_de"], direccion: "in", profundidad: 3 });
    expect(r.nodos.map((n) => n.id)).toEqual(expect.arrayContaining(["svc-bff:POST:/checkout", "svc-web:pantalla:/checkout", "feat-checkout", "feat-carrito"]));
  });

  it("recorrido desde un endpoint: método que lo atiende y lo que toca cada paso", () => {
    const r = recorrido(ctx, { desde: "POST /checkout" }) as { atiende: string; pasos: Array<{ n: number; simbolo: string; ev: string; toca?: string[] }> };
    expect(r.atiende).toBe("postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L14");
    expect(r.pasos).toEqual([
      { n: 0, simbolo: "postCheckout", ev: "repo-tienda:apps/bff/src/routes/checkout.ts#L14", toca: ["escribe_en tabla-pagos"] },
      { n: 1, simbolo: "crearPago", ev: "repo-tienda:apps/bff/src/clients/payments.ts#L10", toca: ["llama_a svc-payments:POST:/payments"] },
    ]);
  });

  it("pantalla de punta a punta: componente, funcionalidad, llamadas al back y recorrido que cruza por HTTP", () => {
    const r = pantalla(ctx, { ruta: "/checkout", budget_tokens: null });
    expect(r).toMatchObject({ id: "svc-web:pantalla:/checkout", componente: "main @ repo-tienda:apps/web/src/main.tsx#L1", funcionalidades: ["feat-carrito"], llamaAlBack: ["svc-bff:POST:/checkout"] });
    // La relación pantalla → funcionalidad queda en el grafo y en la consulta de la funcionalidad.
    expect(ctx.graph.edges.filter((e) => e.verbo === "implementa" && e.desde === "svc-web:pantalla:/checkout").map((e) => `${e.hasta} ${e.evidencia}`)).toEqual(["feat-carrito repo-tienda:apps/web/src/main.tsx"]);
    expect(funcionalidad(ctx, { id: "feat-carrito", budget_tokens: null }).pantallas).toEqual([{ pantalla: "svc-web:pantalla:/checkout", ruta: "/checkout", componente: "repo-tienda:apps/web/src/main.tsx#main", llamaAlBack: ["svc-bff:POST:/checkout"] }]);
    expect(r.recorrido.map((p) => `${p.n} ${p.simbolo}${p.via ? ` (${p.via})` : ""}`)).toEqual([
      "0 main",
      "1 confirmarCheckout",
      "2 postCheckout (por HTTP: svc-bff:POST:/checkout)",
      "3 crearPago",
    ]);
    expect(r.avisos[0]).toMatch(/ninguna pantalla conocida lleva acá/);
    // `recorrido` acepta la pantalla, y una ruta del front que no es un endpoint.
    expect(recorrido(ctx, { desde: "pantalla /checkout", budget_tokens: null })).toMatchObject({ inicio: "svc-web:pantalla:/checkout" });
    expect(() => pantalla(ctx, { ruta: "/nada" })).toThrow(ConsultaError);
  });

  it("control `alcanza`: la pantalla sigue llegando a la llamada que se verificó a mano", () => {
    const { controles } = leerControles(
      [
        "controles:",
        '  - { tipo: alcanza, pantalla: "/checkout", metodo: POST, ruta: "/checkout" }',
        '  - { tipo: alcanza, pantalla: "/checkout", metodo: DELETE, ruta: "/checkout" }',
        '  - { tipo: alcanza, pantalla: "/nada", metodo: POST, ruta: "/checkout" }',
      ].join("\n"),
    );
    expect(controles).toHaveLength(3);
    const r = cobertura(ctx, { controles });
    expect(r.controles.fallan.map((c) => `${c.pantalla} ${c.metodo}`)).toEqual(["/checkout DELETE", "/nada POST"]);
  });

  it("pantalla con espacios en la ruta (React Navigation nombra pantallas con espacios)", () => {
    expect(() => pantalla(ctx, { ruta: "/mi cuenta" })).toThrow(/no hay una pantalla con la ruta \/mi cuenta$/);
  });

  it("quien_llama sube por las invocaciones y dice qué endpoints y funcionalidades alcanza", () => {
    const r = quienLlama(ctx, { simbolo: "crearPago" });
    expect(r.llamadas).toEqual([{ nivel: 1, quien: "postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L15", llama_a: "crearPago" }]);
    expect(r.endpoints).toEqual(["svc-bff:POST:/checkout"]);
    expect(r.funcionalidades).toEqual(["feat-checkout"]);
    expect(r.consumenEsosEndpoints).toEqual(["feat-carrito"]);
    expect(r.porHttp).toEqual([{ endpoint: "svc-bff:POST:/checkout", quien: "confirmarCheckout @ repo-tienda:apps/web/src/api/checkout.ts#L8" }]);
  });

  it("impacto de una tabla: funcionalidades por niveles con el porqué y qué métodos la tocan", () => {
    const r = impactoDe(ctx, { pieza: "tabla-pagos" }) as { funcionalidades: Array<{ id: string; nivel: number; porque: string }>; tocadaPor: Array<{ quien: string; verbo: string }> };
    expect(r.funcionalidades.map((f) => `${f.nivel} ${f.id}: ${f.porque}`)).toEqual(["1 feat-checkout: escribe en tabla-pagos", "2 feat-carrito: usa feat-checkout, que escribe en tabla-pagos"]);
    expect(r.tocadaPor).toEqual([{ verbo: "escribe_en", quien: "postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L14", ev: "repo-tienda:apps/bff/src/routes/checkout.ts#L16" }]);
    // Un símbolo de código delega en quien_llama.
    expect(impactoDe(ctx, { pieza: "crearPago" })).toMatchObject({ endpoints: ["svc-bff:POST:/checkout"] });
  });

  it("funcionalidad por sufijo o nombre, con el método que atiende cada endpoint", () => {
    const r = funcionalidad(ctx, { id: "checkout" }) as { id: string; expone: unknown[]; usadaPor: string[] };
    expect(r.id).toBe("feat-checkout");
    expect(r.expone).toEqual([{ endpoint: "svc-bff:POST:/checkout", atiende: "postCheckout @ repo-tienda:apps/bff/src/routes/checkout.ts#L14" }]);
    expect(r.usadaPor).toEqual(["feat-carrito"]);
    expect(() => funcionalidad(ctx, { id: "chekout" })).toThrow(/no existe la funcionalidad/);
  });

  it("respeta el presupuesto y avisa cuando recorta; sin índice de código, error claro", () => {
    for (const r of [funcionalidad(ctx, { id: "checkout", budget_tokens: 120 }), quienLlama(ctx, { simbolo: "crearPago", budget_tokens: 120 })]) {
      expect(tokens(r)).toBeLessThanOrEqual(Math.ceil(120 * 1.05) + 60);
    }
    expect(() => recorrido(sinIndice, { desde: "POST /checkout" })).toThrow(ConsultaError);
    expect(() => quienLlama(ctx, { simbolo: "noExiste" })).toThrow(/no existe el símbolo/);
  });
  it("avisa cuando el clon avanzó desde que se indexó (HEAD leído de .git, incluso con packed-refs)", async () => {
    const brain = await mkdtemp(join(tmpdir(), "brain-head-"));
    const git = join(brain, "clon/.git");
    await mkdir(join(git, "refs/heads"), { recursive: true });
    await writeFile(join(git, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(git, "packed-refs"), `# pack-refs\n${"a".repeat(40)} refs/heads/main\n`);
    expect(await commitDe(join(brain, "clon"))).toBe("a".repeat(40));
    const ix = { ...ctx.codigo!, commits: { "repo-tienda": "a".repeat(40) }, raices: { "repo-tienda": "clon" }, actuales: {} };
    const c = { ...ctx, codigo: ix };
    await actualizarHeads(ix, brain);
    expect(recorrido(c, { desde: "POST /checkout" }).avisos).toEqual([]);
    await writeFile(join(git, "refs/heads/main"), `${"b".repeat(40)}\n`);
    await actualizarHeads(ix, brain);
    expect(recorrido(c, { desde: "POST /checkout" }).avisos).toEqual([
      "índice desactualizado: repo-tienda se indexó en aaaaaaaaaaaa y el clon está en bbbbbbbbbbbb; las líneas pueden no coincidir (corré `flowbrain index` y `flowbrain compile`)",
    ]);
  });
  it("evaluar cuenta aciertos por herramienta: textos esperados, prohibidos y errores esperados", () => {
    const preguntas = leerPreguntas(JSON.stringify({ preguntas: [
      { id: "a", pregunta: "¿Qué ejecuta POST /checkout?", herramienta: "recorrido", args: { desde: "POST /checkout" }, espera: ["postCheckout", "escribe_en tabla-pagos"] },
      { id: "b", herramienta: "quien_llama", args: { simbolo: "crearPago" }, espera: ["postCheckout @"], noEspera: ["feat-inexistente"] },
      { id: "c", herramienta: "recorrido", args: { desde: "POST /checkout" }, espera: ["tabla-inexistente", "postCheckout"] },
      { id: "d", herramienta: "quien_llama", args: { simbolo: "NoExiste.metodo" }, error: true },
    ] }));
    const r = evaluar(ctx, preguntas);
    expect(r).toMatchObject({ total: 4, aciertos: 3, porcentaje: 75, cobertura: 80, porHerramienta: { quien_llama: { total: 2, aciertos: 2 }, recorrido: { total: 2, aciertos: 1 } } });
    // Lo que la evaluación no mide queda a la vista.
    expect(r.sinPreguntas).toEqual(["buscar_nodo", "contrato_de", "deriva", "fidelidad", "funcionalidad", "impacto", "infra", "pantalla", "paridad", "recorrer_grafo", "riesgo", "trazar"]);
    expect(r.falladas).toEqual([{ id: "c", pregunta: "c", herramienta: "recorrido", ok: false, faltan: ["tabla-inexistente"], sobran: [] }]);
    expect(() => leerPreguntas('[{"id":"x","herramienta":"otra","args":{}}]')).toThrow(/herramienta desconocida/);
  });
  it("recorrido desde el front cruza por HTTP al método del back que atiende el endpoint", () => {
    const r = recorrido(ctx, { desde: "confirmarCheckout" }) as { pasos: Array<{ n: number; simbolo: string; toca?: string[]; via?: string }> };
    expect(r.pasos.map((p) => `${p.n} ${p.simbolo}${p.via ? ` (${p.via})` : ""}`)).toEqual([
      "0 confirmarCheckout",
      "1 postCheckout (por HTTP: svc-bff:POST:/checkout)",
      "2 crearPago",
    ]);
    expect(r.pasos[0]!.toca).toEqual(["llama_a svc-bff:POST:/checkout"]);
  });
});

describe("paridad de una migración", () => {
  const nodo = (id: string, tipo: GraphNode["tipo"], atributos: Record<string, unknown> = {}): GraphNode => ({ actualizado: null, aliases: [], atributos, estado: "vigente", id, nombre: id, origen: "parser", pagina: null, resumen: null, tecnologia: [], tipo, verificado: null });
  const arista = (desde: string, verbo: GraphEdge["verbo"], hasta: string): GraphEdge => ({ confianza: 0.9, dato: null, desde, endpoint: null, estado: "vigente", evidencia: null, hasta, origen: "parser", verbo });
  const ep = (svc: string, metodo: string, ruta: string) => nodo(`${svc}:${metodo}:${ruta}`, "endpoint", { metodo, ruta });
  const eps = [ep("svc-viejo", "GET", "/turnos"), ep("svc-viejo", "GET", "/turnos/{id}"), ep("svc-viejo", "POST", "/turnos"), ep("svc-viejo", "DELETE", "/turnos/{id}"), ep("svc-nuevo", "GET", "/api/turnos"), ep("svc-nuevo", "GET", "/api/turnos/{turnoId}"), ep("svc-nuevo", "POST", "/api/turnos"), ep("svc-nuevo", "GET", "/api/salud")];
  const graph: Graph = {
    version: 1,
    nodes: [nodo("svc-viejo", "svc"), nodo("svc-nuevo", "svc"), nodo("tabla-turno", "tabla"), nodo("tabla-auditoria", "tabla"), ...eps],
    edges: [
      ...eps.map((e) => arista(e.id.slice(0, e.id.indexOf(":")), "contiene", e.id)),
      arista("svc-viejo:POST:/turnos", "escribe_en", "tabla-turno"),
      arista("svc-viejo:POST:/turnos", "escribe_en", "tabla-auditoria"),
      arista("svc-nuevo:POST:/api/turnos", "escribe_en", "tabla-turno"),
    ],
  };
  const ctx2 = crearContexto(graph, [], new Map());

  it("empareja por método y ruta, descuenta el prefijo fijo y dice qué falta y dónde difieren las tablas", () => {
    const r = paridad(ctx2, { viejo: "svc-viejo", nuevo: "svc-nuevo" });
    expect(r.endpoints).toEqual({
      total: { viejo: 4, nuevo: 4, migrados: 3 },
      faltan: ["svc-viejo:DELETE:/turnos/{id}"],
      soloEnNuevo: ["svc-nuevo:GET:/api/salud"],
      difierenEnTablas: [{ viejo: "svc-viejo:POST:/turnos", nuevo: "svc-nuevo:POST:/api/turnos", soloViejo: ["escribe_en tabla-auditoria"], soloNuevo: [] }],
    });
    expect(r.tablasSinMigrar).toEqual(["tabla-auditoria"]);
    expect(() => paridad(ctx2, { viejo: "svc-viejo", nuevo: "tabla-turno" })).toThrow(ConsultaError);
  });

  it("con cada servicio en su cerebro da lo mismo, y dice de qué cerebro es cada lado", () => {
    const solo = (svc: string) => {
      const ids = new Set([svc, "tabla-turno", "tabla-auditoria", ...eps.filter((e) => e.id.startsWith(`${svc}:`)).map((e) => e.id)]);
      return crearContexto({ version: 1, nodes: graph.nodes.filter((n) => ids.has(n.id)), edges: graph.edges.filter((e) => ids.has(e.desde) && ids.has(e.hasta)) }, [], new Map());
    };
    const r = paridadEntre({ ctx: solo("svc-viejo"), svc: "svc-viejo", cerebro: "legado" }, { ctx: solo("svc-nuevo"), svc: "svc-nuevo", cerebro: "back" });
    const junto = paridad(ctx2, { viejo: "svc-viejo", nuevo: "svc-nuevo" });
    expect(r.endpoints).toEqual(junto.endpoints);
    expect(r.tablasSinMigrar).toEqual(["tabla-auditoria"]);
    expect(r).toMatchObject({ cerebros: { viejo: "legado", nuevo: "back" } });
    expect(r.avisos.join(" ")).toContain("las tablas se comparan por nombre, sin guiones ni mayúsculas");
    // La misma tabla con otro id de página en cada cerebro no es una diferencia.
    const conOtroId = (g: Graph): Graph => JSON.parse(JSON.stringify(g).replaceAll("tabla-turno", "tabla-Tur_no").replaceAll("tabla-auditoria", "tabla-audi-toria")) as Graph;
    const nuevoRenombrado = crearContexto(conOtroId({ version: 1, nodes: graph.nodes.filter((n) => !n.id.startsWith("svc-viejo")), edges: graph.edges.filter((e) => !e.desde.startsWith("svc-viejo")) }), [], new Map());
    const rr = paridadEntre({ ctx: solo("svc-viejo"), svc: "svc-viejo", cerebro: "legado" }, { ctx: nuevoRenombrado, svc: "svc-nuevo", cerebro: "back" });
    expect(rr.endpoints.difierenEnTablas).toEqual([{ viejo: "svc-viejo:POST:/turnos", nuevo: "svc-nuevo:POST:/api/turnos", soloViejo: ["escribe_en tabla-auditoria"], soloNuevo: [] }]);
    expect(rr.tablasSinMigrar).toEqual(["tabla-auditoria"]);
    expect(junto).not.toHaveProperty("cerebros");
    expect(() => paridadEntre({ ctx: solo("svc-viejo"), svc: "svc-nuevo", cerebro: "legado" }, { ctx: solo("svc-nuevo"), svc: "svc-nuevo", cerebro: "back" })).toThrow(/no existe el servicio: svc-nuevo en el cerebro legado/);
  });
});

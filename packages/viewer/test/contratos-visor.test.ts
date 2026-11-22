import { describe, expect, it } from "vitest";
import { crearContexto, paridad, paridadEntre, type Graph, type GraphEdge, type GraphNode } from "@flowbrain/core";
import { datosDeCerebros } from "../src/cerebros.js";
import { datosDelVisor, derivaDelVisor } from "../src/viewer.js";
import { CONTRATOS_JS } from "../src/viewer-contratos.js";

/** La pantalla Contratos con un DOM mínimo. La paridad se calcula en la página: acá se comprueba que dé lo mismo que el motor. */
type Oyente = (ev: { target: Record<string, unknown> }) => void;
interface ParidadJs { entre: boolean; endpoints: { viejo: number; nuevo: number; migrados: number; faltan: string[]; soloEnNuevo: string[]; difieren: unknown[] }; tablasSinMigrar: string[] }
function montar(datos: Record<string, unknown>) {
  const guardado = new Map<string, string>();
  const sessionStorage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
  const oyentes: Record<string, Oyente[]> = {};
  const raiz = { innerHTML: "", addEventListener(t: string, f: Oyente) { (oyentes[t] ??= []).push(f); } };
  const porId: Record<string, { n: string }> = {};
  for (const n of (datos["nodes"] as Array<{ id: string; n: string }> | undefined) ?? []) porId[n.id] = n;
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const window = { brainVisor: { D: datos, porId, esc }, brainContratos: null as null | { mostrar(): void; paridad(v: string, n: string): ParidadJs } };
  new Function("window", "document", "sessionStorage", CONTRATOS_JS)(window, { getElementById: (id: string) => (id === "contratos" ? raiz : null) }, sessionStorage);
  window.brainContratos!.mostrar();
  const disparar = (tipo: string, target: Record<string, unknown>) => (oyentes[tipo] ?? []).forEach((f) => f({ target }));
  const boton = (attrs: Record<string, string>) => ({ closest: () => ({ getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs }) });
  return {
    pagina: () => raiz.innerHTML,
    paridad: window.brainContratos!.paridad,
    tocar: (attrs: Record<string, string>) => disparar("click", boton(attrs)),
    cambiar: (id: string, value: string) => disparar("change", { id, value }),
    escribir: (value: string) => disparar("input", { id: "ct-q", value }),
    cifras: () => [...raiz.innerHTML.matchAll(/<div class="fd-cifra"><b[^>]*>([^<]+)<\/b><span>([^<]+)</g)].map((m) => `${m[1]} ${m[2]}`),
  };
}

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
const lado = (svc: string, renombrar = false): Graph => {
  const ids = new Set([svc, "tabla-turno", "tabla-auditoria", ...eps.filter((e) => e.id.startsWith(`${svc}:`)).map((e) => e.id)]);
  const g: Graph = { version: 1, nodes: graph.nodes.filter((n) => ids.has(n.id)), edges: graph.edges.filter((e) => ids.has(e.desde) && ids.has(e.hasta)) };
  return renombrar ? (JSON.parse(JSON.stringify(g).replaceAll("tabla-turno", "tabla-Tur_no")) as Graph) : g;
};
const deriva = {
  llamadasSinEndpoint: [{ desde: "svc-viejo", llamada: "GET ${api}/stock", ev: "repo-a:src/api.ts#L9", existeConOtroMetodo: ["svc-nuevo:POST:/api/turnos"] }],
  llamadasAmbiguas: [],
  endpointsSinLlamadasDetectadas: [{ endpoint: "svc-nuevo:GET:/api/salud", ev: "repo-a:src/salud.ts#L3" }],
  consumidoresIndexados: { "svc-nuevo": ["svc-viejo"], "svc-viejo": [] },
  avisos: ["svc-viejo no tiene consumidores indexados: no se puede decir qué endpoints suyos no se usan"],
};

describe("pantalla Contratos: paridad", () => {
  it("da lo mismo que el motor, en un mismo brain", () => {
    const v = montar(datosDelVisor(graph));
    const js = v.paridad("svc-viejo", "svc-nuevo"), motor = paridad(crearContexto(graph, [], new Map()), { viejo: "svc-viejo", nuevo: "svc-nuevo" });
    expect([js.endpoints.viejo, js.endpoints.nuevo, js.endpoints.migrados]).toEqual([motor.endpoints.total.viejo, motor.endpoints.total.nuevo, motor.endpoints.total.migrados]);
    expect(js.endpoints.faltan).toEqual(motor.endpoints.faltan);
    expect(js.endpoints.soloEnNuevo).toEqual(motor.endpoints.soloEnNuevo);
    expect(js.endpoints.difieren).toEqual(motor.endpoints.difierenEnTablas);
    expect(js.tablasSinMigrar).toEqual(motor.tablasSinMigrar);
    expect(js.entre).toBe(false);
  });

  it("y entre cerebros, con la misma tabla bajo otro id en cada uno", () => {
    const gv = lado("svc-viejo"), gn = lado("svc-nuevo", true);
    const v = montar(datosDeCerebros([{ nombre: "legado", sinRevisar: false, graph: gv, funcionalidades: [] }, { nombre: "back", sinRevisar: false, graph: gn, funcionalidades: [] }], [], []));
    const js = v.paridad("legado/svc-viejo", "back/svc-nuevo");
    const motor = paridadEntre({ ctx: crearContexto(gv, [], new Map()), svc: "svc-viejo", cerebro: "legado" }, { ctx: crearContexto(gn, [], new Map()), svc: "svc-nuevo", cerebro: "back" });
    expect(js.entre).toBe(true);
    expect(js.endpoints.faltan).toEqual(motor.endpoints.faltan.map((id) => `legado/${id}`));
    expect(js.endpoints.soloEnNuevo).toEqual(motor.endpoints.soloEnNuevo.map((id) => `back/${id}`));
    // `tabla-turno` y `tabla-Tur_no` son la misma: lo único que difiere es la auditoría.
    expect(js.endpoints.difieren).toEqual([{ viejo: "legado/svc-viejo:POST:/turnos", nuevo: "back/svc-nuevo:POST:/api/turnos", soloViejo: ["escribe_en legado/tabla-auditoria"], soloNuevo: [] }]);
    expect(js.tablasSinMigrar).toEqual(["legado/tabla-auditoria"]);
    expect(motor.tablasSinMigrar).toEqual(["tabla-auditoria"]);
  });

  it("se eligen los dos servicios y muestra qué falta, qué sobra y dónde cambian las tablas", () => {
    const v = montar(datosDelVisor(graph));
    v.tocar({ "data-tab": "paridad" });
    expect(v.pagina()).toContain("Elegí los dos servicios");
    expect(v.pagina()).toContain('<option value="svc-viejo">svc-viejo (4 endpoints)</option>');
    v.cambiar("ct-viejo", "svc-viejo");
    v.cambiar("ct-nuevo", "svc-viejo");
    expect(v.pagina()).toContain("Elegiste el mismo servicio de los dos lados");
    v.cambiar("ct-nuevo", "svc-nuevo");
    expect(v.cifras()).toEqual(["3 de 4 endpoints ya están del otro lado (75 %)", "1 faltan migrar", "1 solo en el nuevo", "1 migrados que tocan tablas distintas"]);
    expect(v.pagina()).toContain("<code>DELETE /turnos/{id}</code>");
    expect(v.pagina()).toContain("Solo el viejo escribe en <code>tabla-auditoria</code>");
    expect(v.pagina()).toContain("Tablas que el nuevo todavía no toca <small>1</small>");
    // Sin pantallas de ningún lado, no se muestra ese bloque.
    expect(v.pagina()).not.toContain("<h2>Pantallas</h2>");
    v.tocar({ "data-acc": "invertir" });
    expect(v.cifras()[0]).toBe("3 de 4 endpoints ya están del otro lado (75 %)");
    expect(v.pagina()).toContain("<code>GET /api/salud</code>");
    v.escribir("nada-que-coincida");
    expect(v.pagina()).toContain("Ninguno coincide con «nada-que-coincida».");
  });

  it("con un solo servicio dice que no hay con qué comparar", () => {
    const v = montar(datosDelVisor(lado("svc-viejo")));
    v.tocar({ "data-tab": "paridad" });
    expect(v.pagina()).toContain("solo hay uno (svc-viejo)");
  });
});

describe("pantalla Contratos: deriva", () => {
  it("muestra las llamadas que nadie atiende y los endpoints que nadie llama, y lo que no se pudo medir", () => {
    const v = montar(datosDelVisor(graph, [], undefined, deriva));
    expect(v.cifras()).toEqual(["1 llamadas que nadie atiende", "1 endpoints que nadie llama"]);
    const p = v.pagina();
    expect(p).toContain("<code>GET ${api}/stock</code> <small>desde svc-viejo · <code>repo-a:src/api.ts#L9</code></small>");
    expect(p).toContain("Existe con otro método: <code>POST /api/turnos</code>");
    expect(p).toContain("svc-nuevo <small>lo llaman svc-viejo</small>");
    expect(p).toContain("<code>GET /api/salud</code>");
    expect(p).toContain("Nadie indexado llama a este servicio");
    expect(p).toContain("Lo que no se pudo medir <small>1</small>");
    // Un brain solo no se cruzó con nadie: no se habla de otros cerebros.
    expect(p).not.toContain("otro cerebro");
  });

  it("con varios cerebros, cada uno su deriva: lo que atiende otro cerebro va aparte y la falta de comunicación se dice", () => {
    const front = { ...deriva, llamadasSinEndpoint: [], comunicadoCon: ["back"], atendidasEnOtrosCerebros: [{ cerebro: "back", llamadas: 7, endpoints: 3 }], disputadasEntreCerebros: [{ desde: "svc-viejo", llamada: "GET /x", ev: "repo-a:x.ts#L1", candidatos: ["back/svc-a:GET:/x", "otro/svc-b:GET:/x"] }] };
    const d = datosDeCerebros([{ nombre: "legado", sinRevisar: false, graph: lado("svc-viejo"), funcionalidades: [], deriva: front }, { nombre: "back", sinRevisar: false, graph: lado("svc-nuevo"), funcionalidades: [], deriva: { ...deriva, comunicadoCon: [] } }], [], []);
    expect((d.deriva as Array<{ c: number }>).map((x) => x.c)).toEqual([0, 1]);
    const v = montar(d);
    expect(v.cifras()).toEqual(["0 llamadas que nadie atiende", "7 llamadas que atiende otro cerebro", "1 en disputa entre cerebros", "1 endpoints que nadie llama"]);
    expect(v.pagina()).toContain("Cruzado con back");
    expect(v.pagina()).toContain("Todas las llamadas con ruta tienen quién las atienda.");
    expect(v.pagina()).toContain("back <small>7 llamadas a 3 endpoints</small>");
    expect(v.pagina()).toContain("Candidatos: <code>back/svc-a:GET:/x</code>, <code>otro/svc-b:GET:/x</code>");
    v.tocar({ "data-cerebro": "1" });
    expect(v.pagina()).toContain("no tiene la comunicación activa con ningún otro");
    expect(v.cifras()[0]).toBe("1 llamadas que nadie atiende");
  });

  it("muestra los campos que no coinciden, con evidencia de los dos lados, y lo que no se pudo comparar", () => {
    const conCampos = {
      ...deriva,
      campos: { llamadasUnidas: 3, comparadas: 2, sinDiferencias: 1, conDiferencias: 1, noComparables: [{ lado: "cuerpo", motivo: "la llamada manda un tipo sin campos que comparar", llamadas: 1, tipos: ["FormData"] }] },
      camposQueNoCoinciden: [{ llamada: "POST ${api}/turnos", ev: "repo-a:src/api.ts#L20", endpoint: "svc-nuevo:POST:/api/turnos", cerebro: "back", evEndpoint: "repo-b:src/turnos.ts#L8", cuerpo: { front: "NuevoTurno", back: "CrearTurno", requeridosQueNoManda: ["fecha"] }, respuesta: { front: "Turno", back: "TurnoDto", distintoNombre: ["horaInicio ↔ hora_inicio"] } }],
    };
    const v = montar(datosDelVisor(graph, [], undefined, conCampos));
    expect(v.cifras()).toContain("1 con campos que no coinciden");
    const p = v.pagina();
    expect(p).toContain("Campos que no coinciden <small>1</small>");
    expect(p).toContain("<code>POST ${api}/turnos</code> <small>→ <code>back/POST /api/turnos</code> · llama <code>repo-a:src/api.ts#L20</code> · atiende <code>repo-b:src/turnos.ts#L8</code></small>");
    expect(p).toContain("Cuerpo (<code>NuevoTurno</code> → <code>CrearTurno</code>): requeridos que no manda: <code>fecha</code>");
    expect(p).toContain("distinto nombre: <code>horaInicio ↔ hora_inicio</code>");
    expect(p).toContain("Cuerpo: la llamada manda un tipo sin campos que comparar <small>1 llamada · <code>FormData</code></small>");
    // Una deriva sin la comparación (calculada antes) lo dice en vez de mostrar una lista vacía.
    expect(montar(datosDelVisor(graph, [], undefined, deriva)).pagina()).toContain("no trae la comparación de campos");
    // Un índice anterior: el motivo se lee en la sección, no solo en los avisos.
    const viejo = { ...conCampos, camposQueNoCoinciden: [], avisos: ["el índice de repo-a no trae los campos de las llamadas (se indexó antes de registrarlos): corré `flowbrain index`"] };
    expect(montar(datosDelVisor(graph, [], undefined, viejo)).pagina()).toMatch(/Campos que no coinciden <small>1<\/small><\/h3><\/summary><p class="aviso">el índice de repo-a no trae los campos/);
  });

  it("sin índice de código explica qué hace falta", () => {
    expect(derivaDelVisor(undefined)).toBeNull();
    expect(montar(datosDelVisor(graph)).pagina()).toContain("No hay índice de código");
  });
});

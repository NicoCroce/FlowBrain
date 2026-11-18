import { describe, expect, it } from "vitest";
import { compile, dependenciasDelGrafo, dependeDe, impacto, renderIndex, type Fuente } from "../src/index.js";

/** Páginas mínimas escritas a mano: un proyecto con colas y con tipos de nodo propios. */
const pagina = (ruta: string, fm: string[]): Fuente => ({ ruta, contenido: ["---", ...fm, "---", "# x", ""].join("\n") });
const paginas: Fuente[] = [
  pagina("technology/repo-a.md", ["id: repo-a", "tipo: repo", "nombre: a", "resumen: Repo."]),
  pagina("technology/svc-pagos.md", ["id: svc-pagos", "tipo: svc", "nombre: pagos", "resumen: Cobra.", "vive_en: [repo-a]", "relaciones:", "  - {verbo: publica_en, destino: queue-pago-confirmado}"]),
  pagina("technology/svc-reservas.md", ["id: svc-reservas", "tipo: svc", "nombre: reservas", "resumen: Reserva.", "vive_en: [repo-a]", "relaciones:", "  - {verbo: consume_de, destino: queue-pago-confirmado}"]),
  pagina("technology/svc-auditoria.md", ["id: svc-auditoria", "tipo: svc", "nombre: auditoria", "resumen: Audita.", "vive_en: [repo-a]", "relaciones:", "  - {verbo: publica_en, destino: queue-pago-confirmado}"]),
  pagina("technology/queue-pago-confirmado.md", ["id: queue-pago-confirmado", "tipo: queue", "nombre: pago.confirmado", "resumen: Evento."]),
  // Un tipo propio: un job programado que escribe en una tabla y llama a un servicio.
  pagina("technology/job-cierre-diario.md", ["id: job-cierre-diario", "tipo: job", "nombre: Cierre diario", "resumen: Cierra la caja.", "relaciones:", "  - {verbo: escribe_en, destino: tabla-caja}", "  - {verbo: llama_a, destino: svc-pagos}"]),
  pagina("technology/tabla-caja.md", ["id: tabla-caja", "tipo: tabla", "nombre: caja", "resumen: Caja."]),
];

describe("proyecto con colas y tipos propios", () => {
  const s = compile({ paginas, contratos: [], archivos: [] });
  const deps = dependenciasDelGrafo(s.graph, s.funcionalidades ?? []);
  const ids = (nv: Array<Array<{ id: string }>>) => nv.map((n) => n.map((x) => x.id));

  it("compila un tipo de nodo propio y lo lista en el índice", () => {
    expect(s.graph.nodes.find((n) => n.id === "job-cierre-diario")?.tipo).toBe("job");
    expect(renderIndex(s.graph)).toMatch(/## job\n\n.*job-cierre-diario/);
  });

  it("si cambia quien publica, se ven afectados los que consumen, no los demás que publican", () => {
    expect(ids(impacto(deps, "svc-pagos"))).toEqual([["job-cierre-diario", "queue-pago-confirmado"], ["svc-reservas"]]);
    // Si cambia la cola, todos: los que publican y los que consumen.
    expect(ids(impacto(deps, "queue-pago-confirmado"))[0]).toEqual(["svc-auditoria", "svc-pagos", "svc-reservas"]);
  });

  it("quien consume depende de quienes publican; el tipo propio tiene impacto y dependencias", () => {
    const tipo = (id: string) => s.graph.nodes.find((n) => n.id === id)?.tipo;
    expect(ids(dependeDe(deps, "svc-reservas", tipo))).toEqual([["queue-pago-confirmado"], ["svc-auditoria", "svc-pagos"]]);
    expect(ids(impacto(deps, "tabla-caja"))).toEqual([["job-cierre-diario"]]);
    expect(ids(dependeDe(deps, "job-cierre-diario", tipo))).toEqual([["svc-pagos", "tabla-caja"]]);
  });
});

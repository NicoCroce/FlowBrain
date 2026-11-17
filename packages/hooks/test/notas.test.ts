import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anotar, bloqueReglas, extraerNotas, hookSessionEnd, notasDeTranscript } from "../src/index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flowbrain-notas-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("extraerNotas", () => {
  it("reconoce la marca con ids de página y generados, viñetas y backticks", () => {
    const t = [
      "Listo, cambié el cliente.",
      "flowbrain-nota svc-payments: ya no llama a la pasarela directo, usa una cola",
      "- `flowbrain-nota svc-bff:POST:/checkout: ahora devuelve 202`",
      "> flowbrain-nota ext-pasarela: cambió el host a api2",
      "texto con flowbrain-nota en el medio: no cuenta",
    ].join("\n");
    expect(extraerNotas(t)).toEqual([
      { id: "svc-payments", texto: "ya no llama a la pasarela directo, usa una cola" },
      { id: "svc-bff:POST:/checkout", texto: "ahora devuelve 202" },
      { id: "ext-pasarela", texto: "cambió el host a api2" },
    ]);
  });
});

describe("hook SessionEnd", () => {
  const transcript = [
    { type: "user", message: { content: "flowbrain-nota svc-x: esto lo escribió el usuario, no cuenta" } },
    { type: "assistant", message: { content: [{ type: "text", text: "flowbrain-nota svc-payments: usa una cola" }, { type: "tool_use", name: "Bash" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "flowbrain-nota svc-payments: usa una cola" }] } },
    "línea rota {",
    { type: "assistant", message: { content: [{ type: "text", text: "flowbrain-nota tabla-pagos: tiene columna nueva `moneda`" }] } },
  ]
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
    .join("\n");

  it("solo toma notas del asistente, ignora líneas rotas y no duplica", () => {
    expect(notasDeTranscript(transcript)).toEqual([
      { id: "svc-payments", texto: "usa una cola" },
      { id: "svc-payments", texto: "usa una cola" },
      { id: "tabla-pagos", texto: "tiene columna nueva `moneda`" },
    ]);
  });

  it("escribe _drafts/notas/<id>.md y es idempotente", async () => {
    const t = join(dir, "t.jsonl");
    await writeFile(t, transcript);
    const brain = join(dir, "brain");
    expect(await hookSessionEnd({ session_id: "abc", transcript_path: t }, brain)).toEqual(["_drafts/notas/svc-payments.md", "_drafts/notas/tabla-pagos.md"]);
    expect(await readFile(join(brain, "_drafts/notas/svc-payments.md"), "utf8")).toBe("# Notas sobre `svc-payments`\n\n- usa una cola (sesión abc)\n");
    expect(await hookSessionEnd({ session_id: "abc", transcript_path: t }, brain)).toEqual([]);
    await anotar(brain, [{ id: "svc-payments", texto: "otra cosa" }], "manual");
    expect(await readFile(join(brain, "_drafts/notas/svc-payments.md"), "utf8")).toBe("# Notas sobre `svc-payments`\n\n- usa una cola (sesión abc)\n- otra cosa (manual)\n");
  });

  it("los ids generados se guardan con un nombre de archivo seguro", async () => {
    expect(await anotar(dir, [{ id: "svc-bff:POST:/checkout", texto: "x" }], "manual")).toEqual(["_drafts/notas/svc-bff_POST_checkout.md"]);
  });

  it("el bloque de reglas enseña la marca", () => {
    expect(bloqueReglas()).toContain("flowbrain-nota <id-del-nodo>: <qué cambió>");
  });
});

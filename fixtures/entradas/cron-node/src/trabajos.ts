import { enviarResumen } from "./avisos";
import { PedidosRepo } from "./pedidos.repo";

export interface Trabajo {
  name: string;
}
export const defineJob = (name: string): Trabajo => ({ name });
export const CONCILIAR = defineJob("conciliar");

export interface Registro {
  register(job: Trabajo, h: { handle: () => unknown }): void;
}
export interface Programador {
  schedule(job: Trabajo, payload: object, op: { schedulerId: string; everyMs: number }): Promise<void>;
}
interface Config {
  INTERVALO_CONCILIACION_MS: number;
}
interface Agenda {
  define(nombre: string, f: () => unknown): void;
  every(cuando: string, nombre: string): void;
}
interface Cola {
  process(nombre: string, f: () => unknown): void;
  add(nombre: string, datos: object, op: object): void;
}

/** Un programador propio sobre una cola: la clave del trabajo une el horario con quien lo atiende. */
export class Conciliacion {
  constructor(
    private readonly registro: Registro,
    private readonly programador: Programador,
    private readonly config: Config,
    private readonly repo: PedidosRepo,
  ) {}

  iniciar() {
    this.registro.register(CONCILIAR, { handle: () => this.conciliar() });
    const { INTERVALO_CONCILIACION_MS: everyMs } = this.config;
    return this.programador.schedule(CONCILIAR, {}, { schedulerId: "conciliacion", everyMs });
  }

  conciliar() {
    return this.repo.contar();
  }
}

export function agenda(a: Agenda) {
  a.define("enviar-resumen", enviarResumen);
  a.every("5 minutes", "enviar-resumen");
}

export function bull(cola: Cola, repo: PedidosRepo) {
  cola.process("purgar", () => repo.borrarViejos());
  cola.add("purgar", {}, { repeat: { cron: "0 4 * * *" } });
}

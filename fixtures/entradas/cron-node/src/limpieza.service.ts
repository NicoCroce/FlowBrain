import { Injectable } from "@nestjs/common";
import { Cron, CronExpression, Interval, Timeout } from "@nestjs/schedule";
import { PedidosRepo } from "./pedidos.repo";

@Injectable()
export class LimpiezaService {
  constructor(private readonly repo: PedidosRepo) {}

  @Cron("0 3 * * *", { name: "limpiar-pedidos" })
  limpiar() {
    return this.repo.borrarViejos();
  }

  @Cron(CronExpression.EVERY_HOUR)
  resumen() {
    return this.repo.resumir();
  }

  @Interval(60000)
  latido() {
    return this.repo.contar();
  }

  @Timeout("calentar", 5000)
  calentar() {
    return this.repo.contar();
  }
}

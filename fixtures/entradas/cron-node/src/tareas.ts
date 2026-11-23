import cron from "node-cron";
import schedule from "node-schedule";
import { CronJob } from "cron";
import { PrismaClient } from "@prisma/client";
import { avisar } from "./avisos";
import { PedidosRepo } from "./pedidos.repo";

const repo = new PedidosRepo(new PrismaClient());

export function arrancar() {
  cron.schedule("*/5 * * * *", () => repo.contar());
  schedule.scheduleJob("reporte-diario", "0 8 * * *", avisar);
  new CronJob("0 0 1 * *", () => {
    avisar();
    repo.borrarViejos();
  });
  // No es un horario: un `schedule` cualquiera no cuenta.
  agendar("mañana", () => repo.contar());
}

function agendar(cuando: string, f: () => unknown) {
  return { cuando, f };
}

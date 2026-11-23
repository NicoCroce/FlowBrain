import { PrismaClient } from "@prisma/client";

export class PedidosRepo {
  constructor(private readonly db: PrismaClient) {}

  borrarViejos() {
    return this.db.pedido.deleteMany({});
  }

  contar() {
    return this.db.pedido.count();
  }

  resumir() {
    return this.db.resumen.create({ data: { id: "1", dia: "hoy" } });
  }
}

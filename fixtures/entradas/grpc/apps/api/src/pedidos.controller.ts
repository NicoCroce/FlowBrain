import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { PrismaClient } from "@prisma/client";

@Controller()
export class PedidosController {
  constructor(private readonly db: PrismaClient) {}

  @GrpcMethod("Pedidos", "Crear")
  crear(datos: { productoId: string }) {
    return this.db.pedido.create({ data: { id: datos.productoId } });
  }

  @GrpcMethod("Pedidos")
  listar() {
    return this.db.pedido.findMany();
  }
}

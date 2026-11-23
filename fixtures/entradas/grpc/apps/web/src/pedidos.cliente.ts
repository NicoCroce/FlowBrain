import type { ClientGrpc } from "@nestjs/microservices";
import * as grpc from "@grpc/grpc-js";

interface PedidosGrpc {
  crear(p: { productoId: string }): unknown;
  listar(f: { pagina: number }): unknown;
  cancelar(p: { id: string }): unknown;
}

/** Cliente de NestJS: `getService` por el nombre del servicio del `.proto`. */
export class PedidosCliente {
  private pedidos!: PedidosGrpc;

  constructor(private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.pedidos = this.client.getService<PedidosGrpc>("Pedidos");
  }

  crear(productoId: string) {
    return this.pedidos.crear({ productoId });
  }

  listar() {
    return this.pedidos.listar({ pagina: 1 });
  }

  cancelar(id: string) {
    return this.pedidos.cancelar({ id });
  }
}

declare const paquete: any;
/** Cliente de grpc-js: el constructor del servicio, con la dirección. */
const stock = new paquete.pedidos.v1.Stock("stock:50051", grpc.credentials.createInsecure());

export function reservar(id: string) {
  stock.reservar({ id }, () => undefined);
}

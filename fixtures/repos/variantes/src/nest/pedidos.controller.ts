import { Body, Controller, Get, Post } from "@nestjs/common";

interface CrearPedido {
  sku: string;
}
interface Pedido {
  id: string;
}

@Controller("pedidos")
export class PedidosController {
  @Get(":id")
  async uno(): Promise<Pedido> {
    return { id: "1" };
  }

  @Post()
  crear(@Body() dto: CrearPedido): Pedido {
    return { id: dto.sku };
  }
}

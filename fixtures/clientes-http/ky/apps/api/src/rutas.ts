import { Router, type Request, type Response } from "express";

export interface CrearPedido {
  productoId: string;
  cantidad: number;
}

export interface PedidoCreado {
  id: string;
  estado: string;
  total: number;
}

export interface Filtro {
  pagina: number;
  orden?: string;
}

export async function crear(req: Request<{}, PedidoCreado, CrearPedido>, res: Response<PedidoCreado>) {
  res.json({ id: "1", estado: "nuevo", total: req.body.cantidad });
}

export async function listar(_req: Request<{}, PedidoCreado[], null, Filtro>, res: Response<PedidoCreado[]>) {
  res.json([]);
}

export async function ver(_req: Request, res: Response<PedidoCreado>) {
  res.json({ id: "1", estado: "nuevo", total: 0 });
}

export async function cambiar(_req: Request, res: Response) {
  res.end();
}

export const router = Router();
router.post("/pedidos", crear);
router.get("/pedidos", listar);
router.get("/pedidos/:id", ver);
router.put("/pedidos/:id", cambiar);
router.delete("/pedidos/:id", cambiar);

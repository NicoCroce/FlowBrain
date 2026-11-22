import { Router, type Request, type Response } from "express";

export interface CrearPedido {
  productoId: string;
  cantidad: number;
  direccion: string;
  nota?: string;
}

export interface PedidoCreado {
  id: string;
  estado: string;
  total: number;
}

export interface Listado {
  items: unknown[];
  total: number;
  pagina: number;
}

export interface PedidoDetalle {
  id: string;
  estado: string;
  total: number;
  entrega_estimada: string;
}

export async function crear(req: Request<{}, PedidoCreado, CrearPedido>, res: Response<PedidoCreado>) {
  res.json({ id: "1", estado: "nuevo", total: req.body.cantidad });
}

export async function listar(_req: Request, res: Response<Listado>) {
  res.json({ items: [], total: 0, pagina: 1 });
}

export async function subir(_req: Request<{ id: string }, null, unknown>, res: Response) {
  res.end();
}

export async function ver(_req: Request, res: Response<PedidoDetalle>) {
  res.json({ id: "1", estado: "nuevo", total: 0, entrega_estimada: "mañana" });
}

export const router = Router();
router.post("/pedidos", crear);
router.get("/pedidos", listar);
router.post("/pedidos/:id/foto", subir);
router.get("/pedidos/:id", ver);

export interface Confirmacion {
  motivo: string;
}

export async function confirmar(_req: Request<{ id: string }, null, Confirmacion>, res: Response) {
  res.end();
}

router.post("/pedidos/:id/confirmar", confirmar);

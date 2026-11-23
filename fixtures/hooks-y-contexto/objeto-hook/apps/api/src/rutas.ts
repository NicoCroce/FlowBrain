import { Router, type Request, type Response } from "express";

export async function listar(_req: Request, res: Response) {
  res.json([]);
}

export async function crear(_req: Request, res: Response) {
  res.json({});
}

export async function borrar(_req: Request, res: Response) {
  res.end();
}

export async function otp(_req: Request, res: Response) {
  res.end();
}

export const router = Router();
router.get("/api/pedidos", listar);
router.post("/api/pedidos", crear);
router.delete("/api/pedidos/:id", borrar);
router.post("/api/otp", otp);

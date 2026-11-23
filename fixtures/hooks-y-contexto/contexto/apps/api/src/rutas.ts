import { Router, type Request, type Response } from "express";

export async function login(_req: Request, res: Response) {
  res.json({});
}

export async function logout(_req: Request, res: Response) {
  res.end();
}

export async function agregar(_req: Request, res: Response) {
  res.end();
}

export async function vaciar(_req: Request, res: Response) {
  res.end();
}

export async function permisos(_req: Request, res: Response) {
  res.json([]);
}

export async function token(_req: Request, res: Response) {
  res.end();
}

export const router = Router();
router.post("/api/login", login);
router.post("/api/logout", logout);
router.post("/api/carrito/:id", agregar);
router.delete("/api/carrito", vaciar);
router.get("/api/permisos", permisos);
router.put("/api/token", token);

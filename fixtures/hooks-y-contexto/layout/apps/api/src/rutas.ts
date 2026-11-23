import { Router, type Request, type Response } from "express";

export async function sesion(_req: Request, res: Response) {
  res.json({ nombre: "x" });
}

export async function permisos(_req: Request, res: Response) {
  res.json([]);
}

export async function usuarios(_req: Request, res: Response) {
  res.json([]);
}

export async function listas(_req: Request, res: Response) {
  res.json([]);
}

export const router = Router();
router.get("/api/sesion", sesion);
router.get("/api/permisos", permisos);
router.get("/api/usuarios", usuarios);
router.get("/api/listas", listas);

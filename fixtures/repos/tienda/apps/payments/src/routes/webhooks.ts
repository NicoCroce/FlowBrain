import { Router, type Request, type Response } from "express";

/**
 * La pasarela notifica el resultado del cobro.
 */

export async function postWebhookPasarela(req: Request<{}, void, EventoPasarela>, res: Response) {
  void req.body;
  res.status(204).end();
}

export const router = Router();
router.post("/webhooks/pasarela", postWebhookPasarela);

export interface EventoPasarela {
  cargoId: string;
  estado: 'aprobado' | 'rechazado';
  tipo: string;
}

import { Router, type Request, type Response } from "express";
import { PrismaClient } from "@prisma/client";
import { cobrar } from "../clients/pasarela.js";

const prisma = new PrismaClient();

/**
 * Cobra el pedido en la pasarela y lo registra como pendiente.
 * La confirmación final llega por webhook.
 */

export async function postPayment(req: Request<{}, Pago, CrearPagoRequest>, res: Response<Pago>) {
  const { pedidoId, monto, moneda, medioDePago } = req.body;
  const cargo = await cobrar({ monto, moneda, token: medioDePago });
  if (!cargo.ok) {
    res.status(402).end();
    return;
  }

  // Se guarda como pendiente: la pasarela confirma por webhook.
  const pago = await prisma.pago.create({ data: { pedidoId, monto, moneda, estado: "pendiente" } });
  res.json(pago);
}

export const router = Router();
router.post("/payments", postPayment);

export interface CrearPagoRequest {
  medioDePago: string;
  moneda: string;
  monto: number;
  pedidoId: string;
}

export interface Pago {
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  id: string;
  moneda: string;
  monto: number;
  pedidoId: string;
}

import { Router, type Request, type Response } from "express";
import { crearPago } from "../clients/payments.js";

export interface CheckoutRequest {
  carritoId: string;
  medioDePago: string;
}

export interface CheckoutResponse {
  estado: 'aprobado' | 'rechazado' | 'pendiente';
  pedidoId: string;
}

export async function postCheckout(req: Request<{}, CheckoutResponse, CheckoutRequest>, res: Response<CheckoutResponse>) {
  const pago = await crearPago({ pedidoId: req.body.carritoId, monto: 100, moneda: "ARS", medioDePago: req.body.medioDePago });
  res.json({ pedidoId: pago.pedidoId, estado: pago.estado });
}

export const router = Router();
router.post("/checkout", postCheckout);

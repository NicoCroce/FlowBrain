import axios from "axios";

const PAYMENTS_URL = "http://payments:3002";

interface PagoCreado {
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  pedidoId: string;
}

export async function crearPago(pedido: { pedidoId: string; monto: number; moneda: string; medioDePago: string }): Promise<PagoCreado> {
  const res = await axios.post<PagoCreado>(`${PAYMENTS_URL}/payments`, pedido);
  return res.data;
}

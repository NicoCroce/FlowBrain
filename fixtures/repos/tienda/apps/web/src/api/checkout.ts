export interface CheckoutRequest {
  carritoId: string;
  medioDePago: string;
}

const BFF_URL = import.meta.env.VITE_BFF_URL;

export async function confirmarCheckout(pedido: CheckoutRequest): Promise<unknown> {
  const res = await fetch(`${BFF_URL}/checkout`, { method: "POST", body: JSON.stringify(pedido) });
  return res.json();
}

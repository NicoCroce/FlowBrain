export interface Pedido {
  id: string;
  total: number;
}

export const api = {
  crear: (p: Pedido) => fetch("/api/pedidos", { method: "POST", body: JSON.stringify(p) }),
};

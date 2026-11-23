import ky from "ky";

export interface NuevoPedido {
  productoId: string;
  cantidad: number;
}

export interface Pedido {
  id: string;
  estado: string;
  total: number;
}

const api = ky.create({ prefixUrl: import.meta.env.VITE_API_URL });
const conToken = api.extend({ headers: { Authorization: "x" } });

export const listar = (pagina: number) => api.get("pedidos", { searchParams: { pagina } }).json<Pedido[]>();
export const ver = (id: string) => api.get<Pedido>(`pedidos/${id}`).json();
export const crear = (p: NuevoPedido) => api.post("pedidos", { json: p }).json<Pedido>();
export const cambiar = (id: string) => conToken(`pedidos/${id}`, { method: "put", json: { estado: "listo" } });
export const borrar = (id: string) => ky.delete(`https://pedidos.example.com/pedidos/${id}`);
export const armada = (destino: () => string) => ky.get(destino());

import { ofetch } from "ofetch";

export interface NuevoPedido {
  productoId: string;
  cantidad: number;
}

export interface Pedido {
  id: string;
  estado: string;
  total: number;
}

const api = ofetch.create({ baseURL: process.env.API_URL });

export const listar = (pagina: number) => $fetch<Pedido[]>("/pedidos", { baseURL: process.env.API_URL, query: { pagina } });
export const crear = (p: NuevoPedido) => api<Pedido>("/pedidos", { method: "POST", body: p });
export const borrar = (id: string) => api(`/pedidos/${id}`, { method: "DELETE" });
export const useDetalle = (id: string) => useFetch<Pedido>(() => `/pedidos/${id}`, { baseURL: process.env.API_URL });
export const useListado = () => useAsyncData("pedidos", () => $fetch<Pedido[]>("/pedidos", { baseURL: process.env.API_URL }));
export const cambiar = (id: string) => useLazyFetch(`/pedidos/${id}`, { method: "PUT", body: { estado: "listo" }, baseURL: process.env.API_URL });
export const armada = (destino: () => string) => $fetch(destino());

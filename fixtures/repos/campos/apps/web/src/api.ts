import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

export interface NuevoPedido {
  productoId: string;
  cantidad: number;
  nota?: string;
  cupon: string;
}

export interface Pedido {
  id: string;
  estado: string;
  total: number;
  entregaEstimada: string;
}

export interface FiltroPedidos {
  pagina: number;
  orden?: string;
}

export async function crearPedido(p: NuevoPedido) {
  const { data } = await api.post<Pedido>("/pedidos", p);
  return data;
}

export async function listarPedidos(f: FiltroPedidos) {
  const { data } = await api.get<{ items: Pedido[]; total: number }>("/pedidos", { params: f });
  return data;
}

export async function subirFoto(id: string, archivo: FormData) {
  await api.post(`/pedidos/${id}/foto`, archivo);
}

export async function verPedido(id: string) {
  const { data } = await api.get<Pedido>(`/pedidos/${id}`);
  return data;
}

export async function confirmarPedido(id: string) {
  await api.post(`/pedidos/${id}/confirmar`);
}

export async function buscarPedidos(texto: string, orden?: string) {
  const { data } = await api.get<{ items: Pedido[]; total: number }>(`/buscar?q=${texto}&limite=10`, orden ? { params: { orden } } : undefined);
  return data;
}

export async function olvideClave(email: string) {
  await api.put("/clave", `email=${encodeURIComponent(email)}`);
}

interface Envelope<T> {
  ok: boolean;
  data: T;
}

async function pedir<T>(url: string): Promise<T> {
  const { data } = await api.get<Envelope<T>>(url);
  return data.data;
}

async function traer<T>(url: string) {
  return api.get<T>(url);
}

export const pedidoEnvuelto = () => pedir<Pedido>("/pedidos/1");
export const pedidoDirecto = () => traer<Pedido>("/pedidos/2");

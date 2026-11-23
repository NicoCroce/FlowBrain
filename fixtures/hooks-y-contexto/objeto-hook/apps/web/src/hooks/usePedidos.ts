import { useState } from "react";
import { api, type Pedido } from "../api";

/** El hook arma el objeto: la pantalla lo desestructura o usa sus métodos. */
export function usePedidos() {
  const [lista, setLista] = useState<Pedido[]>([]);
  const cargar = async () => {
    const r = await fetch("/api/pedidos");
    setLista(await r.json());
  };
  async function guardar(p: Pedido) {
    await api.crear(p);
  }
  return {
    lista,
    cargar,
    guardar,
    borrar: (id: string) => fetch(`/api/pedidos/${id}`, { method: "DELETE" }),
  };
}

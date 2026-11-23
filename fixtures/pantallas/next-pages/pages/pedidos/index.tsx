import { useRouter } from "next/router";

export async function cargarPedidos() {
  const r = await fetch("/api/pedidos");
  return r.json();
}

export default function Pedidos() {
  const router = useRouter();
  const abrir = (id: string) => router.push(`/pedidos/${id}`);
  cargarPedidos();
  return <button onClick={() => abrir("1")}>Ver</button>;
}

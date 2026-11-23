import { router } from "expo-router";

async function cargar(id: string) {
  const r = await fetch(`/api/productos/${id}`);
  return r.json();
}

export default function Producto() {
  cargar("1");
  const volver = () => router.push("/perfil");
  return null;
}

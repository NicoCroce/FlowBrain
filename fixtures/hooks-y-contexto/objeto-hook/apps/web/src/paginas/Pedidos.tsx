import { useEffect } from "react";
import { usePedidos } from "../hooks/usePedidos";

function enviar(o: { grabar: (p: { id: string; total: number }) => Promise<void> }) {
  return o.grabar({ id: "1", total: 0 });
}

export function Pedidos() {
  const { lista, cargar, guardar: grabar } = usePedidos();
  useEffect(() => {
    cargar();
  }, []);
  return <button onClick={() => enviar({ grabar })} />;
}

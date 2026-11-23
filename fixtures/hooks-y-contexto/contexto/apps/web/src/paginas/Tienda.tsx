import { useContext } from "react";
import { CarritoContext, useCarrito } from "../contexto/Carrito";

export function Tienda() {
  const carrito = useContext(CarritoContext)!;
  const { vaciar } = useCarrito();
  return (
    <div>
      <button onClick={() => carrito.agregar("1")} />
      <button onClick={vaciar} />
    </div>
  );
}

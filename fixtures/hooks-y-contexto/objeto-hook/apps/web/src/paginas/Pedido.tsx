import { usePedidos } from "../hooks/usePedidos";
import { useOtp } from "../hooks/useOtp";

export function Pedido({ id }: { id: string }) {
  const pedidos = usePedidos();
  const otp = useOtp();
  return (
    <div>
      <button onClick={() => pedidos.borrar(id)} />
      <button onClick={() => otp.abrir()} />
      <button onClick={() => otp.reenviar()} />
    </div>
  );
}

import { useContext } from "react";
import { SesionContext } from "../contexto/SesionContext";

export function Perfil() {
  const sesion = useContext(SesionContext);
  return <button onClick={sesion.cerrar}>{sesion.usuario}</button>;
}

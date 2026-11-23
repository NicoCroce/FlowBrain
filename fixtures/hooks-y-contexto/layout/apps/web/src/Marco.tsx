import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

/** Layout de las rutas de adentro: pide la sesión y dibuja la pantalla en el <Outlet />. */
export function Marco() {
  const [nombre, setNombre] = useState("");
  useEffect(() => {
    fetch("/api/sesion").then((r) => r.json()).then((s) => setNombre(s.nombre));
  }, []);
  return (
    <main>
      <header>{nombre}</header>
      <Outlet />
    </main>
  );
}

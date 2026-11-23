import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Usuarios } from "./Usuarios";
import { Usuario } from "./Usuario";

/** Montada en /admin/*: sus rutas son relativas a esa (rutas descendientes de React Router 6). */
export function Admin() {
  useEffect(() => {
    fetch("/api/permisos");
  }, []);
  return (
    <Routes>
      <Route path="usuarios" element={<Usuarios />} />
      <Route path="usuarios/:uid" element={<Usuario />} />
    </Routes>
  );
}

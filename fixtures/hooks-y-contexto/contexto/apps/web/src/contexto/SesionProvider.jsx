import { useCallback, useContext, useState } from "react";
import { SesionContext } from "./SesionContext";
import { usePermisos } from "./usePermisos";

/** Store de la sesión: las funciones que llaman al back viven acá y se publican en el contexto. */
export function SesionProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const permisos = usePermisos();
  const guardarToken = async (t) => {
    await fetch("/api/token", { method: "PUT", body: t });
  };
  const entrar = async (datos) => {
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify(datos) });
    const u = await r.json();
    await guardarToken(u.token);
    setUsuario(u);
  };
  const salir = useCallback(() => {
    fetch("/api/logout", { method: "POST" });
    setUsuario(null);
  }, []);
  return <SesionContext.Provider value={{ usuario, permisos, entrar, cerrar: salir }}>{children}</SesionContext.Provider>;
}

/** Hook del contexto: el Provider es obligatorio. */
export function useSesion() {
  const c = useContext(SesionContext);
  if (!c) throw new Error("useSesion fuera de SesionProvider");
  return c;
}

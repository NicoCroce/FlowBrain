import { useEffect, useState } from "react";

export function usePermisos() {
  const [permisos, setPermisos] = useState([]);
  useEffect(() => {
    fetch("/api/permisos").then((r) => r.json()).then(setPermisos);
  }, []);
  return permisos;
}

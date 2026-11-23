import { useEffect } from "react";

export function Usuarios() {
  useEffect(() => {
    fetch("/api/usuarios");
  }, []);
  return <ul />;
}

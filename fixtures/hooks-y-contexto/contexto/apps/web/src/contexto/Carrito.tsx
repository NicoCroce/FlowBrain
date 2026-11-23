import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

interface Carrito {
  agregar(id: string): Promise<void>;
  vaciar(): void;
}

export const CarritoContext = createContext<Carrito | null>(null);

export function CarritoProvider({ children }: { children: ReactNode }) {
  const agregar = useCallback(async (id: string) => {
    await fetch(`/api/carrito/${id}`, { method: "POST" });
  }, []);
  const valor = useMemo(
    () => ({
      agregar,
      vaciar: () => {
        fetch("/api/carrito", { method: "DELETE" });
      },
    }),
    [agregar],
  );
  return <CarritoContext.Provider value={valor}>{children}</CarritoContext.Provider>;
}

export const useCarrito = () => useContext(CarritoContext)!;

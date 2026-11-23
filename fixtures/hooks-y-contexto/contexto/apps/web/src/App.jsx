import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SesionProvider } from "./contexto/SesionProvider";
import { CarritoProvider } from "./contexto/Carrito";
import { Login } from "./paginas/Login";
import { Perfil } from "./paginas/Perfil";
import { Tienda } from "./paginas/Tienda";

export function App() {
  return (
    <SesionProvider>
      <CarritoProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/tienda" element={<Tienda />} />
          </Routes>
        </BrowserRouter>
      </CarritoProvider>
    </SesionProvider>
  );
}

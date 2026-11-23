import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Pedidos } from "./paginas/Pedidos";
import { Pedido } from "./paginas/Pedido";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/pedidos/:id" element={<Pedido id="1" />} />
      </Routes>
    </BrowserRouter>
  );
}

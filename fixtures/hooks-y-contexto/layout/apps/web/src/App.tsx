import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Marco } from "./Marco";
import { Inicio } from "./Inicio";
import { Admin } from "./Admin";
import { Torneo } from "./Torneo";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Marco />}>
          <Route path="/" element={<Inicio />} />
          <Route path="/admin/*" element={<Admin />} />
        </Route>
        <Route path="/torneos/:id" element={<Torneo />} />
      </Routes>
    </BrowserRouter>
  );
}

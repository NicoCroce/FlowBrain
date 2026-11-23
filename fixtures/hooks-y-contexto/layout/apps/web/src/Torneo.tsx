import { Route, Routes, Switch, useRouteMatch } from "react-router-dom";
import { Listas } from "./Listas";
import { Huerfana } from "./Huerfana";

/** React Router 5: las rutas hijas se arman con el `path` con el que se montó esta pantalla. */
export function Torneo() {
  const { path } = useRouteMatch();
  return (
    <Switch>
      <Route path={`${path}/listas`}>
        <Listas />
      </Route>
    </Switch>
  );
}

/** Rutas relativas en un componente que ninguna ruta monta: no se sabe bajo qué ruta quedan. */
export function Suelto() {
  return (
    <Routes>
      <Route path="perdida" element={<Huerfana />} />
    </Routes>
  );
}

/** React Router 5 con el `url` de un componente que ninguna ruta monta: queda pendiente. */
export function Perdido() {
  const { url } = useRouteMatch();
  return (
    <Route path={`${url}/x`}>
      <Huerfana />
    </Route>
  );
}

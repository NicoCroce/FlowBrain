import http from "@http/instancia";

const RUTAS = {
  perfil: "/perfil",
} as const;

export async function perfil() {
  return http.get(RUTAS.perfil);
}

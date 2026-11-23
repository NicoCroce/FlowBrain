import { buscarUsuario } from "../../utils/usuarios";

export default defineEventHandler((event: any) => {
  return buscarUsuario(event.context.params.id);
});

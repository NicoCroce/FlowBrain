import { useSesion } from "../contexto/SesionProvider";

export function Login() {
  const { entrar, recargar } = useSesion();
  return (
    <form onSubmit={() => entrar({ usuario: "a" })}>
      <button onClick={() => recargar()} />
    </form>
  );
}

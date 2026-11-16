const base = process.env.API_URL;

export const usuario = (id: string) => fetch(`${base}/usuarios/${id}`);
export const entrar = () => fetch(`${base}/login`, { method: "POST" });

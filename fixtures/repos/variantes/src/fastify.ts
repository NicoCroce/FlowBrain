import Fastify from "fastify";

interface Login {
  usuario: string;
}
interface Sesion {
  token: string;
}

const app = Fastify();
app.post<{ Body: Login; Reply: Sesion }>("/login", async () => ({ token: "t" }));

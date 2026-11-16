import axios from "axios";
import { api } from "./cliente.js";

interface Alta {
  nombre: string;
}

export async function usar(id: string, alta: Alta) {
  await api.get(`/usuarios/${id}`);
  await api.post("/usuarios", alta);
  await axios({ url: "https://hooks.slack.example/services/x", method: "post", data: alta });
  await fetch("/api/salud");
  await fetch(`https://${process.env.HOST}/x`);
}

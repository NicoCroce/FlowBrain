import { buscar } from "../repo";

export const listar = async () => ({ statusCode: 200, body: JSON.stringify(await buscar()) });

export async function obtener(evento: { pathParameters: { id: string } }) {
  return { statusCode: 200, body: evento.pathParameters.id };
}

export const crear = async () => ({ statusCode: 201, body: "" });

export const todo = async () => ({ statusCode: 404, body: "" });

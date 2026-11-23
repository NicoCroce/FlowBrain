export async function procesar(evento: { Records: unknown[] }) {
  return evento.Records.length;
}

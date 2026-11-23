export function descontar(id: string) {
  return fetch(`https://inventario.example.com/items/${id}`, { method: "DELETE" });
}

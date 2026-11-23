async function producto(id: string) {
  const r = await fetch(`/api/productos/${id}`);
  return r.json();
}

export default async function Producto({ params }: any) {
  const p = await producto(params.id);
  return <h1>{p.nombre}</h1>;
}

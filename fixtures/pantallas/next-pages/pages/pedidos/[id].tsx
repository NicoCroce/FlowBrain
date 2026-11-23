export async function getServerSideProps({ params }: any) {
  const r = await fetch(`/api/pedidos/${params.id}`);
  return { props: { pedido: await r.json() } };
}

export default function ({ pedido }: any) {
  return <h1>{pedido.id}</h1>;
}

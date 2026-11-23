export async function load({ fetch, params }: any) {
  const r = await fetch(`/api/posts/${params.slug}`);
  return r.json();
}

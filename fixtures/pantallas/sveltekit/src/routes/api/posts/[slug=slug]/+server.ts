export const GET = async ({ params }: any) => {
  return new Response(JSON.stringify({ slug: params.slug }));
};

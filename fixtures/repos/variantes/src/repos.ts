export async function listar(db: any) {
  return db.cliente.findMany();
}

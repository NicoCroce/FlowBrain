export interface CargoPasarela {
  moneda: string;
  monto: number;
  token: string;
}

export async function cobrar(cargo: CargoPasarela): Promise<{ ok: boolean }> {
  const res = await fetch("https://api.pasarela.example/v1/charges", { method: "POST", body: JSON.stringify(cargo) });
  return { ok: res.ok };
}

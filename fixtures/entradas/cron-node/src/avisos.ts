export function avisar() {
  return fetch("https://hooks.example.com/aviso", { method: "POST" });
}

export function enviarResumen() {
  return fetch("https://hooks.example.com/resumen", { method: "POST" });
}

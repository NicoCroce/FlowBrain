export const useOtp = () => {
  const abrir = () => fetch("/api/otp", { method: "POST" });
  const cerrar = () => {};
  return { abrir, cerrar };
};

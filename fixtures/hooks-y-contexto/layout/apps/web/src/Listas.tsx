export function Listas() {
  fetch("/api/listas");
  return <ol />;
}

<script setup lang="ts">
const id = "1";
async function cargar() {
  const r = await fetch(`/api/usuarios/${id}`);
  return r.json();
}
cargar();
</script>

<template>
  <h1>Usuario</h1>
</template>

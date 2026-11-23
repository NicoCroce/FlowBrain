<script setup lang="ts">
async function crear() {
  await fetch("/api/usuarios", { method: "POST", body: JSON.stringify({}) });
}
</script>

<template>
  <button @click="crear">Nuevo</button>
</template>

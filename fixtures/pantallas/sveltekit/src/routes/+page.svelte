<script lang="ts">
  import { goto } from "$app/navigation";
  const ir = () => goto("/ajustes");
</script>

<button on:click={ir}>Ajustes</button>

# flowbrain

Grafo de conocimiento de un sistema de software para agentes de código: funcionalidades, pantallas, endpoints, métodos y tablas de todos los repos de un proyecto, cómo se conectan entre servicios y qué se rompe si algo cambia. Se sirve por MCP, por hooks de Claude Code y por CLI. Ninguna consulta llama a un LLM y cada dato cita su evidencia.

```bash
cd /ruta/al/proyecto
npx flowbrain install
claude mcp add --scope user flowbrain -- npx -y flowbrain serve --sync
```

`install` crea `.flowbrain/` en el proyecto, pregunta dónde están los repositorios, indexa todo, deja el visor en `.flowbrain/flowbrain.html` y los comandos de Claude Code `/flowbrain-study` (estudia cada repo y escribe los extractores que completan el índice), `/flowbrain-index` (la comunicación real entre servicios) y `/flowbrain-features` (las funcionalidades de producto).

Consultas frecuentes:

```bash
flowbrain impact tabla-pedidos          # qué se ve afectado si cambia
git diff | flowbrain risk --diff -      # alcance de un cambio
flowbrain screen /pedidos/{id}          # una pantalla de punta a punta
flowbrain feature feat-checkout         # una funcionalidad de producto
flowbrain coverage                      # cuánto del código quedó conectado
```

Requiere Node ≥ 20. El contrato del grafo está en `SCHEMA.md`.

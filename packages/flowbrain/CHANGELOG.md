# Cambios

## 0.1.0 · 2026-11-24

Primera versión publicada, como `@nicocroce/flowbrain` (el comando es `flowbrain`).

- `flowbrain install`: configura el proyecto, detecta los repositorios, arma uno o varios cerebros, indexa y deja hooks y comandos de Claude Code.
- Parsers determinísticos para TypeScript/JavaScript (React, React Native, Vue, Svelte, Astro, Next, Nest, Express), PHP (Laravel, Symfony), OpenAPI, esquemas de base de datos e infraestructura (Docker, CI, Kubernetes, Helm, Terraform, serverless).
- Extractores del proyecto escritos por el agente y verificados por FlowBrain, para lo que los parsers no entienden.
- Servidor MCP (`flowbrain serve`) con 16 herramientas, más `conexiones` con varios cerebros.
- Varios cerebros en un proyecto con `flowbrain.yaml`: las consultas cruzan entre servicios.
- Visor web en localhost: mapa, funcionalidades, pantallas, contratos, especificaciones, impacto, fidelidad y pedido de tests en lote.
- Comandos de Claude Code `/flowbrain-study`, `/flowbrain-index`, `/flowbrain-features`, `/flowbrain-specs` y `/flowbrain-tests`.
- La gramática de PHP viaja como `.wasm` dentro del paquete: la instalación no compila nada nativo.

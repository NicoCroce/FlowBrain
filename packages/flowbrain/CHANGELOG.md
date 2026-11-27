# Cambios

## 0.2.0 · 2026-11-27

- El menú (`flowbrain`) avisa cuando hay una versión nueva publicada y recomienda actualizar.
- «Actualizar FlowBrain» vuelve a registrar el servidor MCP con la versión nueva (`flowbrain setup --mcp`); si ya tenés la última, lo dice y no reinstala.
- «Analizar el proyecto completo» suma un cuarto paso: deduce las especificaciones de cada funcionalidad.
- Mientras desarrolla, el agente agrega casos de uso y especificaciones al borrador de una funcionalidad nueva y actualiza las de una que cambia.
- Contratos no se rompe con una llamada ambigua: lista los endpoints candidatos de cada llamada pendiente.
- El visor tiene un solo pedido al agente: la bandeja «Pedido (N)» en la barra superior, visible desde cualquier pantalla, y un panel que junta tests y archivos por asociar, con el costo estimado de cada tipo y el total. «Pedir todos» manda un lote por tipo. Lo que ya tenías pedido en cada pantalla se conserva.
- En Especificaciones, «Agrupar en casos de uso», «Escribir casos de uso» y las correcciones (casos marcados como mal y reglas que están mal) ya no abren un recuadro para copiar: se suman al mismo pedido y se mandan en lote con «Pedir todos». El agente solo puede editar las páginas de las funcionalidades, y el visor saca de la lista lo que quedó resuelto.

## 0.1.1 · 2026-11-25

- El README del paquete es el mismo del repo (inglés y castellano), con imágenes y links que funcionan en npm.

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

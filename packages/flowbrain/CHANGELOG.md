# Cambios

## 0.3.0 · 2026-11-27

- En Sin asociar, cada recomendación dice qué tan segura es (alta, media o baja) y por qué, en el idioma del visor. Se puede filtrar por confianza, y «Aceptar las de confianza alta» asocia de una vez las más seguras, con confirmación.
- «Ver código» abre el archivo sin asociar debajo de su fila, sin ir al editor (con el visor servido).
- «Mandar al agente» manda los archivos sin asociar a Claude Code, que solo puede editar las páginas de funcionalidades y librerías de su cerebro y dejar borradores.
- El código compartido se asocia a una librería («Asociar a una librería…»), o se le pide al agente que la cree. A un archivo sin pista se le puede pedir una funcionalidad nueva, como borrador con casos de uso y especificaciones.
- «No es de producto…» marca un archivo o una carpeta (tests, configuración, scripts, generados) con su motivo y lo saca de la lista. La marca queda en `not-product.yaml`, sobrevive a reindexar y se deshace desde la misma pantalla. `sin_asociar` (MCP y `flowbrain unassigned`) cuenta lo marcado y suma la confianza de cada recomendación.
- «Abrir el visor» ya no reusa un visor que corre con una versión anterior de FlowBrain: levanta uno nuevo en el puerto siguiente y avisa dónde está el viejo para cerrarlo.

## 0.2.0 · 2026-11-27

- El menú (`flowbrain`) avisa cuando hay una versión nueva publicada y recomienda actualizar.
- «Actualizar FlowBrain» vuelve a registrar el servidor MCP con la versión nueva (`flowbrain setup --mcp`); si ya tenés la última, lo dice y no reinstala.
- «Analizar el proyecto completo» suma un cuarto paso: deduce las especificaciones de cada funcionalidad.
- Mientras desarrolla, el agente agrega casos de uso y especificaciones al borrador de una funcionalidad nueva y actualiza las de una que cambia.
- Contratos no se rompe con una llamada ambigua: lista los endpoints candidatos de cada llamada pendiente.

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

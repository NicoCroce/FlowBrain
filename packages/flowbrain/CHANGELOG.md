# Cambios

## 0.2.0 · 2026-11-27

- El menú (`flowbrain`) avisa cuando hay una versión nueva publicada y recomienda actualizar.
- «Actualizar FlowBrain» vuelve a registrar el servidor MCP con la versión nueva (`flowbrain setup --mcp`); si ya tenés la última, lo dice y no reinstala.
- «Analizar el proyecto completo» suma un cuarto paso: deduce las especificaciones de cada funcionalidad.
- Mientras desarrolla, el agente agrega casos de uso y especificaciones al borrador de una funcionalidad nueva y actualiza las de una que cambia.
- Contratos no se rompe con una llamada ambigua: lista los endpoints candidatos de cada llamada pendiente.
- El visor tiene un solo pedido al agente: la bandeja «Pedido (N)» en la barra superior, visible desde cualquier pantalla, y un panel que junta tests y archivos por asociar, con el costo estimado de cada tipo y el total. «Pedir todos» manda un lote por tipo. Lo que ya tenías pedido en cada pantalla se conserva.
- En Especificaciones, «Agrupar en casos de uso», «Escribir casos de uso» y las correcciones (casos marcados como mal y reglas que están mal) ya no abren un recuadro para copiar: se suman al mismo pedido y se mandan en lote con «Pedir todos». El agente solo puede editar las páginas de las funcionalidades, y el visor saca de la lista lo que quedó resuelto.
- En Fidelidad ya no hay planes para copiar: «Pedir» en cada archivo o «Pedir los N de la lista» (con las relaciones marcadas) lo suma al mismo pedido, y «Pedir todos» lo manda en lote. El agente solo puede declarar en la carpeta del cerebro (`calls.yaml`, extractores, páginas de tablas); al terminar cada tanda se reindexa y sale de la lista lo que ya no tiene las faltas pedidas.
- En Contratos, cada problema de la deriva (llamadas que nadie atiende, endpoints que nadie llama, campos que no coinciden) se suma al mismo pedido con «Pedir», o por sección con «Pedir los N». El agente arregla la llamada o declara su destino, y lo que se podría borrar lo propone en una nota: nunca borra nada. Un endpoint que nadie llama a propósito se marca «Sin uso a propósito» y sale de la deriva (también para el MCP); se deshace desde la misma pantalla.
- Pantalla nueva **Borradores** en el visor: lo que el agente dejó en `_drafts/` (funcionalidades, especificaciones, librerías, páginas técnicas y notas), con qué cambia cada uno frente a la página actual. «Aceptar» y «Aceptar todo» lo promueven como `flowbrain promote` (si el cerebro deja de compilar, se deshace y se ve el error), «Descartar» lo borra y «Pedir corrección» lo devuelve al agente con tu nota, desde el mismo pedido. La barra cuenta los pendientes y la bandeja avisa cuando un lote dejó borradores. Sin servidor, da los comandos de terminal.
- En Funcionalidades, la ficha tiene «Pedir descripción» (nombre de negocio y descripción, cuando faltan) y «Pedir casos de uso y especificaciones» (el mismo pedido que en Especificaciones: queda «✔ En el pedido» en las dos), y el catálogo «Pedir las N» para las que no tienen descripción. Sin funcionalidades, cada cerebro tiene «Pedir que proponga las funcionalidades». El agente solo escribe borradores en `_drafts/product/`, que una persona revisa y promueve.
- Un solo botón **Agente** en la barra, como un carrito: un número (lo que hay por pedir más lo que hay por revisar) y un panel con tres etapas, «Por pedir», «Trabajando» y «A revisar». Reemplaza a la bandeja «Pedido (N)», al aviso «N borradores nuevos para revisar» y a la pestaña Borradores, que sigue como pantalla de detalle («Abrir la revisión completa»). Al mandar un lote el panel pasa solo a «Trabajando», y al terminar con algo nuevo, a «A revisar», donde se ven los cambios, se acepta, se descarta o se pide corrección sin salir de la pantalla en la que estás.
- Al terminar un lote, cada ítem dice cómo terminó, igual en todas las pantallas: «✔ Resuelto por el agente» con lo que cambió (test nuevo, puntaje nuevo, archivo asociado, borrador para revisar) o «No lo pudo resolver» con el motivo que dio el agente y «Pedir de nuevo». Se ve en el panel y junto al botón de cada fila. El visor trae solo los datos nuevos, en la misma pantalla y scroll (ya no hace falta «Recargar para ver los cambios»), y la bandeja avisa si el lote terminó mientras mirabas otra pantalla.

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

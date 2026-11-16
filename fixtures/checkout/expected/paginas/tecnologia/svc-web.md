---
id: svc-web
tipo: svc
nombre: Web de la tienda
resumen: SPA donde el cliente arma el carrito y paga.
aliases: [web, storefront]
estado: vigente
origen: curado
actualizado: 2026-11-15
verificado: 2026-11-15
tecnologia: [typescript, react, vite]
vive_en: [repo-tienda]
puntos_de_entrada:
  arranque: apps/web/src/main.tsx
  clientes_http: apps/web/src/api/
relaciones:
  - { verbo: llama_a, destino: svc-bff, endpoint: "POST /checkout", evidencia: "repo-tienda:apps/web/src/api/checkout.ts#L9", origen: inferido }
  - { verbo: implementa, destino: feat-checkout, origen: curado }
---

# Web de la tienda

La URL base del BFF sale de una variable de entorno (`VITE_BFF_URL`) y la ruta es literal. Por eso el parser no puede afirmar el destino y la arista queda como `inferido`.

<!-- brain:backlinks:inicio -->
## Backlinks

_Sin backlinks._
<!-- brain:backlinks:fin -->

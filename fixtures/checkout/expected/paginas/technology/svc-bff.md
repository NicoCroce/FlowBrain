---
id: svc-bff
tipo: svc
nombre: BFF de la tienda
resumen: Backend-for-frontend que orquesta el checkout para la web.
aliases: [bff, backend for frontend]
estado: vigente
origen: curado
actualizado: 2026-11-15
verificado: 2026-11-15
tecnologia: [typescript, express]
vive_en: [repo-tienda]
puntos_de_entrada:
  arranque: apps/bff/src/main.ts
  rutas_http: apps/bff/src/routes/
  clientes_externos: apps/bff/src/clients/
relaciones:
  - { verbo: llama_a, destino: svc-payments, endpoint: "POST /payments", evidencia: "repo-tienda:apps/bff/src/clients/payments.ts#L11", origen: parser }
  - { verbo: implementa, destino: feat-checkout, origen: curado }
---

# BFF de la tienda

Recibe `POST /checkout`, valida el carrito y le pide a pagos que cobre el pedido.

<!-- brain:backlinks:inicio -->
## Backlinks

- [[svc-web]] · llama_a · POST /checkout
<!-- brain:backlinks:fin -->

---
id: ext-pasarela
tipo: ext
nombre: Pasarela de pagos
resumen: Proveedor externo que procesa tarjetas y notifica el resultado por webhook.
aliases: [pasarela, gateway de pagos]
estado: vigente
origen: curado
actualizado: 2026-11-15
verificado: 2026-11-15
relaciones:
  - { verbo: llama_a, destino: svc-payments, endpoint: "POST /webhooks/pasarela", evidencia: "repo-tienda:apps/payments/src/routes/webhooks.ts#L7", origen: curado }
---

# Pasarela de pagos

Sistema de terceros. La arista hacia pagos es el webhook de confirmación, y su evidencia es el handler que lo recibe.

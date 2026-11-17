---
id: svc-payments
tipo: svc
nombre: Servicio de pagos
resumen: Cobra pedidos a través de la pasarela y registra cada pago.
aliases: [payments, pagos]
estado: vigente
origen: curado
actualizado: 2026-11-15
verificado: 2026-11-15
tecnologia: [typescript, express, prisma]
vive_en: [repo-tienda]
puntos_de_entrada:
  arranque: apps/payments/src/main.ts
  rutas_http: apps/payments/src/routes/
  clientes_externos: apps/payments/src/clients/
relaciones:
  - { verbo: llama_a, destino: ext-pasarela, dato: CargoPasarela, evidencia: "repo-tienda:apps/payments/src/clients/pasarela.ts#L8", origen: parser }
  - { verbo: escribe_en, destino: tabla-pagos, dato: Pago, evidencia: "repo-tienda:apps/payments/src/routes/payments.ts#L21", origen: parser }
  - { verbo: implementa, destino: feat-checkout, origen: curado }
---

# Servicio de pagos

Crea el cargo en la pasarela y guarda el pago como `pendiente`. La pasarela confirma o rechaza después mediante `POST /webhooks/pasarela`.

<!-- brain:backlinks:inicio -->
## Backlinks

- [[ext-pasarela]] · llama_a · POST /webhooks/pasarela
- [[svc-bff]] · llama_a · POST /payments
- [[svc-bff:POST:/checkout]] · llama_a · POST /payments
<!-- brain:backlinks:fin -->

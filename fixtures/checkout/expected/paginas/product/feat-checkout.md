---
id: feat-checkout
tipo: feat
nombre: Checkout
resumen: El cliente confirma el carrito, paga con tarjeta y recibe el estado del pedido.
aliases: [compra, pago del carrito]
estado: vigente
origen: curado
actualizado: 2026-11-15
verificado: 2026-11-15
---

# Checkout

El cliente confirma el carrito y elige un medio de pago. Recibe una respuesta inmediata (aprobado, rechazado o pendiente). Si queda pendiente, la confirmación final llega después por webhook de la pasarela.

<!-- brain:backlinks:inicio -->
## Backlinks

- [[svc-bff]] · implementa
- [[svc-payments]] · implementa
- [[svc-web]] · implementa
<!-- brain:backlinks:fin -->

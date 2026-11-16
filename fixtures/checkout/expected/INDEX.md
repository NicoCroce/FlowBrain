# INDEX

<!-- generado por brain compile; no editar -->

## repo

- `repo-tienda` · Monorepo de la tienda — Monorepo pnpm con la web, el BFF y el servicio de pagos en apps/. → tecnologia/repo-tienda.md

## svc

- `svc-bff` · BFF de la tienda — Backend-for-frontend que orquesta el checkout para la web. → tecnologia/svc-bff.md
- `svc-payments` · Servicio de pagos — Cobra pedidos a través de la pasarela y registra cada pago. → tecnologia/svc-payments.md
- `svc-web` · Web de la tienda — SPA donde el cliente arma el carrito y paga. → tecnologia/svc-web.md

## db

- `db-tienda` · Base de datos de la tienda — PostgreSQL principal de la tienda. → tecnologia/db-tienda.md

## ext

- `ext-pasarela` · Pasarela de pagos — Proveedor externo que procesa tarjetas y notifica el resultado por webhook. → tecnologia/ext-pasarela.md

## tabla

- `tabla-pagos` · Tabla de pagos — Un registro por intento de cobro, con su estado. → tecnologia/tabla-pagos.md

## feat

- `feat-checkout` · Checkout — El cliente confirma el carrito, paga con tarjeta y recibe el estado del pedido. → producto/feat-checkout.md

## endpoint

- `svc-bff:POST:/checkout` · POST /checkout
- `svc-payments:POST:/payments` · POST /payments
- `svc-payments:POST:/webhooks/pasarela` · POST /webhooks/pasarela

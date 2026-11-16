# Fixture: checkout

Flujo sintético que sirve de oráculo para los tests: `web → bff → payments → pasarela (ext) + tabla-pagos + feat-checkout`.

- **Entradas:** las páginas de `producto/` y `tecnologia/`, y los JSON de `_build/contratos/` y `_build/archivos/`, que simulan la salida de `brain index`.
- **Salida esperada:** `expected/graph.json`, con 23 nodos y 27 aristas. Las demás salidas (`backlinks.json`, `INDEX.md`, `mapa.mmd`) se fijan como golden en el paso 2, después de revisarlas.

## Qué patrones ejercita

| Patrón | Dónde |
|---|---|
| Varios servicios en un mismo repo | `svc-web`, `svc-bff` y `svc-payments` con `vive_en: [repo-tienda]` |
| URL base que sale de una variable de entorno | `svc-web → svc-bff` con origen `inferido` y confianza 0.5 |
| Llamada detectada por parser con endpoint resuelto | `svc-bff → svc-payments` (`POST /payments`) |
| Webhook entrante desde un sistema externo | `ext-pasarela → svc-payments` (`POST /webhooks/pasarela`) |
| Dato que viaja sin endpoint | `svc-payments → ext-pasarela` (`CargoPasarela`) y `→ tabla-pagos` (`Pago`) |
| Endpoint sin response | `POST /webhooks/pasarela` tiene `response: null` |
| Aristas generadas | `expone`, `contiene` (svc → endpoint, repo → archivo) |

## Resultados de consulta esperados (oráculo de los pasos 3 y 4)

**`trazar --desde /checkout`:** 5 saltos.

| # | Nivel | Salto | Verbo | Dato | Confianza | Evidencia |
|---|---|---|---|---|---|---|
| 1 | 1 | svc-web → svc-bff | llama_a `POST /checkout` | CheckoutRequest → CheckoutResponse | 0.5 | `repo-tienda:apps/web/src/api/checkout.ts#L9` |
| 2 | 2 | svc-bff → svc-payments | llama_a `POST /payments` | CrearPagoRequest → Pago | 0.9 | `repo-tienda:apps/bff/src/clients/payments.ts#L11` |
| 3 | 3 | svc-payments → ext-pasarela | llama_a | CargoPasarela | 0.9 | `repo-tienda:apps/payments/src/clients/pasarela.ts#L8` |
| 4 | 3 | svc-payments → tabla-pagos | escribe_en | Pago | 0.9 | `repo-tienda:apps/payments/src/routes/payments.ts#L21` |
| 5 | 4 | ext-pasarela → svc-payments | llama_a `POST /webhooks/pasarela` | EventoPasarela → null | 1.0 | `repo-tienda:apps/payments/src/routes/webhooks.ts#L7` |

En el nivel 3 empatan en confianza, así que el orden lo decide el id de `hasta`: `ext-pasarela` va antes que `tabla-pagos`. El salto 5 se incluye porque la arista es nueva, pero `svc-payments` no se vuelve a expandir.

**`recorrer_grafo svc-payments --verbos depende_de --direccion in`:**
- Profundidad 1: `ext-pasarela` (1.0, webhook) y después `svc-bff` (0.9).
- Profundidad 2: se suma `svc-web` (0.5, a través de svc-bff).

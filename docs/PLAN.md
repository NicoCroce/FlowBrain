# Plan de mejoras de Brain

Fecha: 2026-11-17. Sale de la auditoría integral del 2026-11-16 (estructura, agnosticismo, relaciones, comandos y MCP, comparación con alternativas).

## Objetivo

Que el agente responda con evidencia preguntas de producto, código, infraestructura, riesgo de cambio y punta a punta. El visor solo sirve para controlar lo que el agente sabe.

## Reglas de trabajo

- Un paso por vez. Al cerrar cada paso: tests y typecheck en verde, decisión en `docs/DECISIONS.md` con fecha y motivo, commit, resumen y aprobación antes del siguiente.
- Todo dato o relación nueva entra primero en lo que usa el agente (`graph.json`, `backlinks.json`, `INDEX.md`, consultas del MCP, evals). El visor lo refleja después.
- Agnosticismo: cada arreglo que nace de depurar con el proyecto de referencia entra con un fixture sintético. Ningún nombre ni código de ese proyecto entra al repo. El brain de depuración queda fuera del repo.
- Sin LLM en el camino de lectura. Lo que no se puede determinar queda `null` o con aviso; no se afirma a medias.
- `SCHEMA.md` se actualiza en el mismo paso que cambia el contrato del grafo.

## Estado

| Paso | Tema | Estado |
|---|---|---|
| 0 | Limpieza de nombres del proyecto de referencia | Hecho (`09a6744`) |
| 1 | Tipos en contratos de Nest | Hecho (`66e23b2`, decisión 119) |
| 2 | Relaciones finas en el grafo | Hecho (decisión 120) |
| 3 | MCP: respuestas compactas, búsqueda e instrucciones | Hecho (decisión 121) |
| 4 | Comandos `sync`, `estado` y `doctor` | Hecho (decisión 122) |
| 5 | Registro del MCP y los hooks | Pendiente, requiere decisión |
| 6–9 | Cobertura del modelo | Pendiente |
| 10–12 | Frescura | Pendiente |
| 13–15 | Agnosticismo | Pendiente |
| 16–19 | Diferenciación | Pendiente |
| 20–22 | Higiene | Pendiente |

---

## Fase 1 · Lo que el agente nota ya

### Paso 2 · Relaciones finas en el grafo

**Problema.** `graph.json` está a nivel servicio. El detalle (qué endpoint toca qué tabla, qué pantalla llama a qué endpoint) vive en `funcionalidades.json` y en `_build/extraccion`, así que `recorrer_grafo` e `impacto` no lo ven y cada consulta lo recalcula por su lado.

**Qué se hace.** `compile` genera estas aristas, todas con origen `parser` y evidencia `repo:ruta#Ln`:

| Arista | Verbo | Fuente |
|---|---|---|
| endpoint → tabla | `lee_de` / `escribe_en` | recorrido del handler en la extracción |
| pantalla → endpoint | `llama_a` | recorrido de la pantalla |
| feat → endpoint | `expone` | endpoints cuyo handler cae en el código de la feat |
| feat → tabla | `lee_de` / `escribe_en` | unión de sus endpoints |
| feat → feat | `depende_de` | una feat consume un endpoint de otra |

**Archivos.** `packages/core/src/compile.ts`, `packages/core/src/schema*` (pares origen/destino permitidos por verbo), `SCHEMA.md`, motor de `impacto` y `funcionalidad` para que lean del grafo en vez de recalcular.

**A resolver en el paso.** Si `feat → feat` usa `depende_de` o un verbo nuevo; cómo se marca una arista derivada (unión de otras) para no confundirla con una observada.

**Hecho cuando.** El fixture sintético fija cada arista en su golden; `recorrer_grafo` desde una tabla con `direccion: in` llega a endpoints, pantallas y feats; `impacto` da el mismo resultado o uno mayor que antes; eval sin regresiones.

### Paso 3 · MCP: respuestas compactas, búsqueda e instrucciones

**Problema.** `stringifyCanonical` indenta la salida, pero el presupuesto de tokens se mide sobre el texto compacto: el agente recibe más tokens que los presupuestados. `buscar_nodo "SessionService"` devuelve 0 porque solo busca id, nombre y alias. El servidor no declara `instructions`. `evaluar` cubre 5 de las 9 herramientas.

**Qué se hace.**
1. El MCP serializa compacto (la CLI conserva el indentado para humanos) y el presupuesto se mide sobre lo que se envía.
2. `buscar_nodo` busca también símbolos de código (clases, métodos, funciones) y texto de las páginas (título, descripción). El resultado indica dónde coincidió.
3. `instructions` del servidor: qué herramienta usar para cada tipo de pregunta, en pocas líneas.
4. `evaluar` acepta casos para `pantalla`, `quien_llama`, `impacto` y `recorrido`.

**Archivos.** `packages/mcp/src/server.ts`, `packages/core/src/engine/` (búsqueda y presupuesto), `packages/cli/src/main.ts` (`evaluar`), tests del motor.

**Hecho cuando.** Un test fija que el texto devuelto por el MCP no supera el presupuesto; buscar un símbolo del fixture devuelve su archivo y línea; hay casos de eval para las 9 herramientas.

### Paso 4 · Comandos `sync`, `estado` y `doctor`

**Problema.** Actualizar el brain exige encadenar `index` por repo y `compile` a mano. No hay forma de saber si el brain está al día respecto de los clones, ni de diagnosticar una instalación.

**Qué se hace.**
- `brain sync`: lee un manifiesto de repos del brain (id, ruta o URL, rama), reindexa los que cambiaron de HEAD y compila. El manifiesto guarda rutas relativas o por variable, para que el brain sea portable entre máquinas (hoy `_build/archivos` guarda la ruta del clon de una máquina).
- `brain estado`: por repo, HEAD indexado contra HEAD actual; conteo de nodos y aristas por tipo; huecos conocidos (endpoints sin response, tablas sin `vive_en`, archivos fuera de toda feat, borradores sin promover). Sale con código distinto de cero si está desactualizado.
- `brain doctor`: verifica que el MCP y los hooks estén registrados, que el grafo cargue y que los clones existan.

**Archivos.** `packages/cli/src/main.ts`, módulo nuevo para el manifiesto en `packages/core` o `packages/indexer`, `docs/INSTALACION.md`.

**Hecho cuando.** Sobre un fixture con dos repos, `sync` reindexa solo el que cambió; `estado` lista los huecos y su código de salida refleja el desfase.

### Paso 5 · Registro del MCP y los hooks

**Problema.** El MCP `brain` no está registrado en Claude Code y no hay hooks de brain en la configuración: hoy el agente no usa el brain en ninguna sesión. `brain-graph@0.1.0` no está publicado.

**Requiere decisión del usuario** antes de tocar nada, porque edita configuración fuera del repo:
- Alcance: a nivel usuario, solo en el proyecto que se depura, o esperar.
- A qué brain apunta. El de depuración no debe quedar como configuración permanente de la herramienta.

**Qué se hace.** `brain init` (o `doctor --fix`) deja el registro hecho de forma reproducible y reversible; se documenta en `docs/INSTALACION.md`. Conviene hacerlo después del paso 3, para que el agente reciba respuestas compactas e instrucciones desde el primer uso.

---

## Fase 2 · Cobertura del modelo

### Paso 6 · Eventos y colas

`indexar.ts` deja `eventos: []` fijo; las colas solo aparecen como `via` en las invocaciones. Extraer publicadores y consumidores (emisores de eventos, colas, cron), crear nodos `queue` y aristas `publica_en` / `consume_de`, y llenar `eventos` del contrato. Fixture sintético con un productor y un consumidor en repos distintos.

### Paso 7 · Bases de datos y esquema

No hay nodos `db` y las tablas no tienen `vive_en`. Parser de DDL y migraciones: tablas, columnas, claves foráneas e índices. Aristas `tabla vive_en db` y relación entre tablas por clave foránea. Las columnas van en la ficha de la tabla, no como nodos. Permite responder "qué se rompe si cambio esta columna".

### Paso 8 · Infraestructura

Hoy no se modela. Parsers para Dockerfile y compose, pipelines de CI, configuración de proxy y variables de entorno de ejemplo. Aristas: `svc` desplegado por un pipeline, `svc depende_de ext` por variable de entorno, puertos y rutas del proxy hacia servicios. Cada parser es opcional y entra con su fixture.

### Paso 9 · Código compartido, equipos y decisiones

- Cerca del 28 % de los archivos del proyecto de referencia queda fuera de toda feat (código compartido, núcleo, sistema de diseño). Nodos `lib` para esos módulos y `feat depende_de lib`, para que `impacto` sobre código compartido llegue a las feats.
- Nodos `team` y `decision` desde páginas curadas: `pertenece_a` y `decidido_por`. `brain nota` puede anclar una nota a un nodo.
- Correr `brain verify` por primera vez y arreglar lo que marque.

---

## Fase 3 · Frescura

### Paso 10 · Indexado incremental

Reindexar solo los archivos cambiados entre el HEAD indexado y el actual. Requiere que la extracción sea por archivo y que la fusión sea determinista. Opción de `sync --watch` y de un hook de git post-commit.

### Paso 11 · Impacto desde un diff

`impacto` acepta un diff o un rango de commits: de las líneas tocadas a los símbolos, de ahí a endpoints, pantallas, tablas y feats. Es la base de `riesgo` (paso 16).

### Paso 12 · Promover borradores

Comando para pasar un borrador de `draft` a página curada revisando el diff, y aviso en `estado` de los borradores viejos.

---

## Fase 4 · Agnosticismo

### Paso 13 · Segundo proyecto de otra pila

Indexar un proyecto con otra pila (otro framework de back y de front) antes de dar por buena cualquier heurística. Cada fallo que aparezca se arregla con fixture sintético. Medir con `evaluar` y con `estado`.

### Paso 14 · Interfaz de parsers y pilas nuevas

Hoy se extrae TS/JS y PHP, solo HTTP REST. Documentar el contrato de un parser (`packages/parsers/src/tipos.ts`) para que sumar un lenguaje no toque el indexador. Candidatos por orden de valor: GraphQL y gRPC como tipos de contrato; Python y Go vía tree-sitter. Se elige según el proyecto del paso 13.

### Paso 15 · Huecos de contratos

Lo que la decisión 119 dejó afuera: parámetros de query y de ruta, cuerpos leídos con decoradores sin `Body` en el nombre, handlers de Express o Fastify sin genéricos, y los endpoints cuyo retorno no se pudo seguir.

---

## Fase 5 · Diferenciación

Ninguna alternativa revisada (memoria episódica, grafos de símbolos con tree-sitter, servidores LSP) tiene la funcionalidad de producto como nodo de primera clase, el camino pantalla → endpoint → servicio → tabla entre repos, evidencia verificable, verdad curada ni evals. Estos pasos profundizan esa diferencia.

### Paso 16 · `riesgo <pieza|diff>`

Una respuesta para "qué tan riesgoso es este cambio": alcance (feats, pantallas, repos), confianza de las aristas que lo sostienen, huecos conocidos en el camino y decisiones asociadas. Depende de los pasos 2 y 11.

### Paso 17 · Deriva de contratos

Comparar lo que el front espera de un endpoint con lo que el back declara (campos, tipos, rutas que nadie atiende, endpoints que nadie llama). Sale como aviso en `verify` y en `contrato_de`.

### Paso 18 · Paridad de migración

Para migraciones de un sistema viejo a uno nuevo: emparejar endpoints, pantallas y tablas de ambos lados e informar qué falta migrar y qué difiere. Genérico: dos conjuntos de repos y una regla de emparejamiento.

### Paso 19 · Decisiones y notas ancladas

Las notas de sesión y las decisiones quedan atadas a nodos y aparecen en la ficha de la pieza y en `riesgo`.

---

## Fase 6 · Higiene

### Paso 20 · Visor fuera de `core`

Mover el visor a su propio paquete: `core` queda con esquema, compilación y motor.

### Paso 21 · Documentación al día

`docs/PRD.es.md` quedó atrasado respecto del código. Actualizarlo o marcarlo como histórico y dejar `SCHEMA.md` y `docs/DECISIONS.md` como fuente.

### Paso 22 · Publicar `brain-graph`

Publicar el paquete cuando las fases 1 y 2 estén cerradas (decisión 72 pendiente).

---

## Orden y dependencias

- 2 → 3 → 4 → 5 en ese orden. El 5 espera la decisión del usuario.
- 16 depende de 2 y 11. 17 depende de 15. 10 conviene antes de 13 por tiempo de indexado.
- Las fases 2 a 6 se pueden reordenar según lo que muestre el paso 13.

## Decisiones abiertas

1. Paso 5: alcance del registro y a qué brain apunta.
2. ~~Paso 2: verbo de `feat → feat` y marca de aristas derivadas.~~ Resuelto en la decisión 120: `depende_de`, y origen heredado de la extracción en vez de una marca.
3. Paso 13: qué proyecto de otra pila se usa como segundo banco de pruebas.
4. Carpetas de ejemplo `afip` y `videoAnalysis` en `packages/indexer/test/borrador.test.ts`: renombrarlas si identifican al proyecto de referencia.

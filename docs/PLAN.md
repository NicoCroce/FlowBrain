# Plan de mejoras de FlowBrain

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
| 5 | Registro del MCP y los hooks | Hecho el 2026-11-17: a nivel usuario, apuntando al brain de depuración |
| 6 | Eventos y colas | Hecho (decisión 123) |
| 7 | Bases de datos y esquema | Hecho (decisión 124) |
| 8 | Infraestructura | Hecho (decisión 125) |
| 9 | Código compartido, equipos y decisiones | Hecho (decisión 126) |
| 10 | Índice al día | Hecho de otra forma (decisión 127) |
| 11 | Impacto desde un diff | Hecho (decisión 128, junto con el paso 16) |
| 12 | Promover borradores | Hecho (decisión 129) |
| 13 | Segundo proyecto de otra pila | Pendiente: falta elegir el proyecto (prueba de humo en decisión 131) |
| 14 | Interfaz de parsers | Hecho: `docs/PARSERS.md`; lenguajes nuevos esperan al paso 13 |
| 15 | Huecos de contratos | Hecho en parte (decisión 130) |
| 16 | `riesgo` | Hecho (decisión 128) |
| 17 | Deriva de contratos | Hecho (decisión 132) |
| 18 | Paridad de migración | Hecho (decisión 134), sin probar con un caso real |
| 19 | Decisiones y notas ancladas | Hecho (decisiones 126 y 133) |
| 20 | Visor fuera de `core` | Hecho (decisión 135) |
| 21 | Documentación al día | Hecho: el PRD queda como histórico y apunta a las fuentes vigentes |
| 22 | Publicar `flowbrain` | Pendiente: publicar es una acción externa, requiere confirmación |
| 23 | Registro y alta de cerebros | Hecho (decisión 136) |
| 24 | MCP y hooks con varios cerebros | Hecho (decisión 137) |
| 25 | Pistas de otros cerebros | Hecho (decisión 138) |
| 26 | Relaciones entre cerebros | Hecho (decisión 139) |
| 27 | Visor con varios cerebros | Hecho (decisión 140); falta revisarlo a ojo en un navegador |

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
- `flowbrain sync`: lee un manifiesto de repos del brain (id, ruta o URL, rama), reindexa los que cambiaron de HEAD y compila. El manifiesto guarda rutas relativas o por variable, para que el brain sea portable entre máquinas (hoy `_build/archivos` guarda la ruta del clon de una máquina).
- `flowbrain estado`: por repo, HEAD indexado contra HEAD actual; conteo de nodos y aristas por tipo; huecos conocidos (endpoints sin response, tablas sin `vive_en`, archivos fuera de toda feat, borradores sin promover). Sale con código distinto de cero si está desactualizado.
- `flowbrain doctor`: verifica que el MCP y los hooks estén registrados, que el grafo cargue y que los clones existan.

**Archivos.** `packages/cli/src/main.ts`, módulo nuevo para el manifiesto en `packages/core` o `packages/indexer`, `docs/INSTALACION.md`.

**Hecho cuando.** Sobre un fixture con dos repos, `sync` reindexa solo el que cambió; `estado` lista los huecos y su código de salida refleja el desfase.

### Paso 5 · Registro del MCP y los hooks

**Problema.** El MCP `brain` no está registrado en Claude Code y no hay hooks de brain en la configuración: hoy el agente no usa el brain en ninguna sesión. `flowbrain@0.1.0` no está publicado.

**Requiere decisión del usuario** antes de tocar nada, porque edita configuración fuera del repo:
- Alcance: a nivel usuario, solo en el proyecto que se depura, o esperar.
- A qué brain apunta. El de depuración no debe quedar como configuración permanente de la herramienta.

**Qué se hace.** `flowbrain init` (o `doctor --fix`) deja el registro hecho de forma reproducible y reversible; se documenta en `docs/INSTALACION.md`. Conviene hacerlo después del paso 3, para que el agente reciba respuestas compactas e instrucciones desde el primer uso.

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
- Nodos `team` y `decision` desde páginas curadas: `pertenece_a` y `decidido_por`. `flowbrain nota` puede anclar una nota a un nodo.
- Correr `flowbrain verify` por primera vez y arreglar lo que marque.

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

### Paso 22 · Publicar `flowbrain`

Publicar el paquete cuando las fases 1 y 2 estén cerradas (decisión 72 pendiente).

---

## Fase 7 · Varios cerebros

Pedido del 2026-11-17. Hasta 5 cerebros, cada uno con su nombre y sus repos o carpetas, aislados por defecto y con la comunicación entre ellos activable. Sirve para tener información vieja a mano sin mezclarla con la vigente.

### Paso 23 · Registro y alta de cerebros

Un archivo de registro con los cerebros (nombre, carpeta, repos o carpetas que contiene) y qué pares tienen la comunicación activada. Un comando de alta que pregunte el nombre y los repos de cada uno, lo cree y lo indexe; lo mismo por parámetros, para que se pueda probar y automatizar. El tope de 5 es un valor de configuración. A resolver: si un mismo repo puede estar en dos cerebros (por ejemplo en commits distintos).

**Conexiones declaradas.** El registro también guarda, por cada par comunicado, qué servicio llama a cuál: por ejemplo, que la web nueva llama a la API nueva y también a la API vieja. El alta lo pregunta. Es un dato curado, como las páginas: manda sobre lo que detecte el parser. Cada conexión puede indicar por dónde se distingue el destino (el host o la variable de la URL base), que es lo único que permite saber a cuál de dos APIs con las mismas rutas va una llamada.

**Hecho cuando.** Con un registro de dos cerebros sintéticos, `estado` y `sync` trabajan sobre cada uno por nombre.

### Paso 24 · MCP y hooks con varios cerebros

Un solo servidor MCP para todos. Cada consulta lleva `cerebro` (por defecto, el del repo actual) y cada respuesta dice de qué cerebro salió. El hook carga solo el cerebro del repo donde se está parado; fuera de todo repo conocido no inyecta nada. En consultas que juntan cerebros, cada id va con el nombre de su cerebro, porque dos cerebros pueden tener un `repo-x` o una `tabla-user` distintos.

**Hecho cuando.** Un test fija que una consulta desde el repo de un cerebro no devuelve nada del otro con la comunicación desactivada, y que el hook no carga los grafos ajenos.

### Paso 25 · Pistas de otros cerebros

Al compilar, cada cerebro escribe un índice chico de nombres (ids, nombres, alias, rutas de endpoints, tablas). Con la comunicación activada, si algo de la consulta coincide de forma exacta en otro cerebro, la respuesta suma una pista: cerebro, cantidad y coincidencias principales. Las instrucciones del servidor le piden al modelo que la mencione y que consulte ese cerebro solo si hace falta. Medido sobre el brain de depuración: unos 30 tokens por pista, unos 120 con los otros cuatro cerebros a la vez, 0 sin coincidencias; el índice pesa unos 27.000 caracteres contra 4 MB del grafo.

**Hecho cuando.** Un test fija el formato y el tamaño de la pista, que solo hay coincidencia exacta, y que con la comunicación desactivada no hay pistas.

### Paso 26 · Relaciones entre cerebros

Lo que hace que una pista diga "el front de este cerebro llama a este endpoint de aquel" y no solo "allá hay algo con el mismo nombre". Hoy una llamada se une a su endpoint al indexar, contra los contratos del mismo cerebro. Para poder prenderlo y apagarlo sin reindexar, las llamadas que quedaron sin unir se resuelven al consultar contra los contratos de los cerebros comunicados. `impacto`, `riesgo`, `deriva` y `paridad` siguen ese cruce cuando la comunicación está activada. Es el paso más grande de la fase. Habilita `paridad` entre un cerebro viejo y uno nuevo, que hoy no se pudo probar con un caso real.

Las conexiones declaradas en el registro (paso 23) dicen contra qué servicios de otros cerebros se intenta unir cada llamada; lo detectado se contrasta con lo declarado: una conexión declarada sin ninguna llamada que la respalde, o llamadas hacia un cerebro sin conexión declarada, salen como aviso. Por cada conexión se informa cuántas llamadas van a cada destino, que en una migración es cuánto queda todavía contra el servicio viejo.

**Hecho cuando.** Con dos cerebros sintéticos (un front y un back), `impacto` sobre un endpoint del segundo alcanza a la pantalla del primero solo con la comunicación activada.

### Paso 27 · Visor con varios cerebros

El mapa 3D dibuja un cerebro por cada cerebro del registro, con la misma estética de hoy (la corteza de puntos y las neuronas adentro), y los impulsos que cruzan de uno a otro son las relaciones del paso 26. Un panel de detalle por cerebro muestra qué contiene, con un interruptor para prender o apagar cada cerebro y, como hoy, cada tipo de nodo (tablas, pantallas, archivos, etc.), más uno para apagar todo. Depende del paso 26: sin relaciones reales entre cerebros no hay nada que viaje de uno a otro. Como todo el visor, refleja lo que ya está en los datos; no agrega información propia.

**Hecho cuando.** Con dos cerebros sintéticos comunicados, el visor embebe los dos conjuntos de nodos, las relaciones que cruzan y los interruptores; con la comunicación desactivada no embebe cruces.

---

## Orden y dependencias

- 2 → 3 → 4 → 5 en ese orden. El 5 espera la decisión del usuario.
- 16 depende de 2 y 11. 17 depende de 15. 10 conviene antes de 13 por tiempo de indexado.
- Las fases 2 a 6 se pueden reordenar según lo que muestre el paso 13.
- Fase 7: 23 → 24 → 25 → 26 → 27. El 27 necesita el 26; los pasos 23 a 25 ya dan cerebros aislados con pistas.

## Decisiones abiertas

1. **Paso 5:** si el MCP y los hooks se registran a nivel usuario, solo en un proyecto, o todavía no, y a qué brain apuntan. `flowbrain doctor` dice qué falta; `flowbrain init --claude-code` y la línea de `claude mcp add` que imprime lo hacen. Conviene registrar el servidor con `serve --sync`.
2. **Paso 13:** qué proyecto de otra pila se usa como segundo banco de pruebas. De eso dependen los lenguajes nuevos del paso 14.
3. **Paso 22:** publicar `flowbrain` en npm.
4. Carpetas de ejemplo `afip` y `videoAnalysis` en `packages/indexer/test/borrador.test.ts`: renombrarlas si identifican al proyecto de referencia.

## Pendientes anotados en las decisiones

Lo que cada paso dejó afuera está en su decisión (120 a 135), bajo "Queda fuera". Los de más valor:

- Que `impacto` y la ficha lean del grafo en vez de recalcular desde la extracción (120).
- Preguntas de evaluación para las herramientas sin cubrir (121): hoy `buscar_nodo`, `contrato_de`, `recorrer_grafo`, `trazar`, `infra`, `riesgo`, `deriva` y `paridad`.
- Proponer páginas de cola y de librería desde `draft` (123, 126).
- Indexar en un mismo brain el servicio viejo y el nuevo de una migración para probar `paridad` y ver el esquema de las tablas (124, 134).
- Kubernetes, Terraform y serverless en `infra` (125).
- Seguir el uso de un tipo o una constante cambiados en `riesgo` (128).
- Comparar campos entre lo que el front espera y lo que el back declara (132).
- Precisión del hook de prompt: una palabra común del pedido ("documentos") alcanzó para inyectar el contexto de una funcionalidad que no venía al caso. Visto el 2026-11-17, en el primer uso real.

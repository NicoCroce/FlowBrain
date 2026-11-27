# Cuánto contexto usa FlowBrain y cómo acompaña el desarrollo

[English](CONTEXT.md) · **Español**

## La fortaleza en una frase

FlowBrain **nunca carga el proyecto en el contexto del modelo**. El conocimiento vive fuera, en `.flowbrain/` (grafo + páginas compiladas), y al agente le llegan solo respuestas chicas, con presupuesto de tokens, en las que cada dato trae la línea de código que lo respalda (`repo:ruta#Ln`). El agente lee primero el mapa y después solo los pocos archivos que importan.

```
Sin FlowBrain:  pregunta ─► grep ─► abrir decenas de archivos ─► reconstruir el flujo a mano ─► respuesta
Con FlowBrain:  pregunta ─► grafo (cientos o pocos miles de tokens) ─► 2 a 5 archivos exactos ─► respuesta
```

## Las tres capas de contexto

### 1. Fijo por sesión: reglas e instrucciones del MCP (~1–1,5k tokens)

- **Bloque de reglas** en `CLAUDE.md`, `AGENTS.md` o el equivalente de Cursor/Windsurf (`flowbrain gen …`). Dice qué repo es este en el grafo, qué servicios viven ahí y de qué dependen (cada lista se corta en 8 con "+N more"), qué herramienta usar para cada pregunta y la regla de abrir el archivo citado antes de afirmar algo.
- **Instrucciones del servidor MCP**: el mapa de qué herramienta usar para cada pregunta. Con varios cerebros se suma una línea por cerebro.

Se carga una vez y **no crece con el tamaño del proyecto**.

### 2. Automático por pregunta: hook `UserPromptSubmit` (tope 1.500 tokens)

Cuando escribís una pregunta, el hook la analiza sin usar IA, con reglas fijas:

- Detecta rutas HTTP (`POST /auth/login`) y rutas de archivo, y prepara hasta **3 trazas** (`trazar`).
- Detecta nombres exactos de nodos (servicio, tabla, funcionalidad, repo…) y prepara hasta **5 vecindarios** (`recorrer_grafo`).
- Arma un bloque `<flowbrain-context>` sección por sección. Cada sección recibe **solo lo que queda del presupuesto**. Si quedan menos de 80 tokens, la sección se omite y se avisa ("N sections omitted due to budget").
- Si la pregunta no nombra nada reconocible, no inyecta nada (o solo la línea del repo actual).

Una pregunta vaga cuesta casi cero. Una que nombra el endpoint y la tabla llega con el recorrido y los vecinos ya resueltos.

### 3. A pedido del agente: herramientas MCP (≤2.000 tokens por defecto cada una)

El agente decide qué consultar (`recorrido`, `impacto`, `pantalla`, `funcionalidad`, `quien_llama`…). Cada respuesta está acotada así:

| Mecanismo | Qué hace |
|---|---|
| `budget_tokens` | 2.000 por defecto, ajustable (`null` lo saca). Si la lista no entra, se sacan elementos del final y se marca `truncado: true, omitidos: N`: el agente sabe que falta algo y puede pedir más o preguntar más preciso. |
| Proyección | `resumen`, `relaciones`, `contrato` o `completo`. Se pide solo la vista necesaria. |
| Límites de recorrido | hasta 12 niveles y 200 pasos por flujo, y profundidad máxima 5 al recorrer el grafo. Al pasarse, devuelve `truncado` y un aviso. |
| JSON compacto | sin espacios ni campos vacíos. El presupuesto se mide sobre ese mismo texto. |
| `avisos` | marcan dónde el grafo no sabe (llamadas sin resolver, índice atrasado respecto del commit). Ahí conviene leer el código, y solo ahí. |

## En números

| Capa | Cuándo | Costo aproximado |
|---|---|---|
| Reglas + instrucciones MCP | una vez por sesión | ~1–1,5k tokens |
| Hook por pregunta | cada mensaje | 0 a 1,5k (tope) |
| Cada consulta MCP | cuando el agente la pide | ≤2k por defecto |
| Archivos citados | el agente los abre | lo que pesen esos pocos archivos |

En un proyecto de 7 cerebros, una pregunta típica suma unos 3–8k tokens de FlowBrain más los archivos puntuales, y no los cientos de miles que costaría leer el proyecto. El conteo es una estimación interna (≈4 caracteres por token), así que los topes son aproximados.

**Por qué es una fortaleza:**

- **Escala**: el costo depende de la pregunta, no del tamaño del repositorio.
- **Más precisión**: menos ruido en el contexto significa menos confusión y menos alucinación. Cada dato tiene evidencia verificable.
- **Determinístico**: ninguna consulta llama a un LLM. La misma pregunta devuelve la misma respuesta, con la misma evidencia.
- **Honesto sobre lo que falta**: `truncado` y `avisos` dicen qué quedó afuera en lugar de callarlo.
- **Deja lugar para trabajar**: la ventana de contexto queda libre para el código que hay que escribir, no para reconstruir cómo funciona el sistema.

## Mientras desarrollás: cómo se mantiene al día

**¿Una funcionalidad nueva entra de punta a punta?**

- **Lo técnico entra solo.** Endpoints, métodos, llamadas, tablas, pantallas e infraestructura se regeneran desde el código. Con `serve --sync`, cuando un repo tiene un commit nuevo, la siguiente consulta lo reindexa y ya ve el flujo completo, de la pantalla a la tabla. Lo que no está commiteado no se ve: el grafo sigue en el commit anterior y las respuestas avisan que el índice quedó atrás.
- **Lo de producto se propone y lo revisás vos.** Qué funcionalidad es, sus reglas de negocio y sus tests no se agregan solos. Los archivos nuevos aparecen en `sin_asociar` con una sugerencia de a qué funcionalidad pertenecen. `/flowbrain-features` y `/flowbrain-specs` generan borradores, y `flowbrain promote` los confirma.

### El código nuevo entra solo, en el commit

El grafo de código (endpoints, métodos, llamadas, tablas, pantallas, infraestructura) **se regenera desde el código**, no se escribe a mano. Con el servidor MCP en modo `serve --sync`, en cada consulta FlowBrain compara el commit indexado con el `HEAD` de cada clon. Si un clon avanzó, reindexa y recompila ese repo antes de responder. Los extractores propios del proyecto se vuelven a correr y se verifican en cada indexación.

Cuando el agente agrega una funcionalidad nueva (pantalla → endpoint → servicio → tabla), **después del commit** la próxima consulta ya la ve de punta a punta: `recorrido`, `pantalla`, `impacto` y `quien_llama` la incluyen. Sin `--sync`, el mismo efecto se logra con `flowbrain sync`.

Lo que todavía no está commiteado no se ve: el grafo sigue en el commit anterior, y las respuestas lo avisan cuando el índice quedó atrás.

### La capa de producto se propone y se revisa

Las **funcionalidades** (qué es una feature, qué reglas de negocio cumple, qué test la verifica) son conocimiento de producto: se deducen pero no se adivinan en silencio.

- Los archivos nuevos que no pertenecen a ninguna funcionalidad aparecen en `sin_asociar` (y en la pantalla *Unassigned* del visor), con una sugerencia de a cuál asignarlos.
- `/flowbrain-features` y `/flowbrain-specs` hacen que el agente deduzca o complete funcionalidades y especificaciones como **borradores** en `_drafts/`.
- Mientras desarrolla, el agente hace lo mismo por su cuenta: el borrador de una funcionalidad nueva ya trae sus casos de uso y especificaciones, y cuando cambia una existente actualiza sus especificaciones (las reglas nuevas como propuestas sin confirmar; una confirmada que el código contradice se avisa, no se cambia).
- `flowbrain promote` los pasa a `product/` y `technology/`. Si el cerebro deja de compilar con las páginas nuevas, deshace todo.
- `fidelidad` mide de 0 a 100 qué tan entendido quedó cada archivo o funcionalidad, y qué falta.

### Qué cuesta mantenerlo al día

**Actualizar el grafo de código no consume tokens del modelo.** Reindexar y recompilar son programas: parsers y extractores del proyecto que corren en tu máquina, sin llamar a ningún LLM. Lo que cuesta es tiempo de CPU (en un proyecto de 7 cerebros, unos dos minutos para todo; con `--sync`, solo los repos que avanzaron). Eso pasa **una vez por commit**, cuando la siguiente consulta detecta que el clon se movió, y no mientras el agente escribe código.

Los tokens se gastan solo en dos momentos:

| Momento | Quién lo hace | Tokens |
|---|---|---|
| Reindexar después de un commit | FlowBrain (parsers + extractores) | 0 |
| Consultar el grafo | el agente, por MCP o el hook | lo de las tres capas de arriba |
| Proponer producto: funcionalidades, especificaciones, asignar archivos sin funcionalidad | el agente, cuando se lo pide la regla o corrés `/flowbrain-features` o `/flowbrain-specs` | lo que lea y escriba para esos borradores |
| Promover borradores (`flowbrain promote`) | FlowBrain | 0 |

Mientras desarrollás sin commitear, FlowBrain no gasta nada en mantenerse al día: el agente lee el código que está cambiando, como sin FlowBrain, y el grafo se pone al día solo en el próximo commit.

### Cuando el código contradice al grafo

Si mientras trabaja el agente ve que el código dice otra cosa que el grafo, escribe en su respuesta una línea `flowbrain-nota <nodo>: <qué cambió>`. El hook `SessionEnd` guarda esas notas en `_drafts/notes/` para que las revises. **FlowBrain no reescribe solo su conocimiento curado**: lo de código se regenera del código, y lo de producto pasa por tu revisión. Ese control es lo que lo mantiene confiable.

### Lo que las reglas le piden al agente

El bloque de reglas (`flowbrain gen …`) y las instrucciones del servidor MCP le enseñan al agente a mantener el grafo al día mientras desarrolla:

- **Lo no commiteado se lee del código.** Para archivos que creó o cambió y todavía no commiteó, lee el código y no el grafo.
- **Antes de cambiar, mira quién usa.** Antes de tocar un método, un endpoint o una tabla, consulta `quien_llama` o `impacto`.
- **Lo nuevo se propone, no se impone.** Cuando agrega una funcionalidad o archivos nuevos, ya commiteados revisa `sin_asociar` y dice a qué funcionalidad pertenece cada archivo. Para una funcionalidad nueva propone su página como borrador en `_drafts/product/feat-<id>.md`. Nunca edita `product/` ni `technology/` directamente: vos revisás y promovés con `flowbrain promote`.

### ¿Y las mejoras en el propio código?

FlowBrain no modifica tu código: le da al agente el mapa para hacerlo con menos riesgo. Antes de tocar algo, el agente puede preguntar `quien_llama` (quién usa este método, incluso por HTTP, eventos o colas desde otros repos), `impacto` (qué funcionalidades se ven afectadas) y `riesgo` (qué alcanza un diff y a quién avisar). Las correcciones o mejoras las decide el agente, o las pedís vos. FlowBrain hace que no rompan algo en otro servicio sin que nadie lo vea.

## Para seguir

- [GUIA.md](GUIA.md): qué entendió la IA y cómo verificarlo.
- [INSTALACION.md](INSTALACION.md): instalación, `serve --sync` y CI.
- [SCHEMA.md](../SCHEMA.md): el contrato del grafo.

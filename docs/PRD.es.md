# Brain — PRD v0.1

> **Documento histórico.** Es el diseño original (v0.1) y se conserva para entender de dónde salen las decisiones. No describe el estado actual. Las fuentes vigentes son:
>
> - [`SCHEMA.md`](../SCHEMA.md): el contrato del grafo, de los JSON y de las consultas.
> - [`DECISIONS.md`](DECISIONS.md): cada cambio respecto de este PRD, con fecha y motivo.
> - [`PLAN.md`](PLAN.md): qué se hizo y qué falta después de la auditoría del 2026-11-16.
> - [`PARSERS.md`](PARSERS.md): cómo sumar un parser.
>
> Lo que hoy existe y este PRD no contempla: funcionalidades de producto y pantallas como nodos; relaciones a nivel de endpoint, pantalla y funcionalidad; consultas de código (`recorrido`, `quien_llama`, `impacto`, `pantalla`, `funcionalidad`), de cambio (`riesgo`), de contratos (`deriva`, `paridad`) y de infraestructura (`infra`); esquema de base de datos, eventos y colas; evaluación con preguntas de respuesta conocida; y los comandos `sync`, `estado`, `doctor` y `promover`. Varios puntos de "Fuera de alcance" de abajo ya no lo están.

Un grafo de conocimiento determinístico e independiente de la herramienta para agentes de código. Markdown y JSON planos en un repo git, compilados por scripts, servidos por MCP y hooks. La misma pregunta da la misma respuesta desde Claude Code, OpenCode, ChatGPT o Cursor.

## Problema

Los agentes redescubren el código en cada sesión, queman tokens en `grep` y no pueden responder preguntas entre repos ("¿qué se rompe si cambio el endpoint de pagos?", "¿qué devuelve el BFF en `/checkout`?"). Las herramientas de memoria existentes guardan hechos sueltos de sesión; ninguna tiene un mapa curado, tipado y con evidencia de cómo se relacionan repositorios, servicios, datos y features de producto.

## Objetivos

1. Respuestas determinísticas: el motor de consulta no tiene LLM en el camino de lectura. La salida depende solo del grafo y de la consulta.
2. Independiente de la herramienta: un motor, varias puertas (servidor MCP, hooks, CLI, archivos de reglas generados).
3. Frugal en tokens: lectura jerárquica (índice → frontmatter → prosa), proyecciones fijas, presupuestos de tokens.
4. Con evidencia: cada arista cita una ruta de archivo; evidencia desaparecida degrada la arista automáticamente.
5. Curado por humanos, extraído por máquinas: humanos y agentes supervisados escriben Markdown; los parsers escriben JSON; el compilador los une por ID.

## Fuera de alcance (v0.1)

Introspección de base de datos, memoria episódica de sesión, interfaz web con edición, búsqueda vectorial, lenguajes distintos de TypeScript y PHP, autenticación o hosting multiusuario.

## Usuarios

- Desarrollador trabajando dentro de un repo con cualquier agente compatible con MCP.
- Tech lead que mantiene el mapa y revisa borradores del indexador.
- Persona de producto que lee las páginas de `producto/` y el grafo renderizado.

## Estructura del repositorio

```
brain/
├── INDEX.md                 # generado: una línea por nodo
├── SCHEMA.md                # tipos de nodo, verbos, estados, orígenes, proyecciones
├── producto/*.md            # nodos de producto (feat, team, decision)
├── tecnologia/*.md          # nodos técnicos (repo, svc, lib, db, queue, ext, tabla)
├── raw/                     # fuentes inmutables (PRDs, transcripciones)
├── _build/                  # generado, nunca se edita
│   ├── graph.json
│   ├── backlinks.json
│   ├── contratos/<id>.json
│   ├── archivos/<repo-id>.json
│   ├── mapa.mmd
│   └── viewer.html
└── packages/
    ├── core/                # esquema, compilador, motor (TS puro, sin I/O más que fs)
    ├── parsers/             # ts-parser (API del compilador TS), php-parser (tree-sitter), openapi-parser
    ├── indexer/             # prompt del agente + generador de borradores
    ├── mcp/                 # servidor MCP sobre core
    ├── cli/                 # CLI `brain` sobre core
    └── hooks/               # hook de Claude Code, plugin de OpenCode, generadores de reglas
```

## Modelo de datos

**Tipos de nodo:** `repo`, `svc`, `lib`, `db`, `queue`, `ext`, `tabla`, `feat`, `team`, `decision`, `contrato`, `endpoint`, `archivo`.

**Verbos de arista (origen → destino):** `llama_a`, `publica_en`, `consume_de`, `lee_de`, `escribe_en`, `depende_de`, `vive_en`, `implementa`, `pertenece_a`, `decidido_por`, `expone`, `contiene` (repo → archivo, svc → endpoint).

**Estados:** `vigente`, `dudoso`, `deprecado`. **Orígenes:** `curado`, `inferido`, `parser`.

**Frontmatter de página (escrito por humanos):**

```yaml
id: svc-payments            # slug, único, nombre de archivo
tipo: svc
nombre: Servicio de pagos
aliases: [payments, pagos]
estado: vigente
origen: curado
actualizado: 2026-11-15
verificado: 2026-11-15
pertenece_a: [team-platform]
vive_en: [repo-payments]
puntos_de_entrada:
  arranque: src/main.ts
  rutas_http: src/routes/
  clientes_externos: src/clients/
relaciones:
  - { verbo: llama_a, destino: svc-auth, evidencia: "repo-payments:src/clients/auth.ts#L12", origen: parser }
  - { verbo: implementa, destino: feat-checkout, origen: curado }
```

**JSON generado (escrito por máquinas):** `contratos/<id>.json` con endpoints (método, ruta, tipos de request y response, evidencia) y eventos; `archivos/<repo-id>.json` con el árbol de archivos y símbolos por archivo; `graph.json` como `{nodes[], edges[]}` donde cada arista lleva `verbo`, `origen`, `evidencia`, `confianza`.

**Formato de evidencia:** `<repo-id>:<ruta/relativa>[#L<línea>]`. Nunca rutas absolutas.

**Proyecciones (fijas, definidas en SCHEMA.md):** `resumen` (identidad + una línea), `relaciones` (+ aristas con evidencia), `contrato` (+ endpoints), `completo` (+ prosa). Orden de recorte al exceder presupuesto: prosa → endpoints → aristas de baja confianza.

## Componentes

### 1. Compilador (`brain compile`)

Lee todos los frontmatters, valida contra `SCHEMA.md` (verbo, tipo, estado o destino desconocido → falla con archivo y línea), fusiona el JSON generado por ID y escribe `graph.json`, `backlinks.json`, `INDEX.md`, `mapa.mmd`, `viewer.html`. Inyecta una sección "Backlinks" generada en cada página entre marcadores. Idempotente: mismas entradas → salidas idénticas byte a byte.

### 2. Motor de consulta (`packages/core/engine`)

Funciones puras sobre `graph.json`. Cuatro herramientas, cada una con parámetros `proyeccion` y `budget_tokens`:

| Herramienta | Entrada | Salida |
| --- | --- | --- |
| `buscar_nodo` | texto (coincide con id, nombre, aliases; exacto > prefijo > difuso) | nodos ordenados, `resumen` por defecto |
| `recorrer_grafo` | nodo, verbos\[\], direccion (out/in/both), profundidad (≤5) | nodos alcanzados por nivel, cada arista con evidencia |
| `contrato_de` | nodo, endpoint? | endpoints + eventos del JSON de contrato |
| `trazar` | desde (nodo, URL o ruta), hasta? | saltos ordenados, cada uno con verbo, evidencia, tipo de dato que viaja y confianza |

Reglas de determinismo: orden estable (confianza desc, id asc), sin aleatoriedad, sin timestamps en la salida, estimación de tokens con un tokenizador fijo.

### 3. Parsers (`brain index <ruta-repo>`)

Interfaz común `Parser { detect(repo): boolean; extract(repo): { archivos, endpoints, llamadas, tablas, eventos } }`.

- **ts-parser:** API del compilador de TypeScript. Extrae handlers de rutas (Express, Fastify, rutas API de Next, decoradores de NestJS), sus tipos de retorno, llamadas salientes `fetch`/`axios` con URL literal, modelos de ORM (Prisma, TypeORM), publicadores de eventos.
- **php-parser:** tree-sitter-php. Extrae rutas y controladores de Laravel/Symfony, llamadas Guzzle/cURL, modelos Eloquent/Doctrine.
- **openapi-parser:** cualquier archivo `openapi.*`/`swagger.*` prevalece sobre tipos inferidos.

Las URLs dinámicas (`${base}/x`) se emiten con `destino: null` y candidatos `origen: inferido` para que el indexador los resuelva.

### 4. Indexador (`brain draft <ruta-repo>`)

Corre los parsers y luego un prompt fijo le pide al agente el borrador de la página del repo: identidad, puntos de entrada, una arista por dependencia externa encontrada, cada una citando evidencia; destinos sin resolver listados bajo "Preguntas abiertas". La salida va a `_drafts/`, nunca directo a `tecnologia/`. El humano la mueve tras revisarla.

### 5. Puertas

- **Servidor MCP** (`brain serve`): expone las cuatro herramientas; instalado a nivel de usuario.
- **Hook de Claude Code**: el hook `UserPromptSubmit` ejecuta `brain context --repo . --prompt "$PROMPT" --budget 1500` e inyecta el resultado. El hook `SessionEnd` le pregunta al agente si algo contradijo la página del nodo y lo agrega a `_drafts/`.
- **Plugin de OpenCode**: las mismas dos llamadas.
- **Generadores de reglas** (`brain gen cursor|windsurf|agents`): emiten el bloque de `CLAUDE.md`/`AGENTS.md` apuntando al nodo y a las herramientas.

### 6. Verificador (`brain verify`)

Para cada arista con evidencia: comprueba que la ruta exista (y que la línea aún contenga el símbolo referido cuando se conoce). Si falta → estado `dudoso`. Reporta nodos sin verificar en N días. Código de salida distinto de cero cuando aparecen nuevas aristas dudosas (apto para CI).

### 7. Visor (`_build/viewer.html`)

HTML estático con Cytoscape.js: filtro por tipo, estado y origen; búsqueda por nombre; clic en nodo → resumen del frontmatter y enlace a la página. Sin servidor. La wiki se mantiene compatible con Obsidian (enlaces `[[id]]`).

## Orden de construcción para el agente

1. `SCHEMA.md` + fixtures: 6 páginas escritas a mano para un flujo de checkout (web → bff → payments → ext + tabla + feat) y su `graph.json` esperado. Son el oráculo de los tests.
2. Compilador, hasta que `compile(fixtures)` iguale el JSON esperado byte a byte.
3. Motor + CLI, testeados contra fixtures; tests golden-file para las cuatro herramientas.
4. Servidor MCP + hook de Claude Code llamando a las mismas funciones del motor; un test asegura JSON idéntico por ambas puertas.
5. ts-parser y openapi-parser, testeados sobre un repo de muestra Express+Prisma en `fixtures/repos/`.
6. php-parser sobre un repo Laravel de muestra.
7. Generación de borradores del indexador y verificador.
8. Visor y generadores de reglas.

## Criterios de aceptación

- `brain compile` sobre fixtures es idempotente y falla ruidosamente ante un verbo desconocido.
- `trazar --desde /checkout` sobre fixtures devuelve 5 saltos con evidencia y tipos de dato, idénticos por CLI, MCP y hook.
- `recorrer_grafo svc-payments --verbos depende_de --direccion in` devuelve el mismo conjunto ordenado en 10 ejecuciones consecutivas.
- Toda herramienta respeta `budget_tokens` con margen del 5% usando el tokenizador fijo.
- `brain index` sobre el repo TS de muestra produce ≥ 90% de las aristas etiquetadas a mano; sobre el PHP de muestra ≥ 80%.
- `brain verify` marca una arista como `dudoso` tras borrar su archivo de evidencia.
- Instalación para un usuario nuevo: `npx brain init` + una línea en la configuración de Claude Code, en menos de 5 minutos.

## Stack

TypeScript, Node ≥ 20, pnpm workspaces. `@modelcontextprotocol/sdk`, API del compilador `typescript`, `tree-sitter` + `tree-sitter-php`, `gray-matter` para frontmatter, `zod` para validación del esquema, `cytoscape` para el visor, `vitest` para tests. Almacenamiento: `graph.json` (SQLite + FTS5 detrás de la misma interfaz al superar 10k nodos). Licencia: Apache-2.0.

## Preguntas abiertas

- Tokenizador para presupuestos (tiktoken `cl100k` vs una estimación barata por caracteres).
- Dónde se revisan los `_drafts/`: PR sobre el repo brain por defecto.
- Si `trazar` debe cruzar hacia el OpenAPI público de sistemas externos cuando la página `ext` provee una URL.

## Prompt de arranque para Claude Code

Guardar este documento como `docs/PRD.es.md` (y el inglés como `docs/PRD.en.md`) en el repo nuevo, y pegar:

```
Vas a construir "Brain", un grafo de conocimiento determinístico para agentes de código. La especificación completa está en docs/PRD.es.md (y su equivalente en inglés en docs/PRD.en.md). Leela entera antes de hacer nada.

Reglas de trabajo:
1. Seguí el "Orden de construcción para el agente" del PRD al pie de la letra. No avances a un paso sin que los tests del anterior pasen.
2. Paso 1 es solo texto: escribí SCHEMA.md y las seis páginas fixture del flujo de checkout (web → bff → payments → ext + tabla + feat) más el graph.json esperado. Cuando termines, DETENETE y pedime revisión. No escribas código hasta que yo apruebe el esquema.
3. Determinismo es el requisito número uno: nada de aleatoriedad, timestamps ni dependencia del orden del filesystem en ninguna salida. Ordenamientos estables siempre.
4. El motor de consulta no llama a ningún LLM. Si en algún punto te parece necesario, parame y explicámelo.
5. Monorepo pnpm con la estructura de packages/ del PRD. TypeScript estricto, vitest, tests golden-file contra los fixtures.
6. Cada vez que tomes una decisión que el PRD deja abierta, anotala en docs/DECISIONS.md con fecha y motivo, y avisame en el resumen del paso.
7. Al cerrar cada paso, dame: qué construiste, qué tests pasan, qué quedó pendiente, y qué necesitás de mí.

Empezá por el paso 1.
```

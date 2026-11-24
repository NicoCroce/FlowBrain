# FlowBrain

FlowBrain arma un **grafo de conocimiento de tu sistema** para que un agente de código (Claude Code, Codex, OpenCode u otro) entienda el producto antes de tocarlo: qué funcionalidades tiene, qué pantallas las forman, qué endpoints llaman, qué métodos ejecutan, qué tablas tocan y **qué se rompe si algo cambia**, también entre repositorios y servicios distintos.

- **Lee el código, no adivina.** Los parsers leen TypeScript/JavaScript (React, React Native, Vue, Svelte, Astro, Next, Nest, Express…), PHP, OpenAPI, esquemas de base de datos e infraestructura (Docker, CI, Kubernetes, Helm, Terraform, serverless). Lo que un parser no entiende lo completa tu agente: estudia el repo y escribe *extractores* que FlowBrain verifica dato por dato.
- **Determinístico.** Ninguna consulta llama a un LLM. Cada dato cita su evidencia (`repo:ruta#Ln`), así el agente abre el archivo justo en vez de recorrer el repo con grep.
- **Para agentes y para personas.** Servidor MCP, hooks de Claude Code, CLI y un visor web con mapa, funcionalidades, especificaciones e impacto.

## Instalación

Parado en la carpeta del proyecto (la que tiene tus repos adentro, o un repo solo):

```bash
npx @nicocroce/flowbrain install
```

O instalado global, para tener el comando `flowbrain` siempre a mano:

```bash
npm i -g @nicocroce/flowbrain
flowbrain install
```

El paquete se llama `@nicocroce/flowbrain`, pero el comando es `flowbrain`. La instalación no compila nada nativo: no corre scripts de instalación.

## Cómo se usa

### 1. `flowbrain install`

- Deja los hooks y los comandos de Claude Code. Con `npx` no queda el comando `flowbrain` en el PATH: para tenerlo, instalalo global (`npm i -g @nicocroce/flowbrain`); si no, cada comando de esta guía se corre como `npx @nicocroce/flowbrain …`.
- Crea `.flowbrain/` en el proyecto, te muestra los repositorios que encontró (con su tecnología) y pregunta si va **un cerebro por repo** o **uno solo** para todo. Sin preguntar: `--repos <carpeta>` y `--split` o `--single`.
- Indexa todo y deja el visor en `.flowbrain/flowbrain.html`.
- Imprime la línea para conectar el MCP.

Los hooks y el MCP quedan apuntando a una versión fija (`npx -y @nicocroce/flowbrain@<versión>`), para que una publicación nueva no cambie nada sin aviso. Volver a correr `flowbrain install` actualiza.

### 2. El menú

Después, en el proyecto o en cualquiera de sus subrepos:

```bash
flowbrain
```

Abre un menú en la terminal: configurar el proyecto, analizarlo completo con el agente que elijas, reindexar, abrir el visor, ver el estado, conectar el MCP a un agente y actualizar FlowBrain. Si lo cortás a mitad, la próxima vez sigue desde el primer paso pendiente.

### 3. El visor en localhost

```bash
flowbrain viewer --serve
```

Lo sirve en `http://127.0.0.1:4780` (o el siguiente puerto libre). Muestra el mapa del sistema, las funcionalidades, pantallas, contratos, especificaciones, impacto y qué tan entendido quedó cada archivo. Desde ahí se puede corregir: sumar un archivo a una funcionalidad, confirmar reglas, declarar llamadas y **pedir tests** (ver abajo). Todo lo que guarda son archivos del cerebro, versionables.

### 4. El MCP en tu agente

En Claude Code, para todos tus proyectos:

```bash
claude mcp add --scope user flowbrain -- npx -y @nicocroce/flowbrain@0.1.0 serve --sync
```

En Codex:

```bash
codex mcp add flowbrain -- npx -y @nicocroce/flowbrain@0.1.0 serve --sync
```

Cualquier otro cliente MCP (OpenCode, Cursor, etc.): el comando es `npx -y @nicocroce/flowbrain@0.1.0 serve --sync` por stdio. El menú (`flowbrain` → *Conectar un agente*) lo registra por vos en el que elijas. Con `--sync` el servidor reindexa los repos que avanzaron antes de responder.

### 5. Varios cerebros: `flowbrain.yaml`

En un proyecto con varios servicios (un front, una API, un backend viejo, workers…), cada uno puede ser un cerebro y `.flowbrain/flowbrain.yaml` dice cuáles hay y cómo se comunican: qué base de URL va a qué servicio. Con eso las consultas cruzan de cerebro en cerebro: cambiar una tabla de un servicio llega a la pantalla del front que, pasando por otra API, termina escribiendo en ella.

```bash
flowbrain brains                 # cerebros del registro y su estado
flowbrain brains apply           # crea e indexa los que falten
flowbrain connections            # qué viaja entre cerebros
```

## Herramientas del MCP

| Herramienta | Para qué |
|---|---|
| `buscar_nodo` | Encontrar algo cuando no sabés su id: una clase, un método, una palabra. |
| `recorrer_grafo` | Vecinos de un nodo por tipo de relación. |
| `funcionalidad` | Qué hace una funcionalidad de producto: endpoints, pantallas, datos y relaciones. |
| `pantalla` | Una pantalla del front de punta a punta: de dónde se llega, a dónde lleva, qué llama del back. |
| `recorrido` | Qué ejecuta un endpoint o un método, paso a paso, y qué toca cada paso. |
| `contrato_de` | Qué recibe y devuelve un endpoint, y quién lo llama. |
| `quien_llama` | Quién llama a un método o a una clase. |
| `impacto` | Qué se rompe si cambia una tabla, un endpoint, un servicio o una funcionalidad. |
| `riesgo` | Alcance de un cambio concreto: un diff o unos archivos. |
| `trazar` | Por dónde viaja un dato entre servicios. |
| `deriva` | Endpoints que nadie llama y llamadas que nadie atiende, campo por campo. |
| `paridad` | Qué falta migrar de un servicio a otro. |
| `infra` | Cómo se construye, despliega y configura un servicio: imagen, pipeline, variables, proxy, Kubernetes, Helm, Terraform, serverless. |
| `especificaciones` | Qué tiene que cumplir una funcionalidad (reglas de negocio y de producto), qué archivo lo cumple y qué test lo verifica. |
| `sin_asociar` | Archivos que no son de ninguna funcionalidad y a cuál conviene asociar cada uno. |
| `fidelidad` | Qué tan confiable es lo que el grafo dice de un archivo o una funcionalidad, y qué falta completar. |
| `conexiones` | Qué llamadas cruzan entre cerebros (solo con varios cerebros). |

Las mismas consultas están en la CLI: `flowbrain search`, `feature`, `screen`, `flow`, `contract`, `callers`, `impact`, `risk`, `trace`, `drift`, `parity`, `infra`, `specs`, `unassigned`, `fidelity`. Por ejemplo `git diff | flowbrain risk --diff -`. `flowbrain --help` las lista todas.

## Comandos de Claude Code

`install` deja estos comandos en Claude Code. Se corren en orden la primera vez (el menú, con *Analizar el proyecto completo*, los encadena):

| Comando | Qué hace |
|---|---|
| `/flowbrain-study` | Estudia cómo está hecho cada repo y escribe los extractores que completan lo que los parsers no vieron. |
| `/flowbrain-index` | Analiza la comunicación real entre servicios: a qué servicio va cada llamada, con evidencia. |
| `/flowbrain-features` | Deduce y completa las funcionalidades de producto de cada cerebro. |
| `/flowbrain-specs` | Deduce las especificaciones de negocio y de producto de cada funcionalidad. |
| `/flowbrain-tests` | Resuelve cada regla: la verifica con un test, o informa por qué no se puede o si el código no la cumple. |

Con otro agente, las mismas instrucciones salen de `flowbrain coverage --guide`, `evidence --guide`, `feature --guide` y `specs --guide`.

## Pedir tests

En la pantalla Especificaciones del visor se eligen reglas y se piden sus tests en lote: FlowBrain abre tu agente por repo, con el proveedor y el modelo que elijas, y cada regla vuelve verificada por un test, para decidir (la regla puede estar mal) o para desarrollo (el código no la cumple). FlowBrain nunca cambia el código de producción.

## Requisitos

- **Node ≥ 20.**
- **Claude Code**, opcional: hace falta para el análisis completo (`/flowbrain-*`) y para pedir tests desde el visor. Sin él, el índice, el visor, la CLI y el MCP funcionan igual, y el análisis se puede hacer con otro agente pegando las guías.

## Diagnóstico

```bash
flowbrain doctor      # grafo, índice, clones, hooks y MCP registrados (solo lee)
flowbrain status      # repos al día, conteos y huecos conocidos
```

El contrato del grafo está en `SCHEMA.md`, dentro del paquete. Código y reportes: [github.com/NicoCroce/FlowBrain](https://github.com/NicoCroce/FlowBrain).

Licencia Apache-2.0.

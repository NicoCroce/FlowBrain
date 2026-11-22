# FlowBrain

Grafo de conocimiento de un sistema de software, hecho para que un agente de código entienda el producto antes de tocarlo: qué funcionalidades tiene, qué pantallas las forman, qué endpoints llaman, qué métodos ejecutan, qué tablas tocan y **qué se rompe si algo cambia**, también entre repositorios y servicios distintos.

- **Agnóstico a la tecnología.** Los parsers leen TypeScript/JavaScript (React, React Native, Vue, Svelte, Astro, Next, Nest, Express…), PHP, OpenAPI, esquemas de base de datos e infraestructura. Lo que un parser no entiende (Go, Python, Dart, Ruby, un framework propio) lo completa un modelo: estudia el repo y escribe *extractores* del proyecto que corren en cada indexación y que FlowBrain verifica dato por dato.
- **Determinístico.** Ninguna consulta llama a un LLM. Todo dato cita su evidencia (`repo:ruta#Ln`).
- **Para agentes y para personas.** Servidor MCP, hooks de Claude Code, CLI y un visor HTML con mapa 3D.

## Qué responde

| Pregunta | MCP | CLI |
|---|---|---|
| ¿Qué hace esta funcionalidad de producto? | `funcionalidad` | `flowbrain feature <id>` |
| Esta pantalla, de punta a punta | `pantalla` | `flowbrain screen </ruta>` |
| Qué ejecuta un endpoint, paso a paso | `recorrido` | `flowbrain flow "POST /x"` |
| Qué se rompe si cambio esto (y de qué depende) | `impacto` | `flowbrain impact <pieza>` |
| Qué tan riesgoso es este diff | `riesgo` | `git diff \| flowbrain risk --diff -` |
| Quién llama a este método | `quien_llama` | `flowbrain callers <Clase.metodo>` |
| Por dónde viaja un dato entre servicios | `trazar` | `flowbrain trace --from <x>` |
| Qué recibe y devuelve un endpoint | `contrato_de` | `flowbrain contract <nodo>` |
| Llamadas sin endpoint y endpoints sin uso | `deriva` | `flowbrain drift` |
| Qué falta migrar de un servicio a otro | `paridad` | `flowbrain parity <viejo> <nuevo>` |
| Cómo se construye y despliega | `infra` | `flowbrain infra` |
| Qué tiene que cumplir una funcionalidad, qué archivo lo cumple y qué test lo verifica | `especificaciones` | `flowbrain specs [feat]` |
| Qué archivos no son de ninguna funcionalidad y a cuál conviene asociarlos | `sin_asociar` | `flowbrain unassigned [carpeta]` |
| Qué tan entendido quedó cada archivo (0 a 100), qué le falta y un plan para llevarlo a 100 | `fidelidad` | `flowbrain fidelity [--plan]` |
| Qué llamadas cruzan entre cerebros | `conexiones` | `flowbrain connections` |
| Buscar un nodo / recorrer el grafo | `buscar_nodo`, `recorrer_grafo` | `flowbrain search`, `flowbrain traverse` |

El impacto sigue la dirección de las relaciones (una tabla → los métodos y endpoints que la usan → las pantallas y funcionalidades que los llaman) y cruza de cerebro en cerebro hasta cuatro saltos: cambiar una tabla de un servicio en Go llega a la pantalla del front en Vue que, pasando por una API en Python, termina escribiendo en ella.

## Instalación

Requiere Node ≥ 20, pnpm y un agente de código que pueda correr comandos (Claude Code, Codex, OpenCode u otro): FlowBrain no trae ni elige un modelo, el análisis lo hace el que uses.

```bash
git clone <este-repo> flowbrain && cd flowbrain
pnpm install
cd /ruta/al/proyecto
pnpm -s -C /ruta/a/flowbrain flowbrain install "$PWD"
```

`install` deja el comando `flowbrain` en el PATH, los hooks de Claude Code y los comandos `/flowbrain-study`, `/flowbrain-index`, `/flowbrain-features` y `/flowbrain-specs`; crea `.flowbrain/` en el proyecto, pregunta dónde están los repositorios y si va un cerebro por repo o uno solo, indexa todo y deja el visor en `.flowbrain/flowbrain.html`. Al final imprime la línea del servidor MCP:

```bash
claude mcp add --scope user flowbrain -- flowbrain serve --sync
```

### El menú

Después, en cualquier proyecto (o en cualquiera de sus subrepos), alcanza con escribir:

```bash
flowbrain
```

En un proyecto sin configurar arranca un asistente que hace todo en orden: prepara la máquina, te muestra los subrepositorios que encontró (con su tecnología) para que elijas cuáles entran y cómo se agrupan, indexa, conecta el MCP y ofrece el análisis completo con el agente que elijas (Claude Code, Codex, OpenCode, u otro: te da el pedido para pegarlo). Si lo cortás, la próxima vez sigue desde el primer paso pendiente. Ya configurado, abre un menú en la terminal (flechas y Enter, o el número) con lo que se puede hacer ahí: configurar el proyecto (detecta los subrepositorios y arma los cerebros), analizarlo completo con el agente que elijas, reindexar, abrir el visor, ver el estado, conectar el MCP a un agente y actualizar FlowBrain. Las opciones dependen del estado: sin `.flowbrain/`, lo primero es configurarlo. Cada opción corre los mismos comandos que se pueden escribir a mano.

Volver a correr `flowbrain install` actualiza. Detalle completo, instalación a mano y CI en [docs/INSTALACION.md](docs/INSTALACION.md).

## Cómo se completa un proyecto

Con Claude Code abierto en la carpeta del proyecto (con otro agente, el menú da un único pedido que recorre los mismos pasos con `flowbrain coverage --guide`, `evidence --guide` y `feature --guide`):

1. **`/flowbrain-study`**: el modelo estudia cómo está hecho cada repo, escribe `profile.md`, extractores en `.flowbrain/<cerebro>/extractors/<repo-id>/` para lo que los parsers no ven, y controles (`checks.yaml`) que tienen que seguir cumpliéndose. `flowbrain coverage` mide el avance.
2. **`/flowbrain-index`**: decide a qué servicio va cada llamada entre repos (por base de URL, configuración e infraestructura) y lo declara con evidencia.
3. **`/flowbrain-features`**: deduce las funcionalidades de producto, las explica y las une con sus pantallas, endpoints y tablas.
4. **`/flowbrain-specs`**: deduce de los tests y del código las especificaciones de cada funcionalidad (requisitos de negocio y de producto), con el archivo que las cumple y el caso que las verifica; quedan propuestas hasta que una persona las confirma.
5. **`flowbrain brains viewer`**: regenera el visor. Con **`flowbrain viewer --serve`** se abre en `http://127.0.0.1:4780` la pantalla Fidelidad deja corregir lo que le falta a cada archivo , la pantalla Especificaciones deja confirmar cada requisito y la pantalla Sin asociar deja sumar cada archivo suelto a su funcionalidad (solo escribe en `.flowbrain/`).

Todo lo que el modelo escribe queda en `.flowbrain/`, legible y versionable junto al proyecto; lo derivado (`_build/`, el visor) queda fuera de git.

## Estructura

| Paquete | Qué hace |
|---|---|
| `packages/core` | Esquema, compilación de páginas a `graph.json`, consultas, impacto y cruces entre cerebros |
| `packages/parsers` | Parsers (TypeScript, PHP, OpenAPI, esquema, infra), extractores del proyecto e indexador |
| `packages/indexer` | Borradores de páginas a partir del código |
| `packages/mcp` | Servidor MCP |
| `packages/hooks` | Hooks de Claude Code (contexto en cada prompt, notas al cerrar la sesión) |
| `packages/viewer` | Visor HTML: catálogo, pantallas, trazas, impacto, fidelidad y mapa 3D |
| `packages/cli` | Comando `flowbrain` y las guías de los comandos para el modelo |
| `packages/flowbrain` | Paquete npm publicable (un solo archivo armado con esbuild) |

Documentación: [SCHEMA.md](SCHEMA.md) (contrato del grafo), [docs/PARSERS.md](docs/PARSERS.md) (cómo sumar un parser), [docs/DECISIONS.md](docs/DECISIONS.md) (cada decisión, con fecha y motivo), [docs/PRD.es.md](docs/PRD.es.md).

## Desarrollo

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build          # packages/flowbrain/dist/flowbrain.mjs
pnpm flowbrain help # la CLI desde el código, sin armar
```

Las pruebas usan proyectos sintéticos en `fixtures/` y en directorios temporales; ninguna depende de código real ni de la red.

## Licencia

[Apache-2.0](LICENSE)

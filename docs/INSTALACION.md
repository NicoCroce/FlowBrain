# Instalación en Claude Code

## Con el paquete publicado (`flowbrain`)

```bash
npx flowbrain init mi-brain --claude-code
```

Crea el brain (estructura, `SCHEMA.md`, `README.md`), lo compila, registra los hooks `UserPromptSubmit` y `SessionEnd` en `~/.claude/settings.json` (conserva los demás hooks y deja un respaldo `settings.json.flowbrain.bak`) e imprime la única línea que falta, la del servidor MCP:

```bash
claude mcp add --scope user flowbrain -- npx -y flowbrain@0.1.0 serve --raiz /ruta/absoluta/a/mi-brain
```

Los hooks y el servidor usan una versión fija (`flowbrain@0.1.0`) para que una publicación nueva no cambie el comportamiento sin aviso. `init` nunca pisa archivos existentes y se puede repetir. Sin `--claude-code` no toca la configuración de Claude Code. El paquete instala dos comandos equivalentes, `flowbrain` y `brain`.

## Desde el repo (desarrollo)

FlowBrain también se usa desde este repo con `pnpm` (`pnpm flowbrain init …` genera comandos que apuntan al repo). En los ejemplos:

- `FLOWBRAIN_TOOL` es la ruta a este repo (el código de FlowBrain).
- `FLOWBRAIN_ROOT` es la ruta a tu brain (la carpeta con `producto/`, `tecnologia/` y `_build/`).

## 1. Compilar el brain

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain compile --raiz "$FLOWBRAIN_ROOT"
```

## 2. Servidor MCP (nivel usuario)

```bash
claude mcp add --scope user flowbrain -- pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain serve --raiz "$FLOWBRAIN_ROOT"
```

El servidor recarga el grafo solo cuando cambia `_build/graph.json`, así que no hace falta reiniciarlo después de compilar.

## 3. Hook UserPromptSubmit

En `~/.claude/settings.json`, reemplazando las rutas:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "pnpm -s -C /ruta/a/brain-tool flowbrain hook claude-code --raiz /ruta/a/mi-brain" }
        ]
      }
    ]
  }
}
```

El hook lee el JSON que manda Claude Code por stdin (`prompt`, `cwd`) e inyecta un bloque `<flowbrain-context>` con:

- el repo actual, si el nombre del directorio raíz de git coincide con el id (sin `repo-`), el nombre o un alias de un nodo `repo`;
- `trazar` para cada ruta HTTP o archivo mencionado que exista en el grafo (máximo 3);
- `recorrer_grafo` (vecinos en ambas direcciones) para cada nodo mencionado por id, nombre o alias exacto (máximo 5).

El presupuesto por defecto es de 1500 tokens. Si algo falla, el hook sale con código 0 y sin salida: nunca bloquea el prompt.

## 4. Hook SessionEnd (notas de contradicciones)

Mismo comando, registrado también en `SessionEnd`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "pnpm -s -C /ruta/a/brain-tool flowbrain hook claude-code --raiz /ruta/a/mi-brain" }
        ]
      }
    ]
  }
}
```

El hook distingue el evento por `hook_event_name`. Cuando el agente encuentra que el código contradice al brain, escribe en su respuesta una línea `flowbrain-nota <id-del-nodo>: <qué cambió>` (lo pide el bloque `<flowbrain-context>` y el bloque de reglas de `CLAUDE.md`). Al cerrar la sesión, el hook lee el transcript y agrega esas líneas a `_drafts/notas/<id>.md`. No gasta tokens ni bloquea nada. A mano: `flowbrain nota <id> <texto>`.

## 5. Verificación en CI

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain verify --raiz "$FLOWBRAIN_ROOT" --repos /ruta/a/los/clones
```

Busca el clon de cada repo como `<carpeta>/<id>`, `<carpeta>/<id sin repo->` o `<carpeta>/<alias>` (o `--clon repo-x=/ruta`). Sale con 1 si aparecen aristas dudosas nuevas. Las aristas de repos sin clon local no se verifican y conservan su estado anterior.

### Mantener el brain al día

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain sync --raiz "$FLOWBRAIN_ROOT"      # reindexa los repos cuyo clon avanzó y recompila
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain estado --raiz "$FLOWBRAIN_ROOT"    # repos al día o no, conteos y huecos; sale con 1 si hay desfase
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain doctor --raiz "$FLOWBRAIN_ROOT"    # diagnóstico de la instalación (solo lee)
```

Para que el agente consulte siempre sobre el código actual, registrá el servidor con `serve --sync`: cuando un clon avanzó, reindexa y recompila antes de responder.

`sync` usa la ruta del clon que guardó `flowbrain index` (relativa al brain); si el clon está en otro lado, `--repos <carpeta>` lo busca por nombre. No hace `git pull`.

## Varios cerebros

Para separar grupos de repos (por ejemplo, lo vigente de lo viejo) en hasta 5 cerebros, con la comunicación entre ellos activable:

```bash
mkdir ~/cerebros
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain cerebros proponer /ruta/a/los/repos --raiz ~/cerebros   # escribe ~/cerebros/cerebros.yaml
# editar cerebros.yaml: agrupar los repos en cerebros, responder las preguntas, activar la comunicación
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain cerebros aplicar --raiz ~/cerebros                      # crea e indexa cada cerebro
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain cerebros --raiz ~/cerebros                              # qué hay y con quién se comunica cada uno
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain conexiones --raiz ~/cerebros --cerebro vigente          # qué llamadas viajan a otros cerebros
open ~/cerebros/cerebros.html                                                          # visor: un cerebro dibujado por cada uno
```

```yaml
version: 1
cerebros:
  - nombre: vigente
    repos:
      - ruta: /ruta/a/web
      - ruta: /ruta/a/api
  - nombre: historico
    curado: false            # sin revisión humana: cada respuesta lo avisa
    repos:
      - ruta: /ruta/a/api-vieja
comunicacion:
  - entre: [vigente, historico]
    activa: true             # false: no hay pistas ni relaciones entre los dos
conexiones:                  # opcional: qué servicio llama a cuál y por dónde se distingue
  - desde: vigente/svc-web
    hacia: historico/svc-api-vieja
    por: LEGACY_API_URL      # variable de la URL base o host
```

El servidor MCP y los hooks apuntan a la carpeta del registro en vez de a un brain. `flowbrain cerebros registrar --raiz ~/cerebros` registra los hooks en Claude Code (reemplaza los de un brain anterior) e imprime la línea de `claude mcp add` para el servidor. Cada consulta usa el cerebro del repo donde estás; `cerebro` (o `--cerebro` en la CLI) elige otro. Volver a correr `aplicar` actualiza; cambiar `comunicacion` o `conexiones` tiene efecto en la siguiente consulta, sin reindexar.

## 6. Reglas para el agente

```bash
cd /ruta/a/un/repo
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain gen claude --raiz "$FLOWBRAIN_ROOT" --repo "$PWD" --escribir
```

Destinos: `claude` (bloque en `CLAUDE.md`), `agents` (bloque en `AGENTS.md`), `cursor` (`.cursor/rules/flowbrain.mdc`) y `windsurf` (`.windsurf/rules/flowbrain.md`). En `CLAUDE.md` y `AGENTS.md` el bloque va entre `<!-- flowbrain:reglas:inicio -->` y `<!-- flowbrain:reglas:fin -->`, así que regenerarlo no toca el resto del archivo. Sin `--escribir`, lo imprime. `--repo` acepta un directorio o un id de repo.

## 7. Visor

`flowbrain compile` escribe `_build/viewer.html`: un único archivo con el grafo y Cytoscape embebidos, sin servidor ni red. Se abre con doble clic. Tiene filtros por tipo, estado y origen, búsqueda, y al hacer clic en un nodo muestra su detalle, sus aristas con evidencia y el enlace a la página. Los endpoints y archivos arrancan ocultos.

## 8. Probar a mano

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain context --raiz "$FLOWBRAIN_ROOT" --repo . --prompt "¿qué se rompe si cambio /checkout?"
```

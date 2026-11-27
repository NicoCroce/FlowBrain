# Instalación en Claude Code

**Español** · [English](INSTALL.md)

## La forma corta: `flowbrain install` dentro del proyecto

La primera vez en una máquina, desde este repo (después el comando `flowbrain` queda en el PATH):

```bash
cd /ruta/al/proyecto
pnpm -s -C /ruta/a/este/repo flowbrain install "$PWD"
```

Las siguientes, en cualquier proyecto:

```bash
cd /ruta/al/proyecto
flowbrain install
```

`install` hace todo: deja el comando `flowbrain` y los hooks de Claude Code (sin atarlos a una carpeta), crea `.flowbrain/` en el proyecto, pregunta en qué carpeta están los repositorios (Enter: la del proyecto; en un monorepo, la carpeta de los paquetes) y si va un cerebro por cada uno o todos en uno, indexa y deja el visor en `.flowbrain/flowbrain.html`. Al final imprime las dos líneas del servidor MCP, que se corren una sola vez por máquina. Sin terminal (CI, un agente) no pregunta: `--repos <carpeta>` y `--split` o `--single` dicen lo mismo.

Volver a correrlo actualiza. Para reagrupar repos o apagar la comunicación se edita `.flowbrain/flowbrain.yaml` (ver "Varios cerebros"). Los hooks y el servidor MCP usan el `.flowbrain` de la carpeta donde se abrió Claude Code, o de cualquier carpeta por encima; fuera de un proyecto no hacen nada. `.flowbrain/.gitignore` deja fuera lo derivado (`_build/` y el visor).

### El menú

En un proyecto sin `.flowbrain/`, `flowbrain` arranca un **asistente** con los pasos en el único orden que funciona, porque cada uno usa lo que deja el anterior:

1. **Requisitos:** deja la máquina lista (`flowbrain setup`) y avisa si falta git o si no hay ningún agente de código conocido (Claude Code, Codex, OpenCode); sin ninguno sigue igual.
2. **Repositorios:** pregunta la carpeta, muestra los subrepositorios con su tecnología y lo que se ve a primera vista, deja elegir cuáles quedan afuera y si va un cerebro por repo o uno solo, y escribe `.flowbrain/` recién al confirmar. Sin código en la carpeta no crea nada.
3. **Índice:** corren los parsers.
4. **Agente (MCP):** lo conecta, en el agente que elijas, si se acepta.
5. **Análisis completo:** pide el ok, porque es lo que más tarda, y pregunta con qué agente (ver abajo).
6. **Visor.**

Cada paso mira primero si ya está hecho (`flowbrain.yaml`, `_build/graph.json` y `profile.md` de cada cerebro), así que cortarlo y volver a escribir `flowbrain` sigue desde el primero pendiente; el menú marca ese paso como **Siguiente paso** y arranca parado en él.

Ya configurado, `flowbrain` sin argumentos (o `flowbrain menu`, que lo abre siempre), en una terminal, abre un menú con lo que se puede hacer en el proyecto donde estás parado (lo encuentra también desde un subrepo):

- **Configurar este proyecto** (sin `.flowbrain/`): lo mismo que `flowbrain install`. Con el proyecto ya configurado, **Actualizar la configuración** deja al día el comando, los hooks y los comandos de Claude Code, y reindexa.
- **Analizar el proyecto completo:** pregunta con qué agente y lo abre con el análisis de punta a punta, en orden: estudio de cada repo y extractores (`flowbrain coverage --guide`), comunicación entre servicios (`flowbrain evidence --guide`), funcionalidades de producto (`flowbrain feature --guide`) y especificaciones de cada funcionalidad (`flowbrain specs --guide`). Si el proyecto no está configurado, lo configura antes. El análisis es siempre completo: no hay una versión rápida.
- **Reindexar** y **Ver estado** (todos los cerebros).
- **Abrir el visor:** lo sirve en `http://127.0.0.1:4780` (o el siguiente puerto libre) para ver y corregir desde la página, y abre el navegador. Si ya hay un visor de FlowBrain corriendo para el mismo proyecto, abre ese. Queda andando hasta Ctrl+C, que lo corta y vuelve al menú. Si el servidor no puede arrancar, abre `flowbrain.html` (solo lectura) y dice por qué.
- **Conectar un agente (MCP):** registra el servidor para todos tus proyectos en el agente que elijas; pregunta antes.
- **Actualizar FlowBrain:** desde el repo, `git pull --ff-only`, `pnpm install` y `flowbrain setup --mcp`; con el paquete publicado, `npm install -g @nicocroce/flowbrain@latest`. Después corre `flowbrain setup --mcp`, que vuelve a registrar el servidor MCP con la versión nueva en los agentes que ya lo tenían. Pregunta antes; si ya tenés la última, lo dice. Al abrir el menú, si hay una versión nueva publicada, la cabecera lo avisa.

`flowbrain setup` deja lista la máquina (comando, hooks y comandos de Claude Code) sin tocar ningún proyecto. Sin terminal, `flowbrain` sin argumentos imprime la ayuda.

### Con qué agente

FlowBrain no trae ni elige un modelo: los parsers no usan IA, y lo que no entienden lo completa el agente de código que uses, con el modelo que tenga configurado. Las instrucciones son las mismas para todos (las imprime `flowbrain coverage --guide`, `evidence --guide` y `feature --guide`) y FlowBrain verifica lo que el agente escribe. El menú ofrece los que encuentra instalados:

| Agente | Análisis | MCP |
|---|---|---|
| Claude Code | `claude "<pedido>"` | `claude mcp add --scope user flowbrain -- flowbrain serve --sync` |
| Codex (OpenAI) | `codex "<pedido>"` | `codex mcp add flowbrain -- flowbrain serve --sync` |
| OpenCode | `opencode --prompt "<pedido>"` | entrada `mcp.flowbrain` (`type: local`) en `~/.config/opencode/opencode.json`: el menú la muestra para pegar |
| Otro | el menú imprime el pedido para pegarlo en el agente que uses (tiene que poder correr comandos) | `flowbrain serve --sync` por stdio, en cualquier cliente MCP |

Los comandos `/flowbrain-*` y los hooks son de Claude Code; con otros agentes, el pedido del análisis ya lleva todo lo que hace falta.

### Que un modelo analice la comunicación real

La consola une llamadas con endpoints por método y ruta. Eso no alcanza para saber a qué servidor va una llamada: dos APIs pueden exponer las mismas rutas. Cuando una llamada coincide en más de un cerebro, no se une a ninguno y queda como disputada, hasta que una conexión declarada en `.flowbrain/flowbrain.yaml` diga a qué servicio va cada base de URL.

Ese análisis lo hace un modelo. `flowbrain install` deja el comando `/flowbrain-index` en Claude Code: abrí Claude Code en la carpeta del proyecto y escribí `/flowbrain-index` (o pedile "indexá este proyecto con FlowBrain"). El modelo reindexa, corre `flowbrain evidence`, sigue cada variable de URL hasta su valor en archivos de ejemplo, configuración e infraestructura, escribe las conexiones que pudo confirmar (`origen: modelo`, con su `evidencia`) y te devuelve lo confirmado, las dudas y las oportunidades de mejora. No abre archivos `.env` reales: si un valor solo está ahí, te lo pregunta.

Con otro agente, las mismas instrucciones salen de `flowbrain evidence --guide`.

El resto de este documento describe la instalación a mano, con la carpeta del brain donde se quiera.

## Con el paquete publicado (`@nicocroce/flowbrain`)

```bash
npx @nicocroce/flowbrain init mi-brain --claude-code
```

Crea el brain (estructura, `SCHEMA.md`, `README.md`), lo compila, registra los hooks `UserPromptSubmit` y `SessionEnd` en `~/.claude/settings.json` (conserva los demás hooks y deja un respaldo `settings.json.flowbrain.bak`) e imprime la única línea que falta, la del servidor MCP:

```bash
claude mcp add --scope user flowbrain -- npx -y @nicocroce/flowbrain@0.1.1 serve --root /ruta/absoluta/a/mi-brain
```

Los hooks y el servidor usan una versión fija (`@nicocroce/flowbrain@0.1.1`) para que una publicación nueva no cambie el comportamiento sin aviso. `init` nunca pisa archivos existentes y se puede repetir. Sin `--claude-code` no toca la configuración de Claude Code. El paquete se llama `@nicocroce/flowbrain` (el nombre `flowbrain` en npm es de otro proyecto) e instala el comando `flowbrain`.

## Desde el repo (desarrollo)

FlowBrain también se usa desde este repo con `pnpm` (`pnpm flowbrain init …` genera comandos que apuntan al repo). En los ejemplos:

- `FLOWBRAIN_TOOL` es la ruta a este repo (el código de FlowBrain).
- `FLOWBRAIN_ROOT` es la ruta a tu brain (la carpeta con `product/`, `technology/` y `_build/`).

## 1. Compilar el brain

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain compile --root "$FLOWBRAIN_ROOT"
```

## 2. Servidor MCP (nivel usuario)

```bash
claude mcp add --scope user flowbrain -- pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain serve --root "$FLOWBRAIN_ROOT"
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
          { "type": "command", "command": "pnpm -s -C /ruta/a/brain-tool flowbrain hook claude-code --root /ruta/a/mi-brain" }
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
          { "type": "command", "command": "pnpm -s -C /ruta/a/brain-tool flowbrain hook claude-code --root /ruta/a/mi-brain" }
        ]
      }
    ]
  }
}
```

El hook distingue el evento por `hook_event_name`. Cuando el agente encuentra que el código contradice al brain, escribe en su respuesta una línea `flowbrain-nota <id-del-nodo>: <qué cambió>` (lo pide el bloque `<flowbrain-context>` y el bloque de reglas de `CLAUDE.md`). Al cerrar la sesión, el hook lee el transcript y agrega esas líneas a `_drafts/notes/<id>.md`. No gasta tokens ni bloquea nada. A mano: `flowbrain note <id> <texto>`.

## 5. Verificación en CI

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain verify --root "$FLOWBRAIN_ROOT" --repos /ruta/a/los/clones
```

Busca el clon de cada repo como `<carpeta>/<id>`, `<carpeta>/<id sin repo->` o `<carpeta>/<alias>` (o `--clone repo-x=/ruta`). Sale con 1 si aparecen aristas dudosas nuevas. Las aristas de repos sin clon local no se verifican y conservan su estado anterior.

### Mantener el brain al día

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain sync --root "$FLOWBRAIN_ROOT"      # reindexa los repos cuyo clon avanzó y recompila
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain status --root "$FLOWBRAIN_ROOT"    # repos al día o no, conteos y huecos; sale con 1 si hay desfase
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain doctor --root "$FLOWBRAIN_ROOT"    # diagnóstico de la instalación (solo lee)
```

Para que el agente consulte siempre sobre el código actual, registrá el servidor con `serve --sync`: cuando un clon avanzó, reindexa y recompila antes de responder.

`sync` usa la ruta del clon que guardó `flowbrain index` (relativa al brain); si el clon está en otro lado, `--repos <carpeta>` lo busca por nombre. No hace `git pull`.

## Varios cerebros

Para separar grupos de repos (por ejemplo, lo vigente de lo viejo) en hasta 8 cerebros, con la comunicación entre ellos activable:

```bash
mkdir ~/cerebros
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain brains propose /ruta/a/los/repos --root ~/cerebros   # escribe ~/cerebros/flowbrain.yaml
# editar flowbrain.yaml: agrupar los repos en cerebros, responder las preguntas, activar la comunicación
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain brains apply --root ~/cerebros                      # crea e indexa cada cerebro
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain brains --root ~/cerebros                              # qué hay y con quién se comunica cada uno
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain connections --root ~/cerebros --brain vigente          # qué llamadas viajan a otros cerebros
open ~/cerebros/flowbrain.html                                                          # visor: un cerebro dibujado por cada uno
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

El servidor MCP y los hooks apuntan a la carpeta del registro en vez de a un brain. `flowbrain brains register --root ~/cerebros` registra los hooks en Claude Code (reemplaza los de un brain anterior) e imprime la línea de `claude mcp add` para el servidor. Cada consulta usa el cerebro del repo donde estás; `cerebro` (o `--brain` en la CLI) elige otro. Volver a correr `aplicar` actualiza; cambiar `comunicacion` o `conexiones` tiene efecto en la siguiente consulta, sin reindexar.

## 6. Reglas para el agente

```bash
cd /ruta/a/un/repo
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain gen claude --root "$FLOWBRAIN_ROOT" --repo "$PWD" --write
```

Destinos: `claude` (bloque en `CLAUDE.md`), `agents` (bloque en `AGENTS.md`), `cursor` (`.cursor/rules/flowbrain.mdc`) y `windsurf` (`.windsurf/rules/flowbrain.md`). En `CLAUDE.md` y `AGENTS.md` el bloque va entre `<!-- flowbrain:reglas:inicio -->` y `<!-- flowbrain:reglas:fin -->`, así que regenerarlo no toca el resto del archivo. Sin `--write`, lo imprime. `--repo` acepta un directorio o un id de repo.

## 7. Visor

`flowbrain compile` escribe `_build/viewer.html`: un único archivo con el grafo y Cytoscape embebidos, sin servidor ni red. Se abre con doble clic. Tiene filtros por tipo, estado y origen, búsqueda, y al hacer clic en un nodo muestra su detalle, sus aristas con evidencia y el enlace a la página. Los endpoints y archivos arrancan ocultos.

## 8. Probar a mano

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain context --root "$FLOWBRAIN_ROOT" --repo . --prompt "¿qué se rompe si cambio /checkout?"
```

## Publicar una versión (mantenedores)

```bash
pnpm release patch     # o minor, major, x.y.z; sin argumento, la versión actual
```

Antes, agregá en `packages/flowbrain/CHANGELOG.md` una sección `## x.y.z` con lo que cambia (puede quedar sin commitear: va en el commit de la versión). El comando controla que estés en `main`, sin otros cambios y al día con `origin`; sube la versión, la commitea y pushea; corre `npm publish` (typecheck, tests, build y el 2FA); espera a que npm termine de procesar la versión (tarda unos minutos y no hay que volver a publicar); y deja el tag `vx.y.z` en GitHub con las notas del CHANGELOG, más una release si está `gh`. Si algo falla a mitad, se vuelve a correr con la misma versión y sigue desde lo que falta. `--dry-run` muestra qué haría sin tocar nada.

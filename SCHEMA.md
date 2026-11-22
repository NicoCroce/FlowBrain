# SCHEMA — FlowBrain v0.1

Contrato del grafo. El compilador lo hace cumplir y el motor responde según él. Si algo no está acá, es inválido.

## 1. Identificadores

**IDs de página** (nodos escritos por humanos): slug `^[a-z]+-[a-z0-9]+(-[a-z0-9]+)*$`. El prefijo es el tipo: `svc-`, `repo-`, `lib-`, `db-`, `queue-`, `ext-`, `tabla-`, `feat-`, `team-`, `decision-`. El nombre del archivo es `<id>.md` y el `tipo` del frontmatter tiene que coincidir con el prefijo.

**IDs generados** (nodos que salen de los JSON de los parsers): `<id-padre>:<sufijo>`.

| Tipo | Forma | Ejemplo |
|---|---|---|
| `contrato` | `<svc-id>:contrato` | `svc-bff:contrato` |
| `endpoint` | `<svc-id>:<MÉTODO>:<ruta>` | `svc-bff:POST:/checkout` |
| `archivo` | `<repo-id>:<ruta/relativa>` | `repo-tienda:apps/bff/src/main.ts` |
| `pantalla` | `<svc-id>:pantalla:<ruta>` | `svc-web:pantalla:/perfil/{id}` |
| `componente` | `<svc-id o repo-id>:componente:<Nombre>` | `svc-ui:componente:Boton` |

Las rutas de endpoint se normalizan a `/segmento/{param}`: `:id`, `[id]` y `{id}` se escriben `{id}`, sin barra final, y el método va en mayúsculas.

Un ID duplicado hace fallar la compilación.

## 2. Tipos de nodo

| Tipo | Carpeta | Se escribe en | Campos propios (`atributos`) |
|---|---|---|---|
| `repo` | `technology/` | página | — |
| `svc` | `technology/` | página | `puntos_de_entrada` |
| `lib` | `technology/` | página | — |
| `db` | `technology/` | página | — |
| `queue` | `technology/` | página | — |
| `ext` | `technology/` | página | — |
| `tabla` | `technology/` | página | — |
| `feat` | `product/` | página | — |
| `team` | `product/` | página | — |
| `decision` | `product/` | página | — |
| `contrato` | — | `_build/contracts/<svc-id>.json` | `svc`, `fuente` |
| `endpoint` | — | `_build/contracts/<svc-id>.json` | `metodo`, `ruta`, `request`, `response`, `evidencia` |
| `archivo` | — | `_build/files/<repo-id>.json` | `repo`, `ruta`, `lenguaje` |
| `pantalla` | — | `_build/files/<repo-id>.json` | `ruta`, `componentes`, `evidencia`, `envuelta`, `sale`, `desdeEnvolturas` |
| `componente` | — | `_build/files/<repo-id>.json` | `paquete`, `archivo`, `evidencia` |

**Tipos propios.** Una página puede declarar un `tipo` que no está en la tabla (`job`, `worker`, `bucket`, `webhook`): una palabra en minúsculas (`[a-z][a-z0-9_-]*`) que no sea un tipo generado (`contrato`, `endpoint`, `archivo`, `pantalla`, `componente`, `metodo`). Va en `technology/` o en `product/`, admite los verbos de datos y de dependencia (`lee_de`, `escribe_en`, `llama_a`, `publica_en`, `consume_de`, `depende_de`, `usa`, `vive_en`), sale al final del índice y en el mapa 3D con un color propio, y entra en el impacto en las dos direcciones como cualquier otro nodo.

`svc` incluye todo proceso que se despliega: APIs, workers, crons y también frontends (SPA, app mobile). Un mismo repo puede tener varios `svc`, por ejemplo un monorepo o el mismo código desplegado con distintos roles.

## 3. Verbos

Toda arista va de `desde` a `hasta`.

| Verbo | desde | hasta | Dónde se escribe | Lleva datos |
|---|---|---|---|---|
| `llama_a` | svc, lib, ext; endpoint, pantalla, feat | svc, ext | `relaciones` (endpoint y pantalla: lo genera el compilador) | sí |
| `publica_en` | svc; endpoint, feat | queue | `relaciones` (endpoint: lo genera el compilador) | sí |
| `consume_de` | svc; endpoint, feat | queue | `relaciones` (endpoint: lo genera el compilador) | sí |
| `lee_de` | svc; endpoint, feat | db, tabla | `relaciones` (endpoint: lo genera el compilador) | sí |
| `escribe_en` | svc; endpoint, feat | db, tabla | `relaciones` (endpoint: lo genera el compilador) | sí |
| `depende_de` | repo, svc, lib → repo, svc, lib, db, queue, ext · feat → feat · tabla → tabla (clave foránea, la genera el compilador) | | `relaciones` | no |
| `implementa` | svc, lib, repo; pantalla, endpoint | feat | `relaciones` (pantalla y endpoint: lo genera el compilador) | no |
| `decidido_por` | cualquiera salvo generados | decision | `relaciones` | no |
| `vive_en` | svc, lib → repo · tabla → db | | campo `vive_en` | no |
| `pertenece_a` | repo, svc, lib, db, queue, ext, feat, tabla | team | campo `pertenece_a` | no |
| `expone` | svc | contrato | solo el compilador | no |
| `contiene` | repo → archivo · svc → endpoint · svc, repo → pantalla | | solo el compilador | no |
| `navega_a` | pantalla | pantalla | solo el compilador | no |
| `usa` | pantalla, svc, repo, lib, componente | componente | solo el compilador | no |

Reglas:
- `vive_en` y `pertenece_a` se escriben solo como campos de primer nivel, nunca dentro de `relaciones`.
- `expone`, `contiene` y `navega_a` los genera el compilador a partir de los JSON. Si aparecen en una página, la compilación falla.
- Se permite `desde == hasta`: un servicio que se llama a sí mismo por HTTP.
- **Relaciones finas.** Además de las aristas entre servicios, `compile` genera las de endpoints, pantallas y funcionalidades a partir de la extracción (`_build/extraction`) y de los recorridos del código. Cada una cita la línea del acceso o de la llamada y hereda su origen y su `dato` (una llamada `inferido` da una relación `inferido`):
  - endpoint → tabla (`lee_de`/`escribe_en`) y endpoint → servicio o externo (`llama_a`, con `endpoint` si se conoce): lo que toca el método que lo atiende y todo lo que llama dentro de su servicio, sin cruzar HTTP.
  - pantalla → servicio o externo (`llama_a`, con `endpoint`): las llamadas en el árbol de sus componentes.
  - endpoint → funcionalidad (`implementa`): el handler está en el `codigo` de la funcionalidad.
  - funcionalidad → tabla, servicio o externo: accesos y llamadas dentro de su `codigo` (sin archivos de test).
  - funcionalidad → funcionalidad (`depende_de`): llama a un endpoint que implementa la otra.
  - endpoint → cola y funcionalidad → cola (`publica_en`/`consume_de`): los mensajes de su recorrido o de su `codigo`, cuando la cola tiene página.

  Una funcionalidad también puede declararlas a mano en `relaciones`; si coinciden, gana la curada. Sin extracción no se genera ninguna. Como en todo `llama_a`, el destino es el servicio y el endpoint va en el campo `endpoint`.
- **`depende_de` en consultas es un superverbo:** `recorrer_grafo` con `verbos: [depende_de]` incluye también `llama_a`, `publica_en`, `consume_de`, `lee_de` y `escribe_en`. La arista explícita `depende_de` queda para dependencias que no son llamadas, como librerías o infraestructura.

## 4. Estados, orígenes y confianza

**Estados:** `vigente` (por defecto), `dudoso` (lo asigna `flowbrain verify` cuando falta la evidencia) y `deprecado` (lo marca un humano).

**Orígenes y su confianza:**

| origen | confianza | Evidencia |
|---|---|---|
| `curado` | 1.0 | opcional |
| `parser` | 0.9 | obligatoria |
| `inferido` | 0.5 | obligatoria |

La confianza se deriva del origen y no se escribe a mano.

**Aristas duplicadas:** se considera la misma arista cuando coinciden `(desde, verbo, hasta, endpoint)`. Se conserva la de mayor confianza. Si esa no tiene evidencia y otra sí, se toma la evidencia de la otra.

## 5. Evidencia

Formato: `<repo-id>:<ruta/relativa>[#L<n>[-L<m>]]`, con la expresión regular `^repo-[a-z0-9-]+:[^\s#:]+(#L\d+(-L\d+)?)?$`.

- El `repo-id` tiene que existir como nodo.
- No se aceptan rutas absolutas, `..`, `./` ni barras iniciales.
- El compilador solo valida el formato. Que el archivo exista lo comprueba `flowbrain verify`.

## 6. Frontmatter de página

```yaml
id: svc-payments                  # obligatorio, igual al nombre del archivo
tipo: svc                         # obligatorio, igual al prefijo del id
nombre: Servicio de pagos         # obligatorio
resumen: Cobra pedidos y registra pagos.   # obligatorio, una línea, ≤ 140 caracteres
aliases: [payments, pagos]        # opcional
estado: vigente                   # opcional, por defecto vigente
origen: curado                    # opcional, por defecto curado
actualizado: 2026-11-15           # opcional, YYYY-MM-DD
verificado: 2026-11-15            # opcional, YYYY-MM-DD
tecnologia: [typescript, express] # opcional
vive_en: [repo-tienda]            # opcional
pertenece_a: [team-plataforma]    # opcional
puntos_de_entrada:                # solo para svc; rutas relativas al único repo de vive_en
  arranque: apps/payments/src/main.ts
codigo:                           # para feat y lib: carpetas (o archivos) que la componen, en uno o varios repos
  - repo-tienda:apps/web/src/features/checkout
especificaciones:                 # solo para feat: requisitos de negocio y de producto, en llano
  - id: tarjeta-vencida           # obligatorio, único en la funcionalidad (minúsculas, números y guiones)
    texto: No se puede pagar con una tarjeta vencida.   # obligatorio, hasta 400 caracteres
    tipo: negocio                 # obligatorio: negocio | producto
    archivos:                     # opcional: dónde se cumple, repo:ruta con #Ln opcional
      - repo-tienda:apps/bff/src/pagos/validar.ts#L18
    tests:                        # opcional: repo:ruta::nombre del caso, o repo:ruta (el archivo entero)
      - repo-tienda:apps/bff/test/validar.test.ts::rechaza una tarjeta vencida
    estado: propuesta             # opcional: propuesta (por defecto) | confirmada
relaciones:                       # opcional
  - verbo: llama_a                # obligatorio
    destino: svc-auth             # obligatorio, id existente, nunca null
    endpoint: "POST /tokens"      # opcional, solo con llama_a hacia un svc con contrato; tiene que existir
    dato: CargoPasarela           # opcional, nombre del tipo que viaja cuando no hay endpoint
    evidencia: "repo-x:src/clients/auth.ts#L12"
    origen: parser                # opcional, por defecto curado
    estado: vigente               # opcional
```

Un campo desconocido, un enum fuera de rango, un destino inexistente o un verbo que no admite ese par de tipos hacen fallar la compilación. El error indica archivo y línea.

Si una página tiene `puntos_de_entrada`, su `vive_en` tiene que tener exactamente un repo.

**`codigo` en una `lib`:** las carpetas o archivos que son de la librería (código compartido, núcleo, sistema de diseño). No genera `implementa`. `compile` genera `depende_de` desde cada funcionalidad (u otra librería) que tenga un archivo que importa o llama a uno de la librería, con ese archivo como evidencia; así `impacto` sobre la librería alcanza a las funcionalidades que la usan. Queda en el atributo `codigo` del nodo.

**`codigo` (en `feat`):** cada entrada es `<repo-id>:<ruta>`, sin línea, con el repo existente. El compilador genera `implementa` (origen `parser`, evidencia = la entrada) desde cada servicio de ese repo hacia la funcionalidad. En un monorepo, solo desde los servicios cuya raíz (la carpeta común de sus `puntos_de_entrada`) contiene la ruta o está dentro de ella; si ninguno, desde todos los del repo; si el repo no tiene servicios, desde el repo. También genera `implementa` desde cada `pantalla` hacia la funcionalidad cuyo `codigo` contiene el archivo de su componente (evidencia = ese archivo).

Los destinos sin resolver nunca llegan a una página compilada. Van como prosa en la sección `## Preguntas abiertas`.

**Cuerpo de la página:** prosa libre en Markdown, compatible con Obsidian (`[[id]]`). El compilador escribe la sección de backlinks entre `<!-- brain:backlinks:inicio -->` y `<!-- brain:backlinks:fin -->`, y no toca nada fuera de esos marcadores.

## 7. JSON generado por los parsers

**`_build/contracts/<svc-id>.json`**

```json
{
  "endpoints": [
    { "evidencia": "repo-x:src/routes/a.ts#L3", "metodo": "POST", "request": "TipoReq", "response": "TipoRes", "ruta": "/a" }
  ],
  "eventos": [
    { "cola": "queue-x", "direccion": "publica", "evidencia": "repo-x:src/b.ts#L9", "nombre": "pago.aprobado", "payload": "TipoEvt" }
  ],
  "fuente": "ts-parser",
  "svc": "svc-x",
  "tipos": { "TipoReq": { "campo": "string" } }
}
```

`eventos` lista lo que el servicio publica y consume, uno por (nombre, dirección) con la primera evidencia. `nombre` es la clave del mensaje (el literal o el valor de la constante; si la clave no es un texto, su nombre en el código). `cola` es la página `queue` con ese nombre o alias, o `null` si no hay ninguna: el evento se registra igual. `payload` hoy es siempre `null`. Se cuentan los mensajes de forma inequívoca (`emit`, `publish`, `enqueue`, `produce`, `dispatch` con clave de texto; decoradores de suscripción) y, de los dudosos (`send`, `add`, `on`…), solo los que se publican y se consumen con la misma clave dentro del repo. Un servicio sin endpoints pero con eventos también tiene contrato. Hoy los detecta el ts-parser.

Un endpoint puede traer `query`: el tipo de sus parámetros de query (un DTO, o la forma `<Clase.metodo>:query` si se declaran de a uno). Ausente si no se determinó.

`request` y `response` pueden ser `null` (no se pudo determinar: es un hueco, no "sin cuerpo"). Son el nombre de un tipo, `T[]`, un genérico con su texto (`Record<string, unknown>`) o varios unidos con ` | `. `tipos` es un mapa de nombre a forma, con tipos expresados como strings estilo TS; incluye interfaces, tipos y clases de datos (propiedades públicas). Si un handler devuelve un objeto literal sin tipo, su forma se guarda como `<Clase.metodo>:respuesta` (con varios `return` literales, la unión de sus claves: la que falta en alguno lleva `?`), con `unknown` en lo que no se sabe y la clave `…` si esparce otro objeto. Cuando hay `openapi-parser`, prevalece sobre cualquier tipo inferido.

**`_build/files/<repo-id>.json`**

```json
{
  "archivos": [
    {
      "importa": ["src/pagos/pago.service.ts"],
      "invoca": [{ "archivo": "src/pagos/pago.service.ts", "desde": "PagoController.crear", "linea": 8, "simbolo": "PagoService.crear" }],
      "lenguaje": "typescript",
      "ruta": "src/pagos/pago.controller.ts",
      "simbolos": [
        { "fin": 10, "linea": 3, "nombre": "PagoController", "tipo": "clase" },
        { "fin": 9, "linea": 7, "nombre": "PagoController.crear", "tipo": "metodo" }
      ]
    }
  ],
  "repo": "repo-x"
}
```

- `commit` (opcional): commit de HEAD del clon al indexar, leído de `.git` sin ejecutar git.
- `simbolos`: funciones, clases, métodos (`Clase.metodo`, en la línea del nombre), interfaces, tipos y enums; `fin` es la última línea, si el parser la conoce.
- `esquema` (opcional, raíz del JSON): por cada tabla con página, `tabla` (id), `evidencia` (dónde se crea), `columnas` (`nombre`, `tipo`, `nulo`, `pk`) y `fks` (`columnas`, `hasta` = id de la tabla referenciada, `columnasRef`, `evidencia`). `compile` deja `columnas` y `esquema` en los atributos del nodo de la tabla y genera `depende_de` de tabla a tabla por cada clave foránea, con `dato` = `columna → columna referenciada`. Lo genera el esquema-parser: lee DDL (`CREATE`/`ALTER`/`DROP TABLE`) en archivos `.sql` y dentro del texto de archivos de código (migraciones), y modelos de `schema.prisma`; aplica las sentencias en orden de ruta. Las tablas sin página y las claves foráneas hacia tablas sin página se omiten.
- `infra` (opcional, raíz del JSON): infraestructura declarada en el repo. Cada entrada tiene `de` (nodo dueño), `clase` (`imagen`, `servicio`, `pipeline`, `variables`, `proxy`), `nombre`, `detalle` (lista de textos: puertos, comandos, pasos, nombres de variables) y `evidencia`; un servicio de compose puede traer `dependeDe` (ids). `compile` la deja en el atributo `infra` del nodo dueño y genera `depende_de` por cada `dependeDe`. La genera el infra-parser a partir de Dockerfile, compose, pipelines de CI (Bitbucket, GitHub Actions, GitLab), archivos de variables de ejemplo (`.env.example` y similares) y configuración de nginx. **Nunca se lee un `.env` real ni se guarda un valor:** de las variables, solo los nombres. Dueño: el servicio de compose cuyo nombre coincide con una página (svc, db, queue, ext); si no, el servicio del paquete donde está el archivo; si no, el repo.
- `componentes` (opcional, por archivo): componentes de interfaz que exporta (`nombre`, `linea`), solo si el archivo es de una librería: un paquete cuyo `package.json` tiene `name` y dice por dónde se entra (`main`, `module`, `exports`, `types` o `svelte`). Son funciones, clases y constantes exportadas con nombre de componente (`Boton`), y el archivo entero en un componente de un solo archivo (`.vue`, `.svelte`, `.astro`). También es una librería una carpeta que se importa con un alias exacto del tsconfig (`"@ds": ["./design-system/src"]`, con un `index`), con el alias de nombre; uno que apunta a la raíz o a `src` del paquete es un atajo a toda la app y no cuenta. Quedan afuera historias, tests y páginas de muestra (`.page`, `.demo`, `examples/`).
- `usaPaquetes` (opcional, por archivo): componentes que toma de otro paquete (`desde`, el símbolo que lo dibuja o `null`; `paquete`, el nombre sin subruta; `simbolo`, el nombre exportado; `linea`). Cuenta lo que se dibuja: una etiqueta JSX, o, en un componente de un solo archivo, lo importado que el `<script>` no usa como valor (lo dibuja el template). Una clase o un decorador con mayúscula no cuenta. Un import que el repo resuelve a otra librería del mismo monorepo cuenta con el nombre de esa librería.
- `paquetes` (opcional, raíz del JSON): cada manifiesto del repo (`package.json`, `composer.json`, `pubspec.yaml`, `go.mod`, `pyproject.toml`, `Cargo.toml`, en la raíz y en cada paquete, más cada librería por alias, cuyo `manifiesto` es el tsconfig) con `carpeta`, `manifiesto`, `nombre` (con el que se publica) y `dependeDe` (`nombre` y `linea` de cada dependencia declarada).
- `importa` (opcional): archivos del mismo repo que importa. `invoca` (opcional): llamadas de cada método o función a símbolos de otros archivos o clases del repo; una llamada a una interfaz o método abstracto se atribuye a las clases que lo implementan. Hoy los genera el ts-parser.
- `casos` (opcional): si es un archivo de test, sus casos: `[{ "nombre": "rechaza una tarjeta vencida", "linea": 12, "grupo": "Pago › con tarjeta" }]`. Se leen del texto, en cualquier lenguaje: llamadas con el nombre como texto (`it("…")`, `test "…" do`), marcas antes de la función (`@Test`, `#[Test]`, `[Fact]`) y funciones que se llaman `test…`. Un nombre de función se pasa a palabras. Es un test seguro por ubicación o nombre (`x.test.ts`, `tests/`), y entonces `casos` viene aunque quede vacío (no se le pudieron leer); por sufijo solo (`XTest.php`, `test_x.py`) cuenta si adentro hay casos. Un test de un lenguaje sin parser entra igual, sin símbolos.

- `pantallas` (opcional): rutas del router del front con `ruta` (normalizada como las de endpoint), `archivo` y `linea` donde se declaran, `componente` (`{archivo, simbolo}` o `null`) y `envuelta` (componentes de las rutas contenedoras: layouts y guardas, de afuera hacia adentro).
- `navegaciones` (opcional): `{paquete, archivo, linea, desde, ruta, tipo}`, con `tipo` `navega` (`navigate(…)`), `enlace` (`<Link to>`, ítems de menú) o `redirige` (`<Navigate>`); `desde` es la función que navega, o `null` si es un dato suelto del archivo.

`compile` crea un nodo `pantalla` por ruta y servicio. Una pantalla `navega_a` otra si su componente, o algo que llama o dibuja (hasta 8 niveles), navega a esa ruta; los datos sueltos cuentan si su archivo es parte del recorrido o lo importa. Lo que navegan los layouts y las guardas queda en `envuelta[].sale` y, del lado del destino, en `desdeEnvolturas`.

`compile` también crea un nodo `componente` por cada componente que exporta una librería con nombre (el paquete que lo contiene, según `paquetes`). Una pantalla `usa` un componente si su componente, o algo que llama o dibuja, lo dibuja; si el uso no es de ninguna pantalla, lo `usa` el servicio (o repo) dueño del archivo. Un servicio `depende_de` el dueño del paquete si lo importa o si lo declara en su manifiesto (`dato` es el nombre del paquete). Funciona igual en un monorepo (cada paquete del workspace) y entre repos del mismo cerebro.

Los símbolos se quedan en este JSON y no pasan a `graph.json`. `flowbrain verify` los usa para comprobar que la línea citada por una evidencia todavía nombre al símbolo (en un método, su nombre sin la clase); `compile`, para la sección "cómo está construida" de cada funcionalidad.

### `_build/verification.json` (escrito por `flowbrain verify`)

```json
{
  "dudosas": [
    { "desde": "svc-x", "endpoint": null, "evidencia": "repo-x:src/a.ts#L3", "hasta": "ext-y", "motivo": "archivo inexistente", "verbo": "llama_a" }
  ],
  "version": 1
}
```

`compile` marca `estado: dudoso` en cada arista cuya `(desde, verbo, hasta, endpoint, evidencia)` aparezca acá, salvo que esté `deprecado`. Si la evidencia de la página cambia, la arista deja de coincidir y vuelve a `vigente` hasta la próxima verificación.

### `_build/features.json` (escrito por `flowbrain compile`)

Vista de producto de cada `feat`, derivada de las rutas de `codigo` y de `_build/extraction/*.json`: su campo `accesos` conserva cada llamada y cada acceso con su evidencia (`aristas` deja uno por par, para los borradores), y `pendientes` los accesos a tablas sin página. Se escribe solo si hay alguna `feat`.

```json
{
  "funcionalidades": [
    {
      "archivos": 12,
      "codigo": ["repo-tienda:apps/web/src/features/checkout"],
      "cuerpo": "# Checkout\n\nEl cliente confirma el carrito…",
      "datos": [{ "escribe": 1, "evidencia": "repo-tienda:apps/bff/src/routes/checkout.ts#L30", "lee": 0, "tabla": "tabla-pagos" }],
      "expone": ["svc-bff:POST:/checkout"],
      "id": "feat-checkout",
      "implementan": ["svc-bff"],
      "usa": [{ "endpoint": "svc-payments:POST:/charges", "evidencia": "repo-tienda:apps/bff/src/routes/checkout.ts#L18", "hasta": "svc-payments", "veces": 1 }],
      "usadaPor": ["feat-carrito"],
      "usaFuncionalidades": ["feat-pagos"]
    }
  ],
  "version": 1
}
```

- `expone`: endpoints cuya evidencia cae dentro de `codigo`. `usa`: llamadas (`llama_a`) hechas desde `codigo`, agrupadas por destino y endpoint. `datos`: accesos a tablas desde `codigo`.
- `usaFuncionalidades`: las `feat` dueñas (por `codigo`) de los endpoints que esta llama. `usadaPor` es la inversa.
- `cuerpo`: el Markdown de la página sin la sección de backlinks.
- `recorridos`: por cada endpoint de `expone`, los pasos desde el método que lo atiende siguiendo `invoca` (hasta 6 niveles y 40 pasos), cada uno con su `capa`, `evidencia`, `nivel`, quién lo llama (`desde`) y lo que `toca` (`lee_de`/`escribe_en` una tabla o `llama_a` un servicio, si la línea de la extracción cae dentro del método; `sinPagina: true` si la tabla no tiene página). Se omiten funciones sueltas que no tocan nada. Un paso de repositorio (`*Repository*`, `*.dao.*`, `*.sql.*`) que no toca ninguna tabla, ni él ni lo que llama, lleva `aviso`; un recorrido cortado lleva `truncado: true`.
- `tests`: archivos de test de la funcionalidad, cada uno con sus `casos` y `por`: `ubicacion` (vive dentro de su `codigo`) o `importa` (vive afuera y de ninguna otra funcionalidad importa más archivos; si empatan, es de todas ellas). Un test dentro del código de una funcionalidad es solo de esa.
- `especificaciones`: las de la página, cruzadas con el índice. `tests` trae cada caso encontrado (`archivo`, `caso`, `linea`) o el archivo entero con cuántos `casos` tiene; el caso se busca por nombre (o `grupo › nombre`), sin distinguir mayúsculas ni espacios, porque la línea se corre con cada cambio. `rotos`: archivos y casos que el índice no encuentra. De un repo sin indexar no se marca nada. `estado` es `propuesta` salvo que la página diga `confirmada`.
- `dominio`: archivos de capa `dominio` de `codigo` o importados por ella o por los pasos de los recorridos, con sus clases, interfaces, tipos y enums (`elementos`), cuántas funciones tienen, la `feat` dueña si es otra (`de`) y las demás que también lo usan (`usadoPor`).

### `_drafts/` (fuera de la compilación)

- `_drafts/<repo-id>/technology/*.md`: páginas propuestas por `flowbrain draft`, con el mismo formato que `technology/` y `resumen: "Borrador: completar resumen."` donde falta. Lo no resuelto va en una sección `## Preguntas abiertas`.
- `_drafts/product/feat-*.md`: funcionalidades propuestas por `flowbrain draft`, una por cada hija de una carpeta `features/`, `modules/` o `domains/` (hasta 4 niveles, salvo debajo de `shared/`, `core/`, `common/` y similares). Si ya hay una página o un borrador con el mismo id, se le suma la ruta a `codigo`: la misma carpeta en dos repos queda en una sola funcionalidad.
- `_drafts/<repo-id>/PROMPT.md`: instrucciones fijas para que un agente refine los borradores.
- `_drafts/notes/<id>.md`: notas de contradicciones entre el código y el brain (`flowbrain note` o el hook `SessionEnd`).

`compile` nunca lee `_drafts/`. Un humano mueve los borradores a `technology/` y `product/` tras revisarlos.

## 8. `graph.json`

```json
{ "edges": [ ... ], "nodes": [ ... ], "version": 1 }
```

**Nodo:** `actualizado`, `aliases`, `atributos`, `estado`, `id`, `nombre`, `origen`, `pagina`, `resumen`, `tecnologia`, `tipo`, `verificado`. Todos los campos están siempre presentes y valen `null`, `[]` o `{}` cuando faltan. `pagina` es la ruta relativa al `.md` o `null` en los nodos generados.

**Arista:** `confianza`, `dato`, `desde`, `endpoint` (ID del endpoint o `null`), `estado`, `evidencia`, `hasta`, `origen`, `verbo`. Todos los campos están siempre presentes.

**Serialización canónica (rige para toda salida JSON del sistema):**
- Claves de objeto en orden alfabético por code unit, a cualquier profundidad.
- Nodos ordenados por `id`. Aristas ordenadas por `(desde, verbo, hasta, endpoint ?? "")`.
- Las comparaciones de strings usan code units UTF-16 (`<` de JS), nunca `localeCompare`.
- Indentación de 2 espacios, `\n` al final y UTF-8 sin BOM.
- Sin timestamps de compilación, sin rutas absolutas y sin depender del orden del filesystem.
- Los arrays escritos por un autor (`aliases`, `tecnologia`) conservan su orden. El resto se ordena.

## 9. Proyecciones

| Proyección | Contenido |
|---|---|
| `resumen` | `id`, `tipo`, `nombre`, `estado`, `resumen` |
| `relaciones` | `resumen` más las aristas entrantes y salientes, con verbo, extremo, endpoint, evidencia, confianza y estado |
| `contrato` | `relaciones` más los endpoints con sus tipos expandidos desde `tipos` |
| `completo` | `contrato` más la prosa de la página, sin la sección de backlinks |

**Presupuesto:** `tokens(s) = ceil(s.length / 4)` sobre la serialización canónica compacta de la salida (sin indentación).

**Orden de recorte cuando se excede el presupuesto:**
1. Prosa.
2. Endpoints.
3. Aristas, de menor a mayor confianza y, con la misma confianza, en orden inverso al canónico.

Si con todo eso sigue sin entrar, se quitan nodos desde el final y, en `trazar`, saltos desde el final. La salida incluye `truncado: boolean` y `omitidos: { aristas, endpoints, nodos, prosa, saltos }`. Presupuesto por defecto: 2000; `null` desactiva el límite.

La proyección `relaciones` no muestra `contiene` ni `expone` (se ven con `contrato`).

## 10. Semántica de consultas

Todas las herramientas ordenan sus resultados por confianza descendente y después por id ascendente.

- **`buscar_nodo`:** orden de coincidencia: `exacta` con id, nombre o alias; `prefijo`; `contiene` (el texto está dentro del nombre o de un alias; de un archivo, solo en su nombre sin carpetas); `difusa` (distancia de Levenshtein ≤ 2 sobre id, nombre y aliases); `texto` (aparece en el resumen o en la prosa de la página). `contiene` y `texto` piden al menos 3 caracteres. La comparación ignora mayúsculas y acentos (NFD sin marcas).
  - **Símbolos de código.** Si el brain tiene índice de código, la respuesta suma `simbolos`: clases, métodos, funciones y tipos cuyo nombre coincide (`exacta`, `prefijo` o `contiene`; un método también por su nombre sin la clase), cada uno con `tipo` y `ev` (`repo:ruta#Ln` de su definición), y `totalSimbolos`. No son nodos del grafo: sirven para pasarlos a `recorrido`, `quien_llama` o `impacto`. `tipos: ["simbolo"]` devuelve solo símbolos; cualquier otro filtro de tipos los deja afuera. Con presupuesto excedido se recortan desde el final y se informa `simbolosOmitidos`.
- **Serialización.** El MCP responde JSON compacto, que es el texto sobre el que se mide `budget_tokens` (caracteres / 4). La CLI devuelve el mismo JSON indentado.
- **`recorrer_grafo`:** BFS por niveles desde el nodo, con profundidad por defecto 1 y máximo 5. Sin `verbos`, usa todos menos `contiene` y `expone`. La raíz va como nivel 0; cada nodo aparece una sola vez, en el primer nivel donde se lo alcanza, con `nivel` y `via` (la arista de mayor confianza que lo alcanzó).
- **`contrato_de`:** acepta un svc o un endpoint; proyección por defecto `resumen`, pero siempre incluye los endpoints (tipos expandidos y `llamado_por`) y los eventos.
- **`trazar`:**
  1. `desde` se resuelve a un nodo: un id, una URL o ruta (contra la `ruta` de los endpoints, con `{param}` como comodín) o un archivo.
  2. Si es un endpoint, el nivel 1 son las aristas `llama_a` que lo tienen como `endpoint`, y se sigue desde el svc dueño.
  3. Después se hace BFS sobre los verbos que llevan datos, siguiendo `publica_en` hacia la cola y, desde una cola, las aristas `consume_de` en sentido inverso.
  4. Cada arista se incluye una sola vez y cada nodo se expande una sola vez. La profundidad máxima es 5.
  5. Cada salto informa `desde`, `hasta`, `verbo`, `endpoint`, `dato` (`request → response` si hay endpoint, o el `dato` de la arista), `evidencia`, `confianza` y `nivel`.
  6. Con `hasta`, se devuelven solo los saltos de los caminos más cortos.

Consultas de código y producto (necesitan `flowbrain index` + `flowbrain compile`; sin índice, error `parametro_invalido`). Todas devuelven `avisos` (huecos conocidos: falta de dato, no "no pasa nada") e `indice` (repo → commit de HEAD al indexar, 12 caracteres). Con presupuesto excedido recortan listas desde el final y agregan `truncado: true` y `omitidos: n`.

- **`especificaciones`:** sin argumentos, por funcionalidad: cuántas tiene, cuántas confirmadas, cuántas sin test, sus casos de test y cuántos de esos casos no verifican ninguna (`casosSinEspecificacion`). Con `funcionalidad`: cada requisito con `archivos`, `tests`, `sinTest` y `rotos`, y los casos sueltos (hasta 40). Filtros: `estado`, `tipo`, `sin_test`. Un caso cuenta como verificador si una especificación lo nombra o nombra su archivo entero.
- **`sin_asociar`:** archivos del índice (sin los tests) que no caen en el `codigo` de ninguna `feat` ni `lib`, agrupados por carpeta. A cada uno le recomienda la funcionalidad con más indicios, con el motivo: atiende un endpoint que esa funcionalidad llama (peso 4), lo importan archivos suyos (3), importa archivos suyos (2), sus vecinos de carpeta son de ella (1 cada uno, hasta 5; la mitad si son de la carpeta de arriba). `otras`: hasta 2 con al menos el 40 % de los puntos de la primera. `compartido`: lo importan dos o más funcionalidades y ninguna junta el 60 % de los usos; no se recomienda ninguna. `carpetaLibre`: ningún archivo de su carpeta ni de las de adentro tiene dueño. La carpeta lleva `recomendada` solo si la tienen más de la mitad de sus archivos. Filtros: `carpeta`, `funcionalidad` (`ninguna`: los que no tienen pista). No tener funcionalidad no entra en el puntaje de `fidelidad`.
- **`fidelidad` e inciertos:** el puntaje de un archivo es el promedio pesado de las signals que le aplican (`llamadas`, `http`, `datos`, `entradas` pesan 2; `contrato` y `pantallas`, 1). Un archivo sin ninguna signal es de fidelidad incierta: no tiene puntaje ni entra al promedio, con motivo `sin_nada` (el índice no vio símbolos) o `sin_relaciones` (vio código pero ninguna relación). `inciertos: true` los lista.
- **`funcionalidad`:** por id, sufijo (`billing` → `feat-billing`) o nombre. Endpoints que expone con el método que atiende cada uno, lo que consume (y de qué funcionalidad), tablas con su evidencia, relaciones y el dominio compartido con otras.
- **`recorrido`:** desde un endpoint (id, `MÉTODO /ruta` o `/ruta`; hasta 3 si coinciden varios) o un símbolo (`Clase.metodo`, `funcion`, `ruta#Simbolo`). Pasos `{n, simbolo, ev, toca?, aviso?}` en orden de llamada; `toca` es `verbo destino`, con `(tabla sin página en el brain)` si la tabla existe en el código pero no tiene página.
- **`quien_llama`:** BFS inverso sobre `invoca` (profundidad 1–6, por defecto 3); una clase incluye sus métodos. Devuelve las llamadas con la línea de cada una, los endpoints alcanzados (por el método que los atiende), las funcionalidades dueñas del código alcanzado y las que consumen esos endpoints.
- **`riesgo`:** alcance de un cambio concreto. Entrada: `diff` (diff unificado) y/o `archivos` (`ruta` o `repo:ruta`), con `repo` opcional para las rutas. De cada archivo toma los métodos y funciones cuyas líneas toca el diff (el archivo entero si no hay rangos), sube por sus llamadores (`profundidad` 1–6, por defecto 4) y devuelve `cambia`, `llamadores`, `endpoints`, `pantallas` (las que dibujan un componente alcanzado o llaman a un endpoint alcanzado), `funcionalidades`, `tablas` (las que tocan directamente los símbolos cambiados), `otrosRepos` (repos que consumen esos endpoints por HTTP), y `decisiones` y `equipos` si los hay. `nivel` mide alcance, no probabilidad de error: `alto` si lo consume otro repo, alcanza 3 o más funcionalidades o cambia código que escribe en una tabla; `medio` si alcanza algún endpoint o pantalla, o 2 funcionalidades; si no, `bajo`. `motivos` lo explica. `avisos`: archivos fuera del índice, cambios fuera de funciones (tipos, constantes), llamadas sin resolver.
- **`deriva`:** diferencias entre lo que se llama y lo que se atiende, de un servicio (`nodo`) o de todos. `llamadasSinEndpoint`: llamadas cuya ruta ningún endpoint conocido atiende, con `existeConOtroMetodo` si la ruta existe con otro verbo HTTP. `llamadasAmbiguas`: coinciden con varios endpoints. `endpointsSinLlamadasDetectadas`: endpoints de servicios con algún consumidor indexado a los que nadie llama. `consumidoresIndexados` dice qué servicios llaman a cada uno; sin consumidores indexados no se listan endpoints sin uso. Las llamadas con URL armada en tiempo de ejecución no se analizan y se cuentan en `avisos`.
  Con varios cerebros cruza por los cruces del registro: `atendidasEnOtrosCerebros` (llamadas que atiende un endpoint de otro cerebro; no son deriva), `disputadasEntreCerebros` (coinciden con endpoints de más de un cerebro), `comunicadoCon`, y los consumidores de otros cerebros como `cerebro/servicio`. `llamadasSinEndpoint` queda con las que no atiende ningún cerebro comunicado.
- **`paridad`:** compara dos servicios, `viejo` y `nuevo`. Para endpoints y para pantallas: `total` (cuántos de cada lado y cuántos migrados), `faltan` (están en el viejo y no en el nuevo), `soloEnNuevo` y `difierenEnTablas` (pares emparejados cuyas tablas leídas o escritas no coinciden). `tablasSinMigrar`: tablas que toca el viejo y el nuevo no. Empareja por método y ruta, sin importar el nombre de los parámetros ni mayúsculas, y descuenta un prefijo fijo de un lado si así coinciden más. No necesita índice de código, pero las tablas por endpoint salen de las relaciones finas.
  Con varios cerebros, cada lado puede estar en el suyo: `cerebro/svc-x`, o `cerebro` si tiene un único servicio con endpoints o pantallas. La respuesta suma `cerebros: {viejo, nuevo}`. Entre cerebros las tablas se comparan por nombre sin separadores ni mayúsculas (cada cerebro le pone su id a la página); no depende de la comunicación.
- **`infra`:** infraestructura de un nodo (`nodo`, opcional) filtrada por `texto` (opcional): `items` con `de`, `clase`, `nombre`, `detalle` y `ev`. Para un servicio suma lo del repo donde vive; para un repo, lo de sus servicios; sin nodo, todo el brain. Con `texto`, `detalle` trae solo las líneas que coinciden. No necesita índice de código. Para una tabla, `impacto` trae además `columnas`.
- **`impacto`:** recorrido inverso del modelo de dependencias (ver el visor) desde una tabla, endpoint, servicio, externo o funcionalidad, con el porqué de cada afectado; para una tabla, además, `tocadaPor` (métodos que la leen o escriben). Si la pieza tiene decisiones (`decidido_por`) las trae en `decisiones`; `equipos` lista los equipos dueños (`pertenece_a`) de la pieza y de lo afectado. Con un símbolo de código responde como `quien_llama`. Con varios cerebros comunicados suma `enOtrosCerebros`: por cada cerebro que llama a un endpoint alcanzado, sus `funcionalidades` (con cuántas pantallas llegan), sus `pantallas` (con los endpoints y la evidencia) y `servicios` (llamadas que no salen de una pantalla; un solo salto: lo que siga se consulta en ese cerebro).

## 11. Varios cerebros

Un registro (`flowbrain.yaml` en una carpeta) agrupa hasta 8 cerebros. Cada cerebro es un brain como el descrito arriba, en su propia carpeta (por defecto, una subcarpeta con su nombre). Nada de lo que sigue se guarda en los grafos: se calcula al consultar.

- **`cerebros`:** `nombre` (minúsculas, números y guiones), `repos` (cada uno con `ruta`, relativa al registro o absoluta, e `id` opcional), `carpeta` y `descripcion` opcionales, y `curado` (por defecto `true`; con `false` las respuestas de ese cerebro llevan `sinRevisar: true`).
- **`comunicacion`:** pares `entre: [a, b]` con `activa`. Sin un par activo, dos cerebros no se ven.
- **`conexiones`:** `desde` y `hacia` como `cerebro/svc-id`, y `por` opcional (texto que debe estar en la base de la URL de la llamada: una variable o un host).
- **Respuestas con varios cerebros:** cada una lleva `cerebro`. Con vecinos comunicados puede sumar `otrosCerebros` (`cerebro`, `coincidencias`, `nodos`: algo que se llama exactamente igual que lo consultado) y `llamadoDesdeOtrosCerebros` (`total` y hasta 10 `llamadas` con `endpoint`, `cerebro`, `desde`, `ev` y, si las hay, hasta 3 `pantallas` que llegan a esa llamada: llamadas HTTP de otro cerebro a un endpoint nombrado en la respuesta).
- **Por consola:** con varios cerebros, `flowbrain search|traverse|contract|trace|feature|flow|screen|callers|impact|risk|drift|infra` agregan a su respuesta `cerebro` y las mismas anotaciones entre cerebros que el MCP; `parity` acepta `cerebro/svc-x` de cada lado.
- **`internas`:** llamadas que un servicio le hace a su propio servidor (traducciones, configuración, un archivo estático): `{ de: cerebro/svc-id, por? }`. Sin `por`, todas las de URL relativa (base vacía); con `por`, las que lo llevan en la base de la URL o al principio de la ruta. No se cruzan con ningún cerebro, no figuran en `deriva` como llamadas sin endpoint (se cuentan en `internasDelServicio`) y en la fidelidad del visor cuentan como unidas. Admiten `origen`, `evidencia` y `nota`, como las conexiones.
- **Archivos estáticos:** una llamada cuyo último segmento es un archivo de sitio (`.json`, `.js`, `.css`, `.svg`, `.png`…) solo se une a un endpoint que lo nombre literal: un parámetro de ruta (`/api/{token}`) no lo atiende. Vale dentro de un brain y entre cerebros.
- **Por paquetes:** un componente que un cerebro toma de un paquete que publica otro cerebro (por `paquete` y nombre) se une al nodo `componente` de ese cerebro, con las pantallas que lo dibujan; una dependencia declarada en un manifiesto hacia ese paquete une al servicio (o repo) con el dueño del paquete. No depende de `comunicacion`: un import nombra el paquete sin ambigüedad. Si dos cerebros publican el mismo nombre, no se une. En el visor son aristas `usa` y `depende_de` entre cerebros (y `usa` desde las funcionalidades de esas pantallas, para el impacto); en el MCP, `usadoEnOtrosCerebros` (pantallas y funcionalidades de otro cerebro que dibujan componentes de la respuesta, también en `impacto`), `usaDeOtrosCerebros` (componentes de otro cerebro que dibujan las pantallas de la respuesta) y `dependenDesdeOtrosCerebros`; en `conexiones`, `porPaquetes`.
- **Cruce:** una llamada HTTP pendiente de un cerebro (no se pudo unir a un endpoint propio) se une al endpoint de un cerebro comunicado con el mismo método y la misma ruta, o cuya ruta termina igual. Si coincide con varios, no se une y se cuenta como ambigua. Si el servicio que llama tiene conexiones declaradas hacia ese cerebro, solo se intenta contra los servicios declarados y, con `por`, solo con las llamadas que van por esa base. Cada cruce dice desde qué pantallas se llega a la llamada (el árbol de componentes y hooks de la pantalla, según `_build/files`); si no es de ninguna, queda a nombre del servicio.
- **Visor:** `flowbrain.html` en la carpeta del registro une los datos de todos los cerebros compilados; cada id va como `cerebro/id` y cada nodo lleva `c` (índice de su cerebro). Las relaciones entre cerebros son los cruces, agregados por (servicio que llama, endpoint que atiende).
- **Conexión declarada:** además de `desde`, `hacia` y `por`, admite `origen` (`persona`, por defecto, o `modelo`), `evidencia` (lista de `repo/ruta#Ln` o frases) y `nota`. El resumen de conexiones devuelve el `origen`.
- **Llamada disputada:** una llamada se cruza contra todos los cerebros comunicados con el suyo a la vez. Si coincide con un endpoint en más de uno y ninguna conexión declarada dice a cuál va, no se une a ninguno. Con una conexión que aplica (sin `por`, o con un `por` contenido en la base), solo se busca en los servicios declarados.
- **`flowbrain evidence`:** informe para decidir destinos, sin decidir nada. Por servicio que llama y base de URL: `llamadas`, `ejemplos`, `coincide` (servicios de otros cerebros con los que coincide por método y ruta, y cuántas `soloAhi`), `sinDestino`, `definiciones` (dónde se define cada identificador de la base) y `declaradas`; y `disputadas` por base. Lee los repos al correr; nunca abre archivos de entorno reales, solo los de ejemplo, y oculta el texto de las líneas que parecen llevar un secreto.
- **`conexiones`** (herramienta): por par de servicios, `llamadas`, `endpoints`, `pantallas` (cuántas pantallas distintas originan esas llamadas), `declarada`, `por` y `ejemplos`; `avisos` con las declaradas sin respaldo, las detectadas sin declarar y las ambiguas.

## 12. Lo que completa el índice de un brain

Además de las páginas y de lo que extraen los parsers, un brain puede tener, en su raíz:

- **`profile.md`:** cómo está hecho cada repo (framework, rutas, pantallas, llamadas; capas, endpoints, acceso a datos), con archivo y línea de ejemplo. Lo escribe quien estudia el repo; es lo que justifica cada extractor.
- **`extractors/<repo-id>/`:** programas que completan lo que los parsers no entienden. Reciben la ruta del repo, imprimen un JSON (`simbolos`, `invocaciones`, `endpoints` con un `handler` opcional que dice qué método los atiende, `llamadas` con un `host` opcional, `pantallas`, `navegaciones` con `desde` como símbolo o como ruta de la pantalla, `accesos` con `columnas`, `esquema` con las columnas vigentes de una tabla, `eventos` publicados o consumidos por su clave, `importa` entre archivos, y `componentes` y `usos` de una librería de interfaz, con `paquete` y `simbolo`; el nombre tiene que estar escrito en la línea citada) y corren en cada indexación, en orden alfabético, sin red y sin escribir en el disco. Cada dato cita archivo y línea reales; lo que no se comprueba se descarta. Un extractor también corrige lo que leyó un parser: su llamada reemplaza a las del parser en la misma línea, su pantalla con una ruta existente reemplaza el componente y las envolturas, su `esquema` reemplaza el que un parser leyó para esa tabla (la tabla o alguna columna tiene que aparecer en el archivo citado), y `quitar` (`tipo`: `llamada`, `pantalla`, `navegacion`, `endpoint`, `acceso` o `evento`, con `archivo` y `linea`, `ruta`, `metodo`, `tabla` o `nombre`) borra lo inventado; lo que sumó otro extractor no se toca. El informe de cada corrida queda en `_build/extractors/<repo>.json`.
- **`calls.yaml`:** casos sueltos resueltos a mano: `llamadas` entre métodos y `http` salientes. Una `http` reemplaza a las llamadas que haya en su línea; dos en la misma línea conviven.
- **`checks.yaml`:** `controles` (`endpoint`, `pantalla`, `llamada`, `traza` de endpoint a tabla, `alcanza` de pantalla a llamada): hechos verificados que tienen que seguir saliendo.

**Colas.** Un evento une a quien publica y a quien consume por la cola (`publica_en`, `consume_de`); si cambia quien publica, el impacto llega a quien consume (y no a los demás que publican). Una cola sin página va como pendiente (`cola sin nodo`) y el borrador la propone. Una tabla del esquema sin página también se propone.

**Paquetes.** Además de `package.json` y `composer.json`, cualquier manifiesto conocido (`go.mod`, `pyproject.toml`, `requirements.txt`, `pom.xml`, `build.gradle`, `Gemfile`, `*.csproj`, `pubspec.yaml`, `Package.swift`, `Cargo.toml`, `mix.exs`) marca un paquete candidato; queda solo si el índice le encuentra algo. Un subdirectorio con su propio `.git` es otro repo y no se lee.

`flowbrain coverage` mide cuánto quedó conectado (pantallas con llamadas, llamadas con ruta, endpoints con método y que llegan a una tabla, accesos con columnas), cómo anduvo cada extractor y qué controles fallan. Un acceso a una tabla puede llevar `columnas`: las que ese acceso lee o escribe.


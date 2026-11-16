# Decisiones

Decisiones que el PRD deja abiertas. Formato: fecha · decisión · motivo.

## 2026-11-15 · Paso 0–1

1. **Fixtures sintéticos, inspirados en un workspace multi-repo real.** Se relevó un workspace real en modo solo lectura para sacar patrones. No se copió código, nombres ni URLs. Motivo: los tests golden necesitan entradas estables y el producto tiene que ser agnóstico.
   - Patrones que adopta el esquema: varios `svc` en un repo (monorepo `apps/`, o el mismo código desplegado con distintos roles), una base compartida por varios servicios, webhooks entrantes desde un `ext`, URL base tomada de variables de entorno (`inferido`), frontends que llaman directo a un `ext`, llamadas de un servicio a sí mismo, y migraciones en curso donde un endpoint lo atienden dos servicios (aristas con `deprecado` más una `decision`).
   - Patrones que se anotan para pasos futuros:
     - Rutas generadas por plantillas o código (por ejemplo `/api/{1}`), que limitan al php-parser.
     - Colecciones Bruno o Postman como fuente de contrato, similar a OpenAPI.
     - Envoltorio de respuesta común (`{ ok, data, errorCode }`).
     - Permisos por módulo.
     - Workspaces "orquestadores" donde los repos viven en `repositories/` sin ser submódulos.

2. **El fixture tiene 8 páginas, no 6.** Las 6 del flujo, más `repo-tienda` y `db-tienda`. Motivo: `vive_en` y la evidencia (`<repo-id>:…`) exigen que esos nodos existan; sin ellos la compilación falla por destino desconocido.

3. **IDs generados con la forma `<padre>:<sufijo>`:** `svc-bff:contrato`, `svc-bff:POST:/checkout` y `repo-tienda:<ruta>`. Motivo: son determinísticos, legibles y no chocan con los slugs de página. El ID de archivo coincide con el formato de evidencia sin la línea.

4. **`llama_a` apunta al svc y el endpoint va en un campo aparte.** Motivo: las consultas a nivel servicio ("¿quién depende de payments?") quedan simples y `trazar` sigue teniendo los tipos del endpoint. El endpoint tiene que existir en el contrato del destino.

5. **`dato` en la arista** para llamadas sin contrato (hacia un `ext`) y para lecturas y escrituras de tablas. Motivo: `trazar` necesita informar qué tipo viaja en cada salto.

6. **`depende_de` funciona como superverbo en las consultas.** Incluye `llama_a`, `publica_en`, `consume_de`, `lee_de` y `escribe_en`. Motivo: el criterio de aceptación `recorrer_grafo svc-payments --verbos depende_de --direccion in` tiene que responder "qué se rompe si cambio payments" sin duplicar aristas.

7. **La confianza se deriva del origen:** curado 1.0, parser 0.9, inferido 0.5. No se escribe a mano. Motivo: es determinística y no admite valores arbitrarios.

8. **Tokenizador: `ceil(length / 4)` sobre JSON canónico compacto.** Motivo: es determinístico y no agrega dependencias. *Provisoria*: si se aprueba tiktoken `cl100k`, hay que regenerar los golden de presupuesto.

9. **Serialización canónica:** claves alfabéticas, comparación por code units UTF-16, todos los campos presentes (con `null` si faltan), 2 espacios de indentación y `\n` final. Motivo: requisito de byte a byte idéntico entre compilaciones y entre CLI, MCP y hook.

10. **Los JSON de los parsers viven en `_build/contratos` y `_build/archivos`,** como dice el PRD. Son entrada de `compile`, que no los reescribe. Las aristas que detecta el parser llegan a las páginas por los borradores del indexador, como en el ejemplo del PRD.

11. **Los símbolos no pasan a `graph.json`;** quedan en `archivos/<repo>.json`. Los nodos `archivo` sí entran. Revisar el tamaño cuando se indexen repos grandes, porque el PRD prevé pasar a SQLite por encima de 10k nodos.

12. **`trazar`, nivel 1 cuando `desde` es un endpoint:** son las llamadas entrantes a ese endpoint, y desde ahí se hace BFS aguas abajo. Motivo: así salen los 5 saltos del criterio de aceptación con el fixture.

13. **`docs/PRD.en.md` no se creó.** El PRD solo existe en español. Se traduce cuando haga falta.

## 2026-11-16 · Paso 2 (compilador)

14. **Frontmatter con `yaml` (YAML 1.2 core) en lugar de `gray-matter`.** Motivo: `gray-matter` usa js-yaml, que convierte `2026-11-15` en `Date` y no expone posiciones; `yaml` deja las fechas como strings y da la línea de cada nodo para los errores `archivo:línea`.
15. **El compilador junta todos los errores antes de fallar** y los ordena por archivo y línea. Las referencias a una página que no validó no generan errores en cascada.
16. **`INDEX.md` lista nodos de página y endpoints, agrupados por tipo;** omite `archivo` y `contrato`. Motivo: en repos reales los archivos son miles y el índice dejaría de ser barato de leer. (Desvío del PRD: "una línea por nodo".)
17. **`mapa.mmd` solo dibuja nodos de página** y las aristas entre ellos; las aristas no vigentes van punteadas.
18. **`backlinks.json`:** `{ "<id>": [{ desde, endpoint, verbo }] }` para todo nodo con entrantes. En la página, la sección lista `[[desde]] · verbo · endpoint`; si no hay, `_Sin backlinks._`.
19. **`viewer.html` se pospone al paso 8** (visor), donde el PRD lo construye.
20. **Golden files:** `graph.json` es el oráculo a mano y los tests nunca lo reescriben. El resto (`backlinks.json`, `INDEX.md`, `mapa.mmd`, `paginas/`) se regenera con `UPDATE_GOLDEN=1 pnpm test` y se revisa en el diff.

## 2026-11-16 · Paso 3 (motor + CLI)

21. **`budget_tokens` por defecto: 2000.** `null` (CLI: `--budget none`) desactiva el límite. Motivo: frugal por defecto; el hook usará 1500.
22. **Recorte, pasos extra:** si después de prosa → endpoints → aristas sigue sin entrar, se quitan nodos desde el final y, en `trazar`, saltos desde el final. `omitidos` cuenta `prosa`, `endpoints`, `aristas`, `nodos` y `saltos`; `truncado` es `true` si alguno es > 0. Las aristas se quitan con búsqueda binaria sobre un orden fijo (determinístico y O(log n) serializaciones).
23. **La proyección `relaciones` oculta `contiene` y `expone`;** `recorrer_grafo` sin `verbos` usa todos menos esos dos. Motivo: un repo `contiene` miles de archivos; los endpoints se ven con `contrato`.
24. **`contrato_de` usa `resumen` por defecto y siempre incluye los endpoints** (con tipos expandidos y `llamado_por`) y los eventos, aunque la proyección no los pida. Motivo: son el objeto de la consulta; las aristas del svc son ruido para "¿qué devuelve X?".
25. **`recorrer_grafo` devuelve la raíz como nivel 0** y cada nodo alcanzado con `nivel` y `via` (la arista que lo alcanzó; si hay varias en el mismo nivel, la de mayor confianza y luego orden canónico).
26. **`trazar` desde un endpoint sobre-aproxima:** después de las llamadas entrantes se expande el svc dueño completo, no solo el handler de ese endpoint (no hay grafo de llamadas intra-servicio en v0.1).
27. **`trazar` desde un archivo** (`repo-x:ruta` o ruta relativa): el nivel 1 son las aristas cuya evidencia está en ese archivo. Último recurso de resolución: nombre o alias exacto.
28. **`buscar_nodo`:** devuelve `coincidencia` (`exacta`/`prefijo`/`difusa`) y `total`; `limite` por defecto 10.
29. **Errores de consulta:** `ConsultaError` con `codigo` (`nodo_inexistente`, `parametro_invalido`). La CLI los imprime como `{ "error": { codigo, mensaje } }` y sale con 2; errores de compilación salen por stderr con código 1.
30. **La CLI corre con `tsx` (`pnpm brain …`).** Empaquetado para `npx brain` queda para cuando se resuelva la instalación (criterio "< 5 minutos").
31. **Golden de consultas** en `fixtures/checkout/expected/consultas/`; el catálogo de casos lo comparten los tests del motor y de la CLI (y lo usarán MCP y hook en el paso 4).

### Para revisar
- Con presupuestos chicos, quitar nodos "desde el final" deja los de confianza 1 (`implementa`, `vive_en`) y descarta los de datos (`llama_a`, `escribe_en`), que suelen ser los más útiles. Alternativa: ordenar priorizando verbos de datos. No se cambió porque el PRD fija "confianza desc, id asc".

## 2026-11-16 · Paso 4 (MCP + hook)

32. **El hook lee stdin, no `$PROMPT`.** Claude Code entrega al hook `UserPromptSubmit` un JSON por stdin (`prompt`, `cwd`), no una variable de entorno. Por eso hay dos comandos sobre la misma función del core: `brain hook claude-code` (lee stdin y devuelve `hookSpecificOutput.additionalContext`) y `brain context --prompt … --repo …` (texto plano, para OpenCode o pruebas a mano).
33. **Detección determinística de qué consultar en el prompt** (`contextoParaPrompt`, en el core): rutas HTTP, URLs y archivos → `trazar` si resuelven (máx. 3); menciones exactas de id, nombre o alias (n-gramas de hasta 4 palabras, sin acentos, ≥ 3 caracteres) → `recorrer_grafo` en ambas direcciones (máx. 5). Sin coincidencia difusa, para no inyectar ruido. El JSON de cada sección es compacto y es exactamente la salida del motor.
34. **Repo actual = nombre del directorio raíz de git** comparado contra id (sin `repo-`), nombre y aliases de los nodos `repo`. Alternativa futura: un campo `remoto` en la página del repo comparado con `git remote get-url origin`.
35. **El hook nunca bloquea:** ante cualquier error sale 0 sin stdout y deja el motivo en stderr.
36. **El servidor MCP recarga el contexto cuando cambia el mtime de `_build/graph.json`.** Errores de consulta: `isError: true` con el mismo JSON de error que la CLI.
37. **El hook `SessionEnd` queda pendiente (paso 7).** En `SessionEnd` la sesión ya terminó y el hook no puede preguntarle nada al agente. Opciones: (a) un hook `Stop` que le pida al agente anotar contradicciones en `_drafts/` antes de cerrar; (b) un comando `/brain-feedback` que el usuario invoca; (c) analizar el transcript al cerrar sin LLM (solo detectar archivos de evidencia que el agente editó). Hay que decidirlo junto con los borradores del indexador.
38. **El test de identidad entre puertas vive en `packages/cli/test/puertas.test.ts`** (la CLI depende de `mcp` y `hooks`; así se evita una dependencia circular).

## 2026-11-16 · Paso 5 (ts-parser + openapi-parser)

39. **Los parsers no conocen ids de nodos.** Devuelven una extracción cruda (endpoints, llamadas con URL analizada, accesos a tablas, modelos, formas de tipos, archivos). `brain index` la resuelve contra las páginas del brain y escribe `_build/contratos/<svc>.json`, `_build/archivos/<repo>.json` y `_build/extraccion/<repo>.json` (aristas resueltas + pendientes, para el indexador del paso 7). `compile` no lee `extraccion/`.
40. **Paquete → svc:** cada carpeta con `package.json`/`composer.json` es un paquete (en un workspace se excluye la raíz). Se asocia a los svc con `vive_en: [repo]` cuyos `puntos_de_entrada` caen dentro del paquete; si el repo tiene un solo paquete, a todos sus svc. Sin página → svc propuesto `svc-<carpeta>` marcado `nuevo` (no se escribe su contrato porque `compile` fallaría).
41. **Resolución de llamadas:** host literal → se compara cada etiqueta del host (`api.pasarela.example` → `pasarela`) con id sin prefijo, nombre y aliases de svc/ext; coincidencia única → `origen: parser` (+ endpoint si la ruta coincide con su contrato). Base dinámica (env/variables) o relativa → se busca la ruta entre todos los contratos conocidos; coincidencia única → `origen: inferido`; si no, queda en `pendientes` con candidatos. Nunca se escribe `destino: null` en una arista.
42. **Evidencia de un endpoint = declaración del handler** cuando es una función con nombre; si es inline, la línea del registro de la ruta.
43. **Símbolos de archivos = funciones y clases de primer nivel** (más modelos de Prisma). Interfaces y tipos no cuentan. Por eso se corrigieron 3 líneas de símbolos en `fixtures/checkout/_build/archivos/repo-tienda.json` (marcaban la línea de la llamada, no la de la declaración); `graph.json` no cambia porque no incluye símbolos.
44. **Resolución de módulos acotada al repo:** imports relativos y alias de `paths` de los `tsconfig*.json` de cada paquete; nunca `node_modules`. `noLib: true`. Así el resultado no depende de lo instalado. Consecuencia: tipos de librerías (Express `Request<…>`) se leen sintácticamente desde los genéricos.
45. **OpenAPI prevalece por endpoint:** si la spec declara `(método, ruta)`, gana la spec (tipos incluidos); los endpoints que solo existen en el código se conservan. El contrato queda con `fuente: openapi-parser`.
46. **Strings literales en tipos se normalizan a comillas simples** (`'aprobado' | 'rechazado'`) y espacios colapsados.
47. **Cobertura v0.1 del ts-parser:** Express (instancias `express()`/`Router()`), Fastify (genéricos `Body`/`Reply`), NestJS (`@Controller` + `@Get…`, `@Body`, `Promise<T>`), Next app router (`app/**/route.ts`). Salientes: `fetch`, `axios.m()`, `axios(config)`, instancias `axios.create({ baseURL })` (también importadas por alias o `export default`), URLs en objetos `const`. Prisma (incl. `@@map`) y TypeORM `@Entity` (solo modelos). **Fuera por ahora:** Next `pages/api`, prefijos de `app.use("/x", router)`, eventos/colas, accesos de TypeORM/Sequelize, clientes `got`/`ky`.
48. **Prueba de humo sobre repos reales (solo lectura):** un frontend Vite de ~2.150 archivos se indexa en ~3 s y detecta 144 llamadas (96 con ruta); un backend NestJS detecta 90 endpoints. Sin el contrato del backend PHP (paso 6), las llamadas del frontend quedan como pendientes.

## 2026-11-16 · Paso 6 (php-parser)

49. **tree-sitter en WASM** (`web-tree-sitter` + `tree-sitter-php`), no bindings nativos: `npx brain` no debe compilar nada ni depender del toolchain del usuario. Se inicializa una vez por proceso; `Parser.extract` puede ser async y `indexar` espera a todos los parsers.
50. **Cobertura v0.1 del php-parser:** rutas de Laravel en `routes/*.php` (`api.php` suma `/api`; `Route::prefix()->group()`, `Route::group(['prefix'=>…])`; handlers `[Ctrl::class,'m']` y `'Ctrl@m'`) y de Symfony (atributos `#[Route]` y anotaciones `@Route` en docblocks, con prefijo de clase; OPTIONS/HEAD se descartan si hay otro método; GET por defecto). Request = parámetro FormRequest o `*Request` (no `Request` a secas); response = tipo de retorno salvo genéricos (`JsonResponse`, `Response`, `array`…). Formas: `rules()` de FormRequest (`numeric/integer` → number, `nullable` → `| null`, sin `required` → `| undefined`) y claves de `toArray()` de JsonResource (`unknown`).
51. **Salientes PHP:** facade `Http::` (directo o encadenado), `->get/post/…` con URL absoluta literal, `->request('MÉTODO', url)` (Guzzle/HttpClient) y `curl_init(url)`. URLs: strings, interpolación, concatenación con `.`; `env()`/`getenv()`/`config()` → base dinámica. **Datos:** modelos Eloquent (`$table` o snake_case + "s") con accesos estáticos (`where/find/all…` → `lee_de`; `create/update/upsert…` → `escribe_en`); entidades Doctrine (`Entity` + `Table(name)`, atributo o anotación) con `getRepository(X::class)` → `lee_de` y `persist/remove` → `escribe_en` cuando la clase se infiere de `new X()` en la misma función. **Fuera por ahora:** `Route::resource/apiResource`, controladores invocables, rutas YAML/XML de Symfony, relaciones Eloquent, query builder `DB::table()`, request de Symfony desde `$request->getContent()`.
52. **Evidencia PHP = línea del nombre** de la clase o del método (los atributos quedan dentro del nodo de declaración, así que su línea de inicio apuntaría al atributo).
53. **Resolución de llamadas con base dinámica, más estricta y más útil:** (a) la ruta de la llamada necesita al menos un segmento literal y la coincidencia debe compartir al menos uno (un `{param}` no alcanza: evita rutas comodín como `GET /{token}`); (b) si no hay coincidencia exacta, se prueba por sufijo con prefijo literal (`${env.apiBaseUrl}/user/me` → `/api/user/me`); (c) entre varias se queda con las más específicas; (d) el prefijo que aporta cada base (`${env.apiBaseUrl}` → `/api`) se aprende de las llamadas sin ambigüedad y desempata las demás si es único. Todo sigue siendo `origen: inferido`.
54. **Errores de `brain index` por repo no identificado** son `ConsultaError` (JSON en stdout, código 2), como las consultas; antes salía un stack trace.
55. **Prueba de humo sobre repos reales (solo lectura):** un backend Symfony de ~1.170 archivos PHP se extrae en ~2,3 s: 1.028 endpoints, 16 salientes, 192 entidades, 2.871 accesos a tablas (72 escrituras). Indexado contra ese contrato, el frontend Vite del paso 5 pasa de 1 a 62 aristas `inferido` (de 72 llamadas con ruta, quedan 6 pendientes); las 48 sin ruta reconocible siguen pendientes. Las tablas quedan pendientes hasta que existan sus páginas (paso 7: borradores).

## 2026-11-16 · Paso 7 (borradores, verificador y notas)

56. **`brain draft` es determinístico y no llama a ningún LLM.** El "prompt fijo" del PRD se materializa como `_drafts/<repo>/PROMPT.md`: el borrador sale del código y un agente puede refinarlo después (resúmenes, preguntas abiertas) bajo reglas explícitas (solo dentro de `_drafts/`, nada sin evidencia, no tocar relaciones `origen: parser`). Así el borrador es reproducible y testeable, y el LLM es opcional.
57. **Qué propone `brain draft`:** página del repo si no existe; una por svc (si existe, se copia con las relaciones nuevas agregadas al frontmatter y comentarios preservados); `tabla-<nombre físico>` por cada modelo sin tabla en el brain (aliases: tabla y modelo); `ext-<etiqueta>` por cada host público sin nodo (`api.pasarela.example` → `ext-pasarela`). Hosts sin punto (nombres de servicio de Docker), IPs y `localhost` no se proponen: quedan como pregunta. Todo lo demás pendiente va a `## Preguntas abiertas` agrupado por (motivo, referencia) con hasta 3 evidencias.
58. **`brain draft` no escribe `_build/`.** Flujo: `draft` → revisar → mover a `tecnologia/` → `brain index` → `brain compile`. Acepta repos sin página (id `repo-<carpeta>`); `brain index` sigue exigiendo que exista.
59. **Las dudosas viven en `_build/verificacion.json`, no en las páginas.** `verify` no edita lo que escribe un humano; `compile` aplica el estado. La clave incluye la evidencia: si alguien la corrige en la página, la arista vuelve a `vigente`. `deprecado` (humano) manda sobre `dudoso`.
60. **Qué verifica `brain verify`:** archivo existente, línea dentro del archivo (y fin de rango) y, si `_build/archivos/<repo>.json` registra un símbolo en esa línea, que la línea todavía lo contenga. Repos sin clon local no se verifican y conservan sus dudosas previas (un clon ausente no es evidencia). Sale con 1 solo si hay dudosas **nuevas** respecto de la corrida anterior; "nodos sin verificar en N días" (por defecto 90, `--hoy` para tests) se informa pero no falla.
61. **Notas por marcas en el transcript (elegido por el usuario).** El hook `SessionEnd` de Claude Code corre con la sesión cerrada y no puede hablarle al agente. El contexto inyectado y el bloque de reglas le piden escribir `brain-nota <id>: <qué cambió>`; el hook lee el transcript (solo mensajes del asistente) y agrega las notas a `_drafts/notas/<id>.md` sin duplicar. `brain nota` hace lo mismo a mano. Un mismo comando `brain hook claude-code` atiende ambos eventos según `hook_event_name`.
62. **Prueba de humo (solo lectura):** desde un brain vacío, `draft` del backend Symfony propone 177 páginas (172 tablas, 3 externos) con 203 relaciones en ~3,5 s; movidas, `index` + `compile` dan 2.376 nodos. Sumando el frontend, 4.534 nodos y 62 llamadas cruzadas `inferido`. `verify` revisa 1.293 aristas en ~1,2 s sin dudosas.

## 2026-11-16 · Paso 8 (visor y generadores de reglas)

63. **El visor embebe Cytoscape** (`cytoscape@3.34.4`, versión fija, MIT) en vez de cargarlo de un CDN: "sin servidor" incluye abrirlo sin red. Pesa ~450 KB más el grafo (~2,3 MB con 4.500 nodos). Lo escribe `compileDir`, no `compile`: la función pura no lee archivos y sus goldens no cambian.
64. **Al abrir, el visor muestra solo nodos de página** (endpoints, contratos y archivos se prenden con el filtro). Con más de 400 nodos visibles usa el diseño concéntrico; si no, fuerzas. Las aristas paralelas (mismo origen, destino, verbo y estado) se dibujan como una sola con `×n`, y su detalle lista cada una con su evidencia. Medido sobre 4.534 nodos: carga en ~1,1 s y enfocar un nodo tarda ~30 ms.
65. **Los nombres van como datos, nunca como HTML:** el grafo viaja en un `<script type="application/json">` con `</` y `<!--` escapados, y el panel escapa todo lo que muestra.
66. **`brain gen claude|agents|cursor|windsurf`:** un mismo bloque, con el nodo del repo, sus servicios, de qué dependen y quién los usa (máximo 8 por lista), cómo consultar por MCP o CLI y la marca `brain-nota`. En `CLAUDE.md`/`AGENTS.md` va entre marcadores; los de Cursor (`.mdc`, `alwaysApply: true`) y Windsurf (`trigger: always_on`) son archivos propios. Imprime por defecto y escribe solo con `--escribir`. Si el repo no está en el brain, genera el bloque genérico.
67. **Queda fuera del orden de construcción:** el empaquetado (`npx brain init`, criterio de aceptación de instalación en menos de 5 minutos) y el plugin de OpenCode. Hoy se instala desde el repo con `pnpm` (ver `docs/INSTALACION.md`).

## 2026-11-16 · Empaquetado (`npx brain-graph init`)

68. **Nombre del paquete: `brain-graph`** (elegido por el usuario). `brain` ya existe en npm y `npx brain init` ejecutaría un paquete ajeno. El paquete instala los comandos `brain-graph` (para `npx brain-graph …`) y `brain`.
69. **Un único bundle ESM** (`esbuild 0.28.2`, `scripts/build.mjs`) con todo el código propio, de unos 170 KB. Las dependencias de terceros quedan externas con versión exacta: Cytoscape y la gramática WASM de PHP se leen por ruta y `typescript` es el compilador que usa el ts-parser. `packages/brain-graph/` es el único paquete publicable; los demás siguen `private`.
70. **`brain init [dir] [--claude-code]`:** crea `producto/`, `tecnologia/`, `SCHEMA.md` y `README.md` sin pisar nada, y compila. Con `--claude-code` registra el mismo comando en `UserPromptSubmit` y `SessionEnd`: reemplaza entradas previas de brain (las reconoce por ` hook claude-code`), conserva todo lo demás, no toca un `settings.json` inválido y deja un respaldo. El MCP no se registra solo: `init` imprime la línea de `claude mcp add`, que es "la línea en la configuración de Claude Code" del PRD.
71. **Los comandos que quedan en la configuración usan `npx -y brain-graph@<versión>`**, con versión fija. En desarrollo apuntan al repo con `pnpm -s -C`. `BRAIN_COMANDO` permite otro comando (por ejemplo, una instalación global).
72. **Medición del criterio de instalación:** con la caché de npm vacía, `npx` desde el tarball instala y corre `init --claude-code` en ~6,3 s. El binario instalado pasó draft (PHP con WASM y TS), index, compile (visor con Cytoscape), verify, hook y el handshake MCP por stdio. **Falta publicar en npm**: hasta entonces, los comandos `npx -y brain-graph@0.1.0` que escribe `init` no resuelven.

## 2026-11-16 · Ajustes con repos reales (proyecto-web y proyecto-nestjs-api)

73. **Los archivos de test no aportan endpoints, llamadas ni accesos a tablas** (`*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, `e2e/`, `cypress/`, `fixtures/`, `*Test.php`). Sus rutas son mocks y producían endpoints duplicados. Si un endpoint aparece más de una vez (mismo paquete, método y ruta), queda el de menor archivo y línea.
74. **Los archivos con espacios, `#` o `:` en el nombre se omiten al indexar:** no se pueden citar como evidencia (`repo:ruta#Ln`). En la práctica son copias sueltas (`X copy.jsx`).
75. **Funciones auxiliares de rutas:** si la URL pasa por una función del repo cuyo cuerpo es una expresión (o un único `return`), se evalúa ese cuerpo con los argumentos ligados (`withId(EP.x, id)` → `/x/{param}`). Si la función no tiene cuerpo visible (librería, como `generatePath`), con hasta dos argumentos y el segundo un objeto literal, la ruta es la plantilla del primer argumento. En proyecto-web bajó de 48 a 6 las llamadas sin ruta reconocible.
76. **Kysely:** `selectFrom` y los `*Join` → `lee_de`; `insertInto`, `replaceInto`, `updateTable`, `deleteFrom` y `mergeInto` → `escribe_en`, sobre la tabla del primer argumento literal (sin alias ni esquema). Solo se activa si algún `package.json` del repo declara `kysely`, para no confundir `leftJoin` de otras librerías. El nombre de la tabla es el físico, así que el draft propone `tabla-<nombre>`.
77. **El visor ajusta el zoom al terminar el layout.** Antes quedaba con el zoom inicial y, en grafos medianos, el grafo aparecía cortado o fuera de vista.
78. **Repos en el visor (elegido por el usuario):** el repo sigue siendo un nodo del grafo (lo citan las evidencias y lo usan `verify`, `gen` y las consultas), pero en el visor se dibuja según cuántos servicios viven en él. Con uno o ninguno no se dibuja y no tiene filtro: el panel del servicio muestra el repo, su cantidad de archivos y un botón para desplegarlos. Con dos o más es una caja que contiene a sus servicios, y sus aristas `vive_en` no se dibujan. Los archivos desplegados se ubican en una grilla debajo de los servicios sin recalcular el resto del grafo; con fuerzas y 2.000 archivos la página se trababa más de 30 s. Por la misma razón, con más de 400 nodos visibles el diseño de fuerzas cae a concéntrico.

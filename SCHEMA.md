# SCHEMA — Brain v0.1

Contrato del grafo. El compilador lo hace cumplir y el motor responde según él. Si algo no está acá, es inválido.

## 1. Identificadores

**IDs de página** (nodos escritos por humanos): slug `^[a-z]+-[a-z0-9]+(-[a-z0-9]+)*$`. El prefijo es el tipo: `svc-`, `repo-`, `lib-`, `db-`, `queue-`, `ext-`, `tabla-`, `feat-`, `team-`, `decision-`. El nombre del archivo es `<id>.md` y el `tipo` del frontmatter tiene que coincidir con el prefijo.

**IDs generados** (nodos que salen de los JSON de los parsers): `<id-padre>:<sufijo>`.

| Tipo | Forma | Ejemplo |
|---|---|---|
| `contrato` | `<svc-id>:contrato` | `svc-bff:contrato` |
| `endpoint` | `<svc-id>:<MÉTODO>:<ruta>` | `svc-bff:POST:/checkout` |
| `archivo` | `<repo-id>:<ruta/relativa>` | `repo-tienda:apps/bff/src/main.ts` |

Las rutas de endpoint se normalizan a `/segmento/{param}`: `:id`, `[id]` y `{id}` se escriben `{id}`, sin barra final, y el método va en mayúsculas.

Un ID duplicado hace fallar la compilación.

## 2. Tipos de nodo

| Tipo | Carpeta | Se escribe en | Campos propios (`atributos`) |
|---|---|---|---|
| `repo` | `tecnologia/` | página | — |
| `svc` | `tecnologia/` | página | `puntos_de_entrada` |
| `lib` | `tecnologia/` | página | — |
| `db` | `tecnologia/` | página | — |
| `queue` | `tecnologia/` | página | — |
| `ext` | `tecnologia/` | página | — |
| `tabla` | `tecnologia/` | página | — |
| `feat` | `producto/` | página | — |
| `team` | `producto/` | página | — |
| `decision` | `producto/` | página | — |
| `contrato` | — | `_build/contratos/<svc-id>.json` | `svc`, `fuente` |
| `endpoint` | — | `_build/contratos/<svc-id>.json` | `metodo`, `ruta`, `request`, `response`, `evidencia` |
| `archivo` | — | `_build/archivos/<repo-id>.json` | `repo`, `ruta`, `lenguaje` |

`svc` incluye todo proceso que se despliega: APIs, workers, crons y también frontends (SPA, app mobile). Un mismo repo puede tener varios `svc`, por ejemplo un monorepo o el mismo código desplegado con distintos roles.

## 3. Verbos

Toda arista va de `desde` a `hasta`.

| Verbo | desde | hasta | Dónde se escribe | Lleva datos |
|---|---|---|---|---|
| `llama_a` | svc, lib, ext | svc, ext | `relaciones` | sí |
| `publica_en` | svc | queue | `relaciones` | sí |
| `consume_de` | svc | queue | `relaciones` | sí |
| `lee_de` | svc | db, tabla | `relaciones` | sí |
| `escribe_en` | svc | db, tabla | `relaciones` | sí |
| `depende_de` | repo, svc, lib | repo, svc, lib, db, queue, ext | `relaciones` | no |
| `implementa` | svc, lib, repo | feat | `relaciones` | no |
| `decidido_por` | cualquiera salvo generados | decision | `relaciones` | no |
| `vive_en` | svc, lib → repo · tabla → db | | campo `vive_en` | no |
| `pertenece_a` | repo, svc, lib, db, queue, ext, feat | team | campo `pertenece_a` | no |
| `expone` | svc | contrato | solo el compilador | no |
| `contiene` | repo → archivo · svc → endpoint | | solo el compilador | no |

Reglas:
- `vive_en` y `pertenece_a` se escriben solo como campos de primer nivel, nunca dentro de `relaciones`.
- `expone` y `contiene` los genera el compilador a partir de los JSON. Si aparecen en una página, la compilación falla.
- Se permite `desde == hasta`: un servicio que se llama a sí mismo por HTTP.
- **`depende_de` en consultas es un superverbo:** `recorrer_grafo` con `verbos: [depende_de]` incluye también `llama_a`, `publica_en`, `consume_de`, `lee_de` y `escribe_en`. La arista explícita `depende_de` queda para dependencias que no son llamadas, como librerías o infraestructura.

## 4. Estados, orígenes y confianza

**Estados:** `vigente` (por defecto), `dudoso` (lo asigna `brain verify` cuando falta la evidencia) y `deprecado` (lo marca un humano).

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
- El compilador solo valida el formato. Que el archivo exista lo comprueba `brain verify`.

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

Los destinos sin resolver nunca llegan a una página compilada. Van como prosa en la sección `## Preguntas abiertas`.

**Cuerpo de la página:** prosa libre en Markdown, compatible con Obsidian (`[[id]]`). El compilador escribe la sección de backlinks entre `<!-- brain:backlinks:inicio -->` y `<!-- brain:backlinks:fin -->`, y no toca nada fuera de esos marcadores.

## 7. JSON generado por los parsers

**`_build/contratos/<svc-id>.json`**

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

`request` y `response` pueden ser `null`. `tipos` es un mapa de nombre a forma, con tipos expresados como strings estilo TS. Cuando hay `openapi-parser`, prevalece sobre cualquier tipo inferido.

**`_build/archivos/<repo-id>.json`**

```json
{
  "archivos": [
    { "lenguaje": "typescript", "ruta": "src/main.ts", "simbolos": [ { "linea": 3, "nombre": "main", "tipo": "funcion" } ] }
  ],
  "repo": "repo-x"
}
```

Los símbolos se quedan en este JSON y no pasan a `graph.json`.

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

Si con todo eso sigue sin entrar, se devuelve solo `resumen`. La salida incluye `truncado: boolean` y `omitidos: { prosa, endpoints, aristas }`.

## 10. Semántica de consultas

Todas las herramientas ordenan sus resultados por confianza descendente y después por id ascendente.

- **`buscar_nodo`:** la coincidencia exacta con id, nombre o alias va antes que la de prefijo, y la de prefijo antes que la difusa. La comparación ignora mayúsculas y acentos (NFD sin marcas). La difusa usa la distancia de Levenshtein ≤ 2 sobre id, nombre y aliases.
- **`recorrer_grafo`:** BFS por niveles desde el nodo, con profundidad por defecto 1 y máximo 5. Cada nodo aparece una sola vez, en el primer nivel donde se lo alcanza.
- **`trazar`:**
  1. `desde` se resuelve a un nodo: un id, una URL o ruta (contra la `ruta` de los endpoints, con `{param}` como comodín) o un archivo.
  2. Si es un endpoint, el nivel 1 son las aristas `llama_a` que lo tienen como `endpoint`, y se sigue desde el svc dueño.
  3. Después se hace BFS sobre los verbos que llevan datos, siguiendo `publica_en` hacia la cola y, desde una cola, las aristas `consume_de` en sentido inverso.
  4. Cada arista se incluye una sola vez y cada nodo se expande una sola vez. La profundidad máxima es 5.
  5. Cada salto informa `desde`, `hasta`, `verbo`, `endpoint`, `dato` (`request → response` si hay endpoint, o el `dato` de la arista), `evidencia`, `confianza` y `nivel`.
  6. Con `hasta`, se devuelven solo los saltos de los caminos más cortos.

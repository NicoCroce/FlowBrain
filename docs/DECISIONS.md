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

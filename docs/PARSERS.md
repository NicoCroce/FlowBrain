# Cómo sumar un parser

Un parser lee un repo y devuelve datos crudos. No conoce el brain: no usa ids de nodos ni decide a qué servicio pertenece algo. Eso lo hace el indexador (`packages/parsers/src/indexar.ts`), que une las extracciones de todos los parsers y resuelve nombres contra las páginas.

## Contrato

Un parser implementa `Parser` (`packages/parsers/src/tipos.ts`):

```ts
export interface Parser {
  nombre: string;
  detect(repo: RepoFuente): boolean;            // ¿hay algo para mí en este repo?
  extract(repo: RepoFuente): Extraccion | Promise<Extraccion>;
}
```

`RepoFuente` trae la raíz, la lista de archivos (ordenada, sin `node_modules` ni similares) y los paquetes del repo. `extract` parte de `extraccionVacia(nombre)` y llena solo lo que sabe:

| Campo | Qué es | Lo llenan hoy |
|---|---|---|
| `archivos` | Símbolos, imports e invocaciones por archivo | ts-parser, php-parser |
| `endpoints` | Método, ruta, tipos de request, response y query | ts-parser, php-parser, openapi-parser |
| `llamadas` | Llamadas HTTP salientes con su URL analizada | ts-parser, php-parser |
| `tablas`, `modelos` | Accesos a tablas y modelos de ORM | ts-parser, php-parser |
| `pantallas`, `navegaciones` | Rutas del front y navegación entre ellas (React Router v5 a v7, objetos de rutas, React Navigation, vue-router con componentes .vue, .svelte y .astro) | ts-parser |
| `eventos` | Mensajes publicados y consumidos | ts-parser |
| `esquema` | Tablas con columnas y claves foráneas | esquema-parser |
| `infra` | Imágenes, compose, pipelines, variables, proxy | infra-parser |
| `formas` | Forma de los tipos con nombre, por paquete | ts-parser, php-parser, openapi-parser |
| `autoritativo` | Paquetes cuyos endpoints este parser declara con autoridad | openapi-parser |

Se registra agregándolo a `PARSERS` en `indexar.ts`. Si el campo que llena ya existe, no hay que tocar nada más: el indexador, `compile` y las consultas lo toman.

## Reglas

1. **Determinista.** Misma entrada, misma salida, byte a byte: ordená todo antes de devolver y no dependas del orden del filesystem.
2. **Evidencia.** Cada dato lleva `archivo` y `linea` reales. Sin línea no se puede verificar.
3. **Lo que no se sabe, `null`.** No completar con una suposición: un hueco declarado sirve más que un dato inventado.
4. **Precisión antes que cobertura.** Un patrón ambiguo (`send`, `add`) solo cuenta si algo más lo confirma. Un falso positivo en el grafo cuesta más que un faltante.
5. **Sin secretos.** Nunca leer valores de configuración; de las variables de entorno, solo nombres y solo de archivos de ejemplo.
6. **Fixture sintético.** Cada parser y cada heurística entra con un test sobre un repo mínimo escrito para ese test, sin nombres ni código de un proyecto real.
7. **Agnóstico cuando se pueda.** Si el dato está en un formato que no depende del lenguaje (SQL, YAML, Dockerfile), el parser se escribe una vez para todos, como esquema-parser e infra-parser.

## Lenguajes y protocolos pendientes

Hoy el código se analiza en TypeScript/JavaScript y PHP, y los contratos son HTTP REST. Candidatos, por valor: GraphQL y gRPC como tipos de contrato; Python y Go vía tree-sitter (el php-parser ya usa tree-sitter y sirve de modelo). Se eligen cuando haya un proyecto real de esa pila contra el cual probar.

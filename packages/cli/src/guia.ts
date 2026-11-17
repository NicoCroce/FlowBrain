/**
 * Guía para que un modelo indexe un proyecto y decida la comunicación real entre servicios. Es el texto del comando
 * `/flowbrain-index` de Claude Code (lo escribe `flowbrain install`) y lo que imprime `flowbrain evidence --guide`.
 *
 * La indexación mecánica (endpoints, llamadas, tablas, pantallas) la hace la consola y es determinística. Lo que la
 * consola no puede saber es a qué servidor va cada llamada: eso lo decide el modelo leyendo configuración y código, y
 * lo deja escrito en el registro con su evidencia, para que quede revisable.
 */
export const NOMBRE_COMANDO = "flowbrain-index";

export const GUIA_ANALISIS = `---
description: Indexa este proyecto con FlowBrain y analiza la comunicación real entre sus servicios
---

Vas a indexar (o reindexar) este proyecto con FlowBrain y después analizar vos la comunicación real entre servicios.
La consola hace lo mecánico; tu trabajo es lo que el código solo no dice: a qué servicio va cada llamada.

$ARGUMENTS

## Reglas

- **Nunca abras archivos de entorno reales** (\`.env\`, \`.env.local\`, \`.env.production\`, \`env.prod\` y parecidos): tienen
  credenciales. Usá los de ejemplo (\`.env.example\`, \`.env.sample\`), la configuración en el código, \`docker-compose\`,
  pipelines y proxies. Si un valor solo está en un archivo real, preguntáselo al usuario.
- **No modifiques los repositorios del proyecto.** Editás \`.flowbrain/flowbrain.yaml\` y, solo para completar un hueco
  del índice (paso 6), la extracción de un cerebro en \`.flowbrain/<cerebro>/_build/\`.
- **No declares nada sin evidencia.** Coincidir en método y ruta no es evidencia: dos APIs pueden exponer las mismas
  rutas. Si no podés determinar un destino, no lo adivines: va a la lista de dudas.
- Respondé en el idioma del usuario.

## Pasos

1. **Indexar.** Parado en la carpeta del proyecto:
   - Si no existe \`.flowbrain/flowbrain.yaml\`: \`flowbrain install\` (si pregunta, un cerebro por repo).
   - Si existe: \`flowbrain brains apply\` para reindexar todo.
   Anotá qué cerebros quedaron y cuántos nodos tiene cada uno.

2. **Juntar la evidencia.** \`flowbrain evidence\` devuelve, por cada servicio que llama y cada base de URL:
   - \`llamadas\` y \`ejemplos\` con su archivo y línea;
   - \`coincide\`: con qué servicios de otros cerebros coinciden por método y ruta, y cuántas coinciden **solo** ahí;
   - \`definiciones\`: dónde se define cada variable o función de la base;
   - \`declaradas\`: lo que ya dice el registro;
   y aparte \`disputadas\`: llamadas que hoy no se unen a nada porque coinciden en más de un cerebro.

3. **Decidir cada base, de mayor a menor cantidad de llamadas.** Para cada una, buscá a qué servicio apunta de verdad:
   - Abrí las \`definiciones\` y seguí la variable hasta su valor: archivo de ejemplo, configuración por ambiente,
     \`docker-compose\`, pipeline, proxy. \`flowbrain infra --brain <cerebro>\` lista imágenes, variables y proxies.
   - Con el host o el puerto, buscá qué servicio escucha ahí: en la infraestructura del otro cerebro (dominio, nombre
     del servicio en compose, puerto expuesto, reglas del proxy) y en su código (prefijo global de rutas, puerto).
   - Usá \`coincide\` como pista, no como prueba: muchas llamadas que coinciden **solo** con un servicio lo apoyan; que
     coincidan con dos por igual no dice nada.
   - Una misma base puede ir a dos servicios (un proxy que reparte por prefijo): en ese caso declaralo con una conexión
     por destino y explicalo en \`nota\`.
   - **Si la configuración del repo y lo desplegado se contradicen** (la documentación dice un host y el comentario del
     código otro), lo desplegado manda. Dos formas de verlo sin credenciales:
     - el bundle publicado de un front trae sus variables de build horneadas: bajá el HTML, seguí los \`<script>\` y
       buscá el nombre de la variable (\`VITE_API_URL\`, \`NEXT_PUBLIC_…\`) en los chunks;
     - un \`GET\` a un endpoint de salud o a una ruta que no existe identifica el backend por su firma: cabeceras
       (\`Server\`, \`X-Powered-By\`) y cuerpo del 404, comparados con el código de cada cerebro (el handler de salud, el
       mensaje de "ruta no encontrada"). Solo lecturas; nunca con datos del usuario ni contra hosts que no salgan del
       proyecto.
     Si aun así no cierra, o el valor solo está en un archivo de entorno real, preguntale al usuario.

4. **Escribir lo que confirmaste** en \`.flowbrain/flowbrain.yaml\`:
   - \`comunicacion\`: dejá \`activa: true\` solo entre cerebros que se hablan de verdad; poné \`activa: false\` donde
     comprobaste que no.
   - \`conexiones\`: una por cada destino confirmado.

   \`\`\`yaml
   conexiones:
     - desde: web/svc-tienda-web
       hacia: api/svc-tienda-api
       por: API_URL                # texto que está en la base de la URL de esas llamadas
       origen: modelo
       evidencia:
         - "tienda-web/.env.example#L3"
         - "tienda-api/docker-compose.yml#L12"
       nota: "API_URL apunta a api.tienda.test, que el compose de tienda-api publica en el puerto 3000"
   \`\`\`

   Lo que no pudiste confirmar va a \`preguntas:\` (una frase por duda, con la base y qué falta saber). No borres las
   conexiones que tengan \`origen: persona\` o no tengan \`origen\`: las escribió alguien; si las contradecís, decilo.

5. **Verificar.** \`flowbrain brains viewer\` regenera el mapa. Después, por cada cerebro que llama,
   \`flowbrain connections --brain <cerebro>\` y de nuevo \`flowbrain evidence\`:
   - las \`disputadas\` tienen que haber bajado; las que quedan son dudas reales;
   - una conexión declarada con 0 llamadas está mal declarada o el \`por\` no coincide con la base: corregila.

6. **Buscar oportunidades de mejora** con lo que ya está indexado:
   - \`flowbrain drift --brain <cerebro>\`: llamadas que ningún endpoint atiende y endpoints que nadie llama (solo dentro
     del cerebro: para un front que llama a otro cerebro, usá \`sinDestino\` de \`evidence\`);
   - \`sinDestino\` alto en una base: el front llama a algo que ningún cerebro expone (falta indexar un repo, o la
     llamada está rota). **Antes de reportarlo, mirá una muestra:** puede ser un falso positivo del parser (un \`fetch\`
     con \`method\` en las opciones leído como GET, la query pegada a la ruta, una ruta comodín como \`/{token}\` que
     atrapa un archivo estático del propio front);
   - dos servicios con las mismas rutas: \`flowbrain parity <svc-viejo> <svc-nuevo> --brain <cerebro>\` si están en el
     mismo cerebro, o comparalos con \`coincide\`;
   - hosts escritos a mano en el código, variables de URL sin definición, bases armadas con funciones que impiden saber
     el destino;
   - \`flowbrain status --brain <cerebro>\`: huecos conocidos del índice (pantallas no detectadas, llamadas sin resolver).
   - **Huecos del índice: completalos, no solo los reportes.** Si un front tiene 0 pantallas (\`connections\` muestra
     \`pantallas: 0\` y todas sus llamadas salen del servicio), o el parser no entiende cómo se declaran rutas o llamadas:
     1. mirá en el código cómo están declaradas (router, navegador, cliente HTTP propio);
     2. escribí un extractor en \`.flowbrain/extractores/\` que complete \`pantallas\`, \`navegaciones\` o lo que falte en
        \`.flowbrain/<cerebro>/_build/files/<repo>.json\`, con el formato de \`.flowbrain/<cerebro>/SCHEMA.md\`
        (evidencia con archivo y línea reales, \`null\` donde no se sabe);
     3. corré \`flowbrain compile\` dentro de la carpeta del cerebro y \`flowbrain brains viewer\`, y verificá con
        \`connections\` que el hueco se cerró;
     4. avisá que \`brains apply\` y \`sync\` reescriben \`_build\` (el extractor hay que volver a correrlo) y reportá el
        patrón como mejora del parser de FlowBrain.

7. **Informar al usuario**, corto y en este orden:
   - **Confirmado:** cada conexión declarada, con la evidencia en una línea.
   - **Dudas:** lo que no pudiste determinar y qué necesitás que te responda. Si no hay, decilo.
   - **Oportunidades de mejora:** las que encontraste, de mayor a menor impacto, cada una con su archivo.
   - Qué cambió en \`flowbrain.yaml\` y cómo abrir el mapa: \`open .flowbrain/flowbrain.html\`.
`;

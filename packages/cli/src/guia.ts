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
- **No modifiques los repositorios del proyecto.** Editás \`.flowbrain/flowbrain.yaml\`, \`.flowbrain/<cerebro>/calls.yaml\`
  (pasos 7 y 8) y, solo para completar un hueco
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

7. **Completar las trazas que se cortan.** Por cada cerebro con endpoints, \`flowbrain calls --brain <cerebro>\`
   devuelve los endpoints cuyo recorrido no llega a ninguna tabla y, en su camino, las llamadas que el parser no pudo
   atribuir porque el receptor no tiene tipo declarado (una variable sin tipo, un servicio pedido al contenedor por
   nombre, una llamada dinámica). Cada una trae \`candidatos\`: los métodos del repo que se llaman así.
   - Abrí el archivo en la línea de la llamada y determiná de qué clase es el receptor: seguí la asignación de la
     variable, el tipo que devuelve el método que la crea, la configuración del contenedor de servicios
     (\`services.yaml\`, un \`ServiceProvider\`, un módulo), la clase base.
   - Si lo confirmás, declaralo en \`.flowbrain/<cerebro>/calls.yaml\` (creá el archivo si no existe):

     \`\`\`yaml
     llamadas:
       - desde: "repo-tienda-api:src/Controller/PedidoController.php#PedidoController.crear"
         linea: 42                    # la línea de la llamada, dentro del método que llama
         hacia: "repo-tienda-api:src/Service/Facturador.php#Facturador.emitir"
         origen: modelo
         nota: "services.yaml#L12 registra 'facturador' como App\\Service\\Facturador"
     \`\`\`

     \`desde\` es el valor de \`desde\` que te dio \`calls\`; \`hacia\` es uno de sus \`candidatos\`, o el símbolo que
     encontraste (\`flowbrain search <Clase.metodo> --brain <cerebro>\` da su clave \`repo:ruta#Simbolo\`).
   - Si no podés determinarlo leyendo el código, no lo declares: va a la lista de dudas.
   - Empezá por \`masRepetidas\`: una sola llamada (un helper de autenticación, un serializador) puede estar cortando
     decenas de recorridos. Después seguí con los endpoints que más se usan, de a tandas. Después de cada tanda:
     \`flowbrain brains apply <cerebro>\` (reindexa y aplica \`calls.yaml\`) y de nuevo \`flowbrain calls\`:
     \`sinLlegarATabla\` tiene que bajar, y \`declaradas.faltan\` lista las que no entraron (símbolo o línea que no
     coinciden: corregilas). Seguí hasta que no queden endpoints con llamadas por resolver o hasta que lo que queda
     no se pueda determinar.
   - \`sinMetodo\` son endpoints para los que no se encontró el método que los atiende: ahí el hueco es de cómo se
     declaran las rutas; tratalo como un hueco del índice (paso 6).
   - Un endpoint que no llega a una tabla y no tiene llamadas por resolver probablemente no toca datos: no es un error.
   Al terminar, \`flowbrain brains viewer\`.

8. **Auditar lo que el parser no vio.** La consola solo conoce las llamadas que detectó: si un módulo llama al back de
   una forma que el parser no entiende, no aparece en ningún lado. Buscalo vos. Por cada cerebro con pantallas,
   en la sección \`delLadoQueLlama\` de \`flowbrain calls --brain <cerebro>\`:
   - \`funcionalidadesSinLlamadas\`: funcionalidades con pantallas y ninguna llamada HTTP en ninguna. **Abrí su código**
     (\`codigo\`): si llama al back (un cliente propio, una función que arma la URL, un SDK, un store), es un hueco.
   - \`httpSinRuta\`: llamadas HTTP que el parser vio sin poder determinar la ruta. Abrí cada una y seguí cómo se arma.
   - \`pantallasSinLlamadas\`: tomá una muestra de las que no estén en lo anterior y verificá que de verdad no llamen.
   - Además, por tu cuenta: buscá en el repo los nombres del cliente HTTP y de sus envolturas (\`axios\`, \`fetch\`, el
     cliente propio) y compará los módulos donde aparecen contra los que tienen llamadas en el índice
     (\`flowbrain connections --brain <cerebro>\`, \`flowbrain feature <id>\`). Un módulo que usa el cliente y no tiene
     llamadas es un hueco.
   Lo que confirmes leyendo el código, declaralo en \`.flowbrain/<cerebro>/calls.yaml\`:

   \`\`\`yaml
   http:                              # una llamada HTTP saliente que el parser no vio o no pudo rutear
     - desde: "repo-tienda-web:src/premios/api.ts#premiosApi.estado"
       linea: 30                      # la línea de la llamada, dentro de ese símbolo
       metodo: GET
       ruta: "/premios/estado"        # con {param} en los segmentos variables
       base: "API_URL"                # opcional: la variable o el host de donde sale la URL
       origen: modelo
       nota: "request() arma la URL con la tabla de rutas de rutas.ts#L4"
   \`\`\`

   Si la llamada existe pero la pantalla no llega a ella (una función pasada por referencia, un store, un evento),
   declarala en \`llamadas:\` (paso 7) desde el hook o componente que la dispara. Después \`flowbrain brains apply <cerebro>\`
   y de nuevo \`calls\`: la funcionalidad tiene que salir de \`funcionalidadesSinLlamadas\`. Cada patrón que el parser no
   entendió, reportalo como mejora de FlowBrain con un ejemplo mínimo. No escatimes en esta revisión: una funcionalidad
   sin relaciones en el mapa es peor que gastar más en leer su código.

9. **Informar al usuario**, corto y en este orden:
   - **Confirmado:** cada conexión declarada, con la evidencia en una línea.
   - **Trazas:** cuántos endpoints pasaron a llegar a sus tablas y cuántas llamadas declaraste en \`calls.yaml\`.
   - **Huecos del parser:** qué funcionalidades no tenían llamadas y ahora sí, y qué patrón no entendió el parser.
   - **Dudas:** lo que no pudiste determinar y qué necesitás que te responda. Si no hay, decilo.
   - **Oportunidades de mejora:** las que encontraste, de mayor a menor impacto, cada una con su archivo.
   - Qué cambió en \`flowbrain.yaml\` y cómo abrir el mapa: \`open .flowbrain/flowbrain.html\`.
   - Si algún cerebro tiene pantallas o endpoints pero ninguna funcionalidad en \`product/\` (\`flowbrain status\` lo
     muestra como "pantallas sin funcionalidad" o "borradores sin promover"), sugerí correr \`/flowbrain-features\`.
`;

export const NOMBRE_FUNCIONALIDADES = "flowbrain-features";

/**
 * Guía para que un modelo deduzca y complete las funcionalidades de producto de cada cerebro. Es el texto del comando
 * `/flowbrain-features` (lo escribe `flowbrain install`) y lo que imprime `flowbrain feature --guide`.
 *
 * `flowbrain draft` propone una funcionalidad por carpeta (`features/`, `modules/`, `domains/` o, sin ellas,
 * `pages/`, `screens/`, `views/`), con nombre técnico y sin descripción. Lo que la estructura no dice es qué es cada
 * una para quien la usa, cuáles son la misma con otro nombre y a qué funcionalidad pertenece el código de un back
 * organizado por capas (`Controller/`, `Service/`): eso lo deduce el modelo leyendo pantallas, textos y llamadas.
 */
export const GUIA_FUNCIONALIDADES = `---
description: Deduce y completa las funcionalidades de producto de cada cerebro de FlowBrain
---

Vas a completar el catálogo de funcionalidades de este proyecto en FlowBrain: qué puede hacer quien usa el producto,
con qué pantallas, endpoints y tablas. La consola propone borradores por estructura de carpetas; tu trabajo es
convertirlos en funcionalidades de producto con nombre de negocio, descripción y todo su código.

$ARGUMENTS

## Reglas

- **No modifiques los repositorios del proyecto.** Solo escribís en \`.flowbrain/<cerebro>/_drafts/product/\` y
  \`.flowbrain/<cerebro>/product/\`.
- **No abras archivos de entorno reales** (\`.env\` y parecidos).
- **Todo sale del código.** El nombre y la descripción salen de lo que ve quien usa la pantalla (títulos, textos de
  i18n, menús, rutas), de los endpoints que llama y de las tablas que toca; nunca de suponer por el nombre de una
  carpeta. Lo que no puedas deducir queda en "Preguntas abiertas" de la página.
- No borres páginas de \`product/\` que ya estaban (las escribió alguien): si las contradecís, decilo.
- Respondé en el idioma del usuario. Nombres y descripciones, en el idioma del producto (el de sus textos de i18n).

## Pasos

1. **Ver el estado.** Parado en el proyecto, por cada cerebro (\`flowbrain brains\` los lista):
   \`flowbrain status --brain <cerebro>\` muestra pantallas y endpoints sin funcionalidad y borradores sin promover.
   Si no hay borradores ni páginas, corré \`flowbrain brains apply\` (reindexa y propone borradores).
   Buscá además un glosario del producto en el proyecto (docs de dominio, README, textos de i18n): da los nombres de negocio.

2. **Promover los borradores tal cual, para poder consultarlos:** \`flowbrain promote <id...> --write --brain <cerebro>\`
   con los ids \`feat-*\` (solo los de \`_drafts/product/\`; los de \`technology/\` son otro trabajo). Desde ahí
   \`flowbrain feature <id> --brain <cerebro>\` da sus pantallas, endpoints, tablas y dependencias, y
   \`flowbrain screen <ruta> --brain <cerebro>\` cada pantalla de punta a punta.

3. **Armar el catálogo de cada cerebro**, editando \`.flowbrain/<cerebro>/product/feat-*.md\`:
   - **Unir duplicados:** dos páginas que son la misma funcionalidad (\`game\` y \`games\`, el listado y el detalle de lo
     mismo) quedan en una: sumá las rutas de \`codigo\`, dejá el id más claro y borrá la otra.
   - **Agrupar pantallas sueltas:** si los borradores salieron uno por pantalla (\`pages/Login\`, \`pages/Recover\`,
     \`pages/Register\`), agrupalos en la funcionalidad que el usuario reconoce (acceso a la cuenta).
   - **Separar lo que no es producto:** contenedores de navegación (drawer, splash, layout) y herramientas internas no
     son funcionalidades: borrá la página o sumá su código a la funcionalidad a la que sirven. Lo exclusivo de
     administración sí lo es, con su nombre ("Backoffice: …").
   - **Back organizado por capas** (sin borradores, o con muy pocos): creá las funcionalidades con \`codigo\` apuntando a
     los archivos de controller (\`repo-x:src/Controller/PlayerController.php\`), agrupados por la funcionalidad del
     front que llama a sus endpoints (\`flowbrain connections\`, \`evidence\` y \`feature\` del front lo muestran). Usá el
     mismo id que esa funcionalidad tiene en el cerebro del front: así se encuentran entre cerebros.
   - Cada página: \`nombre\` de negocio (el técnico va a \`aliases\`), \`resumen\` de una línea (máximo 140
     caracteres) y "## Qué es" en lenguaje de producto: qué le permite hacer a quien la usa, quién la usa y el flujo
     principal, sin nombres de archivos ni de clases. Sacá el aviso de borrador y las preguntas que resolviste.

4. **Compilar y verificar.** \`flowbrain compile\` dentro de \`.flowbrain/<cerebro>/\` después de cada tanda (si no
   compila, el error dice qué página corregir). Al final, \`flowbrain status --brain <cerebro>\`: las pantallas y
   endpoints sin funcionalidad tienen que haber bajado; los que quedan, revisalos uno por uno (¿falta sumar su carpeta
   a un \`codigo\`?). Después \`flowbrain brains viewer\` regenera el mapa.

5. **Informar al usuario**, corto: cuántas funcionalidades quedaron por cerebro, qué uniste o descartaste y por qué,
   las preguntas abiertas que necesitan respuesta de una persona, y cómo verlas:
   \`open .flowbrain/flowbrain.html#/funcionalidades\`.
`;

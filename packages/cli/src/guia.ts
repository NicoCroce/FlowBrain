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

0. **¿Está completo el índice?** \`flowbrain coverage --brain <cerebro>\` por cada cerebro. Si un cerebro no tiene
   \`profile.md\` o su cobertura es baja (pantallas sin llamadas, endpoints que no llegan a una tabla), primero hay que
   estudiarlo y completarlo con \`/flowbrain-study\`: decidir la comunicación sobre un índice con huecos da un mapa con
   huecos.

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
     2. escribí un extractor del proyecto en \`.flowbrain/<cerebro>/extractors/<repo-id>/\` que complete
        \`pantallas\`, \`navegaciones\` o lo que falte (el contrato y las reglas están en la guía \`/flowbrain-study\`);
        corre solo en cada indexación, así que sobrevive a \`brains apply\` y a \`sync\`;
     3. corré \`flowbrain brains apply <cerebro>\` y \`flowbrain brains viewer\`, y verificá con \`connections\` que el
        hueco se cerró;
     4. reportá el patrón como mejora del parser de FlowBrain (para que el próximo proyecto no necesite el extractor).

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

/**
 * Guía para que un modelo estudie cómo está hecho cada repo y escriba los extractores que completan el índice. Es el
 * texto del comando `/flowbrain-study` y lo que imprime `flowbrain coverage --guide`. La idea: entender primero
 * (framework, rutas, pantallas, llamadas; en el back: endpoints, capas, repositorios, tablas y columnas), y recién
 * entonces escribir un extractor por cada cosa entendida. El modelo interviene una vez; después cada indexación corre
 * el mismo código.
 */
export const NOMBRE_ESTUDIO = "flowbrain-study";

export const GUIA_ESTUDIO = `---
description: Estudia cómo está hecho cada repo y escribe los extractores que completan el índice de FlowBrain
---

Vas a estudiar cómo está hecho cada repo de este proyecto y a escribir, para cada uno, los extractores que hagan falta
para que FlowBrain lo entienda entero: de la pantalla a la tabla, con las columnas que se leen y se escriben. No importa
el lenguaje ni el framework: si los parsers de FlowBrain no lo entienden, lo enseñás vos con un extractor.

$ARGUMENTS

## Reglas

- **Entender antes de extraer.** No escribas un extractor hasta haber leído cómo lo hace este repo y haberlo anotado en
  el perfil. Un extractor escrito por analogía con otro proyecto devuelve basura convincente.
- **Nunca abras archivos de entorno reales** (\`.env\`, \`.env.local\`, \`.env.production\`, \`env.prod\`). Los extractores
  tampoco pueden leerlos.
- **No modifiques los repositorios.** Todo lo que escribís va en \`.flowbrain/<cerebro>/\`.
- **Un extractor no adivina.** Cada dato cita un archivo y una línea reales. Si para un caso no podés determinar el
  destino con una regla, dejalo afuera y resolvelo a mano en \`calls.yaml\`; no lo inventes.
- **Determinístico.** Mismo repo, misma salida: sin red, sin fechas, sin azar, con la salida ordenada.
- **No escatimes en la lectura.** Un índice incompleto es peor que gastar más en entender el código.
- Respondé en el idioma del usuario.

## Pasos

1. **Punto de partida.** Si no existe \`.flowbrain/flowbrain.yaml\`, \`flowbrain install\`. Después, por cada cerebro,
   \`flowbrain coverage --brain <cerebro>\`: ese es el número a subir. Anotá de dónde parte cada uno.

2. **Estudiar cada repo y escribir su perfil** en \`.flowbrain/<cerebro>/profile.md\`. Leé el código de verdad:
   manifiestos, el punto de entrada, dos o tres módulos completos de punta a punta. El perfil responde, con archivo y
   línea de ejemplo para cada respuesta:

   **Si es un front (web o móvil):**
   - Lenguaje, framework y librerías que definen la arquitectura (router, estado, datos remotos).
   - **Cómo enruta:** dónde se declaran las rutas, con qué forma (objeto, JSX, archivos por convención, navegadores
     anidados), cómo se anidan layouts y guardas, y cómo se arma la ruta final de una pantalla.
   - **Pantallas:** qué es una pantalla acá, cómo se llega del registro de rutas al componente (import directo, lazy,
     un mapa de nombres), y cómo se navega entre ellas.
   - **Llamadas a servicios:** el cliente HTTP y todas sus envolturas; dónde se definen las rutas (constantes, una
     tabla, funciones que las arman); cómo se elige la base (una variable por backend, un proxy); cómo llega una
     pantalla a la llamada (hooks, stores, sagas, queries por referencia, eventos).

   **Si es un back:**
   - Lenguaje, framework y arquitectura: qué capas hay y cómo se llaman acá (controlador, caso de uso, servicio,
     repositorio, modelo), y cómo se conectan (inyección de dependencias, contenedor, fábricas, llamadas estáticas).
   - **Endpoints:** dónde se declaran (decoradores, archivo de rutas, convención de nombres), cómo se arma la ruta
     final (prefijos globales, grupos, versiones) y cómo se llega al método que la atiende.
   - **Servicios y repositorios:** cómo llama una capa a la otra y por qué el tipo del receptor puede no estar
     declarado.
   - **Tablas:** el ORM o el acceso a datos (entidades, query builder, SQL a mano, procedimientos); cómo se sabe qué
     tabla toca cada acceso, si lee o escribe, y **qué columnas**: las del \`select\`, las que se asignan antes de
     guardar, las de un \`update\`, las de un \`where\`.
   - **Esquema:** dónde está la definición vigente de cada tabla (migraciones SQL o como código, modelos del ORM,
     tipos generados desde la base, un \`schema.*\`) y qué columnas tiene. FlowBrain ya lee DDL, Prisma, Drizzle,
     Kysely, Knex, Laravel, Rails, TypeORM, MikroORM, Sequelize, Mongoose, Doctrine, JPA, GORM, Django y SQLAlchemy;
     \`flowbrain coverage\` muestra en \`tablas.sinColumnas\` las que quedaron sin definición.

   Cerrá el perfil con **"Lo que FlowBrain ya entiende"** y **"Lo que falta"**, comparando lo que leíste con
   \`flowbrain coverage\`, \`flowbrain calls --brain <cerebro>\` y una muestra: elegí cinco pantallas (o endpoints) al azar,
   seguilas a mano en el código y compará con \`flowbrain screen <ruta>\` o \`flowbrain flow "<MÉTODO /ruta>"\`.

3. **Escribir un extractor por cada cosa que falta**, en \`.flowbrain/<cerebro>/extractors/<repo-id>/\` (el id del repo
   es el que muestra \`flowbrain status\`). Uno por tema, con nombre que lo diga: \`10-rutas.mjs\`, \`20-pantallas.mjs\`,
   \`30-llamadas.mjs\`, \`40-endpoints.mjs\`, \`50-capas.mjs\`, \`60-tablas.mjs\`. Corren en orden alfabético, después de los
   parsers de FlowBrain, y cada uno puede usar los símbolos que declaró el anterior.

   **Contrato.** El programa recibe la ruta del repo como primer argumento, corre parado en ella e imprime **un JSON**
   por la salida estándar. Puede ser \`.mjs\`/\`.js\` (Node), \`.py\`, \`.sh\`, \`.rb\` o \`.php\`: usá lo que mejor lea ese
   código. Corre sin red, sin poder escribir en el disco y con tope de tiempo. Todas las secciones son opcionales:

   \`\`\`json
   {
     "simbolos":     [{ "archivo": "src/pedidos/handler.go", "nombre": "PedidosHandler.Crear", "tipo": "metodo", "linea": 20, "fin": 41 }],
     "invocaciones": [{ "desde": { "archivo": "src/pedidos/handler.go", "simbolo": "PedidosHandler.Crear" },
                        "hacia": { "archivo": "src/pedidos/repo.go", "simbolo": "PedidosRepo.Guardar" }, "linea": 27 }],
     "endpoints":    [{ "metodo": "POST", "ruta": "/api/pedidos", "archivo": "src/rutas.go", "linea": 12,
                        "handler": { "archivo": "src/pedidos/handler.go", "simbolo": "PedidosHandler.Crear" } }],
     "llamadas":     [{ "archivo": "src/api/pedidos.ts", "linea": 30, "metodo": "GET", "ruta": "/pedidos/{id}", "base": "API_URL" },
                      { "archivo": "src/pagos/stripe.go", "linea": 18, "metodo": "POST", "ruta": "/v1/charges", "host": "api.stripe.com" }],
     "pantallas":    [{ "ruta": "/pedidos", "archivo": "src/rutas.tsx", "linea": 8,
                        "componente": { "archivo": "src/pedidos/Pedidos.tsx", "simbolo": "Pedidos" } }],
     "navegaciones": [{ "archivo": "src/pedidos/Pedidos.tsx", "linea": 14, "desde": "Pedidos", "ruta": "/pedidos/{id}", "tipo": "navega" }],
     "eventos":      [{ "archivo": "src/pagos/servicio.go", "linea": 50, "nombre": "pago.confirmado", "direccion": "publica" }],
     "importa":      [{ "archivo": "lib/pedidos_page.dart", "importa": ["lib/api/pedidos_api.dart"] }],
     "componentes":  [{ "archivo": "lib/src/boton.dart", "nombre": "BotonPrimario", "linea": 12 }],
     "usos":         [{ "archivo": "lib/pedidos_page.dart", "linea": 40, "paquete": "empresa_ui", "simbolo": "BotonPrimario", "desde": "PedidosPage.build" }],
     "accesos":      [{ "archivo": "src/pedidos/repo.go", "linea": 33, "tabla": "pedidos", "verbo": "escribe", "columnas": ["estado", "total"] }],
     "esquema":      [{ "tabla": "pedidos", "archivo": "src/pedidos/modelo.go", "linea": 5,
                        "columnas": [{ "nombre": "id", "tipo": "int", "pk": true }, { "nombre": "nota", "tipo": "text", "nulo": true }] }]
   }
   \`\`\`

   - Rutas de archivo relativas a la raíz del repo; líneas desde 1; segmentos variables de una ruta como \`{param}\`.
   - Un **símbolo** es una función, método o componente con su rango (\`linea\`–\`fin\`): es lo que permite saber que una
     llamada o un acceso ocurre *dentro* de ese método. Declará los que los parsers no tengan.
   - Una **invocación** une dos símbolos que ya existen; la \`linea\` cae dentro del que llama.
   - El **endpoint** cita la línea donde se declara la ruta. Si la ruta se declara en un archivo de rutas y la atiende
     un método de otro lado (\`r.POST("/x", h.Crear)\`, \`path("x/", views.crear)\`, \`get "/x", to: "x#crear"\`), decí cuál con
     \`handler\` (un símbolo que exista): de ahí arrancan el recorrido y la traza. Sin \`handler\`, el método es el que
     contiene la línea o el que empieza hasta 40 líneas después.
   - Una **llamada** con \`host\` va a ese sistema (un tercero, como una pasarela de pagos, o un servicio propio por su
     nombre de host); sin \`host\`, se resuelve por la ruta contra los endpoints conocidos.
   - Una **navegación** dice qué símbolo navega en \`desde\` (la función o el componente, el mismo nombre que en
     \`simbolos\`); si es más fácil, la ruta de la pantalla desde la que se navega (\`"/pedidos"\`). Sin \`desde\`, cuenta
     para cualquier pantalla que alcance ese archivo.
   - Un **evento** es un mensaje que el código publica o consume, por su clave (el tópico, la cola, el nombre del
     evento): \`direccion\` \`publica\` o \`consume\`. Quien publica y quien consume se unen por la cola, y el impacto de
     cambiar quien publica llega a quien consume. Si la cola no tiene página, el borrador la propone.
   - **Importa** declara qué archivos del repo usa un archivo, cuando el lenguaje no lo dice de una forma que FlowBrain
     lea: sirve para que una pantalla alcance los menús y datos que importa.
   - **Componentes y usos** unen un sistema de diseño (o cualquier librería de interfaz) con las pantallas que lo
     dibujan, también entre repos y entre cerebros. \`componentes\`: lo que exporta la librería, en la línea donde se
     declara. \`usos\`: lo que un archivo toma de otro paquete, en la línea donde lo usa, con \`paquete\` igual al nombre
     del manifiesto de la librería (\`package.json\`, \`pubspec.yaml\`, \`go.mod\`…) y \`desde\` el símbolo que lo dibuja.
     En TypeScript, Vue, Svelte y Astro ya lo hace el parser (librería = paquete con \`main\`, \`exports\` o \`types\`);
     escribilo para lo demás (Flutter, Kotlin, SwiftUI) o si la librería no se reconoce sola.
   - Un **acceso** va en la línea donde ocurre, dentro del método que lo hace; \`columnas\` solo las que se ven en el
     código. Si el parser ya detectó ese acceso (mismo archivo, línea, tabla y verbo), el tuyo le suma las columnas.
     Si tu extractor solo busca columnas y no puede asegurar que cada nombre sea una tabla real (una CTE, una
     subconsulta con nombre), agregá \`"soloColumnas": true\`: completa los accesos que ya existen y no crea tablas
     nuevas. Mirá primero en qué línea cita el parser cada acceso (\`_build/extraction/<repo>.json\`) y citá la misma.
   - El **esquema** de una tabla cita la línea donde se define (la migración, el modelo, el tipo generado), con el
     nombre físico de la tabla y todas sus columnas vigentes. Reemplaza lo que un parser haya leído para esa tabla:
     usalo para un ORM o una convención que FlowBrain no conozca, o para corregir un esquema mal leído.
   - **Corregir al parser.** Una \`llamada\` tuya en una línea reemplaza a las que el parser dejó en esa línea (con
     la ruta, el método o la base mal leídos). Una \`pantalla\` con una ruta que ya existe le reemplaza el componente
     y las \`envuelta\` (un layout tomado por la página). Para borrar lo que el parser inventó, \`quitar\`:
     \`[{ "tipo": "llamada", "archivo": "src/api.ts", "linea": 30 }, { "tipo": "pantalla", "ruta": "/{path}/config" }]\`
     (también \`navegacion\`, \`endpoint\` con \`metodo\` y \`ruta\`, \`acceso\` con \`tabla\` y \`evento\` con \`nombre\`). Solo se corrige lo que leyó un parser, nunca lo que sumó otro extractor; un \`quitar\`
     que no coincide con nada se rechaza. Lo mismo vale para \`http\` en \`calls.yaml\`.
   - FlowBrain verifica cada dato: el archivo existe, la línea existe, los símbolos existen. Lo que no pasa se descarta.

   Probá cada extractor suelto antes de indexar:
   \`node .flowbrain/<cerebro>/extractors/<repo-id>/30-llamadas.mjs /ruta/al/repo | head -c 2000\`.

4. **Indexar y medir.** \`flowbrain brains apply <cerebro>\` y \`flowbrain coverage --brain <cerebro>\`:
   - \`extractores\` dice cuánto aceptó de cada uno y cuánto rechazó, con el motivo: corregí el extractor hasta que no
     rechace nada.
   - Los porcentajes tienen que subir. Si uno no se mueve, el extractor no está encontrando lo que creés: volvé a leer.
   - \`flowbrain calls --brain <cerebro>\` muestra lo que sigue cortado: endpoints que no llegan a una tabla,
     funcionalidades sin llamadas, llamadas sin ruta. Cada patrón repetido es un extractor que falta; un caso suelto
     que no entra en una regla va a \`.flowbrain/<cerebro>/calls.yaml\`.
   Repetí los pasos 3 y 4 hasta que la cobertura deje de subir o lo que quede no se pueda determinar leyendo código.

5. **Verificar que lo extraído es cierto, no solo que es mucho.** Por cada extractor, elegí al azar diez datos de su
   salida y comprobá cada uno abriendo el archivo en esa línea. Si alguno está mal, la regla está mal: corregila.
   Después dejá **controles** en \`.flowbrain/<cerebro>/checks.yaml\`: hechos que verificaste a mano y que tienen que
   seguir saliendo en cada indexación. \`coverage\` avisa cuando uno deja de cumplirse.

   \`\`\`yaml
   controles:
     - { tipo: endpoint, metodo: POST, ruta: "/api/login" }
     - { tipo: pantalla, ruta: "/login" }
     - { tipo: llamada, archivo: "src/features/auth/api.ts", metodo: POST, ruta: "/login" }
     - { tipo: traza, endpoint: "POST /api/login", tabla: "user", nota: "el login actualiza el token del usuario" }
     - { tipo: alcanza, pantalla: "/login", metodo: POST, ruta: "/login", nota: "la pantalla llega a la llamada" }
   \`\`\`

   Dejá al menos cinco por cerebro, y que incluyan trazas completas: son las que prueban que todo el camino existe.
   En un back, \`traza\` (endpoint → tabla); en un front, \`alcanza\` (pantalla → llamada).

   **Piezas que no son de ningún tipo conocido.** Si el sistema tiene algo que no es pantalla, endpoint, servicio, tabla
   ni cola (un job programado, un worker, un webhook entrante, un bucket), escribí su página a mano en
   \`.flowbrain/<cerebro>/technology/<tipo>-<nombre>.md\` con un \`tipo\` propio en minúsculas (\`job\`, \`worker\`,
   \`bucket\`) y sus relaciones (\`escribe_en\`, \`lee_de\`, \`llama_a\`, \`publica_en\`, \`consume_de\`). Compila como cualquier
   otro nodo: aparece en el índice, en el mapa 3D con un color propio y en el impacto en las dos direcciones. No uses
   un tipo propio para algo que ya tiene tipo: lo que es un endpoint o una tabla va con el suyo.

6. **Unir los cerebros.** Lo que se importa por nombre de paquete ya queda unido solo: FlowBrain lee los manifiestos de
   cada repo (\`package.json\`, \`go.mod\`, \`pubspec.yaml\`, \`composer.json\`…), sabe qué paquete publica cada uno y quién
   lo declara como dependencia, y une las pantallas con los componentes del sistema de diseño que dibujan
   (\`flowbrain connections\`, en \`porPaquetes\`). Si un repo usa una librería de otro y no aparece ahí, mirá por qué (un
   alias, un paquete sin nombre, un lenguaje que el parser no lee) y completalo con \`componentes\` y \`usos\`. Con los
   índices completos, seguí con \`/${NOMBRE_COMANDO}\` (a qué servicio va cada llamada) y
   \`/${NOMBRE_FUNCIONALIDADES}\` (las funcionalidades de producto). Al final, \`flowbrain brains viewer\`.

7. **Informar al usuario**, corto:
   - Por cerebro: la cobertura antes y después, en una tabla.
   - Qué entendiste de cada repo que FlowBrain no sabía, en dos o tres líneas, y qué extractores escribiste.
   - Lo que quedó sin determinar y por qué.
   - Los patrones que valdría la pena sumar a los parsers de FlowBrain, cada uno con un ejemplo mínimo.
   - Que los extractores, el perfil y los controles quedaron en \`.flowbrain/<cerebro>/\`, se pueden leer y versionar, y
     corren solos en cada indexación; \`coverage\` avisa si alguno queda viejo.
`;

export const NOMBRE_ESPECIFICACIONES = "flowbrain-specs";

/**
 * Guía para que un modelo deduzca las especificaciones de cada funcionalidad: qué tiene que cumplirse, en llano, con el
 * archivo que lo cumple y el caso de test que lo verifica. Es el texto del comando `/flowbrain-specs` (lo escribe
 * `flowbrain install`) y lo que imprime `flowbrain specs --guide`.
 *
 * El índice sabe qué tests tiene cada funcionalidad y cómo se llama cada caso; lo que no sabe es qué regla de negocio
 * hay detrás de un caso ni qué reglas viven en el código sin test. Eso lo lee el modelo y lo confirma una persona.
 */
export const GUIA_ESPECIFICACIONES = `---
description: Deduce las especificaciones de negocio y de producto de cada funcionalidad de FlowBrain
---

Vas a escribir las especificaciones de las funcionalidades de este proyecto en FlowBrain: cada requisito que tiene que
cumplirse para que el caso de uso pase, dicho como lo diría alguien de negocio o de producto, con el archivo que lo
cumple y el caso de test que lo verifica. Quedan como propuestas: las confirma una persona.

$ARGUMENTS

## Reglas

- **No modifiques los repositorios del proyecto.** Solo editás \`.flowbrain/<cerebro>/product/feat-*.md\`.
- **No abras archivos de entorno reales** (\`.env\` y parecidos).
- **Todo sale del código y de los tests.** Una especificación que no podés señalar en un archivo no va. Lo que parezca
  una regla pero no encuentres dónde se cumple, va a "Preguntas abiertas" de la página.
- **En llano.** Una oración que entienda quien no programa, afirmativa y comprobable: "No se puede pagar con una
  tarjeta vencida", "El listado muestra primero los pedidos más nuevos". Sin nombres de clases, archivos ni endpoints
  en el texto: eso va en \`archivos\`.
- **Una regla por especificación.** Si un caso de test comprueba dos cosas, son dos especificaciones con el mismo test.
- **No cambies una especificación \`confirmada\`**: la revisó una persona. Si el código la contradice, decilo.
- No inventes tests: \`tests\` solo nombra casos que existen. Una especificación sin test es un dato útil, no un error.
- Respondé en el idioma del usuario. El texto de cada especificación, en el idioma del producto.

## Qué es cada tipo

- \`negocio\`: una regla que vale aunque cambie la pantalla. Límites, permisos, cálculos, estados válidos, qué se
  guarda y cuándo ("Un pedido cancelado no se puede volver a pagar").
- \`producto\`: cómo se comporta el producto para quien lo usa. Qué ve, qué puede hacer, qué pasa cuando algo falla
  ("Si el pago falla, el carrito queda como estaba y se muestra el motivo").

## Pasos

1. **Ver el estado.** Parado en el proyecto, por cada cerebro (\`flowbrain brains\` los lista):
   \`flowbrain specs --brain <cerebro>\` lista cada funcionalidad con cuántas especificaciones tiene, cuántos casos de
   test y cuántos de esos casos todavía no verifican ninguna. Si no hay funcionalidades, primero \`/flowbrain-features\`.
   Empezá por las que tienen más casos de test sin especificación. Si el usuario nombró funcionalidades, solo esas.

2. **Por cada funcionalidad**, juntar de dónde salen las reglas:
   - \`flowbrain specs <feat> --brain <cerebro>\`: las que ya tiene y los casos de test sueltos, cada uno con su
     archivo y su línea.
   - \`flowbrain feature <feat> --brain <cerebro>\`: pantallas, endpoints, tablas y archivos de test.
   - **Leé los tests**: el nombre del caso y sus \`expect\`/\`assert\` dicen la regla. Varios casos que comprueban lo mismo
     con distintos datos son una sola especificación con varios tests.
   - **Leé el código que no tiene test**: validaciones, guardas y condiciones en el recorrido de cada endpoint
     (\`flowbrain flow "<MÉTODO /ruta>"\`) y en cada pantalla (\`flowbrain screen <ruta>\`): permisos, límites, estados,
     mensajes de error. Esas son las especificaciones sin test.

3. **Escribirlas** en el frontmatter de \`.flowbrain/<cerebro>/product/<feat>.md\`:

   \`\`\`yaml
   especificaciones:
     - id: tarjeta-vencida            # corto, único en la funcionalidad; no lo cambies después
       texto: No se puede pagar con una tarjeta vencida.
       tipo: negocio                  # negocio | producto
       archivos:                      # dónde se cumple; con #Ln si sabés la línea
         - repo-tienda:src/pagos/validar-tarjeta.ts#L18
       tests:                         # "repo:ruta::nombre del caso", o "repo:ruta" si es el archivo entero
         - repo-tienda:tests/pagos/validar-tarjeta.test.ts::rechaza una tarjeta vencida
       estado: propuesta
   \`\`\`

   El nombre del caso va tal como lo lista \`flowbrain specs <feat>\` (sin el \`(L12)\`). Entre 3 y 15 por funcionalidad
   suele alcanzar: las reglas que alguien de producto reconocería, no una por cada \`if\`.

4. **Compilar y revisar.** \`flowbrain compile\` dentro de \`.flowbrain/<cerebro>/\` (si no compila, el error dice qué
   línea corregir). Después \`flowbrain specs <feat> --brain <cerebro>\`: \`rotos\` son referencias que el índice no
   encontró (ruta mal escrita, caso con otro nombre): corregilas. Los \`casosSinEspecificacion\` que queden, revisalos:
   ¿falta una especificación o el caso prueba un detalle técnico que no es un requisito?

5. **Informar al usuario**, corto: por funcionalidad, cuántas especificaciones propusiste, cuántas no tienen test (y
   cuáles son las más riesgosas de dejar así), las preguntas abiertas, y que para confirmarlas alcanza con cambiar
   \`estado: propuesta\` por \`estado: confirmada\` en la página después de leerlas.
`;

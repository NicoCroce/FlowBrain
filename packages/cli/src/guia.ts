/**
 * Guía para que un modelo indexe un proyecto y decida la comunicación real entre servicios. Es el texto del comando
 * `/flowbrain-index` de Claude Code (lo escribe `flowbrain install`) y lo que imprime `flowbrain evidence --guide`.
 *
 * La indexación mecánica (endpoints, llamadas, tablas, pantallas) la hace la consola y es determinística. Lo que la
 * consola no puede saber es a qué servidor va cada llamada: eso lo decide el modelo leyendo configuración y código, y
 * lo deja escrito en el registro con su evidencia, para que quede revisable.
 *
 * Las guías van siempre en inglés (dec. 214): las lee el modelo. Las claves de YAML/JSON y los valores que FlowBrain
 * lee (`conexiones`, `origen: modelo`, `tipo: negocio`…) quedan en castellano: son el formato del brain.
 */
export const NOMBRE_COMANDO = "flowbrain-index";

export const GUIA_ANALISIS = `---
description: Index this project with FlowBrain and analyze the real communication between its services
---

You are going to index (or reindex) this project with FlowBrain and then analyze, yourself, the real communication
between services. The console does the mechanical part; your job is what the code alone does not say: which service
each call goes to.

$ARGUMENTS

## Rules

- **Never open real environment files** (\`.env\`, \`.env.local\`, \`.env.production\`, \`env.prod\` and similar): they hold
  credentials. Use the example ones (\`.env.example\`, \`.env.sample\`), the configuration in the code, \`docker-compose\`,
  pipelines and proxies. If a value only lives in a real file, ask the user for it.
- **Do not modify the project's repositories.** You edit \`.flowbrain/flowbrain.yaml\`, \`.flowbrain/<brain>/calls.yaml\`
  (steps 7 and 8) and, only to fill a gap
  in the index (step 6), the extraction of a brain in \`.flowbrain/<brain>/_build/\`.
- **Do not declare anything without evidence.** Matching on method and path is not evidence: two APIs can expose the
  same paths. If you cannot determine a destination, do not guess it: it goes on the list of open questions.
- Reply in the user's language.

## Steps

0. **Is the index complete?** \`flowbrain coverage --brain <brain>\` for each brain. If a brain has no \`profile.md\`
   or its coverage is low (screens without calls, endpoints that never reach a table), first study it and complete it
   with \`/flowbrain-study\`: deciding the communication on top of an index with gaps gives a map with gaps.

1. **Index.** From the project folder:
   - If \`.flowbrain/flowbrain.yaml\` does not exist: \`flowbrain install\` (if it asks, one brain per repo).
   - If it exists: \`flowbrain brains apply\` to reindex everything.
   Note which brains were created and how many nodes each one has.

2. **Gather the evidence.** \`flowbrain evidence\` returns, for each calling service and each URL base:
   - \`llamadas\` and \`ejemplos\` with their file and line;
   - \`coincide\`: which services of other brains they match by method and path, and how many match **only** there;
   - \`definiciones\`: where each variable or function of the base is defined;
   - \`declaradas\`: what the registry already says;
   and separately \`disputadas\`: calls that today join nothing because they match in more than one brain.

3. **Decide each base, from most to fewest calls.** For each one, find which service it really points to:
   - Open the \`definiciones\` and follow the variable to its value: example file, per-environment configuration,
     \`docker-compose\`, pipeline, proxy. \`flowbrain infra --brain <brain>\` lists images, variables and proxies.
   - With the host or the port, find which service listens there: in the other brain's infrastructure (domain, service
     name in compose, exposed port, proxy rules) and in its code (global route prefix, port).
   - Use \`coincide\` as a hint, not as proof: many calls that match **only** one service support it; matching two
     equally says nothing.
   - One base can go to two services (a proxy that routes by prefix): in that case declare it with one connection per
     destination and explain it in \`nota\`.
   - **If the repo's configuration and what is deployed contradict each other** (the docs say one host and a code
     comment another), what is deployed wins. Two ways to see it without credentials:
     - a front's published bundle has its build variables baked in: download the HTML, follow the \`<script>\` tags and
       search for the variable name (\`VITE_API_URL\`, \`NEXT_PUBLIC_…\`) in the chunks;
     - a \`GET\` to a health endpoint or to a path that does not exist identifies the backend by its signature: headers
       (\`Server\`, \`X-Powered-By\`) and the 404 body, compared with the code of each brain (the health handler, the
       "route not found" message). Reads only; never with user data nor against hosts that do not come from the
       project.
     If it still does not add up, or the value only lives in a real environment file, ask the user.

4. **Write what you confirmed** in \`.flowbrain/flowbrain.yaml\`:
   - \`comunicacion\`: leave \`activa: true\` only between brains that really talk to each other; set \`activa: false\`
     where you checked they do not.
   - \`conexiones\`: one for each confirmed destination.

   \`\`\`yaml
   conexiones:
     - desde: web/svc-shop-web
       hacia: api/svc-shop-api
       por: API_URL                # text found in the URL base of those calls
       origen: modelo
       evidencia:
         - "shop-web/.env.example#L3"
         - "shop-api/docker-compose.yml#L12"
       nota: "API_URL points to api.shop.test, which the shop-api compose publishes on port 3000"
   \`\`\`

   - \`internas\`: when the service calls **its own server** (a \`/version.json\`, translations, runtime configuration,
     relative paths on the same host), it is not a connection: it goes to no brain. Declare it like this and those
     calls stop being cross-referenced and stop showing up in \`drift\` as calls without an endpoint. Without \`por\` it
     applies to every relative-URL call; with \`por\`, only to those that carry it in the base or at the start of the path.

   \`\`\`yaml
   internas:
     - de: web/svc-shop-web
       por: /assets                # optional
       origen: modelo
       evidencia:
         - "shop-web/src/version.ts#L8"
       nota: "fetch('/assets/version.json'): served by the front itself, not the API"
   \`\`\`

   What you could not confirm goes to \`preguntas:\` (one sentence per question, with the base and what is missing).
   Do not delete connections that have \`origen: persona\` or no \`origen\`: someone wrote them; if you contradict them,
   say so.

5. **Verify.** \`flowbrain brains viewer\` regenerates the map. Then, for each calling brain,
   \`flowbrain connections --brain <brain>\` and \`flowbrain evidence\` again:
   - the \`disputadas\` must have gone down; the ones left are real open questions;
   - a declared connection with 0 calls is declared wrong or its \`por\` does not match the base: fix it.

6. **Look for improvement opportunities** with what is already indexed:
   - \`flowbrain drift --brain <brain>\`: calls no endpoint serves and endpoints nobody calls (only within the brain:
     for a front that calls another brain, use \`sinDestino\` from \`evidence\`);
   - high \`sinDestino\` on a base: the front calls something no brain exposes (a repo is missing from the index, or
     the call is broken). **Before reporting it, look at a sample:** it may be a parser false positive (a \`fetch\`
     with \`method\` in its options read as GET, the query glued to the path, a catch-all route like \`/{token}\` that
     catches a static file of the front itself);
   - two services with the same routes: \`flowbrain parity <old-svc> <new-svc> --brain <brain>\` if they are in the
     same brain, or compare them with \`coincide\`;
   - hosts hard-coded in the code, URL variables without a definition, bases built with functions that make the
     destination impossible to know;
   - \`flowbrain status --brain <brain>\`: known gaps in the index (undetected screens, unresolved calls).
   - **Gaps in the index: fill them, do not just report them.** If a front has 0 screens (\`connections\` shows
     \`pantallas: 0\` and all its calls come out of the service), or the parser does not understand how routes or calls
     are declared:
     1. look in the code at how they are declared (router, navigator, custom HTTP client);
     2. write a project extractor in \`.flowbrain/<brain>/extractors/<repo-id>/\` that fills in
        \`pantallas\`, \`navegaciones\` or whatever is missing (the contract and the rules are in the \`/flowbrain-study\`
        guide); it runs on its own on every indexing, so it survives \`brains apply\` and \`sync\`;
     3. run \`flowbrain brains apply <brain>\` and \`flowbrain brains viewer\`, and check with \`connections\` that the
        gap closed;
     4. report the pattern as an improvement to FlowBrain's parser (so the next project does not need the extractor).

7. **Complete the traces that break off.** For each brain with endpoints, \`flowbrain calls --brain <brain>\`
   returns the endpoints whose flow never reaches a table and, along their path, the calls the parser could not
   attribute because the receiver has no declared type (an untyped variable, a service fetched from the container by
   name, a dynamic call). Each one comes with \`candidatos\`: the repo's methods with that name.
   - Open the file at the line of the call and determine the receiver's class: follow the variable's assignment, the
     type returned by the method that creates it, the service container configuration (\`services.yaml\`, a
     \`ServiceProvider\`, a module), the base class.
   - If you confirm it, declare it in \`.flowbrain/<brain>/calls.yaml\` (create the file if it does not exist):

     \`\`\`yaml
     llamadas:
       - desde: "repo-shop-api:src/Controller/OrderController.php#OrderController.create"
         linea: 42                    # the line of the call, inside the calling method
         hacia: "repo-shop-api:src/Service/Invoicer.php#Invoicer.issue"
         origen: modelo
         nota: "services.yaml#L12 registers 'invoicer' as App\\Service\\Invoicer"
     \`\`\`

     \`desde\` is the \`desde\` value \`calls\` gave you; \`hacia\` is one of its \`candidatos\`, or the symbol you
     found (\`flowbrain search <Class.method> --brain <brain>\` gives its key \`repo:path#Symbol\`).
   - If you cannot determine it by reading the code, do not declare it: it goes on the list of open questions.
   - Start with \`masRepetidas\`: a single call (an authentication helper, a serializer) can be cutting off dozens
     of flows. Then go on with the most used endpoints, in batches. After each batch:
     \`flowbrain brains apply <brain>\` (reindexes and applies \`calls.yaml\`) and \`flowbrain calls\` again:
     \`sinLlegarATabla\` must go down, and \`declaradas.faltan\` lists the ones that did not get in (symbol or line that
     do not match: fix them). Keep going until no endpoints are left with calls to resolve or until what is left
     cannot be determined.
   - \`sinMetodo\` are endpoints for which the method that serves them was not found: there the gap is in how routes
     are declared; treat it as a gap in the index (step 6).
   - An endpoint that does not reach a table and has no calls to resolve probably does not touch data: it is not an
     error.
   When done, \`flowbrain brains viewer\`.

8. **Audit what the parser did not see.** The console only knows the calls it detected: if a module calls the back
   in a way the parser does not understand, it shows up nowhere. Look for it yourself. For each brain with screens,
   in the \`delLadoQueLlama\` section of \`flowbrain calls --brain <brain>\`:
   - \`funcionalidadesSinLlamadas\`: features with screens and no HTTP call in any of them. **Open their code**
     (\`codigo\`): if it calls the back (a custom client, a function that builds the URL, an SDK, a store), it is a gap.
   - \`httpSinRuta\`: HTTP calls the parser saw without being able to determine the path. Open each one and follow how
     it is built.
   - \`pantallasSinLlamadas\`: take a sample of those not covered above and check that they really make no calls.
   - Also, on your own: search the repo for the names of the HTTP client and its wrappers (\`axios\`, \`fetch\`,
     \`HttpClient\`, \`ky\`, \`$fetch\`, the custom client) and compare the modules where they appear against the ones
     that have calls in the index (\`flowbrain connections --brain <brain>\`, \`flowbrain feature <id>\`). A module that
     uses the client and has no calls is a gap.
   What you confirm by reading the code, declare it in \`.flowbrain/<brain>/calls.yaml\`:

   \`\`\`yaml
   http:                              # an outgoing HTTP call the parser did not see or could not route
     - desde: "repo-shop-web:src/rewards/api.ts#rewardsApi.status"
       linea: 30                      # the line of the call, inside that symbol
       metodo: GET
       ruta: "/rewards/status"        # with {param} in the variable segments
       base: "API_URL"                # optional: the variable or host the URL comes from
       origen: modelo
       nota: "request() builds the URL with the route table in routes.ts#L4"
   \`\`\`

   If the call exists but the screen does not reach it (a function passed by reference, a store, an event), declare it
   in \`llamadas:\` (step 7) from the hook or component that triggers it. Then \`flowbrain brains apply <brain>\`
   and \`calls\` again: the feature must drop out of \`funcionalidadesSinLlamadas\`. Report every pattern the parser did
   not understand as a FlowBrain improvement, with a minimal example. Do not skimp on this review: a feature with no
   relations on the map is worse than spending more on reading its code.

9. **Report to the user**, briefly and in this order:
   - **Confirmed:** each declared connection, with its evidence in one line.
   - **Traces:** how many endpoints now reach their tables and how many calls you declared in \`calls.yaml\`.
   - **Parser gaps:** which features had no calls and now do, and which pattern the parser did not understand.
   - **Open questions:** what you could not determine and what you need the user to answer. If there are none, say so.
   - **Improvement opportunities:** the ones you found, from highest to lowest impact, each with its file.
   - What changed in \`flowbrain.yaml\` and how to open the map: \`open .flowbrain/flowbrain.html\`.
   - If any brain has screens or endpoints but no feature in \`product/\` (\`flowbrain status\` shows it as screens
     without a feature or unpromoted drafts), suggest running \`/flowbrain-features\`.
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
description: Deduce and complete the product features of each FlowBrain brain
---

You are going to complete this project's feature catalog in FlowBrain: what the people who use the product can do,
with which screens, endpoints and tables. The console proposes drafts based on the folder structure; your job is to
turn them into product features with a business name, a description and all of their code.

$ARGUMENTS

## Rules

- **Do not modify the project's repositories.** You only write in \`.flowbrain/<brain>/_drafts/product/\` and
  \`.flowbrain/<brain>/product/\`.
- **Do not open real environment files** (\`.env\` and similar).
- **Everything comes from the code.** The name and the description come from what the person using the screen sees
  (titles, i18n texts, menus, routes), from the endpoints it calls and from the tables it touches; never from guessing
  based on a folder name. What you cannot deduce stays in the page's open questions section.
- Do not delete pages in \`product/\` that were already there (someone wrote them): if you contradict them, say so.
- Reply in the user's language. Names and descriptions go in the product's language (the language of its i18n texts).

## Steps

1. **Check the status.** From the project, for each brain (\`flowbrain brains\` lists them):
   \`flowbrain status --brain <brain>\` shows screens and endpoints without a feature and unpromoted drafts.
   If there are no drafts and no pages, run \`flowbrain brains apply\` (reindexes and proposes drafts).
   Also look for a product glossary in the project (domain docs, README, i18n texts): it gives the business names.

2. **Promote the drafts as they are, so you can query them:** \`flowbrain promote <id...> --write --brain <brain>\`
   with the \`feat-*\` ids (only those in \`_drafts/product/\`; the ones in \`technology/\` are a different job). From
   there \`flowbrain feature <id> --brain <brain>\` gives its screens, endpoints, tables and dependencies, and
   \`flowbrain screen <route> --brain <brain>\` each screen end to end.

3. **Build the catalog of each brain**, editing \`.flowbrain/<brain>/product/feat-*.md\`:
   - **Merge duplicates:** two pages that are the same feature (\`game\` and \`games\`, the list and the detail of the
     same thing) become one: add up the paths in \`codigo\`, keep the clearest id and delete the other one.
   - **Group loose screens:** if the drafts came out one per screen (\`pages/Login\`, \`pages/Recover\`,
     \`pages/Register\`), group them into the feature the user recognizes (account access).
   - **Separate what is not product:** navigation containers (drawer, splash, layout) and internal tools are not
     features: delete the page or add its code to the feature they serve. What is exclusive to administration is a
     feature, with its name ("Backoffice: …").
   - **Back organized by layers** (no drafts, or very few): create the features with \`codigo\` pointing to the
     controller files (\`repo-x:src/Controller/PlayerController.php\`), grouped by the front feature that calls their
     endpoints (\`flowbrain connections\`, \`evidence\` and the front's \`feature\` show it). Use the same id that
     feature has in the front's brain: that is how they find each other across brains.
   - Each page: a business \`nombre\` (the technical one goes to \`aliases\`), a one-line \`resumen\` (at most 140
     characters) and the "what it is" section (keep the heading the page already has) in product language: what it
     lets its users do, who uses it and the main flow, with no file or class names. Remove the draft notice and the
     questions you resolved.

4. **Compile and verify.** \`flowbrain compile --brain <brain>\` after each batch (if it does not compile,
   the error says which page to fix). At the end, \`flowbrain status --brain <brain>\`: screens and endpoints
   without a feature must have gone down; review the ones left one by one (is its folder missing from some
   \`codigo\`?). \`flowbrain unassigned --brain <brain>\` lists the files that ended up in no feature, by folder, with
   the recommended feature and the reason: assign the ones that fit (what is marked as shared goes to a \`lib\` page,
   not to a feature). Then \`flowbrain brains viewer\` regenerates the map.

5. **Report to the user**, briefly: how many features each brain ended up with, what you merged or discarded and why,
   the open questions that need an answer from a person, and how to see them:
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
description: Study how each repo is built and write the extractors that complete the FlowBrain index
---

You are going to study how each repo of this project is built and write, for each one, the extractors needed for
FlowBrain to understand it fully: from the screen to the table, with the columns that are read and written. The
language and the framework do not matter: if FlowBrain's parsers do not understand it, you teach it with an extractor.

$ARGUMENTS

## Rules

- **Understand before extracting.** Do not write an extractor until you have read how this repo does it and written
  it down in the profile. An extractor written by analogy with another project returns convincing garbage.
- **Never open real environment files** (\`.env\`, \`.env.local\`, \`.env.production\`, \`env.prod\`). Extractors
  cannot read them either.
- **Do not modify the repositories.** Everything you write goes in \`.flowbrain/<brain>/\`.
- **An extractor does not guess.** Every piece of data cites a real file and line. If for some case you cannot
  determine the destination with a rule, leave it out and resolve it by hand in \`calls.yaml\`; do not make it up.
- **Deterministic.** Same repo, same output: no network, no dates, no randomness, with sorted output.
- **Do not skimp on reading.** An incomplete index is worse than spending more on understanding the code.
- Reply in the user's language.

## Steps

1. **Starting point.** If \`.flowbrain/flowbrain.yaml\` does not exist, \`flowbrain install\`. Then, for each brain,
   \`flowbrain coverage --brain <brain>\`: that is the number to raise. Note where each one starts.

2. **Study each repo and write its profile** in \`.flowbrain/<brain>/profile.md\`. Really read the code:
   manifests, the entry point, two or three complete modules end to end. The profile answers, with an example file and
   line for each answer:

   **If it is a front (web or mobile):**
   - Language, framework and the libraries that define the architecture (router, state, remote data).
   - **How it routes:** where routes are declared, in what shape (object, JSX, files by convention, nested
     navigators), how layouts and guards are nested, and how a screen's final route is built.
   - **Screens:** what a screen is here, how you get from the route registry to the component (direct import, lazy,
     a map of names), and how navigation between them works.
   - **Calls to services:** the HTTP client and all its wrappers; where the paths are defined (constants, a table,
     functions that build them); how the base is chosen (one variable per backend, a proxy); how a screen reaches the
     call (hooks, stores, sagas, queries by reference, events).

   **If it is a back:**
   - Language, framework and architecture: which layers exist and what they are called here (controller, use case,
     service, repository, model), and how they are wired (dependency injection, container, factories, static calls).
   - **Endpoints:** where they are declared (decorators, routes file, naming convention), how the final route is
     built (global prefixes, groups, versions) and how you get to the method that serves it.
   - **Services and repositories:** how one layer calls the next and why the receiver's type may not be declared.
   - **Tables:** the ORM or data access (entities, query builder, hand-written SQL, procedures); how to tell which
     table each access touches, whether it reads or writes, and **which columns**: those in the \`select\`, those
     assigned before saving, those in an \`update\`, those in a \`where\`.
   - **Schema:** where the current definition of each table lives (SQL or code migrations, ORM models, types generated
     from the database, a \`schema.*\`) and which columns it has. FlowBrain already reads DDL, Prisma, Drizzle,
     Kysely, Knex, Laravel, Rails, TypeORM, MikroORM, Sequelize, Mongoose, Doctrine, JPA, GORM, Django and SQLAlchemy;
     \`flowbrain coverage\` shows in \`tablas.sinColumnas\` the tables left without a definition.

   Close the profile with **"What FlowBrain already understands"** and **"What is missing"**, comparing what you read
   with \`flowbrain coverage\`, \`flowbrain calls --brain <brain>\` and a sample: pick five screens (or endpoints) at
   random, follow them by hand in the code and compare with \`flowbrain screen <route>\` or
   \`flowbrain flow "<METHOD /route>"\`.

3. **Write one extractor for each missing thing**, in \`.flowbrain/<brain>/extractors/<repo-id>/\` (the repo id is
   the one \`flowbrain status\` shows). One per topic, with a name that says so: \`10-routes.mjs\`, \`20-screens.mjs\`,
   \`30-calls.mjs\`, \`40-endpoints.mjs\`, \`50-layers.mjs\`, \`60-tables.mjs\`. They run in alphabetical order, after
   FlowBrain's parsers, and each one can use the symbols the previous one declared.

   **Contract.** The program receives the repo path as its first argument, runs from inside it and prints **one JSON**
   to standard output. It can be \`.mjs\`/\`.js\` (Node), \`.py\`, \`.sh\`, \`.rb\` or \`.php\`: use whatever reads that
   code best. It runs without network, without being able to write to disk and with a time limit. Every section is
   optional:

   \`\`\`json
   {
     "simbolos":     [{ "archivo": "src/orders/handler.go", "nombre": "OrdersHandler.Create", "tipo": "metodo", "linea": 20, "fin": 41 }],
     "invocaciones": [{ "desde": { "archivo": "src/orders/handler.go", "simbolo": "OrdersHandler.Create" },
                        "hacia": { "archivo": "src/orders/repo.go", "simbolo": "OrdersRepo.Save" }, "linea": 27 }],
     "referencias":  [{ "desde": { "archivo": "src/orders/handler.go", "simbolo": "OrdersHandler.Create" },
                        "hacia": { "archivo": "src/orders/types.go", "simbolo": "OrderStatus" }, "linea": 30 }],
     "endpoints":    [{ "metodo": "POST", "ruta": "/api/orders", "archivo": "src/routes.go", "linea": 12,
                        "handler": { "archivo": "src/orders/handler.go", "simbolo": "OrdersHandler.Create" } }],
     "llamadas":     [{ "archivo": "src/api/orders.ts", "linea": 30, "metodo": "GET", "ruta": "/orders/{id}", "base": "API_URL" },
                      { "archivo": "src/payments/stripe.go", "linea": 18, "metodo": "POST", "ruta": "/v1/charges", "host": "api.stripe.com",
                        "envia": { "amount": "number", "currency": "string", "note?": "string" }, "espera": { "id": "string" } }],
     "pantallas":    [{ "ruta": "/orders", "archivo": "src/routes.tsx", "linea": 8,
                        "componente": { "archivo": "src/orders/Orders.tsx", "simbolo": "Orders" } }],
     "navegaciones": [{ "archivo": "src/orders/Orders.tsx", "linea": 14, "desde": "Orders", "ruta": "/orders/{id}", "tipo": "navega" }],
     "eventos":      [{ "archivo": "src/payments/service.go", "linea": 50, "nombre": "payment.confirmed", "direccion": "publica" }],
     "importa":      [{ "archivo": "lib/orders_page.dart", "importa": ["lib/api/orders_api.dart"] }],
     "componentes":  [{ "archivo": "lib/src/button.dart", "nombre": "PrimaryButton", "linea": 12 }],
     "usos":         [{ "archivo": "lib/orders_page.dart", "linea": 40, "paquete": "company_ui", "simbolo": "PrimaryButton", "desde": "OrdersPage.build" }],
     "accesos":      [{ "archivo": "src/orders/repo.go", "linea": 33, "tabla": "orders", "verbo": "escribe", "columnas": ["status", "total"] }],
     "esquema":      [{ "tabla": "orders", "archivo": "src/orders/model.go", "linea": 5,
                        "columnas": [{ "nombre": "id", "tipo": "int", "pk": true }, { "nombre": "note", "tipo": "text", "nulo": true }] }]
   }
   \`\`\`

   - File paths relative to the repo root; lines start at 1; variable segments of a route as \`{param}\`.
   - A **symbol** is a function, method or component with its range (\`linea\`–\`fin\`): that is what lets FlowBrain
     know that a call or an access happens *inside* that method. Declare the ones the parsers do not have.
   - An **invocation** joins two symbols that already exist; the \`linea\` falls inside the caller.
   - A **reference** joins a symbol with a type, interface, enum, class or constant it names without calling it
     (declared in \`simbolos\` with \`tipo\` \`tipo\`, \`interfaz\`, \`enum\`, \`clase\` or \`constante\`): with that,
     \`riesgo\` follows a change in a type to whoever uses it.
   - The **endpoint** cites the line where the route is declared. If the route is declared in a routes file and served
     by a method somewhere else (\`r.POST("/x", h.Create)\`, \`path("x/", views.create)\`, \`get "/x", to: "x#create"\`),
     say which one with \`handler\` (a symbol that exists): the flow and the trace start from there. Without
     \`handler\`, the method is the one that contains the line or the one that starts up to 40 lines after it.
   - A **call** with \`host\` goes to that system (a third party, like a payment gateway, or one of your own services by
     its host name); without \`host\`, it is resolved by its path against the known endpoints.
     With \`envia\`, \`query\` and \`espera\` (field → type, \`?\` at the end of the field if it is optional) it says what
     the call sends in the body, in the query and what it reads from the response; optionally \`enviaTipo\`,
     \`queryTipo\`, \`esperaTipo\` with the type name. With that, \`deriva\` compares the fields against the type the back
     declares. If you correct a call the parser had already typed, its fields are kept.
   - A **navigation** says which symbol navigates in \`desde\` (the function or component, the same name as in
     \`simbolos\`); if that is easier, the route of the screen you navigate from (\`"/orders"\`). Without \`desde\`, it
     counts for any screen that reaches that file.
   - An **event** is a message the code publishes or consumes, by its key (the topic, the queue, the event name):
     \`direccion\` \`publica\` or \`consume\`. Publisher and consumer are joined through the queue, and the impact of
     changing the publisher reaches the consumer. If the queue has no page, the draft proposes it.
   - **Importa** declares which repo files a file uses, when the language does not say it in a way FlowBrain reads:
     it lets a screen reach the menus and data it imports.
   - **Components and usages** join a design system (or any UI library) with the screens that draw it, also across
     repos and across brains. \`componentes\`: what the library exports, at the line where it is declared. \`usos\`: what
     a file takes from another package, at the line where it uses it, with \`paquete\` equal to the name in the
     library's manifest (\`package.json\`, \`pubspec.yaml\`, \`go.mod\`…) and \`desde\` the symbol that draws it.
     In TypeScript, Vue, Svelte and Astro the parser already does it (library = package with \`main\`, \`exports\` or
     \`types\`); write it for the rest (Flutter, Kotlin, SwiftUI) or if the library is not recognized on its own.
   - An **access** goes at the line where it happens, inside the method that does it; \`columnas\` only those visible in
     the code. If the parser already detected that access (same file, line, table and verb), yours adds its columns.
     If your extractor only looks for columns and cannot ensure each name is a real table (a CTE, a named subquery),
     add \`"soloColumnas": true\`: it completes the accesses that already exist and creates no new tables. First check
     which line the parser cites for each access (\`_build/extraction/<repo>.json\`) and cite the same one.
   - The **schema** of a table cites the line where it is defined (the migration, the model, the generated type), with
     the table's physical name and all its current columns. It replaces whatever a parser read for that table: use it
     for an ORM or a convention FlowBrain does not know, or to correct a misread schema.
   - **Correcting the parser.** A \`llamada\` of yours on a line replaces the ones the parser left on that line (with the
     path, method or base misread). A \`pantalla\` with a route that already exists replaces its component and its
     \`envuelta\` (a layout taken for the page). To delete what the parser made up, \`quitar\`:
     \`[{ "tipo": "llamada", "archivo": "src/api.ts", "linea": 30 }, { "tipo": "pantalla", "ruta": "/{path}/config" }]\`
     (also \`navegacion\`, \`endpoint\` with \`metodo\` and \`ruta\`, \`acceso\` with \`tabla\` and \`evento\` with
     \`nombre\`). Only what a parser read can be corrected, never what another extractor added; a \`quitar\` that matches
     nothing is rejected. The same applies to \`http\` in \`calls.yaml\`.
   - FlowBrain verifies every piece of data: the file exists, the line exists, the symbols exist. Whatever does not pass
     is discarded.

   Test each extractor on its own before indexing:
   \`node .flowbrain/<brain>/extractors/<repo-id>/30-calls.mjs /path/to/the/repo | head -c 2000\`.

4. **Index and measure.** \`flowbrain brains apply <brain>\` and \`flowbrain coverage --brain <brain>\`:
   - \`extractores\` says how much it accepted from each one and how much it rejected, with the reason: fix the
     extractor until it rejects nothing.
   - The percentages must go up. If one does not move, the extractor is not finding what you think: read again.
   - \`flowbrain calls --brain <brain>\` shows what is still cut off: endpoints that do not reach a table, features
     without calls, calls without a path. Each repeated pattern is a missing extractor; a one-off case that does not
     fit a rule goes to \`.flowbrain/<brain>/calls.yaml\`.
   Repeat steps 3 and 4 until coverage stops going up or what is left cannot be determined by reading code.

5. **Verify that what was extracted is true, not just that it is a lot.** For each extractor, pick ten pieces of its
   output at random and check each one by opening the file at that line. If any is wrong, the rule is wrong: fix it.
   Then leave **checks** in \`.flowbrain/<brain>/checks.yaml\`: facts you verified by hand that must keep showing up
   on every indexing. \`coverage\` warns when one stops holding.

   \`\`\`yaml
   controles:
     - { tipo: endpoint, metodo: POST, ruta: "/api/login" }
     - { tipo: pantalla, ruta: "/login" }
     - { tipo: llamada, archivo: "src/features/auth/api.ts", metodo: POST, ruta: "/login" }
     - { tipo: traza, endpoint: "POST /api/login", tabla: "user", nota: "login updates the user's token" }
     - { tipo: alcanza, pantalla: "/login", metodo: POST, ruta: "/login", nota: "the screen reaches the call" }
   \`\`\`

   Leave at least five per brain, and include complete traces: they are the ones that prove the whole path exists.
   In a back, \`traza\` (endpoint → table); in a front, \`alcanza\` (screen → call).

   **Pieces of no known type.** If the system has something that is not a screen, endpoint, service, table or queue
   (a scheduled job, a worker, an incoming webhook, a bucket), write its page by hand in
   \`.flowbrain/<brain>/technology/<type>-<name>.md\` with a custom lowercase \`tipo\` (\`job\`, \`worker\`,
   \`bucket\`) and its relations (\`escribe_en\`, \`lee_de\`, \`llama_a\`, \`publica_en\`, \`consume_de\`). It compiles like
   any other node: it appears in the index, on the 3D map with its own color and in the impact in both directions. Do
   not use a custom type for something that already has one: what is an endpoint or a table goes with its own.

6. **Join the brains.** What is imported by package name is already joined on its own: FlowBrain reads each repo's
   manifests (\`package.json\`, \`go.mod\`, \`pubspec.yaml\`, \`composer.json\`…), knows which package each one publishes
   and who declares it as a dependency, and joins screens with the design-system components they draw
   (\`flowbrain connections\`, under \`porPaquetes\`). If a repo uses a library from another one and it does not show up
   there, find out why (an alias, a package without a name, a language the parser does not read) and complete it with
   \`componentes\` and \`usos\`. With complete indexes, continue with \`/${NOMBRE_COMANDO}\` (which service each call
   goes to) and \`/${NOMBRE_FUNCIONALIDADES}\` (the product features). At the end, \`flowbrain brains viewer\`.

7. **Report to the user**, briefly:
   - Per brain: coverage before and after, in a table.
   - What you understood about each repo that FlowBrain did not know, in two or three lines, and which extractors you
     wrote.
   - What was left undetermined and why.
   - The patterns worth adding to FlowBrain's parsers, each with a minimal example.
   - That the extractors, the profile and the checks are in \`.flowbrain/<brain>/\`, can be read and versioned, and
     run on their own on every indexing; \`coverage\` warns if any goes stale.
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
description: Deduce the business and product specifications of each FlowBrain feature
---

You are going to write the use cases and the specifications of this project's features in FlowBrain. A use case is
something someone can do with the product ("Vote for the player of the match"); each specification is a requirement
that must hold for that use case to pass, stated the way someone from business or product would say it, with the file
that fulfills it and the test case that verifies it. A person reads them in the viewer and flags what is wrong.

$ARGUMENTS

## Rules

- **Do not modify the project's repositories.** You only edit \`.flowbrain/<brain>/product/feat-*.md\`, or the draft
  \`.flowbrain/<brain>/_drafts/product/feat-*.md\` when the feature is new and still a draft (it gets promoted with them).
- **Do not open real environment files** (\`.env\` and similar).
- **Everything comes from the code and the tests.** A specification you cannot point to in a file does not go in.
  Whatever looks like a rule but you cannot find where it is fulfilled goes to the page's open questions section.
- **In plain language.** One sentence someone who does not program understands, affirmative and checkable: "You cannot
  pay with an expired card", "The list shows the newest orders first". No class, file or endpoint names in the text:
  those go in \`archivos\`.
- **One rule per specification.** If a test case checks two things, they are two specifications with the same test.
- **Do not change a \`confirmada\` specification**: a person reviewed it. If the code contradicts it, say so.
- **Every specification goes in a use case**, and in only one. A use case groups the rules of a single action.
- **The same use case in another brain carries the same \`id\`**: if the voting screen is in \`web\` and the API that
  stores the vote in \`newapi\`, both pages have \`casos: - id: vote-mvp\` with their own specifications. Before
  creating a use case, check whether the same feature in another brain already has it
  (\`flowbrain specs <feat> --brain <other>\`) and use its \`id\` and its \`nombre\`.
- **A use case with \`problema\`** was flagged as wrong by a person: fix what it says (the use case, its
  specifications, its files or tests) and delete \`problema\`. If you disagree, leave it and explain why in the report.
- **A rule with \`hallazgo\`** was left by an agent that tried to test it (\`flowbrain specs --findings\`). If its
  \`decision\` is \`regla_mal\`, a person said the code is right and the rule is not: fix the rule's \`texto\` (or delete
  it, if it no longer applies) according to what \`hoy\` says and delete the \`hallazgo\`; its test is then requested
  again. With \`codigo_mal\` or no decision, do not touch it: it belongs to development or a person decides it. The
  product's code is not changed from here.
- Do not make up tests: \`tests\` only names test cases that exist. A specification without a test is useful data, not
  an error.
- **\`manual\`** is written by a person who decides to test a rule by hand: do not touch it. To write the missing tests
  there is \`/flowbrain-tests\` (\`flowbrain specs --guide-tests\`).
- Reply in the user's language. The text of each specification goes in the product's language.

## What each type means

- \`negocio\` (business): a rule that holds even if the screen changes. Limits, permissions, calculations, valid
  states, what is stored and when ("A cancelled order cannot be paid again").
- \`producto\` (product): how the product behaves for the person using it. What they see, what they can do, what
  happens when something fails ("If the payment fails, the cart stays as it was and the reason is shown").

## Steps

1. **Check the status.** First what was flagged as wrong: \`flowbrain specs --problems --brain <brain>\` in each brain.
   That comes before everything else. Then, from the project, for each brain (\`flowbrain brains\` lists them):
   \`flowbrain specs --brain <brain>\` lists each feature with how many specifications it has, how many test cases
   and how many of those test cases still verify none. If there are no features, first \`/flowbrain-features\`.
   Start with the ones with the most test cases without a specification. If the user named features, only those.

2. **For each feature**, gather where the rules come from:
   - \`flowbrain specs <feat> --brain <brain>\`: the ones it already has and the loose test cases, each with its
     file and line.
   - \`flowbrain feature <feat> --brain <brain>\`: screens, endpoints, tables and test files.
   - **Read the tests**: the name of the test case and its \`expect\`/\`assert\` state the rule. Several test cases that
     check the same thing with different data are a single specification with several tests.
   - **Read the code that has no test**: validations, guards and conditions along the flow of each endpoint
     (\`flowbrain flow "<METHOD /route>"\`) and on each screen (\`flowbrain screen <route>\`): permissions, limits,
     states, error messages. Those are the specifications without a test.

3. **Write them** in the frontmatter of \`.flowbrain/<brain>/product/<feat>.md\`:

   \`\`\`yaml
   especificaciones:
     - id: expired-card               # short, unique within the feature; do not change it afterwards
       texto: You cannot pay with an expired card.
       tipo: negocio                  # negocio | producto
       archivos:                      # where it is fulfilled; with #Ln if you know the line
         - repo-shop:src/payments/validate-card.ts#L18
       tests:                         # "repo:path::test case name", or "repo:path" for the whole file
         - repo-shop:tests/payments/validate-card.test.ts::rejects an expired card
       estado: propuesta
   \`\`\`

   The test case name goes exactly as \`flowbrain specs <feat>\` lists it (without the \`(L12)\`). Between 3 and 15
   per feature is usually enough: the rules someone from product would recognize, not one per \`if\`.

   And the use cases, on the same page:

   \`\`\`yaml
   casos:
     - id: pay-order                  # the same id in the front and in the API that serves it
       nombre: Pay for an order by card
       quien: Customer with an open order
       especificaciones: [expired-card, cart-intact-on-failure]
   \`\`\`

   The name starts with a verb and says what the person achieves. If there already are specifications without a use
   case (\`especificacionesSinCaso\` in \`flowbrain specs <feat>\`), group them into use cases without changing their
   text.

4. **Compile and review.** \`flowbrain compile --brain <brain>\` (if it does not compile, the error says
   which line to fix). Then \`flowbrain specs <feat> --brain <brain>\`: each use case comes with its \`estado\`
   (\`cumplido\`, \`sin_test\`, \`sin_codigo\`) and no \`especificacionesSinCaso\` must be left. \`rotos\` are references the
   index did not find (misspelled path, test case with another name): fix them. Review the \`casosSinEspecificacion\`
   that are left: is a specification missing, or does the test case check a technical detail that is not a
   requirement?

5. **Report to the user**, briefly: per feature, how many use cases ended up fulfilled and which ones have no test
   (and which are the riskiest to leave that way), what you fixed of what was flagged as wrong, and the open
   questions. They review it in the viewer, on the Specifications screen, and flag with the "this is wrong" button
   whatever does not add up for them.
`;

export const NOMBRE_TESTS = "flowbrain-tests";

/**
 * La guía `/flowbrain-tests` (resolver reglas con un test o con un informe) vive en core: el visor la lleva en el `.md`
 * que se descarga de «Tests pedidos». Es lo que imprime `flowbrain specs --guide-tests` y lo que sigue el agente del visor.
 */
export { GUIA_TESTS } from "@flowbrain/core";

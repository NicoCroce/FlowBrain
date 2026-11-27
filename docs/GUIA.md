# ¿Qué entiende la IA sobre mi proyecto?

[English](GUIDE.md) · **Español**

Un agente de código que abre tu repositorio tiene que *adivinar* cómo funciona el producto: qué funcionalidades hay, qué pantallas las forman, qué endpoints llaman, qué tablas tocan, qué reglas cumplen. Adivina de nuevo en cada sesión, nunca te dice qué adivinó, y cuando se equivoca te enterás cuando algo se rompe.

FlowBrain convierte esa adivinanza en algo que podés **ver, controlar y corregir**. Lo que el agente entendió de tu proyecto queda escrito como un grafo de conocimiento, cada dato apunta a la línea de código de donde salió (`repo:ruta#Ln`) y lo revisás en un visor. Lo que confirmás queda confirmado; lo que corregís queda corregido. Desde ahí, el agente responde desde ese grafo verificado en lugar de volver a adivinar.

Esa es la potencia de la herramienta: **analizar qué entendió la IA, verificar si es correcto y volverla más determinística cada vez.**

## El ciclo

```
  Analizar ──► Ver ──► Verificar ──► Corregir ──► Analizar de nuevo (solo lo que cambió)
     ▲                                                   │
     └────────────── respuestas determinísticas ◄────────┘
```

1. **Analizar.** Los parsers leen el código (TypeScript/JavaScript, PHP, OpenAPI, esquemas de base de datos, infraestructura). Lo que un parser no entiende lo completa tu agente escribiendo *extractores*: programas chicos, propios del proyecto, que FlowBrain vuelve a correr en cada indexación y verifica dato por dato.
2. **Ver.** El visor muestra lo que se entendió: funcionalidades, pantallas, contratos entre servicios, reglas de negocio, impacto de un cambio y qué tan entendido quedó cada archivo (de 0 a 100).
3. **Verificar.** Lo recorrés y decidís: ¿esto está bien? Cada pantalla dice qué sigue incierto y por qué.
4. **Corregir.** Las correcciones se guardan como archivos dentro de `.flowbrain/` (versionables, revisables en un PR). Una regla se puede fijar con un test.
5. **Responder siempre igual.** Ninguna consulta llama a un LLM. El agente (por el servidor MCP) y vos (por la CLI o el visor) reciben la misma respuesta, con la misma evidencia, cada vez.

## Por dónde empezar: escribí `flowbrain`

En la carpeta del proyecto, o en cualquiera de sus subrepositorios:

```bash
flowbrain
```

- **La primera vez:** arranca un asistente que hace todo en orden. Prepara la máquina, te muestra los repositorios que encontró (con su tecnología) para que elijas cuáles entran y cómo se agrupan en *cerebros* (uno por repo o uno para todo), los indexa, conecta el servidor MCP y ofrece el análisis completo con el agente que elijas (Claude Code, Codex, OpenCode u otro: te da el pedido para pegarlo). Si lo cortás a mitad, la próxima vez sigue desde el primer paso pendiente.
- **Ya configurado:** un menú en la terminal (flechas y Enter, o el número de la opción) con lo que se puede hacer ahí:

| Opción | Qué hace |
|---|---|
| Configurar / actualizar este proyecto | Detecta los subrepositorios, arma los cerebros e indexa todo. |
| Analizar el proyecto completo | Corre el análisis completo con el agente que elijas: estudia cada repo, la comunicación entre servicios, las funcionalidades y sus especificaciones. |
| Reindexar | Vuelve a correr parsers y extractores y regenera el visor. |
| Abrir el visor | Lo sirve en `http://127.0.0.1:4780` para ver y corregir lo que se entendió. |
| Ver estado | Repos al día, conteos y huecos conocidos de cada cerebro. |
| Conectar un agente (MCP) | Registra el servidor MCP en Claude Code, Codex u otro cliente. |
| Actualizar FlowBrain | Instala la última versión y vuelve a registrar el MCP con ella. La cabecera del menú avisa cuando hay una nueva. |

Cada opción corre los mismos comandos que se pueden escribir a mano (`flowbrain --help` los lista todos). El menú, la ayuda y los archivos que crea FlowBrain están en inglés; el castellano está disponible como segundo idioma.

## Las preguntas que podés hacer

Cada pregunta tiene respuesta en el visor (para vos), en el servidor MCP (para tu agente) y en la CLI.

| Pregunta | En el visor | Herramienta MCP | CLI |
|---|---|---|---|
| **¿Qué entiende la IA sobre mi proyecto?** | *Funcionalidades* (el producto, como lo ve la IA) y *Fidelidad* (qué tan entendido quedó cada archivo) | `funcionalidad`, `fidelidad` | `flowbrain feature`, `flowbrain fidelity` |
| ¿Qué funcionalidades cree que tiene el producto? ¿Está bien la lista? | *Funcionalidades*: una tarjeta por funcionalidad, con su código, tablas, endpoints y tests | `funcionalidad` | `flowbrain feature <id>` |
| ¿Qué **no** entendió? | *Fidelidad* (dónde se corta la cadena y qué hacer) y *Sin asociar* (archivos que no son de ninguna funcionalidad) | `fidelidad`, `sin_asociar` | `flowbrain fidelity --plan`, `flowbrain unassigned` |
| ¿Qué reglas de negocio cree que cumple el producto? ¿Son ciertas? | *Especificaciones*: cada caso de uso con sus reglas, el archivo que cumple cada una y el test que la verifica | `especificaciones` | `flowbrain specs [funcionalidad]` |
| ¿Cómo funciona esta pantalla de punta a punta? | *Pantallas*: de dónde se llega, qué la envuelve, qué llama en el back | `pantalla` | `flowbrain screen </ruta>` |
| ¿Qué servicios se hablan? ¿Hay alguna llamada rota? | *Contratos*: llamadas que nadie atiende, endpoints que nadie llama, campos que no coinciden | `deriva`, `contrato_de` | `flowbrain drift`, `flowbrain contract` |
| ¿Qué se rompe si cambio esto? | *Impacto*: todo lo que depende de una pieza, directa o indirectamente, entre cerebros | `impacto`, `quien_llama` | `flowbrain impact <pieza>` |
| ¿Qué tan riesgoso es este diff? | — | `riesgo` | `git diff \| flowbrain risk --diff -` |
| ¿Cómo se conecta todo? | *Mapa 3D* | `recorrer_grafo`, `buscar_nodo` | `flowbrain traverse`, `flowbrain search` |

## Cómo verificar, pantalla por pantalla

- **Funcionalidades.** Leé cada tarjeta: ¿el nombre es el que usa tu equipo? ¿La descripción es lo que hace? ¿Tiene el código correcto? Arriba se cuentan las que no tienen descripción o tests, para saber por dónde empezar.
- **Fidelidad.** Cada archivo tiene un puntaje de 0 a 100: cuánto de él quedó unido al grafo (llamadas, pedidos HTTP, tablas, recorridos de endpoints, tipos de respuesta, pantallas). Cada fila muestra la cadena: qué eslabón se entendió, dónde se corta y qué no aplica. Debajo, qué falta y quién lo resuelve: *vos* (una decisión que solo puede tomar una persona, se guarda desde el visor) o *el agente* (copiás el plan y lo pegás).
- **Especificaciones.** Cada caso de uso está escrito con reglas en llano (de negocio y de pantalla), cada una con el archivo que la cumple y el test que la verifica. Si algo no es lo que hace el producto, marcalo *«Esto está mal»* con un comentario: el agente lo corrige. Si una regla no tiene test, *pedí el test*: el agente lo escribe, lo corre y vuelve con uno de cuatro resultados (verificada, faltaba el test, la regla está mal o el código no la cumple, que va a desarrollo). FlowBrain nunca cambia el código de producción.
- **Sin asociar.** Archivos que no son de ninguna funcionalidad, por carpeta, cada uno con la funcionalidad recomendada, el motivo y su confianza (alta: endpoints o imports directos con una ganadora clara; baja: solo vecinos de carpeta o casi un empate; media: el resto). Se filtra por confianza. Con `flowbrain viewer --serve`, un clic asocia un archivo, «Aceptar las de confianza alta» las asocia en lote después de confirmar cuántas y «Ver código» muestra el archivo. «Mandar al agente» le pasa la lista filtrada (hasta 80) a tu agente, con permisos acotados a las páginas del cerebro y a `_drafts/`, muestra el avance, se cancela y al terminar recarga la lista; en la página estática el pedido se copia. El código compartido se asocia a una librería (`lib`) o se pide «Crear librería»; lo que no tiene pista se pide como «Proponer funcionalidad nueva» (borrador en `_drafts/product/`) o se marca «No es de producto» (archivo o carpeta, con su motivo, en `not-product.yaml`), que deja de listarse y se deshace desde «Marcados como no de producto».
- **Contratos.** Lo que un servicio llama y nadie atiende, y lo que se atiende y nadie llama: integraciones rotas y endpoints que se pueden borrar. También, cuánto avanzó una migración de un servicio a otro.
- **Impacto.** Elegí una pieza y mirá todo lo que depende de ella. Sirve para planificar un cambio, revisar un PR o estimar el riesgo antes de tocar algo compartido.

Cada lista vacía o recortada dice por qué y ofrece el siguiente paso: una pantalla vacía nunca es un error mudo.

## Por qué se vuelve más determinística

- **Evidencia, no opiniones.** Cada dato cita `repo:ruta#Ln`. Si la línea se mueve o desaparece, el dato queda marcado.
- **Extractores, no respuestas sueltas.** Lo que el agente aprendió de tu proyecto es código (`.flowbrain/<cerebro>/extractors/`) que corre en cada indexación, con controles (`checks.yaml`) que tienen que seguir cumpliéndose.
- **Las correcciones son archivos.** Lo que confirmás o corregís en el visor se escribe en `.flowbrain/`, se revisa en un PR como cualquier cambio y sobrevive a la reindexación.
- **Reglas fijadas con tests.** Una regla con test deja de ser una interpretación: si el código deja de cumplirla, el test lo dice.
- **Ningún LLM en las consultas.** El servidor MCP, la CLI y el visor leen el mismo grafo. El agente deja de recorrer tu repositorio con grep y abre el archivo justo que necesita.

Cuanto más verificás, menos tiene que adivinar el agente.

## Para seguir

- [README](../README.es.md): qué responde FlowBrain y cómo está hecho.
- [CONTEXTO.md](CONTEXTO.md): cuánto contexto usa y cómo acompaña el desarrollo.
- [INSTALACION.md](INSTALACION.md): instalación, configuración a mano y CI.
- [SCHEMA.md](../SCHEMA.md): el contrato del grafo.
- [PARSERS.md](PARSERS.md): cómo sumar un parser.

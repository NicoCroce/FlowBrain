/**
 * Guía para que un modelo escriba los tests que faltan para las especificaciones de FlowBrain. Es el texto del comando
 * `/flowbrain-tests` (lo escribe `flowbrain install`), lo que imprime `flowbrain specs --guide-tests` y la guía que
 * sigue el agente cuando el visor le manda un pedido. A diferencia de `/flowbrain-specs`, esta sí escribe en los repos
 * del proyecto, pero solo archivos de test: el código del producto no se toca y cada regla termina en uno de cuatro
 * resultados (a, b, c, d). Vive en core porque el visor la lleva en el `.md` que se descarga.
 */
export const GUIA_TESTS = `---
description: Resuelve cada regla de FlowBrain: la verifica con un test, o informa por qué no se puede
---

Vas a resolver reglas de FlowBrain que hoy no tienen ningún test. Cada regla está en la página de su funcionalidad
(\`.flowbrain/<cerebro>/product/<feat>.md\`, en \`especificaciones\`) con el texto en llano y el archivo que la cumple.
Hace falta un agente con acceso al repo (leer el código y correr los tests): un chat web no sirve.

$ARGUMENTS

## Reglas

- **Nunca modificás el código del producto.** Ni para arreglarlo, ni para "hacerlo testeable". Solo creás o ampliás
  archivos de test en los repos del proyecto, con la herramienta y el estilo que ya usa cada repo.
- **Nunca queda un test que falla en el repo.** Un test rojo rompe la integración continua. Si para mostrar que el
  código no cumple la regla escribiste un test que falla, ese test va dentro del informe (resultado c) y se borra del repo.
- **No abras archivos de entorno reales** (\`.env\` y parecidos) ni uses servicios externos reales: lo que haga falta se
  simula con lo que ya usan los tests del repo.
- **Nada de commits ni push.** Los cambios quedan en cada repo para que la persona los revise.
- **Un test por regla**, con un nombre que diga la regla en el idioma de los tests del repo.
- **No toques** \`texto\`, \`tipo\`, \`estado\` ni \`manual\` de las reglas.

## Los cuatro resultados

Cada regla termina en uno, y solo uno, de estos:

- **a. Verificada con un test nuevo**, escrito sobre el código que ya existe, que pasa.
- **b. Ya tenía un test que la cubre.** Se anota ese test; no escribís nada.
- **c. El código no cumple la regla.** No tocás el código ni dejás un test fallando en el repo. Armás un informe con:
  qué dice la regla; qué hace hoy el código (\`archivo#Ln\`); qué habría que cambiar, en palabras; y el test que lo
  demuestra, dentro del informe (no en el repo). Antes de dar c, descartá que la regla esté mal escrita: si el código
  tiene sentido y la regla es la dudosa, el informe lo dice, porque lo decide una persona.
- **d. No se puede testear sin tocar código.** El informe dice cuál sería el ajuste mínimo (por ejemplo: exportar una
  función, inyectar un reloj) y por qué hace falta.

## Pasos

1. **Qué falta.** Si el pedido trae reglas, son esas. Si no: \`flowbrain specs --untested --brain <cerebro>\` lista las
   funcionalidades con reglas sin test, y \`flowbrain specs <feat> --untested --brain <cerebro>\` cada regla con su
   archivo. Las de \`negocio\` primero. \`flowbrain brains\` dice la carpeta de cada repo.

2. **Cómo testea el repo.** Antes de escribir, mirá cómo lo hace ese repo: el \`package.json\` (\`vitest\`, \`jest\`), el
   \`composer.json\` o \`phpunit.xml\` (PHPUnit), el \`pyproject.toml\` (pytest), y dos o tres tests existentes cerca del
   archivo que cumple la regla. Copiá su estilo: dónde van los archivos, cómo se llaman, qué se simula y con qué. Si el
   repo tiene la herramienta pero ningún test, seguí la convención de la herramienta (\`*.test.tsx\` junto al archivo).

3. **Una regla por vez.** Primero buscá si ya hay un test que la cubra (b). Si no, leé el archivo que la cumple (con
   \`flowbrain flow\` o \`flowbrain screen\` si hace falta el recorrido) y escribí el test sobre el código tal como está.
   Corré solo ese archivo de test con el comando del repo.
   - Pasa: resultado a.
   - Falla por cómo está escrito el test: corregí el test.
   - Falla porque el código no hace lo que dice la regla: resultado c. Guardá el test para el informe y borralo del repo.
   - No hay forma de testearla sin cambiar el código: resultado d.

4. **Responder.** Cerrá con un bloque \`flowbrain-resultados\` que tenga una entrada por regla, con \`cerebro\`,
   \`funcionalidad\` (el id local, \`feat-…\`) y \`regla\` tal cual figuran en el pedido:

   \`\`\`flowbrain-resultados
   [
     { "cerebro": "web", "funcionalidad": "feat-pagos", "regla": "rechaza-tarjeta-vencida", "resultado": "a",
       "tests": ["repo-tienda:src/pagos/validar-tarjeta.test.ts::rechaza una tarjeta vencida"] },
     { "cerebro": "web", "funcionalidad": "feat-pagos", "regla": "reintenta-cobro", "resultado": "b",
       "tests": ["repo-tienda:src/pagos/cobro.test.ts::reintenta hasta tres veces"] },
     { "cerebro": "web", "funcionalidad": "feat-pagos", "regla": "descuento-maximo", "resultado": "c",
       "hoy": "src/pagos/descuento.ts#L40: acepta hasta 100% de descuento",
       "cambio": "Limitar el descuento al 50% que dice la regla.",
       "test": "it('rechaza más de 50%', () => { expect(() => descontar(100, 60)).toThrow() })" },
     { "cerebro": "web", "funcionalidad": "feat-pagos", "regla": "cobra-en-hora-local", "resultado": "d",
       "ajuste": "Recibir la hora por parámetro en cobrar(): hoy usa new Date() adentro." }
   ]
   \`\`\`

   Los tests de a y b van como \`repo:ruta::nombre del caso\`, con el nombre tal cual.

5. **Anotar.** Si te pidieron las reglas desde el visor, el servidor anota lo que respondiste: no edites las páginas ni
   compiles. Si trabajás por tu cuenta (por ejemplo, desde un \`.md\` que te pasaron), anotalo vos:
   - a y b: sumá cada test a \`tests\` de la regla.
   - c y d: agregá \`hallazgo\` a la regla, con \`resultado: codigo_no_cumple\` o \`no_testeable\`, \`hoy\` (solo c), \`cambio\`
     (qué cambiar; en d, el ajuste mínimo) y \`test\` (solo c, entre comillas de bloque \`|\`).

   Después \`flowbrain compile\` dentro de \`.flowbrain/<cerebro>/\` y \`flowbrain specs <feat> --brain <cerebro>\`: las
   reglas con a o b ya no tienen \`sinTest\` y sus tests no aparecen en \`rotos\` (si aparecen, el nombre o la ruta no
   coinciden). Los hallazgos se ven con \`flowbrain specs --findings\`.

6. **Informar**, corto: cuántas reglas terminaron en cada resultado, los archivos de test que escribiste, y que los
   cambios en los repos quedaron sin commitear para revisar.
`;

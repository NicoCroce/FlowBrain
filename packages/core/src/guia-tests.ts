/**
 * Guía para que un modelo escriba los tests que faltan para las especificaciones de FlowBrain. Es el texto del comando
 * `/flowbrain-tests` (lo escribe `flowbrain install`), lo que imprime `flowbrain specs --guide-tests` y la guía que
 * sigue el agente cuando el visor le manda un pedido. A diferencia de `/flowbrain-specs`, esta sí escribe en los repos
 * del proyecto, pero solo archivos de test: el código del producto no se toca y cada regla termina en uno de cuatro
 * resultados (a, b, c, d). Vive en core porque el visor la lleva en el `.md` que se descarga.
 */
export const GUIA_TESTS = `---
description: Resolves each FlowBrain rule: verifies it with a test, or reports why it can't
---

You are going to resolve FlowBrain rules that have no test today. Each rule lives in the page of its feature
(\`.flowbrain/<brain>/product/<feat>.md\`, under \`especificaciones\`) with its plain-language text and the file that satisfies it.
This needs an agent with access to the repo (read the code and run the tests): a web chat won't do.

$ARGUMENTS

## Rules

- **Never modify the product code.** Not to fix it, not to "make it testable". You only create or extend
  test files in the project repos, with the tool and style each repo already uses.
- **Never leave a failing test in the repo.** A red test breaks continuous integration. If you wrote a failing test to show
  that the code does not satisfy the rule, that test goes inside the report (outcome c) and is deleted from the repo.
- **Do not open real environment files** (\`.env\` and the like) or use real external services: whatever is needed is
  mocked with what the repo's tests already use.
- **No commits or pushes.** The changes stay in each repo for the person to review.
- **One test per rule**, with a name that states the rule in the language of the repo's tests.
- **Do not touch** \`texto\`, \`tipo\`, \`estado\` or \`manual\` of the rules.

## The four outcomes

Each rule ends in one, and only one, of these:

- **a. Verified with a new test**, written against the existing code, that passes.
- **b. It already had a test covering it.** Record that test; you write nothing.
- **c. The code does not satisfy the rule.** You don't touch the code or leave a failing test in the repo. Write a report with:
  what the rule says; what the code does today (\`file#Ln\`); what would have to change, in words; and the test that
  proves it, inside the report (not in the repo). Before giving c, rule out that the rule is badly written: if the code
  makes sense and the rule is the doubtful one, the report says so, because a person decides.
- **d. It cannot be tested without touching code.** The report says what the minimal adjustment would be (for example: export a
  function, inject a clock) and why it is needed.

## Steps

1. **What is missing.** If the request includes rules, those are the ones. Otherwise: \`flowbrain specs --untested --brain <brain>\` lists the
   features with untested rules, and \`flowbrain specs <feat> --untested --brain <brain>\` each rule with its
   file. \`negocio\` (business) rules first. \`flowbrain brains\` gives the folder of each repo.

2. **How the repo tests.** Before writing, look at how that repo does it: the \`package.json\` (\`vitest\`, \`jest\`), the
   \`composer.json\` or \`phpunit.xml\` (PHPUnit), the \`pyproject.toml\` (pytest), and two or three existing tests near the
   file that satisfies the rule. Copy their style: where the files go, how they are named, what is mocked and with what. If the
   repo has the tool but no tests, follow the tool's convention (\`*.test.tsx\` next to the file).

3. **One rule at a time.** First look for an existing test that covers it (b). If there is none, read the file that satisfies it (with
   \`flowbrain flow\` or \`flowbrain screen\` if you need the flow) and write the test against the code as it is.
   Run only that test file with the repo's command.
   - It passes: outcome a.
   - It fails because of how the test is written: fix the test.
   - It fails because the code does not do what the rule says: outcome c. Keep the test for the report and delete it from the repo.
   - There is no way to test it without changing the code: outcome d.

4. **Answer.** Finish with a \`flowbrain-resultados\` block with one entry per rule, with \`cerebro\`,
   \`funcionalidad\` (the local id, \`feat-…\`) and \`regla\` exactly as they appear in the request:

   \`\`\`flowbrain-resultados
   [
     { "cerebro": "web", "funcionalidad": "feat-payments", "regla": "rejects-expired-card", "resultado": "a",
       "tests": ["repo-shop:src/payments/validate-card.test.ts::rejects an expired card"] },
     { "cerebro": "web", "funcionalidad": "feat-payments", "regla": "retries-charge", "resultado": "b",
       "tests": ["repo-shop:src/payments/charge.test.ts::retries up to three times"] },
     { "cerebro": "web", "funcionalidad": "feat-payments", "regla": "maximum-discount", "resultado": "c",
       "hoy": "src/payments/discount.ts#L40: accepts up to 100% discount",
       "cambio": "Cap the discount at the 50% the rule states.",
       "test": "it('rejects more than 50%', () => { expect(() => discount(100, 60)).toThrow() })" },
     { "cerebro": "web", "funcionalidad": "feat-payments", "regla": "charges-in-local-time", "resultado": "d",
       "ajuste": "Take the time as a parameter in charge(): today it uses new Date() inside." }
   ]
   \`\`\`

   The tests of a and b go as \`repo:path::test case name\`, with the name verbatim.

5. **Record.** If the rules were requested from the viewer, the server records what you answered: don't edit the pages or
   compile. If you work on your own (for example, from a \`.md\` you were given), record it yourself:
   - a and b: add each test to the rule's \`tests\`.
   - c and d: add \`hallazgo\` to the rule, with \`resultado: codigo_no_cumple\` or \`no_testeable\`, \`hoy\` (c only), \`cambio\`
     (what to change; in d, the minimal adjustment) and \`test\` (c only, as a \`|\` block scalar).

   Then \`flowbrain compile\` inside \`.flowbrain/<brain>/\` and \`flowbrain specs <feat> --brain <brain>\`: the
   rules with a or b no longer have \`sinTest\` and their tests don't appear in \`rotos\` (if they do, the name or the path don't
   match). Findings are shown with \`flowbrain specs --findings\`.

6. **Report**, briefly: how many rules ended in each outcome, the test files you wrote, and that the
   changes in the repos were left uncommitted for review.
`;

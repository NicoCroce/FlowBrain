# What does the AI understand about my project?

**English** · [Español](GUIA.md)

A coding agent that opens your repository has to *guess* how your product works: which features exist, which screens make them up, which endpoints they call, which tables they touch, which rules they enforce. It guesses again every session, it never tells you what it guessed, and when it guesses wrong you only find out when something breaks.

FlowBrain turns that guess into something you can **see, check and correct**. The agent's understanding of your project is written down as a knowledge graph, every fact points to the line of code it came from (`repo:path#Ln`), and you review it in a viewer. What you confirm stays confirmed; what you correct stays corrected. From then on, the agent answers from that verified graph instead of guessing again.

That is the whole point of the tool: **analyze what the AI understood, verify whether it is right, and make it more deterministic every time.**

## The loop

```
  Analyze ──► See ──► Verify ──► Correct ──► Analyze again (only what changed)
     ▲                                              │
     └──────────── deterministic answers ◄──────────┘
```

1. **Analyze.** Parsers read the code (TypeScript/JavaScript, PHP, OpenAPI, database schemas, infrastructure). Whatever a parser does not understand, your agent completes by writing *extractors*: small, project-specific programs that FlowBrain re-runs on every index and checks fact by fact.
2. **See.** The viewer shows what was understood: features, screens, contracts between services, business rules, impact of a change, and how well each file is understood (0 to 100).
3. **Verify.** You go through it and decide: is this right? Each screen tells you what is still uncertain and why.
4. **Correct.** Corrections are saved as plain files inside `.flowbrain/` (versionable, reviewable in a PR). Rules can be locked in by a test.
5. **Answer deterministically.** No query calls an LLM. The agent (through the MCP server) and you (through the CLI or the viewer) get the same answer, with the same evidence, every time.

## Start here: type `flowbrain`

In your project folder, or in any of its sub-repositories:

```bash
flowbrain
```

- **First time:** a setup assistant runs everything in order. It prepares the machine, shows the repositories it found (with their technology) so you choose which ones go in and how they are grouped into *brains* (one per repo, or one for everything), indexes them, connects the MCP server and offers the full analysis with the agent you pick (Claude Code, Codex, OpenCode or any other: it gives you the prompt to paste). If you stop halfway, next time it resumes from the first pending step.
- **Already set up:** an interactive menu (arrow keys and Enter, or the option number) with what you can do there:

| Option | What it does |
|---|---|
| Set up / update this project | Detects the sub-repositories, builds the brains and indexes everything. |
| Analyze the whole project | Runs the full analysis with the agent you choose: study each repo, the communication between services, the features and their specifications. |
| Re-index | Runs parsers and extractors again and regenerates the viewer. |
| Open the viewer | Serves it on `http://127.0.0.1:4780` to see and correct what was understood. |
| See status | Repositories up to date, counts and known gaps of each brain. |
| Connect an agent (MCP) | Registers the MCP server in Claude Code, Codex or another client. |
| Update FlowBrain | Installs the latest version and registers the MCP again with it. The menu header tells you when there is a new one. |

Every option runs the same commands you can type by hand (`flowbrain --help` lists them all). The menu, the help and the files FlowBrain creates are in English; Spanish is available as a second language.

## The questions you can ask

Each question has an answer in the viewer (for you), in the MCP server (for your agent) and in the CLI.

| Question | In the viewer | MCP tool | CLI |
|---|---|---|---|
| **What does the AI understand about my project?** | *Features* (the product, as the AI sees it) and *Fidelity* (how well each file is understood) | `funcionalidad`, `fidelidad` | `flowbrain feature`, `flowbrain fidelity` |
| Which features does it think the product has? Is the list right? | *Features*: one card per feature, with its code, tables, endpoints and tests | `funcionalidad` | `flowbrain feature <id>` |
| What did it **not** understand? | *Fidelity* (where the chain breaks, and what to do) and *Unassigned* (files that belong to no feature) | `fidelidad`, `sin_asociar` | `flowbrain fidelity --plan`, `flowbrain unassigned` |
| Which business rules does it think the product enforces? Are they true? | *Specifications*: each use case with its rules, the file that implements each one and the test that verifies it | `especificaciones` | `flowbrain specs [feature]` |
| How does this screen work, end to end? | *Screens*: where you arrive from, what wraps it, what it calls in the back end | `pantalla` | `flowbrain screen </route>` |
| Which services talk to each other? Is any call broken? | *Contracts*: calls nobody serves, endpoints nobody calls, fields that do not match | `deriva`, `contrato_de` | `flowbrain drift`, `flowbrain contract` |
| What breaks if I change this? | *Impact*: everything that depends on a piece, directly or indirectly, across brains | `impacto`, `quien_llama` | `flowbrain impact <piece>` |
| How risky is this diff? | — | `riesgo` | `git diff \| flowbrain risk --diff -` |
| How is everything connected? | *3D Map* | `recorrer_grafo`, `buscar_nodo` | `flowbrain traverse`, `flowbrain search` |

## How to verify, screen by screen

- **Features.** Read each card: is the name the one your team uses? Is the description what the feature does? Does it own the right code? Features without a description or without tests are counted at the top, so you know where to start.
- **Fidelity.** Every file gets a score from 0 to 100: how much of it is joined to the graph (calls, HTTP requests, tables, endpoint flows, response types, screens). Each row shows the chain: which link was understood, where it breaks and what does not apply. Below, what is missing and who solves it: *you* (a decision only a person can make, saved from the viewer) or *the agent* (copy the plan and paste it).
- **Specifications.** Each use case is written as plain-language rules (business rules and screen rules), each with the file that implements it and the test that verifies it. If something is not what the product does, mark it *"This is wrong"* with a comment: the agent fixes it. If a rule has no test, *request the test*: the agent writes it, runs it and comes back with one of four results (verified, the test was missing, the rule is wrong, or the code does not comply, which goes to development). FlowBrain never changes production code.
- **Unassigned.** Files that belong to no feature, grouped by folder, each with a recommended feature, the reason and its confidence (high: endpoints or direct imports with a clear winner; low: only folder neighbors or almost a tie; medium: the rest). Filter by confidence. With `flowbrain viewer --serve`, one click assigns a file, «Accept the high-confidence ones» assigns them in bulk after confirming how many, and «View code» shows the file. «Send to the agent» works like «Request all» in Specifications: you pick the provider and model and it sends the whole filtered list as a batch, in batches of up to 30 files per brain and repo, with permissions limited to the brain's pages and `_drafts/`; you see «X of N batches», «Cancel all» stops it, and when it finishes it says how many were assigned and how many remain («Reload to see the changes»). «Copy the text» carries the first 80; on the static page the request is copied. Shared code is assigned to a library (`lib`) or you ask to «Create library»; files with no hint become a «Propose new feature» request (a draft in `_drafts/product/`) or get marked «Not product» (a file or a folder, with its reason, in `not-product.yaml`), which stops listing them and is undone from «Marked as not product».
- **Contracts.** What one service calls and nobody serves, and what is served and nobody calls: broken integrations and endpoints you could delete. Also, how far a migration from one service to another has gone.
- **Impact.** Choose a piece and see everything that depends on it. Use it to plan a change, review a PR or estimate the risk before touching something shared.

Each empty or cut-down list says why and offers the next step, so an empty screen is never a silent error.

## Why it becomes more deterministic

- **Evidence, not opinions.** Every fact cites `repo:path#Ln`. If the line moves or disappears, the fact is flagged.
- **Extractors, not one-off answers.** What the agent learned about your project is code (`.flowbrain/<brain>/extractors/`) that runs on every index, with checks (`checks.yaml`) that must keep passing.
- **Corrections are files.** What you confirm or correct in the viewer is written to `.flowbrain/`, reviewed in PRs like any other change, and survives re-indexing.
- **Rules locked by tests.** A rule with a test stops being an interpretation: if the code stops complying, the test says so.
- **No LLM in the queries.** The MCP server, the CLI and the viewer read the same graph. The agent stops grepping your repository and opens the exact file it needs.

The more you verify, the less the agent has to guess.

## Learn more

- [README](../README.md): what FlowBrain answers and how it is built.
- [CONTEXT.md](CONTEXT.md): how little context it uses and how it keeps up while you develop.
- [INSTALL.md](INSTALL.md): installation, manual setup and CI.
- [SCHEMA.md](../SCHEMA.md): the graph contract.
- [PARSERS.md](PARSERS.md): how to add a parser.

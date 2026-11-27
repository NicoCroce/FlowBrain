# How much context FlowBrain uses and how it keeps up with development

**English** · [Español](CONTEXTO.md)

## The strength in one sentence

FlowBrain **never loads the project into the model's context**. The knowledge lives outside, in `.flowbrain/` (graph + compiled pages). The agent only gets small, token-budgeted answers in which every fact carries the line of code that backs it (`repo:path#Ln`). The agent reads the map first, and then only the few files that matter.

```
Without FlowBrain:  question ─► grep ─► open dozens of files ─► rebuild the flow by hand ─► answer
With FlowBrain:     question ─► graph (hundreds to a few thousand tokens) ─► 2 to 5 exact files ─► answer
```

## The three context layers

### 1. Fixed per session: rules and MCP instructions (~1–1.5k tokens)

- **Rules block** in `CLAUDE.md`, `AGENTS.md` or the Cursor/Windsurf equivalent (`flowbrain gen …`). It says which repo this is in the graph, which services live here and what they depend on (each list is cut at 8 with "+N more"), which tool to use for each question, and the rule to open the cited file before claiming anything.
- **MCP server instructions**: the map of which tool to use for each question. With several brains, one line per brain is added.

Loaded once, and it **does not grow with the size of the project**.

### 2. Automatic per question: the `UserPromptSubmit` hook (capped at 1,500 tokens)

When you type a question, the hook analyzes it with fixed rules, no AI involved:

- It detects HTTP routes (`POST /auth/login`) and file paths, and prepares up to **3 traces** (`trazar`).
- It detects exact node names (service, table, feature, repo…) and prepares up to **5 neighborhoods** (`recorrer_grafo`).
- It builds a `<flowbrain-context>` block section by section. Each section gets **only what is left of the budget**. If fewer than 80 tokens remain, the section is skipped and reported ("N sections omitted due to budget").
- If the question names nothing it recognizes, it injects nothing (or only the current repo's line).

A vague question costs almost nothing. One that names the endpoint and the table arrives with the flow and the neighbors already resolved.

### 3. On demand: MCP tools (≤2,000 tokens each by default)

The agent decides what to query (`recorrido`, `impacto`, `pantalla`, `funcionalidad`, `quien_llama`…). Each answer is bounded this way:

| Mechanism | What it does |
|---|---|
| `budget_tokens` | 2,000 by default, adjustable (`null` removes it). If the list does not fit, items are dropped from the end and the answer is marked `truncado: true, omitidos: N`: the agent knows something is missing and can ask for more or ask more precisely. |
| Projection | `resumen` (summary), `relaciones` (relations), `contrato` (contract) or `completo` (full). Only the view that is needed is requested. |
| Traversal limits | up to 12 levels and 200 steps per flow, and a maximum depth of 5 when walking the graph. Beyond that, it returns `truncado` and a notice. |
| Compact JSON | no whitespace or empty fields. The budget is measured on that same text. |
| `avisos` | mark where the graph does not know (unresolved calls, index behind the commit). That is where reading the code pays off, and only there. |

## In numbers

| Layer | When | Approximate cost |
|---|---|---|
| Rules + MCP instructions | once per session | ~1–1.5k tokens |
| Per-question hook | every message | 0 to 1.5k (cap) |
| Each MCP query | when the agent asks | ≤2k by default |
| Cited files | the agent opens them | whatever those few files weigh |

In a 7-brain project, a typical question adds about 3–8k tokens from FlowBrain plus the specific files, instead of the hundreds of thousands it would take to read the project. The count is an internal estimate (≈4 characters per token), so the caps are approximate.

**Why it is a strength:**

- **Scales**: the cost depends on the question, not on the size of the repository.
- **More accuracy**: less noise in the context means less confusion and less hallucination. Every fact has verifiable evidence.
- **Deterministic**: no query calls an LLM. The same question returns the same answer, with the same evidence.
- **Honest about what is missing**: `truncado` and `avisos` say what was left out instead of hiding it.
- **Leaves room to work**: the context window stays free for the code to be written, not for rebuilding how the system works.

## While you develop: how it stays current

**Does a new feature come in end to end?**

- **The technical side comes in by itself.** Endpoints, methods, calls, tables, screens and infrastructure are regenerated from the code. With `serve --sync`, when a repo has a new commit, the next query reindexes it and already sees the whole flow, from screen to table. Uncommitted work is not visible: the graph stays at the previous commit and answers warn that the index fell behind.
- **The product side is proposed, and you review it.** What feature it is, its business rules and its tests are not added on their own. New files show up in `sin_asociar` with a suggestion of which feature they belong to. `/flowbrain-features` and `/flowbrain-specs` produce drafts, and `flowbrain promote` confirms them.

### New code comes in by itself, at the commit

The code graph (endpoints, methods, calls, tables, screens, infrastructure) is **regenerated from the code**, not written by hand. With the MCP server in `serve --sync` mode, on every query FlowBrain compares the indexed commit with each clone's `HEAD`. If a clone moved, it reindexes and recompiles that repo before answering. The project's own extractors run again and are verified on every indexing.

When the agent adds a new feature (screen → endpoint → service → table), **after the commit** the next query already sees it end to end: `recorrido`, `pantalla`, `impacto` and `quien_llama` include it. Without `--sync`, `flowbrain sync` does the same.

Uncommitted work is not visible yet: the graph stays at the previous commit, and answers say so when the index fell behind.

### The product layer is proposed and reviewed

**Features** (what a feature is, which business rules it meets, which test verifies it) are product knowledge: they are deduced, but never silently guessed.

- New files that belong to no feature show up in `sin_asociar` (and in the viewer's *Unassigned* screen), with a suggestion of where to assign them.
- `/flowbrain-features` and `/flowbrain-specs` have the agent deduce or complete features and specifications as **drafts** in `_drafts/`.
- While it develops, the agent follows the same path on its own: a new feature's draft already carries its use cases and specifications, and when an existing feature changes it updates its specifications (new rules as unconfirmed proposals; a confirmed one the code contradicts is reported, not changed).
- `flowbrain promote` moves them into `product/` and `technology/`. If the brain stops compiling with the new pages, it undoes everything.
- `fidelidad` (fidelity) scores from 0 to 100 how well each file or feature is understood, and what is missing.

### What it costs to stay current

**Updating the code graph uses no model tokens.** Reindexing and recompiling are programs: parsers and the project's own extractors running on your machine, without calling any LLM. The cost is CPU time (in a 7-brain project, about two minutes for everything; with `--sync`, only the repos that moved). That happens **once per commit**, when the next query detects the clone moved, not while the agent is writing code.

Tokens are spent only at these moments:

| Moment | Who does it | Tokens |
|---|---|---|
| Reindexing after a commit | FlowBrain (parsers + extractors) | 0 |
| Querying the graph | the agent, over MCP or the hook | the three layers above |
| Proposing product: features, specifications, assigning unassigned files | the agent, when the rule asks or you run `/flowbrain-features` or `/flowbrain-specs` | whatever it reads and writes for those drafts |
| Promoting drafts (`flowbrain promote`) | FlowBrain | 0 |

While you develop without committing, FlowBrain spends nothing on staying current: the agent reads the code it is changing, as it would without FlowBrain, and the graph catches up by itself at the next commit.

### When the code contradicts the graph

If, while working, the agent sees that the code says something different from the graph, it writes a line `flowbrain-nota <node>: <what changed>` in its answer. The `SessionEnd` hook saves those notes in `_drafts/notes/` for you to review. **FlowBrain does not rewrite its curated knowledge on its own**: the code layer is regenerated from the code, and the product layer goes through your review. That control is what keeps it trustworthy.

### What the rules ask of the agent

The rules block (`flowbrain gen …`) and the MCP server instructions teach the agent to keep the graph current while it develops:

- **Uncommitted work is read from the code.** For files it created or changed and has not committed, it reads the code, not the graph.
- **Check who uses it before changing it.** Before touching a method, an endpoint or a table, it asks `quien_llama` or `impacto`.
- **New things are proposed, not imposed.** When it adds a feature or new files, once they are committed it checks `sin_asociar` and says which feature each file belongs to. For a new feature it proposes the page as a draft in `_drafts/product/feat-<id>.md`. It never edits `product/` or `technology/` directly: you review and promote with `flowbrain promote`.

### What about improvements to the code itself?

FlowBrain does not modify your code: it gives the agent the map to change it with less risk. Before touching something, the agent can ask `quien_llama` (who uses this method, even over HTTP, events or queues from other repos), `impacto` (which features are affected) and `riesgo` (what a diff reaches and whom to tell). The fixes or improvements are decided by the agent, or requested by you. FlowBrain makes sure they do not break something in another service without anyone noticing.

## Learn more

- [GUIDE.md](GUIDE.md): what the AI understood and how to verify it.
- [INSTALL.md](INSTALL.md): installation, `serve --sync` and CI.
- [SCHEMA.md](../SCHEMA.md): the graph contract.

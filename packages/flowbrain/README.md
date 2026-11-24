# FlowBrain

**English** · [Español](README.es.md)

> **What does the AI understand about your project?** FlowBrain puts it in plain sight so you can verify it and correct it, making every answer more deterministic. Start with the [guide](https://github.com/NicoCroce/FlowBrain/blob/main/docs/GUIDE.md).

FlowBrain builds a **knowledge graph of your system** so a coding agent (Claude Code, Codex, OpenCode or another) understands the product before touching it: which features it has, which screens make them up, which endpoints they call, which methods run, which tables they touch and **what breaks if something changes**, across different repositories and services too.

- **It reads the code, it does not guess.** Parsers read TypeScript/JavaScript (React, React Native, Vue, Svelte, Astro, Next, Nest, Express…), PHP, OpenAPI, database schemas and infrastructure (Docker, CI, Kubernetes, Helm, Terraform, serverless). Whatever a parser does not understand is completed by your agent: it studies the repo and writes *extractors* that FlowBrain checks fact by fact.
- **Deterministic.** No query calls an LLM. Every fact cites its evidence (`repo:path#Ln`), so the agent opens the exact file instead of grepping the repo.
- **For agents and for people.** MCP server, Claude Code hooks, CLI and a web viewer with a map, features, specifications and impact.

## Installation

From the project folder (the one with your repos inside, or a single repo):

```bash
npx @nicocroce/flowbrain install
```

Or installed globally, to always have the `flowbrain` command at hand:

```bash
npm i -g @nicocroce/flowbrain
flowbrain install
```

The package is called `@nicocroce/flowbrain`, but the command is `flowbrain`. Installing compiles nothing native: it runs no install scripts.

## How to use it

### 1. `flowbrain install`

- Sets up the Claude Code hooks and commands. With `npx` the `flowbrain` command does not stay on the PATH: to have it, install it globally (`npm i -g @nicocroce/flowbrain`); otherwise, run every command in this guide as `npx @nicocroce/flowbrain …`.
- Creates `.flowbrain/` in the project, shows you the repositories it found (with their technology) and asks whether there is **one brain per repo** or **a single one** for everything. Without asking: `--repos <folder>` and `--split` or `--single`.
- Indexes everything and leaves the viewer in `.flowbrain/flowbrain.html`.
- Prints the line to connect the MCP server.

Hooks and the MCP server point to a fixed version (`npx -y @nicocroce/flowbrain@<version>`), so a new release changes nothing without notice. Running `flowbrain install` again updates.

### 2. The menu

After that, in the project or in any of its sub-repos:

```bash
flowbrain
```

It opens a terminal menu: set up the project, analyze it fully with the agent you choose, re-index, open the viewer, see the status, connect the MCP server to an agent and update FlowBrain. If you stop halfway, next time it resumes from the first pending step.

### 3. The viewer on localhost

```bash
flowbrain viewer --serve
```

It serves it on `http://127.0.0.1:4780` (or the next free port). It shows the map of the system, the features, screens, contracts, specifications, impact and how well each file is understood. From there you can correct things: add a file to a feature, confirm rules, declare calls and **request tests** (see below). Everything it saves are brain files, versionable.

### 4. The MCP server in your agent

In Claude Code, for all your projects:

```bash
claude mcp add --scope user flowbrain -- npx -y @nicocroce/flowbrain@0.1.0 serve --sync
```

In Codex:

```bash
codex mcp add flowbrain -- npx -y @nicocroce/flowbrain@0.1.0 serve --sync
```

Any other MCP client (OpenCode, Cursor, etc.): the command is `npx -y @nicocroce/flowbrain@0.1.0 serve --sync` over stdio. The menu (`flowbrain` → *Connect an agent*) registers it for you in the one you pick. With `--sync` the server re-indexes the repos that moved forward before answering.

### 5. Several brains: `flowbrain.yaml`

In a project with several services (a front end, an API, a legacy back end, workers…), each one can be a brain, and `.flowbrain/flowbrain.yaml` says which ones exist and how they communicate: which base URL goes to which service. With that, queries cross from brain to brain: changing a table in one service reaches the front-end screen that, through another API, ends up writing to it.

```bash
flowbrain brains                 # brains in the registry and their state
flowbrain brains apply           # creates and indexes the missing ones
flowbrain connections            # what travels between brains
```

## MCP tools

| Tool | What for |
|---|---|
| `buscar_nodo` | Find something when you do not know its id: a class, a method, a word. |
| `recorrer_grafo` | Neighbors of a node by relationship type. |
| `funcionalidad` | What a product feature does: endpoints, screens, data and relationships. |
| `pantalla` | A front-end screen end to end: where you arrive from, where it leads, what it calls in the back end. |
| `recorrido` | What an endpoint or method runs, step by step, and what each step touches. |
| `contrato_de` | What an endpoint receives and returns, and who calls it. |
| `quien_llama` | Who calls a method or a class. |
| `impacto` | What breaks if a table, an endpoint, a service or a feature changes. |
| `riesgo` | Scope of a concrete change: a diff or some files. |
| `trazar` | Where a piece of data travels between services. |
| `deriva` | Endpoints nobody calls and calls nobody serves, field by field. |
| `paridad` | What is left to migrate from one service to another. |
| `infra` | How a service is built, deployed and configured: image, pipeline, variables, proxy, Kubernetes, Helm, Terraform, serverless. |
| `especificaciones` | What a feature must comply with (business and product rules), which file implements it and which test verifies it. |
| `sin_asociar` | Files that belong to no feature and which one each should join. |
| `fidelidad` | How reliable what the graph says about a file or a feature is, and what is left to complete. |
| `conexiones` | Which calls cross between brains (only with several brains). |

The same queries are in the CLI: `flowbrain search`, `feature`, `screen`, `flow`, `contract`, `callers`, `impact`, `risk`, `trace`, `drift`, `parity`, `infra`, `specs`, `unassigned`, `fidelity`. For example `git diff | flowbrain risk --diff -`. `flowbrain --help` lists them all.

## Claude Code commands

`install` adds these commands to Claude Code. The first time they run in order (the menu, with *Analyze the whole project*, chains them):

| Command | What it does |
|---|---|
| `/flowbrain-study` | Studies how each repo is built and writes the extractors that complete what the parsers did not see. |
| `/flowbrain-index` | Analyzes the real communication between services: which service each call goes to, with evidence. |
| `/flowbrain-features` | Deduces and completes the product features of each brain. |
| `/flowbrain-specs` | Deduces the business and product specifications of each feature. |
| `/flowbrain-tests` | Resolves each rule: verifies it with a test, or reports why it cannot be done or whether the code does not comply. |

With another agent, the same instructions come from `flowbrain coverage --guide`, `evidence --guide`, `feature --guide` and `specs --guide`.

## Requesting tests

In the viewer's Specifications screen you pick rules and request their tests in bulk: FlowBrain opens your agent per repo, with the provider and model you choose, and each rule comes back verified by a test, to decide (the rule may be wrong) or for development (the code does not comply). FlowBrain never changes production code.

## Requirements

- **Node ≥ 20.**
- **Claude Code**, optional: needed for the full analysis (`/flowbrain-*`) and to request tests from the viewer. Without it, the index, the viewer, the CLI and the MCP server work the same, and the analysis can be done with another agent by pasting the guides.

## Diagnostics

```bash
flowbrain doctor      # graph, index, clones, registered hooks and MCP (read-only)
flowbrain status      # repos up to date, counts and known gaps
```

The graph contract is in `SCHEMA.md`, inside the package. Code and issues: [github.com/NicoCroce/FlowBrain](https://github.com/NicoCroce/FlowBrain).

Apache-2.0 license.

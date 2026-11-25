# FlowBrain

**English** · [Español](README.es.md)

> **What does the AI understand about your project?** FlowBrain puts it in plain sight so you can verify it and correct it, making every answer more deterministic. Start with the [guide](docs/GUIDE.md).

A knowledge graph of a software system, built so a coding agent understands the product before touching it: which features it has, which screens make them up, which endpoints they call, which methods run, which tables they touch and **what breaks if something changes**, across different repositories and services too.

- **Technology-agnostic.** Parsers read TypeScript/JavaScript (React, React Native, Vue, Svelte, Astro, Next, Nest, Express…), PHP, OpenAPI, database schemas and infrastructure. Whatever a parser does not understand (Go, Python, Dart, Ruby, an in-house framework) is completed by a model: it studies the repo and writes project *extractors* that run on every index and that FlowBrain checks fact by fact.
- **Deterministic.** No query calls an LLM. Every fact cites its evidence (`repo:path#Ln`).
- **For agents and for people.** MCP server, Claude Code hooks, CLI and an HTML viewer with a 3D map.

## What it answers

| Question | MCP | CLI |
|---|---|---|
| What does this product feature do? | `funcionalidad` | `flowbrain feature <id>` |
| This screen, end to end | `pantalla` | `flowbrain screen </route>` |
| What an endpoint runs, step by step | `recorrido` | `flowbrain flow "POST /x"` |
| What breaks if I change this (and what it depends on) | `impacto` | `flowbrain impact <piece>` |
| How risky is this diff | `riesgo` | `git diff \| flowbrain risk --diff -` |
| Who calls this method | `quien_llama` | `flowbrain callers <Class.method>` |
| Where a piece of data travels between services | `trazar` | `flowbrain trace --from <x>` |
| What an endpoint receives and returns | `contrato_de` | `flowbrain contract <node>` |
| Calls with no endpoint and unused endpoints | `deriva` | `flowbrain drift` |
| What is left to migrate from one service to another | `paridad` | `flowbrain parity <old> <new>` |
| How it is built and deployed | `infra` | `flowbrain infra` |
| What a feature must comply with, which file implements it and which test verifies it | `especificaciones` | `flowbrain specs [feat]` |
| Which files belong to no feature, and which one each should join | `sin_asociar` | `flowbrain unassigned [folder]` |
| How well each file is understood (0 to 100), what it is missing and a plan to reach 100 | `fidelidad` | `flowbrain fidelity [--plan]` |
| Which calls cross between brains | `conexiones` | `flowbrain connections` |
| Find a node / walk the graph | `buscar_nodo`, `recorrer_grafo` | `flowbrain search`, `flowbrain traverse` |

Impact follows the direction of the relationships (a table → the methods and endpoints that use it → the screens and features that call them) and crosses from brain to brain up to four hops: changing a table in a Go service reaches the Vue front-end screen that, through a Python API, ends up writing to it.

## Installation

With the published package, from the project folder:

```bash
npx @nicocroce/flowbrain install
```

From source, it needs Node ≥ 20, pnpm and a coding agent that can run commands (Claude Code, Codex, OpenCode or another): FlowBrain does not ship or pick a model, the analysis is done by the one you use.

```bash
git clone <this-repo> flowbrain && cd flowbrain
pnpm install
cd /path/to/project
pnpm -s -C /path/to/flowbrain flowbrain install "$PWD"
```

`install` puts the `flowbrain` command on the PATH, the Claude Code hooks and the `/flowbrain-study`, `/flowbrain-index`, `/flowbrain-features` and `/flowbrain-specs` commands; it creates `.flowbrain/` in the project, asks where the repositories are and whether there is one brain per repo or a single one, indexes everything and leaves the viewer in `.flowbrain/flowbrain.html`. At the end it prints the MCP server line:

```bash
claude mcp add --scope user flowbrain -- flowbrain serve --sync
```

### The menu

After that, in any project (or in any of its sub-repos), just type:

```bash
flowbrain
```

In a project that is not set up yet, an assistant does everything in order: it prepares the machine, shows you the sub-repositories it found (with their technology) so you choose which ones go in and how they are grouped, indexes, connects the MCP server and offers the full analysis with the agent you choose (Claude Code, Codex, OpenCode or another: it gives you the prompt to paste). If you stop it, next time it resumes from the first pending step. Once set up, it opens a terminal menu (arrow keys and Enter, or the number) with what you can do there: set up the project (it detects the sub-repositories and builds the brains), analyze it fully with the agent you choose, re-index, open the viewer, see the status, connect the MCP server to an agent and update FlowBrain. The options depend on the state: without `.flowbrain/`, the first thing is to set it up. Each option runs the same commands you can type by hand. See the [guide](docs/GUIDE.md) for what each one is for.

Running `flowbrain install` again updates it. Full details, manual installation and CI in [docs/INSTALL.md](docs/INSTALL.md).

## How a project gets completed

With Claude Code open in the project folder (with another agent, the menu gives a single prompt that goes through the same steps with `flowbrain coverage --guide`, `evidence --guide` and `feature --guide`):

1. **`/flowbrain-study`**: the model studies how each repo is built, writes `profile.md`, extractors in `.flowbrain/<brain>/extractors/<repo-id>/` for what the parsers do not see, and checks (`checks.yaml`) that must keep passing. `flowbrain coverage` measures the progress.
2. **`/flowbrain-index`**: decides which service each call between repos goes to (by base URL, configuration and infrastructure) and declares it with evidence.
3. **`/flowbrain-features`**: deduces the product features, explains them and links them to their screens, endpoints and tables.
4. **`/flowbrain-specs`**: deduces from tests and code the specifications of each feature (business and product requirements), with the file that implements them and the case that verifies them; they stay as proposals until a person confirms them.
5. **`flowbrain brains viewer`**: regenerates the viewer. With **`flowbrain viewer --serve`** it opens on `http://127.0.0.1:4780`: the Fidelity screen lets you fix what each file is missing, the Specifications screen lets you confirm each requirement and the Unassigned screen lets you add each loose file to its feature (it only writes inside `.flowbrain/`).

Everything the model writes stays in `.flowbrain/`, readable and versionable next to the project; derived output (`_build/`, the viewer) stays out of git.

## Structure

| Package | What it does |
|---|---|
| `packages/core` | Schema, compiling pages into `graph.json`, queries, impact and crossings between brains |
| `packages/parsers` | Parsers (TypeScript, PHP, OpenAPI, schema, infra), project extractors and indexer |
| `packages/indexer` | Page drafts from the code |
| `packages/mcp` | MCP server |
| `packages/hooks` | Claude Code hooks (context on every prompt, notes when the session closes) |
| `packages/viewer` | HTML viewer: catalog, screens, traces, specifications, unassigned, impact, contracts (drift and parity), fidelity and 3D map |
| `packages/cli` | The `flowbrain` command and the command guides for the model |
| `packages/flowbrain` | Publishable npm package (a single file bundled with esbuild) |

Documentation: [docs/GUIDE.md](docs/GUIDE.md) (what the AI understood and how to verify it), [docs/CONTEXT.md](docs/CONTEXT.md) (how little context it uses and how it keeps up while you develop), [SCHEMA.md](SCHEMA.md) (graph contract), [docs/PARSERS.md](docs/PARSERS.md) (how to add a parser), [docs/DECISIONS.md](docs/DECISIONS.md) (every decision, with date and reason, in Spanish), [docs/PRD.es.md](docs/PRD.es.md) (in Spanish).

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build          # packages/flowbrain/dist/flowbrain.mjs
pnpm flowbrain help # the CLI from source, without bundling
```

Tests use synthetic projects in `fixtures/` and in temporary directories; none depends on real code or the network.

## License

[Apache-2.0](LICENSE)

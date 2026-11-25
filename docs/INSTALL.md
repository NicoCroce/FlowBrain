# Installing in Claude Code

[Español](INSTALACION.md) · **English**

## The short way: `flowbrain install` inside the project

The first time on a machine, from this repo (after that, the `flowbrain` command is on your PATH):

```bash
cd /ruta/al/proyecto
pnpm -s -C /ruta/a/este/repo flowbrain install "$PWD"
```

From then on, in any project:

```bash
cd /ruta/al/proyecto
flowbrain install
```

`install` does everything: it sets up the `flowbrain` command and the Claude Code hooks (without tying them to a folder), creates `.flowbrain/` in the project, asks which folder holds the repositories (Enter: the project folder; in a monorepo, the packages folder) and whether you want one brain per repository or all of them in one, indexes, and leaves the viewer at `.flowbrain/flowbrain.html`. At the end it prints the two MCP server lines, which you run only once per machine. Without a terminal (CI, an agent) it doesn't ask: `--repos <folder>` and `--split` or `--single` provide the same answers.

Running it again updates everything. To regroup repos or turn off communication, edit `.flowbrain/flowbrain.yaml` (see "Multiple brains"). The hooks and the MCP server use the `.flowbrain` in the folder where Claude Code was opened, or in any folder above it; outside a project they do nothing. `.flowbrain/.gitignore` excludes derived files (`_build/` and the viewer).

### The menu

In a project without `.flowbrain/`, `flowbrain` starts a **wizard** with the steps in the only order that works, since each one uses what the previous one leaves behind:

1. **Requirements:** gets the machine ready (`flowbrain setup`) and warns if git is missing or if no known coding agent is found (Claude Code, Codex, OpenCode); if there's none, it carries on anyway.
2. **Repositories:** asks for the folder, shows the subrepositories with their technology and what is visible at first glance, lets you choose which ones to leave out and whether to use one brain per repo or a single one, and only writes `.flowbrain/` once you confirm. If the folder has no code, it creates nothing.
3. **Index:** the parsers run.
4. **Agent (MCP):** connects it to the agent you choose, if you accept.
5. **Full analysis:** asks for your OK, because it's the slowest step, and asks which agent to use (see below).
6. **Viewer.**

Each step first checks whether it's already done (`flowbrain.yaml`, `_build/graph.json` and each brain's `profile.md`), so if you stop and type `flowbrain` again it resumes from the first pending step; the menu marks that step as **Next step** and starts with it selected.

Once configured, `flowbrain` with no arguments (or `flowbrain menu`, which always opens it), in a terminal, opens a menu with what you can do in the project you're in (it also finds it from a subrepo):

- **Configure this project** (without `.flowbrain/`): the same as `flowbrain install`. With the project already configured, **Update configuration** brings the command, the hooks and the Claude Code commands up to date, and reindexes.
- **Analyze the whole project:** asks which agent to use and opens it with the end-to-end analysis, in order: study of each repo and extractors (`flowbrain coverage --guide`), communication between services (`flowbrain evidence --guide`) and product features (`flowbrain feature --guide`). If the project isn't configured, it configures it first. The analysis is always complete: there is no quick version.
- **Reindex** and **View status** (all brains).
- **Open the viewer:** serves it at `http://127.0.0.1:4780` (or the next free port) so you can view and correct things from the page, and opens the browser. If a FlowBrain viewer is already running for the same project, it opens that one. It keeps running until Ctrl+C, which stops it and returns to the menu. If the server can't start, it opens `flowbrain.html` (read-only) and explains why.
- **Connect an agent (MCP):** registers the server for all your projects in the agent you choose; asks first.
- **Update FlowBrain:** from the repo, `git pull --ff-only`, `pnpm install` and `flowbrain setup`; with the published package, `npm install -g @nicocroce/flowbrain@latest`. Asks first.

`flowbrain setup` gets the machine ready (command, hooks and Claude Code commands) without touching any project. Without a terminal, `flowbrain` with no arguments prints the help.

### Which agent

FlowBrain neither ships nor picks a model: the parsers don't use AI, and whatever they don't understand is filled in by the coding agent you use, with whatever model it has configured. The instructions are the same for all of them (printed by `flowbrain coverage --guide`, `evidence --guide` and `feature --guide`) and FlowBrain verifies what the agent writes. The menu offers the ones it finds installed:

| Agent | Analysis | MCP |
|---|---|---|
| Claude Code | `claude "<pedido>"` | `claude mcp add --scope user flowbrain -- flowbrain serve --sync` |
| Codex (OpenAI) | `codex "<pedido>"` | `codex mcp add flowbrain -- flowbrain serve --sync` |
| OpenCode | `opencode --prompt "<pedido>"` | an `mcp.flowbrain` entry (`type: local`) in `~/.config/opencode/opencode.json`: the menu shows it for you to paste |
| Other | the menu prints the request so you can paste it into the agent you use (it must be able to run commands) | `flowbrain serve --sync` over stdio, in any MCP client |

The `/flowbrain-*` commands and the hooks are Claude Code features; with other agents, the analysis request already includes everything needed.

### Having a model analyze the real communication

The console matches calls to endpoints by method and path. That isn't enough to know which server a call goes to: two APIs can expose the same paths. When a call matches in more than one brain, it isn't linked to any of them and stays disputed, until a connection declared in `.flowbrain/flowbrain.yaml` states which service each base URL points to.

That analysis is done by a model. `flowbrain install` adds the `/flowbrain-index` command to Claude Code: open Claude Code in the project folder and type `/flowbrain-index` (or ask it to "index this project with FlowBrain"). The model reindexes, runs `flowbrain evidence`, follows each URL variable to its value in example, configuration and infrastructure files, writes the connections it could confirm (`origen: modelo`, with its `evidencia`) and reports back what it confirmed, its doubts and opportunities for improvement. It doesn't open real `.env` files: if a value only lives there, it asks you.

With another agent, the same instructions come from `flowbrain evidence --guide`.

The rest of this document describes the manual installation, with the brain folder wherever you want.

## With the published package (`@nicocroce/flowbrain`)

```bash
npx @nicocroce/flowbrain init mi-brain --claude-code
```

It creates the brain (structure, `SCHEMA.md`, `README.md`), compiles it, registers the `UserPromptSubmit` and `SessionEnd` hooks in `~/.claude/settings.json` (keeping your other hooks and leaving a `settings.json.flowbrain.bak` backup) and prints the only line left to run, the one for the MCP server:

```bash
claude mcp add --scope user flowbrain -- npx -y @nicocroce/flowbrain@0.1.1 serve --root /ruta/absoluta/a/mi-brain
```

The hooks and the server use a pinned version (`@nicocroce/flowbrain@0.1.1`) so that a new release doesn't change behavior without notice. `init` never overwrites existing files and can be run again. Without `--claude-code` it doesn't touch the Claude Code configuration. The package is named `@nicocroce/flowbrain` (the `flowbrain` name on npm belongs to another project) and installs the `flowbrain` command.

## From the repo (development)

FlowBrain can also be used from this repo with `pnpm` (`pnpm flowbrain init …` generates commands that point to the repo). In the examples:

- `FLOWBRAIN_TOOL` is the path to this repo (the FlowBrain code).
- `FLOWBRAIN_ROOT` is the path to your brain (the folder with `product/`, `technology/` and `_build/`).

## 1. Compile the brain

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain compile --root "$FLOWBRAIN_ROOT"
```

## 2. MCP server (user scope)

```bash
claude mcp add --scope user flowbrain -- pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain serve --root "$FLOWBRAIN_ROOT"
```

The server reloads the graph on its own when `_build/graph.json` changes, so there's no need to restart it after compiling.

## 3. UserPromptSubmit hook

In `~/.claude/settings.json`, replacing the paths:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "pnpm -s -C /ruta/a/brain-tool flowbrain hook claude-code --root /ruta/a/mi-brain" }
        ]
      }
    ]
  }
}
```

The hook reads the JSON that Claude Code sends on stdin (`prompt`, `cwd`) and injects a `<flowbrain-context>` block with:

- the current repo, if the name of the git root directory matches the id (without `repo-`), the name or an alias of a `repo` node;
- `trazar` for each HTTP path or file mentioned that exists in the graph (at most 3);
- `recorrer_grafo` (neighbors in both directions) for each node mentioned by exact id, name or alias (at most 5).

The default budget is 1500 tokens. If anything fails, the hook exits with code 0 and no output: it never blocks the prompt.

## 4. SessionEnd hook (contradiction notes)

Same command, also registered under `SessionEnd`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "pnpm -s -C /ruta/a/brain-tool flowbrain hook claude-code --root /ruta/a/mi-brain" }
        ]
      }
    ]
  }
}
```

The hook tells the events apart by `hook_event_name`. When the agent finds that the code contradicts the brain, it writes a `flowbrain-nota <id-del-nodo>: <qué cambió>` line in its response (as requested by the `<flowbrain-context>` block and the rules block in `CLAUDE.md`). When the session closes, the hook reads the transcript and appends those lines to `_drafts/notes/<id>.md`. It spends no tokens and blocks nothing. By hand: `flowbrain note <id> <texto>`.

## 5. Verification in CI

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain verify --root "$FLOWBRAIN_ROOT" --repos /ruta/a/los/clones
```

It looks for each repo's clone as `<carpeta>/<id>`, `<carpeta>/<id sin repo->` or `<carpeta>/<alias>` (or `--clone repo-x=/ruta`). It exits with 1 if new doubtful edges show up. Edges from repos without a local clone aren't verified and keep their previous state.

### Keeping the brain up to date

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain sync --root "$FLOWBRAIN_ROOT"      # reindexes the repos whose clone moved ahead and recompiles
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain status --root "$FLOWBRAIN_ROOT"    # repos up to date or not, counts and gaps; exits with 1 if anything is out of date
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain doctor --root "$FLOWBRAIN_ROOT"    # installation diagnostics (read-only)
```

To make the agent always query against the current code, register the server with `serve --sync`: when a clone has moved ahead, it reindexes and recompiles before answering.

`sync` uses the clone path saved by `flowbrain index` (relative to the brain); if the clone is somewhere else, `--repos <folder>` looks it up by name. It doesn't run `git pull`.

## Multiple brains

To split groups of repos (for example, current from legacy) into up to 8 brains, with optional communication between them:

```bash
mkdir ~/cerebros
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain brains propose /ruta/a/los/repos --root ~/cerebros   # writes ~/cerebros/flowbrain.yaml
# edit flowbrain.yaml: group the repos into brains, answer the questions, turn on communication
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain brains apply --root ~/cerebros                      # creates and indexes each brain
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain brains --root ~/cerebros                              # what exists and who each one talks to
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain connections --root ~/cerebros --brain vigente          # which calls travel to other brains
open ~/cerebros/flowbrain.html                                                          # viewer: one brain drawn for each
```

```yaml
version: 1
cerebros:
  - nombre: vigente
    repos:
      - ruta: /ruta/a/web
      - ruta: /ruta/a/api
  - nombre: historico
    curado: false            # no human review: every answer warns about it
    repos:
      - ruta: /ruta/a/api-vieja
comunicacion:
  - entre: [vigente, historico]
    activa: true             # false: no hints or relationships between the two
conexiones:                  # optional: which service calls which, and what tells them apart
  - desde: vigente/svc-web
    hacia: historico/svc-api-vieja
    por: LEGACY_API_URL      # base URL or host variable
```

The MCP server and the hooks point to the registry folder instead of a single brain. `flowbrain brains register --root ~/cerebros` registers the hooks in Claude Code (replacing those of a previous brain) and prints the `claude mcp add` line for the server. Each query uses the brain of the repo you're in; `cerebro` (or `--brain` on the CLI) picks another one. Running `aplicar` again updates; changing `comunicacion` or `conexiones` takes effect on the next query, without reindexing.

## 6. Rules for the agent

```bash
cd /ruta/a/un/repo
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain gen claude --root "$FLOWBRAIN_ROOT" --repo "$PWD" --write
```

Targets: `claude` (block in `CLAUDE.md`), `agents` (block in `AGENTS.md`), `cursor` (`.cursor/rules/flowbrain.mdc`) and `windsurf` (`.windsurf/rules/flowbrain.md`). In `CLAUDE.md` and `AGENTS.md` the block sits between `<!-- flowbrain:reglas:inicio -->` and `<!-- flowbrain:reglas:fin -->`, so regenerating it doesn't touch the rest of the file. Without `--write`, it prints it. `--repo` accepts a directory or a repo id.

## 7. Viewer

`flowbrain compile` writes `_build/viewer.html`: a single file with the graph and Cytoscape embedded, with no server or network. Open it with a double click. It has filters by type, status and origin, search, and clicking a node shows its details, its edges with evidence and the link to its page. Endpoints and files start out hidden.

## 8. Trying it by hand

```bash
pnpm -s -C "$FLOWBRAIN_TOOL" flowbrain context --root "$FLOWBRAIN_ROOT" --repo . --prompt "¿qué se rompe si cambio /checkout?"
```

## Publishing a version (maintainers)

```bash
pnpm release patch     # or minor, major, x.y.z; without an argument, the current version
```

First add a `## x.y.z` section to `packages/flowbrain/CHANGELOG.md` with what changes (it can stay uncommitted: it goes into the version commit). The command checks that you are on `main`, with no other changes and up to date with `origin`; bumps the version, commits and pushes it; runs `npm publish` (typecheck, tests, build and 2FA); waits for npm to finish processing the version (it takes a few minutes, and you must not publish again); and creates the `vx.y.z` tag on GitHub with the CHANGELOG notes, plus a release if `gh` is installed. If something fails halfway, run it again with the same version and it picks up where it left off. `--dry-run` shows what it would do without touching anything.

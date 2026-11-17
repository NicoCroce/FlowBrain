# flowbrain

Grafo de conocimiento determinístico para agentes de código. Las páginas Markdown las escriben humanos, el JSON lo generan parsers de TypeScript, PHP y OpenAPI, y todo se sirve por MCP, por hooks de Claude Code y por CLI. Ninguna consulta llama a un LLM.

```bash
npx flowbrain init mi-brain --claude-code   # crea el brain, lo compila y registra los hooks
claude mcp add --scope user flowbrain -- npx -y flowbrain@0.1.0 serve --root "$PWD/mi-brain"
```

Después:

```bash
npx flowbrain draft /ruta/a/un/repo --root mi-brain   # borradores en _drafts/ a partir del código
npx flowbrain index /ruta/a/un/repo --root mi-brain   # contratos y archivos
npx flowbrain compile --root mi-brain                 # graph.json y _build/viewer.html
npx flowbrain verify --root mi-brain --repos /ruta/a/los/clones
npx flowbrain gen claude --root mi-brain --repo /ruta/a/un/repo --write
```

Requiere Node ≥ 20. El contrato del grafo está en `SCHEMA.md`.

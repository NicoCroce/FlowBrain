# Instalación en Claude Code (v0.1, desde el repo)

Hasta que exista `npx brain init`, Brain se usa desde este repo con `pnpm`. En los ejemplos:

- `BRAIN_TOOL` es la ruta a este repo (el código de Brain).
- `BRAIN_ROOT` es la ruta a tu brain (la carpeta con `producto/`, `tecnologia/` y `_build/`).

## 1. Compilar el brain

```bash
pnpm -s -C "$BRAIN_TOOL" brain compile --raiz "$BRAIN_ROOT"
```

## 2. Servidor MCP (nivel usuario)

```bash
claude mcp add --scope user brain -- pnpm -s -C "$BRAIN_TOOL" brain serve --raiz "$BRAIN_ROOT"
```

El servidor recarga el grafo solo cuando cambia `_build/graph.json`, así que no hace falta reiniciarlo después de compilar.

## 3. Hook UserPromptSubmit

En `~/.claude/settings.json`, reemplazando las rutas:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "pnpm -s -C /ruta/a/brain-tool brain hook claude-code --raiz /ruta/a/mi-brain" }
        ]
      }
    ]
  }
}
```

El hook lee el JSON que manda Claude Code por stdin (`prompt`, `cwd`) e inyecta un bloque `<brain-context>` con:

- el repo actual, si el nombre del directorio raíz de git coincide con el id (sin `repo-`), el nombre o un alias de un nodo `repo`;
- `trazar` para cada ruta HTTP o archivo mencionado que exista en el grafo (máximo 3);
- `recorrer_grafo` (vecinos en ambas direcciones) para cada nodo mencionado por id, nombre o alias exacto (máximo 5).

El presupuesto por defecto es de 1500 tokens. Si algo falla, el hook sale con código 0 y sin salida: nunca bloquea el prompt.

## 4. Probar a mano

```bash
pnpm -s -C "$BRAIN_TOOL" brain context --raiz "$BRAIN_ROOT" --repo . --prompt "¿qué se rompe si cambio /checkout?"
```

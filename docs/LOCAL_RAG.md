# Combo-X — Local device RAG + connectors

## Device RAG

Chrome cannot open `~/projects/foo` from a path string. Combo-X uses the **File System Access API**:

1. **Settings → Device RAG → Grant / Add folder** — pick directories; exclude dirs editable (defaults skip `node_modules`, `.git`, `dist`, lockfiles…).
2. Handles stored in IndexedDB (`combo_x_rag` / `handles`).
3. Indexer walks trees, chunks text, stores hash vectors + keyword index. Cap is 2,500 files — a truncated walk is reported in `rag_status.lastError`.
4. Agent tools (auto-attached when an index exists — no `skill_read` required):

| Tool | Use for |
|------|---------|
| `rag_grep` | Exact identifier / string / regex → `path:line` with context. **The code-search tool.** |
| `rag_glob` | List paths matching a glob (`**/*.{ts,tsx}`) before reading |
| `rag_read_file` | Read a path; prefer `startLine`/`endLine` from a grep hit |
| `rag_search` | Fuzzy keyword / conceptual questions only |
| `rag_status` | Confirm grant, file/chunk counts, lastError |

`rag_search` returning empty hits is a retrieval failure (hash-vector scoring floors out on natural language about code) — switch to `rag_grep`. Do not conclude the code is missing.

Workspace setup page only toggles tool flags — folder grant stays in Settings.

## Connectors

See [`CONNECTORS.md`](./CONNECTORS.md). REST + remote MCP with vault secret refs — no hardcoded product APIs.

## Not required

- Native companion / MCP stdio for local folder RAG (jarvisd has `list_dir`/`read_file` but no `rg` yet)
- Path-hint string (optional label only)

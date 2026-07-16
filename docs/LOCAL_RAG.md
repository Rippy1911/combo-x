# Combo-X — Local device RAG + connectors

## Device RAG (working product)

Chrome cannot open `~/projects/foo` from a path string. Combo-X uses the **File System Access API**:

1. **Settings → Device RAG → Grant folder** (or **Add another folder**) — user picks directories; exclude dirs editable (defaults skip `node_modules`, `.git`, `dist`, …).
2. Handles stored in IndexedDB (`combo_x_rag` / `handles`).
3. Indexer walks trees with built-in + extra excludes, chunks text files, stores embeddings (deterministic hash vectors) + keyword index.
4. Agent tools: `rag_status`, `rag_search`, `rag_read_file`.

Workspace setup page only toggles connector/tool flags — folder grant stays in Settings. Re-grant if Chrome forgets permission; use **Reindex** after code changes.

## Connectors (working product)

| Connector | Vault labels | Tools |
|---|---|---|
| IdeaForge read | `ideaforge_email`, `ideaforge_password` | `ideaforge_search` → Base44 login + `searchKnowledge` |
| GitHub read | `github_token` (PAT with `repo` or public code) | `github_search_code`, `github_get_file` |

Setup checkboxes enable the tools; credentials live in the encrypted vault (Settings).

Defaults: IdeaForge app `69d5e793…` / host `intelligent-strategy-os-hub.base44.app`.

## Not required

- Native companion / MCP for local folder RAG
- Path-hint string (optional label only)

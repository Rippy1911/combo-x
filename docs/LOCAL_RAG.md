# Combo-X — Local device RAG + connectors

## Device RAG (working product)

Chrome cannot open `~/projects/foo` from a path string. Combo-X uses the **File System Access API**:

1. **Setup → Grant folder** (or Settings → Grant folder) — user picks a directory once.
2. Handle is stored in IndexedDB (`combo_x_rag` / `handles`).
3. Indexer walks the tree (skips `node_modules`, `.git`, `dist`, …), chunks text files, stores embeddings (deterministic hash vectors) + keyword index.
4. Agent tools: `rag_status`, `rag_search`, `rag_read_file`.

Re-grant if Chrome forgets permission; use **Reindex** after code changes.

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

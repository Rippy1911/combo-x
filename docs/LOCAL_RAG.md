# Combo-X — Local device RAG + connectors

## Device RAG

Chrome cannot open `~/projects/foo` from a path string. Combo-X uses the **File System Access API**:

1. **Settings → Device RAG → Grant / Add folder** — pick directories; exclude dirs editable (defaults skip `node_modules`, `.git`, `dist`, …).
2. Handles stored in IndexedDB (`combo_x_rag` / `handles`).
3. Indexer walks trees, chunks text, stores embeddings (hash vectors) + keyword index.
4. Agent tools: `rag_status`, `rag_search`, `rag_read_file`.

Workspace setup page only toggles tool flags — folder grant stays in Settings.

## Connectors

See [`CONNECTORS.md`](./CONNECTORS.md). REST + remote MCP with vault secret refs — no hardcoded product APIs.

## Not required

- Native companion / MCP stdio for local folder RAG
- Path-hint string (optional label only)

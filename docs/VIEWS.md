# Combo-X Views

Durable tables and local-data browser for the side panel **Views** tab (v0.7+).

## Use-case map

| ID | What |
|----|------|
| UC-Collect | Browse sessions, attachments, bookmarks, reminders, reports, memories, RAG paths, site-profile **names** |
| UC-Table | Generic grid: sort, text filter, column pick, export CSV/JSON |
| UC-Chart | Simple SVG bar/line from a numeric column (no chart library) |
| UC-Export | Downloads via `downloadText` |
| UC-CopilotView | Agent tools `save_view` / `list_views` / `get_view` |
| UC-Integrations | Status cards (vault, RAG meta, IdeaForge/GH configured flags, attachment count) — Test probes never dump secrets |
| UC-Inspector | Advanced read-only IDB inspector; vault = labels + ciphertext marker only |
| UC-Privacy | Never show vault plaintext or site-profile passwords in Views |

## Sub-nav

1. **Library** — named views saved by you or the agent
2. **Collections** — live lists from IndexedDB stores
3. **Table** — current grid + chart + export + Save as view
4. **Integrations** — connector/RAG/vault status
5. **Inspector** — gated Advanced; pick DB → store → JSON (vault redacted)

## Copilot-built views

After a scrape/`parse_data`, the orchestrator should call:

```text
save_view { name, rows: [["col",…], …], note? }
```

Reopen with `list_views` / `get_view { name|id }`. Snapshots live in IndexedDB `combo_x_views` (plaintext like sessions — **never** put vault secrets in `rows`).

Chat Preview → **Views** stashes the table (`combo_x_views_pending_table`) and switches tab.

## Privacy rules

- Site profiles in Collections: vault labels `site_profile:*` → display name only
- Inspector on `combo_x_vault`: `label=… (ciphertext)` — no decrypt
- `redactSensitiveFields` strips password/secret/token/api_key keys from object rows

## Out of scope

- MCP remote control of Combo chat (parked)
- Heavy chart / dashboard builders
- Editing IDB rows in Inspector
- Encrypted multi-device sync of views

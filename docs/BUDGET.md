# Budget mode

Minimize orchestrator tokens and steps for multi-page scrapes (e.g. FoodWell invoice → carton/retail EAN).

**Default for new installs** (`localStorage` missing → `budget`).

## What changes

| Lever | Normal | Budget |
|---|---|---|
| Max agent steps | 32 | 16 |
| Bare `get_page` | full ~12k | **rewritten to `page_digest`**; `mode=full` **rejected** |
| Preferred path | ad-hoc | `ensure_scrape_table` → `scrape_pdps` / digest → upsert |
| Structure reuse | — | Per-run `PageTemplateCache` |
| Structuring | Orchestrator LLM | `parse_data` worker (`meta.source` / `meta.fallback`) |

## Tools

- **`ensure_scrape_table` / `upsert_scrape_rows` / `get_scrape_table`** — progressive Views IDB table
- **`scrape_pdps`** — batch navigate `/s/{sap}` or URLs → digest → upsert in one tool turn
- **`page_digest`** — compact EAN / carton / catalog map
- **`parse_data`** — cheap worker extract

## Folder grant

**Settings → Device RAG** (not setup page).

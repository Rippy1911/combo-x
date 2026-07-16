# Budget mode

Minimize orchestrator tokens and steps for multi-page scrapes (e.g. FoodWell invoice → carton/retail EAN).

## Enable

**Settings → Token budget → Budget**. Persists in `localStorage` (`combo_x_budget_mode`).

## What changes

| Lever | Normal | Budget |
|---|---|---|
| Max agent steps | 32 | 16 |
| Default `get_page` | ~12k chars, mode full | snippet, ~2.2k chars |
| Preferred read | `get_page` | `page_digest` |
| Structure reuse | — | Per-run `PageTemplateCache` (learn once / strip chrome on reuse) |
| Structuring | Orchestrator LLM | `parse_data` cheap worker (+ `meta.source` / `meta.fallback`) |

System addon tells the orchestrator: digest → extract → navigate `/s/{SAP}` → worker parse; report worker fallbacks.

## Tools

- **`page_digest`** — compact map: title, url, headings, `labelHits` (EAN / carton EAN / catalog #), `eans`, short `mainSample`. After first hit of a path kind (`/s/{id}`, `/-p{id}`), later digests include `template.status=reuse` and drop bulky chrome.
- **`get_page`** — `mode=snippet|structure|full` + `maxChars`. Budget defaults to snippet.
- **`parse_data`** — prefers `page_digest` when `use_page` or empty text; returns `meta: { workerModel, source, inputChars, fallback }`.

## Workspace setup

Healthtree-oriented setup page syncs tool allowlist + approval only. **Folder grant / multi-folder / exclude dirs** (`node_modules`, `.git`, …) live in **Settings → Device RAG**.

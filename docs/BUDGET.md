# Budget mode

Minimize orchestrator tokens and steps for multi-page scrapes (e.g. FoodWell invoice → carton/retail EAN).

**Default for new installs** (`localStorage` missing → `budget`).

## Prompt cache (provider KV)

Combo-X does **not** host a local KV cache. On OpenRouter it pins each run with `session_id` (+ `x-session-id`) so sticky routing can reuse the provider’s prompt cache for the stable prefix (system + tools). Anthropic/Qwen also get explicit `cache_control` breakpoints. Moonshot/Grok/OpenAI usually cache automatically once the prefix is stable and long enough.

The token meter still shows full `prompt_tokens` (providers count them); when the API reports hits you’ll also see `cache N`. **Cost** drops on cache reads (often 0.1–0.5× input); skill unlocks that change `tools[]` invalidate the tools portion of the prefix until the next write.

## Mid-run compact

Within a single `AgentLoop.run()`, older tool rounds are folded into lean crumbs before each model call after step 1 (`compactMidLoopMessages`). Newest 1–2 rounds stay in OpenAI `assistant`+`tool` shape so tool-calling stays valid. Cap = Settings Ctx limit (or 2× lean history when Ctx is Off). This is what stops quadratic “every action re-bills the whole transcript” growth.

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

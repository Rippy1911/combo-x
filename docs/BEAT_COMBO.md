# How Combo-X beats Combo (Composer 2.5 / GLM Phase A–B)

Source of truth for the challenge: `../combo` on `feat/v0.1-phase-b` (2026-07-16).

## Gap analysis (combo)

| Area | State in `combo/` | Impact |
|---|---|---|
| Side panel | `App.tsx` = “Combo is alive” placeholder | User cannot chat or configure BYOK |
| `@combo/agents` | Role enums + stub interface | No tool loop, no planner execution |
| Content script | Stub / no DOM ops | No page reading or clicking |
| `@combo/llm` | OpenRouter stream/chat only | **No `tools` / tool_calls** → cannot be agentic |
| Memory / RAG | pglite package, not wired | No recall in product |
| Vault | Real crypto | Not connected to UI |

## What Combo-X ships instead

1. **AgentLoop** — tool calling; default **32** steps; abort; approval modes (`ask` / `auto_llm` / `auto_all`).
2. **Dual models (v0.3)** — orchestrator + cheap **worker** for `parse_data` (Nanobrowser-style cost split without full Planner/Navigator).
3. **Scrape/nav toolkit** — `get_interactive` / index click, scroll/wait/find, `query_all`, `navigate` / `go_back` / `close_tab`, tables + CSV.
4. **UI** — tool chips, allow-box, Sessions, token meter, Setup ingest.
5. **MemoryStore + SessionStore** — IndexedDB; searchable past chats.
6. Gap vs Nanobrowser: [`docs/NANOBROWSER_GAP.md`](./NANOBROWSER_GAP.md). Sync: [`docs/SYNC_AND_SCALE.md`](./SYNC_AND_SCALE.md).

## Reused (not reinvented)

- AES-GCM + PBKDF2 vault shape from combo Phase B
- CRXJS + pnpm workspace layout
- OpenRouter SSE parsing ideas

## Intentionally deferred (honest)

- Encrypted multi-device blob sync (vault yes today; sessions plaintext local — see SYNC_AND_SCALE)
- Live IdeaForge / Supabase read MCP (setup page queues intents only)
- Folder RAG via File System Access API
- Firefox port

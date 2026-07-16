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
2. **16 tools** — page DOM + `open_tab` / `activate_tab` + `scrape_tables` / `export_csv` + bookmarks / reminders / HTML reports + `search_sessions` + memory.
3. **UI** — expandable tool chips, allow-box for sensitive actions, Sessions tab, token/cost meter, Setup ingest page.
4. **Content handlers** — unit-tested DOM ops; SW reinjects content scripts after navigation.
5. **MemoryStore + SessionStore** — IndexedDB; searchable past chats.
6. **24 unit tests + build** — green locally. Sync/scale = plan only (`docs/SYNC_AND_SCALE.md`).

## Reused (not reinvented)

- AES-GCM + PBKDF2 vault shape from combo Phase B
- CRXJS + pnpm workspace layout
- OpenRouter SSE parsing ideas

## Intentionally deferred (honest)

- Encrypted multi-device blob sync (vault yes today; sessions plaintext local — see SYNC_AND_SCALE)
- Live IdeaForge / Supabase read MCP (setup page queues intents only)
- Folder RAG via File System Access API
- Firefox port

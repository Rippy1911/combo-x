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

1. **AgentLoop** — OpenAI-compatible tool calling against OpenRouter; max steps; abort signal.
2. **8 tools** — `get_page`, `get_links`, `click`, `type_text`, `extract`, `list_tabs`, `remember`, `recall`.
3. **Content handlers** — unit-tested DOM ops used by the real content script.
4. **Side panel** — onboarding (passphrase + key), chat, live tool traces, session cost meter, STOP.
5. **MemoryStore** — IndexedDB + keyword ranking (lightweight day-1; pgvector later if needed).
6. **20 unit tests + build + e2e artifact checks** — all green locally.

## Reused (not reinvented)

- AES-GCM + PBKDF2 vault shape from combo Phase B
- CRXJS + pnpm workspace layout
- OpenRouter SSE parsing ideas

## Intentionally deferred (honest)

- Folder RAG via File System Access API
- Bidirectional MCP
- WASM sandbox / pentest toolkit
- Firefox port

Those were Combo Phases C–D. Combo-X wins by shipping a **usable agent** first.

# Combo-X

Local-first **browser agent** Chrome extension. Built to beat the Combo Phase A/B scaffold (Composer 2.5 / GLM): packages that never wired into UI, stub agents, no tool calling.

**Current: v0.4** — agent loop + scrape toolkit + **local folder RAG** + IdeaForge/GitHub read connectors. Details: [`docs/LOCAL_RAG.md`](./docs/LOCAL_RAG.md), [`docs/BEAT_COMBO.md`](./docs/BEAT_COMBO.md).

| Capability | Status |
|---|---|
| Tool-calling agent + DOM scrape/nav | ✅ |
| Dual models (orchestrator + `parse_data` worker) | ✅ |
| Encrypted vault + sessions + approvals | ✅ |
| **Local device RAG** (Grant folder → IndexedDB index) | ✅ `rag_search` / `rag_read_file` |
| **IdeaForge + GitHub** live read tools | ✅ vault creds in Settings |
| Supabase MCP / multi-device sync | deferred |

## Install

```bash
cd combo-x
pnpm install
pnpm test
pnpm build
```

Load in Chrome:

1. `chrome://extensions` → Developer mode
2. **Load unpacked** → select `extension/dist` (reload after rebuild)
3. Side panel → passphrase + OpenRouter key
4. **Settings** → IdeaForge email/password and/or GitHub PAT → Save
5. **Setup** tab (or setup page) → **Grant folder + index**
6. Chat: *“Use rag_search for X in this repo”* or *“ideaforge_search …”*

## Architecture

```
Side panel (React)
  → AgentLoop (tool-calling)
      → OpenRouterClient
      → MemoryStore (IndexedDB)
      → ChromeBridge → service worker → content script (DOM tools)
```

Reuse note: vault crypto + SSE patterns inspired by `combo/` Phase B; agent loop, tool schemas, DOM handlers, and UI wiring are new.

## Scripts

| Command | What |
|---|---|
| `pnpm test` | Vitest (vault, memory, DOM tools, agent loop, LLM mocks) |
| `pnpm build` | CRXJS Vite build → `extension/dist` |
| `pnpm test:e2e` | Playwright load-unpacked smoke |

## License

MIT

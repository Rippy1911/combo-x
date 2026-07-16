# Combo-X

Local-first **browser agent** Chrome extension. Built to beat the Combo Phase A/B scaffold (Composer 2.5 / GLM): packages that never wired into UI, stub agents, no tool calling.

**Current: v0.9** — **Budget mode** (`page_digest` + worker `parse_data` meta + per-run page template cache), Activity log, multi-folder RAG with exclude filters in Settings, Healthtree workspace setup. Docs: [`docs/BUDGET.md`](./docs/BUDGET.md), [`docs/VIEWS.md`](./docs/VIEWS.md), [`docs/ATTACHMENTS.md`](./docs/ATTACHMENTS.md), [`docs/LOCAL_RAG.md`](./docs/LOCAL_RAG.md).

| Capability | Status |
|---|---|
| Tool-calling agent + DOM scrape/nav | ✅ |
| **Budget mode** (least steps/tokens) | ✅ |
| **Memory inject + lean history** | ✅ |
| **Activity log** (tools + approval + page URL) | ✅ |
| **Views tab** (tables, charts, collections, inspector) | ✅ |
| **Streaming assistant text** (SSE) | ✅ |
| **Markdown / GFM tables** in chat | ✅ |
| **Preview drawer** (tables, CSV, files, tool results) | ✅ → Open in Views |
| Dual models + vault + sessions + approvals | ✅ |
| Local folder RAG (multi-folder + excludes) + attachments + IdeaForge/GitHub | ✅ |
| MCP remote control of Combo chat | deferred (lower prio) |

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
5. **Settings** → Grant / Add folder + exclude dirs; optional **Budget** mode for multi-PDP scrapes
6. **Workspace** tab / setup page → tool allowlist + approval (FoodWell preset)
7. Chat: Attach a PDF/CSV/image → ask about it; or *“rag_search …”* / *“ideaforge_search …”*

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

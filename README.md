# Combo-X

Local-first **browser agent** Chrome extension. Built to beat the Combo Phase A/B scaffold (Composer 2.5 / GLM): packages that never wired into UI, stub agents, no tool calling.

**What ships in v0.1 (this directory):**

| Capability | Combo (`combo/`) | Combo-X (`combo-x/`) |
|---|---|---|
| MV3 shell | ✅ | ✅ |
| Encrypted vault (AES-GCM + PBKDF2) | ✅ package | ✅ **wired to onboarding** |
| OpenRouter chat | ✅ package | ✅ |
| **Tool-calling agent loop** | ❌ stub | ✅ **real** |
| **Browser tools (get_page/click/type/…)** | ❌ stub content | ✅ **content script handlers** |
| **Persistent memory + recall** | ❌ (pglite planned) | ✅ IndexedDB keyword memory |
| Side panel chat + cost meter + STOP | ❌ "Combo is alive" | ✅ |
| Unit tests for agent/DOM/vault | partial | ✅ |

## Install

```bash
cd combo-x
pnpm install
pnpm test
pnpm build
```

Load in Chrome:

1. `chrome://extensions` → Developer mode
2. **Load unpacked** → select `extension/dist`
3. Open Combo-X side panel → set passphrase + OpenRouter key
4. Ask: *“Summarize this page”*

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

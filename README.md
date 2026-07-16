# Combo-X

Local-first **browser agent** Chrome extension.

**Current: v1.0** — multi-agent profiles, REST/MCP connectors with vault secret extract, screenshots + tab recording, progressive scrape tables, Budget mode defaults. Docs: [`docs/BUDGET.md`](./docs/BUDGET.md), [`docs/CONNECTORS.md`](./docs/CONNECTORS.md), [`docs/AGENTS.md`](./docs/AGENTS.md), [`docs/VIEWS.md`](./docs/VIEWS.md), [`docs/LOCAL_RAG.md`](./docs/LOCAL_RAG.md).

| Capability | Status |
|---|---|
| Tool-calling agent + DOM scrape/nav | ✅ |
| **Budget mode** (default; page_digest / scrape_pdps) | ✅ |
| **Multi-agent profiles** | ✅ |
| **REST + remote MCP connectors** | ✅ |
| **Screenshots + tab recording** | ✅ |
| **Progressive scrape tables** (Views IDB) | ✅ |
| Memory inject + lean history | ✅ |
| Activity log | ✅ |
| Views / streaming / attachments | ✅ |
| Local folder RAG (multi-folder + excludes) | ✅ |

## Install

```bash
cd combo-x
pnpm install
pnpm test
pnpm build
```

Load in Chrome:

1. `chrome://extensions` → Developer mode
2. **Load unpacked** → `extension/dist` (reload after rebuild)
3. Side panel → passphrase + OpenRouter key
4. **Settings** → Budget (default), Agents, Connectors (REST/MCP), Device RAG
5. Chat: attach PDF → scrape with `scrape_pdps` / progressive table

## Architecture

```
Side panel (React)
  → AgentLoop (tool-calling)
      → OpenRouterClient
      → AgentProfileStore / ConnectorStore / ViewStore / Vault
      → ChromeBridge → SW → content + offscreen (media)
```

## Scripts

| Command | What |
|---|---|
| `pnpm test` | Vitest |
| `pnpm build` | CRXJS Vite → `extension/dist` |
| `pnpm test:e2e` | Playwright smoke |

## License

MIT

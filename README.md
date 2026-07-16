# Combo-X

Local-first **browser agent** Chrome extension (MV3).

**Current: v1.2.0** — page extensions (MAIN-world userscripts, isolated store + agent bridge), agentic control, sub-agents, usage/tasks, Budget scrape, REST/MCP.

**Architecture:** [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — mermaid diagrams for loop, tools, sub-agents, memories, usage.

| Capability | Status |
|---|---|
| Tool-calling agent + DOM scrape/nav | ✅ |
| **Budget mode** (default; `page_digest` / `scrape_pdps`) | ✅ |
| **Multi-agent + meta-tools** (`create_agent` / `spawn_subagent`) | ✅ |
| **Auto-tool pick** (`pickToolsForGoal` + catalog use-cases) | ✅ |
| **Sub-agents** (depth 1; UI strip; results to parent) | ✅ |
| **Usage charts** (models/providers/tokens/actions/messages) | ✅ |
| **Task tracking** (session + global) | ✅ |
| **Page extensions** (MAIN inject, isolated IDB, bridge + audit) | ✅ |
| **REST + remote MCP connectors** | ✅ |
| **Screenshots + tab recording** | ✅ |
| **Progressive scrape tables** (Views IDB) | ✅ |
| Memory inject + lean history | ✅ |
| Activity log | ✅ |
| Local folder RAG (multi-folder + excludes) | ✅ |

### Feature docs

| Doc | Topic |
|-----|-------|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | System design (start here) |
| [`docs/TOOLS.md`](./docs/TOOLS.md) | Tool catalog + groups |
| [`docs/AGENTS.md`](./docs/AGENTS.md) | Agent profiles |
| [`docs/SUBAGENTS.md`](./docs/SUBAGENTS.md) | Sub-agent protocol |
| [`docs/PAGE_EXTENSIONS.md`](./docs/PAGE_EXTENSIONS.md) | Page scripts / isolation / bridge |
| [`docs/BUDGET.md`](./docs/BUDGET.md) | Budget mode |
| [`docs/CONNECTORS.md`](./docs/CONNECTORS.md) | REST/MCP |
| [`docs/VIEWS.md`](./docs/VIEWS.md) | Progressive tables |
| [`docs/LOCAL_RAG.md`](./docs/LOCAL_RAG.md) | Device RAG |

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

## Next (known gaps — see verification)

- Page-ext **bridge capability token** (forgeable `scriptId` today — harden before password-manager use cases)
- Honor `runAt` / tighten match patterns / optional auto-inject flag
- `canSelfEdit` execute-time catalog filtering

## Monorepo layout

```
packages/core/   Shared agent loop, tools, stores, LLM client
extension/       Chrome MV3: side panel, SW, content, offscreen
```

## Scripts

| Command | What |
|---|---|
| `pnpm test` | Vitest (`packages/core`) |
| `pnpm build` | CRXJS Vite → `extension/dist` |
| `pnpm test:e2e` | Playwright smoke |

## License

MIT

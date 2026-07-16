# Combo-X

Local-first **browser agent** Chrome extension (MV3).

**Current: v1.1.0** — agentic control (create/edit/delegate agents), auto-tool pick, sub-agents (1 nest), usage charts, task tracking, progressive scrape, Budget defaults, REST/MCP.

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
| [`docs/SUBAGENTS.md`](./docs/SUBAGENTS.md) | Sub-agent protocol (v1.1) |
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

## v1.1 roadmap

- **Sub-agents** — `spawn_subagent` with isolated child history, results-only return, depth 1 ([`docs/SUBAGENTS.md`](./docs/SUBAGENTS.md))
- **Usage telemetry** — durable `UsageStore` + charts (v1.0: per-session totals in `SessionStore`)
- **Task tracking** — global `TaskStore` linked to sessions, views, and sub-agent runs
- **Auto-tooling** — worker LLM filters `AGENT_TOOLS` per turn; optional auto-agent profile creation
- **Agent profile fields** — `maxSteps`, `canDelegate`, `canSelfEdit` on `AgentProfile`

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

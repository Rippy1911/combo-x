# Tools reference

Combo-X exposes **function-calling tools** to the orchestrator LLM. The canonical schema lives in one place:

**Source of truth:** `packages/core/src/browser/tools.ts` → `AGENT_TOOLS`

Each entry is an OpenRouter-compatible `ToolDefinition` with:

- `name` — stable identifier (also in `BrowserToolNameSchema`, `packages/core/src/protocol/messages.ts`)
- `description` — when the model should call it
- `parameters` — JSON Schema for arguments

Runtime execution splits across:

| Layer | File | Role |
|-------|------|------|
| Schema | `packages/core/src/browser/tools.ts` | `AGENT_TOOLS`, `toolArgsToContentRequest()` |
| Orchestrator | `packages/core/src/agent/loop.ts` | `executeTool()` dispatch |
| DOM ops | `packages/core/src/browser/content-handlers.ts` | `handleContentRequest()` |
| Wire | `extension/src/content/content.ts` | In-tab message handler |
| UI groups | `extension/src/sidepanel/toolGroups.ts` | `TOOL_GROUPS` for Settings |

---

## How tools reach the model

Every orchestrator turn filters `AGENT_TOOLS` by `enabledTools` (see [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md#tool-attachment-per-orchestrator-turn)).

Resolution:

1. Active `AgentProfile.toolAllowlist` (`"all"` or `string[]`)
2. Else global Tools tab selection (`localStorage`)
3. Filter: `AGENT_TOOLS.filter(t => enabledTools.includes(t.function.name))`

### v1.1: worker tool filter (shipped)

`pickToolsForGoal` (`packages/core/src/tools/pickTools.ts`) uses a worker LLM + `TOOL_CATALOG` (use-case metadata) to return a `string[]` allowlist — wired into `create_agent`. Per-run, `AgentLoop` builds the filtered `ToolDefinition[]` **once** (still re-sent each turn per OpenAI protocol).

---

## Tool groups

UI grouping (`extension/src/sidepanel/toolGroups.ts`) plus planned v1.1 groups:

### Browser

DOM navigation, interaction, and scrape helpers. Most map to `ContentRequest` ops via `toolArgsToContentRequest()`.

| Tool | Use when |
|------|----------|
| `page_digest` | Cheap page map (title, headings, EAN/label hits) — **default in budget mode** |
| `get_page` | Read tab text (`snippet` / `structure` / `full`; budget caps/rejects `full`) |
| `get_links` | List links (text + href) |
| `get_interactive` | Indexed clickable/inputs — prefer over guessing CSS |
| `click_index` / `type_index` | Act on index from `get_interactive` |
| `click` / `type_text` | CSS selector interaction |
| `extract` | Single selector text/attribute |
| `query_all` | Batch extract nodes (product cards, EAN lists) |
| `scrape_tables` | HTML `<table>` → row arrays |
| `scroll` | Page/container scroll |
| `wait` | Post-navigation settle (≤10s) |
| `find_text` | Visible text search + optional scroll-into-view |
| `navigate` / `go_back` | Same-tab URL / history |
| `list_tabs` / `open_tab` / `activate_tab` / `close_tab` | Tab management |
| `login` | Vault/profile-based login flow |
| `save_site_profile` / `get_site_profile` | Encrypted login + scrape recipes |
| `scrape_catalog` | Multi-page catalog (query_all → parse_data → next page) |
| `ensure_scrape_table` | Create/open progressive scrape view **before** first PDP |
| `upsert_scrape_rows` | Merge rows into scrape table by key columns |
| `get_scrape_table` | Read current scrape progress |
| `scrape_pdps` | Batch PDP scrape: navigate → digest → upsert (one tool turn) |

**Sensitive** (approval-gated): `click`, `type_text`, `click_index`, `type_index`, `open_tab`, `activate_tab`, `navigate`, `go_back`, `close_tab`, `login`, `scrape_catalog`, `scrape_pdps` — see `SENSITIVE_TOOLS` in `packages/core/src/protocol/messages.ts`.

### Data

Structured extraction, RAG, attachments, views, export.

| Tool | Use when |
|------|----------|
| `parse_data` | Worker LLM extracts JSON rows from text or current page |
| `rag_status` | Check local folder index health |
| `rag_search` | Keyword search granted repo folder |
| `rag_read_file` | Read indexed file path |
| `list_attachments` / `read_attachment` | Chat-uploaded PDF/CSV/images |
| `export_csv` | Download row matrix as CSV |
| `save_view` / `list_views` / `get_view` | Named table snapshots (Views tab) |

### Media

Screenshots, UX Vision Lab, and tab recording (service worker + offscreen).

| Tool | Use when |
|------|----------|
| `ux_critique` | **ALWAYS_ON** — required for visual UX audits; capture + chat artifact + vision attach |
| `annotate_screenshot` | Numbered markers / boxes on a prior `attachmentId` |
| `page_css_preview` / `page_css_clear` | Ephemeral live CSS for before/after proof |
| `open_preview` | HTML / image / compare (prefer `attachmentId*`, never base64) |
| `screenshot_viewport` | Visible tab PNG (combo-media) |
| `screenshot_element` | Crop element by selector or index |
| `screenshot_full` | Scroll-stitch full page |
| `start_recording` / `stop_recording` | Tab webm capture |

**Sensitive:** `start_recording`, `stop_recording`.

### Memory

Durable local notes and session artifacts.

| Tool | Use when |
|------|----------|
| `remember` | Save fact to `MemoryStore` (also first-turn inject) |
| `recall` | Keyword search memories |
| `memory_list` | List recent memories |
| `save_bookmark` | Local bookmark artifact |
| `set_reminder` | Chrome notification reminder |
| `create_report` | HTML report + download |
| `search_sessions` | List recent chats (empty query) or search by keyword |
| `get_session` | Load full messages for a session id |

Store: `packages/core/src/memory/store.ts` (`combo_x_memory`).

### Connectors

User-configured REST/MCP — no hardcoded hosts.

| Tool | Use when |
|------|----------|
| `rest_request` | HTTP call via `ConnectorStore` REST entry |
| `mcp_list_tools` | Discover remote MCP tools |
| `mcp_call` | Invoke remote MCP tool |

Secrets resolve through `Vault` labels. Agent `connectorIds` scopes which connectors are callable.

**Sensitive:** `rest_request`, `mcp_call`.

See [`docs/CONNECTORS.md`](./CONNECTORS.md).

### Agentic (v1.1 — shipped)

| Tool | Use when |
|------|----------|
| `spawn_subagent` | Delegate sub-goal to isolated child loop (depth ≤ 1) |
| `create_agent` | New profile; optional `pickToolsForGoal` |
| `update_agent` | Mutate profile when `canSelfEdit` |
| `list_agents` | Inspect profiles |

Protocol: [`docs/SUBAGENTS.md`](./SUBAGENTS.md). Profile fields: [`docs/AGENTS.md`](./AGENTS.md).

### Meta (v1.1 — shipped)

| Tool | Use when |
|------|----------|
| `create_task` / `update_task` / `list_tasks` / `reorder_tasks` | Conversation tasks (session checklist + global; ordered) |

Usage charts are UI-driven (`UsagePanel` ← `UsageStore`), not a separate tool.

### Page extensions (v1.2 — shipped)

| Tool | Use when |
|------|----------|
| `create_page_extension` / `update_page_extension` | Draft MAIN-world userscripts |
| `approve_page_extension` | **User-only** (agent call rejected) |
| `inject_page_extension` / `set_page_extension_bridge` | Always ask (even under `auto_all`) |
| `page_ext_data_*` / `list_page_extension_audit` | Read isolated data / audit |

See [`docs/PAGE_EXTENSIONS.md`](./PAGE_EXTENSIONS.md). Sensitive: approve, revoke, inject, bridge, data_clear, create/update.

---

## Worker vs orchestrator tools

| Caller | Tools |
|--------|-------|
| **Orchestrator** | All tools in filtered `AGENT_TOOLS` |
| **Worker** (internal) | Not tool-called — `parse_data`, approval yes/no, future tool-filter prompt |

Worker model: `AgentRunOptions.workerModel` (default `DEFAULT_WORKER_MODEL` in `packages/core/src/models.ts`).

---

## Adding a new tool (contributors)

1. Add schema to `AGENT_TOOLS` in `packages/core/src/browser/tools.ts`
2. If DOM op: extend `ContentRequestSchema` + `handleContentRequest()` + `toolArgsToContentRequest()`
3. If loop-local: branch in `AgentLoop.executeTool()` (`packages/core/src/agent/loop.ts`)
4. Add name to `BrowserToolNameSchema` if content-wire related
5. Add to `TOOL_GROUPS` in `extension/src/sidepanel/toolGroups.ts`
6. If sensitive: add to `SENSITIVE_TOOLS`
7. Tests: `packages/core/src/browser/tools.test.ts`, `loop.test.ts`

---

## Related

- Architecture: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
- Budget tool preferences: [`docs/BUDGET.md`](./BUDGET.md)
- Scrape table workflow: [`docs/VIEWS.md`](./VIEWS.md)

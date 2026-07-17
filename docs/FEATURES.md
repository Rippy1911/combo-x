# Combo-X — Complete Internal Feature Map

Authoritative inventory of every internal subsystem. Cited to source where useful.
Generated from a full read of `packages/core/src` and `extension/src` (v1.4.3).

> Companion docs: [ARCHITECTURE](./ARCHITECTURE.md) · [TOOLS](./TOOLS.md) ·
> [AUDIT](./AUDIT.md) · [ROADMAP](./ROADMAP.md). The prioritized fix list lives at
> the end of this file (§10).

## Subsystem overview

| # | Subsystem | Purpose | Store (IndexedDB) |
|---|-----------|---------|-------------------|
| 1 | Tools | Capability layer (78 tools) | — |
| 2 | Skills | On-demand playbooks that unlock tool packs | `combo_x_skills` |
| 3 | Memory | Always-prepended local notes | `combo_x_memory` |
| 4 | Context mgmt | Lean history, budget mode, token accounting | — |
| 5 | Agents / sub-agents | Reusable profiles + delegation | `combo_x_agents` |
| 6 | Approvals / audit | Sensitive-tool gating + action log | `combo_x_action_log` |
| 7 | Sessions | Chat persistence | `combo_x_sessions` |
| 7 | Connectors | REST + MCP definitions | `combo_x_connectors` |
| 7 | RAG | Local folder index | `combo_x_rag` |
| 7 | Vault | AES-GCM encrypted secrets | `combo_x_vault` |
| 7 | Page extensions | MAIN-world userscripts + bridge | `combo_x_page_ext` |
| 7 | Tasks | Kanban task board | `combo_x_tasks` |
| 7 | Usage | Token/cost telemetry | `combo_x_usage` |
| 7 | Attachments | PDF/CSV/XLSX/image uploads | `combo_x_attachments` |
| 8 | LLM client | OpenRouter streaming + tool calling | — |

## 1. Tools (78 total, 7 categories)

Defined in `packages/core/src/browser/tools.ts` (`AGENT_TOOLS`), with metadata in
`tools/catalog.ts` and access control in `tools/gating.ts`.

| Category | ~Count | Examples |
|----------|--------|----------|
| browser | 18 | navigate, page_digest, get_page, get_interactive, click_index, type_index, click, type_text, extract, scroll, find_text |
| data | 10 | query_all, scrape_tables, export_csv, save_view, get_view, ensure_scrape_table, upsert_scrape_rows |
| agentic | ~19 | parse_data, scrape_catalog, scrape_pdps, create_agent, spawn_subagent, *_page_extension |
| memory | 10 | rag_search, rag_read_file, remember, recall, memory_list, skill_search, skill_read, skill_save |
| connectors | 6 | save_site_profile, login, rest_request, mcp_list_tools, mcp_call |
| media | 5 | screenshot_viewport/element/full, start_recording, stop_recording |
| meta | ~7 | save_bookmark, set_reminder, create_report, search_sessions, list/create/update_task |

### Gating model (`tools/gating.ts`)
- **Always-on (~36):** core browser, memory, skills, tasks, agent meta-tools.
- **Skill-gated packs (~39):** `scrape` (14), `rest` (3), `rag` (5), `page-ext` (12),
  `media` (5). Unlocked at runtime by `skill_read` via each skill's `toolHints`.
- Helpers: `isSkillGatedTool`, `isAlwaysOnTool`, `packForTool`, `initialActiveTools`,
  `unlockFromHints`.
- UI reflects this: the chat footer shows e.g. `Tools 37/76 · gated`.

### Selection & execution
- Optional cheap **tool picker** (`tools/pickTools.ts`) narrows tools for a goal.
- `AgentLoop.executeTool()` routes all 78 tools; locked tools return `tool_locked`.
- **Sensitive tools (24)** require approval — see §6.

## 2. Skills (`skills/store.ts`)
On-demand playbooks (markdown `body`) that both store knowledge and **unlock tool
packs** via `toolHints`. Unlike memories, skills are searched, never auto-injected.

Seeded skills: `combo-scrape`, `combo-rest`, `combo-rag`, `combo-page-ext`,
`combo-media` — each maps to the matching gated pack. Scope is `global` or `agent`.
Search is keyword-scored (exact 1.0 > substring 0.5).

## 3. Memory (`memory/store.ts`)
Kinds: `episodic | semantic | note`; scope `global | agent`. Keyword search with a
recency boost (~14-day decay). Up to 24 entries are **prepended to the system message
each turn** via `formatMemoryInject` — "prefer these over inventing facts".

## 4. Context management
- **Lean history** (`agent/leanHistory.ts`): drops tool/system rows, snippets + redacts
  tool results (≤280 chars, ≤6 per turn), trims from the front to a ~24k-char cap.
- **Budget mode** (`agent/budget.ts`): `normal` (32 steps, 12k `get_page`) vs `budget`
  (16 steps, ~2.2k, rejects `get_page mode=full`, rewrites args to snippet).
- **page_digest** (cheap: title/url/headings/sample) vs **get_page** (snippet/structure/full).
- **Token accounting** (`usage/store.ts` + `llm/openrouter.ts`): prefers OpenRouter's
  native cost, else estimate (0.3/2.5 USD per Mtok default).
- **RunContextSnapshot** emitted once per turn for the Inspector panel.

## 5. Agents & sub-agents (`agents/profiles.ts`)
`AgentProfile` presets: models, `toolAllowlist` ceiling, `toolMode`
(`skill_gated | static`), `budgetMode`, `approvalMode`, `maxSteps`, `canDelegate`,
`canSelfEdit`, `nestingDepth` (default 1). `spawn_subagent` recursively runs
`AgentLoop.run()` with decremented depth; child results (messages + usage) return to
the parent. Meta-tools: `create_agent`, `update_agent`, `list_agents`, `spawn_subagent`.

## 6. Approvals & audit
Modes: **ask** (blocking UI), **auto_llm** (cheap ~4-token safety vote), **auto_all**
(auto-approve). Page-extension lifecycle (approve/bridge/inject) **always** asks, even
under `auto_all`. 24 sensitive tools gate on this. Every call is written to the
**action log** (`local/actionLog.ts`, max 2000, secret-redacted).

## 7. Other stores
- **Sessions:** chat history + per-message usage/tools; keyword search.
- **Connectors:** REST + MCP; headers can reference vault secrets (`SecretRef`).
- **RAG:** folder handles + chunked content; hybrid keyword(65%)+hash-vector(35%)
  score. Note: vectors are mock/hash-based — not true embeddings.
- **Vault:** AES-GCM 256 + PBKDF2 100k; single passphrase, no rotation.
- **Page extensions:** source (≤200k), match patterns, approval, `sourceHash`, bridge
  spec, audit (max 5000).
- **Tasks:** kanban `todo/doing/done/blocked`; open tasks injected each turn.
- **Usage:** per-call telemetry, aggregate by model/provider/tool.
- **Attachments:** PDF/CSV/XLSX/text/image; extracted text + image dataUrl for vision.

## 8. LLM client (`llm/openrouter.ts`)
OpenRouter-compatible `chat` / `chatStreaming` with native tool-calling, multimodal
content parts, abort signal, and usage extraction. Default temperature 0.2.

## 9. Data flow (per user turn)
```
user msg
  → assemble system = base + budget addon + memories + open tasks
  → lean history + tools (always-on ∪ unlocked packs, ∩ profile ceiling)
  → OpenRouter (stream) → tool_calls
      → approval gate (sensitive) → executeTool → result (redacted to log)
      → skill_read may unlock more tools mid-run
  → repeat until done or maxSteps
```

## 10. Optimization & fix backlog (prioritized)

### P1 — correctness / reliability
- **Tools file is monolithic** (`browser/tools.ts` ~1000+ lines). Split by category into
  `tools/defs/*.ts` re-exported as `AGENT_TOOLS` for maintainability + discoverability.
- **`toolHints` are unvalidated** — a skill can reference non-existent tools. Validate
  against `AGENT_TOOLS` on `skill_save` and at seed time. _(fixed — see AUDIT)_
- **RAG is not real semantic search** (hash vectors). Ship real embeddings (local model
  or provider) behind the existing hybrid scorer.
- **auto_llm approval is a 4-token verdict** with little context — strengthen the prompt
  or restrict which tools it may auto-approve.

### P2 — robustness / DX
- Element targeting: add stable element hashing + numbered interactive overlays +
  bounding-box filtering (see `docs/RELIABILITY.md`).
- Redaction gaps: nested secrets aren't always caught in the action log.
- Budget mode: some expensive tools (`scrape_pdps`) still run unthrottled.
- No tool success/failure metrics in usage telemetry.

### P3 — polish
- Versioning for skills / agents / memories (currently overwrite-in-place).
- Attachment size limits (IDB quota risk).
- Provider parsing assumes `vendor/model` id format.
- Task priorities / due dates.

Each P1/P2 item is tracked with an owner-ready description in `docs/ROADMAP.md`.

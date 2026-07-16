# Combo-X vs Nanobrowser — gap matrix & roadmap

Reference: [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) (Planner + Navigator, ~20 browser actions, indexed DOM).

## Architecture contrast

| | Nanobrowser | Combo-X |
|---|---|---|
| Agents | Planner (strategy) + Navigator (actions) | Single tool-calling `AgentLoop` |
| Models | Per-agent (strong + cheap) | **v0.3:** orchestrator + worker (`parse_data`) |
| Element targeting | Highlight index | CSS + **index via `get_interactive`** |
| Approvals | URL firewall | Per-action allow box (`ask` / `auto_llm` / `auto_all`) |
| Vault | Provider keys in storage | AES-GCM vault |

Combo-X keeps the single loop + approvals; does **not** clone LangChain Executor. Full Planner↔Navigator is P1 if P0 still burns too many orchestrator turns.

## Capability matrix

| Capability | Nano | Combo-X | Priority |
|---|---|---|---|
| Split models | Planner/Navigator | orchestrator + worker | **P0 (v0.3)** |
| Cheap LLM parse with intent | `extract_content` (disabled upstream) | `parse_data` | **P0** |
| Scroll / wait / find text | yes | `scroll` / `wait` / `find_text` | **P0** |
| Interactive snapshot + index click | yes | `get_interactive` / `click_index` / `type_index` | **P0** |
| In-tab navigate / go_back / close_tab | yes | `navigate` / `go_back` / `close_tab` | **P0** |
| Batch CSS extract | weak | `query_all` + tables | **P0** |
| Full Planner↔Navigator executor | yes | no | P1 |
| Vision screenshots | optional | capture tools + attachments; auto vision loop P2 | P2 |
| Side-panel browser mirror | chat only | **v1.3 Browser preview** (polled `captureVisibleTab`) | P0 shipped |
| Live tabCapture video in panel | — | not yet (P1) | P1 |
| URL firewall | yes | no | P1 |
| Session replay | yes | no | P2 |
| Per-action approval | no | yes | keep |

## v0.3 ship (this release)

- Dual model settings: `openrouter_model` (orchestrator) + `openrouter_worker_model` (default Gemini 3.5 Flash).
- Scrape/nav tools listed above + `parse_data` (worker LLM → JSON rows).
- System prompt steers catalogs toward `query_all` / `scrape_tables` + `parse_data`.

## Later

- **P1:** Planner interval replan loop; URL allow/deny firewall.
- **P2:** Vision tool; session step replay.
- Sync/scale: see [SYNC_AND_SCALE.md](./SYNC_AND_SCALE.md).

# Combo Desktop Gap Analysis — combo-x vs Combo Desktop v0.4.0

**Date:** 2026-08-30  
**Scope:** Research only. Combo Desktop inventory is ground truth from operator (v0.4.0, ~7,500 LOC, Electron, OpenRouter direct). combo-x is this repo (`packages/core/src`, `extension/`).  
**Audience:** Operators deciding what to port from combo-x into Combo Desktop.

---

## Executive summary

Combo Desktop is a polished **Windows-native shell** with voice, UIA guide mode, command policy, and secrets handling that combo-x does not have on Windows. It was written from scratch and **skips years of agent-runtime lessons** baked into combo-x: token accounting, context compaction, loop hardening, browser automation, MCP extensibility, and cross-session telemetry.

The blunt verdict: **Desktop is not a substitute for combo-x today.** It is a complementary overlay assistant. Without porting combo-x's `@combo-x/core` agent runtime (or reimplementing it), Desktop users will hit runaway costs, context failures, agent loops, and an inability to drive the user's real browser — problems combo-x already solved.

Where Desktop is genuinely ahead: **Guide mode** (UIA anchor resolution, click-through overlay, "Do it for me" with password-field refusal), **command execution policy** (injection cut after screen/web reads, workspace-root sandbox), **privacy denied-apps**, and **tray/ghost UX** tuned for Windows.

---

## 1. Top 10 gaps (ranked by daily-user value)

| Rank | Gap | What it is | combo-x location | Port effort | What breaks if missing |
|------|-----|------------|------------------|-------------|------------------------|
| **1** | **Token & cost accounting + hover detail** | Per-turn in/out tokens, USD cost (OpenRouter native or estimate), cache-hit counts, session total, orchestrator vs worker split, last-turn breakdown | `llm/openrouter.ts` (~672 LOC), `extension/sidepanel/App.tsx` (usage footer ~301–3946), `usage/store.ts` (~203 LOC), `UsagePanel.tsx` (~220 LOC) | **1–2 days** (core is portable; UI is React patterns Desktop can mirror) | Users cannot see spend; multi-step agent runs feel "free" until the OpenRouter bill arrives. Operator explicitly flagged this. |
| **2** | **Context compaction & budget mode** | Char-based context cap, hysteretic mid-loop compaction (cache-aware), lean history with tool-result crumbs, budget mode (16 steps, digest-only page reads) | `agent/budget.ts` (~151 LOC), `agent/leanHistory.ts` (~617 LOC), `llm/promptCache.ts` (~105 LOC), `docs/BUDGET.md` | **2–3 days** | Desktop sends **whole history until too long** — guaranteed API failures and cost explosions on long tasks. No prompt-cache discipline. |
| **3** | **Real browser control** | Drive user's Chrome tab: navigate, click, type, scrape, screenshots, tab management via MV3 extension + content scripts | `extension/lib/chrome-bridge.ts`, `extension/background/index.ts` (~960 LOC), `extension/content/content.ts` + `content-handlers.ts` (~1,700 LOC), `browser/tools.ts` (18 browser tools) | **1–2 weeks** (reuse extension; Desktop launches/pairs with it — do not rebuild DOM layer) | Cannot run PageSpeed in user's Chrome, fill web forms, or scrape authenticated sites. Desktop's `read_url` fetches server-side HTML, not logged-in DOM. |
| **4** | **MCP & connector extensibility** | User-configurable REST + MCP connectors; `mcp_list_tools`, `mcp_call`, `rest_request`; GitHub/connector templates | `connectors/`, `browser/tools.ts` (connector tools), `docs/CONNECTORS.md` | **3–5 days** (core stores + loop routing; Desktop needs settings UI) | Fixed 19 skills cap usefulness. No GitHub/Jira/custom API without code changes. Table stakes vs Claude/Raycast/ChatGPT (2025–2026). |
| **5** | **Agent loop hardening** | Repeat-call guard, observation-streak "ACT NOW", verify-before-done, parallel non-sensitive tools, malformed-JSON recovery, cancellation | `agent/loop.ts` (~4,641 LOC), `agent/repeatGuard.ts` (~284 LOC), `agent/loopQuality.ts` (~143 LOC) | **3–5 days** (import `AgentLoop` wholesale) | Agent re-navigates same URL 4×, burns step budget, claims "done" without mutations. Observed failures documented in code comments (Google Play Console 2026-08-01). |
| **6** | **Full tool catalogue (111 tools) + skill gating** | ALWAYS_ON (~60) + skill-gated packs (scrape, RAG, page-ext, media, REST); unlock via `skill_read` | `browser/tools.ts` (111 tools, ~2,449 LOC), `tools/gating.ts` (~274 LOC), `tools/catalog.ts` (~524 LOC), `skills/store.ts` | **1 week** (tools + handlers; many need `BrowserBridge`) | Desktop's 19 skills cover basics only. No scrape tables, page extensions, sub-agents, vision lab, device RAG folder index, etc. |
| **7** | **Edit-and-resend + context inspect** | Edit a user turn → truncates later turns; inspect per-turn system prompt, memories, tasks, tool catalog | `extension/sidepanel/App.tsx` (~3380–3428), `sessions/store.ts` runContext snapshots | **1–2 days** | Linear-only chat; mistakes require new session. Power users lose trust. |
| **8** | **Usage telemetry & analytics** | Cross-session IndexedDB events; aggregate by model/provider; bar charts; JSON export | `usage/store.ts`, `UsagePanel.tsx` | **1 day** | No trend visibility; cannot answer "which model burned my budget this week?" |
| **9** | **Sub-agents & agent profiles** | Multiple agents with different models/tools/budget/approval; `spawn_subagent` with depth limit | `agents/profiles.ts`, `agent/loop.ts` spawn path, `SubagentStrip.tsx` | **2–3 days** | Single monolithic agent config; complex tasks cannot delegate. |
| **10** | **Combo Link / session sync** | Remote chat from portal, encrypted vault sync, approval relay, device presence | `cloud/linkClient.ts`, `cloud/sessionSync.ts`, `docs/COMBO_LINK.md`, `docs/SYNC_AND_SCALE.md` | **1–2 weeks** (partial infra exists; Desktop could be Link client) | Phone/portal cannot continue Desktop sessions. No cross-device vault. |

---

## 2. Full comparison table

| Feature | combo-x | Combo Desktop v0.4.0 | Competitors (2025–26) | Verdict |
|---------|---------|----------------------|------------------------|---------|
| **Token/cost per turn** | ✅ in/out/cache/cost on every assistant turn | ❌ none | Cursor ✅ tokens; Perplexity ✅ credits; Claude ✅ usage ring | **Port #1** — Desktop blind |
| **Cost hover/detail popover** | ✅ session / orch / worker / last turn (`App.tsx` ⋯ button) | ❌ | Cursor (dashboard split); Perplexity thread dropdown | **Port** — exact UX spec below |
| **Context-window meter** | ⚠️ char-based (`Ctx 64k` button), not token-based | ❌ | Claude context row in settings | **Port char meter;** token meter is stretch |
| **History compaction** | ✅ lean history + mid-loop compact + hysteresis | ❌ whole history | Raycast compaction (Aug 2026) | **Port** — Desktop will break on long chats |
| **Budget mode** | ✅ 16 steps, digest-only reads, system addon | ❌ | Unique to combo-x among extensions | **Port** for scrape/multi-page tasks |
| **Model pricing in picker** | ✅ live OpenRouter pricing, 6h cache | ❌ | OpenRouter native | Nice-to-have |
| **Browser: user's real Chrome** | ✅ MV3 extension + content scripts | ❌ | Claude in Chrome ✅ (CDP); Perplexity ✅ (owned Comet) | **Reuse extension** — don't rebuild |
| **Browser: authenticated DOM** | ✅ same tab, cookies, SSO | ❌ `read_url` only | Claude in Chrome ✅ | Critical gap |
| **Guide / click-here overlay** | ⚠️ element picker, no step overlay | ✅ UIA + ring + arrow (Windows) | Hintora ✅; Copilot Vision Highlights ✅ | **Desktop wins** — don't port, learn from it |
| **Screen read** | ✅ screenshot + DOM tools | ✅ UIA tree (~150 ms) | Raycast Screen Awareness; ChatGPT Appshots | Both have; different mechanism |
| **Voice input** | ✅ Azure + wake word + VAD | ✅ ElevenLabs + Azure fallback | Wispr ✅ dictation; Copilot ✅ wake | Desktop voice UX is mature |
| **Voice → auto-send agent** | ✅ wake token → actuation gate | ❌ transcript lands in composer only | Hintora agents | Design choice; Desktop safer default |
| **Skills/tools count** | 111 tools, skill-gated packs | 19 fixed skills | Claude MCP unlimited | **Port gating model** |
| **MCP support** | ✅ stdio + HTTP connectors | ❌ | Raycast ✅ (May 2025); Claude ✅; ChatGPT dev mode ✅ | **Port** — table stakes |
| **Command execution** | ⚠️ via `run_command` tool (mac jarvisd) | ✅ 3-lane policy + injection cut + audit | Copilot Agent Workspace (isolated) | **Desktop wins** on Windows shell |
| **Secrets / vault** | ✅ AES-GCM IDB + cloud vault | ✅ OS keystore + `.vault/` CLI + env inject | Claude connectors OAuth | Both strong; Desktop env-inject is cleaner |
| **Memory** | ✅ keyword inject (24/turn) | ✅ durable memory inject | Claude/ChatGPT/Copilot unified memory | combo-x local-only; competitors cloud-sync |
| **RAG** | ✅ device folder + ns-rag portfolio | ✅ `portfolio_ask` only | Perplexity local folders | **Port device RAG** |
| **Tasks** | ✅ kanban + inject | ✅ due times + OS notifications | — | Parity |
| **Notes** | ⚠️ via memory/artifacts | ✅ quick-capture hotkey | — | Desktop wins UX |
| **Edit-and-resend** | ✅ | ❌ | ChatGPT ✅; Claude ✅ | **Port** |
| **Context inspect** | ✅ full system dump per turn | ❌ | Cursor @ context | **Port** for debugging |
| **Conversation export** | ✅ `export_session` tool | ❌ | Raycast export | **Port** |
| **Branching** | ❌ linear edit-truncate only | ❌ | ChatGPT ✅ | Both lack |
| **Multi-session / multi-window** | ⚠️ sessions drawer, single panel | ❌ single overlay | Claude Cowork sync | Both weak |
| **Sub-agents** | ✅ `spawn_subagent` depth 1 | ❌ | Cursor agents | **Port** |
| **Agent profiles** | ✅ models/tools/budget per profile | ❌ | Cursor modes | **Port** |
| **Page extensions** | ✅ MAIN-world inject + bridge | ❌ | Unique combo-x | Browser-only; skip Desktop |
| **Approval flows** | ✅ ask / auto_llm / auto_all + per-tool policy | ✅ inline + LLM judge + injection cut | Claude auto-approve + classifier | **Merge policies** — Desktop injection cut is valuable |
| **Repeat/loop detection** | ✅ RepeatGuard | ❌ | — | **Port** |
| **Parallel tool calls** | ✅ non-sensitive batch | ❌ sequential implied | — | **Port** |
| **Cancellation / stop** | ✅ AbortController + STOP | ✅ stop everything shortcut | Standard | Parity |
| **Rate-limit backoff** | ❌ surfaces error, no retry | ❌ | Partial elsewhere | Both gap |
| **Telemetry** | ✅ usage + action log | ❌ | Perplexity Analytics | **Port usage store** |
| **Sync / accounts** | ⚠️ Combo Link partial | ❌ | Raycast Cloud Sync (Jul 2026) | Both gap vs market |
| **Offline model** | ❌ | ❌ | — | Neither |
| **Self-documentation** | ⚠️ scattered docs | ✅ `COMBO.md` single source | — | **Desktop wins** — adopt pattern |
| **Tests** | ✅ vitest + playwright | ✅ headed Electron + UIA | — | Both invested |

---

## 3. Port list — lift from combo-x more or less as-is

| Package / path | What to port | Dependencies dragged in |
|----------------|--------------|-------------------------|
| **`@combo-x/core` entire package** | Agent runtime, stores, LLM client | OpenRouter API key; IndexedDB or adapter |
| `packages/core/src/llm/openrouter.ts` | Streaming chat, `LlmUsage`, cost estimation, model list | `fetch`, OpenRouter credentials |
| `packages/core/src/agent/loop.ts` | Full agent loop | `BrowserBridge` impl, stores, OpenRouter client |
| `packages/core/src/agent/budget.ts` | Budget mode + compaction constants | None |
| `packages/core/src/agent/leanHistory.ts` | History shaping | `local/views.ts` (redaction) |
| `packages/core/src/agent/repeatGuard.ts` | Loop detection | None |
| `packages/core/src/agent/loopQuality.ts` | Verify-before-done | `repeatGuard` |
| `packages/core/src/usage/store.ts` | Telemetry persistence | IndexedDB |
| `packages/core/src/protocol/messages.ts` | `SENSITIVE_TOOLS`, `VOICE_FORBIDDEN_TOOLS`, Zod schemas | zod |
| `packages/core/src/tools/gating.ts` | Tool packs + ALWAYS_ON | `browser/tools.ts` names |
| `packages/core/src/tools/catalog.ts` | Tool metadata for prompts | None |
| `packages/core/src/browser/tools.ts` | 111 tool schemas (execution needs bridge) | Platform handlers |
| `packages/core/src/memory/store.ts` | Local memory inject | IndexedDB |
| `packages/core/src/rag/*` | Device folder RAG | File System Access API or Desktop file picker |
| `packages/core/src/nsrag/client.ts` | Portfolio RAG | API keys (Desktop already has) |
| `packages/core/src/sessions/store.ts` | Session persistence + export | IndexedDB |
| `packages/core/src/agents/profiles.ts` | Multi-agent profiles | IndexedDB |
| `packages/core/src/vault/*` | Secret storage patterns | crypto subtle |
| `packages/core/src/cloud/linkClient.ts` | Combo Link client | Cloud API endpoint |
| `extension/` (as companion) | **Do not port — ship alongside** | Chrome/Edge installed |

### Recommended integration architecture

```
Combo Desktop (Electron)
  ├── main/llm.js          → replace with @combo-x/core OpenRouterClient
  ├── main/agent.js        → thin wrapper around AgentLoop
  ├── main/bridge.js       → BrowserBridge → spawn message to combo-x extension
  │                          OR Playwright for headless-only tasks
  └── renderer/            → mirror App.tsx usage footer + approval patterns
combo-x extension (existing)  ← user's real Chrome, logged-in tabs
```

**Minimum viable port (3–5 days):** `openrouter.ts` + `usage/store.ts` + usage UI + `budget.ts` + `leanHistory.ts` wired into Desktop's existing `main/llm.js` call path.

**Full agent parity (2–3 weeks):** Import `AgentLoop` + tool catalogue; ship combo-x extension for browser tools; implement `BrowserBridge` over native messaging to extension.

---

## 4. Do-not-port — browser-specific or superseded

| combo-x feature | Why skip in Desktop |
|-----------------|---------------------|
| **Content script DOM handlers** (`content-handlers.ts`) | Desktop has UIA guide mode; DOM execution belongs in the **extension**, not Electron |
| **Page extensions** (MAIN-world inject + bridge) | Chrome-only; high risk; Desktop has no tab context |
| **Tab pin / `boundTabId`** | Extension session model |
| **Chrome offscreen voice pipeline** | Desktop already has ElevenLabs/Azure; port `voice/vad.ts` + `wakeGate.ts` only if wake→actuation desired |
| **Mac `jarvisd` native host** | Windows uses Desktop's PowerShell UIA sidecar instead |
| **Firefox manifest work** | Irrelevant to Windows Desktop |
| **Element picker overlay** | Extension UX; Desktop guide mode supersedes for Windows native apps |
| **Vision sandbox / UX Vision Lab** | Browser-screenshot specific; Desktop `read_screen` covers native UI |
| **Scrape PDP/catalog pipeline** | Browser-only; port only if extension bridge exists |
| **Direct nanobrowser-style popup UI** | Desktop has its own renderer |

### Where Desktop's approach is better — keep it

1. **Guide mode anchor resolution** — multi-signal scoring beats combo-x's DOM index clicking for native Windows apps.
2. **Command injection cut** — auto-approve blocked after screen/web reads in same turn; combo-x lacks this cross-modality rule.
3. **Secret env-inject** — values never enter model context; combo-x vault resolves into prompts with `{vault:label}` placeholders (more leak surface).
4. **Denied-apps privacy list** — blocks mic/screen before open; combo-x has no equivalent.
5. **Self-doc single source** (`COMBO.md` → Help + skill); combo-x docs are richer but fragmented.
6. **Speech cleanup race** (1200 ms budget) — pragmatic UX combo-x doesn't have.

---

## 5. Competition — what both Combos lack

Features that are **table stakes in 2025–2026** but missing from **both** combo-x and Combo Desktop:

| Capability | Who has it | Gap severity |
|------------|------------|--------------|
| **Account-wide memory across devices** | Claude (2026), ChatGPT, Copilot M365, Raycast Cloud Sync (Jul 2026) | High — both are local-first silos |
| **Visual guidance overlay for web** | Hintora, Copilot Vision Highlights | Medium — Desktop has native; neither has web overlay |
| **Scheduled / recurring agent tasks** | Claude in Chrome (scheduled tasks) | High |
| **MCP marketplace one-click install** | Raycast Registry (May 2025), Claude Desktop Extensions | Medium — combo-x manual config; Desktop none |
| **Isolated sandbox for risky automation** | Copilot Agent Workspace, Perplexity server sandbox | Medium — both run in user context |
| **Rate-limit-aware LLM retry** | Partial (neither implements 429 backoff) | Medium |
| **Conversation branching tree** | ChatGPT | Low |
| **Offline / local model** | Ollama ecosystem | Low for now |
| **GPT-Live / continuous voice conversation** | ChatGPT Voice (Jul 2026) | Medium — both are push-to-talk / dictation |
| **Credit budget alerts / hard caps** | Perplexity, Claude weekly limits | Medium — combo-x shows cost but doesn't block |

### Driving the user's real browser — mechanism comparison

**Operator question:** *"Use my Chrome to run a PageSpeed audit for airon.app"* — how do others do it, and what can Desktop reuse?

| Product | Mechanism | Drives existing Chrome profile? |
|---------|-----------|--------------------------------|
| **Claude in Chrome** | MV3 extension with **`debugger` permission** → Chrome DevTools Protocol attached to tab. Side panel agent sends CDP commands (click, navigate, screenshot). Also `nativeMessaging` declared for Desktop integration. | **Yes** — user's installed Chrome with cookies/SSO |
| **Perplexity Comet** | **Owned Chromium** with force-installed internal extensions; backend WebSocket + extension messaging RPC (`Navigate`, `ReadPage`, `FormInput`). | **No** — separate browser |
| **Raycast AI** | No native browser control; optional **MCP Playwright** or **chrome-devtools-mcp** (often launches fresh browser). | Usually **no** |
| **Hintora** | Desktop **Electron overlay** + vision model on screenshots/UIA-like reads; job posts mention future **injected scripts/DOM overlays** — not shipped as user-Chrome CDP. | **No** (guidance, not automation) |
| **Wispr Flow** | **OS accessibility text injection** — dictation into focused field. Zero browser automation. | **N/A** |
| **ChatGPT Desktop** | **Computer use** (screen + mouse/keyboard) or deprecated Atlas browser; not general user-Chrome CDP. | **Partial** via computer use |
| **Copilot Windows** | **Vision streaming** + Highlights; **Agent Workspace** is isolated session; Web Actions on copilot.com. | **No** for local Chrome CDP |
| **combo-x** | MV3 **service worker → content script** message passing (`chrome-bridge.ts`); DOM tools in page context; no CDP/debugger permission required. | **Yes** |

**What combo-x's extension provides that Desktop should reuse (not rebuild):**

1. **`BrowserBridge` interface** (`packages/core/src/browser/bridge.ts`) — platform-agnostic contract Desktop implements via native messaging to the installed combo-x extension.
2. **Content script execution** — 111 tool schemas route to `content-handlers.ts` for DOM queries, clicks, form fills, scroll, extract — ~1,700 LOC battle-tested.
3. **Tab lifecycle** — `background/index.ts` handles navigate-wait, content-script recovery (`contentRecovery.ts`), screenshots, recording.
4. **Authenticated session** — runs in user's tab with existing cookies; `read_url` cannot do this.
5. **SENSITIVE_TOOLS approval** — already integrated with agent loop.

**Concrete port path for PageSpeed example:**

```
User (Desktop) → AgentLoop → BrowserBridge.navigate("https://pagespeed.web.dev/...")
  → extension background → content script → fill URL → click Analyze
  → screenshot / extract → back to Desktop timeline
```

Desktop should **ship combo-x extension as optional companion** (like Claude in Chrome), not reimplement DOM in Electron `webview` (loses profile, SSO, extensions).

---

## 6. Token/cost display — porting spec

The operator asked for the exact combo-x implementation. Here is the full chain.

### Data shape

```typescript
// packages/core/src/llm/openrouter.ts:72-84
interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  costSource?: "openrouter" | "estimate";
  cachedTokens?: number;
  cacheWriteTokens?: number;
}
```

### Where numbers come from

1. OpenRouter response `usage` block parsed in `OpenRouterClient.chat()` / `chatStreaming()`.
2. **Cost priority:** native `usage.cost` → `costSource: "openrouter"`; else local estimate using `promptUsdPerMTok` / `completionUsdPerMTok` (defaults 0.3 / 2.5).
3. **Cache:** from `prompt_tokens_details.cached_tokens` or top-level `cached_tokens`.
4. Agent loop emits `{ type: "usage", usage, usageSource: "orchestrator" | "worker" | "approval" | "vision_worker" }`.
5. Persisted on `SessionMessage.usage` / `usageWorker`; appended to `UsageStore` IndexedDB.

### UI layers

| Layer | File | Behavior |
|-------|------|----------|
| **Per-turn line** | `App.tsx:3411-3420` | Under each assistant message: `in 12,345 · cache 8,000 · out 456 ($0.012 OR)` |
| **Format helper** | `App.tsx:301-314` | `formatUsageLine()`, `formatUsd()` — 4 decimals if < $0.01 |
| **Session footer** | `App.tsx:3881-3891` | Running total with `title` tooltip explaining OR vs ~ |
| **Hover popover** | `App.tsx:3892-3946` | ⋯ button toggles `usageDetailsOpen`; shows Session, Orchestrator, Worker, Last turn splits |
| **Split aggregation** | `App.tsx:2016-2034` | Event handler buckets `usageSource` into orch vs worker |
| **Analytics tab** | `UsagePanel.tsx` | Bar charts by model/provider; tokens vs spend toggle; JSON export |

### Key types for Desktop renderer

```typescript
type UsageSplit = { total: LlmUsage; orch: LlmUsage; worker: LlmUsage };
// Worker = parse_data, vision_worker, approval LLM calls
// Orchestrator = main agent model calls
```

### Port checklist for Desktop

- [ ] Copy `LlmUsage` + `estimateUsage()` from `openrouter.ts`
- [ ] Emit usage after every LLM call in `main/llm.js` (currently absent)
- [ ] Track `UsageSplit` in renderer state
- [ ] Add `formatUsageLine` + footer + ⋯ popover (plain DOM — no React required)
- [ ] Optional: persist to JSON file under `userData/usage/` mirroring `UsageStore`
- [ ] Show `cache N` when `cachedTokens > 0` — signals prompt-cache hits

### Why it matters (comment worth preserving)

From `packages/core/src/agent/budget.ts:16-24`:

> Prompt caching only pays off while the prompt grows append-only: rewriting the middle invalidates every cached token after the edit. Compacting on every step therefore *costs* money — you pay full price for the whole prompt each turn instead of ~10% for a cache read.

Desktop's lack of compaction **and** lack of cost visibility is a double hit: users pay more AND cannot see why.

---

## 7. Additional high-value combo-x features not in Desktop inventory

Features worth mentioning beyond the operator's known-absent list:

| Feature | Path | Notes |
|---------|------|-------|
| Prompt cache breakpoints | `llm/promptCache.ts` | Anthropic/Qwen explicit; DeepSeek/Moonshot automatic |
| Verify-before-done gate | `agent/loopQuality.ts` | Blocks premature "done" without mutation verify |
| Action log (redacted audit) | `local/actionLog.ts` | 2000 entries; every tool call + approval |
| Per-tool approval policies | `local/approvalPolicy.ts` | "Always allow X on domain Y" |
| Custom user tools | `tools/customStore.ts` | Saved to IDB, merged into catalogue |
| Conversation tasks inject | `tasks/store.ts` | Open tasks prepended each turn |
| Run context snapshots | `sessions/store.ts` | Debug what model actually saw |
| OpenRouter web plugin | `browser/tools.ts` | `web_search` / `web_fetch` server tools |
| Device RAG folder index | `rag/store.ts` | Hybrid keyword + mock-vector search |
| Combo Link remote control | `cloud/linkClient.ts` | Portal drives side panel |
| Wake word actuation gate | `voice/wakeGate.ts` | 60s TTL token before sensitive tools |
| Content script recovery | `extension/background/contentRecovery.ts` | Retry on "Receiving end does not exist" |
| Queue while running | `App.tsx` | Send queues next message during active run |
| Worker/orchestrator split | `models.ts` | Cheap model for parse_data/approval only |

---

## 8. Sources

| Claim | URL | Accessed |
|-------|-----|----------|
| Claude in Chrome GA, CDP/debugger | https://claude.com/blog/claude-in-chrome-generally-available | 2026-08-30 |
| Claude in Chrome permissions table | https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome | 2026-08-30 |
| Claude computer use (Desktop) | https://code.claude.com/docs/en/desktop | 2026-08-30 |
| Claude unified memory (2026) | https://claude.com/blog/claudes-memory-works-everywhere-and-you-decide-whats-in-it | 2026-08-30 |
| Raycast MCP v1.98.0 | https://www.raycast.com/changelog/macos/1-98-0 | 2026-08-30 (ship date 2025-05-08) |
| Raycast Screen Awareness | https://manual.raycast.com/ai/screen-awareness | 2026-08-30 |
| Raycast Cloud Sync | https://manual.raycast.com/cloud-sync | 2026-08-30 (Jul 2026 beta) |
| Raycast request limits (not tokens) | https://manual.raycast.com/ai/usage-limits | 2026-08-30 |
| Cursor MCP guide | https://cursor.com/guides/coding-agent-mcp | 2026-08-30 |
| Cursor usage → tokens (Jul 2026) | https://forum.cursor.com/t/usage-page-to-token-amount-what/167153 | 2026-08-30 |
| ChatGPT Voice + Appshots | https://learn.chatgpt.com/docs/features/voice | 2026-08-30 |
| ChatGPT computer use + Voice rollout | https://9to5mac.com/2026/07/23/openai-updating-chatgpt-desktop-app-with-gpt-voice-for-talking-through-work/ | 2026-08-30 |
| ChatGPT developer mode MCP | https://developers.openai.com/api/docs/guides/developer-mode | 2026-08-30 |
| Perplexity Personal Computer (Windows) | https://www.perplexity.ai/hub/products/computer-for-windows | 2026-08-30 |
| Perplexity credits / analytics | https://www.perplexity.ai/help-center/en/articles/13838041-how-credits-work-on-perplexity | 2026-08-30 |
| Comet browser architecture (extension RPC) | https://labs.zenity.io/post/perplexity-comet-a-reversing-story | 2026-08-30 (2025 publication) |
| Copilot Voice/Vision Windows | https://blogs.windows.com/windowsexperience/2025/10/16/making-every-windows-11-pc-an-ai-pc/ | 2026-08-30 (2025-10-16) |
| Copilot Actions local (Agent Workspace) | https://blogs.windows.com/windows-insider/2025/11/17/copilot-on-windows-copilot-actions-begins-rolling-out-to-windows-insiders/ | 2026-08-30 (2025-11-17) |
| Copilot experimental agentic features | https://support.microsoft.com/en-us/windows/ai/ai-features/experimental-agentic-features | 2026-08-30 |
| Wispr Flow — no integrations needed | https://wisprflow.ai/ | 2026-08-30 |
| Wispr MCP (Notetaker export only) | https://docs.wisprflow.ai/articles/4759919286-how-to-connect-wispr-flow-to-claude-chatgpt-and-other-ai-tools-mcp | 2026-08-30 |
| Hintora product page | https://hintora.ai/ | 2026-08-30 |
| Hintora stack (Electron, Gemini Live) | https://dev.bg/company/hintora/ | 2026-08-30 |
| Hintora browser AI job (extension/inject planned) | https://dev.bg/company/jobads/founding-full-stack-web-developer-browser-ai-hintora/ | 2026-08-30 **[unverified if shipped]** |
| combo-x internal: budget/cache rationale | `docs/BUDGET.md`, `packages/core/src/agent/budget.ts` | 2026-08-30 |
| combo-x internal: sync status | `docs/SYNC_AND_SCALE.md` | 2026-08-30 |
| combo-x internal: feature map | `docs/FEATURES.md` | 2026-08-30 |

---

## 9. Recommended port sequence

1. **Week 1 — Stop the bleeding:** `LlmUsage` + per-turn/footer/popover UI + `UsageStore` equivalent.
2. **Week 1–2 — Context:** `leanHistory.ts` + `budget.ts` + char context limit setting.
3. **Week 2–3 — Agent hardening:** Replace Desktop's direct LLM loop with `AgentLoop`; add `RepeatGuard` + `loopQuality`.
4. **Week 3–4 — Browser:** Publish combo-x extension companion; `BrowserBridge` over native messaging.
5. **Week 4+ — Extensibility:** MCP/connectors, agent profiles, device RAG, Combo Link client.

**Do not** attempt to merge browser DOM execution into Electron. **Do** merge Desktop's command policy injection cut into combo-x's approval layer — that rule is worth backporting.

---

*Generated by combo-x cloud agent. Combo Desktop inventory v0.4.0 treated as authoritative external input.*

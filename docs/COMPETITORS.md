# Competitive Analysis

How Combo-X compares to other open-source browser agents (researched 2026-07).

## Landscape

| Project | Form factor | Multi-agent | Local-first | Firefox | Stars |
|---------|-------------|-------------|-------------|---------|-------|
| **Combo-X** | Chrome MV3 side panel | ✅ sub-agents + meta-tools | ✅✅ | 🟡 in progress | — |
| [nanobrowser](https://github.com/nanobrowser/nanobrowser) | Chrome MV3 | ✅ Planner+Navigator | ✅✅ | ❌ | ~13.5k |
| [browser-use](https://github.com/browser-use/browser-use) | Python SDK + Cloud | ❌ | ✅ SDK / ⚠️ cloud | ✅ via Playwright | ~105k |
| [Taxy AI](https://github.com/TaxyAI/browser-extension) | Chrome MV3 | ❌ | ✅✅ | ❌ | ~1.3k (stale) |
| [Agent-E](https://github.com/EmergenceAI/Agent-E) | Python (AG2) | ✅ | ✅ | ✅ via Playwright | ~1.2k |

## Feature matrix (vs the two most comparable extensions)

| Feature | Combo-X | nanobrowser | Taxy AI |
|---|---|---|---|
| Side-panel UI | ✅ | ❌ (popup) | ❌ (popup) |
| Multi-agent / sub-agents | ✅ | ✅ | ❌ |
| Budget mode + token accounting | ✅ | ❌ | ❌ |
| Local folder RAG | ✅ | ❌ | ❌ |
| Page extensions (MAIN inject + bridge) | ✅ | ❌ | ❌ |
| REST + MCP connectors | ✅ | ❌ | ❌ |
| Usage analytics | ✅ | ❌ | ❌ |
| Turn editing / context inspect | ✅ | ❌ | ❌ |
| Screenshots + tab recording | ✅ | ✅ | ❌ |
| Multi-provider LLM | ✅ (OpenRouter) | ✅ (native multi) | ❌ (OpenAI) |
| Chrome Web Store listing | ❌ | ✅ | ✅ |
| Firefox | 🟡 | ❌ | ❌ |
| Public benchmark numbers | ❌ | ❌ | ❌ |

## Where Combo-X already wins
Budget mode, local RAG, page extensions, MCP+REST connectors, usage analytics, and
turn editing are **unique** among the extension-based competitors. Architecturally
it is the most feature-complete local-first browser extension in this set.

## Gaps to close for "world-class" (prioritized)
1. **Distribution** — no store listing yet; nanobrowser's reach comes largely from
   Chrome Web Store presence.
2. **Native multi-provider** — nanobrowser lets you pick a distinct model per agent
   role directly; Combo-X routes everything through OpenRouter. Add Ollama/local +
   Anthropic/OpenAI direct providers.
3. **Benchmarks** — no competitor publishes strong numbers; being first to publish
   WebArena / Odyssey results is a differentiation opportunity.
4. **Firefox / cross-browser** — in progress here.
5. **Reliability UX** — accessibility-tree DOM representation (like Agent-E/browser-use)
   tends to beat raw scrape for robust element targeting.
6. **Scheduling & headless/CLI** — "run this task every morning"; a Node CLI that
   reuses `packages/core` would open programmatic use.

See `docs/ROADMAP.md` for the sequenced plan.

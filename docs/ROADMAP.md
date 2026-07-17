# Roadmap: making Combo-X a world-class local-first browser assistant

A sequenced plan derived from the audit (`docs/AUDIT.md`) and competitive analysis
(`docs/COMPETITORS.md`). Ordered by leverage.

## Phase 0 — Release readiness (now)
- [x] Autonomous e2e harness with console/error/screenshot capture (`e2e/harness.ts`).
- [x] Firefox build pipeline (`scripts/build-firefox.mjs`, 0 `web-ext lint` errors).
- [x] Graceful degradation for Chromium-only APIs (sidePanel, offscreen, tabCapture).
- [ ] Harden page-ext bridge: rate-limit invalid tokens, cap source size (S1/S2).
- [ ] Vault auto-lock timeout (S4).
- [ ] Replace `innerHTML` in setup page (S5).
- [ ] Chrome Web Store + Firefox AMO listing assets (screenshots, privacy policy).

## Phase 1 — Reliability & reach (0–2 months)
- [ ] **Accessibility-tree DOM mode** alongside scrape for robust element targeting.
- [ ] **Native providers**: direct Ollama (local), OpenAI, Anthropic in addition to
      OpenRouter; per-agent model selection (parity with nanobrowser).
- [ ] Dynamic-import xlsx/pdf to cut the initial bundle (~800 kB deferred).
- [ ] Expand unit coverage on media-bridge + background routing; grow e2e flows.
- [ ] Publish a first benchmark run (WebArena subset) with a reproducible harness.

## Phase 2 — Differentiation (2–4 months)
- [ ] **Task scheduling** ("run every weekday 9am") via `chrome.alarms` + task queue.
- [ ] **Headless/CLI**: a Node entry that reuses `packages/core` for programmatic runs.
- [ ] **Connector marketplace**: shareable REST/MCP connector + agent-profile registry.
- [ ] Persistent, cross-session learned-preference memory (agentic RAG v2).

## Phase 3 — Scale (4+ months)
- [ ] Optional companion web dashboard (task history, exports) — stays local-first.
- [ ] Team/approval workflows for shared task queues.
- [ ] Optional stealth/proxy integration for resilient automation.

## Definition of "release ready" (v1.5)
1. Chrome + Firefox builds load and pass smoke e2e.
2. Page-ext hardening (S1, S2) merged with tests.
3. Store listings prepared with privacy policy reflecting local-first design.
4. Docs complete: architecture, tools, debugging, Firefox, security.
5. CI runs unit + e2e + `web-ext lint` on every PR.

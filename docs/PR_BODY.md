# Release-readiness: audit, Firefox port, autonomous e2e, feature map, hardening

## Summary
Makes Combo-X materially closer to a world-class, release-ready, cross-browser
local-first browser agent. Adds an autonomous test/debug loop, a real Firefox build,
full internal documentation, and several security/quality fixes — all verified.

## What's included

### Autonomous dev/test harness
- `e2e/harness.ts` — launches Chromium with the unpacked extension, resolves the
  extension id, captures page + service-worker console/errors, and dumps
  screenshots + logs on failure.
- `e2e/sidepanel.spec.ts` — asserts the side panel React app mounts with 0 fatal errors.
- `e2e/screens.spec.ts` — drives onboarding and screenshots each tab for review.
- `.vscode/launch.json` + `tasks.json` for one-click debug/build/test.

### Firefox port (0 `web-ext lint` errors)
- `scripts/firefox-manifest.mjs` (pure `toFirefoxManifest`, unit-tested) +
  `scripts/build-firefox.mjs` + `pnpm build:firefox`.
- Guards for Chromium-only APIs (`chrome.sidePanel`, `chrome.offscreen`) so Firefox
  degrades gracefully instead of crashing.

### Documentation
- `docs/FEATURES.md` — authoritative internal feature map (78 tools, skills, memory,
  context management, agents/sub-agents, approvals/audit, all stores, LLM client).
- `docs/AUDIT.md`, `docs/COMPETITORS.md`, `docs/ROADMAP.md`, `docs/FIREFOX.md`,
  `docs/DEBUGGING.md`.

### Security & quality fixes
- Rate-limit invalid page-extension bridge-token attempts (blunts forged-token
  enumeration) in `extension/src/lib/page-ext-inject.ts`.
- `crypto.randomUUID()` for page-ext storage request ids (collision fix).
- Validate skill `toolHints` against real tools (`isKnownTool`) — drops unknowns.
- Log previously-silent `catch {}` blocks in the background service worker.

### CI
- `.github/workflows/ci.yml`: typecheck → unit → Chrome build → Firefox build →
  `web-ext lint` → headless e2e.

## Verification
- `pnpm typecheck` — clean
- `pnpm test` — 160 passed, 6 skipped
- `pnpm build` (Chrome) — ok
- `pnpm build:firefox` + `web-ext lint` — 0 errors
- `pnpm test:e2e` — 6 passed

## Follow-ups (tracked in `docs/ROADMAP.md`)
Element-targeting reliability (stable hashing + numbered overlays + bbox filtering),
real RAG embeddings, native providers (Ollama/OpenAI/Anthropic direct), vault
auto-lock, benchmarks, and store-listing assets.

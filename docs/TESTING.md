# Testing status

Honest map of what is and isn't tested, so gaps are visible rather than hidden.

## Snapshot
- **Unit/integration:** 172 passing (6 skipped LLM-eval), 38 files — Vitest.
- **Statement coverage (`packages/core`):** ~76% (`pnpm test:coverage`).
- **E2E:** 6 passing — Playwright loads the real unpacked extension in Chromium.
- **Firefox:** `web-ext lint` on the generated build — 0 errors.

## Well covered (>80%)
Agent budget, lean history, memory store, skills store (+ toolHints validation),
tool gating/catalog/pickTools, connectors (REST resolve/request incl. error &
missing-secret paths, MCP), vault (AES-GCM), sessions, usage, tasks, views,
RAG search/table/chunk, page-extension match/store/throttle, Firefox manifest
transform, several sidepanel helpers.

## Intentionally not unit-tested
| Area | File | Why | Covered by |
|------|------|-----|------------|
| MAIN-world injector | `pageExtensions/inject.ts` (6.8%) | Runs inside the page via `chrome.scripting`; not meaningful in jsdom | e2e / manual |
| Type-only modules | `pageExtensions/types.ts` (0%) | No runtime code | n/a |
| E2E helper | `e2e/harness.ts` | Is itself test tooling | used by e2e |

## Real gaps to close (prioritized)
1. **`agent/loop.ts` (53%)** — the orchestrator. Has 24 integration tests but many
   branches (approval modes, sub-agent delegation, budget rewrites, tool_locked
   paths, max-steps) are uncovered. _Highest value._ Add focused tests with a fake
   LLM + fake bridge for each branch.
2. **`media/capture.ts` (45%)** — screenshot tiling/stitching. Needs canvas/offscreen
   mocks; add pure-function tests for `stitchTilesVertically` and crop math.
3. **`rag/folder.ts` (30%)** — folder indexing. Add tests with a fake
   `FileSystemDirectoryHandle` to cover chunk/index/exclude logic.
4. **`local/artifacts.ts` (54%)** — reminders/bookmarks/reports. Add store tests for
   due-reminder selection and pruning.
5. **`attachments/parse.ts` + `store.ts` (~64%)** — cover CSV/XLSX branches and the
   truncation path.
6. **UI (React panels)** — mostly untested beyond a few helpers. Grow e2e flows
   (onboarding → chat → tabs already scripted) and add component tests for
   `SettingsPanel`, `UsagePanel`.

## How to run
```bash
pnpm test              # unit/integration
pnpm test:coverage     # + coverage table (needs @vitest/coverage-v8)
pnpm test:e2e          # Playwright, real extension in Chromium
```

## Regenerating screenshots
`pnpm test:e2e` runs `e2e/screens.spec.ts`, which drives onboarding and writes
per-tab PNGs to `e2e/artifacts/`. Curated copies live in `docs/images/` and back
the [USER_GUIDE](./USER_GUIDE.md).

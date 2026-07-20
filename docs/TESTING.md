# Testing status

Honest map of what is and isn't tested, so gaps are visible rather than hidden.

## Snapshot (1.6.54)

- **Unit/integration:** Vitest (`pnpm test`). Page-bubble experiment removed.
- **E2E:** Playwright loads the real unpacked extension in Chromium (`pnpm test:e2e`).
- **Firefox:** `pnpm build` → `extension/dist-firefox`; `web-ext lint` expected 0 errors.

## Well covered

Agent budget, lean history (+ mid-loop `truncateToolResultForLlm`), memory store, skills store
(+ seed revision / pack hints / `combo-self-improve`), tool gating/catalog/pickTools/promptCatalog,
connectors (REST/MCP + `ensure_github`), vault AES-GCM + registry + recipes, setupPack,
vaultAdmin (put/delete/upsert/bundle), dispatchCursor (success, missing key, bad repo, HTTP error),
CloudClient / LinkClient / sessionSync / connectionProbe, modelPickerCache,
Firefox manifest transform, several sidepanel helpers.

## Today’s stack coverage notes

| Area | Tests |
|------|--------|
| Mid-loop truncate | `leanHistory.test.ts`, budget midLoop caps |
| Multi-vault / recipes / setup pack | `registry`, `recipes`, `setupPack`, `vaultAdmin` |
| Combo Link client | `linkClient.test.ts` |
| Model picker cost migrate | `modelPickerCache.test.ts` |
| Self-improve dispatch | `dispatchCursor.test.ts` + gating/store seeds |
| Sync history keep (API) | `ns-infra/.../history_keep_test.ts` (platform) |

## Intentionally not unit-tested

| Area | Why | Covered by |
|------|-----|------------|
| MAIN-world injector | Runs via `chrome.scripting` | e2e / manual |
| Parallel tool `Promise.all` branch in loop | Orchestration timing | Integration loop tests + manual |
| Type-only modules | No runtime | n/a |

## How to run

```bash
pnpm test              # unit/integration
pnpm test:coverage     # + coverage table (needs @vitest/coverage-v8)
pnpm test:e2e          # Playwright, real extension in Chromium
pnpm build             # dist + dist-firefox
```

## Regenerating screenshots

`pnpm test:e2e` runs `e2e/screens.spec.ts`, which drives onboarding and writes
artifacts under `e2e/artifacts/`. See [DEBUGGING](./DEBUGGING.md).

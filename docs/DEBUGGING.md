# Debugging & autonomous testing

Combo-X can be developed and verified end-to-end without manually clicking in a
browser. Three loops are available.

## 1. Unit / integration (fast)

```bash
corepack pnpm test          # vitest, packages/core + extension helpers
corepack pnpm test:watch    # watch mode
```

## 2. Live extension in a real browser (Playwright)

```bash
corepack pnpm --filter @combo-x/extension build   # produce extension/dist first
corepack pnpm test:e2e                            # launches Chromium + loads unpacked
```

The harness (`e2e/harness.ts`) launches Chromium with the unpacked extension,
resolves the `chrome-extension://` id from the service worker, and captures:
- page `console` + `pageerror`
- service-worker `console`
- a full-page screenshot + JSON log dump on failure (`e2e/artifacts/`)

`launchExtension()` returns an `ExtensionHarness` you can drive:

```ts
const h = await launchExtension();
const panel = await h.openSidePanel();   // opens src/sidepanel/index.html
// ... interact, assert ...
await h.dump("my-scenario", panel);      // logs + screenshot for inspection
await h.close();
```

Set `COMBO_X_HEADLESS=1` for CI (note: MV3 service workers are flakier headless).

## 3. Interactive dev

```bash
corepack pnpm --filter @combo-x/extension dev   # vite build --watch → extension/dist
```

Then load `extension/dist` at `chrome://extensions` (Developer mode → Load unpacked)
and reload after rebuilds. VS Code launch configs and tasks are provided in
`.vscode/` ("Debug extension in Chrome", "Run e2e (Playwright)").

## Adding autonomous scenarios
Add specs under `e2e/*.spec.ts` using `launchExtension()`. Prefer offline/mocked
flows (no real API key) for CI; gate live LLM runs behind an env var.

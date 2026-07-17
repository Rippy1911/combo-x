# Firefox port

Combo-X targets Chrome MV3 first. A Firefox-compatible build is produced by
transforming the Chrome output — no source fork required.

## Build & load

```bash
corepack pnpm build:firefox        # builds Chrome dist, then writes extension/dist-firefox
```

Load it:
1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `extension/dist-firefox/manifest.json`

Package for AMO:
```bash
npx web-ext build --source-dir extension/dist-firefox
npx web-ext lint  --source-dir extension/dist-firefox   # expect 0 errors
```

## What the transform changes (`scripts/build-firefox.mjs`)
- `background.service_worker` → `background.scripts` (Firefox MV3 event page).
- `side_panel` → `sidebar_action` (same `index.html`).
- Drops Chromium-only permissions: `sidePanel`, `offscreen`, `tabCapture`.
- Adds `browser_specific_settings.gecko` with id, `strict_min_version` and
  `data_collection_permissions` (now required by AMO).
- Preserves all hashed asset paths from the Chrome build.

## Feature parity

| Capability | Chrome | Firefox | Notes |
|---|---|---|---|
| Chat / agent loop / tools | ✅ | ✅ | Core is browser-agnostic. |
| DOM scrape / navigate / click | ✅ | ✅ | Content script + `scripting`. |
| Vault / sessions / RAG / memory | ✅ | ✅ | IndexedDB — identical. |
| REST / MCP connectors | ✅ | ✅ | `fetch`-based. |
| UI surface | side panel | sidebar | Same React app. |
| Screenshots / tab recording | ✅ | ❌ | Needs `offscreen` + `tabCapture`; degrades with a clear error. |

## Known caveats
- Media tools return `media capture unavailable: chrome.offscreen not supported`
  on Firefox — handled gracefully, not a crash.
- `web-ext lint` reports expected `UNSUPPORTED_API` warnings for the guarded
  Chromium-only calls; these are dead paths on Firefox and safe.
- To fully match Chrome media features on Firefox, reimplement capture via
  `tabs.captureVisibleTab` + an in-page canvas (tracked in the roadmap).

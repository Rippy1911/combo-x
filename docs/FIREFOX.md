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
- Strips `use_dynamic_url` from `web_accessible_resources` (Firefox warning).
- Registers `_execute_sidebar_action` so View → Sidebar / shortcut can toggle.
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
- **Reopen after close (Zen/Firefox):** toolbar click prefers `sidebarAction.open()`
  (not `toggle`) and registers the listener once. Chrome still uses
  `sidePanel.setPanelBehavior`. After rebuild, reload the temporary add-on.
  Alternate: menu **View → Sidebar → Combo-X** (`_execute_sidebar_action`).

## Zen / multi-tab (pinned target tab)

Combo-X is one extension instance per browser profile. DOM tools default to the
**active** tab unless the chat has a **pinned tab** (`boundTabId`).

Recommended Zen workflow for “chat about site A while typing in Combo”:

1. Open the target site in **window A** (or a split pane).
2. Open Combo sidebar (same profile).
3. In Chat, click **Pin tab** — tools/navigate hit that `tabId` **without**
   calling `activate_tab` (sidepanel keeps focus).
4. Optional: put Combo in a second window so the site stays fully visible.

Do not expect two independent sidebars driving two chats in one window without
pin — pin (or `activate_tab`) selects the target. If the pinned tab closes,
Combo clears the bind and falls back to the active tab.

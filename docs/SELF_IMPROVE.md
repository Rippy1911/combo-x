# Combo self-improve (Cursor dispatch)

Combo can audit itself and open PRs on **`Rippy1911/combo-x`** via the Cursor Cloud Agents API.

## Setup (once)

1. Mint a Cursor API key (Cursor dashboard → API / Cloud Agents).
2. Unlock Combo vault → add secret label **`cursor_api_key`** (aliases: `CURSOR_API_KEY`, `cursor_key`).
3. Reload the extension build that includes **`dispatch_cursor_agent`** (≥ **1.6.52**).

## Chat prompt

```
Audit yourself. skill_read combo-self-improve. Rank the top fixes/improvements for Rippy1911/combo-x, then dispatch_cursor_agent for each (one focused PR). Tell me each watchUrl and when to reload the Firefox temp add-on (dist-firefox) after I merge.
```

## Operator loop

1. Approve `dispatch_cursor_agent` if your approval mode asks.
2. Watch agents / PRs at the `watchUrl` Combo returns.
3. Merge PRs → on the Mac: `cd combo-x && pnpm build` (or pull a release) → **Reload Temporary Add-on** pointing at `extension/dist-firefox/manifest.json`.
4. Continue in Combo chat (“PRs merged, reloaded — continue”).

## Vs combo-repo-ops

| Path | When |
|------|------|
| `dispatch_cursor_agent` + `combo-self-improve` | Multi-file, tests, real refactors |
| `combo-repo-ops` + GitHub Contents API | Tiny one-file patch only |

Never echo vault secrets in chat or commits.

## Use cases

### Audit → N PRs → reload
> “Audit yourself and dispatch fixes.” Combo ranks issues, calls `dispatch_cursor_agent` once per focused PR, returns `watchUrl`s. You merge, `pnpm build`, Reload temp add-on, then “continue.”

### Missing Cursor key
> Dispatch fails with a clear vault hint. Add `cursor_api_key` once; do not paste the key into chat.

### Tiny vs Cursor path
> One-line docs typo → `combo-repo-ops` Contents API. Anything needing tests/CI → Cursor dispatch.

### Wrong repo
> Pass `repo: "Rippy1911/other"` only when the user names it; default stays `Rippy1911/combo-x`.

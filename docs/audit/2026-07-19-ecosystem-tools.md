# Ecosystem audit notes — tools.ts (2026-07-19)

Agent-driven read of `Rippy1911/combo-x` via GitHub Contents API (equivalent to
Combo `rest_request` on a GitHub REST connector).

## Auth smoke

- `GET /user` succeeded as **Rippy1911** (gh CLI / PAT-backed API).
- Combo-side equivalent once vault has the PAT:
  1. `skill_read combo-rest` (unlocks rest pack)
  2. `ensure_github_connector({ connectorId: "gh", vaultLabel: "github_pat" })`
  3. `rest_request({ connectorId: "gh", method: "GET", path: "/user" })`

> `ensure_github_connector` / `list_connectors` / `save_rest_connector` ship in
> **PR #4** (`feat/v1.6.41-agent-connectors-ux`), not yet on `main` as of this note.
> Until #4 merges, create the `gh` connector in Settings → Connectors with
> `Authorization: Bearer {vault:github_pat}` and base `https://api.github.com`.

## Source of truth

| Field | Value |
|-------|--------|
| Path | `packages/core/src/browser/tools.ts` |
| Ref | `main` @ Contents API |
| SHA | `2f2474340ac33342a8d0d44e1f96b2922fcb095f` |
| Size | 56487 bytes |
| Tool count (`name:` entries) | **87** on `main` · **93** on PR #4 tip |

## Gaps spotted (main vs PR #4)

| Capability | `main` | PR #4 |
|------------|--------|-------|
| `rest_request` / `skill_read` | yes | yes |
| `export_session` | no | yes |
| `list_connectors` | no | yes |
| `save_rest_connector` | no | yes |
| `ensure_github_connector` | no | yes |

## Next audit targets (after #4 merge)

1. Confirm TOOL INDEX stays uncapped under budget mode (Context panel).
2. Dogfood: vault `github_pat` → `ensure_github_connector` → Contents API read of this file.
3. Map skill packs (`combo-rest`, `combo-repo-ops`) to TOOL_PACKS.rest unlock set.


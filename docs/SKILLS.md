# Skills (v1.6.53)

Playbooks unlocked via `skill_search` → `skill_read`. Local IDB only today — no Combo API until CloudClient + sign-in.

## OOTB seeds (17)

| Skill | Unlocks | Notes |
|-------|---------|--------|
| `combo-scrape` | scrape pack | Catalog/PDP/login |
| `combo-rest` | rest/mcp pack | Saved connectors |
| `combo-rag` | rag pack | Folder KB + attachments |
| `combo-page-ext` | page-ext pack | MAIN-world userscripts |
| `combo-media` | media pack | Screenshots / recording |
| `combo-ux-critique` | — | Vision Lab playbook (always-on tools) |
| `combo-tasks` | — | Task board (always-on) |
| `combo-memory` | — | Remember / bookmarks (always-on) |
| `combo-subagent` | — | Spawn workers (always-on) |
| `combo-vault-setup` | — | First-run vault guidance |
| `combo-map` | — | Map reports + uploads |
| `combo-uploads` | — | `publish_upload` playbook |
| `combo-ns-food` | rest/mcp pack | Nutrition REST |
| `combo-pdf-attach` | — | Attachments flow; use combo-rag for attach tools |
| `combo-openapi-call` | rest/mcp pack | Spec-aware REST (same pack as combo-rest) |
| `combo-repo-ops` | rest/mcp pack | Tiny GitHub Contents PRs |
| `combo-self-improve` | — | Cursor Cloud Agent dispatch (`dispatch_cursor_agent` always-on); see [`SELF_IMPROVE.md`](./SELF_IMPROVE.md) |

Missing seeds are upserted by name on store open (existing installs get new rows without wiping custom skills).

## Future (after sign-in)

Hybrid registry search + `skills` sync scope — see portfolio `_memory/combo-skills-registry-design.md`.

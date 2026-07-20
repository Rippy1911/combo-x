# Combo-X — Multi-vault, disk backup, Combo Cloud

Version: **1.6.53+**

## Startup (no LLM key)

Onboarding is **passphrase + vault name / select** only. Add OpenRouter (or other) API keys later in **Settings → LLM provider**.

## Local vaults

- Registry in `localStorage` (`combo_x_vault_registry`).
- Each vault is its own IndexedDB (`combo_x_vault_<id>`; legacy `combo_x_vault` migrates as **Default**).
- Create multiple vaults; switch / rename / sync from the **Vault** tab after unlock (re-unlock required when switching).
- Connectors may carry `vaultId` so **private** vs **work** hosts stay isolated.

## Disk folder

Extensions cannot bind a free path like `/Users/…`.

**Choose disk folder…** uses the **File System Access API** (browser folder grant). Combo writes `vault-pack.json` (sealed ciphertext pack). Prefer **Reload** (not Remove) on Firefox temporary add-ons so IndexedDB + folder grants survive.

## Combo Cloud

- Default API: `https://api.combo.nextsolutions.studio`
- Scope `vault` — multi-vault **vault pack** (sealed AES-GCM). Server never sees passphrases.
- Scope `setup` — **sealed setup pack** (connectors with `{vaultLabel}` refs only), encrypted with the unlocked vault KEK.
- Connect: paste `cmb_sync_…` in the **Vault** tab → Combo Cloud, or Pull from Cloud on the unlock screen.
- **Push / Pull vault + setup** from the Vault tab after unlock.

### Sync history

- Each push archives the previous tip into `sync_blob_revisions` (when keep &gt; 0).
- Defaults: **free keep 5**, **pro keep 30** prior revisions (+ tip). Set keep to **0** for tip-only (no dated restores).
- Vault UI → **History…** lists versions by date → **Restore** pulls that version.
- API: `GET /v1/sync/history?scope=vault`, `GET /v1/sync/pull?scope=vault&version=N`, `PATCH /v1/sync/settings` `{ sync_history_keep }`.

### Personal recipes (no native product code)

Named bundles of vault labels + REST connectors (see `packages/core/src/vault/recipes.ts`):

| Vault | Contents |
|-------|----------|
| **private** | `openrouter_api_key`, `ns_food_key` + `ns-food`, `anatome_api_key` + `anatome`, `fc_uploads_key` + `ns-uploads` (maps) |
| **work** | `ideaforge_shared_api_key` + `ideaforge`, `github_token` + `github-rest`, `ns_exec_token` + `ns-exec`, **`cursor_api_key`** (self-improve → Cursor Cloud Agents; see [`SELF_IMPROVE.md`](./SELF_IMPROVE.md)); RAG stays a local folder grant (`rag_project_hint` note) |

Apply from Cursor (Combo Link online, vault unlocked):

```bash
# List device_id from Vault → Combo Link or:
curl -sS -H "Authorization: Bearer $COMBO_SYNC_TOKEN" \
  "$COMBO_API_BASE/v1/link/devices"

cd combo-x
node scripts/apply-vault-recipe-via-link.mjs --recipe private --device <device_id> --push
node scripts/apply-vault-recipe-via-link.mjs --recipe work --device <device_id> --push
```

Secrets are read from the portfolio `.env` and sent only as Link command payloads to the unlocked desktop.

### Combo Link vault-admin

Unlocked desktop with Link enabled can apply:

| Command | Effect |
|---------|--------|
| `vault.put_secrets` | Write labels |
| `vault.delete_secrets` | Remove labels |
| `setup.upsert_connectors` | Put REST/MCP defs (vault refs only) |
| `setup.apply_bundle` | Recipe + secrets |
| `sync.push_now` | Push vault + setup |
| `sync.restore_version` | Pull historical ciphertext |

Cloud still never holds the passphrase. Full Link doc: [`COMBO_LINK.md`](./COMBO_LINK.md).

### Advanced — custom API URL / LAN

- **Vault gate** and **Vault → Combo Cloud → Show advanced**: set API base to
  `http://<lan-ip>:8050` (or leave prod default).
- **Test API** probes `GET /v1/health`.
- Full guide: [`docs/LOCAL_NETWORK.md`](./LOCAL_NETWORK.md).

Mint a test token:

```bash
cd combo-x
node scripts/mint-combo-sync-token.mjs you@example.com
```

## Use cases

### Private vs work
> Keep personal nutrition/maps keys in **private**; GitHub / IdeaForge / ns-exec in **work**. Switch vaults after unlock (re-unlock required). Apply recipes via Link when the desktop is online.

### Accidental overwrite → History restore
> You Push a bad setup pack. Vault → **History…** → Restore an earlier version. Keep limits: Free ≤5 / Pro ≤30 (or `sync_history_keep`).

### Cursor as vault admin
> With Link on + sidepanel open, `apply-vault-recipe-via-link.mjs` enqueue secrets/connectors onto the unlocked laptop — cloud still never holds the passphrase.

### Self-improve key lives in work
> Store `cursor_api_key` on the work vault next to `github_token` (see [`SELF_IMPROVE.md`](./SELF_IMPROVE.md)).

## Threat notes

- Sync token in `localStorage` (`combo_x_cloud_config`) so Pull works before unlock; mirrored into the vault when unlocked.
- Sealed export is ciphertext-only; wrong passphrase cannot open imported vaults.
- Setup pack hosts are sealed with the vault KEK — API stores ciphertext only.

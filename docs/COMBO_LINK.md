# Combo Link — remote control via portal

**Status:** Implemented in combo-x **1.6.48** + combo-platform `/v1/link/*` (deploy + migrate required).

Combo Link lets you drive a **desktop Combo-X** install from the Combo portal (phone or another laptop). The agent loop, DOM tools, and vault stay on the laptop. The portal is a remote cockpit.

This is **not** Pro Steel/Firecrawl “remote tools” (cloud browsers).

## Requirements

1. Combo Cloud connected (sync token in Vault → Combo Cloud).
2. Vault unlocked.
3. **Vault → Combo Link → Enable** (default OFF).
4. Sidepanel **open** (MV3 cannot reliably run the agent from the service worker alone).
5. Portal logged in with magic link (`cmb_portal_…`).
6. API schema migrated (Link tables) and service restarted.

## Privacy / threat model

| Data | Visibility |
|------|------------|
| Vault secrets / passphrase | Device only (ciphertext sync) |
| Encrypted `session:{id}` sync blobs | Opaque to API (base64 JSON transport) |
| **Live Link events + portal session snapshots** | **TLS + account auth** — Combo Cloud can see chat text while relayed |

Do not enable Link on a shared/untrusted account if chat content is sensitive.

## Online definition

Device shows **Online** when:

- `link_enabled` heartbeat is true, and
- last heartbeat within **45 seconds**, and
- for sends: `sidepanel_open` is true.

Header chip: `Link·on` when online.

## Flows

### Presence

Extension heartbeats every ~20s while Link is enabled and the sidepanel is open. Closing the sidepanel / disabling Link advertises offline.

### History

- **Portal:** plaintext snapshots via `POST/GET /v1/link/sessions` (pushed after persist).
- **Second Combo install:** opt-in **Sync chats** pushes `sessions_manifest` + `session:{id}` scopes.

### Live chat

1. Portal `POST /v1/link/commands` (`chat.send` / `session.create` / `chat.abort` / `approval.respond`).
2. Extension long-polls `GET /v1/link/commands/poll`.
3. Extension runs `AgentLoop` / `send()`; mirrors `AgentEvent`s to `POST /v1/link/events`.
4. Portal subscribes with fetch-SSE to `GET /v1/link/events/sse`.

Rate limits: **60 commands/hour** (free), **600** (pro).

### Approvals

Sensitive tools emit `tool_approval` on the Link event stream. Portal or laptop can Allow/Deny (`approval.respond`). Timeout remains local agent policy (deny if ignored).

### Vault-admin (1.6.51+ / API 0.3.0+)

Unlocked desktop applies structured patches (cloud stays ciphertext-only). Auth: **portal_token or sync_token**.

| type | payload |
|------|---------|
| `vault.put_secrets` | `{ items: [{ label, value }] }` |
| `vault.delete_secrets` | `{ labels: string[] }` |
| `setup.upsert_connectors` | `{ connectors: Connector[] }` |
| `setup.apply_bundle` | `{ recipeId: "private"\|"work", secrets?: Record<label,value> }` |
| `sync.push_now` | `{ scopes?: ["vault","setup"] }` |
| `sync.restore_version` | `{ scope, version }` |

Cursor helper: `combo-x/scripts/apply-vault-recipe-via-link.mjs`.

## Extension UI

- **Vault tab → Combo Link** — enable, sync chats, pull chats, status.
- Header **Link·on** when heartbeating.
- User turns from portal badged `link`.
- **Vault → History…** for dated restore; **Push vault + setup** for connectors.

## API

Contract: `ns-infra/services/combo-platform/docs/API.md` § Combo Link + Sync history.  
Deploy: migrate `schema.sql` (Link + `sync_blob_revisions`) then recreate `combo-api` (v0.3.0+).

Smoke HTML (portal token): portfolio `_artifacts/combo-link-portal-smoke.html`.  
Portal Base44 paste delta: portfolio `_memory/combo-portal-link-fable-delta.md`.

## MCP / Cursor adapters (later)

Parked MCP `chat.send` / live-debug bus should reuse the same command envelope (`LinkCommand` types) as a second adapter over `LinkClient` — not a separate protocol.

## Use cases

### Drive laptop from phone
> Enable Link on the desktop sidepanel, keep it open, send `chat.send` from the portal. Approvals can answer from either side.

### Apply vault recipe from Cursor
> Desktop unlocked + Link online → enqueue `setup.apply_bundle` / `vault.put_secrets` with sync token. Ciphertext sync remains separate.

### Keep sidepanel open for Link
> Closing the sidebar stops heartbeats — reopen Combo before relying on portal control.

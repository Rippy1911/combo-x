# Combo-X — Sync & Scale (plan, not implemented)

Status: **plan only.** v0.2 ships local-first: vault secrets are AES-GCM ciphered; chat
sessions, bookmarks, reminders and reports are local plaintext IndexedDB. This doc is the design
for (a) an encrypted blob-sync backend across devices and (b) staying fast when a user has hundreds
of conversations. No code here is wired into the extension yet.

## 0. What is encrypted today

| Store | Where | Encrypted? |
|------|------|-----------|
| Vault secrets (OpenRouter key, model pref) | IndexedDB `combo_x_vault` | **Yes** — AES-GCM 256, key from PBKDF2(passphrase) |
| Chat sessions | IndexedDB `combo_x_sessions` | No (local plaintext) |
| Bookmarks / reminders / reports | IndexedDB `combo_x_artifacts` | No (local plaintext) |
| Setup payload (tool toggles, connectors) | `chrome.storage.local` | No |

The passphrase never leaves the device. The vault blob is ciphertext + salt + iv; without the
passphrase the backend cannot read it.

## 1. Blob-sync backend (basic) — Blocked:infra

Goal: a user unlocks on laptop, chats, then opens on phone and sees the same sessions/vault.

### Object model
- One **device** record per install: `{deviceId, createdAt, label}`.
- One **blob** per (user, scope, version): `users/{userId}/{scope}/{blobId}`.
  - `scope ∈ {vault, sessions, artifacts}`.
  - Blob body = ciphertext (AES-GCM of the JSON of that scope) + `{iv, salt, deviceId, updatedAt, prevVersion}`.
- The user id is a locally-generated random id (no account in v0.2). Auth = a per-user sync token
  minted on first "enable sync" and stored **in the vault** (so it's encrypted at rest).

### Sync protocol (last-write-wins per scope, with version vector)
1. On unlock, client uploads `{scope: vault, version, ciphertext}` only if `version > serverVersion`.
2. On focus, client pulls the latest blob per scope; if `serverVersion > localVersion`, decrypt
   into a temp buffer, **merge** (see below), then write merged back.
3. Merge:
   - `vault`: last-write-wins (secrets are small, single-writer at a time is fine).
   - `sessions`: union by `session.id`, per-session last-write-wins on `updatedAt`.
   - `artifacts`: union by `id`, last-write-wins on `createdAt`.

### Infra options (pick one — this is the blocker)
| Option | Pros | Cons |
|-------|------|------|
| **Cloudflare R2 + Worker** | Cheap, global, no egress fees, we already use CF | Need a Worker + R2 bucket + token minting |
| **Supabase Storage + RLS** | We already use Supabase on other apps; RLS per user | Egress costs; row-level vs blob tradeoff |
| **Tailscale / self-host on the VM** | No third party, full control | User must run a node; not "just works" |
| **GitHub repo as backend** | Zero infra for a single user | Rate limits; not multi-user safe |

**Recommendation:** Cloudflare R2 + a thin Worker (matches the portfolio's CF bias). Blocked on the
operator picking a host + minting a sync-token secret.

### Threat model
- Backend sees only ciphertext + metadata (sizes, timestamps). Acceptable.
- Sync token lives in the vault; a device that unlocks can sync. A revoked device = delete its
  `deviceId` row (server enforces a device list per user).
- No passphrase ever transits.

## 2. Scale — hundreds of conversations

The risk is not storage (a session is ~5–50 KB; 1k sessions ≈ 5–50 MB, fine for IDB). The risks are
**UI latency** and **sync bandwidth**.

### Principles
1. **Never load all sessions into memory.** `SessionStore.list(limit)` already caps at 50; the
   Sessions tab must paginate (offset + limit), not `getAll()`.
2. **Search over an index, not full scans.** Today `search()` loads 200 sessions and tokenizes
   client-side. At 1k+ this is slow. Move to a per-session **summary index**: one small row per
   session `{id, title, updatedAt, totalTokens, topKeywords[], firstUserMsg}`. Search hits the
   index only; full messages load on open.
3. **Sync deltas, not full blobs.** Once the backend exists, sync per-session blobs (changed
   `updatedAt` only), not the whole `sessions` scope. The `sessions` scope becomes a manifest of
   session ids + versions; bodies are per-session blobs fetched on open.
4. **Archive cold sessions.** Sessions untouched >90 days move to a cold store (still in IDB, but
   excluded from the default list + index). A "Show archived" toggle surfaces them.
5. **Compaction.** A long session (100+ turns) gets a rolling summary: every 20 turns, the oldest
   18 are replaced by a single `system` summary message. History sent to the LLM stays bounded.

### Migration path from v0.2
- v0.2: `getAll()` + client tokenize. Fine to ~200 sessions.
- v0.3: summary index + pagination + archive flag (no backend needed).
- v0.4: delta sync per-session blob (needs the §1 backend).

## 3. Decisions needed from the operator
1. Pick a sync host (CF R2 recommended) → unblocks §1.
2. Confirm "no account, local random user id" is acceptable for v0.2 sync, or whether we need a
   real auth path (email/magic link) before sync ships.
3. Encrypt sessions/artifacts at rest on-device before sync, or accept that only the vault is
   ciphered and sessions sync as plaintext-inside-ciphertext (the blob is encrypted regardless, so
   this is mostly a local-theft question, not a transit question).

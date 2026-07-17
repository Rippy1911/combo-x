# Combo-X Security & Quality Audit

_Audited version: 1.4.3 · Full read-only review of `packages/core` and `extension`._

## Summary

Combo-X is an architecturally mature MV3 browser agent with strong crypto (AES-GCM
vault), strict Zod message validation, and no `as any` usage. The main risks are
concentrated in the **page-extension MAIN-world injection path** and **broad host
permissions**. None are critical for the local-first, single-user threat model, but
several should be hardened before password-manager / untrusted-source use cases.

Severity legend: 🔴 High · 🟠 Medium · 🟡 Low · ✅ Good

## Security findings

| # | Sev | Area | Finding | Location |
|---|-----|------|---------|----------|
| S1 | 🟠 | Page-ext bridge | `scriptId` is forgeable; mitigated by a 192-bit per-injection `bridgeToken`, but there is **no rate limiting** on invalid-token attempts and tokens are in-memory only. | `extension/src/lib/page-ext-inject.ts`, `extension/src/content/content.ts` |
| S2 | 🟠 | Code execution | `new Function("ComboX", source)` runs stored page-extension source in the page MAIN world, bypassing CSP. `source` is loaded from IndexedDB without length/AST validation at inject time. | `packages/core/src/pageExtensions/inject.ts` |
| S3 | 🟠 | Permissions | `host_permissions: ["<all_urls>"]` + `<all_urls>` content script is very broad. | `extension/manifest.json` |
| S4 | 🟡 | Vault | Key material is decrypted into memory during tool execution; no auto-lock timeout. Crypto itself (AES-GCM + PBKDF2 100k) is strong. | `packages/core/src/vault/vault.ts` |
| S5 | 🟡 | XSS (dev) | `innerHTML` templating in the setup page uses only static tool names, but is a latent sink. | `extension/setup/main.ts` |
| ✅ | — | Messaging | Every runtime message is validated with a strict Zod discriminated union. | `extension/src/background/index.ts` |

### Recommended hardening
- **S1:** throttle invalid `bridgeToken` attempts per tab; rotate token on failure.
- **S2:** enforce a max source length + hash allow-list before injection; keep the
  existing `sourceHash` approval flow mandatory.
- **S3:** offer an optional "only these origins" mode; document the `<all_urls>` need.
- **S4:** add an optional auto-lock after N minutes idle.
- **S5:** replace `innerHTML` with DOM construction / `textContent`.

## Code-quality findings

- 🟡 Silent `catch {}` blocks swallow errors without logging (reminder polling,
  page-ext auto-inject). Prefer `.catch(console.debug)`.
- 🟡 `JSON.parse` without fallback in the tool picker can throw on malformed LLM
  output. Wrap and default to `{}`. — `packages/core/src/tools/pickTools.ts`
- 🟡 Request IDs use `Date.now()_Math.random()`; prefer `crypto.randomUUID()`.
- 🟡 Magic numbers (size/time limits) are scattered; consider a `constants.ts`.
- ✅ No `as any` / bare `any`. Strong typing throughout.

## Correctness notes
- Page extensions cannot run on `file://` pages (`location.origin === "null"`); this
  is acceptable but should be documented.
- Content-script re-injection only retries on the exact "Receiving end does not
  exist" string; other transient errors do not retry.

## Test-coverage gaps
Well covered: agent loop, vault, connectors, RAG, stores, budget, page-ext match.
Under-tested: **UI panels** (React components largely untested), **media-bridge**
(offscreen/tabCapture), **background service-worker routing**, **Firefox
degradation paths**. See `docs/DEBUGGING.md` for the new e2e harness that begins to
close the UI gap.

## Firefox portability blockers (addressed)
- `chrome.sidePanel` → now guarded; Firefox uses `sidebar_action` (see `docs/FIREFOX.md`).
- `chrome.offscreen` + `chrome.tabCapture` → media capture degrades with a clear
  error on Firefox.
- Manifest transform handled by `scripts/build-firefox.mjs` (0 `web-ext lint` errors).

## Performance
- Large chunks (`index.html` 527 kB, `xlsx` 429 kB, `pdf` 409 kB). Consider dynamic
  `import()` for xlsx/pdf so they load only when an attachment needs them.

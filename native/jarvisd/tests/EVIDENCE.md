# jarvisd evidence — 2026-07-28

Lane F verification of the Combo-X Jarvis native-messaging host (`native/jarvisd`).

## Reproduce

```bash
cd /Users/mymac/projects/base44/combo-x/native/jarvisd
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install pytest
export PYTHONPATH=.

# Unit + e2e framing (needs real macOS APIs for apps/screenshot — run outside sandboxes)
python3 -m pytest tests/ -v

# Host manifest dry-run (no writes)
./install.sh --dry-run
```

Stdlib-only alternative (no pyobjc required for unit tests that use fakes):

```bash
cd /Users/mymac/projects/base44/combo-x
python3 -m unittest discover -s native/jarvisd/tests -t native/jarvisd -v
```

## Pytest counts

| When | Result |
|------|--------|
| Before daemon fixes | **47 passed, 0 failed** (existing suite only) |
| After fixes + new e2e | **49 passed, 0 failed** |

New tests: `tests/test_native_framing.py` (2 cases).

## Ops proven working vs Blocked-on-TCC

Wire op names (no `mac_` prefix in this daemon).

| Op | Status | Evidence |
|----|--------|----------|
| `ping` | **Working** | E2E + live `Server.handle` → `ok:true`, version/pid/capabilities |
| `mic_owner` | **Working** | E2E handshake id match → `{owner, listening}` |
| `apps` | **Working** | E2E → non-empty running-app list (14 apps on probe host) |
| `list_dir` / `read_file` (allowlisted) | **Working** | E2E read of tempfile under configured roots |
| `list_dir` / `read_file` (outside roots) | **Working (deny)** | `/etc` → `denied:path` |
| `screenshot` (display) | **Working** | Live probe → PNG dataUrl 320×207 (Screen Recording already granted to this python/Terminal context) |
| `screenshot` / `ui_tree` / `focus` on denylisted apps | **Working (deny)** | `1Password` / `Terminal` / `mBank Online` / `Keychain Access` → `denied:sensitive_app` |
| `unknown op` | **Working (error)** | `unknown_op:…`; subsequent `ping` still succeeds |
| malformed JSON frame | **Working (recover)** | `bad_request:invalid_json` response; loop continues |
| truncated frame | **Working (clean exit)** | Process exits 0; no hang/crash |
| `ui_tree` (Finder) | **Blocked: needs TCC grant** | `unavailable:accessibility` + `hint` (AXIsProcessTrusted=false for host python) |
| `click` / `type` / `key` | **Blocked: needs TCC grant** | Same `unavailable:accessibility` + hint (daemon now refuses instead of posting silent no-ops) |
| `focus` (Finder) | **Working** | Activate via NSRunningApplication (no AX trust required on this host) |
| `index_dir` / ambient whisper | **Not exercised live** | Unit-tested; live ingest needs ns-rag + whisper binaries |

### Operator one-time TCC grant

1. Run `./install.sh` (or ensure `.venv` + `run-jarvisd.sh` exist).
2. **System Settings → Privacy & Security → Accessibility** — enable `run-jarvisd.sh` **or** `native/jarvisd/.venv/bin/python3` (whichever Chrome launches).
3. **System Settings → Privacy & Security → Screen Recording** — enable the same binary (needed when capture returns `unavailable:screen_recording` / black frames).
4. Quit Chrome fully (Cmd+Q) and reopen so the native host relaunches under the granted binary.
5. Reload the Combo-X extension and reconnect the native host.

## install.sh / extension ID

- Dry-run validates JSON, absolute `path`, and `allowed_origins`.
- Extension ID is derived from `extension/manifest.json` `"key"` (base64 SPKI DER → SHA-256 → first 32 hex chars → `0-9a-f` mapped to `a-p`).
- **Computed ID:** `lhhciejhfmlkjochjbhlfmlodjplpcjg`
- Manifest origin: `chrome-extension://lhhciejhfmlkjochjbhlfmlodjplpcjg/`
- Absolute host path (dry-run): `/Users/mymac/projects/base44/combo-x/native/jarvisd/run-jarvisd.sh`
- ID matches the pinned public key in `extension/manifest.json` (no hardcoded wrong id).

```bash
./install.sh --dry-run
# ==> Derived extension id ...: lhhciejhfmlkjochjbhlfmlodjplpcjg
```

## Daemon bugs fixed

| File | What was wrong |
|------|----------------|
| `jarvisd/ax.py` | Sensitive-app check ran *after* Accessibility TCC probe, so `ui_tree` on Terminal/1Password returned `unavailable:accessibility` instead of `denied:sensitive_app`. Now denylist-by-name first; TCC errors include an actionable `hint`. |
| `jarvisd/input.py` | `click`/`type`/`key` returned `ok:true` when AX was not trusted (silent ineffective CGEventPost). Now gate on `AXIsProcessTrusted` → `unavailable:accessibility` + hint. |
| `jarvisd/apps.py` | `focus` on a denylisted name that was not running returned `bad_request:no_such_app`. Now refuse sensitive names before lookup. |
| `jarvisd/server.py` | Invalid JSON frames aborted the stdio loop. Recoverable framing errors (`invalid_json` / `not_object`) now write a structured error and continue; truncated/oversized frames still exit cleanly (stream desync). |
| `jarvisd/protocol.py` + `errors.py` | `Unavailable` can carry `hint`; wire responses include it. |
| `jarvisd/capture.py` | `screencapture` CLI unbounded wait could hang the host; now 15s timeout → structured `unavailable:screen_recording` + hint. Black/empty captures also include hint. |
| `install.sh` | Required a manually supplied extension id. Now derives from `extension/manifest.json` key; added `--dry-run`. |

## Acceptance matrix

| Must ship | Evidence |
|-----------|----------|
| Existing pytest suite green | 47→49 passed (`pytest tests/ -v`) |
| Chrome framing e2e (subprocess) | `test_native_framing.py::test_chrome_framing_smoke` PASSED |
| Deny sensitive apps + path ACL | E2E asserts `denied:sensitive_app` / `denied:path` |
| TCC ops clear errors (no crash/hang) | Live probe + `test_tcc_ops_structured_errors` |
| install.sh ID matches pinned key | dry-run → `lhhciejhfmlkjochjbhlfmlodjplpcjg` |
| `.venv` gitignored | `native/jarvisd/.gitignore` |

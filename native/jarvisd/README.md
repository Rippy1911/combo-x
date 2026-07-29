# jarvisd

macOS native-messaging daemon for Combo-X **Jarvis**. Gives the Chrome extension eyes and hands on the Mac: Accessibility UI tree, screenshots, clicks/typing, local ambient transcription, and local file indexing into the portfolio RAG service (`ns-rag`).

Chrome talks to this process over **stdio** with length-prefixed JSON (4-byte little-endian length + UTF-8 body). **Never write logs to stdout** — that channel is the protocol. Logs go to stderr / a rotating file.

## Install

```bash
cd native/jarvisd
export JARVIS_EXTENSION_ID='<your chrome extension id>'
# or: ./install.sh --extension-id '<id>'
./install.sh
```

This creates `.venv`, installs `requirements.txt` (pyobjc), writes `run-jarvisd.sh`, and registers the host manifest at:

`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/studio.nextsolutions.jarvisd.json`

Uninstall the manifest:

```bash
./install.sh --uninstall
```

### macOS permissions

1. **Accessibility** — System Settings → Privacy & Security → Accessibility. Enable `run-jarvisd.sh` (or the venv `python3`). Required for `ui_tree`, `click`, `type`, `key`, `focus`. Without it: `unavailable:accessibility`.
2. **Screen Recording** — same pane → Screen Recording. Required for `screenshot`. Without it captures are empty/black → `unavailable:screen_recording`.

After toggling permissions, quit Chrome fully and reopen so the host is relaunched.

## Config

`~/.config/jarvisd/config.json` (created with defaults on first run):

```json
{
  "roots": ["~/projects", "~/Documents", "~/Downloads", "~/Desktop"],
  "ambient": {
    "enabled": false,
    "bufferMinutes": 5,
    "diaryEnabled": false,
    "diaryDir": "~/projects/base44/_memory/jarvis-diary",
    "whisperBin": null,
    "whisperModel": null
  },
  "indexer": {
    "nsRagDir": "~/projects/base44/ns-rag",
    "debounceMs": 5000
  },
  "micOwner": "offscreen"
}
```

Ambient transcription is **off by default**. Partial user configs deep-merge over defaults.

## Wire protocol

Request: `{ "id": "r7", "op": "ui_tree", "args": { "app": "Safari" } }`  
Success: `{ "id": "r7", "ok": true, "data": { } }`  
Failure: `{ "id": "r7", "ok": false, "error": "denied:sensitive_app" }`

| op | sample args | sample data |
|---|---|---|
| `ping` | `{}` | `{ "version", "pid", "capabilities" }` |
| `ui_tree` | `{ "app": "Safari", "maxNodes": 200 }` | `{ "nodes", "truncated" }` |
| `screenshot` | `{ "mode": "display", "maxWidth": 1280 }` | `{ "dataUrl", "width", "height" }` |
| `click` | `{ "index": 3 }` or `{ "point": { "x", "y" } }` | `{ "clicked": true }` |
| `type` | `{ "text": "hello", "index": 2 }` | `{ "typed": true }` |
| `key` | `{ "combo": "cmd+shift+s" }` | `{ "sent": true }` |
| `apps` | `{}` | `{ "apps": [{ "name", "bundleId", "pid", "frontmost" }] }` |
| `focus` | `{ "app": "Safari" }` | `{ "focused": true }` |
| `list_dir` | `{ "path": "~/Documents", "limit": 200 }` | `{ "entries" }` |
| `read_file` | `{ "path": "~/Documents/note.md", "maxChars": 200000 }` | `{ "path", "text", "truncated" }` |
| `index_dir` | `{ "path": "~/projects/base44/_docs", "watch": false }` | `{ "files", "chunks", "corpus" }` |
| `ambient_recall` | `{ "minutes": 5 }` | `{ "segments", "enabled" }` |
| `ambient_status` | `{}` | `{ "enabled", "bufferMinutes", "diaryEnabled", "model" }` |
| `mic_owner` | `{}` | `{ "owner": "daemon"\|"offscreen", "listening" }` |

`ui_tree` node indices are resolved against the **most recent** tree for `click`/`type`. Stale indices → `bad_request:stale_index`.

Stable errors: `denied:sensitive_app`, `denied:path`, `denied:secure_field`, `denied:typing_target`, `unavailable:accessibility`, `unavailable:screen_recording`, `unavailable:whisper`, `bad_request:<detail>`, `unknown_op:<op>`, `internal:<ExcType>`.

## Security (deny by default)

- **Sensitive apps** (password managers, terminals, System Settings, bank-name patterns) refuse capture and input.
- **Secure fields** (`AXSecureTextField`) refuse typing.
- **Typing** also refuses when the target app is unknown/empty (`denied:typing_target`).
- **Paths** must expand to an absolute path inside configured roots on a **path-segment boundary** (symlink-resolved). Relative paths, `..` escapes, NUL bytes → `denied:path`.
- Ambient buffer is **local-only** — no network sinks in `ambient.py`.

## Tests

Stdlib only — no pyobjc, no pip:

```bash
cd /Users/mymac/projects/base44/combo-x
python3 -m unittest discover -s native/jarvisd/tests -t native/jarvisd -v
```

## What is not implemented yet

- **FSEvents watching** — `index_dir` with `watch: true` registers the path (`pending_paths()`), but filesystem event wiring is a follow-up; re-index is still explicit.
- **Mic ownership handover** — `mic_owner` reports config (`daemon` vs `offscreen`); live handoff between the extension offscreen document and the daemon is not wired yet.
- Real-hardware verification of Accessibility / Screen Recording / whisper.cpp binaries after `install.sh`.

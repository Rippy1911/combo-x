# Voice mode — wake-driven control via Combo-X

> **Brand:** Voice mode · wake phrase **"Hey Combo"**. Technical wake assets still use the openWakeWord `hey_jarvis` model (no `hey_combo` ONNX yet). Wire protocol may still say `jarvis_*` / `JARVIS_*` for compatibility. See also [`COMBO.md`](./COMBO.md).

Wake-word voice assistant. Say **"Hey Combo"** (or the acoustic alias **"Hey Jarvis"** via the wake model), then a command; Combo-X's existing agent
loop plans and acts. Slice 1 acts inside browser tabs. Slice 2 adds whole-Mac vision and
input through a native-messaging daemon (`jarvisd`).

**Panel visibility:** Settings → Voice panel = `auto` (default: hide when `chrome.offscreen` is missing, e.g. Firefox), `show`, or `hide`. The strip also has a Hide button.

Chrome/Chromium for full mic/wake — the Firefox build drops `sidePanel`, `offscreen` and `tabCapture`
(see `FIREFOX.md`); Auto mode hides the Voice strip there so it does not waste space.

---

## 1. Runtime shape

```
mic (offscreen doc, 16 kHz mono)
  └─ WakeWordDetector  (openWakeWord ONNX: melspectrogram → embedding → hey_jarvis)
       └─ on detect: mint wake token, start armed window
            └─ UtteranceEndpointer (energy hysteresis, 700 ms silence / 15 s cap)
                 └─ encodeWav16 → Azure Speech STT (short audio REST)
                      └─ parseWakeUtterance → command text
                           └─ AgentLoop (source: "voice", wakeToken)
                                ├─ browser tools (get_interactive → click_index …)
                                ├─ portfolio_ask / portfolio_search → ns-rag
                                └─ mac_* / index_dir / ambient_recall → jarvisd  (Slice 2)
                                     └─ toSpokenReply → Azure Neural TTS → speaker
```

**Actuation is wake-gated.** A voice-sourced run without a valid, unexpired wake token is
refused before any tool executes. Ambient audio never triggers a tool.

## 2. Speech engine

Azure Speech REST (resource `ns-voice`, `northeurope`, S0) — **not** `ns-voice-rt`, which
exposes only `/v1/rt/token` plus the `/v1/rt/session` call WebSocket and would drag the
receptionist workflow, the Art. 50 disclosure gate and `MAX_CONCURRENT_SESSIONS=2` into a
personal assistant.

Vault labels: `azure_speech_key`, `azure_speech_region` (default `northeurope`).
Add them under **Vault → Add secret** (or Chat → Add secret… → Send). Saving also writes a
**sealed** `chrome.storage.local` backup (same passphrase) so Chrome reloads restore the
labels if IndexedDB is empty. Prefer Chrome unpacked for Combo voice (stable extension id);
Firefox temporary add-ons wipe storage on Remove — use **Reload** or Vault → disk pack.

**Test** on the Voice panel synthesizes a short TTS phrase in the side panel (no mic).
Wake + STT (**Start**) needs Chromium `chrome.offscreen` — use Chrome/Edge; rebuild with
`pnpm build:combo` (alias `pnpm build:jarvis`). Mic capture uses ScriptProcessor (not AudioWorklet): MV3
`script-src 'self'` forbids `blob:` and Chromium rewrites worklet modules through blob URLs.

## 3. Wake model licence — read before packaging

openWakeWord **code** is Apache-2.0, but the **pretrained models** (including
`hey_jarvis_v0.1.onnx`) are **CC BY-NC-SA 4.0** — non-commercial.

- Assets are fetched by `scripts/fetch-wake-models.mjs` into `extension/public/openwakeword/`,
  which is **gitignored**.
- The build only copies them when `JARVIS_DEV_BUILD=1`. A default build ships **zero**
  wake assets, and `packages/core/src/voice/jarvisAssets.test.ts` asserts that (with
  `e2e/jarvis.spec.ts` asserting the same thing against the real built `dist`).
- Commercial unblock: train a custom openWakeWord model (Apache-2.0 output) or licence
  Picovoice Porcupine.

## 4. Knowledge plane

`portfolio_ask` / `portfolio_search` hit **ns-rag** (`https://rag.nextsolutions.studio`,
Neon pgvector over `_docs/` + `_memory/`). Vault labels `ns_rag_api_key`, `ns_rag_base_url`.

Combo's Device RAG (`rag_search`) stays as-is for ad-hoc granted folders — it uses hash
"mock vectors", so it is not the portfolio knowledge plane.

## 5. Native protocol (extension ↔ jarvisd)

Chrome native messaging: 4-byte little-endian length prefix + UTF-8 JSON, on stdio.
Host name **`studio.nextsolutions.jarvisd`**.

```jsonc
// request
{ "id": "r7", "op": "ui_tree", "args": { "app": "Safari" } }
// response
{ "id": "r7", "ok": true, "data": { /* op-specific */ } }
{ "id": "r7", "ok": false, "error": "denied:sensitive_app" }
```

| op | args | data |
|---|---|---|
| `ping` | — | `{ version, pid, capabilities[] }` |
| `ui_tree` | `{ app?, maxNodes? }` | `{ nodes[], truncated }` |
| `screenshot` | `{ mode:"display"\|"window", app?, displayId?, maxWidth? }` | `{ dataUrl, width, height }` |
| `click` | `{ index?, point?, button?, double? }` | `{ clicked }` |
| `type` | `{ text, index? }` | `{ typed }` |
| `key` | `{ combo }` | `{ sent }` |
| `apps` | — | `{ apps[] }` |
| `focus` | `{ app }` | `{ focused }` |
| `list_dir` | `{ path, limit? }` | `{ entries[] }` |
| `read_file` | `{ path, maxChars? }` | `{ path, text, truncated }` |
| `index_dir` | `{ path, watch? }` | `{ files, chunks, corpus }` |
| `ambient_recall` | `{ minutes? }` | `{ segments[], enabled }` |
| `ambient_status` | — | `{ enabled, bufferMinutes, diaryEnabled, model }` |
| `mic_owner` | — | `{ owner:"daemon"\|"offscreen", listening }` |

`nodes[]` element: `{ index, role, title, value, enabled, focused, frame:{x,y,w,h}, app, bundleId }`.
`apps[]` element: `{ name, bundleId, pid, frontmost }`.
`entries[]` element: `{ name, path, isDir, size, mtime }`.

The daemon may also **push** unsolicited frames (no `id`), which the service worker turns
into side-panel events:

```jsonc
{ "event": "utterance", "data": { "text": "click save", "wakeToken": "wk_…", "at": 0 } }
{ "event": "state", "data": { "state": "listening" } }
```

**Microphone ownership.** Only one process may hold the mic. The extension calls `mic_owner`
before starting: when the daemon answers `"daemon"`, the offscreen document does **not** open
the mic, and the daemon is expected to push `utterance` frames. The daemon's own wake-word
pipeline is **not implemented yet** — today it answers `"offscreen"` by default and the
in-browser tier does wake detection. See `native/jarvisd/README.md`.

**Mic grant (Chrome).** Offscreen cannot show the permission prompt — use the setup tab
(“Grant microphone”) once. The service worker must only handle lowercase `jarvis_*`
commands; uppercase `JARVIS_*` is SW→offscreen only (handling both races the mic-check
reply and surfaces a false “Microphone not granted”). Side panel trusts the extension-origin
Permissions API when already `granted`.

Error codes are prefixed and stable: `denied:sensitive_app`, `denied:path`,
`denied:secure_field`, `denied:typing_target`, `unavailable:accessibility`,
`unavailable:screen_recording`, `unavailable:whisper`, `bad_request:<detail>`.

### Not implemented yet

Three things in the tool surface are thinner than they look, and a reader should not
assume otherwise:

- **`index_dir { watch: true }` does not watch.** It records the path in
  `pending_paths()` and runs a one-shot ingest; FSEvents wiring is a follow-up.
- **The daemon has no wake pipeline** and never pushes `utterance` / `state`. Wake
  detection is offscreen-only today, so Combo voice needs Chrome open.
- **Ambient capture is off by default** and reports `unavailable:whisper` until a
  `whisperBin` is configured.

## 6. Safety limits (both slices)

- Voice never reaches shell, secrets, or `chrome://`.
- Sensitive apps (1Password, Keychain Access, Terminal, iTerm, banking) refuse **both**
  capture and input.
- Typing is refused when a secure text field holds focus; ambient capture pauses too.
- File ops are confined to configured allowlist roots; `..` traversal and symlink escapes
  are rejected after realpath.
- Ambient transcript is local-only and in-memory. The diary is opt-in and writes to
  `_memory/jarvis-diary/`.

## 7. Install (Slice 2)

```bash
cd native/jarvisd && ./install.sh          # venv + host manifest for the pinned extension id
```

Grant **Accessibility** and **Screen Recording** to the Python binary in
System Settings → Privacy & Security. Mic is granted once from the extension Setup page.

## 8. Ownership map (parallel build lanes)

| Area | Files |
|---|---|
| Spine (integration) | `packages/core/src/index.ts`, `protocol/messages.ts`, `browser/tools.ts`, `tools/{catalog,gating}.ts`, `agent/loop.ts`, `extension/manifest.json`, `extension/vite.config.ts`, `scripts/fetch-wake-models.mjs` |
| Voice core | `packages/core/src/voice/**` |
| Remote clients | `packages/core/src/nsrag/**`, `packages/core/src/mac/**` |
| Extension plumbing | `extension/src/offscreen/**`, `extension/src/lib/comboVoiceBridge.ts`, `extension/src/background/index.ts`, `extension/setup/**` |
| Side panel UI | `extension/src/sidepanel/ComboVoicePanel.tsx`, `App.tsx`, `toolGroups.ts` |
| Mac daemon | `native/jarvisd/**` |

## Azure verification

Live TTS → STT round trip (same region hosts / headers / SSML as
`packages/core/src/voice/azureSpeech.ts`; TTS requests
`riff-16khz-16bit-mono-pcm` so short-audio STT can consume the bytes without
transcoding — the extension still synthesizes mp3 for playback).

```bash
cd combo-x
node scripts/verify-azure-speech.mjs
```

**Env** (portfolio root `../../.env`, names only): `AZURE_SPEECH_KEY`,
`AZURE_SPEECH_REGION`, optional `AZURE_SPEECH_ENDPOINT`, optional
`AZURE_TTS_FIRST_BYTE_BUDGET_MS` (default `800`, report-only — does not fail
the script).

**Artifacts:** `_artifacts/jarvis-azure-verify/` — `pl-PL.wav`, `en-US.wav`,
`result.json` (no credentials).

**Measured first-byte latency** (2026-07-28, `northeurope`, budget 800 ms):

| Locale | Voice | TTFB | Budget | STT overlap |
|--------|-------|------|--------|-------------|
| pl-PL | pl-PL-ZofiaNeural | 631 ms | MET | 0.75 |
| en-US | en-US-AriaNeural | 246 ms | MET | 1.0 |

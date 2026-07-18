# UX Vision Lab (v1.6+)

Capture → see → critique → annotate → prototype / live CSS proof **inside chat**.

## OOTB behavior

Vision Lab tools are **FORCE_ATTACH**’d into any non-empty tool allowlist (stale Media unchecked / old localStorage cannot hide `ux_critique`). No other Settings required:

| Knob | Default |
|------|---------|
| `autoAttachScreenshots` | `true` |
| `screenshotQuality` | `high` (`draft` / `standard` / `high` / `max`) |
| `critiqueImageDetail` | `high` (vision `image_url.detail`) |
| `maxVisionBytes` | 5 MB (quality preset may raise further up to 8–12 MB) |
| `visionWorkerModel` | `google/gemini-3.5-flash` |
| `interactivePreviewScripts` | `true` (`sandbox="allow-scripts"` only) |
| `enableGenerateMock` | `false` (P1) |

Agent override on `ux_critique` / `screenshot_*`: `quality` + `detail`. Example: `ux_critique({ quality: "max", detail: "high" })`.

## Flow

1. **`ux_critique`** (ALWAYS_ON) or **`screenshot_*`** (combo-media skill) captures PNG/JPEG.
2. Image stored in `AttachmentStore`; tool result is a **stub** (`attachmentId`, `bytes`, `visionAttached`) — never megabase64 in history.
3. Capture also emits a **`preview`** event → **ChatArtifact** image in the turn (+ side drawer).
4. Before the next orchestrator turn, pending vision is flushed **once**:
   - Vision model (preset / OpenRouter / override) → `role:user` with `image_url`.
   - Unknown / non-vision → vision worker critique → text crumb to orchestrator.
5. **`annotate_screenshot`** builds an HTML overlay (markers / boxes) from `attachmentId`.
6. **`open_preview`** surfaces HTML / image / compare. Prefer `attachmentId` / `beforeAttachmentId` / `afterAttachmentId`.
7. **HTML reports with screenshots:** use `<img src="attachment:<uuid>">` or pass `attachmentIds` — runtime embeds data URLs. Prefer CSS-only tabs (`details`/`summary`). `create_report` downloads via data URL (MV3 SW) + opens chat preview. Use **Open tab** for fullscreen.
8. **`page_css_preview`** / **`page_css_clear`** inject ephemeral isolated-world CSS for live before/after.
9. **Assets tab** — browse/delete screenshots + reports from IndexedDB (quota hint in panel). See [`docs/ATTACHMENTS.md`](./ATTACHMENTS.md#storage-limits-indexeddb-vs-folder).

## Dogfood (healthtree.pl)

Reload `extension/dist`, unlock vault, open Chat, prompt:

> Visual UX audit https://healthtree.pl homepage. Use ux_critique, annotate findings on the screenshot, propose one CSS tweak live, re-capture, show before/after compare.

Expected tool sequence:

1. `navigate` → healthtree.pl  
2. `ux_critique({ scope:"viewport", focus:"hero CTA" })` → note `attachmentId` A  
3. (next turn, after vision) critique with numbered findings  
4. `annotate_screenshot({ attachmentId: A, markers:[…] })`  
5. `page_css_preview({ css:"…" })`  
6. `ux_critique` → attachmentId B  
7. `open_preview({ kind:"compare", beforeAttachmentId:A, afterAttachmentId:B })`  
8. `page_css_clear`

Acceptance: chat shows screenshot artifact + annotated overlay + before/after compare; critique text references marker numbers.

## Security

- Interactive HTML uses `sandbox="allow-scripts"` and **never** `allow-same-origin` (enforced + tested).
- Preview CSS: max 20KB; no `@import` / remote `url(https://…)`.

## Skills

- `combo-ux-critique` — mandatory playbook (`toolHints: []`); refreshes on seed revision `v1.6.7`.
- `combo-media` — raw screenshot / recording tools.

## Settings

Side panel → Settings → **UX Vision Lab**.

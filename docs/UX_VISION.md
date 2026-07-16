# UX Vision Lab (v1.6)

Capture → see → critique → prototype **inside chat**.

## OOTB behavior

No Settings required:

| Knob | Default |
|------|---------|
| `autoAttachScreenshots` | `true` |
| `critiqueImageDetail` | `low` |
| `maxVisionBytes` | 1.5 MB |
| `visionWorkerModel` | `google/gemini-3.5-flash` |
| `interactivePreviewScripts` | `true` (`sandbox="allow-scripts"` only) |
| `enableGenerateMock` | `false` (P1) |

## Flow

1. **`ux_critique`** (ALWAYS_ON) or **`screenshot_*`** (combo-media skill) captures PNG/JPEG.
2. Image stored in `AttachmentStore`; tool result is a **stub** (`attachmentId`, `bytes`, `visionAttached`) — never megabase64 in history.
3. Before the next orchestrator turn, pending vision is flushed **once**:
   - Vision model (preset / OpenRouter / override) → `role:user` with `image_url`.
   - Unknown / non-vision → vision worker critique → text crumb to orchestrator.
4. **`open_preview`** surfaces HTML / image / compare as a **ChatArtifact** in the turn (+ side drawer).

## Security

Interactive HTML uses `sandbox="allow-scripts"` and **never** `allow-same-origin` (enforced + tested).

## Skills

- `combo-ux-critique` — playbook only (`toolHints: []`); does not unlock media.
- `combo-media` — raw screenshot / recording tools.

## Settings

Side panel → Settings → **UX Vision Lab**.

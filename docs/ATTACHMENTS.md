# Combo-X — Chat attachments

Upload and parse files in the side panel composer (Attach button, drag-drop, or paste).

## Supported

| Kind | How |
|---|---|
| `.txt` `.md` `.json` `.csv` `.tsv` | UTF-8 text extract |
| `.pdf` | pdf.js text (up to 40 pages) |
| `.xlsx` / `.xls` | SheetJS → per-sheet CSV text |
| Images (`png` `jpg` `webp` `gif`…) | data URL → OpenRouter vision parts |

Limits: 8 MB/file, ~200k chars extract, images ≤4 MB (downscaled when canvas available).

PDF parsing uses pdf.js with a bundled worker (`pdf.worker.min.mjs`). If you see `GlobalWorkerOptions.workerSrc`, reload the unpacked `extension/dist` after rebuild.

## Agent tools

- `list_attachments` — inventory for the session
- `read_attachment` — full/partial extracted text by id or name

On send, Combo-X injects a short inventory + text preview; images go as multimodal `image_url` parts. History strips image bytes after the turn (keeps text).

## Not the same as device RAG

Folder grant (`rag_*`) indexes a local repo. Attachments are per-chat uploads stored in IndexedDB `combo_x_attachments`.

## Assets tab (browse / delete)

Side panel **Assets** lists screenshots (Vision Lab), chat uploads, and HTML reports (`combo_x_artifacts` / `reports`). Preview, open in a tab, or delete individual / bulk items. Shows approximate Combo footprint + `navigator.storage.estimate()` for the extension origin.

## Storage limits (IndexedDB vs folder)

| Layer | Reality |
|-------|---------|
| Per-file parse caps | 8 MB/file · images ≤4 MB (see above) |
| Origin quota | Shared Chrome quota for the extension origin — often **tens to hundreds of MB**, sometimes more. Eviction under disk pressure is possible. Not a durable archive. |
| Screenshots / reports | Stored as data URLs / HTML in IDB — grow fast during audits. Use Assets → Delete when done. |
| Downloads | `create_report` / export still write via the browser download path (user Downloads folder). |

**Ask the user for a directory?** Optional **P1**, not required for typical audit volumes:

- **Yes, later** — File System Access (`showDirectoryPicker`) or a remembered RAG-style folder for bulk PNG/HTML archives that should survive quota pressure and be opened outside Combo.
- **Not instead of IDB** — keep IDB for fast in-chat preview + agent `attachmentId` resolution; directory export is for long-term / large sets.

Recommendation: ship Assets delete + quota hint first; add “Save assets to folder…” when operators regularly hit quota or want offline report packs.

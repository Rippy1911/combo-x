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

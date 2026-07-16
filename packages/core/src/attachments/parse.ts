/** Local attachment parsers — PDF / spreadsheets / text / images. */

export type AttachmentKind = "pdf" | "xlsx" | "csv" | "txt" | "md" | "json" | "image" | "other";

export interface ParseResult {
  kind: AttachmentKind;
  mime: string;
  /** Extracted text (docs/sheets); empty for pure images */
  text: string;
  /** data: URL for images (vision) */
  dataUrl?: string;
  meta: Record<string, string | number | boolean>;
  truncated: boolean;
  error?: string;
}

export const ATTACH_MAX_BYTES = 8_000_000;
export const ATTACH_MAX_TEXT = 200_000;
export const ATTACH_MAX_IMAGE_BYTES = 4_000_000;
export const ATTACH_MAX_PDF_PAGES = 40;
export const ATTACH_INLINE_PREVIEW = 4_000;

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "jsonc", "log", "yml", "yaml"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

function extOf(name: string): string {
  const base = name.split("/").pop() ?? name;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Blob | bytes — jsdom Blob often lacks arrayBuffer/text; Response polyfill works. */
export type BinarySource = Blob | ArrayBuffer | Uint8Array | ArrayBufferView;

async function readBytes(source: BinarySource): Promise<Uint8Array> {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    if (typeof source.arrayBuffer === "function") {
      try {
        return new Uint8Array(await source.arrayBuffer());
      } catch {
        /* fall through */
      }
    }
    if (typeof Response !== "undefined") {
      return new Uint8Array(await new Response(source).arrayBuffer());
    }
  }
  throw new Error("Unsupported binary source");
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function truncateText(text: string, max = ATTACH_MAX_TEXT): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

function itemStr(item: unknown): string {
  const str = (item as { str?: unknown }).str;
  return typeof str === "string" ? str : "";
}

export function detectKind(name: string, mime: string): AttachmentKind {
  const ext = extOf(name);
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (
    m.includes("spreadsheet") ||
    m.includes("excel") ||
    ext === "xlsx" ||
    ext === "xls"
  ) {
    return "xlsx";
  }
  if (m === "text/csv" || ext === "csv" || ext === "tsv") return "csv";
  if (ext === "md" || ext === "markdown" || m === "text/markdown") return "md";
  if (ext === "json" || ext === "jsonc" || m.includes("json")) return "json";
  if (m.startsWith("text/") || TEXT_EXT.has(ext)) return "txt";
  return "other";
}

/** Set from the extension entry (Vite `?url` import) before parsing PDFs in Chrome. */
let pdfWorkerSrcOverride: string | null = null;

export function setPdfWorkerSrc(url: string): void {
  if (url) pdfWorkerSrcOverride = url;
}

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: unknown) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> }> };
};

async function ensurePdfWorker(pdfjs: PdfJsModule): Promise<void> {
  if (pdfjs.GlobalWorkerOptions.workerSrc) return;
  if (pdfWorkerSrcOverride) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrcOverride;
    return;
  }

  const chromeApi = (globalThis as unknown as {
    chrome?: { runtime?: { getURL?: (path: string) => string } };
  }).chrome;
  if (typeof chromeApi?.runtime?.getURL === "function") {
    // Copied into extension/public by vite build (fallback if entry forgot setPdfWorkerSrc)
    pdfjs.GlobalWorkerOptions.workerSrc = chromeApi.runtime.getURL("public/pdf.worker.min.mjs");
    return;
  }

  throw new Error(
    "PDF worker missing — call setPdfWorkerSrc() (extension main / vitest.setup) before parsing PDFs",
  );
}

async function readPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
  await ensurePdfWorker(pdfjs);
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, ATTACH_MAX_PDF_PAGES);
  let text = "";
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      text += `${itemStr(item)} `;
    }
    text += "\n";
  }
  return { text: text.trim(), pages: pdf.numPages };
}

async function readXlsxText(
  bytes: Uint8Array,
): Promise<{ text: string; sheetCount: number; rowCount: number }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];
  let rowCount = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws);
    parts.push(`## Sheet: ${name}\n${csv}`);
    rowCount += csv.split("\n").filter(Boolean).length;
  }
  return { text: parts.join("\n\n"), sheetCount: wb.SheetNames.length, rowCount };
}

async function imageDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  const type = mime && mime.startsWith("image/") ? mime : "image/png";
  if (bytes.byteLength > ATTACH_MAX_IMAGE_BYTES) {
    throw new Error(`Image too large (max ${ATTACH_MAX_IMAGE_BYTES} bytes)`);
  }
  // Browser: downscale large images via canvas when available
  if (typeof createImageBitmap === "function" && typeof OffscreenCanvas !== "undefined") {
    try {
      const copy = Uint8Array.from(bytes);
      const blob = new Blob([copy], { type });
      const bmp = await createImageBitmap(blob);
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(bmp, 0, 0, w, h);
        const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
        const outBytes = await readBytes(out);
        return `data:image/jpeg;base64,${bytesToBase64(outBytes)}`;
      }
    } catch {
      /* fall through */
    }
  }
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

/** Parse a user-selected File/Blob (or raw bytes) into text and/or image data URL. */
export async function parseAttachment(
  file: BinarySource,
  name: string,
  mimeHint?: string,
): Promise<ParseResult> {
  const mime =
    mimeHint ||
    (typeof Blob !== "undefined" && file instanceof Blob ? (file as File).type : "") ||
    "application/octet-stream";

  let bytes: Uint8Array;
  try {
    bytes = await readBytes(file);
  } catch (e) {
    return {
      kind: "other",
      mime,
      text: "",
      meta: {},
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (bytes.byteLength > ATTACH_MAX_BYTES) {
    return {
      kind: "other",
      mime,
      text: "",
      meta: { size: bytes.byteLength },
      truncated: false,
      error: `File too large (max ${ATTACH_MAX_BYTES} bytes)`,
    };
  }

  const kind = detectKind(name, mime);
  try {
    if (kind === "image") {
      const dataUrl = await imageDataUrl(bytes, mime);
      return {
        kind: "image",
        mime,
        text: "",
        dataUrl,
        meta: { size: bytes.byteLength, vision: true },
        truncated: false,
      };
    }

    if (kind === "pdf") {
      const { text, pages } = await readPdfText(bytes);
      const t = truncateText(text);
      return {
        kind: "pdf",
        mime: "application/pdf",
        text: t.text,
        meta: {
          size: bytes.byteLength,
          pages,
          extractedPages: Math.min(pages, ATTACH_MAX_PDF_PAGES),
        },
        truncated: t.truncated || pages > ATTACH_MAX_PDF_PAGES,
      };
    }

    if (kind === "xlsx") {
      const { text, sheetCount, rowCount } = await readXlsxText(bytes);
      const t = truncateText(text);
      return {
        kind: "xlsx",
        mime,
        text: t.text,
        meta: { size: bytes.byteLength, sheetCount, rowCount },
        truncated: t.truncated,
      };
    }

    const raw = decodeUtf8(bytes);
    const t = truncateText(raw);
    return {
      kind: kind === "other" ? "txt" : kind,
      mime,
      text: t.text,
      meta: { size: bytes.byteLength, chars: t.text.length },
      truncated: t.truncated,
    };
  } catch (e) {
    return {
      kind,
      mime,
      text: "",
      meta: { size: bytes.byteLength },
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Short inventory line for the user turn. */
export function formatAttachmentInventory(
  items: Array<{ id: string; name: string; kind: AttachmentKind; chars?: number; truncated?: boolean }>,
): string {
  if (!items.length) return "";
  const lines = items.map((a) => {
    const bits = [`- ${a.name} (id=${a.id}, kind=${a.kind}`];
    if (a.chars != null) bits.push(`, chars=${a.chars}`);
    if (a.truncated) bits.push(", truncated");
    bits.push(")");
    return bits.join("");
  });
  return [
    "Attached files (use list_attachments / read_attachment for full text; images are included for vision):",
    ...lines,
  ].join("\n");
}

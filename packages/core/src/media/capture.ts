/** Pure screenshot / crop helpers (browser + jsdom; stub in node without canvas). */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
  note?: string;
}

export interface RecordingSession {
  id: string;
  tabId: number;
  startedAt: string;
}

export interface ParsedDataUrl {
  mime: string;
  isBase64: boolean;
  /** Payload after the comma (base64 or percent-encoded). */
  data: string;
}

const DATA_URL_RE = /^data:([^;,]*)(;base64)?,(.*)$/s;

export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  return {
    mime: match[1] || "application/octet-stream",
    isBase64: Boolean(match[2]),
    data: match[3] ?? "",
  };
}

export function buildDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function canvasAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext?.("2d"));
  } catch {
    return false;
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

/** Crop a data URL to device-pixel rect; returns original when canvas unavailable. */
export async function cropDataUrl(
  dataUrl: string,
  rect: CropRect,
  dpr = 1,
): Promise<ScreenshotResult> {
  if (!parseDataUrl(dataUrl)) {
    return { ok: false, error: "invalid data URL" };
  }
  if (!canvasAvailable()) {
    return { ok: true, dataUrl, note: "crop skipped: canvas unavailable" };
  }

  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.max(1, Math.round(rect.width * dpr));
  const sh = Math.max(1, Math.round(rect.height * dpr));

  try {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { ok: true, dataUrl, note: "crop skipped: 2d context unavailable" };
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return { ok: true, dataUrl: canvas.toDataURL("image/png") };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

/** Vertically stitch screenshot tiles (same width); best-effort pure helper. */
export async function stitchTilesVertically(
  tiles: string[],
  tileCssHeights: number[],
  dpr = 1,
): Promise<ScreenshotResult> {
  if (tiles.length === 0) return { ok: false, error: "no tiles" };
  if (tiles.length === 1) return { ok: true, dataUrl: tiles[0] };
  if (!canvasAvailable()) {
    return {
      ok: true,
      dataUrl: tiles[0],
      note: `stitch skipped: ${tiles.length} tiles, canvas unavailable`,
    };
  }

  try {
    const images = await Promise.all(tiles.map((t) => loadImage(t)));
    const width = images[0]!.naturalWidth;
    const totalHeight = tileCssHeights.reduce((sum, h) => sum + Math.round(h * dpr), 0);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, totalHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { ok: true, dataUrl: tiles[0], note: "stitch skipped: 2d context unavailable" };
    }
    let y = 0;
    for (let i = 0; i < images.length; i += 1) {
      const img = images[i]!;
      const h = Math.round((tileCssHeights[i] ?? img.naturalHeight / dpr) * dpr);
      ctx.drawImage(img, 0, 0, width, h, 0, y, width, h);
      y += h;
    }
    return { ok: true, dataUrl: canvas.toDataURL("image/png") };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

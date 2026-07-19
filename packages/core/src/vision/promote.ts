/**
 * Screenshot → multimodal ContentPart promotion + size budget.
 */

import type { ContentPart } from "../llm/openrouter.js";
import { parseDataUrl } from "../media/capture.js";
import type { ImageDetail } from "./settings.js";

export type PendingVision = {
  dataUrl: string;
  detail: ImageDetail;
  attachmentId?: string;
  /** Set true after one inject (orchestrator or worker). */
  consumed: boolean;
};

export type PromoteResult = {
  dataUrl: string;
  bytes: number;
  detail: ImageDetail;
  downscaled: boolean;
  maxSide?: number;
  jpegQuality?: number;
};

/** Approx decoded byte length of a data URL. */
export function dataUrlByteLength(dataUrl: string): number {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return dataUrl.length;
  if (parsed.isBase64) {
    const padding = (parsed.data.match(/=+$/) ?? [""])[0].length;
    return Math.max(0, Math.floor((parsed.data.length * 3) / 4) - padding);
  }
  try {
    return decodeURIComponent(parsed.data).length;
  } catch {
    return parsed.data.length;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Downscale / recompress a data URL until under maxBytes (best-effort).
 * When canvas APIs are unavailable (Node tests), returns input if under budget
 * or the original with downscaled:false.
 */
export async function promoteScreenshotToVision(
  dataUrl: string,
  opts: {
    maxBytes: number;
    detail: ImageDetail;
    /** Initial longest side when recompressing (default 2560). */
    maxSide?: number;
    /** Initial JPEG quality 0–1 (default 0.92). */
    jpegQuality?: number;
  },
): Promise<PromoteResult> {
  const detail = opts.detail;
  let current = dataUrl;
  let bytes = dataUrlByteLength(current);
  if (bytes <= opts.maxBytes) {
    return { dataUrl: current, bytes, detail, downscaled: false };
  }

  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return { dataUrl: current, bytes, detail, downscaled: false };
  }

  try {
    const parsed = parseDataUrl(current);
    if (!parsed?.isBase64) {
      return { dataUrl: current, bytes, detail, downscaled: false };
    }
    const bin = atob(parsed.data);
    const raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    const blob = new Blob([raw], { type: parsed.mime || "image/png" });
    const bmp = await createImageBitmap(blob);

    let maxSide = Math.max(640, opts.maxSide ?? 2560);
    let quality = Math.min(0.97, Math.max(0.5, opts.jpegQuality ?? 0.92));
    let lastSide = maxSide;
    let lastQ = quality;
    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(bmp, 0, 0, w, h);
      const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
      const outBytes = new Uint8Array(await out.arrayBuffer());
      current = `data:image/jpeg;base64,${bytesToBase64(outBytes)}`;
      bytes = outBytes.byteLength;
      lastSide = maxSide;
      lastQ = quality;
      if (bytes <= opts.maxBytes) {
        return {
          dataUrl: current,
          bytes,
          detail,
          downscaled: true,
          maxSide: lastSide,
          jpegQuality: lastQ,
        };
      }
      // Prefer dropping JPEG quality slightly before crushing resolution.
      if (quality > 0.72 && attempt % 2 === 0) {
        quality = Math.max(0.7, quality - 0.06);
      } else {
        maxSide = Math.max(720, Math.floor(maxSide * 0.82));
      }
    }
    return {
      dataUrl: current,
      bytes: dataUrlByteLength(current),
      detail,
      downscaled: true,
      maxSide: lastSide,
      jpegQuality: lastQ,
    };
  } catch {
    /* keep current */
  }

  return {
    dataUrl: current,
    bytes: dataUrlByteLength(current),
    detail,
    downscaled: true,
  };
}

export function visionPartsFromPending(pending: PendingVision): ContentPart[] {
  return [
    {
      type: "text",
      text: pending.attachmentId
        ? `[Screenshot attached for visual analysis; attachmentId=${pending.attachmentId}]`
        : "[Screenshot attached for visual analysis]",
    },
    {
      type: "image_url",
      image_url: { url: pending.dataUrl, detail: pending.detail },
    },
  ];
}

/** Stub persisted in tool messages / UI — never includes dataUrl. */
export function screenshotToolStub(input: {
  ok: boolean;
  attachmentId?: string;
  bytes?: number;
  width?: number;
  height?: number;
  visionAttached: boolean;
  note?: string;
  error?: string;
  quality?: string;
  detail?: string;
  downscaled?: boolean;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ok: input.ok,
    visionAttached: input.visionAttached,
  };
  if (input.attachmentId) out.attachmentId = input.attachmentId;
  if (input.bytes != null) out.bytes = input.bytes;
  if (input.width != null) out.width = input.width;
  if (input.height != null) out.height = input.height;
  if (input.note) out.note = input.note;
  if (input.error) out.error = input.error;
  if (input.quality) out.quality = input.quality;
  if (input.detail) out.detail = input.detail;
  if (input.downscaled != null) out.downscaled = input.downscaled;
  return out;
}

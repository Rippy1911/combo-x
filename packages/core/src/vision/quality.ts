/**
 * Screenshot encode / vision detail presets.
 * Capture is PNG; promote may JPEG-recompress under a byte budget.
 */

import type { ImageDetail } from "./settings.js";

export type ScreenshotQuality = "draft" | "standard" | "high" | "max";

export type QualityEncodePlan = {
  quality: ScreenshotQuality;
  /** Soft cap after encode (approx decoded bytes). */
  maxBytes: number;
  /** Longest side before JPEG encode when over budget. */
  maxSide: number;
  /** JPEG quality 0–1 when recompressing. */
  jpegQuality: number;
  /** Suggested vision detail when caller did not override. */
  suggestedDetail: ImageDetail;
};

const PLANS: Record<ScreenshotQuality, Omit<QualityEncodePlan, "maxBytes"> & { preferredMaxBytes: number }> =
  {
    draft: {
      quality: "draft",
      preferredMaxBytes: 900_000,
      maxSide: 1280,
      jpegQuality: 0.78,
      suggestedDetail: "low",
    },
    standard: {
      quality: "standard",
      preferredMaxBytes: 2_500_000,
      maxSide: 1920,
      jpegQuality: 0.88,
      suggestedDetail: "auto",
    },
    high: {
      quality: "high",
      preferredMaxBytes: 4_500_000,
      maxSide: 2560,
      jpegQuality: 0.92,
      suggestedDetail: "high",
    },
    max: {
      quality: "max",
      preferredMaxBytes: 8_000_000,
      maxSide: 4096,
      jpegQuality: 0.95,
      suggestedDetail: "high",
    },
  };

export function isScreenshotQuality(v: unknown): v is ScreenshotQuality {
  return v === "draft" || v === "standard" || v === "high" || v === "max";
}

/**
 * Resolve encode plan.
 * - Quality preset sets maxSide / jpegQuality / preferred budget.
 * - Final maxBytes = min(12MB, max(preset, settingsMaxBytes)) so agent quality=max
 *   is not stuck under a stale 1.5MB localStorage ceiling.
 */
export function planScreenshotEncode(input: {
  quality: ScreenshotQuality;
  settingsMaxBytes: number;
}): QualityEncodePlan {
  const base = PLANS[input.quality] ?? PLANS.high;
  const settings = Number.isFinite(input.settingsMaxBytes)
    ? Math.max(0, input.settingsMaxBytes)
    : 0;
  const maxBytes = Math.min(
    12_000_000,
    Math.max(base.preferredMaxBytes, settings || base.preferredMaxBytes),
  );
  return {
    quality: base.quality,
    maxBytes,
    maxSide: base.maxSide,
    jpegQuality: base.jpegQuality,
    suggestedDetail: base.suggestedDetail,
  };
}

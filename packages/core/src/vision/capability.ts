/**
 * Vision capability router — never send image_url to a model that may 400.
 * Unknown modality → treat as non-vision (vision worker path).
 */

import { MODEL_PRESETS } from "../models.js";
import type { VisionSettings } from "./settings.js";

export type VisionCapability = {
  /** true = orchestrator may receive image_url; false = use vision worker */
  orchestratorHasVision: boolean;
  source: "override" | "preset" | "openrouter" | "unknown";
};

/** Known vision flags for curated presets (OpenRouter ids). */
export function presetVisionFlag(modelId: string): boolean | undefined {
  const row = MODEL_PRESETS.find((p) => p.id === modelId);
  return row?.vision;
}

/**
 * Resolve whether the orchestrator can accept image_url parts.
 * Override (exact id match) wins; then OpenRouter map; then preset; else unknown→false.
 */
export function resolveVisionCapability(
  modelId: string,
  opts?: {
    settings?: Pick<VisionSettings, "visionModelOverride">;
    /** From listModels — id → supports image input */
    openRouterVision?: ReadonlyMap<string, boolean> | Record<string, boolean>;
  },
): VisionCapability {
  const override = opts?.settings?.visionModelOverride?.trim();
  if (override && override === modelId) {
    return { orchestratorHasVision: true, source: "override" };
  }

  const map = opts?.openRouterVision;
  if (map) {
    let fromOr: boolean | undefined;
    if (map instanceof Map) {
      fromOr = map.get(modelId);
    } else if (Object.prototype.hasOwnProperty.call(map, modelId)) {
      fromOr = (map as Record<string, boolean>)[modelId];
    }
    if (typeof fromOr === "boolean") {
      return { orchestratorHasVision: fromOr, source: "openrouter" };
    }
  }

  const preset = presetVisionFlag(modelId);
  if (typeof preset === "boolean") {
    return { orchestratorHasVision: preset, source: "preset" };
  }

  // Fail soft: unknown → vision worker (never silent 400 on orchestrator).
  return { orchestratorHasVision: false, source: "unknown" };
}

/** Parse OpenRouter architecture fields into a boolean vision flag. */
export function modalitySupportsVision(architecture: unknown): boolean | undefined {
  if (!architecture || typeof architecture !== "object") return undefined;
  const arch = architecture as {
    modality?: string;
    input_modalities?: string[];
  };
  if (Array.isArray(arch.input_modalities)) {
    const lower = arch.input_modalities.map((m) => String(m).toLowerCase());
    if (lower.includes("image") || lower.includes("image_url")) return true;
    if (lower.length > 0 && !lower.some((m) => m.includes("image"))) return false;
  }
  if (typeof arch.modality === "string") {
    const m = arch.modality.toLowerCase();
    if (m.includes("image")) return true;
    // e.g. "text->text" with no image
    if (m.includes("text") && !m.includes("image")) return false;
  }
  return undefined;
}

export const UX_VISION_WORKER_SYSTEM = `You are a UX vision critic. Analyze the attached screenshot.
Return a concise structured critique with:
1) Summary (1-2 sentences)
2) Scores 1-5: hierarchy, contrast, CTA clarity, density, mobile-fit, a11y, copy
3) Ranked fixes (max 7) — concrete, actionable
4) What to prototype next (HTML mock or visual tweak)
Be specific to what you see; do not invent UI that is not visible.`;

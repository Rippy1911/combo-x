/**
 * UX Vision Lab settings — OOTB defaults, no user config required.
 * UI persists via localStorage keys below; AgentLoop accepts a resolved object.
 */

export type ImageDetail = "auto" | "low" | "high";

export interface VisionSettings {
  /** Cheap multimodal model when orchestrator lacks vision. */
  visionWorkerModel: string;
  /** After screenshot_* / ux_critique, attach image_url once for the next model turn. */
  autoAttachScreenshots: boolean;
  /** OpenRouter image_url.detail for critique shots. */
  critiqueImageDetail: ImageDetail;
  /** Max encoded image bytes after downscale (approx). */
  maxVisionBytes: number;
  /** ChatArtifact iframe: allow-scripts (never allow-same-origin with scripts). */
  interactivePreviewScripts: boolean;
  /** P1 gate — when false, generate_mock is not in the tool ceiling. */
  enableGenerateMock: boolean;
  /**
   * Force vision capability for a model id when OpenRouter metadata is missing/wrong.
   * Empty = use preset / listModels / unknown→worker.
   */
  visionModelOverride: string;
}

export const VISION_STORAGE_KEYS = {
  visionWorkerModel: "combo_x_vision_worker_model",
  autoAttachScreenshots: "combo_x_auto_attach_screenshots",
  critiqueImageDetail: "combo_x_critique_image_detail",
  maxVisionBytes: "combo_x_max_vision_bytes",
  interactivePreviewScripts: "combo_x_interactive_preview_scripts",
  enableGenerateMock: "combo_x_enable_generate_mock",
  visionModelOverride: "combo_x_vision_model_override",
} as const;

export const DEFAULT_VISION_SETTINGS: VisionSettings = {
  visionWorkerModel: "google/gemini-3.5-flash",
  autoAttachScreenshots: true,
  critiqueImageDetail: "low",
  maxVisionBytes: 1_500_000,
  interactivePreviewScripts: true,
  enableGenerateMock: false,
  visionModelOverride: "",
};

export function mergeVisionSettings(
  partial?: Partial<VisionSettings> | null,
): VisionSettings {
  return { ...DEFAULT_VISION_SETTINGS, ...(partial ?? {}) };
}

/** Read from localStorage (browser). Safe defaults if missing/invalid. */
export function loadVisionSettingsFromStorage(
  getItem: (key: string) => string | null = (k) =>
    typeof localStorage !== "undefined" ? localStorage.getItem(k) : null,
): VisionSettings {
  const detail = getItem(VISION_STORAGE_KEYS.critiqueImageDetail);
  const maxRaw = getItem(VISION_STORAGE_KEYS.maxVisionBytes);
  const maxParsed = maxRaw != null ? Number(maxRaw) : NaN;
  return mergeVisionSettings({
    visionWorkerModel:
      getItem(VISION_STORAGE_KEYS.visionWorkerModel) ?? undefined,
    autoAttachScreenshots: readBool(
      getItem(VISION_STORAGE_KEYS.autoAttachScreenshots),
      DEFAULT_VISION_SETTINGS.autoAttachScreenshots,
    ),
    critiqueImageDetail:
      detail === "auto" || detail === "low" || detail === "high"
        ? detail
        : undefined,
    maxVisionBytes:
      Number.isFinite(maxParsed) && maxParsed > 10_000
        ? Math.min(maxParsed, 8_000_000)
        : undefined,
    interactivePreviewScripts: readBool(
      getItem(VISION_STORAGE_KEYS.interactivePreviewScripts),
      DEFAULT_VISION_SETTINGS.interactivePreviewScripts,
    ),
    enableGenerateMock: readBool(
      getItem(VISION_STORAGE_KEYS.enableGenerateMock),
      DEFAULT_VISION_SETTINGS.enableGenerateMock,
    ),
    visionModelOverride:
      getItem(VISION_STORAGE_KEYS.visionModelOverride) ?? undefined,
  });
}

export function persistVisionSettings(
  settings: VisionSettings,
  setItem: (key: string, value: string) => void = (k, v) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
  },
): void {
  setItem(VISION_STORAGE_KEYS.visionWorkerModel, settings.visionWorkerModel);
  setItem(
    VISION_STORAGE_KEYS.autoAttachScreenshots,
    settings.autoAttachScreenshots ? "1" : "0",
  );
  setItem(VISION_STORAGE_KEYS.critiqueImageDetail, settings.critiqueImageDetail);
  setItem(VISION_STORAGE_KEYS.maxVisionBytes, String(settings.maxVisionBytes));
  setItem(
    VISION_STORAGE_KEYS.interactivePreviewScripts,
    settings.interactivePreviewScripts ? "1" : "0",
  );
  setItem(
    VISION_STORAGE_KEYS.enableGenerateMock,
    settings.enableGenerateMock ? "1" : "0",
  );
  setItem(
    VISION_STORAGE_KEYS.visionModelOverride,
    settings.visionModelOverride,
  );
}

function readBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return fallback;
}

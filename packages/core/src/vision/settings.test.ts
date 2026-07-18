import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISION_SETTINGS,
  loadVisionSettingsFromStorage,
  mergeVisionSettings,
} from "./settings.js";

describe("mergeVisionSettings", () => {
  it("does not let undefined overwrite defaults", () => {
    const m = mergeVisionSettings({ visionWorkerModel: undefined });
    expect(m.visionWorkerModel).toBe(DEFAULT_VISION_SETTINGS.visionWorkerModel);
  });

  it("does not let empty string wipe vision worker model", () => {
    const m = mergeVisionSettings({ visionWorkerModel: "  " });
    expect(m.visionWorkerModel).toBe(DEFAULT_VISION_SETTINGS.visionWorkerModel);
  });

  it("accepts a real override", () => {
    const m = mergeVisionSettings({ visionWorkerModel: "openai/gpt-4o" });
    expect(m.visionWorkerModel).toBe("openai/gpt-4o");
  });
});

describe("loadVisionSettingsFromStorage", () => {
  it("keeps default worker when key missing", () => {
    const m = loadVisionSettingsFromStorage(() => null);
    expect(m.visionWorkerModel).toBe(DEFAULT_VISION_SETTINGS.visionWorkerModel);
    expect(m.critiqueImageDetail).toBe("high");
    expect(m.screenshotQuality).toBe("high");
  });

  it("keeps default worker when key is empty", () => {
    const m = loadVisionSettingsFromStorage((k) =>
      k === "combo_x_vision_worker_model" ? "" : null,
    );
    expect(m.visionWorkerModel).toBe(DEFAULT_VISION_SETTINGS.visionWorkerModel);
  });

  it("migrates legacy low/1.5MB installs to high quality", () => {
    const m = loadVisionSettingsFromStorage((k) => {
      if (k === "combo_x_critique_image_detail") return "low";
      if (k === "combo_x_max_vision_bytes") return "1500000";
      return null;
    });
    expect(m.critiqueImageDetail).toBe("high");
    expect(m.screenshotQuality).toBe("high");
    expect(m.maxVisionBytes).toBe(DEFAULT_VISION_SETTINGS.maxVisionBytes);
  });
});

import { describe, expect, it } from "vitest";
import {
  modalitySupportsVision,
  resolveVisionCapability,
} from "./capability.js";

describe("resolveVisionCapability", () => {
  it("uses preset vision for grok-4.5", () => {
    const r = resolveVisionCapability("x-ai/grok-4.5");
    expect(r.orchestratorHasVision).toBe(true);
    expect(r.source).toBe("preset");
  });

  it("unknown model fails soft to non-vision", () => {
    const r = resolveVisionCapability("vendor/unknown-text-only");
    expect(r.orchestratorHasVision).toBe(false);
    expect(r.source).toBe("unknown");
  });

  it("override forces vision when id matches", () => {
    const r = resolveVisionCapability("vendor/unknown-text-only", {
      settings: { visionModelOverride: "vendor/unknown-text-only" },
    });
    expect(r.orchestratorHasVision).toBe(true);
    expect(r.source).toBe("override");
  });

  it("openRouter map wins over unknown", () => {
    const r = resolveVisionCapability("vendor/x", {
      openRouterVision: { "vendor/x": true },
    });
    expect(r.orchestratorHasVision).toBe(true);
    expect(r.source).toBe("openrouter");
  });
});

describe("modalitySupportsVision", () => {
  it("detects image in input_modalities", () => {
    expect(
      modalitySupportsVision({ input_modalities: ["text", "image"] }),
    ).toBe(true);
  });

  it("detects text-only modality string", () => {
    expect(modalitySupportsVision({ modality: "text->text" })).toBe(false);
  });
});

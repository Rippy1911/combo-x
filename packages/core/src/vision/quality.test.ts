import { describe, expect, it } from "vitest";
import { isScreenshotQuality, planScreenshotEncode } from "./quality.js";

describe("planScreenshotEncode", () => {
  it("high prefers ~4.5MB and high detail", () => {
    const p = planScreenshotEncode({ quality: "high", settingsMaxBytes: 1_500_000 });
    expect(p.maxBytes).toBe(4_500_000);
    expect(p.maxSide).toBe(2560);
    expect(p.suggestedDetail).toBe("high");
    expect(p.jpegQuality).toBeGreaterThanOrEqual(0.9);
  });

  it("max raises budget even when settings are stale-low", () => {
    const p = planScreenshotEncode({ quality: "max", settingsMaxBytes: 1_500_000 });
    expect(p.maxBytes).toBe(8_000_000);
    expect(p.maxSide).toBe(4096);
  });

  it("settings can raise above preset", () => {
    const p = planScreenshotEncode({ quality: "standard", settingsMaxBytes: 6_000_000 });
    expect(p.maxBytes).toBe(6_000_000);
  });
});

describe("isScreenshotQuality", () => {
  it("accepts known presets", () => {
    expect(isScreenshotQuality("high")).toBe(true);
    expect(isScreenshotQuality("ultra")).toBe(false);
  });
});

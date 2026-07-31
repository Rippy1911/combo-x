import { describe, expect, it } from "vitest";
import {
  isVoiceMicSupported,
  parseVoicePanelMode,
  shouldShowVoicePanel,
} from "./voicePanel.js";

describe("voicePanel visibility", () => {
  it("parses modes with auto default", () => {
    expect(parseVoicePanelMode("show")).toBe("show");
    expect(parseVoicePanelMode("hide")).toBe("hide");
    expect(parseVoicePanelMode("auto")).toBe("auto");
    expect(parseVoicePanelMode(null)).toBe("auto");
    expect(parseVoicePanelMode("nope")).toBe("auto");
  });

  it("detects offscreen createDocument as mic support", () => {
    expect(
      isVoiceMicSupported({ offscreen: { createDocument: async () => undefined } }),
    ).toBe(true);
    expect(isVoiceMicSupported({ offscreen: {} })).toBe(false);
    expect(isVoiceMicSupported(undefined)).toBe(false);
  });

  it("auto hides when mic unsupported (Firefox)", () => {
    expect(shouldShowVoicePanel("auto", false)).toBe(false);
    expect(shouldShowVoicePanel("auto", true)).toBe(true);
  });

  it("hide always hides; show always shows", () => {
    expect(shouldShowVoicePanel("hide", true)).toBe(false);
    expect(shouldShowVoicePanel("hide", false)).toBe(false);
    expect(shouldShowVoicePanel("show", false)).toBe(true);
    expect(shouldShowVoicePanel("show", true)).toBe(true);
  });
});

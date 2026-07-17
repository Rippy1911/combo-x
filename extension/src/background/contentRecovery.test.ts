import { describe, expect, it } from "vitest";
import {
  STALE_ASSETS_ERROR,
  formatContentFailure,
  isMissingContentReceiver,
  isStaleContentAsset,
  shouldAttemptContentRecovery,
} from "./contentRecovery.js";

describe("contentRecovery", () => {
  it("detects missing content receiver", () => {
    expect(isMissingContentReceiver("Could not establish connection. Receiving end does not exist.")).toBe(
      true,
    );
    expect(isMissingContentReceiver("The message port closed before a response was received.")).toBe(
      true,
    );
    expect(isMissingContentReceiver("bad content response")).toBe(false);
  });

  it("detects stale hashed content loader", () => {
    expect(
      isStaleContentAsset("Could not load file: 'assets/content.ts-loader-CpUtSg0U.js'."),
    ).toBe(true);
    expect(isStaleContentAsset("Could not load file: 'assets/sidepanel-abc.js'.")).toBe(true);
    expect(isStaleContentAsset("Receiving end does not exist")).toBe(false);
  });

  it("recovery trigger covers both classes", () => {
    expect(shouldAttemptContentRecovery("Receiving end does not exist")).toBe(true);
    expect(
      shouldAttemptContentRecovery("Could not load file: 'assets/content.ts-loader-x.js'."),
    ).toBe(true);
    expect(shouldAttemptContentRecovery("timeout")).toBe(false);
  });

  it("formats stale asset as extension reload (not tab-only)", () => {
    const msg = formatContentFailure(
      "Could not load file: 'assets/content.ts-loader-CpUtSg0U.js'.",
    );
    expect(msg).toContain(STALE_ASSETS_ERROR);
    expect(msg).toContain("content.ts-loader-CpUtSg0U");
  });

  it("formats missing receiver with tab reload hint", () => {
    const msg = formatContentFailure("Receiving end does not exist.");
    expect(msg).toContain("reload the tab");
    expect(msg).not.toContain(STALE_ASSETS_ERROR);
  });
});

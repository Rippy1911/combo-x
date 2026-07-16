import { describe, expect, it } from "vitest";
import {
  defaultGetPageMaxChars,
  preferPageDigest,
  resolveMaxSteps,
  rewriteGetPageArgs,
  shouldRejectGetPageFull,
} from "./budget.js";

describe("budget mode", () => {
  it("resolveMaxSteps", () => {
    expect(resolveMaxSteps("budget")).toBe(16);
    expect(resolveMaxSteps("normal")).toBe(32);
    expect(resolveMaxSteps("budget", 8)).toBe(8);
  });

  it("defaultGetPageMaxChars", () => {
    expect(defaultGetPageMaxChars("budget")).toBeLessThan(defaultGetPageMaxChars("normal"));
  });

  it("shouldRejectGetPageFull in budget mode", () => {
    expect(shouldRejectGetPageFull("budget", { mode: "full" })).toBe(true);
    expect(shouldRejectGetPageFull("budget", { mode: "snippet" })).toBe(false);
    expect(shouldRejectGetPageFull("normal", { mode: "full" })).toBe(false);
  });

  it("preferPageDigest when budget and no mode", () => {
    expect(preferPageDigest("budget", "get_page", {})).toBe(true);
    expect(preferPageDigest("budget", "get_page", { mode: "snippet" })).toBe(false);
    expect(preferPageDigest("normal", "get_page", {})).toBe(false);
  });

  it("rewriteGetPageArgs rejects full or forces snippet", () => {
    const err = rewriteGetPageArgs("budget", { mode: "full" });
    expect(err).toHaveProperty("error");

    const rewritten = rewriteGetPageArgs("budget", {});
    expect(rewritten).not.toHaveProperty("error");
    if (!("error" in rewritten)) {
      expect(rewritten.mode).toBe("snippet");
      expect(rewritten.maxChars).toBe(defaultGetPageMaxChars("budget"));
    }
  });
});

import { describe, expect, it } from "vitest";
import { defaultGetPageMaxChars, resolveMaxSteps } from "./budget.js";

describe("budget mode", () => {
  it("resolveMaxSteps", () => {
    expect(resolveMaxSteps("budget")).toBe(16);
    expect(resolveMaxSteps("normal")).toBe(32);
    expect(resolveMaxSteps("budget", 8)).toBe(8);
  });

  it("defaultGetPageMaxChars", () => {
    expect(defaultGetPageMaxChars("budget")).toBeLessThan(defaultGetPageMaxChars("normal"));
  });
});

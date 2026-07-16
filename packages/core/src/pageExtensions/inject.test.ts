import { describe, expect, it } from "vitest";
import { isOverbroadPattern } from "./inject.js";

describe("isOverbroadPattern", () => {
  it("blocks star-only globs", () => {
    expect(isOverbroadPattern("*")).toBe(true);
    expect(isOverbroadPattern("https://*/*")).toBe(true);
    expect(isOverbroadPattern("*://*/*")).toBe(true);
  });

  it("allows host-specific patterns", () => {
    expect(isOverbroadPattern("https://allegro.pl/*")).toBe(false);
    expect(isOverbroadPattern("https://*.example.com/path/*")).toBe(false);
  });
});

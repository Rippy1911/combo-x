import { describe, expect, it } from "vitest";
import { patternToRegExp, urlMatches } from "./match.js";

describe("pageExtensions match", () => {
  it("matches allegro-style globs", () => {
    expect(urlMatches("https://allegro.pl/oferta/foo-123", { patterns: ["https://allegro.pl/*"] })).toBe(
      true,
    );
    expect(urlMatches("https://allegro.pl/oferta/foo", { patterns: ["https://ebay.com/*"] })).toBe(
      false,
    );
  });

  it("supports wildcard host", () => {
    const re = patternToRegExp("https://*.example.com/*");
    expect(re.test("https://shop.example.com/a")).toBe(true);
    expect(re.test("https://example.com/a")).toBe(false);
  });

  it("rejects invalid url", () => {
    expect(urlMatches("not-a-url", { patterns: ["*"] })).toBe(false);
  });
});

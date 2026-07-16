import { describe, expect, it } from "vitest";
import { PageTemplateCache, pathKindFromUrl, templateKey } from "./pageTemplateCache.js";

describe("pageTemplateCache", () => {
  it("collapses FoodWell PDP paths", () => {
    expect(pathKindFromUrl("https://b2b.foodwell.pl/baton-bakalland-5-orzechow-40-g-p1046")).toBe(
      "/…-p{id}",
    );
    expect(pathKindFromUrl("https://b2b.foodwell.pl/s/29605")).toBe("/s/{id}");
    expect(templateKey("https://b2b.foodwell.pl/s/29605")).toBe("b2b.foodwell.pl|/s/{id}");
  });

  it("learns once then strips bulk on reuse", () => {
    const cache = new PageTemplateCache();
    const first = cache.annotate({
      url: "https://b2b.foodwell.pl/s/29597",
      title: "A",
      headings: [{ tag: "h1", text: "nav" }],
      mainSample: "huge chrome ".repeat(40),
      labelHits: [{ label: "EAN", value: "5900749610926" }],
      eans: ["5900749610926", "5900749611923"],
    });
    expect(first.template).toMatchObject({ status: "learned" });
    expect(first.mainSample).toBeTruthy();

    const second = cache.annotate({
      url: "https://b2b.foodwell.pl/s/29605",
      title: "B",
      headings: [{ tag: "h1", text: "nav" }],
      mainSample: "more chrome",
      labelHits: [{ label: "EAN", value: "1" }],
      eans: ["1"],
    });
    expect(second.template).toMatchObject({ status: "reuse", seen: 2 });
    expect(second.mainSample).toBeUndefined();
    expect(second.headings).toBeUndefined();
    expect(second.eans).toEqual(["1"]);
  });
});

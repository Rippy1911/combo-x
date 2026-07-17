import { describe, expect, it } from "vitest";
import { buildMapHtml, MAP_STYLE_URLS } from "./buildMapHtml.js";

describe("buildMapHtml", () => {
  it("embeds markers and inlined style object", () => {
    const html = buildMapHtml({
      title: "Spots <test>",
      locale: "pl",
      markers: [
        { lat: 52.23, lng: 21.01, label: "Warsaw", note: "HQ" },
        { lat: 50.06, lng: 19.94, label: "Krakow" },
      ],
      styleJson: { version: 8, sources: {}, layers: [] },
    });
    expect(html).toContain("maplibregl");
    expect(html).toContain("Warsaw");
    expect(html).toContain("52.23");
    expect(html).toContain('"version":8');
    expect(html).toContain("Spots &lt;test&gt;");
    expect(html).toContain("2 pins");
  });

  it("falls back to style URL string when styleJson omitted", () => {
    const html = buildMapHtml({
      title: "Empty",
      locale: "en",
      markers: [],
    });
    expect(html).toContain(MAP_STYLE_URLS.en);
  });

  it("drops invalid coordinates", () => {
    const html = buildMapHtml({
      title: "Filter",
      markers: [
        { lat: 52, lng: 21, label: "ok" },
        { lat: 999, lng: 0, label: "bad" },
      ],
      styleJson: {},
    });
    expect(html).toContain("1 pin");
    expect(html).not.toContain("bad");
  });
});

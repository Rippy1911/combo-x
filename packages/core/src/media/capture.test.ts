import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildDataUrl,
  cropDataUrl,
  parseDataUrl,
  stitchTilesVertically,
} from "./capture.js";

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("parseDataUrl", () => {
  it("parses base64 PNG data URLs", () => {
    const parsed = parseDataUrl("data:image/png;base64,AAAA");
    expect(parsed).toEqual({
      mime: "image/png",
      isBase64: true,
      data: "AAAA",
    });
  });

  it("parses plain data URLs", () => {
    const parsed = parseDataUrl("data:text/plain,hello%20world");
    expect(parsed).toEqual({
      mime: "text/plain",
      isBase64: false,
      data: "hello%20world",
    });
  });

  it("returns null for invalid input", () => {
    expect(parseDataUrl("not-a-data-url")).toBeNull();
  });
});

describe("buildDataUrl", () => {
  it("round-trips with parseDataUrl", () => {
    const url = buildDataUrl("image/webp", "Zm9v");
    expect(parseDataUrl(url)?.mime).toBe("image/webp");
    expect(parseDataUrl(url)?.data).toBe("Zm9v");
  });
});

describe("cropDataUrl", () => {
  const sample =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("returns original when canvas 2d is unavailable in jsdom", async () => {
    const res = await cropDataUrl(sample, { x: 0, y: 0, width: 1, height: 1 }, 2);
    expect(res.ok).toBe(true);
    expect(res.dataUrl).toBe(sample);
    expect(res.note).toMatch(/crop skipped/i);
  });

  it("rejects invalid data URLs", async () => {
    const res = await cropDataUrl("bad", { x: 0, y: 0, width: 1, height: 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid data URL/i);
  });
});

describe("stitchTilesVertically", () => {
  const tile =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("returns single tile unchanged", async () => {
    const res = await stitchTilesVertically([tile], [10]);
    expect(res.ok).toBe(true);
    expect(res.dataUrl).toBe(tile);
  });

  it("falls back when canvas unavailable", async () => {
    const res = await stitchTilesVertically([tile, tile], [10, 10]);
    expect(res.ok).toBe(true);
    expect(res.dataUrl).toBe(tile);
    expect(res.note).toMatch(/stitch skipped/i);
  });
});

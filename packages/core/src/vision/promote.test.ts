import { describe, expect, it } from "vitest";
import {
  dataUrlByteLength,
  screenshotToolStub,
  visionPartsFromPending,
} from "./promote.js";

describe("screenshotToolStub", () => {
  it("never includes dataUrl", () => {
    const stub = screenshotToolStub({
      ok: true,
      attachmentId: "a1",
      bytes: 1200,
      visionAttached: true,
    });
    expect(stub.dataUrl).toBeUndefined();
    expect(JSON.stringify(stub)).not.toContain("data:image");
    expect(stub.attachmentId).toBe("a1");
  });
});

describe("visionPartsFromPending", () => {
  it("builds text + image_url parts", () => {
    const parts = visionPartsFromPending({
      dataUrl: "data:image/png;base64,aaaa",
      detail: "low",
      attachmentId: "x",
      consumed: false,
    });
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(parts[1]).toMatchObject({
      type: "image_url",
      image_url: { detail: "low" },
    });
  });
});

describe("dataUrlByteLength", () => {
  it("estimates base64 payload", () => {
    // "AAAA" -> 3 bytes
    const url = "data:image/png;base64,AAAA";
    expect(dataUrlByteLength(url)).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { canOpenPreviewInNewTab, previewToHtmlDocument } from "./openPreviewTab";

describe("openPreviewTab", () => {
  it("opens full html documents as-is", () => {
    const html = "<!doctype html><html><body><h1>Report</h1></body></html>";
    const doc = previewToHtmlDocument({
      title: "Audit",
      kind: "html",
      html,
    });
    expect(doc).toBe(html);
    expect(canOpenPreviewInNewTab({ title: "Audit", kind: "html", html })).toBe(true);
  });

  it("wraps image and compare payloads", () => {
    const img = previewToHtmlDocument({
      title: "Shot",
      kind: "image",
      body: "data:image/png;base64,aa",
    });
    expect(img).toContain("<img");
    expect(img).toContain("data:image/png;base64,aa");

    const cmp = previewToHtmlDocument({
      title: "BA",
      kind: "compare",
      beforeSrc: "data:image/png;base64,a",
      afterSrc: "data:image/png;base64,b",
    });
    expect(cmp).toContain("Before");
    expect(cmp).toContain("After");
  });

  it("rejects empty table-only payloads", () => {
    expect(canOpenPreviewInNewTab({ title: "T", kind: "table" })).toBe(false);
  });
});

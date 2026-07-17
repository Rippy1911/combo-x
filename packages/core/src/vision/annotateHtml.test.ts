import { describe, expect, it } from "vitest";
import {
  buildAnnotateScreenshotHtml,
  validatePreviewCss,
} from "./annotateHtml.js";

describe("annotateHtml", () => {
  it("builds overlay with markers and highlights (no duplicate title/list nums)", () => {
    const html = buildAnnotateScreenshotHtml({
      title: "Home",
      src: "data:image/png;base64,aa",
      markers: [{ x: 10, y: 20, label: "1", note: "Weak CTA" }],
      highlights: [{ x: 5, y: 5, w: 40, h: 10, label: "hero" }],
    });
    expect(html).toContain("Weak CTA");
    expect(html).toContain('left:10%');
    expect(html).toContain("hero");
    expect(html).toContain("<img");
    // Title only in <title>/alt — ChatArtifact already shows the heading.
    expect(html).not.toMatch(/<h1[\s>]/);
    expect(html).not.toContain("<ol");
    // One badge + note — not "1. 1 —"
    expect(html).toContain('<span class="n">1</span> Weak CTA');
    expect(html).not.toContain("<strong>1</strong>");
  });

  it("validatePreviewCss rejects remote loads", () => {
    expect(validatePreviewCss("body{color:red}").ok).toBe(true);
    expect(validatePreviewCss("@import url('https://evil.test/x.css');").ok).toBe(
      false,
    );
    expect(validatePreviewCss("body{background:url(https://x.test/a.png)}").ok).toBe(
      false,
    );
  });
});

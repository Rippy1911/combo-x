import { describe, expect, it } from "vitest";
import {
  appendAttachmentGallery,
  embedAttachmentsInHtml,
  extractAttachmentPlaceholders,
} from "./embedAttachments.js";

describe("embedAttachments", () => {
  it("extracts placeholders", () => {
    const id = "1803c5f0-cba4-4c11-ba34-2573812220d5";
    expect(
      extractAttachmentPlaceholders(`<img src="attachment:${id}"/><img src="combo-att:${id}"/>`),
    ).toEqual([id]);
  });

  it("embeds data URLs and galleries missing refs", async () => {
    const id = "1803c5f0-cba4-4c11-ba34-2573812220d5";
    const dataUrl = "data:image/png;base64,aa";
    const { html, embedded, missing } = await embedAttachmentsInHtml(
      "<p>Report</p>",
      async (x) => (x === id ? dataUrl : null),
      { attachmentIds: [id], labels: { [id]: "Hero" } },
    );
    expect(embedded).toEqual([id]);
    expect(missing).toEqual([]);
    expect(html).toContain(dataUrl);
    expect(html).toContain("Hero");
    expect(html).not.toContain(`attachment:${id}`);
  });

  it("keeps placeholder when missing", async () => {
    const id = "1803c5f0-cba4-4c11-ba34-2573812220d5";
    const html0 = appendAttachmentGallery("<h1>x</h1>", [id]);
    const { html, missing } = await embedAttachmentsInHtml(html0, async () => null);
    expect(missing).toContain(id);
    expect(html).toContain(`attachment:${id}`);
  });
});

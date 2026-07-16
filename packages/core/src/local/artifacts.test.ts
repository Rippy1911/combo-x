import { describe, expect, it } from "vitest";
import { ArtifactStore } from "./artifacts.js";

describe("ArtifactStore", () => {
  it("listReports after saveReport", async () => {
    // Use unique db by temporarily patching — ArtifactStore has fixed db name.
    // Concurrent tests share combo_x_artifacts; use unique title.
    const store = new ArtifactStore();
    const title = `report_${crypto.randomUUID()}`;
    await store.saveReport({ title, bodyHtml: "<p>hi</p>" });
    const list = await store.listReports();
    expect(list.some((r) => r.title === title)).toBe(true);
  });
});

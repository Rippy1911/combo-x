import { describe, expect, it } from "vitest";
import {
  buildPreviewFromMarkdown,
  buildPreviewFromTool,
} from "./PreviewDrawer";
import { parseCsv, rowsFromMarkdownTables } from "./tableHelpers";

describe("PreviewDrawer parsers", () => {
  it("parseCsv handles quoted commas", () => {
    const rows = parseCsv('a,"b,c",d\n1,2,3');
    expect(rows[0]).toEqual(["a", "b,c", "d"]);
  });

  it("rowsFromMarkdownTables extracts GFM", () => {
    const md = `# Title

| Name | Qty |
| --- | --- |
| A | 1 |
| B | 2 |
`;
    const rows = rowsFromMarkdownTables(md);
    expect(rows?.[0]).toEqual(["Name", "Qty"]);
    expect(rows?.[1]).toEqual(["A", "1"]);
  });

  it("buildPreviewFromMarkdown", () => {
    const p = buildPreviewFromMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(p?.kind).toBe("table");
    expect(p?.rows?.length).toBeGreaterThan(1);
  });

  it("buildPreviewFromTool finds data.rows (parse_data shape)", () => {
    const p = buildPreviewFromTool("parse_data", {
      ok: true,
      data: { rows: [["h1", "h2"], ["a", "b"]] },
    });
    expect(p?.kind).toBe("table");
    expect(p?.rows?.[1]).toEqual(["a", "b"]);
  });

  it("buildPreviewFromTool finds top-level rows", () => {
    const p = buildPreviewFromTool("scrape_catalog", {
      rows: [["sku"], ["x"]],
      count: 1,
    });
    expect(p?.rows?.[0]).toEqual(["sku"]);
  });
});

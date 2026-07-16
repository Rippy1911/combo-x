import { describe, expect, it } from "vitest";
import {
  buildBarSeries,
  detectNumericColumns,
  filterTableRows,
  sortTableRows,
  tableToJson,
} from "./table.js";

const sample = [
  ["name", "qty", "note"],
  ["alpha", "10", "x"],
  ["beta", "2", "y"],
  ["gamma", "30", "z"],
];

describe("table helpers", () => {
  it("detectNumericColumns", () => {
    expect(detectNumericColumns(sample)).toContain(1);
    expect(detectNumericColumns(sample)).not.toContain(0);
  });

  it("sortTableRows numeric", () => {
    const sorted = sortTableRows(sample, 1, "asc");
    expect(sorted[1]![0]).toBe("beta");
    expect(sorted[3]![0]).toBe("gamma");
  });

  it("filterTableRows", () => {
    const f = filterTableRows(sample, "gamma");
    expect(f).toHaveLength(2);
    expect(f[1]![0]).toBe("gamma");
  });

  it("buildBarSeries", () => {
    const pts = buildBarSeries(sample, 1, 0);
    expect(pts.length).toBe(3);
    expect(pts[0]!.value).toBe(10);
  });

  it("tableToJson", () => {
    const json = tableToJson(sample);
    expect(json[0]).toEqual({ name: "alpha", qty: "10", note: "x" });
  });
});

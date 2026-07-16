import { describe, expect, it } from "vitest";
import {
  buildBarSeries,
  detectNumericColumns,
  filterTableRows,
  sortTableRows,
} from "@combo-x/core";

/** Pure helpers used by DataTable (T-Table-1). */
const sample = [
  ["name", "qty"],
  ["alpha", "10"],
  ["beta", "2"],
];

describe("DataTable helpers", () => {
  it("sort + filter + numeric detection + bar series", () => {
    expect(detectNumericColumns(sample)).toEqual([1]);
    const sorted = sortTableRows(sample, 1, "asc");
    expect(sorted[1]![0]).toBe("beta");
    expect(filterTableRows(sample, "alpha")).toHaveLength(2);
    expect(buildBarSeries(sample, 1)[0]!.value).toBe(10);
  });
});

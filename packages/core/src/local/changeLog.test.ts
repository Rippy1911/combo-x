import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { ChangeLogStore, computeUpsertDelta } from "./changeLog.js";

describe("changeLog", () => {
  it("computes add/update", () => {
    const before = new Set(["a", "b"]);
    const after = new Set(["a", "b", "c"]);
    const d = computeUpsertDelta(before, after, ["b", "c"]);
    expect(d.added).toBe(1);
    expect(d.updated).toBe(1);
    expect(d.op).toBe("mixed");
  });

  it("appends and lists", async () => {
    const store = new ChangeLogStore(`combo_x_change_log_test_${crypto.randomUUID()}`);
    await store.append({
      viewId: "v1",
      viewName: "Invoices",
      op: "add",
      added: 2,
      updated: 0,
      removed: 0,
      sourceTool: "upsert_scrape_rows",
    });
    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.viewName).toBe("Invoices");
  });
});

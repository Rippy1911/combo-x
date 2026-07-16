import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { CustomToolStore, runCustomTool } from "./customStore.js";

describe("CustomToolStore", () => {
  it("saves, lists, runs guide tool", async () => {
    const store = new CustomToolStore(`combo_x_custom_tools_test_${crypto.randomUUID()}`);
    const saved = await store.save({
      name: "foodwell_invoice_hint",
      description: "How to open FoodWell invoices",
      kind: "guide",
      handlerNote: "Go to my-account/invoices",
      parameters: {
        type: "object",
        properties: { q: { type: "string" } },
      },
    });
    expect(saved.name).toBe("foodwell_invoice_hint");
    const list = await store.list();
    expect(list.some((t) => t.id === saved.id)).toBe(true);
    const result = runCustomTool(saved, { q: "x" });
    expect(result.ok).toBe(true);
    expect(result.note).toContain("invoices");
  });

  it("rejects bad names", async () => {
    const store = new CustomToolStore(`combo_x_custom_tools_test_${crypto.randomUUID()}`);
    await expect(store.save({ name: "Bad Name", description: "x" })).rejects.toThrow(/name/);
  });
});

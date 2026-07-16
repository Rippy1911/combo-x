import { describe, expect, it } from "vitest";
import {
  ViewStore,
  ensureView,
  upsertRows,
  redactSensitiveFields,
  siteProfileLabelName,
} from "./views.js";

describe("ViewStore", () => {
  it("save list get delete with row snapshot", async () => {
    const store = new ViewStore(`views_test_${crypto.randomUUID()}`);
    const saved = await store.save({
      name: "Foodwell scrape",
      source: "snapshot",
      rows: [
        ["name", "price"],
        ["A", "1"],
        ["B", "2"],
      ],
      note: "test",
    });
    expect(saved.id).toBeTruthy();
    const listed = await store.list();
    expect(listed.some((v) => v.id === saved.id)).toBe(true);
    const byName = await store.get("Foodwell scrape");
    expect(byName?.rows?.[1]?.[0]).toBe("A");
    expect(await store.delete(saved.id)).toBe(true);
    expect(await store.get(saved.id)).toBeNull();
  });
});

describe("ensureView + upsertRows", () => {
  it("ensureView creates then upsertRows merges by key columns", async () => {
    const store = new ViewStore(`views_upsert_${crypto.randomUUID()}`);
    const view = await ensureView(store, {
      name: "Catalog",
      columns: ["sku", "name", "price"],
      keyColumns: ["sku"],
    });
    await upsertRows(
      store,
      view.id,
      [
        ["A1", "Widget", "10"],
        ["B2", "Gadget", "20"],
      ],
      ["sku"],
    );
    const updated = await upsertRows(
      store,
      view.id,
      [["A1", "Widget Pro", "12"]],
      ["sku"],
    );
    const rows = updated.rows ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["A1", "Widget Pro", "12"]);
    expect(rows[2]).toEqual(["B2", "Gadget", "20"]);
  });
});

describe("privacy helpers", () => {
  it("redactSensitiveFields masks password keys", () => {
    const out = redactSensitiveFields({
      name: "foodwell",
      password: "secret",
      username: "u",
    });
    expect(out.password).toBe("[redacted]");
    expect(out.username).toBe("u");
  });

  it("siteProfileLabelName parses vault labels", () => {
    expect(siteProfileLabelName("site_profile:foodwell")).toBe("foodwell");
    expect(siteProfileLabelName("openrouter_api_key")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { PageExtensionStore } from "./store.js";

describe("PageExtensionStore", () => {
  it("create approve inject data isolation + audit trail", async () => {
    const store = new PageExtensionStore(`page_ext_test_${crypto.randomUUID()}`);
    const ext = await store.create({
      name: "Allegro viewed",
      source: "ComboX.log('hi')",
      patterns: ["https://allegro.pl/*"],
      sessionId: "sess-1",
    });
    expect(ext.approval).toBe("draft");
    expect(ext.enabled).toBe(false);
    expect(ext.world).toBe("MAIN");
    expect(ext.sourceHash).toMatch(/^[a-f0-9]{64}$/);

    // Not injectable until approved + enabled
    expect(await store.listInjectableForUrl("https://allegro.pl/x")).toHaveLength(0);

    await store.approve(ext.id, "user", "sess-1");
    await store.update(ext.id, { enabled: true }, { actor: "user" });
    const injectable = await store.listInjectableForUrl("https://allegro.pl/oferta/1");
    expect(injectable.map((e) => e.id)).toContain(ext.id);

    await store.setBridge(
      ext.id,
      { exportChannels: ["viewed"], allowStorage: true },
      { actor: "agent", sessionId: "sess-1" },
    );
    await store.dataSet(ext.id, "products", [{ id: "1" }], { actor: "page" });
    expect(await store.dataGet(ext.id, "products")).toEqual([{ id: "1" }]);
    const keys = await store.dataList(ext.id);
    expect(keys.map((k) => k.key)).toContain("products");

    // Source change reverts approval
    const updated = await store.update(
      ext.id,
      { source: "ComboX.log('v2')" },
      { actor: "agent" },
    );
    expect(updated.approval).toBe("draft");
    expect(updated.version).toBe(2);

    const audit = await store.listAudit(ext.id, 50);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain("create");
    expect(actions).toContain("approve");
    expect(actions).toContain("bridge_set");
    expect(actions).toContain("storage_set");
    expect(actions).toContain("update");

    await store.dataClear(ext.id);
    expect(await store.dataList(ext.id)).toHaveLength(0);
  });

  it("does not share data across extensions", async () => {
    const store = new PageExtensionStore(`page_ext_iso_${crypto.randomUUID()}`);
    const a = await store.create({
      name: "A",
      source: "//a",
      patterns: ["https://a.test/*"],
    });
    const b = await store.create({
      name: "B",
      source: "//b",
      patterns: ["https://b.test/*"],
    });
    await store.dataSet(a.id, "secret", "aaa");
    await store.dataSet(b.id, "secret", "bbb");
    expect(await store.dataGet(a.id, "secret")).toBe("aaa");
    expect(await store.dataGet(b.id, "secret")).toBe("bbb");
    await store.remove(a.id);
    expect(await store.dataGet(a.id, "secret")).toBeUndefined();
    expect(await store.dataGet(b.id, "secret")).toBe("bbb");
  });
});

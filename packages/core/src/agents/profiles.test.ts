import { describe, expect, it } from "vitest";
import { AgentProfileStore } from "./profiles.js";

describe("AgentProfileStore", () => {
  it("list get put remove and active meta", async () => {
    const store = new AgentProfileStore(`agents_test_${crypto.randomUUID()}`);
    const p1 = await store.put({
      id: "p1",
      name: "Research",
      toolAllowlist: ["rag_search", "get_page"],
      connectorIds: ["github-rest"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(p1.name).toBe("Research");
    expect((await store.list()).some((p) => p.id === "p1")).toBe(true);
    expect((await store.get("p1"))?.toolAllowlist).toEqual(["rag_search", "get_page"]);

    await store.setActiveId("p1");
    expect(await store.getActiveId()).toBe("p1");

    expect(await store.remove("p1")).toBe(true);
    expect(await store.get("p1")).toBeNull();
    expect(await store.getActiveId()).toBeNull();
  });

  it("setActiveId rejects missing profile", async () => {
    const store = new AgentProfileStore(`agents_test_${crypto.randomUUID()}`);
    await expect(store.setActiveId("missing")).rejects.toThrow(/not found/);
  });
});

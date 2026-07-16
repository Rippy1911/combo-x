import { describe, expect, it } from "vitest";
import { SessionStore } from "./store.js";

describe("SessionStore", () => {
  it("create list search delete", async () => {
    const store = new SessionStore(`sess_test_${crypto.randomUUID()}`);
    const a = await store.create("Alpha chat");
    a.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: "find aironcoach workout plan",
      createdAt: new Date().toISOString(),
    });
    await store.save(a);
    const b = await store.create("Beta chat");
    b.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: "unrelated cooking",
      createdAt: new Date().toISOString(),
    });
    await store.save(b);

    const list = await store.list(10);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]!.updatedAt >= list[1]!.updatedAt).toBe(true);

    const hits = await store.search("aironcoach", 5);
    expect(hits.some((s) => s.id === a.id)).toBe(true);

    await store.delete(a.id);
    expect(await store.get(a.id)).toBeNull();
  });
});

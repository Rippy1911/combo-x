import { describe, expect, it } from "vitest";
import { TaskStore } from "./store.js";

describe("TaskStore", () => {
  it("list put remove setStatus with session/global filters", async () => {
    const store = new TaskStore(`tasks_test_${crypto.randomUUID()}`);

    await store.put({
      id: "t1",
      title: "Scrape PDPs",
      status: "todo",
      sessionId: "sess-a",
    });
    await store.put({
      id: "t2",
      title: "Global backlog",
      status: "todo",
      sessionId: null,
    });

    expect((await store.list({ sessionId: "sess-a" })).map((t) => t.id)).toEqual(["t1"]);
    expect((await store.list({ globalOnly: true })).map((t) => t.id)).toEqual(["t2"]);

    const doing = await store.setStatus("t1", "doing");
    expect(doing?.status).toBe("doing");

    expect(await store.remove("t2")).toBe(true);
    expect(await store.remove("missing")).toBe(false);
  });
});

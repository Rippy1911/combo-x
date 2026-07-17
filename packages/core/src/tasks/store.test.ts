import { describe, expect, it } from "vitest";
import { TaskStore, taskProgress } from "./store.js";

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
    expect(typeof doing?.sortOrder).toBe("number");

    expect(await store.remove("t2")).toBe(true);
    expect(await store.remove("missing")).toBe(false);
  });

  it("assigns sortOrder and reorder persists", async () => {
    const store = new TaskStore(`tasks_order_${crypto.randomUUID()}`);
    const a = await store.put({
      id: "a",
      title: "First",
      status: "todo",
      sessionId: "s",
    });
    const b = await store.put({
      id: "b",
      title: "Second",
      status: "todo",
      sessionId: "s",
    });
    const c = await store.put({
      id: "c",
      title: "Third",
      status: "todo",
      sessionId: "s",
    });
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(1);
    expect(c.sortOrder).toBe(2);
    expect((await store.list({ sessionId: "s" })).map((t) => t.id)).toEqual(["a", "b", "c"]);

    await store.reorder(["c", "a", "b"]);
    expect((await store.list({ sessionId: "s" })).map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect((await store.list({ sessionId: "s" })).map((t) => t.sortOrder)).toEqual([0, 1, 2]);
  });

  it("taskProgress counts done/total", () => {
    expect(
      taskProgress([
        {
          id: "1",
          title: "a",
          status: "done",
          sortOrder: 0,
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "2",
          title: "b",
          status: "todo",
          sortOrder: 1,
          createdAt: "",
          updatedAt: "",
        },
      ]),
    ).toEqual({ done: 1, total: 2 });
  });
});

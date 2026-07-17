import { describe, expect, it } from "vitest";
import { formatOpenTasksBlock, pickOpenTasksForInject } from "./inject.js";
import type { Task } from "./store.js";

function task(partial: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task {
  return {
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-07-16T12:00:00.000Z",
    sortOrder: partial.sortOrder ?? 0,
    ...partial,
  };
}

describe("formatOpenTasksBlock", () => {
  it("returns empty when all done", () => {
    expect(
      formatOpenTasksBlock(
        [task({ id: "a", title: "x", status: "done", sessionId: "s1", sortOrder: 0 })],
        "s1",
      ),
    ).toBe("");
  });

  it("prefers session tasks then global; skips done; respects sortOrder", () => {
    const rows = [
      task({
        id: "g1",
        title: "Global todo",
        status: "todo",
        sessionId: null,
        sortOrder: 0,
        updatedAt: "2026-07-16T11:00:00.000Z",
      }),
      task({
        id: "s2",
        title: "Session later",
        status: "todo",
        sessionId: "sess",
        sortOrder: 1,
        updatedAt: "2026-07-16T14:00:00.000Z",
      }),
      task({
        id: "s1",
        title: "Session first",
        status: "doing",
        sessionId: "sess",
        sortOrder: 0,
        updatedAt: "2026-07-16T13:00:00.000Z",
      }),
      task({ id: "other", title: "Other session", status: "todo", sessionId: "other", sortOrder: 0 }),
      task({ id: "d1", title: "Done", status: "done", sessionId: "sess", sortOrder: 9 }),
    ];
    const picked = pickOpenTasksForInject(rows, "sess", 10);
    expect(picked.map((t) => t.id)).toEqual(["s1", "s2", "g1"]);
    const block = formatOpenTasksBlock(rows, "sess");
    expect(block).toContain("CONVERSATION TASKS 1/3 done");
    expect(block).toContain("Session first");
    expect(block).toContain("Global todo");
    expect(block).not.toContain("Other session");
    expect(block.indexOf("Session first")).toBeLessThan(block.indexOf("Session later"));
  });
});

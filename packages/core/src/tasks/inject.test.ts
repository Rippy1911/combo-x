import { describe, expect, it } from "vitest";
import { formatOpenTasksBlock, pickOpenTasksForInject } from "./inject.js";
import type { Task } from "./store.js";

function task(partial: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task {
  return {
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-07-16T12:00:00.000Z",
    ...partial,
  };
}

describe("formatOpenTasksBlock", () => {
  it("returns empty when all done", () => {
    expect(
      formatOpenTasksBlock([
        task({ id: "a", title: "x", status: "done", sessionId: "s1" }),
      ], "s1"),
    ).toBe("");
  });

  it("prefers session tasks then global; skips done", () => {
    const rows = [
      task({ id: "g1", title: "Global todo", status: "todo", sessionId: null, updatedAt: "2026-07-16T11:00:00.000Z" }),
      task({ id: "s1", title: "Session doing", status: "doing", sessionId: "sess", updatedAt: "2026-07-16T13:00:00.000Z" }),
      task({ id: "s2", title: "Other session", status: "todo", sessionId: "other" }),
      task({ id: "d1", title: "Done", status: "done", sessionId: "sess" }),
    ];
    const picked = pickOpenTasksForInject(rows, "sess", 10);
    expect(picked.map((t) => t.id)).toEqual(["s1", "g1"]);
    const block = formatOpenTasksBlock(rows, "sess");
    expect(block).toContain("OPEN CONVERSATION TASKS");
    expect(block).toContain("Session doing");
    expect(block).toContain("Global todo");
    expect(block).not.toContain("Other session");
    expect(block).not.toContain("Done");
  });
});

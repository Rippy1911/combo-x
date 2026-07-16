import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "@combo-x/core";
import { GROUP_ORDER, TOOL_GROUPS } from "./toolGroups";

describe("TOOL_GROUPS", () => {
  it("covers every AGENT_TOOLS name exactly once", () => {
    const all = Object.values(TOOL_GROUPS).flat();
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(new Set(all).size).toBe(all.length);
    for (const n of names) {
      expect(all, `missing ${n}`).toContain(n);
    }
    for (const n of all) {
      expect(names, `orphan ${n}`).toContain(n);
    }
  });

  it("GROUP_ORDER lists every group key", () => {
    expect(new Set(GROUP_ORDER)).toEqual(new Set(Object.keys(TOOL_GROUPS)));
  });
});

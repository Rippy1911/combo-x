import { describe, expect, it, vi } from "vitest";
import { TOOL_CATALOG } from "./catalog.js";
import { CORE_TOOL_NAMES, pickToolsForGoal, type ToolPickerLlm } from "./pickTools.js";

describe("pickToolsForGoal", () => {
  it("merges core tools and LLM picks intersected with catalog", async () => {
    const llm: ToolPickerLlm = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          tools: ["scrape_pdps", "login", "not_a_tool"],
          rationale: "Need auth + batch PDP scrape",
        }),
      }),
    };

    const result = await pickToolsForGoal(llm, "x-ai/grok-mini", "Map EANs from FoodWell", TOOL_CATALOG);

    for (const core of CORE_TOOL_NAMES) {
      expect(result.tools).toContain(core);
    }
    expect(result.tools).toContain("scrape_pdps");
    expect(result.tools).toContain("login");
    expect(result.tools).not.toContain("not_a_tool");
    expect(result.rationale).toContain("PDP");
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it("falls back to core only on invalid JSON", async () => {
    const llm: ToolPickerLlm = {
      chat: vi.fn().mockResolvedValue({ content: "not json" }),
    };
    const result = await pickToolsForGoal(llm, "worker", "hello", TOOL_CATALOG);
    expect(result.tools.sort()).toEqual([...CORE_TOOL_NAMES].sort());
    expect(result.rationale).toMatch(/invalid JSON/i);
  });
});

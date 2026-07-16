import { describe, expect, it } from "vitest";
import { parseToolArguments, toolArgsToContentRequest, AGENT_TOOLS } from "./tools.js";

describe("tool helpers", () => {
  it("exposes all required tool names", () => {
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_page",
        "get_links",
        "click",
        "type_text",
        "extract",
        "list_tabs",
        "remember",
        "recall",
      ]),
    );
  });

  it("maps tool args to content requests", () => {
    expect(toolArgsToContentRequest("get_page", {})).toEqual({ op: "get_page" });
    expect(toolArgsToContentRequest("click", { selector: "#x" })).toEqual({
      op: "click",
      selector: "#x",
    });
    expect(toolArgsToContentRequest("click", {})).toBeNull();
  });

  it("parses tool argument JSON safely", () => {
    expect(parseToolArguments('{"selector":"#a"}')).toEqual({ selector: "#a" });
    expect(parseToolArguments("not-json")).toEqual({});
    expect(parseToolArguments("")).toEqual({});
  });
});

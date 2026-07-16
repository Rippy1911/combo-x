import { describe, expect, it } from "vitest";
import { parseToolArguments, toolArgsToContentRequest, AGENT_TOOLS } from "./tools.js";

describe("tool helpers", () => {
  it("exposes scrape + parse tool names", () => {
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_page",
        "get_interactive",
        "click_index",
        "type_index",
        "query_all",
        "scroll",
        "wait",
        "find_text",
        "navigate",
        "go_back",
        "close_tab",
        "parse_data",
        "scrape_tables",
        "export_csv",
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
    expect(toolArgsToContentRequest("scroll", { direction: "down" })).toEqual({
      op: "scroll",
      direction: "down",
      percent: undefined,
      selector: undefined,
    });
    expect(toolArgsToContentRequest("query_all", { selector: ".card", limit: 10 })).toEqual({
      op: "query_all",
      selector: ".card",
      limit: 10,
      attributes: undefined,
    });
    expect(toolArgsToContentRequest("parse_data", { intent: "x" })).toBeNull();
  });

  it("parses tool argument JSON safely", () => {
    expect(parseToolArguments('{"selector":"#a"}')).toEqual({ selector: "#a" });
    expect(parseToolArguments("not-json")).toEqual({});
    expect(parseToolArguments("")).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { SENSITIVE_TOOLS } from "../protocol/messages.js";
import { parseToolArguments, toolArgsToContentRequest, AGENT_TOOLS } from "./tools.js";

describe("tool helpers", () => {
  it("exposes scrape + parse + view tool names", () => {
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
        "list_attachments",
        "read_attachment",
        "save_view",
        "list_views",
        "get_view",
        "remember",
        "recall",
        "memory_list",
        "login",
        "scrape_catalog",
        "save_site_profile",
        "get_site_profile",
      ]),
    );
  });

  it("SENSITIVE_TOOLS covers mutate/nav/login tools (T-Sensitive-1)", () => {
    const names = new Set(AGENT_TOOLS.map((t) => t.function.name));
    const mustBeSensitive = [
      "click",
      "type_text",
      "click_index",
      "type_index",
      "navigate",
      "open_tab",
      "go_back",
      "close_tab",
      "login",
      "scrape_catalog",
    ];
    for (const n of mustBeSensitive) {
      expect(SENSITIVE_TOOLS.has(n), `${n} should be sensitive`).toBe(true);
      expect(names.has(n), `${n} should be registered`).toBe(true);
    }
    for (const n of SENSITIVE_TOOLS) {
      expect(names.has(n), `SENSITIVE orphan: ${n}`).toBe(true);
    }
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

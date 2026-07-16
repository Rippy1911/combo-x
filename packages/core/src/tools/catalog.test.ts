import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../browser/tools.js";
import {
  catalogEntry,
  catalogForPrompt,
  filterToolsByNames,
  TOOL_CATALOG,
} from "./catalog.js";

describe("TOOL_CATALOG", () => {
  it("covers every AGENT_TOOLS entry", () => {
    const toolNames = AGENT_TOOLS.map((t) => t.function.name);
    const catalogNames = TOOL_CATALOG.map((t) => t.name);
    expect(catalogNames.sort()).toEqual(toolNames.sort());
  });

  it("has curated metadata for key tools", () => {
    for (const name of [
      "page_digest",
      "scrape_pdps",
      "ensure_scrape_table",
      "parse_data",
      "rest_request",
      "navigate",
      "login",
      "remember",
      "screenshot_viewport",
    ]) {
      const entry = catalogEntry(name);
      expect(entry?.useCases.length).toBeGreaterThan(0);
      expect(entry?.whenToUse).toBeTruthy();
      expect(entry?.whenNotToUse).toBeTruthy();
    }
  });
});

describe("filterToolsByNames", () => {
  it("returns matching ToolDefinitions in AGENT_TOOLS order", () => {
    const picked = filterToolsByNames(["wait", "navigate", "missing"]);
    expect(picked.map((t) => t.function.name)).toEqual(["wait", "navigate"]);
  });
});

describe("catalogForPrompt", () => {
  it("renders compact grouped markdown", () => {
    const md = catalogForPrompt(TOOL_CATALOG.filter((e) => e.name === "page_digest"));
    expect(md).toContain("### browser");
    expect(md).toContain("**page_digest**");
    expect(md).toContain("When:");
  });
});

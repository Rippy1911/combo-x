import { describe, expect, it } from "vitest";
import type { Skill } from "../skills/store.js";
import { formatSkillIndexBlock, formatToolSchemaBlock } from "./promptCatalog.js";

describe("promptCatalog inject", () => {
  it("formats skill index without bodies", () => {
    const skills: Skill[] = [
      {
        id: "1",
        name: "combo-scrape",
        description: "Scrape PDPs",
        body: "SECRET BODY SHOULD NOT APPEAR",
        tags: [],
        scope: "global",
        toolHints: ["scrape_pdps"],
        createdAt: "",
        updatedAt: "",
      },
    ];
    const block = formatSkillIndexBlock(skills);
    expect(block).toContain("AVAILABLE SKILLS");
    expect(block).toContain("combo-scrape");
    expect(block).toMatch(/unlock:\[.*scrape_pdps/);
    expect(block).not.toContain("SECRET BODY");
  });

  it("schema-less index: active lines + locked pack→skill (no parameters JSON)", () => {
    const block = formatToolSchemaBlock(["navigate", "scrape_pdps"], ["navigate"]);
    expect(block).toContain("TOOL INDEX");
    expect(block).toContain("ACTIVE");
    expect(block).toContain("- navigate —");
    expect(block).toContain("scrape → combo-scrape");
    expect(block).toContain("scrape_pdps");
    expect(block).not.toContain("parameters:");
    expect(block).not.toMatch(/"type"\s*:\s*"object"/);
  });
});

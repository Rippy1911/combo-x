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
    expect(block).toContain("unlock:[scrape_pdps]");
    expect(block).not.toContain("SECRET BODY");
  });

  it("includes parameters schema and lock marker", () => {
    const block = formatToolSchemaBlock(["navigate", "scrape_pdps"], ["navigate"]);
    expect(block).toContain("### navigate");
    expect(block).toContain("parameters:");
    expect(block).toContain("scrape_pdps");
    expect(block).toContain("[LOCKED until skill_read]");
    expect(block).not.toMatch(/### navigate\[LOCKED/);
  });
});

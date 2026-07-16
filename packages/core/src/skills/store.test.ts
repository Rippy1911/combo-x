import { describe, expect, it } from "vitest";
import { SkillStore, seedSkillDefinitions } from "./store.js";

describe("SkillStore", () => {
  it("seeds five packs on empty db", async () => {
    const store = new SkillStore({ dbName: `skills_${crypto.randomUUID()}` });
    const list = await store.list();
    expect(list.length).toBe(seedSkillDefinitions().length);
    expect(list.some((s) => s.name === "combo-scrape")).toBe(true);
  });

  it("searches by keyword", async () => {
    const store = new SkillStore({ dbName: `skills_${crypto.randomUUID()}` });
    const hits = await store.search("scrape PDP table");
    expect(hits[0]?.name).toBe("combo-scrape");
  });

  it("saves and deletes custom skill", async () => {
    const store = new SkillStore({
      dbName: `skills_${crypto.randomUUID()}`,
      skipSeed: true,
    });
    const row = await store.save({
      name: "custom",
      description: "test skill",
      body: "do the thing",
      tags: ["t"],
      toolHints: ["export_csv"],
    });
    expect(await store.get(row.id)).toBeTruthy();
    expect(await store.delete(row.id)).toBe(true);
    expect(await store.get(row.id)).toBeNull();
  });
});

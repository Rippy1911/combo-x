import { describe, expect, it } from "vitest";
import { TOOL_PACKS } from "../tools/gating.js";
import { SkillStore, seedSkillDefinitions } from "./store.js";

const EXPECTED_SEED_NAMES = [
  "combo-scrape",
  "combo-rest",
  "combo-rag",
  "combo-page-ext",
  "combo-media",
  "combo-ux-critique",
  "combo-tasks",
  "combo-memory",
  "combo-subagent",
  "combo-vault-setup",
  "combo-pdf-attach",
  "combo-openapi-call",
] as const;

const PLAYBOOK_ONLY = new Set([
  "combo-ux-critique",
  "combo-tasks",
  "combo-memory",
  "combo-subagent",
  "combo-vault-setup",
  "combo-pdf-attach",
]);

describe("SkillStore", () => {
  it("seeds twelve packs on empty db (unique names)", async () => {
    const defs = seedSkillDefinitions();
    expect(defs.map((d) => d.name).sort()).toEqual([...EXPECTED_SEED_NAMES].sort());
    expect(new Set(defs.map((d) => d.name)).size).toBe(EXPECTED_SEED_NAMES.length);

    const store = new SkillStore({ dbName: `skills_${crypto.randomUUID()}` });
    const list = await store.list();
    expect(list.length).toBe(EXPECTED_SEED_NAMES.length);
    for (const name of EXPECTED_SEED_NAMES) {
      expect(list.some((s) => s.name === name)).toBe(true);
    }
  });

  it("playbook-only seeds have empty toolHints; openapi unlocks rest", () => {
    const byName = new Map(seedSkillDefinitions().map((d) => [d.name, d]));
    for (const name of PLAYBOOK_ONLY) {
      expect(byName.get(name)?.toolHints ?? []).toEqual([]);
    }
    expect(byName.get("combo-openapi-call")?.toolHints).toEqual([...TOOL_PACKS.rest]);
  });

  it("upserts missing seed skills on existing db", async () => {
    const dbName = `skills_${crypto.randomUUID()}`;
    const store = new SkillStore({ dbName, skipSeed: true });
    await store.save({
      name: "combo-scrape",
      description: "old",
      body: "old body",
      tags: ["seed"],
      toolHints: [...TOOL_PACKS.scrape],
    });
    // New store instance with seeding enabled should fill missing seeds only
    const store2 = new SkillStore({ dbName });
    const list = await store2.list();
    expect(list.length).toBe(EXPECTED_SEED_NAMES.length);
    expect(list.find((s) => s.name === "combo-scrape")?.description).toBe("old");
    expect(list.some((s) => s.name === "combo-tasks")).toBe(true);
  });

  it("searches by keyword for new and old seeds", async () => {
    const store = new SkillStore({ dbName: `skills_${crypto.randomUUID()}` });
    expect((await store.search("scrape PDP table"))[0]?.name).toBe("combo-scrape");
    expect((await store.search("task board")).some((s) => s.name === "combo-tasks")).toBe(
      true,
    );
    expect((await store.search("pdf attach")).some((s) => s.name === "combo-pdf-attach")).toBe(
      true,
    );
    expect(
      (await store.search("openapi rest")).some((s) => s.name === "combo-openapi-call"),
    ).toBe(true);
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

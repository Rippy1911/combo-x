import { describe, expect, it } from "vitest";
import { TOOL_PACKS } from "../tools/gating.js";
import { SEED_REVISION, SkillStore, seedSkillDefinitions } from "./store.js";

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
  "combo-map",
  "combo-uploads",
  "combo-ns-food",
  "combo-pdf-attach",
  "combo-openapi-call",
  "combo-repo-ops",
] as const;

const PLAYBOOK_ONLY = new Set([
  "combo-ux-critique",
  "combo-tasks",
  "combo-memory",
  "combo-subagent",
  "combo-vault-setup",
  "combo-map",
  "combo-uploads",
  "combo-pdf-attach",
]);

describe("SkillStore", () => {
  it("seeds sixteen packs on empty db (unique names)", async () => {
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
    expect(byName.get("combo-ns-food")?.toolHints).toEqual([...TOOL_PACKS.rest]);
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

  it("getByName resolves seed names exactly (prefers global)", async () => {
    const store = new SkillStore({ dbName: `skills_${crypto.randomUUID()}` });
    const byName = await store.getByName("combo-scrape");
    expect(byName?.name).toBe("combo-scrape");
    expect(byName?.scope).toBe("global");
    expect(await store.getByName("no-such-skill")).toBeNull();
  });

  it("force-refreshes combo-ux-critique when seed revision advances", async () => {
    const dbName = `skills_${crypto.randomUUID()}`;
    const store = new SkillStore({ dbName, skipSeed: true });
    await store.save({
      name: "combo-ux-critique",
      description: "old ux",
      body: "old playbook",
      tags: ["seed", "ux"],
      toolHints: [],
    });
    const store2 = new SkillStore({ dbName });
    const ux = (await store2.list()).find((s) => s.name === "combo-ux-critique");
    expect(ux?.description).not.toBe("old ux");
    expect(ux?.body).toContain("annotate_screenshot");
    expect(ux?.tags).toContain(SEED_REVISION);
  });

  it("drops toolHints that are not real tools", async () => {
    const store = new SkillStore({
      dbName: `skills_${crypto.randomUUID()}`,
      skipSeed: true,
    });
    const row = await store.save({
      name: "custom",
      description: "test skill",
      body: "do the thing",
      toolHints: ["export_csv", "not_a_real_tool", "navigate"],
    });
    expect(row.toolHints).toEqual(["export_csv", "navigate"]);
  });
});

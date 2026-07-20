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
  "combo-self-improve",
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
  "combo-self-improve",
]);

describe("SkillStore", () => {
  it("seeds seventeen packs on empty db (unique names)", async () => {
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
    // Current revision tag → keep custom description (pack refresh skips)
    await store.save({
      name: "combo-scrape",
      description: "old",
      body: "old body",
      tags: ["seed", "tools", SEED_REVISION],
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

  it("refreshes stale combo-rest toolHints when SEED_REVISION advances", async () => {
    const dbName = `skills_${crypto.randomUUID()}`;
    const store = new SkillStore({ dbName, skipSeed: true });
    await store.save({
      name: "combo-rest",
      description: "old rest",
      body: "old playbook",
      tags: ["seed", "tools", "v1.6.29", "rest"],
      // Pre-1.6.41 pack — missing ensure_github_connector
      toolHints: ["rest_request", "mcp_list_tools", "mcp_call"],
    });
    const store2 = new SkillStore({ dbName });
    const rest = (await store2.list()).find((s) => s.name === "combo-rest");
    expect(rest?.tags).toContain(SEED_REVISION);
    expect(rest?.toolHints).toEqual(expect.arrayContaining([
      "rest_request",
      "mcp_list_tools",
      "mcp_call",
    ]));
    expect(rest?.toolHints).toHaveLength(3);
    expect(rest?.body).toContain("ALWAYS ON");
  });

  it("rewrites incomplete combo-rest toolHints even without seed tag", async () => {
    const dbName = `skills_${crypto.randomUUID()}`;
    const store = new SkillStore({ dbName, skipSeed: true });
    // Agent skill_save overwrite — no seed tag, incomplete hints
    await store.save({
      name: "combo-rest",
      description: "agent rewrite",
      body: "Use rest_request only against saved connectors",
      tags: ["rest"],
      toolHints: ["rest_request"],
    });
    const store2 = new SkillStore({ dbName });
    const rest = (await store2.list()).find((s) => s.name === "combo-rest");
    expect(rest?.body).toContain("ALWAYS ON");
    expect(rest?.toolHints).toEqual(expect.arrayContaining([...TOOL_PACKS.rest]));
  });

  it("refreshes every duplicate combo-rest row (not only Map last-write)", async () => {
    const dbName = `skills_${crypto.randomUUID()}`;
    const store = new SkillStore({ dbName, skipSeed: true });
    const a = await store.save({
      id: "rest-stale-a",
      name: "combo-rest",
      description: "stale A",
      body: "Use rest_request only against saved connectors",
      tags: ["rest"],
      toolHints: ["rest_request", "mcp_list_tools", "mcp_call"],
    });
    const b = await store.save({
      id: "rest-stale-b",
      name: "combo-rest",
      description: "stale B",
      body: "Use rest_request only against saved connectors",
      tags: ["rest"],
      toolHints: ["rest_request"],
    });
    expect(a.id).toBe("rest-stale-a");
    expect(b.id).toBe("rest-stale-b");
    const store2 = new SkillStore({ dbName });
    const byIdA = await store2.get("rest-stale-a");
    const byIdB = await store2.get("rest-stale-b");
    expect(byIdA?.toolHints).toContain("rest_request");
    expect(byIdB?.toolHints).toContain("mcp_call");
    const byName = await store2.getByName("combo-rest");
    expect(byName?.toolHints).toEqual(expect.arrayContaining([...TOOL_PACKS.rest]));
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

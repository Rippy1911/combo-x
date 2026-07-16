import { describe, expect, it } from "vitest";
import { MemoryStore, rankMemories, type MemoryEntry } from "./store.js";

describe("rankMemories", () => {
  const entries: MemoryEntry[] = [
    {
      id: "1",
      kind: "note",
      text: "Healthtree PayU production credentials pending from Anita",
      tags: ["healthtree", "payu"],
      createdAt: new Date().toISOString(),
    },
    {
      id: "2",
      kind: "note",
      text: "Combo-X vault uses AES-GCM",
      tags: ["combo-x"],
      createdAt: new Date(Date.now() - 1000).toISOString(),
    },
  ];

  it("ranks by keyword overlap", () => {
    const hits = rankMemories("PayU Healthtree", entries, 5);
    expect(hits[0]?.id).toBe("1");
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("returns empty when no overlap", () => {
    expect(rankMemories("zzzznonexistent", entries)).toHaveLength(0);
  });
});

describe("MemoryStore", () => {
  it("persists and recalls", async () => {
    const store = new MemoryStore({ dbName: `mem_${crypto.randomUUID()}` });
    await store.remember({ text: "User prefers Polish replies", tags: ["prefs"] });
    await store.remember({ text: "OpenRouter key lives in vault", tags: ["keys"] });
    const hits = await store.recall("Polish", 3);
    expect(hits.some((h) => h.text.includes("Polish"))).toBe(true);
  });
});

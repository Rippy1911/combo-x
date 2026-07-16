import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk.js";
import { hybridScore, tokenize } from "./embed.js";
import { shouldIndexFile } from "./folder.js";
import { RagStore } from "./store.js";

describe("local RAG", () => {
  it("chunks text with overlap", () => {
    const text = "Alpha paragraph.\n\n".repeat(40) + "Beta unique token aironcoach.";
    const chunks = chunkText(text, { maxChunkSize: 120, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.includes("aironcoach"))).toBe(true);
  });

  it("hybridScore ranks relevant content", () => {
    const q = "aironcoach workout plan";
    const a = hybridScore(q, "aironcoach manageWorkoutData creates a weekly plan");
    const b = hybridScore(q, "unrelated cooking recipe for pasta");
    expect(a).toBeGreaterThan(b);
    expect(tokenize(q).length).toBeGreaterThan(1);
  });

  it("shouldIndexFile filters junk", () => {
    expect(shouldIndexFile("src/App.tsx")).toBe(true);
    expect(shouldIndexFile("node_modules/foo/index.js")).toBe(false);
    expect(shouldIndexFile("dist/bundle.js")).toBe(false);
    expect(shouldIndexFile("AGENTS.md")).toBe(true);
    expect(shouldIndexFile("tmp/cache/x.ts", ["tmp"])).toBe(false);
  });

  it("RagStore rebuild + search", async () => {
    const store = new RagStore(`rag_test_${crypto.randomUUID()}`);
    await store.rebuildFromFiles(
      [
        {
          path: "src/coach.ts",
          text: "export function buildWorkoutPlan(athleteId: string) { return { days: 3 }; }",
        },
        {
          path: "README.md",
          text: "Aironcoach fitness app documentation and onboarding.",
        },
      ],
      "aironcoach",
    );
    const meta = await store.getMeta();
    expect(meta?.fileCount).toBe(2);
    expect(meta?.chunkCount).toBeGreaterThan(0);
    const hits = await store.search("workout plan athlete", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toMatch(/coach|README/);
    const file = await store.readPath("src/coach.ts");
    expect(file?.content).toMatch(/buildWorkoutPlan/);
  });
});

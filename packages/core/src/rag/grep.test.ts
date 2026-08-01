/**
 * The codebase-search primitives the agent was missing. `rag_search` is a
 * fuzzy hash-vector scan that cannot cite a line and floors out on natural
 * language; these cover the exact-match path an agent actually needs for code.
 */
import { describe, expect, it } from "vitest";
import { chunkStartLines, globToRegExp, grepChunks, type RagChunkRow } from "./store.js";

function chunk(path: string, chunkIndex: number, content: string, startLine?: number): RagChunkRow {
  return {
    id: `${path}#${chunkIndex}`,
    path,
    chunkIndex,
    content,
    embedding: [],
    bytes: content.length,
    indexedAt: "2026-08-01T00:00:00.000Z",
    ...(startLine != null ? { startLine } : {}),
  };
}

const CORPUS: RagChunkRow[] = [
  chunk(
    "src/agent/loop.ts",
    0,
    [
      "import { foo } from './x.js';",
      "",
      "export function buildWorkoutPlan(input: PlanInput) {",
      "  const days = resolveTrainingDays(input);",
      "  return scheduleSessions(days);",
      "}",
    ].join("\n"),
  ),
  chunk(
    "src/agent/repeatGuard.ts",
    0,
    ["export class RepeatGuard {", "  check(name: string) { return true; }", "}"].join("\n"),
  ),
  chunk("README.md", 0, "# Combo-X\nA browser agent.\nbuildWorkoutPlan lives in the agent."),
  chunk("pnpm-lock.yaml", 0, "lockfileVersion: '9.0'\npackages: {}"),
];

describe("globToRegExp", () => {
  it("matches ** across directories", () => {
    const re = globToRegExp("**/*.ts");
    expect(re.test("src/agent/loop.ts")).toBe(true);
    expect(re.test("loop.ts")).toBe(true);
    expect(re.test("src/agent/loop.tsx")).toBe(false);
  });

  it("matches * within a single segment", () => {
    const re = globToRegExp("src/*/loop.ts");
    expect(re.test("src/agent/loop.ts")).toBe(true);
    expect(re.test("src/a/b/loop.ts")).toBe(false);
  });

  it("supports {a,b} alternation", () => {
    const re = globToRegExp("**/*.{ts,tsx}");
    expect(re.test("a.ts")).toBe(true);
    expect(re.test("a/b/c.tsx")).toBe(true);
    expect(re.test("a.js")).toBe(false);
  });

  it("anchors to the whole path", () => {
    expect(globToRegExp("loop.ts").test("src/loop.ts")).toBe(false);
  });
});

describe("grepChunks", () => {
  it("finds an exact identifier with path, line and column", () => {
    const out = grepChunks(CORPUS, { pattern: "buildWorkoutPlan" });
    const paths = out.matches.map((m) => `${m.path}:${m.line}`);
    expect(paths).toContain("src/agent/loop.ts:3");
    expect(paths).toContain("README.md:3");
    const hit = out.matches.find((m) => m.path === "src/agent/loop.ts")!;
    expect(hit.column).toBe(17);
    expect(hit.text).toContain("export function buildWorkoutPlan");
  });

  it("is case-sensitive by default and honours caseInsensitive", () => {
    expect(grepChunks(CORPUS, { pattern: "repeatguard" }).matches).toHaveLength(0);
    expect(
      grepChunks(CORPUS, { pattern: "repeatguard", caseInsensitive: true }).matches.length,
    ).toBeGreaterThan(0);
  });

  it("treats regex metacharacters literally unless regex:true", () => {
    expect(grepChunks(CORPUS, { pattern: "buildWorkoutPlan(" }).matches.length).toBeGreaterThan(0);
    const re = grepChunks(CORPUS, { pattern: "function\\s+build\\w+", regex: true });
    expect(re.matches.some((m) => m.path === "src/agent/loop.ts")).toBe(true);
  });

  it("scopes to a glob", () => {
    const out = grepChunks(CORPUS, { pattern: "buildWorkoutPlan", glob: "src/**/*.ts" });
    expect(out.matches.every((m) => m.path.startsWith("src/"))).toBe(true);
    expect(out.matches.some((m) => m.path === "README.md")).toBe(false);
  });

  it("carries context lines around each hit", () => {
    const out = grepChunks(CORPUS, { pattern: "resolveTrainingDays", context: 1 });
    const hit = out.matches[0]!;
    expect(hit.before[0]).toContain("buildWorkoutPlan");
    expect(hit.after[0]).toContain("scheduleSessions");
  });

  it("caps matches and reports truncation", () => {
    const many: RagChunkRow[] = [
      chunk("big.ts", 0, Array.from({ length: 100 }, (_, i) => `const v${i} = needle;`).join("\n")),
    ];
    const out = grepChunks(many, { pattern: "needle", maxMatches: 10, context: 0 });
    expect(out.matches).toHaveLength(10);
    expect(out.truncated).toBe(true);
  });

  it("returns empty rather than throwing on a bad regex", () => {
    const out = grepChunks(CORPUS, { pattern: "([", regex: true });
    expect(out.matches).toEqual([]);
  });

  it("does not double-report a line that appears in two overlapping chunks", () => {
    // Same source line 2 seen at the end of chunk 0 and the start of chunk 1.
    const overlapping: RagChunkRow[] = [
      chunk("a.ts", 0, "line one\ntarget line\nline three", 1),
      chunk("a.ts", 1, "target line\nline three\nline four", 2),
    ];
    const out = grepChunks(overlapping, { pattern: "target line" });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]!.line).toBe(2);
  });

  it("still reports identical text on DIFFERENT real lines", () => {
    const repeated: RagChunkRow[] = [
      chunk("b.ts", 0, "if (x) {\n  return;\n}\nif (y) {\n  return;\n}", 1),
    ];
    const out = grepChunks(repeated, { pattern: "return;", context: 0 });
    expect(out.matches.map((m) => m.line)).toEqual([2, 5]);
  });

  it("reports real file lines via startLine, not chunk-relative ones", () => {
    const multi: RagChunkRow[] = [
      chunk("c.ts", 0, "alpha\nbeta", 1),
      chunk("c.ts", 1, "gamma\ntarget here", 50),
    ];
    const out = grepChunks(multi, { pattern: "target here" });
    expect(out.matches[0]!.line).toBe(51);
    expect(out.matches[0]!.lineIsEstimate).toBeUndefined();
  });

  it("flags chunk-relative line numbers on pre-startLine indexes", () => {
    const legacy: RagChunkRow[] = [chunk("old.ts", 3, "needle line")];
    const out = grepChunks(legacy, { pattern: "needle" });
    expect(out.matches[0]!.lineIsEstimate).toBe(true);
  });
});

describe("chunkStartLines", () => {
  it("locates each chunk's 1-based start line in the source", () => {
    const source = "l1\nl2\nl3\nl4\nl5\nl6";
    const parts = ["l1\nl2\nl3", "l3\nl4\nl5", "l5\nl6"];
    expect(chunkStartLines(source, parts)).toEqual([1, 3, 5]);
  });

  it("accounts for leading blank lines stripped by the chunker", () => {
    const source = "\n\nconst a = 1;\nconst b = 2;";
    expect(chunkStartLines(source, ["const a = 1;\nconst b = 2;"])).toEqual([3]);
  });

  it("normalizes CRLF like the chunker does", () => {
    const source = "l1\r\nl2\r\nl3";
    expect(chunkStartLines(source, ["l1\nl2", "l2\nl3"])).toEqual([1, 2]);
  });

  it("returns undefined for a chunk it cannot locate", () => {
    expect(chunkStartLines("a\nb", ["not in file"])).toEqual([undefined]);
  });
});

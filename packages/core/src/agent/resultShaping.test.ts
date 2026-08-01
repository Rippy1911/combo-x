/**
 * The 2026-08-01 transcript shows a get_interactive result cut mid-object at
 * item 19: the model received unparseable JSON with no indication that 80 more
 * controls existed. Tool results must always stay valid JSON and always say how
 * to fetch the remainder.
 */
import { describe, expect, it } from "vitest";
import { truncateToolResultForLlm } from "./leanHistory.js";
import { shouldCompactNow, compactTargetChars } from "./budget.js";

function bigInteractiveResult(count: number) {
  return {
    ok: true,
    data: {
      items: Array.from({ length: count }, (_, i) => ({
        i,
        tag: "a",
        kind: "link",
        region: "nav",
        text: `Sidebar destination number ${i} with a fairly long label`,
        href: `https://play.google.com/console/u/0/developers/7135248059108841547/app/nav/${i}`,
      })),
      count,
      total: count,
      offset: 0,
    },
  };
}

type Shaped = {
  ok: boolean;
  data: { items: unknown[]; count: number; total: number; offset: number };
  _truncated: { field: string; shown: number; of: number; dropped: number; hint: string };
};

/** Every browser tool answers `{ok, data:{…}}` — shape against that, not a flat stub. */
function shape(result: unknown, cap = 4_000): Shaped {
  return JSON.parse(truncateToolResultForLlm(result, cap)) as Shaped;
}

describe("truncateToolResultForLlm", () => {
  it("passes small results through unchanged", () => {
    const out = truncateToolResultForLlm({ ok: true, value: 1 }, 4_000);
    expect(JSON.parse(out)).toEqual({ ok: true, value: 1 });
  });

  it("keeps oversized list results parseable", () => {
    const out = truncateToolResultForLlm(bigInteractiveResult(100), 4_000);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out.length).toBeLessThanOrEqual(4_000);
  });

  it("finds the list nested under the tool envelope, not just at the top level", () => {
    // Regression: pickListField only scanned the root, so `{ok,data:{items}}` —
    // i.e. every real browser result — fell through to a mid-string JSON cut.
    const out = shape(bigInteractiveResult(100));
    expect(out._truncated.field).toBe("data.items");
    expect(Array.isArray(out.data.items)).toBe(true);
  });

  it("drops whole entries and reports how many are missing", () => {
    const out = shape(bigInteractiveResult(100));
    expect(out.data.items.length).toBe(out._truncated.shown);
    expect(out._truncated.of).toBe(100);
    expect(out._truncated.dropped).toBe(100 - out._truncated.shown);
    expect(out._truncated.dropped).toBeGreaterThan(0);
  });

  it("reads offset from beside the list, not from the envelope root", () => {
    const base = bigInteractiveResult(100);
    const out = shape({ ...base, data: { ...base.data, offset: 40 } });
    expect(out._truncated.hint).toContain(`offset:${40 + out._truncated.shown}`);
    expect(out._truncated.hint).toMatch(/NOT gone/);
  });

  it("never lets a dropped tail look like the end of the list", () => {
    expect(shape(bigInteractiveResult(100))._truncated.hint).toMatch(
      /Do not conclude the list ended here/,
    );
  });

  it("preserves sibling fields inside and outside the list container", () => {
    const base = bigInteractiveResult(100);
    const out = shape({
      ...base,
      scope: "page",
      data: { ...base.data, matched: 100, region: "nav" },
    }) as Shaped & { scope: string; data: { matched: number; region: string } };
    expect(out.ok).toBe(true);
    expect(out.scope).toBe("page");
    expect(out.data.matched).toBe(100);
    expect(out.data.region).toBe("nav");
    expect(out.data.total).toBe(100);
  });

  it("shapes the other nested list fields tools actually emit", () => {
    for (const field of ["links", "matches", "rows", "tables"] as const) {
      const list = Array.from({ length: 200 }, (_, i) => ({
        i,
        text: `entry ${i} with enough text to matter`,
      }));
      const out = JSON.parse(
        truncateToolResultForLlm({ ok: true, data: { [field]: list, total: 200 } }, 4_000),
      ) as { _truncated: { field: string; of: number } };
      expect(out._truncated.field).toBe(`data.${field}`);
      expect(out._truncated.of).toBe(200);
    }
  });

  it("falls back to a valid-JSON preview for an unstructured blob", () => {
    const out = truncateToolResultForLlm({ ok: true, data: { text: "x".repeat(20_000) } }, 2_000);
    const parsed = JSON.parse(out) as { truncated: boolean; chars: number; hint: string };
    expect(parsed.truncated).toBe(true);
    expect(parsed.chars).toBeGreaterThan(2_000);
    expect(parsed.hint).toMatch(/offset|filter/);
  });

  it("still redacts secrets while shaping", () => {
    const base = bigInteractiveResult(100);
    const out = truncateToolResultForLlm(
      { ...base, data: { ...base.data, password: "hunter2" } },
      4_000,
    );
    expect(out).not.toContain("hunter2");
  });

  it("does not mutate the caller's result object", () => {
    const original = bigInteractiveResult(100);
    truncateToolResultForLlm(original, 4_000);
    expect(original.data.items).toHaveLength(100);
  });
});

describe("compaction hysteresis (prompt-cache preservation)", () => {
  const cap = 40_000;

  it("tolerates a marginal overflow rather than resetting the cache", () => {
    expect(shouldCompactNow({ chars: cap + 100, cap, step: 5, lastCompactStep: null })).toBe(false);
  });

  it("compacts once the overflow is real", () => {
    expect(shouldCompactNow({ chars: cap * 1.4, cap, step: 5, lastCompactStep: null })).toBe(true);
  });

  it("does not re-compact on the very next step", () => {
    expect(shouldCompactNow({ chars: cap * 1.4, cap, step: 6, lastCompactStep: 5 })).toBe(false);
  });

  it("compacts again after the cooldown", () => {
    expect(shouldCompactNow({ chars: cap * 1.4, cap, step: 9, lastCompactStep: 5 })).toBe(true);
  });

  it("ignores the cooldown past the hard ceiling", () => {
    expect(shouldCompactNow({ chars: cap * 2.5, cap, step: 6, lastCompactStep: 5 })).toBe(true);
  });

  it("cuts deep so the next steps stay under the cap", () => {
    expect(compactTargetChars(cap)).toBeLessThanOrEqual(cap / 2);
  });

  it("is inert when no cap is configured", () => {
    expect(shouldCompactNow({ chars: 1e9, cap: 0, step: 3, lastCompactStep: null })).toBe(false);
  });
});

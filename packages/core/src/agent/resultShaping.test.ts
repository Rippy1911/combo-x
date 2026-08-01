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

describe("truncateToolResultForLlm", () => {
  it("passes small results through unchanged", () => {
    const out = truncateToolResultForLlm({ ok: true, value: 1 }, 4_000);
    expect(JSON.parse(out)).toEqual({ ok: true, value: 1 });
  });

  it("keeps oversized list results parseable", () => {
    const out = truncateToolResultForLlm({ ok: true, items: bigInteractiveResult(100).data.items }, 4_000);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out.length).toBeLessThanOrEqual(4_000);
  });

  it("drops whole entries and reports how many are missing", () => {
    const out = JSON.parse(
      truncateToolResultForLlm({ ok: true, items: bigInteractiveResult(100).data.items }, 4_000),
    ) as {
      items: unknown[];
      _truncated: { shown: number; of: number; dropped: number; hint: string };
    };
    expect(out.items.length).toBe(out._truncated.shown);
    expect(out._truncated.of).toBe(100);
    expect(out._truncated.dropped).toBe(100 - out._truncated.shown);
    expect(out._truncated.dropped).toBeGreaterThan(0);
  });

  it("tells the agent the exact offset to resume from", () => {
    const out = JSON.parse(
      truncateToolResultForLlm(
        { ok: true, offset: 40, items: bigInteractiveResult(100).data.items },
        4_000,
      ),
    ) as { _truncated: { shown: number; hint: string } };
    expect(out._truncated.hint).toContain(`offset:${40 + out._truncated.shown}`);
    expect(out._truncated.hint).toMatch(/NOT gone/);
  });

  it("never lets a dropped tail look like the end of the list", () => {
    const out = JSON.parse(
      truncateToolResultForLlm({ ok: true, items: bigInteractiveResult(100).data.items }, 4_000),
    ) as { _truncated: { hint: string } };
    expect(out._truncated.hint).toMatch(/Do not conclude the list ended here/);
  });

  it("preserves sibling fields alongside the trimmed list", () => {
    const out = JSON.parse(
      truncateToolResultForLlm(
        { ok: true, scope: "page", matched: 100, items: bigInteractiveResult(100).data.items },
        4_000,
      ),
    ) as { ok: boolean; scope: string; matched: number };
    expect(out.ok).toBe(true);
    expect(out.scope).toBe("page");
    expect(out.matched).toBe(100);
  });

  it("falls back to a valid-JSON preview for an unstructured blob", () => {
    const out = truncateToolResultForLlm({ ok: true, text: "x".repeat(20_000) }, 2_000);
    const parsed = JSON.parse(out) as { truncated: boolean; chars: number; hint: string };
    expect(parsed.truncated).toBe(true);
    expect(parsed.chars).toBeGreaterThan(2_000);
    expect(parsed.hint).toMatch(/offset|filter/);
  });

  it("still redacts secrets while shaping", () => {
    const out = truncateToolResultForLlm(
      { ok: true, password: "hunter2", items: bigInteractiveResult(100).data.items },
      4_000,
    );
    expect(out).not.toContain("hunter2");
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

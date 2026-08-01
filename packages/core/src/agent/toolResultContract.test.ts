/**
 * The contract between what browser tools *emit* and what the history shaper
 * *understands*.
 *
 * These two sides drifted once already and shipped: the shaper only scanned the
 * top level for a list field, while every handler answers `{ok, data:{items}}`.
 * The unit tests on each side passed because the shaper's fixtures were flat —
 * a shape the runtime never produces. So exercise the real handler output here
 * rather than a hand-written stub, and let the two halves meet.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { handleContentRequest } from "../browser/content-handlers.js";
import { truncateToolResultForLlm } from "./leanHistory.js";

/** A console-style page: a huge sidebar and a small main region. */
function renderHeavyConsole(navLinks = 120): void {
  const nav = Array.from(
    { length: navLinks },
    (_, i) =>
      `<a href="/console/u/0/developers/713524805910/app/49737017091/section-${i}">` +
      `Sidebar destination number ${i} with a fairly long Polish label</a>`,
  ).join("");
  document.body.innerHTML = `
    <header><a href="/home">Konsola Google Play</a></header>
    <nav aria-label="primary">${nav}</nav>
    <main>
      <h1>Panel</h1>
      <button>Utwórz nową wersję</button>
      <a href="/publishing">Przegląd publikowanych zmian</a>
    </main>`;
}

/** The mid-loop cap is small in budget mode — that is where truncation bites. */
const CAP = 3_000;

describe("handler output survives history shaping", () => {
  beforeEach(() => {
    renderHeavyConsole();
  });

  for (const op of ["get_interactive", "get_links"] as const) {
    it(`${op}: stays parseable and reports the dropped remainder`, () => {
      const raw = handleContentRequest({ op, scope: "page", region: "any" }, document);
      const shaped = truncateToolResultForLlm(raw, CAP);

      expect(() => JSON.parse(shaped)).not.toThrow();
      expect(shaped.length).toBeLessThanOrEqual(CAP);

      const out = JSON.parse(shaped) as {
        ok: boolean;
        data: Record<string, unknown>;
        _truncated?: { field: string; shown: number; of: number; hint: string };
      };
      expect(out.ok).toBe(true);
      // The payload is far over the cap, so shaping must have engaged.
      expect(out._truncated).toBeDefined();
      expect(out._truncated!.field).toMatch(/^data\./);
      expect(out._truncated!.of).toBeGreaterThan(out._truncated!.shown);
      expect(out._truncated!.hint).toMatch(/offset:\d+/);
    });
  }

  it("get_interactive: shaping drops a tail but never renumbers what it keeps", () => {
    const raw = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "any" },
      document,
    );
    const full = (raw.data as { items: { i: number; text: string }[] }).items;
    const kept = (
      JSON.parse(truncateToolResultForLlm(raw, CAP)) as {
        data: { items: { i: number; text: string }[] };
      }
    ).data.items;

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(full.length);
    // `i` is the click-map index. If shaping reindexed the survivors, the model
    // would pass a stale number to click_index and hit the wrong control.
    for (const [pos, item] of kept.entries()) {
      expect(item.i).toBe(full[pos]!.i);
      expect(item.text).toBe(full[pos]!.text);
    }
  });

  it("find_text: hit list is shaped, not sliced mid-object", () => {
    const raw = handleContentRequest(
      { op: "find_text", text: "Sidebar destination number", limit: 200 },
      document,
    );
    const shaped = truncateToolResultForLlm(raw, CAP);
    expect(() => JSON.parse(shaped)).not.toThrow();
    const out = JSON.parse(shaped) as { _truncated?: { field: string } };
    if (out._truncated) expect(out._truncated.field).toMatch(/^data\.(matches|items)$/);
  });

  it("get_page text is a blob, so it degrades to a preview with a retry hint", () => {
    document.body.innerHTML = `<main>${"long content ".repeat(4_000)}</main>`;
    const raw = handleContentRequest({ op: "get_page", maxChars: 40_000 }, document);
    const out = JSON.parse(truncateToolResultForLlm(raw, CAP)) as {
      truncated?: boolean;
      hint?: string;
    };
    expect(out.truncated).toBe(true);
    expect(out.hint).toMatch(/offset|filter/);
  });

  it("a result that already fits is passed through untouched", () => {
    document.body.innerHTML = `<main><button>Only one</button></main>`;
    const raw = handleContentRequest({ op: "get_interactive" }, document);
    const out = JSON.parse(truncateToolResultForLlm(raw, CAP)) as {
      _truncated?: unknown;
      data: { items: unknown[] };
    };
    expect(out._truncated).toBeUndefined();
    expect(out.data.items).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { annotateRedirect, RepeatGuard } from "./repeatGuard.js";

const NAV = { url: "https://play.google.com/console/app/1/app-content" };

describe("RepeatGuard", () => {
  it("allows the first call and stays quiet", () => {
    const g = new RepeatGuard();
    expect(g.check("navigate", NAV).kind).toBe("ok");
    expect(g.record("navigate", NAV, { ok: true, url: "/app-list" }).kind).toBe("ok");
  });

  it("still lets the second call reach the browser", () => {
    // The thresholds count duplicate *outcomes*, not calls. Blocking here would
    // mean one unlucky result permanently bans the arguments.
    const g = new RepeatGuard();
    g.record("navigate", NAV, { ok: true, url: "/app-list" });
    expect(g.check("navigate", NAV).kind).toBe("ok");
  });

  it("nudges on the second identical call+result", () => {
    const g = new RepeatGuard();
    const same = { ok: true, url: "/app-list" };
    g.record("navigate", NAV, same);
    const second = g.record("navigate", NAV, same);
    expect(second.kind).toBe("warn");
    if (second.kind === "warn") {
      expect(second.note).toMatch(/identical result/);
      expect(second.note).toMatch(/get_interactive|find_text/);
    }
  });

  it("refuses the third identical call before it runs", () => {
    const g = new RepeatGuard();
    const same = { ok: true, url: "/app-list" };
    g.record("navigate", NAV, same);
    g.record("navigate", NAV, same);
    const verdict = g.check("navigate", NAV);
    expect(verdict.kind).toBe("block");
    if (verdict.kind === "block") {
      expect(verdict.result.error).toBe("repeated_call_blocked");
      expect(String(verdict.result.hint)).toMatch(/redirected or requires a different entry point/);
    }
  });

  it("does not punish polling a page that is actually changing", () => {
    const g = new RepeatGuard();
    g.record("get_page", {}, { text: "loading" });
    g.record("get_page", {}, { text: "loaded" });
    g.record("get_page", {}, { text: "loaded and rendered" });
    expect(g.check("get_page", {}).kind).toBe("ok");
  });

  it("resets the streak once the result finally changes", () => {
    const g = new RepeatGuard();
    g.record("get_page", {}, { text: "spinner" });
    expect(g.record("get_page", {}, { text: "spinner" }).kind).toBe("warn");
    expect(g.record("get_page", {}, { text: "content" }).kind).toBe("ok");
    expect(g.check("get_page", {}).kind).toBe("ok");
  });

  it("treats key order as irrelevant when comparing arguments", () => {
    const g = new RepeatGuard();
    const res = { ok: true };
    g.record("click", { selector: "a", index: 1 }, res);
    expect(g.record("click", { index: 1, selector: "a" }, res).kind).toBe("warn");
  });

  it("keeps different arguments independent", () => {
    const g = new RepeatGuard();
    const res = { ok: true };
    g.record("navigate", { url: "/a" }, res);
    g.record("navigate", { url: "/a" }, res);
    expect(g.check("navigate", { url: "/b" }).kind).toBe("ok");
  });

  it("annotates without hiding the payload", () => {
    const out = RepeatGuard.annotate({ ok: true, items: [1, 2] }, "nudge") as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.items).toEqual([1, 2]);
    expect(out._repeat).toBe("nudge");
  });

  it("gives tool-specific alternatives, not a generic scold", () => {
    const g = new RepeatGuard();
    const res = { ok: true, items: [] };
    g.record("get_interactive", { scope: "page" }, res);
    g.record("get_interactive", { scope: "page" }, res);
    const verdict = g.check("get_interactive", { scope: "page" });
    if (verdict.kind !== "block") throw new Error("expected block");
    expect(String(verdict.result.hint)).toMatch(/filter/);
  });
});

describe("semantic observation stuck guard", () => {
  it("warns at 6 consecutive observations with varied args", () => {
    const g = new RepeatGuard();
    let last: ReturnType<RepeatGuard["record"]> = { kind: "ok" };
    for (let i = 0; i < 6; i++) {
      last = g.record("get_page", { filter: `x${i}` }, { ok: true, data: { text: `t${i}` } });
    }
    expect(last.kind).toBe("warn");
    if (last.kind === "warn") {
      expect(last.note).toMatch(/6 observations without changing anything/);
      expect(last.note).toMatch(/list_form_fields|within|excludeSelector/);
    }
    expect(g.getObservationStreak()).toBe(6);
  });

  it("blocks the 9th observation before it runs", () => {
    const g = new RepeatGuard();
    for (let i = 0; i < 9; i++) {
      g.record("find_text", { text: `q${i}` }, { ok: true, matches: [] });
    }
    expect(g.getObservationStreak()).toBe(9);
    const verdict = g.check("get_interactive", { filter: "Save" });
    expect(verdict.kind).toBe("block");
    if (verdict.kind === "block") {
      expect(verdict.result.error).toBe("observation_stuck_blocked");
    }
  });

  it("resets the streak on a mutation", () => {
    const g = new RepeatGuard();
    for (let i = 0; i < 6; i++) {
      g.record("get_interactive", { filter: `f${i}` }, { ok: true, items: [] });
    }
    expect(g.getObservationStreak()).toBe(6);
    g.record("click_index", { index: 3 }, { ok: true, clickedIndex: 3 });
    expect(g.getObservationStreak()).toBe(0);
    expect(g.record("get_page", {}, { ok: true, data: { text: "x" } }).kind).toBe("ok");
  });

  it("does not trip when the observed URL is changing", () => {
    const g = new RepeatGuard();
    for (let i = 0; i < 8; i++) {
      const verdict = g.record(
        "get_page",
        { offset: i },
        { ok: true, data: { text: "loading", url: `https://app.test/step/${i}` } },
      );
      expect(verdict.kind).toBe("ok");
    }
    expect(g.check("get_page", {}).kind).toBe("ok");
    expect(g.getObservationStreak()).toBe(1);
  });
});

describe("annotateRedirect", () => {
  it("flags a silent redirect and names both URLs", () => {
    const out = annotateRedirect(
      "https://play.google.com/console/app/1/app-content",
      { ok: true, url: "https://play.google.com/console/app-list" },
    ) as Record<string, unknown>;
    expect(out.redirected).toBe(true);
    expect(out.requestedUrl).toContain("app-content");
    expect(String(out.hint)).toMatch(/do not retry the same URL/i);
  });

  it("stays silent when the landing URL is the requested one", () => {
    const out = annotateRedirect("https://example.com/a", {
      ok: true,
      url: "https://example.com/a",
    }) as Record<string, unknown>;
    expect(out.redirected).toBeUndefined();
  });

  it("ignores trailing slash and query differences", () => {
    const out = annotateRedirect("https://example.com/a", {
      ok: true,
      url: "https://example.com/a/?utm=1",
    }) as Record<string, unknown>;
    expect(out.redirected).toBeUndefined();
  });

  it("passes non-object results through untouched", () => {
    expect(annotateRedirect("https://example.com", null)).toBeNull();
  });
});

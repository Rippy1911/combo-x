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

/**
 * Semantic stuck guard — the 2026-08-03 Base44 editor run made ~12 varied
 * read-only calls with zero mutations; the identical-call guard never fired
 * because args and results kept changing. Distinct args/results per call.
 */
describe("RepeatGuard stuck-loop guard", () => {
  const read = (g: RepeatGuard, n: number, tool = "get_interactive") => {
    for (let i = 0; i < n; i++) {
      g.check(tool, { round: i });
      g.record(tool, { round: i }, { ok: true, items: [i] });
    }
  };

  it("warns on the 6th consecutive read-only call with varied args", () => {
    const g = new RepeatGuard();
    let last: ReturnType<RepeatGuard["record"]> = { kind: "ok" };
    for (let i = 0; i < 6; i++) {
      g.check("get_interactive", { round: i });
      last = g.record("get_interactive", { round: i }, { ok: true, items: [i] });
    }
    expect(last.kind).toBe("warn");
    if (last.kind === "warn") expect(last.note).toMatch(/read-only observations/);
  });

  it("a mutation resets the observation streak", () => {
    const g = new RepeatGuard();
    read(g, 5); // streak 5
    g.check("click_index", { index: 3 });
    g.record("click_index", { index: 3 }, { ok: true }); // reset
    read(g, 5); // streak 5 again — still quiet
    expect(g.check("get_page", {}).kind).toBe("ok");
  });

  it("blocks the 11th consecutive read-only call when no wait() was used", () => {
    const g = new RepeatGuard();
    read(g, 10);
    const verdict = g.check("find_text", { text: "x" });
    expect(verdict.kind).toBe("block");
    if (verdict.kind === "block") {
      expect(verdict.result.error).toBe("stuck_loop_blocked");
      expect(String(verdict.result.hint)).toMatch(/list_form_fields|BLOCKED/);
    }
  });

  it("the block resets the streak, so recovery reads (list_tabs) are allowed", () => {
    // Field case 2026-08-03: the active tab changed mid-run; the agent's
    // recovery move (list_tabs) is itself read-only and must not stay refused.
    const g = new RepeatGuard();
    read(g, 10);
    expect(g.check("find_text", { text: "x" }).kind).toBe("block");
    expect(g.check("list_tabs", {}).kind).toBe("ok");
    const verdict = g.record("list_tabs", {}, { ok: true, tabs: [] });
    expect(verdict.kind).toBe("ok");
  });

  it("wait() marks deliberate polling: warns but never blocks", () => {
    const g = new RepeatGuard();
    let warned = false;
    for (let i = 0; i < 12; i++) {
      g.check("wait", { ms: 1000 + i });
      if (g.record("wait", { ms: 1000 + i }, { ok: true, data: { waitedMs: 1000 + i } }).kind === "warn") {
        warned = true;
      }
      g.check("get_page", { round: i });
      if (g.record("get_page", { round: i }, { ok: true, text: `state ${i}` }).kind === "warn") {
        warned = true;
      }
    }
    expect(warned).toBe(true);
    expect(g.check("get_page", {}).kind).not.toBe("block");
  });

  it("identical-call blocking still works alongside the streak guard", () => {
    const g = new RepeatGuard();
    const same = { ok: true, url: "/app-list" };
    g.record("navigate", NAV, same);
    g.record("navigate", NAV, same);
    expect(g.check("navigate", NAV).kind).toBe("block");
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

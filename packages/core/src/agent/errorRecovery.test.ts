/**
 * A tool that throws used to hand the model a bare `"The operation was
 * aborted."` — no tool name, no cause, no next step. On the Play Console run
 * that string was the entire content of two tool cards. The model cannot
 * recover from an error it cannot interpret, so the message must carry one.
 */
import { describe, expect, it } from "vitest";
import { toolErrorRecovery } from "./loop.js";

describe("toolErrorRecovery", () => {
  it("turns a bare AbortError into a recovery path, not a finding", () => {
    const out = toolErrorRecovery("ux_critique", "The operation was aborted.");
    expect(out.tool).toBe("ux_critique");
    const hint = String(out.hint);
    expect(hint).toMatch(/not a result about the page/i);
    expect(hint).toMatch(/retry ux_critique once/i);
    expect(hint).toMatch(/wait/i);
  });

  it("names the tool on a timeout and pushes toward a narrower retry", () => {
    const out = toolErrorRecovery("get_interactive", "Request timed out");
    expect(out.tool).toBe("get_interactive");
    expect(String(out.hint)).toMatch(/narrower/i);
  });

  it("always names the tool even when there is no specific guidance", () => {
    const out = toolErrorRecovery("scrape_tables", "no <table> on page");
    expect(out.tool).toBe("scrape_tables");
    expect(out.hint).toBeUndefined();
  });
});

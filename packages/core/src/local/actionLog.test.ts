import { describe, expect, it } from "vitest";
import {
  ActionLogStore,
  approvalDecisionFor,
  extractTargetUrl,
  summarizeResult,
} from "./actionLog.js";

describe("actionLog helpers", () => {
  it("approvalDecisionFor", () => {
    expect(approvalDecisionFor("ask", true, true)).toBe("allowed");
    expect(approvalDecisionFor("ask", false, true)).toBe("denied");
    expect(approvalDecisionFor("auto_all", true, true)).toBe("auto_all");
    expect(approvalDecisionFor("auto_llm", true, true)).toBe("auto_llm");
    expect(approvalDecisionFor("ask", true, false)).toBe("n/a");
  });

  it("extractTargetUrl + summarizeResult", () => {
    expect(extractTargetUrl({ url: "https://example.com/x" })).toBe("https://example.com/x");
    expect(summarizeResult({ ok: true, n: 1 })).toContain("ok");
  });
});

describe("ActionLogStore", () => {
  it("append list export redact password args", async () => {
    const store = new ActionLogStore(`alog_${crypto.randomUUID()}`);
    await store.append({
      tool: "login",
      args: { profile: "foodwell", password: "secret" },
      resultSummary: '{"ok":true}',
      ok: true,
      approvalDecision: "allowed",
      approvalMode: "ask",
      pageUrl: "https://b2b.foodwell.pl/login",
      pageTitle: "Login",
      sessionId: "sess1",
      runId: "run1",
    });
    const list = await store.list(10);
    expect(list).toHaveLength(1);
    expect(list[0]!.args.password).toBe("[redacted]");
    expect(list[0]!.pageUrl).toContain("foodwell");
    const json = await store.exportJson();
    expect(json).not.toContain("secret");
    expect(json).toContain("[redacted]");
  });

  it("redacts nested profile password in resultSummary", async () => {
    const store = new ActionLogStore(`alog_${crypto.randomUUID()}`);
    await store.append({
      tool: "get_site_profile",
      args: { name: "foodwell" },
      resultSummary: JSON.stringify({
        ok: true,
        profile: { username: "anita", password: "hunter2" },
      }),
      ok: true,
      approvalDecision: "n/a",
      approvalMode: "ask",
    });
    const json = await store.exportJson();
    expect(json).not.toContain("hunter2");
    expect(json).toContain("[redacted]");
  });

  it("redacts type_index text when selector is password", async () => {
    const store = new ActionLogStore(`alog_${crypto.randomUUID()}`);
    await store.append({
      tool: "type_index",
      args: { index: 3, selector: "#password", text: "hunter2" },
      resultSummary: '{"ok":true}',
      ok: true,
      approvalDecision: "allowed",
      approvalMode: "ask",
    });
    const row = (await store.list(1))[0]!;
    expect(row.args.text).toBe("[redacted]");
  });
});

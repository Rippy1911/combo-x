import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../llm/openrouter.js";
import { historyFromUiTurns, leanHistory } from "./leanHistory.js";

describe("leanHistory (T-LEAN-1)", () => {
  it("drops tool rows and keeps assistant crumbs", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "scrape it" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "get_page", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "1",
        name: "get_page",
        content: JSON.stringify({ title: "Huge page", text: "x".repeat(5000) }),
      },
      { role: "assistant", content: "Done scraping." },
    ];
    const lean = leanHistory(history);
    expect(lean.every((m) => m.role !== "tool")).toBe(true);
    const toolCrumb = lean.find(
      (m) => m.role === "assistant" && String(m.content).includes("tools:"),
    );
    expect(toolCrumb).toBeTruthy();
    expect(String(toolCrumb?.content)).toContain("Results:");
    expect(String(toolCrumb?.content)).toContain("Huge page");
    expect(lean[lean.length - 1]?.content).toBe("Done scraping.");
  });

  it("caps from the tail", () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      history.push({ role: "user", content: `u${i} ${"y".repeat(2000)}` });
      history.push({ role: "assistant", content: `a${i} ${"z".repeat(2000)}` });
    }
    const lean = leanHistory(history, 8_000);
    const chars = lean.reduce((n, m) => n + String(m.content ?? "").length, 0);
    expect(chars).toBeLessThanOrEqual(8_000 + 500);
    expect(String(lean[lean.length - 1]?.content)).toMatch(/^a19/);
  });

  it("redacts password/token keys in tool result crumbs", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "login" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "login", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "1",
        name: "login",
        content: JSON.stringify({ ok: true, password: "s3cret", api_key: "sk-x" }),
      },
      { role: "assistant", content: "Logged in." },
    ];
    const lean = leanHistory(history);
    const crumb = String(lean.find((m) => String(m.content).includes("Results:"))?.content);
    expect(crumb).toContain("[redacted]");
    expect(crumb).not.toContain("s3cret");
    expect(crumb).not.toContain("sk-x");
  });

  it("historyFromUiTurns rebuilds redacted crumbs from tool chips", () => {
    const msgs = historyFromUiTurns([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "Done",
        tools: [
          {
            name: "login",
            result: { password: "nope", title: "ok" },
          },
        ],
      },
    ]);
    expect(msgs).toHaveLength(2);
    expect(String(msgs[1]?.content)).toContain("Results:");
    expect(String(msgs[1]?.content)).toContain("[redacted]");
    expect(String(msgs[1]?.content)).not.toContain("nope");
    expect(String(msgs[1]?.content)).toContain("ok");
  });
});

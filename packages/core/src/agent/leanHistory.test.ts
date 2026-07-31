import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../llm/openrouter.js";
import {
  compactMidLoopMessages,
  compressHistory,
  historyChars,
  historyFromUiTurns,
  leanHistory,
  scrubDataUrls,
  truncateToolResultForLlm,
} from "./leanHistory.js";

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

  it("truncateToolResultForLlm keeps small payloads and caps large ones", () => {
    expect(truncateToolResultForLlm({ ok: true, n: 1 }, 4_000)).toBe(
      JSON.stringify({ ok: true, n: 1 }),
    );
    const big = { text: "x".repeat(10_000) };
    const capped = truncateToolResultForLlm(big, 4_000);
    const parsed = JSON.parse(capped) as {
      truncated: boolean;
      chars: number;
      preview: string;
    };
    expect(parsed.truncated).toBe(true);
    expect(parsed.chars).toBeGreaterThan(4_000);
    expect(parsed.preview.length).toBeLessThan(4_000);
    expect(capped.length).toBeLessThan(4_500);
  });

  it("truncateToolResultForLlm scrubs data URLs", () => {
    const b64 = "B".repeat(200);
    const capped = truncateToolResultForLlm(
      { dataUrl: `data:image/png;base64,${b64}` },
      4_000,
    );
    expect(capped).toContain("data:image…[redacted]");
    expect(capped).not.toContain(b64);
  });

  it("scrubs megabase64 data URLs from crumbs", () => {
    const b64 = "A".repeat(200);
    const raw = `screenshot_viewport: {"ok":true,"dataUrl":"data:image/png;base64,${b64}"}`;
    expect(scrubDataUrls(raw)).toContain("data:image…[redacted]");
    expect(scrubDataUrls(raw)).not.toContain(b64);

    const history: ChatMessage[] = [
      { role: "user", content: "shot" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "screenshot_viewport", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "1",
        name: "screenshot_viewport",
        content: JSON.stringify({
          ok: true,
          dataUrl: `data:image/png;base64,${b64}`,
        }),
      },
    ];
    const lean = leanHistory(history);
    const joined = lean.map((m) => String(m.content)).join("\n");
    expect(joined).not.toContain(b64);
  });
});

describe("compressHistory (context limit)", () => {
  function bigTurns(n: number, chars: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ role: "user", content: `u${i} ${"y".repeat(chars)}` });
      out.push({
        role: "assistant",
        content: `a${i} ${"z".repeat(chars)}`,
      });
    }
    return out;
  }

  it("historyChars sums message lengths", () => {
    const h: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ];
    expect(historyChars(h)).toBe(5 + 16 + 5 + 16);
  });

  it("returns history unchanged when under limit", () => {
    const h = bigTurns(2, 100);
    const r = compressHistory(h, 10_000);
    expect(r.compressed).toBe(false);
    expect(r.history).toBe(h);
    expect(r.droppedTurns).toBe(0);
  });

  it("returns history unchanged when contextLimit is 0 (disabled)", () => {
    const h = bigTurns(50, 500);
    const r = compressHistory(h, 0);
    expect(r.compressed).toBe(false);
    expect(r.history).toBe(h);
  });

  it("compresses older turns into a summary when over limit", () => {
    const h = bigTurns(20, 800);
    const limit = 8_000;
    const r = compressHistory(h, limit);
    expect(r.compressed).toBe(true);
    expect(r.droppedTurns).toBeGreaterThan(0);
    expect(r.afterChars).toBeLessThan(r.beforeChars);
    expect(r.afterChars).toBeLessThanOrEqual(limit + 200);
    // First message is the summary marker
    const first = r.history[0]!;
    expect(first.role).toBe("user");
    expect(String(first.content)).toMatch(/CONTEXT AUTO-COMPRESSED/i);
    expect(String(first.content)).toMatch(/USER GOALS/i);
    // Newest turn is preserved verbatim
    const last = r.history[r.history.length - 1]!;
    expect(String(last.content)).toMatch(/^a19/);
  });

  it("summary preserves user goals from dropped turns", () => {
    const h: ChatMessage[] = [
      { role: "user", content: "scrape the catalog" },
      { role: "assistant", content: "done" },
      { role: "user", content: "now export csv" },
      { role: "assistant", content: "x".repeat(9000) },
    ];
    const r = compressHistory(h, 4_000);
    expect(r.compressed).toBe(true);
    const summary = String(r.history[0]?.content);
    expect(summary).toContain("scrape the catalog");
    expect(summary).toContain("now export csv");
  });

  it("summary mentions list_tasks resume instruction", () => {
    const h = bigTurns(20, 800);
    const r = compressHistory(h, 8_000);
    expect(String(r.history[0]?.content)).toMatch(/list_tasks/i);
  });

  it("tool crumbs are preserved in summary", () => {
    const h: ChatMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "navigate", arguments: "{}" },
          },
        ],
      },
      { role: "assistant", content: "x".repeat(9000) },
    ];
    const r = compressHistory(h, 4_000);
    if (r.compressed) {
      const summary = String(r.history[0]?.content);
      expect(summary).toMatch(/tools:\s*navigate/i);
    }
  });
});

describe("compactMidLoopMessages", () => {
  function toolRound(id: string, name: string, resultChars: number): ChatMessage[] {
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id,
            type: "function",
            function: { name, arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: id,
        name,
        content: "x".repeat(resultChars),
      },
    ];
  }

  it("no-ops when under maxChars", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      ...toolRound("1", "navigate", 100),
    ];
    const r = compactMidLoopMessages(messages, { maxChars: 50_000 });
    expect(r.compacted).toBe(false);
    expect(r.messages).toBe(messages);
  });

  it("keeps newest tool rounds in OpenAI shape and folds older ones", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "audit the site" },
      ...toolRound("1", "navigate", 3_000),
      ...toolRound("2", "page_digest", 3_000),
      ...toolRound("3", "get_interactive", 3_000),
      ...toolRound("4", "click_index", 3_000),
    ];
    const r = compactMidLoopMessages(messages, {
      maxChars: 8_000,
      keepRecentRounds: 2,
    });
    expect(r.compacted).toBe(true);
    expect(r.droppedRounds).toBe(2);
    expect(r.afterChars).toBeLessThan(r.beforeChars);
    // System preserved
    expect(r.messages[0]?.role).toBe("system");
    // Newest rounds still have real tool rows
    const toolRows = r.messages.filter((m) => m.role === "tool");
    expect(toolRows.length).toBeGreaterThanOrEqual(2);
    expect(toolRows.some((m) => m.tool_call_id === "4")).toBe(true);
    // Older rounds should not keep raw tool rows for id 1
    expect(toolRows.some((m) => m.tool_call_id === "1")).toBe(false);
  });

  it("preserves the last assistant tool_calls pair for the next model turn", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      ...toolRound("a", "navigate", 4_000),
      ...toolRound("b", "page_digest", 4_000),
      ...toolRound("c", "get_page", 4_000),
    ];
    const r = compactMidLoopMessages(messages, {
      maxChars: 6_000,
      keepRecentRounds: 1,
    });
    expect(r.compacted).toBe(true);
    const lastAssistant = [...r.messages].reverse().find((m) => m.role === "assistant");
    expect(lastAssistant?.tool_calls?.[0]?.id).toBe("c");
    const lastTool = [...r.messages].reverse().find((m) => m.role === "tool");
    expect(lastTool?.tool_call_id).toBe("c");
  });
});

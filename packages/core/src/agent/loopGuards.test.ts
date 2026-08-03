/**
 * End-to-end guards for the failure modes seen in the 2026-08-01 Play Console
 * run: the same navigate repeated four times against a silent redirect, and a
 * volatile task list sitting in front of the cached tool catalog.
 */
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, OpenRouterClient } from "../llm/openrouter.js";
import { MemoryStore } from "../memory/store.js";
import { TaskStore } from "../tasks/store.js";
import type { BrowserBridge } from "./loop.js";
import { AgentLoop } from "./loop.js";

function mockLlm(
  sequence: Array<{
    content: string | null;
    toolCalls?: Array<{ id: string; name: string; args: string }>;
  }>,
  onChat?: (messages: ChatMessage[]) => void,
) {
  let i = 0;
  const next = async (opts: { model: string; messages?: ChatMessage[] }) => {
    onChat?.(opts.messages ?? []);
    const step = sequence[i] ?? sequence[sequence.length - 1]!;
    i += 1;
    return {
      content: step.content,
      toolCalls: (step.toolCalls ?? []).map((t) => ({
        id: t.id,
        type: "function" as const,
        function: { name: t.name, arguments: t.args },
      })),
      model: opts.model,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCostUsd: 0 },
      finishReason: step.toolCalls?.length ? "tool_calls" : "stop",
    };
  };
  return {
    chat: vi.fn(next),
    chatStreaming: vi.fn(next),
  } as unknown as OpenRouterClient;
}

function stubBrowser(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  return {
    runContent: vi.fn(async () => ({ ok: true, data: { title: "t", url: "u", text: "x" } })),
    listTabs: vi.fn(async () => []),
    openTab: vi.fn(async (url: string) => ({ id: 1, url })),
    activateTab: vi.fn(async () => ({ ok: true })),
    navigate: vi.fn(async (url: string) => ({ ok: true, url })),
    goBack: vi.fn(async () => ({ ok: true })),
    closeTab: vi.fn(async () => ({ ok: true })),
    downloadText: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

const navCall = (id: string) => ({
  id,
  name: "navigate",
  args: JSON.stringify({ url: "https://play.google.com/console/app/1/app-content" }),
});

describe("repeat-call guard inside the agent loop", () => {
  it("stops a redirect loop instead of burning the step budget", async () => {
    // Every navigate silently lands on /app-list — the exact Play Console bug.
    const navigate = vi.fn(async () => ({
      ok: true,
      url: "https://play.google.com/console/app-list",
    }));
    const browser = stubBrowser({ navigate });
    const llm = mockLlm([
      { content: null, toolCalls: [navCall("1")] },
      { content: null, toolCalls: [navCall("2")] },
      { content: null, toolCalls: [navCall("3")] },
      { content: null, toolCalls: [navCall("4")] },
      { content: "Giving up on that URL." },
    ]);
    const agent = new AgentLoop(llm, browser, new MemoryStore({ dbName: `g_${crypto.randomUUID()}` }));

    const results: unknown[] = [];
    await agent.run({
      model: "mock",
      approvalMode: "auto_all",
      userMessage: "open app content",
      onEvent: (e) => {
        if (e.type === "tool_result") results.push(e.result);
      },
    });

    // Two attempts reach the browser; the third and fourth are refused outright.
    expect(navigate).toHaveBeenCalledTimes(2);
    const blocked = results.filter(
      (r) => (r as { error?: string })?.error === "repeated_call_blocked",
    );
    expect(blocked.length).toBeGreaterThanOrEqual(1);
  });

  it("tells the agent it was redirected rather than reporting plain success", async () => {
    const browser = stubBrowser({
      navigate: vi.fn(async () => ({
        ok: true,
        url: "https://play.google.com/console/app-list",
      })),
    });
    const llm = mockLlm([
      { content: null, toolCalls: [navCall("1")] },
      { content: "done" },
    ]);
    const agent = new AgentLoop(llm, browser, new MemoryStore({ dbName: `g_${crypto.randomUUID()}` }));

    let navResult: Record<string, unknown> | undefined;
    await agent.run({
      model: "mock",
      approvalMode: "auto_all",
      userMessage: "go",
      onEvent: (e) => {
        if (e.type === "tool_result" && e.tool === "navigate") {
          navResult = e.result as Record<string, unknown>;
        }
      },
    });

    expect(navResult?.redirected).toBe(true);
    expect(String(navResult?.requestedUrl)).toContain("app-content");
    expect(String(navResult?.hint)).toMatch(/click_index|get_interactive/);
  });

  it("leaves an honest navigation unannotated", async () => {
    const browser = stubBrowser();
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [{ id: "1", name: "navigate", args: JSON.stringify({ url: "https://example.com/a" }) }],
      },
      { content: "done" },
    ]);
    const agent = new AgentLoop(llm, browser, new MemoryStore({ dbName: `g_${crypto.randomUUID()}` }));
    let navResult: Record<string, unknown> | undefined;
    await agent.run({
      model: "mock",
      approvalMode: "auto_all",
      userMessage: "go",
      onEvent: (e) => {
        if (e.type === "tool_result" && e.tool === "navigate") {
          navResult = e.result as Record<string, unknown>;
        }
      },
    });
    expect(navResult?.redirected).toBeUndefined();
  });
});

describe("stop checkpoint on abort", () => {
  it("appends a task summary when stopping with open todo/doing tasks", async () => {
    const tasks = new TaskStore(`tasks_${crypto.randomUUID()}`);
    const sessionId = "sess-stop";
    await tasks.put({
      id: "t1",
      title: "Edit FaqPage meta",
      status: "doing",
      sessionId,
      note: "saved FaqPage",
    });
    await tasks.put({
      id: "t2",
      title: "Edit Row3 meta",
      status: "todo",
      sessionId,
    });

    const llm = mockLlm([
      {
        content: null,
        toolCalls: [
          { id: "1", name: "click_index", args: JSON.stringify({ index: 2 }) },
        ],
      },
      {
        content: null,
        toolCalls: [{ id: "2", name: "get_page", args: "{}" }],
      },
      { content: "should not reach" },
    ]);
    const runContent = vi.fn(async (req: { op?: string }) => {
      if (req.op === "click_index") return { ok: true, data: { clickedIndex: 2 } };
      return { ok: true, data: { title: "t", url: "https://app.test/x", text: "x" } };
    });
    const browser = stubBrowser({ runContent });
    const agent = new AgentLoop(llm, browser, new MemoryStore({ dbName: `g_${crypto.randomUUID()}` }));
    const controller = new AbortController();

    // Abort after the first tool turn completes (mutation recorded), before the next model call.
    let toolTurns = 0;
    const result = await agent.run({
      model: "mock",
      approvalMode: "auto_all",
      userMessage: "edit meta tags",
      sessionId,
      tasks,
      signal: controller.signal,
      maxSteps: 8,
      onEvent: (e) => {
        if (e.type === "tool_result") {
          toolTurns += 1;
          if (toolTurns >= 1) controller.abort();
        }
      },
    });

    expect(result.aborted).toBe(true);
    expect(result.finalText).toMatch(/^Stopped\. Tasks: 0\/2 done; last action:/);
    expect(result.finalText).toMatch(/clicked index 2/);
  });
});

describe("semantic stuck guard inside the agent loop", () => {
  it("warns after 6 read-only calls and resets on a click", async () => {
    const runContent = vi.fn(async (req: { op?: string }) => {
      if (req.op === "click_index") return { ok: true, data: { clickedIndex: 0 } };
      return { ok: true, data: { title: "t", url: "https://app.test/meta", text: "x", items: [] } };
    });
    const browser = stubBrowser({ runContent });

    const reads = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      name: "get_page",
      args: JSON.stringify({ filter: `noise-${i}` }),
    }));
    const llm = mockLlm([
      { content: null, toolCalls: reads.slice(0, 3) },
      { content: null, toolCalls: reads.slice(3, 6) },
      {
        content: null,
        toolCalls: [{ id: "click", name: "click_index", args: JSON.stringify({ index: 0 }) }],
      },
      {
        content: null,
        toolCalls: [{ id: "after", name: "get_page", args: JSON.stringify({ filter: "after" }) }],
      },
      { content: "done" },
    ]);
    const agent = new AgentLoop(llm, browser, new MemoryStore({ dbName: `g_${crypto.randomUUID()}` }));

    const results: Array<{ tool?: string; result: unknown }> = [];
    await agent.run({
      model: "mock",
      approvalMode: "auto_all",
      userMessage: "edit rows",
      maxSteps: 12,
      onEvent: (e) => {
        if (e.type === "tool_result") results.push({ tool: e.tool, result: e.result });
      },
    });

    const readResults = results.filter((r) => r.tool === "get_page");
    const sixth = readResults[5]?.result as { _repeat?: string };
    expect(sixth?._repeat).toMatch(/observations without changing anything/);

    const afterClick = results.filter((r) => r.tool === "get_page").slice(6);
    expect(afterClick.length).toBeGreaterThanOrEqual(1);
    expect((afterClick[0]?.result as { _repeat?: string })?._repeat).toBeUndefined();
  });
});

describe("prompt-cache layout", () => {
  it("keeps the volatile task list out of the cached system prefix", async () => {
    const seen: ChatMessage[][] = [];
    const llm = mockLlm([{ content: "ok" }], (messages) => seen.push(messages));
    const agent = new AgentLoop(llm, stubBrowser(), new MemoryStore({ dbName: `g_${crypto.randomUUID()}` }));
    await agent.run({ model: "mock", userMessage: "hi" });

    const system = String(seen[0]!.find((m) => m.role === "system")?.content ?? "");
    expect(system).toContain("Combo-X");
    expect(system).not.toMatch(/OPEN TASKS/);
    expect(system).not.toMatch(/AGENT MEMORIES/);
  });

  it("puts the large stable tool catalog last in the system message", async () => {
    const seen: ChatMessage[][] = [];
    const llm = mockLlm([{ content: "ok" }], (messages) => seen.push(messages));
    const agent = new AgentLoop(llm, stubBrowser(), new MemoryStore({ dbName: `g_${crypto.randomUUID()}` }));
    await agent.run({ model: "mock", userMessage: "hi" });

    const system = String(seen[0]!.find((m) => m.role === "system")?.content ?? "");
    const catalogAt = system.indexOf("TOOL INDEX");
    expect(catalogAt).toBeGreaterThan(0);
    // Nothing volatile may follow it, or the cache breaks behind the biggest block.
    expect(system.slice(catalogAt)).not.toMatch(/OPEN TASKS|AGENT MEMORIES/);
  });
});

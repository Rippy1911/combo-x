/**
 * End-to-end guards for the failure modes seen in the 2026-08-01 Play Console
 * run: the same navigate repeated four times against a silent redirect, and a
 * volatile task list sitting in front of the cached tool catalog.
 */
import "fake-indexeddb/auto";
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

  it("stop-checkpoint: an abort surfaces open tasks in the done message", async () => {
    // The 2026-08-03 Base44 run was stopped mid-grind and lost all progress
    // state. Deterministic abort: signal is already aborted before the loop.
    const sessionId = `s_${crypto.randomUUID()}`;
    const tasks = new TaskStore(`t_${crypto.randomUUID()}`);
    await tasks.put({
      id: crypto.randomUUID(),
      title: "Fill 46 meta rows",
      status: "doing",
      sessionId,
    });
    const agent = new AgentLoop(
      mockLlm([{ content: "unused" }]),
      stubBrowser(),
      new MemoryStore({ dbName: `g_${crypto.randomUUID()}` }),
    );

    const controller = new AbortController();
    controller.abort();
    const events: Array<{ type: string; message?: string }> = [];
    const result = await agent.run({
      model: "mock",
      approvalMode: "auto_all",
      userMessage: "go",
      sessionId,
      tasks,
      signal: controller.signal,
      onEvent: (e) => events.push(e as { type: string; message?: string }),
    });

    expect(result.aborted).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(String(done?.message)).toContain("Stopped mid-run");
    expect(String(done?.message)).toContain("Fill 46 meta rows");
    expect(events.some((e) => e.type === "status" && /open tasks/.test(e.message ?? ""))).toBe(true);
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

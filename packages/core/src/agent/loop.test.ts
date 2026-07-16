import { describe, expect, it, vi } from "vitest";
import type { OpenRouterClient } from "../llm/openrouter.js";
import { MemoryStore } from "../memory/store.js";
import { AgentLoop } from "./loop.js";

function mockLlm(sequence: Array<{ content: string | null; toolCalls?: Array<{ id: string; name: string; args: string }> }>) {
  let i = 0;
  return {
    chat: vi.fn(async () => {
      const step = sequence[i] ?? sequence[sequence.length - 1]!;
      i += 1;
      return {
        content: step.content,
        toolCalls: (step.toolCalls ?? []).map((t) => ({
          id: t.id,
          type: "function" as const,
          function: { name: t.name, arguments: t.args },
        })),
        model: "mock",
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          estimatedCostUsd: 0.0001,
        },
        finishReason: step.toolCalls?.length ? "tool_calls" : "stop",
      };
    }),
  } as unknown as OpenRouterClient;
}

describe("AgentLoop", () => {
  it("runs get_page then answers", async () => {
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [{ id: "1", name: "get_page", args: "{}" }],
      },
      { content: "The page title is Example." },
    ]);

    const browser = {
      runContent: vi.fn(async () => ({
        ok: true,
        data: { title: "Example", url: "https://example.com", text: "Hello" },
      })),
      listTabs: vi.fn(async () => []),
    };

    const memory = new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` });
    const agent = new AgentLoop(llm, browser, memory);
    const events: string[] = [];
    const result = await agent.run({
      model: "mock",
      userMessage: "What is this page?",
      onEvent: (e) => events.push(e.type),
    });

    expect(result.finalText).toContain("Example");
    expect(result.aborted).toBe(false);
    expect(result.steps).toBe(2);
    expect(browser.runContent).toHaveBeenCalled();
    expect(events).toContain("tool_start");
    expect(events).toContain("done");
  });

  it("respects abort signal", async () => {
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [{ id: "1", name: "get_page", args: "{}" }],
      },
    ]);
    const controller = new AbortController();
    controller.abort();
    const agent = new AgentLoop(
      llm,
      {
        runContent: async () => ({ ok: true, data: {} }),
        listTabs: async () => [],
      },
      new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` }),
    );
    const result = await agent.run({
      model: "mock",
      userMessage: "hi",
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  });

  it("remember + recall tools hit MemoryStore", async () => {
    const llm = mockLlm([
      {
        content: null,
        toolCalls: [
          {
            id: "1",
            name: "remember",
            args: JSON.stringify({ text: "Anita prefers morning calls", tags: ["anita"] }),
          },
        ],
      },
      {
        content: null,
        toolCalls: [{ id: "2", name: "recall", args: JSON.stringify({ query: "Anita" }) }],
      },
      { content: "Noted: Anita prefers morning calls." },
    ]);
    const memory = new MemoryStore({ dbName: `agent_${crypto.randomUUID()}` });
    const agent = new AgentLoop(
      llm,
      { runContent: async () => ({ ok: true }), listTabs: async () => [] },
      memory,
    );
    const result = await agent.run({ model: "mock", userMessage: "save and recall" });
    expect(result.finalText).toMatch(/Anita/);
    const hits = await memory.recall("Anita");
    expect(hits.length).toBeGreaterThan(0);
  });
});

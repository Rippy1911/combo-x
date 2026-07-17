import { describe, expect, it, vi } from "vitest";
import type { OpenRouterClient } from "../llm/openrouter.js";
import { MemoryStore } from "../memory/store.js";
import { SkillStore } from "../skills/store.js";
import { AGENT_TOOLS } from "../browser/tools.js";
import { AgentLoop, type BrowserBridge } from "./loop.js";

function mockLlm(
  steps: Array<{
    content?: string | null;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  }>,
): OpenRouterClient {
  let i = 0;
  const next = async () => {
    const step = steps[Math.min(i, steps.length - 1)]!;
    i += 1;
    return {
      content: step.content ?? null,
      toolCalls: (step.toolCalls ?? []).map((t) => ({
        id: t.id,
        type: "function" as const,
        function: { name: t.name, arguments: t.arguments },
      })),
      model: "mock",
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        estimatedCostUsd: 0,
      },
      finishReason: step.toolCalls?.length ? "tool_calls" : "stop",
    };
  };
  return {
    chat: vi.fn(next),
    chatStreaming: vi.fn(next),
  } as unknown as OpenRouterClient;
}

function stubBrowser(): BrowserBridge {
  return {
    runContent: vi.fn(async () => ({ ok: true, data: {} })),
    listTabs: vi.fn(async () => []),
    openTab: vi.fn(async (url) => ({ id: 1, url })),
    activateTab: vi.fn(async () => ({ ok: true })),
    navigate: vi.fn(async (url) => ({ ok: true, url })),
    goBack: vi.fn(async () => ({ ok: true })),
    closeTab: vi.fn(async () => ({ ok: true })),
    downloadText: vi.fn(async () => ({ ok: true })),
  };
}

describe("skill gating runtime", () => {
  async function runUnlockScenario(
    resolveArgs: (skills: SkillStore) => Promise<Record<string, string>> | Record<string, string>,
  ) {
    const skills = new SkillStore({ dbName: `gate_${crypto.randomUUID()}` });
    expect((await skills.list()).some((s) => s.name === "combo-scrape")).toBe(true);
    const skillReadArgs = await resolveArgs(skills);

    const llm = mockLlm([
      {
        toolCalls: [
          {
            id: "c1",
            name: "ensure_scrape_table",
            arguments: JSON.stringify({
              name: "t",
              columns: ["a"],
              mergeKeys: ["a"],
            }),
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "c2",
            name: "skill_read",
            arguments: JSON.stringify(skillReadArgs),
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "c3",
            name: "ensure_scrape_table",
            arguments: JSON.stringify({
              name: "t",
              columns: ["a"],
              mergeKeys: ["a"],
            }),
          },
        ],
      },
      { content: "done" },
    ]);

    const agent = new AgentLoop(
      llm,
      stubBrowser(),
      new MemoryStore({ dbName: `m_${crypto.randomUUID()}` }),
    );
    const results: unknown[] = [];
    const unlocked: string[][] = [];

    await agent.run({
      model: "mock",
      userMessage: "unlock scrape",
      skills,
      toolMode: "skill_gated",
      enabledTools: AGENT_TOOLS.map((t) => t.function.name),
      approvalMode: "auto_all",
      maxSteps: 8,
      views: {
        list: async () => [],
        get: async () => null,
        save: async (v: unknown) => v,
        remove: async () => false,
        ensure: async () => ({
          id: "v1",
          name: "t",
          columns: ["a"],
          mergeKeys: ["a"],
          rows: [["a"]],
          createdAt: "",
          updatedAt: "",
        }),
      } as never,
      onEvent: (e) => {
        if (e.type === "tool_result") results.push(e.result);
        if (e.type === "tools_unlocked") {
          unlocked.push(e.unlockedTools ?? []);
        }
      },
    });

    return { results, unlocked };
  }

  it("rejects gated tool until skill_read unlocks it (UUID id)", async () => {
    const { results, unlocked } = await runUnlockScenario(async (skills) => {
      const scrape = (await skills.list()).find((s) => s.name === "combo-scrape")!;
      return { id: scrape.id };
    });

    const first = results[0] as { error?: string };
    expect(first?.error).toBe("tool_locked");
    const unlock = results[1] as { ok?: boolean; unlockedTools?: string[] };
    expect(unlock?.ok).toBe(true);
    expect(unlocked[0]?.length).toBeGreaterThan(0);
    const after = results[2] as { ok?: boolean; error?: string };
    expect(after?.error).not.toBe("tool_locked");
  });

  it("skill_read unlocks when id is the seed name (combo-scrape)", async () => {
    const { results, unlocked } = await runUnlockScenario(() => ({ id: "combo-scrape" }));

    expect((results[0] as { error?: string })?.error).toBe("tool_locked");
    const unlock = results[1] as { ok?: boolean; name?: string };
    expect(unlock?.ok).toBe(true);
    expect(unlock?.name).toBe("combo-scrape");
    expect(unlocked[0]?.length).toBeGreaterThan(0);
    expect((results[2] as { error?: string })?.error).not.toBe("tool_locked");
  });

  it("skill_read unlocks via name arg (combo-rag)", async () => {
    const skills = new SkillStore({ dbName: `gate_${crypto.randomUUID()}` });
    const llm = mockLlm([
      {
        toolCalls: [
          {
            id: "c1",
            name: "skill_read",
            arguments: JSON.stringify({ name: "combo-rag" }),
          },
        ],
      },
      { content: "done" },
    ]);
    const results: unknown[] = [];
    const agent = new AgentLoop(
      llm,
      stubBrowser(),
      new MemoryStore({ dbName: `m_${crypto.randomUUID()}` }),
    );
    await agent.run({
      model: "mock",
      userMessage: "load rag skill",
      skills,
      toolMode: "skill_gated",
      enabledTools: AGENT_TOOLS.map((t) => t.function.name),
      approvalMode: "auto_all",
      maxSteps: 4,
      onEvent: (e) => {
        if (e.type === "tool_result") results.push(e.result);
      },
    });
    const unlock = results[0] as { ok?: boolean; name?: string };
    expect(unlock?.ok).toBe(true);
    expect(unlock?.name).toBe("combo-rag");
  });
});

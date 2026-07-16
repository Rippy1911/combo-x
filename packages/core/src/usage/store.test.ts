import { describe, expect, it } from "vitest";
import { providerFromModel, UsageStore } from "./store.js";

describe("providerFromModel", () => {
  it("parses openrouter provider prefix", () => {
    expect(providerFromModel("x-ai/grok-4.5")).toBe("x-ai");
    expect(providerFromModel("anthropic/claude-sonnet-4")).toBe("anthropic");
  });

  it("returns whole id when no slash", () => {
    expect(providerFromModel("gpt-4o")).toBe("gpt-4o");
  });
});

describe("UsageStore", () => {
  it("append list aggregate and totals", async () => {
    const store = new UsageStore(`usage_test_${crypto.randomUUID()}`);
    await store.append({
      kind: "llm",
      sessionId: "s1",
      model: "x-ai/grok-4.5",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCostUsd: 0.002,
    });
    await store.append({
      kind: "tool",
      sessionId: "s1",
      tool: "page_digest",
    });
    await store.append({
      kind: "message",
      sessionId: "s2",
      role: "user",
    });

    const s1 = await store.list({ sessionId: "s1" });
    expect(s1).toHaveLength(2);

    const byModel = await store.aggregateByModel();
    expect(byModel[0]?.key).toBe("x-ai/grok-4.5");
    expect(byModel[0]?.totalTokens).toBe(150);

    const byProvider = await store.aggregateByProvider();
    expect(byProvider.some((r) => r.key === "x-ai")).toBe(true);

    const totals = await store.totals({ sessionId: "s1" });
    expect(totals.events).toBe(2);
    expect(totals.totalTokens).toBe(150);

    await store.clear();
    expect(await store.list()).toHaveLength(0);
  });
});

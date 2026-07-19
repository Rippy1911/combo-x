import { describe, expect, it, vi } from "vitest";
import { OpenRouterClient } from "./openrouter.js";

describe("OpenRouterClient server tools", () => {
  it("appends openrouter:web_search when enabled", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok", tool_calls: [] }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      );
    });
    const client = new OpenRouterClient({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      enableOpenRouterServerTools: true,
    });
    await client.chat({
      model: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "noop",
            description: "x",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
    const tools = body.tools as Array<{ type: string }>;
    expect(tools.some((t) => t.type === "openrouter:web_search")).toBe(true);
    expect(tools.some((t) => t.type === "openrouter:web_fetch")).toBe(true);
    expect(tools.some((t) => t.type === "function")).toBe(true);
  });
});

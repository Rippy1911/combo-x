import { describe, expect, it } from "vitest";
import { OpenRouterClient, parseSse } from "./openrouter.js";

async function* chunks(...parts: string[]) {
  for (const p of parts) yield p;
}

describe("parseSse", () => {
  it("yields content deltas and stops on [DONE]", async () => {
    const out: string[] = [];
    for await (const d of parseSse(
      chunks(
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        "data: [DONE]\n",
      ),
    )) {
      out.push(d);
    }
    expect(out.join("")).toBe("Hello");
  });
});

describe("OpenRouterClient.chat", () => {
  it("parses tool calls from a non-stream response", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "test-model",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "get_page", arguments: "{}" },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const client = new OpenRouterClient({ apiKey: "sk-test", fetchImpl });
    const result = await client.chat({
      model: "test-model",
      messages: [{ role: "user", content: "read the page" }],
      tools: [],
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.function.name).toBe("get_page");
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("throws LlmError on non-OK", async () => {
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 401 });
    const client = new OpenRouterClient({ apiKey: "bad", fetchImpl });
    await expect(
      client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ name: "LlmError", status: 401 });
  });
});

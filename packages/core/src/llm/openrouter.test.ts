import { describe, expect, it } from "vitest";
import { OpenRouterClient, extractReasoningText, parseSse } from "./openrouter.js";

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

describe("extractReasoningText", () => {
  it("reads reasoning, reasoning_content, and reasoning_details", () => {
    expect(extractReasoningText({ reasoning: "a" })).toBe("a");
    expect(extractReasoningText({ reasoning_content: "b" })).toBe("b");
    expect(
      extractReasoningText({
        reasoning_details: [{ text: "c" }, { text: "d" }],
      }),
    ).toBe("cd");
  });
});

describe("OpenRouterClient.chatStreaming", () => {
  it("streams reasoning tokens separately from content", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"reasoning":"Think "}}]}\n',
      'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"hard"}]}}]}\n',
      'data: {"choices":[{"delta":{"content":"Answer"}}]}\n',
      'data: {"choices":[{"finish_reason":"stop"}]}\n',
      "data: [DONE]\n",
    ].join("");
    const fetchImpl: typeof fetch = async () =>
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    const client = new OpenRouterClient({ apiKey: "sk-test", fetchImpl });
    const reasoning: string[] = [];
    const result = await client.chatStreaming({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      onReasoning: (s) => reasoning.push(s),
    });
    expect(reasoning.at(-1)).toBe("Think hard");
    expect(result.reasoning).toBe("Think hard");
    expect(result.content).toBe("Answer");
  });

  it("accumulates content deltas and tool_calls", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hi "}}]}\n',
      'data: {"choices":[{"delta":{"content":"there"}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_page","arguments":""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n',
      "data: [DONE]\n",
    ].join("");
    const fetchImpl: typeof fetch = async () =>
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    const client = new OpenRouterClient({ apiKey: "sk-test", fetchImpl });
    const deltas: string[] = [];
    const result = await client.chatStreaming({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      onDelta: (s) => deltas.push(s),
    });
    expect(deltas.at(-1)).toBe("Hi there");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.function.name).toBe("get_page");
    expect(result.toolCalls[0]?.function.arguments).toBe("{}");
  });

  it("fires onToolCallDelta once when tool name first appears", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"navigate","arguments":""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"url\\":\\"x\\"}"}}]},"finish_reason":"tool_calls"}]}\n',
      "data: [DONE]\n",
    ].join("");
    const fetchImpl: typeof fetch = async () =>
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    const client = new OpenRouterClient({ apiKey: "sk-test", fetchImpl });
    const planned: string[] = [];
    await client.chatStreaming({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      onToolCallDelta: (name) => planned.push(name),
    });
    expect(planned).toEqual(["navigate"]);
  });

  it("omits OpenRouter-only headers and stream_options for Moonshot baseUrl", async () => {
    let body: Record<string, unknown> = {};
    let headers: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      headers = new Headers(init?.headers);
      return new Response("data: [DONE]\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const client = new OpenRouterClient({
      apiKey: "sk-moon",
      baseUrl: "https://api.moonshot.ai/v1",
      fetchImpl,
    });
    await client.chatStreaming({
      model: "kimi-k2.6",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.stream_options).toBeUndefined();
    expect(headers?.get("HTTP-Referer")).toBeNull();
    expect(headers?.get("X-Title")).toBeNull();
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
    expect(result.usage.costSource).toBe("estimate");
  });

  it("prefers OpenRouter native usage.cost", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "test-model",
          choices: [{ finish_reason: "stop", message: { content: "ok" } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0042 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const client = new OpenRouterClient({ apiKey: "sk-test", fetchImpl });
    const result = await client.chat({
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.usage.estimatedCostUsd).toBe(0.0042);
    expect(result.usage.costSource).toBe("openrouter");
  });

  it("lists models from /models", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toContain("/models");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "x-ai/grok-4.5",
              name: "Grok 4.5",
              context_length: 256000,
              pricing: { prompt: "0.000001", completion: "0.000003" },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const client = new OpenRouterClient({ apiKey: "sk-test", fetchImpl });
    const models = await client.listModels();
    expect(models[0]?.id).toBe("x-ai/grok-4.5");
    expect(models[0]?.promptPrice).toBe(0.000001);
  });

  it("throws LlmError on non-OK", async () => {
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 401 });
    const client = new OpenRouterClient({ apiKey: "bad", fetchImpl });
    await expect(
      client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ name: "LlmError", status: 401 });
  });

  it("rejects empty model before fetch (avoids OpenRouter No models provided)", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };
    const client = new OpenRouterClient({ apiKey: "sk-test", fetchImpl });
    await expect(
      client.chat({ model: "  ", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ name: "LlmError", status: 400 });
    expect(called).toBe(false);
  });
});

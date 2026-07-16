/**
 * OpenRouter client with streaming + native tool calling.
 * Combo Phase B had stream/chat only — no tools. That blocked a real agent.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Rough USD estimate using OpenRouter-style cents; overridden if provider returns cost. */
  estimatedCostUsd: number;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  model: string;
  usage: LlmUsage;
  finishReason: string | null;
}

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  referer?: string;
  title?: string;
  /** USD per 1M prompt tokens (fallback estimator). */
  promptUsdPerMTok?: number;
  /** USD per 1M completion tokens. */
  completionUsdPerMTok?: number;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

function emptyUsage(): LlmUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly referer: string;
  private readonly title: string;
  private readonly promptUsdPerMTok: number;
  private readonly completionUsdPerMTok: number;

  constructor(options: OpenRouterOptions) {
    if (!options.apiKey) throw new Error("apiKey required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.referer = options.referer ?? "https://github.com/Rippy1911/combo-x";
    this.title = options.title ?? "Combo-X";
    this.promptUsdPerMTok = options.promptUsdPerMTok ?? 0.3;
    this.completionUsdPerMTok = options.completionUsdPerMTok ?? 2.5;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": this.referer,
      "X-Title": this.title,
    };
  }

  private estimate(usage: { prompt_tokens?: number; completion_tokens?: number }): LlmUsage {
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const estimatedCostUsd =
      (promptTokens / 1_000_000) * this.promptUsdPerMTok +
      (completionTokens / 1_000_000) * this.completionUsdPerMTok;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd,
    };
  }

  async chat(input: {
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      stream: false,
    };
    if (input.tools?.length) body.tools = input.tools;
    if (input.temperature !== undefined) body.temperature = input.temperature;
    if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw new LlmError(text || `HTTP ${res.status}`, res.status);

    let json: {
      model?: string;
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          tool_calls?: ToolCall[];
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("malformed JSON response");
    }

    const choice = json.choices?.[0];
    return {
      content: choice?.message?.content ?? null,
      toolCalls: choice?.message?.tool_calls ?? [],
      model: json.model ?? input.model,
      usage: this.estimate(json.usage ?? {}),
      finishReason: choice?.finish_reason ?? null,
    };
  }

  /** Stream text deltas only (no tools). Used for simple chat replies. */
  async *streamText(input: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<string, LlmUsage, void> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      stream: true,
    };
    if (input.temperature !== undefined) body.temperature = input.temperature;
    if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: input.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new LlmError(errText || `HTTP ${res.status}`, res.status);
    }
    if (!res.body) throw new LlmError("missing response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage = emptyUsage();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let json: {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }
          if (json.usage) usage = this.estimate(json.usage);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        }
      }
    } finally {
      reader.releaseLock();
    }
    return usage;
  }
}

/** Parse OpenAI-compatible SSE chunks — exported for unit tests. */
export async function* parseSse(chunks: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        if (data === "[DONE]") return;
        continue;
      }
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* skip */
      }
    }
  }
}

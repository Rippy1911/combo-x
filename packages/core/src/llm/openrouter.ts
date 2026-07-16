/**
 * OpenRouter client with streaming + native tool calling.
 * Combo Phase B had stream/chat only — no tools. That blocked a real agent.
 */

/** OpenAI/OpenRouter multimodal content parts (text + image_url). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type ChatContent = string | ContentPart[] | null;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatContent;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

/** Flatten message content for history persistence / UI. */
export function messageContentAsText(content: ChatContent): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .map((p) => (p.type === "text" ? p.text : "[image]"))
    .filter(Boolean)
    .join("\n");
}

/** Drop heavy image parts from history (keep text inventory). */
export function stripImageParts(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const text = messageContentAsText(m.content);
    return { ...m, content: text };
  });
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
  /** USD — prefers OpenRouter `usage.cost` when present; else local estimate. */
  estimatedCostUsd: number;
  /** Where estimatedCostUsd came from. */
  costSource?: "openrouter" | "estimate";
}

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  /** USD per token (OpenRouter pricing.prompt). */
  promptPrice?: number;
  /** USD per token (OpenRouter pricing.completion). */
  completionPrice?: number;
}

type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** OpenRouter native generation cost in USD. */
  cost?: number;
};

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

  private estimate(usage: RawUsage): LlmUsage {
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
    if (typeof usage.cost === "number" && Number.isFinite(usage.cost)) {
      return {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd: usage.cost,
        costSource: "openrouter",
      };
    }
    const estimatedCostUsd =
      (promptTokens / 1_000_000) * this.promptUsdPerMTok +
      (completionTokens / 1_000_000) * this.completionUsdPerMTok;
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
      costSource: "estimate",
    };
  }

  /** List models from OpenRouter (for searchable picker). */
  async listModels(): Promise<OpenRouterModelInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.headers(),
    });
    const text = await res.text();
    if (!res.ok) throw new LlmError(text || `HTTP ${res.status}`, res.status);
    let json: {
      data?: Array<{
        id?: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("malformed models JSON");
    }
    const out: OpenRouterModelInfo[] = [];
    for (const row of json.data ?? []) {
      if (!row.id) continue;
      const promptPrice = row.pricing?.prompt != null ? Number(row.pricing.prompt) : undefined;
      const completionPrice =
        row.pricing?.completion != null ? Number(row.pricing.completion) : undefined;
      out.push({
        id: row.id,
        name: row.name ?? row.id,
        contextLength: row.context_length,
        promptPrice: Number.isFinite(promptPrice) ? promptPrice : undefined,
        completionPrice: Number.isFinite(completionPrice) ? completionPrice : undefined,
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
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
      usage?: RawUsage;
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

  /**
   * Streaming chat with optional tools (OpenAI-compatible SSE).
   * Calls onDelta with accumulated assistant text as tokens arrive.
   */
  async chatStreaming(input: {
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    onDelta?: (accumulated: string) => void;
  }): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (input.tools?.length) body.tools = input.tools;
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
    let content = "";
    let finishReason: string | null = null;
    let usage = emptyUsage();
    const toolAcc = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    try {
      for (;;) {
        if (input.signal?.aborted) break;
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
            choices?: Array<{
              finish_reason?: string | null;
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
            usage?: RawUsage;
            model?: string;
          };
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }
          if (json.usage) usage = this.estimate(json.usage);
          const choice = json.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = choice?.delta;
          if (delta?.content) {
            content += delta.content;
            input.onDelta?.(content);
          }
          for (const tc of delta?.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            const cur = toolAcc.get(idx) ?? { id: "", name: "", arguments: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.arguments += tc.function.arguments;
            toolAcc.set(idx, cur);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls: ToolCall[] = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => ({
        id: t.id || `call_${crypto.randomUUID()}`,
        type: "function" as const,
        function: { name: t.name, arguments: t.arguments || "{}" },
      }))
      .filter((t) => t.function.name);

    if (!finishReason) {
      finishReason = toolCalls.length ? "tool_calls" : "stop";
    }

    return {
      content: content || null,
      toolCalls,
      model: input.model,
      usage,
      finishReason,
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
      stream_options: { include_usage: true },
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
            usage?: RawUsage;
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

import { AGENT_TOOLS, parseToolArguments, toolArgsToContentRequest } from "../browser/tools.js";
import type { ChatMessage, ChatResult, LlmUsage, OpenRouterClient, ToolCall } from "../llm/openrouter.js";
import type { MemoryStore } from "../memory/store.js";
import type { ContentRequest, ContentResponse } from "../protocol/messages.js";

export interface BrowserBridge {
  runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse>;
  listTabs(): Promise<Array<{ id: number; title: string; url: string }>>;
}

export interface AgentEvent {
  type: "status" | "tool_start" | "tool_result" | "assistant_delta" | "done" | "error";
  message?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  usage?: LlmUsage;
}

export interface AgentRunOptions {
  model: string;
  userMessage: string;
  history?: ChatMessage[];
  maxSteps?: number;
  signal?: AbortSignal;
  systemPrompt?: string;
  /** If set, only these tool names are offered to the model. */
  enabledTools?: string[];
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult {
  messages: ChatMessage[];
  finalText: string;
  steps: number;
  usage: LlmUsage;
  aborted: boolean;
}

const DEFAULT_SYSTEM = `You are Combo-X, a local-first browser agent.
You can inspect and interact with the user's active browser tab via tools.
Rules:
- Prefer get_page before clicking/typing.
- Never invent page content — use tools.
- Use remember/recall for durable facts the user wants kept locally.
- Be concise. When done, answer in plain language without tool call JSON.`;

function sumUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
  };
}

const ZERO: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
};

export class AgentLoop {
  constructor(
    private readonly llm: OpenRouterClient,
    private readonly browser: BrowserBridge,
    private readonly memory: MemoryStore,
  ) {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const maxSteps = options.maxSteps ?? 8;
    const emit = options.onEvent ?? (() => undefined);
    const messages: ChatMessage[] = [
      { role: "system", content: options.systemPrompt ?? DEFAULT_SYSTEM },
      ...(options.history ?? []),
      { role: "user", content: options.userMessage },
    ];

    let usage = ZERO;
    let steps = 0;
    let finalText = "";

    for (let step = 0; step < maxSteps; step += 1) {
      if (options.signal?.aborted) {
        emit({ type: "done", message: "aborted", usage });
        return { messages, finalText, steps, usage, aborted: true };
      }

      emit({ type: "status", message: `thinking (step ${step + 1}/${maxSteps})` });
      const tools =
        options.enabledTools && options.enabledTools.length > 0
          ? AGENT_TOOLS.filter((t) => options.enabledTools!.includes(t.function.name))
          : AGENT_TOOLS;
      let result: ChatResult;
      try {
        result = await this.llm.chat({
          model: options.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          temperature: 0.2,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        emit({ type: "error", message: msg });
        throw error;
      }

      usage = sumUsage(usage, result.usage);
      steps += 1;

      if (result.toolCalls.length === 0) {
        finalText = result.content ?? "";
        messages.push({ role: "assistant", content: finalText });
        emit({ type: "assistant_delta", message: finalText });
        emit({ type: "done", usage });
        return { messages, finalText, steps, usage, aborted: false };
      }

      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        if (options.signal?.aborted) {
          emit({ type: "done", message: "aborted", usage });
          return { messages, finalText, steps, usage, aborted: true };
        }
        const toolResult = await this.executeTool(call, emit);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
        });
      }
    }

    finalText = "Reached max tool steps without a final answer. Try a narrower request.";
    messages.push({ role: "assistant", content: finalText });
    emit({ type: "done", message: finalText, usage });
    return { messages, finalText, steps, usage, aborted: false };
  }

  private async executeTool(
    call: ToolCall,
    emit: (e: AgentEvent) => void,
  ): Promise<unknown> {
    const name = call.function.name;
    const args = parseToolArguments(call.function.arguments);
    emit({ type: "tool_start", tool: name, args });

    try {
      let result: unknown;
      if (name === "list_tabs") {
        result = { tabs: await this.browser.listTabs() };
      } else if (name === "remember") {
        const text = String(args.text ?? "");
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
        const entry = await this.memory.remember({ text, tags, kind: "note" });
        result = { saved: true, id: entry.id };
      } else if (name === "recall") {
        const query = String(args.query ?? "");
        const limit = typeof args.limit === "number" ? args.limit : 5;
        const hits = await this.memory.recall(query, limit);
        result = { hits };
      } else {
        const req = toolArgsToContentRequest(name, args);
        if (!req) {
          result = { ok: false, error: `invalid args for ${name}` };
        } else {
          result = await this.browser.runContent(req);
        }
      }
      emit({ type: "tool_result", tool: name, result });
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      emit({ type: "tool_result", tool: name, result: { ok: false, error: msg } });
      return { ok: false, error: msg };
    }
  }
}

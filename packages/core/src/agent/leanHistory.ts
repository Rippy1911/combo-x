/**
 * Lean LLM history — drop raw tool rows; keep short crumbs for tool-calling turns.
 * Port of ns-agent loadHistory / summarizeToolCalls idea (GAP-MEM-3).
 */

import {
  messageContentAsText,
  type ChatMessage,
  type ToolCall,
} from "../llm/openrouter.js";

const DEFAULT_MAX_CHARS = 24_000;

function summarizeToolCalls(calls: ToolCall[] | undefined): string {
  if (!calls?.length) return "";
  const names = calls.map((c) => c.function.name).slice(0, 8);
  const more = calls.length > 8 ? ` +${calls.length - 8}` : "";
  return `[tools: ${names.join(", ")}${more}]`;
}

/**
 * Prepare prior turns for the next OpenRouter call:
 * - drop `role: tool`
 * - assistants with tool_calls keep text crumb (content or tool name list)
 * - trim from the front until under maxChars (keep newest)
 */
export function leanHistory(
  history: ChatMessage[],
  maxChars = DEFAULT_MAX_CHARS,
): ChatMessage[] {
  const out: ChatMessage[] = [];

  for (const m of history) {
    if (m.role === "tool") continue;
    if (m.role === "system") continue;

    if (m.role === "assistant" && m.tool_calls?.length) {
      const text = messageContentAsText(m.content).trim();
      const crumb = text || summarizeToolCalls(m.tool_calls);
      out.push({ role: "assistant", content: crumb });
      continue;
    }

    out.push({
      role: m.role,
      content: messageContentAsText(m.content),
      ...(m.name ? { name: m.name } : {}),
    });
  }

  // Cap from the tail
  let total = 0;
  const kept: ChatMessage[] = [];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]!;
    const len = messageContentAsText(m.content).length + 16;
    if (kept.length > 0 && total + len > maxChars) break;
    kept.push(m);
    total += len;
  }
  kept.reverse();
  return kept;
}

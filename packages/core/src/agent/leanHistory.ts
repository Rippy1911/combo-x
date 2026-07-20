/**
 * Lean LLM history — drop raw tool rows; keep short crumbs for tool-calling turns.
 * Port of ns-agent loadHistory / summarizeToolCalls idea (GAP-MEM-3).
 *
 * Tool *results* used to be dropped entirely — after "continue" the model only
 * saw `[tools: navigate, …]` and re-browsed. We now attach truncated result
 * snippets so continue keeps page/tab facts without replaying full JSON.
 * Snippets are deep-redacted before fold-in (no password/token keys to OpenRouter).
 */

import { redactSensitiveDeep } from "../local/views.js";
import {
  messageContentAsText,
  type ChatMessage,
  type ToolCall,
} from "../llm/openrouter.js";

const DEFAULT_MAX_CHARS = 24_000;
const RESULT_SNIPPET = 280;
const MAX_RESULT_LINES = 6;

function summarizeToolCalls(calls: ToolCall[] | undefined): string {
  if (!calls?.length) return "";
  const names = calls.map((c) => c.function.name).slice(0, 8);
  const more = calls.length > 8 ? ` +${calls.length - 8}` : "";
  return `[tools: ${names.join(", ")}${more}]`;
}

function snippet(content: string, max = RESULT_SNIPPET): string {
  const t = content.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Strip megabase64 data URLs so lean crumbs never re-inject vision bytes. */
export function scrubDataUrls(text: string): string {
  return text.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{80,}/g,
    "data:image…[redacted]",
  );
}

/** Redact sensitive keys then truncate for lean crumbs. */
export function redactToolResultSnippet(raw: unknown, max = RESULT_SNIPPET): string {
  let text: string;
  if (typeof raw === "string") {
    try {
      text = JSON.stringify(redactSensitiveDeep(JSON.parse(raw)));
    } catch {
      text = raw;
    }
  } else {
    text = JSON.stringify(redactSensitiveDeep(raw));
  }
  return snippet(scrubDataUrls(text), max);
}

/**
 * Cap a mid-loop tool result for the LLM `messages[]` row.
 * Full payload still goes to UI via tool_result events — this only shrinks the
 * prompt replayed on every subsequent model turn.
 */
export function truncateToolResultForLlm(result: unknown, maxChars: number): string {
  const cap = Math.max(256, maxChars);
  let text: string;
  if (typeof result === "string") {
    try {
      text = JSON.stringify(redactSensitiveDeep(JSON.parse(result)));
    } catch {
      text = result;
    }
  } else {
    text = JSON.stringify(redactSensitiveDeep(result));
  }
  text = scrubDataUrls(text);
  if (text.length <= cap) return text;
  // Leave room for the envelope keys so the stored string stays near `cap`.
  const previewBudget = Math.max(128, cap - 96);
  const preview =
    text.length > previewBudget ? `${text.slice(0, previewBudget)}…` : text;
  return JSON.stringify({
    truncated: true,
    chars: text.length,
    preview,
  });
}

function collectToolResultLines(
  history: ChatMessage[],
  startIdx: number,
  calls: ToolCall[],
): string[] {
  const byId = new Map(calls.map((c) => [c.id, c.function.name]));
  const lines: string[] = [];
  for (let j = startIdx + 1; j < history.length; j++) {
    const row = history[j]!;
    if (row.role !== "tool") break;
    const name =
      (row.tool_call_id ? byId.get(row.tool_call_id) : undefined) ??
      row.name ??
      "tool";
    lines.push(`${name}: ${redactToolResultSnippet(messageContentAsText(row.content))}`);
    if (lines.length >= MAX_RESULT_LINES) break;
  }
  return lines;
}

/**
 * Prepare prior turns for the next OpenRouter call:
 * - drop `role: tool` as standalone rows
 * - assistants with tool_calls keep text crumb + short redacted result snippets
 * - trim from the front until under maxChars (keep newest)
 */
export function leanHistory(
  history: ChatMessage[],
  maxChars = DEFAULT_MAX_CHARS,
): ChatMessage[] {
  const out: ChatMessage[] = [];

  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    if (m.role === "tool") continue;
    if (m.role === "system") continue;

    if (m.role === "assistant" && m.tool_calls?.length) {
      const text = messageContentAsText(m.content).trim();
      const crumb = text || summarizeToolCalls(m.tool_calls);
      const results = collectToolResultLines(history, i, m.tool_calls);
      const content = results.length
        ? `${crumb}\nResults:\n${results.join("\n")}`
        : crumb;
      out.push({ role: "assistant", content });
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

/** UI/session turns used to rebuild LLM history after reload or edit-truncate. */
export type UiHistoryTurn = {
  role: "user" | "assistant";
  content: string;
  tools?: Array<{ name: string; result?: unknown }>;
};

/**
 * Rebuild lean ChatMessages from persisted UI turns (1:1 with visible bubbles).
 * Prefer this over slicing historyRef by UI index (indices do not align).
 */
export function historyFromUiTurns(turns: UiHistoryTurn[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const t of turns) {
    if (t.role === "user") {
      out.push({ role: "user", content: t.content });
      continue;
    }
    const tools = t.tools ?? [];
    if (!tools.length) {
      out.push({ role: "assistant", content: t.content });
      continue;
    }
    const names = tools.map((x) => x.name).slice(0, 8);
    const more = tools.length > 8 ? ` +${tools.length - 8}` : "";
    const crumb =
      t.content.trim() || `[tools: ${names.join(", ")}${more}]`;
    const results = tools
      .filter((x) => x.result != null)
      .slice(0, MAX_RESULT_LINES)
      .map((x) => `${x.name}: ${redactToolResultSnippet(x.result)}`);
    out.push({
      role: "assistant",
      content: results.length ? `${crumb}\nResults:\n${results.join("\n")}` : crumb,
    });
  }
  return out;
}

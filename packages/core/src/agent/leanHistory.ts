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
 * Array fields that carry the bulk of a list-shaped tool result. When a result
 * is too big we drop whole entries from these instead of slicing the serialized
 * JSON — a mid-string cut hands the model unparseable text (it sees half an
 * object and cannot tell how many entries it missed or how to ask for more).
 */
const LIST_FIELDS = [
  "items",
  "links",
  "matches",
  "rows",
  "hits",
  "tables",
  "values",
  "results",
  "tabs",
  "attachments",
  "memories",
] as const;

function toPlainObject(result: unknown): unknown {
  if (typeof result === "string") {
    try {
      return redactSensitiveDeep(JSON.parse(result));
    } catch {
      return result;
    }
  }
  return redactSensitiveDeep(result);
}

/** The dominant list field of an object result, if any. */
function pickListField(obj: Record<string, unknown>): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const key of LIST_FIELDS) {
    const v = obj[key];
    if (Array.isArray(v) && v.length > bestLen) {
      best = key;
      bestLen = v.length;
    }
  }
  return best;
}

/**
 * Shrink a list result by dropping trailing entries until it fits, keeping the
 * JSON valid and telling the agent exactly how to fetch the remainder.
 */
function shapeListResult(
  obj: Record<string, unknown>,
  field: string,
  cap: number,
): string | null {
  const full = obj[field] as unknown[];
  let lo = 0;
  let hi = full.length;
  let bestJson: string | null = null;
  let bestCount = 0;

  // Binary search the largest prefix that fits — list entries are near-uniform
  // in size, so this converges in ~log2(n) serializations.
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const kept = full.slice(0, mid);
    const dropped = full.length - kept.length;
    const candidate = {
      ...obj,
      [field]: kept,
      _truncated: {
        field,
        shown: kept.length,
        of: full.length,
        dropped,
        hint: buildListHint(obj, field, kept.length, dropped),
      },
    };
    const json = scrubDataUrls(JSON.stringify(candidate));
    if (json.length <= cap) {
      bestJson = json;
      bestCount = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return bestCount > 0 ? bestJson : null;
}

function buildListHint(
  obj: Record<string, unknown>,
  field: string,
  shown: number,
  dropped: number,
): string {
  if (dropped <= 0) return `All ${shown} ${field} shown.`;
  const offset = typeof obj.offset === "number" ? obj.offset : 0;
  const resume = offset + shown;
  return (
    `${dropped} more ${field} were dropped to fit the context budget — they are NOT gone. ` +
    `Re-call the same tool with offset:${resume} to continue, or narrow with filter/kind/region ` +
    `so the answer fits in one call. Do not conclude the list ended here.`
  );
}

/**
 * Cap a mid-loop tool result for the LLM `messages[]` row.
 * Full payload still goes to UI via tool_result events — this only shrinks the
 * prompt replayed on every subsequent model turn.
 *
 * Always emits valid JSON. List results lose whole entries (with a resume hint);
 * only unstructured blobs fall back to a string preview.
 */
export function truncateToolResultForLlm(result: unknown, maxChars: number): string {
  const cap = Math.max(256, maxChars);
  const plain = toPlainObject(result);

  if (typeof plain !== "string" && plain && typeof plain === "object" && !Array.isArray(plain)) {
    const obj = plain as Record<string, unknown>;
    const direct = scrubDataUrls(JSON.stringify(obj));
    if (direct.length <= cap) return direct;
    const field = pickListField(obj);
    if (field) {
      const shaped = shapeListResult(obj, field, cap);
      if (shaped) return shaped;
    }
  }

  let text = typeof plain === "string" ? plain : JSON.stringify(plain);
  text = scrubDataUrls(text);
  if (text.length <= cap) return text;
  // Leave room for the envelope keys so the stored string stays near `cap`.
  const previewBudget = Math.max(128, cap - 220);
  const preview = text.length > previewBudget ? `${text.slice(0, previewBudget)}…` : text;
  return JSON.stringify({
    truncated: true,
    chars: text.length,
    hint:
      "Result was too large and is cut mid-way. Re-read a narrower slice " +
      "(get_page offset/filter, get_interactive filter/region, find_text) rather than repeating this call.",
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

/** Approx char length of a ChatMessage (content + 16 bytes overhead). */
function messageChars(m: ChatMessage): number {
  return messageContentAsText(m.content).length + 16;
}

/** Total chars across an array of ChatMessages. */
export function historyChars(history: ChatMessage[]): number {
  return history.reduce((n, m) => n + messageChars(m), 0);
}

/**
 * Compress prior turns into a single summary when total chars exceed `contextLimit`.
 * Keeps the newest turns verbatim (up to ~50% of the limit); older turns collapse
 * into one system-style message that preserves user goals, tool names, and short
 * result snippets so the agent can resume without losing the plot.
 *
 * Returns the original history when under the limit (no compression needed).
 *
 * The returned array always starts with a single `user`-role summary message
 * (when compression fired) followed by the kept newest turns. Callers can
 * detect compression via the second return value (`compressed: boolean`).
 */
export function compressHistory(
  history: ChatMessage[],
  contextLimit: number,
): { history: ChatMessage[]; compressed: boolean; droppedTurns: number; beforeChars: number; afterChars: number } {
  if (!contextLimit || contextLimit <= 0) {
    return { history, compressed: false, droppedTurns: 0, beforeChars: 0, afterChars: 0 };
  }
  const beforeChars = historyChars(history);
  if (beforeChars <= contextLimit) {
    return { history, compressed: false, droppedTurns: 0, beforeChars, afterChars: beforeChars };
  }

  // Walk from the newest end, keeping turns until we hit ~50% of the limit.
  const keepBudget = Math.floor(contextLimit * 0.5);
  const kept: ChatMessage[] = [];
  let keptChars = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    const len = messageChars(m);
    if (kept.length > 0 && keptChars + len > keepBudget) break;
    kept.unshift(m);
    keptChars += len;
  }

  const dropped = history.slice(0, history.length - kept.length);
  if (!dropped.length) {
    return { history, compressed: false, droppedTurns: 0, beforeChars, afterChars: beforeChars };
  }

  const summary = summarizeDroppedTurns(dropped);
  const afterChars = messageChars(summary) + keptChars;
  return {
    history: [summary, ...kept],
    compressed: true,
    droppedTurns: dropped.length,
    beforeChars,
    afterChars,
  };
}

/**
 * Build a single `user`-role summary message from dropped turns.
 * Preserves: user goals (verbatim, capped), assistant tool names, short result snippets.
 * Never includes raw tool JSON or sensitive values (already redacted by redactToolResultSnippet).
 */
function summarizeDroppedTurns(dropped: ChatMessage[]): ChatMessage {
  const userGoals: string[] = [];
  const assistantNotes: string[] = [];
  let toolTurnCount = 0;

  for (const m of dropped) {
    if (m.role === "user") {
      const text = messageContentAsText(m.content).trim();
      if (text) userGoals.push(text.slice(0, 280));
    } else if (m.role === "assistant") {
      const text = messageContentAsText(m.content).trim();
      if (m.tool_calls?.length) {
        toolTurnCount += 1;
        const names = m.tool_calls.map((c) => c.function.name).slice(0, 6);
        const more = m.tool_calls.length > 6 ? ` +${m.tool_calls.length - 6}` : "";
        const resultsLine = /Results:/.test(text) ? `\n${text.split(/Results:/)[1]!.slice(0, 400)}` : "";
        assistantNotes.push(
          `[tools: ${names.join(", ")}${more}]${resultsLine}`,
        );
      } else if (text) {
        assistantNotes.push(text.slice(0, 200));
      }
    }
  }

  const goalsBlock = userGoals.length
    ? userGoals
        .slice(-6)
        .map((g, i) => `${i + 1}. ${g}`)
        .join("\n")
    : "(none recorded)";

  const notesBlock = assistantNotes.length
    ? assistantNotes
        .slice(-10)
        .map((n) => `- ${n}`)
        .join("\n")
    : "(none)";

  const content = `[CONTEXT AUTO-COMPRESSED — ${dropped.length} prior turns summarized to save tokens]

USER GOALS FROM COMPRESSED TURNS (most recent last):
${goalsBlock}

ASSISTANT ACTIONS / TOOL CRUMBS FROM COMPRESSED TURNS:
${notesBlock}

Tool-calling turns in compressed range: ${toolTurnCount}.

Resume instructions: re-read open tasks via list_tasks before continuing. Do not claim work is done that was only started in the compressed range — verify with tools first.`;

  return { role: "user", content };
}

export type CompactMidLoopResult = {
  messages: ChatMessage[];
  compacted: boolean;
  beforeChars: number;
  afterChars: number;
  droppedRounds: number;
};

/**
 * Mid-run prompt compact: fold older tool rounds into lean crumbs while keeping
 * the newest `keepRecentRounds` rounds in OpenAI tool-call shape (assistant +
 * tool rows) so the next model call stays valid.
 *
 * Call before each orchestrator step after the first. Stops quadratic token growth
 * within a single AgentLoop.run() without waiting for the next user turn.
 */
export function compactMidLoopMessages(
  messages: ChatMessage[],
  opts: { maxChars: number; keepRecentRounds?: number },
): CompactMidLoopResult {
  const maxChars = opts.maxChars;
  const keepRecentRounds = Math.max(1, opts.keepRecentRounds ?? 2);
  const beforeChars = historyChars(messages);
  if (!maxChars || maxChars <= 0 || beforeChars <= maxChars) {
    return {
      messages,
      compacted: false,
      beforeChars,
      afterChars: beforeChars,
      droppedRounds: 0,
    };
  }

  let i = 0;
  const system: ChatMessage[] = [];
  while (i < messages.length && messages[i]!.role === "system") {
    system.push(messages[i]!);
    i += 1;
  }
  const rest = messages.slice(i);
  const systemChars = historyChars(system);

  const roundStarts: number[] = [];
  for (let j = 0; j < rest.length; j++) {
    const m = rest[j]!;
    if (m.role === "assistant" && m.tool_calls?.length) roundStarts.push(j);
  }

  let keepFrom = 0;
  let droppedRounds = 0;
  if (roundStarts.length > keepRecentRounds) {
    droppedRounds = roundStarts.length - keepRecentRounds;
    keepFrom = roundStarts[roundStarts.length - keepRecentRounds]!;
  } else if (roundStarts.length > 0) {
    // Over budget but few rounds — still lean-fold everything before the first tool round.
    keepFrom = roundStarts[0]!;
  } else {
    // No tool rounds yet — compress the whole rest as history.
    const lean = leanHistory(rest, maxChars);
    const budget = Math.max(512, maxChars - systemChars);
    const compressed = compressHistory(lean, budget);
    const out = [...system, ...compressed.history];
    return {
      messages: out,
      compacted: compressed.compressed || lean.length < rest.length,
      beforeChars,
      afterChars: historyChars(out),
      droppedRounds: 0,
    };
  }

  const older = rest.slice(0, keepFrom);
  const recent = rest.slice(keepFrom);
  const recentChars = historyChars(recent);
  const olderBudget = Math.max(512, Math.floor(maxChars * 0.45) - systemChars);
  // Prefer leaving room for recent rounds; if recent alone blows the cap, still
  // shrink older as much as possible.
  const olderCap = Math.max(
    512,
    Math.min(olderBudget, Math.max(512, maxChars - systemChars - recentChars)),
  );

  let olderLean = leanHistory(older, olderCap);
  const compressed = compressHistory(olderLean, olderCap);
  olderLean = compressed.history;

  const out = [...system, ...olderLean, ...recent];
  const afterChars = historyChars(out);
  const compacted =
    droppedRounds > 0 ||
    compressed.compressed ||
    olderLean.length < older.length ||
    afterChars < beforeChars;

  return {
    messages: out,
    compacted,
    beforeChars,
    afterChars,
    droppedRounds,
  };
}

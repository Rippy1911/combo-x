/**
 * OpenRouter / provider prompt-cache helpers.
 *
 * This is the useful "KV cache": providers reuse the stable prefix (system +
 * tools) across agent steps. Combo-X does not host a local KV — cache lives
 * on the inference host (OpenRouter sticky routing → Anthropic/OpenAI/Moonshot/…).
 *
 * - Moonshot / Grok / OpenAI / Gemini / DeepSeek: often automatic once prefix is stable.
 * - Anthropic Claude + Alibaba Qwen: need explicit `cache_control` breakpoints.
 * - Always send `session_id` on OpenRouter so sticky routing keeps the warm cache.
 *
 * @see https://openrouter.ai/docs/guides/best-practices/prompt-caching
 */

import type { ChatContent, ChatMessage, ContentPart } from "./openrouter.js";

/**
 * Providers that cache automatically on an exact token-prefix match (DeepSeek,
 * Moonshot, OpenAI, Gemini, Grok). No breakpoints needed — but they only pay
 * off if the prompt is *append-only*: any edit near the front invalidates every
 * cached token after it. Callers should therefore order the system prompt
 * stable-first and compact rarely (see `COMPACT_TRIGGER_RATIO`).
 */
export function supportsAutomaticPrefixCache(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  if (needsExplicitCacheControl(m)) return false;
  return (
    m.includes("deepseek") ||
    m.includes("moonshot") ||
    m.includes("kimi") ||
    m.includes("openai/") ||
    m.includes("gpt-") ||
    m.includes("gemini") ||
    m.includes("grok") ||
    m.includes("x-ai/")
  );
}

/** Models that require explicit cache_control breakpoints (via OpenRouter). */
export function needsExplicitCacheControl(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  return (
    m.includes("anthropic/") ||
    m.includes("claude") ||
    m.includes("qwen") ||
    m.includes("alibaba/")
  );
}

/** Top-level cache_control is supported for Anthropic (+ a few) on OpenRouter. */
export function needsTopLevelCacheControl(model: string): boolean {
  return needsExplicitCacheControl(model);
}

/**
 * Mark the system message (and optional trailing static user block) with
 * Anthropic-style ephemeral cache breakpoints so the next turns can cache-read.
 * No-op when the model does not need explicit breakpoints.
 */
export function applyCacheBreakpoints(
  messages: ChatMessage[],
  model: string,
): ChatMessage[] {
  if (!needsExplicitCacheControl(model) || messages.length === 0) return messages;

  let markedSystem = false;
  return messages.map((msg) => {
    if (msg.role !== "system" || markedSystem) return msg;
    markedSystem = true;
    return { ...msg, content: withCacheControl(msg.content) };
  });
}

function withCacheControl(content: ChatContent): ChatContent {
  if (content == null) return content;
  if (typeof content === "string") {
    const part: ContentPart = {
      type: "text",
      text: content,
      cache_control: { type: "ephemeral" },
    };
    return [part];
  }
  if (!Array.isArray(content) || content.length === 0) return content;
  // Put breakpoint on the last text part of the system message.
  const out: ContentPart[] = content.map((p) => ({ ...p }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]!.type === "text") {
      out[i] = { ...out[i]!, cache_control: { type: "ephemeral" } };
      break;
    }
  }
  return out;
}

/** Clamp session id for OpenRouter (max 256 chars). */
export function clampSessionId(sessionId: string | undefined | null): string | undefined {
  if (!sessionId) return undefined;
  const s = sessionId.trim();
  if (!s) return undefined;
  return s.length > 256 ? s.slice(0, 256) : s;
}

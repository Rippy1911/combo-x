import { describe, expect, it } from "vitest";
import {
  applyCacheBreakpoints,
  clampSessionId,
  needsExplicitCacheControl,
  needsTopLevelCacheControl,
} from "./promptCache.js";

describe("promptCache", () => {
  it("flags Anthropic/Claude and Qwen for explicit cache_control", () => {
    expect(needsExplicitCacheControl("anthropic/claude-sonnet-4")).toBe(true);
    expect(needsExplicitCacheControl("anthropic/claude-3.5-sonnet")).toBe(true);
    expect(needsExplicitCacheControl("qwen/qwen3-235b")).toBe(true);
    expect(needsExplicitCacheControl("alibaba/qwen-turbo")).toBe(true);
    expect(needsTopLevelCacheControl("anthropic/claude-sonnet-4")).toBe(true);
  });

  it("does not require explicit breakpoints for Moonshot/Grok/OpenAI", () => {
    expect(needsExplicitCacheControl("x-ai/grok-4.5")).toBe(false);
    expect(needsExplicitCacheControl("openai/gpt-4.1")).toBe(false);
    expect(needsExplicitCacheControl("kimi-k3")).toBe(false);
    expect(needsExplicitCacheControl("moonshotai/kimi-k2.5")).toBe(false);
  });

  it("marks system message with cache_control for Claude", () => {
    const out = applyCacheBreakpoints(
      [
        { role: "system", content: "You are Combo-X" },
        { role: "user", content: "go" },
      ],
      "anthropic/claude-sonnet-4",
    );
    expect(out[0]?.role).toBe("system");
    expect(Array.isArray(out[0]?.content)).toBe(true);
    const parts = out[0]!.content as Array<{ type: string; text?: string; cache_control?: unknown }>;
    expect(parts[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(parts[0]?.text).toBe("You are Combo-X");
    expect(out[1]?.content).toBe("go");
  });

  it("leaves messages unchanged for automatic-cache models", () => {
    const msgs = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "hi" },
    ];
    expect(applyCacheBreakpoints(msgs, "x-ai/grok-4.5")).toBe(msgs);
  });

  it("clamps session ids to 256 chars", () => {
    expect(clampSessionId("  abc  ")).toBe("abc");
    expect(clampSessionId("")).toBeUndefined();
    expect(clampSessionId(null)).toBeUndefined();
    const long = "x".repeat(300);
    expect(clampSessionId(long)?.length).toBe(256);
  });
});

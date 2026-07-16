import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, normalizeModelId } from "./models.js";

describe("normalizeModelId", () => {
  it("replaces legacy grok-4.5-fast", () => {
    expect(normalizeModelId("x-ai/grok-4.5-fast")).toBe(DEFAULT_MODEL);
    expect(normalizeModelId("openrouter/x-ai/grok-4.5-fast")).toBe(DEFAULT_MODEL);
  });

  it("keeps valid ids", () => {
    expect(normalizeModelId("x-ai/grok-4.5")).toBe("x-ai/grok-4.5");
    expect(normalizeModelId("anthropic/claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
  });
});

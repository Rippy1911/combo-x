import { describe, expect, it } from "vitest";
import {
  createEmptyRuntime,
  evictIdleRuntimes,
  SESSION_IDLE_EVICT_MS,
  type SessionRuntime,
} from "./sessionRuntime";

const ZERO = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
};

describe("evictIdleRuntimes", () => {
  it("keeps running and active sessions; drops idle background", () => {
    const map = new Map<string, SessionRuntime>();
    const now = Date.now();
    map.set("active", {
      ...createEmptyRuntime("active", ZERO),
      lastTouchedAt: now - SESSION_IDLE_EVICT_MS * 2,
    });
    map.set("running", {
      ...createEmptyRuntime("running", ZERO),
      running: true,
      lastTouchedAt: now - SESSION_IDLE_EVICT_MS * 2,
    });
    map.set("idle", {
      ...createEmptyRuntime("idle", ZERO),
      lastTouchedAt: now - SESSION_IDLE_EVICT_MS * 2,
    });
    map.set("fresh", {
      ...createEmptyRuntime("fresh", ZERO),
      lastTouchedAt: now - 1_000,
    });

    const removed = evictIdleRuntimes(map, "active", now);
    expect(removed).toEqual(["idle"]);
    expect(map.has("active")).toBe(true);
    expect(map.has("running")).toBe(true);
    expect(map.has("fresh")).toBe(true);
    expect(map.has("idle")).toBe(false);
  });
});

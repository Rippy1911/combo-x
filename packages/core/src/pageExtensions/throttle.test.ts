import { describe, expect, it } from "vitest";
import { BridgeAttemptThrottle } from "./throttle.js";

describe("BridgeAttemptThrottle", () => {
  it("does not throttle up to and including the limit", () => {
    const t = new BridgeAttemptThrottle({ maxAttempts: 3, windowMs: 1000 });
    expect(t.register("a", 0)).toBe(false); // 1
    expect(t.register("a", 1)).toBe(false); // 2
    expect(t.register("a", 2)).toBe(false); // 3 (== limit, still allowed)
  });

  it("throttles once attempts exceed the limit within the window", () => {
    const t = new BridgeAttemptThrottle({ maxAttempts: 3, windowMs: 1000 });
    t.register("a", 0);
    t.register("a", 1);
    t.register("a", 2);
    expect(t.register("a", 3)).toBe(true); // 4th > limit
  });

  it("resets after the window elapses", () => {
    const t = new BridgeAttemptThrottle({ maxAttempts: 2, windowMs: 1000 });
    t.register("a", 0);
    t.register("a", 500);
    expect(t.register("a", 900)).toBe(true); // still in window, over limit
    // Next attempt is outside the original window → counter resets.
    expect(t.register("a", 2000)).toBe(false);
  });

  it("tracks keys independently", () => {
    const t = new BridgeAttemptThrottle({ maxAttempts: 1, windowMs: 1000 });
    expect(t.register("tab1:x", 0)).toBe(false);
    expect(t.register("tab1:x", 1)).toBe(true);
    // Different key is unaffected.
    expect(t.register("tab2:x", 1)).toBe(false);
  });

  it("clear() resets a single key", () => {
    const t = new BridgeAttemptThrottle({ maxAttempts: 1, windowMs: 1000 });
    t.register("a", 0);
    expect(t.register("a", 1)).toBe(true);
    t.clear("a");
    expect(t.register("a", 2)).toBe(false);
  });

  it("clearPrefix() resets all keys for a tab", () => {
    const t = new BridgeAttemptThrottle({ maxAttempts: 1, windowMs: 1000 });
    t.register("5:x", 0);
    t.register("5:y", 0);
    t.clearPrefix("5:");
    expect(t.register("5:x", 1)).toBe(false);
    expect(t.register("5:y", 1)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { resolveVoiceSendError, shouldForceClearStuckRun } from "./voiceSend";

describe("resolveVoiceSendError", () => {
  it("prefers lastSendFail over status", () => {
    expect(
      resolveVoiceSendError({
        lastSendFail: "busy: session already running",
        statusText: "Combo heard: go to Google.",
      }),
    ).toBe("busy: session already running");
  });

  it("never treats optimistic heard status as the error", () => {
    expect(
      resolveVoiceSendError({
        lastSendFail: null,
        statusText: "Jarvis heard: go to Google.",
      }),
    ).toMatch(/busy or missing LLM/i);
    expect(
      resolveVoiceSendError({
        lastSendFail: "",
        statusText: "Combo heard: open mail",
      }),
    ).toMatch(/busy or missing LLM/i);
  });

  it("uses real status messages from send()", () => {
    expect(
      resolveVoiceSendError({
        lastSendFail: null,
        statusText: "Missing API key for OpenRouter. Open Settings → LLM",
      }),
    ).toMatch(/Missing API key/);
  });
});

describe("shouldForceClearStuckRun", () => {
  it("clears only when running past the stuck window", () => {
    const now = 100_000;
    expect(
      shouldForceClearStuckRun({
        running: true,
        lastTouchedAt: now - 9_000,
        now,
        stuckAfterMs: 8_000,
      }),
    ).toBe(true);
    expect(
      shouldForceClearStuckRun({
        running: true,
        lastTouchedAt: now - 1_000,
        now,
        stuckAfterMs: 8_000,
      }),
    ).toBe(false);
    expect(
      shouldForceClearStuckRun({
        running: false,
        lastTouchedAt: now - 60_000,
        now,
      }),
    ).toBe(false);
  });
});

/**
 * Voice → chat send helpers. Kept free of React so failures are unit-testable.
 */

/** Optimistic status lines must never be reported as the send failure reason. */
const OPTIMISTIC_HEARD = /^(?:Combo|Jarvis) heard:/i;

export function resolveVoiceSendError(input: {
  lastSendFail: string | null | undefined;
  statusText: string | null | undefined;
}): string {
  const fail = (input.lastSendFail ?? "").trim();
  if (fail) return fail;
  const status = (input.statusText ?? "").trim();
  if (status && !OPTIMISTIC_HEARD.test(status)) return status;
  return "Send rejected (session busy or missing LLM API key). Press STOP, check Settings → LLM, then retry.";
}

export function shouldForceClearStuckRun(input: {
  running: boolean;
  lastTouchedAt: number;
  now?: number;
  stuckAfterMs?: number;
}): boolean {
  if (!input.running) return false;
  const now = input.now ?? Date.now();
  const stuckAfter = input.stuckAfterMs ?? 8_000;
  return now - input.lastTouchedAt >= stuckAfter;
}

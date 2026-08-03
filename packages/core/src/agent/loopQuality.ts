/**
 * Agentic-loop quality gates — the runtime half of "verify before claim".
 *
 * ns-agent stays honest because tools return structured success envelopes and
 * the coach prompt forbids claiming work without a matching tool result.
 * Combo-X historically finished on empty tool_calls with no gate, so a model
 * that spent five turns reading a noisy admin panel could claim "done" with
 * zero mutations. This module tracks per-run evidence and builds the nudge
 * that forces one more verify/act turn before finish is accepted.
 */

import { isObservationTool } from "./repeatGuard.js";

/** Mutations that require a follow-up read before "done" is honest. */
const VERIFY_MUTATION_TOOLS = new Set([
  "click",
  "click_index",
  "type_text",
  "type_index",
  "press_key",
  "navigate",
  "open_tab",
  "go_back",
  "login",
]);

export type RunEvidence = {
  /** How many verify-before-done nudges we already injected this run. */
  verifyNudges: number;
  /** Successful verify-relevant mutations this run. */
  mutationsOk: number;
  /** True once any observation tool succeeded after the latest mutation. */
  obsAfterMutation: boolean;
  /**
   * Unresolved clicks that reported dialogOpened:false. Cleared only by a later
   * click with dialogOpened:true — a random get_page must not erase the miss
   * (pr-agent / ns-agent review on combo-x#23).
   */
  unresolvedSilentClicks: number;
};

export function emptyRunEvidence(): RunEvidence {
  return {
    verifyNudges: 0,
    mutationsOk: 0,
    obsAfterMutation: true,
    unresolvedSilentClicks: 0,
  };
}

function toolOk(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const obj = result as Record<string, unknown>;
  if (obj.ok === false) return false;
  if (typeof obj.error === "string" && obj.error.length > 0) return false;
  return true;
}

function dialogOpenedFlag(result: unknown): boolean | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const obj = result as Record<string, unknown>;
  if (typeof obj.dialogOpened === "boolean") return obj.dialogOpened;
  const data = obj.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (typeof d.dialogOpened === "boolean") return d.dialogOpened;
  }
  return undefined;
}

/** Update evidence after a tool returns (call for every executed tool). */
export function noteToolEvidence(ev: RunEvidence, name: string, result: unknown): void {
  if (VERIFY_MUTATION_TOOLS.has(name)) {
    if (!toolOk(result)) return;
    ev.mutationsOk += 1;
    ev.obsAfterMutation = false;
    if (name === "click" || name === "click_index") {
      const opened = dialogOpenedFlag(result);
      if (opened === false) ev.unresolvedSilentClicks += 1;
      else if (opened === true) ev.unresolvedSilentClicks = 0;
    }
    return;
  }
  if (isObservationTool(name) && toolOk(result) && ev.mutationsOk > 0) {
    ev.obsAfterMutation = true;
  }
}

export const MAX_VERIFY_NUDGES = 2;

/**
 * Signals that mean "finishing now would likely hallucinate completion".
 * Empty array → allow finish.
 */
export function verifyBeforeDoneSignals(opts: {
  evidence: RunEvidence;
  openTaskTitles: string[];
}): string[] {
  const signals: string[] = [];
  if (opts.openTaskTitles.length > 0) {
    signals.push(
      `Open tasks still active (${opts.openTaskTitles.length}): ${opts.openTaskTitles
        .slice(0, 6)
        .map((t) => `"${t}"`)
        .join("; ")}${opts.openTaskTitles.length > 6 ? "…" : ""}`,
    );
  }
  if (opts.evidence.mutationsOk > 0 && !opts.evidence.obsAfterMutation) {
    signals.push(
      "You mutated the page (click/type/navigate) but never re-read to verify the effect",
    );
  }
  if (opts.evidence.unresolvedSilentClicks > 0) {
    signals.push(
      `${opts.evidence.unresolvedSilentClicks} click(s) reported dialogOpened:false still unresolved — re-scan and retry until dialogOpened:true, or report the miss`,
    );
  }
  return signals;
}

export function buildVerifyNudge(signals: string[]): string {
  return (
    `## Runtime gate — VERIFY BEFORE DONE\n` +
    `(This is NOT the user. Obey and continue with tools.)\n` +
    `You stopped without tool calls, but unfinished-work signals remain:\n` +
    signals.map((s) => `- ${s}`).join("\n") +
    `\n\nDo ONE of the following now with tools (not prose alone):\n` +
    `1. Re-read the control/dialog/list that should have changed and confirm the effect, OR\n` +
    `2. Act (click_index / type_index / Save) if you already know the target, OR\n` +
    `3. update_task to blocked/cancelled with a concrete blocker — never invent "done".\n` +
    `Empty tool results mean not found. Never claim saves/translations/completions without a tool result in THIS run that proves it.`
  );
}

/** Honest closeout line when the gate gave up but work is still unfinished. */
export function unfinishedCloseoutNote(signals: string[]): string {
  return (
    `\n\n— UNVERIFIED closeout — open work remains after verify-before-done nudges:\n` +
    signals.map((s) => `• ${s}`).join("\n") +
    `\nTasks left open were marked blocked so the board stays honest.`
  );
}

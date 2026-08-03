import { describe, expect, it } from "vitest";
import {
  buildVerifyNudge,
  emptyRunEvidence,
  noteToolEvidence,
  verifyBeforeDoneSignals,
} from "./loopQuality.js";

describe("loopQuality verify-before-done", () => {
  it("allows finish when there is no unfinished-work signal", () => {
    const ev = emptyRunEvidence();
    expect(verifyBeforeDoneSignals({ evidence: ev, openTaskTitles: [] })).toEqual([]);
  });

  it("flags open tasks", () => {
    const signals = verifyBeforeDoneSignals({
      evidence: emptyRunEvidence(),
      openTaskTitles: ["Translate FaqPage"],
    });
    expect(signals[0]).toMatch(/Translate FaqPage/);
  });

  it("flags unverified mutations", () => {
    const ev = emptyRunEvidence();
    noteToolEvidence(ev, "click_index", { ok: true, data: { dialogOpened: true } });
    expect(ev.mutationsOk).toBe(1);
    expect(ev.obsAfterMutation).toBe(false);
    const signals = verifyBeforeDoneSignals({ evidence: ev, openTaskTitles: [] });
    expect(signals.some((s) => /never re-read/i.test(s))).toBe(true);
  });

  it("clears the unverified-mutation signal after a successful observation", () => {
    const ev = emptyRunEvidence();
    noteToolEvidence(ev, "click_index", { ok: true, data: { dialogOpened: true } });
    noteToolEvidence(ev, "get_interactive", { ok: true, data: { items: [] } });
    expect(ev.obsAfterMutation).toBe(true);
    expect(verifyBeforeDoneSignals({ evidence: ev, openTaskTitles: [] })).toEqual([]);
  });

  it("counts silent clicks (dialogOpened:false)", () => {
    const ev = emptyRunEvidence();
    noteToolEvidence(ev, "click_index", {
      ok: true,
      data: { dialogOpened: false, effect: "no_dialog" },
    });
    expect(ev.silentClicks).toBe(1);
    const signals = verifyBeforeDoneSignals({ evidence: ev, openTaskTitles: [] });
    expect(signals.some((s) => /dialogOpened:false/i.test(s))).toBe(true);
  });

  it("buildVerifyNudge names the runtime gate header", () => {
    const text = buildVerifyNudge(["Open tasks still active"]);
    expect(text).toMatch(/VERIFY BEFORE DONE/);
    expect(text).toMatch(/Open tasks still active/);
    expect(text).toMatch(/never invent/i);
  });
});

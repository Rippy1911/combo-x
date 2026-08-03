import { describe, expect, it } from "vitest";
import {
  buildVerifyNudge,
  emptyRunEvidence,
  noteToolEvidence,
  unfinishedCloseoutNote,
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

  it("keeps silent-click signal even after an unrelated observation", () => {
    const ev = emptyRunEvidence();
    noteToolEvidence(ev, "click_index", {
      ok: true,
      data: { dialogOpened: false, effect: "no_dialog" },
    });
    expect(ev.unresolvedSilentClicks).toBe(1);
    noteToolEvidence(ev, "get_page", { ok: true, data: { text: "noise" } });
    expect(ev.obsAfterMutation).toBe(true);
    const signals = verifyBeforeDoneSignals({ evidence: ev, openTaskTitles: [] });
    expect(signals.some((s) => /dialogOpened:false/i.test(s))).toBe(true);
  });

  it("clears silent clicks only when a later click opens a dialog", () => {
    const ev = emptyRunEvidence();
    noteToolEvidence(ev, "click_index", { ok: true, data: { dialogOpened: false } });
    noteToolEvidence(ev, "click_index", { ok: true, data: { dialogOpened: true } });
    expect(ev.unresolvedSilentClicks).toBe(0);
    noteToolEvidence(ev, "get_interactive", { ok: true, data: { items: [1] } });
    expect(verifyBeforeDoneSignals({ evidence: ev, openTaskTitles: [] })).toEqual([]);
  });

  it("buildVerifyNudge names the runtime gate header", () => {
    const text = buildVerifyNudge(["Open tasks still active"]);
    expect(text).toMatch(/VERIFY BEFORE DONE/);
    expect(text).toMatch(/NOT the user/);
    expect(text).toMatch(/Open tasks still active/);
  });

  it("unfinishedCloseoutNote marks the board honest", () => {
    expect(unfinishedCloseoutNote(["Open tasks"])).toMatch(/UNVERIFIED/);
    expect(unfinishedCloseoutNote(["Open tasks"])).toMatch(/blocked/);
  });
});

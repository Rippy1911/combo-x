import { describe, expect, it } from "vitest";
import {
  isActuationAllowed,
  mintWakeToken,
  parseWakeUtterance,
  verifyWakeToken,
  WAKE_PHRASES,
  WAKE_TOKEN_TTL_MS,
} from "./wakeGate.js";

describe("parseWakeUtterance", () => {
  it("matches all configured phrases including Polish/diacritic forms", () => {
    for (const phrase of WAKE_PHRASES) {
      const r = parseWakeUtterance(phrase);
      expect(r.armed, phrase).toBe(true);
      expect(r.command).toBe("");
      expect(r.matchedPhrase).toBeTruthy();
    }
    expect(parseWakeUtterance("Hej dżarwis otwórz").armed).toBe(true);
    expect(parseWakeUtterance("DZARWIS kliknij").matchedPhrase).toBeTruthy();
  });

  it("preserves command casing and strips leading comma", () => {
    const r = parseWakeUtterance("Hey Jarvis, click Save");
    expect(r.armed).toBe(true);
    expect(r.command).toBe("click Save");
    expect(r.matchedPhrase?.toLowerCase()).toContain("jarvis");
  });

  it("strips Combo brand phrases from STT", () => {
    const r = parseWakeUtterance("Hey Combo, go to Google");
    expect(r.armed).toBe(true);
    expect(r.command).toBe("go to Google");
    expect(r.matchedPhrase?.toLowerCase()).toContain("combo");
  });

  it("arms bare wake word with empty command", () => {
    const r = parseWakeUtterance("  jarvis  ");
    expect(r).toEqual({ armed: true, command: "", matchedPhrase: "jarvis" });
  });

  it("strips the wake phrase as Azure pl-PL actually transcribes it", () => {
    // Observed transcript from _artifacts/jarvis-azure-verify/result.json.
    const r = parseWakeUtterance("Cześć, Jestem jarvez słucham?");
    expect(r.armed).toBe(false);

    const armed = parseWakeUtterance("Jarvez kliknij Zapisz");
    expect(armed.armed).toBe(true);
    expect(armed.command).toBe("kliknij Zapisz");

    const hej = parseWakeUtterance("Hej jarvez, otwórz pocztę");
    expect(hej.armed).toBe(true);
    expect(hej.command).toBe("otwórz pocztę");
  });

  it("refuses non-wake text", () => {
    expect(parseWakeUtterance("please click Save")).toEqual({
      armed: false,
      command: "",
      matchedPhrase: null,
    });
  });
});

describe("wake tokens", () => {
  it("mint/verify round trip", () => {
    const now = () => 1_700_000_000_000;
    const token = mintWakeToken(now);
    expect(token.startsWith("wk_")).toBe(true);
    expect(verifyWakeToken(token, { now })).toBe(true);
  });

  it("rejects expired and malformed tokens", () => {
    const t0 = 1_000_000;
    const token = mintWakeToken(() => t0);
    expect(
      verifyWakeToken(token, { now: () => t0 + WAKE_TOKEN_TTL_MS + 1 }),
    ).toBe(false);
    expect(verifyWakeToken("wk_nope", { now: () => t0 })).toBe(false);
    expect(verifyWakeToken("bad", { now: () => t0 })).toBe(false);
    expect(verifyWakeToken(null)).toBe(false);
    // Future beyond skew
    const future = mintWakeToken(() => t0 + 60_000);
    expect(verifyWakeToken(future, { now: () => t0 })).toBe(false);
  });
});

describe("isActuationAllowed", () => {
  it("allows non-voice sources; requires token for voice", () => {
    expect(isActuationAllowed({ source: "ui" })).toBe(true);
    expect(isActuationAllowed({ source: null })).toBe(true);
    expect(isActuationAllowed({ source: "voice" })).toBe(false);
    const now = () => 5_000;
    const token = mintWakeToken(now);
    expect(isActuationAllowed({ source: "voice", wakeToken: token }, { now })).toBe(
      true,
    );
  });
});

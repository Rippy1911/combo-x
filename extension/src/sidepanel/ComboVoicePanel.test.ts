import { describe, expect, it, vi } from "vitest";
import { guidanceForStatus } from "./useComboVoice.js";
import type { ComboStatus } from "../lib/comboVoiceBridge.js";

vi.mock("../lib/comboVoiceBridge.js", () => ({
  openSetupPageForMic: vi.fn(),
  loadComboLocale: () => "pl-PL",
  saveComboLocale: vi.fn(),
  startCombo: vi.fn(),
  stopCombo: vi.fn(),
  getComboStatus: vi.fn(),
  speakCombo: vi.fn(),
  checkMicPermission: vi.fn(),
  onComboEvent: () => () => {},
  createNativePort: vi.fn(),
}));

const status = (partial: Partial<ComboStatus> = {}): ComboStatus => ({
  state: "error",
  micGranted: false,
  lastTranscript: "click the login button please",
  lastError: "Microphone not granted",
  locale: "en-US",
  micOwner: "offscreen",
  daemonConnected: false,
  ...partial,
});

describe("ComboVoicePanel guidance", () => {
  it("surfaces mic + azure guidance for the panel", () => {
    const g = guidanceForStatus(status(), { azure: false, nsRag: false });
    expect(g.micMissing).toBe(true);
    expect(g.azureMissing).toBe(true);
    expect(g.messages.join(" ")).toMatch(/Microphone/i);
    expect(g.messages.join(" ")).toMatch(/azure_speech_key/);
    expect(g.messages.join(" ")).toMatch(/Vault → Add secret/);
  });

  it("surfaces daemon offline when micOwner is daemon", () => {
    const g = guidanceForStatus(
      status({
        micGranted: true,
        micOwner: "daemon",
        daemonConnected: false,
        lastError: null,
      }),
      { azure: true, nsRag: true },
    );
    expect(g.daemonOffline).toBe(true);
  });
});

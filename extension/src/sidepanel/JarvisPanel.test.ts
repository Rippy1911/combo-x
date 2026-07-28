import { describe, expect, it, vi } from "vitest";
import { guidanceForStatus } from "./useJarvis";
import type { JarvisStatus } from "../lib/jarvis-bridge.js";

vi.mock("../lib/jarvis-bridge.js", () => ({
  openSetupPageForMic: vi.fn(),
  loadJarvisLocale: () => "pl-PL",
  saveJarvisLocale: vi.fn(),
  startJarvis: vi.fn(),
  stopJarvis: vi.fn(),
  getJarvisStatus: vi.fn(),
  speakJarvis: vi.fn(),
  checkMicPermission: vi.fn(),
  onJarvisEvent: () => () => {},
  createNativePort: vi.fn(),
}));

const status = (partial: Partial<JarvisStatus> = {}): JarvisStatus => ({
  state: "error",
  micGranted: false,
  lastTranscript: "click the login button please",
  lastError: "Microphone not granted",
  locale: "en-US",
  micOwner: "offscreen",
  daemonConnected: false,
  ...partial,
});

describe("JarvisPanel guidance", () => {
  it("surfaces mic + azure guidance for the panel", () => {
    const g = guidanceForStatus(status(), { azure: false, nsRag: false });
    expect(g.micMissing).toBe(true);
    expect(g.azureMissing).toBe(true);
    expect(g.messages.join(" ")).toMatch(/Microphone/i);
    expect(g.messages.join(" ")).toMatch(/azure_speech_key/);
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

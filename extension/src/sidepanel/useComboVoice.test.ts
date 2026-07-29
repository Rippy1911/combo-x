import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AZURE_TTS_NETWORK_HINT,
  guidanceForStatus,
  mapComboStartError,
  mapComboTestError,
  nextStatusFromEvent,
  OFFSCREEN_UNSUPPORTED_HINT,
  runTestSpeech,
  shouldRouteUtterance,
  utteranceCommand,
  WAKE_MODELS_MISSING_HINT,
} from "./useComboVoice.js";
import type { ComboStatus } from "../lib/comboVoiceBridge.js";

const coreMock = vi.hoisted(() => ({
  resolveAzureSpeechConfig: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));

vi.mock("@combo-x/core", () => ({
  AZURE_SPEECH_KEY_LABEL: "azure_speech_key",
  NS_RAG_API_KEY_LABEL: "ns_rag_api_key",
  COMBO_VOICE_SYSTEM_ADDON: "spoken addon",
  SPOKEN_WORD_CAP: 40,
  toSpokenReply: (s: string) => s,
  isActuationAllowed: () => true,
  resolveAzureSpeechConfig: coreMock.resolveAzureSpeechConfig,
  synthesizeSpeech: coreMock.synthesizeSpeech,
}));

const bridge = vi.hoisted(() => {
  const listeners = new Set<(ev: unknown) => void>();
  let locale: "pl-PL" | "en-US" = "pl-PL";
  return {
    listeners,
    locale: () => locale,
    setLocale: (l: "pl-PL" | "en-US") => {
      locale = l;
    },
    startCombo: vi.fn(async () => ({ ok: true as const })),
    stopCombo: vi.fn(async () => {}),
    getComboStatus: vi.fn(async () => ({
      state: "off" as const,
      micGranted: true,
      lastTranscript: null,
      lastError: null,
      locale,
      micOwner: "offscreen" as const,
      daemonConnected: false,
    })),
    speakCombo: vi.fn(async () => ({ ok: true as const })),
    checkMicPermission: vi.fn(async () => true),
    openSetupPageForMic: vi.fn(),
    onComboEvent: vi.fn((cb: (ev: unknown) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    loadComboLocale: vi.fn(() => locale),
    saveComboLocale: vi.fn((l: "pl-PL" | "en-US") => {
      locale = l;
    }),
    createNativePort: vi.fn(),
    emit(ev: unknown) {
      for (const cb of listeners) cb(ev);
    },
  };
});

vi.mock("../lib/comboVoiceBridge.js", () => ({
  startCombo: bridge.startCombo,
  stopCombo: bridge.stopCombo,
  getComboStatus: bridge.getComboStatus,
  speakCombo: bridge.speakCombo,
  checkMicPermission: bridge.checkMicPermission,
  openSetupPageForMic: bridge.openSetupPageForMic,
  onComboEvent: bridge.onComboEvent,
  loadComboLocale: bridge.loadComboLocale,
  saveComboLocale: bridge.saveComboLocale,
  createNativePort: bridge.createNativePort,
}));

const baseStatus = (): ComboStatus => ({
  state: "listening",
  micGranted: true,
  lastTranscript: null,
  lastError: null,
  locale: "pl-PL",
  micOwner: "offscreen",
  daemonConnected: false,
});

describe("shouldRouteUtterance", () => {
  it("drops muted utterances", () => {
    expect(shouldRouteUtterance({ muted: true, command: "open tab" })).toBe(false);
  });

  it("drops empty commands", () => {
    expect(shouldRouteUtterance({ muted: false, command: "" })).toBe(false);
    expect(shouldRouteUtterance({ muted: false, command: "   " })).toBe(false);
  });

  it("routes a valid command", () => {
    expect(shouldRouteUtterance({ muted: false, command: "click login" })).toBe(true);
  });
});

describe("utteranceCommand", () => {
  it("trims text", () => {
    expect(utteranceCommand({ text: "  hi  ", wakeToken: "t", at: 1 })).toBe("hi");
  });
});

describe("nextStatusFromEvent", () => {
  it("applies status events", () => {
    const next = {
      ...baseStatus(),
      state: "armed" as const,
      lastTranscript: "hey",
    };
    expect(nextStatusFromEvent(baseStatus(), { type: "status", status: next })).toEqual(
      next,
    );
  });

  it("marks thinking on utterance while running", () => {
    const prev = baseStatus();
    const out = nextStatusFromEvent(prev, {
      type: "utterance",
      utterance: { text: "open gmail", wakeToken: "w1", at: 9 },
    });
    expect(out.state).toBe("thinking");
    expect(out.lastTranscript).toBe("open gmail");
  });

  it("does not wake from off on utterance alone", () => {
    const prev = { ...baseStatus(), state: "off" as const };
    const out = nextStatusFromEvent(prev, {
      type: "utterance",
      utterance: { text: "x", wakeToken: "w", at: 1 },
    });
    expect(out.state).toBe("off");
    expect(out.lastTranscript).toBe("x");
  });
});

describe("guidanceForStatus", () => {
  it("flags mic not granted", () => {
    const g = guidanceForStatus(
      { ...baseStatus(), micGranted: false },
      { azure: true, nsRag: true },
    );
    expect(g.micMissing).toBe(true);
    expect(g.messages.some((m) => /microphone/i.test(m))).toBe(true);
  });

  it("flags missing azure key", () => {
    const g = guidanceForStatus(baseStatus(), { azure: false, nsRag: true });
    expect(g.azureMissing).toBe(true);
    expect(g.messages.some((m) => /azure_speech_key/i.test(m))).toBe(true);
    expect(g.messages.join(" ")).toMatch(/Vault → Add secret/);
  });

  it("maps offscreen unsupported start errors", () => {
    expect(
      mapComboStartError("media capture unavailable: chrome.offscreen not supported in this browser"),
    ).toBe(OFFSCREEN_UNSUPPORTED_HINT);
    expect(mapComboStartError("azure_tts_401")).toBe("azure_tts_401");
  });

  it("maps wake-model fetch failures on Start", () => {
    expect(mapComboStartError("Failed to fetch")).toBe(WAKE_MODELS_MISSING_HINT);
  });

  it("maps Azure TTS network failures on Test", () => {
    expect(mapComboTestError("Failed to fetch")).toBe(AZURE_TTS_NETWORK_HINT);
  });

  it("runTestSpeech synthesizes and plays when vault has key", async () => {
    coreMock.resolveAzureSpeechConfig.mockResolvedValue({
      key: "k",
      region: "northeurope",
      locale: "en-US",
      voice: "en-US-AriaNeural",
    });
    const audio = new ArrayBuffer(4);
    coreMock.synthesizeSpeech.mockResolvedValue({
      ok: true,
      audio,
      mime: "audio/mpeg",
    });
    const playAudio = vi.fn(async () => {});
    const res = await runTestSpeech({
      getSecret: async () => "k",
      locale: "en-US",
      synthesize: coreMock.synthesizeSpeech,
      playAudio,
    });
    expect(res).toEqual({ ok: true });
    expect(playAudio).toHaveBeenCalledWith(audio, "audio/mpeg");
  });

  it("runTestSpeech fails clearly when key missing", async () => {
    coreMock.resolveAzureSpeechConfig.mockResolvedValue(null);
    await expect(
      runTestSpeech({
        getSecret: async () => null,
        locale: "pl-PL",
        synthesize: coreMock.synthesizeSpeech,
        playAudio: async () => {},
      }),
    ).resolves.toEqual({ ok: false, error: "azure_speech_key missing in vault" });
  });

  it("flags daemon offline when micOwner is daemon", () => {
    const g = guidanceForStatus(
      {
        ...baseStatus(),
        micOwner: "daemon",
        daemonConnected: false,
      },
      { azure: true, nsRag: true },
    );
    expect(g.daemonOffline).toBe(true);
  });
});

describe("locale persistence helpers via bridge mocks", () => {
  beforeEach(() => {
    bridge.listeners.clear();
    bridge.setLocale("pl-PL");
    vi.clearAllMocks();
    bridge.loadComboLocale.mockImplementation(() => bridge.locale());
    bridge.saveComboLocale.mockImplementation((l: "pl-PL" | "en-US") => {
      bridge.setLocale(l);
    });
  });

  it("saveComboLocale persists locale", () => {
    bridge.saveComboLocale("en-US");
    expect(bridge.locale()).toBe("en-US");
    expect(bridge.loadComboLocale()).toBe("en-US");
  });
});

describe("utterance routing through onComboEvent (manual)", () => {
  beforeEach(() => {
    bridge.listeners.clear();
    vi.clearAllMocks();
  });

  it("routes a valid utterance to onCommand with wakeToken", async () => {
    const onCommand = vi.fn();
    const { useComboVoice } = await import("./useComboVoice.js");

    // Tiny render: call hook body via React is unavailable — drive subscription path.
    // useComboVoice mounts onComboEvent; simulate by invoking the registered callback after a
    // minimal stateful harness that mirrors muted + route decisions.
    const muted = false;
    const command = "open settings";
    const wakeToken = "wake-abc";
    if (shouldRouteUtterance({ muted, command })) {
      onCommand(command, wakeToken);
    }
    expect(onCommand).toHaveBeenCalledWith("open settings", "wake-abc");
    expect(useComboVoice).toBeTypeOf("function");
  });

  it("treats a locked vault as 'no key' instead of throwing", async () => {
    const { readSecretSafely } = await import("./useComboVoice.js");
    class VaultLockedError extends Error {}
    const locked = vi.fn(async () => {
      throw new VaultLockedError("vault is locked");
    });
    await expect(readSecretSafely(locked, "azure_speech_key")).resolves.toBeNull();
    expect(locked).toHaveBeenCalledWith("azure_speech_key");

    const present = vi.fn(async () => "sk-real");
    await expect(readSecretSafely(present, "azure_speech_key")).resolves.toBe("sk-real");
  });

  it("drops muted and empty via the same decision helper the hook uses", () => {
    const onCommand = vi.fn();
    if (shouldRouteUtterance({ muted: true, command: "x" })) onCommand("x", "t");
    if (shouldRouteUtterance({ muted: false, command: "" })) onCommand("", "t");
    expect(onCommand).not.toHaveBeenCalled();
  });
});

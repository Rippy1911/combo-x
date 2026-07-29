import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAzureSpeechConfig = vi.fn();

vi.mock("@combo-x/core", () => ({
  resolveAzureSpeechConfig: (...args: unknown[]) => resolveAzureSpeechConfig(...args),
}));

import {
  checkMicPermission,
  createNativePort,
  getComboStatus,
  COMBO_LOCALE_KEY,
  loadComboLocale,
  onComboEvent,
  openSetupPageForMic,
  saveComboLocale,
  speakCombo,
  startCombo,
  stopCombo,
} from "./comboVoiceBridge.js";

describe("comboVoiceBridge", () => {
  const sendMessage = vi.fn();
  const addListener = vi.fn();
  const removeListener = vi.fn();
  const tabsCreate = vi.fn();
  const getURL = vi.fn((p: string) => `chrome-extension://id/${p}`);

  beforeEach(() => {
    sendMessage.mockReset();
    addListener.mockReset();
    removeListener.mockReset();
    tabsCreate.mockReset();
    resolveAzureSpeechConfig.mockReset();
    localStorage.clear();

    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage,
        getURL,
        onMessage: { addListener, removeListener },
      },
      tabs: { create: tabsCreate },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("startCombo posts jarvis_start with resolved azure", async () => {
    resolveAzureSpeechConfig.mockResolvedValue({
      key: "k",
      region: "northeurope",
      locale: "en-US",
      voice: "en-US-AriaNeural",
    });
    sendMessage.mockResolvedValue({ ok: true });

    const res = await startCombo({
      locale: "en-US",
      getSecret: async () => "k",
    });

    expect(res).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "jarvis_start",
      locale: "en-US",
      azure: {
        key: "k",
        region: "northeurope",
        locale: "en-US",
        voice: "en-US-AriaNeural",
      },
    });
  });

  it("startCombo returns clear error when vault lacks azure key", async () => {
    resolveAzureSpeechConfig.mockResolvedValue(null);
    const res = await startCombo({
      locale: "pl-PL",
      getSecret: async () => null,
    });
    expect(res).toEqual({ ok: false, error: "azure_speech_key missing in vault" });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stop/speak/status send expected message shapes", async () => {
    sendMessage.mockResolvedValue({ ok: true });
    await stopCombo();
    expect(sendMessage).toHaveBeenCalledWith({ type: "jarvis_stop" });

    sendMessage.mockResolvedValue({ ok: true });
    await speakCombo("cześć");
    expect(sendMessage).toHaveBeenCalledWith({ type: "jarvis_speak", text: "cześć" });

    sendMessage.mockResolvedValue({
      ok: true,
      status: {
        state: "listening",
        micGranted: true,
        lastTranscript: null,
        lastError: null,
        locale: "pl-PL",
        micOwner: "offscreen",
        daemonConnected: false,
      },
    });
    const status = await getComboStatus();
    expect(sendMessage).toHaveBeenCalledWith({ type: "jarvis_status" });
    expect(status.state).toBe("listening");
  });

  it("checkMicPermission trusts sidepanel Permissions API when granted", async () => {
    Object.defineProperty(globalThis.navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn().mockResolvedValue({ state: "granted" }),
      },
    });
    await expect(checkMicPermission()).resolves.toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("checkMicPermission falls back to jarvis_mic_check when prompt", async () => {
    Object.defineProperty(globalThis.navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn().mockResolvedValue({ state: "prompt" }),
      },
    });
    sendMessage.mockResolvedValue({ ok: true, granted: true });
    await expect(checkMicPermission()).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({ type: "jarvis_mic_check" });
  });

  it("onComboEvent filters only jarvis_event and unsubscribes", () => {
    const cb = vi.fn();
    const unsub = onComboEvent(cb);
    expect(addListener).toHaveBeenCalledTimes(1);
    const listener = addListener.mock.calls[0]![0] as (msg: unknown) => void;

    listener({ type: "other", event: { type: "status" } });
    listener({ type: "jarvis_event", event: { type: "utterance", utterance: { text: "hi", wakeToken: "wk_1", at: 1 } } });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toMatchObject({ type: "utterance" });

    unsub();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });

  it("locale load/save defaults to pl-PL", () => {
    expect(loadComboLocale()).toBe("pl-PL");
    saveComboLocale("en-US");
    expect(localStorage.getItem(COMBO_LOCALE_KEY)).toBe("en-US");
    expect(loadComboLocale()).toBe("en-US");
  });

  it("createNativePort posts jarvis_native and reflects connected", async () => {
    sendMessage.mockResolvedValue({ id: "1", ok: true, data: { apps: [] }, connected: true });
    const port = createNativePort();
    expect(port.connected).toBe(false);
    const res = await port.send("apps", {});
    expect(sendMessage).toHaveBeenCalledWith({
      type: "jarvis_native",
      op: "apps",
      args: {},
    });
    expect(res.ok).toBe(true);
    expect(port.connected).toBe(true);

    sendMessage.mockResolvedValue({ id: "2", ok: false, error: "jarvisd not installed" });
    await port.send("apps");
    expect(port.connected).toBe(false);
  });

  it("openSetupPageForMic opens setup page", () => {
    openSetupPageForMic();
    expect(tabsCreate).toHaveBeenCalledWith({ url: "chrome-extension://id/setup/index.html" });
  });
});

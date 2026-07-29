import { resolveAzureSpeechConfig, type SpeechLocale } from "@combo-x/core";

export interface ComboNativeResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ComboNativePort {
  readonly connected: boolean;
  send(op: string, args?: Record<string, unknown>): Promise<ComboNativeResponse>;
}

export type ComboState =
  | "off"
  | "loading"
  | "listening"
  | "armed"
  | "thinking"
  | "speaking"
  | "error";

export interface ComboStatus {
  state: ComboState;
  micGranted: boolean;
  lastTranscript: string | null;
  lastError: string | null;
  locale: SpeechLocale;
  micOwner: "offscreen" | "daemon";
  daemonConnected: boolean;
  debug?: boolean;
}

export interface ComboUtterance {
  text: string;
  wakeToken: string;
  at: number;
}

export interface ComboDebugEntry {
  t: number;
  kind: string;
  detail?: Record<string, unknown>;
}

export type ComboBridgeEvent =
  | { type: "status"; status: ComboStatus }
  | { type: "utterance"; utterance: ComboUtterance }
  | { type: "debug"; entry: ComboDebugEntry };

/** localStorage key — legacy name kept so existing locale prefs survive rebrand. */
export const COMBO_LOCALE_KEY = "jarvis_locale";

const DEFAULT_STATUS: ComboStatus = {
  state: "off",
  micGranted: false,
  lastTranscript: null,
  lastError: null,
  locale: "pl-PL",
  micOwner: "offscreen",
  daemonConnected: false,
  debug: false,
};

export async function setComboDebug(enabled: boolean): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "jarvis_set_debug", enabled });
  } catch {
    /* ignore */
  }
}

/** Reliable path: pull utterances queued in the offscreen runtime. */
export async function drainComboUtterances(): Promise<ComboUtterance[]> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "jarvis_drain_utterances",
    })) as { ok?: boolean; utterances?: ComboUtterance[] };
    return Array.isArray(res?.utterances) ? res.utterances : [];
  } catch {
    return [];
  }
}

function isSpeechLocale(v: unknown): v is SpeechLocale {
  return v === "pl-PL" || v === "en-US";
}

export function loadComboLocale(): SpeechLocale {
  try {
    const raw = localStorage.getItem(COMBO_LOCALE_KEY);
    if (isSpeechLocale(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "pl-PL";
}

export function saveComboLocale(locale: SpeechLocale): void {
  try {
    localStorage.setItem(COMBO_LOCALE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export async function startCombo(opts: {
  locale: SpeechLocale;
  getSecret: (label: string) => Promise<string | null>;
}): Promise<{ ok: boolean; error?: string }> {
  const azure = await resolveAzureSpeechConfig(opts.getSecret, opts.locale);
  if (!azure) {
    return { ok: false, error: "azure_speech_key missing in vault" };
  }
  saveComboLocale(opts.locale);
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "jarvis_start",
      locale: opts.locale,
      azure,
    })) as { ok?: boolean; error?: string };
    if (!res?.ok) {
      return { ok: false, error: res?.error ?? "jarvis_start failed" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function stopCombo(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "jarvis_stop" });
  } catch {
    /* ignore */
  }
}

export async function getComboStatus(): Promise<ComboStatus> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "jarvis_status" })) as {
      ok?: boolean;
      status?: ComboStatus;
    };
    if (res?.status) return res.status;
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_STATUS, locale: loadComboLocale() };
}

export async function speakCombo(text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "jarvis_speak",
      text,
    })) as { ok?: boolean; error?: string };
    if (!res?.ok) return { ok: false, error: res?.error ?? "speak failed" };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Side panel / setup page can query the extension-origin mic permission. */
export async function querySidepanelMicPermission(): Promise<
  "granted" | "denied" | "prompt" | "unknown"
> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
      return status.state;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Prefer the visible side panel's Permissions API (reliable for extension origin).
 * Fall back to an offscreen getUserMedia probe only when the query is inconclusive.
 */
export async function checkMicPermission(): Promise<boolean> {
  const local = await querySidepanelMicPermission();
  if (local === "granted") return true;
  if (local === "denied") return false;
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "jarvis_mic_check",
    })) as { ok?: boolean; granted?: boolean; error?: string };
    return Boolean(res?.granted === true || (res?.ok === true && res?.granted !== false));
  } catch {
    return false;
  }
}

export function openSetupPageForMic(): void {
  const url = chrome.runtime.getURL("setup/index.html");
  void chrome.tabs.create({ url });
}

export function onComboEvent(cb: (ev: ComboBridgeEvent) => void): () => void {
  const onMessage = (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const msg = message as { type?: string; event?: ComboBridgeEvent };
    if (msg.type !== "jarvis_event" || !msg.event) return;
    cb(msg.event);
  };
  chrome.runtime.onMessage.addListener(onMessage);

  // Port is the primary delivery path (sendMessage from SW is flaky for sidepanel).
  let port: chrome.runtime.Port | null = null;
  try {
    port = chrome.runtime.connect({ name: "jarvis-events" });
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null;
    });
  } catch {
    port = null;
  }

  return () => {
    chrome.runtime.onMessage.removeListener(onMessage);
    try {
      port?.disconnect();
    } catch {
      /* ignore */
    }
  };
}

class BridgeNativePort implements ComboNativePort {
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async send(op: string, args: Record<string, unknown> = {}): Promise<ComboNativeResponse> {
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "jarvis_native",
        op,
        args,
      })) as ComboNativeResponse & { connected?: boolean };
      this._connected = res.ok === true || res.connected === true;
      if (res && typeof res === "object" && "ok" in res) {
        return {
          id: typeof res.id === "string" ? res.id : "",
          ok: Boolean(res.ok),
          data: res.data,
          error: res.error,
        };
      }
      this._connected = false;
      return { id: "", ok: false, error: "bad jarvis_native response" };
    } catch (err) {
      this._connected = false;
      return {
        id: "",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function createNativePort(): ComboNativePort {
  return new BridgeNativePort();
}

/** @deprecated use ComboNativeResponse */
export type JarvisNativeResponse = ComboNativeResponse;
/** @deprecated use ComboNativePort */
export type JarvisNativePort = ComboNativePort;
/** @deprecated use ComboState */
export type JarvisState = ComboState;
/** @deprecated use ComboStatus */
export type JarvisStatus = ComboStatus;
/** @deprecated use ComboUtterance */
export type JarvisUtterance = ComboUtterance;
/** @deprecated use ComboDebugEntry */
export type JarvisDebugEntry = ComboDebugEntry;
/** @deprecated use ComboBridgeEvent */
export type JarvisBridgeEvent = ComboBridgeEvent;
/** @deprecated use COMBO_LOCALE_KEY */
export const JARVIS_LOCALE_KEY = COMBO_LOCALE_KEY;

export const setJarvisDebug = setComboDebug;
export const drainJarvisUtterances = drainComboUtterances;
export const loadJarvisLocale = loadComboLocale;
export const saveJarvisLocale = saveComboLocale;
export const startJarvis = startCombo;
export const stopJarvis = stopCombo;
export const getJarvisStatus = getComboStatus;
export const speakJarvis = speakCombo;
export const onJarvisEvent = onComboEvent;

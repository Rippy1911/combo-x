import { resolveAzureSpeechConfig, type SpeechLocale } from "@combo-x/core";

export interface JarvisNativeResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface JarvisNativePort {
  readonly connected: boolean;
  send(op: string, args?: Record<string, unknown>): Promise<JarvisNativeResponse>;
}

export type JarvisState =
  | "off"
  | "loading"
  | "listening"
  | "armed"
  | "thinking"
  | "speaking"
  | "error";

export interface JarvisStatus {
  state: JarvisState;
  micGranted: boolean;
  lastTranscript: string | null;
  lastError: string | null;
  locale: SpeechLocale;
  micOwner: "offscreen" | "daemon";
  daemonConnected: boolean;
}

export interface JarvisUtterance {
  text: string;
  wakeToken: string;
  at: number;
}

export type JarvisBridgeEvent =
  | { type: "status"; status: JarvisStatus }
  | { type: "utterance"; utterance: JarvisUtterance };

export const JARVIS_LOCALE_KEY = "jarvis_locale";

const DEFAULT_STATUS: JarvisStatus = {
  state: "off",
  micGranted: false,
  lastTranscript: null,
  lastError: null,
  locale: "pl-PL",
  micOwner: "offscreen",
  daemonConnected: false,
};

function isSpeechLocale(v: unknown): v is SpeechLocale {
  return v === "pl-PL" || v === "en-US";
}

export function loadJarvisLocale(): SpeechLocale {
  try {
    const raw = localStorage.getItem(JARVIS_LOCALE_KEY);
    if (isSpeechLocale(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "pl-PL";
}

export function saveJarvisLocale(locale: SpeechLocale): void {
  try {
    localStorage.setItem(JARVIS_LOCALE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export async function startJarvis(opts: {
  locale: SpeechLocale;
  getSecret: (label: string) => Promise<string | null>;
}): Promise<{ ok: boolean; error?: string }> {
  const azure = await resolveAzureSpeechConfig(opts.getSecret, opts.locale);
  if (!azure) {
    return { ok: false, error: "azure_speech_key missing in vault" };
  }
  saveJarvisLocale(opts.locale);
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

export async function stopJarvis(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "jarvis_stop" });
  } catch {
    /* ignore */
  }
}

export async function getJarvisStatus(): Promise<JarvisStatus> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "jarvis_status" })) as {
      ok?: boolean;
      status?: JarvisStatus;
    };
    if (res?.status) return res.status;
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_STATUS, locale: loadJarvisLocale() };
}

export async function speakJarvis(text: string): Promise<{ ok: boolean; error?: string }> {
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

export async function checkMicPermission(): Promise<boolean> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "jarvis_mic_check",
    })) as { ok?: boolean; granted?: boolean };
    return Boolean(res?.granted ?? res?.ok);
  } catch {
    return false;
  }
}

export function openSetupPageForMic(): void {
  const url = chrome.runtime.getURL("setup/index.html");
  void chrome.tabs.create({ url });
}

export function onJarvisEvent(cb: (ev: JarvisBridgeEvent) => void): () => void {
  const listener = (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const msg = message as { type?: string; event?: JarvisBridgeEvent };
    if (msg.type !== "jarvis_event" || !msg.event) return;
    cb(msg.event);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}

class BridgeNativePort implements JarvisNativePort {
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async send(op: string, args: Record<string, unknown> = {}): Promise<JarvisNativeResponse> {
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "jarvis_native",
        op,
        args,
      })) as JarvisNativeResponse & { connected?: boolean };
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

export function createNativePort(): JarvisNativePort {
  return new BridgeNativePort();
}

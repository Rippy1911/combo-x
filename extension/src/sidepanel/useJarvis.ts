import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkMicPermission,
  getJarvisStatus,
  loadJarvisLocale,
  onJarvisEvent,
  openSetupPageForMic,
  saveJarvisLocale,
  speakJarvis,
  startJarvis,
  stopJarvis,
  type JarvisBridgeEvent,
  type JarvisStatus,
  type JarvisUtterance,
} from "../lib/jarvis-bridge.js";

/** Matches `@combo-x/core` SpeechLocale / vault labels (barrel may land mid-merge). */
type SpeechLocale = JarvisStatus["locale"];
const AZURE_SPEECH_KEY_LABEL = "azure_speech_key";
const NS_RAG_API_KEY_LABEL = "ns_rag_api_key";

export interface UseJarvisOptions {
  getSecret: (label: string) => Promise<string | null>;
  onCommand: (command: string, wakeToken: string) => void | Promise<void>;
}

export interface UseJarvisResult {
  status: JarvisStatus;
  enabled: boolean;
  muted: boolean;
  toggleEnabled: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setLocale: (locale: SpeechLocale) => Promise<void>;
  speak: (text: string) => Promise<void>;
  keyStatus: { azure: boolean; nsRag: boolean };
  refreshKeyStatus: () => Promise<void>;
}

export function shouldRouteUtterance(input: {
  muted: boolean;
  command: string;
}): boolean {
  if (input.muted) return false;
  return input.command.trim().length > 0;
}

export function nextStatusFromEvent(
  prev: JarvisStatus,
  event: JarvisBridgeEvent,
): JarvisStatus {
  if (event.type === "status") return event.status;
  if (event.type === "utterance") {
    return {
      ...prev,
      lastTranscript: event.utterance.text,
      state: prev.state === "off" ? prev.state : "thinking",
    };
  }
  return prev;
}

export function guidanceForStatus(
  status: JarvisStatus,
  keyStatus: { azure: boolean; nsRag: boolean },
): {
  micMissing: boolean;
  azureMissing: boolean;
  daemonOffline: boolean;
  messages: string[];
} {
  const messages: string[] = [];
  const micMissing = !status.micGranted;
  const azureMissing = !keyStatus.azure;
  const daemonOffline = status.micOwner === "daemon" && !status.daemonConnected;
  if (micMissing) {
    messages.push("Microphone not granted — open setup to allow access.");
  }
  if (azureMissing) {
    messages.push("Add azure_speech_key in the Vault tab.");
  }
  if (!keyStatus.nsRag) {
    messages.push("Optional: add ns_rag_api_key in Vault for portfolio answers.");
  }
  if (daemonOffline) {
    messages.push("jarvisd is offline — Mac tools unavailable.");
  }
  return { micMissing, azureMissing, daemonOffline, messages };
}

export function utteranceCommand(utterance: JarvisUtterance): string {
  return (utterance.text ?? "").trim();
}

/**
 * The vault throws `VaultLockedError` instead of returning null, and the panel probes
 * for Jarvis keys before the operator has unlocked anything. Treat every read failure
 * as "no key" so a locked vault cannot surface as an unhandled rejection.
 */
export async function readSecretSafely(
  getSecret: (label: string) => Promise<string | null>,
  label: string,
): Promise<string | null> {
  try {
    return await getSecret(label);
  } catch {
    return null;
  }
}

function defaultStatus(): JarvisStatus {
  return {
    state: "off",
    micGranted: false,
    lastTranscript: null,
    lastError: null,
    locale: loadJarvisLocale(),
    micOwner: "offscreen",
    daemonConnected: false,
  };
}

export function useJarvis(opts: UseJarvisOptions): UseJarvisResult {
  const getSecretRef = useRef(opts.getSecret);
  const onCommandRef = useRef(opts.onCommand);
  getSecretRef.current = opts.getSecret;
  onCommandRef.current = opts.onCommand;

  const [status, setStatus] = useState<JarvisStatus>(defaultStatus);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  const [keyStatus, setKeyStatus] = useState({ azure: false, nsRag: false });
  const enabledRef = useRef(false);

  const readSecret = useCallback(
    (label: string) => readSecretSafely(getSecretRef.current, label),
    [],
  );

  const refreshKeyStatus = useCallback(async () => {
    const [azure, nsRag] = await Promise.all([
      readSecret(AZURE_SPEECH_KEY_LABEL),
      readSecret(NS_RAG_API_KEY_LABEL),
    ]);
    setKeyStatus({
      azure: Boolean(azure?.trim()),
      nsRag: Boolean(nsRag?.trim()),
    });
  }, [readSecret]);

  useEffect(() => {
    let cancelled = false;
    void getJarvisStatus().then((s) => {
      if (!cancelled) {
        setStatus(s);
        const on = s.state !== "off" && s.state !== "error";
        setEnabled(on);
        enabledRef.current = on;
      }
    });
    void refreshKeyStatus();
    const unsub = onJarvisEvent((ev) => {
      setStatus((prev) => nextStatusFromEvent(prev, ev));
      if (ev.type === "status") {
        // Keep enabled true while thinking/speaking/listening/armed/loading.
        if (ev.status.state === "off") {
          setEnabled(false);
          enabledRef.current = false;
        } else if (ev.status.state !== "error") {
          setEnabled(true);
          enabledRef.current = true;
        }
      }
      if (ev.type === "utterance") {
        const command = utteranceCommand(ev.utterance);
        if (!shouldRouteUtterance({ muted: mutedRef.current, command })) return;
        setStatus((prev) => ({
          ...prev,
          state: "thinking",
          lastTranscript: command,
        }));
        void Promise.resolve(
          onCommandRef.current(command, ev.utterance.wakeToken),
        ).catch(() => {
          /* App surfaces errors via chat */
        });
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [refreshKeyStatus]);

  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next;
    setMutedState(next);
  }, []);

  const toggleEnabled = useCallback(async () => {
    if (enabledRef.current) {
      await stopJarvis();
      enabledRef.current = false;
      setEnabled(false);
      setStatus((prev) => ({
        ...prev,
        state: "off",
        lastError: null,
      }));
      return;
    }

    const granted = await checkMicPermission();
    if (!granted) {
      openSetupPageForMic();
      setStatus((prev) => ({
        ...prev,
        state: "error",
        micGranted: false,
        lastError: "Microphone not granted",
      }));
      return;
    }

    const locale = loadJarvisLocale();
    setStatus((prev) => ({ ...prev, state: "loading", lastError: null, locale }));
    const res = await startJarvis({
      locale,
      getSecret: readSecret,
    });
    if (!res.ok) {
      setStatus((prev) => ({
        ...prev,
        state: "error",
        lastError: res.error ?? "Failed to start Jarvis",
      }));
      enabledRef.current = false;
      setEnabled(false);
      return;
    }
    enabledRef.current = true;
    setEnabled(true);
    const next = await getJarvisStatus();
    setStatus(next);
    void refreshKeyStatus();
  }, [refreshKeyStatus, readSecret]);

  const setLocale = useCallback(
    async (locale: SpeechLocale) => {
      saveJarvisLocale(locale);
      setStatus((prev) => ({ ...prev, locale }));
      if (!enabledRef.current) return;
      await stopJarvis();
      setStatus((prev) => ({ ...prev, state: "loading", lastError: null, locale }));
      const res = await startJarvis({
        locale,
        getSecret: readSecret,
      });
      if (!res.ok) {
        enabledRef.current = false;
        setEnabled(false);
        setStatus((prev) => ({
          ...prev,
          state: "error",
          lastError: res.error ?? "Failed to restart Jarvis",
          locale,
        }));
        return;
      }
      const next = await getJarvisStatus();
      setStatus(next);
    },
    [readSecret],
  );

  const speak = useCallback(async (text: string) => {
    if (mutedRef.current) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setStatus((prev) => ({ ...prev, state: "speaking" }));
    const res = await speakJarvis(trimmed);
    if (!res.ok) {
      setStatus((prev) => ({
        ...prev,
        state: "error",
        lastError: res.error ?? "Speak failed",
      }));
    }
  }, []);

  return {
    status,
    enabled,
    muted,
    toggleEnabled,
    setMuted,
    setLocale,
    speak,
    keyStatus,
    refreshKeyStatus,
  };
}

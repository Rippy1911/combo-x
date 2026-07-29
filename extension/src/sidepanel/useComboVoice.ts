import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveAzureSpeechConfig,
  synthesizeSpeech,
  type SpeechLocale,
} from "@combo-x/core";
import {
  checkMicPermission,
  getComboStatus,
  loadComboLocale,
  drainComboUtterances,
  onComboEvent,
  openSetupPageForMic,
  saveComboLocale,
  setComboDebug,
  speakCombo,
  startCombo,
  stopCombo,
  type ComboBridgeEvent,
  type ComboDebugEntry,
  type ComboStatus,
  type ComboUtterance,
} from "../lib/comboVoiceBridge.js";

/** Matches `@combo-x/core` SpeechLocale / vault labels (barrel may land mid-merge). */
const AZURE_SPEECH_KEY_LABEL = "azure_speech_key";
const NS_RAG_API_KEY_LABEL = "ns_rag_api_key";

export const TEST_SPEECH_PHRASE: Record<SpeechLocale, string> = {
  "pl-PL": "Cześć, Azure Speech działa.",
  "en-US": "Hello, Azure Speech is working.",
};

export const OFFSCREEN_UNSUPPORTED_HINT =
  "Combo voice mic needs Chrome or Edge (Firefox has no offscreen). Use Test Speech to verify your key here.";

export const WAKE_MODELS_MISSING_HINT =
  "Wake models missing — rebuild with `pnpm build:combo`, then reload. Use Test to verify Azure TTS without wake.";

export const AZURE_TTS_NETWORK_HINT =
  "Azure TTS unreachable — set azure_speech_region to `northeurope` (not a full URL), then retry Test.";

export function mapComboStartError(error: string): string {
  if (/offscreen not supported|chrome\.offscreen/i.test(error)) {
    return OFFSCREEN_UNSUPPORTED_HINT;
  }
  if (/unable to load a worklet/i.test(error)) {
    return "Audio worklet blocked — reload the Combo voice build (public/jarvis-capture-worklet.js).";
  }
  if (/failed to fetch|wake models? missing|openwakeword/i.test(error)) {
    return WAKE_MODELS_MISSING_HINT;
  }
  return error;
}

export function mapComboTestError(error: string): string {
  if (/failed to fetch|networkerror|load failed/i.test(error)) {
    return AZURE_TTS_NETWORK_HINT;
  }
  return error;
}

export async function playSpeechAudio(
  audio: ArrayBuffer,
  mime = "audio/mpeg",
): Promise<void> {
  const blob = new Blob([audio], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const el = new Audio(url);
    await new Promise<void>((resolve, reject) => {
      el.onended = () => resolve();
      el.onerror = () => reject(new Error("audio playback failed"));
      void el.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function runTestSpeech(opts: {
  getSecret: (label: string) => Promise<string | null>;
  locale: SpeechLocale;
  synthesize?: typeof synthesizeSpeech;
  playAudio?: (audio: ArrayBuffer, mime: string) => Promise<void>;
}): Promise<{ ok: boolean; error?: string }> {
  const cfg = await resolveAzureSpeechConfig(opts.getSecret, opts.locale);
  if (!cfg) {
    return { ok: false, error: "azure_speech_key missing in vault" };
  }
  const synth = opts.synthesize ?? synthesizeSpeech;
  const play = opts.playAudio ?? playSpeechAudio;
  const res = await synth(TEST_SPEECH_PHRASE[opts.locale], cfg);
  if (!res.ok || !res.audio) {
    return {
      ok: false,
      error: mapComboTestError(res.error ?? "synthesize failed"),
    };
  }
  try {
    await play(res.audio, res.mime ?? "audio/mpeg");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "audio playback failed",
    };
  }
}

export interface UseComboVoiceOptions {
  getSecret: (label: string) => Promise<string | null>;
  onCommand: (command: string, wakeToken: string) => void | Promise<void>;
}

export interface UseComboVoiceResult {
  status: ComboStatus;
  enabled: boolean;
  muted: boolean;
  testing: boolean;
  debug: boolean;
  debugLog: ComboDebugEntry[];
  toggleEnabled: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setLocale: (locale: SpeechLocale) => Promise<void>;
  setDebug: (enabled: boolean) => Promise<void>;
  clearDebugLog: () => void;
  copyDebugDump: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  testSpeech: () => Promise<void>;
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
  prev: ComboStatus,
  event: ComboBridgeEvent,
): ComboStatus {
  if (event.type === "status") return event.status;
  if (event.type === "utterance") {
    return {
      ...prev,
      lastTranscript: event.utterance.text,
      lastError: null,
      state: prev.state === "off" ? prev.state : "thinking",
    };
  }
  return prev;
}

export function appendDebugLog(
  prev: ComboDebugEntry[],
  entry: ComboDebugEntry,
  max = 80,
): ComboDebugEntry[] {
  const next = [...prev, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function guidanceForStatus(
  status: ComboStatus,
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
    messages.push("Add azure_speech_key in Vault → Add secret.");
  }
  if (!keyStatus.nsRag) {
    messages.push("Optional: add ns_rag_api_key in Vault → Add secret for portfolio answers.");
  }
  if (daemonOffline) {
    messages.push("Mac tools daemon (jarvisd) is offline — Mac tools unavailable.");
  }
  return { micMissing, azureMissing, daemonOffline, messages };
}

export function utteranceCommand(utterance: ComboUtterance): string {
  return (utterance.text ?? "").trim();
}

/**
 * The vault throws `VaultLockedError` instead of returning null, and the panel probes
 * for Combo voice keys before the operator has unlocked anything. Treat every read failure
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

function defaultStatus(): ComboStatus {
  return {
    state: "off",
    micGranted: false,
    lastTranscript: null,
    lastError: null,
    locale: loadComboLocale(),
    micOwner: "offscreen",
    daemonConnected: false,
  };
}

export function useComboVoice(opts: UseComboVoiceOptions): UseComboVoiceResult {
  const getSecretRef = useRef(opts.getSecret);
  const onCommandRef = useRef(opts.onCommand);
  getSecretRef.current = opts.getSecret;
  onCommandRef.current = opts.onCommand;

  const [status, setStatus] = useState<ComboStatus>(defaultStatus);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  const [keyStatus, setKeyStatus] = useState({ azure: false, nsRag: false });
  const [testing, setTesting] = useState(false);
  const [debug, setDebugState] = useState(false);
  const [debugLog, setDebugLog] = useState<ComboDebugEntry[]>([]);
  const enabledRef = useRef(false);
  const seenWakeTokensRef = useRef(new Set<string>());
  const handleUtteranceRef = useRef<(u: ComboUtterance) => void>(() => {});

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

  const dispatchUtterance = useCallback((utterance: ComboUtterance) => {
    const token = utterance.wakeToken || `${utterance.at}:${utterance.text}`;
    if (seenWakeTokensRef.current.has(token)) return;
    seenWakeTokensRef.current.add(token);
    if (seenWakeTokensRef.current.size > 100) {
      const keep = [...seenWakeTokensRef.current].slice(-50);
      seenWakeTokensRef.current = new Set(keep);
    }

    const command = utteranceCommand(utterance);
    if (!shouldRouteUtterance({ muted: mutedRef.current, command })) return;

    // Auto-open debug so the next failure is visible without an extra click.
    setDebugState(true);
    void setComboDebug(true);

    setStatus((prev) => ({
      ...prev,
      state: "thinking",
      lastTranscript: command,
      lastError: null,
    }));
    setDebugLog((prev) =>
      appendDebugLog(prev, {
        t: Date.now(),
        kind: "command",
        detail: { text: command, wakeToken: utterance.wakeToken?.slice(0, 18), via: "dispatch" },
      }),
    );
    void (async () => {
      try {
        await onCommandRef.current(command, utterance.wakeToken);
        setStatus((prev) => ({
          ...prev,
          state: prev.state === "off" ? "off" : "listening",
          lastError: null,
        }));
        setDebugLog((prev) =>
          appendDebugLog(prev, {
            t: Date.now(),
            kind: "command_done",
            detail: { text: command },
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus((prev) => ({
          ...prev,
          state: prev.state === "off" ? "off" : "listening",
          lastError: msg,
        }));
        setDebugLog((prev) =>
          appendDebugLog(prev, {
            t: Date.now(),
            kind: "command_error",
            detail: { error: msg },
          }),
        );
      }
    })();
  }, []);

  handleUtteranceRef.current = dispatchUtterance;

  useEffect(() => {
    let cancelled = false;
    void getComboStatus().then((s) => {
      if (!cancelled) {
        setStatus(s);
        const on = s.state !== "off" && s.state !== "error";
        setEnabled(on);
        enabledRef.current = on;
      }
    });
    void refreshKeyStatus();
    const unsub = onComboEvent((ev) => {
      setStatus((prev) => nextStatusFromEvent(prev, ev));
      if (ev.type === "status") {
        if (typeof ev.status.debug === "boolean") setDebugState(ev.status.debug);
        // Keep enabled true while thinking/speaking/listening/armed/loading.
        if (ev.status.state === "off") {
          setEnabled(false);
          enabledRef.current = false;
        } else if (ev.status.state !== "error") {
          setEnabled(true);
          enabledRef.current = true;
        }
      }
      if (ev.type === "debug") {
        setDebugLog((prev) => appendDebugLog(prev, ev.entry));
      }
      if (ev.type === "utterance") {
        handleUtteranceRef.current(ev.utterance);
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [refreshKeyStatus]);

  // Belt-and-suspenders: poll the offscreen utterance queue while Combo voice is on.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || !enabledRef.current) return;
      const batch = await drainComboUtterances();
      for (const u of batch) {
        if (cancelled) break;
        handleUtteranceRef.current(u);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next;
    setMutedState(next);
  }, []);

  const setDebug = useCallback(async (enabledDebug: boolean) => {
    setDebugState(enabledDebug);
    if (enabledDebug) {
      setDebugLog((prev) =>
        appendDebugLog(prev, {
          t: Date.now(),
          kind: "ui",
          detail: { note: "debug ON — say Hey Combo (STT or wake model); acoustic alias hey_jarvis also works — watch wake_hit / stt_wake / mic" },
        }),
      );
    }
    await setComboDebug(enabledDebug);
  }, []);

  const clearDebugLog = useCallback(() => setDebugLog([]), []);

  const copyDebugDump = useCallback(async () => {
    const dump = {
      at: new Date().toISOString(),
      status,
      keyStatus,
      enabled,
      muted: mutedRef.current,
      log: debugLog,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
    } catch {
      /* ignore */
    }
  }, [status, keyStatus, enabled, debugLog]);

  const toggleEnabled = useCallback(async () => {
    if (enabledRef.current) {
      await stopCombo();
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
        lastError:
          "Microphone not granted — click Grant microphone on the setup tab, then press Start again.",
      }));
      return;
    }

    const locale = loadComboLocale();
    setStatus((prev) => ({ ...prev, state: "loading", lastError: null, locale }));
    const res = await startCombo({
      locale,
      getSecret: readSecret,
    });
    if (!res.ok) {
      setStatus((prev) => ({
        ...prev,
        state: "error",
        lastError: mapComboStartError(res.error ?? "Failed to start Combo voice"),
      }));
      enabledRef.current = false;
      setEnabled(false);
      return;
    }
    enabledRef.current = true;
    setEnabled(true);
    const next = await getComboStatus();
    setStatus(next);
    void refreshKeyStatus();
  }, [refreshKeyStatus, readSecret]);

  const setLocale = useCallback(
    async (locale: SpeechLocale) => {
      saveComboLocale(locale);
      setStatus((prev) => ({ ...prev, locale }));
      if (!enabledRef.current) return;
      await stopCombo();
      setStatus((prev) => ({ ...prev, state: "loading", lastError: null, locale }));
      const res = await startCombo({
        locale,
        getSecret: readSecret,
      });
      if (!res.ok) {
        enabledRef.current = false;
        setEnabled(false);
        setStatus((prev) => ({
          ...prev,
          state: "error",
          lastError: mapComboStartError(res.error ?? "Failed to restart Combo voice"),
          locale,
        }));
        return;
      }
      const next = await getComboStatus();
      setStatus(next);
    },
    [readSecret],
  );

  const speak = useCallback(async (text: string) => {
    if (mutedRef.current) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setStatus((prev) => ({ ...prev, state: "speaking" }));
    const res = await speakCombo(trimmed);
    if (!res.ok) {
      setStatus((prev) => ({
        ...prev,
        state: "error",
        lastError: res.error ?? "Speak failed",
      }));
    }
  }, []);

  const testSpeech = useCallback(async () => {
    const locale = status.locale;
    setTesting(true);
    setStatus((prev) => ({ ...prev, lastError: null }));
    try {
      const res = await runTestSpeech({
        getSecret: readSecret,
        locale,
      });
      if (!res.ok) {
        setStatus((prev) => ({
          ...prev,
          state: prev.state === "listening" || prev.state === "armed" ? prev.state : "error",
          lastError: mapComboTestError(res.error ?? "Test Speech failed"),
        }));
        return;
      }
      setStatus((prev) => ({
        ...prev,
        lastError: null,
        lastTranscript: TEST_SPEECH_PHRASE[locale],
      }));
    } finally {
      setTesting(false);
      void refreshKeyStatus();
    }
  }, [readSecret, refreshKeyStatus, status.locale]);

  return {
    status,
    enabled,
    muted,
    testing,
    debug,
    debugLog,
    toggleEnabled,
    setMuted,
    setLocale,
    setDebug,
    clearDebugLog,
    copyDebugDump,
    speak,
    testSpeech,
    keyStatus,
    refreshKeyStatus,
  };
}

/** @deprecated use mapComboStartError */
export const mapJarvisStartError = mapComboStartError;
/** @deprecated use mapComboTestError */
export const mapJarvisTestError = mapComboTestError;
/** @deprecated use useComboVoice */
export { useComboVoice as useJarvis };
export type UseJarvisOptions = UseComboVoiceOptions;
export type UseJarvisResult = UseComboVoiceResult;

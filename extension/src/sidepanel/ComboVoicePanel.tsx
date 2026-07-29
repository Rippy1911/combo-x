import { openSetupPageForMic } from "../lib/comboVoiceBridge.js";
import {
  guidanceForStatus,
  type UseComboVoiceResult,
} from "./useComboVoice.js";

const STATE_LABEL: Record<UseComboVoiceResult["status"]["state"], string> = {
  off: "off",
  loading: "loading models…",
  listening: 'say "Hey Combo"',
  armed: "armed — speak command",
  thinking: "thinking",
  speaking: "speaking",
  error: "error",
};

const DOT_COLOR: Record<UseComboVoiceResult["status"]["state"], string> = {
  off: "var(--muted)",
  loading: "#fbbf24",
  listening: "var(--accent)",
  armed: "#34d399",
  thinking: "#60a5fa",
  speaking: "#a78bfa",
  error: "var(--danger)",
};

export function ComboVoicePanel({ comboVoice }: { comboVoice: UseComboVoiceResult }) {
  const { status, enabled, muted, testing, keyStatus, debug, debugLog } = comboVoice;
  const guidance = guidanceForStatus(status, keyStatus);
  const transcript = status.lastTranscript?.trim() || "";
  const truncated =
    transcript.length > 72 ? `${transcript.slice(0, 72)}…` : transcript;
  const noSpeechHint =
    status.lastError === "no_speech"
      ? status.locale === "pl-PL"
        ? 'Azure heard silence/noise. Switch locale to en-US for English, or pause after “Hey Combo” then speak the command.'
        : 'Azure heard silence/noise. Prefer: “Hey Combo” → pause → command. (Acoustic wake model hey_jarvis also works.)'
      : null;

  return (
    <div
      className="combo-voice-panel"
      data-testid="combo-voice-pill"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 10px",
        borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--bg-elev) 70%, transparent)",
        fontSize: 12,
      }}
    >
      <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
          title={STATE_LABEL[status.state]}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: DOT_COLOR[status.state],
              flexShrink: 0,
              boxShadow:
                status.state === "listening" || status.state === "armed"
                  ? `0 0 0 2px color-mix(in srgb, ${DOT_COLOR[status.state]} 35%, transparent)`
                  : undefined,
            }}
          />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            Combo · {STATE_LABEL[status.state]}
          </span>
        </span>

        {status.micOwner === "daemon" ? (
          <span
            className="gate-badge"
            title={
              status.daemonConnected
                ? "Mic owned by jarvisd (Mac daemon)"
                : "Mac daemon (jarvisd) offline"
            }
            style={{ fontSize: 10 }}
          >
            Mac tools{status.daemonConnected ? "" : " · offline"}
          </span>
        ) : null}

        <span style={{ flex: 1 }} />

        <button
          type="button"
          className={enabled ? "msg-action active" : "msg-action"}
          onClick={() => void comboVoice.toggleEnabled()}
          title={enabled ? "Stop Combo voice" : "Start Combo voice"}
        >
          {enabled ? "Stop" : "Start"}
        </button>
        <button
          type="button"
          className="msg-action"
          disabled={testing || !keyStatus.azure}
          onClick={() => void comboVoice.testSpeech()}
          title="Synthesize a short phrase via Azure TTS (no mic; works on Firefox)"
        >
          {testing ? "Testing…" : "Test"}
        </button>
        <button
          type="button"
          className={muted ? "msg-action active dangerish" : "msg-action"}
          onClick={() => comboVoice.setMuted(!muted)}
          title={muted ? "Unmute — route wake commands" : "Hard mute — drop utterances"}
        >
          {muted ? "Muted" : "Mute"}
        </button>
        <button
          type="button"
          className={debug ? "msg-action active" : "msg-action"}
          onClick={() => void comboVoice.setDebug(!debug)}
          title="Live wake / mic / STT debug stream"
          data-testid="combo-voice-debug-toggle"
        >
          Debug
        </button>
        <select
          aria-label="Combo voice locale"
          value={status.locale}
          onChange={(e) =>
            void comboVoice.setLocale(e.target.value as UseComboVoiceResult["status"]["locale"])
          }
          style={{
            fontSize: 11,
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "2px 4px",
          }}
        >
          <option value="pl-PL">pl-PL</option>
          <option value="en-US">en-US</option>
        </select>
      </div>

      {transcript ? (
        <p
          className="hint"
          title={transcript}
          style={{
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            opacity: 0.85,
          }}
        >
          {truncated}
        </p>
      ) : null}

      {status.lastError || guidance.messages.length || noSpeechHint ? (
        <div className="hint wrap" style={{ margin: 0, color: "var(--danger)" }}>
          {status.lastError ? <div>{status.lastError}</div> : null}
          {noSpeechHint ? (
            <div style={{ color: "var(--muted)", marginTop: 2 }}>{noSpeechHint}</div>
          ) : null}
          {guidance.azureMissing ? (
            <div>Missing azure_speech_key — add it in Vault → Add secret.</div>
          ) : null}
          {guidance.daemonOffline ? (
            <div>Mac tools daemon (jarvisd) is offline.</div>
          ) : null}
          {guidance.micMissing ? (
            <button
              type="button"
              className="msg-action"
              style={{ marginTop: 2 }}
              onClick={() => openSetupPageForMic()}
            >
              Grant microphone
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="hint" style={{ margin: 0, opacity: 0.75 }}>
        Audio stays local until the wake word fires. English commands → set locale{" "}
        <strong>en-US</strong>.
      </p>

      {debug ? (
        <div
          data-testid="combo-voice-debug-panel"
          style={{
            marginTop: 4,
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 6,
            background: "var(--bg)",
            maxHeight: 220,
            overflow: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 10,
            lineHeight: 1.35,
          }}
        >
          <div className="row" style={{ gap: 6, marginBottom: 4, alignItems: "center" }}>
            <span style={{ fontWeight: 700 }}>
              debug · {status.state} · {status.locale} · mic=
              {status.micGranted ? "ok" : "no"}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="msg-action" onClick={() => comboVoice.clearDebugLog()}>
              Clear
            </button>
            <button type="button" className="msg-action" onClick={() => void comboVoice.copyDebugDump()}>
              Copy dump
            </button>
          </div>
          {debugLog.length === 0 ? (
            <div style={{ opacity: 0.7 }}>Waiting for mic/wake/stt events…</div>
          ) : (
            debugLog
              .slice()
              .reverse()
              .map((e, i) => (
                <div key={`${e.t}-${e.kind}-${i}`} style={{ opacity: e.kind === "mic" ? 0.65 : 1 }}>
                  <span style={{ color: "var(--muted)" }}>
                    {new Date(e.t).toLocaleTimeString()}{" "}
                  </span>
                  <span style={{ color: "var(--accent)" }}>{e.kind}</span>{" "}
                  {e.detail ? JSON.stringify(e.detail) : ""}
                </div>
              ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated use ComboVoicePanel */
export { ComboVoicePanel as JarvisPanel };
export type { UseComboVoiceResult as UseJarvisResult };

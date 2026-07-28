import { openSetupPageForMic } from "../lib/jarvis-bridge.js";
import {
  guidanceForStatus,
  type UseJarvisResult,
} from "./useJarvis";

const STATE_LABEL: Record<UseJarvisResult["status"]["state"], string> = {
  off: "off",
  loading: "loading models…",
  listening: 'say "Hey Jarvis"',
  armed: "listening…",
  thinking: "thinking",
  speaking: "speaking",
  error: "error",
};

const DOT_COLOR: Record<UseJarvisResult["status"]["state"], string> = {
  off: "var(--muted)",
  loading: "#fbbf24",
  listening: "var(--accent)",
  armed: "#34d399",
  thinking: "#60a5fa",
  speaking: "#a78bfa",
  error: "var(--danger)",
};

export function JarvisPanel({ jarvis }: { jarvis: UseJarvisResult }) {
  const { status, enabled, muted, keyStatus } = jarvis;
  const guidance = guidanceForStatus(status, keyStatus);
  const transcript = status.lastTranscript?.trim() || "";
  const truncated =
    transcript.length > 72 ? `${transcript.slice(0, 72)}…` : transcript;

  return (
    <div
      className="jarvis-panel"
      data-testid="jarvis-pill"
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
            Jarvis · {STATE_LABEL[status.state]}
          </span>
        </span>

        {status.micOwner === "daemon" ? (
          <span
            className="gate-badge"
            title={
              status.daemonConnected
                ? "Mic owned by jarvisd"
                : "jarvisd offline"
            }
            style={{ fontSize: 10 }}
          >
            jarvisd{status.daemonConnected ? "" : " · offline"}
          </span>
        ) : null}

        <span style={{ flex: 1 }} />

        <button
          type="button"
          className={enabled ? "msg-action active" : "msg-action"}
          onClick={() => void jarvis.toggleEnabled()}
          title={enabled ? "Stop Jarvis" : "Start Jarvis"}
        >
          {enabled ? "Stop" : "Start"}
        </button>
        <button
          type="button"
          className={muted ? "msg-action active dangerish" : "msg-action"}
          onClick={() => jarvis.setMuted(!muted)}
          title={muted ? "Unmute — route wake commands" : "Hard mute — drop utterances"}
        >
          {muted ? "Muted" : "Mute"}
        </button>
        <select
          aria-label="Jarvis locale"
          value={status.locale}
          onChange={(e) =>
            void jarvis.setLocale(e.target.value as UseJarvisResult["status"]["locale"])
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

      {status.lastError || guidance.messages.length ? (
        <div className="hint wrap" style={{ margin: 0, color: "var(--danger)" }}>
          {status.lastError ? <div>{status.lastError}</div> : null}
          {guidance.azureMissing ? (
            <div>Missing azure_speech_key — add it in the Vault tab.</div>
          ) : null}
          {guidance.daemonOffline ? <div>jarvisd is offline.</div> : null}
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
        Audio stays local until the wake word fires.
      </p>
    </div>
  );
}

import { chatArtifactSandbox, isSafeChatArtifactSandbox } from "@combo-x/core";
import { useEffect, useState } from "react";
import { canOpenPreviewInNewTab, openPreviewInNewTab } from "./openPreviewTab";

export type ChatArtifactPayload = {
  kind: "table" | "html" | "text" | "image" | "compare";
  title: string;
  html?: string;
  text?: string;
  src?: string;
  beforeSrc?: string;
  afterSrc?: string;
  attachmentId?: string;
  beforeAttachmentId?: string;
  afterAttachmentId?: string;
  interactive?: boolean;
  headers?: string[];
  rows?: string[][];
};

function ArtifactHead({
  title,
  openPayload,
}: {
  title: string;
  openPayload?: Parameters<typeof openPreviewInNewTab>[0];
}) {
  const canOpen = openPayload ? canOpenPreviewInNewTab(openPayload) : false;
  return (
    <div className="chat-artifact-head">
      <span className="chat-artifact-title">{title}</span>
      {canOpen && openPayload ? (
        <button
          type="button"
          className="chat-artifact-open"
          title="Open in a full browser tab"
          onClick={() => {
            if (!openPreviewInNewTab(openPayload)) {
              window.alert("Popup blocked — allow popups for Combo-X, then try again.");
            }
          }}
        >
          Open tab
        </button>
      ) : null}
    </div>
  );
}

/**
 * Inline chat surface for UX Vision Lab prototypes.
 * sandbox: allow-scripts XOR empty — never allow-same-origin with scripts.
 */
export function ChatArtifact({
  artifact,
  resolveAttachment,
}: {
  artifact: ChatArtifactPayload;
  /** Rehydrate image src from AttachmentStore after IDB slim (data URL dropped). */
  resolveAttachment?: (id: string) => Promise<string | null>;
}) {
  const [src, setSrc] = useState(artifact.src);
  const [beforeSrc, setBeforeSrc] = useState(artifact.beforeSrc);
  const [afterSrc, setAfterSrc] = useState(artifact.afterSrc);

  useEffect(() => {
    setSrc(artifact.src);
    setBeforeSrc(artifact.beforeSrc);
    setAfterSrc(artifact.afterSrc);
    if (!resolveAttachment) return;
    let cancelled = false;
    void (async () => {
      if (!artifact.src && artifact.attachmentId) {
        const u = await resolveAttachment(artifact.attachmentId);
        if (!cancelled && u) setSrc(u);
      }
      if (!artifact.beforeSrc && artifact.beforeAttachmentId) {
        const u = await resolveAttachment(artifact.beforeAttachmentId);
        if (!cancelled && u) setBeforeSrc(u);
      }
      if (!artifact.afterSrc && artifact.afterAttachmentId) {
        const u = await resolveAttachment(artifact.afterAttachmentId);
        if (!cancelled && u) setAfterSrc(u);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    artifact.src,
    artifact.beforeSrc,
    artifact.afterSrc,
    artifact.attachmentId,
    artifact.beforeAttachmentId,
    artifact.afterAttachmentId,
    resolveAttachment,
  ]);

  if (artifact.kind === "html" && artifact.html) {
    const sandbox = chatArtifactSandbox(Boolean(artifact.interactive));
    if (!isSafeChatArtifactSandbox(sandbox)) {
      return (
        <div className="chat-artifact error">
          Blocked unsafe sandbox configuration.
        </div>
      );
    }
    return (
      <div className="chat-artifact">
        <ArtifactHead
          title={artifact.title}
          openPayload={{
            title: artifact.title,
            kind: "html",
            html: artifact.html,
          }}
        />
        <iframe
          title={artifact.title}
          srcDoc={artifact.html}
          sandbox={sandbox}
          className="chat-artifact-frame"
        />
      </div>
    );
  }

  if (artifact.kind === "image" && src) {
    return (
      <div className="chat-artifact">
        <ArtifactHead
          title={artifact.title}
          openPayload={{
            title: artifact.title,
            kind: "image",
            body: src,
          }}
        />
        <img src={src} alt={artifact.title} className="chat-artifact-img" />
      </div>
    );
  }

  if (artifact.kind === "image" && artifact.attachmentId && !src) {
    return (
      <div className="chat-artifact">
        <ArtifactHead title={artifact.title} />
        <p className="hint">Loading screenshot…</p>
      </div>
    );
  }

  if (artifact.kind === "compare" && (beforeSrc || afterSrc)) {
    return (
      <div className="chat-artifact">
        <ArtifactHead
          title={artifact.title}
          openPayload={{
            title: artifact.title,
            kind: "compare",
            beforeSrc,
            afterSrc,
          }}
        />
        <div className="chat-artifact-compare">
          {beforeSrc ? (
            <figure>
              <figcaption>Before</figcaption>
              <img src={beforeSrc} alt="Before" className="chat-artifact-img" />
            </figure>
          ) : null}
          {afterSrc ? (
            <figure>
              <figcaption>After</figcaption>
              <img src={afterSrc} alt="After" className="chat-artifact-img" />
            </figure>
          ) : null}
        </div>
      </div>
    );
  }

  if (artifact.kind === "text" && artifact.text) {
    return (
      <div className="chat-artifact">
        <ArtifactHead
          title={artifact.title}
          openPayload={{
            title: artifact.title,
            kind: "text",
            body: artifact.text,
          }}
        />
        <pre className="chat-artifact-pre">{artifact.text}</pre>
      </div>
    );
  }

  if (artifact.kind === "table" && artifact.rows?.length) {
    return (
      <div className="chat-artifact">
        <ArtifactHead title={artifact.title} />
        <div className="chat-artifact-table-wrap">
          <table>
            <tbody>
              {artifact.rows.map((row, i) => (
                <tr key={`ar-${i}`}>
                  {row.map((cell, j) => (
                    <td key={`ac-${i}-${j}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
}

/** Exported for tests — sandbox string only. */
export function sandboxForInteractive(interactive: boolean): string {
  return chatArtifactSandbox(interactive);
}

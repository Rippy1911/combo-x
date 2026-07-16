import { chatArtifactSandbox, isSafeChatArtifactSandbox } from "@combo-x/core";

export type ChatArtifactPayload = {
  kind: "table" | "html" | "text" | "image" | "compare";
  title: string;
  html?: string;
  text?: string;
  src?: string;
  beforeSrc?: string;
  afterSrc?: string;
  interactive?: boolean;
  headers?: string[];
  rows?: string[][];
};

/**
 * Inline chat surface for UX Vision Lab prototypes.
 * sandbox: allow-scripts XOR empty — never allow-same-origin with scripts.
 */
export function ChatArtifact({
  artifact,
}: {
  artifact: ChatArtifactPayload;
}) {
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
        <div className="chat-artifact-head">{artifact.title}</div>
        <iframe
          title={artifact.title}
          srcDoc={artifact.html}
          sandbox={sandbox}
          className="chat-artifact-frame"
        />
      </div>
    );
  }

  if (artifact.kind === "image" && artifact.src) {
    return (
      <div className="chat-artifact">
        <div className="chat-artifact-head">{artifact.title}</div>
        <img src={artifact.src} alt={artifact.title} className="chat-artifact-img" />
      </div>
    );
  }

  if (artifact.kind === "compare" && (artifact.beforeSrc || artifact.afterSrc)) {
    return (
      <div className="chat-artifact">
        <div className="chat-artifact-head">{artifact.title}</div>
        <div className="chat-artifact-compare">
          {artifact.beforeSrc ? (
            <figure>
              <figcaption>Before</figcaption>
              <img src={artifact.beforeSrc} alt="Before" className="chat-artifact-img" />
            </figure>
          ) : null}
          {artifact.afterSrc ? (
            <figure>
              <figcaption>After</figcaption>
              <img src={artifact.afterSrc} alt="After" className="chat-artifact-img" />
            </figure>
          ) : null}
        </div>
      </div>
    );
  }

  if (artifact.kind === "text" && artifact.text) {
    return (
      <div className="chat-artifact">
        <div className="chat-artifact-head">{artifact.title}</div>
        <pre className="chat-artifact-pre">{artifact.text}</pre>
      </div>
    );
  }

  if (artifact.kind === "table" && artifact.rows?.length) {
    return (
      <div className="chat-artifact">
        <div className="chat-artifact-head">{artifact.title}</div>
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

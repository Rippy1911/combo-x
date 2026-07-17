import { maskSecretValue } from "@combo-x/core";
import { useId, useState, type ReactNode } from "react";

export type PendingSecret = {
  id: string;
  label: string;
  value: string;
  useNote?: string;
  source: "detected" | "manual";
  include: boolean;
};

export function SecretEmbedBar({
  detectEnabled,
  onDetectEnabledChange,
  pending,
  onPendingChange,
  vaultUnlocked,
  endSlot,
}: {
  detectEnabled: boolean;
  onDetectEnabledChange: (v: boolean) => void;
  pending: PendingSecret[];
  onPendingChange: (next: PendingSecret[]) => void;
  vaultUnlocked: boolean;
  /** Right-aligned chrome (e.g. Tools picker). */
  endSlot?: ReactNode;
}) {
  const detectId = useId();
  const [manualLabel, setManualLabel] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [showManual, setShowManual] = useState(false);

  const addManual = () => {
    const label = manualLabel.trim().replace(/\s+/g, "_");
    const value = manualValue;
    if (!label || !value) return;
    onPendingChange([
      ...pending,
      {
        id: crypto.randomUUID(),
        label,
        value,
        useNote: manualNote.trim() || undefined,
        source: "manual",
        include: true,
      },
    ]);
    setManualLabel("");
    setManualValue("");
    setManualNote("");
  };

  const included = pending.filter((p) => p.include);

  return (
    <div className="secret-embed-bar">
      <div className="row wrap secret-embed-toggles">
        <span className="hint row" style={{ gap: 6, alignItems: "center" }}>
          <label className="hint row" htmlFor={detectId} style={{ gap: 6 }}>
            <input
              id={detectId}
              type="checkbox"
              checked={detectEnabled}
              onChange={(e) => onDetectEnabledChange(e.target.checked)}
            />
            Detect secrets
          </label>
          <span
            className="secret-detect-help"
            title="Paste keys/passwords — suggestions appear here. On Send they go into the vault and the message uses {vault:label}."
            aria-label="Paste keys/passwords — suggestions appear here. On Send they go into the vault and the message uses {vault:label}."
            tabIndex={0}
          >
            ?
          </span>
        </span>
        <button type="button" className="msg-action" onClick={() => setShowManual((v) => !v)}>
          {showManual ? "Hide secret form" : "Add secret…"}
        </button>
        {!vaultUnlocked ? (
          <span className="hint">Unlock vault to embed on send</span>
        ) : included.length > 0 ? (
          <span className="hint">{included.length} to embed on send</span>
        ) : null}
        {endSlot ? <div className="secret-embed-end">{endSlot}</div> : null}
      </div>

      {showManual ? (
        <div className="secret-manual-form">
          <input
            value={manualLabel}
            onChange={(e) => setManualLabel(e.target.value)}
            placeholder="label (e.g. foodwell_password)"
            spellCheck={false}
          />
          <input
            type="password"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="secret value"
            autoComplete="off"
          />
          <input
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
            placeholder="use note (optional)"
          />
          <button
            type="button"
            className="primary"
            disabled={!manualLabel.trim() || !manualValue}
            onClick={addManual}
          >
            Queue
          </button>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <ul className="list secret-pending-list">
          {pending.map((p) => (
            <li key={p.id} className="secret-pending-row">
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={p.include}
                  onChange={(e) =>
                    onPendingChange(
                      pending.map((x) =>
                        x.id === p.id ? { ...x, include: e.target.checked } : x,
                      ),
                    )
                  }
                />
                <span className="hint">{p.source === "detected" ? "auto" : "manual"}</span>
              </label>
              <input
                className="secret-label-input"
                value={p.label}
                spellCheck={false}
                onChange={(e) =>
                  onPendingChange(
                    pending.map((x) =>
                      x.id === p.id ? { ...x, label: e.target.value.replace(/\s+/g, "_") } : x,
                    ),
                  )
                }
                title="Vault label"
              />
              <code className="secret-mask" title="Value (masked)">
                {maskSecretValue(p.value)}
              </code>
              <input
                className="secret-note-input"
                value={p.useNote ?? ""}
                placeholder="use…"
                onChange={(e) =>
                  onPendingChange(
                    pending.map((x) =>
                      x.id === p.id ? { ...x, useNote: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="msg-action dangerish"
                aria-label="Dismiss"
                onClick={() => onPendingChange(pending.filter((x) => x.id !== p.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

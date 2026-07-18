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

function emptyManualRow(): PendingSecret {
  return {
    id: crypto.randomUUID(),
    label: "",
    value: "",
    useNote: "",
    source: "manual",
    include: true,
  };
}

/** Keep a blank trailing manual row for “+” UX. */
function ensureTrailingEmpty(list: PendingSecret[]): PendingSecret[] {
  const manuals = list.filter((p) => p.source === "manual");
  const last = manuals[manuals.length - 1];
  if (last && !last.label.trim() && !last.value) return list;
  return [...list, emptyManualRow()];
}

function stripEmptyManuals(list: PendingSecret[]): PendingSecret[] {
  return list.filter(
    (p) => p.source !== "manual" || (p.label.trim().length > 0 && p.value.length > 0),
  );
}

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
  const [showManual, setShowManual] = useState(false);

  const manualRows = pending.filter((p) => p.source === "manual");
  const detectedRows = pending.filter((p) => p.source === "detected");
  const readyCount = pending.filter(
    (p) => p.include && p.label.trim() && p.value,
  ).length;

  const patchManual = (id: string, patch: Partial<PendingSecret>) => {
    onPendingChange(pending.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const removeRow = (id: string) => {
    const next = pending.filter((x) => x.id !== id);
    onPendingChange(showManual ? ensureTrailingEmpty(next) : next);
  };

  const addRow = () => {
    onPendingChange(ensureTrailingEmpty([...pending, emptyManualRow()]));
  };

  const toggleForm = () => {
    if (showManual) {
      setShowManual(false);
      onPendingChange(stripEmptyManuals(pending));
    } else {
      setShowManual(true);
      onPendingChange(ensureTrailingEmpty(pending));
    }
  };

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
            title="Paste keys/passwords — suggestions appear here. Filled rows embed into the vault on Send as {vault:label}."
            aria-label="Paste keys/passwords — suggestions appear here. Filled rows embed into the vault on Send as {vault:label}."
            tabIndex={0}
          >
            ?
          </span>
        </span>
        <button type="button" className="msg-action" onClick={toggleForm}>
          {showManual ? "Hide secret form" : "Add secret…"}
        </button>
        {!vaultUnlocked ? (
          <span className="hint">Unlock vault to embed on send</span>
        ) : readyCount > 0 ? (
          <span className="hint">{readyCount} to embed on send</span>
        ) : showManual ? (
          <span className="hint">Filled rows embed on Send</span>
        ) : null}
        {endSlot ? <div className="secret-embed-end">{endSlot}</div> : null}
      </div>

      {showManual ? (
        <div className="secret-manual-rows" role="list">
          {manualRows.map((row, idx) => {
            const isLast = idx === manualRows.length - 1;
            return (
              <div key={row.id} className="secret-manual-row" role="listitem">
                <div className="secret-manual-row-fields">
                  <input
                    value={row.label}
                    onChange={(e) =>
                      patchManual(row.id, {
                        label: e.target.value.replace(/\s+/g, "_"),
                      })
                    }
                    placeholder="label (e.g. foodwell_password)"
                    spellCheck={false}
                    aria-label="Vault label"
                  />
                  <input
                    type="password"
                    value={row.value}
                    onChange={(e) => patchManual(row.id, { value: e.target.value })}
                    placeholder="secret value"
                    autoComplete="off"
                    aria-label="Secret value"
                  />
                  <input
                    value={row.useNote ?? ""}
                    onChange={(e) =>
                      patchManual(row.id, { useNote: e.target.value })
                    }
                    placeholder="use note (optional)"
                    aria-label="Use note"
                  />
                </div>
                {isLast ? (
                  <button
                    type="button"
                    className="secret-row-icon"
                    aria-label="Add secret row"
                    title="Add row"
                    onClick={addRow}
                  >
                    ＋
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secret-row-icon dangerish"
                    aria-label="Remove secret row"
                    title="Remove"
                    onClick={() => removeRow(row.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Detected (and filled manuals when form hidden) — compact chips */}
      {(showManual ? detectedRows : pending.filter((p) => p.label.trim() && p.value))
        .length > 0 ? (
        <ul className="list secret-pending-list">
          {(showManual
            ? detectedRows
            : pending.filter((p) => p.label.trim() && p.value)
          ).map((p) => (
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
                      x.id === p.id
                        ? { ...x, label: e.target.value.replace(/\s+/g, "_") }
                        : x,
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

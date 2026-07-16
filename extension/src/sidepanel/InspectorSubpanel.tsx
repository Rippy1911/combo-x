import { INSPECTABLE_DBS, inspectStore } from "@combo-x/core";
import { useMemo, useState } from "react";

export function InspectorSubpanel() {
  const [advanced, setAdvanced] = useState(false);
  const [inspDb, setInspDb] = useState(INSPECTABLE_DBS[0]!.name);
  const [inspStore, setInspStore] = useState(INSPECTABLE_DBS[0]!.stores[0]!);
  const [inspRows, setInspRows] = useState<Array<{ key: string; summary: string }>>([]);

  const storesForDb = useMemo(
    () => INSPECTABLE_DBS.find((d) => d.name === inspDb)?.stores ?? [],
    [inspDb],
  );

  const runInspect = async () => {
    setAdvanced(true);
    const rows = await inspectStore(inspDb, inspStore, 40);
    setInspRows(rows.map((r) => ({ key: String(r.key), summary: r.summary })));
  };

  return (
    <div className="lib-section">
      <p className="hint wrap">
        Read-only IDB browser. Vault values are never decrypted here — labels/ciphertext only.
      </p>
      <label className="hint">
        <input
          type="checkbox"
          checked={advanced}
          onChange={(e) => setAdvanced(e.target.checked)}
        />{" "}
        Enable Advanced inspector
      </label>
      {advanced ? (
        <>
          <div className="row">
            <select
              value={inspDb}
              onChange={(e) => {
                setInspDb(e.target.value);
                const stores =
                  INSPECTABLE_DBS.find((d) => d.name === e.target.value)?.stores ?? [];
                setInspStore(stores[0] ?? "");
              }}
            >
              {INSPECTABLE_DBS.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                  {d.redactValues ? " (redacted)" : ""}
                </option>
              ))}
            </select>
            <select value={inspStore} onChange={(e) => setInspStore(e.target.value)}>
              {storesForDb.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button type="button" className="primary" onClick={() => void runInspect()}>
              Load
            </button>
          </div>
          <ul className="list">
            {inspRows.map((r) => (
              <li key={r.key}>
                <code>{r.key}</code>
                <div className="hint wrap">{r.summary}</div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="hint">Check Advanced to browse object stores.</p>
      )}
    </div>
  );
}

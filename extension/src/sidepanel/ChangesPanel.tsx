import { ChangeLogStore, type ChangeLogEntry } from "@combo-x/core";
import { useCallback, useEffect, useState } from "react";

export function ChangesPanel({
  changeLog,
  active = true,
}: {
  changeLog: ChangeLogStore;
  active?: boolean;
}) {
  const [rows, setRows] = useState<ChangeLogEntry[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    setRows(await changeLog.list(100));
  }, [changeLog]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [active, refresh]);

  return (
    <div className="panel">
      <h2>Changes</h2>
      <p className="hint wrap">
        Table deltas from agent tools (upsert / scrape). Shows additions, updates, and removals per
        view.
      </p>
      <div className="row">
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
        <button
          type="button"
          className="dangerish"
          onClick={() =>
            void (async () => {
              if (!window.confirm("Clear change log?")) return;
              await changeLog.clear();
              setMsg("Cleared");
              await refresh();
            })()
          }
        >
          Clear log
        </button>
      </div>
      {msg ? <p className="hint">{msg}</p> : null}
      {rows.length === 0 ? (
        <p className="hint">No table changes yet — run a scrape or upsert_scrape_rows.</p>
      ) : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="change-row">
              <strong>
                [{r.op}] {r.viewName}
              </strong>
              <div className="hint">
                +{r.added} · ~{r.updated} · −{r.removed}
                {r.sourceTool ? ` · ${r.sourceTool}` : ""}
              </div>
              {r.sampleKeys?.length ? (
                <div className="hint mono-id">keys: {r.sampleKeys.join(", ")}</div>
              ) : null}
              <div className="hint">{new Date(r.at).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

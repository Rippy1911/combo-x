import {
  ActionLogStore,
  type ActionLogEntry,
} from "@combo-x/core";
import { useCallback, useEffect, useState } from "react";

export function ActivityPanel({
  actionLog,
  onExport,
}: {
  actionLog: ActionLogStore;
  onExport: (filename: string, text: string, mime: string) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<ActionLogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const list = await actionLog.list(200, toolFilter.trim() ? { tool: toolFilter.trim() } : undefined);
    setRows(list);
  }, [actionLog, toolFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = filter.trim()
    ? rows.filter((r) => {
        const hay = `${r.tool} ${r.pageUrl ?? ""} ${r.targetUrl ?? ""} ${r.pageTitle ?? ""} ${r.approvalDecision} ${r.resultSummary}`.toLowerCase();
        return hay.includes(filter.trim().toLowerCase());
      })
    : rows;

  return (
    <div className="panel activity-panel">
      <h2>Activity</h2>
      <p className="hint">
        Every AI tool call with approval, timestamp, and page URL. Secrets in args are redacted.
      </p>
      <div className="row data-table-toolbar">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter text…"
        />
        <input
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          placeholder="Tool name…"
          style={{ maxWidth: 120 }}
        />
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
        <button
          type="button"
          onClick={() =>
            void (async () => {
              const json = await actionLog.exportJson(500);
              await onExport(`combo-x-activity-${Date.now()}.json`, json, "application/json");
              setMsg("Exported JSON");
            })()
          }
        >
          Export JSON
        </button>
        <button
          type="button"
          className="danger"
          onClick={() =>
            void (async () => {
              if (!confirm("Clear all activity logs on this device?")) return;
              await actionLog.clear();
              await refresh();
              setMsg("Cleared");
            })()
          }
        >
          Clear
        </button>
      </div>
      {msg ? <p className="hint">{msg}</p> : null}
      <div className="activity-list">
        {filtered.length === 0 ? (
          <p className="hint">No actions logged yet — run the agent in Chat.</p>
        ) : (
          filtered.map((r) => (
            <details key={r.id} className="activity-row">
              <summary>
                <span className={`activity-ok ${r.ok ? "ok" : "bad"}`}>{r.ok ? "OK" : "ERR"}</span>
                <code className="activity-tool">{r.tool}</code>
                <span className="activity-appr">{r.approvalDecision}</span>
                <span className="hint activity-time">
                  {new Date(r.at).toLocaleString()}
                </span>
              </summary>
              <dl className="activity-meta">
                <div>
                  <dt>Mode</dt>
                  <dd>{r.approvalMode}</dd>
                </div>
                {r.pageUrl ? (
                  <div>
                    <dt>Page</dt>
                    <dd title={r.pageTitle ?? ""}>{r.pageUrl}</dd>
                  </div>
                ) : null}
                {r.targetUrl ? (
                  <div>
                    <dt>Target</dt>
                    <dd>{r.targetUrl}</dd>
                  </div>
                ) : null}
                {r.sessionId ? (
                  <div>
                    <dt>Session</dt>
                    <dd>
                      <code>{r.sessionId.slice(0, 8)}…</code>
                    </dd>
                  </div>
                ) : null}
                {r.runId ? (
                  <div>
                    <dt>Run</dt>
                    <dd>
                      <code>{r.runId.slice(0, 8)}…</code>
                    </dd>
                  </div>
                ) : null}
                {r.error ? (
                  <div>
                    <dt>Error</dt>
                    <dd>{r.error}</dd>
                  </div>
                ) : null}
              </dl>
              <pre className="activity-pre">{JSON.stringify(r.args, null, 2).slice(0, 2000)}</pre>
              <pre className="activity-pre hint">{r.resultSummary}</pre>
            </details>
          ))
        )}
      </div>
    </div>
  );
}

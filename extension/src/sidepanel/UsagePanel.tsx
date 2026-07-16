import {
  UsageStore,
  type UsageAggregateRow,
  type UsageEvent,
  type UsageTotals,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function shortModel(key: string): string {
  const slash = key.indexOf("/");
  return slash > 0 ? key.slice(slash + 1) : key;
}

function BarChart({
  rows,
  mode,
  title,
}: {
  rows: UsageAggregateRow[];
  mode: "tokens" | "spend";
  title: string;
}) {
  const max = Math.max(
    ...rows.map((r) => (mode === "tokens" ? r.totalTokens : r.estimatedCostUsd)),
    1,
  );
  const colors = ["#3dffa8", "#5b9bd5", "#e6b800", "#c77dff", "#ff6b6b", "#8b9bb0"];

  if (!rows.length) {
    return (
      <div className="usage-chart">
        <h3>{title}</h3>
        <p className="hint">No data yet — run the agent in Chat.</p>
      </div>
    );
  }

  return (
    <div className="usage-chart">
      <h3>{title}</h3>
      <svg className="usage-bars" viewBox={`0 0 320 ${rows.length * 28 + 8}`} role="img">
        {rows.slice(0, 12).map((row, i) => {
          const value = mode === "tokens" ? row.totalTokens : row.estimatedCostUsd;
          const width = Math.max(4, (value / max) * 220);
          const y = i * 28 + 4;
          const label = shortModel(row.key);
          return (
            <g key={row.key}>
              <text x={0} y={y + 14} className="usage-bar-label">
                {label.length > 18 ? `${label.slice(0, 16)}…` : label}
              </text>
              <rect
                x={100}
                y={y}
                width={width}
                height={18}
                rx={3}
                fill={colors[i % colors.length]}
                opacity={0.85}
              />
              <text x={100 + width + 6} y={y + 13} className="usage-bar-value">
                {mode === "tokens" ? formatTokens(value) : formatUsd(value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function UsagePanel({
  usageStore,
  sessionId,
  sessionFilter,
  onSessionFilterChange,
  onExport,
}: {
  usageStore: UsageStore;
  sessionId?: string;
  sessionFilter: "all" | "session";
  onSessionFilterChange: (v: "all" | "session") => void;
  onExport: (filename: string, text: string, mime: string) => void | Promise<void>;
}) {
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [byModel, setByModel] = useState<UsageAggregateRow[]>([]);
  const [byProvider, setByProvider] = useState<UsageAggregateRow[]>([]);
  const [kinds, setKinds] = useState({ llm: 0, tool: 0, message: 0 });
  const [msg, setMsg] = useState("");

  const listOpts = useMemo(
    () => (sessionFilter === "session" && sessionId ? { sessionId } : {}),
    [sessionFilter, sessionId],
  );

  const refresh = useCallback(async () => {
    const [t, model, provider, events] = await Promise.all([
      usageStore.totals(listOpts),
      usageStore.aggregateByModel(listOpts),
      usageStore.aggregateByProvider(listOpts),
      usageStore.list({ ...listOpts, limit: 5000 }),
    ]);
    setTotals(t);
    setByModel(model);
    setByProvider(provider);
    const counts = { llm: 0, tool: 0, message: 0 };
    for (const e of events) {
      if (e.kind === "llm") counts.llm += 1;
      else if (e.kind === "tool") counts.tool += 1;
      else if (e.kind === "message") counts.message += 1;
    }
    setKinds(counts);
  }, [listOpts, usageStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="panel usage-panel">
      <h2>Usage</h2>
      <p className="hint">
        Cross-session token/cost telemetry. Inspired by OpenRouter analytics — local IndexedDB only.
      </p>
      <div className="row data-table-toolbar">
        <label className="usage-filter">
          <input
            type="radio"
            name="usage-scope"
            checked={sessionFilter === "all"}
            onChange={() => onSessionFilterChange("all")}
          />
          All sessions
        </label>
        <label className="usage-filter">
          <input
            type="radio"
            name="usage-scope"
            checked={sessionFilter === "session"}
            disabled={!sessionId}
            onChange={() => onSessionFilterChange("session")}
          />
          Current session
        </label>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
        <button
          type="button"
          onClick={() =>
            void (async () => {
              const events: UsageEvent[] = await usageStore.list({ ...listOpts, limit: 10_000 });
              await onExport(
                `combo-x-usage-${Date.now()}.json`,
                JSON.stringify({ exportedAt: new Date().toISOString(), events }, null, 2),
                "application/json",
              );
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
              if (!confirm("Clear all usage telemetry on this device?")) return;
              await usageStore.clear();
              await refresh();
              setMsg("Cleared");
            })()
          }
        >
          Clear
        </button>
      </div>
      {msg ? <p className="hint">{msg}</p> : null}

      <div className="usage-kpis">
        <div className="usage-kpi">
          <span className="usage-kpi-label">Spend</span>
          <span className="usage-kpi-value">{formatUsd(totals?.estimatedCostUsd ?? 0)}</span>
        </div>
        <div className="usage-kpi">
          <span className="usage-kpi-label">LLM requests</span>
          <span className="usage-kpi-value">{kinds.llm}</span>
        </div>
        <div className="usage-kpi">
          <span className="usage-kpi-label">Tokens</span>
          <span className="usage-kpi-value">{formatTokens(totals?.totalTokens ?? 0)}</span>
        </div>
        <div className="usage-kpi">
          <span className="usage-kpi-label">Tool actions</span>
          <span className="usage-kpi-value">{kinds.tool}</span>
        </div>
        <div className="usage-kpi">
          <span className="usage-kpi-label">Messages</span>
          <span className="usage-kpi-value">{kinds.message}</span>
        </div>
      </div>

      <BarChart rows={byModel} mode="tokens" title="Tokens by model" />
      <BarChart rows={byProvider} mode="spend" title="Spend by provider" />
    </div>
  );
}

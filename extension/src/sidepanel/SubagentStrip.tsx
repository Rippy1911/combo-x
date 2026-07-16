export type SubagentRun = {
  id: string;
  goal: string;
  status: "running" | "done";
  summary?: string;
  ok?: boolean;
  messages?: Array<{ tool: string; status?: string }>;
};

export function SubagentStrip({ runs }: { runs: SubagentRun[] }) {
  if (!runs.length) return null;

  return (
    <div className="subagent-strip">
      {runs.map((run) => (
        <details
          key={run.id}
          className={`subagent-card${run.status === "running" ? " subagent-running" : ""}`}
          open={run.status === "running"}
        >
          <summary>
            <span className={`subagent-badge${run.ok === false ? " bad" : run.status === "done" ? " ok" : ""}`}>
              {run.status === "running" ? "RUN" : run.ok === false ? "ERR" : "OK"}
            </span>
            <span className="subagent-goal">{run.goal}</span>
            {run.summary ? <span className="hint subagent-summary">{run.summary.slice(0, 80)}</span> : null}
          </summary>
          <div className="subagent-body">
            {run.summary ? <p className="subagent-full-summary">{run.summary}</p> : null}
            {run.messages && run.messages.length > 0 ? (
              <div className="subagent-tools">
                {run.messages.map((m, i) => (
                  <span key={`${m.tool}-${i}`} className={`subagent-tool-chip${m.status === "running" ? " running" : ""}`}>
                    {m.tool}
                  </span>
                ))}
              </div>
            ) : run.status === "running" ? (
              <p className="hint">Child agent working…</p>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

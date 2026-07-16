import { useState } from "react";

export interface ToolChipData {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "done" | "denied" | "error";
}

export function ToolChip({ tool }: { tool: ToolChipData }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`chip chip-${tool.status}`}>
      <button type="button" className="chip-head" onClick={() => setOpen((v) => !v)}>
        <span className="chip-name">{tool.name}</span>
        <span className="chip-status">{tool.status}</span>
        <span className="chip-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <pre className="chip-body">
          {JSON.stringify({ args: tool.args, result: tool.result }, null, 2).slice(0, 4000)}
        </pre>
      ) : null}
    </div>
  );
}

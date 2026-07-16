import { useState } from "react";
import type { PreviewPayload } from "./PreviewDrawer";
import { buildPreviewFromTool } from "./PreviewDrawer";

export interface ToolChipData {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "done" | "denied" | "error";
}

export function ToolChip({
  tool,
  onPreview,
}: {
  tool: ToolChipData;
  onPreview?: (p: PreviewPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const preview =
    tool.status === "done" && tool.result != null
      ? buildPreviewFromTool(tool.name, tool.result)
      : null;

  return (
    <div className={`chip chip-${tool.status}`}>
      <button type="button" className="chip-head" onClick={() => setOpen((v) => !v)}>
        <span className="chip-name">{tool.name}</span>
        <span className="chip-status">{tool.status}</span>
        <span className="chip-caret">{open ? "▾" : "▸"}</span>
      </button>
      {preview && onPreview ? (
        <button
          type="button"
          className="chip-preview"
          onClick={() => onPreview(preview)}
        >
          Preview
        </button>
      ) : null}
      {open ? (
        <pre className="chip-body">
          {JSON.stringify({ args: tool.args, result: tool.result }, null, 2).slice(0, 4000)}
        </pre>
      ) : null}
    </div>
  );
}

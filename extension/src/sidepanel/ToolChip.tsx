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

function hasResolvablePreview(result: unknown): boolean {
  if (result == null || typeof result !== "object") return false;
  const obj = result as Record<string, unknown>;
  if (typeof obj.dataUrl === "string" && obj.dataUrl.startsWith("data:image/")) return true;
  if (typeof obj.attachmentId === "string") return true;
  if (Array.isArray(obj.rows) && obj.rows.length) return true;
  if ("hits" in obj || "content" in obj) return true;
  return false;
}

export function ToolChip({
  tool,
  onPreview,
  onPreviewTool,
}: {
  tool: ToolChipData;
  onPreview?: (p: PreviewPayload) => void;
  /** Prefer this for vision stubs (attachmentId → AttachmentStore). */
  onPreviewTool?: (tool: ToolChipData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const preview =
    tool.status === "done" && tool.result != null
      ? buildPreviewFromTool(tool.name, tool.result)
      : null;
  const canPreview =
    tool.status === "done" &&
    (Boolean(preview?.body) || hasResolvablePreview(tool.result));

  return (
    <div className={`chip chip-${tool.status}`}>
      <button type="button" className="chip-head" onClick={() => setOpen((v) => !v)}>
        <span className="chip-name">{tool.name}</span>
        <span className="chip-status">{tool.status}</span>
        <span className="chip-caret">{open ? "▾" : "▸"}</span>
      </button>
      {canPreview && (onPreviewTool || onPreview) ? (
        <button
          type="button"
          className="chip-preview"
          onClick={() => {
            if (onPreviewTool) void onPreviewTool(tool);
            else if (preview && onPreview) onPreview(preview);
          }}
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

import { chatArtifactSandbox } from "@combo-x/core";
import { MarkdownView } from "./MarkdownView";
import { DataTable } from "./DataTable";
import { canOpenPreviewInNewTab, openPreviewInNewTab } from "./openPreviewTab";
import {
  parseCsv,
  rowsFromMarkdownTables,
  stashTableForViews,
} from "./tableHelpers";

export type PreviewPayload = {
  title: string;
  kind: "table" | "csv" | "json" | "text" | "markdown" | "image" | "html" | "compare";
  body: string;
  rows?: string[][];
  html?: string;
  beforeSrc?: string;
  afterSrc?: string;
  interactive?: boolean;
};

export { parseCsv, rowsFromMarkdownTables };

function coerceRows(raw: unknown): string[][] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]));
}

export function buildPreviewFromTool(
  name: string,
  result: unknown,
): PreviewPayload | null {
  if (result == null) return null;

  if (typeof result === "object" && result) {
    const obj = result as Record<string, unknown>;
    // Top-level rows (scrape_catalog, scrape_tables)
    let rows = coerceRows(obj.rows);
    // parse_data nests under data.rows
    if (!rows && obj.data && typeof obj.data === "object") {
      rows = coerceRows((obj.data as { rows?: unknown }).rows);
    }
    if (rows?.length) {
      // Ensure header if first row looks like objects was flattened already
      return {
        title: `${name} · ${rows.length} rows`,
        kind: "table",
        body: rows.map((r) => r.join("\t")).join("\n"),
        rows,
      };
    }
  }

  if (typeof result === "object" && result && "hits" in result) {
    return {
      title: `${name} · hits`,
      kind: "json",
      body: JSON.stringify(result, null, 2).slice(0, 80_000),
    };
  }
  if (typeof result === "object" && result) {
    const obj = result as Record<string, unknown>;
    const dataUrl = typeof obj.dataUrl === "string" ? obj.dataUrl : "";
    if (dataUrl.startsWith("data:image/")) {
      return { title: name, kind: "image", body: dataUrl };
    }
  }
  if (typeof result === "object" && result && "content" in result) {
    const content = String((result as { content: unknown }).content ?? "");
    if (content.startsWith("data:image/")) {
      return { title: name, kind: "image", body: content };
    }
    return { title: name, kind: "text", body: content.slice(0, 80_000) };
  }
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (name.includes("csv") || /^[\w" ].*,.*\n/.test(text)) {
    return { title: name, kind: "csv", body: text.slice(0, 80_000) };
  }
  return { title: name, kind: "json", body: text.slice(0, 80_000) };
}

export function buildPreviewFromMarkdown(md: string): PreviewPayload | null {
  const rows = rowsFromMarkdownTables(md);
  if (rows) {
    return {
      title: `Table · ${rows.length} rows`,
      kind: "table",
      body: md,
      rows,
    };
  }
  if (md.trim().length > 40) {
    return { title: "Message", kind: "markdown", body: md };
  }
  return null;
}

export function buildPreviewFromAttachment(a: {
  name: string;
  kind: string;
  text?: string;
  dataUrl?: string;
}): PreviewPayload {
  if (a.kind === "image" && a.dataUrl) {
    return { title: a.name, kind: "image", body: a.dataUrl };
  }
  if (a.kind === "csv" || a.name.endsWith(".csv")) {
    return { title: a.name, kind: "csv", body: a.text ?? "" };
  }
  return {
    title: a.name,
    kind: a.kind === "md" ? "markdown" : "text",
    body: a.text ?? "(empty)",
  };
}

export function PreviewDrawer({
  preview,
  onClose,
  onExport,
  onGoViews,
}: {
  preview: PreviewPayload | null;
  onClose: () => void;
  onExport?: (filename: string, text: string, mime: string) => void | Promise<void>;
  onGoViews?: () => void;
}) {
  if (!preview) return null;

  let rows = preview.rows;
  if (!rows && preview.kind === "csv") rows = parseCsv(preview.body);

  const openable = canOpenPreviewInNewTab(preview);

  return (
    <div className="preview-drawer" role="dialog" aria-label="Preview">
      <div className="preview-head">
        <strong className="preview-title">{preview.title}</strong>
        <div className="preview-head-actions">
          {openable ? (
            <button
              type="button"
              title="Open in a full browser tab for fullscreen inspect"
              onClick={() => {
                if (!openPreviewInNewTab(preview)) {
                  window.alert("Pop-up blocked — allow pop-ups for this extension.");
                }
              }}
            >
              Open tab
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="preview-body">
        {preview.kind === "image" && preview.body ? (
          <img src={preview.body} alt={preview.title} className="preview-img" />
        ) : null}
        {preview.kind === "html" && preview.html ? (
          <iframe
            title={preview.title}
            srcDoc={preview.html}
            sandbox={chatArtifactSandbox(Boolean(preview.interactive))}
            className="preview-html-frame"
          />
        ) : null}
        {preview.kind === "compare" ? (
          <div className="preview-compare">
            {preview.beforeSrc ? (
              <img src={preview.beforeSrc} alt="Before" className="preview-img" />
            ) : null}
            {preview.afterSrc ? (
              <img src={preview.afterSrc} alt="After" className="preview-img" />
            ) : null}
          </div>
        ) : null}
        {rows && rows.length > 0 ? (
          <DataTable
            rows={rows}
            title={preview.title}
            onExport={onExport}
            onOpenInViews={(t, r) => {
              stashTableForViews(t, r);
              onGoViews?.();
            }}
          />
        ) : null}
        {!rows && preview.kind === "markdown" ? (
          <MarkdownView content={preview.body} />
        ) : null}
        {!rows && (preview.kind === "json" || preview.kind === "text") ? (
          <pre className="preview-pre">{preview.body}</pre>
        ) : null}
      </div>
    </div>
  );
}

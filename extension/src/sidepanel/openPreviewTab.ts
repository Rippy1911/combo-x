/**
 * Open preview content in a real browser tab for fullscreen inspect.
 * Uses blob: URLs (revoked after a delay) so large HTML/images stay out of history.
 */

export type OpenablePreview = {
  title: string;
  kind: string;
  body?: string;
  html?: string;
  beforeSrc?: string;
  afterSrc?: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapHtmlDocument(title: string, bodyInner: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  html,body{margin:0;min-height:100%;background:#0b0f14;color:#e8eef6;font:14px/1.45 system-ui,sans-serif}
  header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#111827;border-bottom:1px solid #243041}
  header h1{margin:0;font-size:14px;font-weight:600}
  main{padding:0}
  img{max-width:100%;height:auto;display:block}
  .compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}
  .compare figure{margin:0}
  .compare figcaption{font-size:11px;opacity:.7;padding:4px 0}
  pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,monospace}
</style></head><body>
<header><h1>${esc(title)}</h1><span style="opacity:.6;font-size:11px">Combo-X preview</span></header>
<main>${bodyInner}</main>
</body></html>`;
}

/** Build a self-contained HTML document for the preview payload. */
export function previewToHtmlDocument(p: OpenablePreview): string | null {
  if (p.kind === "html" && p.html) {
    // If payload already looks like a full document, use as-is (has its own chrome).
    const trimmed = p.html.trim();
    if (/^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
      return trimmed;
    }
    return wrapHtmlDocument(p.title, p.html);
  }
  if (p.kind === "image" && p.body?.startsWith("data:image/")) {
    return wrapHtmlDocument(
      p.title,
      `<img src="${esc(p.body)}" alt="${esc(p.title)}"/>`,
    );
  }
  if (p.kind === "compare" && (p.beforeSrc || p.afterSrc)) {
    const before = p.beforeSrc
      ? `<figure><figcaption>Before</figcaption><img src="${esc(p.beforeSrc)}" alt="Before"/></figure>`
      : "";
    const after = p.afterSrc
      ? `<figure><figcaption>After</figcaption><img src="${esc(p.afterSrc)}" alt="After"/></figure>`
      : "";
    return wrapHtmlDocument(p.title, `<div class="compare">${before}${after}</div>`);
  }
  if (
    (p.kind === "text" || p.kind === "json" || p.kind === "markdown" || p.kind === "csv") &&
    p.body
  ) {
    return wrapHtmlDocument(p.title, `<pre>${esc(p.body)}</pre>`);
  }
  return null;
}

export function openPreviewInNewTab(p: OpenablePreview): boolean {
  const doc = previewToHtmlDocument(p);
  if (!doc) return false;
  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  // Revoke after the tab has a chance to load the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export function canOpenPreviewInNewTab(p: OpenablePreview): boolean {
  return previewToHtmlDocument(p) != null;
}

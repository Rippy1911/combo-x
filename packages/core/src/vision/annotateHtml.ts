/**
 * Build a sandboxed HTML overlay for screenshot callouts (percent coords 0–100).
 */

export type AnnotateMarker = {
  x: number;
  y: number;
  label: string;
  note?: string;
};

export type AnnotateHighlight = {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
};

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Reject data URLs that are absurdly large for srcDoc (keep under ~1.2MB chars). */
export function isSafeDataUrlForSrcDoc(src: string): boolean {
  return src.startsWith("data:image/") && src.length <= 1_200_000;
}

export function buildAnnotateScreenshotHtml(input: {
  title: string;
  src: string;
  markers?: AnnotateMarker[];
  highlights?: AnnotateHighlight[];
}): string {
  const markers = (input.markers ?? []).slice(0, 40);
  const highlights = (input.highlights ?? []).slice(0, 20);
  const markerHtml = markers
    .map((m, i) => {
      const x = clampPct(m.x);
      const y = clampPct(m.y);
      const label = esc(String(m.label || String(i + 1)));
      const note = m.note ? esc(String(m.note).slice(0, 240)) : "";
      const titleAttr = note ? ` title="${note}"` : "";
      return `<button type="button" class="m" style="left:${x}%;top:${y}%"${titleAttr}><span>${label}</span>${
        note ? `<em>${note}</em>` : ""
      }</button>`;
    })
    .join("");
  const hlHtml = highlights
    .map((h) => {
      const x = clampPct(h.x);
      const y = clampPct(h.y);
      const w = clampPct(h.w);
      const ht = clampPct(h.h);
      const label = h.label ? esc(String(h.label).slice(0, 40)) : "";
      return `<div class="hl" style="left:${x}%;top:${y}%;width:${w}%;height:${ht}%">${
        label ? `<span>${label}</span>` : ""
      }</div>`;
    })
    .join("");

  // Title lives in ChatArtifact / PreviewDrawer — omit inner <h1> to avoid duplicates.
  // Findings use a custom list (not <ol>) so labels like "1" aren't numbered twice.
  const findings = markers
    .map((m, i) => {
      const label = String(m.label || String(i + 1)).trim();
      const note = (m.note ?? "").trim();
      const badge = esc(label);
      // If label is bare "1"/"2" and note exists, show note only once after badge.
      const bareNum = /^\d+$/.test(label);
      const text = note
        ? esc(note.slice(0, 240))
        : bareNum
          ? ""
          : esc(label);
      return `<li><span class="n">${badge}</span>${text ? ` ${text}` : ""}</li>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${esc(input.title)}</title><style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 12px/1.35 ui-sans-serif, system-ui, sans-serif; background: #0b0f14; color: #e8eef6; }
  .stage { position: relative; width: 100%; overflow: hidden; background: #111827; }
  .stage img { display: block; width: 100%; height: auto; }
  .hl { position: absolute; border: 2px solid #34d399; background: rgba(52,211,153,.12); box-sizing: border-box; pointer-events: none; }
  .hl span { position: absolute; left: 0; top: 0; transform: translateY(-100%); background: #065f46; color: #ecfdf5; padding: 1px 5px; font-size: 10px; }
  .m { position: absolute; transform: translate(-50%,-50%); border: none; padding: 0; background: transparent; cursor: default; }
  .m span { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: #ef4444; color: #fff; font-weight: 700; font-size: 11px; box-shadow: 0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.45); }
  .m em { display: none; position: absolute; left: 50%; top: 26px; transform: translateX(-50%); min-width: 120px; max-width: 220px; padding: 6px 8px; border-radius: 8px; background: #111827; border: 1px solid #334155; color: #e2e8f0; font-style: normal; font-size: 11px; z-index: 2; }
  .m:hover em, .m:focus em { display: block; }
  ul.findings { list-style: none; margin: 0; padding: 8px 10px 12px; color: #94a3b8; }
  ul.findings li { display: flex; gap: 8px; align-items: flex-start; margin: 5px 0; }
  ul.findings .n { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #ef4444; color: #fff; font-weight: 700; font-size: 11px; }
</style></head><body>
  <div class="stage">
    <img src="${esc(input.src)}" alt="${esc(input.title)}"/>
    ${hlHtml}
    ${markerHtml}
  </div>
  ${findings ? `<ul class="findings">${findings}</ul>` : ""}
</body></html>`;
}

const CSS_MAX = 20_000;

/** Validate ephemeral preview CSS (size + no remote loads). */
export function validatePreviewCss(css: string): { ok: true; css: string } | { ok: false; error: string } {
  const trimmed = css.trim();
  if (!trimmed) return { ok: false, error: "css required" };
  if (trimmed.length > CSS_MAX) return { ok: false, error: `css too large (max ${CSS_MAX} chars)` };
  if (/@import\b/i.test(trimmed)) return { ok: false, error: "@import not allowed" };
  if (/url\s*\(\s*['"]?\s*https?:/i.test(trimmed)) {
    return { ok: false, error: "remote url() not allowed" };
  }
  if (/expression\s*\(/i.test(trimmed) || /behavior\s*:/i.test(trimmed)) {
    return { ok: false, error: "unsafe CSS construct" };
  }
  return { ok: true, css: trimmed };
}

export const PREVIEW_STYLE_ID = "combo-x-css-preview";

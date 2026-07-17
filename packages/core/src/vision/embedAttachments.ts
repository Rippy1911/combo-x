/**
 * Resolve attachment:<uuid> / combo-att:<uuid> placeholders in HTML to data:image URLs.
 */

const ATTACH_RE = /(?:attachment:|combo-att:)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function extractAttachmentPlaceholders(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(ATTACH_RE)) {
    const id = m[1]!.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Append a simple gallery when the model passes attachmentIds but no placeholders. */
export function appendAttachmentGallery(
  html: string,
  ids: string[],
  labels?: Record<string, string>,
): string {
  if (!ids.length) return html;
  const figures = ids
    .map((id, i) => {
      const label = labels?.[id] ?? `Screenshot ${i + 1}`;
      return `<figure class="combo-att-fig" id="shot-${i + 1}"><figcaption>${escAttr(label)}</figcaption><img src="attachment:${id}" alt="${escAttr(label)}" style="max-width:100%;height:auto"/></figure>`;
    })
    .join("\n");
  return `${html}\n<section class="combo-att-gallery" style="margin-top:1.5rem"><h2>Screenshots</h2>\n${figures}\n</section>`;
}

export async function embedAttachmentsInHtml(
  html: string,
  getDataUrl: (id: string) => Promise<string | null>,
  opts?: {
    /** Extra ids to gallery-append if not referenced */
    attachmentIds?: string[];
    labels?: Record<string, string>;
    maxHtmlChars?: number;
  },
): Promise<{
  html: string;
  embedded: string[];
  missing: string[];
  truncated: boolean;
}> {
  let work = html;
  const extra = (opts?.attachmentIds ?? [])
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  const placeholders = extractAttachmentPlaceholders(work);
  if (extra.length && placeholders.length === 0) {
    work = appendAttachmentGallery(work, extra, opts?.labels);
  }

  const ids = [
    ...new Set([...extractAttachmentPlaceholders(work), ...extra]),
  ];
  const embedded: string[] = [];
  const missing: string[] = [];
  const map = new Map<string, string>();

  for (const id of ids) {
    const dataUrl = await getDataUrl(id);
    if (dataUrl?.startsWith("data:image/")) {
      map.set(id, dataUrl);
      embedded.push(id);
    } else {
      missing.push(id);
    }
  }

  let out = work.replace(ATTACH_RE, (full, id: string) => {
    const resolved = map.get(id.toLowerCase());
    return resolved ?? full;
  });

  const max = opts?.maxHtmlChars ?? 2_000_000;
  let truncated = false;
  if (out.length > max) {
    out = `${out.slice(0, max)}\n<!-- truncated: html exceeded ${max} chars -->`;
    truncated = true;
  }

  return { html: out, embedded, missing, truncated };
}

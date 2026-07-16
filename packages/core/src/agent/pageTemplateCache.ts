/** Per-run cache of PDP / site page shapes so budget mode skips re-dumping chrome. */

export type PageTemplateEntry = {
  host: string;
  /** Path pattern e.g. `/p\d+$` or `/s/\d+` */
  pathKind: string;
  labelKeys: string[];
  sampleUrl: string;
  seen: number;
};

export function pathKindFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (/\/s\/\d+/i.test(path)) return "/s/{id}";
    if (/\/p\d+/i.test(path) || /-p\d+$/i.test(path)) return "/…-p{id}";
    if (/\/product\//i.test(path)) return "/product/…";
    // collapse digits
    return path.replace(/\d+/g, "{n}").slice(0, 80) || "/";
  } catch {
    return "unknown";
  }
}

export function templateKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}|${pathKindFromUrl(url)}`;
  } catch {
    return `unknown|${pathKindFromUrl(url)}`;
  }
}

export class PageTemplateCache {
  private readonly map = new Map<string, PageTemplateEntry>();

  remember(digest: {
    url?: string;
    labelHits?: Array<{ label?: string; value?: string }>;
  }): PageTemplateEntry | null {
    const url = typeof digest.url === "string" ? digest.url : "";
    if (!url) return null;
    const key = templateKey(url);
    const labelKeys = (digest.labelHits ?? [])
      .map((h) => String(h.label ?? "").slice(0, 40))
      .filter(Boolean);
    const existing = this.map.get(key);
    if (existing) {
      existing.seen += 1;
      for (const k of labelKeys) {
        if (!existing.labelKeys.includes(k)) existing.labelKeys.push(k);
      }
      return existing;
    }
    let host = "unknown";
    try {
      host = new URL(url).host;
    } catch {
      /* ignore */
    }
    const entry: PageTemplateEntry = {
      host,
      pathKind: pathKindFromUrl(url),
      labelKeys,
      sampleUrl: url,
      seen: 1,
    };
    this.map.set(key, entry);
    return entry;
  }

  annotate(digest: Record<string, unknown>): Record<string, unknown> {
    const url = typeof digest.url === "string" ? digest.url : "";
    const entry = this.remember({
      url,
      labelHits: digest.labelHits as Array<{ label?: string; value?: string }> | undefined,
    });
    if (!entry) return digest;
    if (entry.seen === 1) {
      return {
        ...digest,
        template: {
          status: "learned",
          pathKind: entry.pathKind,
          labelKeys: entry.labelKeys,
          hint: "Reuse extract/query_all for these labels on next PDPs of this shape; skip get_page.",
        },
      };
    }
    // Subsequent hits: drop bulky chrome; keep a short mainSample if fields empty
    const labelHits = Array.isArray(digest.labelHits) ? digest.labelHits : [];
    const eans = Array.isArray(digest.eans) ? digest.eans : [];
    const { mainSample, headings: _h, ...rest } = digest;
    const keepSample =
      (!labelHits.length && !eans.length && typeof mainSample === "string"
        ? mainSample.slice(0, 280)
        : undefined) ?? undefined;
    return {
      ...rest,
      ...(keepSample ? { mainSample: keepSample } : {}),
      template: {
        status: "reuse",
        pathKind: entry.pathKind,
        labelKeys: entry.labelKeys,
        seen: entry.seen,
        hint: "Same PDP template — use labelHits/eans or extract; do not get_page.",
      },
    };
  }

  size(): number {
    return this.map.size;
  }
}

/** URL match helpers for page extensions (userscript-style). */

export type PageExtMatch = {
  /** Glob-ish patterns, e.g. `https://allegro.pl/*` or `*://*.example.com/*` */
  patterns: string[];
};

/** Convert a simple match pattern to RegExp. Supports `*` wildcards. */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function urlMatches(url: string, match: PageExtMatch | undefined | null): boolean {
  if (!match?.patterns?.length) return false;
  try {
    // Validate URL
    void new URL(url);
  } catch {
    return false;
  }
  return match.patterns.some((p) => {
    try {
      return patternToRegExp(p).test(url);
    } catch {
      return false;
    }
  });
}

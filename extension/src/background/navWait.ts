/**
 * Pure helpers for post-navigate tab readiness (unit-tested without Chrome).
 *
 * Bug class: tabs.update returns before the document swaps; a naive
 * "status===complete" waiter can resolve on the *previous* page and content
 * tools then scrape stale DOM.
 */

export function normalizeNavUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return url.trim();
  }
}

/** Same host (www-insensitive) and path compatible with the navigation target. */
export function urlsMatchTarget(current: string | undefined, target: string): boolean {
  if (!current) return false;
  const a = normalizeNavUrl(current);
  const b = normalizeNavUrl(target);
  if (a === b) return true;
  try {
    const cu = new URL(current);
    const tu = new URL(target);
    const ch = cu.hostname.replace(/^www\./i, "").toLowerCase();
    const th = tu.hostname.replace(/^www\./i, "").toLowerCase();
    if (ch !== th) return false;
    const cp = cu.pathname.replace(/\/$/, "") || "/";
    const tp = tu.pathname.replace(/\/$/, "") || "/";
    if (cp === tp) return true;
    // Allow landing on a deeper path after redirect (e.g. / → /pl).
    if (tp === "/" || cp.startsWith(`${tp}/`)) return true;
    return false;
  } catch {
    return false;
  }
}

export function isNavigationSettled(opts: {
  startUrl: string;
  targetUrl: string;
  currentUrl: string | undefined;
  status: string | undefined;
  /** True once we observed status=loading (or started from loading). */
  sawLoading: boolean;
}): boolean {
  if (opts.status !== "complete") return false;
  const atTarget = urlsMatchTarget(opts.currentUrl, opts.targetUrl);
  const stillOnStart =
    normalizeNavUrl(opts.currentUrl ?? "") === normalizeNavUrl(opts.startUrl);

  // Already on the target before navigate (idempotent).
  if (urlsMatchTarget(opts.startUrl, opts.targetUrl) && atTarget) return true;

  // Classic race: still complete on the *old* page — keep waiting.
  if (stillOnStart && !opts.sawLoading) return false;

  // Settle only when the document matches the intended target (incl. same-host
  // redirects via urlsMatchTarget). Never settle on an unrelated origin just
  // because we left startUrl.
  return atTarget;
}

/** For go_back / reload: settle once we leave startUrl (loading optional for SPA/bfcache). */
export function isHistoryNavSettled(opts: {
  startUrl: string;
  currentUrl: string | undefined;
  status: string | undefined;
  sawLoading: boolean;
}): boolean {
  const leftStart =
    normalizeNavUrl(opts.currentUrl ?? "") !== normalizeNavUrl(opts.startUrl);
  if (!leftStart) return false;
  if (opts.status === "loading") return false;
  // Classic full navigation: wait for complete after loading.
  if (opts.sawLoading) return opts.status === "complete";
  // SPA / bfcache / hash: URL changed without a loading phase.
  return opts.status === "complete" || opts.status == null;
}

/**
 * Pure helpers for content-script reinject recovery (unit-tested without Chrome).
 */

export const STALE_ASSETS_ERROR =
  "Extension assets stale after rebuild — Reload Combo-X on chrome://extensions, then refresh the tab";

export const RELOAD_TAB_HINT =
  "reload the tab so the Combo-X content script can inject";

export function isMissingContentReceiver(err: string | undefined | null): boolean {
  if (!err) return false;
  return (
    /Receiving end does not exist/i.test(err) ||
    /Could not establish connection/i.test(err) ||
    /message port closed/i.test(err)
  );
}

/** Chrome executeScript / dynamic import after Vite emptied hashed assets. */
export function isStaleContentAsset(err: string | undefined | null): boolean {
  if (!err) return false;
  if (!/Could not load file/i.test(err)) return false;
  return /content(\.ts)?(-loader)?/i.test(err) || /assets\//i.test(err);
}

/** True when a recover-by-reinject / tab-reload ladder should run. */
export function shouldAttemptContentRecovery(err: string | undefined | null): boolean {
  return isMissingContentReceiver(err) || isStaleContentAsset(err);
}

export function formatContentFailure(err: string | undefined | null): string {
  const base = (err ?? "content script unavailable").trim();
  if (isStaleContentAsset(base)) {
    return `${STALE_ASSETS_ERROR} (${base})`;
  }
  if (base.includes(STALE_ASSETS_ERROR) || base.includes(RELOAD_TAB_HINT)) {
    return base;
  }
  return `${base} — ${RELOAD_TAB_HINT}`;
}

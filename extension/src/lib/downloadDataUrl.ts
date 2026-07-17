/**
 * Build a data: URL for chrome.downloads from the MV3 service worker.
 * URL.createObjectURL is unavailable in SW — use data URLs for small/medium files.
 */

export function toDownloadDataUrl(text: string, mime = "text/plain"): string {
  // UTF-8 safe base64 (btoa alone breaks on Polish chars / emoji).
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(bin);
  const safeMime = mime.includes("charset=") ? mime : `${mime};charset=utf-8`;
  return `data:${safeMime};base64,${b64}`;
}

/** Chrome data-URL download soft limit — keep headroom. */
export const DOWNLOAD_DATA_URL_SOFT_MAX = 1_800_000;

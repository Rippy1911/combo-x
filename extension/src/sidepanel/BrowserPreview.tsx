import { useCallback, useEffect, useState } from "react";

/**
 * Nanobrowser-style "browser view" MVP: polled still of the active tab.
 * Chrome cannot embed a live tab in a side panel — this mirrors via captureVisibleTab.
 */
export function BrowserPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [frame, setFrame] = useState<{
    dataUrl: string;
    url: string;
    title: string;
    tabId: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [follow, setFollow] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = (await chrome.runtime.sendMessage({ type: "preview_frame" })) as {
        ok?: boolean;
        dataUrl?: string;
        url?: string;
        title?: string;
        tabId?: number;
        error?: string;
      };
      if (!res.ok || !res.dataUrl) {
        setError(res.error ?? "capture failed");
        return;
      }
      setError("");
      setFrame({
        dataUrl: res.dataUrl,
        url: res.url ?? "",
        title: res.title ?? "",
        tabId: res.tabId ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!open || !follow) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [open, follow, refresh]);

  if (!open) return null;

  return (
    <aside className="browser-preview" aria-label="Browser preview">
      <div className="browser-preview-bar">
        <strong>Browser</strong>
        <span className="hint truncate" title={frame?.url}>
          {frame?.title || frame?.url || "No frame"}
        </span>
        <label className="hint">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />{" "}
          Live
        </label>
        <button type="button" className="msg-action" onClick={() => void refresh()}>
          Refresh
        </button>
        <button type="button" className="msg-action" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? <p className="hint">{error}</p> : null}
      {frame?.dataUrl ? (
        <img className="browser-preview-img" src={frame.dataUrl} alt={frame.title || "tab"} />
      ) : (
        <p className="hint">Capturing active tab…</p>
      )}
      <p className="hint">
        Mirror only (Nanobrowser-style). Actions still run on the real tab — not an embedded browser.
      </p>
    </aside>
  );
}

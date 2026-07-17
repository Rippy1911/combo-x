import {
  ArtifactStore,
  AttachmentStore,
  buildReportHtml,
  type AttachmentRecord,
  type ReportArtifact,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { openPreviewInNewTab } from "./openPreviewTab";
import type { PreviewPayload } from "./PreviewDrawer";

type AssetFilter = "all" | "screenshots" | "reports" | "uploads";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

export function AssetsPanel({
  attachments,
  artifacts,
  active = true,
  sessionId,
  onPreview,
}: {
  attachments: AttachmentStore;
  artifacts: ArtifactStore;
  active?: boolean;
  sessionId?: string | null;
  onPreview: (p: PreviewPayload) => void;
}) {
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [shots, setShots] = useState<AttachmentRecord[]>([]);
  const [uploads, setUploads] = useState<AttachmentRecord[]>([]);
  const [reports, setReports] = useState<ReportArtifact[]>([]);
  const [attBytes, setAttBytes] = useState(0);
  const [reportBytes, setReportBytes] = useState(0);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [sessionOnly, setSessionOnly] = useState(false);

  const refresh = useCallback(async () => {
    const sid = sessionOnly && sessionId ? sessionId : undefined;
    const all = await attachments.list(sid);
    const shotRows = all.filter(
      (r) =>
        r.kind === "image" &&
        (r.meta?.vision === true ||
          String(r.meta?.source ?? "").startsWith("ux-") ||
          r.name.startsWith("screenshot-")),
    );
    const uploadRows = all.filter((r) => !shotRows.some((s) => s.id === r.id));
    setShots(shotRows);
    setUploads(uploadRows);
    setReports(await artifacts.listReports());
    setAttBytes(await attachments.totalBytes(sid));
    setReportBytes(await artifacts.reportsBytes());
    setQuota(await storageEstimate());
  }, [attachments, artifacts, sessionId, sessionOnly]);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  const quotaHint = useMemo(() => {
    if (!quota?.quota) return "Origin storage quota unknown (Chrome typically allows large IDB).";
    const pct = Math.round((quota.usage / quota.quota) * 100);
    return `Browser origin: ${formatBytes(quota.usage)} / ${formatBytes(quota.quota)} (${pct}%)`;
  }, [quota]);

  return (
    <div className="panel">
      <h2>Assets</h2>
      <p className="hint wrap">
        Screenshots, chat uploads, and HTML reports stored in this browser (IndexedDB — not the vault).
        Delete to free space. Large archives belong in a folder you pick (File System Access) — not
        required yet for typical audit volumes.
      </p>
      <p className="hint wrap">
        Combo attachments+reports ≈ {formatBytes(attBytes + reportBytes)}. {quotaHint}
      </p>

      <div className="row wrap">
        {(
          [
            ["all", "All"],
            ["screenshots", "Screenshots"],
            ["reports", "Reports"],
            ["uploads", "Uploads"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={filter === id ? "filter-on" : undefined}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <label className="hint row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={sessionOnly}
            onChange={(e) => setSessionOnly(e.target.checked)}
          />
          This session only (attachments)
        </label>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {msg ? <p className="hint">{msg}</p> : null}

      {(filter === "all" || filter === "screenshots") && (
        <section className="assets-section">
          <div className="row">
            <h3>Screenshots ({shots.length})</h3>
            {shots.length > 0 ? (
              <button
                type="button"
                className="dangerish"
                onClick={() =>
                  void (async () => {
                    if (!window.confirm(`Delete ${shots.length} screenshot(s)?`)) return;
                    for (const s of shots) await attachments.remove(s.id);
                    setMsg(`Deleted ${shots.length} screenshot(s)`);
                    await refresh();
                  })()
                }
              >
                Delete all shots
              </button>
            ) : null}
          </div>
          {shots.length === 0 ? (
            <p className="hint">No screenshots yet — run ux_critique.</p>
          ) : (
            <ul className="list">
              {shots.map((s) => (
                <li key={s.id} className="asset-row">
                  <div className="asset-thumb">
                    {s.dataUrl ? (
                      <img src={s.dataUrl} alt={s.name} />
                    ) : (
                      <span className="hint">no preview</span>
                    )}
                  </div>
                  <div className="grow">
                    <strong>{s.name}</strong>
                    <div className="hint mono-id">
                      {s.id.slice(0, 8)}… · {formatBytes(s.size)} ·{" "}
                      {new Date(s.createdAt).toLocaleString()}
                      {s.meta?.source ? ` · ${String(s.meta.source)}` : ""}
                    </div>
                  </div>
                  <div className="asset-actions">
                    <button
                      type="button"
                      disabled={!s.dataUrl}
                      onClick={() =>
                        onPreview({
                          title: s.name,
                          kind: "image",
                          body: s.dataUrl ?? "",
                        })
                      }
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      disabled={!s.dataUrl}
                      onClick={() =>
                        openPreviewInNewTab({
                          title: s.name,
                          kind: "image",
                          body: s.dataUrl,
                        })
                      }
                    >
                      Open tab
                    </button>
                    <button
                      type="button"
                      className="dangerish"
                      onClick={() =>
                        void (async () => {
                          await attachments.remove(s.id);
                          setMsg(`Deleted ${s.name}`);
                          await refresh();
                        })()
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(filter === "all" || filter === "reports") && (
        <section className="assets-section">
          <div className="row">
            <h3>Reports ({reports.length})</h3>
            {reports.length > 0 ? (
              <button
                type="button"
                className="dangerish"
                onClick={() =>
                  void (async () => {
                    if (!window.confirm(`Delete all ${reports.length} report(s)?`)) return;
                    const n = await artifacts.clearReports();
                    setMsg(`Deleted ${n} report(s)`);
                    await refresh();
                  })()
                }
              >
                Delete all reports
              </button>
            ) : null}
          </div>
          {reports.length === 0 ? (
            <p className="hint">No reports yet — use create_report.</p>
          ) : (
            <ul className="list">
              {reports.map((r) => (
                <li key={r.id} className="asset-row">
                  <div className="grow">
                    <strong>{r.title}</strong>
                    <div className="hint mono-id">
                      {r.id.slice(0, 8)}… · {formatBytes((r.bodyHtml?.length ?? 0) * 2)} ·{" "}
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="asset-actions">
                    <button
                      type="button"
                      onClick={() => {
                        const html = buildReportHtml(r.title, r.bodyHtml);
                        onPreview({
                          title: r.title,
                          kind: "html",
                          body: "",
                          html,
                          interactive: true,
                        });
                      }}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const html = buildReportHtml(r.title, r.bodyHtml);
                        openPreviewInNewTab({
                          title: r.title,
                          kind: "html",
                          html,
                        });
                      }}
                    >
                      Open tab
                    </button>
                    <button
                      type="button"
                      className="dangerish"
                      onClick={() =>
                        void (async () => {
                          await artifacts.deleteReport(r.id);
                          setMsg(`Deleted report ${r.title}`);
                          await refresh();
                        })()
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(filter === "all" || filter === "uploads") && (
        <section className="assets-section">
          <h3>Chat uploads ({uploads.length})</h3>
          {uploads.length === 0 ? (
            <p className="hint">No uploaded files in scope.</p>
          ) : (
            <ul className="list">
              {uploads.map((u) => (
                <li key={u.id} className="asset-row">
                  <div className="grow">
                    <strong>
                      {u.kind}: {u.name}
                    </strong>
                    <div className="hint mono-id">
                      {u.id.slice(0, 8)}… · {formatBytes(u.size)} ·{" "}
                      {new Date(u.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="asset-actions">
                    {u.kind === "image" && u.dataUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          onPreview({
                            title: u.name,
                            kind: "image",
                            body: u.dataUrl ?? "",
                          })
                        }
                      >
                        Preview
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          onPreview({
                            title: u.name,
                            kind: "text",
                            body: (u.text || "(empty)").slice(0, 80_000),
                          })
                        }
                      >
                        Preview
                      </button>
                    )}
                    <button
                      type="button"
                      className="dangerish"
                      onClick={() =>
                        void (async () => {
                          await attachments.remove(u.id);
                          setMsg(`Deleted ${u.name}`);
                          await refresh();
                        })()
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

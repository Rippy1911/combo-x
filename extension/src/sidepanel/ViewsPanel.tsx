import {
  ArtifactStore,
  AttachmentStore,
  ConnectorStore,
  INSPECTABLE_DBS,
  MemoryStore,
  RagStore,
  SessionStore,
  ViewStore,
  inspectStore,
  restRequest,
  siteProfileLabelName,
  type RagMeta,
  type SavedView,
  type Vault,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "./DataTable";
import { takeStashedTable } from "./tableHelpers";

type SubNav = "library" | "collections" | "table" | "integrations" | "inspector";
type CollectionKind =
  | "sessions"
  | "attachments"
  | "bookmarks"
  | "reminders"
  | "reports"
  | "memories"
  | "rag"
  | "profiles";

export function ViewsPanel({
  vault,
  views,
  sessions,
  attachments,
  rag,
  memory,
  artifacts,
  vaultUnlocked,
  connectorStore,
  onExport,
}: {
  vault: Vault;
  views: ViewStore;
  sessions: SessionStore;
  attachments: AttachmentStore;
  rag: RagStore;
  memory: MemoryStore;
  artifacts: ArtifactStore;
  vaultUnlocked: boolean;
  connectorStore: ConnectorStore;
  onExport: (filename: string, text: string, mime: string) => void | Promise<void>;
}) {
  const [sub, setSub] = useState<SubNav>("library");
  const [library, setLibrary] = useState<SavedView[]>([]);
  const [tableRows, setTableRows] = useState<string[][]>([]);
  const [tableTitle, setTableTitle] = useState("Table");
  const [collection, setCollection] = useState<CollectionKind>("sessions");
  const [collectionRows, setCollectionRows] = useState<string[][]>([]);
  const [msg, setMsg] = useState("");
  const [ragMeta, setRagMeta] = useState<RagMeta | null>(null);
  const [attachCount, setAttachCount] = useState(0);
  const [connectorCount, setConnectorCount] = useState(0);
  const [probeMsg, setProbeMsg] = useState("");
  const [inspDb, setInspDb] = useState(INSPECTABLE_DBS[0]!.name);
  const [inspStore, setInspStore] = useState(INSPECTABLE_DBS[0]!.stores[0]!);
  const [inspRows, setInspRows] = useState<Array<{ key: string; summary: string }>>([]);
  const [advanced, setAdvanced] = useState(false);

  const refreshLibrary = useCallback(async () => {
    setLibrary(await views.list());
  }, [views]);

  useEffect(() => {
    void refreshLibrary();
    const stashed = takeStashedTable();
    if (stashed) {
      setTableRows(stashed.rows);
      setTableTitle(stashed.title);
      setSub("table");
    }
  }, [refreshLibrary]);

  const loadCollection = useCallback(async () => {
    setMsg("");
    try {
      if (collection === "sessions") {
        const list = await sessions.list(50);
        setCollectionRows([
          ["id", "title", "updatedAt", "messages", "tokens"],
          ...list.map((s) => [
            s.id,
            s.title,
            s.updatedAt,
            String(s.messages.length),
            String(s.totalTokens),
          ]),
        ]);
      } else if (collection === "attachments") {
        const list = await attachments.list();
        setCollectionRows([
          ["id", "name", "kind", "size", "sessionId", "truncated"],
          ...list.map((a) => [
            a.id,
            a.name,
            a.kind,
            String(a.size),
            a.sessionId,
            String(a.truncated),
          ]),
        ]);
      } else if (collection === "bookmarks") {
        const list = await artifacts.listBookmarks();
        setCollectionRows([
          ["id", "title", "url", "note", "createdAt"],
          ...list.map((b) => [b.id, b.title, b.url, b.note ?? "", b.createdAt]),
        ]);
      } else if (collection === "reminders") {
        const list = await artifacts.listReminders();
        setCollectionRows([
          ["id", "text", "atIso", "fired", "createdAt"],
          ...list.map((r) => [
            r.id,
            r.text,
            r.atIso,
            String(Boolean(r.fired)),
            r.createdAt,
          ]),
        ]);
      } else if (collection === "reports") {
        const list = await artifacts.listReports();
        setCollectionRows([
          ["id", "title", "createdAt", "htmlChars"],
          ...list.map((r) => [
            r.id,
            r.title,
            r.createdAt,
            String(r.bodyHtml.length),
          ]),
        ]);
      } else if (collection === "memories") {
        const list = await memory.list(100);
        setCollectionRows([
          ["id", "kind", "text", "tags", "createdAt"],
          ...list.map((m) => [
            m.id,
            m.kind,
            m.text.slice(0, 200),
            m.tags.join(";"),
            m.createdAt,
          ]),
        ]);
      } else if (collection === "rag") {
        const paths = await rag.listPaths(300);
        const meta = await rag.getMeta();
        setRagMeta(meta);
        setCollectionRows([
          ["path", "folder", "chunks"],
          ...paths.map((p) => [
            p,
            meta?.folderName ?? "",
            String(meta?.chunkCount ?? ""),
          ]),
        ]);
      } else if (collection === "profiles") {
        const labels = await vault.listLabels();
        const names = labels
          .map(siteProfileLabelName)
          .filter((n): n is string => Boolean(n));
        setCollectionRows([
          ["name", "vault_label", "note"],
          ...names.map((n) => [n, `site_profile:${n}`, "password never shown"]),
        ]);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setCollectionRows([]);
    }
  }, [
    artifacts,
    attachments,
    collection,
    memory,
    rag,
    sessions,
    vault,
  ]);

  useEffect(() => {
    if (sub === "collections") void loadCollection();
  }, [sub, collection, loadCollection]);

  useEffect(() => {
    if (sub !== "integrations") return;
    void (async () => {
      setRagMeta(await rag.getMeta());
      setAttachCount((await attachments.list()).length);
      setConnectorCount((await connectorStore.list()).length);
    })();
  }, [sub, rag, attachments, connectorStore]);

  const openView = async (v: SavedView) => {
    if (v.rows?.length) {
      setTableRows(v.rows);
      setTableTitle(v.name);
      setSub("table");
    } else {
      setMsg("View has no row snapshot");
    }
  };

  const saveCurrentAsView = async (name: string, rows: string[][]) => {
    const saved = await views.save({
      name,
      source: "manual",
      rows,
    });
    setMsg(`Saved view “${saved.name}”`);
    await refreshLibrary();
  };

  const runInspect = async () => {
    setAdvanced(true);
    const rows = await inspectStore(inspDb, inspStore, 40);
    setInspRows(
      rows.map((r) => ({ key: String(r.key), summary: r.summary })),
    );
  };

  const storesForDb = useMemo(
    () => INSPECTABLE_DBS.find((d) => d.name === inspDb)?.stores ?? [],
    [inspDb],
  );

  const probeRest = async () => {
    const list = await connectorStore.list();
    const rest = list.find((c) => c.kind === "rest");
    if (!rest || rest.kind !== "rest") {
      setProbeMsg(
        list.length
          ? `${list.length} connector(s) — none are REST`
          : "No connectors — add REST in Settings",
      );
      return;
    }
    const path = rest.id === "github-rest" ? "/zen" : "/";
    const out = await restRequest(
      rest,
      { path, method: "GET" },
      (label) => vault.getByLabel(label),
    );
    setProbeMsg(
      out.ok
        ? `REST probe OK — ${rest.name} ${path}`
        : `REST probe failed: ${out.error}`,
    );
  };

  return (
    <div className="panel views-panel">
      <h2>Views</h2>
      <p className="hint wrap">
        Browse local data, tables, charts, and copilot-saved views. Vault secrets stay out of grids.
      </p>
      <nav className="views-subnav">
        {(
          [
            ["library", "Library"],
            ["collections", "Collections"],
            ["table", "Table"],
            ["integrations", "Integrations"],
            ["inspector", "Inspector"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={sub === id ? "tab active" : "tab"}
            onClick={() => setSub(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {msg ? <p className="hint wrap">{msg}</p> : null}

      {sub === "library" ? (
        <div className="views-section">
          <div className="row">
            <button type="button" onClick={() => void refreshLibrary()}>
              Refresh
            </button>
          </div>
          {library.length === 0 ? (
            <p className="hint">No saved views yet. Ask the agent to save_view after a scrape, or Save view from Table.</p>
          ) : (
            <ul className="list">
              {library.map((v) => (
                <li key={v.id}>
                  <strong>{v.name}</strong>
                  <div className="hint">
                    {v.source} · {v.rows?.length ?? 0} rows · {new Date(v.updatedAt).toLocaleString()}
                  </div>
                  <div className="row">
                    <button type="button" className="primary" onClick={() => void openView(v)}>
                      Open
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void (async () => {
                          await views.delete(v.id);
                          await refreshLibrary();
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
        </div>
      ) : null}

      {sub === "collections" ? (
        <div className="views-section">
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value as CollectionKind)}
          >
            <option value="sessions">Sessions</option>
            <option value="attachments">Attachments</option>
            <option value="bookmarks">Bookmarks</option>
            <option value="reminders">Reminders</option>
            <option value="reports">Reports</option>
            <option value="memories">Memories</option>
            <option value="rag">RAG paths</option>
            <option value="profiles">Site profiles (names only)</option>
          </select>
          {collectionRows.length > 0 ? (
            <DataTable
              rows={collectionRows}
              title={collection}
              onExport={onExport}
              onOpenInViews={(t, r) => {
                setTableTitle(t);
                setTableRows(r);
                setSub("table");
              }}
              onSaveView={(t, r) => void saveCurrentAsView(t, r)}
              showChart={collection !== "profiles"}
            />
          ) : (
            <p className="hint">Empty collection</p>
          )}
        </div>
      ) : null}

      {sub === "table" ? (
        <div className="views-section">
          {tableRows.length ? (
            <DataTable
              rows={tableRows}
              title={tableTitle}
              onExport={onExport}
              onSaveView={(t, r) => void saveCurrentAsView(t, r)}
            />
          ) : (
            <p className="hint">
              No active table. Open a Library view, Collection, or use Preview → Views from chat.
            </p>
          )}
        </div>
      ) : null}

      {sub === "integrations" ? (
        <div className="views-section">
          <ul className="list">
            <li>
              Vault: {vaultUnlocked ? "unlocked" : "locked"}
            </li>
            <li>
              RAG:{" "}
              {ragMeta?.chunkCount
                ? `${ragMeta.folderName || "folder"} · ${ragMeta.fileCount} files / ${ragMeta.chunkCount} chunks`
                : "not indexed"}
            </li>
            <li>Connectors: {connectorCount} configured</li>
            <li>Attachments: {attachCount}</li>
            <li>Saved views: {library.length}</li>
          </ul>
          <div className="row">
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  const m = await rag.getMeta();
                  setRagMeta(m);
                  setProbeMsg(
                    m?.chunkCount
                      ? `RAG OK — ${m.chunkCount} chunks`
                      : "RAG empty — grant folder in Settings",
                  );
                })()
              }
            >
              Test RAG
            </button>
            <button type="button" onClick={() => void probeRest()}>
              Probe REST
            </button>
          </div>
          {probeMsg ? <p className="hint wrap">{probeMsg}</p> : null}
        </div>
      ) : null}

      {sub === "inspector" ? (
        <div className="views-section">
          <p className="hint wrap">
            Read-only IDB browser. Vault values are never decrypted here — labels/ciphertext only.
          </p>
          <label className="hint">
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => setAdvanced(e.target.checked)}
            />{" "}
            Enable Advanced inspector
          </label>
          {advanced ? (
            <>
              <div className="row">
                <select
                  value={inspDb}
                  onChange={(e) => {
                    setInspDb(e.target.value);
                    const stores =
                      INSPECTABLE_DBS.find((d) => d.name === e.target.value)?.stores ?? [];
                    setInspStore(stores[0] ?? "");
                  }}
                >
                  {INSPECTABLE_DBS.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                      {d.redactValues ? " (redacted)" : ""}
                    </option>
                  ))}
                </select>
                <select value={inspStore} onChange={(e) => setInspStore(e.target.value)}>
                  {storesForDb.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button type="button" className="primary" onClick={() => void runInspect()}>
                  Load
                </button>
              </div>
              <ul className="list">
                {inspRows.map((r) => (
                  <li key={r.key}>
                    <code>{r.key}</code>
                    <div className="hint wrap">{r.summary}</div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="hint">Check Advanced to browse object stores.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

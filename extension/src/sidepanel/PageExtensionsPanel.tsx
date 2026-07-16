import { useCallback, useEffect, useState } from "react";
import type { PageExtAuditEntry, PageExtension, PageExtensionStore } from "@combo-x/core";

const EXAMPLE = `// Allegro: remember viewed offers (needs bridge allowStorage + exportChannels)
(async () => {
  const title = document.title;
  const url = location.href;
  const prev = (await ComboX.storage.get("viewed")) || [];
  const next = [{ title, url, at: new Date().toISOString() }, ...prev].slice(0, 200);
  ComboX.storage.set("viewed", next);
  ComboX.export("viewed", next);
  ComboX.log("saved " + next.length);
})();`;

export function PageExtensionsPanel({
  store,
  sessionId,
}: {
  store: PageExtensionStore;
  sessionId?: string;
}) {
  const [list, setList] = useState<PageExtension[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audit, setAudit] = useState<PageExtAuditEntry[]>([]);
  const [dataKeys, setDataKeys] = useState<Array<{ key: string; updatedAt: string }>>([]);
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState({
    name: "",
    patterns: "https://allegro.pl/*",
    source: EXAMPLE,
    description: "",
  });

  const selected = list.find((e) => e.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    const rows = await store.list();
    setList(rows);
    if (selectedId) {
      setAudit(await store.listAudit(selectedId, 40));
      setDataKeys(await store.dataList(selectedId));
    }
  }, [selectedId, store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setAudit([]);
      setDataKeys([]);
      return;
    }
    void (async () => {
      setAudit(await store.listAudit(selectedId, 40));
      setDataKeys(await store.dataList(selectedId));
    })();
  }, [selectedId, store]);

  return (
    <div className="panel page-ext-panel">
      <h2>Page extensions</h2>
      <p className="hint">
        MAIN-world userscripts. Isolated store <code>combo_x_page_ext</code> — cannot access Combo
        sessions/vault. Only an agent-configured bridge can export or use host storage.
      </p>

      <div className="page-ext-grid">
        <div className="page-ext-list">
          <button
            type="button"
            className="primary"
            onClick={() => {
              void (async () => {
                try {
                  const row = await store.create({
                    name: draft.name || "New extension",
                    source: draft.source,
                    patterns: draft.patterns
                      .split(/[\n,]/)
                      .map((p) => p.trim())
                      .filter(Boolean),
                    description: draft.description || undefined,
                    createdBy: "user",
                    sessionId,
                  });
                  setSelectedId(row.id);
                  setStatus(`Created draft ${row.id.slice(0, 8)}…`);
                  await refresh();
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e));
                }
              })();
            }}
          >
            Create draft
          </button>
          <ul className="list">
            {list.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={e.id === selectedId ? "linkish active" : "linkish"}
                  onClick={() => setSelectedId(e.id)}
                >
                  <strong>{e.name}</strong>
                  <br />
                  <span className="hint">
                    {e.approval}
                    {e.enabled ? " · on" : " · off"} · v{e.version}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="page-ext-editor">
          {!selected ? (
            <>
              <label>
                Name
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Allegro viewed products"
                />
              </label>
              <label>
                Match patterns (comma/newline)
                <textarea
                  rows={2}
                  value={draft.patterns}
                  onChange={(e) => setDraft((d) => ({ ...d, patterns: e.target.value }))}
                />
              </label>
              <label>
                Source
                <textarea
                  rows={12}
                  className="mono"
                  value={draft.source}
                  onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
                />
              </label>
            </>
          ) : (
            <>
              <div className="row wrap">
                <span className="hint mono-id" title={selected.id}>
                  {selected.id}
                </span>
                <span className="hint">
                  {selected.approval} · hash {selected.sourceHash?.slice(0, 12)}…
                </span>
              </div>
              <label>
                Name
                <input
                  value={selected.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setList((prev) =>
                      prev.map((x) => (x.id === selected.id ? { ...x, name } : x)),
                    );
                  }}
                />
              </label>
              <label>
                Patterns
                <textarea
                  rows={2}
                  value={selected.match.patterns.join("\n")}
                  onChange={(e) => {
                    const patterns = e.target.value
                      .split(/[\n,]/)
                      .map((p) => p.trim())
                      .filter(Boolean);
                    setList((prev) =>
                      prev.map((x) =>
                        x.id === selected.id ? { ...x, match: { patterns } } : x,
                      ),
                    );
                  }}
                />
              </label>
              <label>
                Source
                <textarea
                  rows={12}
                  className="mono"
                  value={selected.source}
                  onChange={(e) => {
                    const source = e.target.value;
                    setList((prev) =>
                      prev.map((x) => (x.id === selected.id ? { ...x, source } : x)),
                    );
                  }}
                />
              </label>
              <div className="row wrap">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    void (async () => {
                      const cur = list.find((x) => x.id === selected.id);
                      if (!cur) return;
                      await store.update(
                        cur.id,
                        {
                          name: cur.name,
                          source: cur.source,
                          patterns: cur.match.patterns,
                        },
                        { actor: "user", sessionId },
                      );
                      setStatus("Saved (source change → draft)");
                      await refresh();
                    })();
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      await store.approve(selected.id, "user", sessionId);
                      setStatus("Approved");
                      await refresh();
                    })();
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      await store.update(
                        selected.id,
                        { enabled: !selected.enabled },
                        { actor: "user", sessionId },
                      );
                      await refresh();
                    })();
                  }}
                >
                  {selected.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      await store.setBridge(
                        selected.id,
                        {
                          exportChannels: ["viewed"],
                          allowStorage: true,
                        },
                        { actor: "user", sessionId },
                      );
                      setStatus("Bridge: export viewed + storage");
                      await refresh();
                    })();
                  }}
                >
                  Set sample bridge
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      const res = (await chrome.runtime.sendMessage({
                        type: "inject_page_extensions",
                        scriptIds: [selected.id],
                      })) as { ok?: boolean; injected?: string[]; errors?: string[] };
                      setStatus(
                        res.ok
                          ? `Injected: ${(res.injected ?? []).join(", ") || "none"}`
                          : `Inject errors: ${(res.errors ?? []).join("; ")}`,
                      );
                      await refresh();
                    })();
                  }}
                >
                  Inject now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      await store.revoke(selected.id, "user", sessionId);
                      setStatus("Revoked");
                      await refresh();
                    })();
                  }}
                >
                  Revoke
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      await store.remove(selected.id, "user", sessionId);
                      setSelectedId(null);
                      setStatus("Deleted");
                      await refresh();
                    })();
                  }}
                >
                  Delete
                </button>
              </div>
              <h3>Isolated data keys</h3>
              <ul className="list compact">
                {dataKeys.length === 0 ? <li className="hint">None</li> : null}
                {dataKeys.map((k) => (
                  <li key={k.key}>
                    <code>{k.key}</code>{" "}
                    <span className="hint">{new Date(k.updatedAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <h3>Audit</h3>
              <ul className="list compact">
                {audit.map((a) => (
                  <li key={a.id}>
                    <span className="hint">{new Date(a.at).toLocaleString()}</span> ·{" "}
                    <strong>{a.action}</strong> · {a.actor}
                    {a.pageUrl ? ` · ${a.pageUrl.slice(0, 48)}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          {status ? <p className="hint">{status}</p> : null}
        </div>
      </div>
    </div>
  );
}

import { ViewStore, type SavedView } from "@combo-x/core";
import { useCallback, useEffect, useState } from "react";
import { DataTable } from "./DataTable";
import { takeStashedTable } from "./tableHelpers";

export function TablesSubpanel({
  views,
  onExport,
}: {
  views: ViewStore;
  onExport: (filename: string, text: string, mime: string) => void | Promise<void>;
}) {
  const [library, setLibrary] = useState<SavedView[]>([]);
  const [tableRows, setTableRows] = useState<string[][]>([]);
  const [tableTitle, setTableTitle] = useState("Table");
  const [showTable, setShowTable] = useState(false);
  const [msg, setMsg] = useState("");

  const refreshLibrary = useCallback(async () => {
    setLibrary(await views.list());
  }, [views]);

  useEffect(() => {
    void refreshLibrary();
    const stashed = takeStashedTable();
    if (stashed) {
      setTableRows(stashed.rows);
      setTableTitle(stashed.title);
      setShowTable(true);
    }
  }, [refreshLibrary]);

  const openView = async (v: SavedView) => {
    if (v.rows?.length) {
      setTableRows(v.rows);
      setTableTitle(v.name);
      setShowTable(true);
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

  return (
    <div className="lib-section">
      <p className="hint wrap">
        Saved views and active tables from scrapes. Open a library entry or use Preview → Views from
        chat.
      </p>
      {msg ? <p className="hint wrap">{msg}</p> : null}
      <div className="row">
        <button type="button" onClick={() => setShowTable(false)}>
          Library
        </button>
        <button
          type="button"
          className={showTable ? "tab active" : "tab"}
          onClick={() => setShowTable(true)}
        >
          Table
        </button>
        <button type="button" onClick={() => void refreshLibrary()}>
          Refresh
        </button>
      </div>
      {!showTable ? (
        <>
          {library.length === 0 ? (
            <p className="hint">
              No saved views yet. Ask the agent to save_view after a scrape, or Save view from
              Table.
            </p>
          ) : (
            <ul className="list">
              {library.map((v) => (
                <li key={v.id}>
                  <strong>{v.name}</strong>
                  <div className="hint">
                    {v.source} · {v.rows?.length ?? 0} rows ·{" "}
                    {new Date(v.updatedAt).toLocaleString()}
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
        </>
      ) : tableRows.length ? (
        <DataTable
          rows={tableRows}
          title={tableTitle}
          onExport={onExport}
          onSaveView={(t, r) => void saveCurrentAsView(t, r)}
        />
      ) : (
        <p className="hint">
          No active table. Open a library view or use Preview → Views from chat.
        </p>
      )}
    </div>
  );
}

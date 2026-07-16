import {
  DEFAULT_SKIP_DIRS,
  grantAndIndex,
  reindexSaved,
  type RagMeta,
  type RagStore,
} from "@combo-x/core";
import { useState } from "react";

export function KnowledgeSubpanel({
  rag,
  ragMeta,
  setRagMeta,
  ragExclude,
  setRagExclude,
  locked,
  setEnabledTools,
}: {
  rag: RagStore;
  ragMeta: RagMeta | null;
  setRagMeta: (m: RagMeta | null) => void;
  ragExclude: string;
  setRagExclude: (v: string) => void;
  locked: boolean;
  setEnabledTools?: (fn: (prev: Set<string>) => Set<string>) => void;
}) {
  const [ragMsg, setRagMsg] = useState("");
  const [ragBusy, setRagBusy] = useState(false);

  return (
    <div className="lib-section">
      <p className="hint wrap">
        Grant folders on this device. Built-in skips: <code>node_modules</code>, <code>.git</code>,{" "}
        <code>dist</code>.
      </p>
      <p className="hint wrap">
        Index:{" "}
        <code>
          {ragMeta
            ? `${ragMeta.folderName || "folder"} · ${ragMeta.fileCount} files / ${ragMeta.chunkCount} chunks`
            : "(none)"}
        </code>
      </p>
      <label className="hint">Extra exclude dirs</label>
      <input
        value={ragExclude}
        onChange={(e) => setRagExclude(e.target.value)}
        placeholder={DEFAULT_SKIP_DIRS.join(", ")}
      />
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={ragBusy || locked}
          onClick={() =>
            void (async () => {
              setRagBusy(true);
              setRagMsg("Pick a folder…");
              try {
                const excludeDirs = ragExclude
                  .split(/[,\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                const meta = await grantAndIndex(rag, (p) => setRagMsg(p.message ?? p.phase), {
                  append: false,
                  excludeDirs,
                });
                setRagMeta(meta);
                setEnabledTools?.((prev) => {
                  const next = new Set(prev);
                  next.add("rag_search");
                  next.add("rag_read_file");
                  next.add("rag_status");
                  return next;
                });
                setRagMsg(`Ready — ${meta.fileCount} files / ${meta.chunkCount} chunks`);
              } catch (e) {
                setRagMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setRagBusy(false);
              }
            })()
          }
        >
          Grant folder + index
        </button>
        <button
          type="button"
          disabled={ragBusy || locked}
          onClick={() =>
            void (async () => {
              setRagBusy(true);
              try {
                const excludeDirs = ragExclude
                  .split(/[,\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                const meta = await grantAndIndex(rag, (p) => setRagMsg(p.message ?? p.phase), {
                  append: true,
                  excludeDirs,
                });
                setRagMeta(meta);
                setRagMsg(`Added — ${meta.fileCount} files / ${meta.chunkCount} chunks`);
              } catch (e) {
                setRagMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setRagBusy(false);
              }
            })()
          }
        >
          Add folder
        </button>
        <button
          type="button"
          disabled={ragBusy || locked}
          onClick={() =>
            void (async () => {
              setRagBusy(true);
              try {
                const meta = await reindexSaved(rag, (p) => setRagMsg(p.message ?? p.phase));
                setRagMeta(meta);
                setRagMsg(`Reindexed — ${meta.fileCount} files / ${meta.chunkCount} chunks`);
              } catch (e) {
                setRagMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setRagBusy(false);
              }
            })()
          }
        >
          Reindex
        </button>
      </div>
      {ragMeta?.folders?.length ? (
        <ul className="hint wrap" style={{ listStyle: "none", padding: 0 }}>
          {ragMeta.folders.map((f) => (
            <li key={f.id} className="row">
              <code>{f.folderName}</code>
              <button
                type="button"
                disabled={ragBusy || locked}
                onClick={() =>
                  void (async () => {
                    setRagBusy(true);
                    try {
                      await rag.removeHandle(f.id);
                      const left = await rag.listHandles();
                      if (left.length) {
                        const meta = await reindexSaved(rag, (p) => setRagMsg(p.message ?? p.phase));
                        setRagMeta(meta);
                        setRagMsg(`Removed ${f.folderName}; reindexed`);
                      } else {
                        await rag.clearChunks();
                        setRagMeta(await rag.getMeta());
                        setRagMsg("All folders removed");
                      }
                    } catch (e) {
                      setRagMsg(e instanceof Error ? e.message : String(e));
                    } finally {
                      setRagBusy(false);
                    }
                  })()
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {ragMsg ? <p className="hint wrap">{ragMsg}</p> : null}
    </div>
  );
}

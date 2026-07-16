import type { AgentProfile, AgentProfileStore } from "@combo-x/core";
import { MemoryStore, type MemoryEntry, type MemoryScope } from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";

type ScopeFilter = "all" | "global" | "agent";

export function MemoryBrowser({
  memory,
  agents,
}: {
  memory: MemoryStore;
  agents: AgentProfileStore;
}) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [agentFilterId, setAgentFilterId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editScope, setEditScope] = useState<MemoryScope>("global");
  const [editAgentId, setEditAgentId] = useState("");
  const [newText, setNewText] = useState("");
  const [newScope, setNewScope] = useState<MemoryScope>("global");
  const [newAgentId, setNewAgentId] = useState("");
  const [newTags, setNewTags] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setEntries(await memory.list(200));
    setProfiles(await agents.list());
  }, [memory, agents]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const agentName = useCallback(
    (id?: string) => profiles.find((p) => p.id === id)?.name ?? id ?? "agent",
    [profiles],
  );

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (scopeFilter === "global") return e.scope !== "agent";
      if (scopeFilter === "agent") {
        if (!agentFilterId) return e.scope === "agent";
        return e.scope === "agent" && e.agentId === agentFilterId;
      }
      return true;
    });
  }, [entries, scopeFilter, agentFilterId]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const openEdit = (e: MemoryEntry) => {
    setSelectedId(e.id);
    setEditText(e.text);
    setEditTags(e.tags.join(", "));
    setEditScope(e.scope);
    setEditAgentId(e.agentId ?? "");
  };

  const saveEdit = async () => {
    if (!selectedId) return;
    setBusy(true);
    setMsg("");
    try {
      const tags = editTags
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await memory.update(selectedId, {
        text: editText,
        tags,
        scope: editScope,
        agentId: editScope === "agent" ? editAgentId : undefined,
      });
      setMsg("Saved");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (id: string) => {
    setBusy(true);
    try {
      await memory.delete(id);
      if (selectedId === id) setSelectedId(null);
      setMsg("Deleted");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createNote = async () => {
    if (!newText.trim()) {
      setMsg("Note text required");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const tags = newTags
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const row = await memory.remember({
        text: newText,
        kind: "note",
        tags,
        scope: newScope,
        agentId: newScope === "agent" ? newAgentId : undefined,
      });
      setNewText("");
      setNewTags("");
      setMsg(`Created “${row.id.slice(0, 8)}…”`);
      setSelectedId(row.id);
      openEdit(row);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lib-section">
      <p className="hint wrap">
        Always prepended to each LLM turn (global + active agent). Not searched mid-run.
      </p>
      <div className="lib-subnav filter-chips">
        {(
          [
            ["all", "All"],
            ["global", "Global"],
            ["agent", "Agent"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={scopeFilter === id ? "tab active" : "tab"}
            onClick={() => setScopeFilter(id)}
          >
            {label}
          </button>
        ))}
        {scopeFilter === "agent" ? (
          <select
            className="agent-pick"
            value={agentFilterId}
            onChange={(e) => setAgentFilterId(e.target.value)}
          >
            <option value="">All agents</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {msg ? <p className="hint wrap">{msg}</p> : null}
      <div className="row">
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
      </div>
      {filtered.length === 0 ? (
        <p className="hint">No memories in this filter.</p>
      ) : (
        <ul className="list">
          {filtered.map((e) => (
            <li key={e.id}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <span
                  className={`scope-badge${e.scope === "agent" ? " agent" : " global"}`}
                >
                  {e.scope === "agent" ? agentName(e.agentId) : "global"}
                </span>
                <span className="hint">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              {e.tags.length > 0 ? (
                <div className="chips tool-chip-grid" style={{ marginTop: 6 }}>
                  {e.tags.map((t) => (
                    <span key={t} className="chip-toggle on">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="clamp-2" style={{ margin: "6px 0 0", fontSize: 12 }}>
                {e.text}
              </p>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" onClick={() => openEdit(e)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => void deleteEntry(e.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <div className="agent-editor">
          <h3>Edit memory</h3>
          <label className="hint">Scope</label>
          <select
            value={editScope}
            onChange={(e) => setEditScope(e.target.value as MemoryScope)}
          >
            <option value="global">Global</option>
            <option value="agent">Agent</option>
          </select>
          {editScope === "agent" ? (
            <>
              <label className="hint">Agent</label>
              <select value={editAgentId} onChange={(e) => setEditAgentId(e.target.value)}>
                <option value="">Select agent…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <label className="hint">Tags (comma-separated)</label>
          <input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
          <label className="hint">Text</label>
          <textarea rows={5} value={editText} onChange={(e) => setEditText(e.target.value)} />
          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={() => void saveEdit()}>
              Save
            </button>
            <button type="button" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      <div className="agent-editor">
        <h3>New note</h3>
        <label className="hint">Scope</label>
        <select value={newScope} onChange={(e) => setNewScope(e.target.value as MemoryScope)}>
          <option value="global">Global</option>
          <option value="agent">Agent</option>
        </select>
        {newScope === "agent" ? (
          <>
            <label className="hint">Agent</label>
            <select value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}>
              <option value="">Select agent…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <label className="hint">Tags (comma-separated)</label>
        <input value={newTags} onChange={(e) => setNewTags(e.target.value)} />
        <label className="hint">Text</label>
        <textarea
          rows={4}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Persistent note for the agent…"
        />
        <button type="button" className="primary" disabled={busy} onClick={() => void createNote()}>
          Create note
        </button>
      </div>
    </div>
  );
}

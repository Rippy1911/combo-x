import type { AgentProfile, AgentProfileStore } from "@combo-x/core";
import { SkillStore, type Skill, type SkillScope } from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";

export function SkillsBrowser({
  skills,
  agents,
}: {
  skills: SkillStore;
  agents: AgentProfileStore;
}) {
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "agent">("all");
  const [filterAgentId, setFilterAgentId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editHints, setEditHints] = useState("");
  const [editScope, setEditScope] = useState<SkillScope>("global");
  const [editAgentId, setEditAgentId] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setAllSkills(await skills.list({ limit: 200 }));
    setProfiles(await agents.list());
  }, [skills, agents]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const agentName = useCallback(
    (id?: string) => profiles.find((p) => p.id === id)?.name ?? id ?? "agent",
    [profiles],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allSkills.filter((s) => {
      if (scopeFilter === "global" && s.scope === "agent") return false;
      if (scopeFilter === "agent") {
        if (s.scope !== "agent") return false;
        if (filterAgentId && s.agentId !== filterAgentId) return false;
      }
      if (!q) return true;
      const hay = `${s.name} ${s.description} ${s.tags.join(" ")} ${s.body}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allSkills, query, scopeFilter, filterAgentId]);

  const openEdit = (s: Skill) => {
    setExpandedId(s.id);
    setCreating(false);
    setEditName(s.name);
    setEditDesc(s.description);
    setEditBody(s.body);
    setEditHints((s.toolHints ?? []).join(", "));
    setEditScope(s.scope);
    setEditAgentId(s.agentId ?? "");
  };

  const startCreate = () => {
    setCreating(true);
    setExpandedId("__new__");
    setEditName("");
    setEditDesc("");
    setEditBody("");
    setEditHints("");
    setEditScope("global");
    setEditAgentId("");
  };

  const saveSkill = async () => {
    setBusy(true);
    setMsg("");
    try {
      const toolHints = editHints
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const row = await skills.save({
        id: creating ? undefined : expandedId ?? undefined,
        name: editName,
        description: editDesc,
        body: editBody,
        scope: editScope,
        agentId: editScope === "agent" ? editAgentId : undefined,
        toolHints: toolHints.length ? toolHints : undefined,
      });
      setMsg(`Saved “${row.name}”`);
      setExpandedId(row.id);
      setCreating(false);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteSkill = async (id: string) => {
    setBusy(true);
    try {
      await skills.delete(id);
      if (expandedId === id) setExpandedId(null);
      setMsg("Deleted");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isSeeded = (s: Skill) => s.tags.includes("seed");

  return (
    <div className="lib-section">
      <p className="hint wrap">
        Name/description are prepended each turn. skill_read loads the body and unlocks toolHints.
        Create/edit here, or ask the agent to call skill_save when that tool is in the ceiling.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search skills…"
      />
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {(["all", "global", "agent"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={scopeFilter === f ? "msg-action active" : "msg-action"}
            onClick={() => setScopeFilter(f)}
          >
            {f === "all" ? "All" : f === "global" ? "Global" : "Per-agent"}
          </button>
        ))}
        {scopeFilter === "agent" ? (
          <select
            value={filterAgentId}
            onChange={(e) => setFilterAgentId(e.target.value)}
            aria-label="Filter by agent"
          >
            <option value="">Any agent</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="row">
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
        <button type="button" className="primary" onClick={startCreate}>
          New skill
        </button>
      </div>
      {msg ? <p className="hint wrap">{msg}</p> : null}
      {filtered.length === 0 ? (
        <p className="hint">No skills match.</p>
      ) : (
        <ul className="list">
          {filtered.map((s) => (
            <li key={s.id}>
              <div className="list-card-top">
                <div className="list-card-body">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <strong>{s.name}</strong>
                    <span
                      className={`scope-badge${s.scope === "agent" ? " agent" : " global"}`}
                    >
                      {s.scope === "agent" ? agentName(s.agentId) : "global"}
                      {isSeeded(s) ? " · seed" : ""}
                    </span>
                  </div>
                  <p className="hint wrap" style={{ margin: "4px 0" }}>
                    {s.description}
                  </p>
                  <p className="hint clamp-2" style={{ margin: "0 0 4px" }}>
                    {s.body}
                  </p>
                  {(s.toolHints?.length ?? 0) > 0 ? (
                    <div className="row" style={{ alignItems: "center", gap: 6 }}>
                      <span className="hint">Unlocks:</span>
                      <div className="tool-chip-grid">
                        {s.toolHints!.map((h) => (
                          <span key={h} className="chip-toggle on">
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="list-row-actions">
                  <button
                    type="button"
                    className={
                      expandedId === s.id
                        ? "msg-action icon-btn active"
                        : "msg-action icon-btn"
                    }
                    title={expandedId === s.id ? "Editing…" : "Edit"}
                    aria-label="Edit"
                    onClick={() => openEdit(s)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="msg-action icon-btn dangerish"
                    title="Delete"
                    aria-label="Delete"
                    disabled={busy}
                    onClick={() => void deleteSkill(s.id)}
                  >
                    ⌫
                  </button>
                </div>
              </div>
              {expandedId === s.id ? (
                <div className="agent-editor" style={{ marginTop: 8 }}>
                  <label className="hint">Name</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <label className="hint">Description</label>
                  <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                  <label className="hint">Scope</label>
                  <select
                    value={editScope}
                    onChange={(e) => setEditScope(e.target.value as SkillScope)}
                  >
                    <option value="global">Global</option>
                    <option value="agent">Agent</option>
                  </select>
                  {editScope === "agent" ? (
                    <>
                      <label className="hint">Agent</label>
                      <select
                        value={editAgentId}
                        onChange={(e) => setEditAgentId(e.target.value)}
                      >
                        <option value="">Select agent…</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  <label className="hint">toolHints (comma-separated tool names)</label>
                  <input
                    value={editHints}
                    onChange={(e) => setEditHints(e.target.value)}
                    placeholder="scrape_catalog, export_csv"
                    className="mono"
                  />
                  <label className="hint">Body</label>
                  <textarea
                    rows={8}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="mono"
                  />
                  <div className="row">
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => void saveSkill()}
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setExpandedId(null)}>
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {creating && expandedId === "__new__" ? (
        <div className="agent-editor">
          <h3>New skill</h3>
          <label className="hint">Name</label>
          <input value={editName} onChange={(e) => setEditName(e.target.value)} />
          <label className="hint">Description</label>
          <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
          <label className="hint">Scope</label>
          <select
            value={editScope}
            onChange={(e) => setEditScope(e.target.value as SkillScope)}
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
          <label className="hint">toolHints</label>
          <input value={editHints} onChange={(e) => setEditHints(e.target.value)} className="mono" />
          <label className="hint">Body</label>
          <textarea rows={8} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={() => void saveSkill()}>
              Save skill
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setExpandedId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import {
  AGENT_TOOLS,
  DEFAULT_SKIP_DIRS,
  MODEL_PRESETS,
  grantAndIndex,
  githubRestTemplate,
  normalizeModelId,
  parseMcpDefinition,
  reindexSaved,
  type AgentBudgetMode,
  type AgentProfile,
  type AgentProfileStore,
  type ApprovalMode,
  type Connector,
  type ConnectorStore,
  type RagMeta,
  type RagStore,
  type Vault,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { mcpConnectorFromSanitized } from "./connectorHelpers";
import { GROUP_ORDER, TOOL_GROUPS } from "./toolGroups";

const GH_TOKEN_LABEL = "github_token";

export type SettingsPanelProps = {
  vault: Vault;
  rag: RagStore;
  agentProfiles: AgentProfileStore;
  connectorStore: ConnectorStore;
  locked: boolean;
  apiKey: string;
  setApiKey: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  workerModel: string;
  setWorkerModel: (v: string) => void;
  customModel: string;
  setCustomModel: (v: string) => void;
  customWorkerModel: string;
  setCustomWorkerModel: (v: string) => void;
  approvalMode: ApprovalMode;
  setApprovalMode: (v: ApprovalMode) => void;
  budgetMode: AgentBudgetMode;
  setBudgetMode: (v: AgentBudgetMode) => void;
  enabledTools: Set<string>;
  setEnabledTools: (fn: (prev: Set<string>) => Set<string>) => void;
  activeAgentId: string | null;
  setActiveAgentId: (id: string | null) => void;
  ragExclude: string;
  setRagExclude: (v: string) => void;
  ragMeta: RagMeta | null;
  setRagMeta: (m: RagMeta | null) => void;
  onLockVault: () => void;
  onRefreshVaultLabels: () => void;
};

function profileToolsToSet(allowlist: AgentProfile["toolAllowlist"], all: string[]): Set<string> {
  if (allowlist === "all") return new Set(all);
  return new Set(allowlist.filter((n) => all.includes(n)));
}

function setToAllowlist(tools: Set<string>, all: string[]): AgentProfile["toolAllowlist"] {
  if (tools.size === all.length) return "all";
  return [...tools].filter((n) => all.includes(n));
}

export function SettingsPanel({
  vault,
  rag,
  agentProfiles,
  connectorStore,
  locked,
  apiKey,
  setApiKey,
  model,
  setModel,
  workerModel,
  setWorkerModel,
  customModel,
  setCustomModel,
  customWorkerModel,
  setCustomWorkerModel,
  approvalMode,
  setApprovalMode,
  budgetMode,
  setBudgetMode,
  enabledTools,
  setEnabledTools,
  activeAgentId,
  setActiveAgentId,
  ragExclude,
  setRagExclude,
  ragMeta,
  setRagMeta,
  onLockVault,
  onRefreshVaultLabels,
}: SettingsPanelProps) {
  const allToolNames = useMemo(() => AGENT_TOOLS.map((t) => t.function.name), []);
  const [msg, setMsg] = useState("");
  const [ragMsg, setRagMsg] = useState("");
  const [ragBusy, setRagBusy] = useState(false);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSystem, setDraftSystem] = useState("");
  const [draftOrch, setDraftOrch] = useState("");
  const [draftWorker, setDraftWorker] = useState("");
  const [draftTools, setDraftTools] = useState<Set<string>>(new Set(allToolNames));
  const [draftConnectorIds, setDraftConnectorIds] = useState<string[]>([]);
  const [draftBudget, setDraftBudget] = useState<AgentBudgetMode>("budget");
  const [draftApproval, setDraftApproval] = useState<ApprovalMode>("ask");
  const [restName, setRestName] = useState("");
  const [restBaseUrl, setRestBaseUrl] = useState("");
  const [mcpJson, setMcpJson] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [pendingSecrets, setPendingSecrets] = useState<
    Array<{ label: string; value: string; path: string }>
  >([]);
  const [sanitizedMcp, setSanitizedMcp] = useState("");

  const refreshProfiles = useCallback(async () => {
    setProfiles(await agentProfiles.list());
  }, [agentProfiles]);

  const refreshConnectors = useCallback(async () => {
    setConnectors(await connectorStore.list());
  }, [connectorStore]);

  const migrateGithub = useCallback(async () => {
    const list = await connectorStore.list();
    if (list.some((c) => c.id === "github-rest")) return;
    const token = await vault.getByLabel(GH_TOKEN_LABEL);
    if (!token) return;
    await connectorStore.put(githubRestTemplate());
    await refreshConnectors();
    setMsg("Migrated github_token → GitHub REST connector");
  }, [connectorStore, refreshConnectors, vault]);

  useEffect(() => {
    void refreshProfiles();
    void refreshConnectors();
    void migrateGithub();
  }, [migrateGithub, refreshConnectors, refreshProfiles]);

  const editing = profiles.find((p) => p.id === editingId) ?? null;

  const startNewProfile = () => {
    setEditingId("__new__");
    setDraftName("New agent");
    setDraftSystem("");
    setDraftOrch(model);
    setDraftWorker(workerModel);
    setDraftTools(new Set(enabledTools));
    setDraftConnectorIds([]);
    setDraftBudget(budgetMode);
    setDraftApproval(approvalMode);
  };

  const startEditProfile = (p: AgentProfile) => {
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftSystem(p.systemPrompt ?? "");
    setDraftOrch(p.orchestratorModel ?? model);
    setDraftWorker(p.workerModel ?? workerModel);
    setDraftTools(profileToolsToSet(p.toolAllowlist, allToolNames));
    setDraftConnectorIds([...p.connectorIds]);
    setDraftBudget(p.budgetMode ?? "budget");
    setDraftApproval(p.approvalMode ?? "ask");
  };

  const saveProfile = async () => {
    const now = new Date().toISOString();
    const row: AgentProfile =
      editingId === "__new__"
        ? {
            id: crypto.randomUUID(),
            name: draftName.trim() || "Agent",
            systemPrompt: draftSystem.trim() || undefined,
            orchestratorModel: draftOrch.trim() || undefined,
            workerModel: draftWorker.trim() || undefined,
            toolAllowlist: setToAllowlist(draftTools, allToolNames),
            connectorIds: draftConnectorIds,
            budgetMode: draftBudget,
            approvalMode: draftApproval,
            createdAt: now,
            updatedAt: now,
          }
        : {
            ...(editing as AgentProfile),
            name: draftName.trim() || editing!.name,
            systemPrompt: draftSystem.trim() || undefined,
            orchestratorModel: draftOrch.trim() || undefined,
            workerModel: draftWorker.trim() || undefined,
            toolAllowlist: setToAllowlist(draftTools, allToolNames),
            connectorIds: draftConnectorIds,
            budgetMode: draftBudget,
            approvalMode: draftApproval,
          };
    await agentProfiles.put(row);
    if (!activeAgentId) {
      await agentProfiles.setActiveId(row.id);
      setActiveAgentId(row.id);
    }
    setEditingId(null);
    await refreshProfiles();
    setMsg(`Saved agent “${row.name}”`);
  };

  const deleteProfile = async (id: string) => {
    await agentProfiles.remove(id);
    if (activeAgentId === id) setActiveAgentId(null);
    if (editingId === id) setEditingId(null);
    await refreshProfiles();
    setMsg("Agent deleted");
  };

  const saveVaultKeys = async () => {
    const m = normalizeModelId(customModel.trim() || model);
    const w = normalizeModelId(customWorkerModel.trim() || workerModel);
    if (apiKey.trim()) await vault.putByLabel("openrouter_api_key", apiKey.trim());
    await vault.putByLabel("openrouter_model", m);
    await vault.putByLabel("openrouter_worker_model", w);
    setModel(m);
    setWorkerModel(w);
    setMsg(`Saved orch=${m} · worker=${w}`);
    await onRefreshVaultLabels();
  };

  const toggleDraftTool = (name: string) => {
    setDraftTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const parseMcpPaste = () => {
    const out = parseMcpDefinition(mcpJson);
    setSanitizedMcp(out.sanitizedDef);
    setPendingSecrets(
      out.secrets.map((s) => ({ label: s.suggestedLabel, value: s.value, path: s.path })),
    );
    setMsg(
      out.secrets.length
        ? `Found ${out.secrets.length} secret(s) — confirm labels then save`
        : "No secrets detected — review and save connector",
    );
  };

  const confirmMcpSecrets = async () => {
    for (const s of pendingSecrets) {
      if (s.label.trim()) await vault.putByLabel(s.label.trim(), s.value);
    }
    await onRefreshVaultLabels();
    setPendingSecrets([]);
    setMsg("Secrets stored in vault");
  };

  const saveMcpConnector = async () => {
    const built = mcpConnectorFromSanitized(sanitizedMcp || mcpJson, mcpName.trim() || "MCP");
    if ("error" in built) {
      setMsg(built.error);
      return;
    }
    await connectorStore.put(built);
    setMcpJson("");
    setMcpName("");
    setSanitizedMcp("");
    await refreshConnectors();
    setEnabledTools((prev) => {
      const next = new Set(prev);
      next.add("mcp_list_tools");
      next.add("mcp_call");
      return next;
    });
    setMsg(`Saved MCP connector “${built.name}”`);
  };

  const addRestConnector = async () => {
    if (!restName.trim() || !restBaseUrl.trim()) {
      setMsg("REST name + base URL required");
      return;
    }
    const row = {
      id: crypto.randomUUID(),
      kind: "rest" as const,
      name: restName.trim(),
      baseUrl: restBaseUrl.trim(),
      headers: {} as Record<string, string>,
    };
    await connectorStore.put(row);
    setRestName("");
    setRestBaseUrl("");
    await refreshConnectors();
    setEnabledTools((prev) => {
      const next = new Set(prev);
      next.add("rest_request");
      return next;
    });
    setMsg(`Added REST connector “${row.name}”`);
  };

  const addGithubTemplate = async () => {
    const token = await vault.getByLabel(GH_TOKEN_LABEL);
    if (!token) {
      setMsg("Add github_token in Vault/API keys first");
      return;
    }
    await connectorStore.put(githubRestTemplate());
    await refreshConnectors();
    setEnabledTools((prev) => {
      const next = new Set(prev);
      next.add("rest_request");
      return next;
    });
    setMsg("GitHub REST template added");
  };

  const removeConnector = async (id: string) => {
    await connectorStore.remove(id);
    await refreshConnectors();
    setMsg("Connector removed");
  };

  const renderToolChips = (tools: Set<string>, onToggle: (name: string) => void) => (
    <div className="tool-groups">
      {GROUP_ORDER.map((group) => (
        <div key={group} className="tool-group">
          <h4>{group}</h4>
          <div className="chips tool-chip-grid">
            {TOOL_GROUPS[group]
              .filter((n) => allToolNames.includes(n))
              .map((name) => (
                <label key={name} className={`chip-toggle${tools.has(name) ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={tools.has(name)}
                    onChange={() => onToggle(name)}
                  />
                  {name}
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="panel settings-panel">
      <h2>Settings</h2>
      {msg ? <p className="hint wrap">{msg}</p> : null}

      <h3>Agent</h3>
      <p className="hint wrap">
        Agent profiles override model, system prompt, tool allowlist, connectors, budget, and approval
        for chat runs.
      </p>
      <div className="row">
        <select
          value={activeAgentId ?? ""}
          onChange={(e) => {
            const id = e.target.value || null;
            void (async () => {
              await agentProfiles.setActiveId(id);
              setActiveAgentId(id);
              if (id) {
                const p = await agentProfiles.get(id);
                if (p) setEnabledTools(() => profileToolsToSet(p.toolAllowlist, allToolNames));
              }
            })();
          }}
        >
          <option value="">Default (global tools / budget)</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={startNewProfile}>
          New
        </button>
      </div>
      {profiles.length > 0 ? (
        <ul className="list compact">
          {profiles.map((p) => (
            <li key={p.id} className="row">
              <span>
                <strong>{p.name}</strong>
                {activeAgentId === p.id ? " (active)" : ""}
              </span>
              <button type="button" onClick={() => startEditProfile(p)}>
                Edit
              </button>
              <button type="button" className="danger" onClick={() => void deleteProfile(p.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No agents yet — create one to pin tools and connectors per workflow.</p>
      )}
      {editingId ? (
        <div className="agent-editor">
          <label className="hint">Name</label>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
          <label className="hint">System prompt (optional)</label>
          <textarea
            rows={4}
            value={draftSystem}
            onChange={(e) => setDraftSystem(e.target.value)}
            placeholder="Extra instructions for this agent…"
          />
          <label className="hint">Orchestrator model</label>
          <select value={draftOrch} onChange={(e) => setDraftOrch(e.target.value)}>
            {MODEL_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="hint">Worker model</label>
          <select value={draftWorker} onChange={(e) => setDraftWorker(e.target.value)}>
            {MODEL_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="hint">Budget mode</label>
          <select
            value={draftBudget}
            onChange={(e) => setDraftBudget(e.target.value as AgentBudgetMode)}
          >
            <option value="budget">Budget</option>
            <option value="normal">Normal</option>
          </select>
          <label className="hint">Approval mode</label>
          <select
            value={draftApproval}
            onChange={(e) => setDraftApproval(e.target.value as ApprovalMode)}
          >
            <option value="ask">Ask</option>
            <option value="auto_llm">Auto LLM</option>
            <option value="auto_all">Auto all</option>
          </select>
          <label className="hint">Connector allowlist (empty = all connectors)</label>
          <div className="chips">
            {connectors.map((c) => (
              <label key={c.id} className="chip-toggle">
                <input
                  type="checkbox"
                  checked={draftConnectorIds.includes(c.id)}
                  onChange={() =>
                    setDraftConnectorIds((prev) =>
                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
          <p className="hint">Tool allowlist</p>
          {renderToolChips(draftTools, toggleDraftTool)}
          <div className="row">
            <button type="button" className="primary" onClick={() => void saveProfile()}>
              Save agent
            </button>
            <button type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <h3>Tools</h3>
      <p className="hint wrap">
        Global tool allowlist{activeAgentId ? " (active agent overrides at run time)" : ""}.
      </p>
      <div className="row">
        <button type="button" onClick={() => setEnabledTools(() => new Set(allToolNames))}>
          Enable all
        </button>
        <button type="button" onClick={() => setEnabledTools(() => new Set())}>
          Disable all
        </button>
      </div>
      {renderToolChips(enabledTools, (name) =>
        setEnabledTools((prev) => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        }),
      )}

      <h3>Connectors</h3>
      <p className="hint wrap">
        REST and MCP connectors power <code>rest_request</code>, <code>mcp_list_tools</code>, and{" "}
        <code>mcp_call</code>.
      </p>
      {connectors.length === 0 ? (
        <p className="hint">No connectors yet.</p>
      ) : (
        <ul className="list">
          {connectors.map((c) => (
            <li key={c.id} className="row">
              <span>
                <strong>{c.name}</strong> · {c.kind}
                {c.kind === "rest" ? ` · ${c.baseUrl}` : ` · ${c.url}`}
              </span>
              <button type="button" className="danger" onClick={() => void removeConnector(c.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="connector-forms">
        <h4>Add REST</h4>
        <input
          value={restName}
          onChange={(e) => setRestName(e.target.value)}
          placeholder="Connector name"
        />
        <input
          value={restBaseUrl}
          onChange={(e) => setRestBaseUrl(e.target.value)}
          placeholder="https://api.example.com"
        />
        <button type="button" onClick={() => void addRestConnector()}>
          Add REST
        </button>
        <h4>GitHub template</h4>
        <button type="button" onClick={() => void addGithubTemplate()}>
          Add from GitHub template
        </button>
        <h4>Paste MCP JSON</h4>
        <textarea
          rows={5}
          value={mcpJson}
          onChange={(e) => setMcpJson(e.target.value)}
          placeholder='{"mcpServers":{"demo":{"url":"https://…"}}}'
          className="mono"
        />
        <input
          value={mcpName}
          onChange={(e) => setMcpName(e.target.value)}
          placeholder="MCP connector name"
        />
        <div className="row">
          <button type="button" onClick={parseMcpPaste}>
            Parse secrets
          </button>
          <button type="button" className="primary" onClick={() => void saveMcpConnector()}>
            Save MCP connector
          </button>
        </div>
        {pendingSecrets.length > 0 ? (
          <div className="secret-confirm">
            <p className="hint">Confirm vault labels for extracted secrets:</p>
            {pendingSecrets.map((s, i) => (
              <div key={s.path} className="row">
                <input
                  value={s.label}
                  onChange={(e) =>
                    setPendingSecrets((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
                <span className="hint">{s.path}</span>
              </div>
            ))}
            <button type="button" className="primary" onClick={() => void confirmMcpSecrets()}>
              Store secrets in vault
            </button>
          </div>
        ) : null}
        {sanitizedMcp ? (
          <pre className="hint mono wrap" style={{ maxHeight: 120, overflow: "auto" }}>
            {sanitizedMcp}
          </pre>
        ) : null}
      </div>

      <h3>Device RAG</h3>
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
                setEnabledTools((prev) => {
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

      <h3>Vault / API keys</h3>
      <label className="hint">OpenRouter API key</label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="sk-or-v1-…"
      />
      <label className="hint">Orchestrator model (global default)</label>
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {MODEL_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} — {p.id}
          </option>
        ))}
      </select>
      <input
        className="mono"
        value={customModel}
        onChange={(e) => setCustomModel(e.target.value)}
        placeholder="custom orchestrator model id"
      />
      <label className="hint">Worker model</label>
      <select value={workerModel} onChange={(e) => setWorkerModel(e.target.value)}>
        {MODEL_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} — {p.id}
          </option>
        ))}
      </select>
      <input
        className="mono"
        value={customWorkerModel}
        onChange={(e) => setCustomWorkerModel(e.target.value)}
        placeholder="custom worker model id"
      />
      <label className="hint">GitHub token (vault label github_token)</label>
      <input
        type="password"
        placeholder="ghp_…"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v) void vault.putByLabel(GH_TOKEN_LABEL, v);
        }}
      />
      <div className="row">
        <button type="button" className="primary" onClick={() => void saveVaultKeys()}>
          Save keys
        </button>
        <button type="button" className="danger" onClick={onLockVault}>
          Lock vault
        </button>
      </div>

      <h3>Advanced</h3>
      <label className="hint">Global approval mode</label>
      <select
        value={approvalMode}
        onChange={(e) => setApprovalMode(e.target.value as ApprovalMode)}
      >
        <option value="ask">Ask each sensitive action</option>
        <option value="auto_llm">Auto (LLM judges intent)</option>
        <option value="auto_all">Auto-approve all (this browser)</option>
      </select>
      <label className="hint">Global token budget</label>
      <select
        value={budgetMode}
        onChange={(e) => setBudgetMode(e.target.value as AgentBudgetMode)}
      >
        <option value="budget">Budget — page_digest + worker parse, 16 steps</option>
        <option value="normal">Normal — full tools / 32 steps</option>
      </select>
    </div>
  );
}

import {
  AGENT_TOOLS,
  AgentLoop,
  DEFAULT_MODEL,
  DEFAULT_WORKER_MODEL,
  MODEL_PRESETS,
  MemoryStore,
  OpenRouterClient,
  SessionStore,
  Vault,
  getProtocolVersion,
  normalizeModelId,
  type AgentEvent,
  type ApprovalMode,
  type ChatMessage,
  type ChatSession,
  type LlmUsage,
  type SessionMessage,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChromeBridge } from "../lib/chrome-bridge";
import { ApprovalBanner } from "./ApprovalBanner";
import { ToolChip, type ToolChipData } from "./ToolChip";

const KEY_LABEL = "openrouter_api_key";
const MODEL_LABEL = "openrouter_model";
const WORKER_MODEL_LABEL = "openrouter_worker_model";
const TOOLS_STORAGE_KEY = "combo_x_enabled_tools";
const APPROVAL_KEY = "combo_x_approval_mode";

type TabId = "chat" | "sessions" | "settings" | "vault" | "tools" | "mcp";

type UiTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ToolChipData[];
  usage?: LlmUsage;
};

const ALL_TOOL_NAMES = AGENT_TOOLS.map((t) => t.function.name);
const ZERO: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
};

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function loadEnabledTools(): Set<string> {
  try {
    const raw = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (!raw) return new Set(ALL_TOOL_NAMES);
    const saved = (JSON.parse(raw) as string[]).filter((n) => ALL_TOOL_NAMES.includes(n));
    // v0.3 migrate: enable new scrape/parse tools if older allowlist lacked them
    if (!saved.includes("parse_data") || !saved.includes("get_interactive")) {
      return new Set(ALL_TOOL_NAMES);
    }
    return new Set(saved);
  } catch {
    return new Set(ALL_TOOL_NAMES);
  }
}

function loadApproval(): ApprovalMode {
  const v = localStorage.getItem(APPROVAL_KEY);
  if (v === "auto_llm" || v === "auto_all" || v === "ask") return v;
  return "ask";
}

export function App() {
  const vault = useMemo(() => new Vault(), []);
  const memory = useMemo(() => new MemoryStore(), []);
  const sessions = useMemo(() => new SessionStore(), []);
  const bridge = useMemo(() => createChromeBridge(), []);

  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  const [locked, setLocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [workerModel, setWorkerModel] = useState(DEFAULT_WORKER_MODEL);
  const [customModel, setCustomModel] = useState("");
  const [customWorkerModel, setCustomWorkerModel] = useState("");
  const [tab, setTab] = useState<TabId>("chat");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [settingsMsg, setSettingsMsg] = useState("");
  const [vaultLabels, setVaultLabels] = useState<string[]>([]);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => loadEnabledTools());
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => loadApproval());
  const [pendingApproval, setPendingApproval] = useState<{
    tool: string;
    args: Record<string, unknown>;
    resolve: (allow: boolean) => void;
  } | null>(null);
  const [sessionList, setSessionList] = useState<ChatSession[]>([]);
  const [sessionQuery, setSessionQuery] = useState("");
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessionUsage, setSessionUsage] = useState<LlmUsage>(ZERO);
  const [lastTurnUsage, setLastTurnUsage] = useState<LlmUsage | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const approvalModeRef = useRef(approvalMode);

  useEffect(() => {
    approvalModeRef.current = approvalMode;
    localStorage.setItem(APPROVAL_KEY, approvalMode);
  }, [approvalMode]);

  useEffect(() => {
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify([...enabledTools]));
  }, [enabledTools]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, status, pendingApproval]);

  const [setupMsg, setSetupMsg] = useState("");
  const [ragPathHint, setRagPathHint] = useState(
    () => localStorage.getItem("combo_x_rag_path_hint") ?? "",
  );
  const [connectors, setConnectors] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("combo_x_connectors") ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  const applySetupPayload = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== "object") return false;
    const p = payload as {
      type?: string;
      tools?: string[];
      approvalMode?: string;
      ragPathHint?: string | null;
      connectors?: string[];
    };
    if (p.type !== "combo-x-setup") return false;
    if (Array.isArray(p.tools)) {
      setEnabledTools(new Set(p.tools.filter((n) => ALL_TOOL_NAMES.includes(n))));
    }
    if (p.approvalMode === "ask" || p.approvalMode === "auto_llm" || p.approvalMode === "auto_all") {
      setApprovalMode(p.approvalMode);
    }
    if (p.ragPathHint != null) {
      setRagPathHint(p.ragPathHint);
      localStorage.setItem("combo_x_rag_path_hint", p.ragPathHint);
    }
    if (Array.isArray(p.connectors)) {
      setConnectors(p.connectors);
      localStorage.setItem("combo_x_connectors", JSON.stringify(p.connectors));
    }
    setSetupMsg(`Applied setup (${p.tools?.length ?? 0} tools, approval=${p.approvalMode ?? "?"})`);
    return true;
  }, []);

  useEffect(() => {
    const fromStorage = () => {
      try {
        const raw = localStorage.getItem("combo_x_setup_payload");
        if (raw) applySetupPayload(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    };
    fromStorage();
    void chrome.storage.local.get("combo_x_setup_payload").then((res) => {
      if (res.combo_x_setup_payload) applySetupPayload(res.combo_x_setup_payload);
    });
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.combo_x_setup_payload?.newValue) {
        applySetupPayload(changes.combo_x_setup_payload.newValue);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    const onFocus = () => fromStorage();
    window.addEventListener("focus", onFocus);
    return () => {
      chrome.storage.onChanged.removeListener(onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [applySetupPayload]);

  const refreshVaultLabels = useCallback(async () => {
    if (!vault.isUnlocked()) return setVaultLabels([]);
    setVaultLabels(await vault.listLabels());
  }, [vault]);

  const refreshSessions = useCallback(async () => {
    setSessionList(await sessions.list(40));
  }, [sessions]);

  const persistSession = useCallback(
    async (session: ChatSession, nextTurns: UiTurn[], usage: LlmUsage) => {
      const msgs: SessionMessage[] = nextTurns.flatMap((t) => {
        const base: SessionMessage = {
          id: t.id,
          role: t.role,
          content: t.content,
          createdAt: new Date().toISOString(),
          usage: t.usage,
          tools: t.tools,
        };
        return [base];
      });
      const title =
        nextTurns.find((t) => t.role === "user")?.content.slice(0, 60) || session.title || "Chat";
      const updated: ChatSession = {
        ...session,
        title,
        messages: msgs,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
        updatedAt: new Date().toISOString(),
      };
      await sessions.save(updated);
      setCurrentSession(updated);
      await refreshSessions();
    },
    [refreshSessions, sessions],
  );

  useEffect(() => {
    void (async () => {
      const initialized = await vault.isInitialized();
      setNeedsOnboarding(!initialized);
      if (initialized) setLocked(true);
      setReady(true);
      await refreshSessions();
    })();
  }, [refreshSessions, vault]);

  const afterUnlock = useCallback(async () => {
    const key = await vault.getByLabel(KEY_LABEL);
    let storedModel = await vault.getByLabel(MODEL_LABEL);
    const normalized = normalizeModelId(storedModel);
    if (storedModel !== normalized) {
      await vault.putByLabel(MODEL_LABEL, normalized);
      storedModel = normalized;
    }
    setModel(normalized);
    const storedWorker = await vault.getByLabel(WORKER_MODEL_LABEL);
    setWorkerModel(storedWorker ? normalizeModelId(storedWorker) : DEFAULT_WORKER_MODEL);
    if (key) setApiKey(key);
    setNeedsOnboarding(!key);
    setLocked(false);
    await refreshVaultLabels();
    if (!currentSession) {
      const s = await sessions.create("New chat");
      setCurrentSession(s);
    }
    setStatus("Unlocked");
  }, [currentSession, refreshVaultLabels, sessions, vault]);

  const unlockExisting = useCallback(async () => {
    const ok = await vault.unlock(passphrase);
    if (!ok) return setStatus("Wrong passphrase");
    await afterUnlock();
  }, [afterUnlock, passphrase, vault]);

  const completeOnboarding = useCallback(async () => {
    if (!passphrase || !apiKey.trim()) return setStatus("Passphrase + OpenRouter key required");
    const initialized = await vault.isInitialized();
    if (!initialized) await vault.setPassphrase(passphrase);
    else if (!(await vault.unlock(passphrase))) return setStatus("Wrong passphrase");
    const m = normalizeModelId(model);
    const w = normalizeModelId(workerModel);
    await vault.putByLabel(KEY_LABEL, apiKey.trim());
    await vault.putByLabel(MODEL_LABEL, m);
    await vault.putByLabel(WORKER_MODEL_LABEL, w);
    setModel(m);
    setWorkerModel(w);
    setNeedsOnboarding(false);
    setLocked(false);
    const s = await sessions.create("New chat");
    setCurrentSession(s);
    await refreshVaultLabels();
    setTab("chat");
  }, [apiKey, model, workerModel, passphrase, refreshVaultLabels, sessions, vault]);

  const newChat = useCallback(async () => {
    abortRef.current?.abort();
    const s = await sessions.create("New chat");
    setCurrentSession(s);
    setTurns([]);
    historyRef.current = [];
    setSessionUsage(ZERO);
    setLastTurnUsage(null);
    setTab("chat");
    await refreshSessions();
  }, [refreshSessions, sessions]);

  const loadSession = useCallback(async (id: string) => {
    const s = await sessions.get(id);
    if (!s) return;
    setCurrentSession(s);
    setTurns(
      s.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          tools: m.tools as ToolChipData[] | undefined,
          usage: m.usage,
        })),
    );
    historyRef.current = s.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    setSessionUsage({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: s.totalTokens,
      estimatedCostUsd: s.estimatedCostUsd,
    });
    setTab("chat");
  }, [sessions]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setPendingApproval(null);
    setStatus("Stopped");
  }, []);

  const send = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || running) return;
      if (!vault.isUnlocked()) return setStatus("Unlock vault first");
      const key = apiKey || (await vault.getByLabel(KEY_LABEL));
      if (!key) {
        setTab("settings");
        return setStatus("Missing OpenRouter key");
      }

      let session = currentSession;
      if (!session) {
        session = await sessions.create(text.slice(0, 60));
        setCurrentSession(session);
      }

      if (!overrideText) setInput("");
      const userTurn: UiTurn = { id: crypto.randomUUID(), role: "user", content: text };
      const assistantId = crypto.randomUUID();
      let nextTurns = [...turns, userTurn, { id: assistantId, role: "assistant" as const, content: "" }];
      setTurns(nextTurns);
      setRunning(true);
      setStatus("Working…");
      setLastTurnUsage(null);

      const controller = new AbortController();
      abortRef.current = controller;
      const llm = new OpenRouterClient({ apiKey: key });
      const agent = new AgentLoop(llm, bridge, memory, sessions);
      let turnUsage = ZERO;
      const toolMap = new Map<string, ToolChipData>();

      const flushTools = () => {
        const tools = [...toolMap.values()];
        setTurns((prev) =>
          prev.map((t) => (t.id === assistantId ? { ...t, tools: [...tools] } : t)),
        );
      };

      const onEvent = (event: AgentEvent) => {
        if (event.type === "status" && event.message) setStatus(event.message);
        if (event.type === "usage" && event.usage) {
          turnUsage = {
            promptTokens: turnUsage.promptTokens + event.usage.promptTokens,
            completionTokens: turnUsage.completionTokens + event.usage.completionTokens,
            totalTokens: turnUsage.totalTokens + event.usage.totalTokens,
            estimatedCostUsd: turnUsage.estimatedCostUsd + event.usage.estimatedCostUsd,
          };
          setLastTurnUsage(turnUsage);
          setSessionUsage((u) => ({
            promptTokens: u.promptTokens + event.usage!.promptTokens,
            completionTokens: u.completionTokens + event.usage!.completionTokens,
            totalTokens: u.totalTokens + event.usage!.totalTokens,
            estimatedCostUsd: u.estimatedCostUsd + event.usage!.estimatedCostUsd,
          }));
        }
        if (event.type === "tool_approval" && event.resolve) {
          setPendingApproval({
            tool: event.tool ?? "tool",
            args: event.args ?? {},
            resolve: event.resolve,
          });
        }
        if (event.type === "tool_start" && event.tool) {
          const id = event.toolCallId ?? crypto.randomUUID();
          toolMap.set(id, {
            id,
            name: event.tool,
            args: event.args ?? {},
            status: "running",
          });
          flushTools();
        }
        if (event.type === "tool_result" && event.tool) {
          const id = event.toolCallId ?? crypto.randomUUID();
          const prev = toolMap.get(id);
          const denied =
            typeof event.result === "object" &&
            event.result &&
            "error" in event.result &&
            String((event.result as { error?: string }).error).includes("denied");
          toolMap.set(id, {
            id,
            name: event.tool,
            args: event.args ?? prev?.args ?? {},
            result: event.result,
            status: denied ? "denied" : "done",
          });
          flushTools();
        }
        if (event.type === "assistant_delta" && event.message) {
          setTurns((prev) =>
            prev.map((t) => (t.id === assistantId ? { ...t, content: event.message ?? "" } : t)),
          );
        }
        if (event.type === "error" && event.message) setStatus(event.message);
      };

      try {
        const result = await agent.run({
          model: normalizeModelId(model),
          workerModel: normalizeModelId(workerModel),
          userMessage: text,
          history: historyRef.current,
          signal: controller.signal,
          enabledTools: [...enabledTools],
          approvalMode: approvalModeRef.current,
          approvalModel: normalizeModelId(workerModel),
          maxSteps: 32,
          onEvent,
        });
        historyRef.current = result.messages.filter((m) => m.role !== "system");
        nextTurns = nextTurns.map((t) =>
          t.id === assistantId
            ? {
                ...t,
                content: result.finalText || t.content || "(no text)",
                tools: [...toolMap.values()],
                usage: turnUsage,
              }
            : t,
        );
        setTurns(nextTurns);
        setLastTurnUsage(turnUsage);
        if (session) await persistSession(session, nextTurns, {
          ...sessionUsage,
          totalTokens: sessionUsage.totalTokens + turnUsage.totalTokens,
          estimatedCostUsd: sessionUsage.estimatedCostUsd + turnUsage.estimatedCostUsd,
          promptTokens: sessionUsage.promptTokens + turnUsage.promptTokens,
          completionTokens: sessionUsage.completionTokens + turnUsage.completionTokens,
        });
        setStatus(
          result.hitStepLimit
            ? "Step limit — say “continue” to keep going"
            : result.aborted
              ? "Stopped"
              : "Done",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId ? { ...t, content: t.content || `Error: ${msg}` } : t,
          ),
        );
        setStatus("Error");
      } finally {
        setRunning(false);
        setPendingApproval(null);
        abortRef.current = null;
      }
    },
    [
      apiKey,
      bridge,
      currentSession,
      enabledTools,
      input,
      memory,
      model,
      workerModel,
      persistSession,
      running,
      sessionUsage,
      sessions,
      turns,
      vault,
    ],
  );

  if (!ready) {
    return (
      <div className="app">
        <div className="onboarding">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if ((needsOnboarding && !vault.isUnlocked() && !locked) || (locked && !vault.isUnlocked())) {
    const isUnlock = locked || (!needsOnboarding && !vault.isUnlocked());
    return (
      <div className="app">
        <header className="header">
          <div className="brand">
            Combo<span>-X</span>
          </div>
          <div className="meta">v{getProtocolVersion()}</div>
        </header>
        <div className="onboarding">
          <h1>{isUnlock ? "Unlock vault" : "Local agent. Your keys."}</h1>
          {!isUnlock ? (
            <p>
              Encrypted vault (AES-GCM). OpenRouter BYOK. Sessions persist locally. Sync is planned —
              not in this build.
            </p>
          ) : null}
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="passphrase"
            onKeyDown={(e) => {
              if (e.key === "Enter") void (isUnlock ? unlockExisting() : completeOnboarding());
            }}
          />
          {!isUnlock ? (
            <>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-…"
              />
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {MODEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() => void (isUnlock ? unlockExisting() : completeOnboarding())}
            >
              {isUnlock ? "Unlock" : "Start"}
            </button>
            {!isUnlock ? (
              <button type="button" onClick={() => setLocked(true)}>
                Unlock existing
              </button>
            ) : null}
          </div>
          {status ? <p className="hint">{status}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Combo<span>-X</span>
        </div>
        <div className="meta" title="Session token totals">
          {formatUsd(sessionUsage.estimatedCostUsd)} · {sessionUsage.totalTokens.toLocaleString()} tok
        </div>
      </header>

      <nav className="tabs">
        {(
          [
            ["chat", "Chat"],
            ["sessions", "Sessions"],
            ["settings", "Settings"],
            ["vault", "Vault"],
            ["tools", "Tools"],
            ["mcp", "Setup"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "tab active" : "tab"}
            onClick={() => {
              setTab(id);
              if (id === "sessions") void refreshSessions();
              if (id === "vault") void refreshVaultLabels();
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "chat" ? (
        <>
          <div className="messages">
            {turns.length === 0 ? (
              <div className="bubble system">
                Hi — I’m Combo-X. I can open tabs (<code>open_tab</code>), scrape tables, export CSV,
                and keep sessions. Approval mode: <strong>{approvalMode}</strong>.
              </div>
            ) : null}
            {turns.map((t) => (
              <div key={t.id} className={`bubble ${t.role}`}>
                <div>{t.content}</div>
                {t.tools && t.tools.length > 0 ? (
                  <div className="chips">
                    {t.tools.map((tool) => (
                      <ToolChip key={tool.id} tool={tool} />
                    ))}
                  </div>
                ) : null}
                {t.usage && t.role === "assistant" ? (
                  <div className="turn-usage">
                    {t.usage.totalTokens} tok · {formatUsd(t.usage.estimatedCostUsd)}
                  </div>
                ) : null}
              </div>
            ))}
            {pendingApproval ? (
              <ApprovalBanner
                tool={pendingApproval.tool}
                args={pendingApproval.args}
                onAllow={() => {
                  pendingApproval.resolve(true);
                  setPendingApproval(null);
                }}
                onDeny={() => {
                  pendingApproval.resolve(false);
                  setPendingApproval(null);
                }}
                onAutoAll={() => {
                  setApprovalMode("auto_all");
                  approvalModeRef.current = "auto_all";
                  pendingApproval.resolve(true);
                  setPendingApproval(null);
                }}
                onAutoSmart={() => {
                  setApprovalMode("auto_llm");
                  approvalModeRef.current = "auto_llm";
                  pendingApproval.resolve(true);
                  setPendingApproval(null);
                }}
              />
            ) : null}
            {status && running ? <div className="bubble system">{status}</div> : null}
            <div ref={bottomRef} />
          </div>
          <div className="composer">
            <div className="row">
              <select
                className="grow"
                value={MODEL_PRESETS.some((p) => p.id === model) ? model : "__custom__"}
                onChange={(e) => {
                  if (e.target.value === "__custom__") return;
                  setModel(e.target.value);
                  void vault.putByLabel(MODEL_LABEL, e.target.value);
                }}
              >
                {MODEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void newChat()}>
                New
              </button>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask… or “continue” after a step limit"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={running || !input.trim()}
                onClick={() => void send()}
              >
                Send
              </button>
              <button type="button" className="danger" disabled={!running} onClick={stop}>
                STOP
              </button>
              <span className="hint" style={{ marginLeft: "auto" }}>
                {lastTurnUsage
                  ? `last: ${lastTurnUsage.totalTokens} tok`
                  : model === workerModel
                    ? `${enabledTools.size} tools`
                    : `orch≠worker`}
              </span>
            </div>
          </div>
        </>
      ) : null}

      {tab === "sessions" ? (
        <div className="panel">
          <h2>Sessions</h2>
          <p className="hint">Persisted in IndexedDB on this device. Sync across devices = planned.</p>
          <div className="row">
            <input
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
              placeholder="Search past sessions…"
            />
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  if (!sessionQuery.trim()) return refreshSessions();
                  setSessionList(await sessions.search(sessionQuery, 30));
                })()
              }
            >
              Search
            </button>
            <button type="button" className="primary" onClick={() => void newChat()}>
              New chat
            </button>
          </div>
          <ul className="list">
            {sessionList.map((s) => (
              <li key={s.id}>
                <button type="button" className="linkish" onClick={() => void loadSession(s.id)}>
                  <strong>{s.title || "Untitled"}</strong>
                  <br />
                  <span className="hint">
                    {new Date(s.updatedAt).toLocaleString()} · {s.totalTokens} tok ·{" "}
                    {formatUsd(s.estimatedCostUsd)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="panel">
          <h2>Settings</h2>
          <label className="hint">Approval mode</label>
          <select
            value={approvalMode}
            onChange={(e) => setApprovalMode(e.target.value as ApprovalMode)}
          >
            <option value="ask">Ask each sensitive action</option>
            <option value="auto_llm">Auto (LLM judges intent)</option>
            <option value="auto_all">Auto-approve all (this browser)</option>
          </select>
          <p className="hint wrap">
            Sensitive: click, type, click_index, type_index, open_tab, navigate, go_back, close_tab.
            Orchestrator plans; worker runs <code>parse_data</code>.
          </p>
          <label className="hint">OpenRouter API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-v1-…"
          />
          <label className="hint">Orchestrator model</label>
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
          <label className="hint">Worker model (parse_data / cheap extract)</label>
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
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() =>
                void (async () => {
                  const m = normalizeModelId(customModel.trim() || model);
                  const w = normalizeModelId(customWorkerModel.trim() || workerModel);
                  if (apiKey.trim()) await vault.putByLabel(KEY_LABEL, apiKey.trim());
                  await vault.putByLabel(MODEL_LABEL, m);
                  await vault.putByLabel(WORKER_MODEL_LABEL, w);
                  setModel(m);
                  setWorkerModel(w);
                  setSettingsMsg(`Saved orch=${m} · worker=${w}`);
                })()
              }
            >
              Save
            </button>
            <button
              type="button"
              className="danger"
              onClick={() =>
                void (async () => {
                  abortRef.current?.abort();
                  await vault.lock();
                  setLocked(true);
                  setApiKey("");
                })()
              }
            >
              Lock vault
            </button>
          </div>
          {settingsMsg ? <p className="hint">{settingsMsg}</p> : null}
        </div>
      ) : null}

      {tab === "vault" ? (
        <div className="panel">
          <h2>Vault</h2>
          <p className="hint wrap">
            Yes — secrets (API keys, model prefs) are AES-GCM encrypted with a key derived from your
            passphrase (PBKDF2). Bookmarks/reports/sessions are local plaintext IndexedDB for now
            (encrypt-at-rest for those is a sync-design item).
          </p>
          <ul className="list">
            {vaultLabels.map((l) => (
              <li key={l}>
                <code>{l}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "tools" ? (
        <div className="panel">
          <h2>Tools</h2>
          <div className="row">
            <button type="button" onClick={() => setEnabledTools(new Set(ALL_TOOL_NAMES))}>
              Enable all
            </button>
            <button type="button" onClick={() => setEnabledTools(new Set())}>
              Disable all
            </button>
          </div>
          <ul className="list tools">
            {AGENT_TOOLS.map((t) => {
              const name = t.function.name;
              return (
                <li key={name}>
                  <label className="tool-row">
                    <input
                      type="checkbox"
                      checked={enabledTools.has(name)}
                      onChange={() =>
                        setEnabledTools((prev) => {
                          const next = new Set(prev);
                          if (next.has(name)) next.delete(name);
                          else next.add(name);
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{name}</strong>
                      <br />
                      <span className="hint">{t.function.description}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {tab === "mcp" ? (
        <div className="panel">
          <h2>Setup ingest</h2>
          <p className="hint wrap">
            Open the setup page, tick tools / read-only MCP targets, then click “Send to Combo-X”.
            Payload type <code>combo-x-setup</code> is stored in extension localStorage +{" "}
            <code>chrome.storage.local</code> and applied when this panel focuses.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const url = chrome.runtime.getURL("setup/index.html");
              void chrome.tabs.create({ url });
            }}
          >
            Open setup page
          </button>
          {setupMsg ? <p className="hint wrap">{setupMsg}</p> : null}
          <p className="hint wrap">
            RAG path hint: <code>{ragPathHint || "(none)"}</code>
            <br />
            Connectors queued: {connectors.length ? connectors.join(", ") : "(none)"} — IdeaForge /
            Supabase / GitHub are <strong>read-only intents</strong> until MCP client ships.
          </p>
          <p className="hint wrap">
            Encrypted multi-device vault sync + conversation scale: planned only — see{" "}
            <code>docs/SYNC_AND_SCALE.md</code>. Vault secrets are AES-GCM today; sessions/artifacts
            are still local plaintext IDB.
          </p>
        </div>
      ) : null}
    </div>
  );
}

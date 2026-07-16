import {
  AGENT_TOOLS,
  ActionLogStore,
  AgentLoop,
  AgentProfileStore,
  ArtifactStore,
  AttachmentStore,
  ConnectorStore,
  DEFAULT_MODEL,
  DEFAULT_SKIP_DIRS,
  DEFAULT_WORKER_MODEL,
  MODEL_PRESETS,
  MemoryStore,
  OpenRouterClient,
  RagStore,
  SessionStore,
  Vault,
  ViewStore,
  extractTargetUrl,
  getProtocolVersion,
  leanHistory,
  normalizeModelId,
  parseAttachment,
  resolveAgentProfile,
  resultError,
  resultOk,
  summarizeResult,
  stripImageParts,
  TaskStore,
  UsageStore,
  PageExtensionStore,
  type AgentBudgetMode,
  type AgentEvent,
  type AgentProfile,
  type ApprovalMode,
  type AttachmentRecord,
  type ChatMessage,
  type ChatSession,
  type LlmUsage,
  type ProfileStore,
  type RagMeta,
  type RunContextSnapshot,
  type SessionMessage,
  type SiteProfile,
  type SubagentEvent,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChromeBridge } from "../lib/chrome-bridge";
import { ApprovalBanner } from "./ApprovalBanner";
import { BrowserPreview } from "./BrowserPreview";
import { copyText, shortConversationId } from "./chatClipboard";
import { MarkdownView } from "./MarkdownView";
import { MessageToolbar } from "./MessageToolbar";
import {
  PreviewDrawer,
  buildPreviewFromAttachment,
  buildPreviewFromMarkdown,
  type PreviewPayload,
} from "./PreviewDrawer";
import { ToolChip, type ToolChipData } from "./ToolChip";
import { ActivityPanel } from "./ActivityPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ViewsPanel } from "./ViewsPanel";
import { UsagePanel } from "./UsagePanel";
import { TasksPanel } from "./TasksPanel";
import { SubagentStrip, type SubagentRun } from "./SubagentStrip";
import { PageExtensionsPanel } from "./PageExtensionsPanel";
import { GROUP_ORDER, TOOL_GROUPS } from "./toolGroups";

const KEY_LABEL = "openrouter_api_key";
const MODEL_LABEL = "openrouter_model";
const WORKER_MODEL_LABEL = "openrouter_worker_model";
const TOOLS_STORAGE_KEY = "combo_x_enabled_tools";
const APPROVAL_KEY = "combo_x_approval_mode";
const BUDGET_KEY = "combo_x_budget_mode";
const RAG_EXCLUDE_KEY = "combo_x_rag_exclude";
const LAST_SESSION_KEY = "combo_x_last_session_id";

type TabId =
  | "chat"
  | "sessions"
  | "views"
  | "activity"
  | "usage"
  | "tasks"
  | "pageext"
  | "settings"
  | "vault"
  | "tools"
  | "mcp";

const PRIMARY_TABS: TabId[] = ["chat", "sessions", "views", "activity", "usage"];
const MORE_TABS: Array<{ id: TabId; label: string }> = [
  { id: "tasks", label: "Tasks" },
  { id: "pageext", label: "Page ext" },
  { id: "settings", label: "Settings" },
  { id: "vault", label: "Vault" },
  { id: "tools", label: "Tools" },
  { id: "mcp", label: "Workspace" },
];

async function getActiveTabMeta(): Promise<{
  url?: string;
  title?: string;
  tabId?: number;
}> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return {};
    return { url: tab.url, title: tab.title, tabId: tab.id };
  } catch {
    return {};
  }
}

type UiTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  bookmarked?: boolean;
  attachments?: Array<{ id: string; name: string; kind: string }>;
  tools?: ToolChipData[];
  usage?: LlmUsage;
  /** stream = chatStreaming; full = non-stream chat */
  delivery?: "stream" | "full";
  /** System + memories + tools attached to this user turn (not mid-stream). */
  runContext?: RunContextSnapshot;
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
    if (
      !saved.includes("parse_data") ||
      !saved.includes("get_interactive") ||
      !saved.includes("rag_search") ||
      !saved.includes("list_attachments") ||
      !saved.includes("save_view") ||
      !saved.includes("memory_list") ||
      !saved.includes("create_page_extension")
    ) {
      return new Set(ALL_TOOL_NAMES);
    }
    // Additive: turn on page_digest without wiping a custom allowlist
    const next = new Set(saved);
    if (!next.has("page_digest") && ALL_TOOL_NAMES.includes("page_digest")) {
      next.add("page_digest");
    }
    return next;
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
  const rag = useMemo(() => new RagStore(), []);
  const attachments = useMemo(() => new AttachmentStore(), []);
  const views = useMemo(() => new ViewStore(), []);
  const artifacts = useMemo(() => new ArtifactStore(), []);
  const actionLog = useMemo(() => new ActionLogStore(), []);
  const agentProfiles = useMemo(() => new AgentProfileStore(), []);
  const usageStore = useMemo(() => new UsageStore(), []);
  const taskStore = useMemo(() => new TaskStore(), []);
  const pageExtensions = useMemo(() => new PageExtensionStore(), []);
  const connectorStore = useMemo(() => new ConnectorStore(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profiles = useMemo<ProfileStore>(
    () => ({
      get: async (name) => {
        const raw = await vault.getByLabel(`site_profile:${name}`);
        if (!raw) return null;
        try {
          return JSON.parse(raw) as SiteProfile;
        } catch {
          return null;
        }
      },
      save: async (profile) => {
        await vault.putByLabel(`site_profile:${profile.name}`, JSON.stringify(profile));
      },
    }),
    [vault],
  );
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
  const [vaultLabels, setVaultLabels] = useState<string[]>([]);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => loadEnabledTools());
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => loadApproval());
  const [budgetMode, setBudgetMode] = useState<AgentBudgetMode>(() => {
    const v = localStorage.getItem(BUDGET_KEY);
    return v === "normal" ? "normal" : "budget";
  });
  const [ragExclude, setRagExclude] = useState(
    () => localStorage.getItem(RAG_EXCLUDE_KEY) ?? DEFAULT_SKIP_DIRS.join(", "),
  );
  const [pendingApproval, setPendingApproval] = useState<{
    tool: string;
    args: Record<string, unknown>;
    resolve: (allow: boolean) => void;
  } | null>(null);
  const [sessionList, setSessionList] = useState<ChatSession[]>([]);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionBookmarksOnly, setSessionBookmarksOnly] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessionUsage, setSessionUsage] = useState<LlmUsage>(ZERO);
  const [lastTurnUsage, setLastTurnUsage] = useState<LlmUsage | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentRecord[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachMsg, setAttachMsg] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [subagentRuns, setSubagentRuns] = useState<SubagentRun[]>([]);
  const [usageSessionFilter, setUsageSessionFilter] = useState<"all" | "session">("all");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [inspectTurnId, setInspectTurnId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const approvalModeRef = useRef(approvalMode);

  useEffect(() => {
    approvalModeRef.current = approvalMode;
    localStorage.setItem(APPROVAL_KEY, approvalMode);
  }, [approvalMode]);

  useEffect(() => {
    localStorage.setItem(BUDGET_KEY, budgetMode);
  }, [budgetMode]);

  useEffect(() => {
    localStorage.setItem(RAG_EXCLUDE_KEY, ragExclude);
  }, [ragExclude]);

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
  const [, setConnectors] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("combo_x_connectors") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [ragMeta, setRagMeta] = useState<RagMeta | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentList, setAgentList] = useState<AgentProfile[]>([]);
  const [connectorCount, setConnectorCount] = useState(0);

  const applySetupPayload = useCallback((payload: unknown, opts?: { syncApproval?: boolean }) => {
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
    // Do not stomp Settings/banner choice on focus re-sync (setup often defaults to ask).
    if (
      opts?.syncApproval &&
      (p.approvalMode === "ask" || p.approvalMode === "auto_llm" || p.approvalMode === "auto_all")
    ) {
      setApprovalMode(p.approvalMode);
    }
    if (p.ragPathHint != null) {
      setRagPathHint(p.ragPathHint);
      localStorage.setItem("combo_x_rag_path_hint", p.ragPathHint);
    }
    if (Array.isArray(p.connectors)) {
      setConnectors(p.connectors);
      localStorage.setItem("combo_x_connectors", JSON.stringify(p.connectors));
      setEnabledTools((prev) => {
        const next = new Set(prev);
        if (
          p.connectors!.includes("rest") ||
          p.connectors!.includes("github:read") ||
          p.connectors!.includes("connectors:rest")
        ) {
          next.add("rest_request");
        }
        if (p.connectors!.includes("mcp") || p.connectors!.includes("connectors:mcp")) {
          next.add("mcp_list_tools");
          next.add("mcp_call");
        }
        if (p.ragPathHint || p.connectors!.includes("local_rag")) {
          next.add("rag_search");
          next.add("rag_read_file");
          next.add("rag_status");
        }
        return next;
      });
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
        // Explicit Setup → Apply: sync approval too
        applySetupPayload(changes.combo_x_setup_payload.newValue, { syncApproval: true });
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
          createdAt: t.createdAt ?? new Date().toISOString(),
          bookmarked: t.bookmarked,
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
      localStorage.setItem(LAST_SESSION_KEY, updated.id);
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
    setRagMeta(await rag.getMeta());
    setActiveAgentId(await agentProfiles.getActiveId());
    setAgentList(await agentProfiles.list());
    setConnectorCount((await connectorStore.list()).length);
    if (!currentSession) {
      const lastId = localStorage.getItem(LAST_SESSION_KEY);
      const last = lastId ? await sessions.get(lastId) : null;
      if (last) {
        setCurrentSession(last);
        setTurns(
          last.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              createdAt: m.createdAt,
              bookmarked: m.bookmarked,
              tools: m.tools as ToolChipData[] | undefined,
              usage: m.usage,
            })),
        );
        historyRef.current = last.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
        setSessionUsage({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: last.totalTokens,
          estimatedCostUsd: last.estimatedCostUsd,
        });
      } else {
        const s = await sessions.create("New chat");
        setCurrentSession(s);
        localStorage.setItem(LAST_SESSION_KEY, s.id);
      }
    }
    setStatus("Unlocked");
  }, [agentProfiles, connectorStore, currentSession, rag, refreshVaultLabels, sessions, vault]);

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
    localStorage.setItem(LAST_SESSION_KEY, s.id);
    setCurrentSession(s);
    setTurns([]);
    historyRef.current = [];
    setEditingTurnId(null);
    setInspectTurnId(null);
    setPendingAttachments([]);
    setAttachMsg("");
    setSessionUsage(ZERO);
    setLastTurnUsage(null);
    setSubagentRuns([]);
    setTab("chat");
    await refreshSessions();
  }, [refreshSessions, sessions]);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = [...fileList];
      if (!files.length) return;
      setAttachBusy(true);
      setAttachMsg(`Parsing ${files.length} file(s)…`);
      let session = currentSession;
      if (!session) {
        session = await sessions.create("New chat");
        setCurrentSession(session);
      }
      const added: AttachmentRecord[] = [];
      const errors: string[] = [];
      for (const file of files) {
        const parsed = await parseAttachment(file, file.name, file.type);
        if (parsed.error && !parsed.text && !parsed.dataUrl) {
          errors.push(`${file.name}: ${parsed.error}`);
          continue;
        }
        const row: AttachmentRecord = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          name: file.name,
          mime: parsed.mime,
          kind: parsed.kind,
          size: file.size,
          text: parsed.text,
          dataUrl: parsed.dataUrl,
          meta: parsed.meta,
          truncated: parsed.truncated,
          error: parsed.error,
          createdAt: Date.now(),
        };
        await attachments.put(row);
        added.push(row);
      }
      setPendingAttachments((prev) => [...prev, ...added]);
      setAttachMsg(
        errors.length
          ? `Added ${added.length}; errors: ${errors.join("; ")}`
          : `Ready: ${added.map((a) => a.name).join(", ")}`,
      );
      setAttachBusy(false);
      setEnabledTools((prev) => {
        const next = new Set(prev);
        next.add("list_attachments");
        next.add("read_attachment");
        return next;
      });
    },
    [attachments, currentSession, sessions],
  );

  const toggleMessageBookmark = useCallback(
    (turnId: string) => {
      setTurns((prev) => {
        const next = prev.map((t) =>
          t.id === turnId ? { ...t, bookmarked: !t.bookmarked } : t,
        );
        if (currentSession) void persistSession(currentSession, next, sessionUsage);
        return next;
      });
    },
    [currentSession, persistSession, sessionUsage],
  );

  const toggleSessionBookmark = useCallback(() => {
    void (async () => {
      if (!currentSession) return;
      const updated: ChatSession = {
        ...currentSession,
        bookmarked: !currentSession.bookmarked,
        updatedAt: new Date().toISOString(),
      };
      await sessions.save(updated);
      setCurrentSession(updated);
      await refreshSessions();
    })();
  }, [currentSession, refreshSessions, sessions]);

  const loadSession = useCallback(async (id: string) => {
    const s = await sessions.get(id);
    if (!s) return;
    localStorage.setItem(LAST_SESSION_KEY, s.id);
    setCurrentSession(s);
    setTurns(
      s.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt,
          bookmarked: m.bookmarked,
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
      const pending = pendingAttachments;
      if ((!text && pending.length === 0) || running) return;
      if (!vault.isUnlocked()) return setStatus("Unlock vault first");
      const key = apiKey || (await vault.getByLabel(KEY_LABEL));
      if (!key) {
        setTab("settings");
        return setStatus("Missing OpenRouter key");
      }

      const displayText =
        text ||
        (pending.length
          ? `Analyze ${pending.length} attachment(s): ${pending.map((p) => p.name).join(", ")}`
          : "");

      let session = currentSession;
      if (!session) {
        session = await sessions.create(displayText.slice(0, 60) || "Attachments");
        setCurrentSession(session);
      }

      if (!overrideText) setInput("");
      const pendingIds = pending.map((p) => p.id);
      setPendingAttachments([]);
      const nowIso = new Date().toISOString();
      const editId = editingTurnId;
      setEditingTurnId(null);
      let baseTurns = turns;
      if (editId) {
        const idx = turns.findIndex((t) => t.id === editId && t.role === "user");
        if (idx >= 0) {
          baseTurns = turns.slice(0, idx);
          historyRef.current = historyRef.current.slice(0, idx);
        }
      }
      const userTurn: UiTurn = {
        id: editId && baseTurns.length < turns.length ? editId : crypto.randomUUID(),
        role: "user",
        content: displayText,
        createdAt: nowIso,
        attachments: pending.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
      };
      const assistantId = crypto.randomUUID();
      let nextTurns = [
        ...baseTurns,
        userTurn,
        {
          id: assistantId,
          role: "assistant" as const,
          content: "",
          createdAt: nowIso,
          delivery: "stream" as const,
        },
      ];
      setTurns(nextTurns);
      setRunning(true);
      setStreamingId(assistantId);
      setSubagentRuns([]);
      setStatus(pendingIds.length ? `Working with ${pendingIds.length} file(s)…` : "Working…");
      setLastTurnUsage(null);

      const controller = new AbortController();
      abortRef.current = controller;
      const llm = new OpenRouterClient({ apiKey: key });
      const agent = new AgentLoop(llm, bridge, memory, sessions, profiles);
      const activeProfile = activeAgentId ? await agentProfiles.get(activeAgentId) : null;
      const resolved = activeProfile ? resolveAgentProfile(activeProfile) : null;
      const runModel = normalizeModelId(activeProfile?.orchestratorModel ?? model);
      const runWorker = normalizeModelId(activeProfile?.workerModel ?? workerModel);
      const runBudget = activeProfile?.budgetMode ?? budgetMode;
      const runApproval = activeProfile?.approvalMode ?? approvalModeRef.current;
      const runMaxSteps = resolved?.maxSteps;
      const runTools =
        activeProfile?.toolAllowlist === "all"
          ? ALL_TOOL_NAMES
          : activeProfile?.toolAllowlist?.length
            ? activeProfile.toolAllowlist
            : [...enabledTools];
      const connectorAllowlist =
        activeProfile?.connectorIds?.length ? activeProfile.connectorIds : undefined;
      let turnUsage = ZERO;
      const toolMap = new Map<string, ToolChipData>();
      const runId = crypto.randomUUID();
      const sessionIdForLog = session.id;

      const flushTools = () => {
        const tools = [...toolMap.values()];
        setTurns((prev) =>
          prev.map((t) => (t.id === assistantId ? { ...t, tools: [...tools] } : t)),
        );
      };

      const onSubagent = (ev: SubagentEvent) => {
        setSubagentRuns((prev) => {
          switch (ev.type) {
            case "start":
              return [
                ...prev,
                { id: ev.subagentId, goal: ev.goal, status: "running", messages: [] },
              ];
            case "delta": {
              const toolChips =
                ev.messages
                  ?.filter((m) => m.role === "tool" || m.role === "assistant")
                  .map((m) => ({
                    tool:
                      m.role === "tool"
                        ? (m.name ?? "tool")
                        : m.tool_calls?.[0]?.function.name ?? "step",
                    status: "done" as const,
                  })) ?? [];
              return prev.map((r) =>
                r.id === ev.subagentId ? { ...r, messages: toolChips } : r,
              );
            }
            case "done":
              return prev.map((r) =>
                r.id === ev.subagentId
                  ? { ...r, status: "done", summary: ev.summary, ok: true }
                  : r,
              );
            case "error":
              return prev.map((r) =>
                r.id === ev.subagentId
                  ? {
                      ...r,
                      status: "done",
                      summary: ev.summary ?? "Sub-agent error",
                      ok: false,
                    }
                  : r,
              );
            default:
              return prev;
          }
        });
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
          const args = event.args ?? prev?.args ?? {};
          toolMap.set(id, {
            id,
            name: event.tool,
            args,
            result: event.result,
            status: denied ? "denied" : "done",
          });
          flushTools();
          if (
            (event.tool === "create_agent" || event.tool === "create_agent_profile") &&
            resultOk(event.result)
          ) {
            void agentProfiles.list().then(setAgentList);
          }
          if (event.tool === "spawn_subagent" && resultOk(event.result)) {
            const envelope = event.result as { summary?: string; ok?: boolean; childRunId?: string };
            if (envelope.summary) {
              setSubagentRuns((runs) => {
                const last = runs[runs.length - 1];
                if (!last || last.status === "done") return runs;
                return runs.map((r, i) =>
                  i === runs.length - 1
                    ? {
                        ...r,
                        status: "done" as const,
                        summary: envelope.summary,
                        ok: envelope.ok !== false,
                      }
                    : r,
                );
              });
            }
          }
          void (async () => {
            const page = await getActiveTabMeta();
            await actionLog.append({
              tool: event.tool!,
              args,
              resultSummary: summarizeResult(event.result),
              ok: resultOk(event.result),
              approvalDecision: event.approvalDecision ?? "n/a",
              approvalMode: event.approvalMode ?? approvalModeRef.current,
              pageUrl: page.url,
              pageTitle: page.title,
              tabId: page.tabId,
              targetUrl: extractTargetUrl(args),
              sessionId: sessionIdForLog,
              runId,
              toolCallId: event.toolCallId,
              error: resultError(event.result),
            });
          })();
        }
        if (event.type === "run_context" && event.runContext) {
          const ctx = event.runContext;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === userTurn.id
                ? { ...t, runContext: ctx }
                : t.id === assistantId
                  ? { ...t, delivery: ctx.transport }
                  : t,
            ),
          );
        }
        if (event.type === "assistant_delta" && event.message != null) {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantId
                ? { ...t, content: event.message ?? "", delivery: t.delivery ?? "stream" }
                : t,
            ),
          );
        }
        if (event.type === "error" && event.message) setStatus(event.message);
        if (event.type === "done") setStreamingId(null);
      };

      try {
        const result = await agent.run({
          model: runModel,
          workerModel: runWorker,
          userMessage: text || displayText,
          history: historyRef.current,
          signal: controller.signal,
          maxSteps: runMaxSteps,
          systemPrompt: activeProfile?.systemPrompt,
          enabledTools: runTools,
          approvalMode: runApproval,
          getApprovalMode: () => activeProfile?.approvalMode ?? approvalModeRef.current,
          approvalModel: runWorker,
          budgetMode: runBudget,
          usageLog: usageStore,
          tasks: taskStore,
          pageExtensions,
          agents: agentProfiles,
          sessionId: session.id,
          runId,
          agentId: activeAgentId ?? undefined,
          nestingDepth: 0,
          onSubagent,
          connectors: {
            store: connectorStore,
            getSecret: (label) => vault.getByLabel(label),
            allowedIds: connectorAllowlist,
          },
          rag,
          attachments,
          views,
          pendingAttachmentIds: pendingIds,
          onEvent,
        });
        historyRef.current = leanHistory(
          stripImageParts(result.messages.filter((m) => m.role !== "system")),
        );
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
        setStreamingId(null);
        setPendingApproval(null);
        abortRef.current = null;
      }
    },
    [
      activeAgentId,
      agentProfiles,
      apiKey,
      actionLog,
      attachments,
      budgetMode,
      connectorStore,
      views,
      bridge,
      currentSession,
      enabledTools,
      input,
      memory,
      model,
      pendingAttachments,
      workerModel,
      persistSession,
      profiles,
      rag,
      running,
      sessionUsage,
      sessions,
      taskStore,
      usageStore,
      pageExtensions,
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
            ["views", "Views"],
            ["activity", "Activity"],
            ["usage", "Usage"],
          ] as const
        )
          .filter(([id]) => PRIMARY_TABS.includes(id))
          .map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "tab active" : "tab"}
              onClick={() => {
                setTab(id);
                if (id === "sessions") void refreshSessions();
              }}
            >
              {label}
            </button>
          ))}
        <select
          className="tab-more"
          aria-label="More tabs"
          value={MORE_TABS.some((t) => t.id === tab) ? tab : ""}
          onChange={(e) => {
            const id = e.target.value as TabId;
            if (!id) return;
            setTab(id);
            if (id === "vault") void refreshVaultLabels();
            if (id === "settings" || id === "mcp") {
              void connectorStore.list().then((list) => setConnectorCount(list.length));
              void agentProfiles.list().then(setAgentList);
            }
          }}
        >
          <option value="">More…</option>
          {MORE_TABS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </nav>

      {tab === "chat" ? (
        <>
          <div
            className={`chat-main${preview || browserOpen ? " chat-main-split" : ""}`}
          >
            <div className="messages">
              {currentSession ? (
                <div className="conv-bar">
                  <div className="conv-bar-main">
                    <span className="conv-label">Conversation</span>
                    <code className="conv-id" title={currentSession.id}>
                      {shortConversationId(currentSession.id)}
                    </code>
                    <button
                      type="button"
                      className="msg-action"
                      title="Copy full conversation id"
                      onClick={() => {
                        void (async () => {
                          const ok = await copyText(currentSession.id);
                          if (ok) {
                            setIdCopied(true);
                            window.setTimeout(() => setIdCopied(false), 1200);
                          }
                        })();
                      }}
                    >
                      {idCopied ? "Copied id" : "Copy id"}
                    </button>
                    <button
                      type="button"
                      className={browserOpen ? "msg-action active" : "msg-action"}
                      title="Toggle browser preview (Nanobrowser-style tab mirror)"
                      onClick={() => setBrowserOpen((v) => !v)}
                    >
                      Browser
                    </button>
                  </div>
                  <button
                    type="button"
                    className={
                      currentSession.bookmarked ? "msg-action active" : "msg-action"
                    }
                    title={
                      currentSession.bookmarked
                        ? "Remove conversation bookmark"
                        : "Bookmark conversation"
                    }
                    aria-pressed={!!currentSession.bookmarked}
                    onClick={toggleSessionBookmark}
                  >
                    {currentSession.bookmarked ? "Bookmarked" : "Bookmark"}
                  </button>
                </div>
              ) : null}
              <SubagentStrip runs={subagentRuns} />
              {turns.length === 0 ? (
                <div className="bubble system">
                  Hi — I’m Combo-X. I can open tabs (<code>open_tab</code>), scrape tables, export CSV,
                  and keep sessions. Approval mode: <strong>{approvalMode}</strong>.
                </div>
              ) : null}
              {turns.map((t) => (
                <div
                  key={t.id}
                  className={`bubble ${t.role}${t.bookmarked ? " bookmarked" : ""}`}
                >
                  {t.role === "assistant" ? (
                    <MarkdownView content={t.content} streaming={streamingId === t.id} />
                  ) : (
                    <div className="bubble-plain">{t.content}</div>
                  )}
                  {t.role === "assistant" && t.content.includes("|") ? (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => {
                        const p = buildPreviewFromMarkdown(t.content);
                        if (p) setPreview(p);
                      }}
                    >
                      Open tables / preview
                    </button>
                  ) : null}
                  {t.attachments && t.attachments.length > 0 ? (
                    <div className="attach-chips">
                      {t.attachments.map((a) => (
                        <span key={a.id} className="attach-chip done">
                          {a.kind}: {a.name}
                          <button
                            type="button"
                            className="attach-x"
                            onClick={() =>
                              void (async () => {
                                const row = await attachments.get(a.id);
                                if (!row) return;
                                setPreview(
                                  buildPreviewFromAttachment({
                                    name: row.name,
                                    kind: row.kind,
                                    text: row.text,
                                    dataUrl: row.dataUrl,
                                  }),
                                );
                              })()
                            }
                          >
                            ↗
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {t.tools && t.tools.length > 0 ? (
                    <div className="chips">
                      {t.tools.map((tool) => (
                        <ToolChip key={tool.id} tool={tool} onPreview={setPreview} />
                      ))}
                    </div>
                  ) : null}
                  <div className="bubble-footer">
                    <MessageToolbar
                      content={t.content}
                      createdAt={t.createdAt}
                      bookmarked={t.bookmarked}
                      onToggleBookmark={() => toggleMessageBookmark(t.id)}
                    />
                    <div className="msg-extra-actions">
                      {t.role === "assistant" && t.delivery ? (
                        <span
                          className={
                            t.delivery === "stream" ? "delivery-pill stream" : "delivery-pill full"
                          }
                          title={
                            t.delivery === "stream"
                              ? "Orchestrator used streaming (chatStreaming)"
                              : "Orchestrator used a full non-stream call"
                          }
                        >
                          {t.delivery === "stream" ? "stream" : "full call"}
                        </span>
                      ) : null}
                      {t.role === "user" ? (
                        <button
                          type="button"
                          className="msg-action"
                          disabled={running}
                          title="Edit and resend from here (drops later turns)"
                          onClick={() => {
                            setEditingTurnId(t.id);
                            setInput(t.content);
                          }}
                        >
                          {editingTurnId === t.id ? "Editing…" : "Edit"}
                        </button>
                      ) : null}
                      {t.role === "user" ? (
                        <button
                          type="button"
                          className="msg-action"
                          title="Inspect system context + memories for this turn"
                          disabled={!t.runContext}
                          onClick={() =>
                            setInspectTurnId((id) => (id === t.id ? null : t.id))
                          }
                        >
                          Context
                        </button>
                      ) : null}
                    </div>
                    {t.usage && t.role === "assistant" ? (
                      <div className="turn-usage">
                        {t.usage.totalTokens} tok · {formatUsd(t.usage.estimatedCostUsd)}
                      </div>
                    ) : null}
                  </div>
                  {inspectTurnId === t.id && t.runContext ? (
                    <pre className="context-inspect">
                      {`model: ${t.runContext.model}\ntransport: ${t.runContext.transport}\ntools (${t.runContext.toolNames.length}): ${t.runContext.toolNames.join(", ")}\n\n--- SYSTEM ---\n${t.runContext.systemPrompt}\n\n--- MEMORIES (injected once per turn, not mid-stream) ---\n${t.runContext.memoryBlock || "(none)"}`}
                    </pre>
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
            <PreviewDrawer
              preview={preview}
              onClose={() => setPreview(null)}
              onExport={(filename, text, mime) =>
                void bridge.downloadText(filename, text, mime)
              }
              onGoViews={() => setTab("views")}
            />
            <BrowserPreview open={browserOpen} onClose={() => setBrowserOpen(false)} />
          </div>
          <div className="composer">
            <div className="row">
              <select
                className="agent-pick"
                value={activeAgentId ?? ""}
                title="Active agent profile"
                onChange={(e) => {
                  const id = e.target.value || null;
                  void (async () => {
                    await agentProfiles.setActiveId(id);
                    setActiveAgentId(id);
                    if (id) {
                      const p = await agentProfiles.get(id);
                      if (p && p.toolAllowlist !== "all") {
                        setEnabledTools(() => new Set(p.toolAllowlist as string[]));
                      } else if (p?.toolAllowlist === "all") {
                        setEnabledTools(() => new Set(ALL_TOOL_NAMES));
                      }
                    }
                  })();
                }}
              >
                <option value="">Default agent</option>
                {agentList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
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
            {pendingAttachments.length > 0 ? (
              <div className="attach-chips">
                {pendingAttachments.map((a) => (
                  <span key={a.id} className="attach-chip">
                    {a.kind}: {a.name}
                    <button
                      type="button"
                      className="attach-x"
                      aria-label={`Preview ${a.name}`}
                      title="Preview"
                      onClick={() =>
                        setPreview(
                          buildPreviewFromAttachment({
                            name: a.name,
                            kind: a.kind,
                            text: a.text,
                            dataUrl: a.dataUrl,
                          }),
                        )
                      }
                    >
                      ↗
                    </button>
                    <button
                      type="button"
                      className="attach-x"
                      aria-label={`Remove ${a.name}`}
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((p) => p.id !== a.id))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {attachMsg ? <p className="hint wrap">{attachMsg}</p> : null}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask… attach PDF/CSV/images, or “continue” after a step limit"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              onPaste={(e) => {
                const files = [...(e.clipboardData?.files ?? [])];
                if (files.length) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.csv,.tsv,.txt,.md,.json,.xlsx,.xls,image/*,text/*"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {editingTurnId ? (
              <p className="hint">
                Editing a prior turn — Send will truncate later messages.{" "}
                <button type="button" className="linkish" onClick={() => setEditingTurnId(null)}>
                  Cancel edit
                </button>
              </p>
            ) : null}
            <div className="row">
              <button
                type="button"
                disabled={running || attachBusy}
                onClick={() => fileInputRef.current?.click()}
                title="Attach PDF, CSV, XLSX, txt, images"
              >
                {attachBusy ? "…" : "Attach"}
              </button>
              <button
                type="button"
                disabled={running || !input.trim()}
                title="Save current input as a durable memory (injected on next turn)"
                onClick={() => {
                  void (async () => {
                    const text = input.trim();
                    if (!text) return;
                    await memory.remember({ text, tags: ["manual"], kind: "note" });
                    setStatus("Memory saved — will inject on the next send");
                  })();
                }}
              >
                Save memory
              </button>
              <button
                type="button"
                className="primary"
                disabled={running || (!input.trim() && pendingAttachments.length === 0)}
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
            <button
              type="button"
              className={sessionBookmarksOnly ? "primary" : undefined}
              title="Show bookmarked conversations or messages"
              aria-pressed={sessionBookmarksOnly}
              onClick={() => setSessionBookmarksOnly((v) => !v)}
            >
              Bookmarks
            </button>
            <button type="button" className="primary" onClick={() => void newChat()}>
              New chat
            </button>
          </div>
          <ul className="list">
            {sessionList
              .filter((s) => {
                if (!sessionBookmarksOnly) return true;
                return (
                  !!s.bookmarked || s.messages.some((m) => m.bookmarked && m.role !== "system")
                );
              })
              .map((s) => (
              <li key={s.id} className={s.bookmarked ? "session-row bookmarked" : "session-row"}>
                <button type="button" className="linkish session-open" onClick={() => void loadSession(s.id)}>
                  <strong>
                    {s.bookmarked ? "[B] " : ""}
                    {s.title || "Untitled"}
                    {s.messages.some((m) => m.bookmarked) ? " · msgs bookmarked" : ""}
                  </strong>
                  <br />
                  <span className="hint">
                    {new Date(s.updatedAt).toLocaleString()} · {s.totalTokens} tok ·{" "}
                    {formatUsd(s.estimatedCostUsd)}
                  </span>
                  <br />
                  <span className="hint mono-id" title={s.id}>
                    id {shortConversationId(s.id)}
                  </span>
                </button>
                <button
                  type="button"
                  className="msg-action"
                  title="Copy conversation id"
                  onClick={() => void copyText(s.id)}
                >
                  Copy id
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "views" ? (
        <ViewsPanel
          vault={vault}
          views={views}
          sessions={sessions}
          attachments={attachments}
          rag={rag}
          memory={memory}
          artifacts={artifacts}
          vaultUnlocked={vault.isUnlocked()}
          connectorStore={connectorStore}
          onExport={(filename, text, mime) => void bridge.downloadText(filename, text, mime)}
        />
      ) : null}

      {tab === "activity" ? (
        <ActivityPanel
          actionLog={actionLog}
          onExport={(filename, text, mime) => void bridge.downloadText(filename, text, mime)}
        />
      ) : null}

      {tab === "usage" ? (
        <UsagePanel
          usageStore={usageStore}
          sessionId={currentSession?.id}
          sessionFilter={usageSessionFilter}
          onSessionFilterChange={setUsageSessionFilter}
          onExport={(filename, text, mime) => void bridge.downloadText(filename, text, mime)}
        />
      ) : null}

      {tab === "tasks" ? (
        <TasksPanel taskStore={taskStore} currentSessionId={currentSession?.id} />
      ) : null}

      {tab === "pageext" ? (
        <PageExtensionsPanel store={pageExtensions} sessionId={currentSession?.id} />
      ) : null}

      {tab === "settings" ? (
        <SettingsPanel
          vault={vault}
          rag={rag}
          agentProfiles={agentProfiles}
          connectorStore={connectorStore}
          locked={locked}
          apiKey={apiKey}
          setApiKey={setApiKey}
          model={model}
          setModel={setModel}
          workerModel={workerModel}
          setWorkerModel={setWorkerModel}
          customModel={customModel}
          setCustomModel={setCustomModel}
          customWorkerModel={customWorkerModel}
          setCustomWorkerModel={setCustomWorkerModel}
          approvalMode={approvalMode}
          setApprovalMode={setApprovalMode}
          budgetMode={budgetMode}
          setBudgetMode={setBudgetMode}
          enabledTools={enabledTools}
          setEnabledTools={setEnabledTools}
          activeAgentId={activeAgentId}
          setActiveAgentId={setActiveAgentId}
          ragExclude={ragExclude}
          setRagExclude={setRagExclude}
          ragMeta={ragMeta}
          setRagMeta={setRagMeta}
          onLockVault={() => {
            void (async () => {
              abortRef.current?.abort();
              await vault.lock();
              setLocked(true);
              setApiKey("");
            })();
          }}
          onRefreshVaultLabels={() => void refreshVaultLabels()}
        />
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
          <p className="hint wrap">
            {activeAgentId
              ? `Synced with agent “${agentList.find((a) => a.id === activeAgentId)?.name ?? activeAgentId}”. Edits update global allowlist.`
              : "Global tool allowlist — create an agent in Settings to pin per-workflow tools."}
          </p>
          <div className="row">
            <button type="button" onClick={() => setEnabledTools(new Set(ALL_TOOL_NAMES))}>
              Enable all
            </button>
            <button type="button" onClick={() => setEnabledTools(new Set())}>
              Disable all
            </button>
          </div>
          <div className="tool-groups">
            {GROUP_ORDER.map((group) => (
              <div key={group} className="tool-group">
                <h3>{group}</h3>
                <ul className="list tools">
                  {TOOL_GROUPS[group]
                    .filter((name) => ALL_TOOL_NAMES.includes(name))
                    .map((name) => {
                      const t = AGENT_TOOLS.find((x) => x.function.name === name);
                      if (!t) return null;
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
            ))}
          </div>
        </div>
      ) : null}

      {tab === "mcp" ? (
        <div className="panel">
          <h2>Workspace</h2>
          <p className="hint wrap">
            Local Combo-X status — RAG index, configured connectors, and active agent profile.
          </p>
          <ul className="list">
            <li>
              RAG:{" "}
              {ragMeta?.chunkCount
                ? `${ragMeta.folderName || "folder"} · ${ragMeta.fileCount} files / ${ragMeta.chunkCount} chunks`
                : "not indexed — grant in Settings → Device RAG"}
            </li>
            <li>Connectors: {connectorCount} configured</li>
            <li>
              Active agent:{" "}
              {activeAgentId
                ? agentList.find((a) => a.id === activeAgentId)?.name ?? activeAgentId
                : "Default (global)"}
            </li>
            <li>
              Budget: {budgetMode} · Approval: {approvalMode} · Tools enabled: {enabledTools.size}
            </li>
          </ul>
          <div className="row">
            <button type="button" className="primary" onClick={() => setTab("settings")}>
              Open Settings
            </button>
            <button
              type="button"
              onClick={() => {
                const url = chrome.runtime.getURL("setup/index.html");
                void chrome.tabs.create({ url });
              }}
            >
              Open setup page
            </button>
          </div>
          {setupMsg ? <p className="hint wrap">{setupMsg}</p> : null}
          <p className="hint wrap">
            Folder hint: <code>{ragPathHint || "(none)"}</code>
          </p>
        </div>
      ) : null}
    </div>
  );
}

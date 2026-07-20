import {
  AGENT_TOOLS,
  ActionLogStore,
  AgentLoop,
  AgentProfileStore,
  ApprovalPolicyStore,
  ArtifactStore,
  AttachmentStore,
  BUDGET_MODE_HELP,
  ChangeLogStore,
  ConnectorStore,
  CustomToolStore,
  targetKeyFromArgs,
  DEFAULT_MODEL,
  DEFAULT_SKIP_DIRS,
  DEFAULT_WORKER_MODEL,
  MemoryStore,
  LLM_ACTIVE_MODEL_LABEL,
  LLM_ACTIVE_WORKER_MODEL_LABEL,
  LLM_BASE_URL_KEY,
  LLM_PROVIDER_KEY,
  LLM_PROVIDER_PRESETS,
  apiKeyVaultLabel,
  baseUrlVaultLabel,
  defaultModelsForProvider,
  isProviderReady,
  modelVaultLabel,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
  workerModelVaultLabel,
  hydrateCloudConfigFromVault,
  RagStore,
  SessionStore,
  SkillStore,
  Vault,
  ViewStore,
  emptyRegistry,
  ensureRegistryMigrated,
  getActiveEntry,
  openVaultFromEntry,
  buildVaultPack,
  cloudClientFromConfig,
  loadCloudConfig,
  loadDirectoryHandle,
  mergeVaultPack,
  packFromCiphertextB64,
  packToCiphertextB64,
  saveCloudConfig,
  saveRegistry,
  sealSetupPack,
  setupPackToB64,
  writeVaultPackToDirectory,
  type AgentToolMode,
  type VaultRegistryState,
  extractTargetUrl,
  getProtocolVersion,
  historyFromUiTurns,
  leanHistory,
  loadVisionSettingsFromStorage,
  mergeVisionSettings,
  normalizeModelId,
  parseAttachment,
  persistVisionSettings,
  assignUniqueLabels,
  detectChatSecrets,
  embedSecretsInMessage,
  formatBrowserContextBlock,
  pickedElementChipLabel,
  resolveProvider,
  resultError,
  resultOk,
  summarizeResult,
  stripImageParts,
  TaskStore,
  UsageStore,
  PageExtensionStore,
  type ActiveTabContext,
  type AgentBudgetMode,
  type AgentEvent,
  type AgentProfile,
  type ApprovalMode,
  type AttachmentRecord,
  type ChatMessage,
  type ChatPreviewPayload,
  type ChatSession,
  type LlmProviderId,
  type LlmUsage,
  type PickedElementRef,
  type ProfileStore,
  type RagMeta,
  type RunContextSnapshot,
  type SessionMessage,
  type SiteProfile,
  type SubagentEvent,
  type VisionSettings,
  slimRunContextForStorage,
} from "@combo-x/core";
import { buildLlmClient, shouldOmitComboWebSearch } from "./llmClient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChromeBridge } from "../lib/chrome-bridge";
import { ApprovalBanner } from "./ApprovalBanner";
import { ApprovalModeMenu } from "./ApprovalModeMenu";
import { BrowserPreview } from "./BrowserPreview";
import { ChangesPanel } from "./ChangesPanel";
import { ConversationTasksDrawer } from "./ConversationTasksDrawer";
import { copyText } from "./chatClipboard";
import { SecretEmbedBar, type PendingSecret } from "./SecretEmbedBar";
import { ChatArtifact, type ChatArtifactPayload } from "./ChatArtifact";
import { MarkdownView } from "./MarkdownView";
import { MessageToolbar } from "./MessageToolbar";
import {
  PreviewDrawer,
  buildPreviewFromAttachment,
  buildPreviewFromMarkdown,
  buildPreviewFromTool,
  type PreviewPayload,
} from "./PreviewDrawer";
import { ToolChip, type ToolChipData } from "./ToolChip";
import { ActivityPanel } from "./ActivityPanel";
import { AssetsPanel } from "./AssetsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { LibrariesPanel, type LibSubNav } from "./LibrariesPanel";
import { UsagePanel } from "./UsagePanel";
import { TasksPanel } from "./TasksPanel";
import { SubagentStrip, type SubagentRun } from "./SubagentStrip";
import { PageExtensionsPanel } from "./PageExtensionsPanel";
import { ModelPicker } from "./ModelPicker";
import { MessagesViewport } from "./MessagesViewport";
import { SessionsDrawer } from "./SessionsDrawer";
import { ToolAccessPicker } from "./ToolAccessPicker";
import { TabBar } from "./TabBar";
import { CloudVaultSection } from "./CloudVaultSection";
import { VaultGate } from "./VaultGate";
import { resolveEnabledToolsFromSetup } from "./setupApply";
import {
  createEmptyRuntime,
  evictIdleRuntimes,
  metaFromRuntimes,
  SESSION_IDLE_EVICT_MS,
  type SessionRuntime,
  type SessionRuntimeMeta,
} from "./sessionRuntime";
import { useComboLink } from "./useComboLink";

const APP_VERSION =
  typeof chrome !== "undefined" && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version
    : "dev";
const MODEL_LABEL = LLM_ACTIVE_MODEL_LABEL;
const WORKER_MODEL_LABEL = LLM_ACTIVE_WORKER_MODEL_LABEL;
const TOOLS_STORAGE_KEY = "combo_x_enabled_tools";
const DETECT_SECRETS_KEY = "combo_x_detect_secrets";
const APPROVAL_KEY = "combo_x_approval_mode";
const BUDGET_KEY = "combo_x_budget_mode";
const RAG_EXCLUDE_KEY = "combo_x_rag_exclude";
const LAST_SESSION_KEY = "combo_x_last_session_id";
const SHOW_ACTIONS_KEY = "combo_x_show_actions";
const MAX_STEPS_KEY = "combo_x_max_steps";
const SESSIONS_PINNED_KEY = "combo_x_sessions_pinned";
const WEB_SEARCH_KEY = "combo_x_web_search";
const STEPS_PRESETS = [8, 12, 16, 24, 32, 48] as const;

type TabId =
  | "chat"
  | "libraries"
  | "activity"
  | "changes"
  | "assets"
  | "usage"
  | "tasks"
  | "pageext"
  | "settings"
  | "vault";

const ALL_TABS: Array<{ id: TabId; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "libraries", label: "Libraries" },
  { id: "activity", label: "Activity" },
  { id: "changes", label: "Changes" },
  { id: "assets", label: "Assets" },
  { id: "usage", label: "Usage" },
  { id: "tasks", label: "Tasks" },
  { id: "pageext", label: "Page ext" },
  { id: "settings", label: "Settings" },
  { id: "vault", label: "Vault" },
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

/** Ordered assistant timeline: reasoning/thoughts/tools/artifacts interleaved. */
type TurnBlock =
  | { id: string; kind: "reasoning"; text: string }
  | { id: string; kind: "thought"; text: string }
  | { id: string; kind: "message"; text: string }
  | { id: string; kind: "tools"; toolIds: string[] }
  | { id: string; kind: "artifact"; artifact: ChatArtifactPayload };

type UiTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  bookmarked?: boolean;
  /** Origin — Combo Link remote turns are badged in UI. */
  source?: "local" | "link" | "mcp";
  attachments?: Array<{ id: string; name: string; kind: string }>;
  /** User-picked DOM elements attached to this turn. */
  picks?: PickedElementRef[];
  /** Tab snapshot at send time. */
  activeTab?: ActiveTabContext;
  tools?: ToolChipData[];
  /** Interleaved reasoning / step narration / tool batches (assistant only). */
  blocks?: TurnBlock[];
  /** Live streaming reasoning not yet committed into blocks. */
  liveReasoning?: string;
  artifacts?: ChatArtifactPayload[];
  usage?: LlmUsage;
  /** Worker / secondary model usage for this turn (parse_data, vision, …). */
  usageWorker?: LlmUsage;
  /** stream = chatStreaming; full = non-stream chat */
  delivery?: "stream" | "full";
  /** System + memories + tools attached to this user turn (not mid-stream). */
  runContext?: RunContextSnapshot;
};

function chatPreviewToDrawer(p: ChatPreviewPayload): PreviewPayload {
  if (p.kind === "html") {
    return {
      title: p.title,
      kind: "html",
      body: "",
      html: p.html,
      interactive: p.interactive,
    };
  }
  if (p.kind === "compare") {
    return {
      title: p.title,
      kind: "compare",
      body: "",
      beforeSrc: p.beforeSrc,
      afterSrc: p.afterSrc,
    };
  }
  if (p.kind === "image") {
    return { title: p.title, kind: "image", body: p.src ?? "" };
  }
  if (p.kind === "table" && p.rows) {
    return {
      title: p.title,
      kind: "table",
      body: p.rows.map((r) => r.join("\t")).join("\n"),
      rows: p.rows,
    };
  }
  return { title: p.title, kind: "text", body: p.text ?? "" };
}

const ALL_TOOL_NAMES = AGENT_TOOLS.map((t) => t.function.name);
const ZERO: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
};

function formatUsageLine(u: LlmUsage): string {
  const cost = formatUsd(u.estimatedCostUsd);
  const src = u.costSource === "openrouter" ? "OR" : u.costSource === "estimate" ? "~" : "";
  return `in ${u.promptTokens.toLocaleString()} · out ${u.completionTokens.toLocaleString()} (${cost}${src ? ` ${src}` : ""})`;
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

type UsageSplit = { total: LlmUsage; orch: LlmUsage; worker: LlmUsage };

function emptySplit(): UsageSplit {
  return { total: { ...ZERO }, orch: { ...ZERO }, worker: { ...ZERO } };
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
    costSource:
      a.costSource === "openrouter" || b.costSource === "openrouter"
        ? "openrouter"
        : a.costSource ?? b.costSource,
  };
}

/** Additive-only migrate — never wipe a custom allowlist on reload. */
const TOOLS_MIGRATE_FLAG = "combo_x_tools_migrate_v168";
const TOOLS_MIGRATE_ADD = [
  "parse_data",
  "get_interactive",
  "rag_search",
  "list_attachments",
  "save_view",
  "memory_list",
  "create_page_extension",
  "page_digest",
  "skill_search",
  "skill_read",
  "skill_save",
  "list_custom_tools",
  "custom_tool_save",
  "ux_critique",
  "open_preview",
  "annotate_screenshot",
  "page_css_preview",
  "page_css_clear",
  "create_task",
  "update_task",
  "list_tasks",
  "reorder_tasks",
] as const;

function loadEnabledTools(): Set<string> {
  try {
    const raw = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (!raw) return new Set(ALL_TOOL_NAMES);
    const saved = (JSON.parse(raw) as string[]).filter((n) => ALL_TOOL_NAMES.includes(n));
    const next = new Set(saved);
    if (!localStorage.getItem(TOOLS_MIGRATE_FLAG)) {
      for (const n of TOOLS_MIGRATE_ADD) {
        if (ALL_TOOL_NAMES.includes(n)) next.add(n);
      }
      localStorage.setItem(TOOLS_MIGRATE_FLAG, "1");
    }
    // Empty array is a valid "disable all" choice.
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
  const [registry, setRegistry] = useState<VaultRegistryState>(() => emptyRegistry());
  const [vault, setVault] = useState(() => new Vault());
  const memory = useMemo(() => new MemoryStore(), []);
  const skills = useMemo(() => new SkillStore(), []);
  const sessions = useMemo(() => new SessionStore(), []);
  const rag = useMemo(() => new RagStore(), []);
  const attachments = useMemo(() => new AttachmentStore(), []);
  const artifacts = useMemo(() => new ArtifactStore(), []);
  const views = useMemo(() => new ViewStore(), []);
  const actionLog = useMemo(() => new ActionLogStore(), []);
  const agentProfiles = useMemo(() => new AgentProfileStore(), []);
  const usageStore = useMemo(() => new UsageStore(), []);
  const taskStore = useMemo(() => new TaskStore(), []);
  const customTools = useMemo(() => new CustomToolStore(), []);
  const approvalPolicies = useMemo(() => new ApprovalPolicyStore(), []);
  const changeLog = useMemo(() => new ChangeLogStore(), []);
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
  const [locked, setLocked] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [llmProvider, setLlmProvider] = useState<LlmProviderId>("openrouter");
  const [llmBaseUrl, setLlmBaseUrl] = useState(() => resolveProvider("openrouter").baseUrl);
  /** Per-provider key + base for multi ModelPicker (refreshed on unlock / settings save). */
  const [providerCreds, setProviderCreds] = useState<
    Partial<Record<LlmProviderId, { key: string; base: string }>>
  >({});
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    () => localStorage.getItem(WEB_SEARCH_KEY) !== "0",
  );
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [workerModel, setWorkerModel] = useState(DEFAULT_WORKER_MODEL);
  const [visionSettings, setVisionSettingsState] = useState<VisionSettings>(() =>
    loadVisionSettingsFromStorage(),
  );
  const setVisionSettings = useCallback((next: VisionSettings) => {
    const merged = mergeVisionSettings(next);
    setVisionSettingsState(merged);
    persistVisionSettings(merged);
  }, []);
  const [customModel, setCustomModel] = useState("");
  const [customWorkerModel, setCustomWorkerModel] = useState("");
  const [tab, setTab] = useState<TabId>("chat");
  const [libSubnav, setLibSubnav] = useState<LibSubNav>("tables");
  const [contentTick, setContentTick] = useState(0);
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
  const [sessionsDrawerOpen, setSessionsDrawerOpen] = useState(false);
  const [sessionsPinned, setSessionsPinned] = useState(
    () => localStorage.getItem(SESSIONS_PINNED_KEY) === "1",
  );
  const [runtimeMeta, setRuntimeMeta] = useState<SessionRuntimeMeta[]>([]);
  const [tasksDrawerOpen, setTasksDrawerOpen] = useState(false);
  const [tasksRefreshTick, setTasksRefreshTick] = useState(0);
  const [idCopied, setIdCopied] = useState(false);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessionUsage, setSessionUsage] = useState<UsageSplit>(() => emptySplit());
  const [lastTurnUsage, setLastTurnUsage] = useState<UsageSplit | null>(null);
  const [usageDetailsOpen, setUsageDetailsOpen] = useState(false);
  const [budgetInfoOpen, setBudgetInfoOpen] = useState(false);
  /** Live SSE tool name while model plans tools (pre tool_start). */
  const [planningTool, setPlanningTool] = useState<string | null>(null);
  type QueuedSend = {
    sessionId: string;
    text: string;
    attachments: AttachmentRecord[];
    secrets: PendingSecret[];
    picks: PickedElementRef[];
    activeTab?: ActiveTabContext;
    source?: "local" | "link" | "mcp";
  };
  const [sendQueue, setSendQueue] = useState<QueuedSend[]>([]);
  const sendQueueRef = useRef<QueuedSend[]>([]);
  const queueDrainLockRef = useRef(false);
  const runningRef = useRef(false);
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentRecord[]>([]);
  const [pendingPicks, setPendingPicks] = useState<PickedElementRef[]>([]);
  const [picking, setPicking] = useState(false);
  const [detectSecrets, setDetectSecrets] = useState(
    () => localStorage.getItem(DETECT_SECRETS_KEY) !== "0",
  );
  const [pendingSecrets, setPendingSecrets] = useState<PendingSecret[]>([]);
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
  const runtimesRef = useRef<Map<string, SessionRuntime>>(new Map());
  const abortBySessionRef = useRef<Map<string, AbortController>>(new Map());
  /** Combo Link — filled after useComboLink / send are defined */
  const linkPersistRef = useRef<
    ((session: ChatSession, running: boolean) => void | Promise<void>) | null
  >(null);
  const linkPublishRef = useRef<
    | ((
        events: Array<Record<string, unknown>>,
        opts?: { sessionId?: string; commandId?: string },
      ) => void | Promise<void>)
    | null
  >(null);
  const sendRef = useRef<
    (overrideText?: string, queued?: QueuedSend) => Promise<boolean>
  >(async () => false);
  const loadSessionRef = useRef<(id: string) => Promise<void>>(async () => {});
  const pendingApprovalBySessionRef = useRef<
    Map<
      string,
      {
        tool: string;
        args: Record<string, unknown>;
        resolve: (allow: boolean) => void;
      }
    >
  >(new Map());
  const activeSessionIdRef = useRef<string | null>(null);
  const turnsRef = useRef<UiTurn[]>([]);
  const sessionUsageRef = useRef<UsageSplit>(emptySplit());
  const lastTurnUsageRef = useRef<UsageSplit | null>(null);
  const statusRef = useRef("");
  const unlockedThisRunRef = useRef<string[]>([]);
  const approvalModeRef = useRef(approvalMode);
  const [showActions, setShowActions] = useState(() => {
    const v = localStorage.getItem(SHOW_ACTIONS_KEY);
    return v !== "0";
  });
  const [maxStepsOverride, setMaxStepsOverride] = useState<number>(() => {
    const n = Number(localStorage.getItem(MAX_STEPS_KEY));
    return STEPS_PRESETS.includes(n as (typeof STEPS_PRESETS)[number]) ? n : 16;
  });
  const [unlockedThisRun, setUnlockedThisRun] = useState<string[]>([]);

  useEffect(() => {
    approvalModeRef.current = approvalMode;
    localStorage.setItem(APPROVAL_KEY, approvalMode);
  }, [approvalMode]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    sessionUsageRef.current = sessionUsage;
  }, [sessionUsage]);
  useEffect(() => {
    lastTurnUsageRef.current = lastTurnUsage;
  }, [lastTurnUsage]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    unlockedThisRunRef.current = unlockedThisRun;
  }, [unlockedThisRun]);
  useEffect(() => {
    activeSessionIdRef.current = currentSession?.id ?? null;
  }, [currentSession?.id]);

  useEffect(() => {
    localStorage.setItem(SESSIONS_PINNED_KEY, sessionsPinned ? "1" : "0");
  }, [sessionsPinned]);

  useEffect(() => {
    if (sessionsPinned) setSessionsDrawerOpen(true);
  }, [sessionsPinned]);

  const bumpRuntimeMeta = useCallback(() => {
    setRuntimeMeta(metaFromRuntimes(runtimesRef.current));
  }, []);

  const ensureRuntime = useCallback((sessionId: string): SessionRuntime => {
    let rt = runtimesRef.current.get(sessionId);
    if (!rt) {
      rt = createEmptyRuntime(sessionId, ZERO);
      runtimesRef.current.set(sessionId, rt);
    }
    return rt;
  }, []);

  const stashActiveWorkspace = useCallback(() => {
    const id = activeSessionIdRef.current;
    if (!id) return;
    const rt = ensureRuntime(id);
    if (!rt.running) {
      rt.turns = turnsRef.current;
      rt.history = historyRef.current;
      rt.sessionUsage = sessionUsageRef.current;
      rt.lastTurnUsage = lastTurnUsageRef.current;
      rt.unlockedThisRun = unlockedThisRunRef.current;
      rt.status = statusRef.current;
    }
    rt.lastTouchedAt = Date.now();
  }, [ensureRuntime]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const removed = evictIdleRuntimes(
        runtimesRef.current,
        activeSessionIdRef.current,
        Date.now(),
        SESSION_IDLE_EVICT_MS,
      );
      if (removed.length) bumpRuntimeMeta();
    }, 30_000);
    return () => window.clearInterval(tick);
  }, [bumpRuntimeMeta]);

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
    localStorage.setItem(SHOW_ACTIONS_KEY, showActions ? "1" : "0");
  }, [showActions]);

  useEffect(() => {
    localStorage.setItem(DETECT_SECRETS_KEY, detectSecrets ? "1" : "0");
  }, [detectSecrets]);

  /** Sync auto-detected secrets into pending queue (preserves manual + label/include edits). */
  useEffect(() => {
    setPendingSecrets((prev) => {
      const manuals = prev.filter((p) => p.source === "manual");
      if (!detectSecrets) {
        if (prev.length === manuals.length && prev.every((p, i) => p.id === manuals[i]?.id)) {
          return prev;
        }
        return manuals;
      }
      const reserved = [...vaultLabels, ...manuals.map((m) => m.label)];
      const assigned = assignUniqueLabels(detectChatSecrets(input), reserved);
      const manualValues = new Set(manuals.map((m) => m.value));
      const detected: PendingSecret[] = assigned
        .filter((e) => !manualValues.has(e.value))
        .map((e) => {
          const prevRow = prev.find((p) => p.source === "detected" && p.value === e.value);
          return {
            id: prevRow?.id ?? crypto.randomUUID(),
            label: prevRow?.label ?? e.label,
            value: e.value,
            useNote: prevRow?.useNote,
            source: "detected" as const,
            include: prevRow?.include ?? true,
          };
        });
      const next = [...detected, ...manuals];
      if (
        next.length === prev.length &&
        next.every(
          (n, i) =>
            prev[i]?.id === n.id &&
            prev[i]?.value === n.value &&
            prev[i]?.label === n.label &&
            prev[i]?.include === n.include &&
            prev[i]?.source === n.source &&
            prev[i]?.useNote === n.useNote,
        )
      ) {
        return prev;
      }
      return next;
    });
  }, [input, detectSecrets, vaultLabels]);

  useEffect(() => {
    localStorage.setItem(MAX_STEPS_KEY, String(maxStepsOverride));
  }, [maxStepsOverride]);

  const [, setSetupMsg] = useState("");
  const [, setRagPathHint] = useState(
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

  /** Persist ceiling to localStorage (via effect) + active agent allowlist when set. */
  const updateEnabledTools = useCallback(
    (fn: (prev: Set<string>) => Set<string>) => {
      setEnabledTools((prev) => {
        const next = fn(prev);
        const agentId = activeAgentId;
        if (agentId) {
          void (async () => {
            const p = await agentProfiles.get(agentId);
            if (!p) return;
            await agentProfiles.put({
              ...p,
              toolAllowlist: [...next],
            });
            const list = await agentProfiles.list();
            setAgentList(list);
          })();
        }
        return next;
      });
    },
    [activeAgentId, agentProfiles],
  );

  const effectiveToolMode: AgentToolMode = useMemo(() => {
    const p = agentList.find((a) => a.id === activeAgentId);
    return p?.toolMode ?? "skill_gated";
  }, [agentList, activeAgentId]);
  const effectiveApproval: ApprovalMode = useMemo(() => {
    const p = agentList.find((a) => a.id === activeAgentId);
    return p?.approvalMode ?? approvalMode;
  }, [agentList, activeAgentId, approvalMode]);
  const [, setConnectorCount] = useState(0);

  /**
   * Setup page writes `combo_x_setup_payload`. Re-applying tools on every focus/mount
   * wiped Libraries/Settings toggles (page_digest, etc.). Only replace tools/approval
   * on explicit Setup → Apply (`syncTools` / `syncApproval`). Soft sync stays additive
   * for connector/RAG hints only.
   */
  const applySetupPayload = useCallback(
    (payload: unknown, opts?: { syncApproval?: boolean; syncTools?: boolean }) => {
      if (!payload || typeof payload !== "object") return false;
      const p = payload as {
        type?: string;
        tools?: string[];
        approvalMode?: string;
        ragPathHint?: string | null;
        connectors?: string[];
      };
      if (p.type !== "combo-x-setup") return false;
      if (opts?.syncTools && Array.isArray(p.tools)) {
        setEnabledTools((prev) => {
          const nextNames = resolveEnabledToolsFromSetup({
            prev: [...prev],
            setupTools: p.tools,
            allToolNames: ALL_TOOL_NAMES,
            opts: { syncTools: true },
          });
          return new Set(nextNames);
        });
      }
      if (
        opts?.syncApproval &&
        (p.approvalMode === "ask" ||
          p.approvalMode === "auto_llm" ||
          p.approvalMode === "auto_all")
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
      setSetupMsg(
        opts?.syncTools
          ? `Applied setup (${p.tools?.length ?? 0} tools, approval=${p.approvalMode ?? "?"})`
          : `Setup hints synced (tools unchanged)`,
      );
      return true;
    },
    [],
  );

  useEffect(() => {
    const softSync = () => {
      try {
        const raw = localStorage.getItem("combo_x_setup_payload");
        if (raw) applySetupPayload(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    };
    softSync();
    void chrome.storage.local.get("combo_x_setup_payload").then((res) => {
      if (res.combo_x_setup_payload) applySetupPayload(res.combo_x_setup_payload);
    });
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.combo_x_setup_payload?.newValue) {
        applySetupPayload(changes.combo_x_setup_payload.newValue, {
          syncApproval: true,
          syncTools: true,
        });
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    window.addEventListener("focus", softSync);
    return () => {
      chrome.storage.onChanged.removeListener(onStorage);
      window.removeEventListener("focus", softSync);
    };
  }, [applySetupPayload]);

  const refreshVaultLabels = useCallback(async () => {
    if (!vault.isUnlocked()) return setVaultLabels([]);
    setVaultLabels(await vault.listLabels());
  }, [vault]);

  const readyProviders = useMemo(() => {
    return LLM_PROVIDER_PRESETS.filter((p) =>
      isProviderReady(p, providerCreds[p.id]?.key),
    ).map((p) => ({
      id: p.id,
      label: p.label,
      apiKey: providerCreds[p.id]?.key ?? "",
      baseUrl: providerCreds[p.id]?.base ?? p.baseUrl,
      keyOptional: p.keyOptional,
    }));
  }, [providerCreds]);

  const selectProviderModel = useCallback(
    async (pid: LlmProviderId, modelId: string) => {
      const preset = resolveProvider(pid);
      const get = (label: string) => vault.getByLabel(label);
      const key =
        providerCreds[pid]?.key ?? (await resolveProviderApiKey(pid, get));
      const base =
        providerCreds[pid]?.base ??
        (await resolveProviderBaseUrl(pid, get, { activeProviderId: pid }));
      const defaults = defaultModelsForProvider(pid);
      const orch = normalizeModelId(modelId, pid);
      const storedWorker = (await get(workerModelVaultLabel(pid)))?.trim();
      const worker = normalizeModelId(storedWorker || defaults.worker, pid);
      setLlmProvider(pid);
      setApiKey(key);
      setLlmBaseUrl(base);
      setModel(orch);
      setWorkerModel(worker);
      setCustomModel(orch);
      setCustomWorkerModel(worker);
      if (preset.local) setWebSearchEnabled(false);
      void (async () => {
        await vault.putByLabel(LLM_PROVIDER_KEY, pid);
        await vault.putByLabel(MODEL_LABEL, orch);
        await vault.putByLabel(WORKER_MODEL_LABEL, worker);
        await vault.putByLabel(modelVaultLabel(pid), orch);
        await vault.putByLabel(workerModelVaultLabel(pid), worker);
        await vault.putByLabel(LLM_BASE_URL_KEY, base);
        await vault.putByLabel(baseUrlVaultLabel(pid), base);
      })();
      setStatus(`Provider → ${preset.label} · ${orch}`);
    },
    [providerCreds, vault],
  );

  const refreshSessions = useCallback(async () => {
    setSessionList(await sessions.list(40));
  }, [sessions]);

  const persistSession = useCallback(
    async (session: ChatSession, nextTurns: UiTurn[], usage: LlmUsage) => {
      const msgs: SessionMessage[] = nextTurns.map((t) => {
        const base: SessionMessage = {
          id: t.id,
          role: t.role,
          content: t.content,
          createdAt: t.createdAt ?? new Date().toISOString(),
          bookmarked: t.bookmarked,
          usage: t.usage,
          tools: t.tools,
          source: t.source,
        };
        if (t.role === "assistant" && t.blocks?.length) {
          base.blocks = t.blocks;
        }
        if (t.role === "user" && t.runContext) {
          base.runContext = slimRunContextForStorage(t.runContext);
        }
        if (t.role === "user" && t.picks?.length) {
          base.picks = t.picks as unknown as SessionMessage["picks"];
        }
        if (t.role === "user" && t.activeTab) {
          base.activeTab = t.activeTab;
        }
        return base;
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
      try {
        await sessions.save(updated);
        // Never hijack the open chat when a background run persists.
        if (activeSessionIdRef.current === updated.id) {
          setCurrentSession(updated);
          localStorage.setItem(LAST_SESSION_KEY, updated.id);
        }
        await refreshSessions();
        // Combo Link / chat sync — best-effort (refs filled after hook mounts)
        void linkPersistRef.current?.(updated, false);
      } catch (err) {
        console.error("[persistSession] failed", err);
        if (activeSessionIdRef.current === updated.id) {
          setStatus("Warning: could not save session history");
        }
      }
    },
    [refreshSessions, sessions],
  );

  useEffect(() => {
    void (async () => {
      const state = await ensureRegistryMigrated();
      setRegistry(state);
      const entry = getActiveEntry(state);
      if (entry) {
        setVault(openVaultFromEntry(entry));
        setLocked(true);
      } else {
        setVault(new Vault());
        setLocked(false);
      }
      setReady(true);
      await refreshSessions();
    })();
  }, [refreshSessions]);

  const refreshProviderCreds = useCallback(async (v: Vault) => {
    const get = (label: string) => v.getByLabel(label);
    const next: Partial<Record<LlmProviderId, { key: string; base: string }>> = {};
    for (const p of LLM_PROVIDER_PRESETS) {
      next[p.id] = {
        key: await resolveProviderApiKey(p.id, get),
        base: await resolveProviderBaseUrl(p.id, get),
      };
    }
    setProviderCreds(next);
  }, []);

  const afterUnlock = useCallback(async (activeVault?: Vault) => {
    const v = activeVault ?? vault;
    // Restore Combo API base / sync token from vault labels (LAN config survives)
    await hydrateCloudConfigFromVault((label) => v.getByLabel(label));
    const get = (label: string) => v.getByLabel(label);
    const storedProvider = await v.getByLabel(LLM_PROVIDER_KEY);
    const provider = resolveProvider(storedProvider);
    setLlmProvider(provider.id);
    const key = await resolveProviderApiKey(provider.id, get);
    const storedBase = await resolveProviderBaseUrl(provider.id, get, {
      activeProviderId: provider.id,
    });
    setLlmBaseUrl(storedBase);
    let storedModel =
      (await v.getByLabel(modelVaultLabel(provider.id))) ||
      (await v.getByLabel(MODEL_LABEL));
    const normalized = normalizeModelId(storedModel, provider.id);
    if (storedModel && storedModel !== normalized) {
      await v.putByLabel(MODEL_LABEL, normalized);
      storedModel = normalized;
    }
    if (normalized) setModel(normalized);
    const storedWorker =
      (await v.getByLabel(workerModelVaultLabel(provider.id))) ||
      (await v.getByLabel(WORKER_MODEL_LABEL));
    const workerNorm = storedWorker
      ? normalizeModelId(storedWorker, provider.id)
      : provider.defaultWorkerModel;
    setWorkerModel(workerNorm);
    if (storedWorker && storedWorker !== workerNorm) {
      await v.putByLabel(WORKER_MODEL_LABEL, workerNorm);
    }
    if (provider.local) setWebSearchEnabled(false);
    setApiKey(key);
    setLocked(false);
    setVaultLabels(await v.listLabels());
    await refreshProviderCreds(v);
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
              blocks: m.blocks as TurnBlock[] | undefined,
              usage: m.usage,
              runContext: m.runContext as RunContextSnapshot | undefined,
            })),
        );
        historyRef.current = historyFromUiTurns(
          last.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
              tools: m.tools,
            })),
        );
        setSessionUsage({
          ...emptySplit(),
          total: {
            ...ZERO,
            totalTokens: last.totalTokens,
            estimatedCostUsd: last.estimatedCostUsd,
          },
        });
      } else {
        const s = await sessions.create("New chat");
        setCurrentSession(s);
        localStorage.setItem(LAST_SESSION_KEY, s.id);
      }
    }
    if (!key && !provider.keyOptional) {
      setStatus(
        `Unlocked — add ${provider.label} key in Settings (${apiKeyVaultLabel(provider.id)}) before chatting`,
      );
    } else {
      setStatus("Unlocked");
    }
  }, [
    agentProfiles,
    connectorStore,
    currentSession,
    rag,
    refreshProviderCreds,
    refreshVaultLabels,
    sessions,
    vault,
  ]);

  const newChat = useCallback(async () => {
    stashActiveWorkspace();
    // Do not abort background runs — leave them on their session runtime.
    const s = await sessions.create("New chat");
    localStorage.setItem(LAST_SESSION_KEY, s.id);
    activeSessionIdRef.current = s.id;
    ensureRuntime(s.id);
    abortRef.current = null;
    runningRef.current = false;
    setCurrentSession(s);
    setTurns([]);
    historyRef.current = [];
    setEditingTurnId(null);
    setInspectTurnId(null);
    setPendingAttachments([]);
    setPendingPicks([]);
    setAttachMsg("");
    setSessionUsage(emptySplit());
    setLastTurnUsage(null);
    setSubagentRuns([]);
    setStreamingId(null);
    setUnlockedThisRun([]);
    setPendingApproval(null);
    setRunning(false);
    setStatus("");
    setTab("chat");
    bumpRuntimeMeta();
    await refreshSessions();
  }, [bumpRuntimeMeta, ensureRuntime, refreshSessions, sessions, stashActiveWorkspace]);

  const startElementPick = useCallback(async () => {
    if (picking) {
      setPicking(false);
      void chrome.runtime.sendMessage({ type: "element_picker", action: "stop" });
      setStatus("Picker cancelled");
      return;
    }
    setPicking(true);
    setStatus("Click an element on the page (Esc to cancel)…");
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "element_picker",
        action: "start",
      })) as {
        ok?: boolean;
        cancelled?: boolean;
        data?: PickedElementRef;
        error?: string;
      };
      if (res?.ok && res.data) {
        setPendingPicks((prev) => [...prev, res.data!].slice(-8));
        setStatus(`Picked ${pickedElementChipLabel(res.data)}`);
      } else if (res?.cancelled) {
        setStatus("Picker cancelled");
      } else {
        setStatus(res?.error ? `Picker: ${res.error}` : "Picker failed");
      }
    } catch (e) {
      setStatus(`Picker: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPicking(false);
    }
  }, [picking]);

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
        if (currentSession) void persistSession(currentSession, next, sessionUsage.total);
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
    stashActiveWorkspace();
    const s = await sessions.get(id);
    if (!s) return;
    localStorage.setItem(LAST_SESSION_KEY, s.id);
    activeSessionIdRef.current = id;

    const cached = runtimesRef.current.get(id);
    if (cached) {
      cached.unread = false;
      cached.lastTouchedAt = Date.now();
      setCurrentSession(s);
      setTurns(cached.turns as UiTurn[]);
      historyRef.current = cached.history;
      setSessionUsage(cached.sessionUsage);
      setLastTurnUsage(cached.lastTurnUsage);
      setUnlockedThisRun(cached.unlockedThisRun);
      setStreamingId(cached.streamingId);
      setStatus(cached.status);
      setRunning(cached.running);
      runningRef.current = cached.running;
      abortRef.current = abortBySessionRef.current.get(id) ?? null;
      setPendingApproval(pendingApprovalBySessionRef.current.get(id) ?? null);
      setPendingAttachments([]);
      setPendingPicks([]);
      setAttachMsg("");
      setEditingTurnId(null);
      setInspectTurnId(null);
      setSubagentRuns([]);
      setTab("chat");
      bumpRuntimeMeta();
      return;
    }

    const turnsFromDb: UiTurn[] = s.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt,
        bookmarked: m.bookmarked,
        tools: m.tools as ToolChipData[] | undefined,
        blocks: m.blocks as TurnBlock[] | undefined,
        usage: m.usage,
        runContext: m.runContext as RunContextSnapshot | undefined,
        picks: m.picks as PickedElementRef[] | undefined,
        activeTab: m.activeTab,
      }));
    const history = historyFromUiTurns(
      turnsFromDb.map((m) => ({
        role: m.role,
        content: m.content,
        tools: m.tools,
      })),
    );
    const usage = {
      ...emptySplit(),
      total: {
        ...ZERO,
        totalTokens: s.totalTokens,
        estimatedCostUsd: s.estimatedCostUsd,
      },
    };
    const rt = ensureRuntime(id);
    rt.turns = turnsFromDb;
    rt.history = history;
    rt.sessionUsage = usage;
    rt.unread = false;
    rt.lastTouchedAt = Date.now();

    setCurrentSession(s);
    setTurns(turnsFromDb);
    historyRef.current = history;
    setSessionUsage(usage);
    setLastTurnUsage(null);
    setUnlockedThisRun([]);
    setStreamingId(null);
    setStatus("");
    setRunning(false);
    runningRef.current = false;
    abortRef.current = null;
    setPendingApproval(null);
    setPendingAttachments([]);
    setPendingPicks([]);
    setAttachMsg("");
    setEditingTurnId(null);
    setInspectTurnId(null);
    setSubagentRuns([]);
    setTab("chat");
    bumpRuntimeMeta();
  }, [bumpRuntimeMeta, ensureRuntime, sessions, stashActiveWorkspace]);

  const stop = useCallback(() => {
    // Abort every in-flight session (active + background) so STOP always works.
    for (const [sid, controller] of [...abortBySessionRef.current]) {
      controller.abort();
      abortBySessionRef.current.delete(sid);
      const pa = pendingApprovalBySessionRef.current.get(sid);
      if (pa) {
        pa.resolve(false);
        pendingApprovalBySessionRef.current.delete(sid);
      }
      const rt = runtimesRef.current.get(sid);
      if (rt) {
        rt.running = false;
        rt.activeRunId = null;
        rt.streamingId = null;
        rt.status = "Stopped";
        rt.lastTouchedAt = Date.now();
      }
    }
    // Drop queued sends — STOP must not auto-drain into a new turn.
    sendQueueRef.current = [];
    setSendQueue([]);
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = false;
    setRunning(false);
    setPendingApproval(null);
    setStatus("Stopped");
    bumpRuntimeMeta();
  }, [bumpRuntimeMeta]);

  const removeQueued = useCallback((idx: number) => {
    sendQueueRef.current = sendQueueRef.current.filter((_, i) => i !== idx);
    setSendQueue([...sendQueueRef.current]);
  }, []);

  /** Pre-send: show the system/memory/skills/tool-index + user payload without calling the LLM. */
  const previewOutbound = useCallback(async () => {
    const text = input.trim();
    if (!text && pendingAttachments.length === 0 && pendingPicks.length === 0) {
      setStatus("Type a message, attach a file, or pick an element to preview");
      return;
    }
    if (!vault.isUnlocked()) return setStatus("Unlock vault first");
    try {
      setStatus("Building outbound preview…");
      const key =
        (await resolveProviderApiKey(llmProvider, (l) => vault.getByLabel(l))) ||
        apiKey ||
        "preview";
      const llm = buildLlmClient({
        apiKey: key,
        provider: llmProvider,
        baseUrl: llmBaseUrl,
        webSearchEnabled,
      });
      const agent = new AgentLoop(llm, bridge, memory, sessions, profiles);
      const activeProfile = activeAgentId ? await agentProfiles.get(activeAgentId) : null;
      const runModel = normalizeModelId(activeProfile?.orchestratorModel ?? model);
      const runWorker = normalizeModelId(activeProfile?.workerModel ?? workerModel);
      const runBudget = activeProfile?.budgetMode ?? budgetMode;
      const runToolMode: AgentToolMode = activeProfile?.toolMode ?? "skill_gated";
      const runTools =
        activeProfile?.toolAllowlist === "all"
          ? ALL_TOOL_NAMES
          : activeProfile?.toolAllowlist?.length
            ? activeProfile.toolAllowlist
            : [...enabledTools];
      const pendingIds = pendingAttachments.map((a) => a.id);
      const tabSnap: ActiveTabContext = {
        ...(await getActiveTabMeta()),
        at: new Date().toISOString(),
      };
      const ctx = await agent.previewRunContext({
        model: runModel,
        workerModel: runWorker,
        userMessage:
          text ||
          (pendingPicks.length
            ? "Inspect and interact with the picked element(s)."
            : "Please analyze the attached files."),
        history: historyRef.current,
        systemPrompt: activeProfile?.systemPrompt,
        enabledTools: runTools,
        toolMode: runToolMode,
        skills,
        customTools,
        budgetMode: runBudget,
        tasks: taskStore,
        agents: agentProfiles,
        sessionId: currentSession?.id,
        agentId: activeAgentId ?? undefined,
        attachments,
        pendingAttachmentIds: pendingIds,
        pickedElements: [...pendingPicks],
        activeTab: tabSnap,
      });
      const approxTokens = (s: string) => Math.max(0, Math.ceil(s.length / 4));
      const historyChars = historyRef.current.reduce((n, m) => {
        const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        return n + c.length;
      }, 0);
      const blocks = {
        system: ctx.systemPrompt,
        memories: ctx.memoryBlock || "",
        tasks: ctx.taskBlock || "",
        skills: ctx.skillBlock || "",
        tools: ctx.toolCatalogBlock || "",
        user: ctx.userPreview,
      };
      const promptTokensApprox =
        approxTokens(blocks.system) +
        approxTokens(blocks.memories) +
        approxTokens(blocks.tasks) +
        approxTokens(blocks.skills) +
        approxTokens(blocks.tools) +
        approxTokens(blocks.user) +
        approxTokens("x".repeat(historyChars));
      const body = [
        `≈ ${promptTokensApprox.toLocaleString()} tokens (chars÷4 estimate; tool JSON schemas not fully counted)`,
        `model: ${ctx.model}`,
        `transport: ${ctx.transport}`,
        `history turns: ${ctx.historyTurns}`,
        `active tools (${ctx.toolNames.length}): ${ctx.toolNames.join(", ")}`,
        "",
        `--- SYSTEM (~${approxTokens(blocks.system).toLocaleString()} tok) ---`,
        ctx.systemPrompt,
        "",
        `--- MEMORIES (~${approxTokens(blocks.memories).toLocaleString()} tok) ---`,
        ctx.memoryBlock || "(none)",
        "",
        `--- OPEN TASKS (~${approxTokens(blocks.tasks).toLocaleString()} tok) ---`,
        ctx.taskBlock || "(none)",
        "",
        `--- SKILLS INDEX (~${approxTokens(blocks.skills).toLocaleString()} tok) ---`,
        ctx.skillBlock || "(none)",
        "",
        `--- TOOL INDEX (~${approxTokens(blocks.tools).toLocaleString()} tok; schemas on tools[] only) ---`,
        ctx.toolCatalogBlock || "(none)",
        "",
        `--- USER (~${approxTokens(blocks.user).toLocaleString()} tok) ---`,
        ctx.userPreview,
      ].join("\n");
      setPreview({
        title: `Outbound context · ≈${promptTokensApprox.toLocaleString()} tok`,
        kind: "text",
        body,
      });
      setStatus(`Outbound context · ≈${promptTokensApprox.toLocaleString()} tokens — nothing sent`);
    } catch (err) {
      console.error("[previewOutbound]", err);
      setStatus(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [
    activeAgentId,
    agentProfiles,
    attachments,
    bridge,
    budgetMode,
    currentSession?.id,
    customTools,
    enabledTools,
    input,
    llmBaseUrl,
    llmProvider,
    memory,
    model,
    pendingAttachments,
    pendingPicks,
    profiles,
    sessions,
    skills,
    taskStore,
    vault,
    webSearchEnabled,
    workerModel,
  ]);

  const send = useCallback(
    async (overrideText?: string, queued?: QueuedSend): Promise<boolean> => {
      const activeId = activeSessionIdRef.current ?? currentSession?.id ?? null;
      if (activeId && runtimesRef.current.get(activeId)?.running) return false;
      if (!activeId && runningRef.current) return false;
      let text = (overrideText ?? (queued ? queued.text : input)).trim();
      const pending = queued?.attachments ?? pendingAttachments;
      // Snapshot immediately — React state may clear before await points below.
      const picks = [...(queued?.picks ?? pendingPicks)];
      if (!text && pending.length === 0 && picks.length === 0) return false;
      if (!vault.isUnlocked()) {
        setStatus("Unlock vault first");
        return false;
      }

      // Embed queued secrets into the vault BEFORE send/history (no race with agent tools).
      const secretsSource = queued?.secrets ?? pendingSecrets;
      const toEmbed = secretsSource.filter((p) => p.include && p.label.trim() && p.value);
      if (toEmbed.length) {
        try {
          for (const e of toEmbed) {
            await vault.putByLabel(e.label.trim(), e.value);
          }
          await refreshVaultLabels();
          if (text) {
            const embedded = embedSecretsInMessage(
              text,
              toEmbed.map((e) => ({
                label: e.label.trim(),
                value: e.value,
                useNote: e.useNote,
              })),
            );
            text = embedded.text.trim();
          }
          if (!queued) setPendingSecrets([]);
          setStatus(`Embedded ${toEmbed.length} secret(s) in vault`);
        } catch (err) {
          setStatus(`Vault embed failed: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        }
      }

      const provider = resolveProvider(llmProvider);
      const key =
        apiKey.trim() ||
        (await resolveProviderApiKey(llmProvider, (l) => vault.getByLabel(l))) ||
        "";
      if (!key.trim() && !provider.keyOptional) {
        // Stay on Chat — forced tab switch felt like a redirect bug.
        setStatus(
          `Missing API key for ${provider.label}. Open Settings → LLM and paste your key (vault label ${apiKeyVaultLabel(provider.id)}), or pick a model from another configured provider / Ollama.`,
        );
        return false;
      }

      const displayText =
        text ||
        (pending.length
          ? `Analyze ${pending.length} attachment(s): ${pending.map((p) => p.name).join(", ")}`
          : picks.length
            ? `Inspect picked element(s): ${picks.map((p) => pickedElementChipLabel(p)).join(", ")}`
            : "");

      let session = currentSession;
      if (queued?.sessionId && queued.sessionId !== session?.id) {
        const targeted = await sessions.get(queued.sessionId);
        if (targeted) session = targeted;
      }
      if (!session) {
        session = await sessions.create(displayText.slice(0, 60) || "Attachments", {
          source: queued?.source,
        });
        if (!activeSessionIdRef.current || queued?.source === "link") {
          setCurrentSession(session);
        }
      } else if (queued?.source === "link" && !session.source) {
        session = { ...session, source: "link" };
        await sessions.save(session);
      }

      if (!overrideText && !queued) setInput("");
      const pendingIds = pending.map((p) => p.id);
      if (!queued) {
        setPendingAttachments([]);
        setPendingPicks([]);
      }
      setAttachMsg("");
      const nowIso = new Date().toISOString();
      const tabSnap =
        queued?.activeTab ??
        ({
          ...(await getActiveTabMeta()),
          at: nowIso,
        } satisfies ActiveTabContext);
      const editId = queued ? null : editingTurnId;
      setEditingTurnId(null);
      const boundId = session.id;
      activeSessionIdRef.current = activeSessionIdRef.current ?? boundId;
      const isBoundActive = () => activeSessionIdRef.current === boundId;
      const rt = ensureRuntime(boundId);
      // Atomic claim — closes the race between concurrent send()/queue drain.
      if (rt.running) return false;
      const runId = crypto.randomUUID();
      const controller = new AbortController();
      rt.running = true;
      rt.activeRunId = runId;
      abortBySessionRef.current.set(boundId, controller);
      if (isBoundActive()) {
        abortRef.current = controller;
        runningRef.current = true;
        setRunning(true);
      }

      const bump = () => setRuntimeMeta(metaFromRuntimes(runtimesRef.current));
      try {
      // Prefer persisted runtime turns — React `turns` can lag on queue drain / switch.
      let baseTurns = ((rt.turns as UiTurn[]) ?? []).length
        ? ([...(rt.turns as UiTurn[])] as UiTurn[])
        : turns;
      if (rt.history?.length) historyRef.current = [...rt.history];
      const priorTurnCount = baseTurns.length;
      if (editId) {
        const idx = baseTurns.findIndex((t) => t.id === editId && t.role === "user");
        if (idx >= 0) {
          // UI turns ≠ lean history rows (multi-step crumbs). Rebuild from UI prefix.
          baseTurns = baseTurns.slice(0, idx);
          historyRef.current = historyFromUiTurns(baseTurns);
        }
      }
      const userTurn: UiTurn = {
        id: editId && baseTurns.length < priorTurnCount ? editId : crypto.randomUUID(),
        role: "user",
        content: displayText,
        createdAt: nowIso,
        source: queued?.source ?? "local",
        attachments: pending.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
        picks: picks.length ? picks : undefined,
        activeTab: tabSnap,
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
      rt.turns = nextTurns;
      rt.history = historyRef.current;
      rt.streamingId = assistantId;
      rt.status = pendingIds.length ? `Working with ${pendingIds.length} file(s)…` : "Working…";
      rt.lastTurnUsage = null;
      rt.unlockedThisRun = [];
      rt.lastTouchedAt = Date.now();
      rt.unread = false;

      const publishTurns = (next: UiTurn[] | ((prev: UiTurn[]) => UiTurn[])) => {
        const prev = (rt.turns as UiTurn[]) ?? [];
        const resolved = typeof next === "function" ? next(prev) : next;
        rt.turns = resolved;
        rt.lastTouchedAt = Date.now();
        if (isBoundActive()) setTurns(resolved);
        else bump();
      };
      const publishStatus = (msg: string) => {
        rt.status = msg;
        if (isBoundActive()) setStatus(msg);
      };
      const publishStreaming = (id: string | null) => {
        rt.streamingId = id;
        if (isBoundActive()) setStreamingId(id);
      };
      const publishUnlocked = (names: string[]) => {
        rt.unlockedThisRun = names;
        if (isBoundActive()) setUnlockedThisRun(names);
      };
      const publishLastTurn = (split: UsageSplit | null) => {
        rt.lastTurnUsage = split;
        if (isBoundActive()) setLastTurnUsage(split);
      };
      const publishSessionUsage = (split: UsageSplit) => {
        rt.sessionUsage = split;
        if (isBoundActive()) setSessionUsage(split);
      };

      if (isBoundActive()) {
        setTurns(nextTurns);
        setStreamingId(assistantId);
        setSubagentRuns([]);
        setStatus(rt.status);
        setLastTurnUsage(null);
        setUnlockedThisRun([]);
      }
      bump();

      const llm = buildLlmClient({
        apiKey: key,
        provider: llmProvider,
        baseUrl: llmBaseUrl,
        webSearchEnabled,
      });
      const omitComboWebSearch = shouldOmitComboWebSearch(llmProvider, webSearchEnabled);
      const agent = new AgentLoop(llm, bridge, memory, sessions, profiles);
      const activeProfile = activeAgentId ? await agentProfiles.get(activeAgentId) : null;
      const runModel = normalizeModelId(activeProfile?.orchestratorModel ?? model);
      const runWorker = normalizeModelId(activeProfile?.workerModel ?? workerModel);
      const runBudget = activeProfile?.budgetMode ?? budgetMode;
      const runApproval = activeProfile?.approvalMode ?? approvalModeRef.current;
      // Prefer composer override; profile maxSteps only if explicitly stored (not resolve default 32).
      const runMaxSteps = maxStepsOverride || activeProfile?.maxSteps || undefined;
      const runToolMode: AgentToolMode =
        activeProfile?.toolMode ?? "skill_gated";
      const runTools =
        activeProfile?.toolAllowlist === "all"
          ? ALL_TOOL_NAMES
          : activeProfile?.toolAllowlist?.length
            ? activeProfile.toolAllowlist
            : [...enabledTools];
      const connectorAllowlist =
        activeProfile?.connectorIds?.length ? activeProfile.connectorIds : undefined;
      let turnSplit = emptySplit();
      const toolMap = new Map<string, ToolChipData>();
      const blocks: TurnBlock[] = [];
      const turnArtifacts: ChatArtifactPayload[] = [];
      let liveContent = "";
      let liveReasoning = "";
      /** Captured from run_context — local nextTurns must not wipe React state at end-of-run. */
      let capturedRunContext: RunContextSnapshot | undefined;
      const sessionIdForLog = session.id;
      const historyAtStart = [...historyRef.current];

      const flushAssistant = (extra?: Partial<UiTurn>) => {
        const tools = [...toolMap.values()];
        publishTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  tools: [...tools],
                  blocks: [...blocks],
                  content: liveContent,
                  liveReasoning: liveReasoning || undefined,
                  ...extra,
                }
              : t,
          ),
        );
      };

      const commitLivesToBlocks = () => {
        if (liveReasoning.trim()) {
          blocks.push({
            id: crypto.randomUUID(),
            kind: "reasoning",
            text: liveReasoning.trim(),
          });
          liveReasoning = "";
        }
        if (liveContent.trim()) {
          blocks.push({
            id: crypto.randomUUID(),
            kind: "thought",
            text: liveContent.trim(),
          });
          liveContent = "";
        }
      };

      const flushTools = () => {
        flushAssistant();
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
        // Mirror select events to Combo Link portal (TLS relay — not E2E)
        if (
          event.type === "assistant_delta" ||
          event.type === "reasoning_delta" ||
          event.type === "tool_start" ||
          event.type === "tool_result" ||
          event.type === "status" ||
          event.type === "done" ||
          event.type === "error"
        ) {
          void linkPublishRef.current?.(
            [
              {
                type: event.type,
                session_id: boundId,
                message: event.message,
                tool: event.tool,
                toolCallId: event.toolCallId,
              },
            ],
            { sessionId: boundId },
          );
        }
        if (event.type === "status" && event.message) {
          if (event.message.startsWith("Calling model")) {
            if (isBoundActive()) setPlanningTool(null);
          }
          publishStatus(event.message);
        }
        if (event.type === "usage" && event.usage) {
          const u = event.usage;
          const src = event.usageSource;
          const bucket =
            src === "worker" || src === "vision_worker" || src === "approval"
              ? "worker"
              : "orch";
          turnSplit = {
            total: addUsage(turnSplit.total, u),
            orch: bucket === "orch" ? addUsage(turnSplit.orch, u) : turnSplit.orch,
            worker: bucket === "worker" ? addUsage(turnSplit.worker, u) : turnSplit.worker,
          };
          publishLastTurn(turnSplit);
          const prevUsage = rt.sessionUsage;
          publishSessionUsage({
            total: addUsage(prevUsage.total, u),
            orch: bucket === "orch" ? addUsage(prevUsage.orch, u) : prevUsage.orch,
            worker: bucket === "worker" ? addUsage(prevUsage.worker, u) : prevUsage.worker,
          });
        }
        if (event.type === "tool_approval" && event.resolve) {
          const pending = {
            tool: event.tool ?? "tool",
            args: event.args ?? {},
            resolve: event.resolve,
          };
          pendingApprovalBySessionRef.current.set(boundId, pending);
          void linkPublishRef.current?.(
            [
              {
                type: "tool_approval",
                session_id: boundId,
                tool: pending.tool,
                args: pending.args,
              },
            ],
            { sessionId: boundId },
          );
          if (!isBoundActive()) {
            rt.unread = true;
            publishStatus(`Needs approval: ${pending.tool}`);
            bump();
          } else {
            setPendingApproval(pending);
          }
        }
        if (event.type === "tool_planning" && event.tool) {
          if (isBoundActive()) setPlanningTool(event.tool);
          publishStatus(`Planning: ${event.tool}…`);
        }
        if (event.type === "tool_start" && event.tool) {
          if (isBoundActive()) setPlanningTool(null);
          const id = event.toolCallId ?? crypto.randomUUID();
          commitLivesToBlocks();
          toolMap.set(id, {
            id,
            name: event.tool,
            args: event.args ?? {},
            status: "running",
          });
          const last = blocks[blocks.length - 1];
          if (last?.kind === "tools") {
            if (!last.toolIds.includes(id)) last.toolIds.push(id);
          } else {
            blocks.push({ id: crypto.randomUUID(), kind: "tools", toolIds: [id] });
          }
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
          // Commit any live narration before tools that skipped tool_start.
          if (![...blocks].some((b) => b.kind === "tools" && b.toolIds.includes(id))) {
            commitLivesToBlocks();
          }
          toolMap.set(id, {
            id,
            name: event.tool,
            args,
            result: event.result,
            status: denied ? "denied" : "done",
          });
          if (![...blocks].some((b) => b.kind === "tools" && b.toolIds.includes(id))) {
            const last = blocks[blocks.length - 1];
            if (last?.kind === "tools") last.toolIds.push(id);
            else blocks.push({ id: crypto.randomUUID(), kind: "tools", toolIds: [id] });
          }
          flushTools();
          if (
            (event.tool === "create_agent" || event.tool === "create_agent_profile") &&
            resultOk(event.result)
          ) {
            void agentProfiles.list().then(setAgentList);
          }
          if (
            (event.tool === "create_task" ||
              event.tool === "update_task" ||
              event.tool === "reorder_tasks") &&
            resultOk(event.result)
          ) {
            setTasksRefreshTick((n) => n + 1);
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
          capturedRunContext = ctx;
          publishTurns((prev) =>
            prev.map((t) =>
              t.id === userTurn.id
                ? { ...t, runContext: ctx }
                : t.id === assistantId
                  ? { ...t, delivery: ctx.transport }
                  : t,
            ),
          );
        }
        if (event.type === "tools_unlocked") {
          const unlocked = event.unlockedTools ?? [];
          publishUnlocked([...new Set([...rt.unlockedThisRun, ...unlocked])]);
          if (unlocked.length) {
            publishStatus(
              `Unlocked ${unlocked.length} tools via skill${event.skillId ? ` (${event.skillId.slice(0, 8)}…)` : ""}`,
            );
          }
          if (capturedRunContext && event.activeTools) {
            capturedRunContext = {
              ...capturedRunContext,
              toolNames: event.activeTools,
            };
          }
          publishTurns((prev) =>
            prev.map((t) =>
              t.id === userTurn.id && t.runContext
                ? {
                    ...t,
                    runContext: {
                      ...t.runContext,
                      toolNames: event.activeTools ?? t.runContext.toolNames,
                    },
                  }
                : t,
            ),
          );
        }
        if (event.type === "reasoning_delta" && event.message != null) {
          liveReasoning = event.message;
          flushAssistant({ delivery: "stream" });
          if (isBoundActive()) setContentTick((n) => n + 1);
        }
        if (event.type === "assistant_delta" && event.message != null) {
          liveContent = event.message;
          flushAssistant({ delivery: "stream" });
          if (isBoundActive()) setContentTick((n) => n + 1);
        }
        if (event.type === "preview" && event.preview) {
          const p = event.preview as ChatArtifactPayload;
          if (isBoundActive()) setPreview(chatPreviewToDrawer(p));
          // Interleave with tools/thoughts (not a dump at the bottom of the turn).
          commitLivesToBlocks();
          turnArtifacts.push(p);
          blocks.push({
            id: crypto.randomUUID(),
            kind: "artifact",
            artifact: p,
          });
          flushAssistant({ artifacts: [...turnArtifacts] });
        }
        if (event.type === "error" && event.message) publishStatus(event.message);
        if (event.type === "done") {
          if (isBoundActive()) setPlanningTool(null);
          publishStreaming(null);
        }
      };

      try {
        if (isBoundActive()) setPlanningTool(null);
        const result = await agent.run({
          model: runModel,
          workerModel: runWorker,
          userMessage: text || displayText,
          history: historyAtStart,
          signal: controller.signal,
          maxSteps: runMaxSteps,
          systemPrompt: activeProfile?.systemPrompt,
          enabledTools: runTools,
          toolMode: runToolMode,
          omitComboWebSearch,
          skills,
          customTools,
          approvalMode: runApproval,
          getApprovalMode: () => activeProfile?.approvalMode ?? approvalModeRef.current,
          approvalModel: runWorker,
          budgetMode: runBudget,
          usageLog: usageStore,
          tasks: taskStore,
          pageExtensions,
          agents: agentProfiles,
          sessionId: session.id,
          boundTabId: session.boundTabId,
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
          approvalPolicies,
          changeLog,
          pendingAttachmentIds: pendingIds,
          pickedElements: picks,
          activeTab: tabSnap,
          vision: visionSettings,
          onEvent,
        });
        const lean = leanHistory(
          stripImageParts(result.messages.filter((m) => m.role !== "system")),
        );
        rt.history = lean;
        if (isBoundActive()) historyRef.current = lean;
        nextTurns = (rt.turns as UiTurn[]).map((t) => {
          if (t.id === userTurn.id && capturedRunContext) {
            return { ...t, runContext: capturedRunContext };
          }
          if (t.id !== assistantId) return t;
          if (liveReasoning.trim()) {
            blocks.push({
              id: crypto.randomUUID(),
              kind: "reasoning",
              text: liveReasoning.trim(),
            });
            liveReasoning = "";
          }
          const finalMsg = (result.finalText || liveContent || "(no text)").trim();
          liveContent = "";
          if (finalMsg) {
            blocks.push({
              id: crypto.randomUUID(),
              kind: "message",
              text: finalMsg,
            });
          }
          return {
            ...t,
            content: finalMsg,
            liveReasoning: undefined,
            blocks: [...blocks],
            tools: [...toolMap.values()],
            artifacts: turnArtifacts.length ? [...turnArtifacts] : t.artifacts,
            usage: turnSplit.total,
            usageWorker: turnSplit.worker.totalTokens > 0 ? turnSplit.worker : undefined,
            delivery: capturedRunContext?.transport ?? t.delivery,
          };
        });
        publishTurns(nextTurns);
        publishLastTurn(turnSplit);
        if (session) {
          // rt.sessionUsage already includes this turn via publishSessionUsage.
          await persistSession(session, nextTurns, rt.sessionUsage.total);
        }
        const doneStatus = result.hitStepLimit
          ? "Step limit — say “continue” to keep going"
          : result.aborted
            ? "Stopped"
            : "Done";
        publishStatus(doneStatus);
        if (!isBoundActive() && !result.aborted) {
          rt.unread = true;
          bump();
          void refreshSessions();
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const errText = `Error: ${msg}`;
        const erroredTurns = (rt.turns as UiTurn[]).map((t) => {
          if (t.id !== assistantId) return t;
          const content = t.content?.trim() ? t.content : errText;
          const hasMsg = (t.blocks ?? []).some((b) => b.kind === "message");
          const blocks = hasMsg
            ? t.blocks
            : [
                ...(t.blocks ?? []),
                { id: crypto.randomUUID(), kind: "message" as const, text: content },
              ];
          return { ...t, content, blocks };
        });
        publishTurns(erroredTurns);
        publishStatus("Error");
        if (session) {
          try {
            await persistSession(session, erroredTurns, rt.sessionUsage.total);
          } catch {
            /* already logged in persistSession */
          }
        }
        if (!isBoundActive()) {
          rt.unread = true;
          bump();
          void refreshSessions();
        }
      }
      } finally {
        // Only the owning run may clear — a newer send() may already own this session.
        if (rt.activeRunId === runId) {
          rt.running = false;
          rt.streamingId = null;
          rt.activeRunId = null;
          rt.lastTouchedAt = Date.now();
          if (abortBySessionRef.current.get(boundId) === controller) {
            abortBySessionRef.current.delete(boundId);
          }
          pendingApprovalBySessionRef.current.delete(boundId);
          if (isBoundActive()) {
            runningRef.current = false;
            setRunning(false);
            setStreamingId(null);
            setPendingApproval(null);
            if (abortRef.current === controller) abortRef.current = null;
          }
          bump();
        }
      }
      return true;
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
      editingTurnId,
      enabledTools,
      ensureRuntime,
      input,
      llmBaseUrl,
      llmProvider,
      memory,
      skills,
      customTools,
      approvalPolicies,
      changeLog,
      maxStepsOverride,
      model,
      pendingAttachments,
      pendingPicks,
      pendingSecrets,
      workerModel,
      visionSettings,
      webSearchEnabled,
      persistSession,
      profiles,
      rag,
      refreshSessions,
      refreshVaultLabels,
      sessionUsage,
      sessions,
      taskStore,
      usageStore,
      pageExtensions,
      turns,
      vault,
    ],
  );

  const enqueueOrSend = useCallback(async () => {
    const text = input.trim();
    const pending = pendingAttachments;
    const picks = [...pendingPicks];
    if ((!text && pending.length === 0 && picks.length === 0) || attachBusy || picking) return;
    if (!vault.isUnlocked()) {
      setStatus("Unlock vault first");
      return;
    }
    const activeId = activeSessionIdRef.current ?? currentSession?.id ?? null;
    const activeRunning =
      (activeId ? !!runtimesRef.current.get(activeId)?.running : false) || runningRef.current;
    if (activeRunning) {
      if (!activeId) return;
      const meta = await getActiveTabMeta();
      const item: QueuedSend = {
        sessionId: activeId,
        text:
          text ||
          (pending.length
            ? `Analyze ${pending.length} attachment(s): ${pending.map((p) => p.name).join(", ")}`
            : `Inspect picked element(s): ${picks.map((p) => pickedElementChipLabel(p)).join(", ")}`),
        attachments: [...pending],
        secrets: pendingSecrets.map((s) => ({ ...s })),
        picks,
        activeTab: { ...meta, at: new Date().toISOString() },
      };
      sendQueueRef.current = [...sendQueueRef.current, item];
      setSendQueue([...sendQueueRef.current]);
      setInput("");
      setPendingAttachments([]);
      setPendingPicks([]);
      setPendingSecrets([]);
      setAttachMsg("");
      setStatus(`Queued · ${sendQueueRef.current.length} waiting`);
      return;
    }
    void send();
  }, [
    attachBusy,
    currentSession?.id,
    input,
    pendingAttachments,
    pendingPicks,
    pendingSecrets,
    picking,
    send,
    vault,
  ]);

  // Keep refs fresh for Combo Link command handlers
  sendRef.current = send;
  loadSessionRef.current = loadSession;

  const comboLink = useComboLink(!locked && vault.isUnlocked(), sessions, {
    onLinkSend: async ({ sessionId, text, createNew }) => {
      try {
        let sid = sessionId;
        if (createNew || !sid) {
          const created = await sessions.create(text.slice(0, 60) || "Link chat", {
            source: "link",
          });
          sid = created.id;
          await loadSessionRef.current(sid);
        } else {
          const existing = await sessions.get(sid);
          if (!existing) {
            return { ok: false, error: "session not found" };
          }
          await loadSessionRef.current(sid);
        }
        const ok = await sendRef.current(text, {
          sessionId: sid!,
          text,
          attachments: [],
          secrets: [],
          picks: [],
          source: "link",
        });
        return ok
          ? { ok: true, sessionId: sid }
          : { ok: false, sessionId: sid, error: "send rejected (busy or locked)" };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    onLinkAbort: (sessionId) => {
      const sid = sessionId ?? activeSessionIdRef.current;
      if (!sid) {
        abortRef.current?.abort();
        return;
      }
      const c = abortBySessionRef.current.get(sid);
      c?.abort();
    },
    onLinkApproval: (sessionId, allow) => {
      const sid = sessionId ?? activeSessionIdRef.current;
      if (!sid) return;
      const pending = pendingApprovalBySessionRef.current.get(sid);
      if (!pending) return;
      pending.resolve(allow);
      pendingApprovalBySessionRef.current.delete(sid);
      if (activeSessionIdRef.current === sid) setPendingApproval(null);
    },
    getSessionSnapshot: (sessionId) => {
      const rt = runtimesRef.current.get(sessionId);
      const turnsLocal = (rt?.turns as UiTurn[] | undefined) ?? [];
      if (!turnsLocal.length && currentSession?.id === sessionId) {
        return {
          title: currentSession.title,
          running: !!rt?.running,
          messages: turns.map((t) => ({
            id: t.id,
            role: t.role,
            content: t.content,
            createdAt: t.createdAt,
            source: t.source,
          })),
        };
      }
      if (!turnsLocal.length) return null;
      return {
        title: turnsLocal.find((t) => t.role === "user")?.content.slice(0, 60) || "Chat",
        running: !!rt?.running,
        messages: turnsLocal.map((t) => ({
          id: t.id,
          role: t.role,
          content: t.content,
          createdAt: t.createdAt,
          source: t.source,
        })),
      };
    },
    getVault: () => (vault.isUnlocked() ? vault : null),
    getActiveVaultId: () => registry.activeId,
    onSyncPushNow: async (_scopes) => {
      try {
        const cfg = loadCloudConfig();
        if (!cfg?.syncToken) return { ok: false, error: "no sync token" };
        if (!vault.isUnlocked()) return { ok: false, error: "vault locked" };
        const client = cloudClientFromConfig(cfg);
        const pack = await buildVaultPack(registry.vaults);
        const nextVersion = (cfg.packVersion || 0) + 1;
        const res = await client.syncPush({
          scope: "vault",
          version: nextVersion,
          prev_version: cfg.packVersion || undefined,
          ciphertext_b64: packToCiphertextB64(pack),
        });
        if (!res.ok) return { ok: false, error: res.error ?? "vault push failed" };
        const ver = res.version ?? nextVersion;
        let setupVer = cfg.setupPackVersion ?? 0;
        const activeId = registry.activeId ?? "";
        if (activeId) {
          const store = new ConnectorStore();
          const list = await store.list(activeId);
          if (list.length) {
            const entry = registry.vaults.find((v) => v.id === activeId);
            const sealed = await sealSetupPack(vault, {
              vaultId: activeId,
              vaultName: entry?.name,
              connectors: list,
            });
            const nextSetup = setupVer + 1;
            const sRes = await client.syncPush({
              scope: "setup",
              version: nextSetup,
              prev_version: setupVer || undefined,
              ciphertext_b64: setupPackToB64(sealed),
            });
            if (sRes.ok) setupVer = sRes.version ?? nextSetup;
          }
        }
        saveCloudConfig({ ...cfg, packVersion: ver, setupPackVersion: setupVer });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    onRestoreVaultPack: async (ciphertextB64, version) => {
      try {
        const pack = packFromCiphertextB64(ciphertextB64);
        const { state, imported } = await mergeVaultPack(registry, pack);
        saveRegistry(state);
        setRegistry(state);
        const cfg = loadCloudConfig();
        if (cfg) saveCloudConfig({ ...cfg, packVersion: version });
        return imported.length
          ? { ok: true }
          : { ok: false, error: "no vaults imported" };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  linkPublishRef.current = comboLink.publishLinkEvents;
  linkPersistRef.current = async (session, running) => {
    await comboLink.pushLinkSnapshot(session, running);
    await comboLink.syncSessionCloud(session);
  };

  useEffect(() => {
    const activeId = activeSessionIdRef.current ?? currentSession?.id ?? null;
    if (!activeId) return;
    const activeRunning =
      !!runtimesRef.current.get(activeId)?.running || running || runningRef.current;
    if (activeRunning || queueDrainLockRef.current) return;
    const idx = sendQueueRef.current.findIndex((q) => q.sessionId === activeId);
    if (idx < 0) return;
    const next = sendQueueRef.current[idx]!;
    queueDrainLockRef.current = true;
    void (async () => {
      try {
        const ok = await send(next.text, next);
        if (ok) {
          sendQueueRef.current = sendQueueRef.current.filter((q) => q !== next);
          setSendQueue([...sendQueueRef.current]);
        }
      } finally {
        queueDrainLockRef.current = false;
      }
    })();
  }, [currentSession?.id, running, send]);

  if (!ready) {
    return (
      <div className="app">
        <div className="onboarding">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (!vault.isUnlocked()) {
    return (
      <VaultGate
        appVersion={APP_VERSION}
        protocolVersion={getProtocolVersion()}
        registry={registry}
        onRegistryChange={setRegistry}
        vault={vault}
        onVaultChange={setVault}
        onUnlocked={(v) => afterUnlock(v)}
        status={status}
        setStatus={setStatus}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Combo<span>-X</span>
          <span className="brand-version" title={`Protocol ${getProtocolVersion()}`}>
            v{APP_VERSION}
          </span>
          {comboLink.linkConfig.linkEnabled ? (
            <span
              className="brand-version"
              title={
                comboLink.linkStatus === "online"
                  ? "Combo Link online — portal can drive this device"
                  : comboLink.linkError || `Combo Link: ${comboLink.linkStatus}`
              }
              style={{
                marginLeft: 6,
                color:
                  comboLink.linkStatus === "online"
                    ? "#16a34a"
                    : comboLink.linkStatus === "error"
                      ? "#dc2626"
                      : undefined,
              }}
            >
              {comboLink.linkStatus === "online" ? "Link·on" : "Link·…"}
            </span>
          ) : null}
        </div>
        <TabBar
          className="header-tabs"
          tabs={ALL_TABS}
          active={tab}
          onSelect={(id) => {
            const next = id as TabId;
            setTab(next);
            if (next === "vault") void refreshVaultLabels();
            if (next === "settings" || next === "libraries") {
              void connectorStore.list().then((list) => setConnectorCount(list.length));
              void agentProfiles.list().then(setAgentList);
            }
          }}
        />
      </header>

      {tab === "chat" ? (
        <>
          <div
            className={`chat-main${preview || browserOpen ? " chat-main-split" : ""}${sessionsDrawerOpen || sessionsPinned || tasksDrawerOpen ? " sessions-open" : ""}${sessionsPinned ? " sessions-pinned" : ""}`}
          >
            <SessionsDrawer
              open={sessionsDrawerOpen || sessionsPinned}
              pinned={sessionsPinned}
              onClose={() => {
                if (!sessionsPinned) setSessionsDrawerOpen(false);
              }}
              onTogglePin={() => {
                setSessionsPinned((v) => {
                  const next = !v;
                  if (next) setSessionsDrawerOpen(true);
                  return next;
                });
              }}
              sessions={sessions}
              sessionList={sessionList}
              refreshSessions={refreshSessions}
              currentSessionId={currentSession?.id}
              onOpenSession={loadSession}
              onNewChat={newChat}
              runtimeMeta={runtimeMeta}
              onExport={(filename, text, mime) => void bridge.downloadText(filename, text, mime)}
            />
            <ConversationTasksDrawer
              open={tasksDrawerOpen}
              onClose={() => setTasksDrawerOpen(false)}
              taskStore={taskStore}
              sessionId={currentSession?.id}
              refreshTick={tasksRefreshTick}
            />
            <div className="chat-thread">
              <div className="conv-bar">
                <div className="conv-bar-main">
                  <button
                    type="button"
                    className={
                      sessionsDrawerOpen || sessionsPinned
                        ? "msg-action active icon-btn"
                        : "msg-action icon-btn"
                    }
                    title="Sessions & history"
                    aria-label="Sessions and history"
                    aria-expanded={sessionsDrawerOpen || sessionsPinned}
                    onClick={() => {
                      setTasksDrawerOpen(false);
                      if (sessionsPinned) return;
                      setSessionsDrawerOpen((v) => !v);
                      void refreshSessions();
                    }}
                  >
                    ☰
                  </button>
                  <button
                    type="button"
                    className={tasksDrawerOpen ? "msg-action active icon-btn" : "msg-action icon-btn"}
                    title="Conversation tasks"
                    aria-label="Conversation tasks"
                    aria-expanded={tasksDrawerOpen}
                    onClick={() => {
                      if (!sessionsPinned) setSessionsDrawerOpen(false);
                      setTasksDrawerOpen((v) => !v);
                      setTasksRefreshTick((n) => n + 1);
                    }}
                  >
                    ☑
                  </button>
                  <button
                    type="button"
                    className="msg-action icon-btn"
                    title="New conversation"
                    aria-label="New conversation"
                    onClick={() => void newChat()}
                  >
                    ＋
                  </button>
                  {currentSession ? (
                    <>
                      <span className="conv-label">Conversation</span>
                      <code className="conv-id" title={currentSession.id}>
                        {currentSession.id}
                      </code>
                      <button
                        type="button"
                        className="msg-action icon-btn"
                        title="Copy conversation id"
                        aria-label="Copy conversation id"
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
                        {idCopied ? "✓" : "⎘"}
                      </button>
                    </>
                  ) : null}
                </div>
                {currentSession ? (
                  <div className="conv-bar-actions">
                    <button
                      type="button"
                      className={
                        currentSession.boundTabId != null
                          ? "msg-action icon-btn active"
                          : "msg-action icon-btn"
                      }
                      title={
                        currentSession.boundTabId != null
                          ? `Pinned tab ${currentSession.boundTabId} — click to unpin (tools hit this tab without stealing sidepanel focus)`
                          : "Pin active browser tab for tools/navigate (keeps sidepanel focus)"
                      }
                      aria-label="Pin active tab"
                      aria-pressed={currentSession.boundTabId != null}
                      onClick={() => {
                        void (async () => {
                          if (currentSession.boundTabId != null) {
                            const updated = { ...currentSession, boundTabId: undefined };
                            setCurrentSession(updated);
                            await sessions.save(updated);
                            setStatus("Tab unpinned");
                            return;
                          }
                          const meta = await getActiveTabMeta();
                          if (meta.tabId == null) {
                            setStatus("No active tab to pin");
                            return;
                          }
                          const updated = { ...currentSession, boundTabId: meta.tabId };
                          setCurrentSession(updated);
                          await sessions.save(updated);
                          const label = meta.title?.trim() || meta.url || String(meta.tabId);
                          setStatus(`Pinned tab ${meta.tabId}: ${label.slice(0, 48)}`);
                        })();
                      }}
                    >
                      {currentSession.boundTabId != null ? "●" : "○"}
                    </button>
                    <button
                      type="button"
                      className={browserOpen ? "msg-action icon-btn active" : "msg-action icon-btn"}
                      title="Toggle browser preview"
                      aria-label="Browser preview"
                      onClick={() => setBrowserOpen((v) => !v)}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className={showActions ? "msg-action icon-btn active" : "msg-action icon-btn"}
                      title={showActions ? "Hide tool chips" : "Show tool chips"}
                      aria-label="Toggle actions"
                      onClick={() => setShowActions((v) => !v)}
                    >
                      {showActions ? "▣" : "□"}
                    </button>
                    <ApprovalModeMenu
                      mode={effectiveApproval}
                      onChange={(m) => {
                        setApprovalMode(m);
                        approvalModeRef.current = m;
                        setStatus(
                          m === "ask"
                            ? "Approval: ask each action"
                            : m === "auto_llm"
                              ? "Approval: auto (smart)"
                              : "Approval: auto-approve all",
                        );
                      }}
                    />
                    <button
                      type="button"
                      className={
                        currentSession.bookmarked
                          ? "msg-action icon-btn active"
                          : "msg-action icon-btn"
                      }
                      title={
                        currentSession.bookmarked
                          ? "Remove conversation bookmark"
                          : "Bookmark conversation"
                      }
                      aria-label="Bookmark conversation"
                      aria-pressed={!!currentSession.bookmarked}
                      onClick={toggleSessionBookmark}
                    >
                      {currentSession.bookmarked ? "★" : "☆"}
                    </button>
                  </div>
                ) : null}
              </div>
              <SubagentStrip runs={subagentRuns} />
              <MessagesViewport
                itemCount={turns.length}
                stickKey={currentSession?.id ?? "none"}
                contentTick={contentTick}
              >
                {({ start, end }) => (
                  <>
                    {turns.length === 0 ? (
                      <div className="bubble system">
                        Hi — I’m Combo-X. Memories + skill descriptions + tool schemas are prepended
                        each turn; <code>skill_read</code> loads bodies and unlocks gated tools.
                        Scrape tables: <strong>Libraries → Tables</strong>. Approval:{" "}
                        <strong>{effectiveApproval}</strong>.
                      </div>
                    ) : null}
                    {turns.slice(start, end).map((t) => (
                      <div
                        key={t.id}
                        className={`bubble-wrap ${t.role}${t.bookmarked ? " bookmarked" : ""}${inspectTurnId === t.id ? " inspecting" : ""}`}
                      >
                      <div className={`bubble ${t.role}`}>
                        {t.role === "assistant" ? (
                          <>
                            {(t.blocks ?? []).map((b) => {
                              if (b.kind === "reasoning") {
                                return (
                                  <details key={b.id} className="thought-block reasoning" open>
                                    <summary>Thoughts</summary>
                                    <div className="thought-body">{b.text}</div>
                                  </details>
                                );
                              }
                              if (b.kind === "thought") {
                                return (
                                  <div key={b.id} className="thought-block step">
                                    <MarkdownView content={b.text} streaming={false} />
                                  </div>
                                );
                              }
                              if (b.kind === "message") {
                                return (
                                  <div key={b.id} className="thought-block message">
                                    <MarkdownView content={b.text} streaming={false} />
                                  </div>
                                );
                              }
                              if (b.kind === "artifact") {
                                return (
                                  <ChatArtifact
                                    key={b.id}
                                    artifact={b.artifact}
                                    resolveAttachment={async (id) => {
                                      const row = await attachments.get(id);
                                      return row?.dataUrl ?? null;
                                    }}
                                  />
                                );
                              }
                              if (!showActions) return null;
                              const chips = b.toolIds
                                .map((id) => t.tools?.find((x) => x.id === id))
                                .filter(Boolean) as ToolChipData[];
                              if (!chips.length) return null;
                              return (
                                <div key={b.id} className="chips">
                                  {chips.map((tool) => (
                                    <ToolChip
                                      key={tool.id}
                                      tool={tool}
                                      onPreview={setPreview}
                                      onPreviewTool={async (chip) => {
                                        const r = chip.result as {
                                          attachmentId?: string;
                                          dataUrl?: string;
                                        } | null;
                                        if (r?.attachmentId) {
                                          const row = await attachments.get(r.attachmentId);
                                          if (row?.dataUrl) {
                                            setPreview({
                                              title: chip.name,
                                              kind: "image",
                                              body: row.dataUrl,
                                            });
                                            return;
                                          }
                                        }
                                        const p = buildPreviewFromTool(chip.name, chip.result);
                                        if (p) setPreview(p);
                                      }}
                                    />
                                  ))}
                                </div>
                              );
                            })}
                            {t.liveReasoning ? (
                              <details className="thought-block reasoning" open>
                                <summary>Thoughts</summary>
                                <div className="thought-body">{t.liveReasoning}</div>
                              </details>
                            ) : null}
                            {/* Fallback: flat tool list when blocks empty (legacy turns). */}
                            {showActions &&
                            !(t.blocks?.length) &&
                            t.tools &&
                            t.tools.length > 0 ? (
                              <div className="chips">
                                {t.tools.map((tool) => (
                                  <ToolChip
                                    key={tool.id}
                                    tool={tool}
                                    onPreview={setPreview}
                                    onPreviewTool={async (chip) => {
                                      const r = chip.result as {
                                        attachmentId?: string;
                                        dataUrl?: string;
                                      } | null;
                                      if (r?.attachmentId) {
                                        const row = await attachments.get(r.attachmentId);
                                        if (row?.dataUrl) {
                                          setPreview({
                                            title: chip.name,
                                            kind: "image",
                                            body: row.dataUrl,
                                          });
                                          return;
                                        }
                                      }
                                      const p = buildPreviewFromTool(chip.name, chip.result);
                                      if (p) setPreview(p);
                                    }}
                                  />
                                ))}
                              </div>
                            ) : null}
                            {/* Streaming tip; after done, content falls back if no message block. */}
                            {t.content && streamingId === t.id ? (
                              <MarkdownView content={t.content} streaming />
                            ) : null}
                            {t.content &&
                            streamingId !== t.id &&
                            !(t.blocks ?? []).some((b) => b.kind === "message") ? (
                              <MarkdownView content={t.content} streaming={false} />
                            ) : null}
                          </>
                        ) : (
                          <div className="bubble-plain">{t.content}</div>
                        )}
                        {/* Legacy turns: artifacts not yet interleaved into blocks. */}
                        {t.artifacts
                          ?.filter(
                            (a) =>
                              !(t.blocks ?? []).some(
                                (b) =>
                                  b.kind === "artifact" &&
                                  b.artifact.title === a.title &&
                                  (b.artifact.src === a.src ||
                                    b.artifact.attachmentId === a.attachmentId),
                              ),
                          )
                          .map((a, i) => (
                            <ChatArtifact
                              key={`art-${t.id}-${i}`}
                              artifact={a}
                              resolveAttachment={async (id) => {
                                const row = await attachments.get(id);
                                return row?.dataUrl ?? null;
                              }}
                            />
                          ))}
                        {showActions && t.role === "assistant" && t.content.includes("|") ? (
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
                        {t.role === "user" && (t.picks?.length || t.activeTab?.url) ? (
                          <div className="attach-chips turn-context-chips">
                            {t.activeTab?.url ? (
                              <span
                                className="attach-chip done"
                                title={`${t.activeTab.title ?? ""}\n${t.activeTab.url}\n${t.activeTab.at}`}
                              >
                                tab: {(t.activeTab.title || t.activeTab.url).slice(0, 36)}
                              </span>
                            ) : null}
                            {t.picks?.map((p) => (
                              <span
                                key={p.id}
                                className="attach-chip done"
                                title={formatBrowserContextBlock({ picks: [p] })}
                              >
                                el: {pickedElementChipLabel(p)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="bubble-actions">
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
                                t.delivery === "stream"
                                  ? "delivery-pill stream"
                                  : "delivery-pill full"
                              }
                              title={
                                t.delivery === "stream"
                                  ? "SSE — response streaming (full context still sent each turn)"
                                  : "Orchestrator used a full non-stream call"
                              }
                            >
                              {t.delivery === "stream" ? "sse" : "full"}
                            </span>
                          ) : null}
                          {t.role === "user" && t.source === "link" ? (
                            <span className="delivery-pill stream" title="Sent via Combo Link (portal)">
                              link
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
                              title={
                                t.runContext
                                  ? "Inspect system context + memories for this turn"
                                  : "No context snapshot (turns before 1.6.17, or context was wiped)"
                              }
                              onClick={() =>
                                setInspectTurnId((id) => (id === t.id ? null : t.id))
                              }
                            >
                              Context
                            </button>
                          ) : null}
                        </div>
                        {t.usage && t.role === "assistant" ? (
                          <div
                            className="turn-usage"
                            title="Prompt (in) / completion (out) tokens + cost"
                          >
                            {formatUsageLine(t.usage)}
                            {t.usageWorker && t.usageWorker.totalTokens > 0
                              ? ` · worker ${formatUsageLine(t.usageWorker)}`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                      {inspectTurnId === t.id ? (
                        <pre className="context-inspect">
                          {t.runContext
                            ? `model: ${t.runContext.model}\ntransport: ${t.runContext.transport}\ntools (${t.runContext.toolNames.length}): ${t.runContext.toolNames.join(", ")}\n\n--- USER (sent to LLM: tab + picks + message) ---\n${t.runContext.userPreview || "(missing — reload 1.6.40+)"}\n\n--- SYSTEM ---\n${t.runContext.systemPrompt}\n\n--- MEMORIES (always prepended once per turn; global + active agent; not mid-stream) ---\n${t.runContext.memoryBlock || "(none)"}\n\n--- OPEN TASKS (session + global; always prepended once per turn) ---\n${t.runContext.taskBlock || "(none)"}\n\n--- SKILLS INDEX (descriptions; bodies via skill_read) ---\n${t.runContext.skillBlock || "(none)"}\n\n--- TOOL CATALOG ---\n${t.runContext.toolCatalogBlock || "(none)"}`
                            : "No context snapshot for this turn.\n\nOlder turns (before the fix) or a finished run that wiped runContext from UI state. Send a new message after reloading 1.6.17+ — Context will stay available and persist with the session."}
                        </pre>
                      ) : null}
                      </div>
                    ))}
                  </>
                )}
              </MessagesViewport>
              {pendingApproval ? (
                <ApprovalBanner
                  tool={pendingApproval.tool}
                  args={pendingApproval.args}
                  onAllow={() => {
                    pendingApproval.resolve(true);
                    if (currentSession)
                      pendingApprovalBySessionRef.current.delete(currentSession.id);
                    setPendingApproval(null);
                  }}
                  onDeny={() => {
                    pendingApproval.resolve(false);
                    if (currentSession)
                      pendingApprovalBySessionRef.current.delete(currentSession.id);
                    setPendingApproval(null);
                  }}
                  onAlwaysAllowTool={() => {
                    void (async () => {
                      await approvalPolicies.remember(pendingApproval.tool, null);
                      setStatus(`Always allow: ${pendingApproval.tool}`);
                      pendingApproval.resolve(true);
                      if (currentSession)
                        pendingApprovalBySessionRef.current.delete(currentSession.id);
                      setPendingApproval(null);
                    })();
                  }}
                  onAlwaysAllowTarget={() => {
                    void (async () => {
                      const key = targetKeyFromArgs(
                        pendingApproval.tool,
                        pendingApproval.args,
                      );
                      await approvalPolicies.remember(pendingApproval.tool, key);
                      setStatus(
                        key
                          ? `Always allow ${pendingApproval.tool} @ ${key}`
                          : `Always allow: ${pendingApproval.tool}`,
                      );
                      pendingApproval.resolve(true);
                      if (currentSession)
                        pendingApprovalBySessionRef.current.delete(currentSession.id);
                      setPendingApproval(null);
                    })();
                  }}
                  onAutoAll={() => {
                    setApprovalMode("auto_all");
                    approvalModeRef.current = "auto_all";
                    pendingApproval.resolve(true);
                    if (currentSession)
                      pendingApprovalBySessionRef.current.delete(currentSession.id);
                    setPendingApproval(null);
                  }}
                  onAutoSmart={() => {
                    setApprovalMode("auto_llm");
                    approvalModeRef.current = "auto_llm";
                    pendingApproval.resolve(true);
                    if (currentSession)
                      pendingApprovalBySessionRef.current.delete(currentSession.id);
                    setPendingApproval(null);
                  }}
                />
              ) : null}
              {planningTool && running ? (
                <div className="attach-chips" aria-live="polite">
                  <span className="attach-chip" title="Model is emitting a tool call via SSE">
                    Planning: {planningTool}…
                  </span>
                </div>
              ) : null}
              {status && running ? <div className="bubble system">{status}</div> : null}
              {status && !running ? (
                <div className="bubble system" role="status">
                  {status}
                </div>
              ) : null}
            </div>
            <PreviewDrawer
              preview={preview}
              onClose={() => setPreview(null)}
              onExport={(filename, text, mime) =>
                void bridge.downloadText(filename, text, mime)
              }
              onGoViews={() => {
                setLibSubnav("tables");
                setTab("libraries");
              }}
            />
            <BrowserPreview open={browserOpen} onClose={() => setBrowserOpen(false)} />
          </div>
          <div className="composer composer-compact">
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
              <ModelPicker
                className="grow"
                value={model}
                apiKey={apiKey}
                baseUrl={llmBaseUrl}
                providerId={llmProvider}
                keyOptional={resolveProvider(llmProvider).keyOptional}
                title="Search models across configured providers"
                multi={readyProviders}
                activeProviderId={llmProvider}
                onChange={(id) => {
                  setModel(id);
                  void vault.putByLabel(MODEL_LABEL, id);
                  void vault.putByLabel(modelVaultLabel(llmProvider), id);
                }}
                onSelectProviderModel={(pid, modelId) => {
                  void selectProviderModel(pid, modelId);
                }}
              />
              <label className="steps-pick" title="Max orchestrator turns for the next send">
                <select
                  value={maxStepsOverride}
                  onChange={(e) => setMaxStepsOverride(Number(e.target.value))}
                  aria-label="Max turns"
                >
                  {STEPS_PRESETS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => void newChat()}>
                New
              </button>
            </div>
            {sendQueue.length > 0 ? (
              <div className="queue-chips" aria-label="Queued messages">
                {sendQueue.map((q, idx) => (
                  <span key={`q-${idx}-${q.text.slice(0, 12)}`} className="queue-chip">
                    <span className="queue-chip-text" title={q.text}>
                      {idx + 1}. {q.text.slice(0, 48)}
                      {q.text.length > 48 ? "…" : ""}
                      {q.attachments.length ? ` · ${q.attachments.length} file(s)` : ""}
                    </span>
                    <button
                      type="button"
                      className="attach-x"
                      aria-label={`Remove queued message ${idx + 1}`}
                      title="Remove from queue"
                      onClick={() => removeQueued(idx)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
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
            {pendingPicks.length > 0 ? (
              <div className="attach-chips" aria-label="Picked elements">
                {pendingPicks.map((p) => (
                  <span
                    key={p.id}
                    className="attach-chip"
                    title={`${p.selector}${p.interactiveIndex != null ? ` · index ${p.interactiveIndex}` : ""}`}
                  >
                    el: {pickedElementChipLabel(p)}
                    <button
                      type="button"
                      className="attach-x"
                      aria-label="Remove picked element"
                      onClick={() => setPendingPicks((prev) => prev.filter((x) => x.id !== p.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {attachMsg ? <p className="hint wrap">{attachMsg}</p> : null}
            <SecretEmbedBar
              detectEnabled={detectSecrets}
              onDetectEnabledChange={setDetectSecrets}
              pending={pendingSecrets}
              onPendingChange={setPendingSecrets}
              vaultUnlocked={vault.isUnlocked()}
              endSlot={
                <ToolAccessPicker
                  enabledTools={enabledTools}
                  setEnabledTools={updateEnabledTools}
                  toolMode={effectiveToolMode}
                  unlockedThisRun={unlockedThisRun}
                  onInspectContext={() => void previewOutbound()}
                  inspectDisabled={
                    running ||
                    (!input.trim() &&
                      pendingAttachments.length === 0 &&
                      pendingPicks.length === 0)
                  }
                />
              }
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask… attach files, pick an element, or “continue” after a step limit"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void enqueueOrSend();
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
            <div className="row composer-actions">
              <button
                type="button"
                className="icon-btn"
                disabled={attachBusy}
                onClick={() => fileInputRef.current?.click()}
                title="Attach files (PDF, CSV, images…)"
                aria-label="Attach files"
              >
                {attachBusy ? "…" : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className={picking ? "icon-btn primary" : "icon-btn"}
                disabled={attachBusy}
                onClick={() => void startElementPick()}
                title={
                  picking
                    ? "Cancel element picker"
                    : "Pick an element on the active tab for the agent"
                }
                aria-label={picking ? "Cancel pick" : "Pick element"}
              >
                {picking ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  (!input.trim() &&
                    pendingAttachments.length === 0 &&
                    pendingPicks.length === 0) ||
                  attachBusy ||
                  picking
                }
                onClick={() => void enqueueOrSend()}
              >
                {running ||
                !!(
                  currentSession?.id &&
                  runtimesRef.current.get(currentSession.id)?.running
                )
                  ? "Queue"
                  : "Send"}
              </button>
              <button
                type="button"
                className="danger"
                disabled={!running && !runtimeMeta.some((m) => m.running)}
                title={
                  running
                    ? "Stop this conversation"
                    : runtimeMeta.some((m) => m.running)
                      ? "Stop all background runs"
                      : "Nothing running"
                }
                onClick={stop}
              >
                STOP
              </button>
              <div className="budget-toggle-wrap">
                <label
                  className={
                    budgetMode === "budget" ? "budget-toggle active" : "budget-toggle"
                  }
                  title={
                    budgetMode === "budget"
                      ? "Budget on — cheaper page reads + fewer steps (tools stay listed)"
                      : "Budget off — normal page reads + more steps"
                  }
                >
                  <input
                    type="checkbox"
                    checked={budgetMode === "budget"}
                    onChange={(e) =>
                      setBudgetMode(e.target.checked ? "budget" : "normal")
                    }
                  />
                  <span>Budget</span>
                </label>
                <button
                  type="button"
                  className={
                    budgetInfoOpen ? "msg-action icon-btn active" : "msg-action icon-btn"
                  }
                  title="What does Budget mode do?"
                  aria-label="Budget mode help"
                  aria-expanded={budgetInfoOpen}
                  onClick={() => {
                    setBudgetInfoOpen((v) => !v);
                    setUsageDetailsOpen(false);
                  }}
                >
                  ?
                </button>
                {budgetInfoOpen ? (
                  <div className="budget-info-pop" role="dialog" aria-label="Budget mode help">
                    {BUDGET_MODE_HELP.split("\n\n").map((block, i) => (
                      <p key={i} className={i === 0 ? undefined : "hint"}>
                        {block.split("\n").map((line, j) => (
                          <span key={j}>
                            {j > 0 ? <br /> : null}
                            {line}
                          </span>
                        ))}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="usage-footer">
              <span
                className="hint usage-total"
                title="Session total context in / out + cost (OR = OpenRouter, ~ = estimate)"
              >
                {sessionUsage.total.totalTokens > 0
                  ? formatUsageLine(sessionUsage.total)
                  : model === workerModel
                    ? `${enabledTools.size} tools`
                    : "orch≠worker"}
              </span>
              <div className="usage-more-wrap">
                <button
                  type="button"
                  className={usageDetailsOpen ? "msg-action icon-btn active" : "msg-action icon-btn"}
                  title="Usage details (orchestrator / worker / last turn)"
                  aria-label="Usage details"
                  aria-expanded={usageDetailsOpen}
                  onClick={() => {
                    setUsageDetailsOpen((v) => !v);
                    setBudgetInfoOpen(false);
                  }}
                >
                  ⋯
                </button>
                {usageDetailsOpen ? (
                  <div className="usage-pop" role="dialog" aria-label="Usage details">
                    <p>
                      <strong>Session</strong> {formatUsageLine(sessionUsage.total)}
                    </p>
                    {sessionUsage.orch.totalTokens > 0 ? (
                      <p>
                        <span className="hint">Orchestrator</span>{" "}
                        {formatUsageLine(sessionUsage.orch)}
                      </p>
                    ) : null}
                    {sessionUsage.worker.totalTokens > 0 ? (
                      <p>
                        <span className="hint">Worker</span>{" "}
                        {formatUsageLine(sessionUsage.worker)}
                      </p>
                    ) : null}
                    {lastTurnUsage ? (
                      <>
                        <hr />
                        <p>
                          <strong>Last turn</strong> {formatUsageLine(lastTurnUsage.total)}
                        </p>
                        {lastTurnUsage.orch.totalTokens > 0 ? (
                          <p>
                            <span className="hint">Orch</span>{" "}
                            {formatUsageLine(lastTurnUsage.orch)}
                          </p>
                        ) : null}
                        {lastTurnUsage.worker.totalTokens > 0 ? (
                          <p>
                            <span className="hint">Worker</span>{" "}
                            {formatUsageLine(lastTurnUsage.worker)}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="hint">No turn usage yet</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {tab === "libraries" ? (
        <LibrariesPanel
          memory={memory}
          skills={skills}
          agents={agentProfiles}
          enabledTools={enabledTools}
          setEnabledTools={updateEnabledTools}
          customTools={customTools}
          rag={rag}
          ragMeta={ragMeta}
          setRagMeta={setRagMeta}
          ragExclude={ragExclude}
          setRagExclude={setRagExclude}
          vaultUnlocked={vault.isUnlocked()}
          locked={locked}
          connectorStore={connectorStore}
          views={views}
          initialSubnav={libSubnav}
          onSubnavChange={setLibSubnav}
          onExport={(filename, text, mime) => void bridge.downloadText(filename, text, mime)}
        />
      ) : null}

      {tab === "activity" ? (
        <ActivityPanel
          actionLog={actionLog}
          onExport={(filename, text, mime) => void bridge.downloadText(filename, text, mime)}
        />
      ) : null}

      {tab === "changes" ? (
        <ChangesPanel changeLog={changeLog} active={tab === "changes"} />
      ) : null}

      {tab === "assets" ? (
        <AssetsPanel
          attachments={attachments}
          artifacts={artifacts}
          active={tab === "assets"}
          sessionId={currentSession?.id}
          onPreview={(p) => {
            setPreview(p);
            setTab("chat");
          }}
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
          llmProvider={llmProvider}
          setLlmProvider={setLlmProvider}
          llmBaseUrl={llmBaseUrl}
          setLlmBaseUrl={setLlmBaseUrl}
          webSearchEnabled={webSearchEnabled}
          setWebSearchEnabled={(v) => {
            setWebSearchEnabled(v);
            localStorage.setItem(WEB_SEARCH_KEY, v ? "1" : "0");
          }}
          model={model}
          setModel={setModel}
          workerModel={workerModel}
          setWorkerModel={setWorkerModel}
          customModel={customModel}
          setCustomModel={setCustomModel}
          customWorkerModel={customWorkerModel}
          setCustomWorkerModel={setCustomWorkerModel}
          visionSettings={visionSettings}
          setVisionSettings={setVisionSettings}
          approvalMode={approvalMode}
          setApprovalMode={setApprovalMode}
          approvalPolicies={approvalPolicies}
          budgetMode={budgetMode}
          setBudgetMode={setBudgetMode}
          enabledTools={enabledTools}
          setEnabledTools={updateEnabledTools}
          activeAgentId={activeAgentId}
          setActiveAgentId={setActiveAgentId}
          ragExclude={ragExclude}
          setRagExclude={setRagExclude}
          ragMeta={ragMeta}
          setRagMeta={setRagMeta}
          onLockVault={() => {
            void (async () => {
              abortRef.current?.abort();
              try {
                const handle = await loadDirectoryHandle();
                if (handle && registry.vaults.length) {
                  const pack = await buildVaultPack(registry.vaults);
                  await writeVaultPackToDirectory(handle, pack);
                }
              } catch {
                /* best-effort disk autosave */
              }
              await vault.lock();
              setLocked(true);
              setApiKey("");
            })();
          }}
          vaultLabels={vaultLabels}
          onRefreshVaultLabels={() => {
            void (async () => {
              await refreshVaultLabels();
              await refreshProviderCreds(vault);
            })();
          }}
        />
      ) : null}

      {tab === "vault" ? (
        <div className="panel">
          <h2>Vault</h2>
          <p className="hint wrap">
            Secrets are AES-GCM encrypted with your passphrase. Manage vaults, disk backup, and Combo
            Cloud sync here. LLM API keys still live under Settings → LLM provider.
          </p>
          <CloudVaultSection
            vault={vault}
            registry={registry}
            onRegistryChange={setRegistry}
            linkEnabled={comboLink.linkConfig.linkEnabled}
            syncChats={comboLink.linkConfig.syncChats}
            linkStatus={comboLink.linkStatus}
            linkError={comboLink.linkError}
            onLinkConfigChange={(partial) => {
              comboLink.setLinkConfig(partial);
            }}
            onPullSessions={() => comboLink.pullSessionsCloud()}
            onSwitchVault={async (nextVault) => {
              abortRef.current?.abort();
              await vault.lock();
              setVault(nextVault);
              setApiKey("");
              setLocked(true);
              setStatus("Switched vault — unlock with passphrase");
            }}
            locked={locked}
          />
          <h3>Labels in this vault</h3>
          <p className="hint wrap">Names only — values stay encrypted.</p>
          <ul className="list">
            {vaultLabels.length === 0 ? (
              <li className="hint">No labels yet</li>
            ) : (
              vaultLabels.map((l) => (
                <li key={l}>
                  <code>{l}</code>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

    </div>
  );
}

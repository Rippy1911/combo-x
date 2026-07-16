import {
  AGENT_TOOLS,
  ActionLogStore,
  AgentLoop,
  ArtifactStore,
  AttachmentStore,
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
  grantAndIndex,
  leanHistory,
  normalizeModelId,
  parseAttachment,
  reindexSaved,
  resultError,
  resultOk,
  summarizeResult,
  stripImageParts,
  type AgentBudgetMode,
  type AgentEvent,
  type ApprovalMode,
  type AttachmentRecord,
  type ChatMessage,
  type ChatSession,
  type LlmUsage,
  type ProfileStore,
  type RagMeta,
  type SessionMessage,
  type SiteProfile,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChromeBridge } from "../lib/chrome-bridge";
import { ApprovalBanner } from "./ApprovalBanner";
import { MarkdownView } from "./MarkdownView";
import {
  PreviewDrawer,
  buildPreviewFromAttachment,
  buildPreviewFromMarkdown,
  type PreviewPayload,
} from "./PreviewDrawer";
import { ToolChip, type ToolChipData } from "./ToolChip";
import { ActivityPanel } from "./ActivityPanel";
import { ViewsPanel } from "./ViewsPanel";

const KEY_LABEL = "openrouter_api_key";
const MODEL_LABEL = "openrouter_model";
const WORKER_MODEL_LABEL = "openrouter_worker_model";
const IF_EMAIL_LABEL = "ideaforge_email";
const IF_PASS_LABEL = "ideaforge_password";
const GH_TOKEN_LABEL = "github_token";
const TOOLS_STORAGE_KEY = "combo_x_enabled_tools";
const APPROVAL_KEY = "combo_x_approval_mode";
const BUDGET_KEY = "combo_x_budget_mode";
const RAG_EXCLUDE_KEY = "combo_x_rag_exclude";

type TabId =
  | "chat"
  | "sessions"
  | "views"
  | "activity"
  | "settings"
  | "vault"
  | "tools"
  | "mcp";

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
  attachments?: Array<{ id: string; name: string; kind: string }>;
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
    if (
      !saved.includes("parse_data") ||
      !saved.includes("get_interactive") ||
      !saved.includes("rag_search") ||
      !saved.includes("list_attachments") ||
      !saved.includes("save_view") ||
      !saved.includes("memory_list") ||
      !saved.includes("page_digest")
    ) {
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
  const rag = useMemo(() => new RagStore(), []);
  const attachments = useMemo(() => new AttachmentStore(), []);
  const views = useMemo(() => new ViewStore(), []);
  const artifacts = useMemo(() => new ArtifactStore(), []);
  const actionLog = useMemo(() => new ActionLogStore(), []);
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
  const [settingsMsg, setSettingsMsg] = useState("");
  const [vaultLabels, setVaultLabels] = useState<string[]>([]);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => loadEnabledTools());
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => loadApproval());
  const [budgetMode, setBudgetMode] = useState<AgentBudgetMode>(() => {
    const v = localStorage.getItem(BUDGET_KEY);
    return v === "budget" ? "budget" : "normal";
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
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessionUsage, setSessionUsage] = useState<LlmUsage>(ZERO);
  const [lastTurnUsage, setLastTurnUsage] = useState<LlmUsage | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentRecord[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachMsg, setAttachMsg] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);

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
  const [connectors, setConnectors] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("combo_x_connectors") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [ragMeta, setRagMeta] = useState<RagMeta | null>(null);
  const [ragMsg, setRagMsg] = useState("");
  const [ragBusy, setRagBusy] = useState(false);
  const [ideaforgeEmail, setIdeaforgeEmail] = useState("");
  const [ideaforgePass, setIdeaforgePass] = useState("");
  const [githubToken, setGithubToken] = useState("");

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
        if (p.connectors!.includes("ideaforge:read") || p.connectors!.includes("ideaforge_search")) {
          next.add("ideaforge_search");
        }
        if (p.connectors!.includes("github:read") || p.connectors!.includes("github_search_code")) {
          next.add("github_search_code");
          next.add("github_get_file");
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
    setIdeaforgeEmail((await vault.getByLabel(IF_EMAIL_LABEL)) ?? "");
    setIdeaforgePass((await vault.getByLabel(IF_PASS_LABEL)) ?? "");
    setGithubToken((await vault.getByLabel(GH_TOKEN_LABEL)) ?? "");
    setNeedsOnboarding(!key);
    setLocked(false);
    await refreshVaultLabels();
    setRagMeta(await rag.getMeta());
    if (!currentSession) {
      const s = await sessions.create("New chat");
      setCurrentSession(s);
    }
    setStatus("Unlocked");
  }, [currentSession, rag, refreshVaultLabels, sessions, vault]);

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
    setPendingAttachments([]);
    setAttachMsg("");
    setSessionUsage(ZERO);
    setLastTurnUsage(null);
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
      const userTurn: UiTurn = {
        id: crypto.randomUUID(),
        role: "user",
        content: displayText,
        attachments: pending.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
      };
      const assistantId = crypto.randomUUID();
      let nextTurns = [...turns, userTurn, { id: assistantId, role: "assistant" as const, content: "" }];
      setTurns(nextTurns);
      setRunning(true);
      setStreamingId(assistantId);
      setStatus(pendingIds.length ? `Working with ${pendingIds.length} file(s)…` : "Working…");
      setLastTurnUsage(null);

      const controller = new AbortController();
      abortRef.current = controller;
      const llm = new OpenRouterClient({ apiKey: key });
      const agent = new AgentLoop(llm, bridge, memory, sessions, profiles);
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
        if (event.type === "assistant_delta" && event.message != null) {
          setTurns((prev) =>
            prev.map((t) => (t.id === assistantId ? { ...t, content: event.message ?? "" } : t)),
          );
        }
        if (event.type === "error" && event.message) setStatus(event.message);
        if (event.type === "done") setStreamingId(null);
      };

      try {
        const ifEmail = ideaforgeEmail || (await vault.getByLabel(IF_EMAIL_LABEL));
        const ifPass = ideaforgePass || (await vault.getByLabel(IF_PASS_LABEL));
        const gh = githubToken || (await vault.getByLabel(GH_TOKEN_LABEL));
        const result = await agent.run({
          model: normalizeModelId(model),
          workerModel: normalizeModelId(workerModel),
          userMessage: text || displayText,
          history: historyRef.current,
          signal: controller.signal,
          enabledTools: [...enabledTools],
          approvalMode: approvalModeRef.current,
          getApprovalMode: () => approvalModeRef.current,
          approvalModel: normalizeModelId(workerModel),
          budgetMode,
          rag,
          attachments,
          views,
          pendingAttachmentIds: pendingIds,
          connectors: {
            ideaforge:
              ifEmail && ifPass ? { email: ifEmail, password: ifPass } : null,
            github: gh ? { token: gh } : null,
          },
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
      apiKey,
      actionLog,
      attachments,
      budgetMode,
      views,
      bridge,
      currentSession,
      enabledTools,
      githubToken,
      ideaforgeEmail,
      ideaforgePass,
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
            ["settings", "Settings"],
            ["vault", "Vault"],
            ["tools", "Tools"],
            ["mcp", "Workspace"],
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
          <div className={`chat-main${preview ? " chat-main-split" : ""}`}>
            <div className="messages">
              {turns.length === 0 ? (
                <div className="bubble system">
                  Hi — I’m Combo-X. I can open tabs (<code>open_tab</code>), scrape tables, export CSV,
                  and keep sessions. Approval mode: <strong>{approvalMode}</strong>.
                </div>
              ) : null}
              {turns.map((t) => (
                <div key={t.id} className={`bubble ${t.role}`}>
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
            <PreviewDrawer
              preview={preview}
              onClose={() => setPreview(null)}
              onExport={(filename, text, mime) =>
                void bridge.downloadText(filename, text, mime)
              }
              onGoViews={() => setTab("views")}
            />
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
          ideaforgeConfigured={Boolean(ideaforgeEmail)}
          githubConfigured={Boolean(githubToken)}
          onExport={(filename, text, mime) => void bridge.downloadText(filename, text, mime)}
        />
      ) : null}

      {tab === "activity" ? (
        <ActivityPanel
          actionLog={actionLog}
          onExport={(filename, text, mime) => void bridge.downloadText(filename, text, mime)}
        />
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
          <label className="hint">Token budget</label>
          <select
            value={budgetMode}
            onChange={(e) => setBudgetMode(e.target.value as AgentBudgetMode)}
          >
            <option value="normal">Normal — full tools / 32 steps</option>
            <option value="budget">
              Budget — page_digest + worker parse, 16 steps, short get_page
            </option>
          </select>
          <p className="hint wrap">
            Budget mode: prefer <code>page_digest</code> / <code>extract</code> /{" "}
            <code>parse_data</code> (FoodWell PDP EAN pairs, invoice→scrape). Avoid full{" "}
            <code>get_page</code> dumps.
          </p>
          <h3>Device RAG (local folders)</h3>
          <p className="hint wrap">
            Grant one or more folders on this Mac. Built-in skips:{" "}
            <code>node_modules</code>, <code>.git</code>, <code>dist</code>, …. Extra excludes
            below (comma-separated dir names).
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
            placeholder="node_modules, .git, dist, coverage"
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
                    const meta = await grantAndIndex(
                      rag,
                      (p) => setRagMsg(p.message ?? p.phase),
                      { append: false, excludeDirs },
                    );
                    setRagMeta(meta);
                    setRagPathHint(meta.folderName);
                    localStorage.setItem("combo_x_rag_path_hint", meta.folderName);
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
                  setRagMsg("Add folder…");
                  try {
                    const excludeDirs = ragExclude
                      .split(/[,\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const meta = await grantAndIndex(
                      rag,
                      (p) => setRagMsg(p.message ?? p.phase),
                      { append: true, excludeDirs },
                    );
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
              Add another folder
            </button>
            <button
              type="button"
              disabled={ragBusy || locked}
              onClick={() =>
                void (async () => {
                  setRagBusy(true);
                  setRagMsg("Reindexing…");
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
              Reindex all
            </button>
          </div>
          {ragMsg ? <p className="hint wrap">{ragMsg}</p> : null}
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
          <label className="hint">IdeaForge email (read search)</label>
          <input
            type="email"
            value={ideaforgeEmail}
            onChange={(e) => setIdeaforgeEmail(e.target.value)}
            placeholder="admin@…"
          />
          <label className="hint">IdeaForge password</label>
          <input
            type="password"
            value={ideaforgePass}
            onChange={(e) => setIdeaforgePass(e.target.value)}
            placeholder="vault-encrypted"
          />
          <label className="hint">GitHub PAT (code search / file read)</label>
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_…"
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
                  if (ideaforgeEmail.trim()) await vault.putByLabel(IF_EMAIL_LABEL, ideaforgeEmail.trim());
                  if (ideaforgePass.trim()) await vault.putByLabel(IF_PASS_LABEL, ideaforgePass.trim());
                  if (githubToken.trim()) await vault.putByLabel(GH_TOKEN_LABEL, githubToken.trim());
                  setModel(m);
                  setWorkerModel(w);
                  setSettingsMsg(`Saved orch=${m} · worker=${w} · connectors`);
                  await refreshVaultLabels();
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
          <h2>Healthtree workspace</h2>
          <p className="hint wrap">
            Your Combo-X profile for FoodWell B2B scrapes, invoice PDF → carton/retail EAN, IdeaForge /
            GitHub. Folder RAG + excludes live under Settings (Grant / Add folder). Prefer Budget mode
            for multi-PDP EAN mapping.
          </p>
          <p className="hint wrap">
            RAG:{" "}
            <code>
              {ragMeta
                ? `${ragMeta.folderName || "folder"} · ${ragMeta.fileCount} files / ${ragMeta.chunkCount} chunks`
                : "(none — grant in Settings)"}
            </code>
          </p>
          {ragMsg ? <p className="hint wrap">{ragMsg}</p> : null}
          <div className="row">
            <button type="button" className="primary" onClick={() => setTab("settings")}>
              Open Settings (RAG + Budget)
            </button>
            <button
              type="button"
              onClick={() => {
                const url = chrome.runtime.getURL("setup/index.html");
                void chrome.tabs.create({ url });
              }}
            >
              Open workspace setup page
            </button>
          </div>
          {setupMsg ? <p className="hint wrap">{setupMsg}</p> : null}
          <p className="hint wrap">
            Label: <code>{ragPathHint || "(none)"}</code>
            <br />
            Setup connectors: {connectors.length ? connectors.join(", ") : "(none)"}
            <br />
            IdeaForge: {ideaforgeEmail ? "email set" : "missing"} · GitHub:{" "}
            {githubToken ? "token set" : "missing"}
          </p>
          <p className="hint wrap">
            See <code>docs/LOCAL_RAG.md</code> · <code>docs/BUDGET.md</code>
          </p>
        </div>
      ) : null}
    </div>
  );
}

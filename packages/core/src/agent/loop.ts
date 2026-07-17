import { ArtifactStore, buildReportHtml } from "../local/artifacts.js";
import type { AttachmentStore } from "../attachments/store.js";
import {
  ATTACH_INLINE_PREVIEW,
  formatAttachmentInventory,
} from "../attachments/parse.js";
import type { ViewChartSpec, ViewStore } from "../local/views.js";
import { ensureView, upsertRows } from "../local/views.js";
import type { ApprovalPolicyStore } from "../local/approvalPolicy.js";
import type { ChangeLogStore } from "../local/changeLog.js";
import type { ConnectorStore } from "../connectors/store.js";
import { restRequest } from "../connectors/rest.js";
import { mcpCall, mcpListTools } from "../connectors/mcp.js";
import { buildMapHtml, fetchMapStyleJson } from "../maps/buildMapHtml.js";
import { dataUrlToBytes, publishUpload } from "../uploads/publish.js";
import {
  resolveAgentProfile,
  type AgentProfile,
  type AgentToolMode,
  type ResolvedAgentProfile,
  type AgentProfileStore,
} from "../agents/profiles.js";
import type { TaskStore } from "../tasks/store.js";
import { formatOpenTasksBlock } from "../tasks/inject.js";
import { providerFromModel, type UsageEvent, type UsageStore } from "../usage/store.js";
import { TOOL_CATALOG } from "../tools/catalog.js";
import {
  ensureForceAttachTools,
  initialActiveTools,
  isSkillGatedTool,
  unlockFromHints,
} from "../tools/gating.js";
import { pickToolsForGoal } from "../tools/pickTools.js";
import {
  customToolToDefinition,
  formatSkillIndexBlock,
  formatToolSchemaBlock,
} from "../tools/promptCatalog.js";
import {
  runCustomTool,
  type CustomTool,
  type CustomToolStore,
} from "../tools/customStore.js";
import type { Skill, SkillStore } from "../skills/store.js";
import {
  BUDGET_SYSTEM_ADDON,
  preferPageDigest,
  resolveMaxSteps,
  rewriteGetPageArgs,
  type AgentBudgetMode,
} from "./budget.js";
import { PageTemplateCache } from "./pageTemplateCache.js";
import { leanHistory } from "./leanHistory.js";
import type {
  ChatMessage,
  ChatResult,
  ContentPart,
  LlmUsage,
  OpenRouterClient,
  ToolCall,
} from "../llm/openrouter.js";
import type { MemoryStore } from "../memory/store.js";
import { DEFAULT_WORKER_MODEL } from "../models.js";
import { approvalDecisionFor } from "../local/actionLog.js";
import { SENSITIVE_TOOLS } from "../protocol/messages.js";
import type { ContentRequest, ContentResponse } from "../protocol/messages.js";
import type { RagStore } from "../rag/store.js";
import type { SessionStore } from "../sessions/store.js";
import { AGENT_TOOLS, parseToolArguments, rowsToCsv, toolArgsToContentRequest } from "../browser/tools.js";
import {
  resolveVisionCapability,
  UX_VISION_WORKER_SYSTEM,
} from "../vision/capability.js";
import {
  promoteScreenshotToVision,
  screenshotToolStub,
  visionPartsFromPending,
  type PendingVision,
} from "../vision/promote.js";
import {
  buildAnnotateScreenshotHtml,
  isSafeDataUrlForSrcDoc,
  type AnnotateHighlight,
  type AnnotateMarker,
} from "../vision/annotateHtml.js";
import { embedAttachmentsInHtml } from "../vision/embedAttachments.js";
import {
  mergeVisionSettings,
  type ImageDetail,
  type VisionSettings,
} from "../vision/settings.js";

export type ApprovalMode = "ask" | "auto_llm" | "auto_all";

export interface BrowserBridge {
  runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse>;
  listTabs(): Promise<Array<{ id: number; title: string; url: string }>>;
  openTab(
    url: string,
    active?: boolean,
  ): Promise<{ id: number; url: string; title?: string; contentReady?: boolean; warning?: string }>;
  activateTab(tabId: number): Promise<{ ok: boolean }>;
  navigate(
    url: string,
    tabId?: number,
  ): Promise<{
    ok: boolean;
    url: string;
    title?: string;
    previousUrl?: string;
    contentReady?: boolean;
    warning?: string;
  }>;
  goBack(
    tabId?: number,
  ): Promise<{ ok: boolean; url?: string; title?: string; contentReady?: boolean; warning?: string }>;
  closeTab(tabId: number): Promise<{ ok: boolean }>;
  downloadText(filename: string, text: string, mime?: string): Promise<{ ok: boolean }>;
  captureViewport?(windowId?: number): Promise<import("../media/capture.js").ScreenshotResult>;
  captureElement?(
    tabId: number,
    target: { selector?: string; index?: number },
  ): Promise<import("../media/capture.js").ScreenshotResult>;
  captureFullPage?(tabId: number): Promise<import("../media/capture.js").ScreenshotResult>;
  startRecording?(
    tabId: number,
  ): Promise<{ ok: boolean; session?: import("../media/capture.js").RecordingSession; error?: string }>;
  stopRecording?(opts?: {
    download?: boolean;
    filename?: string;
  }): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  /** Inject approved page extensions into a tab (MAIN world). */
  injectPageExtensions?(opts?: {
    tabId?: number;
    scriptIds?: string[];
  }): Promise<{ ok: boolean; injected?: string[]; errors?: string[]; error?: string }>;
}

/** A saved site login + scrape recipe, stored encrypted in the vault as `site_profile:<name>`. */
export interface SiteProfile {
  name: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  selector?: string;
  nextSelector?: string;
  nextText?: string;
  intent?: string;
  schemaHint?: string;
}

/** Vault-backed profile store; App.tsx wires this to Vault labels. */
export interface ProfileStore {
  get(name: string): Promise<SiteProfile | null>;
  save(profile: SiteProfile): Promise<void>;
}

export type RunContextSnapshot = {
  systemPrompt: string;
  memoryBlock: string;
  /** Open conversation + global tasks prepended each turn (empty if none). */
  taskBlock: string;
  /** Skill name/description index (bodies via skill_read). */
  skillBlock: string;
  /** Schema-less tool index (pack→skill); JSON schemas live on API tools[] only. */
  toolCatalogBlock: string;
  toolNames: string[];
  model: string;
  /** How the first orchestrator call was delivered */
  transport: "stream" | "full";
};

/** In-chat / drawer preview payload (open_preview + screenshot auto-preview). */
export type ChatPreviewPayload = {
  kind: "table" | "html" | "text" | "image" | "compare";
  title: string;
  headers?: string[];
  rows?: string[][];
  html?: string;
  text?: string;
  src?: string;
  beforeSrc?: string;
  afterSrc?: string;
  /** Prefer over embedding data URLs when persisting the chat timeline. */
  attachmentId?: string;
  beforeAttachmentId?: string;
  afterAttachmentId?: string;
  /** html only — scripts allowed when true (sandbox never includes allow-same-origin). */
  interactive?: boolean;
};

export interface AgentEvent {
  type:
    | "status"
    | "tool_start"
    | "tool_result"
    | "tool_approval"
    | "assistant_delta"
    | "reasoning_delta"
    | "done"
    | "error"
    | "usage"
    | "run_context"
    | "tools_unlocked"
    | "preview";
  message?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  usage?: LlmUsage;
  toolCallId?: string;
  /** orchestrator | worker | approval */
  usageSource?: "orchestrator" | "worker" | "approval" | "vision_worker";
  resolve?: (allow: boolean) => void;
  /** Present on tool_result after the approval gate */
  approvalMode?: ApprovalMode;
  /** allowed | denied | auto_all | auto_llm | n/a */
  approvalDecision?: "allowed" | "denied" | "auto_all" | "auto_llm" | "n/a";
  /** Emitted once per user turn — system + memories (not re-sent mid-stream). */
  runContext?: RunContextSnapshot;
  /** skill_read unlocked tools for this run */
  skillId?: string;
  unlockedTools?: string[];
  activeTools?: string[];
  /** open_preview / auto screenshot surface */
  preview?: ChatPreviewPayload;
}

/** Runtime for dynamic REST/MCP connectors (no hardcoded hosts). */
export type ConnectorRuntime = {
  store: ConnectorStore;
  getSecret: (label: string) => Promise<string | null>;
  /** If set, only these connector ids are callable */
  allowedIds?: string[];
};

/** @deprecated use ConnectorRuntime */
export type ConnectorBundle = ConnectorRuntime;

export interface SubagentEvent {
  type: "start" | "delta" | "done" | "error";
  subagentId: string;
  goal: string;
  summary?: string;
  messages?: ChatMessage[];
  usage?: LlmUsage;
}

export interface AgentRunOptions {
  model: string;
  /** Cheap model for parse_data (and optional approval) */
  workerModel?: string;
  userMessage: string;
  history?: ChatMessage[];
  maxSteps?: number;
  signal?: AbortSignal;
  systemPrompt?: string;
  enabledTools?: string[];
  /**
   * skill_gated (default when skills provided): lean ALWAYS_ON + unlock via skill_read.
   * static: attach full ceiling every turn (good for expensive orch / auto-picked profiles).
   */
  toolMode?: AgentToolMode;
  /** On-demand skill store (search/read/save). */
  skills?: SkillStore;
  /** User-defined custom tools (schemas + guide/echo handlers). */
  customTools?: CustomToolStore;
  approvalMode?: ApprovalMode;
  /**
   * Live approval mode (e.g. UI flipped mid-run to auto_all).
   * When set, consulted per tool call so Auto-approve persists for the rest of the run.
   */
  getApprovalMode?: () => ApprovalMode;
  approvalModel?: string;
  onEvent?: (event: AgentEvent) => void;
  /** Local folder RAG index (IndexedDB) */
  rag?: RagStore;
  /** Dynamic REST/MCP connectors */
  connectors?: ConnectorRuntime;
  /** Chat attachments (PDF/CSV/images/…) */
  attachments?: AttachmentStore;
  /** Attachment ids included with this user turn */
  pendingAttachmentIds?: string[];
  /** UX Vision Lab settings (OOTB defaults if omitted). */
  vision?: Partial<VisionSettings>;
  /**
   * Optional map from OpenRouter listModels (id → supportsVision).
   * Unknown models without a preset flag use the vision worker.
   */
  openRouterVision?: ReadonlyMap<string, boolean> | Record<string, boolean>;
  /** Named Views (Views tab / save_view) */
  views?: ViewStore;
  /** Per-action Always Allow policies (tool ± target). */
  approvalPolicies?: ApprovalPolicyStore;
  /** Table mutation delta log (Changes tab). */
  changeLog?: ChangeLogStore;
  /** Minimize steps/tokens — prefer page_digest + worker parse */
  budgetMode?: AgentBudgetMode;
  /** Sub-agent nesting depth (0 = root orchestrator). */
  nestingDepth?: number;
  /** Agent profile store for create/list/update/spawn. */
  agents?: AgentProfileStore;
  /** Task board store. */
  tasks?: TaskStore;
  /** Usage telemetry store. */
  usageLog?: UsageStore;
  /** Page extensions (userscripts) — isolated from combo sessions/vault. */
  pageExtensions?: import("../pageExtensions/store.js").PageExtensionStore;
  sessionId?: string;
  runId?: string;
  agentId?: string;
  onSubagent?: (e: SubagentEvent) => void;
}

export interface AgentRunResult {
  messages: ChatMessage[];
  finalText: string;
  steps: number;
  usage: LlmUsage;
  aborted: boolean;
  hitStepLimit: boolean;
}

const DEFAULT_SYSTEM = `You are Combo-X, a local-first browser agent (orchestrator).
Browser navigation: ALWAYS prefer navigate (same tab). Use open_tab ONLY with newTab:true when you truly need a second page in parallel (e.g. compare two PDPs). Ephemeral new tabs are auto-closed at end of turn unless keepOpen:true — still prefer navigate. Use list_tabs + activate_tab to reuse existing tabs; close_tab when done with a keepOpen tab.
For interaction prefer get_interactive → click_index / type_index (Nanobrowser-style indices) over guessing CSS. After opening a modal/floating editor, call get_interactive again — it scopes to the topmost dialog OR high-z portal (scope=dialog) so Save/Plan title are indexed (not calendar buttons behind). Never type_index free text into type=time.
SKILLS vs MEMORY:
- Memories are already prepended in the system message each turn (global + active agent). Do not re-fetch them mid-stream.
- Skill descriptions are listed in AVAILABLE SKILLS below. Use skill_search / skill_read for the full body AND to unlock specialized tools (scrape, rest, rag, page-ext, media).
- Use skill_save to create/update playbooks when that tool is enabled. Use custom_tool_save / list_custom_tools for user-defined tools when enabled.
- TOOL INDEX lists ACTIVE tools (one-liners) and LOCKED packs (pack → combo-* skill). Parameter schemas are NOT in the system prompt — only on the attached tools[] for ACTIVE tools.
- For LOCKED packs: skill_search → skill_read (combo-scrape, combo-rest, combo-rag, combo-page-ext, combo-media) to unlock; then those tools join tools[] with full schemas.
Browse with page_digest / get_page freely. Specialized scrape/REST/RAG/media/page-ext tools require a skill unlock first (unless this agent uses static toolMode).
UX Vision Lab: For any visual UX audit you MUST call ux_critique (always-on) — do not answer from get_page alone. It captures, shows a chat screenshot artifact, and vision-attaches for the next turn. Then annotate_screenshot({ attachmentId, markers }) and/or open_preview with attachmentId / beforeAttachmentId / afterAttachmentId. Optional live CSS: page_css_preview → ux_critique again → compare → page_css_clear. Raw screenshot_* need combo-media. Never paste base64.
Durable notes: remember / save_memory / recall / memory_list (scope global|agent).
Rules:
- Prefer page_digest over full get_page dumps.
- Prefer skill_read + tools / rag / memories over inventing facts.
- After click/navigate, wait briefly then re-read.
- Never invent page content — use tools.
- Be concise in the final answer.`;

const PARSE_SYSTEM = `You extract structured data from untrusted page text.
Reply with ONLY valid JSON: {"rows":[...],"notes":"optional short note"}.
rows must match the user's intent / schema_hint. No markdown fences.`;

function sumUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
  };
}

const ZERO: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
};

function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    return { rows: [], notes: "parse_failed", raw: body.slice(0, 500) };
  }
}

function strOpt(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const META_TASK_TOOLS = ["create_task", "list_tasks", "update_task", "reorder_tasks"];

function mergeToolNames(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const name of group) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function metaToolsForAgent(canDelegate: boolean, canSelfEdit: boolean): string[] {
  const meta = [...META_TASK_TOOLS];
  if (canDelegate) meta.push("spawn_subagent");
  if (canSelfEdit) meta.push("update_agent", "list_agents", "create_agent");
  return meta;
}

interface RunContext {
  nestingDepth: number;
  runId: string;
  sessionId?: string;
  agentId?: string;
  agents?: AgentProfileStore;
  tasks?: TaskStore;
  usageLog?: UsageStore;
  pageExtensions?: import("../pageExtensions/store.js").PageExtensionStore;
  resolvedProfile: ResolvedAgentProfile | null;
  /** Ceiling — user/profile may-use set. */
  enabledToolNames: string[];
  /** Currently attached tool names (skill_gated expands on skill_read). */
  activeToolNames: string[];
  toolMode: AgentToolMode;
  skills?: SkillStore;
  customTools?: CustomToolStore;
  customToolMap: Map<string, CustomTool>;
  onSubagent?: (e: SubagentEvent) => void;
  rebuildTools: () => void;
  model: string;
  workerModel: string;
  budgetMode: AgentBudgetMode;
  signal?: AbortSignal;
  rag?: RagStore;
  connectors?: ConnectorRuntime;
  attachments?: AttachmentStore;
  views?: ViewStore;
  approvalPolicies?: ApprovalPolicyStore;
  changeLog?: ChangeLogStore;
  approvalMode?: ApprovalMode;
  getApprovalMode?: () => ApprovalMode;
  approvalModel?: string;
  systemPrompt?: string;
  history?: ChatMessage[];
  pendingVision: PendingVision | null;
  visionSettings: VisionSettings;
  openRouterVision?: ReadonlyMap<string, boolean> | Record<string, boolean>;
  /** Tabs opened via open_tab(newTab:true) this run — closed on finish unless keepOpen. */
  ephemeralTabIds: number[];
}

export class AgentLoop {
  private readonly artifacts = new ArtifactStore();

  constructor(
    private readonly llm: OpenRouterClient,
    private readonly browser: BrowserBridge,
    private readonly memory: MemoryStore,
    private readonly sessions?: SessionStore,
    private readonly profiles?: ProfileStore,
  ) {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const nestingDepth = options.nestingDepth ?? 0;
    const runId = options.runId ?? crypto.randomUUID();
    let resolvedProfile: ResolvedAgentProfile | null = null;
    if (options.agentId && options.agents) {
      const profile = await options.agents.get(options.agentId);
      if (profile) resolvedProfile = resolveAgentProfile(profile);
    }

    const budgetMode =
      options.budgetMode ?? resolvedProfile?.budgetMode ?? "normal";
    const maxSteps = resolveMaxSteps(
      budgetMode,
      options.maxSteps ?? resolvedProfile?.maxSteps,
    );
    const resolveApprovalMode = (): ApprovalMode =>
      options.getApprovalMode?.() ??
      options.approvalMode ??
      resolvedProfile?.approvalMode ??
      "ask";
    const workerModel =
      options.workerModel ??
      resolvedProfile?.workerModel ??
      DEFAULT_WORKER_MODEL;
    const orchestratorModel = resolvedProfile?.orchestratorModel ?? options.model;
    const emit = options.onEvent ?? (() => undefined);

    const logUsage = async (input: Omit<UsageEvent, "id" | "at">) => {
      await options.usageLog?.append({
        sessionId: options.sessionId,
        runId,
        agentId: options.agentId,
        ...input,
      });
    };

    await logUsage({ kind: "message", role: "user" });

    const userContent = await this.buildUserContent(options);
    let systemBase = options.systemPrompt ?? resolvedProfile?.systemPrompt ?? DEFAULT_SYSTEM;
    if (budgetMode === "budget") systemBase = `${systemBase}\n\n${BUDGET_SYSTEM_ADDON}`;

    let usage = ZERO;
    let steps = 0;
    let finalText = "";
    const pageTemplates = new PageTemplateCache();

    const customRows = options.customTools ? await options.customTools.list() : [];
    const customToolMap = new Map(customRows.map((t) => [t.name, t]));

    // undefined/null → all built-in tools; [] → zero tools (Disable-all must not restore full set).
    let enabledToolNames =
      options.enabledTools != null
        ? [...options.enabledTools]
        : AGENT_TOOLS.map((t) => t.function.name);
    // Stale allowlists often omit Vision Lab — force-attach so "MUST call ux_critique" is callable.
    enabledToolNames = ensureForceAttachTools(enabledToolNames);
    // Custom tools always join the ceiling when present (unless explicitly stripped).
    for (const c of customRows) {
      if (!enabledToolNames.includes(c.name)) enabledToolNames.push(c.name);
    }

    // Enforce profile capability flags on the allowlist for this run.
    if (resolvedProfile && !resolvedProfile.canSelfEdit) {
      enabledToolNames = enabledToolNames.filter(
        (n) => n !== "create_agent" && n !== "update_agent",
      );
    }
    if (resolvedProfile && !resolvedProfile.canDelegate) {
      enabledToolNames = enabledToolNames.filter((n) => n !== "spawn_subagent");
    }

    const ceiling = new Set(enabledToolNames);
    const toolMode: AgentToolMode =
      options.toolMode ??
      resolvedProfile?.toolMode ??
      (options.skills ? "skill_gated" : "static");

    let activeToolNames =
      toolMode === "skill_gated"
        ? [...initialActiveTools(ceiling), ...customRows.map((c) => c.name).filter((n) => ceiling.has(n))]
        : enabledToolNames.filter((n) => ceiling.has(n));
    activeToolNames = [...new Set(activeToolNames)];

    const rebuildTools = () => {
      const builtin = AGENT_TOOLS.filter((t) => activeToolNames.includes(t.function.name));
      const customDefs = customRows
        .filter((c) => activeToolNames.includes(c.name))
        .map(customToolToDefinition);
      tools = [...builtin, ...customDefs];
    };
    let tools = AGENT_TOOLS.filter((t) => activeToolNames.includes(t.function.name));
    rebuildTools();

    // Memories / tasks / skill index / tool schemas — once per user turn (not mid-stream).
    const memBlock = await this.formatMemoryInject(options.agentId);
    const taskBlock = await this.formatTaskInject(options.sessionId, options.tasks);
    const skillBlock = await this.formatSkillInject(options.agentId, options.skills);
    const toolCatalogBlock = formatToolSchemaBlock(enabledToolNames, activeToolNames, {
      custom: customRows,
      maxChars: budgetMode === "budget" ? 4_000 : 6_000,
    });
    const systemParts = [
      systemBase,
      memBlock,
      taskBlock,
      skillBlock,
      toolCatalogBlock,
    ].filter(Boolean);
    const messages: ChatMessage[] = [
      { role: "system", content: systemParts.join("\n\n") },
      ...leanHistory(options.history ?? []),
      { role: "user", content: userContent },
    ];

    const preferStream = typeof this.llm.chatStreaming === "function";
    emit({
      type: "run_context",
      runContext: {
        systemPrompt: systemBase,
        memoryBlock: memBlock,
        taskBlock,
        skillBlock,
        toolCatalogBlock,
        toolNames: tools.map((t) => t.function.name),
        model: orchestratorModel,
        transport: preferStream ? "stream" : "full",
      },
    });

    const visionSettings = mergeVisionSettings(options.vision);
    const runCtx: RunContext = {
      nestingDepth,
      runId,
      sessionId: options.sessionId,
      agentId: options.agentId,
      agents: options.agents,
      tasks: options.tasks,
      usageLog: options.usageLog,
      pageExtensions: options.pageExtensions,
      resolvedProfile,
      enabledToolNames,
      activeToolNames,
      toolMode,
      skills: options.skills,
      customTools: options.customTools,
      customToolMap,
      rebuildTools: () => {
        // Keep runCtx.activeToolNames as source of truth for unlocks.
        activeToolNames = runCtx.activeToolNames;
        rebuildTools();
      },
      onSubagent: options.onSubagent,
      model: orchestratorModel,
      workerModel,
      budgetMode,
      signal: options.signal,
      rag: options.rag,
      connectors: options.connectors,
      attachments: options.attachments,
      views: options.views,
      approvalPolicies: options.approvalPolicies,
      changeLog: options.changeLog,
      approvalMode: options.approvalMode ?? resolvedProfile?.approvalMode,
      getApprovalMode: options.getApprovalMode,
      approvalModel: options.approvalModel,
      systemPrompt: options.systemPrompt ?? resolvedProfile?.systemPrompt,
      history: options.history,
      pendingVision: null,
      visionSettings,
      openRouterVision: options.openRouterVision,
      ephemeralTabIds: [],
    };
    // Point rebuild at runCtx so unlocks sync both arrays.
    runCtx.rebuildTools = () => {
      activeToolNames = runCtx.activeToolNames;
      rebuildTools();
    };

    const finishRun = async (
      outcome: {
        finalText: string;
        aborted: boolean;
        hitStepLimit: boolean;
        doneMessage?: string;
      },
    ) => {
      for (const tabId of runCtx.ephemeralTabIds) {
        try {
          await this.browser.closeTab(tabId);
        } catch {
          /* tab may already be closed */
        }
      }
      runCtx.ephemeralTabIds = [];
      emit({
        type: "done",
        message: outcome.doneMessage ?? outcome.finalText,
        usage,
      });
      return {
        messages,
        finalText: outcome.finalText,
        steps,
        usage,
        aborted: outcome.aborted,
        hitStepLimit: outcome.hitStepLimit,
      };
    };

    for (let step = 0; step < maxSteps; step += 1) {
      if (options.signal?.aborted) {
        return finishRun({ finalText, aborted: true, hitStepLimit: false, doneMessage: "aborted" });
      }

      // Refresh schemas after possible skill_read unlocks from the previous step.
      activeToolNames = runCtx.activeToolNames;
      rebuildTools();

      emit({
        type: "status",
        message: `Working… turn ${step + 1} (limit ${maxSteps})`,
      });

      // Flush pending screenshot vision once (M1) before the next orchestrator call.
      await this.flushPendingVision(messages, runCtx, emit, (u) => {
        usage = sumUsage(usage, u);
      }, logUsage);

      let result: ChatResult;
      try {
        // Prefer streaming so the UI sees tokens; fall back to non-stream chat for mocks/old clients.
        if (typeof this.llm.chatStreaming === "function") {
          result = await this.llm.chatStreaming({
            model: orchestratorModel,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: 0.2,
            signal: options.signal,
            onDelta: (accumulated) => {
              emit({ type: "assistant_delta", message: accumulated });
            },
            onReasoning: (accumulated) => {
              emit({ type: "reasoning_delta", message: accumulated });
            },
          });
        } else {
          result = await this.llm.chat({
            model: orchestratorModel,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: 0.2,
          });
          if (result.reasoning?.trim()) {
            emit({ type: "reasoning_delta", message: result.reasoning });
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        emit({ type: "error", message: msg });
        throw error;
      }

      usage = sumUsage(usage, result.usage);
      emit({ type: "usage", usage: result.usage, usageSource: "orchestrator" });
      await logUsage({
        kind: "llm",
        model: orchestratorModel,
        provider: providerFromModel(orchestratorModel),
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: result.usage.estimatedCostUsd,
      });
      steps += 1;

      if (result.toolCalls.length === 0) {
        finalText = result.content ?? "";
        messages.push({ role: "assistant", content: finalText });
        emit({ type: "assistant_delta", message: finalText });
        await logUsage({ kind: "message", role: "assistant" });
        return finishRun({ finalText, aborted: false, hitStepLimit: false });
      }

      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        if (options.signal?.aborted) {
          return finishRun({
            finalText,
            aborted: true,
            hitStepLimit: false,
            doneMessage: "aborted",
          });
        }

        const args = parseToolArguments(call.function.arguments);
        const modeNow = resolveApprovalMode();
        const sensitive = SENSITIVE_TOOLS.has(call.function.name);
        const allowed = await this.approve(
          call,
          args,
          modeNow,
          options.approvalModel ?? workerModel,
          emit,
          options.signal,
          (u) => {
            usage = sumUsage(usage, u);
            void logUsage({
              kind: "llm",
              model: options.approvalModel ?? workerModel,
              provider: providerFromModel(options.approvalModel ?? workerModel),
              promptTokens: u.promptTokens,
              completionTokens: u.completionTokens,
              totalTokens: u.totalTokens,
              estimatedCostUsd: u.estimatedCostUsd,
            });
          },
          options.approvalPolicies,
        );
        const decision = approvalDecisionFor(modeNow, allowed, sensitive);
        if (!allowed) {
          const denied = { ok: false, error: "denied by user / policy" };
          emit({
            type: "tool_result",
            tool: call.function.name,
            args,
            result: denied,
            toolCallId: call.id,
            approvalMode: modeNow,
            approvalDecision: decision,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(denied),
          });
          continue;
        }

        const toolResult = await this.executeTool(
          call,
          args,
          emit,
          workerModel,
          (u) => {
            usage = sumUsage(usage, u);
          },
          options.rag,
          options.connectors,
          options.attachments,
          options.views,
          { approvalMode: modeNow, approvalDecision: decision },
          budgetMode,
          pageTemplates,
          runCtx,
          logUsage,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
        });
      }
    }

    finalText =
      `Hit the step limit (${maxSteps} model turns). I can continue if you say “continue” — or narrow the task (e.g. one category page + parse_data + export_csv).`;
    messages.push({ role: "assistant", content: finalText });
    await logUsage({ kind: "message", role: "assistant" });
    return finishRun({ finalText, aborted: false, hitStepLimit: true, doneMessage: finalText });
  }

  private async approve(
    call: ToolCall,
    args: Record<string, unknown>,
    mode: ApprovalMode,
    approvalModel: string,
    emit: (e: AgentEvent) => void,
    signal: AbortSignal | undefined,
    onUsage: (u: LlmUsage) => void,
    approvalPolicies?: ApprovalPolicyStore,
  ): Promise<boolean> {
    if (!SENSITIVE_TOOLS.has(call.function.name)) return true;
    // Page-extension lifecycle that installs MAIN-world JS must never auto-approve.
    const alwaysAskUser = new Set([
      "approve_page_extension",
      "set_page_extension_bridge",
      "inject_page_extension",
    ]);
    if (
      !alwaysAskUser.has(call.function.name) &&
      approvalPolicies &&
      (await approvalPolicies.allows(call.function.name, args))
    ) {
      return true;
    }
    if (alwaysAskUser.has(call.function.name)) {
      /* fall through to ask / UI gate even under auto_all */
    } else if (mode === "auto_all") {
      return true;
    }

    if (mode === "auto_llm" && !alwaysAskUser.has(call.function.name)) {
      try {
        const verdict = await this.llm.chat({
          model: approvalModel,
          messages: [
            {
              role: "system",
              content:
                "You are a safety gate for a browser agent. Reply ONLY yes or no. Approve routine browsing (open shop URLs, click nav/search, type search queries). Deny destructive/sensitive (delete, payments, password changes, email send, random downloads).",
            },
            {
              role: "user",
              content: `Tool: ${call.function.name}\nArgs: ${JSON.stringify(args)}`,
            },
          ],
          maxTokens: 4,
          temperature: 0,
        });
        onUsage(verdict.usage);
        emit({ type: "usage", usage: verdict.usage, usageSource: "approval" });
        const text = (verdict.content ?? "").trim().toLowerCase();
        return text.startsWith("y");
      } catch {
        // fall through to ask
      }
    }

    return await new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      const onAbort = () => resolve(false);
      signal?.addEventListener("abort", onAbort, { once: true });
      emit({
        type: "tool_approval",
        tool: call.function.name,
        args,
        toolCallId: call.id,
        message: `Allow ${call.function.name}?`,
        resolve: (allow) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(allow);
        },
      });
    });
  }

  /**
   * Same system/memory/tasks/skills/tool-index blocks as the next run(), without calling the LLM.
   * Used by the composer “Preview” button.
   */
  async previewRunContext(
    options: AgentRunOptions,
  ): Promise<RunContextSnapshot & { userPreview: string; historyTurns: number }> {
    let resolvedProfile: ResolvedAgentProfile | null = null;
    if (options.agentId && options.agents) {
      const profile = await options.agents.get(options.agentId);
      if (profile) resolvedProfile = resolveAgentProfile(profile);
    }
    const budgetMode =
      options.budgetMode ?? resolvedProfile?.budgetMode ?? "normal";
    const orchestratorModel = resolvedProfile?.orchestratorModel ?? options.model;
    let systemBase = options.systemPrompt ?? resolvedProfile?.systemPrompt ?? DEFAULT_SYSTEM;
    if (budgetMode === "budget") systemBase = `${systemBase}\n\n${BUDGET_SYSTEM_ADDON}`;

    const customRows = options.customTools ? await options.customTools.list() : [];
    let enabledToolNames =
      options.enabledTools != null
        ? [...options.enabledTools]
        : AGENT_TOOLS.map((t) => t.function.name);
    enabledToolNames = ensureForceAttachTools(enabledToolNames);
    for (const c of customRows) {
      if (!enabledToolNames.includes(c.name)) enabledToolNames.push(c.name);
    }
    if (resolvedProfile && !resolvedProfile.canSelfEdit) {
      enabledToolNames = enabledToolNames.filter(
        (n) => n !== "create_agent" && n !== "update_agent",
      );
    }
    if (resolvedProfile && !resolvedProfile.canDelegate) {
      enabledToolNames = enabledToolNames.filter((n) => n !== "spawn_subagent");
    }
    const ceiling = new Set(enabledToolNames);
    const toolMode: AgentToolMode =
      options.toolMode ??
      resolvedProfile?.toolMode ??
      (options.skills ? "skill_gated" : "static");
    let activeToolNames =
      toolMode === "skill_gated"
        ? [
            ...initialActiveTools(ceiling),
            ...customRows.map((c) => c.name).filter((n) => ceiling.has(n)),
          ]
        : enabledToolNames.filter((n) => ceiling.has(n));
    activeToolNames = [...new Set(activeToolNames)];

    const memoryBlock = await this.formatMemoryInject(options.agentId);
    const taskBlock = await this.formatTaskInject(options.sessionId, options.tasks);
    const skillBlock = await this.formatSkillInject(options.agentId, options.skills);
    const toolCatalogBlock = formatToolSchemaBlock(enabledToolNames, activeToolNames, {
      custom: customRows,
      maxChars: budgetMode === "budget" ? 4_000 : 6_000,
    });
    const userContent = await this.buildUserContent(options);
    const userPreview =
      typeof userContent === "string"
        ? userContent
        : userContent
            .map((p) => {
              if (p.type === "text") return p.text;
              if (p.type === "image_url") return "[image attachment]";
              return "[content part]";
            })
            .join("\n");
    const preferStream = typeof this.llm.chatStreaming === "function";
    return {
      systemPrompt: systemBase,
      memoryBlock,
      taskBlock,
      skillBlock,
      toolCatalogBlock,
      toolNames: activeToolNames,
      model: orchestratorModel,
      transport: preferStream ? "stream" : "full",
      userPreview,
      historyTurns: options.history?.length ?? 0,
    };
  }

  /** First-call inject: always prepend global + active-agent memories (not mid-stream). */
  private async formatMemoryInject(agentId?: string): Promise<string> {
    try {
      const top = await this.memory.listForInject({ agentId, limit: 24 });
      if (!top.length) return "";
      const lines = top.map((m, i) => {
        const tag = m.scope === "agent" ? "agent" : "global";
        return `${i + 1}. [${tag}] ${m.text.slice(0, 400)}`;
      });
      return `AGENT MEMORIES (local; always prepended each turn; prefer these over inventing facts):\n${lines.join("\n")}`;
    } catch {
      return "";
    }
  }

  /** First-call inject: open session + global tasks (ns-agent Conversation Tasks parity). */
  private async formatTaskInject(
    sessionId: string | undefined,
    tasks: AgentRunOptions["tasks"],
  ): Promise<string> {
    if (!tasks) return "";
    try {
      const rows = await tasks.list({});
      return formatOpenTasksBlock(rows, sessionId);
    } catch {
      return "";
    }
  }

  /** Skill name/description index (bodies via skill_read). */
  private async formatSkillInject(
    agentId: string | undefined,
    skills: AgentRunOptions["skills"],
  ): Promise<string> {
    if (!skills) return "";
    try {
      const rows = await skills.list({ agentId, limit: 40 });
      return formatSkillIndexBlock(rows);
    } catch {
      return "";
    }
  }

  /**
   * Inject pending screenshot vision exactly once (M1).
   * Vision orchestrator → role:user image_url; else vision worker → text crumb.
   */
  private async flushPendingVision(
    messages: ChatMessage[],
    runCtx: RunContext,
    emit: (e: AgentEvent) => void,
    onUsage: (u: LlmUsage) => void,
    logUsage: (input: Omit<UsageEvent, "id" | "at">) => Promise<void>,
  ): Promise<void> {
    const pending = runCtx.pendingVision;
    if (!pending || pending.consumed) return;
    pending.consumed = true;
    runCtx.pendingVision = null;

    const cap = resolveVisionCapability(runCtx.model, {
      settings: runCtx.visionSettings,
      openRouterVision: runCtx.openRouterVision,
    });

    if (cap.orchestratorHasVision) {
      messages.push({
        role: "user",
        content: visionPartsFromPending(pending),
      });
      emit({
        type: "status",
        message: `Vision attached (${cap.source}) for orchestrator`,
      });
      return;
    }

    emit({
      type: "status",
      message: `Vision worker (${runCtx.visionSettings.visionWorkerModel}) — orchestrator lacks vision (${cap.source})`,
    });
    const critique = await this.runVisionWorker(pending, runCtx, emit, onUsage, logUsage);
    messages.push({
      role: "user",
      content: [
        pending.attachmentId
          ? `[Vision worker critique; attachmentId=${pending.attachmentId}]`
          : "[Vision worker critique]",
        critique,
      ].join("\n\n"),
    });
  }

  private async runVisionWorker(
    pending: PendingVision,
    runCtx: RunContext,
    emit: (e: AgentEvent) => void,
    onUsage: (u: LlmUsage) => void,
    logUsage: (input: Omit<UsageEvent, "id" | "at">) => Promise<void>,
  ): Promise<string> {
    const model = runCtx.visionSettings.visionWorkerModel;
    const parts = visionPartsFromPending(pending);
    const result = await this.llm.chat({
      model,
      messages: [
        { role: "system", content: UX_VISION_WORKER_SYSTEM },
        { role: "user", content: parts },
      ],
      temperature: 0.2,
      maxTokens: 1200,
    });
    onUsage(result.usage);
    emit({ type: "usage", usage: result.usage, usageSource: "vision_worker" });
    await logUsage({
      kind: "llm",
      model,
      provider: providerFromModel(model),
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      estimatedCostUsd: result.usage.estimatedCostUsd,
    });
    return (result.content ?? "").trim() || "(vision worker returned empty critique)";
  }

  private async finalizeScreenshotCapture(
    shot: { ok: boolean; dataUrl?: string; error?: string; note?: string },
    label: string,
    runCtx: RunContext | undefined,
    emit: (e: AgentEvent) => void,
    detailOverride?: ImageDetail,
  ): Promise<Record<string, unknown>> {
    if (!shot.ok || !shot.dataUrl) {
      return screenshotToolStub({
        ok: false,
        visionAttached: false,
        error: shot.error ?? "capture failed",
        note: shot.note,
      });
    }

    const settings = runCtx?.visionSettings ?? mergeVisionSettings();
    const detail = detailOverride ?? settings.critiqueImageDetail;
    const promoted = await promoteScreenshotToVision(shot.dataUrl, {
      maxBytes: settings.maxVisionBytes,
      detail,
    });

    let attachmentId: string | undefined;
    if (runCtx?.attachments && runCtx.sessionId) {
      attachmentId = crypto.randomUUID();
      await runCtx.attachments.put({
        id: attachmentId,
        sessionId: runCtx.sessionId,
        name: `screenshot-${label}-${Date.now()}.jpg`,
        mime: promoted.dataUrl.startsWith("data:image/jpeg")
          ? "image/jpeg"
          : "image/png",
        kind: "image",
        size: promoted.bytes,
        text: "",
        dataUrl: promoted.dataUrl,
        meta: { vision: true, source: label, downscaled: promoted.downscaled },
        truncated: false,
        createdAt: Date.now(),
      });
    }

    const visionAttached = Boolean(settings.autoAttachScreenshots && runCtx);
    if (visionAttached && runCtx) {
      runCtx.pendingVision = {
        dataUrl: promoted.dataUrl,
        detail: promoted.detail,
        attachmentId,
        consumed: false,
      };
    }

    emit({
      type: "preview",
      preview: {
        kind: "image",
        title: `Screenshot · ${label}`,
        src: promoted.dataUrl,
        attachmentId,
      },
    });

    return screenshotToolStub({
      ok: true,
      attachmentId,
      bytes: promoted.bytes,
      visionAttached,
      note:
        shot.note ??
        (visionAttached
          ? "Vision queued for next model turn (image not in tool JSON)."
          : "Stored; autoAttachScreenshots is off."),
    });
  }

  private async handleUxCritique(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
    emit: (e: AgentEvent) => void,
  ): Promise<Record<string, unknown>> {
    const scope =
      args.scope === "element" || args.scope === "full" ? args.scope : "viewport";
    const detail =
      args.detail === "auto" || args.detail === "low" || args.detail === "high"
        ? args.detail
        : undefined;
    const focus =
      typeof args.focus === "string" && args.focus.trim() ? args.focus.trim() : undefined;

    let shot: { ok: boolean; dataUrl?: string; error?: string; note?: string };
    if (scope === "viewport") {
      if (!this.browser.captureViewport) {
        return { ok: false, error: "capture unavailable" };
      }
      shot = await this.browser.captureViewport(
        typeof args.windowId === "number" ? args.windowId : undefined,
      );
    } else if (scope === "full") {
      if (!this.browser.captureFullPage) {
        return { ok: false, error: "capture unavailable" };
      }
      const tabs = await this.browser.listTabs();
      const tabId = typeof args.tabId === "number" ? args.tabId : (tabs[0]?.id ?? 0);
      shot = await this.browser.captureFullPage(tabId);
    } else {
      if (!this.browser.captureElement) {
        return { ok: false, error: "capture unavailable" };
      }
      const tabs = await this.browser.listTabs();
      const tabId = typeof args.tabId === "number" ? args.tabId : (tabs[0]?.id ?? 0);
      shot = await this.browser.captureElement(tabId, {
        selector: typeof args.selector === "string" ? args.selector : undefined,
        index: typeof args.index === "number" ? args.index : undefined,
      });
    }

    const stub = await this.finalizeScreenshotCapture(
      shot,
      `ux-${scope}`,
      runCtx,
      emit,
      detail,
    );
    return {
      ...stub,
      focus: focus ?? null,
      hint: focus
        ? `Focus critique on: ${focus}. Image vision-attached for next turn.`
        : "Image vision-attached for next turn. Apply UX rubric from combo-ux-critique skill.",
    };
  }

  private async resolveAttachmentDataUrl(
    id: unknown,
    runCtx: RunContext | undefined,
  ): Promise<string | null> {
    if (typeof id !== "string" || !id.trim() || !runCtx?.attachments) return null;
    const row = await runCtx.attachments.get(id.trim());
    const src = row?.dataUrl;
    if (!src || !src.startsWith("data:image/")) return null;
    return src;
  }

  /** Drop megabase64 image args — models must use attachmentId instead. */
  private sanitizePreviewSrc(raw: unknown): string | undefined {
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    if (raw.startsWith("data:image/") && raw.length > 8_000) return undefined;
    return raw;
  }

  private async handleOpenPreview(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
    emit: (e: AgentEvent) => void,
  ): Promise<Record<string, unknown>> {
    const kindRaw = String(args.kind ?? "text");
    const allowedKinds = new Set(["table", "html", "text", "image", "compare"]);
    const kind = allowedKinds.has(kindRaw)
      ? (kindRaw as ChatPreviewPayload["kind"])
      : "text";
    const interactiveSetting =
      runCtx?.visionSettings.interactivePreviewScripts ?? true;
    const interactive =
      kind === "html"
        ? args.interactive === false
          ? false
          : args.interactive === true
            ? true
            : interactiveSetting
        : false;

    let src = this.sanitizePreviewSrc(args.src);
    let beforeSrc = this.sanitizePreviewSrc(args.beforeSrc);
    let afterSrc = this.sanitizePreviewSrc(args.afterSrc);

    if (kind === "image" || kind === "compare") {
      const fromAtt = await this.resolveAttachmentDataUrl(args.attachmentId, runCtx);
      if (fromAtt) src = fromAtt;
      const beforeAtt = await this.resolveAttachmentDataUrl(
        args.beforeAttachmentId,
        runCtx,
      );
      if (beforeAtt) beforeSrc = beforeAtt;
      const afterAtt = await this.resolveAttachmentDataUrl(
        args.afterAttachmentId,
        runCtx,
      );
      if (afterAtt) afterSrc = afterAtt;
    }

    if (kind === "image" && !src) {
      return {
        ok: false,
        error: "image preview needs attachmentId (or a small non-data src)",
      };
    }
    if (kind === "compare" && !beforeSrc && !afterSrc) {
      return {
        ok: false,
        error: "compare needs beforeAttachmentId/afterAttachmentId (or small srcs)",
      };
    }

    let html = typeof args.html === "string" ? args.html : undefined;
    const attachIds = Array.isArray(args.attachmentIds)
      ? args.attachmentIds.map(String)
      : undefined;
    let embedded: string[] = [];
    let missingAtt: string[] = [];
    if (kind === "html" && html) {
      const emb = await embedAttachmentsInHtml(
        html,
        (id) => this.resolveAttachmentDataUrl(id, runCtx),
        { attachmentIds: attachIds, maxHtmlChars: 2_000_000 },
      );
      html = emb.html;
      embedded = emb.embedded;
      missingAtt = emb.missing;
    }

    const preview: ChatPreviewPayload = {
      kind,
      title: String(args.title ?? "Preview"),
      headers: Array.isArray(args.headers)
        ? (args.headers as unknown[]).map(String)
        : undefined,
      rows: Array.isArray(args.rows)
        ? (args.rows as unknown[]).map((r) =>
            Array.isArray(r) ? r.map(String) : [String(r)],
          )
        : undefined,
      html,
      text: typeof args.text === "string" ? args.text : undefined,
      src,
      beforeSrc,
      afterSrc,
      interactive,
    };

    // Hard cap HTML size to avoid sidepanel OOM (raised when embedding screenshots)
    const htmlCap = embedded.length ? 2_000_000 : 400_000;
    if (preview.html && preview.html.length > htmlCap) {
      return { ok: false, error: `html too large (max ${htmlCap} chars)` };
    }

    emit({ type: "preview", preview });
    return {
      ok: true,
      opened: preview.kind,
      title: preview.title,
      interactive: preview.interactive ?? false,
      embeddedAttachments: embedded,
      missingAttachments: missingAtt.length ? missingAtt : undefined,
      resolvedFromAttachment: Boolean(
        args.attachmentId ||
          args.beforeAttachmentId ||
          args.afterAttachmentId ||
          embedded.length,
      ),
    };
  }

  private async handleAnnotateScreenshot(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
    emit: (e: AgentEvent) => void,
  ): Promise<Record<string, unknown>> {
    const attachmentId =
      typeof args.attachmentId === "string" ? args.attachmentId.trim() : "";
    if (!attachmentId) return { ok: false, error: "attachmentId required" };
    const src = await this.resolveAttachmentDataUrl(attachmentId, runCtx);
    if (!src) return { ok: false, error: "attachment not found or not an image" };
    if (!isSafeDataUrlForSrcDoc(src)) {
      return { ok: false, error: "screenshot too large to embed in annotate preview" };
    }

    const markers: AnnotateMarker[] = Array.isArray(args.markers)
      ? args.markers
          .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
          .map((m) => ({
            x: Number(m.x),
            y: Number(m.y),
            label: String(m.label ?? ""),
            note: typeof m.note === "string" ? m.note : undefined,
          }))
          .filter((m) => m.label)
      : [];
    const highlights: AnnotateHighlight[] = Array.isArray(args.highlights)
      ? args.highlights
          .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
          .map((h) => ({
            x: Number(h.x),
            y: Number(h.y),
            w: Number(h.w),
            h: Number(h.h),
            label: typeof h.label === "string" ? h.label : undefined,
          }))
      : [];

    const title = String(args.title ?? "Annotated screenshot");
    const html = buildAnnotateScreenshotHtml({ title, src, markers, highlights });
    if (html.length > 400_000) {
      return { ok: false, error: "annotate html too large (max 400KB)" };
    }

    const preview: ChatPreviewPayload = {
      kind: "html",
      title,
      html,
      interactive: false,
    };
    emit({ type: "preview", preview });
    return {
      ok: true,
      opened: "html",
      title,
      attachmentId,
      markerCount: markers.length,
      highlightCount: highlights.length,
    };
  }

  private async buildUserContent(
    options: AgentRunOptions,
  ): Promise<string | ContentPart[]> {
    const ids = options.pendingAttachmentIds ?? [];
    const store = options.attachments;
    if (!store || ids.length === 0) return options.userMessage;

    const rows = [];
    for (const id of ids) {
      const row = await store.get(id);
      if (row) rows.push(row);
    }
    if (!rows.length) return options.userMessage;

    const inventory = formatAttachmentInventory(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        chars: r.text?.length || undefined,
        truncated: r.truncated,
      })),
    );

    const previews: string[] = [];
    for (const r of rows) {
      if (r.kind === "image" || !r.text) continue;
      const slice = r.text.slice(0, ATTACH_INLINE_PREVIEW);
      const truncated = r.text.length > ATTACH_INLINE_PREVIEW || r.truncated;
      const csvHint =
        r.kind === "csv" || /\.csv$/i.test(r.name)
          ? `\n⚠️ CSV preview only (${r.text.length} chars total). For ALL rows call parse_data({ attachmentId: "${r.id}", intent: "…" }) — do NOT paste this preview into text=.`
          : truncated
            ? `\n…(truncated; use read_attachment id=${r.id} or parse_data attachmentId)`
            : "";
      previews.push(`--- ${r.name} (id=${r.id}) preview ---\n${slice}${csvHint}`);
    }

    const textBlock = [
      options.userMessage.trim() || "Please analyze the attached files.",
      "",
      inventory,
      previews.length ? `\n${previews.join("\n\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const parts: ContentPart[] = [{ type: "text", text: textBlock }];
    for (const r of rows) {
      if (r.kind === "image" && r.dataUrl) {
        parts.push({
          type: "image_url",
          image_url: { url: r.dataUrl, detail: "auto" },
        });
      }
    }
    return parts.length > 1 ? parts : textBlock;
  }

  private async executeTool(
    call: ToolCall,
    args: Record<string, unknown>,
    emit: (e: AgentEvent) => void,
    workerModel: string,
    onUsage: (u: LlmUsage) => void,
    rag?: RagStore,
    connectors?: ConnectorRuntime,
    attachments?: AttachmentStore,
    views?: ViewStore,
    approvalMeta?: {
      approvalMode: ApprovalMode;
      approvalDecision: NonNullable<AgentEvent["approvalDecision"]>;
    },
    budgetMode: AgentBudgetMode = "normal",
    pageTemplates?: PageTemplateCache,
    runCtx?: RunContext,
    logUsage?: (input: Omit<UsageEvent, "id" | "at">) => Promise<void>,
  ): Promise<unknown> {
    const name = call.function.name;
    emit({ type: "tool_start", tool: name, args, toolCallId: call.id });

    const workerOnUsage = (u: LlmUsage) => {
      onUsage(u);
      void logUsage?.({
        kind: "llm",
        model: workerModel,
        provider: providerFromModel(workerModel),
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        estimatedCostUsd: u.estimatedCostUsd,
      });
    };

    try {
      let result: unknown;

      // Hard gate: skill-gated tools must be unlocked (or toolMode static).
      if (
        runCtx &&
        runCtx.toolMode === "skill_gated" &&
        isSkillGatedTool(name) &&
        !runCtx.activeToolNames.includes(name)
      ) {
        result = {
          ok: false,
          error: "tool_locked",
          hint: "Call skill_search then skill_read for a skill that unlocks this tool (e.g. combo-scrape).",
        };
        emit({
          type: "tool_result",
          tool: name,
          result,
          toolCallId: call.id,
          approvalMode: approvalMeta?.approvalMode,
          approvalDecision: approvalMeta?.approvalDecision ?? "n/a",
        });
        return result;
      }

      if (name === "list_tabs") {
        result = { tabs: await this.browser.listTabs() };
      } else if (name === "open_tab") {
        const url = String(args.url ?? "");
        const forceNew = args.newTab === true || args.forceNew === true;
        if (!forceNew) {
          // Default: same-tab navigate — models over-use open_tab and litter windows.
          const nav = await this.browser.navigate(url);
          result = {
            ok: nav.ok,
            url: nav.url,
            mode: "navigated",
            note: "Used navigate on the active tab. Pass newTab:true only when a parallel tab is required.",
          };
        } else {
          const opened = await this.browser.openTab(url, true);
          const keepOpen = args.keepOpen === true;
          if (!keepOpen && typeof opened.id === "number") {
            runCtx?.ephemeralTabIds.push(opened.id);
          }
          result = {
            ...opened,
            mode: "new_tab",
            keepOpen,
            note: keepOpen
              ? "Tab left open (keepOpen:true). Close with close_tab when done."
              : "Tab will auto-close at end of this turn.",
          };
        }
      } else if (name === "activate_tab") {
        result = await this.browser.activateTab(Number(args.tabId));
      } else if (name === "navigate") {
        result = await this.browser.navigate(String(args.url ?? ""));
      } else if (name === "go_back") {
        result = await this.browser.goBack();
      } else if (name === "close_tab") {
        result = await this.browser.closeTab(Number(args.tabId));
      } else if (name === "parse_data") {
        result = await this.parseData(args, workerModel, emit, workerOnUsage, attachments);
      } else if (name === "rag_status") {
        if (!rag) result = { ok: false, error: "rag store unavailable" };
        else {
          const meta = await rag.getMeta();
          const handle = await rag.getHandle();
          result = {
            ok: true,
            granted: Boolean(handle),
            folderName: meta?.folderName ?? handle?.folderName ?? null,
            fileCount: meta?.fileCount ?? 0,
            chunkCount: meta?.chunkCount ?? 0,
            indexedAt: meta?.indexedAt ?? null,
            lastError: meta?.lastError ?? null,
          };
        }
      } else if (name === "rag_search") {
        if (!rag) result = { ok: false, error: "rag store unavailable" };
        else {
          const meta = await rag.getMeta();
          if (!meta?.chunkCount) {
            result = {
              ok: false,
              error: "No local RAG index — grant a folder in Setup/Settings and wait for indexing",
            };
          } else {
            const query = String(args.query ?? "");
            const limit = typeof args.limit === "number" ? args.limit : 8;
            const hits = await rag.search(query, limit);
            result = {
              ok: true,
              hits: hits.map((h) => ({
                path: h.path,
                score: Number(h.score.toFixed(3)),
                snippet: h.content.slice(0, 500),
              })),
            };
          }
        }
      } else if (name === "rag_read_file") {
        if (!rag) result = { ok: false, error: "rag store unavailable" };
        else {
          const path = String(args.path ?? "");
          const maxChars = typeof args.maxChars === "number" ? args.maxChars : 12_000;
          const file = await rag.readPath(path, maxChars);
          result = file
            ? { ok: true, ...file }
            : { ok: false, error: `path not in index: ${path}` };
        }
      } else if (name === "list_attachments") {
        if (!attachments) result = { ok: false, error: "attachment store unavailable" };
        else {
          const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;
          const rows = await attachments.list(sessionId);
          result = {
            ok: true,
            attachments: rows.map((r) => ({
              id: r.id,
              name: r.name,
              kind: r.kind,
              mime: r.mime,
              size: r.size,
              chars: r.text?.length ?? 0,
              truncated: r.truncated,
              error: r.error ?? null,
              createdAt: r.createdAt,
            })),
          };
        }
      } else if (name === "read_attachment") {
        if (!attachments) result = { ok: false, error: "attachment store unavailable" };
        else {
          const id = String(args.id ?? args.name ?? "");
          const maxChars = typeof args.maxChars === "number" ? args.maxChars : 200_000;
          const file = await attachments.read(id, maxChars);
          result = file
            ? { ok: true, ...file }
            : { ok: false, error: `attachment not found: ${id}` };
        }
      } else if (name === "remember" || name === "save_memory") {
        const text = String(args.text ?? args.fact ?? "");
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
        const scopeRaw = String(args.scope ?? "global").toLowerCase();
        const scope = scopeRaw === "agent" ? ("agent" as const) : ("global" as const);
        const agentIdArg =
          typeof args.agentId === "string" && args.agentId.trim()
            ? args.agentId.trim()
            : runCtx?.agentId;
        try {
          const entry = await this.memory.remember({
            text,
            tags,
            kind: "note",
            scope,
            agentId: scope === "agent" ? agentIdArg : undefined,
          });
          result = {
            ok: true,
            saved: true,
            id: entry.id,
            scope: entry.scope,
            agentId: entry.agentId ?? null,
          };
        } catch (err) {
          result = {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      } else if (name === "recall") {
        const query = String(args.query ?? "");
        const limit = typeof args.limit === "number" ? args.limit : 5;
        result = {
          hits: await this.memory.recall(query, limit, { agentId: runCtx?.agentId }),
        };
      } else if (name === "memory_list") {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        result = {
          memories: await this.memory.listForInject({
            agentId: runCtx?.agentId,
            limit,
          }),
        };
      } else if (name === "skill_search") {
        if (!runCtx?.skills) result = { ok: false, error: "skills store unavailable" };
        else {
          const query = String(args.query ?? "");
          const limit = typeof args.limit === "number" ? args.limit : 8;
          const hits = await runCtx.skills.search(query, {
            agentId: runCtx.agentId,
            limit,
          });
          result = {
            ok: true,
            hits: hits.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              tags: s.tags,
              toolHints: s.toolHints ?? [],
              scope: s.scope,
              score: s.score,
            })),
          };
        }
      } else if (name === "skill_read") {
        if (!runCtx?.skills) result = { ok: false, error: "skills store unavailable" };
        else {
          const idArg = typeof args.id === "string" ? args.id.trim() : "";
          const nameArg = typeof args.name === "string" ? args.name.trim() : "";
          let skill: Skill | null = idArg ? await runCtx.skills.get(idArg) : null;
          // Models often pass seed names as id (index lists names, not UUIDs).
          if (!skill && idArg) {
            skill = await runCtx.skills.getByName(idArg, { agentId: runCtx.agentId });
          }
          if (!skill && nameArg) {
            skill = await runCtx.skills.getByName(nameArg, { agentId: runCtx.agentId });
            if (!skill) {
              const hits = await runCtx.skills.search(nameArg, {
                agentId: runCtx.agentId,
                limit: 5,
              });
              skill = hits.find((h) => h.name === nameArg) ?? hits[0] ?? null;
            }
          }
          if (!skill) result = { ok: false, error: "skill not found" };
          else {
            const ceiling = new Set(runCtx.enabledToolNames);
            const { active, unlocked } = unlockFromHints(
              runCtx.activeToolNames,
              skill.toolHints ?? [],
              ceiling,
            );
            runCtx.activeToolNames = active;
            runCtx.rebuildTools();
            emit({
              type: "tools_unlocked",
              skillId: skill.id,
              unlockedTools: unlocked,
              activeTools: active,
            });
            result = {
              ok: true,
              id: skill.id,
              name: skill.name,
              description: skill.description,
              body: skill.body,
              tags: skill.tags,
              toolHints: skill.toolHints ?? [],
              unlockedTools: unlocked,
              activeToolCount: active.length,
            };
          }
        }
      } else if (name === "skill_save") {
        if (!runCtx?.skills) result = { ok: false, error: "skills store unavailable" };
        else {
          try {
            const scopeRaw = String(args.scope ?? "global").toLowerCase();
            const scope = scopeRaw === "agent" ? ("agent" as const) : ("global" as const);
            const agentIdArg =
              typeof args.agentId === "string" && args.agentId.trim()
                ? args.agentId.trim()
                : runCtx.agentId;
            const saved = await runCtx.skills.save({
              id: typeof args.id === "string" ? args.id : undefined,
              name: String(args.name ?? ""),
              description: String(args.description ?? ""),
              body: String(args.body ?? ""),
              tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
              scope,
              agentId: scope === "agent" ? agentIdArg : undefined,
              toolHints: Array.isArray(args.toolHints) ? args.toolHints.map(String) : undefined,
            });
            result = { ok: true, skill: saved };
          } catch (err) {
            result = {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      } else if (name === "list_custom_tools") {
        if (!runCtx?.customTools) result = { ok: false, error: "custom tools store unavailable" };
        else {
          const rows = await runCtx.customTools.list();
          result = {
            ok: true,
            tools: rows.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              kind: t.kind,
            })),
          };
        }
      } else if (name === "custom_tool_save") {
        if (!runCtx?.customTools) result = { ok: false, error: "custom tools store unavailable" };
        else {
          try {
            let parameters: Record<string, unknown> | undefined;
            if (typeof args.parametersJson === "string" && args.parametersJson.trim()) {
              parameters = JSON.parse(args.parametersJson) as Record<string, unknown>;
            }
            const saved = await runCtx.customTools.save({
              id: typeof args.id === "string" ? args.id : undefined,
              name: String(args.name ?? ""),
              description: String(args.description ?? ""),
              parameters,
              kind: args.kind === "echo" ? "echo" : "guide",
              handlerNote:
                typeof args.handlerNote === "string" ? args.handlerNote : undefined,
            });
            runCtx.customToolMap.set(saved.name, saved);
            if (!runCtx.enabledToolNames.includes(saved.name)) {
              runCtx.enabledToolNames.push(saved.name);
            }
            if (!runCtx.activeToolNames.includes(saved.name)) {
              runCtx.activeToolNames.push(saved.name);
            }
            runCtx.rebuildTools();
            result = { ok: true, tool: saved };
          } catch (err) {
            result = {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      } else if (name === "export_csv") {
        const filename = String(args.filename ?? "export.csv");
        const rows = Array.isArray(args.rows) ? (args.rows as string[][]) : [];
        const csv = rowsToCsv(rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)])));
        result = await this.browser.downloadText(
          filename.endsWith(".csv") ? filename : `${filename}.csv`,
          csv,
          "text/csv",
        );
      } else if (name === "save_bookmark") {
        result = await this.artifacts.saveBookmark({
          url: String(args.url ?? ""),
          title: String(args.title ?? ""),
          note: args.note != null ? String(args.note) : undefined,
        });
      } else if (name === "set_reminder") {
        result = await this.artifacts.setReminder({
          text: String(args.text ?? ""),
          atIso: String(args.atIso ?? ""),
        });
      } else if (name === "create_report") {
        const title = String(args.title ?? "Report");
        let bodyHtml = String(args.bodyHtml ?? "");
        const attachIds = Array.isArray(args.attachmentIds)
          ? args.attachmentIds.map(String)
          : undefined;
        const emb = await embedAttachmentsInHtml(
          bodyHtml,
          (id) => this.resolveAttachmentDataUrl(id, runCtx),
          { attachmentIds: attachIds, maxHtmlChars: 2_000_000 },
        );
        bodyHtml = emb.html;
        const saved = await this.artifacts.saveReport({ title, bodyHtml });
        const html = buildReportHtml(title, bodyHtml);
        // Always surface in chat (download may still fail on huge payloads).
        emit({
          type: "preview",
          preview: {
            kind: "html",
            title,
            html,
            interactive: true,
          },
        });
        let download: { ok: boolean; error?: string } = { ok: true };
        try {
          download = await this.browser.downloadText(
            `${title.replace(/[^\w.-]+/g, "_").slice(0, 40)}.html`,
            html,
            "text/html",
          );
        } catch (e) {
          download = {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        result = {
          ...saved,
          download,
          embeddedAttachments: emb.embedded,
          missingAttachments: emb.missing.length ? emb.missing : undefined,
          hint: download.ok
            ? "Report downloaded + opened in chat preview. Use Open tab for fullscreen."
            : `Saved + opened in chat preview; download failed (${download.error ?? "unknown"}). Use Open tab.`,
        };
      } else if (name === "create_map_report") {
        result = await this.handleCreateMapReport(args, emit);
      } else if (name === "publish_upload") {
        result = await this.handlePublishUpload(args, connectors, runCtx);
      } else if (name === "search_sessions") {
        if (!this.sessions) {
          result = { hits: [], error: "session store not available" };
        } else {
          const query = String(args.query ?? "");
          const limit = typeof args.limit === "number" ? args.limit : 20;
          const hits = await this.sessions.search(query, limit);
          result = {
            query: query || null,
            mode: query.trim() ? "search" : "recent",
            hits: hits.map((s) => {
              const lastUser = [...s.messages].reverse().find((m) => m.role === "user");
              const lastAsst = [...s.messages].reverse().find((m) => m.role === "assistant");
              return {
                id: s.id,
                title: s.title,
                updatedAt: s.updatedAt,
                messageCount: s.messages.length,
                preview: (lastUser?.content || lastAsst?.content || "").slice(0, 200),
              };
            }),
          };
        }
      } else if (name === "get_session") {
        if (!this.sessions) {
          result = { error: "session store not available" };
        } else {
          const id = String(args.id ?? "");
          const maxMessages =
            typeof args.maxMessages === "number"
              ? Math.min(80, Math.max(1, Math.floor(args.maxMessages)))
              : 40;
          const s = await this.sessions.get(id);
          if (!s) {
            result = { error: "session not found", id };
          } else {
            const msgs = s.messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .slice(-maxMessages)
              .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content.slice(0, 12_000),
                createdAt: m.createdAt,
                toolNames: m.tools?.map((t) => t.name),
              }));
            result = {
              id: s.id,
              title: s.title,
              updatedAt: s.updatedAt,
              bookmarked: !!s.bookmarked,
              totalMessages: s.messages.length,
              returned: msgs.length,
              messages: msgs,
            };
          }
        }
      } else if (name === "save_view") {
        if (!views) result = { ok: false, error: "view store unavailable" };
        else {
          const nameArg = String(args.name ?? "Untitled view");
          const rawRows = Array.isArray(args.rows) ? args.rows : undefined;
          const rows = rawRows?.map((r) =>
            Array.isArray(r) ? r.map(String) : [String(r)],
          );
          const saved = await views.save({
            name: nameArg,
            source: "snapshot",
            rows,
            columns: Array.isArray(args.columns) ? args.columns.map(String) : undefined,
            filter: typeof args.filter === "string" ? args.filter : undefined,
            note: typeof args.note === "string" ? args.note : undefined,
            chart:
              args.chart && typeof args.chart === "object"
                ? (args.chart as ViewChartSpec)
                : undefined,
          });
          if (runCtx?.changeLog) {
            const n = Math.max(0, (saved.rows?.length ?? 1) - 1);
            void runCtx.changeLog.append({
              viewId: saved.id,
              viewName: saved.name,
              op: "replace",
              added: n,
              updated: 0,
              removed: 0,
              sourceTool: "save_view",
              sessionId: runCtx.sessionId,
            });
          }
          result = {
            ok: true,
            id: saved.id,
            name: saved.name,
            rowCount: saved.rows?.length ?? 0,
          };
        }
      } else if (name === "list_views") {
        if (!views) result = { ok: false, error: "view store unavailable" };
        else {
          const list = await views.list();
          result = {
            ok: true,
            views: list.map((v) => ({
              id: v.id,
              name: v.name,
              source: v.source,
              rowCount: v.rows?.length ?? 0,
              updatedAt: v.updatedAt,
            })),
          };
        }
      } else if (name === "get_view") {
        if (!views) result = { ok: false, error: "view store unavailable" };
        else {
          const id = String(args.id ?? args.name ?? "");
          const v = await views.get(id);
          result = v
            ? {
                ok: true,
                id: v.id,
                name: v.name,
                source: v.source,
                note: v.note,
                rows: v.rows?.slice(0, 200),
                truncated: (v.rows?.length ?? 0) > 200,
              }
            : { ok: false, error: `view not found: ${id}` };
        }
      } else if (name === "save_site_profile") {
        result = await this.saveSiteProfile(args);
      } else if (name === "get_site_profile") {
        result = await this.getSiteProfile(args);
      } else if (name === "login") {
        result = await this.loginWithProfile(args, emit);
      } else if (name === "scrape_catalog") {
        result = await this.scrapeCatalog(args, workerModel, emit, workerOnUsage);
      } else if (name === "ensure_scrape_table") {
        if (!views) result = { ok: false, error: "view store unavailable" };
        else {
          const columns = Array.isArray(args.columns) ? args.columns.map(String) : [];
          const keyColumns = Array.isArray(args.keyColumns)
            ? args.keyColumns.map(String)
            : columns.slice(0, 1);
          const view = await ensureView(views, {
            name: String(args.name ?? "scrape"),
            columns,
            keyColumns,
          });
          result = {
            ok: true,
            id: view.id,
            name: view.name,
            columns,
            keyColumns,
            rowCount: Math.max(0, (view.rows?.length ?? 1) - 1),
          };
        }
      } else if (name === "upsert_scrape_rows") {
        if (!views) result = { ok: false, error: "view store unavailable" };
        else {
          const viewId = String(args.viewId ?? "");
          const rows = Array.isArray(args.rows)
            ? (args.rows as unknown[]).map((r) =>
                Array.isArray(r) ? r.map((c) => String(c ?? "")) : [String(r)],
              )
            : [];
          let keyColumns = Array.isArray(args.keyColumns) ? args.keyColumns.map(String) : [];
          const existing = await views.get(viewId);
          if (!existing) result = { ok: false, error: `view not found: ${viewId}` };
          else {
            if (!keyColumns.length) {
              const note = existing.note ?? "";
              const m = note.match(/keyColumns:([^|]+)/);
              keyColumns = m
                ? m[1]!.split(",").map((s) => s.trim()).filter(Boolean)
                : (existing.rows?.[0] ?? existing.columns ?? []).slice(0, 1);
            }
            const { view: saved, delta } = await upsertRows(
              views,
              existing.id,
              rows,
              keyColumns,
            );
            if (runCtx?.changeLog) {
              void runCtx.changeLog.append({
                viewId: saved.id,
                viewName: saved.name,
                op: delta.op,
                added: delta.added,
                updated: delta.updated,
                removed: delta.removed,
                sampleKeys: delta.sampleKeys,
                sourceTool: "upsert_scrape_rows",
                sessionId: runCtx.sessionId,
              });
            }
            result = {
              ok: true,
              id: saved.id,
              name: saved.name,
              rowCount: Math.max(0, (saved.rows?.length ?? 1) - 1),
              delta,
            };
          }
        }
      } else if (name === "get_scrape_table") {
        if (!views) result = { ok: false, error: "view store unavailable" };
        else {
          const v = await views.get(String(args.viewId ?? ""));
          const limit = clampInt(args.limit, 200, 1, 500);
          result = v
            ? {
                ok: true,
                id: v.id,
                name: v.name,
                rows: v.rows?.slice(0, limit + 1),
                rowCount: Math.max(0, (v.rows?.length ?? 1) - 1),
              }
            : { ok: false, error: "view not found" };
        }
      } else if (name === "scrape_pdps") {
        result = await this.scrapePdps(args, views, pageTemplates, emit, runCtx);
      } else if (name === "rest_request") {
        result = await this.runRestRequest(args, connectors);
      } else if (name === "mcp_list_tools") {
        result = await this.runMcpList(args, connectors);
      } else if (name === "mcp_call") {
        result = await this.runMcpCall(args, connectors);
      } else if (name === "ux_critique") {
        result = await this.handleUxCritique(args, runCtx, emit);
      } else if (name === "open_preview") {
        result = await this.handleOpenPreview(args, runCtx, emit);
      } else if (name === "annotate_screenshot") {
        result = await this.handleAnnotateScreenshot(args, runCtx, emit);
      } else if (name === "screenshot_viewport") {
        if (!this.browser.captureViewport) result = { ok: false, error: "capture unavailable" };
        else {
          const shot = await this.browser.captureViewport(
            typeof args.windowId === "number" ? args.windowId : undefined,
          );
          result = await this.finalizeScreenshotCapture(shot, "viewport", runCtx, emit);
        }
      } else if (name === "screenshot_element") {
        if (!this.browser.captureElement) result = { ok: false, error: "capture unavailable" };
        else {
          const tabs = await this.browser.listTabs();
          const tabId =
            typeof args.tabId === "number" ? args.tabId : (tabs[0]?.id ?? 0);
          const shot = await this.browser.captureElement(tabId, {
            selector: typeof args.selector === "string" ? args.selector : undefined,
            index: typeof args.index === "number" ? args.index : undefined,
          });
          result = await this.finalizeScreenshotCapture(shot, "element", runCtx, emit);
        }
      } else if (name === "screenshot_full") {
        if (!this.browser.captureFullPage) result = { ok: false, error: "capture unavailable" };
        else {
          const tabs = await this.browser.listTabs();
          const tabId =
            typeof args.tabId === "number" ? args.tabId : (tabs[0]?.id ?? 0);
          const shot = await this.browser.captureFullPage(tabId);
          result = await this.finalizeScreenshotCapture(shot, "full", runCtx, emit);
        }
      } else if (name === "start_recording") {
        if (!this.browser.startRecording) result = { ok: false, error: "recording unavailable" };
        else {
          const tabs = await this.browser.listTabs();
          const tabId =
            typeof args.tabId === "number" ? args.tabId : (tabs[0]?.id ?? 0);
          result = await this.browser.startRecording(tabId);
        }
      } else if (name === "stop_recording") {
        if (!this.browser.stopRecording) result = { ok: false, error: "recording unavailable" };
        else
          result = await this.browser.stopRecording({
            download: args.download !== false,
            filename: typeof args.filename === "string" ? args.filename : undefined,
          });
      } else if (name === "create_agent") {
        if (runCtx?.resolvedProfile && !runCtx.resolvedProfile.canSelfEdit) {
          result = { ok: false, error: "canSelfEdit is false on active profile" };
        } else {
          result = await this.createAgent(args, runCtx, workerModel);
        }
      } else if (name === "update_agent") {
        if (runCtx?.resolvedProfile && !runCtx.resolvedProfile.canSelfEdit) {
          result = { ok: false, error: "canSelfEdit is false on active profile" };
        } else {
          result = await this.updateAgent(args, runCtx);
        }
      } else if (name === "list_agents") {
        result = await this.listAgents(runCtx);
      } else if (name === "spawn_subagent") {
        result = await this.spawnSubagent(args, runCtx);
      } else if (name === "create_task") {
        result = await this.createTask(args, runCtx);
      } else if (name === "update_task") {
        result = await this.updateTask(args, runCtx);
      } else if (name === "list_tasks") {
        result = await this.listTasks(args, runCtx);
      } else if (name === "reorder_tasks") {
        result = await this.reorderTasks(args, runCtx);
      } else if (
        name === "create_page_extension" ||
        name === "update_page_extension" ||
        name === "list_page_extensions" ||
        name === "get_page_extension" ||
        name === "approve_page_extension" ||
        name === "revoke_page_extension" ||
        name === "inject_page_extension" ||
        name === "set_page_extension_bridge" ||
        name === "page_ext_data_list" ||
        name === "page_ext_data_get" ||
        name === "page_ext_data_clear" ||
        name === "list_page_extension_audit"
      ) {
        result = await this.handlePageExtensionTool(name, args, runCtx);
      } else if (runCtx?.customToolMap.has(name)) {
        result = runCustomTool(runCtx.customToolMap.get(name)!, args);
      } else {
        let toolName = name;
        let toolArgs = args;
        if (name === "get_page") {
          if (preferPageDigest(budgetMode, name, args)) {
            toolName = "page_digest";
            toolArgs = {};
          } else {
            const rewritten = rewriteGetPageArgs(budgetMode, args);
            if ("error" in rewritten) {
              result = { ok: false, error: rewritten.error };
              emit({
                type: "tool_result",
                tool: name,
                args,
                result,
                toolCallId: call.id,
                approvalMode: approvalMeta?.approvalMode,
                approvalDecision: approvalMeta?.approvalDecision,
              });
              return result;
            }
            toolArgs = rewritten;
          }
        }
        const req = toolArgsToContentRequest(toolName, toolArgs);
        if (!req) {
          result = { ok: false, error: `invalid args for ${toolName}` };
        } else {
          result = await this.browser.runContent(req);
          if (
            pageTemplates &&
            result &&
            typeof result === "object" &&
            (result as { ok?: boolean }).ok &&
            (toolName === "page_digest" ||
              (toolName === "get_page" && toolArgs.mode === "structure"))
          ) {
            const data = (result as { data?: unknown }).data;
            if (data && typeof data === "object") {
              (result as { data: unknown }).data = pageTemplates.annotate(
                data as Record<string, unknown>,
              );
            }
          }
        }
      }

      emit({
        type: "tool_result",
        tool: name,
        args,
        result,
        toolCallId: call.id,
        approvalMode: approvalMeta?.approvalMode,
        approvalDecision: approvalMeta?.approvalDecision,
      });
      await logUsage?.({ kind: "tool", tool: name });
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const result = { ok: false, error: msg };
      emit({
        type: "tool_result",
        tool: name,
        args,
        result,
        toolCallId: call.id,
        approvalMode: approvalMeta?.approvalMode,
        approvalDecision: approvalMeta?.approvalDecision,
      });
      await logUsage?.({ kind: "tool", tool: name });
      return result;
    }
  }

  private async createAgent(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
    workerModel: string,
  ): Promise<unknown> {
    if (!runCtx?.agents) return { ok: false, error: "agent store unavailable" };
    const name = String(args.name ?? "");
    if (!name.trim()) return { ok: false, error: "name required" };

    const goal = strOpt(args.goal);
    const canDelegate = args.canDelegate !== false;
    const canSelfEdit = args.canSelfEdit !== false;
    const pickModel = strOpt(args.workerModel) ?? workerModel;

    const hasSkills = Boolean(runCtx?.skills);
    // Default off when skills exist — lean skill_gated; keep auto-pick for static/expensive orch.
    const autoPick =
      typeof args.autoPickTools === "boolean" ? args.autoPickTools : !hasSkills && Boolean(goal);
    const toolModeArg =
      args.toolMode === "static" || args.toolMode === "skill_gated"
        ? args.toolMode
        : autoPick
          ? ("static" as const)
          : ("skill_gated" as const);

    let pickedTools: string[] = AGENT_TOOLS.map((t) => t.function.name);
    if (autoPick && goal) {
      const picked = await pickToolsForGoal(this.llm, pickModel, goal, TOOL_CATALOG);
      pickedTools = picked.tools;
    }

    const toolAllowlist =
      toolModeArg === "skill_gated" && !autoPick
        ? ("all" as const)
        : mergeToolNames(pickedTools, metaToolsForAgent(canDelegate, canSelfEdit));

    const profile: AgentProfile = {
      id: crypto.randomUUID(),
      name: name.trim(),
      systemPrompt: strOpt(args.systemPrompt),
      orchestratorModel: strOpt(args.orchestratorModel),
      workerModel: strOpt(args.workerModel),
      toolAllowlist,
      toolMode: toolModeArg,
      connectorIds: [],
      budgetMode:
        args.budgetMode === "budget" || args.budgetMode === "normal"
          ? args.budgetMode
          : undefined,
      maxSteps: typeof args.maxSteps === "number" ? args.maxSteps : undefined,
      canDelegate: typeof args.canDelegate === "boolean" ? args.canDelegate : undefined,
      canSelfEdit: typeof args.canSelfEdit === "boolean" ? args.canSelfEdit : undefined,
      createdAt: "",
      updatedAt: "",
    };

    const saved = await runCtx.agents.put(profile);
    return { ok: true, agent: resolveAgentProfile(saved) };
  }

  private async updateAgent(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
  ): Promise<unknown> {
    if (!runCtx?.agents) return { ok: false, error: "agent store unavailable" };
    const agentId = String(args.agentId ?? "");
    if (!agentId) return { ok: false, error: "agentId required" };

    const existing = await runCtx.agents.get(agentId);
    if (!existing) return { ok: false, error: `agent not found: ${agentId}` };

    const updated: AgentProfile = {
      ...existing,
      name: typeof args.name === "string" ? args.name : existing.name,
      systemPrompt:
        typeof args.systemPrompt === "string" ? args.systemPrompt : existing.systemPrompt,
      orchestratorModel:
        typeof args.orchestratorModel === "string"
          ? args.orchestratorModel
          : existing.orchestratorModel,
      workerModel:
        typeof args.workerModel === "string" ? args.workerModel : existing.workerModel,
      toolAllowlist: Array.isArray(args.toolAllowlist)
        ? args.toolAllowlist.map(String)
        : existing.toolAllowlist,
      connectorIds: Array.isArray(args.connectorIds)
        ? args.connectorIds.map(String)
        : existing.connectorIds,
      budgetMode:
        args.budgetMode === "budget" || args.budgetMode === "normal"
          ? args.budgetMode
          : existing.budgetMode,
      approvalMode:
        args.approvalMode === "ask" ||
        args.approvalMode === "auto_llm" ||
        args.approvalMode === "auto_all"
          ? args.approvalMode
          : existing.approvalMode,
      maxSteps: typeof args.maxSteps === "number" ? args.maxSteps : existing.maxSteps,
      canDelegate:
        typeof args.canDelegate === "boolean" ? args.canDelegate : existing.canDelegate,
      canSelfEdit:
        typeof args.canSelfEdit === "boolean" ? args.canSelfEdit : existing.canSelfEdit,
      nestingDepth:
        typeof args.nestingDepth === "number" ? args.nestingDepth : existing.nestingDepth,
      ragEnabled: typeof args.ragEnabled === "boolean" ? args.ragEnabled : existing.ragEnabled,
      toolMode:
        args.toolMode === "static" || args.toolMode === "skill_gated"
          ? args.toolMode
          : existing.toolMode,
    };

    const saved = await runCtx.agents.put(updated);
    return { ok: true, agent: resolveAgentProfile(saved) };
  }

  private async listAgents(runCtx: RunContext | undefined): Promise<unknown> {
    if (!runCtx?.agents) return { ok: false, error: "agent store unavailable" };
    const agents = await runCtx.agents.list();
    return {
      ok: true,
      agents: agents.map((a) => {
        const resolved = resolveAgentProfile(a);
        const toolCount =
          a.toolAllowlist === "all" ? AGENT_TOOLS.length : a.toolAllowlist.length;
        return {
          id: a.id,
          name: a.name,
          orchestratorModel: a.orchestratorModel,
          workerModel: a.workerModel,
          toolCount,
          maxSteps: resolved.maxSteps,
          canDelegate: resolved.canDelegate,
          canSelfEdit: resolved.canSelfEdit,
          updatedAt: a.updatedAt,
        };
      }),
    };
  }

  private async createTask(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
  ): Promise<unknown> {
    if (!runCtx?.tasks) return { ok: false, error: "task store unavailable" };
    const title = String(args.title ?? "");
    if (!title.trim()) return { ok: false, error: "title required" };

    const status =
      args.status === "todo" ||
      args.status === "doing" ||
      args.status === "done" ||
      args.status === "blocked"
        ? args.status
        : "todo";

    const sessionId =
      typeof args.sessionId === "string" ? args.sessionId : (runCtx.sessionId ?? null);
    const sortOrder =
      typeof args.sortOrder === "number" && Number.isFinite(args.sortOrder)
        ? args.sortOrder
        : undefined;

    const task = await runCtx.tasks.put({
      id: crypto.randomUUID(),
      title: title.trim(),
      status,
      sessionId,
      agentId: runCtx.agentId,
      note: typeof args.note === "string" ? args.note : undefined,
      planMarkdown: typeof args.planMarkdown === "string" ? args.planMarkdown : undefined,
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    });
    return { ok: true, task };
  }

  private async updateTask(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
  ): Promise<unknown> {
    if (!runCtx?.tasks) return { ok: false, error: "task store unavailable" };
    const id = String(args.id ?? "");
    if (!id) return { ok: false, error: "id required" };

    const existing = (await runCtx.tasks.list()).find((t) => t.id === id);
    if (!existing) return { ok: false, error: `task not found: ${id}` };

    const status =
      args.status === "todo" ||
      args.status === "doing" ||
      args.status === "done" ||
      args.status === "blocked"
        ? args.status
        : existing.status;

    const sortOrder =
      typeof args.sortOrder === "number" && Number.isFinite(args.sortOrder)
        ? args.sortOrder
        : existing.sortOrder;

    const task = await runCtx.tasks.put({
      ...existing,
      status,
      sortOrder,
      title: typeof args.title === "string" ? args.title : existing.title,
      note: typeof args.note === "string" ? args.note : existing.note,
      planMarkdown:
        typeof args.planMarkdown === "string" ? args.planMarkdown : existing.planMarkdown,
    });
    return { ok: true, task };
  }

  private async listTasks(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
  ): Promise<unknown> {
    if (!runCtx?.tasks) return { ok: false, error: "task store unavailable" };
    const status =
      args.status === "todo" ||
      args.status === "doing" ||
      args.status === "done" ||
      args.status === "blocked"
        ? args.status
        : undefined;
    const tasks = await runCtx.tasks.list({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : runCtx.sessionId,
      globalOnly: Boolean(args.globalOnly),
      status,
    });
    return { ok: true, tasks };
  }

  private async reorderTasks(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
  ): Promise<unknown> {
    if (!runCtx?.tasks) return { ok: false, error: "task store unavailable" };
    const raw = args.orderedIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { ok: false, error: "orderedIds required (non-empty string[])" };
    }
    const orderedIds = raw.map((x) => String(x)).filter(Boolean);
    const tasks = await runCtx.tasks.reorder(orderedIds);
    return { ok: true, tasks, count: tasks.length };
  }

  private async spawnSubagent(
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
  ): Promise<unknown> {
    if (!runCtx) return { ok: false, error: "run context unavailable" };

    const profile = runCtx.resolvedProfile;
    if (profile && !profile.canDelegate) {
      return { ok: false, error: "delegation not allowed for this agent" };
    }

    const maxNesting = profile?.nestingDepth ?? 1;
    if (runCtx.nestingDepth >= maxNesting) {
      return { ok: false, error: "nesting limit" };
    }

    const goal = String(args.goal ?? "");
    if (!goal.trim()) return { ok: false, error: "goal required" };

    const subagentId = crypto.randomUUID();
    runCtx.onSubagent?.({ type: "start", subagentId, goal });

    let childEnabled: string[] | undefined = Array.isArray(args.tools)
      ? args.tools.map(String)
      : undefined;
    let childAgentId = strOpt(args.agentId);
    let childModel = runCtx.model;
    let childWorker = runCtx.workerModel;
    let childBudget: AgentBudgetMode =
      args.budgetMode === "budget" || args.budgetMode === "normal"
        ? args.budgetMode
        : runCtx.budgetMode;
    let childMaxSteps = typeof args.maxSteps === "number" ? args.maxSteps : 16;
    let childSystem = runCtx.systemPrompt;

    if (childAgentId && runCtx.agents) {
      const childProfile = await runCtx.agents.get(childAgentId);
      if (childProfile) {
        const resolved = resolveAgentProfile(childProfile);
        childModel = resolved.orchestratorModel ?? childModel;
        childWorker = resolved.workerModel ?? childWorker;
        childBudget = resolved.budgetMode ?? childBudget;
        childMaxSteps = typeof args.maxSteps === "number" ? args.maxSteps : resolved.maxSteps;
        childSystem = resolved.systemPrompt ?? childSystem;
        if (!childEnabled) {
          childEnabled =
            resolved.toolAllowlist === "all"
              ? runCtx.enabledToolNames
              : [...resolved.toolAllowlist];
        }
      }
    }

    if (!childEnabled) {
      childEnabled = [...runCtx.enabledToolNames];
    }
    childEnabled = childEnabled.filter((n) => n !== "spawn_subagent");

    const childLoop = new AgentLoop(
      this.llm,
      this.browser,
      this.memory,
      this.sessions,
      this.profiles,
    );

    try {
      const childResult = await childLoop.run({
        model: childModel,
        workerModel: childWorker,
        userMessage: goal,
        maxSteps: childMaxSteps,
        budgetMode: childBudget,
        enabledTools: childEnabled,
        toolMode: runCtx.toolMode,
        skills: runCtx.skills,
        customTools: runCtx.customTools,
        nestingDepth: runCtx.nestingDepth + 1,
        agents: runCtx.agents,
        tasks: runCtx.tasks,
        usageLog: runCtx.usageLog,
        pageExtensions: runCtx.pageExtensions,
        sessionId: runCtx.sessionId,
        runId: subagentId,
        agentId: childAgentId,
        signal: runCtx.signal,
        rag: runCtx.rag,
        connectors: runCtx.connectors,
        views: runCtx.views,
        approvalMode: runCtx.approvalMode,
        getApprovalMode: runCtx.getApprovalMode,
        systemPrompt: childSystem,
        onSubagent: runCtx.onSubagent,
        onEvent: (e) => {
          if (e.type === "assistant_delta" && e.message) {
            runCtx.onSubagent?.({
              type: "delta",
              subagentId,
              goal,
              summary: e.message,
            });
          }
          if (e.type === "error" && e.message) {
            runCtx.onSubagent?.({
              type: "error",
              subagentId,
              goal,
              summary: e.message,
            });
          }
        },
      });

      runCtx.onSubagent?.({
        type: "done",
        subagentId,
        goal,
        summary: childResult.finalText,
        messages: childResult.messages,
        usage: childResult.usage,
      });

      return {
        ok: !childResult.aborted && !childResult.hitStepLimit,
        summary: childResult.finalText,
        steps: childResult.steps,
        usage: childResult.usage,
        subagentId,
        error: childResult.hitStepLimit
          ? "hit_step_limit"
          : childResult.aborted
            ? "aborted"
            : undefined,
        artifacts: [] as unknown[],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      runCtx.onSubagent?.({
        type: "error",
        subagentId,
        goal,
        summary: msg,
      });
      return { ok: false, error: msg, summary: msg, subagentId, artifacts: [] };
    }
  }

  private async handlePageExtensionTool(
    name: string,
    args: Record<string, unknown>,
    runCtx: RunContext | undefined,
  ): Promise<unknown> {
    const store = runCtx?.pageExtensions;
    if (!store) return { ok: false, error: "page extension store unavailable" };
    const sessionId = runCtx?.sessionId;
    try {
      if (name === "create_page_extension") {
        const patterns = Array.isArray(args.patterns)
          ? args.patterns.map(String)
          : typeof args.pattern === "string"
            ? [args.pattern]
            : [];
        const row = await store.create({
          name: String(args.name ?? "Untitled"),
          source: String(args.source ?? ""),
          patterns,
          description: typeof args.description === "string" ? args.description : undefined,
          runAt:
            args.runAt === "document_start" || args.runAt === "document_end"
              ? args.runAt
              : "document_idle",
          createdBy: "agent",
          sessionId,
          enabled: false,
        });
        return {
          ok: true,
          id: row.id,
          approval: row.approval,
          version: row.version,
          sourceHash: row.sourceHash,
          note: "Created as draft — call approve_page_extension then enable (update enabled:true) then inject",
        };
      }
      if (name === "update_page_extension") {
        const id = String(args.id ?? "");
        if (!id) return { ok: false, error: "id required" };
        const row = await store.update(
          id,
          {
            name: typeof args.name === "string" ? args.name : undefined,
            description: typeof args.description === "string" ? args.description : undefined,
            source: typeof args.source === "string" ? args.source : undefined,
            patterns: Array.isArray(args.patterns) ? args.patterns.map(String) : undefined,
            runAt:
              args.runAt === "document_start" ||
              args.runAt === "document_end" ||
              args.runAt === "document_idle"
                ? args.runAt
                : undefined,
            enabled: typeof args.enabled === "boolean" ? args.enabled : undefined,
          },
          { actor: "agent", sessionId },
        );
        return {
          ok: true,
          id: row.id,
          approval: row.approval,
          version: row.version,
          enabled: row.enabled,
          sourceHash: row.sourceHash,
        };
      }
      if (name === "list_page_extensions") {
        const list = await store.list();
        return {
          ok: true,
          extensions: list.map((e) => ({
            id: e.id,
            name: e.name,
            enabled: e.enabled,
            approval: e.approval,
            version: e.version,
            patterns: e.match.patterns,
            bridge: e.bridge
              ? {
                  exportChannels: e.bridge.exportChannels,
                  allowStorage: !!e.bridge.allowStorage,
                }
              : null,
            lastInjectedAt: e.lastInjectedAt,
            lastInjectedUrl: e.lastInjectedUrl,
          })),
        };
      }
      if (name === "get_page_extension") {
        const id = String(args.id ?? "");
        const row = await store.get(id);
        if (!row) return { ok: false, error: "not found" };
        return { ok: true, extension: row };
      }
      if (name === "approve_page_extension") {
        // Human-only: MAIN-world JS install must be confirmed in Page ext UI (actor=user).
        return {
          ok: false,
          error:
            "approve_page_extension is user-only — open the Page ext tab and click Approve (shows source hash).",
        };
      }
      if (name === "revoke_page_extension") {
        const row = await store.revoke(String(args.id ?? ""), "agent", sessionId);
        return { ok: true, id: row.id, approval: row.approval, enabled: row.enabled };
      }
      if (name === "set_page_extension_bridge") {
        const id = String(args.id ?? "");
        if (args.clear === true || args.bridge === null) {
          const row = await store.setBridge(id, null, { actor: "agent", sessionId });
          return { ok: true, id: row.id, bridge: null };
        }
        const channels = Array.isArray(args.exportChannels)
          ? args.exportChannels.map(String)
          : [];
        const row = await store.setBridge(
          id,
          {
            exportChannels: channels,
            allowStorage: Boolean(args.allowStorage),
            maxPayloadBytes:
              typeof args.maxPayloadBytes === "number" ? args.maxPayloadBytes : 64_000,
          },
          { actor: "agent", sessionId },
        );
        return { ok: true, id: row.id, bridge: row.bridge };
      }
      if (name === "inject_page_extension") {
        if (!this.browser.injectPageExtensions) {
          return { ok: false, error: "injectPageExtensions unavailable" };
        }
        const scriptIds = Array.isArray(args.ids)
          ? args.ids.map(String)
          : typeof args.id === "string"
            ? [args.id]
            : undefined;
        const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
        return this.browser.injectPageExtensions({ tabId, scriptIds });
      }
      if (name === "page_ext_data_list") {
        const id = String(args.id ?? "");
        return { ok: true, keys: await store.dataList(id) };
      }
      if (name === "page_ext_data_get") {
        const id = String(args.id ?? "");
        const key = String(args.key ?? "");
        if (args.all === true) return { ok: true, data: await store.dataGetAll(id) };
        return { ok: true, key, value: await store.dataGet(id, key) };
      }
      if (name === "page_ext_data_clear") {
        const n = await store.dataClear(String(args.id ?? ""), sessionId);
        return { ok: true, cleared: n };
      }
      if (name === "list_page_extension_audit") {
        const id = typeof args.id === "string" ? args.id : undefined;
        const limit = typeof args.limit === "number" ? args.limit : 50;
        return { ok: true, entries: await store.listAudit(id, limit) };
      }
      return { ok: false, error: `unknown page extension tool ${name}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async parseData(
    args: Record<string, unknown>,
    workerModel: string,
    emit: (e: AgentEvent) => void,
    onUsage: (u: LlmUsage) => void,
    attachments?: AttachmentStore,
  ): Promise<unknown> {
    const intent = String(args.intent ?? "");
    const schemaHint = args.schema_hint != null ? String(args.schema_hint) : "";
    let text = typeof args.text === "string" ? args.text : "";
    let pageSource:
      | "text"
      | "attachment"
      | "page_digest"
      | "get_page" = text.trim() ? "text" : "text";
    const attachmentId =
      typeof args.attachmentId === "string"
        ? args.attachmentId.trim()
        : typeof args.attachment_id === "string"
          ? args.attachment_id.trim()
          : "";

    if (attachmentId) {
      if (!attachments) {
        return { ok: false, error: "attachments store unavailable" };
      }
      // Full file (ATTACH_MAX_TEXT) — never the 4k chat preview.
      const file = await attachments.read(attachmentId, 200_000);
      if (!file) return { ok: false, error: `attachment not found: ${attachmentId}` };
      text = file.content;
      pageSource = "attachment";
      if (file.truncated) {
        emit({
          type: "status",
          message: `Attachment truncated at ${text.length} chars — parse may be incomplete`,
        });
      }
    } else if (args.use_page || !text.trim()) {
      const digest = await this.browser.runContent({ op: "page_digest" });
      if (digest.ok && digest.data) {
        pageSource = "page_digest";
        text = JSON.stringify(digest.data).slice(0, 10_000);
      } else {
        const page = await this.browser.runContent({
          op: "get_page",
          mode: "snippet",
          maxChars: 4_000,
        });
        pageSource = "get_page";
        const data = page.data as { text?: string; title?: string; url?: string } | undefined;
        text = [data?.title, data?.url, data?.text].filter(Boolean).join("\n").slice(0, 10_000);
      }
    }

    if (!text.trim()) {
      return {
        ok: false,
        error: "no text to parse",
        meta: { workerModel, source: pageSource, inputChars: 0, fallback: true },
      };
    }

    // Deterministic path: order CSVs with position/{name,index} — LLM truncates long lists.
    const { extractProductsFromOrderCsv, wantsProductListFromCsv } = await import(
      "../local/csvProducts.js"
    );
    const looksCsv =
      pageSource === "attachment" ||
      (text.includes("\n") &&
        text.includes(",") &&
        /position|index|sap/i.test(text.slice(0, 800)));
    if (looksCsv && wantsProductListFromCsv(intent)) {
      const extracted = extractProductsFromOrderCsv(text);
      if (extracted.rows.length > 0) {
        emit({
          type: "status",
          message: `CSV products: ${extracted.rows.length} rows (deterministic)`,
        });
        return {
          ok: true,
          model: "deterministic/csv",
          data: { rows: extracted.rows, notes: extracted.notes },
          meta: {
            workerModel: "deterministic/csv",
            source: pageSource,
            inputChars: text.length,
            fallback: false,
            notes: extracted.notes,
            count: extracted.rows.length,
          },
        };
      }
    }

    emit({ type: "status", message: `Worker parse (${workerModel})…` });
    const maxTokens = Math.min(16_384, Math.max(4096, Math.ceil(text.length / 4)));
    const result = await this.llm.chat({
      model: workerModel,
      messages: [
        { role: "system", content: PARSE_SYSTEM },
        {
          role: "user",
          content: `Intent: ${intent}\nSchema hint: ${schemaHint || "(infer reasonable columns)"}\n\n--- PAGE TEXT ---\n${text}`,
        },
      ],
      temperature: 0.1,
      maxTokens,
    });
    onUsage(result.usage);
    emit({ type: "usage", usage: result.usage, usageSource: "worker" });
    const parsed = parseJsonLoose(result.content ?? "{}") as {
      rows?: unknown;
      notes?: string;
    };
    const failed =
      parsed &&
      typeof parsed === "object" &&
      "notes" in parsed &&
      String(parsed.notes).includes("parse_failed");
    return {
      ok: !failed,
      model: workerModel,
      data: parsed,
      meta: {
        workerModel,
        source: pageSource,
        inputChars: text.length,
        fallback: failed === true,
        notes: typeof parsed?.notes === "string" ? parsed.notes : undefined,
      },
    };
  }

  private async saveSiteProfile(args: Record<string, unknown>): Promise<unknown> {
    if (!this.profiles) return { ok: false, error: "profile store not available" };
    const profile: SiteProfile = {
      name: String(args.name ?? ""),
      loginUrl: strOpt(args.loginUrl),
      username: strOpt(args.username),
      password: strOpt(args.password),
      usernameSelector: strOpt(args.usernameSelector),
      passwordSelector: strOpt(args.passwordSelector),
      submitSelector: strOpt(args.submitSelector),
      selector: strOpt(args.selector),
      nextSelector: strOpt(args.nextSelector),
      nextText: strOpt(args.nextText),
      intent: strOpt(args.intent),
      schemaHint: strOpt(args.schemaHint ?? args.schema_hint),
    };
    if (!profile.name) return { ok: false, error: "profile name required" };
    await this.profiles.save(profile);
    return { ok: true, saved: true, name: profile.name };
  }

  private async getSiteProfile(args: Record<string, unknown>): Promise<unknown> {
    if (!this.profiles) return { ok: false, error: "profile store not available" };
    const name = String(args.name ?? "");
    if (!name) return { ok: false, error: "profile name required" };
    const profile = await this.profiles.get(name);
    if (!profile) return { ok: false, error: `no profile '${name}'` };
    return { ok: true, profile };
  }

  private async loginWithProfile(
    args: Record<string, unknown>,
    emit: (e: AgentEvent) => void,
  ): Promise<unknown> {
    if (!this.profiles) return { ok: false, error: "profile store not available" };
    const profileName = strOpt(args.profile);
    let profile: SiteProfile | null = null;
    if (profileName) profile = await this.profiles.get(profileName);
    // inline overrides win
    const username = strOpt(args.username) ?? profile?.username ?? "";
    const password = strOpt(args.password) ?? profile?.password ?? "";
    const uSel = strOpt(args.usernameSelector) ?? profile?.usernameSelector ?? "";
    const pSel = strOpt(args.passwordSelector) ?? profile?.passwordSelector ?? "";
    const submit = strOpt(args.submitSelector) ?? profile?.submitSelector ?? "";
    const loginUrl = strOpt(args.loginUrl) ?? profile?.loginUrl ?? "";
    if (!username || !password || !uSel || !pSel) {
      return { ok: false, error: "login needs username+password+usernameSelector+passwordSelector (or a profile that has them)" };
    }
    if (loginUrl) {
      emit({ type: "status", message: `Login: navigate ${loginUrl}` });
      await this.browser.navigate(loginUrl);
      await wait(800);
    }
    emit({ type: "status", message: "Login: filling credentials" });
    await this.browser.runContent({ op: "type_text", selector: uSel, text: username, submit: false });
    await this.browser.runContent({ op: "type_text", selector: pSel, text: password, submit: false });
    if (submit) {
      const clicked = await this.browser.runContent({ op: "click", selector: submit });
      if (!clicked.ok) return { ok: false, error: `submit selector not found: ${submit}` };
    }
    await wait(1200);
    return { ok: true, logged_in: true, profile: profileName ?? "(inline)" };
  }

  private async scrapeCatalog(
    args: Record<string, unknown>,
    workerModel: string,
    emit: (e: AgentEvent) => void,
    onUsage: (u: LlmUsage) => void,
  ): Promise<unknown> {
    const profileName = strOpt(args.profile);
    let profile: SiteProfile | null = null;
    if (profileName && this.profiles) profile = await this.profiles.get(profileName);

    const selector = strOpt(args.selector) ?? profile?.selector ?? "";
    const intent = strOpt(args.intent) ?? profile?.intent ?? "";
    const nextSelector = strOpt(args.nextSelector) ?? profile?.nextSelector ?? "";
    const nextText = strOpt(args.nextText) ?? profile?.nextText ?? "";
    const schemaHint = strOpt(args.schemaHint ?? args.schema_hint) ?? profile?.schemaHint ?? "";
    const maxPages = clampInt(args.maxPages, 20, 1, 100);

    if (!selector || !intent) {
      return { ok: false, error: "scrape_catalog needs selector + intent (or a profile that has them)" };
    }

    const allRows: unknown[] = [];
    const seen = new Set<string>();
    let pages = 0;
    const notes: string[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const items = await this.browser.runContent({ op: "query_all", selector, attributes: [] });
      if (!items.ok) {
        notes.push(`page ${page + 1}: query_all failed: ${items.error ?? "?"}`);
        break;
      }
      const values = (items.data as { values?: string[] } | undefined)?.values ?? [];
      if (values.length === 0 && page === 0) {
        notes.push("no items matched selector on first page");
        break;
      }
      emit({ type: "status", message: `Scrape page ${page + 1}: ${values.length} items` });
      const text = values.join("\n---\n").slice(0, 14_000);
      const parsed = await this.parseData({ intent, schema_hint: schemaHint, text }, workerModel, emit, onUsage);
      const data = (parsed as { data?: { rows?: unknown[]; notes?: string } } | undefined)?.data;
      const rows = Array.isArray(data?.rows) ? data!.rows! : [];
      for (const row of rows) {
        const sig = JSON.stringify(row);
        if (!seen.has(sig)) {
          seen.add(sig);
          allRows.push(row);
        }
      }
      pages += 1;
      if (values.length === 0) break;

      // advance to next page
      let advanced = false;
      if (nextSelector) {
        const click = await this.browser.runContent({ op: "click", selector: nextSelector });
        advanced = click.ok;
      } else if (nextText) {
        const found = await this.browser.runContent({ op: "find_text", text: nextText, scrollIntoView: true });
        const hits = (found.data as { matches?: Array<{ selector?: string }> } | undefined)?.matches ?? [];
        const sel = hits[0]?.selector;
        if (sel) {
          const click = await this.browser.runContent({ op: "click", selector: sel });
          advanced = click.ok;
        }
      }
      if (!advanced) {
        notes.push("no next page — stopped");
        break;
      }
      await wait(900);
    }

    return { ok: true, pages, count: allRows.length, rows: allRows, notes: notes.join("; ") || undefined };
  }

  private async scrapePdps(
    args: Record<string, unknown>,
    views: ViewStore | undefined,
    pageTemplates: PageTemplateCache | undefined,
    emit: (e: AgentEvent) => void,
    runCtx?: RunContext,
  ): Promise<unknown> {
    if (!views) return { ok: false, error: "view store unavailable" };
    const saps = Array.isArray(args.saps) ? args.saps.map(String).filter(Boolean) : [];
    const urls = Array.isArray(args.urls) ? args.urls.map(String).filter(Boolean) : [];
    const columns = Array.isArray(args.columns)
      ? args.columns.map(String)
      : ["ean", "packagedEan", "sap", "title", "url"];
    const keyColumns = Array.isArray(args.keyColumns)
      ? args.keyColumns.map(String)
      : [columns[0] ?? "ean"];
    const viewName = String(args.viewName ?? "scrape-pdps");
    const waitMs = clampInt(args.waitMs, 500, 100, 5_000);
    let baseUrl = strOpt(args.baseUrl) ?? "";
    if (!baseUrl) {
      const tabs = await this.browser.listTabs();
      try {
        baseUrl = tabs[0]?.url ? new URL(tabs[0].url).origin : "";
      } catch {
        baseUrl = "";
      }
    }
    const targets: Array<{ url: string; sap: string }> = [];
    for (const sap of saps) {
      if (!baseUrl) return { ok: false, error: "baseUrl required when using saps" };
      targets.push({ sap, url: `${baseUrl.replace(/\/$/, "")}/s/${sap}` });
    }
    for (const url of urls) targets.push({ sap: "", url });
    if (!targets.length) return { ok: false, error: "scrape_pdps needs saps or urls" };

    const view = await ensureView(views, { name: viewName, columns, keyColumns });
    const rowsOut: string[][] = [];
    const errors: string[] = [];
    let added = 0;
    let updated = 0;
    let removed = 0;
    const sampleKeys: string[] = [];

    for (let i = 0; i < targets.length; i += 1) {
      const t = targets[i]!;
      emit({ type: "status", message: `PDP ${i + 1}/${targets.length}: ${t.sap || t.url}` });
      try {
        await this.browser.navigate(t.url);
        await wait(waitMs);
        let digest = await this.browser.runContent({ op: "page_digest" });
        if (!digest.ok) {
          errors.push(`${t.sap || t.url}: digest failed`);
          continue;
        }
        let data = (digest.data ?? {}) as Record<string, unknown>;
        if (pageTemplates) data = pageTemplates.annotate(data);
        const labelHits = Array.isArray(data.labelHits)
          ? (data.labelHits as Array<{ label?: string; value?: string }>)
          : [];
        const eans = Array.isArray(data.eans) ? data.eans.map(String) : [];
        const findLabel = (re: RegExp) =>
          labelHits.find((h) => re.test(String(h.label ?? "")))?.value ?? "";
        const retail =
          findLabel(/^EAN(?!.*zbior)/i) ||
          findLabel(/^EAN\b/i) ||
          eans[0] ||
          "";
        const carton =
          findLabel(/zbiorcze|opakowanie|carton|packaged/i) ||
          eans.find((e) => e !== retail) ||
          eans[1] ||
          "";
        const sap =
          t.sap ||
          findLabel(/katalog|catalog|Materiał|sap/i) ||
          "";
        const title = String(data.title ?? "");
        const rowMap: Record<string, string> = {
          ean: retail,
          packagedEan: carton,
          sap,
          title,
          url: String(data.url ?? t.url),
        };
        const row = columns.map((c) => rowMap[c] ?? "");
        const { delta } = await upsertRows(views, view.id, [row], keyColumns);
        added += delta.added;
        updated += delta.updated;
        removed += delta.removed;
        for (const k of delta.sampleKeys) {
          if (sampleKeys.length < 8) sampleKeys.push(k);
        }
        rowsOut.push(row);
      } catch (e) {
        errors.push(`${t.sap || t.url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (runCtx?.changeLog && (added || updated || removed || rowsOut.length)) {
      const op =
        added && updated ? "mixed" : added ? "add" : updated ? "update" : "mixed";
      void runCtx.changeLog.append({
        viewId: view.id,
        viewName: view.name,
        op,
        added,
        updated,
        removed,
        sampleKeys,
        sourceTool: "scrape_pdps",
        sessionId: runCtx.sessionId,
      });
    }

    const refreshed = await views.get(view.id);
    return {
      ok: true,
      viewId: view.id,
      viewName: view.name,
      done: rowsOut.length,
      total: targets.length,
      rows: rowsOut,
      rowCount: Math.max(0, (refreshed?.rows?.length ?? 1) - 1),
      errors: errors.length ? errors : undefined,
    };
  }

  private async handleCreateMapReport(
    args: Record<string, unknown>,
    emit: (e: AgentEvent) => void,
  ): Promise<unknown> {
    const title = String(args.title ?? "Map").slice(0, 120);
    const locale = args.locale === "en" ? "en" : "pl";
    const rawMarkers = Array.isArray(args.markers) ? args.markers : [];
    const markers = rawMarkers
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => ({
        lat: Number(m.lat),
        lng: Number(m.lng),
        label: m.label != null ? String(m.label) : undefined,
        note: m.note != null ? String(m.note) : undefined,
      }));
    const center =
      args.center && typeof args.center === "object"
        ? {
            lat: Number((args.center as { lat?: unknown }).lat),
            lng: Number((args.center as { lng?: unknown }).lng),
          }
        : undefined;
    const zoom = typeof args.zoom === "number" ? args.zoom : undefined;

    const styleFetch = await fetchMapStyleJson(locale);
    const styleJson = "style" in styleFetch ? styleFetch.style : undefined;
    const html = buildMapHtml({
      title,
      markers,
      locale,
      center:
        center && Number.isFinite(center.lat) && Number.isFinite(center.lng)
          ? center
          : undefined,
      zoom,
      styleJson,
      styleUrl: "url" in styleFetch ? styleFetch.url : undefined,
    });
    // Store full document as the report body so publish_upload can re-host it as-is.
    const saved = await this.artifacts.saveReport({ title, bodyHtml: html });
    emit({
      type: "preview",
      preview: {
        kind: "html",
        title,
        html,
        interactive: true,
      },
    });
    let download: { ok: boolean; error?: string } = { ok: true };
    try {
      download = await this.browser.downloadText(
        `${title.replace(/[^\w.-]+/g, "_").slice(0, 40)}.html`,
        html,
        "text/html",
      );
    } catch (e) {
      download = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return {
      ok: true,
      reportId: saved.id,
      title: saved.title,
      markerCount: markers.filter(
        (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng),
      ).length,
      locale,
      styleInlined: Boolean(styleJson),
      styleNote:
        "style" in styleFetch
          ? undefined
          : `style fetch failed (${styleFetch.error}); HTML references CDN URL`,
      download,
      hint: "Map opened in preview. Call publish_upload({ filename:\"map.html\", reportId }) for a public https URL.",
    };
  }

  private async handlePublishUpload(
    args: Record<string, unknown>,
    connectors?: ConnectorRuntime,
    runCtx?: RunContext,
  ): Promise<unknown> {
    const filename = String(args.filename ?? "").trim();
    if (!filename) return { ok: false, error: "filename required" };

    let body: string | Uint8Array | undefined;
    let contentType: string | undefined;

    if (typeof args.reportId === "string" && args.reportId.trim()) {
      const report = await this.artifacts.getReport(args.reportId.trim());
      if (!report) return { ok: false, error: `report not found: ${args.reportId}` };
      body = report.bodyHtml;
      contentType = "text/html; charset=utf-8";
    } else if (typeof args.attachmentId === "string" && args.attachmentId.trim()) {
      if (!runCtx?.attachments) return { ok: false, error: "attachments unavailable" };
      const row = await runCtx.attachments.get(args.attachmentId.trim());
      if (!row) return { ok: false, error: `attachment not found: ${args.attachmentId}` };
      if (row.dataUrl) {
        const decoded = dataUrlToBytes(row.dataUrl);
        if (!decoded) return { ok: false, error: "attachment dataUrl decode failed" };
        body = decoded.bytes;
        contentType = decoded.mime;
      } else if (row.text) {
        body = row.text;
        contentType = row.mime || "text/plain; charset=utf-8";
      } else {
        return { ok: false, error: "attachment has no dataUrl or text" };
      }
    } else if (typeof args.text === "string") {
      body = args.text;
    } else {
      return {
        ok: false,
        error: "provide text, reportId, or attachmentId",
      };
    }
    if (body == null) return { ok: false, error: "empty upload body" };
    const uploadBody: string | Uint8Array = body;

    let bearerToken: string | undefined;
    const connectorId =
      typeof args.connectorId === "string" ? args.connectorId.trim() : "";
    if (connectorId) {
      if (!connectors?.store || !connectors.getSecret) {
        return { ok: false, error: "connectors unavailable for protected upload" };
      }
      if (connectors.allowedIds && !connectors.allowedIds.includes(connectorId)) {
        return { ok: false, error: `connector not allowed: ${connectorId}` };
      }
      const conn = await connectors.store.get(connectorId);
      if (!conn || conn.kind !== "rest") {
        return { ok: false, error: `REST connector not found: ${connectorId}` };
      }
      const auth = conn.headers.Authorization ?? conn.headers.authorization;
      if (auth && typeof auth === "object" && "vaultLabel" in auth) {
        bearerToken = (await connectors.getSecret(auth.vaultLabel)) ?? undefined;
        if (!bearerToken) {
          return { ok: false, error: `vault secret missing: ${auth.vaultLabel}` };
        }
      } else if (typeof auth === "string") {
        bearerToken = auth.replace(/^Bearer\s+/i, "");
      } else {
        return {
          ok: false,
          error: "connector missing Authorization vault ref (fc_uploads_key)",
        };
      }
    }

    const uploaded = await publishUpload({
      filename,
      body: uploadBody,
      contentType,
      workspaceId: typeof args.workspaceId === "string" ? args.workspaceId : undefined,
      appName: typeof args.appName === "string" ? args.appName : undefined,
      bearerToken,
      path: typeof args.path === "string" ? args.path : undefined,
    });
    if (!uploaded.ok) return uploaded;

    const openTab = args.openTab !== false;
    let opened: unknown;
    if (openTab) {
      try {
        opened = await this.browser.openTab(uploaded.file_url, true);
      } catch (e) {
        opened = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    return {
      ...uploaded,
      opened,
      hint: `Shareable URL: ${uploaded.file_url}`,
    };
  }

  private async runRestRequest(
    args: Record<string, unknown>,
    connectors?: ConnectorRuntime,
  ): Promise<unknown> {
    if (!connectors?.store) return { ok: false, error: "no connectors configured" };
    const id = String(args.connectorId ?? "");
    if (connectors.allowedIds && !connectors.allowedIds.includes(id)) {
      return { ok: false, error: `connector not allowed for this agent: ${id}` };
    }
    const conn = await connectors.store.get(id);
    if (!conn || conn.kind !== "rest") return { ok: false, error: `REST connector not found: ${id}` };
    return restRequest(
      conn,
      {
        method: typeof args.method === "string" ? args.method : "GET",
        path: String(args.path ?? "/"),
        query:
          args.query && typeof args.query === "object"
            ? (args.query as Record<string, string>)
            : undefined,
        body: args.body,
      },
      connectors.getSecret,
    );
  }

  private async runMcpList(
    args: Record<string, unknown>,
    connectors?: ConnectorRuntime,
  ): Promise<unknown> {
    if (!connectors?.store) return { ok: false, error: "no connectors configured" };
    const id = String(args.connectorId ?? "");
    if (connectors.allowedIds && !connectors.allowedIds.includes(id)) {
      return { ok: false, error: `connector not allowed for this agent: ${id}` };
    }
    const conn = await connectors.store.get(id);
    if (!conn || conn.kind !== "mcp") return { ok: false, error: `MCP connector not found: ${id}` };
    return mcpListTools(conn, connectors.getSecret);
  }

  private async runMcpCall(
    args: Record<string, unknown>,
    connectors?: ConnectorRuntime,
  ): Promise<unknown> {
    if (!connectors?.store) return { ok: false, error: "no connectors configured" };
    const id = String(args.connectorId ?? "");
    if (connectors.allowedIds && !connectors.allowedIds.includes(id)) {
      return { ok: false, error: `connector not allowed for this agent: ${id}` };
    }
    const conn = await connectors.store.get(id);
    if (!conn || conn.kind !== "mcp") return { ok: false, error: `MCP connector not found: ${id}` };
    const toolArgs =
      args.arguments && typeof args.arguments === "object"
        ? (args.arguments as Record<string, unknown>)
        : {};
    return mcpCall(conn, String(args.tool ?? ""), toolArgs, connectors.getSecret);
  }
}

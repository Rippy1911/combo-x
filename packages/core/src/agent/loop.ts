import { ArtifactStore, buildReportHtml } from "../local/artifacts.js";
import type { AttachmentStore } from "../attachments/store.js";
import {
  ATTACH_INLINE_PREVIEW,
  formatAttachmentInventory,
} from "../attachments/parse.js";
import type { ViewChartSpec, ViewStore } from "../local/views.js";
import { ensureView, upsertRows } from "../local/views.js";
import type { ConnectorStore } from "../connectors/store.js";
import { restRequest } from "../connectors/rest.js";
import { mcpCall, mcpListTools } from "../connectors/mcp.js";
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

export type ApprovalMode = "ask" | "auto_llm" | "auto_all";

export interface BrowserBridge {
  runContent(request: ContentRequest, tabId?: number): Promise<ContentResponse>;
  listTabs(): Promise<Array<{ id: number; title: string; url: string }>>;
  openTab(url: string, active?: boolean): Promise<{ id: number; url: string }>;
  activateTab(tabId: number): Promise<{ ok: boolean }>;
  navigate(url: string, tabId?: number): Promise<{ ok: boolean; url: string }>;
  goBack(tabId?: number): Promise<{ ok: boolean }>;
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

export interface AgentEvent {
  type:
    | "status"
    | "tool_start"
    | "tool_result"
    | "tool_approval"
    | "assistant_delta"
    | "done"
    | "error"
    | "usage";
  message?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  usage?: LlmUsage;
  toolCallId?: string;
  /** orchestrator | worker | approval */
  usageSource?: "orchestrator" | "worker" | "approval";
  resolve?: (allow: boolean) => void;
  /** Present on tool_result after the approval gate */
  approvalMode?: ApprovalMode;
  /** allowed | denied | auto_all | auto_llm | n/a */
  approvalDecision?: "allowed" | "denied" | "auto_all" | "auto_llm" | "n/a";
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
  /** Named Views (Views tab / save_view) */
  views?: ViewStore;
  /** Minimize steps/tokens — prefer page_digest + worker parse */
  budgetMode?: AgentBudgetMode;
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
You CAN open tabs (open_tab), navigate the current tab (navigate), go_back, and close_tab.
For interaction prefer get_interactive → click_index / type_index (Nanobrowser-style indices) over guessing CSS.
SCRAPE WORKFLOW (mandatory for multi-item scrapes):
1) ensure_scrape_table with columns BEFORE first navigate
2) Prefer scrape_pdps({ saps|urls }) OR page_digest per PDP — never dump get_page full
3) upsert_scrape_rows after each success (scrape_pdps does this for you)
4) export_csv / save_view when done
For catalogs: scrape_catalog OR scroll + query_all + parse_data (cheap worker).
Login: prefer login {profile} / save_site_profile — not manual password typing loops.
Connectors: rest_request / mcp_list_tools / mcp_call against user-configured connectors only.
Media: screenshot_viewport|element|full; start_recording / stop_recording for tab webm.
Local files: rag_search / rag_read_file; attachments via list_attachments / read_attachment.
Durable notes: remember / recall / memory_list.
Rules:
- Prefer page_digest / scrape_pdps over get_page.
- Prefer rag_search / read_attachment / USER MEMORIES over inventing facts.
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
    const budgetMode = options.budgetMode ?? "normal";
    const maxSteps = resolveMaxSteps(budgetMode, options.maxSteps);
    const resolveApprovalMode = (): ApprovalMode =>
      options.getApprovalMode?.() ?? options.approvalMode ?? "ask";
    const workerModel = options.workerModel ?? DEFAULT_WORKER_MODEL;
    const emit = options.onEvent ?? (() => undefined);
    const userContent = await this.buildUserContent(options);
    let systemBase = options.systemPrompt ?? DEFAULT_SYSTEM;
    if (budgetMode === "budget") systemBase = `${systemBase}\n\n${BUDGET_SYSTEM_ADDON}`;
    const memBlock = await this.formatMemoryInject();
    const messages: ChatMessage[] = [
      { role: "system", content: memBlock ? `${systemBase}\n\n${memBlock}` : systemBase },
      ...leanHistory(options.history ?? []),
      { role: "user", content: userContent },
    ];

    let usage = ZERO;
    let steps = 0;
    let finalText = "";
    const pageTemplates = new PageTemplateCache();

    for (let step = 0; step < maxSteps; step += 1) {
      if (options.signal?.aborted) {
        emit({ type: "done", message: "aborted", usage });
        return { messages, finalText, steps, usage, aborted: true, hitStepLimit: false };
      }

      emit({
        type: "status",
        message: `Working… turn ${step + 1} (limit ${maxSteps})`,
      });

      const tools =
        options.enabledTools && options.enabledTools.length > 0
          ? AGENT_TOOLS.filter((t) => options.enabledTools!.includes(t.function.name))
          : AGENT_TOOLS;

      let result: ChatResult;
      try {
        // Prefer streaming so the UI sees tokens; fall back to non-stream chat for mocks/old clients.
        if (typeof this.llm.chatStreaming === "function") {
          result = await this.llm.chatStreaming({
            model: options.model,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: 0.2,
            signal: options.signal,
            onDelta: (accumulated) => {
              emit({ type: "assistant_delta", message: accumulated });
            },
          });
        } else {
          result = await this.llm.chat({
            model: options.model,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: 0.2,
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        emit({ type: "error", message: msg });
        throw error;
      }

      usage = sumUsage(usage, result.usage);
      emit({ type: "usage", usage: result.usage, usageSource: "orchestrator" });
      steps += 1;

      if (result.toolCalls.length === 0) {
        finalText = result.content ?? "";
        messages.push({ role: "assistant", content: finalText });
        emit({ type: "assistant_delta", message: finalText });
        emit({ type: "done", usage });
        return { messages, finalText, steps, usage, aborted: false, hitStepLimit: false };
      }

      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        if (options.signal?.aborted) {
          emit({ type: "done", message: "aborted", usage });
          return { messages, finalText, steps, usage, aborted: true, hitStepLimit: false };
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
          },
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
    emit({ type: "done", message: finalText, usage });
    return { messages, finalText, steps, usage, aborted: false, hitStepLimit: true };
  }

  private async approve(
    call: ToolCall,
    args: Record<string, unknown>,
    mode: ApprovalMode,
    approvalModel: string,
    emit: (e: AgentEvent) => void,
    signal: AbortSignal | undefined,
    onUsage: (u: LlmUsage) => void,
  ): Promise<boolean> {
    if (!SENSITIVE_TOOLS.has(call.function.name)) return true;
    if (mode === "auto_all") return true;

    if (mode === "auto_llm") {
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

  /** First-call inject from the same MemoryStore `remember` writes (GAP-MEM-1). */
  private async formatMemoryInject(): Promise<string> {
    try {
      const top = await this.memory.list(8);
      if (!top.length) return "";
      const lines = top.map((m, i) => `${i + 1}. ${m.text.slice(0, 400)}`);
      return `USER MEMORIES (local; prefer these over inventing facts):\n${lines.join("\n")}`;
    } catch {
      return "";
    }
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
      previews.push(
        `--- ${r.name} (id=${r.id}) preview ---\n${slice}${
          r.text.length > ATTACH_INLINE_PREVIEW || r.truncated
            ? "\n…(truncated; use read_attachment for more)"
            : ""
        }`,
      );
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
  ): Promise<unknown> {
    const name = call.function.name;
    emit({ type: "tool_start", tool: name, args, toolCallId: call.id });

    try {
      let result: unknown;

      if (name === "list_tabs") {
        result = { tabs: await this.browser.listTabs() };
      } else if (name === "open_tab") {
        const url = String(args.url ?? "");
        result = await this.browser.openTab(url, true);
      } else if (name === "activate_tab") {
        result = await this.browser.activateTab(Number(args.tabId));
      } else if (name === "navigate") {
        result = await this.browser.navigate(String(args.url ?? ""));
      } else if (name === "go_back") {
        result = await this.browser.goBack();
      } else if (name === "close_tab") {
        result = await this.browser.closeTab(Number(args.tabId));
      } else if (name === "parse_data") {
        result = await this.parseData(args, workerModel, emit, onUsage);
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
          const maxChars = typeof args.maxChars === "number" ? args.maxChars : 12_000;
          const file = await attachments.read(id, maxChars);
          result = file
            ? { ok: true, ...file }
            : { ok: false, error: `attachment not found: ${id}` };
        }
      } else if (name === "remember") {
        const text = String(args.text ?? "");
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
        const entry = await this.memory.remember({ text, tags, kind: "note" });
        result = { saved: true, id: entry.id };
      } else if (name === "recall") {
        const query = String(args.query ?? "");
        const limit = typeof args.limit === "number" ? args.limit : 5;
        result = { hits: await this.memory.recall(query, limit) };
      } else if (name === "memory_list") {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        result = { memories: await this.memory.list(limit) };
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
        const bodyHtml = String(args.bodyHtml ?? "");
        const saved = await this.artifacts.saveReport({ title, bodyHtml });
        const html = buildReportHtml(title, bodyHtml);
        const dl = await this.browser.downloadText(
          `${title.replace(/[^\w.-]+/g, "_").slice(0, 40)}.html`,
          html,
          "text/html",
        );
        result = { ...saved, download: dl };
      } else if (name === "search_sessions") {
        if (!this.sessions) {
          result = { hits: [], error: "session store not available" };
        } else {
          const query = String(args.query ?? "");
          const limit = typeof args.limit === "number" ? args.limit : 8;
          const hits = await this.sessions.search(query, limit);
          result = {
            hits: hits.map((s) => ({
              id: s.id,
              title: s.title,
              updatedAt: s.updatedAt,
              preview: s.messages.find((m) => m.role === "user")?.content?.slice(0, 160),
            })),
          };
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
        result = await this.scrapeCatalog(args, workerModel, emit, onUsage);
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
            const saved = await upsertRows(views, existing.id, rows, keyColumns);
            result = {
              ok: true,
              id: saved.id,
              name: saved.name,
              rowCount: Math.max(0, (saved.rows?.length ?? 1) - 1),
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
        result = await this.scrapePdps(args, views, pageTemplates, emit);
      } else if (name === "rest_request") {
        result = await this.runRestRequest(args, connectors);
      } else if (name === "mcp_list_tools") {
        result = await this.runMcpList(args, connectors);
      } else if (name === "mcp_call") {
        result = await this.runMcpCall(args, connectors);
      } else if (name === "screenshot_viewport") {
        if (!this.browser.captureViewport) result = { ok: false, error: "capture unavailable" };
        else
          result = await this.browser.captureViewport(
            typeof args.windowId === "number" ? args.windowId : undefined,
          );
      } else if (name === "screenshot_element") {
        if (!this.browser.captureElement) result = { ok: false, error: "capture unavailable" };
        else {
          const tabs = await this.browser.listTabs();
          const tabId =
            typeof args.tabId === "number" ? args.tabId : (tabs[0]?.id ?? 0);
          result = await this.browser.captureElement(tabId, {
            selector: typeof args.selector === "string" ? args.selector : undefined,
            index: typeof args.index === "number" ? args.index : undefined,
          });
        }
      } else if (name === "screenshot_full") {
        if (!this.browser.captureFullPage) result = { ok: false, error: "capture unavailable" };
        else {
          const tabs = await this.browser.listTabs();
          const tabId =
            typeof args.tabId === "number" ? args.tabId : (tabs[0]?.id ?? 0);
          result = await this.browser.captureFullPage(tabId);
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
      return result;
    }
  }

  private async parseData(
    args: Record<string, unknown>,
    workerModel: string,
    emit: (e: AgentEvent) => void,
    onUsage: (u: LlmUsage) => void,
  ): Promise<unknown> {
    const intent = String(args.intent ?? "");
    const schemaHint = args.schema_hint != null ? String(args.schema_hint) : "";
    let text = typeof args.text === "string" ? args.text : "";
    let pageSource: "text" | "page_digest" | "get_page" = "text";
    if (args.use_page || !text.trim()) {
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

    emit({ type: "status", message: `Worker parse (${workerModel})…` });
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
      maxTokens: 4096,
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
        await upsertRows(views, view.id, [row], keyColumns);
        rowsOut.push(row);
      } catch (e) {
        errors.push(`${t.sap || t.url}: ${e instanceof Error ? e.message : String(e)}`);
      }
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
